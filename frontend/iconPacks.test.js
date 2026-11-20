// Unit tests for the editor's icon-pack index and footer notices. Run with: npm test
// The module is TypeScript; Node 22 runs it directly (type stripping), so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePackIndex, composeFooterNotice, iconifyPart, loadPackIndex, fetchPack, loadPackFile, PACK_INDEX_URL } from './src/utils/iconPacks.ts';

const GOOGLE_EDITOR = 'Google Cloud and the Google Cloud product icons are trademarks of Google LLC, used here solely to depict Google Cloud products in architecture diagrams.';
const GOOGLE_AFTER = 'Icons are used unmodified, as published by Google.';
const gcpEntry = () => ({
  prefix: 'gcp',
  file: 'gcp.json',
  label: 'Google Cloud',
  owner: 'Google',
  termsUrl: 'https://about.google/brand-resource-center/',
  notice: { editor: GOOGLE_EDITOR, editorAfter: GOOGLE_AFTER },
  icons: 45,
});
const index = (...packs) => ({ format: 1, packs });
const CLONIX = { productName: 'Clonix Secure Diagram Studio', vendorName: 'Clonix' };
const DEFAULT = { productName: 'Sirenia', vendorName: null };
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

test('parses a valid index', () => {
  assert.deepEqual(parsePackIndex(index(gcpEntry())), [gcpEntry()]);
  const minimal = parsePackIndex(index({ prefix: 'demo', file: 'demo.json' }));
  assert.deepEqual(minimal, [{ prefix: 'demo', file: 'demo.json', label: 'demo', owner: null, termsUrl: null, notice: null, icons: null }]);
});

test('an index of the wrong shape means no packs', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { packs: [gcpEntry()] }, { format: 2, packs: [gcpEntry()] },
    { format: '1', packs: [gcpEntry()] }, { format: 1, packs: {} }, { format: 1, packs: Array(101).fill(gcpEntry()) }]) {
    assert.deepEqual(parsePackIndex(bad), [], JSON.stringify(bad)?.slice(0, 60));
  }
});

test('a bad entry is dropped, the others are kept', () => {
  const bad = [
    null, 'gcp', [],
    { ...gcpEntry(), prefix: 'GCP', file: 'GCP.json' },
    { ...gcpEntry(), prefix: '1gcp', file: '1gcp.json' },
    { ...gcpEntry(), file: '../gcp.json' },
    { ...gcpEntry(), file: 'gcp.json?x' },
    { ...gcpEntry(), file: '/packs/gcp.json' },
    { ...gcpEntry(), file: 'https://example.com/gcp.json' },
    { ...gcpEntry(), file: 'other.json' },
    { ...gcpEntry(), file: 'gcp.JSON' },
    { ...gcpEntry(), label: 'x'.repeat(81) },
    { ...gcpEntry(), label: 7 },
    { ...gcpEntry(), label: '' },
    { ...gcpEntry(), owner: 'x'.repeat(81) },
    { ...gcpEntry(), owner: 'Goo\ngle' },
    { ...gcpEntry(), termsUrl: 'http://example.com' },
    { ...gcpEntry(), termsUrl: 'javascript:alert(1)' },
    { ...gcpEntry(), notice: 'x' },
    { ...gcpEntry(), notice: { editor: 'x'.repeat(1001) } },
    { ...gcpEntry(), notice: { editor: GOOGLE_EDITOR, editorAfter: 5 } },
    { ...gcpEntry(), notice: { editor: GOOGLE_EDITOR, export: 'x' } },
    { ...gcpEntry(), icons: -1 },
    { ...gcpEntry(), icons: '45' },
  ];
  for (const entry of bad) {
    assert.deepEqual(parsePackIndex(index(entry, { prefix: 'demo', file: 'demo.json' })).map((p) => p.prefix), ['demo'], JSON.stringify(entry)?.slice(0, 80));
  }
  // A repeated prefix keeps the first entry.
  assert.deepEqual(parsePackIndex(index(gcpEntry(), { ...gcpEntry(), label: 'Second' })).map((p) => p.label), ['Google Cloud']);
  // Limits are inclusive.
  assert.equal(parsePackIndex(index({ ...gcpEntry(), label: 'y'.repeat(80), notice: { editor: 'x'.repeat(1000) } })).length, 1);
});

test('footer paragraph for the Google Cloud pack, Clonix branding: exactly the published text', () => {
  assert.equal(
    composeFooterNotice(gcpEntry(), CLONIX),
    'Google Cloud and the Google Cloud product icons are trademarks of Google LLC, used here solely to depict Google Cloud products in architecture diagrams. '
      + 'Clonix Secure Diagram Studio is an independent product; Clonix is not affiliated with, sponsored by, or endorsed by Google. '
      + 'Icons are used unmodified, as published by Google.'
  );
});

test('footer paragraph for the Google Cloud pack, default branding: exactly the published text', () => {
  assert.equal(
    composeFooterNotice(gcpEntry(), DEFAULT),
    'Google Cloud and the Google Cloud product icons are trademarks of Google LLC, used here solely to depict Google Cloud products in architecture diagrams. '
      + 'Sirenia is an independent project, not affiliated with, sponsored by, or endorsed by Google. '
      + 'Icons are used unmodified, as published by Google.'
  );
});

test('the committed index composes the same paragraph (when the Google Cloud pack is installed)', (t) => {
  let committed;
  try {
    committed = JSON.parse(readFileSync(new URL('./public/packs/index.json', import.meta.url), 'utf8'));
  } catch {
    t.skip('frontend/public/packs/index.json not present (no packs in this copy)');
    return;
  }
  const gcp = parsePackIndex(committed).find((p) => p.prefix === 'gcp');
  if (!gcp) { t.skip('Google Cloud pack not installed'); return; }
  assert.equal(composeFooterNotice(gcp, CLONIX), composeFooterNotice(gcpEntry(), CLONIX));
  assert.equal(composeFooterNotice(gcp, DEFAULT), composeFooterNotice(gcpEntry(), DEFAULT));
});

test('a pack without notice or owner contributes no footer text; editorAfter is optional', () => {
  assert.equal(composeFooterNotice({ ...gcpEntry(), notice: null }, CLONIX), null);
  assert.equal(composeFooterNotice({ ...gcpEntry(), owner: null }, CLONIX), null);
  const [demo] = parsePackIndex(index({ prefix: 'demo', file: 'demo.json', owner: 'Example Corp', notice: { editor: 'Demo shapes are test artwork.' } }));
  assert.equal(composeFooterNotice(demo, DEFAULT), 'Demo shapes are test artwork. Sirenia is an independent project, not affiliated with, sponsored by, or endorsed by Example Corp.');
  const [noEditor] = parsePackIndex(index({ prefix: 'demo', file: 'demo.json', owner: 'Example Corp', notice: { editorAfter: 'Only after.' } }));
  assert.equal(composeFooterNotice(noEditor, DEFAULT), null);
});

test('loadPackIndex: any failure means no packs, never throws', async () => {
  const calls = [];
  const fake = (response) => async (url, init) => { calls.push([url, init]); if (response instanceof Error) throw response; return response; };
  assert.deepEqual(await loadPackIndex(fake(json(index(gcpEntry())))), [gcpEntry()]);
  assert.deepEqual(calls[0], [PACK_INDEX_URL, { cache: 'no-cache' }]);
  assert.equal(PACK_INDEX_URL, '/packs/index.json');
  assert.deepEqual(await loadPackIndex(fake(json({ error: 'Not found' }, 404))), []);
  assert.deepEqual(await loadPackIndex(fake(json('<!doctype html><html><body>SPA</body></html>'))), []);
  assert.deepEqual(await loadPackIndex(fake(json({ format: 1, packs: 'x' }))), []);
  assert.deepEqual(await loadPackIndex(fake(new TypeError('Failed to fetch'))), []);
});

test('fetchPack hands Mermaid the Iconify part only and rejects anything else', async () => {
  const entry = gcpEntry();
  const pack = { prefix: 'gcp', sirenia: { format: 1, label: 'Google Cloud' }, width: 512, icons: { a: { body: '<g/>' } }, aliases: { b: { parent: 'a' } } };
  let url;
  const got = await fetchPack(entry, async (u, init) => { url = [u, init]; return json(pack); });
  assert.deepEqual(url, ['/packs/gcp.json', { cache: 'no-cache' }]);
  assert.deepEqual(got, { prefix: 'gcp', width: 512, icons: { a: { body: '<g/>' } }, aliases: { b: { parent: 'a' } } });
  await assert.rejects(fetchPack(entry, async () => json({ error: 'Not found' }, 404)), /HTTP 404/);
  await assert.rejects(fetchPack(entry, async () => json('<!doctype html>')));
  await assert.rejects(fetchPack(entry, async () => json({ ...pack, prefix: 'other' })), /not a valid pack/);
  assert.throws(() => iconifyPart({ prefix: 'gcp', icons: [] }, 'gcp'), /not a valid pack/);
});

test('loadPackFile: one download per page, shared with fetchPack; a failure is not cached', async () => {
  const entry = gcpEntry();
  const pack = { prefix: 'gcp', sirenia: { format: 1 }, icons: { a: { body: '<g/>' } } };
  let calls = 0;
  const fetchOnce = async () => { calls++; return json(pack); };
  const [file, part] = await Promise.all([loadPackFile(entry, fetchOnce), fetchPack(entry, fetchOnce)]);
  assert.deepEqual(file, pack);
  assert.deepEqual(part, { prefix: 'gcp', icons: { a: { body: '<g/>' } } });
  await loadPackFile(entry, fetchOnce);
  assert.equal(calls, 1);

  let attempts = 0;
  const flaky = async () => { attempts++; return attempts === 1 ? json({ error: 'x' }, 503) : json(pack); };
  await assert.rejects(loadPackFile(entry, flaky), /HTTP 503/);
  assert.deepEqual(await loadPackFile(entry, flaky), pack);
  assert.equal(attempts, 2);
  const broken = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchPack(entry, broken));
  await assert.rejects(fetchPack(entry, broken));
});
