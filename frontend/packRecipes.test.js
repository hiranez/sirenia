// Unit tests for the proxy's recipe discovery. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverRecipes, httpsLink, recipesRoot } from './packRecipes.js';

function recipesDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sirenia-recipes-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'mapping.json'), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}
const demo = {
  prefix: 'demo',
  pack: { label: 'Demo Cloud', owner: 'Demo Corp', generator: 'x.mjs', terms: { summary: ['secret'], url: 'https://example.com/terms' } },
  upstream: { page: 'https://example.com/icons', zips: { icons: { url: 'https://example.com/x.zip', sha256: '0'.repeat(64) } } },
};
const demoEntry = { prefix: 'demo', label: 'Demo Cloud', owner: 'Demo Corp', iconsUrl: 'https://example.com/icons', termsUrl: 'https://example.com/terms' };

test('a valid recipe is listed with prefix, label, owner and the two vendor links only', () => {
  const root = recipesDir({ demo });
  assert.deepEqual(discoverRecipes(root), [demoEntry]);
});

test('vendor links: https only, at most 500 characters, otherwise null; pack.termsUrl is the fallback', () => {
  const links = (pack, upstream) => {
    const [r] = discoverRecipes(recipesDir({ demo: { prefix: 'demo', pack, upstream } }));
    return [r.iconsUrl, r.termsUrl];
  };
  assert.deepEqual(links({ termsUrl: 'https://example.com/t' }, { page: 'https://example.com/i' }), ['https://example.com/i', 'https://example.com/t']);
  for (const bad of ['http://example.com/', 'javascript:alert(1)', 'https://', 'https://exa mple.com', 'https://example.com/\nx', `https://example.com/${'x'.repeat(490)}`, 5, null, ['https://example.com']]) {
    assert.deepEqual(links({ terms: { url: bad } }, { page: bad }), [null, null], String(bad));
  }
  assert.deepEqual(links({}, {}), [null, null]);
  assert.equal(httpsLink('https://example.com/a?b=c#d'), 'https://example.com/a?b=c#d');
});

test('label falls back to the prefix and owner to an empty string; recipes are sorted by directory', () => {
  const root = recipesDir({ b: { prefix: 'bee', pack: {} }, a: { prefix: 'ant', pack: { label: 'Ant', owner: 5 } } });
  assert.deepEqual(discoverRecipes(root), [
    { prefix: 'ant', label: 'Ant', owner: '', iconsUrl: null, termsUrl: null },
    { prefix: 'bee', label: 'bee', owner: '', iconsUrl: null, termsUrl: null },
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

test('the recipes of this repository carry both vendor links', () => {
  const recipes = discoverRecipes(path.resolve(import.meta.dirname, '..', 'icons'));
  assert.deepEqual(recipes.map((r) => r.prefix), ['aws', 'azure', 'gcp']);
  for (const r of recipes) {
    assert.ok(r.iconsUrl?.startsWith('https://'), r.prefix);
    assert.ok(r.termsUrl?.startsWith('https://'), r.prefix);
  }
});

test('the root is PACK_RECIPES_DIR, otherwise icons/ next to the frontend directory', () => {
  assert.equal(recipesRoot({ PACK_RECIPES_DIR: '/somewhere/recipes' }, '/app/frontend'), path.resolve('/somewhere/recipes'));
  assert.equal(recipesRoot({}, '/app/frontend'), path.resolve('/app/icons'));
  assert.equal(recipesRoot({ PACK_RECIPES_DIR: '' }, '/app/frontend'), path.resolve('/app/icons'));
});
