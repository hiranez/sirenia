#!/usr/bin/env node
/**
 * build-gcp-icon-pack.mjs — official Google Cloud icon ZIPs → Iconify JSON pack for Mermaid.
 *
 *   node scripts/build-gcp-icon-pack.mjs            # fetch (sha256-pinned), build, write packs
 *   node scripts/build-gcp-icon-pack.mjs --check    # CI drift gate: fail if committed packs differ
 *   node scripts/build-gcp-icon-pack.mjs --legacy   # also emit the deprecated `gcp-legacy` pack
 *   node scripts/build-gcp-icon-pack.mjs --offline  # use ./.cache/gcp-icons only (no network)
 *   node scripts/build-gcp-icon-pack.mjs --out <dir>/gcp.json --no-docs   # one pack only, no catalog
 *   (--mapping <file> and --cache <dir> choose another recipe / ZIP cache; used by scripts/packs.mjs)
 *
 * Source of truth: icons/gcp/mapping.json (products, aliases, upstream URLs + checksums, and the
 * pack's label and trademark notices under `pack`, copied into the pack's `sirenia` object).
 * Each output directory also gets a regenerated `index.json` (scripts/packs/pack-index.mjs).
 * The SVG artwork is NOT modified visually — only render-identical normalization is applied
 * (Illustrator <style> classes inlined as presentation attributes, ids/comments/bounding-box
 * canvas removed) because Iconify injects icon bodies into one shared SVG document, where
 * per-file `.st1 { fill: … }` class rules would collide. Anything unexpected fails the build.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';
import { INDEX_FILE, buildPackIndex } from './packs/pack-index.mjs';

const { checkCatalog } = createRequire(import.meta.url)('../backend/utils/packFile.js');
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const args = new Set(process.argv.slice(2));
const opt = (name, def) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const MAPPING = resolve(repoRoot, opt('--mapping', 'icons/gcp/mapping.json'));
const CACHE = resolve(repoRoot, opt('--cache', '.cache/gcp-icons'));
const OUTPUTS = process.argv.includes('--out')
  ? process.argv.flatMap((a, i, arr) => (a === '--out' ? [resolve(repoRoot, arr[i + 1])] : []))
  : [resolve(repoRoot, 'backend/packs/gcp.json'), resolve(repoRoot, 'frontend/public/packs/gcp.json')];
const CHECK = args.has('--check');
const LEGACY = args.has('--legacy');
const OFFLINE = args.has('--offline');
const NO_DOCS = args.has('--no-docs'); // write only the packs and their index (used by scripts/packs.mjs)
const DOCS = resolve(repoRoot, opt('--docs', 'icons/gcp/CATALOG.md'));

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------------------------------------
// Fetch (pinned) ------------------------------------------------------------------------------
async function fetchZip(key, spec) {
  await mkdir(CACHE, { recursive: true });
  const cached = join(CACHE, `${key}-${spec.sha256.slice(0, 12)}.zip`);
  let buf;
  try {
    await access(cached);
    buf = await readFile(cached);
  } catch {
    if (OFFLINE) fail(`--offline but ${cached} is missing`);
    console.log(`↓ ${spec.url}`);
    const res = await fetch(spec.url, { redirect: 'follow' });
    if (!res.ok) fail(`HTTP ${res.status} fetching ${spec.url}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const digest = sha256(buf);
  if (digest !== spec.sha256) {
    // Deliberate: Google republishes these ZIPs in place (cache-control max-age=1800, no ETag).
    // A digest change means the icon set changed → review the diff, then update mapping.json.
    fail(`sha256 mismatch for ${key}: expected ${spec.sha256}, got ${digest}\n  Upstream icons changed. Review, then update upstream.zips.${key}.sha256 in mapping.json.`);
  }
  await writeFile(cached, buf);
  return unzipSync(new Uint8Array(buf));
}

// ---------------------------------------------------------------------------------------------
// SVG normalization (render-identical) -------------------------------------------------------
const FORBIDDEN = [
  /<style\b/i, /\sclass=/i, /\sid=/i, /url\(#/i, /<script\b/i, /<image\b/i, /<foreignObject\b/i,
  /<use\b/i, /xlink:href/i, /\shref=/i, /Gradient\b/i, /<clipPath\b/i, /<mask\b/i, /<filter\b/i,
  /<a\b/i, /javascript:/i, /on[a-z]+=/i,
];

function parseStyleRules(css) {
  const rules = {};
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = Object.fromEntries(
      m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const idx = d.indexOf(':');
        return [d.slice(0, idx).trim(), d.slice(idx + 1).trim()];
      }),
    );
    for (const sel of m[1].split(',')) {
      const cls = sel.trim().replace(/^\./, '');
      if (!/^[\w-]+$/.test(cls)) throw new Error(`unsupported CSS selector "${sel.trim()}"`);
      rules[cls] = { ...(rules[cls] || {}), ...decls };
    }
  }
  return rules;
}

function normalizeSvg(src, expectedViewBox) {
  let s = src.replace(/^﻿/, '').replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const open = s.match(/<svg\b[^>]*>/);
  if (!open) throw new Error('no <svg> root');
  const vb = /viewBox="([^"]+)"/.exec(open[0]);
  if (!vb) throw new Error('missing viewBox');
  const [x, y, w, h] = vb[1].trim().split(/[\s,]+/).map(Number);
  if (expectedViewBox && vb[1].trim() !== expectedViewBox) throw new Error(`viewBox ${vb[1]} ≠ ${expectedViewBox}`);

  // 1. Pull Illustrator <style> rules out, inline them as presentation attributes.
  let rules = {};
  s = s.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => { rules = { ...rules, ...parseStyleRules(css) }; return ''; });
  s = s.replace(/<defs>\s*<\/defs>/gi, '').replace(/<title>[\s\S]*?<\/title>/gi, '');
  s = s.replace(/\sclass="([^"]+)"/g, (_, cls) => cls.trim().split(/\s+/).map((c) => {
    const d = rules[c];
    if (!d) throw new Error(`unknown class "${c}"`);
    return Object.entries(d).map(([p, v]) => ` ${p}="${v}"`).join('');
  }).join(''));

  // 2. Drop the invisible artboard canvas (<g id="bounding_box"><rect fill="none" …/></g> or bare rect).
  s = s.replace(/<g id="bounding_box">[\s\S]*?<\/g>/g, '');
  s = s.replace(new RegExp(`<rect(?=[^>]*\\bwidth="${w}")(?=[^>]*\\bheight="${h}")(?=[^>]*fill="none")[^>]*\\/>`, 'g'), '');

  // 3. Strip identifiers/metadata that are meaningless (or collision-prone) inside a shared document.
  s = s.replace(/\s+(id|data-name)="[^"]*"/g, '');

  // Re-locate the root tag: the edits above changed offsets (e.g. the root's own id= was stripped).
  const root = s.match(/<svg\b[^>]*>/);
  const end = s.lastIndexOf('</svg>');
  if (!root || end === -1) throw new Error('lost <svg> root during normalization');
  const body = s.slice(root.index + root[0].length, end)
    .replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
  // Balanced <g> is a cheap proxy for "we did not cut through the tree".
  if ((body.match(/<g\b/g) || []).length !== (body.match(/<\/g>/g) || []).length) throw new Error('unbalanced <g>');
  if (!body || !/<(path|polygon|circle|rect|ellipse|polyline|line)\b/.test(body)) throw new Error('empty body');
  for (const re of FORBIDDEN) if (re.test(body)) throw new Error(`forbidden construct ${re}`);
  return { body, width: w, height: h, offsetX: x, offsetY: y };
}

// ---------------------------------------------------------------------------------------------
// Build ---------------------------------------------------------------------------------------
const mapping = JSON.parse(await readFile(MAPPING, 'utf8'));
const { prefix, icons: baseIcons, products, upstream } = mapping;

// Pack metadata for the application (label, owner, terms, notices): vendor wording lives in the
// pack, product wording in the application. Only the known keys are copied.
function sireniaMeta(meta) {
  if (!meta) return undefined;
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
  const out = { format: 1, ...pick(meta, ['label', 'owner', 'termsUrl']) };
  if (meta.notice) out.notice = pick(meta.notice, ['editor', 'editorAfter', 'export']);
  return out;
}
const SIRENIA = sireniaMeta(mapping.pack);

const zips = {};
for (const key of ['core', 'category', ...(LEGACY ? ['legacy'] : [])]) zips[key] = await fetchZip(key, upstream.zips[key]);

const svgIn = (zip, root, folder) =>
  Object.keys(zip).filter((p) => p.startsWith(`${root}/${folder}/SVG/`) && p.toLowerCase().endsWith('.svg') && !p.includes('__MACOSX'));

const icons = {};
const aliases = {};
const seen = new Map(); // name → owner (for uniqueness errors)
const claim = (name, owner) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(`"${name}" (${owner}) is not a valid icon name (lowercase, digits, single hyphens)`);
  if (seen.has(name)) fail(`duplicate icon/alias name "${name}" (${owner} vs ${seen.get(name)})`);
  seen.set(name, owner);
};

for (const icon of baseIcons) {
  const spec = upstream.zips[icon.zip];
  const files = svgIn(zips[icon.zip], spec.root, icon.folder);
  if (files.length !== 1) fail(`${icon.id}: expected exactly 1 SVG under "${spec.root}/${icon.folder}/SVG/", found ${files.length}`);
  try {
    const { body } = normalizeSvg(strFromU8(zips[icon.zip][files[0]]), '0 0 512 512');
    claim(icon.id, `icon ${icon.id}`);
    icons[icon.id] = { body };
    for (const a of icon.aliases || []) { claim(a, `icon ${icon.id}`); aliases[a] = { parent: icon.id }; }
  } catch (e) {
    fail(`${icon.id} (${files[0]}): ${e.message}`);
  }
}

const bySource = {};
for (const p of products) {
  bySource[p.source] = (bySource[p.source] || 0) + 1;
  if (!icons[p.icon]) fail(`product ${p.id}: icon "${p.icon}" is not a base icon`);
  if (!['guide', 'zip', 'extension'].includes(p.source)) fail(`product ${p.id}: invalid source "${p.source}"`);
  if (p.id !== p.icon) { claim(p.id, `product ${p.id}`); aliases[p.id] = { parent: p.icon }; }
  for (const a of p.aliases || []) { claim(a, `product ${p.id}`); aliases[a] = { parent: p.icon }; }
  if (LEGACY && p.legacy && !zips.legacy[`${p.legacy}/${p.legacy}.svg`]) fail(`product ${p.id}: legacy icon "${p.legacy}" not in legacy ZIP`);
}

// Picker catalog: official product names (one per product, plus the core icons no product names).
// Category icons are not products and get no entry. Checked with the validator that rejects the pack
// at install time, so a bad name fails here and not on the user's machine.
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const productIds = new Set(products.map((p) => p.id));
const catalog = [
  ...products.map((p) => ({ icon: p.id, name: p.name, group: p.category })),
  ...baseIcons.filter((i) => i.kind === 'core' && !productIds.has(i.id)).map((i) => ({ icon: i.id, name: i.name })),
].sort((a, b) => byText(a.name.toLowerCase(), b.name.toLowerCase()) || byText(a.icon, b.icon));

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const pack = {
  prefix,
  ...(SIRENIA ? { sirenia: { ...SIRENIA, catalog } } : {}),
  info: {
    name: 'Google Cloud product icons',
    total: Object.keys(icons).length,
    version: mapping.version,
    author: { name: 'Google LLC', url: upstream.page },
    license: { title: 'Google Cloud product icons — Google brand features; use subject to Google trademark guidelines (see icons/gcp/README.md)', url: upstream.page },
    samples: ['cloud-run', 'bigquery', 'gke'],
    height: 512,
    displayHeight: 48,
    palette: true,
  },
  width: 512,
  height: 512,
  icons: sortKeys(icons),
  aliases: sortKeys(aliases),
};

try {
  checkCatalog(catalog, pack, (msg) => { throw new Error(msg); });
} catch (e) {
  fail(e.message);
}

const outputs = [{ path: OUTPUTS, json: `${JSON.stringify(pack)}\n`, pack }];

if (LEGACY) {
  // Opt-in, deprecated by Google ("should not be used as of 2026"). Best effort: icons whose
  // artwork needs clipPath/mask/filter (a handful) are skipped because id-based references
  // cannot survive injection into a shared document without a real SVG toolchain.
  const legacyIcons = {};
  let skipped = 0;
  for (const path of Object.keys(zips.legacy).filter((p) => p.endsWith('.svg') && !p.includes('__MACOSX'))) {
    const name = path.split('/').pop().replace(/\.svg$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    try {
      legacyIcons[name] = { body: normalizeSvg(strFromU8(zips.legacy[path]), '0 0 24 24').body };
    } catch (e) {
      skipped++;
      console.warn(`  (legacy) skipped ${name}: ${e.message}`);
    }
  }
  const legacyPack = {
    prefix: `${prefix}-legacy`,
    ...(SIRENIA ? { sirenia: SIRENIA } : {}),
    info: { name: 'Google Cloud legacy console icons (DEPRECATED by Google as of 2026)', total: Object.keys(legacyIcons).length, author: { name: 'Google LLC', url: upstream.page }, height: 24, palette: true },
    width: 24, height: 24, icons: sortKeys(legacyIcons),
  };
  outputs.push({
    path: OUTPUTS.map((p) => p.replace(/gcp\.json$/, 'gcp-legacy.json')),
    json: `${JSON.stringify(legacyPack)}\n`,
    pack: legacyPack,
  });
  console.log(`legacy: ${Object.keys(legacyIcons).length} icons, ${skipped} skipped`);
}

// ---------------------------------------------------------------------------------------------
// Generated catalog (Docs) — keeps the human-readable equivalence table in lockstep with mapping
function renderCatalog() {
  const iconById = Object.fromEntries(baseIcons.map((i) => [i.id, i]));
  const code = (s) => `\`${s}\``;
  const lines = [
    '# Google Cloud icon catalog for Mermaid (`gcp:` pack)',
    '',
    `> **Generated** by \`scripts/build-gcp-icon-pack.mjs\` from \`icons/gcp/mapping.json\` (v${mapping.version}) — do not edit by hand.`,
    `> Source of the equivalence: Google's *Google Cloud product icons* guide (${upstream.guide.updated}) and the official icon ZIPs at <${upstream.page}>.`,
    '',
    `**${Object.keys(icons).length} icons** (${baseIcons.filter((i) => i.kind === 'core').length} unique core-product icons + ${baseIcons.filter((i) => i.kind === 'category').length} category icons), **${Object.keys(aliases).length} aliases**, **${products.length} products** (${bySource.guide} from Google's guide, ${bySource.zip ?? 0} shipped only in the ZIP, ${bySource.extension ?? 0} extensions).`,
    '',
    'Usage: `service x(gcp:<name>)[Label]` in `architecture-beta`, or `n@{ icon: "gcp:<name>", label: "…" }` in flowcharts. Any name in the **Mermaid icon** or **Aliases** columns works.',
    '',
    '**Legend** — *kind*: `core` = product-specific 4-color icon; `category` = shared 2-color category icon (Google\'s 2025 system deliberately reuses one icon per category, so always label the node). *Source*: `guide` = listed in Google\'s guide; `zip` = icon shipped but not listed; `extension` = not in Google\'s guide, mapped by this project to the closest official category — review on each upstream update.',
    '',
    '## Base icons',
    '',
    '| Icon id | Kind | Official name | Aliases |',
    '|---|---|---|---|',
    ...baseIcons.map((i) => `| ${code(`gcp:${i.id}`)} | ${i.kind} | ${i.name} | ${(i.aliases || []).map(code).join(', ') || '—'} |`),
    '',
    '## Products by category',
  ];
  const cats = [...new Set(products.map((p) => p.category))];
  for (const cat of cats) {
    lines.push('', `### ${cat}`, '', '| Product | Mermaid icon | Kind | Aliases | Source | Notes |', '|---|---|---|---|---|---|');
    for (const p of products.filter((x) => x.category === cat)) {
      const all = [p.id !== p.icon ? p.id : null, ...(p.aliases || [])].filter(Boolean);
      lines.push(`| ${p.name}${p.core ? ' ★' : ''} | ${code(`gcp:${p.id}`)} | ${iconById[p.icon].kind}${p.icon !== p.id ? ` → ${code(p.icon)}` : ''} | ${all.filter((a) => a !== p.id).map(code).join(', ') || '—'} | ${p.source} | ${[p.legacy ? `legacy: ${code(p.legacy)}` : null, p.note].filter(Boolean).join(' ') || '—'} |`);
    }
  }
  lines.push('', '★ = marked as a core product in Google\'s guide.', '', '## Not available in this pack', '', ...(mapping.excluded || []).map((e) => `- **${e.name}** — ${e.reason}`), '');
  return `${lines.join('\n')}\n`;
}
if (!NO_DOCS) outputs.push({ path: [DOCS], json: renderCatalog() });

let drift = false;
for (const { path, json } of outputs) {
  for (const p of path) {
    if (CHECK) {
      const current = await readFile(p, 'utf8').catch(() => null);
      if (current !== json) { drift = true; console.error(`✖ ${p} is out of date — run: node scripts/build-gcp-icon-pack.mjs`); }
      else console.log(`✓ ${p} up to date`);
    } else {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, json);
      console.log(`✓ wrote ${p} (${(json.length / 1024).toFixed(1)} KiB)`);
    }
  }
}

// index.json beside every pack written: rebuilt from all packs in that directory (so packs added
// by other means are listed too). In --check mode, compare against the index the packs generated
// above would produce.
const packDirs = new Map(); // dir → { file name → pack object }
for (const { path, pack: p } of outputs) {
  if (!p) continue;
  for (const file of path) {
    const dir = dirname(file);
    if (!packDirs.has(dir)) packDirs.set(dir, {});
    packDirs.get(dir)[basename(file)] = p;
  }
}
for (const [dir, generated] of packDirs) {
  const indexPath = join(dir, INDEX_FILE);
  const json = await buildPackIndex(dir, generated).catch((e) => fail(`${indexPath}: ${e.message}`));
  if (CHECK) {
    const current = await readFile(indexPath, 'utf8').catch(() => null);
    if (current !== json) { drift = true; console.error(`✖ ${indexPath} is out of date — run: node scripts/build-gcp-icon-pack.mjs`); }
    else console.log(`✓ ${indexPath} up to date`);
  } else {
    await writeFile(indexPath, json);
    console.log(`✓ wrote ${indexPath}`);
  }
}
console.log(`icons: ${pack.info.total} (${baseIcons.filter((i) => i.kind === 'core').length} core, ${baseIcons.filter((i) => i.kind === 'category').length} category) · aliases: ${Object.keys(aliases).length} · products: ${products.length} ${JSON.stringify(bySource)}`);
if (drift) process.exit(1);
