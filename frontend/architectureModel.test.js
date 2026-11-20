// Unit tests for the visual builder's model of architecture diagrams. Run with: npm test
// The module is TypeScript; Node 22 runs it directly (type stripping), so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArchitecture, diagramProblems, parentChoices, startArchitecture, addNode, updateNode, removeNode,
  addEdge, updateEdge, removeEdge, labelProblem, iconProblem, edgeStatement, BUILTIN_ICONS,
  nodeOutline, findEdge, directionOf, arrowsOf,
} from './src/utils/architectureModel.ts';

const lines = (...l) => l.join('\n');
const ok = (result) => {
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
  return result;
};
const refused = (result, code) => {
  assert.equal(result.ok, false, 'expected a refusal');
  assert.equal(result.error.code, code, result.error.message);
  assert.ok(result.error.message.length > 0);
  return result.error.message;
};

// The "Google Cloud Architecture" example of the editor (DiagramEditor.tsx), unchanged.
const GCP = `architecture-beta
  group gcp(cloud)[Google Cloud project]
  group vpc(gcp:vpc)[VPC] in gcp
  service lb(gcp:cloud-load-balancing)[Cloud Load Balancing] in gcp
  service run(gcp:cloud-run)[Cloud Run] in vpc
  service sql(gcp:cloud-sql)[Cloud SQL] in vpc
  service bq(gcp:bigquery)[BigQuery] in gcp
  service gcs(gcp:cloud-storage)[Cloud Storage] in gcp
  lb:R --> L:run
  run:R --> L:sql
  run:B --> T:bq
  bq:R --> L:gcs`;

const CORPUS = {
  gcp: GCP,
  nested: lines(
    'architecture-beta',
    '    group outer(cloud)[Outer]',
    '    group middle(server)[Middle] in outer',
    '    group inner[Inner] in middle',
    '    service api(server)[API] in inner',
    '    service db(database)[Database] in middle',
    '    junction hub in outer',
    '    junction j2',
    '    api:B -- T:hub',
    '    hub:R -- L:db',
    '    hub:L -- R:j2',
    '',
  ),
  edges: lines(
    'architecture-beta',
    '  service a(cloud)[A]',
    '  service b(cloud)[B]',
    '  service c(disk)[C]',
    '  service d(internet)[D]',
    '  a:R <-[HTTPS]-> L:b',
    '  a:B -[sync]- T:c',
    '  a:L <-- R:d',
    '  b:B>--<T:c',
    '  c : R --> L : d',
    '  d:T -["quoted [x]"]-> B:b',
  ),
  groupEdges: lines(
    'architecture-beta',
    '  group left(cloud)[Left]',
    '  group right(cloud)[Right]',
    '  service a(server)[A] in left',
    '  service b(server)[B] in right',
    '  service c(server)[C] in right',
    '  a{group}:R --> L:b{group}',
    '  a{group} :B -- T: c',
  ),
  comments: lines(
    '%% a diagram with comments',
    'architecture-beta',
    '',
    '  %% the edge of the system',
    '  service web(internet)[Web] %% public',
    '',
    '',
    '  service app(server)[App]   ',
    '  %%{init: {"theme": "dark"}}%%',
    '  web:R --> L:app %% traffic',
    '',
  ),
  frontMatter: lines(
    '---',
    'title: Front matter',
    'config:',
    '  theme: neutral',
    '---',
    '%%{init: {',
    '  "theme": "dark"',
    '}}%%',
    'architecture-beta',
    '  title Platform',
    '  accTitle: Accessible title',
    '  accDescr: One line',
    '  accDescr {',
    '    service fake(cloud)[Not a service]',
    '  }',
    '  service real(cloud)[Real]',
  ),
  windows: 'architecture-beta\r\n  group g(cloud)[G]\r\n  service a(server)[A] in g\r\n  service b(disk)[B]\r\n  a:R --> L:b\r\n',
  windowsNoFinal: 'architecture-beta\r\n  service a(server)[A]\r\n  service b(disk)[B]\r\n  a:R --> L:b',
  noFinalNewline: 'architecture-beta\n  service a(cloud)[A]',
  quoted: lines(
    'architecture-beta',
    '  service q1(cloud)["Quoted [label]"]',
    "  service q2(cloud)['Single']",
    '  service t1 "API"[With icon text]',
    '  service bare',
    '  service spaced (cloud) [ Spaced ]',
    '  group g2[No icon]',
    '  group g3',
    '  service hy-phen(cloud)[Hyphen id] in g3',
  ),
  unmanaged: lines(
    'architecture-beta',
    '  service a(cloud)[A]',
    '  service b(cloud)[B]',
    '  align row a b',
    '  service Bad(cloud)[Upper-case B is a side]',
    '  something the builder does not know',
  ),
  tabs: 'architecture-beta\n\tservice a(cloud)[A]\n\tservice b(cloud)[B]\n\ta:R --> L:b\n',
};

test('parse: the Google Cloud example', () => {
  const m = parseArchitecture(GCP);
  assert.equal(m.header, 0);
  assert.equal(m.items.length, GCP.split('\n').length);
  assert.deepEqual(m.items[1], { kind: 'group', line: 1, id: 'gcp', icon: 'cloud', label: 'Google Cloud project', parent: null });
  assert.deepEqual(m.items[2], { kind: 'group', line: 2, id: 'vpc', icon: 'gcp:vpc', label: 'VPC', parent: 'gcp' });
  assert.deepEqual(m.items[4], { kind: 'service', line: 4, id: 'run', icon: 'gcp:cloud-run', iconText: null, label: 'Cloud Run', parent: 'vpc' });
  assert.deepEqual(m.items[8], {
    kind: 'edge', line: 8, label: null,
    from: { id: 'lb', side: 'R', group: false, arrow: false },
    to: { id: 'run', side: 'L', group: false, arrow: true },
  });
  assert.deepEqual(m.unmanaged, []);
  assert.deepEqual(diagramProblems(m), []);
});

test('parse: every syntax form of the grammar', () => {
  const e = parseArchitecture(CORPUS.edges).items;
  const end = (id, side, arrow = false, group = false) => ({ id, side, group, arrow });
  assert.deepEqual([e[5].from, e[5].to, e[5].label], [end('a', 'R', true), end('b', 'L', true), 'HTTPS']);
  assert.deepEqual([e[6].from, e[6].to, e[6].label], [end('a', 'B'), end('c', 'T'), 'sync']);
  assert.deepEqual([e[7].from, e[7].to], [end('a', 'L', true), end('d', 'R')]);
  assert.deepEqual([e[8].from, e[8].to], [end('b', 'B', true), end('c', 'T', true)]);
  assert.deepEqual([e[9].from, e[9].to], [end('c', 'R'), end('d', 'L', true)]);
  assert.equal(e[10].label, 'quoted [x]');

  const g = parseArchitecture(CORPUS.groupEdges).items;
  assert.deepEqual([g[6].from, g[6].to], [end('a', 'R', false, true), end('b', 'L', true, true)]);
  assert.deepEqual([g[7].from, g[7].to], [end('a', 'B', false, true), end('c', 'T')]);

  const q = parseArchitecture(CORPUS.quoted).items;
  assert.equal(q[1].label, 'Quoted [label]');
  assert.equal(q[2].label, 'Single');
  assert.deepEqual([q[3].icon, q[3].iconText, q[3].label], [null, 'API', 'With icon text']);
  assert.deepEqual([q[4].kind, q[4].icon, q[4].label], ['service', null, null]);
  assert.deepEqual([q[5].icon, q[5].label], ['cloud', 'Spaced']);
  assert.deepEqual([q[6].kind, q[6].icon, q[6].label], ['group', null, 'No icon']);
  assert.deepEqual([q[7].kind, q[7].label], ['group', null]);
  assert.deepEqual([q[8].id, q[8].parent], ['hy-phen', 'g3']);

  const n = parseArchitecture(CORPUS.nested).items;
  assert.deepEqual(n.filter((i) => i.kind === 'junction').map((j) => [j.id, j.parent]), [['hub', 'outer'], ['j2', null]]);
});

test('parse: comments, blank lines, front matter, title and accessibility lines are other', () => {
  const c = parseArchitecture(CORPUS.comments);
  assert.deepEqual(c.items.map((i) => (i.kind === 'other' ? i.role : i.kind)),
    ['comment', 'header', 'blank', 'comment', 'service', 'blank', 'blank', 'service', 'directive', 'edge', 'blank']);
  assert.deepEqual(c.unmanaged, [8]);
  const f = parseArchitecture(CORPUS.frontMatter);
  assert.equal(f.header, 8);
  assert.deepEqual(f.items.map((i) => (i.kind === 'other' ? i.role : i.kind)), [
    'preamble', 'preamble', 'preamble', 'preamble', 'preamble', 'preamble', 'preamble', 'preamble', 'header',
    'title', 'accessibility', 'accessibility', 'accessibility', 'accessibility', 'accessibility', 'service',
  ]);
  // The service inside the accDescr block is text, not a service.
  assert.deepEqual(f.items.filter((i) => i.kind === 'service').map((s) => s.id), ['real']);
  assert.equal(f.unmanaged.length, 14);
});

test('parse: lines Mermaid does not read as statements are other (when in doubt, other)', () => {
  const other = [
    'service Rx(cloud)[x]', 'service Bad(cloud)[x]', 'service titlebar(cloud)[x]', 'service in(cloud)[x]', 'service group(cloud)[x]',
    'service a(cloud)[x];', 'service a ( cloud )[x]', 'service a(cloud)[]', 'service a(cloud)[x](cloud)', 'service a[x](cloud)',
    'service a(cloud)[x] in g in h', 'service a-(cloud)[x]', 'servicea(cloud)[x]', 'Service a(cloud)[x]', 'junction j(cloud)',
    'group g "text"[x]', 'a:X --> L:b', 'a:r --> L:b', 'a:R ---> L:b', 'a:R -[]- L:b', 'a:R --> L:b c', 'a.b:R --> L:c',
    'R:R --> L:b', 'service 3d(cloud)[x]', 'service ain g', 'service a(cloud)[x]in', 'title', 'align row a b',
  ];
  for (const line of other) {
    const m = parseArchitecture(`architecture-beta\n${line}`);
    assert.equal(m.items[1].kind, 'other', line);
  }
  assert.equal(parseArchitecture('architecture-beta\n  title My diagram').items[1].role, 'title');
});

test('parse: not an architecture diagram gives null', () => {
  for (const code of ['', '  \n', '%% only', 'graph TD\n A-->B', 'sequenceDiagram', '---\nunclosed', 'architecture']) {
    assert.equal(parseArchitecture(code), null, JSON.stringify(code));
  }
  assert.notEqual(parseArchitecture('ARCHITECTURE-BETA'), null);
});

test('round trip: parsing and no-op edits leave every corpus diagram identical', () => {
  for (const [name, code] of Object.entries(CORPUS)) {
    const m = parseArchitecture(code);
    assert.ok(m, name);
    assert.equal(m.lines.join('\n'), code, name);
    assert.equal(m.items.length, code.split('\n').length, name);
    m.items.forEach((item, i) => assert.equal(item.line, i, name));
    for (const item of m.items) {
      if (item.kind === 'edge') {
        assert.equal(ok(updateEdge(code, item.line, { from: item.from, to: item.to, label: item.label })).code, code, `${name}: edge ${item.line}`);
      } else if (item.kind !== 'other') {
        const same = { parent: item.parent, ...(item.kind === 'junction' ? {} : { icon: item.icon ?? undefined, label: item.label ?? undefined }) };
        assert.equal(ok(updateNode(code, item.id, same)).code, code, `${name}: ${item.id}`);
        assert.equal(ok(updateNode(code, item.id, {})).code, code, `${name}: ${item.id}`);
      }
    }
  }
});

test('startArchitecture', () => {
  assert.equal(startArchitecture(''), 'architecture-beta\n');
  assert.equal(startArchitecture('  \n'), 'architecture-beta\n');
  assert.equal(startArchitecture('%% notes'), '%% notes\narchitecture-beta\n');
  assert.equal(startArchitecture('%% notes\n'), '%% notes\narchitecture-beta\n');
});

test('addNode: exact lines and placement', () => {
  // Into an empty diagram: after the header, two spaces.
  let r = ok(addNode('architecture-beta\n', 'group', { label: 'Google Cloud project', icon: 'cloud' }));
  assert.equal(r.code, 'architecture-beta\n  group google_cloud_project(cloud)[Google Cloud project]\n');
  assert.deepEqual([r.id, r.line], ['google_cloud_project', 1]);
  assert.equal(ok(addNode('architecture-beta', 'service', { label: 'A' })).code, 'architecture-beta\n  service a[A]');
  // A comment or title after the header stays above the first node.
  assert.equal(ok(addNode('architecture-beta\n  title T\n\n', 'junction')).code, 'architecture-beta\n  title T\n  junction junction_1\n\n');

  const base = lines(
    'architecture-beta',
    '  group g(cloud)[G]',
    '  group h(cloud)[H]',
    '  service a(server)[A] in g',
    '  service b(server)[B]',
    '  a:R --> L:b',
  );
  // After the last node of the same kind in the same parent.
  assert.equal(ok(addNode(base, 'service', { label: 'C', icon: 'disk', parent: 'g' })).code,
    base.replace('[A] in g\n', '[A] in g\n  service c(disk)[C] in g\n'));
  assert.equal(ok(addNode(base, 'group', { label: 'I' })).code, base.replace('[H]\n', '[H]\n  group i[I]\n'));
  // No node of that kind in that parent: after the last node line (still before the edges).
  assert.equal(ok(addNode(base, 'service', { label: 'D', parent: 'h' })).code, base.replace('[B]\n', '[B]\n  service d[D] in h\n'));
  assert.equal(ok(addNode(base, 'group', { label: 'Sub', icon: 'gcp:vpc', parent: 'g' })).code, base.replace('[B]\n', '[B]\n  group sub(gcp:vpc)[Sub] in g\n'));
  const j = ok(addNode(base, 'junction', { parent: 'g' }));
  assert.equal(j.code, base.replace('[B]\n', '[B]\n  junction junction_1 in g\n'));
  assert.deepEqual([j.id, j.line], ['junction_1', 5]);
  assert.equal(ok(addNode(j.code, 'junction', { parent: 'g' })).code, j.code.replace('junction_1 in g\n', 'junction_1 in g\n  junction junction_2 in g\n'));
});

test('addNode: indentation, line endings and the final newline', () => {
  assert.equal(ok(addNode(CORPUS.tabs, 'service', { label: 'C' })).code, 'architecture-beta\n\tservice a(cloud)[A]\n\tservice b(cloud)[B]\n\tservice c[C]\n\ta:R --> L:b\n');
  // A deeper anchor line lends its indentation.
  assert.equal(ok(addNode('architecture-beta\n  group g\n      service a[A] in g', 'service', { label: 'B', parent: 'g' })).code,
    'architecture-beta\n  group g\n      service a[A] in g\n      service b[B] in g');
  // CRLF is kept, also when the new line becomes the last line.
  assert.equal(ok(addNode(CORPUS.windows, 'service', { label: 'C' })).code,
    'architecture-beta\r\n  group g(cloud)[G]\r\n  service a(server)[A] in g\r\n  service b(disk)[B]\r\n  service c[C]\r\n  a:R --> L:b\r\n');
  assert.equal(ok(addNode('architecture-beta\r\n  service a(cloud)[A]', 'service', { label: 'B' })).code, 'architecture-beta\r\n  service a(cloud)[A]\r\n  service b[B]');
  // Trailing blank lines stay after the new line.
  assert.equal(ok(addNode('architecture-beta\n  service a[A]\n\n\n', 'service', { label: 'B' })).code, 'architecture-beta\n  service a[A]\n  service b[B]\n\n\n');
});

test('addNode: ids from the label, unique, never a keyword', () => {
  const id = (code, label, kind = 'service') => ok(addNode(code, kind, { label })).id;
  const one = 'architecture-beta\n  service cloud_run(cloud)[Cloud Run]';
  assert.equal(id('architecture-beta', 'Cloud Run'), 'cloud_run');
  assert.equal(id(one, 'Cloud Run'), 'cloud_run_2');
  assert.equal(id(`${one}\n  service cloud_run_2[X]`, 'Cloud Run'), 'cloud_run_3');
  // Case-insensitive, and words anywhere in the text count (also in lines the builder does not manage).
  assert.equal(id('architecture-beta\n  service Cloud_Run[X]', 'Cloud Run'), 'cloud_run_2');
  assert.equal(id('architecture-beta\n  %% api\n  something api', 'API'), 'api_2');
  assert.equal(id('architecture-beta', 'Service'), 'service_node');
  assert.equal(id('architecture-beta', 'Group'), 'group_node');
  assert.equal(id('architecture-beta', 'In'), 'in_node');
  assert.equal(id('architecture-beta', 'Title bar'), 'n_title_bar');
  assert.equal(id('architecture-beta', '3D printer'), 'n_3d_printer');
  assert.equal(id('architecture-beta', 'Café / Bar'), 'cafe_bar');
  assert.equal(id('architecture-beta', 'BigQuery'), 'bigquery');
  assert.equal(id('architecture-beta', 'Rails'), 'rails');
  assert.equal(id('architecture-beta', '///'), 'node');
  assert.equal(id('architecture-beta', '///', 'group'), 'grp');
  assert.equal(id('architecture-beta', 'A very long product name that goes on and on and on'), 'a_very_long_product_name_that_goes_on_an');
  // Adding the same label again and again never repeats an id.
  let code = 'architecture-beta';
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const r = ok(addNode(code, 'service', { label: 'Pub/Sub' }));
    ids.push(r.id);
    code = r.code;
  }
  assert.deepEqual(ids, ['pub_sub', 'pub_sub_2', 'pub_sub_3', 'pub_sub_4']);
  // The generated ids parse as ids.
  assert.equal(parseArchitecture(code).items.filter((i) => i.kind === 'service').length, 4);
});

test('addNode: refuses bad labels, icons and groups', () => {
  const code = 'architecture-beta\n  service a[A]';
  for (const label of ['', '   ', 'a[b', 'a]b', 'two\nlines', 'cr\rhere', 'a %% b']) refused(addNode(code, 'service', { label }), 'label');
  for (const icon of ['Cloud', 'unknown', 'gcp:', ':x', 'a:b:c', 'gcp:cloud run', '(x)', 'x]']) refused(addNode(code, 'service', { label: 'X', icon }), 'icon');
  refused(addNode(code, 'service', { label: 'X', parent: 'nope' }), 'parent');
  refused(addNode(code, 'service', { label: 'X', parent: 'a' }), 'parent');
  refused(addNode('graph TD', 'service', { label: 'X' }), 'not-architecture');
  // Everything else is written as is.
  for (const label of ['Pub/Sub', 'Gemini (Code Assist, Enterprise, etc.)', 'a{b}c', '<b>x</b>', "it's", 'a "quote"', 'x;y#z']) {
    assert.ok(ok(addNode(code, 'service', { label })).code.endsWith(`[${label}]`), label);
  }
  for (const icon of BUILTIN_ICONS) assert.equal(iconProblem(icon), null);
  assert.equal(iconProblem('gcp:cloud-run'), null);
  assert.equal(iconProblem('my_pack:Some_Icon-2'), null);
  assert.equal(labelProblem('', true), null);
  assert.match(labelProblem('a]'), /\[ or \]/);
});

test('updateNode: label, icon and group change only their part of the line', () => {
  const code = lines(
    'architecture-beta',
    '  group g(cloud)[G]',
    '    service a(server)["Quoted"] in g %% keep me',
    '  service b[B]',
  );
  const set = (id, spec) => ok(updateNode(code, id, spec)).code.split('\n');
  assert.equal(set('a', { label: 'API' })[2], '    service a(server)[API] in g %% keep me');
  assert.equal(set('a', { label: 'Quoted' })[2], '    service a(server)["Quoted"] in g %% keep me');
  assert.equal(set('a', { icon: 'gcp:cloud-run' })[2], '    service a(gcp:cloud-run)["Quoted"] in g %% keep me');
  assert.equal(set('a', { icon: null })[2], '    service a["Quoted"] in g %% keep me');
  assert.equal(set('a', { parent: null })[2], '    service a(server)["Quoted"] %% keep me');
  assert.equal(set('b', { parent: 'g', icon: 'disk', label: 'Bee' })[3], '  service b(disk)[Bee] in g');
  assert.equal(set('g', { label: 'Group', icon: null })[1], '  group g[Group]');
  // A service with icon text gets an icon instead; unchanged otherwise.
  const text = 'architecture-beta\n  service t "API"[T]';
  assert.equal(ok(updateNode(text, 't', { label: 'T2' })).code, 'architecture-beta\n  service t "API"[T2]');
  assert.equal(ok(updateNode(text, 't', { icon: 'server' })).code, 'architecture-beta\n  service t (server)[T]');
  // CRLF lines keep their ending.
  assert.equal(ok(updateNode(CORPUS.windows, 'b', { label: 'Bee' })).code, CORPUS.windows.replace('[B]', '[Bee]'));
  refused(updateNode(code, 'nope', { label: 'x' }), 'not-found');
  refused(updateNode(code, 'a', { label: '' }), 'label');
  refused(updateNode(code, 'a', { parent: 'b' }), 'parent');
});

test('updateNode: moving groups refuses cycles and keeps parents above children', () => {
  const code = lines(
    'architecture-beta',
    '  group a[A]',
    '  group b[B] in a',
    '  group c[C] in b',
    '  service s[S] in c',
    '  group d[D]',
  );
  assert.match(refused(updateNode(code, 'a', { parent: 'a' }), 'cycle'), /itself/);
  assert.match(refused(updateNode(code, 'a', { parent: 'b' }), 'cycle'), /b is inside a/);
  refused(updateNode(code, 'a', { parent: 'c' }), 'cycle');
  refused(updateNode(code, 'b', { parent: 'c' }), 'cycle');
  assert.deepEqual(parentChoices(parseArchitecture(code), 'a').map((g) => g.id), ['d']);
  assert.deepEqual(parentChoices(parseArchitecture(code), 'c').map((g) => g.id), ['a', 'b', 'd']);
  assert.deepEqual(parentChoices(parseArchitecture(code), null).map((g) => g.id), ['a', 'b', 'c', 'd']);
  // A group moved into a group defined below it moves down, with its own groups above that line.
  assert.equal(ok(updateNode(code, 'a', { parent: 'd' })).code, lines(
    'architecture-beta',
    '  service s[S] in c',
    '  group d[D]',
    '  group a[A] in d',
    '  group b[B] in a',
    '  group c[C] in b',
  ));
  assert.equal(ok(updateNode(code, 'c', { parent: 'd' })).code, lines(
    'architecture-beta', '  group a[A]', '  group b[B] in a', '  service s[S] in c', '  group d[D]', '  group c[C] in d',
  ));
  // Into a group above: only the group's own line changes. A service never moves.
  assert.equal(ok(updateNode(code, 'c', { parent: 'a' })).code, code.replace('[C] in b', '[C] in a'));
  assert.equal(ok(updateNode(code, 's', { parent: 'd' })).code, code.replace('[S] in c', '[S] in d'));
  // A grandchild below the new parent stays where it is.
  const later = lines('architecture-beta', '  group a[A]', '  group d[D]', '  group b[B] in a');
  assert.equal(ok(updateNode(later, 'a', { parent: 'd' })).code, lines('architecture-beta', '  group d[D]', '  group a[A] in d', '  group b[B] in a'));
  for (const text of [ok(updateNode(code, 'a', { parent: 'd' })).code, ok(updateNode(later, 'a', { parent: 'd' })).code]) {
    assert.deepEqual(diagramProblems(parseArchitecture(text)), []);
  }
  // CRLF and no final newline survive a move to the end.
  assert.equal(ok(updateNode('architecture-beta\r\n  group a[A]\r\n  group d[D]', 'a', { parent: 'd' })).code, 'architecture-beta\r\n  group d[D]\r\n  group a[A] in d');
});

test('updateNode: refuses a move that breaks a {group} edge', () => {
  const message = refused(updateNode(CORPUS.groupEdges, 'b', { parent: 'left' }), 'invalid');
  assert.match(message, /same group/);
});

test('removeNode: removes the edges that touch it', () => {
  assert.equal(ok(removeNode(GCP, 'run')).code, lines(
    'architecture-beta',
    '  group gcp(cloud)[Google Cloud project]',
    '  group vpc(gcp:vpc)[VPC] in gcp',
    '  service lb(gcp:cloud-load-balancing)[Cloud Load Balancing] in gcp',
    '  service sql(gcp:cloud-sql)[Cloud SQL] in vpc',
    '  service bq(gcp:bigquery)[BigQuery] in gcp',
    '  service gcs(gcp:cloud-storage)[Cloud Storage] in gcp',
    '  bq:R --> L:gcs',
  ));
  // The last line goes: no stray CR, no final newline added.
  assert.equal(ok(removeNode(CORPUS.windowsNoFinal, 'b')).code, 'architecture-beta\r\n  service a(server)[A]');
  assert.equal(ok(removeNode(CORPUS.windows, 'b')).code, 'architecture-beta\r\n  group g(cloud)[G]\r\n  service a(server)[A] in g\r\n');
  refused(removeNode(GCP, 'nope'), 'not-found');
});

test('removeNode: a removed group hands its nodes to its parent', () => {
  assert.equal(ok(removeNode(GCP, 'vpc')).code, GCP
    .replace('  group vpc(gcp:vpc)[VPC] in gcp\n', '')
    .replace('[Cloud Run] in vpc', '[Cloud Run] in gcp')
    .replace('[Cloud SQL] in vpc', '[Cloud SQL] in gcp'));
  assert.equal(ok(removeNode(GCP, 'gcp')).code, lines(
    'architecture-beta',
    '  group vpc(gcp:vpc)[VPC]',
    '  service lb(gcp:cloud-load-balancing)[Cloud Load Balancing]',
    '  service run(gcp:cloud-run)[Cloud Run] in vpc',
    '  service sql(gcp:cloud-sql)[Cloud SQL] in vpc',
    '  service bq(gcp:bigquery)[BigQuery]',
    '  service gcs(gcp:cloud-storage)[Cloud Storage]',
    '  lb:R --> L:run',
    '  run:R --> L:sql',
    '  run:B --> T:bq',
    '  bq:R --> L:gcs',
  ));
  const nested = ok(removeNode(CORPUS.nested, 'middle')).code;
  assert.equal(nested, CORPUS.nested.replace('    group middle(server)[Middle] in outer\n', '').replace('[Inner] in middle', '[Inner] in outer').replace('[Database] in middle', '[Database] in outer'));
  assert.deepEqual(diagramProblems(parseArchitecture(nested)), []);
});

test('removeNode: an align line that names the node blocks it', () => {
  assert.match(refused(removeNode(CORPUS.unmanaged, 'a'), 'in-use'), /Line 4 \(align\)/);
});

test('addEdge / updateEdge / removeEdge: exact lines', () => {
  const base = 'architecture-beta\n  service a[A]\n  service b[B]\n  service c[C]\n';
  let r = ok(addEdge(base, { from: { id: 'a', side: 'R' }, to: { id: 'b', side: 'L', arrow: true } }));
  assert.equal(r.code, `${base}  a:R --> L:b\n`);
  assert.equal(r.line, 4);
  r = ok(addEdge(r.code, { from: { id: 'b', side: 'B', arrow: true }, to: { id: 'c', side: 'T', arrow: true }, label: ' HTTPS ' }));
  assert.equal(r.code, `${base}  a:R --> L:b\n  b:B <-[HTTPS]-> T:c\n`);
  // After the last edge, even with nodes after it.
  const mixed = 'architecture-beta\n  service a[A]\n  service b[B]\n  a:R -- L:b\n  service c[C]';
  assert.equal(ok(addEdge(mixed, { from: { id: 'c', side: 'T' }, to: { id: 'a', side: 'B' } })).code, 'architecture-beta\n  service a[A]\n  service b[B]\n  a:R -- L:b\n  c:T -- B:a\n  service c[C]');

  const two = r.code;
  assert.equal(ok(updateEdge(two, 5, { label: '' })).code, `${base}  a:R --> L:b\n  b:B <--> T:c\n`);
  assert.equal(ok(updateEdge(two, 4, { from: { side: 'T' }, to: { side: 'B', arrow: false } })).code, `${base}  a:T -- B:b\n  b:B <-[HTTPS]-> T:c\n`);
  assert.equal(ok(updateEdge(two, 4, { from: { id: 'c', side: 'L', arrow: true }, label: 'x' })).code, `${base}  c:L <-[x]-> L:b\n  b:B <-[HTTPS]-> T:c\n`);
  // Indentation, {group} and the comment of the line stay.
  assert.equal(ok(updateEdge('architecture-beta\n group g\n group h\n service a in g\n service b in h\n\ta{group}:R-->L:b %% c', 5, { label: 'L' })).code,
    'architecture-beta\n group g\n group h\n service a in g\n service b in h\n\ta{group}:R -[L]-> L:b %% c');
  assert.equal(ok(removeEdge(two, 4)).code, `${base}  b:B <-[HTTPS]-> T:c\n`);
  refused(removeEdge(two, 1), 'not-found');
  refused(updateEdge(two, 99, { label: 'x' }), 'not-found');
  assert.equal(edgeStatement({ from: { id: 'a', side: 'L', group: true, arrow: true }, to: { id: 'b', side: 'R', group: true, arrow: false }, label: null }), 'a{group}:L <-- R:b{group}');
});

test('addEdge: refuses what Mermaid cannot draw', () => {
  const code = 'architecture-beta\n  group g[G]\n  service a[A] in g\n  service b[B] in g';
  refused(addEdge(code, { from: { id: 'a', side: 'R' }, to: { id: 'a', side: 'L' } }), 'endpoint');
  refused(addEdge(code, { from: { id: 'g', side: 'R' }, to: { id: 'a', side: 'L' } }), 'endpoint');
  refused(addEdge(code, { from: { id: 'zz', side: 'R' }, to: { id: 'a', side: 'L' } }), 'endpoint');
  refused(addEdge(code, { from: { id: 'a', side: 'X' }, to: { id: 'b', side: 'L' } }), 'endpoint');
  refused(addEdge(code, { from: { id: 'a', side: 'R' }, to: { id: 'b', side: 'L' }, label: 'a]' }), 'label');
  assert.match(refused(addEdge(code, { from: { id: 'a', side: 'R', group: true }, to: { id: 'b', side: 'L' } }), 'invalid'), /same group/);
  // One connection per pair and direction (Mermaid's layout names an edge `from-to`).
  const one = ok(addEdge(code, { from: { id: 'a', side: 'R' }, to: { id: 'b', side: 'L' } })).code;
  assert.match(refused(addEdge(one, { from: { id: 'a', side: 'B' }, to: { id: 'b', side: 'T' } }), 'endpoint'), /already a connection/);
  ok(addEdge(one, { from: { id: 'b', side: 'B' }, to: { id: 'a', side: 'T' } }));
  ok(updateEdge(one, 4, { from: { id: 'a', side: 'T' } }));
  const two = ok(addEdge(one, { from: { id: 'b', side: 'B' }, to: { id: 'a', side: 'T' } })).code;
  refused(updateEdge(two, 5, { from: { id: 'a' }, to: { id: 'b' } }), 'endpoint');
  // An edge named like a hyphenated node id.
  const hyphen = 'architecture-beta\n  service a[A]\n  service b[B]\n  service a-b[AB]';
  assert.match(refused(addEdge(hyphen, { from: { id: 'a', side: 'R' }, to: { id: 'b', side: 'L' } }), 'invalid'), /same name/);
});

test('unmanaged lines stay in place through edits and are counted', () => {
  const code = CORPUS.unmanaged;
  const m = parseArchitecture(code);
  assert.deepEqual(m.unmanaged, [3, 4, 5]);
  let next = ok(addNode(code, 'service', { label: 'C' })).code;
  next = ok(updateNode(next, 'a', { label: 'Alpha' })).code;
  next = ok(addEdge(next, { from: { id: 'a', side: 'R' }, to: { id: 'c', side: 'L' } })).code;
  next = ok(removeNode(next, 'c')).code;
  assert.equal(next, code.replace('[A]', '[Alpha]'));
  // An existing problem (a node the builder cannot see) does not block unrelated edits.
  const broken = 'architecture-beta\n  service a[A]\n  a:R --> L:ghost';
  assert.equal(diagramProblems(parseArchitecture(broken)).length, 1);
  ok(addNode(broken, 'service', { label: 'B' }));
});

test('nodeOutline nests groups; findEdge follows a moved line; directions', () => {
  const outline = (code) => nodeOutline(parseArchitecture(code)).map(({ node, depth }) => `${depth}:${node.id}`);
  assert.deepEqual(outline(GCP), ['0:gcp', '1:vpc', '2:run', '2:sql', '1:lb', '1:bq', '1:gcs']);
  assert.deepEqual(outline(CORPUS.nested), ['0:outer', '1:middle', '2:inner', '3:api', '2:db', '1:hub', '0:j2']);
  // A missing group or a cycle does not hide nodes.
  assert.deepEqual(outline('architecture-beta\n  group a in b\n  group b in a\n  service s in nope\n  service t'), ['0:s', '0:t', '0:a', '1:b']);
  const m = parseArchitecture(GCP);
  assert.equal(findEdge(m, 8, m.lines[8]).line, 8);
  const shifted = parseArchitecture(ok(addNode(GCP, 'service', { label: 'New' })).code);
  assert.deepEqual([findEdge(shifted, 8, m.lines[8]).line, findEdge(shifted, 8, 'nope')], [9, undefined]);
  for (const d of ['none', 'forward', 'backward', 'both']) {
    const arrows = arrowsOf(d);
    assert.equal(directionOf({ from: { arrow: arrows.from }, to: { arrow: arrows.to } }), d);
  }
});

test('diagramProblems follows Mermaid: groups in order, services after all groups', () => {
  const problems = (code) => diagramProblems(parseArchitecture(code));
  assert.deepEqual(problems('architecture-beta\n  service a[A] in g\n  group g[G]'), []);
  assert.equal(problems('architecture-beta\n  group c[C] in p\n  group p[P]').length, 1);
  assert.equal(problems('architecture-beta\n  group a\n  service a').length, 1);
  assert.equal(problems('architecture-beta\n  service a\n  service b in a').length, 1);
  assert.equal(problems('architecture-beta\n  group g\n  service a\n  a:R -- L:g').length, 1);
});
