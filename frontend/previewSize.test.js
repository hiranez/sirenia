// The preview shows the drawing area Mermaid chose, like the export. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawingArea } from './src/utils/previewSize.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the drawing area is the width and height of the viewBox', () => {
  assert.deepEqual(drawingArea('0 0 1200 148'), { width: 1200, height: 148 });
  assert.deepEqual(drawingArea('-347.59 -204.21 698.18 536.43'), { width: 698.18, height: 536.43 });
  assert.deepEqual(drawingArea(' 0,0,500,500 '), { width: 500, height: 500 });
});

test('a missing or unusable viewBox gives no area', () => {
  for (const value of [null, undefined, '', '0 0 100', '0 0 100 100 5', '0 0 abc 100', '0 0 0 100', '0 0 100 -5', '0 0 Infinity 100']) {
    assert.equal(drawingArea(value), null, JSON.stringify(value));
  }
});

// These read the sources: each rule is one line and easy to undo by accident.
test('the editor does not size the preview by measuring what is drawn', () => {
  assert.doesNotMatch(read('./src/components/DiagramEditor.tsx'), /getBBox|getBoundingClientRect\(\)\.(width|height)/);
});

test('a Gantt chart has the same fixed width in the preview and in the export', () => {
  const width = (source, where) => {
    const found = source.match(/gantt:\s*\{[^}]*?useWidth:\s*(\d+)/);
    assert.ok(found, `gantt useWidth in ${where}`);
    return Number(found[1]);
  };
  const preview = width(read('./src/components/DiagramEditor.tsx'), 'the editor');
  const backend = width(read('../backend/routes/generate.js'), 'the render backend');
  assert.equal(preview, backend);
  assert.ok(preview >= 600, 'wide enough for a readable chart');
});
