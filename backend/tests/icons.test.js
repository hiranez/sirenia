// Offline unit tests for icon-pack loading (no browser/network required). They use only the
// fixture packs under tests/fixtures/packs (original test artwork), never a vendor pack, so they
// pass in a copy of the repository without any vendor icons. Vendor-specific checks: gcp-pack.test.js.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadPacks } = require('../utils/icons');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); } catch (e) { failures++; console.error(`FAIL  ${name}: ${e.message}`); }
}

const FIXTURES = path.join(__dirname, 'fixtures', 'packs');
const demoPack = () => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'demo.json'), 'utf8'));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-packs-'));
let tmpCount = 0;
// A fresh directory holding the given files ({ name: object | string }).
function packDir(files) {
  const dir = path.join(tmpRoot, String(tmpCount++));
  fs.mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}
// The demo pack with one icon body replaced.
const withBody = (body) => { const p = demoPack(); p.icons.square.body = body; return { 'demo.json': p }; };
// The demo pack after `edit` mutated it.
const edited = (edit) => { const p = demoPack(); edit(p); return { 'demo.json': p }; };
const rejects = (files, pattern) => assert.throws(() => loadPacks(packDir(files), 'Test'), pattern);

const DEMO_NOTICE = 'Demo shapes are test artwork of Example Corp, used only to test this diagram. '
  + 'Generated with Test Product, an independent product not affiliated with, sponsored by, or endorsed by Example Corp.';

// ---- zero packs ----------------------------------------------------------------------------------

check('a missing or empty packs directory means zero packs, not an error', () => {
  for (const dir of [path.join(tmpRoot, 'does-not-exist'), packDir({}), packDir({ 'index.json': { format: 1, packs: [] }, 'README.txt': 'x' })]) {
    const api = loadPacks(dir, 'Test');
    assert.deepStrictEqual(api.ICON_PACKS, []);
    assert.strictEqual(api.ICON_PACKS_SCRIPT, 'window.__ICON_PACKS__=[];');
    assert.deepStrictEqual(api.findUnknownIcons('service a(gcp:Cloud-Run)[x]\nb(demo:nope)'), []);
    // No empty alternation: nothing that looks like `x:name` is treated as a pack reference.
    assert.deepStrictEqual(api.packsUsedBy('a:b c(:d) gcp:cloud-run demo:square'), []);
    assert.strictEqual(api.attributionNotice(api.packsUsedBy('a(demo:square)')), null);
    assert.strictEqual(api.attributionNotice(['demo']), null);
  }
});

// ---- the demo pack -----------------------------------------------------------------------------

const fixtures = loadPacks(FIXTURES, 'Test Product');

check('fixture directory loads every pack in sorted order and ignores index.json', () => {
  assert.deepStrictEqual(fixtures.ICON_PACKS.map((p) => p.prefix), ['demo', 'dots', 'plain']);
  const withIndex = loadPacks(packDir({ 'demo.json': demoPack(), 'index.json': { format: 1, packs: 'not a pack' } }), 'Test');
  assert.deepStrictEqual(withIndex.ICON_PACKS.map((p) => p.prefix), ['demo']);
  assert.ok(fixtures.KNOWN_ICONS.get('demo').has('box'), 'aliases are resolvable names');
});

check('findUnknownIcons flags only unresolvable names in installed prefixes', () => {
  const { findUnknownIcons } = fixtures;
  assert.deepStrictEqual(findUnknownIcons('service a(demo:square)[Sq]\nb@{ icon: "demo:box" }'), []);
  assert.deepStrictEqual(findUnknownIcons('service a(demo:does-not-exist)[X]\nservice b(demo:Square)[Y]'), ['demo:does-not-exist', 'demo:Square']);
  assert.deepStrictEqual(findUnknownIcons('service a(cloud)[Default icon]\nservice b(logos:aws-lambda)[Other pack]\nc(gcp:cloud-run)'), []);
  assert.deepStrictEqual(findUnknownIcons('service a(mydemo:nothing)[No word boundary]'), []);
  assert.deepStrictEqual(findUnknownIcons('a(demo:nope)[x]\nb(demo:nope)[y]'), ['demo:nope'], 'deduplicates');
  // Deliberate: a reference inside a label counts as well.
  assert.deepStrictEqual(findUnknownIcons('graph TD; A["see demo:nope"] --> B'), ['demo:nope']);
});

check('stateful-regex regression: interleaved calls do not share regex state', () => {
  const { findUnknownIcons, packsUsedBy } = fixtures;
  // A shared /g regex skipped matches that started before the previous call's lastIndex, letting
  // unknown icons through on request N+1.
  packsUsedBy('architecture-beta\n  group g(demo:circle)[Group]\n  service s(demo:square)[Square] in g');
  assert.deepStrictEqual(findUnknownIcons('architecture-beta\n  service a(demo:Square)[x]'), ['demo:Square']);
  assert.deepStrictEqual(findUnknownIcons('x(demo:nope)'), ['demo:nope']);
  assert.deepStrictEqual(findUnknownIcons('x(demo:nope)'), ['demo:nope'], 'repeat call identical');
  assert.deepStrictEqual(packsUsedBy('service a(demo:square)[Sq]'), ['demo']);
  assert.deepStrictEqual(packsUsedBy('service a(demo:square)[Sq]'), ['demo'], 'repeat call identical');
});

check('packsUsedBy lists the referenced packs in pack order', () => {
  const { packsUsedBy } = fixtures;
  assert.deepStrictEqual(packsUsedBy('graph TD; A-->B'), []);
  assert.deepStrictEqual(packsUsedBy('service a(logos:aws-lambda)[x]'), []);
  assert.deepStrictEqual(packsUsedBy('a(plain:bar)\nb(dots:dot)\nc(demo:box)\nd(demo:circle)'), ['demo', 'dots', 'plain']);
});

check('export notice: pack sentence plus the product independence sentence', () => {
  assert.strictEqual(fixtures.attributionNotice(['demo']), DEMO_NOTICE);
  assert.strictEqual(fixtures.attributionNotice(fixtures.packsUsedBy('service a(demo:square)[Sq]')), DEMO_NOTICE);
  assert.strictEqual(fixtures.attributionNotice([]), null);
  assert.strictEqual(fixtures.attributionNotice(['plain']), null, 'a pack without sirenia has no notice');
  assert.strictEqual(fixtures.attributionNotice(['nope']), null);
  const noOwner = loadPacks(packDir(edited((p) => { delete p.sirenia.owner; })), 'Test');
  assert.strictEqual(noOwner.attributionNotice(['demo']), null, 'no owner, no notice');
  const noNotice = loadPacks(packDir(edited((p) => { delete p.sirenia.notice; })), 'Test');
  assert.strictEqual(noNotice.attributionNotice(['demo']), null, 'no notice object, no notice');
});

check('two packs in one diagram give ONE notice text containing both, in pack order', () => {
  const code = 'architecture-beta\n  service b(dots:dot)[Dot]\n  service a(demo:square)[Square]\n  service c(plain:bar)[Bar]';
  const notice = fixtures.attributionNotice(fixtures.packsUsedBy(code));
  assert.strictEqual(
    notice,
    `${DEMO_NOTICE} Dots are test artwork of Sample Ltd. Generated with Test Product, an independent product not affiliated with, sponsored by, or endorsed by Sample Ltd.`
  );
  assert.strictEqual(fixtures.attributionNotice(['dots', 'demo']), notice, 'order follows the packs, not the argument');
  const { injectMetadata } = require('../utils/metadata');
  const svg = injectMetadata(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>'), 'Disclaimer', notice).toString();
  assert.strictEqual((svg.match(/<Disclaimer>/g) || []).length, 1);
  assert.ok(svg.includes('endorsed by Example Corp.') && svg.includes('endorsed by Sample Ltd.'));
});

check('exports carry the notice after the provenance entry (metadata round-trip)', () => {
  const { injectMetadata } = require('../utils/metadata');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>');
  const out = injectMetadata(injectMetadata(svg, 'SireniaSource', 'x'), 'Disclaimer', DEMO_NOTICE).toString();
  assert.ok(out.includes(`<Disclaimer>${DEMO_NOTICE}</Disclaimer>`), 'SVG notice missing');
  assert.ok(out.indexOf('<SireniaSource>') < out.indexOf('<Disclaimer>'), 'provenance must stay first');
});

check('inline pack script is inert (no raw "<", U+2028/U+2029 escaped) and carries no sirenia metadata', () => {
  const { ICON_PACKS_SCRIPT } = fixtures;
  assert.ok(ICON_PACKS_SCRIPT.startsWith('window.__ICON_PACKS__='));
  assert.ok(!ICON_PACKS_SCRIPT.includes('<'), 'raw "<" in inline script');
  assert.ok(ICON_PACKS_SCRIPT.includes('\\u003ccircle'), 'escaped markup missing');
  assert.ok(!ICON_PACKS_SCRIPT.includes('sirenia') && !ICON_PACKS_SCRIPT.includes('Example Corp'), 'sirenia object must be stripped');
  const sep = loadPacks(packDir(edited((p) => { p.info.name = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`; })), 'Test');
  assert.ok(sep.ICON_PACKS_SCRIPT.includes('a\\u2028b\\u2029c'), 'line separators must be escaped');
  assert.ok(!sep.ICON_PACKS_SCRIPT.includes(String.fromCharCode(0x2028)) && !sep.ICON_PACKS_SCRIPT.includes(String.fromCharCode(0x2029)));
  const page = JSON.parse(ICON_PACKS_SCRIPT.slice('window.__ICON_PACKS__='.length, -1));
  assert.deepStrictEqual(page[0].icons, demoPack().icons, 'icons reach the page unchanged');
  assert.deepStrictEqual(page[0].aliases, demoPack().aliases);
});

check('icon bodies may use same-document references (ids, gradients, <use href="#id">, url(#id))', () => {
  assert.ok(fixtures.KNOWN_ICONS.get('dots').has('dot'));
});

// ---- validation (fail fast, error names the file and the icon) --------------------------------

check('malformed JSON is a start-up error that names the file', () => {
  rejects({ 'demo.json': '{"prefix": "demo",' }, /Invalid icon pack .*demo\.json/);
  rejects({ 'demo.json': '[]' }, /demo\.json: expected a JSON object/);
});

check('prefix must be well-formed, match the file name and be unique', () => {
  for (const bad of ['Demo', '1demo', 'demo_x', 'demo--x', 'demo-', '', 7]) {
    rejects({ 'demo.json': { ...demoPack(), prefix: bad } }, /demo\.json: prefix/);
  }
  rejects({ 'Demo.json': { ...demoPack(), prefix: 'Demo' } }, /Demo\.json: prefix "Demo" is not lowercase/);
  rejects({ 'other.json': demoPack() }, /other\.json: prefix "demo" does not match the file name/);
  assert.deepStrictEqual(loadPacks(packDir({ 'my-pack2.json': { ...demoPack(), prefix: 'my-pack2' } }), 'T').ICON_PACKS.map((p) => p.prefix), ['my-pack2']);
});

check('icons must be a non-empty object of string bodies', () => {
  rejects(edited((p) => { p.icons = {}; }), /"icons" must be a non-empty object/);
  rejects(edited((p) => { delete p.icons; }), /"icons" must be a non-empty object/);
  rejects(edited((p) => { p.icons = [{ body: '<g/>' }]; }), /"icons" must be a non-empty object/);
  rejects(edited((p) => { p.icons.square = { body: 42 }; }), /icon "square": missing string "body"/);
  rejects(edited((p) => { p.icons.square = '<g/>'; }), /icon "square": missing string "body"/);
});

check('every alias must have a parent that exists in icons', () => {
  rejects(edited((p) => { p.aliases.box = { parent: 'hexagon' }; }), /alias "box": "parent" must name an icon/);
  rejects(edited((p) => { p.aliases.box = { parent: 'box2' }; p.aliases.box2 = { parent: 'square' }; }), /alias "box"/);
  rejects(edited((p) => { p.aliases.box = 'square'; }), /alias "box"/);
  rejects(edited((p) => { p.aliases = ['box']; }), /"aliases" must be an object/);
  rejects(edited((p) => { p.aliases.box = { parent: '__proto__' }; }), /alias "box"/);
});

check('dimension fields must be numbers (they end up in SVG attributes)', () => {
  rejects(edited((p) => { p.width = '24" onload="x'; }), /pack: "width" must be a number/);
  rejects(edited((p) => { p.icons.square.height = '1'; }), /icon "square": "height" must be a number/);
  rejects(edited((p) => { p.aliases.box.hFlip = 'yes'; }), /alias "box": "hFlip" must be true or false/);
});

check('icon bodies with active content are rejected', () => {
  const bad = [
    ['<script>alert(1)</script>', /active or embedding element/],
    ['<SCRIPT src="#x"></SCRIPT>', /active or embedding element/],
    ['<svg:script>alert(1)</svg:script>', /active or embedding element/],
    ['<foreignObject><div/></foreignObject>', /active or embedding element/],
    ['<iframe src="#x"></iframe>', /active or embedding element/],
    ['<object data="x"></object>', /active or embedding element/],
    ['<embed src="#x"/>', /active or embedding element/],
    ['<img src="#x">', /HTML loading element/],
    ['<meta http-equiv="refresh" content="0;url=https://example.com">', /HTML loading element/],
    ['<rect onload="alert(1)"/>', /event-handler attribute/],
    ['<rect width="1" ONCLICK = "x"/>', /event-handler attribute/],
    ['<rect/onmouseover=alert(1)>', /event-handler attribute/],
    ['<rect x="1"onfocus="x"/>', /event-handler attribute/],
    ['<a href="javascript:alert(1)"><rect/></a>', /javascript: URL/],
    ['<rect style="fill:JavaScript:x"/>', /javascript: URL/],
    ['<set attributeName="href" to="#x"/>', /animation of a link attribute/],
  ];
  for (const [body, reason] of bad) rejects(withBody(body), new RegExp(`demo\\.json: icon "square": ${reason.source}`));
});

check('icon bodies with external references are rejected', () => {
  const bad = [
    '<image href="https://example.com/x.png"/>',
    '<use xlink:href="https://example.com/s.svg#a"/>',
    "<use href='//example.com/s.svg#a'/>",
    '<use href=s.svg#a />',
    '<image href="data:image/png;base64,AAAA"/>',
    '<use href="#a"src="https://example.com/x"/>',
    '<rect fill="url(https://example.com/p.svg#g)"/>',
    '<rect style="fill: url( \'https://example.com/g\' )"/>',
    '<rect style="fill: \\75 rl(https://example.com/g)"/>',
    '<style>@import "https://example.com/a.css";</style>',
    '<rect style="background: image-set(\'x.png\' 1x)"/>',
  ];
  for (const body of bad) rejects(withBody(body), /demo\.json: icon "square": external reference/);
});

check('the sirenia object is validated: shape, strings only, bounded, https terms, no unknown keys', () => {
  const s = (edit) => edited((p) => edit(p.sirenia));
  rejects(edited((p) => { p.sirenia = 'Demo'; }), /"sirenia" must be an object/);
  rejects(s((m) => { m.extra = 1; }), /"sirenia" has unknown key "extra"/);
  rejects(s((m) => { delete m.format; }), /"sirenia.format" must be 1/);
  rejects(s((m) => { m.format = 2; }), /"sirenia.format" must be 1/);
  rejects(s((m) => { m.label = 5; }), /"sirenia.label" must be a non-empty string/);
  rejects(s((m) => { m.label = '  '; }), /"sirenia.label" must be a non-empty string/);
  rejects(s((m) => { m.label = 'x'.repeat(81); }), /"sirenia.label" must be at most 80/);
  rejects(s((m) => { m.owner = 'x'.repeat(81); }), /"sirenia.owner" must be at most 80/);
  rejects(s((m) => { m.owner = 'Example\nCorp'; }), /"sirenia.owner" must not contain control characters/);
  rejects(s((m) => { m.termsUrl = 'http://example.com/terms'; }), /"sirenia.termsUrl" must be an https:\/\/ URL/);
  rejects(s((m) => { m.termsUrl = 'javascript:alert(1)'; }), /"sirenia.termsUrl" must be an https:\/\/ URL/);
  rejects(s((m) => { m.termsUrl = 'https://'; }), /"sirenia.termsUrl" must be an https:\/\/ URL/);
  rejects(s((m) => { m.notice = 'x'; }), /"sirenia.notice" must be an object/);
  rejects(s((m) => { m.notice.footer = 'x'; }), /"sirenia.notice" has unknown key "footer"/);
  rejects(s((m) => { m.notice.export = 'x'.repeat(1001); }), /"sirenia.notice.export" must be at most 1000/);
  rejects(s((m) => { m.notice.editor = ['x']; }), /"sirenia.notice.editor" must be a non-empty string/);
  rejects(s((m) => { m.notice.editorAfter = `a${String.fromCharCode(0x2028)}b`; }), /"sirenia.notice.editorAfter" must not contain control characters/);
  assert.doesNotThrow(() => loadPacks(packDir(s((m) => { m.notice.export = 'x'.repeat(1000); m.label = 'y'.repeat(80); })), 'T'));
});

check('sirenia.catalog is validated: shape, own icon or alias, unique, safe text, bounded', () => {
  const c = (catalog) => edited((p) => { p.sirenia.catalog = catalog; });
  const ok = [{ icon: 'square', name: 'Square', group: 'Shapes' }, { icon: 'box', name: 'Pub/Sub (Beta, etc.)' }];
  assert.doesNotThrow(() => loadPacks(packDir(c(ok)), 'T'));
  assert.doesNotThrow(() => loadPacks(packDir(c([])), 'T'));
  // The catalog is not sent to Mermaid or to the render page.
  assert.ok(!loadPacks(packDir(c(ok)), 'T').ICON_PACKS_SCRIPT.includes('Pub/Sub'));
  rejects(c('x'), /"sirenia.catalog" must be an array/);
  rejects(c({ icon: 'square', name: 'S' }), /"sirenia.catalog" must be an array/);
  rejects(c(Array.from({ length: 5001 }, (_, i) => ({ icon: `i${i}`, name: 'x' }))), /at most 5000 entries/);
  rejects(c(['square']), /entry 1 must be an object/);
  rejects(c([null]), /entry 1 must be an object/);
  rejects(c([[]]), /entry 1 must be an object/);
  rejects(c([{ icon: 'square', name: 'S', extra: 1 }]), /entry 1 has unknown key "extra"/);
  rejects(c([{ icon: 'nope', name: 'S' }]), /entry 1: "icon" must name an icon or alias of this pack/);
  rejects(c([{ icon: 'toString', name: 'S' }]), /"icon" must name an icon or alias/);
  rejects(c([{ icon: 'constructor', name: 'S' }]), /"icon" must name an icon or alias/);
  rejects(c([{ name: 'S' }]), /"icon" must name an icon or alias/);
  rejects(c([{ icon: 5, name: 'S' }]), /"icon" must name an icon or alias/);
  rejects(c([{ icon: 'square', name: 'S' }, { icon: 'circle', name: 'C' }, { icon: 'square', name: 'T' }]), /entry 3: duplicate icon "square"/);
  rejects(edited((p) => { p.icons.Odd_Name = p.icons.square; p.sirenia.catalog = [{ icon: 'Odd_Name', name: 'S' }]; }), /entry 1: icon "Odd_Name" must be lowercase letters, digits and single hyphens/);
  rejects(c([{ icon: 'square' }]), /entry 1 \(icon "square"\) "name" must be a non-empty string/);
  rejects(c([{ icon: 'square', name: ' ' }]), /"name" must be a non-empty string/);
  rejects(c([{ icon: 'square', name: 'x'.repeat(81) }]), /"name" must be at most 80/);
  rejects(c([{ icon: 'square', name: 'a\nb' }]), /"name" must not contain control characters/);
  rejects(c([{ icon: 'square', name: 'S', group: '' }]), /"group" must be a non-empty string/);
  rejects(c([{ icon: 'square', name: 'S', group: null }]), /"group" must be a non-empty string/);
  rejects(c([{ icon: 'square', name: 'S', group: 'x'.repeat(81) }]), /"group" must be at most 80/);
  for (const ch of ['[', ']', '{', '}', '<', '>', '"', '`', '\\', '|', '#', ';', '%']) {
    rejects(c([{ icon: 'square', name: `a${ch}b` }]), /"name" must not contain any of/);
    rejects(c([{ icon: 'square', name: 'S', group: `a${ch}b` }]), /"group" must not contain any of/);
  }
  assert.doesNotThrow(() => loadPacks(packDir(c([{ icon: 'square', name: 'x'.repeat(80), group: 'y'.repeat(80) }])), 'T'));
});

check('a plain Iconify pack without sirenia is valid and contributes no notice', () => {
  const api = loadPacks(packDir({ 'plain.json': fs.readFileSync(path.join(FIXTURES, 'plain.json'), 'utf8') }), 'Test');
  assert.deepStrictEqual(api.ICON_PACKS.map((p) => p.prefix), ['plain']);
  assert.deepStrictEqual(api.findUnknownIcons('a(plain:bar) b(plain:nope)'), ['plain:nope']);
  assert.deepStrictEqual(api.packsUsedBy('a(plain:bar)'), ['plain']);
  assert.strictEqual(api.attributionNotice(['plain']), null);
});

// ---- the configured instance ------------------------------------------------------------------

check('the module instance reads PACKS_DIR and PRODUCT_NAME', () => {
  const run = (env) => spawnSync(process.execPath, ['-e', "const i = require('../utils/icons'); process.stdout.write(JSON.stringify([i.ICON_PACKS.map((p) => p.prefix), i.attributionNotice(['demo'])]))"], {
    cwd: __dirname, encoding: 'utf8', env: { ...process.env, ...env },
  });
  const named = run({ PACKS_DIR: FIXTURES, PRODUCT_NAME: 'Test Product' });
  assert.strictEqual(named.status, 0, named.stderr);
  assert.deepStrictEqual(JSON.parse(named.stdout), [['demo', 'dots', 'plain'], DEMO_NOTICE]);
  const def = run({ PACKS_DIR: FIXTURES, PRODUCT_NAME: '' });
  assert.ok(JSON.parse(def.stdout)[1].includes('Generated with Sirenia, an independent product'), 'default name missing');
  const empty = run({ PACKS_DIR: packDir({}) });
  assert.deepStrictEqual(JSON.parse(empty.stdout), [[], null]);
  const broken = run({ PACKS_DIR: packDir(withBody('<script>x</script>')) });
  assert.notStrictEqual(broken.status, 0, 'an invalid pack must fail at load');
  assert.ok(/Invalid icon pack .*demo\.json: icon "square"/.test(broken.stderr), broken.stderr);
  assert.notStrictEqual(run({ PACKS_DIR: FIXTURES, PRODUCT_NAME: 'x'.repeat(81) }).status, 0, 'over-long name must fail at load');
});

// ---- recipes: a pack the installation could add but has not --------------------------------------

// A recipes directory: { name: mapping object | string } → <dir>/<name>/mapping.json.
function recipesDir(recipes) {
  const dir = path.join(tmpRoot, `recipes-${tmpCount++}`);
  fs.mkdirSync(dir);
  for (const [name, mapping] of Object.entries(recipes)) {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'mapping.json'), typeof mapping === 'string' ? mapping : JSON.stringify(mapping));
  }
  return dir;
}
const RECIPES = { acme: { prefix: 'acme', pack: { label: 'Acme Cloud' } }, other: { prefix: 'other', pack: { label: 'Other "Pack"' } } };

check('recipe present but pack missing: the missing pack is named with its label', () => {
  const api = loadPacks(packDir({}), 'Test', recipesDir(RECIPES));
  assert.deepStrictEqual(api.findMissingPacks('service a(acme:vm)[x]'), [{ prefix: 'acme', label: 'Acme Cloud' }]);
  // Same scope as findUnknownIcons: references inside labels count, other prefixes and bare words do not.
  assert.deepStrictEqual(api.findMissingPacks('A["see acme:vm and other:x"]'), [{ prefix: 'acme', label: 'Acme Cloud' }, { prefix: 'other', label: 'Other "Pack"' }]);
  assert.deepStrictEqual(api.findMissingPacks('A[acme] B(xacme:vm) C(acmes:vm) D(acme: vm) graph TD; A-->B;'), []);
  assert.deepStrictEqual(api.findMissingPacks(''), []);
});

check('recipe whose pack is installed: no error', () => {
  const dir = recipesDir({ demo: { prefix: 'demo', pack: { label: 'Demo' } }, ...RECIPES });
  const api = loadPacks(FIXTURES, 'Test', dir);
  assert.deepStrictEqual(api.findMissingPacks('a(demo:square) b(demo:nope)'), []);
  assert.deepStrictEqual(api.findMissingPacks('a(demo:square) b(acme:vm)'), [{ prefix: 'acme', label: 'Acme Cloud' }]);
});

check('no recipes (none given, missing directory, empty directory): nothing is reported', () => {
  for (const dir of [undefined, null, path.join(tmpRoot, 'no-such-recipes'), recipesDir({})]) {
    assert.deepStrictEqual(loadPacks(packDir({}), 'Test', dir).findMissingPacks('a(acme:vm) b(gcp:cloud-run)'), []);
  }
});

check('unusable recipes are ignored (logged once), never fatal', () => {
  const warn = console.warn;
  const logged = [];
  console.warn = (m) => logged.push(m);
  try {
    const dir = recipesDir({ broken: '{ not json', nolabel: { prefix: 'nolabel', pack: {} }, badprefix: { prefix: 'Bad Prefix', pack: { label: 'x' } }, ...RECIPES });
    fs.writeFileSync(path.join(dir, 'stray.txt'), 'x');
    const api = loadPacks(packDir({}), 'Test', dir);
    assert.deepStrictEqual(api.findMissingPacks('acme:vm nolabel:x'), [{ prefix: 'acme', label: 'Acme Cloud' }]);
    assert.strictEqual(logged.length, 1, logged.join('\n'));
  } finally {
    console.warn = warn;
  }
});

check('stateful-regex regression: interleaved findMissingPacks calls', () => {
  const api = loadPacks(packDir({}), 'Test', recipesDir(RECIPES));
  const long = `${'x '.repeat(40)}acme:vm`;
  assert.strictEqual(api.findMissingPacks(long).length, 1);
  assert.strictEqual(api.findMissingPacks('acme:vm').length, 1); // shorter text after a longer match
  assert.strictEqual(api.findMissingPacks(long).length, 1);
  assert.strictEqual(api.findMissingPacks('acme:vm').length, 1);
});

check('PACK_RECIPES_DIR is read by the module instance', () => {
  const run = (env) => spawnSync(process.execPath, ['-e', "const i = require('../utils/icons'); process.stdout.write(JSON.stringify(i.findMissingPacks('a(acme:vm)')))"], {
    cwd: __dirname, encoding: 'utf8', env: { ...process.env, PACKS_DIR: packDir({}), ...env },
  });
  const withRecipes = run({ PACK_RECIPES_DIR: recipesDir(RECIPES) });
  assert.strictEqual(withRecipes.status, 0, withRecipes.stderr);
  assert.deepStrictEqual(JSON.parse(withRecipes.stdout), [{ prefix: 'acme', label: 'Acme Cloud' }]);
  assert.deepStrictEqual(JSON.parse(run({ PACK_RECIPES_DIR: recipesDir({}) }).stdout), []);
});

fs.rmSync(tmpRoot, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll icon tests passed');
