// Offline unit tests for the self-contained-export check (no browser/network required).
const assert = require('node:assert');
const vm = require('node:vm');
const { cssUnescape, cssExternalRefs, attributeExternalRef, COLLECT_EXTERNAL_REFS_SCRIPT } = require('../utils/externalRefs');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); } catch (e) { failures++; console.error(`FAIL  ${name}: ${e.message}`); }
}

check('same-document references and plain CSS are allowed', () => {
  for (const css of [
    '.node rect { fill: #ECECFF; stroke: #9370DB; }',
    '.edge { marker-end: url(#arrowhead); }',
    'path { clip-path: url( "#clip-1" ); filter: url(\'#drop-shadow\') }',
    'text { font-family: "trebuchet ms", verdana, arial, sans-serif; }',
    '@keyframes dash { to { stroke-dashoffset: 0; } }',
    'rect { transform: translate(10px, 20px) rotate(45deg); fill: rgb(1, 2, 3); width: calc(100% - 4px) }',
    '',
  ]) assert.deepStrictEqual(cssExternalRefs(css), [], css);
});

check('external and relative URLs in CSS are found', () => {
  for (const css of [
    '@import url(https://example.com/a.css);',
    '@import "https://example.com/a.css";',
    '@IMPORT "a.css";',
    '.node rect { fill: url(https://example.com/p.svg#p); }',
    '.x { background: URL( "//example.com/i.png" ) }',
    '.x { background: url(i.png) }',
    '.x { background: url(data:image/png;base64,AAAA) }',
    '.x { background: url() }',
    '@font-face { font-family: f; src: url("https://example.com/f.woff2") }',
    '.x { background-image: image-set("https://example.com/i.png" 1x) }',
    '.x { cursor: url(#ok), url(https://example.com/c.cur), auto }',
  ]) assert.ok(cssExternalRefs(css).length > 0, css);
});

check('CSS escapes cannot hide a reference', () => {
  assert.strictEqual(cssUnescape('u\\72l('), 'url(');
  assert.strictEqual(cssUnescape('\\75 rl('), 'url(');
  assert.strictEqual(cssUnescape('@\\69mport'), '@import');
  assert.strictEqual(cssUnescape('\\000075rl'), 'url');
  for (const css of [
    '.x { background: u\\72l(https://example.com/i.png) }',
    '.x { background: \\75 rl(https://example.com/i.png) }',
    '@\\69mport "https://example.com/a.css";',
    '.x { background: url(\\#not-a-fragment.png) }'.replace('\\#', 'h\\74tp://example.com/'),
    '.x { background: url("ht\\\ntp://example.com/i.png") }',
  ]) assert.ok(cssExternalRefs(css).length > 0, css);
});

check('repeated calls give the same answer (no shared regex state)', () => {
  const css = '.a { fill: url(#a) } .b { fill: url(https://example.com/b) }';
  assert.deepStrictEqual(cssExternalRefs(css), cssExternalRefs(css));
  assert.deepStrictEqual(cssExternalRefs('.a { fill: url(#a) }'), []);
});

check('attributes: resource references must be same-document', () => {
  assert.strictEqual(attributeExternalRef('use', 'href', '#icon'), null);
  assert.strictEqual(attributeExternalRef('use', 'xlink:href', ' #icon'), null);
  assert.ok(attributeExternalRef('image', 'href', 'https://example.com/i.png'));
  assert.ok(attributeExternalRef('image', 'xlink:href', 'i.png'));
  assert.ok(attributeExternalRef('image', 'href', 'data:image/png;base64,AAAA'));
  assert.ok(attributeExternalRef('use', 'href', 'https://example.com/s.svg#a'));
  assert.ok(attributeExternalRef('feImage', 'href', '//example.com/i.png'));
  assert.ok(attributeExternalRef('img', 'src', 'https://example.com/i.png'));
  assert.ok(attributeExternalRef('IMAGE', 'HREF', 'https://example.com/i.png'));
});

check('attributes: hyperlinks are left alone', () => {
  assert.strictEqual(attributeExternalRef('a', 'href', 'https://example.com/'), null);
  assert.strictEqual(attributeExternalRef('a', 'xlink:href', 'https://example.com/'), null);
});

check('attributes: presentation and style values are checked as CSS', () => {
  assert.strictEqual(attributeExternalRef('path', 'marker-end', 'url(#arrow)'), null);
  assert.strictEqual(attributeExternalRef('g', 'transform', 'translate(10, 20) scale(2)'), null);
  assert.strictEqual(attributeExternalRef('rect', 'style', 'fill: #fff; stroke: rgb(0,0,0)'), null);
  assert.strictEqual(attributeExternalRef('text', 'class', 'label'), null);
  assert.ok(attributeExternalRef('rect', 'fill', 'url(https://example.com/p.svg#p)'));
  assert.ok(attributeExternalRef('rect', 'style', 'fill: url("https://example.com/p.svg#p")'));
  assert.ok(attributeExternalRef('rect', 'style', 'background: u\\72l(https://example.com/i.png)'));
  assert.ok(attributeExternalRef('rect', 'filter', 'url(filters.svg#blur)'));
});

// The page script is the same functions, serialised. Run it against a minimal fake DOM to prove
// the injected source is complete and reports what the walk finds.
check('the injected page script runs standalone and reports findings', () => {
  const el = (localName, attrs = {}, textContent = '') => ({
    localName, textContent,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  });
  const run = (styles, elements) => {
    const svg = {
      ...el('svg', { viewBox: '0 0 10 10' }),
      querySelectorAll: (sel) => (sel === 'style' ? styles : [...styles, ...elements]),
      getBoundingClientRect: () => ({}),
    };
    return vm.runInNewContext(COLLECT_EXTERNAL_REFS_SCRIPT, { document: { querySelector: () => svg } });
  };
  assert.deepStrictEqual([...run([el('style', {}, '.a{fill:url(#a)}')], [el('path', { 'marker-end': 'url(#arrow)', d: 'M0,0' })])], []);
  const found = [...run(
    [el('style', {}, '@import url(https://example.com/a.css); .n{fill:url(https://example.com/p#p)}')],
    [el('image', { href: 'https://example.com/i.png' }), el('a', { href: 'https://example.com/' })],
  )];
  assert.deepStrictEqual(found, ['<style> @import', '<style> url()', '<image href>']);
  assert.deepStrictEqual([...vm.runInNewContext(COLLECT_EXTERNAL_REFS_SCRIPT, { document: { querySelector: () => null } })], []);
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll external-reference tests passed');
