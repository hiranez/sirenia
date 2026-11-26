// Tests for scripts/packs.mjs. Run with: node --test scripts/packs.test.mjs
// Every test works in a temporary directory; the repository's own pack directories are never
// targeted. The command runs as a child process, as a person would run it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'packs.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
const fresh = (name = 'd') => path.join(tmp, `${name}-${counter++}`);

// stdin is a pipe (never a terminal), so the interactive prompt is never offered.
function run(args, env = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: tmp, encoding: 'utf8', input: '', env: { ...process.env, PACKS_DIR: '', PACK_RECIPES_DIR: '', PACKS_CACHE_DIR: '', ...env },
  });
  return { status: res.status, out: res.stdout, err: res.stderr, all: `${res.stdout}${res.stderr}` };
}

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
};
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : null);
const readIndex = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const demoPack = (prefix = 'demo', body = '<rect width="10" height="10"/>') => ({
  prefix,
  sirenia: { format: 1, label: 'Demo shapes', owner: 'Example Corp' },
  width: 16,
  height: 16,
  icons: { square: { body }, dot: { body: '<circle cx="8" cy="8" r="4"/>' } },
});

function gitState() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

// A recipes directory with one recipe whose "generator" is a script of ours.
function fixtureRecipe(generatorSource, prefix = 'acme') {
  const recipes = fresh('recipes');
  const gen = write(path.join(recipes, 'gen.mjs'), generatorSource);
  write(path.join(recipes, prefix, 'mapping.json'), {
    prefix,
    pack: {
      label: 'Acme Cloud',
      owner: 'Acme',
      generator: gen,
      terms: { summary: ['Acme icons are Acme trademarks.', 'Use them only in diagrams.'], url: 'https://example.com/acme-terms' },
    },
    upstream: { zips: { core: { url: 'https://example.com/acme-icons.zip', sha256: '0'.repeat(64) } } },
  });
  return recipes;
}

describe('add <recipe>', () => {
  test('without --accept-terms and without a terminal: exit 2, terms shown, nothing written', () => {
    const dir = fresh();
    const r = run(['add', 'gcp', '--dir', dir]);
    assert.equal(r.status, 2, r.all);
    assert.match(r.out, /Google Cloud/);
    assert.match(r.out, /trademarks and brand features of Google LLC/);
    assert.match(r.out, /https:\/\/about\.google\/brand-resource-center\//);
    assert.match(r.out, /services\.google\.com/);
    assert.match(r.err, /--accept-terms/);
    assert.equal(listing(dir), null, 'the target directory must not even be created');
    assert.ok(!/\bGCP\b/.test(r.all), 'user-facing text says Google Cloud, not GCP');
  });

  const cache = path.join(root, '.cache', 'gcp-icons');
  const haveCache = fs.existsSync(cache) && fs.readdirSync(cache).some((n) => n.endsWith('.zip'));
  test('gcp --accept-terms --offline writes the pack and index, nothing else',
    { skip: haveCache ? false : `no ${path.relative(root, cache)} on this machine (run npm run packs -- add gcp once online)` },
    () => {
      const dir = fresh();
      const before = gitState();
      const r = run(['add', 'gcp', '--dir', dir, '--accept-terms', '--offline']);
      assert.equal(r.status, 0, r.all);
      assert.deepEqual(listing(dir), ['gcp.json', 'index.json']);
      const committed = path.join(root, 'backend', 'packs', 'gcp.json');
      if (fs.existsSync(committed)) assert.ok(fs.readFileSync(path.join(dir, 'gcp.json')).equals(fs.readFileSync(committed)), 'pack differs from backend/packs/gcp.json');
      const index = readIndex(dir);
      assert.deepEqual(index.packs.map((p) => p.prefix), ['gcp']);
      assert.equal(index.packs[0].label, 'Google Cloud');
      const pack = JSON.parse(fs.readFileSync(path.join(dir, 'gcp.json'), 'utf8'));
      assert.ok(!('generator' in pack.sirenia) && !('terms' in pack.sirenia), 'recipe-only keys must not reach the pack');
      assert.equal(gitState(), before, 'nothing outside the target directory may change');
    });

  test('a failing generator leaves no partial file, restores what was there, creates no directory', () => {
    const recipes = fixtureRecipe(`
      import fs from 'node:fs';
      import path from 'node:path';
      const out = process.argv[process.argv.indexOf('--out') + 1];
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, 'partial');
      fs.writeFileSync(path.join(path.dirname(out), 'index.json'), 'partial');
      console.error('sha256 mismatch for core: expected 00, got 11');
      process.exit(1);
    `);
    const fresh1 = fresh();
    const r = run(['add', 'acme', '--dir', fresh1, '--recipes', recipes, '--accept-terms']);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /sha256 mismatch/);
    assert.equal(listing(fresh1), null);

    const existing = fresh();
    write(path.join(existing, 'acme.json'), demoPack('acme'));
    write(path.join(existing, 'index.json'), '{"format":1,"packs":[]}\n');
    const before = fs.readFileSync(path.join(existing, 'acme.json'));
    const r2 = run(['add', 'acme', '--dir', existing, '--recipes', recipes, '--accept-terms']);
    assert.notEqual(r2.status, 0);
    assert.ok(fs.readFileSync(path.join(existing, 'acme.json')).equals(before), 'an installed pack must survive a failed update');
    assert.equal(fs.readFileSync(path.join(existing, 'index.json'), 'utf8'), '{"format":1,"packs":[]}\n');
  });

  test('a recipe without terms is refused before anything runs', () => {
    const recipes = fixtureRecipe('process.exit(0)');
    const mapping = path.join(recipes, 'acme', 'mapping.json');
    const m = JSON.parse(fs.readFileSync(mapping, 'utf8'));
    delete m.pack.terms;
    write(mapping, m);
    const dir = fresh();
    const r = run(['add', 'acme', '--dir', dir, '--recipes', recipes, '--accept-terms']);
    assert.equal(r.status, 1, r.all);
    assert.equal(listing(dir), null);
  });

  test('an unknown recipe is refused and the available ones are named', () => {
    const r = run(['add', 'nope', '--dir', fresh()]);
    assert.equal(r.status, 1, r.all);
    assert.match(r.err, /No recipe named "nope"/);
  });

  test('PACKS_DIR is the default target', () => {
    const recipes = fixtureRecipe(`
      import fs from 'node:fs';
      import path from 'node:path';
      const out = process.argv[process.argv.indexOf('--out') + 1];
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify({ prefix: 'acme', icons: { a: { body: '<rect width="1" height="1"/>' } } }));
      fs.writeFileSync(path.join(path.dirname(out), 'index.json'), '{}');
    `);
    const dir = fresh();
    const r = run(['add', 'acme', '--recipes', recipes, '--accept-terms'], { PACKS_DIR: dir });
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(listing(dir), ['acme.json', 'index.json']);
  });

  test('PACKS_CACHE_DIR gives the generator a cache directory per recipe; unset, none is passed', () => {
    // The generator records the arguments it was given next to the pack.
    const recipes = fixtureRecipe(`
      import fs from 'node:fs';
      import path from 'node:path';
      const out = process.argv[process.argv.indexOf('--out') + 1];
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify({ prefix: 'acme', icons: { a: { body: '<rect width="1" height="1"/>' } } }));
      fs.writeFileSync(path.join(path.dirname(out), 'args.txt'), JSON.stringify(process.argv.slice(2)));
    `);
    const args = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'args.txt'), 'utf8'));
    const cacheRoot = fresh('cache');
    const withCache = fresh();
    const r = run(['add', 'acme', '--dir', withCache, '--recipes', recipes, '--accept-terms'], { PACKS_CACHE_DIR: cacheRoot });
    assert.equal(r.status, 0, r.all);
    const a = args(withCache);
    assert.equal(a[a.indexOf('--cache') + 1], path.join(cacheRoot, 'acme'));
    const without = fresh();
    assert.equal(run(['add', 'acme', '--dir', without, '--recipes', recipes, '--accept-terms']).status, 0);
    assert.ok(!args(without).includes('--cache'), 'without PACKS_CACHE_DIR the generator keeps its own default');
    assert.match(r.out, /Restart the server to load the change\./);
  });
});

// A generator that writes a one-icon pack for the recipe it is given, or fails when the recipe says so.
const PACK_WRITER = `
  import fs from 'node:fs';
  import path from 'node:path';
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const mapping = JSON.parse(fs.readFileSync(arg('--mapping'), 'utf8'));
  if (mapping.fail) { console.error('sha256 mismatch for icons: expected 00, got 11'); process.exit(1); }
  const out = arg('--out');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ prefix: mapping.prefix, sirenia: { format: 1, label: mapping.pack.label }, icons: { a: { body: '<rect width="1" height="1"/>' } } }));
  const packs = fs.readdirSync(path.dirname(out)).filter((n) => n.endsWith('.json') && n !== 'index.json').sort();
  fs.writeFileSync(path.join(path.dirname(out), 'index.json'), JSON.stringify({ format: 1, packs: packs.map((n) => ({ prefix: n.slice(0, -5), file: n })) }));
`;

// A recipes directory with several recipes that share the generator above.
function fixtureRecipes(specs) {
  const recipes = fresh('recipes');
  const gen = write(path.join(recipes, 'gen.mjs'), PACK_WRITER);
  for (const { prefix, label, fail } of specs) {
    write(path.join(recipes, prefix, 'mapping.json'), {
      prefix,
      ...(fail ? { fail: true } : {}),
      pack: {
        label,
        owner: `${label} Inc.`,
        generator: gen,
        terms: { summary: [`${label} icons are ${label} trademarks.`], url: `https://example.com/${prefix}-terms` },
      },
      upstream: { zips: { icons: { url: `https://example.com/${prefix}.zip`, sha256: '0'.repeat(64) } } },
    });
  }
  return recipes;
}

describe('add with several recipes', () => {
  const two = () => fixtureRecipes([{ prefix: 'acme', label: 'Acme Cloud' }, { prefix: 'beta', label: 'Beta Cloud' }]);

  test('one command installs each named recipe; --accept-terms covers the ones named', () => {
    const recipes = two();
    const dir = fresh();
    const r = run(['add', 'acme', 'beta', '--dir', dir, '--recipes', recipes, '--accept-terms']);
    assert.equal(r.status, 0, r.all);
    assert.deepEqual(listing(dir), ['acme.json', 'beta.json', 'index.json']);
    for (const label of ['Acme Cloud', 'Beta Cloud']) assert.match(r.out, new RegExp(`${label} icons are ${label} trademarks`));
    assert.match(r.out, /https:\/\/example\.com\/acme-terms[\s\S]*https:\/\/example\.com\/beta-terms/);
    assert.match(r.out, /accepted with --accept-terms for: Acme Cloud, Beta Cloud/);
    assert.match(r.out, /Installed: Acme Cloud \(acme\), Beta Cloud \(beta\)\. Restart the server/);
  });

  test('without acceptance and without a terminal: every vendor\'s terms are shown, nothing is written', () => {
    const dir = fresh();
    const r = run(['add', 'acme', 'beta', '--dir', dir, '--recipes', two()]);
    assert.equal(r.status, 2, r.all);
    assert.match(r.out, /acme-terms/);
    assert.match(r.out, /beta-terms/);
    assert.match(r.err, /--accept-terms/);
    assert.equal(listing(dir), null);
  });

  test('an unknown name stops everything before any terms are shown or files written', () => {
    const dir = fresh();
    const r = run(['add', 'acme', 'nope', 'other', '--dir', dir, '--recipes', two(), '--accept-terms']);
    assert.equal(r.status, 1, r.all);
    assert.match(r.err, /No recipe named "nope", "other"\. Available: acme, beta/);
    assert.doesNotMatch(r.out, /Terms \(summary\)/);
    assert.equal(listing(dir), null);
  });

  test('a failing recipe is reported and leaves nothing behind; the others are installed', () => {
    const recipes = fixtureRecipes([{ prefix: 'acme', label: 'Acme Cloud', fail: true }, { prefix: 'beta', label: 'Beta Cloud' }]);
    const dir = fresh();
    const r = run(['add', 'acme', 'beta', '--dir', dir, '--recipes', recipes, '--accept-terms']);
    assert.equal(r.status, 1, r.all);
    assert.match(r.err, /Installing Acme Cloud \(acme\) into .* failed[\s\S]*sha256 mismatch/);
    assert.match(r.err, /Not installed: Acme Cloud \(acme\): installation failed/);
    assert.deepEqual(listing(dir), ['beta.json', 'index.json']);
  });

  test('a name given twice is installed once; "all" is not a recipe name', () => {
    const recipes = two();
    const dir = fresh();
    const r = run(['add', 'beta', 'beta', '--dir', dir, '--recipes', recipes, '--accept-terms']);
    assert.equal(r.status, 0, r.all);
    assert.equal(r.out.match(/Installing Beta Cloud/g).length, 1);
    const all = run(['add', 'all', '--dir', fresh(), '--recipes', recipes, '--accept-terms']);
    assert.equal(all.status, 1, all.all);
    assert.match(all.err, /No recipe named "all"/);
  });

  test('a bad name among several is a usage error', () => {
    const r = run(['add', 'acme', '../x', '--dir', fresh(), '--recipes', two()]);
    assert.equal(r.status, 2, r.all);
  });
});

describe('add --file', () => {
  test('installs a valid pack unchanged into every --dir and rebuilds the index', () => {
    const file = write(path.join(fresh('src'), 'whatever-name.json'), `${JSON.stringify(demoPack())}\n`);
    const [a, b] = [fresh(), fresh()];
    const r = run(['add', '--file', file, '--dir', a, '--dir', b]);
    assert.equal(r.status, 0, r.all);
    assert.match(r.out, /responsible for having the right/);
    for (const dir of [a, b]) {
      assert.deepEqual(listing(dir), ['demo.json', 'index.json']);
      assert.ok(fs.readFileSync(path.join(dir, 'demo.json')).equals(fs.readFileSync(file)));
      assert.deepEqual(readIndex(dir).packs.map((p) => [p.prefix, p.label, p.icons]), [['demo', 'Demo shapes', 2]]);
    }
  });

  test('a pack containing a script is refused with the reason, nothing written', () => {
    const file = write(path.join(fresh('src'), 'bad.json'), demoPack('demo', '<script>alert(1)</script>'));
    const dir = fresh();
    const r = run(['add', '--file', file, '--dir', dir]);
    assert.equal(r.status, 1, r.all);
    assert.match(r.err, /icon "square": active or embedding element/);
    assert.ok(r.err.includes(file), 'the message names the file the person supplied');
    assert.equal(listing(dir), null);
  });

  test('a prefix that belongs to a recipe is refused and points to "add <recipe>"', () => {
    const file = write(path.join(fresh('src'), 'gcp.json'), demoPack('gcp'));
    const dir = fresh();
    const r = run(['add', '--file', file, '--dir', dir]);
    assert.equal(r.status, 1, r.all);
    assert.match(r.err, /packs add gcp/);
    assert.equal(listing(dir), null);
  });

  test('a bad prefix, bad JSON or a missing file is refused', () => {
    const dir = fresh();
    for (const content of [demoPack('../x'), demoPack('GCP'), '{ nope']) {
      const file = write(path.join(fresh('src'), 'p.json'), content);
      assert.equal(run(['add', '--file', file, '--dir', dir]).status, 1);
    }
    assert.equal(run(['add', '--file', path.join(tmp, 'missing.json'), '--dir', dir]).status, 1);
    assert.equal(listing(dir), null);
  });
});

describe('list and remove', () => {
  test('list works with missing directories and shows recipes, installed packs and their origin', () => {
    const missing = fresh();
    const r0 = run(['list', '--dir', missing]);
    assert.equal(r0.status, 0, r0.all);
    assert.match(r0.out, /gcp\s+Google Cloud\s+Google/);
    assert.match(r0.out, /no packs/);
    assert.equal(listing(missing), null, 'list never writes');

    const dir = fresh();
    run(['add', '--file', write(path.join(fresh('src'), 'd.json'), demoPack()), '--dir', dir]);
    const r1 = run(['list', '--dir', dir]);
    assert.match(r1.out, /demo\s+Demo shapes\s+2\s+file/);

    const none = run(['list', '--dir', dir, '--recipes', fresh('empty')]);
    assert.equal(none.status, 0, none.all);
    assert.match(none.out, /none found/);
  });

  test('remove deletes the pack, rebuilds the index and leaves an empty list when none is left', () => {
    const dir = fresh();
    for (const p of ['demo', 'other']) run(['add', '--file', write(path.join(fresh('src'), `${p}.json`), demoPack(p)), '--dir', dir]);
    assert.equal(run(['remove', 'demo', '--dir', dir]).status, 0);
    assert.deepEqual(listing(dir), ['index.json', 'other.json']);
    assert.deepEqual(readIndex(dir).packs.map((p) => p.prefix), ['other']);
    assert.equal(run(['remove', 'other', '--dir', dir]).status, 0);
    assert.deepEqual(listing(dir), ['index.json']);
    assert.deepEqual(readIndex(dir), { format: 1, packs: [] });
  });

  test('removing something that is not installed exits 0 and changes nothing', () => {
    const dir = fresh();
    const r = run(['remove', 'demo', '--dir', dir]);
    assert.equal(r.status, 0, r.all);
    assert.match(r.out, /not installed/);
    assert.equal(listing(dir), null);
  });
});

describe('argument validation', () => {
  test('path-shaped or malformed names are refused with exit 2', () => {
    const dir = fresh();
    for (const name of ['../x', '..', 'a/b', 'GCP', 'Gcp', '-x', 'x-', 'a--b', '1a', '']) {
      for (const cmd of ['add', 'remove']) {
        const r = run([cmd, name, '--dir', dir]);
        assert.equal(r.status, 2, `${cmd} ${JSON.stringify(name)}: ${r.all}`);
      }
    }
    assert.equal(listing(dir), null);
  });

  test('unknown commands and options print the help and exit 2; --help exits 0', () => {
    for (const args of [[], ['frobnicate'], ['list', '--nope'], ['add'], ['remove'], ['list', 'extra'], ['add', 'gcp', '--dir'], ['remove', 'x', '--accept-terms'], ['add', 'gcp', '--file', 'f.json']]) {
      const r = run(args);
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.all}`);
      assert.match(r.err, /Usage:/);
    }
    const help = run(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.out, /Usage:/);
  });
});
