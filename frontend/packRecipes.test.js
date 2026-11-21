// Unit tests for the proxy's recipe discovery. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverRecipes, recipesRoot } from './packRecipes.js';

function recipesDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sirenia-recipes-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'mapping.json'), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}
const demo = { prefix: 'demo', pack: { label: 'Demo Cloud', owner: 'Demo Corp', generator: 'x.mjs', terms: { summary: ['secret'], url: 'https://example.com' } } };

test('a valid recipe is listed with prefix, label and owner only', () => {
  const root = recipesDir({ demo });
  assert.deepEqual(discoverRecipes(root), [{ prefix: 'demo', label: 'Demo Cloud', owner: 'Demo Corp' }]);
});

test('label falls back to the prefix and owner to an empty string; recipes are sorted by directory', () => {
  const root = recipesDir({ b: { prefix: 'bee', pack: {} }, a: { prefix: 'ant', pack: { label: 'Ant', owner: 5 } } });
  assert.deepEqual(discoverRecipes(root), [
    { prefix: 'ant', label: 'Ant', owner: '' },
    { prefix: 'bee', label: 'bee', owner: '' },
  ]);
});

test('a missing directory is an empty list, not an error', () => {
  const warnings = [];
  assert.deepEqual(discoverRecipes(path.join(os.tmpdir(), 'sirenia-no-such-dir-xyz'), (m) => warnings.push(m)), []);
  assert.deepEqual(warnings, []);
});

test('malformed JSON is skipped with a warning; the other recipes stay', () => {
  const root = recipesDir({ bad: '{ not json', demo });
  const warnings = [];
  assert.deepEqual(discoverRecipes(root, (m) => warnings.push(m)).map((r) => r.prefix), ['demo']);
  assert.equal(warnings.length, 1);
});

test('a mapping without a pack object, or with an invalid prefix, is not a recipe', () => {
  const root = recipesDir({
    nopack: { prefix: 'nopack' },
    arraypack: { prefix: 'arr', pack: [] },
    noprefix: { pack: {} },
    upper: { prefix: 'Upper', pack: {} },
    list: [],
  });
  assert.deepEqual(discoverRecipes(root), []);
});

test('a directory without mapping.json and a stray file are ignored', () => {
  const root = recipesDir({ demo });
  fs.mkdirSync(path.join(root, 'empty'));
  fs.writeFileSync(path.join(root, 'README.md'), 'text');
  assert.deepEqual(discoverRecipes(root).map((r) => r.prefix), ['demo']);
});

test('a root that is a file is an empty list', () => {
  const root = recipesDir({});
  const file = path.join(root, 'plain');
  fs.writeFileSync(file, 'x');
  assert.deepEqual(discoverRecipes(file, () => {}), []);
});

test('the root is PACK_RECIPES_DIR, otherwise icons/ next to the frontend directory', () => {
  assert.equal(recipesRoot({ PACK_RECIPES_DIR: '/somewhere/recipes' }, '/app/frontend'), path.resolve('/somewhere/recipes'));
  assert.equal(recipesRoot({}, '/app/frontend'), path.resolve('/app/icons'));
  assert.equal(recipesRoot({ PACK_RECIPES_DIR: '' }, '/app/frontend'), path.resolve('/app/icons'));
});
