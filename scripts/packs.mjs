#!/usr/bin/env node
// packs.mjs: install, list and remove icon packs. This is the ONLY place that downloads vendor
// artwork: the renderer never fetches anything. A pack is one `<prefix>.json` file in a packs
// directory (see backend/utils/icons.js); the editor learns about it from the directory's
// `index.json`, which this command rebuilds after every change.
//
//   node scripts/packs.mjs list   [--dir <packs dir>]...
//   node scripts/packs.mjs add <recipe> [--dir <dir>]... [--accept-terms] [--offline]
//   node scripts/packs.mjs add --file <iconify.json> [--dir <dir>]...
//   node scripts/packs.mjs remove <prefix> [--dir <dir>]...
//
// A recipe is `icons/<name>/mapping.json` with a `pack` object (label, owner, `generator`, `terms`).
// The generator is run as `node <generator> --mapping <recipe> --out <dir>/<prefix>.json --no-docs
// [--offline] [--cache <dir>]`; `--cache` is passed only when PACKS_CACHE_DIR is set (the generator's
// own default download cache is inside the repository, which the container image cannot write).
// Node built-ins only; the recipe's generator may need more (the Google Cloud one needs `fflate`).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { INDEX_FILE, writePackIndex } from './packs/pack-index.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/; // same rule as the backend's pack prefix
const GENERATOR_TIMEOUT_MS = 10 * 60 * 1000;

const HELP = `Usage:
  node scripts/packs.mjs list   [--dir <packs dir>]...
  node scripts/packs.mjs add <recipe> [--dir <dir>]... [--accept-terms] [--offline]
  node scripts/packs.mjs add --file <iconify.json> [--dir <dir>]...
  node scripts/packs.mjs remove <prefix> [--dir <dir>]...

Commands:
  list     Show the available recipes and the packs installed in each directory.
  add      Install a pack. From a recipe: shows the vendor's terms, asks you to accept them,
           then downloads the artwork from the vendor, checks pinned SHA-256 checksums and writes
           the pack. With --file: installs an Iconify JSON pack you supply.
  remove   Delete a pack and rebuild the index.

Options:
  --dir <dir>        Packs directory (repeatable). Default: $PACKS_DIR if set, otherwise
                     backend/packs and frontend/public/packs of this repository.
  --accept-terms     Accept the vendor's terms without prompting (needed when stdin is not a terminal).
  --offline          Recipes only: use the local download cache, never the network.
  --file <file>      Install this Iconify JSON file as a pack (its "prefix" names the pack).
  --recipes <dir>    Recipes directory (default: $PACK_RECIPES_DIR, otherwise icons/).
  --help, -h         Show this help.

Environment:
  PACKS_CACHE_DIR    Download cache for recipes (a subdirectory per recipe). Default: the
                     generator's own cache in this repository (.cache/).

Nothing is downloaded or written until the terms are accepted. A checksum mismatch stops the
installation; there is no option to skip it.
`;

class UsageError extends Error {}
class Failure extends Error {}

// ---- arguments -------------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { positional: [], dirs: [], acceptTerms: false, offline: false, file: null, recipes: null, help: false };
  const takesValue = new Set(['--dir', '--file', '--recipes']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--accept-terms') out.acceptTerms = true;
    else if (a === '--offline') out.offline = true;
    else if (takesValue.has(a)) {
      const value = argv[++i];
      if (value === undefined || value === '' || value.startsWith('--')) throw new UsageError(`${a} needs a value`);
      if (a === '--dir') out.dirs.push(value);
      else if (a === '--file') out.file = value;
      else out.recipes = value;
    } else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else out.positional.push(a);
  }
  return out;
}

function checkName(value, what) {
  if (typeof value !== 'string' || !NAME.test(value)) {
    throw new UsageError(`invalid ${what} ${JSON.stringify(value)}: use lowercase letters, digits and single hyphens, starting with a letter`);
  }
  return value;
}

function targetDirs(opts) {
  let dirs;
  if (opts.dirs.length) dirs = opts.dirs.map((d) => path.resolve(d));
  else if (process.env.PACKS_DIR) dirs = [path.resolve(process.env.PACKS_DIR)];
  else dirs = [path.join(repoRoot, 'backend', 'packs'), path.join(repoRoot, 'frontend', 'public', 'packs')];
  return [...new Set(dirs)];
}

// ---- recipes ---------------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every `<root>/<name>/mapping.json` that has a `pack` object, keyed by its `prefix`. */
function discoverRecipes(opts) {
  const root = path.resolve(opts.recipes || process.env.PACK_RECIPES_DIR || path.join(repoRoot, 'icons'));
  const recipes = new Map();
  let names = [];
  try {
    names = fs.readdirSync(root).sort();
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`Recipes directory ${root} is not readable: ${e.message}`);
    return recipes;
  }
  for (const name of names) {
    const file = path.join(root, name, 'mapping.json');
    let mapping;
    try {
      mapping = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') console.error(`Recipe ${file} ignored: ${e.message}`);
      continue;
    }
    if (!isObject(mapping) || !isObject(mapping.pack) || typeof mapping.prefix !== 'string' || !NAME.test(mapping.prefix)) continue;
    recipes.set(mapping.prefix, {
      prefix: mapping.prefix,
      file,
      label: typeof mapping.pack.label === 'string' && mapping.pack.label ? mapping.pack.label : mapping.prefix,
      owner: typeof mapping.pack.owner === 'string' ? mapping.pack.owner : '',
      generator: mapping.pack.generator,
      terms: mapping.pack.terms,
      upstream: mapping.upstream,
    });
  }
  return recipes;
}

/** Where the artwork comes from: the recipe's page and its (non-deprecated) ZIP URLs. */
function upstreamUrls(recipe) {
  const urls = [];
  const up = recipe.upstream;
  if (!isObject(up)) return urls;
  for (const spec of Object.values(isObject(up.zips) ? up.zips : {})) {
    if (isObject(spec) && typeof spec.url === 'string' && !spec.deprecated) urls.push(spec.url);
  }
  return urls;
}

function checkTerms(recipe) {
  const t = recipe.terms;
  const ok = isObject(t) && Array.isArray(t.summary) && t.summary.length > 0 && t.summary.every((s) => typeof s === 'string' && s.trim())
    && typeof t.url === 'string' && t.url.startsWith('https://');
  if (!ok) throw new Failure(`The recipe "${recipe.prefix}" has no usable "pack.terms" (a summary and an https link), so its terms cannot be shown. Nothing was downloaded.`);
  if (typeof recipe.generator !== 'string' || !recipe.generator) throw new Failure(`The recipe "${recipe.prefix}" has no "pack.generator". Nothing was downloaded.`);
}

// ---- helpers ---------------------------------------------------------------------------------

function table(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
  return rows.map((r) => `  ${r.map((cell, c) => String(cell).padEnd(widths[c])).join('  ').trimEnd()}`).join('\n');
}

/** Installed packs of one directory: [{ prefix, label, icons, invalid? }], sorted. Missing dir = none. */
function installedPacks(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const packs = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.json') || n === INDEX_FILE || n.startsWith('.')) continue;
    const prefix = n.slice(0, -'.json'.length);
    try {
      const pack = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      packs.push({ prefix, label: pack?.sirenia?.label || pack?.info?.name || prefix, icons: Object.keys(pack?.icons ?? {}).length });
    } catch (e) {
      packs.push({ prefix, label: '', icons: 0, invalid: e.message });
    }
  }
  return packs;
}

/** First ancestor of `dir` (or `dir`) that does not exist yet, or null when `dir` exists. */
function firstMissing(dir) {
  let missing = null;
  for (let d = dir; !fs.existsSync(d); d = path.dirname(d)) missing = d;
  return missing;
}

const readIfExists = (file) => { try { return fs.readFileSync(file); } catch { return null; } };

/** Remember the pack and index of every target so that a failed install can put them back. */
function snapshot(dirs, prefix) {
  return dirs.map((dir) => ({
    dir,
    created: firstMissing(dir),
    pack: readIfExists(path.join(dir, `${prefix}.json`)),
    index: readIfExists(path.join(dir, INDEX_FILE)),
  }));
}

function restore(snap, prefix) {
  for (const s of snap) {
    if (s.created) { fs.rmSync(s.created, { recursive: true, force: true }); continue; }
    for (const [name, content] of [[`${prefix}.json`, s.pack], [INDEX_FILE, s.index]]) {
      const file = path.join(s.dir, name);
      if (content === null) fs.rmSync(file, { force: true });
      else fs.writeFileSync(file, content);
    }
  }
}

// ---- commands --------------------------------------------------------------------------------

function cmdList(opts) {
  const recipes = discoverRecipes(opts);
  console.log('Recipes (install with: packs add <recipe>)');
  if (recipes.size) console.log(table([['PREFIX', 'LABEL', 'OWNER'], ...[...recipes.values()].map((r) => [r.prefix, r.label, r.owner || '-'])]));
  else console.log('  none found');
  for (const dir of targetDirs(opts)) {
    console.log(`\nInstalled in ${dir}`);
    const packs = installedPacks(dir);
    if (!packs.length) { console.log('  no packs'); continue; }
    console.log(table([['PREFIX', 'LABEL', 'ICONS', 'FROM'], ...packs.map((p) => [
      p.prefix, p.invalid ? `(unreadable: ${p.invalid})` : p.label, p.invalid ? '-' : p.icons, recipes.has(p.prefix) ? 'recipe' : 'file',
    ])]));
  }
}

async function acceptance(opts, recipe) {
  if (opts.acceptTerms) { console.log('\nTerms accepted with --accept-terms.'); return; }
  if (!process.stdin.isTTY) {
    console.error(`\nThe terms above must be accepted before anything is downloaded. Re-run with --accept-terms to accept them. Nothing was downloaded or written.`);
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nDo you accept these terms for the ${recipe.label} icons? Type "yes" to continue: `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') throw new Failure('Terms not accepted. Nothing was downloaded or written.');
}

async function cmdAddRecipe(opts, name) {
  checkName(name, 'recipe name');
  const recipes = discoverRecipes(opts);
  const recipe = recipes.get(name);
  if (!recipe) {
    throw new Failure(`No recipe named "${name}". Available: ${[...recipes.keys()].join(', ') || 'none'}. To install your own pack use: add --file <iconify.json>`);
  }
  checkTerms(recipe);
  const generator = path.resolve(repoRoot, recipe.generator);
  if (!fs.existsSync(generator)) throw new Failure(`The generator of recipe "${name}" is missing: ${generator}`);

  console.log(`${recipe.label} icon pack${recipe.owner ? `, artwork by ${recipe.owner}` : ''} (prefix: ${recipe.prefix})`);
  const urls = upstreamUrls(recipe);
  console.log(opts.offline
    ? '\nThe artwork is read from the local download cache (--offline); nothing is fetched from the network.'
    : `\nThe artwork is downloaded from the vendor's own servers:\n${urls.map((u) => `  ${u}`).join('\n') || '  (see the recipe)'}`);
  console.log('Each download is checked against a pinned SHA-256 checksum; a mismatch stops the installation.');
  console.log('\nTerms (summary):');
  for (const line of recipe.terms.summary) console.log(`  - ${line}`);
  console.log(`\nFull terms: ${recipe.terms.url}`);
  await acceptance(opts, recipe);

  const dirs = targetDirs(opts);
  const snap = snapshot(dirs, recipe.prefix);
  const cache = process.env.PACKS_CACHE_DIR ? ['--cache', path.resolve(process.env.PACKS_CACHE_DIR, recipe.prefix)] : [];
  for (const dir of dirs) {
    const out = path.join(dir, `${recipe.prefix}.json`);
    const res = spawnSync(process.execPath, [generator, '--mapping', recipe.file, '--out', out, '--no-docs', ...(opts.offline ? ['--offline'] : []), ...cache], {
      cwd: repoRoot, encoding: 'utf8', timeout: GENERATOR_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
    });
    if (res.status !== 0) {
      restore(snap, recipe.prefix);
      const why = (res.stderr || res.stdout || res.error?.message || `exit status ${res.status}`).trim();
      throw new Failure(`Installing ${recipe.label} into ${dir} failed; nothing was installed.\n${why}`);
    }
    process.stdout.write(res.stdout);
  }
  console.log(`\nInstalled ${recipe.label} (${recipe.prefix}) in: ${dirs.join(', ')}`);
  console.log('Restart the server to load the change.');
}

async function cmdAddFile(opts) {
  const source = path.resolve(opts.file);
  let raw;
  try {
    raw = fs.readFileSync(source);
  } catch (e) {
    throw new Failure(`Cannot read ${source}: ${e.message}`);
  }
  let prefix;
  try {
    prefix = JSON.parse(raw.toString('utf8'))?.prefix;
  } catch (e) {
    throw new Failure(`${source} is not valid JSON: ${e.message}`);
  }
  if (typeof prefix !== 'string' || !NAME.test(prefix)) {
    throw new Failure(`${source}: "prefix" must be lowercase letters, digits and single hyphens, starting with a letter (got ${JSON.stringify(prefix)})`);
  }
  const recipes = discoverRecipes(opts);
  if (recipes.has(prefix)) {
    throw new Failure(`The prefix "${prefix}" belongs to the ${recipes.get(prefix).label} recipe. Install it with: packs add ${prefix}`);
  }
  // Validate with the render service's own rules, on a copy named after the prefix (the validator
  // checks that the file name matches the prefix).
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-add-'));
  try {
    const staged = path.join(stage, `${prefix}.json`);
    fs.writeFileSync(staged, raw);
    const { readPack } = createRequire(import.meta.url)('../backend/utils/packFile.js');
    try {
      readPack(staged);
    } catch (e) {
      throw new Failure(e.message.split(staged).join(source));
    }
    const dirs = targetDirs(opts);
    const snap = snapshot(dirs, prefix);
    try {
      for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = path.join(dir, `.${prefix}.json.tmp`);
        fs.writeFileSync(tmp, raw);
        fs.renameSync(tmp, path.join(dir, `${prefix}.json`));
        await writePackIndex(dir);
        console.log(`Installed ${prefix} in ${dir}`);
      }
    } catch (e) {
      restore(snap, prefix);
      throw new Failure(`Installing ${prefix} failed; nothing was installed: ${e.message}`);
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  console.log('Note: you are responsible for having the right to use the artwork in this pack.');
  console.log('Restart the server to load the change.');
}

async function cmdRemove(opts, prefix) {
  checkName(prefix, 'prefix');
  let removed = 0;
  for (const dir of targetDirs(opts)) {
    const file = path.join(dir, `${prefix}.json`);
    if (!fs.existsSync(file)) { console.log(`${prefix} is not installed in ${dir}`); continue; }
    fs.rmSync(file);
    // With no pack left the index is an empty list (`{"format":1,"packs":[]}`): the proxy answers a
    // missing index with the same list and the editor treats it as "no packs", so either works;
    // keeping the file means the directory stays self-describing.
    await writePackIndex(dir);
    removed++;
    console.log(`Removed ${prefix} from ${dir}`);
  }
  if (removed) console.log('Restart the server to load the change.');
}

// ---- main ------------------------------------------------------------------------------------

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return; }
  const [command, name, ...extra] = opts.positional;
  if (!command) throw new UsageError('missing command');
  if (extra.length) throw new UsageError(`unexpected argument ${JSON.stringify(extra[0])}`);
  const reject = (...flags) => {
    for (const f of flags) if (f.on) throw new UsageError(`${f.name} is not valid with "${command}"`);
  };
  const flagSet = {
    dir: { name: '--dir', on: false },
    file: { name: '--file', on: opts.file !== null },
    accept: { name: '--accept-terms', on: opts.acceptTerms },
    offline: { name: '--offline', on: opts.offline },
  };
  switch (command) {
    case 'list':
      if (name !== undefined) throw new UsageError('"list" takes no argument');
      reject(flagSet.file, flagSet.accept, flagSet.offline);
      return cmdList(opts);
    case 'add':
      if (opts.file !== null) {
        if (name !== undefined) throw new UsageError('use either "add <recipe>" or "add --file <file>", not both');
        reject(flagSet.accept, flagSet.offline);
        return cmdAddFile(opts);
      }
      if (name === undefined) throw new UsageError('"add" needs a recipe name or --file <file>');
      return cmdAddRecipe(opts, name);
    case 'remove':
      if (name === undefined) throw new UsageError('"remove" needs a pack prefix');
      reject(flagSet.file, flagSet.accept, flagSet.offline);
      return cmdRemove(opts, name);
    default:
      throw new UsageError(`unknown command ${JSON.stringify(command)}`);
  }
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`${e.message}\n\n${HELP}`);
    process.exit(2);
  }
  console.error(e instanceof Failure ? e.message : `Unexpected error: ${e.stack || e.message}`);
  process.exit(1);
}
