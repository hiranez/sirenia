// Unit tests for the icon picker's catalog, search and insertion logic. Run with: npm test
// The module is TypeScript; Node 22 runs it directly (type stripping), so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, searchCatalog, diagramKind, insertIcon, previewCode } from './src/utils/iconPicker.ts';

const pack = (catalog, extra = {}) => ({
  prefix: 'demo',
  sirenia: { format: 1, ...(catalog === undefined ? {} : { catalog }) },
  icons: { 'cloud-run': { body: '<g/>' }, pubsub: { body: '<g/>' }, 'sole-tenant-nodes': { body: '<g/>' }, gemini: { body: '<g/>' }, end: { body: '<g/>' } },
  aliases: { run: { parent: 'cloud-run' } },
  ...extra,
});
const entry = (icon, name, group = null) => ({ icon, name, group });
const RUN = entry('cloud-run', 'Cloud Run', 'Serverless');

test('parseCatalog reads sirenia.catalog', () => {
  const got = parseCatalog(pack([{ icon: 'cloud-run', name: 'Cloud Run', group: 'Serverless' }, { icon: 'run', name: 'Run alias' }]), 'demo');
  assert.deepEqual(got, [RUN, entry('run', 'Run alias')]);
});

test('parseCatalog drops bad entries and keeps the good ones', () => {
  const good = { icon: 'pubsub', name: 'Pub/Sub' };
  const bad = [
    null, 'x', 5, [], { icon: 'cloud-run' }, { name: 'No icon' },
    { icon: 'nope', name: 'Unknown icon' },
    { icon: 'toString', name: 'Inherited' },
    { icon: 'constructor', name: 'Inherited' },
    { icon: 5, name: 'Number icon' },
    { icon: 'cloud-run', name: 'Extra key', extra: 1 },
    { icon: 'cloud-run', name: '' },
    { icon: 'cloud-run', name: '   ' },
    { icon: 'cloud-run', name: 7 },
    { icon: 'cloud-run', name: 'x'.repeat(81) },
    { icon: 'cloud-run', name: 'a\nb' },
    { icon: 'cloud-run', name: 'a b' },
    { icon: 'cloud-run', name: 'ok', group: '' },
    { icon: 'cloud-run', name: 'ok', group: null },
    { icon: 'cloud-run', name: 'ok', group: 'x'.repeat(81) },
    ...[...'[]{}<>"`\\|#;%'].flatMap((ch) => [
      { icon: 'cloud-run', name: `a${ch}b` },
      { icon: 'cloud-run', name: 'ok', group: `a${ch}b` },
    ]),
  ];
  const got = parseCatalog(pack([...bad, good]), 'demo');
  assert.deepEqual(got, [entry('pubsub', 'Pub/Sub')]);
  // Limits are inclusive.
  assert.equal(parseCatalog(pack([{ icon: 'pubsub', name: 'x'.repeat(80), group: 'y'.repeat(80) }]), 'demo').length, 1);
});

test('parseCatalog: a repeated icon keeps the first entry', () => {
  const got = parseCatalog(pack([{ icon: 'pubsub', name: 'First' }, { icon: 'pubsub', name: 'Second' }, { icon: 'gemini', name: 'G' }]), 'demo');
  assert.deepEqual(got.map((e) => e.name), ['First', 'G']);
});

test('parseCatalog falls back to icon and alias names without a usable catalog', () => {
  const fallback = [
    entry('cloud-run', 'cloud run'), entry('end', 'end'), entry('gemini', 'gemini'), entry('pubsub', 'pubsub'),
    entry('run', 'run'), entry('sole-tenant-nodes', 'sole tenant nodes'),
  ];
  for (const p of [
    pack(undefined), pack([]), pack('x'), pack({ icon: 'pubsub', name: 'x' }), pack(null), pack([null, { icon: 'nope', name: 'x' }]),
    pack(Array.from({ length: 5001 }, () => ({ icon: 'pubsub', name: 'x' }))),
    { ...pack(undefined), sirenia: 'x' }, { ...pack(undefined), sirenia: null }, { ...pack(undefined), sirenia: [] },
  ]) {
    assert.deepEqual(parseCatalog(p, 'demo'), fallback, JSON.stringify(p.sirenia)?.slice(0, 60));
  }
  const { sirenia, ...plain } = pack(undefined);
  assert.ok(sirenia);
  assert.deepEqual(parseCatalog(plain, 'demo'), fallback);
});

test('parseCatalog: fallback skips names that are not plain icon names; untrusted shapes give nothing', () => {
  const odd = { prefix: 'demo', icons: { ok: {}, 'Bad Name': {}, 'a(b)': {}, '': {} }, aliases: { 'x y': { parent: 'ok' }, good: { parent: 'ok' } } };
  assert.deepEqual(parseCatalog(odd, 'demo').map((e) => e.icon), ['good', 'ok']);
  for (const bad of [null, undefined, 'x', 5, [], {}, { prefix: 'other', icons: {} }, { prefix: 'demo' }, { prefix: 'demo', icons: [] }]) {
    assert.deepEqual(parseCatalog(bad, 'demo'), []);
  }
  // A catalog entry whose icon is not a plain icon name is dropped even if the pack has that key.
  const weird = { prefix: 'demo', sirenia: { catalog: [{ icon: 'A b', name: 'X' }, { icon: 'ok', name: 'Fine' }] }, icons: { 'A b': {}, ok: {} } };
  assert.deepEqual(parseCatalog(weird, 'demo'), [entry('ok', 'Fine')]);
  // Tolerates a non-object aliases.
  assert.deepEqual(parseCatalog({ prefix: 'demo', icons: { a: {} }, aliases: [] }, 'demo'), [entry('a', 'a')]);
});

test('searchCatalog: all terms, case-insensitive, name/icon/group, catalog order, prefix matches first', () => {
  const entries = [
    entry('cloud-sql', 'Cloud SQL', 'Databases'),
    entry('bigquery', 'BigQuery', 'Data Analytics'),
    entry('run', 'Cloud Run', 'Serverless'),
    entry('runner', 'Runner Pool', 'Compute'),
    entry('sql-proxy', 'Auth Proxy', 'Databases'),
  ];
  assert.deepEqual(searchCatalog(entries, ''), entries);
  assert.deepEqual(searchCatalog(entries, '   '), entries);
  assert.notEqual(searchCatalog(entries, ''), entries);
  assert.deepEqual(searchCatalog(entries, 'RUN').map((e) => e.name), ['Runner Pool', 'Cloud Run']);
  assert.deepEqual(searchCatalog(entries, 'cloud run').map((e) => e.name), ['Cloud Run']);
  assert.deepEqual(searchCatalog(entries, 'run cloud').map((e) => e.name), ['Cloud Run']);
  assert.deepEqual(searchCatalog(entries, 'sql').map((e) => e.name), ['Cloud SQL', 'Auth Proxy']);
  assert.deepEqual(searchCatalog(entries, 'databases proxy').map((e) => e.name), ['Auth Proxy']);
  assert.deepEqual(searchCatalog(entries, 'analytics').map((e) => e.name), ['BigQuery']);
  assert.deepEqual(searchCatalog(entries, 'nothing'), []);
  // Regular-expression characters in the query are plain text.
  assert.deepEqual(searchCatalog(entries, '.*'), []);
  assert.deepEqual(searchCatalog(entries, '(').length, 0);
});

test('diagramKind: first meaningful line, after front matter, directives and comments', () => {
  const k = diagramKind;
  assert.equal(k(''), 'empty');
  assert.equal(k('  \n\n \t\n'), 'empty');
  assert.equal(k('%% only a comment'), 'empty');
  assert.equal(k('architecture-beta\n  service a(cloud)[A]'), 'architecture');
  assert.equal(k('\n\n  architecture-beta'), 'architecture');
  assert.equal(k('ARCHITECTURE-BETA'), 'architecture');
  assert.equal(k('graph TD;\n A-->B'), 'flowchart');
  assert.equal(k('graph'), 'flowchart');
  assert.equal(k('flowchart LR'), 'flowchart');
  assert.equal(k('flowchart-elk TD'), 'flowchart');
  assert.equal(k('flowchart;'), 'flowchart');
  assert.equal(k('---\ntitle: T\n---\ngraph TD\n A-->B'), 'flowchart');
  assert.equal(k('---\ntitle: T\nconfig:\n  theme: dark\n---\n%% note\narchitecture-beta'), 'architecture');
  assert.equal(k('%%{init: {"theme": "dark"}}%%\nflowchart TD'), 'flowchart');
  assert.equal(k('%%{init: {\n  "theme": "dark"\n}}%%\n%% comment\n\nflowchart TD'), 'flowchart');
  assert.equal(k('%% a\n%% b\ngraph LR'), 'flowchart');
  assert.equal(k('sequenceDiagram\n A->>B: hi'), 'other');
  assert.equal(k('classDiagram'), 'other');
  assert.equal(k('graphite'), 'other');
  assert.equal(k('flowcharts'), 'other');
  assert.equal(k('architecture'), 'other');
  assert.equal(k('---\ntitle: unclosed\ngraph TD'), 'other');
  assert.equal(k('%%{init: {"unclosed": 1}\ngraph TD'), 'other');
  // `---` after the first meaningful line is not front matter.
  assert.equal(k('sequenceDiagram\n---\ngraph TD'), 'other');
});

const ARCH = 'architecture-beta\n  group g(cloud)[G]\n  service a(cloud)[A]\n  service b(cloud)[B]';

test('insertIcon: architecture and flowchart lines are exact', () => {
  assert.equal(insertIcon(ARCH, null, 'gcp', RUN).code.split('\n').pop(), '  service cloud_run(gcp:cloud-run)[Cloud Run]');
  const flow = insertIcon('graph TD\n  A-->B', null, 'gcp', RUN);
  assert.equal(flow.code, 'graph TD\n  A-->B\n  cloud_run@{ icon: "gcp:cloud-run", label: "Cloud Run" }');
});

test('insertIcon: after the cursor line (start, middle, end, null), never above the header', () => {
  const line = '  service cloud_run(gcp:cloud-run)[Cloud Run]';
  const L = ARCH.split('\n');
  const at = (cursor) => insertIcon(ARCH, cursor, 'gcp', RUN);
  const expected = (n) => [...L.slice(0, n), line, ...L.slice(n)].join('\n');
  // Offsets: inside line 2 (the group), inside the last line, at the very end.
  assert.equal(at(ARCH.indexOf('group') + 2).code, expected(2));
  assert.equal(at(ARCH.indexOf('service b') + 3).code, expected(4));
  assert.equal(at(ARCH.length).code, expected(4));
  assert.equal(at(null).code, expected(4));
  // At the start of a line the new line goes after that line.
  assert.equal(at(ARCH.indexOf('  service a')).code, expected(3));
  // Cursor in the header line, at offset 0, negative or past the end.
  assert.equal(at(0).code, expected(1));
  assert.equal(at(5).code, expected(1));
  assert.equal(at(-10).code, expected(1));
  assert.equal(at(99999).code, expected(4));
  // Caret: the end of the inserted line.
  for (const c of [0, 30, 60, null, ARCH.length]) {
    const r = at(c);
    assert.equal(r.code.slice(0, r.cursor).split('\n').pop(), line);
    assert.ok(r.cursor === r.code.length || r.code[r.cursor] === '\n');
  }
});

test('insertIcon: never above a header that follows front matter, directives or comments', () => {
  const text = '---\ntitle: T\n---\n%%{init: {"theme": "dark"}}%%\n%% note\ngraph TD\n  A-->B';
  const r = insertIcon(text, 2, 'gcp', RUN);
  assert.equal(r.code, '---\ntitle: T\n---\n%%{init: {"theme": "dark"}}%%\n%% note\ngraph TD\n  cloud_run@{ icon: "gcp:cloud-run", label: "Cloud Run" }\n  A-->B');
  assert.equal(insertIcon(text, 0, 'gcp', RUN).code, r.code);
});

test('insertIcon: newlines stay correct', () => {
  const line = '  service cloud_run(gcp:cloud-run)[Cloud Run]';
  // No trailing newline stays that way; a trailing newline stays too.
  assert.equal(insertIcon('architecture-beta', null, 'gcp', RUN).code, `architecture-beta\n${line}`);
  assert.equal(insertIcon('architecture-beta\n', null, 'gcp', RUN).code, `architecture-beta\n${line}\n`);
  assert.equal(insertIcon('architecture-beta\n', 17, 'gcp', RUN).code, `architecture-beta\n${line}\n`);
  assert.equal(insertIcon('architecture-beta\n', 18, 'gcp', RUN).code, `architecture-beta\n${line}\n`);
  assert.equal(insertIcon(`${ARCH}\n`, ARCH.length + 1, 'gcp', RUN).code, `${ARCH}\n${line}\n`);
  // Trailing blank lines: the new line follows the last real line, the blanks stay after it.
  assert.equal(insertIcon('architecture-beta\n  service a(cloud)[A]\n\n\n', null, 'gcp', RUN).code, `architecture-beta\n  service a(cloud)[A]\n${line}\n\n\n`);
  // A blank cursor line in the middle: the new line goes right after it.
  assert.equal(insertIcon('graph TD\n\n  A-->B', 9, 'gcp', RUN).code, 'graph TD\n\n  cloud_run@{ icon: "gcp:cloud-run", label: "Cloud Run" }\n  A-->B');
  // Inserting twice keeps one line per icon, no blank lines or joined lines.
  const once = insertIcon(ARCH, null, 'gcp', RUN);
  const twice = insertIcon(once.code, once.cursor, 'gcp', entry('pubsub', 'Pub/Sub'));
  assert.equal(twice.code, `${ARCH}\n${line}\n  service pubsub(gcp:pubsub)[Pub/Sub]`);
  assert.ok(!/\n\n/.test(twice.code));
});

test('insertIcon: an empty editor becomes an architecture diagram', () => {
  const line = '  service cloud_run(gcp:cloud-run)[Cloud Run]';
  for (const code of ['', '  \n\n']) {
    const r = insertIcon(code, 0, 'gcp', RUN);
    assert.equal(r.code, `architecture-beta\n${line}`);
    assert.equal(r.cursor, r.code.length);
  }
  assert.equal(insertIcon('%% note', null, 'gcp', RUN).code, `%% note\narchitecture-beta\n${line}`);
  assert.equal(insertIcon('%% note\n', 3, 'gcp', RUN).code, `%% note\narchitecture-beta\n${line}`);
  assert.equal(diagramKind(insertIcon('', null, 'gcp', RUN).code), 'architecture');
});

test('insertIcon: other diagram kinds take no icons', () => {
  for (const code of ['sequenceDiagram\n A->>B: x', 'classDiagram', 'gantt', '---\ntitle: x\n---\npie\n "a": 1', '---\nunclosed']) {
    assert.equal(insertIcon(code, null, 'gcp', RUN), null);
  }
});

test('insertIcon: node ids come from the icon name and stay unique', () => {
  const id = (code, icon, kind = 'architecture') => {
    const text = insertIcon(code, null, 'gcp', entry(icon, 'X')).code.split('\n').pop();
    return kind === 'architecture' ? /service (\S+?)\(/.exec(text)[1] : /^\s*(\S+?)@/.exec(text)[1];
  };
  assert.equal(id(ARCH, 'cloud-run'), 'cloud_run');
  assert.equal(id(ARCH, 'bigquery'), 'bigquery');
  assert.equal(id(ARCH, '3d-print'), 'n_3d_print');
  assert.equal(id('graph TD\n A-->B', 'cloud-run', 'flowchart'), 'cloud_run');
  // Collisions: _2, _3, ... and the comparison ignores case.
  assert.equal(id('architecture-beta\n  service cloud_run(cloud)[A]', 'cloud-run'), 'cloud_run_2');
  assert.equal(id('architecture-beta\n  service cloud_run(cloud)[A]\n  service cloud_run_2(cloud)[B]', 'cloud-run'), 'cloud_run_3');
  assert.equal(id('graph TD\n  Cloud_Run-->B', 'cloud-run', 'flowchart'), 'cloud_run_2');
  assert.equal(id('graph TD\n  cloud_run@{ icon: "gcp:cloud-run", label: "x" }', 'cloud-run', 'flowchart'), 'cloud_run_2');
  // Keywords are not ids.
  assert.equal(id('graph TD\n A-->B', 'end', 'flowchart'), 'end_node');
  assert.equal(id(ARCH, 'service'), 'service_node');
  assert.equal(id(ARCH, 'group'), 'group_node');
  // Adding the same icon repeatedly never repeats an id.
  let code = ARCH;
  for (let i = 0; i < 4; i++) code = insertIcon(code, null, 'gcp', RUN).code;
  assert.deepEqual(code.split('\n').slice(4).map((l) => /service (\S+?)\(/.exec(l)[1]), ['cloud_run', 'cloud_run_2', 'cloud_run_3', 'cloud_run_4']);
});

test('insertIcon: catalogs with awkward but legal names give exactly the expected lines', () => {
  const catalog = parseCatalog(pack([
    { icon: 'pubsub', name: 'Pub/Sub', group: 'Data Analytics' },
    { icon: 'gemini', name: 'Gemini (Code Assist, Enterprise, etc.)' },
    { icon: 'sole-tenant-nodes', name: 'Sole-tenant Nodes' },
  ]), 'demo');
  assert.equal(catalog.length, 3);
  const lines = (code) => catalog.map((e) => insertIcon(code, null, 'demo', e).code.split('\n').pop());
  assert.deepEqual(lines(ARCH), [
    '  service pubsub(demo:pubsub)[Pub/Sub]',
    '  service gemini(demo:gemini)[Gemini (Code Assist, Enterprise, etc.)]',
    '  service sole_tenant_nodes(demo:sole-tenant-nodes)[Sole-tenant Nodes]',
  ]);
  assert.deepEqual(lines('flowchart TD'), [
    '  pubsub@{ icon: "demo:pubsub", label: "Pub/Sub" }',
    '  gemini@{ icon: "demo:gemini", label: "Gemini (Code Assist, Enterprise, etc.)" }',
    '  sole_tenant_nodes@{ icon: "demo:sole-tenant-nodes", label: "Sole-tenant Nodes" }',
  ]);
  assert.equal(previewCode('demo', catalog[1]), 'architecture-beta\n  service preview(demo:gemini)[Gemini (Code Assist, Enterprise, etc.)]');
});

test('previewCode is a one-node architecture diagram', () => {
  assert.equal(previewCode('gcp', RUN), 'architecture-beta\n  service preview(gcp:cloud-run)[Cloud Run]');
  assert.equal(diagramKind(previewCode('gcp', RUN)), 'architecture');
});
