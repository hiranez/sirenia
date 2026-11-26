// Unit tests for the builder's quick add, connect by clicking and starter templates. Run with: npm test
// The modules are TypeScript; Node 22 runs them directly (type stripping), so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArchitecture, diagramProblems, updateNode, labelProblem, sidesBetween, connectNodes, nodes, edges, findNode,
} from './src/utils/architectureModel.ts';
import {
  BUILTIN_SOURCE, DEFAULT_ICON, groupFor, iconOf, quickAddService, replacesNothing, searchSources,
} from './src/utils/quickAdd.ts';
import { TEMPLATES, EMPTY_TEMPLATE_ID, availableTemplates, packIcons } from './src/utils/builderTemplates.ts';

const ok = (result) => {
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
  return result;
};
const refused = (result, code) => {
  assert.equal(result.ok, false, 'expected a refusal');
  if (code) assert.equal(result.error.code, code, result.error.message);
  return result.error.message;
};

/** Every line of `before` is in `after`, in order and byte for byte; only `added` lines are new. */
const onlyAdded = (before, after, added) => {
  const a = before.split('\n');
  const b = after.split('\n');
  assert.equal(b.length, a.length + added, `${added} line(s) added`);
  let j = 0;
  for (const line of b) if (j < a.length && line === a[j]) j++;
  assert.equal(j, a.length, 'every old line is kept, unchanged and in order');
};

// A made-up pack: names and icons in the shape of a catalog (no vendor content).
const PACK = {
  prefix: 'demo',
  label: 'Demo Cloud',
  entries: [
    { icon: 'object-store', name: 'Object Store', group: 'Storage' },
    { icon: 'run-service', name: 'Run Service', group: 'Compute' },
    { icon: 'cloud-run', name: 'Cloud Run', group: 'Compute' },
    { icon: 'cloud-sql', name: 'Cloud SQL', group: 'Databases' },
    { icon: 'sql-warehouse', name: 'SQL Warehouse', group: 'Databases' },
    { icon: 'mysql-store', name: 'MySQL Store', group: 'Databases' },
  ],
};
const SOURCES = [BUILTIN_SOURCE, PACK];

const BASE = `architecture-beta
  group vpc(cloud)[Virtual Private Cloud]
  service web(server)[Web] in vpc
  service db(database)[Database] in vpc
  junction hub
  %% a comment the builder keeps
  web:R --> L:db
`;

test('search: built-in icons and packs, ranked exact, starts with, word start, rest', () => {
  assert.deepEqual(searchSources(SOURCES, '', 8), { matches: [], total: 0 });
  assert.deepEqual(searchSources(SOURCES, 'cloud', 8).matches.map(iconOf), ['cloud', 'demo:cloud-run', 'demo:cloud-sql']);
  assert.deepEqual(searchSources(SOURCES, 'sql', 8).matches.map(iconOf), ['demo:sql-warehouse', 'demo:cloud-sql', 'demo:mysql-store']);
  assert.deepEqual(searchSources(SOURCES, 'run', 8).matches.map(iconOf), ['demo:run-service', 'demo:cloud-run']);
  // Every term has to match: name, icon name or group.
  assert.deepEqual(searchSources(SOURCES, 'compute cloud', 8).matches.map(iconOf), ['demo:cloud-run']);
  assert.deepEqual(searchSources(SOURCES, '  DATA  ', 8).matches.map(iconOf), ['database', 'demo:cloud-sql', 'demo:mysql-store', 'demo:sql-warehouse']);
  const limited = searchSources(SOURCES, 'o', 2);
  assert.equal(limited.matches.length, 2);
  assert.ok(limited.total > 2);
  const [match] = searchSources(SOURCES, 'object', 8).matches;
  assert.deepEqual({ source: match.source, name: match.entry.name, icon: iconOf(match) }, { source: 'Demo Cloud', name: 'Object Store', icon: 'demo:object-store' });
});

test('search: fast enough over 1,500 entries for every keystroke', () => {
  const big = { prefix: 'big', label: 'Big', entries: Array.from({ length: 1500 }, (_, i) => ({ icon: `icon-${i}`, name: `Product number ${i} service`, group: `Group ${i % 30}` })) };
  const start = performance.now();
  for (const q of ['p', 'pr', 'pro', 'prod', 'produ', 'product', 'product 1', 'product 14', 'product 149', 'x']) searchSources([BUILTIN_SOURCE, big], q, 8);
  const each = (performance.now() - start) / 10;
  assert.ok(each < 20, `one search took ${each.toFixed(2)} ms`);
});

test('quick add: id from the name, unique, readable; one new line', () => {
  let code = BASE;
  const ids = [];
  for (const name of ['Cloud Run', 'Cloud Run', 'Pub/Sub', 'Web', 'Service']) {
    const before = code;
    const r = ok(quickAddService(code, name, 'demo:cloud-run', null));
    onlyAdded(before, r.code, 1);
    ids.push(r.id);
    code = r.code;
  }
  assert.deepEqual(ids, ['cloud_run', 'cloud_run_2', 'pub_sub', 'web_2', 'service_node']);
  assert.match(code, /^ {2}service cloud_run\(demo:cloud-run\)\[Cloud Run\]$/m);
  assert.deepEqual(diagramProblems(parseArchitecture(code)), []);
});

test('quick add: placed in the selected group, or the group of the selected node', () => {
  const model = parseArchitecture(BASE);
  assert.equal(groupFor(model, 'vpc'), 'vpc');
  assert.equal(groupFor(model, 'web'), 'vpc');
  assert.equal(groupFor(model, 'hub'), null);
  assert.equal(groupFor(model, null), null);
  assert.equal(groupFor(model, 'gone'), null);
  const r = ok(quickAddService(BASE, 'Cache', 'disk', groupFor(model, 'web')));
  assert.equal(findNode(parseArchitecture(r.code), r.id).parent, 'vpc');
  // Right after the last service of that group.
  assert.equal(r.code.split('\n')[4], '  service cache(disk)[Cache] in vpc');
});

test('quick add: an empty editor becomes an architecture diagram in the same edit', () => {
  assert.equal(ok(quickAddService('', 'Users', 'internet', null)).code, 'architecture-beta\n  service users(internet)[Users]\n');
  assert.equal(ok(quickAddService('%% notes\n', 'Users', DEFAULT_ICON, null)).code, '%% notes\narchitecture-beta\n  service users(server)[Users]\n');
  refused(quickAddService('graph TD\n  A-->B', 'Users', 'server', null), 'not-architecture');
});

test('labels: no Mermaid syntax gets through, and what is written reads back the same', () => {
  const bad = ['a]b', 'x] in vpc', '[x', 'two\nlines', 'cr\rhere', 'tab\u2028sep', 'a %% b', '%%{init: {}}%%', '"quoted"', "'quoted'", '"'];
  for (const label of bad) {
    assert.ok(labelProblem(label), JSON.stringify(label));
    refused(quickAddService(BASE, label, 'server', null), 'label');
  }
  const good = ['Load balancer (internal)', 'a)b', '(x', 'it\'s "fine"', 'say "hi" now', 'a "b', 'x -->  y', 'a{group}b', '<b>x</b>', 'Pub/Sub', 'C:\\temp', 'service x in y'];
  for (const label of good) {
    const r = ok(quickAddService(BASE, label, 'server', 'vpc'));
    const node = findNode(parseArchitecture(r.code), r.id);
    assert.equal(node.label, label, `${label} reads back`);
    assert.equal(node.parent, 'vpc', `${label} keeps its group`);
    assert.equal(nodes(parseArchitecture(r.code)).length, nodes(parseArchitecture(BASE)).length + 1, `${label}: exactly one new node`);
    assert.equal(parseArchitecture(r.code).unmanaged.length, 0, `${label}: nothing unreadable`);
  }
});

test('sides: the short way between two boxes', () => {
  const box = (x, y) => ({ x, y, width: 80, height: 100 });
  const a = box(0, 0);
  assert.deepEqual(sidesBetween(a, box(200, 0)), { from: 'R', to: 'L' });
  assert.deepEqual(sidesBetween(a, box(0, 200)), { from: 'B', to: 'T' });
  assert.deepEqual(sidesBetween(a, box(-200, 0)), { from: 'L', to: 'R' });
  assert.deepEqual(sidesBetween(a, box(0, -200)), { from: 'T', to: 'B' });
  // Diagonal: the axis on which they are further apart; a tie goes sideways.
  assert.deepEqual(sidesBetween(a, box(300, 120)), { from: 'R', to: 'L' });
  assert.deepEqual(sidesBetween(a, box(40, 260)), { from: 'B', to: 'T' });
  assert.deepEqual(sidesBetween(a, box(100, 100)), { from: 'R', to: 'L' });
  // Boxes of different sizes compare by their centres.
  assert.deepEqual(sidesBetween({ x: 0, y: 0, width: 400, height: 40 }, { x: 150, y: 80, width: 80, height: 80 }), { from: 'B', to: 'T' });
});

test('connect: one new edge line with an arrow at the target; self and duplicates refused', () => {
  const r = ok(connectNodes(BASE, 'db', 'hub', { from: 'B', to: 'T' }));
  onlyAdded(BASE, r.code, 1);
  assert.equal(r.code.split('\n')[r.line], '  db:B --> T:hub');
  const edge = edges(parseArchitecture(r.code)).find((e) => e.line === r.line);
  assert.deepEqual([edge.from.arrow, edge.to.arrow], [false, true]);

  assert.match(refused(connectNodes(BASE, 'web', 'web', { from: 'R', to: 'L' }), 'endpoint'), /itself/);
  assert.match(refused(connectNodes(BASE, 'web', 'db', { from: 'B', to: 'T' }), 'endpoint'), /already connected/);
  assert.match(refused(connectNodes(BASE, 'db', 'web', { from: 'L', to: 'R' }), 'endpoint'), /already connected/);
  assert.match(refused(connectNodes(BASE, 'web', 'vpc', { from: 'R', to: 'L' }), 'endpoint'), /not groups/);
  refused(connectNodes(BASE, 'web', 'gone', { from: 'R', to: 'L' }), 'not-found');
  refused(connectNodes('graph TD', 'a', 'b', { from: 'R', to: 'L' }), 'not-architecture');
  // A refusal changes nothing; the second connection after a first one is still one line.
  const twice = ok(connectNodes(r.code, 'web', 'hub', { from: 'L', to: 'R' }));
  onlyAdded(r.code, twice.code, 1);
});

test('templates: each parses, has no problem, round-trips unchanged, and uses valid labels', () => {
  assert.equal(TEMPLATES[0].id, EMPTY_TEMPLATE_ID);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) {
    const model = parseArchitecture(t.code);
    assert.ok(model, `${t.id} is an architecture diagram`);
    assert.deepEqual(diagramProblems(model), [], t.id);
    assert.deepEqual(model.unmanaged, [], `${t.id}: every line is managed`);
    assert.equal(model.lines.join('\n'), t.code);
    for (const n of nodes(model)) {
      assert.equal(ok(updateNode(t.code, n.id, { label: n.label ?? undefined, icon: n.icon, parent: n.parent })).code, t.code, `${t.id}/${n.id} no-op edit`);
      if (n.label) assert.equal(labelProblem(n.label), null, n.label);
      if (n.icon && n.icon.includes(':')) assert.equal(n.icon.split(':')[0], t.pack, `${t.id} uses only its own pack`);
    }
    assert.ok(t.title.length > 0 && t.description.length > 0 && !t.description.includes('\n'), `${t.id} has a title and one line`);
    if (t.id !== EMPTY_TEMPLATE_ID) {
      assert.ok(nodes(model).length >= 4 && edges(model).length >= 3, `${t.id} is a small real architecture`);
      // Every service is connected.
      const joined = new Set(edges(model).flatMap((e) => [e.from.id, e.to.id]));
      for (const n of nodes(model).filter((x) => x.kind === 'service')) assert.ok(joined.has(n.id), `${t.id}/${n.id} is connected`);
    }
  }
  assert.deepEqual(TEMPLATES.filter((t) => t.pack).map((t) => t.pack).sort(), ['aws', 'azure', 'gcp']);
});

test('templates: a pack starter is offered only when every icon it names is installed', () => {
  const builtIn = availableTemplates({}).map((t) => t.id);
  assert.deepEqual(builtIn, ['empty', 'web']);
  const gcp = TEMPLATES.find((t) => t.pack === 'gcp');
  const icons = packIcons(gcp);
  assert.ok(icons.length >= 4 && icons.every((i) => /^[a-z0-9-]+$/.test(i)));
  assert.deepEqual(availableTemplates({ gcp: new Set(icons) }).map((t) => t.id), ['empty', 'web', 'gcp']);
  assert.deepEqual(availableTemplates({ gcp: new Set(icons.slice(1)) }).map((t) => t.id), ['empty', 'web']);
  assert.deepEqual(packIcons(TEMPLATES[1]), []);
});

test('replacing the text: nothing to lose only when it is blank or a bare header', () => {
  for (const code of ['', '  \n', 'architecture-beta', 'architecture-beta\n\n']) assert.equal(replacesNothing(code), true, JSON.stringify(code));
  for (const code of ['graph TD', '%% note', 'architecture-beta\n  service a[A]', 'architecture-beta\n%% keep me']) assert.equal(replacesNothing(code), false, JSON.stringify(code));
});

// ---- flowcharts ----------------------------------------------------------------------------------

test('flowchart quick add: an icon node for a pack match, a rectangle for plain text, into the selected subgraph', async () => {
  const { quickAddFlowNode, subgraphFor } = await import('./src/utils/quickAdd.ts');
  const F = await import('./src/utils/flowchartModel.ts');
  const base = 'flowchart LR\n  subgraph stage ["Stage"]\n    a["A"]\n  end\n  a --> b\n';
  const icon = ok(quickAddFlowNode(base, 'Run Service', 'demo:run-service', null));
  assert.equal(icon.code, `${base}  run_service@{ icon: "demo:run-service", label: "Run Service" }\n`);
  const plain = ok(quickAddFlowNode(base, 'Check the order', null, null));
  assert.equal(plain.code, `${base}  check_the_order["Check the order"]\n`);
  const m = F.parseFlowchart(base);
  assert.equal(subgraphFor(m, 'stage'), 'stage');
  assert.equal(subgraphFor(m, 'a'), 'stage');
  assert.equal(subgraphFor(m, 'b'), null);
  assert.equal(subgraphFor(m, null), null);
  const inside = ok(quickAddFlowNode(base, 'Next', null, subgraphFor(m, 'a')));
  assert.equal(inside.code, 'flowchart LR\n  subgraph stage ["Stage"]\n    a["A"]\n    next["Next"]\n  end\n  a --> b\n');
  assert.match(refused(quickAddFlowNode(base, 'Say "hi"', null, null), 'label'), /double quotes/);
});

test('flowchart starters: each parses with every line managed, round-trips, and has what its card says', async () => {
  const { FLOWCHART_TEMPLATES, EMPTY_FLOWCHART_ID } = await import('./src/utils/builderTemplates.ts');
  const F = await import('./src/utils/flowchartModel.ts');
  assert.deepEqual(FLOWCHART_TEMPLATES.map((t) => t.title), ['Empty flowchart', 'Decision flow', 'Process with stages']);
  assert.equal(FLOWCHART_TEMPLATES[0].id, EMPTY_FLOWCHART_ID);
  for (const t of FLOWCHART_TEMPLATES) {
    assert.equal(t.kind, 'flowchart');
    const m = F.parseFlowchart(t.code);
    assert.ok(m, t.id);
    assert.deepEqual(m.unmanaged, [], `${t.id}: every line is managed`);
    for (const n of m.nodes) {
      assert.equal(F.labelProblem(n.label ?? n.id), null, `${t.id}/${n.id}`);
      assert.equal(ok(F.updateNode(t.code, n.id, { label: n.label ?? n.id })).code, t.code, `${t.id}/${n.id} no-op edit`);
    }
  }
  const decision = F.parseFlowchart(FLOWCHART_TEMPLATES[1].code);
  assert.ok(decision.nodes.some((n) => n.shape === 'diamond'));
  assert.deepEqual(decision.edges.map((e) => e.label).filter(Boolean).sort(), ['No', 'Yes']);
  const stages = F.parseFlowchart(FLOWCHART_TEMPLATES[2].code);
  assert.deepEqual(stages.subgraphs.map((g) => g.title), ['Plan', 'Build', 'Release']);
  assert.ok(stages.nodes.every((n) => n.parent !== null), 'every step is in a stage');
});
