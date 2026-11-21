// Unit tests for the "How to add an icon pack" help: the recipes answer and the commands. Run with: npm test
// The module is TypeScript; Node 22 runs it directly (type stripping), so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipes, loadRecipes, recipeRows, suggestedRecipe, helpSections, listCommand, PACK_RECIPES_URL } from './src/utils/packHelp.ts';

const answer = (recipes, extra = {}) => ({ format: 1, version: '1.4.0', recipes, ...extra });
const demo = { prefix: 'demo', label: 'Demo Cloud', owner: 'Demo Corp' };
const other = { prefix: 'other-one', label: 'Other', owner: '' };
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

test('parses a valid answer', () => {
  assert.deepEqual(parseRecipes(answer([demo, other])), { version: '1.4.0', recipes: [demo, other] });
});

test('an answer of the wrong shape means no recipes', () => {
  for (const bad of [null, 'x', 5, [], {}, { format: 2, recipes: [] }, { format: 1 }, { format: 1, recipes: 'x' }, { format: 1, recipes: {} }]) {
    assert.deepEqual(parseRecipes(bad), { version: null, recipes: [] }, JSON.stringify(bad));
  }
  assert.deepEqual(parseRecipes(answer(Array.from({ length: 101 }, (_, i) => ({ prefix: `p${i}` })))).recipes, []);
});

test('bad entries are dropped, the good ones stay, a repeated prefix keeps the first', () => {
  const got = parseRecipes(answer([null, 'x', [], { label: 'No prefix' }, { prefix: 'Bad' }, { prefix: 'a b' }, { prefix: 5 }, demo, { ...demo, label: 'Again' }]));
  assert.deepEqual(got.recipes, [demo]);
});

test('an unusable label falls back to the prefix, an unusable owner to an empty string', () => {
  const got = parseRecipes(answer([{ prefix: 'demo', label: 'a\u0000b', owner: 7 }, { prefix: 'two', label: '', owner: 'x'.repeat(81) }, { prefix: 'three', label: 'x'.repeat(81) }]));
  assert.deepEqual(got.recipes, [
    { prefix: 'demo', label: 'demo', owner: '' },
    { prefix: 'two', label: 'two', owner: '' },
    { prefix: 'three', label: 'three', owner: '' },
  ]);
});

test('extra fields are not carried over', () => {
  const got = parseRecipes(answer([{ ...demo, generator: 'x.mjs', terms: { url: 'https://x' } }]));
  assert.deepEqual(Object.keys(got.recipes[0]), ['prefix', 'label', 'owner']);
});

test('only a plain version is kept', () => {
  for (const v of ['1.4.0', '2.0.0-rc.1']) assert.equal(parseRecipes(answer([demo], { version: v })).version, v);
  for (const v of ['latest', '1.4', '1.4.0; rm -rf /', '1.4.0 ', 5, null, undefined, '1.4.0-' + 'x'.repeat(40)]) {
    assert.equal(parseRecipes(answer([demo], { version: v })).version, null, String(v));
  }
});

test('loadRecipes asks the route and treats every failure as none', async () => {
  const asked = [];
  const ok = await loadRecipes(async (url, init) => { asked.push([url, init?.cache]); return json(answer([demo])); });
  assert.deepEqual(ok.recipes, [demo]);
  assert.deepEqual(asked, [[PACK_RECIPES_URL, 'no-cache']]);
  const none = { version: null, recipes: [] };
  assert.deepEqual(await loadRecipes(async () => json({ error: 'Not found' }, 404)), none);
  assert.deepEqual(await loadRecipes(async () => json('<!doctype html><html></html>')), none);
  assert.deepEqual(await loadRecipes(async () => { throw new Error('offline'); }), none);
});

test('rows say which recipes are installed; the first one not installed is suggested', () => {
  const recipes = [demo, other];
  assert.deepEqual(recipeRows(recipes, []).map((r) => r.installed), [false, false]);
  assert.deepEqual(recipeRows(recipes, [{ prefix: 'demo' }]).map((r) => r.installed), [true, false]);
  assert.equal(suggestedRecipe(recipeRows(recipes, [])).prefix, 'demo');
  assert.equal(suggestedRecipe(recipeRows(recipes, [{ prefix: 'demo' }])).prefix, 'other-one');
  assert.equal(suggestedRecipe(recipeRows(recipes, [{ prefix: 'demo' }, { prefix: 'other-one' }])).prefix, 'demo');
  assert.equal(suggestedRecipe([]), null);
});

test('commands carry the version and the prefix', () => {
  const [docker, compose, source] = helpSections('demo', '1.4.0');
  assert.equal(docker.steps[0].command, 'docker run --rm -it -v sirenia-packs:/packs ghcr.io/hiranez/sirenia:1.4.0 packs add demo');
  assert.equal(compose.steps[0].command, 'docker compose run --rm sirenia packs add demo');
  assert.equal(compose.steps[1].command, 'docker compose restart sirenia');
  assert.equal(source.steps[0].command, 'npm run packs -- add demo');
  assert.equal(listCommand('1.4.0'), 'docker run --rm -it -v sirenia-packs:/packs ghcr.io/hiranez/sirenia:1.4.0 packs list');
});

test('every way ends with a restart and a reload; the volume warning is on the Docker command', () => {
  const sections = helpSections('demo', '1.4.0');
  assert.deepEqual(sections.map((s) => s.id), ['docker', 'compose', 'source']);
  for (const s of sections) {
    assert.match(s.steps.at(-1).text, /Reload this page/);
    assert.match(s.steps.at(-2).text + (s.steps.at(-2).command ?? ''), /restart|Restart/);
  }
  assert.match(sections[0].steps[0].note, /same volume/);
});

test('without a usable version the image tag is a visible placeholder, never "null"', () => {
  assert.match(helpSections('demo', null)[0].steps[0].command, /sirenia:<version> packs add demo$/);
  assert.doesNotMatch(listCommand(null), /null|undefined/);
});
