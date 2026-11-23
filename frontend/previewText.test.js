// The preview shows diagram text as Mermaid lays it out, like the export. Run with: npm test
// These read the sources: the rules they guard are one line each and easy to undo by accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selector: selector.replace(/\s+/g, ' ').trim(),
  body: body.replace(/\s+/g, ''),
}));

test('diagram text uses the same font rule as the page the render backend draws in', () => {
  const backend = read('../backend/routes/generate.js').match(/text,tspan\{font-family:([^}]+)\}/);
  assert.ok(backend, 'font rule in the backend page');
  const preview = rules.find((r) => r.selector === 'svg text, svg tspan');
  assert.ok(preview, 'font rule for diagram text in index.css');
  assert.equal(preview.body.replace(/;$/, ''), `font-family:${backend[1]}`);
});

test('no style changes the size, anchor or baseline of text in the preview', () => {
  const placing = /(^|;)(font-size|text-anchor|dominant-baseline|font-family):/;
  const bad = rules.filter((r) => r.selector.includes('.mermaid-preview') && placing.test(r.body));
  assert.deepEqual(bad.map((r) => r.selector), []);
});

test('the editor does not rewrite the text of the rendered diagram', () => {
  assert.doesNotMatch(read('./src/components/DiagramEditor.tsx'), /'tspan'|"tspan"/);
});
