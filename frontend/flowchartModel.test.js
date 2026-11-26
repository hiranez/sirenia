// Unit tests for the visual builder's model of flowcharts. Run with: npm test
// The module is TypeScript; Node 22 runs it directly (type stripping), so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from './src/utils/flowchartModel.ts';

const lines = (...l) => l.join('\n');
const ok = (result) => {
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
  return result;
};
const refused = (result, code) => {
  assert.equal(result.ok, false, 'expected a refusal');
  if (code) assert.equal(result.error.code, code, result.error.message);
  assert.ok(result.error.message.length > 0);
  return result.error.message;
};

// corpus:start
// Flowcharts in the styles of Mermaid's documentation and of diagrams found in real repositories
// (written for these tests; no names or content from elsewhere).
export const CORPUS = {
  editorDefault: 'graph TD;\n  A-->B;\n  A-->C;\n  B-->D;\n  C-->D;',
  editorExample: 'graph TD;\n  A[Start] --> B[Process];\n  B --> C{Decision};\n  C -->|Yes| D[End];\n  C -->|No| B;',
  single: 'flowchart LR\n    id',
  text: 'flowchart LR\n    id1[This is the text in the box]',
  unicode: 'flowchart LR\n    id["This ❤ Unicode"] --> z["日本語のラベル"]\n    z --> e["Emoji 🚀 here"]',
  markdown: 'flowchart LR\n    markdown["`This **is** _Markdown_`"]\n    newLines["`Line1\nLine 2\nLine 3`"]\n    markdown --> newLines',
  topDown: 'flowchart TD\n    Start --> Stop',
  shapes: lines(
    'flowchart TB',
    '    r[Rectangle]',
    '    ro(Rounded)',
    '    st([Stadium])',
    '    su[[Subroutine]]',
    '    cy[(Database)]',
    '    ci((Circle))',
    '    dc(((Double)))',
    '    di{Diamond}',
    '    hx{{Hexagon}}',
    '    lr[/Lean right/]',
    '    ll[\\Lean left\\]',
    '    tz[/Trapezoid\\]',
    '    it[\\Inverted/]',
    '    fl>Flag]',
    '    el(-Ellipse-)',
    '    r --> ro --> st --> su',
  ),
  links: lines(
    'flowchart LR',
    '    A-->B',
    '    A --- C',
    '    A-- This is the text! ---D',
    '    A---|This is the text|E',
    '    A-->|text|F',
    '    A-- text -->G',
    '    A-.->H;',
    '    A-. text .-> I',
    '    A ==> J',
    '    A == text ==> K',
    '    A ~~~ L',
  ),
  chaining: lines(
    'flowchart LR',
    '   A -- text --> B -- text2 --> C',
    '   a --> b & c--> d',
    '   P & Q--> R & S',
  ),
  edgeIds: 'flowchart LR\n  A e1@--> B\n  e1@{ animate: true }\n  B --> C',
  arrows: lines(
    'flowchart LR',
    '    A --o B',
    '    B --x C',
    '    A o--o B2',
    '    B2 <--> C2',
    '    C2 x--x D',
  ),
  lengths: lines(
    'flowchart TD',
    '    A[Start] --> B{Is it?}',
    '    B -->|Yes| C[OK]',
    '    C --> D[Rethink]',
    '    D --> B',
    '    B ---->|No| E[End]',
  ),
  specialChars: lines(
    'flowchart LR',
    '    id1["This is the (text) in the box"]',
    '    A["A double quote:#quot;"] --> B["A dec char:#9829;"]',
  ),
  subgraphs: lines(
    'flowchart TB',
    '    c1-->a2',
    '    subgraph one',
    '    a1-->a2',
    '    end',
    '    subgraph two',
    '    b1-->b2',
    '    end',
    '    subgraph three',
    '    c1-->c2',
    '    end',
  ),
  subgraphEdges: lines(
    'flowchart TB',
    '    c1-->a2',
    '    subgraph one',
    '    a1-->a2',
    '    end',
    '    subgraph two',
    '    b1-->b2',
    '    end',
    '    subgraph three',
    '    c1-->c2',
    '    end',
    '    one --> two',
    '    three --> two',
    '    two --> c2',
  ),
  subgraphId: 'flowchart TB\n    c1-->a2\n    subgraph ide1 [one]\n    a1-->a2\n    end',
  subgraphDirection: lines(
    'flowchart LR',
    '  subgraph TOP',
    '    direction TB',
    '    subgraph B1',
    '        direction RL',
    '        i1 -->f1',
    '    end',
    '    subgraph B2',
    '        direction BT',
    '        i2 -->f2',
    '    end',
    '  end',
    '  A --> TOP --> B',
    '  B1 --> B2',
  ),
  interaction: lines(
    'flowchart LR',
    '    A-->B',
    '    B-->C',
    '    C-->D',
    '    click A callback "Tooltip for a callback"',
    '    click B "https://example.com" "This is a tooltip for a link"',
    '    click C call callback() "Tooltip for a callback"',
    '    click D href "https://example.com" "This is a tooltip for a link"',
  ),
  comments: lines(
    'flowchart LR',
    '%% this is a comment A -- text --> B{node}',
    '   A -- text --> B -- text2 --> C',
  ),
  styling: lines(
    'flowchart LR',
    '    id1(Start)-->id2(Stop)',
    '    style id1 fill:#f9f,stroke:#333,stroke-width:4px',
    '    style id2 fill:#bbf,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5',
  ),
  classes: lines(
    'flowchart LR',
    '    A:::someclass --> B',
    '    classDef someclass fill:#f96',
    '    classDef default fill:#f9f,stroke:#333,stroke-width:4px;',
    '    class B,C otherclass',
    '    C --> D',
  ),
  linkStyle: lines(
    'flowchart LR',
    '    A --> B',
    '    B --> C',
    '    C --> D',
    '    linkStyle 1 stroke:#ff3,stroke-width:4px,color:red;',
  ),
  icons: lines(
    'flowchart TD',
    '    user@{ icon: "fa:user", form: "square", label: "User Icon", pos: "t", h: 60 }',
    '    run@{ icon: "demo:run-service", label: "Run Service" }',
    '    user --> run',
  ),
  newShapes: 'flowchart RL\n    A@{ shape: rect }\n    B@{ shape: diam, label: "Decision" }\n    A --> B',
  frontMatter: lines(
    '---',
    'title: Order flow',
    'config:',
    '  theme: neutral',
    '---',
    'flowchart LR',
    '  cart[Cart] --> pay{Pay?}',
    '  pay -->|ok| done([Done])',
  ),
  initDirective: lines(
    '%%{init: {"flowchart": {"curve": "basis"}}}%%',
    'graph LR',
    '  a --> b',
    '  %%{init: {"theme": "dark"}}%%',
    '  b --> c',
  ),
  oneLine: 'graph TD; A-->B; B-->C; C-->A;',
  crlf: 'flowchart TD\r\n  A[Start] --> B{Ok?}\r\n  B -->|Yes| C\r\n  B -->|No| A\r\n',
  crlfNoFinal: 'flowchart TD\r\n  A --> B\r\n  B --> C',
  tabs: 'flowchart LR\n\tA --> B\n\tsubgraph S [Stage]\n\t\tC --> D\n\tend\n\tB --> C\n',
  noFinalNewline: 'flowchart LR\n  A --> B',
  accessibility: lines(
    'flowchart LR',
    '  accTitle: Checkout flow',
    '  accDescr {',
    '    A --> Z is text here, not an edge',
    '  }',
    '  A --> B',
  ),
  orderProcess: lines(
    'flowchart TD',
    '  subgraph intake [Intake]',
    '    order([Order received]) --> check{In stock?}',
    '  end',
    '  subgraph fulfil [Fulfilment]',
    '    pick[Pick items] --> pack[Pack] --> ship[/Ship/]',
    '  end',
    '  check -->|Yes| pick',
    '  check -->|No| back[Backorder]',
    '  back -.-> check',
    '  classDef warn fill:#fdd',
    '  class back warn',
  ),
  pipeline: lines(
    'flowchart LR',
    '  commit --> build --> test{Tests pass?}',
    '  test -->|yes| deploy[(Release)]',
    '  test -->|no| fix --> commit',
  ),
  loginIcons: lines(
    'flowchart TD',
    '  user((User)) --> web@{ icon: "demo:web-app", label: "Web app" }',
    '  web --> auth{Signed in?}',
    '  auth -- No --> login[Sign in page]',
    '  auth -- Yes --> home[Home]',
  ),
  nested: lines(
    'flowchart TB',
    '  subgraph outer [Outer]',
    '    subgraph middle [Middle]',
    '      subgraph inner [Inner]',
    '        x1 --> x2',
    '      end',
    '      m1',
    '    end',
    '    o1 --> m1',
    '  end',
    '  start --> x1',
  ),
  hyphenIds: 'flowchart LR\n  api-gw[API gateway] --> auth-svc(Auth) --> user-db[(Users)]',
  numericIds: 'graph LR\n  1 --> 2 --> 3\n  3 --> 1',
  fanout: 'flowchart TD\n  start --> a & b & c\n  a & b & c --> finish\n  finish --> done',
  invisible: 'flowchart LR\n  A ~~~ B\n  B --> C\n  A --> C',
  mixedQuotes: 'flowchart LR\n  A["Quoted (x) [y]"] --> B(it\'s plain)\n  B --> C{"a | b"}',
  noDirection: 'graph\n  A --> B',
  titleSubgraph: 'flowchart TB\n  subgraph Two words here\n    a --> b\n  end\n  subgraph single\n    c\n  end\n  b --> c',
  empty: 'flowchart TD\n',
  headerOnly: 'graph LR;',
  multiDefs: 'flowchart LR\n  A[First] --> B\n  A[Second] --> C',
  edgeToSubgraph: 'flowchart LR\n  subgraph s1 [Box]\n    in1 --> in2\n  end\n  out --> s1\n  s1 --> out2',
  unknownLines: lines(
    'flowchart LR',
    '  A -- text with ; semicolon --> B',
    '  A-->B %% trailing comment',
    '  C[Plain] --> D',
    '  E["direction LR inside"] --> F',
  ),
  classesInline: 'flowchart LR\n  A:::red & B:::blue --> C\n  classDef red fill:#f00\n  classDef blue fill:#00f',
  markdownEdge: 'flowchart LR\n  A -->|"`**bold**`"| B\n  B --> C',
  trapezoids: 'flowchart TB\n  a[/"In / out"/] --> b[\\"Manual"\\]\n  b --> c[/Plain\\]',
  elk: 'flowchart-elk TD\n  a --> b',
  keywordsNear: 'flowchart LR\n  endpoint --> subgraph1\n  class1 --> styles\n  end_x --> classy',
  sharedLine: 'flowchart LR\n  subgraph s [S]; a --> b; end\n  b --> c',
  bigDecision: lines(
    'flowchart TD',
    '    start([Start]) --> input[/Read input/]',
    '    input --> valid{Valid?}',
    '    valid -->|No| err[Show error] --> input',
    '    valid -->|Yes| proc[[Process]]',
    '    proc --> store[(Save)]',
    '    store --> notify>Notify]',
    '    notify --> stop([Stop])',
  ),
};
// corpus:end

// ---- helpers --------------------------------------------------------------------------------------

/** What a model says, independent of how it is written: the property tests compare these. */
function view(m) {
  const path = (key) => {
    const parts = [];
    for (let k = key; k; k = F.findSubgraph(m, k)?.parent ?? null) {
      const g = F.findSubgraph(m, k);
      if (!g) break;
      parts.unshift(g.title);
    }
    return parts.join('/');
  };
  return {
    nodes: Object.fromEntries(m.nodes.map((n) => [n.id, { label: n.label, shape: n.shape, icon: n.icon, parent: path(n.parent) }])),
    edges: m.edges.map((e) => JSON.stringify([e.from, e.to, e.stroke, e.startHead, e.endHead, e.label])).sort(),
    subgraphs: m.subgraphs.map((g) => path(g.key)).sort(),
    direction: m.direction,
  };
}

/** The statements and lines the builder does not manage, trimmed, in order. */
function kept(m) {
  const out = [];
  m.lineRoles.forEach((role, i) => {
    if (['comment', 'directive', 'preamble', 'unmanaged'].includes(role)) out.push(m.lines[i].replace(/\r$/, '').trim());
  });
  for (const st of m.statements) {
    if (st.kind === 'other' && m.lineRoles[st.line] !== 'unmanaged') out.push(F.stmtText(m, st));
  }
  return out;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const sigOf = (e) => JSON.stringify([e.from, e.to, e.stroke, e.startHead, e.endHead, e.label]);
const removeOne = (list, item) => {
  const k = list.indexOf(item);
  assert.ok(k !== -1, `${item} is in the list`);
  list.splice(k, 1);
};

/**
 * The edits tried on a diagram, each with what the new model has to look like (a function of the old
 * view and the new model), or null when only "parses and keeps the unmanaged lines" is checked.
 */
function editsFor(code) {
  const m = F.parseFlowchart(code);
  const edits = [];
  const add = (name, run, expect) => edits.push({ name, run, expect });
  const managed = m.subgraphs.filter((g) => g.managed);
  add('add node', () => F.addNode(code, { label: 'Added step' }), (v, after, r) => {
    v.nodes[r.id] = { label: 'Added step', shape: 'rect', icon: null, parent: '' };
    return v;
  });
  add('add icon node', () => F.addNode(code, { label: 'Run Service', icon: 'demo:run-service' }), (v, after, r) => {
    v.nodes[r.id] = { label: 'Run Service', shape: 'icon', icon: 'demo:run-service', parent: '' };
    return v;
  });
  add('add subgraph', () => F.addSubgraph(code, { title: 'New stage' }), (v) => {
    v.subgraphs = [...v.subgraphs, 'New stage'].sort();
    return v;
  });
  for (const d of ['LR', 'BT']) add(`direction ${d}`, () => F.setDirection(code, d), (v) => ({ ...v, direction: d }));
  for (const n of m.nodes) {
    add(`label ${n.id}`, () => F.updateNode(code, n.id, { label: `Renamed ${n.id}` }), (v) => {
      v.nodes[n.id].label = `Renamed ${n.id}`;
      return v;
    });
    add(`shape ${n.id}`, () => F.updateNode(code, n.id, { shape: 'diamond' }), (v) => {
      if (n.shape !== 'icon' && n.shape !== 'other') {
        v.nodes[n.id].shape = 'diamond';
        if (v.nodes[n.id].label === null) v.nodes[n.id].label = n.id;
      }
      return v;
    });
    add(`icon ${n.id}`, () => F.updateNode(code, n.id, { icon: 'demo:object-store' }), (v) => {
      Object.assign(v.nodes[n.id], { icon: 'demo:object-store', shape: 'icon', label: n.label || n.id });
      return v;
    });
    add(`delete ${n.id}`, () => F.removeNode(code, n.id), (v) => {
      delete v.nodes[n.id];
      for (const e of m.edges) if (e.from === n.id || e.to === n.id) removeOne(v.edges, sigOf(e));
      return v;
    });
    for (const target of [null, ...managed.map((g) => g.key)]) {
      add(`move ${n.id} to ${target}`, () => F.setNodeParent(code, n.id, target), (v) => {
        v.nodes[n.id].parent = target === null ? '' : view(m).subgraphs.find((p) => p.split('/').at(-1) === F.findSubgraph(m, target).title) ?? '?';
        return v;
      });
    }
  }
  if (m.nodes.length >= 2) {
    const [a, b] = [m.nodes.at(-1), m.nodes[0]];
    add('add edge', () => F.addEdge(code, { from: a.id, to: b.id, label: 'Back again', line: 'dotted' }), (v) => {
      v.edges = [...v.edges, JSON.stringify([a.id, b.id, 'dotted', '', '>', 'Back again'])].sort();
      return v;
    });
    add('connect', () => F.connectNodes(code, b.id, a.id), (v) => {
      v.edges = [...v.edges, JSON.stringify([b.id, a.id, 'normal', '', '>', null])].sort();
      return v;
    });
  }
  for (const e of m.edges) {
    add(`edge label ${e.key}`, () => F.updateEdge(code, e.key, { label: 'Maybe' }), (v) => {
      removeOne(v.edges, sigOf(e));
      v.edges = [...v.edges, sigOf({ ...e, label: 'Maybe' })].sort();
      return v;
    });
    add(`edge unlabel ${e.key}`, () => F.updateEdge(code, e.key, { label: '' }), (v) => {
      removeOne(v.edges, sigOf(e));
      v.edges = [...v.edges, sigOf({ ...e, label: null })].sort();
      return v;
    });
    add(`edge thick ${e.key}`, () => F.updateEdge(code, e.key, { line: 'thick' }), (v) => {
      removeOne(v.edges, sigOf(e));
      v.edges = [...v.edges, sigOf({ ...e, stroke: 'thick', startHead: '', endHead: '>' })].sort();
      return v;
    });
    add(`edge delete ${e.key}`, () => F.removeEdge(code, e.key), (v) => {
      removeOne(v.edges, sigOf(e));
      return v;
    });
  }
  for (const g of managed) {
    add(`rename ${g.key}`, () => F.updateSubgraph(code, g.key, { title: 'Renamed stage' }), null);
    add(`delete subgraph ${g.key}`, () => F.removeSubgraph(code, g.key), null);
    add(`subgraph to top ${g.key}`, () => F.updateSubgraph(code, g.key, { parent: null }), null);
    add(`node into ${g.key}`, () => F.addNode(code, { label: 'Inside it', parent: g.key }), (v, after, r) => {
      v.nodes[r.id] = { label: 'Inside it', shape: 'rect', icon: null, parent: view(after).nodes[r.id]?.parent };
      return v;
    });
  }
  return edits;
}

// ---- reading --------------------------------------------------------------------------------------

test('corpus: at least 40 flowcharts, and every one is read as a flowchart', () => {
  assert.ok(Object.keys(CORPUS).length >= 40, `${Object.keys(CORPUS).length} diagrams`);
  for (const [name, code] of Object.entries(CORPUS)) {
    const m = F.parseFlowchart(code);
    assert.ok(m, name);
    assert.equal(m.lines.join('\n'), code, `${name}: the lines give the code back`);
  }
});

test('parse: the editor default diagram has 4 nodes and 4 connections', () => {
  const m = F.parseFlowchart(CORPUS.editorDefault);
  assert.deepEqual(m.nodes.map((n) => n.id), ['A', 'B', 'C', 'D']);
  assert.deepEqual(m.edges.map((e) => `${e.from}>${e.to}`), ['A>B', 'A>C', 'B>D', 'C>D']);
  assert.deepEqual(m.edges.map((e) => e.domId), ['L_A_B_0', 'L_A_C_0', 'L_B_D_0', 'L_C_D_0']);
  assert.equal(m.direction, 'TD');
  assert.deepEqual(m.unmanaged, []);
});

test('parse: shapes, labels and the shapes left alone', () => {
  const m = F.parseFlowchart(CORPUS.shapes);
  const shapes = Object.fromEntries(m.nodes.map((n) => [n.id, [n.shape, n.label]]));
  assert.deepEqual(shapes, {
    r: ['rect', 'Rectangle'], ro: ['rounded', 'Rounded'], st: ['stadium', 'Stadium'], su: ['subroutine', 'Subroutine'],
    cy: ['cylinder', 'Database'], ci: ['circle', 'Circle'], dc: ['double-circle', 'Double'], di: ['diamond', 'Diamond'],
    hx: ['hexagon', 'Hexagon'], lr: ['lean-right', 'Lean right'], ll: ['lean-left', 'Lean left'], tz: ['trapezoid', 'Trapezoid'],
    it: ['inv-trapezoid', 'Inverted'], fl: ['flag', 'Flag'],
  });
  // The ellipse `(- -)` is not a managed shape: its line is kept as it is.
  assert.equal(m.unmanaged.length, 1);
  assert.match(m.lines[m.unmanaged[0]], /el\(-Ellipse-\)/);
  const q = F.parseFlowchart(CORPUS.mixedQuotes);
  assert.deepEqual(q.nodes.map((n) => n.label), ['Quoted (x) [y]', "it's plain", 'a | b']);
});

test('parse: every link form, labels in both forms, chains and & groups', () => {
  const m = F.parseFlowchart(CORPUS.links);
  const got = m.edges.map((e) => [e.to, e.stroke, e.startHead + e.endHead, e.label, F.lineStyleOf(e)]);
  assert.deepEqual(got, [
    ['B', 'normal', '>', null, 'arrow'], ['C', 'normal', '', null, 'line'], ['D', 'normal', '', 'This is the text!', 'line'],
    ['E', 'normal', '', 'This is the text', 'line'], ['F', 'normal', '>', 'text', 'arrow'], ['G', 'normal', '>', 'text', 'arrow'],
    ['H', 'dotted', '>', null, 'dotted'], ['I', 'dotted', '>', 'text', 'dotted'], ['J', 'thick', '>', null, 'thick'],
    ['K', 'thick', '>', 'text', 'thick'], ['L', 'invisible', '', null, null],
  ]);
  const c = F.parseFlowchart(CORPUS.chaining);
  assert.deepEqual(c.edges.map((e) => `${e.from}>${e.to}${e.shared ? '&' : ''}`), ['A>B', 'B>C', 'a>b&', 'a>c&', 'b>d&', 'c>d&', 'P>R&', 'P>S&', 'Q>R&', 'Q>S&']);
  const a = F.parseFlowchart(CORPUS.arrows);
  assert.deepEqual(a.edges.map((e) => e.startHead + e.endHead), ['o', 'x', 'oo', '<>', 'xx']);
  // Repeated pairs get Mermaid's numbering: 0, then 2, 3, …
  const r = F.parseFlowchart('flowchart LR\n  A -->|a| B\n  A -->|b| B\n  A --> B');
  assert.deepEqual(r.edges.map((e) => e.domId), ['L_A_B_0', 'L_A_B_2', 'L_A_B_3']);
});

test('parse: subgraphs, membership as Mermaid decides it, made-up ids', () => {
  const s = F.parseFlowchart(CORPUS.subgraphs);
  // c1 is first mentioned at the top, but `c1-->c2` inside "three" puts it there; a2 is claimed by "one".
  assert.deepEqual(Object.fromEntries(s.nodes.map((n) => [n.id, n.parent])), { c1: 'three', a2: 'one', a1: 'one', b1: 'two', b2: 'two', c2: 'three' });
  const t = F.parseFlowchart(CORPUS.titleSubgraph);
  assert.deepEqual(t.subgraphs.map((g) => [g.key, g.title]), [['subGraph0', 'Two words here'], ['single', 'single']]);
  const n = F.parseFlowchart(CORPUS.nested);
  assert.deepEqual(n.subgraphs.map((g) => [g.key, g.parent]), [['outer', null], ['middle', 'outer'], ['inner', 'middle']]);
  assert.deepEqual(Object.fromEntries(n.nodes.map((x) => [x.id, x.parent])), { x1: 'inner', x2: 'inner', m1: 'middle', o1: 'outer', start: null });
  assert.deepEqual(F.flowOutline(n).map((i) => `${'  '.repeat(i.depth)}${i.kind === 'node' ? i.node.id : i.subgraph.key}`),
    ['outer', '  middle', '    inner', '      x1', '      x2', '    m1', '  o1', 'start']);
  // A subgraph written on one line with its statements is read; it cannot be added to.
  const one = F.parseFlowchart(CORPUS.sharedLine);
  assert.deepEqual(one.nodes.map((x) => [x.id, x.parent]), [['a', 's'], ['b', 's'], ['c', null]]);
  refused(F.addNode(CORPUS.sharedLine, { label: 'x', parent: 's' }), 'unmanaged');
});

test('parse: icon nodes and @{ } blocks', () => {
  const m = F.parseFlowchart(CORPUS.icons);
  assert.deepEqual(m.nodes.map((n) => [n.id, n.shape, n.icon, n.label]), [
    ['user', 'icon', 'fa:user', 'User Icon'], ['run', 'icon', 'demo:run-service', 'Run Service'],
  ]);
  const s = F.parseFlowchart(CORPUS.newShapes);
  assert.deepEqual(s.nodes.map((n) => [n.id, n.shape, n.label]), [['A', 'other', null], ['B', 'other', 'Decision']]);
});

test('parse: what is not managed is counted and kept', () => {
  const counts = {
    styling: 2, classes: 3, interaction: 4, linkStyle: 1, edgeIds: 2, markdown: 4, accessibility: 4, unknownLines: 3,
    subgraphDirection: 3, specialChars: 0, comments: 0, initDirective: 0, frontMatter: 0, markdownEdge: 1,
  };
  for (const [name, n] of Object.entries(counts)) assert.equal(F.parseFlowchart(CORPUS[name]).unmanaged.length, n, name);
  // Lines the reader is not sure about are other, never guessed.
  const other = [
    'A[]', 'A[x] [y]', 'A [x]', 'A["x" ]', 'A-->', '-->B', 'A-->B C', 'A&B', 'A.b --> c', 'A --> end', 'end --> A', 'A --> B@x',
    'A[a@b] --> B', 'style-x --> B', 'A -- x', 'A -->|x B', 'A[x]]', 'A(-x-)', 'A[|x|]', 'v --> A', 'A -->|| B', 'A["`md`"]',
    'click A cb', 'A --> B %% c', 'A["x"]extra', 'é --> A', 'A--> B direction LR',
  ];
  for (const line of other) {
    const m = F.parseFlowchart(`flowchart LR\n  ${line}\n`);
    assert.ok(m.unmanaged.includes(1), `"${line}" is other`);
  }
  // Ids that only start like a keyword are ids.
  const k = F.parseFlowchart(CORPUS.keywordsNear);
  assert.deepEqual(k.nodes.map((n) => n.id), ['endpoint', 'subgraph1', 'class1', 'styles', 'end_x', 'classy']);
  assert.deepEqual(k.unmanaged, []);
});

// ---- the properties, for every diagram of the corpus ------------------------------------------------

test('round trip: no-op edits give the code back byte for byte', () => {
  for (const [name, code] of Object.entries(CORPUS)) {
    const m = F.parseFlowchart(code);
    for (const n of m.nodes) {
      assert.equal(ok(F.updateNode(code, n.id, { label: n.label || n.id })).code, code, `${name}: label of ${n.id}`);
      assert.equal(ok(F.setNodeParent(code, n.id, n.parent)).code, code, `${name}: parent of ${n.id}`);
    }
    for (const e of m.edges) assert.equal(ok(F.updateEdge(code, e.key, { label: e.label })).code, code, `${name}: edge ${e.key}`);
    for (const g of m.subgraphs.filter((x) => x.managed)) assert.equal(ok(F.updateSubgraph(code, g.key, { title: g.title })).code, code, `${name}: ${g.key}`);
    if (m.direction && ['TD', 'TB', 'LR', 'RL', 'BT'].includes(m.direction)) {
      assert.equal(ok(F.setDirection(code, m.direction === 'TB' ? 'TD' : m.direction)).code, code, `${name}: direction`);
    }
  }
});

test('every edit: the result reads back, keeps every unmanaged statement, and has exactly the intended change', () => {
  let applied = 0;
  let refusals = 0;
  for (const [name, code] of Object.entries(CORPUS)) {
    const before = F.parseFlowchart(code);
    for (const edit of editsFor(code)) {
      const r = edit.run();
      if (!r.ok) {
        refusals++;
        assert.ok(r.error.message.length > 10, `${name}: ${edit.name}: a refusal says why`);
        continue;
      }
      applied++;
      const after = F.parseFlowchart(r.code);
      assert.ok(after, `${name}: ${edit.name}: still a flowchart`);
      assert.deepEqual(kept(after), kept(before), `${name}: ${edit.name}: unmanaged statements unchanged`);
      if (r.code === code) continue;
      if (edit.expect) assert.deepEqual(view(after), edit.expect(clone(view(before)), after, r), `${name}: ${edit.name}: exactly the intended change\n${r.code}`);
      // Lines the edit does not concern are kept: every old line is still there, unless the edit removes
      // or rewrites one statement's line (or moves a subgraph's lines).
      if (!/^(delete|edge|label|shape|icon|move|rename|subgraph|direction)/.test(edit.name)) {
        const old = code.split('\n');
        const now = r.code.split('\n');
        let j = 0;
        for (const l of now) if (j < old.length && (l === old[j] || l === `${old[j]}\r`)) j++;
        assert.ok(j >= old.length - 1, `${name}: ${edit.name}: old lines kept in order`);
      }
    }
  }
  assert.ok(applied > 1500, `${applied} edits applied`);
  assert.ok(refusals > 0, `${refusals} refused`);
});

test('chains: deleting a node in the middle splits the chain; definitions elsewhere stay', () => {
  const code = 'flowchart LR\n  A[Start] --> B{Ask} --> C[Done]\n  B --> D\n';
  assert.equal(ok(F.removeNode(code, 'B')).code, 'flowchart LR\n  A[Start]\n  C[Done]\n  D\n');
  assert.equal(ok(F.removeNode('flowchart LR\n  A[Start] --> B\n  B --> C\n', 'B')).code, 'flowchart LR\n  A[Start]\n  C\n');
  // A is defined inside the chain through it; deleting A removes its definition with it, B and C stay.
  assert.equal(ok(F.removeNode('flowchart LR\n  B --> A[Start] --> C\n', 'A')).code, 'flowchart LR\n  B\n  C\n');
  assert.equal(ok(F.removeNode('flowchart LR\n  B --> A[Start] --> C\n', 'B')).code, 'flowchart LR\n  A[Start] --> C\n');
  assert.equal(ok(F.removeNode('flowchart LR\n  B --> A[Start] --> C\n', 'C')).code, 'flowchart LR\n  B --> A[Start]\n');
  // Bare leftovers go when the node is mentioned elsewhere.
  assert.equal(ok(F.removeNode(CORPUS.editorDefault, 'B')).code, 'graph TD;\n  A-->C;\n  C-->D;');
  // On a line with other statements, the pieces stay on that line.
  assert.equal(ok(F.removeNode(CORPUS.oneLine, 'B')).code, 'graph TD; C-->A;');
  assert.equal(ok(F.removeNode('graph TD; A-->B; B-->C;', 'B')).code, 'graph TD; A; C;');
  // An & group loses only the deleted node.
  assert.equal(ok(F.removeNode(CORPUS.fanout, 'b')).code, 'flowchart TD\n  start --> a & c\n  a & c --> finish\n  finish --> done');
});

test('edges: delete splits a chain; labels keep their form; & groups are read-only', () => {
  const code = 'flowchart LR\n  A --> B --> C --> D\n';
  const m = F.parseFlowchart(code);
  assert.equal(ok(F.removeEdge(code, m.edges[1].key)).code, 'flowchart LR\n  A --> B\n  C --> D\n');
  assert.equal(ok(F.removeEdge(code, m.edges[0].key)).code, 'flowchart LR\n  A\n  B --> C --> D\n');
  const ex = F.parseFlowchart(CORPUS.editorExample);
  const yes = ex.edges.find((e) => e.label === 'Yes');
  assert.equal(ok(F.updateEdge(CORPUS.editorExample, yes.key, { label: 'Sure' })).code.split('\n')[3], '  C -->|"Sure"| D[End];');
  assert.equal(ok(F.updateEdge(CORPUS.editorExample, yes.key, { label: '' })).code.split('\n')[3], '  C --> D[End];');
  assert.equal(ok(F.updateEdge(CORPUS.editorExample, ex.edges[0].key, { label: 'go', line: 'dotted' })).code.split('\n')[1], '  A[Start] -.->|"go"| B[Process];');
  const l = F.parseFlowchart(CORPUS.loginIcons);
  const no = l.edges.find((e) => e.label === 'No');
  assert.equal(ok(F.updateEdge(CORPUS.loginIcons, no.key, { label: 'Not yet' })).code.split('\n')[3], '  auth -->|"Not yet"| login[Sign in page]');
  const f = F.parseFlowchart(CORPUS.fanout);
  refused(F.removeEdge(CORPUS.fanout, f.edges[0].key), 'unmanaged');
  refused(F.updateEdge(CORPUS.fanout, f.edges[0].key, { label: 'x' }), 'unmanaged');
  // Never a duplicate of the same pair, direction, line and label.
  refused(F.addEdge(CORPUS.editorDefault, { from: 'A', to: 'B' }), 'duplicate');
  ok(F.addEdge(CORPUS.editorDefault, { from: 'A', to: 'B', label: 'again' }));
  ok(F.addEdge(CORPUS.editorDefault, { from: 'B', to: 'A' }));
  refused(F.connectNodes(CORPUS.editorDefault, 'A', 'B'), 'duplicate');
  refused(F.connectNodes(CORPUS.editorDefault, 'A', 'A'), 'endpoint');
  assert.equal(ok(F.connectNodes(CORPUS.editorDefault, 'D', 'A')).code, `${CORPUS.editorDefault}\n  D --> A;`);
});

test('linkStyle numbers: edits that would renumber the styled edges are refused', () => {
  const m = F.parseFlowchart(CORPUS.linkStyle);
  assert.equal(m.linkStyleMax, 1);
  refused(F.removeEdge(CORPUS.linkStyle, m.edges[0].key), 'in-use');
  ok(F.removeEdge(CORPUS.linkStyle, m.edges[2].key));
  ok(F.addEdge(CORPUS.linkStyle, { from: 'D', to: 'A' }));
  ok(F.updateEdge(CORPUS.linkStyle, m.edges[1].key, { label: 'styled' }));
  refused(F.removeNode(CORPUS.linkStyle, 'A'), 'in-use');
});

test('unmanaged statements that name a node block its deletion; classes are kept through edits', () => {
  assert.match(refused(F.removeNode(CORPUS.styling, 'id1'), 'in-use'), /Line 3 \(style\) names Start/);
  assert.match(refused(F.removeNode(CORPUS.interaction, 'B'), 'in-use'), /Line 6 \(click\)/);
  refused(F.removeNode(CORPUS.classes, 'B'), 'in-use');
  assert.equal(ok(F.updateNode(CORPUS.classes, 'A', { label: 'Some', shape: 'stadium' })).code.split('\n')[1], '    A(["Some"]):::someclass --> B');
  assert.equal(ok(F.updateNode(CORPUS.classesInline, 'B', { label: 'Bee' })).code.split('\n')[1], '  A:::red & B["Bee"]:::blue --> C');
  // A node only named by lines the builder does not read is not in the model.
  assert.equal(F.findNode(F.parseFlowchart(CORPUS.edgeIds), 'A'), undefined);
});

test('nodes: exact text of new and changed nodes', () => {
  const r = ok(F.addNode(CORPUS.editorDefault, { label: 'Check stock' }));
  assert.equal(r.id, 'check_stock');
  assert.equal(r.code, `${CORPUS.editorDefault}\n  check_stock["Check stock"];`);
  assert.equal(ok(F.addNode('flowchart LR\n', { label: 'One', shape: 'circle' })).code, 'flowchart LR\n  one(("One"))\n');
  assert.equal(ok(F.addNode('flowchart LR\n', { label: 'Cloud Run', icon: 'gcp:cloud-run' })).code, 'flowchart LR\n  cloud_run@{ icon: "gcp:cloud-run", label: "Cloud Run" }\n');
  assert.equal(ok(F.addNode('flowchart LR\n', { label: 'a_b *c*', icon: 'gcp:cloud-run' })).code, 'flowchart LR\n  a_b_c@{ icon: "gcp:cloud-run", label: "a_b *c*", labelType: "text" }\n');
  // Ids never collide with a word of the diagram or a keyword.
  for (const [label, id] of [['end', 'end_node'], ['Subgraph', 'subgraph_node'], ['v', 'v_node'], ['A', 'a_2'], ['classDef', 'classdef_node'], ['42', 'n_42']]) {
    assert.equal(ok(F.addNode('flowchart LR\n  a --> b\n', { label })).id, id === 'a_2' ? 'a_2' : id, label);
  }
  // Labels: the quoted form keeps punctuation as text; tabs and runs of spaces become one space.
  assert.equal(ok(F.updateNode(CORPUS.editorDefault, 'C', { label: '  (y)  {z}\tx]  ' })).code.split('\n')[2], '  A-->C["(y) {z} x]"];');
  assert.equal(ok(F.updateNode(CORPUS.shapes, 'lr', { shape: 'trapezoid' })).code.split('\n')[10], '    lr[/Lean right\\]');
  assert.equal(ok(F.updateNode(CORPUS.trapezoids, 'a', { shape: 'rect' })).code.split('\n')[1], '  a["In / out"] --> b[\\"Manual"\\]');
  // Icons: on and off; @{ } keys the builder does not know stay.
  assert.equal(ok(F.updateNode(CORPUS.icons, 'user', { label: 'Person' })).code.split('\n')[1], '    user@{ icon: "fa:user", form: "square", label: "Person", pos: "t", h: 60 }');
  assert.equal(ok(F.updateNode(CORPUS.icons, 'run', { icon: null })).code.split('\n')[2], '    run["Run Service"]');
  assert.equal(ok(F.updateNode(CORPUS.lengths, 'C', { icon: 'demo:object-store' })).code.split('\n')[2], '    B -->|Yes| C@{ icon: "demo:object-store", label: "OK" }');
  // Defined twice: label edits change the definition Mermaid shows (the last); shapes are refused.
  assert.equal(ok(F.updateNode(CORPUS.multiDefs, 'A', { label: 'Third' })).code, 'flowchart LR\n  A[First] --> B\n  A["Third"] --> C');
  refused(F.updateNode(CORPUS.multiDefs, 'A', { shape: 'circle' }), 'unmanaged');
  refused(F.updateNode(CORPUS.newShapes, 'B', { shape: 'circle' }), 'unmanaged');
});

test('subgraphs: add, rename, move, delete', () => {
  assert.equal(ok(F.addSubgraph(CORPUS.editorDefault, { title: 'Review' })).code, `${CORPUS.editorDefault}\n  subgraph review ["Review"];\n  end;`);
  const sub = 'flowchart TB\n  subgraph one [Stage one]\n    a1 --> a2\n  end\n  subgraph two\n    b1\n  end\n  a2 --> b1\n';
  assert.equal(ok(F.addNode(sub, { label: 'Inside', parent: 'one' })).code, 'flowchart TB\n  subgraph one [Stage one]\n    a1 --> a2\n    inside["Inside"]\n  end\n  subgraph two\n    b1\n  end\n  a2 --> b1\n');
  assert.equal(ok(F.updateSubgraph(sub, 'one', { title: 'First' })).code.split('\n')[1], '  subgraph one ["First"]');
  assert.equal(ok(F.updateSubgraph(sub, 'two', { title: 'Second' })).code.split('\n')[4], '  subgraph two ["Second"]');
  const t = ok(F.updateSubgraph(CORPUS.titleSubgraph, 'subGraph0', { title: 'Renamed' }));
  assert.equal(t.id, 'renamed');
  assert.equal(t.code.split('\n')[1], '  subgraph renamed ["Renamed"]');
  assert.equal(ok(F.updateSubgraph(sub, 'two', { parent: 'one' })).code, 'flowchart TB\n  subgraph one [Stage one]\n    a1 --> a2\n    subgraph two\n      b1\n    end\n  end\n  a2 --> b1\n');
  refused(F.updateSubgraph(CORPUS.nested, 'outer', { parent: 'inner' }), 'cycle');
  assert.equal(ok(F.removeSubgraph(sub, 'one')).code, 'flowchart TB\n  a1 --> a2\n  subgraph two\n    b1\n  end\n  a2 --> b1\n');
  // Edges to the subgraph go with it; nodes inside move to the parent.
  const e = ok(F.removeSubgraph(CORPUS.edgeToSubgraph, 's1'));
  assert.equal(e.code, 'flowchart LR\n  in1 --> in2\n  out\n  out2');
  const n = ok(F.removeSubgraph(CORPUS.nested, 'middle'));
  assert.deepEqual(Object.fromEntries(F.parseFlowchart(n.code).nodes.map((x) => [x.id, x.parent])), { x1: 'inner', x2: 'inner', m1: 'outer', o1: 'outer', start: null });
  // Moving nodes follows Mermaid's rule: mentions in other subgraphs move out.
  const moved = ok(F.setNodeParent(sub, 'a1', 'two'));
  assert.equal(moved.code, 'flowchart TB\n  subgraph one [Stage one]\n    a2\n  end\n  subgraph two\n    b1\n    a1\n  end\n  a2 --> b1\n  a1 --> a2\n');
  assert.equal(F.findNode(F.parseFlowchart(moved.code), 'a1').parent, 'two');
  const out = ok(F.setNodeParent(sub, 'b1', null));
  assert.equal(out.code, 'flowchart TB\n  subgraph one [Stage one]\n    a1 --> a2\n  end\n  subgraph two\n  end\n  a2 --> b1\n');
});

test('labels: what cannot be shown as typed is refused, the rest is written as typed', () => {
  const refusedLabels = ['a "b" c', 'click A href "javascript:alert(1)"', '<b>bold</b>', '--> B', 'a > b', 'line<br>break', 'Step #35;', 'x &amp; y', '`tick`', 'go direction LR', 'two\nlines'];
  for (const label of refusedLabels) assert.ok(F.labelProblem(label), label);
  const accepted = ['x]', '(y)', '{z}', 'a|b', '%% no', 'end', 'subgraph x', 'a & b', 'Step #1', '50% off', 'tail`', 'a;b', 'x:::y', 'café', '日本語', 'emoji 🚀', 'a'.repeat(120)];
  for (const label of accepted) {
    assert.equal(F.labelProblem(label), null, label);
    const r = ok(F.addNode(CORPUS.editorDefault, { label }));
    assert.equal(F.findNode(F.parseFlowchart(r.code), r.id).label, label, `${label} reads back`);
    const e = ok(F.addEdge(CORPUS.editorDefault, { from: 'D', to: 'A', label }));
    assert.equal(F.findEdge(F.parseFlowchart(e.code), e.key).label, label, `${label} reads back on an edge`);
  }
  refused(F.addNode(CORPUS.editorDefault, { label: 'a "b"' }), 'label');
  refused(F.addNode(CORPUS.editorDefault, { label: '' }), 'label');
  // Mermaid's entity preprocessing would eat the last ; of "style…:…#…;" on a line.
  refused(F.addNode(CORPUS.editorDefault, { label: 'style:x#y z;' }), 'label');
});

test('direction: written into the header, with or without a semicolon', () => {
  assert.equal(ok(F.setDirection(CORPUS.editorDefault, 'LR')).code.split('\n')[0], 'graph LR;');
  assert.equal(ok(F.setDirection(CORPUS.noDirection, 'RL')).code.split('\n')[0], 'graph RL');
  assert.equal(ok(F.setDirection(CORPUS.oneLine, 'BT')).code, 'graph BT; A-->B; B-->C; C-->A;');
  assert.equal(ok(F.setDirection(CORPUS.elk, 'LR')).code.split('\n')[0], 'flowchart-elk LR');
  assert.equal(ok(F.setDirection(CORPUS.noDirection, 'TD')).code, CORPUS.noDirection);
});

test('line endings, tabs and the final newline are kept', () => {
  const crlf = ok(F.addNode(CORPUS.crlf, { label: 'More' })).code;
  assert.equal(crlf, `${CORPUS.crlf}  more["More"]\r\n`);
  const noFinal = ok(F.addEdge(CORPUS.crlfNoFinal, { from: 'C', to: 'A' })).code;
  assert.equal(noFinal, `${CORPUS.crlfNoFinal}\r\n  C --> A`);
  assert.equal(ok(F.removeNode(CORPUS.crlfNoFinal, 'C')).code, 'flowchart TD\r\n  A --> B');
  assert.equal(ok(F.addNode(CORPUS.tabs, { label: 'In', parent: 'S' })).code, 'flowchart LR\n\tA --> B\n\tsubgraph S [Stage]\n\t\tC --> D\n\t\tin_node["In"]\n\tend\n\tB --> C\n');
  assert.equal(ok(F.addNode(CORPUS.noFinalNewline, { label: 'Z' })).code, 'flowchart LR\n  A --> B\n  z["Z"]');
});

// ---- random edit sequences ---------------------------------------------------------------------------

// random:start
/** A small seeded generator (mulberry32), so a failure can be replayed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One random edit on `code`: its name and result. `M` is the flowchart model module. */
export function randomEdit(M, code, rand, n) {
  const m = M.parseFlowchart(code);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const labels = ['Check', 'Yes', 'No', 'Ship it', 'a & b', '(x)', 'x]', 'Review step', 'Done', '日本語', '%% no', 'end'];
  const node = m.nodes.length ? pick(m.nodes) : null;
  const edge = m.edges.length ? pick(m.edges) : null;
  const sub = m.subgraphs.filter((g) => g.managed);
  const sg = sub.length ? pick(sub) : null;
  const ops = [
    () => ['addNode', M.addNode(code, { label: `${pick(labels)} ${n}`, shape: pick(M.SHAPES).name, parent: rand() < 0.3 && sg ? sg.key : null })],
    () => ['addIcon', M.addNode(code, { label: `Service ${n}`, icon: 'demo:run-service' })],
    () => node && ['label', M.updateNode(code, node.id, { label: `${pick(labels)} ${n}` })],
    () => node && ['shape', M.updateNode(code, node.id, { shape: pick(M.SHAPES).name })],
    () => node && ['removeNode', M.removeNode(code, node.id)],
    () => node && ['move', M.setNodeParent(code, node.id, sg && rand() < 0.6 ? sg.key : null)],
    () => m.nodes.length > 1 && ['addEdge', M.addEdge(code, { from: pick(m.nodes).id, to: pick(m.nodes).id, label: rand() < 0.5 ? pick(labels) : '', line: pick(M.LINE_STYLES).value })],
    () => edge && ['edgeLabel', M.updateEdge(code, edge.key, { label: rand() < 0.3 ? '' : pick(labels) })],
    () => edge && ['edgeLine', M.updateEdge(code, edge.key, { line: pick(M.LINE_STYLES).value })],
    () => edge && ['removeEdge', M.removeEdge(code, edge.key)],
    () => ['addSubgraph', M.addSubgraph(code, { title: `Stage ${n}`, parent: rand() < 0.3 && sg ? sg.key : null })],
    () => sg && ['rename', M.updateSubgraph(code, sg.key, { title: `Phase ${n}` })],
    () => sg && ['removeSubgraph', M.removeSubgraph(code, sg.key)],
    () => ['direction', M.setDirection(code, pick(M.FLOW_DIRECTIONS).value)],
  ];
  for (;;) {
    const out = pick(ops)();
    if (out) return out;
  }
}
// random:end

test('random edit sequences: 600 sequences over the corpus always read back and keep the unmanaged lines', () => {
  const rand = rng(20261126);
  let steps = 0;
  let inverses = 0;
  const names = Object.keys(CORPUS);
  for (let s = 0; s < 600; s++) {
    const name = names[s % names.length];
    let code = CORPUS[name];
    const keep = kept(F.parseFlowchart(code));
    for (let n = 0; n < 8; n++) {
      const [op, r] = randomEdit(F, code, rand, n);
      if (!r.ok) {
        assert.ok(r.error.message, `${name} #${s} ${op}: refusal has a message`);
        continue;
      }
      const after = F.parseFlowchart(r.code);
      assert.ok(after, `${name} #${s} ${op}: reads back`);
      assert.deepEqual(kept(after), keep, `${name} #${s} ${op}: unmanaged lines kept\n${r.code}`);
      // Inverse steps: adding then removing gives the text back exactly.
      if (op === 'addNode' || op === 'addIcon') {
        assert.equal(ok(F.removeNode(r.code, r.id)).code, code, `${name} #${s}: add then delete a node`);
        inverses++;
      }
      if (op === 'addEdge') {
        assert.equal(ok(F.removeEdge(r.code, r.key)).code, code, `${name} #${s}: add then delete an edge\n${r.code}`);
        inverses++;
      }
      if (op === 'addSubgraph') {
        assert.equal(ok(F.removeSubgraph(r.code, r.id)).code, code, `${name} #${s}: add then delete a subgraph`);
        inverses++;
      }
      if (op === 'label') {
        const before = F.parseFlowchart(code);
        const target = before.nodes.find((x) => F.findNode(after, x.id)?.label !== x.label);
        // Back to the old label, when that label is one the builder can write.
        if (target && F.labelProblem(target.label || target.id) === null) {
          const back = ok(F.updateNode(r.code, target.id, { label: target.label || target.id }));
          assert.equal(F.findNode(F.parseFlowchart(back.code), target.id).label || target.id, target.label || target.id);
          inverses++;
        }
      }
      code = r.code;
      steps++;
    }
  }
  assert.ok(steps > 2500, `${steps} steps applied`);
  assert.ok(inverses > 400, `${inverses} inverse checks`);
});
