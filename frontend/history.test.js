// Unit tests for the editor's undo/redo history. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, record, undo, redo, canUndo, canRedo, LIMIT, COALESCE_MS } from './src/utils/history.ts';

test('undo and redo walk the recorded steps', () => {
  let h = createHistory('a');
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
  h = record(h, 'b');
  h = record(h, 'c');
  assert.equal(h.present, 'c');
  h = undo(h);
  assert.equal(h.present, 'b');
  assert.equal(canRedo(h), true);
  h = undo(h);
  assert.equal(h.present, 'a');
  assert.equal(canUndo(h), false);
  assert.equal(undo(h), h);
  h = redo(redo(h));
  assert.equal(h.present, 'c');
  assert.equal(redo(h), h);
});

test('a new step clears the redo steps; recording the same text is not a step', () => {
  let h = record(record(createHistory('a'), 'b'), 'c');
  h = undo(h);
  h = record(h, 'x');
  assert.deepEqual([h.past, h.present, h.future], [['a', 'b'], 'x', []]);
  assert.equal(record(h, 'x'), h);
});

test('typing within the coalescing window is one step; actions never coalesce', () => {
  let h = createHistory('');
  h = record(h, 'a', 1000);
  h = record(h, 'ab', 1000 + COALESCE_MS - 1);
  h = record(h, 'abc', 1000 + 2 * COALESCE_MS - 2);
  assert.deepEqual([h.past, h.present], [[''], 'abc']);
  // A pause starts a new step.
  h = record(h, 'abcd', 1000 + 4 * COALESCE_MS);
  assert.deepEqual([h.past, h.present], [['', 'abc'], 'abcd']);
  // A builder action after typing is its own step, and typing after it starts another.
  h = record(h, 'action');
  h = record(h, 'action!', 1000 + 4 * COALESCE_MS + 2);
  assert.deepEqual([h.past, h.present], [['', 'abc', 'abcd', 'action'], 'action!']);
  // Undo ends a burst: the next keystroke is a new step.
  h = undo(h);
  h = record(h, 'action?', 1000 + 4 * COALESCE_MS + 3);
  assert.deepEqual([h.past, h.present], [['', 'abc', 'abcd', 'action'], 'action?']);
});

test('the history is bounded', () => {
  let h = createHistory('0');
  for (let i = 1; i <= LIMIT + 20; i++) h = record(h, String(i));
  assert.equal(h.past.length, LIMIT);
  assert.equal(h.past[0], '20');
  let steps = 0;
  while (canUndo(h)) { h = undo(h); steps++; }
  assert.equal(steps, LIMIT);
  assert.equal(h.present, '20');
});
