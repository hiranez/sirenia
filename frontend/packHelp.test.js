// Unit tests for the "How to add an icon pack" help: the recipes answer and the commands. Run with: npm test
// The module is TypeScript; Node 22 runs it directly (type stripping), so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipes, loadRecipes, recipeRows, suggestedRecipes, helpSections, listCommand, startCommand, link, PACK_RECIPES_URL } from './src/utils/packHelp.ts';

const answer = (recipes, extra = {}) => ({ format: 1, version: '1.4.0', recipes, ...extra });
const demo = { prefix: 'demo', label: 'Demo Cloud', owner: 'Demo Corp', iconsUrl: 'https://example.com/icons', termsUrl: 'https://example.com/terms' };
const other = { prefix: 'other-one', label: 'Other', owner: '', iconsUrl: null, termsUrl: null };
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
  const none = { iconsUrl: null, termsUrl: null };
  assert.deepEqual(got.recipes, [
    { prefix: 'demo', label: 'demo', owner: '', ...none },
    { prefix: 'two', label: 'two', owner: '', ...none },
    { prefix: 'three', label: 'three', owner: '', ...none },
  ]);
});

test('extra fields are not carried over', () => {
  const got = parseRecipes(answer([{ ...demo, generator: 'x.mjs', terms: { url: 'https://x' } }]));
  assert.deepEqual(Object.keys(got.recipes[0]), ['prefix', 'label', 'owner', 'iconsUrl', 'termsUrl']);
});

test('vendor links: an https URL is kept, a missing one is null, any other value drops the recipe', () => {
  assert.deepEqual(parseRecipes(answer([demo])).recipes, [demo]);
  assert.deepEqual(parseRecipes(answer([{ prefix: 'demo', iconsUrl: null }])).recipes[0].iconsUrl, null);
  const bad = ['http://example.com/', 'javascript:alert(1)', 'data:text/html,x', '//example.com/x', 'https://', 'https://exa mple.com/',
    'https://example.com/\u0000', `https://example.com/${'x'.repeat(481)}`, 5, {}, ['https://example.com/'], ''];
  for (const value of bad) {
    assert.deepEqual(parseRecipes(answer([{ ...demo, iconsUrl: value }, other])).recipes, [other], `iconsUrl ${JSON.stringify(value)}`);
    assert.deepEqual(parseRecipes(answer([{ ...demo, termsUrl: value }, other])).recipes, [other], `termsUrl ${JSON.stringify(value)}`);
  }
  assert.equal(link(`https://example.com/${'x'.repeat(480)}`), `https://example.com/${'x'.repeat(480)}`, '500 characters is the limit');
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

test('rows say which recipes are installed; the ones not installed are suggested, or all when all are', () => {
  const recipes = [demo, other];
  const prefixes = (rows) => suggestedRecipes(rows).map((r) => r.prefix);
  assert.deepEqual(recipeRows(recipes, []).map((r) => r.installed), [false, false]);
  assert.deepEqual(recipeRows(recipes, [{ prefix: 'demo' }]).map((r) => r.installed), [true, false]);
  assert.deepEqual(prefixes(recipeRows(recipes, [])), ['demo', 'other-one']);
  assert.deepEqual(prefixes(recipeRows(recipes, [{ prefix: 'demo' }])), ['other-one']);
  assert.deepEqual(prefixes(recipeRows(recipes, [{ prefix: 'demo' }, { prefix: 'other-one' }])), ['demo', 'other-one']);
  assert.deepEqual(suggestedRecipes([]), []);
});

test('commands carry the version and every prefix; the one-command start comes first', () => {
  const [start, docker, compose, source] = helpSections(['demo', 'other-one'], '1.4.0');
  assert.equal(start.id, 'start');
  assert.equal(start.steps[1].command, 'docker run --rm -p 8080:8080 -v sirenia-packs:/packs -e SIRENIA_PACKS=demo,other-one -e SIRENIA_ACCEPT_PACK_TERMS=yes ghcr.io/hiranez/sirenia:1.4.0');
  assert.equal(startCommand(['demo'], '1.4.0'), 'docker run --rm -p 8080:8080 -v sirenia-packs:/packs -e SIRENIA_PACKS=demo -e SIRENIA_ACCEPT_PACK_TERMS=yes ghcr.io/hiranez/sirenia:1.4.0');
  assert.equal(docker.steps[0].command, 'docker run --rm -it -v sirenia-packs:/packs ghcr.io/hiranez/sirenia:1.4.0 packs add demo other-one');
  assert.equal(compose.steps[0].command, 'docker compose run --rm sirenia packs add demo other-one');
  assert.equal(compose.steps[1].command, 'docker compose restart sirenia');
  assert.equal(source.steps[0].command, 'npm run packs -- add demo other-one');
  assert.equal(listCommand('1.4.0'), 'docker run --rm -it -v sirenia-packs:/packs ghcr.io/hiranez/sirenia:1.4.0 packs list');
});

test('every way ends with a restart and a reload; the volume warning is on the Docker command', () => {
  const sections = helpSections(['demo'], '1.4.0');
  assert.deepEqual(sections.map((s) => s.id), ['start', 'docker', 'compose', 'source']);
  for (const s of sections) {
    assert.match(s.steps.at(-1).text, /Reload this page/);
    assert.match(s.steps.slice(0, -1).map((x) => x.text + (x.command ?? '')).join(' '), /[Rr]estart|Stop the running container/);
  }
  assert.match(sections[0].steps[1].note, /same volume/);
  assert.match(sections[1].steps[0].note, /same volume/);
  assert.match(sections[0].steps[1].text, /SIRENIA_ACCEPT_PACK_TERMS=yes says that you accept each vendor's terms/);
});

test('without a usable version the image tag is a visible placeholder, never "null"', () => {
  assert.match(helpSections(['demo'], null)[1].steps[0].command, /sirenia:<version> packs add demo$/);
  assert.match(helpSections(['demo'], null)[0].steps[1].command, /sirenia:<version>$/);
  assert.doesNotMatch(listCommand(null), /null|undefined/);
});
