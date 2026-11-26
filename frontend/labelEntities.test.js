// The completion of character codes in labels (preview side). Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { decodeLabelEntities as decode } from './src/utils/labelEntities.ts';

const backend = createRequire(new URL('../backend/', import.meta.url))('./utils/labelEntities.js');
const label = (text) => `<svg><g class="label"><text><tspan>${text}</tspan></text></g></svg>`;
const CASES = [
  'say &amp;quot;hi&amp;quot;', '&amp;#35;tag;', '&amp;#96;code&amp;#96;', 'direction&amp;#32;LR', '&amp;#0035;', '&amp;#128512;',
  '&amp;', '&amp;amp;', '&amp;lt;', '&amp;nbsp;', '&lt;b&gt;', '&amp;#x41;', '&amp;#0;', '&amp;#9;', '&amp;#127;', '&amp;#55296;', '&amp;#1114112;',
  '&amp;#60;script&amp;#62;alert(1)&amp;#60;/script&amp;#62;', '&amp;#34;&amp;#62;&amp;#60;svg onload=1&amp;#62;',
];

test('codes become character references; nothing else changes', () => {
  assert.equal(decode(label('say &amp;quot;hi&amp;quot; &amp;#35;x; &amp;#96;')), label('say &quot;hi&quot; &#35;x; &#96;'));
  for (const text of ['&amp;', '&amp;amp;', '&amp;lt;b&amp;gt;', '&lt;b&gt;', '&amp;#x41;', '&amp;#0;', '&amp;#159;', '&amp;#65535;']) assert.equal(decode(label(text)), label(text), text);
});

test('the output parses as text: no element, attribute or comment appears', () => {
  for (const text of CASES) {
    const out = decode(label(text));
    const tags = (s) => (s.match(/<[^>]*>/g) ?? []).join('');
    assert.equal(tags(out), tags(label(text)), text);
  }
  // A code for < is the text "<script>", not an element.
  assert.equal(decode(label('&amp;#60;script&amp;#62;')), label('&#60;script&#62;'));
});

test('a code Mermaid\'s wrapping split over two rows is completed in the first', () => {
  const rows = (a, b) => `<text><tspan><tspan>${a}</tspan></tspan><tspan><tspan>${b}</tspan></tspan></text>`;
  assert.equal(decode(rows('alert(1)&amp;', 'quot;')), rows('alert(1)&quot;', ''));
  assert.equal(decode(rows('x&amp;#3', '5;y')), rows('x&#35;', 'y'));
  assert.equal(decode(rows('x&amp;', 'lt;')), rows('x&amp;', 'lt;'));
  // Two different labels are never joined.
  const two = '<text><tspan>Q&amp;</tspan></text><g><text><tspan>quot; x</tspan></text></g>';
  assert.equal(decode(two), two);
  assert.equal(backend.decodeLabelEntities(two), two);
  for (const [a, b] of [['a&amp;q', 'uot;'], ['&amp;#6', '0;script&amp;#62;']]) assert.equal(decode(rows(a, b)), backend.decodeLabelEntities(rows(a, b)));
});

test('tags, attributes and <style> are kept', () => {
  const svg = '<svg aria-label="&amp;quot;"><style>a > b{content:"&amp;quot;"}</style><g data-x="&amp;#60;">&amp;quot;</g></svg>';
  assert.equal(decode(svg), '<svg aria-label="&amp;quot;"><style>a > b{content:"&amp;quot;"}</style><g data-x="&amp;#60;">&quot;</g></svg>');
});

test('the preview and the export use the same function', () => {
  for (const text of CASES) assert.equal(decode(label(text)), backend.decodeLabelEntities(label(text)), text);
});

test('the preview completes the SVG before showing it', () => {
  const editor = readFileSync(new URL('./src/components/DiagramEditor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /innerHTML = decodeLabelEntities\(result\.svg\)/);
});
