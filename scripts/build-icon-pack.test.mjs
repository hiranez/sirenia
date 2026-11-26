// Tests for scripts/build-icon-pack.mjs. Run with: node --test scripts/build-icon-pack.test.mjs
// Every SVG here is a synthetic drawing made for the test (squares, circles, gradients); no vendor
// artwork. The ZIPs are built in memory and put in a cache directory, so no test touches the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { BuildError, displayName, iconKey, normalizeSvg } from './build-icon-pack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'build-icon-pack.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'build-icon-pack-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let counter = 0;
const fresh = (name) => {
  const dir = path.join(tmp, `${name}-${counter++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- synthetic artwork ------------------------------------------------------------------------

// A square filled with a gradient whose id and class names are the same in every file, as design
// tools write them; only the colours differ.
const gradientSquare = (from, to) => `<?xml version="1.0" encoding="UTF-8"?>
<!-- drawn for the test -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="18" height="18" viewBox="0 0 18 18" id="root-id">
  <title>Square</title>
  <defs>
    <style>.cls-1{fill:url(#grad);}.cls-2{fill:${to};stroke:#000}</style>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="18" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient>
    <linearGradient id="grad-ref" xlink:href="#grad" x1="0" y1="0" x2="18" y2="0"/>
  </defs>
  <g id="Layer_1" data-name="Layer 1">
    <rect class="cls-1" x="1" y="1" width="16" height="16"/>
    <circle class="cls-2" cx="9" cy="9" r="3" fill="red"/>
    <rect x="2" y="2" width="2" height="2" fill="url('#grad-ref')"/>
  </g>
</svg>
`;
const plainCircle = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="64px" height="64px" viewBox="0 0 64 64"><g id="Icon" fill="${fill}"><circle cx="32" cy="32" r="30"/></g></svg>`;

describe('normalizeSvg', () => {
  test('metadata goes, class rules become attributes, referenced ids are renamed for the icon', () => {
    const { body, left, top, width, height } = normalizeSvg(gradientSquare('#112233', '#445566'), 'demo-square', 'square.svg');
    assert.deepEqual([left, top, width, height], [0, 0, 18, 18]);
    assert.doesNotMatch(body, /<title|<style|<!--|class=|data-name|root-id|Layer_1/);
    assert.match(body, /<linearGradient id="demo-square-1" /);
    assert.match(body, /<linearGradient id="demo-square-2" xlink:href="#demo-square-1"/);
    assert.match(body, /<rect x="1" y="1" width="16" height="16" fill="url\(#demo-square-1\)"\/>/);
    // The class rule beats the presentation attribute it replaces.
    assert.match(body, /<circle cx="9" cy="9" r="3" fill="#445566" stroke="#000"\/>/);
    assert.match(body, /fill="url\(#demo-square-2\)"/);
    assert.doesNotMatch(body, /\bgrad\b/);
  });

  test('two icons with the same ids and class names come out with nothing in common', () => {
    const a = normalizeSvg(gradientSquare('#ff0000', '#00ff00'), 'demo-a').body;
    const b = normalizeSvg(gradientSquare('#0000ff', '#ffff00'), 'demo-b').body;
    const ids = (s) => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids(a).filter((id) => ids(b).includes(id)).length, 0);
    assert.deepEqual(ids(a), ['demo-a-1', 'demo-a-2']);
    // Same drawing apart from the colours and the id names.
    assert.equal(a.replace(/demo-a/g, 'X').replace(/#ff0000/g, 'C1').replace(/#00ff00/g, 'C2'), b.replace(/demo-b/g, 'X').replace(/#0000ff/g, 'C1').replace(/#ffff00/g, 'C2'));
  });

  test('root presentation attributes are kept on a group; a missing viewBox comes from width and height', () => {
    const { body, width, height } = normalizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" xviewBox="0 0 18 18" fill="none" stroke="#123456"><path d="M0 0h1"/></svg>', 'x');
    assert.equal(body, '<g fill="none" stroke="#123456"><path d="M0 0h1"/></g>');
    assert.deepEqual([width, height], [18, 18]);
    assert.equal(normalizeSvg('<svg viewBox="0 0 4 4"><rect width="4" height="4"/>​</svg>', 'x').body, '<rect width="4" height="4"/>');
  });

  test('anything that is not plain artwork fails with the reason', () => {
    const svg = (inner, attrs = 'viewBox="0 0 4 4"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}<rect width="4" height="4"/></svg>`;
    const cases = [
      [svg('<script>alert(1)</script>'), /forbidden element <script/],
      [svg('<image href="https://example.com/x.png"/>'), /forbidden element <image/],
      [svg('<foreignObject></foreignObject>'), /forbidden element <foreignObject/],
      [svg('<text>A</text>'), /forbidden element <text/],
      [svg('<use href="#a"/>'), /forbidden element <use/],
      [svg('<rect onclick="x()" width="1" height="1"/>'), /event-handler/],
      [svg('<linearGradient id="g" href="https://example.com/g.svg#a"/>'), /external reference href/],
      [svg('<rect fill="url(https://example.com/a.svg#g)" width="1" height="1"/>'), /external reference in fill/],
      [svg('<style>rect{fill:red}</style>'), /unsupported CSS selector "rect"/],
      [svg('<style>.a{transform:scale(2)}</style>'), /CSS property "transform"/],
      [svg('<style>@import url(x.css);</style>'), /at-rules/],
      [svg('<g>'), /not closed|unbalanced/],
      [svg('hello'), /unexpected text "hello"/],
      [svg('', ''), /no viewBox/],
      [svg('', 'viewBox="0 0 4 4" preserveAspectRatio="none"'), /preserveAspectRatio/],
      [svg('', 'viewBox="0 0 4 4" transform="rotate(90)"'), /transform on the <svg> root/],
      ['<svg viewBox="0 0 4 4"><g/></svg>', /no shapes/],
    ];
    for (const [source, reason] of cases) {
      assert.throws(() => normalizeSvg(source, 'x', 't.svg'), (e) => e instanceof BuildError && reason.test(e.message), source);
    }
  });
});

test('names and keys come from file names', () => {
  assert.equal(displayName('Amazon-EC2'), 'Amazon EC2');
  assert.equal(displayName('AWS-IoT_Thing_Coffee-Pot'), 'AWS IoT Thing Coffee Pot');
  assert.equal(displayName('Cloud-Services-(extended-support)'), 'Cloud Services (extended support)');
  assert.equal(displayName('Arc-PostgreSQL '), 'Arc PostgreSQL');
  assert.equal(iconKey('Amazon EC2'), 'amazon-ec2');
  assert.equal(iconKey('AWS Elemental Appliances & Software'), 'aws-elemental-appliances-software');
  assert.equal(iconKey('Web App + Database'), 'web-app-database');
  assert.equal(iconKey('Cloud Services (extended support)'), 'cloud-services-extended-support');
});

// ---- the command, on a synthetic vendor ZIP ---------------------------------------------------

const ZIP_FILES = {
  // Service icons in four sizes; one size is taken. One is filed in two categories (same drawing).
  'Pkg/Svc_Compute/16/Svc_Acme-Engine_16.svg': plainCircle('#100000'),
  'Pkg/Svc_Compute/64/Svc_Acme-Engine_64.svg': plainCircle('#ff9900'),
  'Pkg/Svc_Compute/64/Svc_Acme-Tool_64.svg': plainCircle('#00aa00'),
  'Pkg/Svc_Storage/64/Svc_Acme-Tool_64.svg': plainCircle('#00aa00'),
  'Pkg/Svc_Storage/64/Svc_Acme-Bucket_64.svg': gradientSquare('#3366ff', '#99ccff'),
  'Pkg/Svc_Storage/64/Svc_Acme-Bucket_Dark_64.svg': gradientSquare('#000000', '#111111'),
  // Same drawing, different name: an alias.
  'Pkg/Svc_Storage/64/Svc_Acme-Bucket-Classic_64.svg': gradientSquare('#3366ff', '#99ccff'),
  // Two different drawings with one name, told apart by the vendor's number.
  'Pkg/Svc_Storage/64/00012-Svc_Acme-Vault_64.svg': plainCircle('#123456'),
  'Pkg/Svc_Storage/64/00034-Svc_Acme-Vault_64.svg': plainCircle('#654321'),
  // A misspelt file name, corrected by an override.
  'Pkg/Svc_Storage/64/Svc_Acme-Bukket_64.svg': plainCircle('#abcdef'),
  'Pkg/readme.txt': 'not an icon',
  '__MACOSX/Pkg/Svc_Compute/64/._Svc_Acme-Engine_64.svg': 'resource fork',
};

function recipe(dir, zipBytes, extra = {}) {
  const mapping = {
    version: 'test',
    prefix: 'acme',
    pack: {
      label: 'Acme Cloud',
      owner: 'Acme',
      termsUrl: 'https://example.com/terms',
      generator: 'scripts/build-icon-pack.mjs',
      terms: { summary: ['Acme icons are Acme trademarks.', "Acme's own terms prevail over this summary."], url: 'https://example.com/terms' },
      notice: { editor: 'Acme icons are trademarks of Acme.', export: 'Acme icons are trademarks of Acme, used unmodified.' },
    },
    upstream: { page: 'https://example.com/icons', zips: { icons: { url: 'https://example.invalid/acme.zip', sha256: sha256(zipBytes) } } },
    kinds: { service: 'service icons' },
    sets: [{ kind: 'service', zip: 'icons', pattern: '^Pkg/Svc_(?<group>[^/]+)/(?:16|64)/(?:(?<id>\\d+)-)?Svc_(?<name>[^/]+?)_(?:16|64)\\.svg$' }],
    exclude: [
      { pattern: '_Dark_\\d+\\.svg$', reason: 'Dark variants.' },
      { pattern: '/16/', reason: 'Other sizes.' },
    ],
    groups: { Compute: 'Compute', Storage: 'Storage & Archive' },
    overrides: { 'Pkg/Svc_Storage/64/Svc_Acme-Bukket_64.svg': { name: 'Acme Bucket Store', key: 'acme-bucket-store' } },
    ...extra,
  };
  const file = path.join(dir, 'mapping.json');
  fs.writeFileSync(file, JSON.stringify(mapping));
  return file;
}

function setup(extra, files = ZIP_FILES) {
  const dir = fresh('recipe');
  const zip = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  const cache = fresh('cache');
  const mapping = recipe(dir, zip, extra);
  const sha = JSON.parse(fs.readFileSync(mapping, 'utf8')).upstream.zips.icons.sha256;
  fs.writeFileSync(path.join(cache, `icons-${sha.slice(0, 12)}.zip`), zip);
  return { dir, cache, mapping, out: path.join(fresh('out'), 'acme.json'), docs: path.join(dir, 'CATALOG.md') };
}

const generate = (args) => {
  const res = spawnSync(process.execPath, [script, ...args], { cwd: tmp, encoding: 'utf8' });
  return { status: res.status, out: res.stdout, err: res.stderr, all: `${res.stdout}${res.stderr}` };
};
const build = (s, more = []) => generate(['--mapping', s.mapping, '--out', s.out, '--docs', s.docs, '--cache', s.cache, '--offline', ...more]);

describe('build-icon-pack.mjs', () => {
  test('selects one size and the standard variant, names icons after their files, keeps the vendor categories', () => {
    const s = setup();
    const r = build(s);
    assert.equal(r.status, 0, r.all);
    const pack = JSON.parse(fs.readFileSync(s.out, 'utf8'));
    assert.deepEqual(Object.keys(pack.icons), ['acme-bucket', 'acme-bucket-store', 'acme-engine', 'acme-tool', 'acme-vault', 'acme-vault-00034']);
    assert.deepEqual(pack.aliases, { 'acme-bucket-classic': { parent: 'acme-bucket' } });
    assert.match(pack.icons['acme-engine'].body, /#ff9900/, 'the 64 px file, not the 16 px one');
    assert.doesNotMatch(JSON.stringify(pack), /#000000|#100000/, 'no dark variant, no other size');
    assert.deepEqual(pack.sirenia.catalog, [
      { icon: 'acme-bucket', name: 'Acme Bucket', group: 'Storage & Archive' },
      { icon: 'acme-bucket-classic', name: 'Acme Bucket Classic', group: 'Storage & Archive' },
      { icon: 'acme-bucket-store', name: 'Acme Bucket Store', group: 'Storage & Archive' },
      { icon: 'acme-engine', name: 'Acme Engine', group: 'Compute' },
      { icon: 'acme-tool', name: 'Acme Tool', group: 'Compute' },
      { icon: 'acme-vault', name: 'Acme Vault', group: 'Storage & Archive' },
      { icon: 'acme-vault-00034', name: 'Acme Vault', group: 'Storage & Archive' },
    ]);
    assert.equal(pack.sirenia.label, 'Acme Cloud');
    assert.ok(!('terms' in pack.sirenia) && !('generator' in pack.sirenia), 'recipe-only keys stay out of the pack');
    // Pack-wide size is the most common one; the 18 x 18 drawings keep their own.
    assert.deepEqual([pack.width, pack.height], [64, 64]);
    assert.deepEqual([pack.icons['acme-bucket'].width, pack.icons['acme-bucket'].height], [18, 18]);
    assert.equal(pack.icons['acme-engine'].width, undefined);
    // Each icon's ids are its own.
    assert.match(pack.icons['acme-bucket'].body, /id="acme-acme-bucket-1"/);
    const index = JSON.parse(fs.readFileSync(path.join(path.dirname(s.out), 'index.json'), 'utf8'));
    assert.deepEqual(index.packs.map((p) => [p.prefix, p.label, p.icons]), [['acme', 'Acme Cloud', 6]]);
  });

  test('the catalog lists names only, by category, with what was left out', () => {
    const s = setup();
    assert.equal(build(s).status, 0);
    const doc = fs.readFileSync(s.docs, 'utf8');
    assert.match(doc, /^# Acme Cloud icon catalog \(`acme:` pack\)/);
    assert.match(doc, /\*\*7 names\*\*, 7 service icons\. 6 distinct drawings/);
    assert.match(doc, /## Compute\n\n\| Name \| Icon \| Kind \|\n\|---\|---\|---\|\n\| Acme Engine \| `acme:acme-engine` \| service icons \|/);
    assert.match(doc, /## Storage & Archive/);
    assert.match(doc, /- Dark variants\. \(1 file\)\n- Other sizes\. \(1 file\)/);
    assert.match(doc, /`acme:acme-vault-00034` \(`acme:acme-vault` is the other one\)/);
    assert.doesNotMatch(doc, /<svg|<path|<circle|#ff9900/, 'no artwork in the catalog');
  });

  test('a SHA-256 mismatch stops the build, says what to do next, and writes nothing', () => {
    const s = setup();
    const m = JSON.parse(fs.readFileSync(s.mapping, 'utf8'));
    const good = m.upstream.zips.icons.sha256;
    fs.copyFileSync(path.join(s.cache, `icons-${good.slice(0, 12)}.zip`), path.join(s.cache, `icons-${'a'.repeat(12)}.zip`));
    m.upstream.zips.icons.sha256 = 'a'.repeat(64);
    fs.writeFileSync(s.mapping, JSON.stringify(m));
    const r = build(s);
    assert.equal(r.status, 1, r.all);
    assert.match(r.err, /sha256 mismatch for https:\/\/example\.invalid\/acme\.zip/);
    assert.match(r.err, new RegExp(`expected a{64}\\n\\s+got\\s+${good}`));
    assert.match(r.err, /Nothing was installed/);
    assert.match(r.err, /update upstream\.zips\.icons \(url, sha256\)/);
    assert.ok(!fs.existsSync(s.out) && !fs.existsSync(s.docs));
  });

  test('--offline without the ZIP in the cache fails without a network request', () => {
    const s = setup();
    const r = generate(['--mapping', s.mapping, '--out', s.out, '--no-docs', '--cache', fresh('empty'), '--offline']);
    assert.equal(r.status, 1, r.all);
    assert.match(r.err, /--offline, but .* is not in the download cache/);
    assert.doesNotMatch(r.all, /↓/);
  });

  test('--no-docs writes the pack and its index only; --check reports drift', () => {
    const s = setup();
    assert.equal(generate(['--mapping', s.mapping, '--out', s.out, '--no-docs', '--cache', s.cache, '--offline']).status, 0);
    assert.deepEqual(fs.readdirSync(path.dirname(s.out)).sort(), ['acme.json', 'index.json']);
    assert.ok(!fs.existsSync(s.docs));
    assert.equal(build(s, ['--check']).status, 1, 'the catalog is missing');
    assert.equal(build(s).status, 0);
    assert.equal(build(s, ['--check']).status, 0);
    fs.appendFileSync(s.docs, 'edited by hand\n');
    const r = build(s, ['--check']);
    assert.equal(r.status, 1);
    assert.match(r.err, /CATALOG\.md is out of date; run: node scripts\/build-icon-pack\.mjs --mapping/);
  });

  test('an unknown vendor category, an unused override, or two icons of one name without a number fail', () => {
    const noGroup = setup({ groups: { Compute: 'Compute' } });
    assert.match(build(noGroup).err, /category "Storage" is not in "groups"/);
    const stale = setup({ overrides: { 'Pkg/none.svg': { name: 'X' } } });
    assert.match(build(stale).err, /overrides: "Pkg\/none\.svg" matches no icon file/);
    const twins = setup({ overrides: {} }, {
      'Pkg/Svc_Compute/64/Svc_Acme-Twin_64.svg': plainCircle('#111111'),
      'Pkg/Svc_Storage/64/Svc_Acme-Twin_64.svg': plainCircle('#222222'),
    });
    assert.match(build(twins).err, /"acme:acme-twin" is the name of two different icons/);
  });

  test('an icon the pack validator would refuse fails the build', () => {
    const s = setup({ overrides: {} }, { 'Pkg/Svc_Compute/64/Svc_Acme-Bad_64.svg': '<svg viewBox="0 0 4 4"><rect width="4" height="4" fill="url(&#x6A;avascript:x)"/></svg>' });
    const r = build(s);
    assert.equal(r.status, 1, r.all);
    assert.ok(!fs.existsSync(s.out));
  });
});

describe('the AWS and Microsoft Azure recipes', () => {
  for (const prefix of ['aws', 'azure']) {
    test(`${prefix}: well-formed, pinned, and its terms end by deferring to the vendor`, () => {
      const m = JSON.parse(fs.readFileSync(path.join(root, 'icons', prefix, 'mapping.json'), 'utf8'));
      assert.equal(m.prefix, prefix);
      assert.equal(m.pack.generator, 'scripts/build-icon-pack.mjs');
      for (const spec of Object.values(m.upstream.zips)) {
        assert.match(spec.sha256, /^[0-9a-f]{64}$/);
        assert.match(spec.url, /^https:\/\//);
      }
      assert.match(m.upstream.page, /^https:\/\//);
      assert.match(m.pack.terms.url, /^https:\/\//);
      assert.match(m.pack.terms.summary.at(-1), /prevail over this summary/);
      for (const k of ['editor', 'editorAfter', 'export']) assert.ok(m.pack.notice[k], k);
      assert.match(m.pack.notice.export, /used unmodified solely to depict/);
      for (const set of m.sets) assert.doesNotThrow(() => new RegExp(set.pattern));
      for (const e of m.exclude || []) assert.ok(e.reason.trim());
      assert.ok(Object.keys(m.overrides || {}).every((p) => m.sets.some((s) => new RegExp(s.pattern).test(p))), 'every override names a file the sets select');
      assert.doesNotMatch(JSON.stringify(m), /<svg|<path/, 'a recipe holds no artwork');
    });
  }
});
