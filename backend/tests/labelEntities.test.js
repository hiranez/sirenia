// Offline unit tests for the completion of character codes in labels (no browser/network required).
const assert = require('node:assert');
const vm = require('node:vm');
const { decodeLabelEntities: decode, LABEL_ENTITIES_SCRIPT } = require('../utils/labelEntities');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); } catch (e) { failures++; console.error(`FAIL  ${name}: ${e.message}`); }
}

const label = (text) => `<svg><g class="label"><text><tspan>${text}</tspan></text></g></svg>`;

check('doubly escaped quotes and decimal codes become character references', () => {
  assert.strictEqual(decode(label('say &amp;quot;hi&amp;quot;')), label('say &quot;hi&quot;'));
  assert.strictEqual(decode(label('&amp;#35;tag; &amp;#96;code&amp;#96; a&amp;#32;b &amp;#9829; &amp;#128512;')), label('&#35;tag; &#96;code&#96; a&#32;b &#9829; &#128512;'));
  assert.strictEqual(decode(label('&amp;#0035;')), label('&#35;'));
});

check('nothing else changes', () => {
  for (const text of ['&amp;', '&amp;amp;', '&amp;lt;b&amp;gt;', '&amp;nbsp;', '&lt;b&gt;', 'a &amp; b;', '&amp;#x41;', '&amp;#;', '&amp;#12345678;', 'plain text', '&amp;QUOT;']) {
    assert.strictEqual(decode(label(text)), label(text), text);
  }
});

check('only code points that are characters and not controls', () => {
  for (const n of [0, 9, 10, 13, 31, 127, 128, 159, 0xd800, 0xdfff, 0xfffe, 0xffff, 0x110000]) {
    assert.strictEqual(decode(label(`&amp;#${n};`)), label(`&amp;#${n};`), String(n));
  }
  for (const n of [32, 126, 160, 0xd7ff, 0xe000, 0xfffd, 0x10000, 0x10ffff]) {
    assert.strictEqual(decode(label(`&amp;#${n};`)), label(`&#${n};`), String(n));
  }
});

check('tags, attribute values and style elements are left as they are', () => {
  const svg = '<svg aria-label="a &amp;quot;b&amp;quot;"><style>.x::before{content:"&amp;quot;"} a > b {}</style><g data-x="&amp;#60;">&amp;#60;script&amp;#62;</g></svg>';
  assert.strictEqual(decode(svg), '<svg aria-label="a &amp;quot;b&amp;quot;"><style>.x::before{content:"&amp;quot;"} a > b {}</style><g data-x="&amp;#60;">&#60;script&#62;</g></svg>');
});

check('the result can never contain markup that was not there: a code for < is still text', () => {
  const out = decode(label('&amp;#60;script&amp;#62;alert(1)&amp;#60;/script&amp;#62; &amp;#60;img src=x onerror=alert(1)&amp;#62;'));
  assert.ok(!/<script|<img/i.test(out), out);
  const tags = (s) => (s.match(/<[^>]*>/g) || []).join('');
  // Every tag of the output is a tag of the input.
  for (const text of ['&amp;#60;a href=x&amp;#62;', '&amp;#34;&amp;#62;&amp;#60;svg onload=1&amp;#62;', '&amp;quot;&amp;#39;&amp;#62;']) {
    assert.strictEqual(tags(decode(label(text))), tags(label(text)), text);
  }
});

check('a code split over two rows by Mermaid\'s wrapping is completed in the first row', () => {
  const rows = (a, b) => `<text><tspan class="row"><tspan>${a}</tspan></tspan><tspan class="row"><tspan>${b}</tspan></tspan></text>`;
  assert.strictEqual(decode(rows('alert(1)&amp;', 'quot;')), rows('alert(1)&quot;', ''));
  assert.strictEqual(decode(rows('x&amp;qu', 'ot; y')), rows('x&quot;', ' y'));
  assert.strictEqual(decode(rows('x&amp;#3', '5;y')), rows('x&#35;', 'y'));
  assert.strictEqual(decode(rows('x&amp;#35', ';y')), rows('x&#35;', 'y'));
  // Two different labels are never joined: one that ends in "&" next to one that starts with "quot;".
  const two = '<text><tspan>Q&amp;</tspan></text><g><text><tspan>quot; x</tspan></text></g>';
  assert.strictEqual(decode(two), two);
  // Not a code: nothing moves.
  for (const [a, b] of [['x&amp;', 'quote'], ['x&amp;', 'lt;'], ['x&amp;#', 'a;'], ['x&amp;#0', ';'], ['x&amp;', '']]) {
    assert.strictEqual(decode(rows(a, b)), rows(a, b), `${a}|${b}`);
  }
});

check('the page script defines the same function', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(LABEL_ENTITIES_SCRIPT, sandbox);
  const s = label('&amp;quot;x&amp;quot; &amp;#35;');
  assert.strictEqual(sandbox.window.__decodeLabelEntities(s), decode(s));
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll label entity tests passed');
