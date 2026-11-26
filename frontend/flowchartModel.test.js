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

/** The statements and lines the builder does not manage and never changes, trimmed, in order. */
function kept(m) {
  const out = [];
  m.lineRoles.forEach((role, i) => {
    if (['comment', 'directive', 'preamble', 'unmanaged'].includes(role)) out.push(m.lines[i].replace(/\r$/, '').trim());
  });
  for (const st of m.statements) {
    if (st.kind === 'other' && !st.attach && m.lineRoles[st.line] !== 'unmanaged') out.push(F.stmtText(m, st));
  }
  return out;
}

/**
 * The attached lines by what they name: style, class and click by id; linkStyle by the connections
 * (from>to) its numbers point at. Each with the rest of its statement.
 */
function attachedView(m) {
  return m.statements.filter((st) => st.kind === 'other' && st.attach).map((st) => {
    const text = F.stmtText(m, st);
    const rest = text.slice(st.attach.listEnd - st.start);
    const items = st.attach.keyword === 'linkStyle'
      ? st.attach.items.map((x) => { const e = m.edges[Number(x.value)]; return e ? `${e.from}>${e.to}` : `#${x.value}`; }).sort()
      : st.attach.items.map((x) => x.value);
    return JSON.stringify([st.attach.keyword, rest, items]);
  }).sort();
}

/** attachedView after deleting ids and connections (from>to strings): they leave the lists; empty lists go. */
function attachedWithout(view, ids, edges) {
  return view.map((json) => {
    const [keyword, rest, items] = JSON.parse(json);
    let left;
    if (keyword === 'linkStyle') {
      left = [...items];
      for (const e of edges) { const k = left.indexOf(e); if (k !== -1) left.splice(k, 1); }
    } else left = items.filter((x) => !ids.includes(x));
    return left.length ? JSON.stringify([keyword, rest, left]) : null;
  }).filter(Boolean).sort();
}

/** The direction lines of subgraphs that are gone: they leave with their subgraph. */
const droppedDirections = (before, after) => before.statements
  .filter((st) => st.kind === 'other' && st.role === 'direction' && st.parent !== null && !after.subgraphs.some((g) => g.key === before.subgraphs.find((x) => x.statement === st.parent)?.key))
  .map((st) => F.stmtText(before, st));
const without = (list, gone) => {
  const out = [...list];
  for (const g of gone) { const k = out.indexOf(g); if (k !== -1) out.splice(k, 1); }
  return out;
};

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
  const add = (name, run, expect, removes) => edits.push({ name, run, expect, removes });
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
    }, (m) => ({ ids: [n.id], edges: m.edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => `${e.from}>${e.to}`) }));
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
    }, () => ({ ids: [], edges: [`${e.from}>${e.to}`] }));
  }
  for (const g of managed) {
    add(`rename ${g.key}`, () => F.updateSubgraph(code, g.key, { title: 'Renamed stage' }), null);
    edits.push({ name: `delete subgraph ${g.key}`, run: () => F.removeSubgraph(code, g.key), expect: null, removes: (m) => ({ ids: [g.key], edges: m.edges.filter((e) => e.from === g.key || e.to === g.key).map((e) => `${e.from}>${e.to}`) }) });
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

test('parse: a link label that goes on to the next line is left alone up to its closing arrow', () => {
  // Mermaid reads "first / second" as the label of A --> B; "second" is not a node.
  const code = lines('flowchart TD', '  A -- first', '  second --> B', '  B --> C', '  C == a', '  b', '  c ==> D', '  D --> E');
  const m = F.parseFlowchart(code);
  assert.deepEqual(m.nodes.map((n) => n.id), ['B', 'C', 'D', 'E']);
  assert.deepEqual(m.edges.map((e) => [e.from, e.to]), [['B', 'C'], ['D', 'E']]);
  assert.deepEqual(m.unmanaged, [1, 2, 4, 5, 6]);
  // A label closed on its own line is read as before.
  assert.equal(F.parseFlowchart(lines('flowchart TD', '  A -- first --> B', '  second --> B')).edges.length, 2);
  // Edits keep those lines byte for byte.
  const added = ok(F.addNode(code, { label: 'New' }));
  assert.deepEqual(added.code.split('\n').slice(0, 8), code.split('\n'));
});

test('parse: what is not managed is counted and kept', () => {
  const counts = {
    styling: 2, classes: 3, interaction: 4, linkStyle: 1, edgeIds: 2, markdown: 3, accessibility: 4, unknownLines: 3,
    subgraphDirection: 3, specialChars: 0, comments: 0, initDirective: 0, frontMatter: 0, markdownEdge: 0,
  };
  for (const [name, n] of Object.entries(counts)) assert.equal(F.parseFlowchart(CORPUS[name]).unmanaged.length, n, name);
  // Lines the reader is not sure about are other, never guessed.
  const other = [
    'A[]', 'A[x] [y]', 'A [x]', 'A["x" ]', 'A-->', '-->B', 'A-->B C', 'A&B', 'A.b --> c', 'A --> end', 'end --> A', 'A --> B@x',
    'A[a@b] --> B', 'style-x --> B', 'A -- x', 'A -->|x B', 'A[x]]', 'A(-x-)', 'A[|x|]', 'v --> A', 'A -->|| B', 'A["`md"]', 'A["`a`b`"]',
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
      // As a multiset: moving a subgraph moves its lines.
      assert.deepEqual(kept(after).sort(), without(kept(before), droppedDirections(before, after)).sort(), `${name}: ${edit.name}: unmanaged statements unchanged`);
      // Attached lines change only with what they name.
      const gone = edit.removes ? edit.removes(before) : { ids: [], edges: [] };
      assert.deepEqual(attachedView(after), attachedWithout(attachedView(before), gone.ids, gone.edges), `${name}: ${edit.name}: attached lines follow\n${r.code}`);
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

test('edges: delete splits a chain; labels keep their form; & statements are expanded to change one connection', () => {
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
  // A connection written with & is changed by writing that statement as one per connection first.
  const f = F.parseFlowchart(CORPUS.fanout);
  assert.equal(ok(F.removeEdge(CORPUS.fanout, f.edges[1].key)).code, 'flowchart TD\n  start --> a\n  start --> c\n  a & b & c --> finish\n  finish --> done');
  assert.equal(ok(F.updateEdge(CORPUS.fanout, f.edges[0].key, { label: 'go' })).code, 'flowchart TD\n  start -->|"go"| a\n  start --> b\n  start --> c\n  a & b & c --> finish\n  finish --> done');
  const shaped = 'flowchart LR\n  A[One]:::x & B --> C{Two} --> D\n  linkStyle 2 stroke:#f00\n';
  const s = F.parseFlowchart(shaped);
  const expanded = ok(F.removeEdge(shaped, s.edges[1].key));
  assert.equal(expanded.code, 'flowchart LR\n  A[One]:::x --> C{Two}\n  B\n  C --> D\n  linkStyle 1 stroke:#f00\n');
  assert.equal(ok(F.updateEdge(shaped, s.edges[0].key, { label: '' })).code, shaped);
  // Never a duplicate of the same pair, direction, line and label.
  refused(F.addEdge(CORPUS.editorDefault, { from: 'A', to: 'B' }), 'duplicate');
  ok(F.addEdge(CORPUS.editorDefault, { from: 'A', to: 'B', label: 'again' }));
  ok(F.addEdge(CORPUS.editorDefault, { from: 'B', to: 'A' }));
  refused(F.connectNodes(CORPUS.editorDefault, 'A', 'B'), 'duplicate');
  refused(F.connectNodes(CORPUS.editorDefault, 'A', 'A'), 'endpoint');
  assert.equal(ok(F.connectNodes(CORPUS.editorDefault, 'D', 'A')).code, `${CORPUS.editorDefault}\n  D --> A;`);
});

test('edges: a pipe label is followed by one space at most (Mermaid refuses more)', () => {
  // Written with several spaces after the arrow: the label takes their place, with one space.
  const wide = lines('flowchart TD', '  A   -->   B', '  B --> C');
  const key = F.parseFlowchart(wide).edges[0].key;
  assert.equal(ok(F.updateEdge(wide, key, { label: 'Yes' })).code, lines('flowchart TD', '  A   -->|"Yes"| B', '  B --> C'));
  assert.equal(ok(F.updateEdge(wide, key, { line: 'dotted' })).code, lines('flowchart TD', '  A   -.->   B', '  B --> C'));
  const inline = lines('flowchart TD', '  A -- old -->   B');
  assert.equal(ok(F.updateEdge(inline, F.parseFlowchart(inline).edges[0].key, { label: 'new' })).code, lines('flowchart TD', '  A -->|"new"| B'));
  const tight = lines('flowchart TD', '  A-->B');
  assert.equal(ok(F.updateEdge(tight, F.parseFlowchart(tight).edges[0].key, { label: 'Yes' })).code, lines('flowchart TD', '  A-->|"Yes"|B'));
  // Text Mermaid refuses is not managed: the line is left to the Code tab.
  const bad = F.parseFlowchart(lines('flowchart TD', '  A -->|x|  B'));
  assert.equal(bad.edges.length, 0);
  assert.deepEqual(bad.unmanaged, [1]);
  assert.equal(F.parseFlowchart(lines('flowchart TD', '  A -->|x| B')).edges.length, 1);
  assert.equal(F.parseFlowchart(lines('flowchart TD', '  A -->|x|\tB')).edges.length, 1);
});

const STYLED = lines(
  'flowchart LR',
  '  A[Start] --> B{Check}:::warn --> C[Done]',
  '  C --> D[Archive]',
  '  B --> D',
  '  style A fill:#f9f',
  '  style B stroke:#333',
  '  class B,D warn',
  '  classDef warn fill:#fdd',
  '  click B call cb()',
  '  linkStyle 1 stroke:#f00',
  '  linkStyle 2,3 stroke:#00f',
  '  linkStyle default stroke:#999',
);

test('markdown strings: read as labels, listed and connected, never rewritten', () => {
  const code = 'flowchart LR\n  A["`**Bold** text`"] -->|"`*it*`"| B\n  B -- "`md`" --> C\n  subgraph s ["`Title **x**`"]\n    C\n  end\n';
  const m = F.parseFlowchart(code);
  assert.deepEqual(m.unmanaged, []);
  assert.deepEqual([m.nodes[0].label, m.nodes[0].markdown, m.edges.map((e) => [e.label, e.markdown]), m.subgraphs[0].title], ['**Bold** text', true, [['*it*', true], ['md', true]], 'Title **x**']);
  assert.match(refused(F.updateNode(code, 'A', { label: 'x' }), 'unmanaged'), /markdown string/);
  refused(F.updateEdge(code, m.edges[0].key, { label: 'x' }), 'unmanaged');
  refused(F.updateEdge(code, m.edges[1].key, { line: 'thick' }), 'unmanaged');
  refused(F.updateSubgraph(code, 's', { title: 'x' }), 'unmanaged');
  // Shape, line (pipe form), moves, connections and deletes work; the markdown text stays as written.
  assert.equal(ok(F.updateNode(code, 'A', { shape: 'stadium' })).code.split('\n')[1], '  A(["`**Bold** text`"]) -->|"`*it*`"| B');
  assert.equal(ok(F.updateEdge(code, m.edges[0].key, { line: 'thick' })).code.split('\n')[1], '  A["`**Bold** text`"] ==>|"`*it*`"| B');
  ok(F.setNodeParent(code, 'A', 's'));
  ok(F.connectNodes(code, 'C', 'A'));
  assert.equal(ok(F.removeNode(code, 'B')).code, 'flowchart LR\n  A["`**Bold** text`"]\n  subgraph s ["`Title **x**`"]\n    C\n  end\n');
});

test('attached lines: read with what they name', () => {
  const m = F.parseFlowchart(STYLED);
  const att = m.statements.filter((st) => st.attach).map((st) => `${st.attach.keyword}:${st.attach.items.map((x) => x.value)}`);
  assert.deepEqual(att, ['style:A', 'style:B', 'class:B,D', 'click:B', 'linkStyle:1', 'linkStyle:2,3']);
  // classDef, linkStyle default, and forms the builder does not read have no list (style takes one id).
  for (const line of ['classDef warn fill:#fdd', 'linkStyle default stroke:#999', 'linkStyle 0, 1 stroke:#f00', 'style A', 'class A', 'style A,B fill:#f00']) {
    assert.equal(F.parseFlowchart(`flowchart LR\n  A --> B\n  ${line}`).statements.at(-1).attach, undefined, line);
  }
});

test('attached lines: deleting a node takes it out of style, class and click lists; linkStyle numbers follow', () => {
  const r = ok(F.removeNode(STYLED, 'B'));
  assert.equal(r.code, lines(
    'flowchart LR',
    '  A[Start]',
    '  C[Done]',
    '  C --> D[Archive]',
    '  style A fill:#f9f',
    '  class D warn',
    '  classDef warn fill:#fdd',
    '  linkStyle 0 stroke:#00f',
    '  linkStyle default stroke:#999',
  ));
  assert.deepEqual(r.also, { deleted: { style: 1, click: 1, linkStyle: 1 }, updated: { class: 1, linkStyle: 1 }, lines: [] });
  // A line that names only the node goes.
  const a = ok(F.removeNode(STYLED, 'A'));
  assert.ok(!a.code.includes('style A'));
  assert.deepEqual(a.also.deleted, { style: 1 });
  // linkStyle 1 styled B --> C; it is now connection 0.
  assert.ok(a.code.includes('  linkStyle 0 stroke:#f00') && a.code.includes('  linkStyle 1,2 stroke:#00f'), a.code);
});

test('attached lines: linkStyle numbers follow every edit that changes the order of connections', () => {
  const m = F.parseFlowchart(STYLED);
  const styledEdge = (code, n) => { const x = F.parseFlowchart(code); return `${x.edges[n].from}>${x.edges[n].to}`; };
  // Delete a connection: later numbers move down; its own number goes.
  const del = ok(F.removeEdge(STYLED, m.edges[1].key));
  assert.ok(!del.code.includes('linkStyle 1 stroke:#f00') && del.code.includes('  linkStyle 1,2 stroke:#00f'), del.code);
  assert.equal(styledEdge(del.code, 1), 'C>D');
  // Split a chain: A --> B --> C without A --> B.
  const split = ok(F.removeEdge(STYLED, m.edges[0].key));
  assert.ok(split.code.includes('  linkStyle 0 stroke:#f00') && split.code.includes('  linkStyle 1,2 stroke:#00f'), split.code);
  assert.equal(styledEdge(split.code, 0), 'B>C');
  // Other ends: the connection is written at the end; its style follows it there.
  const ends = ok(F.updateEdge(STYLED, m.edges[1].key, { to: 'D', label: 'x' }));
  const e = F.parseFlowchart(ends.code);
  assert.equal(e.edges.at(-1).from + e.edges.at(-1).to, 'BD');
  assert.ok(ends.code.includes(`  linkStyle ${e.edges.length - 1} stroke:#f00`), ends.code);
  // Moving a node between subgraphs moves connection lines: matched by what they are.
  const sub = 'flowchart LR\n  subgraph s [S]\n    a --> b\n  end\n  b --> c\n  linkStyle 0 stroke:#f00\n  linkStyle 1 stroke:#00f\n';
  const moved = ok(F.setNodeParent(sub, 'a', null));
  const mm = F.parseFlowchart(moved.code);
  const red = Number(/linkStyle (\d+) stroke:#f00/.exec(moved.code)[1]);
  assert.equal(`${mm.edges[red].from}>${mm.edges[red].to}`, 'a>b', moved.code);
  // Adding a connection at the end changes no number.
  assert.ok(ok(F.addEdge(STYLED, { from: 'D', to: 'A' })).code.includes('  linkStyle 1 stroke:#f00'));
});

test('attached lines: refused when the numbers cannot be known', () => {
  const unread = 'flowchart LR\n  A --> B\n  B --> C\n  linkStyle 0, 1 stroke:#f00\n';
  assert.match(refused(F.removeEdge(unread, F.parseFlowchart(unread).edges[0].key), 'in-use'), /Line 4 \(linkStyle\) is written in a form/);
  const hidden = 'flowchart LR\n  A --> B\n  B -- a; b --> C\n  C --> D\n  linkStyle 1 stroke:#f00\n';
  assert.match(refused(F.removeEdge(hidden, F.parseFlowchart(hidden).edges[0].key), 'in-use'), /Line 3 may hold connections/);
  const twins = 'flowchart LR\n  subgraph s [S]\n    a --> b\n  end\n  a --> b\n  linkStyle 1 stroke:#f00\n';
  assert.match(refused(F.setNodeParent(twins, 'b', null), 'in-use'), /look the same/);
  // With nothing to renumber, the same edits go through.
  ok(F.removeEdge(hidden.replace('  linkStyle 1 stroke:#f00\n', ''), F.parseFlowchart(hidden).edges[0].key));
});

test('attached lines: a subgraph takes its direction line and its style lines with it', () => {
  const code = 'flowchart LR\n  subgraph top [Top]\n    direction TB\n    a --> b\n  end\n  b --> c\n  style top fill:#eee\n  class top,c hot\n';
  const r = ok(F.removeSubgraph(code, 'top'));
  assert.equal(r.code, 'flowchart LR\n  a --> b\n  b --> c\n  class c hot\n');
  assert.deepEqual(r.also, { deleted: { style: 1, direction: 1 }, updated: { class: 1 }, lines: [] });
});

test('lines the builder does not read: a second Delete deletes them with the node', () => {
  const code = 'flowchart LR\n  A[Start] --> B\n  B --> C\n  A -- note; here --> C\n  click A href "https://example.com"\n';
  const first = refused(F.removeNode(code, 'A'), 'confirm');
  assert.equal(first, 'Line 4 also names Start in a form the builder does not read. Press Delete again to delete Start and line 4 as well.');
  const r = ok(F.removeNode(code, 'A', true));
  assert.equal(r.code, 'flowchart LR\n  B --> C\n');
  assert.deepEqual(r.also, { deleted: { click: 1 }, updated: {}, lines: [3] });
  // A class named like the node is not a reference: classDef lines are never touched.
  const named = 'flowchart LR\n  Start --> B\n  classDef Start fill:#f00\n  linkStyle 0 stroke:#00f\n  B --> C\n';
  assert.equal(ok(F.removeNode(named, 'Start')).code, 'flowchart LR\n  classDef Start fill:#f00\n  B --> C\n');
  // Text over several lines goes as a whole; descriptions are not references.
  const block = 'flowchart LR\n  A --> B\n  accDescr: A is the start\n  A -- first\n  second --> B\n  B --> C\n';
  const two = refused(F.removeNode(block, 'A'), 'confirm');
  assert.match(two, /^Line 4 also names A/);
  assert.equal(ok(F.removeNode(block, 'A', true)).code, 'flowchart LR\n  accDescr: A is the start\n  B --> C\n');
});

test('classes are kept through edits', () => {
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

// Labels the owner asked for, and the awkward ones: every one is accepted, written with Mermaid's
// codes where needed, and reads back as typed.
export const AWKWARD = [
  'say "hi"', 'A -> B', '1 < 2', 'a > b', '<b>bold</b>', '<img src=x onerror=alert(1)>', '"]; click A call alert(1)', 'R&D;', '#tag;',
  '`code`', 'direction LR', "it's & more", '50% off', 'a "b" c', 'x]', '(y)', '{z}', 'a|b', '--> B', '%% no', 'end', 'subgraph x',
  'click A href "javascript:alert(1)"', '&amp; &lt;', '#quot; #35;', 'style:x#y z;', 'classDef a:b#c;', 'go direction TB now',
  'This label is a long sentence of about one hundred and twenty characters, to see that wrapping keeps every word.', 'Ünïcödé 日本語 текст', 'Ship it 🚀',
];

test('labels: only empty labels and line breaks are refused', () => {
  assert.equal(F.labelProblem(''), 'Enter a label.');
  assert.equal(F.labelProblem('  ', true), null);
  assert.equal(F.labelProblem('two\nlines'), 'A label has to fit on one line.');
  for (const label of AWKWARD) assert.equal(F.labelProblem(label), null, label);
});

test('labels: the encoding table', () => {
  const table = [
    ['say "hi"', 'say #quot;hi#quot;'], ['A -> B', 'A -#gt; B'], ['1 < 2', '1 #lt; 2'], ['<b>', '#lt;b#gt;'], ['R&D;', 'R#38;D;'], ['&quot;', '#38;quot;'],
    ['a & b', 'a & b'], ['&#12;', '#38;#35;12;'], ['#tag;', '#35;tag;'], ['#1 ok', '#1 ok'], ['50% off', '50% off'], ['`code`', '#96;code`'],
    ['a `b`', 'a `b`'], ['direction LR', 'direction#32;LR'], ['redirection TD x', 'redirection#32;TD x'], ['direction up', 'direction up'],
    ['style:x#y z;', 'style#58;x#y z;'], ['style:x#y;', 'style#58;x#35;y;'], ['a: b', 'a: b'], ["it's", "it's"], ['%% no', '%% no'], ['x]', 'x]'],
  ];
  for (const [typed, written] of table) assert.equal(F.encodeLabel(typed), written, typed);
  for (const [typed, written] of table) assert.equal(F.decodeLabel(written), typed, written);
  // Codes Mermaid draws as their character are read as it; other named codes stay as written.
  assert.equal(F.decodeLabel('#lt;#gt;#amp;#quot;#9829;#128512;#nbsp;#0;'), '<>&"♥😀#nbsp;#0;');
});

test('labels: every awkward label is written, reads back as typed, and a second edit does not encode twice', () => {
  const base = CORPUS.editorDefault;
  for (const label of AWKWARD) {
    const node = ok(F.addNode(base, { label }));
    assert.equal(F.findNode(F.parseFlowchart(node.code), node.id).label, label, `node: ${label}`);
    // Unchanged: nothing is rewritten. Changed and changed back: the same text as the first time.
    assert.equal(ok(F.updateNode(node.code, node.id, { label })).code, node.code, `no-op: ${label}`);
    const twice = ok(F.updateNode(ok(F.updateNode(node.code, node.id, { label: 'other' })).code, node.id, { label }));
    assert.equal(twice.code, node.code, `again: ${label}`);
    const icon = ok(F.addNode(base, { label, icon: 'demo:run-service' }));
    assert.equal(F.findNode(F.parseFlowchart(icon.code), icon.id).label, label, `icon node: ${label}`);
    const edge = ok(F.addEdge(base, { from: 'D', to: 'A', label }));
    const em = F.parseFlowchart(edge.code);
    assert.equal(F.findEdge(em, edge.key).label, label, `edge: ${label}`);
    assert.equal(ok(F.updateEdge(edge.code, edge.key, { label })).code, edge.code, `edge no-op: ${label}`);
    const sub = ok(F.addSubgraph(base, { title: label }));
    assert.equal(F.findSubgraph(F.parseFlowchart(sub.code), sub.id).title, label, `subgraph: ${label}`);
    // What is written never adds a node, an edge or a line, and never reads as a click or a style.
    const m = F.parseFlowchart(node.code);
    assert.equal(m.nodes.length, 5, label);
    assert.deepEqual(m.unmanaged, [], label);
  }
  // Text written by hand with codes reads as the characters Mermaid draws.
  const hand = F.parseFlowchart('flowchart LR\n  A["say #quot;hi#quot; #lt;b#gt;"] -->|"#35;1 #amp; 2"| B');
  assert.deepEqual([hand.nodes[0].label, hand.edges[0].label], ['say "hi" <b>', '#1 & 2']);
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

test('random edit sequences: 600 sequences over the corpus (styled ones included) read back, keep unmanaged lines and move attached ones', () => {
  const rand = rng(20261126);
  let steps = 0;
  let inverses = 0;
  let attached = 0;
  const names = Object.keys(CORPUS);
  for (let s = 0; s < 600; s++) {
    const name = names[s % names.length];
    let code = CORPUS[name];
    let keep = kept(F.parseFlowchart(code));
    for (let n = 0; n < 8; n++) {
      const [op, r] = randomEdit(F, code, rand, n);
      if (!r.ok) {
        assert.ok(r.error.message, `${name} #${s} ${op}: refusal has a message`);
        continue;
      }
      const after = F.parseFlowchart(r.code);
      assert.ok(after, `${name} #${s} ${op}: reads back`);
      const was0 = F.parseFlowchart(code);
      assert.deepEqual(kept(after).sort(), without(keep, droppedDirections(was0, after)).sort(), `${name} #${s} ${op}: unmanaged lines kept\n${r.code}`);
      keep = kept(after);
      // Attached lines follow: what left the diagram left their lists, nothing else changed.
      const was = F.parseFlowchart(code);
      const twins = new Set(was.edges.map((e) => `${e.from}>${e.to}`)).size < was.edges.length;
      if (!twins) {
        const goneIds = [...was.nodes.map((x) => x.id), ...was.subgraphs.map((g) => g.key)].filter((id) => !F.findNode(after, id) && !F.findSubgraph(after, id));
        const left = after.edges.map((e) => `${e.from}>${e.to}`);
        const goneEdges = was.edges.map((e) => `${e.from}>${e.to}`).filter((e) => { const k = left.indexOf(e); if (k === -1) return true; left.splice(k, 1); return false; });
        if (op !== 'move' && op !== 'removeSubgraph' && op !== 'addSubgraph') assert.deepEqual(attachedView(after), attachedWithout(attachedView(was), goneIds, goneEdges), `${name} #${s} ${op}: attached lines follow\n${code}\n---\n${r.code}`);
        attached++;
      }
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
  assert.ok(attached > 2000, `${attached} attached-line checks`);
});
