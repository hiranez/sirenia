/**
 * The visual builder's view of a flowchart (`flowchart` or `graph`), and its edits. Pure functions, so
 * they also run under `node --test`.
 *
 * Mermaid's flowchart grammar is large; this reads a clearly defined part of it and leaves the rest
 * alone. The text is split into statements (lines, and `;` between statements on one line). A
 * statement is managed when it is one of:
 *   header        flowchart LR | graph TD;              (the direction is optional)
 *   nodes         A | A[Label] | A("Label") | A@{ icon: "p:x", label: "Label" } | A:::cls
 *   chain         A --> B | A -->|Yes| B | A -- Yes --> B | A[Start] --> B{Ask} -.-> C
 *                 (any number of links; `A & B --> C` is read, but only its nodes can be edited)
 *   subgraph      subgraph id [Title] | subgraph id["Title"] | subgraph id | subgraph Two words
 *   end
 * Everything else (style, classDef, class, linkStyle, click, direction, markdown strings, edge ids,
 * unknown shapes, anything the reader is not sure about) is `other`: kept byte for byte and never
 * rewritten. On a line with one statement the reader does not know, every statement of the line is
 * left alone, because `;` inside unknown syntax may not separate statements.
 *
 * The rules that need the whole diagram follow Mermaid's flowchart database: a node belongs to the
 * first subgraph, in the order the subgraphs end, whose own statements mention it; the last label or
 * shape given to a node wins; edges are numbered in text order (linkStyle uses those numbers).
 *
 * Every edit returns new text that differs from the old only where it had to, and checks its own
 * result: the new text must read back with exactly the intended change, and every statement the
 * builder does not manage must be unchanged. Errors are values, never exceptions.
 */
import { scanDiagram, uniqueId } from './iconPicker.ts';

export type FlowDirection = 'TB' | 'TD' | 'BT' | 'LR' | 'RL';
export const FLOW_DIRECTIONS: readonly { value: FlowDirection; label: string }[] = [
    { value: 'TD', label: 'Top to bottom' },
    { value: 'BT', label: 'Bottom to top' },
    { value: 'LR', label: 'Left to right' },
    { value: 'RL', label: 'Right to left' },
];

export type ShapeName =
    | 'rect' | 'rounded' | 'stadium' | 'subroutine' | 'cylinder' | 'circle' | 'double-circle' | 'diamond' | 'hexagon'
    | 'lean-right' | 'lean-left' | 'trapezoid' | 'inv-trapezoid' | 'flag';

/** The bracket shapes, in the order the form offers them. */
export const SHAPES: readonly { name: ShapeName; label: string; open: string; close: string }[] = [
    { name: 'rect', label: 'Rectangle', open: '[', close: ']' },
    { name: 'rounded', label: 'Rounded', open: '(', close: ')' },
    { name: 'stadium', label: 'Stadium', open: '([', close: '])' },
    { name: 'subroutine', label: 'Subroutine', open: '[[', close: ']]' },
    { name: 'cylinder', label: 'Cylinder', open: '[(', close: ')]' },
    { name: 'circle', label: 'Circle', open: '((', close: '))' },
    { name: 'double-circle', label: 'Double circle', open: '(((', close: ')))' },
    { name: 'diamond', label: 'Diamond', open: '{', close: '}' },
    { name: 'hexagon', label: 'Hexagon', open: '{{', close: '}}' },
    { name: 'lean-right', label: 'Parallelogram', open: '[/', close: '/]' },
    { name: 'lean-left', label: 'Parallelogram (leaning left)', open: '[\\', close: '\\]' },
    { name: 'trapezoid', label: 'Trapezoid', open: '[/', close: '\\]' },
    { name: 'inv-trapezoid', label: 'Trapezoid (upside down)', open: '[\\', close: '/]' },
    { name: 'flag', label: 'Flag', open: '>', close: ']' },
];
const shapeOf = (name: ShapeName) => SHAPES.find((s) => s.name === name)!;

export type Stroke = 'normal' | 'thick' | 'dotted' | 'invisible';
export type StartHead = '' | '<' | 'x' | 'o';
export type EndHead = '' | '>' | 'x' | 'o';
/** The four kinds of line the builder writes. */
export type LineStyle = 'arrow' | 'line' | 'dotted' | 'thick';
export const LINE_STYLES: readonly { value: LineStyle; label: string; token: string }[] = [
    { value: 'arrow', label: 'Arrow', token: '-->' },
    { value: 'line', label: 'Line', token: '---' },
    { value: 'dotted', label: 'Dotted arrow', token: '-.->' },
    { value: 'thick', label: 'Thick arrow', token: '==>' },
];

export interface DataPair {
    key: string;
    /** Offsets in the line: the whole `key: value`, and the value. */
    start: number; end: number; valueStart: number; valueEnd: number;
    value: string;
}
/** An `@{ … }` block on one line. `pairs` is null when it is not a flat list of `key: value`. */
export interface ShapeData {
    start: number; end: number;
    pairs: DataPair[] | null;
}

export interface NodeRef {
    id: string;
    /** Offsets in the statement's line: the whole reference (id, shape or data, class). */
    start: number; end: number;
    shape: ShapeName | null;
    /** The bracket label: as written between the brackets, and as Mermaid shows it. */
    text: { raw: string; value: string } | null;
    data: ShapeData | null;
    /** `:::name` as written, or ''. */
    cls: string;
}

export interface Link {
    /** Offsets of everything between two node groups: spaces, the arrow and its label. */
    start: number; end: number;
    stroke: Stroke;
    startHead: StartHead;
    endHead: EndHead;
    label: string | null;
    form: 'plain' | 'pipe' | 'inline';
    /** The arrow as written (`-->`, `-.->`; for `-- text -->` both parts). */
    token: string;
    /** The arrow token (without spaces); for `-- text -->`, the whole link without spaces. */
    tokenStart: number; tokenEnd: number;
    /** A pipe label's offsets, from the end of the arrow to after the closing `|`. */
    pipeEnd: number;
}

export type OtherRole = 'unmanaged' | 'direction' | 'accessibility';
interface Base {
    index: number;
    line: number;
    /** Offsets of the statement in its line, without surrounding spaces and `;`. */
    start: number; end: number;
    /** The subgraph statement it is inside, or null. */
    parent: number | null;
}
export type HeaderStatement = Base & { kind: 'header'; keyword: string; direction: string | null; dirStart: number; dirEnd: number };
export type NodesStatement = Base & { kind: 'nodes'; groups: NodeRef[][]; links: Link[] };
export type SubgraphStatement = Base & {
    kind: 'subgraph';
    /** The id as written; null when Mermaid makes one up (subGraph0, …) or the header is not read. */
    written: string | null;
    title: string;
    form: 'id-title' | 'id' | 'title' | 'none' | 'unknown';
    /** Offsets of the part after `subgraph `. */
    restStart: number;
    close: number | null;
};
export type EndStatement = Base & { kind: 'end'; open: number | null };
export type OtherStatement = Base & { kind: 'other'; role: OtherRole };
export type Statement = HeaderStatement | NodesStatement | SubgraphStatement | EndStatement | OtherStatement;

export type LineRole = 'blank' | 'comment' | 'directive' | 'preamble' | 'statements' | 'unmanaged';

export interface FlowNode {
    id: string;
    /** The label Mermaid shows; null means the id is shown. */
    label: string | null;
    shape: ShapeName | 'icon' | 'other';
    icon: string | null;
    /** Statement indexes that mention the node, in text order. */
    mentions: number[];
    /** The reference that defines the label and shape (the last one that has any), or null. */
    def: { statement: number; ref: NodeRef } | null;
    /** How many references carry a definition. */
    defCount: number;
    parent: string | null;
}
export interface FlowEdge {
    /** Stable while the text changes elsewhere: from, to and the number of earlier edges between them. */
    key: string;
    /** The id Mermaid gives the edge in the SVG (L_from_to_n). */
    domId: string;
    from: string; to: string;
    statement: number;
    link: number;
    /** Written with `&` together with other edges: its label and line cannot be changed here. */
    shared: boolean;
    stroke: Stroke; startHead: StartHead; endHead: EndHead;
    label: string | null;
}
export interface FlowSubgraph {
    /** The id Mermaid uses; for a header the reader does not understand, a made-up key. */
    key: string;
    id: string | null;
    title: string;
    statement: number;
    close: number | null;
    parent: string | null;
    managed: boolean;
}

export interface FlowchartModel {
    /** `code.split('\n')`; joined with '\n' they give the code back. */
    lines: string[];
    header: number;
    statements: Statement[];
    lineRoles: LineRole[];
    direction: string | null;
    nodes: FlowNode[];
    edges: FlowEdge[];
    subgraphs: FlowSubgraph[];
    /** Lines with statements the builder keeps but does not edit. */
    unmanaged: number[];
    /** The highest edge number a linkStyle line names; -1 when none does. */
    linkStyleMax: number;
}

export type EditErrorCode = 'not-flowchart' | 'label' | 'icon' | 'parent' | 'cycle' | 'endpoint' | 'not-found' | 'in-use' | 'unmanaged' | 'duplicate' | 'invalid';
export interface EditError { code: EditErrorCode; message: string }
export type EditResult = { ok: true; code: string; id?: string; key?: string } | { ok: false; error: EditError };

// ---- reading ----------------------------------------------------------------------------------------

const stripCr = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);
const ID_RE = /[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*/y;
const CLASS_RE = /:::([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*)/y;
// Keywords the lexer reads before a node id (case-sensitive, as in Mermaid's lexer).
const KEYWORDS = ['style', 'default', 'linkStyle', 'interpolate', 'classDef', 'class', 'graph', 'flowchart', 'flowchart-elk',
    'swimlane-beta', 'subgraph', 'end', '_self', '_blank', '_parent', '_top', 'v'];
// The lexer's rule for `direction TB` matches anywhere on a line, labels included.
const DIRECTION_RULE = /direction\s+(?:TB|BT|RL|LR|TD)/;

function isId(id: string): boolean {
    if (KEYWORDS.some((k) => id === k || id.startsWith(`${k}-`))) return false;
    return !['call', 'href', 'click', 'accTitle', 'accDescr'].includes(id);
}

const sticky = (re: RegExp, s: string, at: number) => {
    re.lastIndex = at;
    return re.exec(s);
};

/** Whether a node id may end at `at`: Mermaid would not read the next character as part of the id. */
function idEndsAt(s: string, at: number): boolean {
    if (at >= s.length) return true;
    const c = s[at];
    if (/[\s[({>]/.test(c) || s.startsWith('@{', at) || s.startsWith(':::', at) || c === '<') return true;
    if (c === '-') return s[at + 1] === '-' || s[at + 1] === '.';
    if (c === '=') return s[at + 1] === '=';
    if (c === '~') return s.startsWith('~~~', at);
    return false;
}

// Bracket openers, longest first; `[|` and `(-` belong to shapes the reader does not manage.
const OPENERS: readonly [string, ShapeName[]][] = [
    ['(((', ['double-circle']], ['((', ['circle']], ['([', ['stadium']], ['(', ['rounded']],
    ['[[', ['subroutine']], ['[(', ['cylinder']], ['[/', ['lean-right', 'trapezoid']], ['[\\', ['lean-left', 'inv-trapezoid']],
    ['[', ['rect']], ['{{', ['hexagon']], ['{', ['diamond']], ['>', ['flag']],
];
// Text inside brackets without quotes: no brackets, pipes or quotes (the lexer reads those as tokens).
const PLAIN_TEXT = /^[^[\](){}|"]+$/;

/** A bracket shape and its label at `at` (just after the id), or null. */
function readShape(s: string, at: number): { shape: ShapeName; raw: string; value: string; end: number } | null {
    for (const [open, shapes] of OPENERS) {
        if (!s.startsWith(open, at)) continue;
        if (s.startsWith('[|', at) || s.startsWith('(-', at)) return null;
        const from = at + open.length;
        for (const shape of shapes) {
            const close = shapeOf(shape).close;
            let raw: string;
            let end: number;
            if (s[from] === '"') {
                const q = s.indexOf('"', from + 1);
                if (q === -1 || s[from + 1] === '`' || !s.startsWith(close, q + 1)) continue;
                raw = s.slice(from, q + 1);
                end = q + 1 + close.length;
            } else {
                const stop = s.indexOf(close, from);
                if (stop === -1) continue;
                raw = s.slice(from, stop);
                // In a trapezoid `/` or `\` before `]` ends the text; elsewhere they are text.
                const trap = open === '[/' || open === '[\\';
                if (!PLAIN_TEXT.test(raw) || raw.includes('~~~') || raw.includes('@') || (trap && /[/\\]/.test(raw))) continue;
                if (open === '(' && raw.startsWith('-')) continue;
                end = stop + close.length;
            }
            const value = raw.startsWith('"') ? raw.slice(1, -1) : raw.trim();
            if (value.trim() === '') return null;
            return { shape, raw, value, end };
        }
        return null;
    }
    return null;
}

/** `@{ … }` at `at` (pointing at `@`): one line, up to the first `}` outside quotes. */
function readData(s: string, at: number): ShapeData | null {
    let i = at + 2;
    for (; i < s.length && s[i] !== '}'; i++) {
        if (s[i] === '"') {
            const q = s.indexOf('"', i + 1);
            if (q === -1) return null;
            i = q;
        }
    }
    if (i >= s.length) return null;
    const bodyStart = at + 2;
    const body = s.slice(bodyStart, i);
    return { start: at, end: i + 1, pairs: readPairs(body, bodyStart) };
}

/** A flat `key: value, key: "value"` list; null for anything else (nested YAML, flow sequences). */
function readPairs(body: string, offset: number): DataPair[] | null {
    if (/[[\]{}\n]/.test(body.replace(/"[^"]*"|'[^']*'/g, '""'))) return null;
    const parts: [number, number][] = [];
    let from = 0;
    for (let i = 0; i <= body.length; i++) {
        const c = body[i];
        if (c === '"' || c === "'") {
            const q = body.indexOf(c, i + 1);
            if (q === -1) return null;
            i = q;
        } else if (c === ',' || i === body.length) {
            parts.push([from, i]);
            from = i + 1;
        }
    }
    const pairs: DataPair[] = [];
    for (const [a, b] of parts) {
        const piece = body.slice(a, b);
        if (piece.trim() === '' && parts.length === 1) return [];
        const m = /^(\s*)([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/.exec(piece);
        if (!m) return null;
        const valueRaw = m[3];
        const valueAt = a + piece.indexOf(valueRaw, m[1].length + m[2].length);
        let value: string;
        if (valueRaw.startsWith('"')) {
            if (!valueRaw.endsWith('"') || valueRaw.length < 2) return null;
            // YAML double quotes: only the backslash escapes the builder writes are read.
            const inner = valueRaw.slice(1, -1);
            if (/\\[^\\]/.test(inner.replace(/\\\\/g, ''))) return null;
            value = inner.replace(/\\\\/g, '\\');
        } else if (valueRaw.startsWith("'")) {
            if (!valueRaw.endsWith("'") || valueRaw.length < 2) return null;
            value = valueRaw.slice(1, -1).replace(/''/g, "'");
        } else {
            value = valueRaw;
        }
        const start = offset + a + m[1].length;
        pairs.push({ key: m[2], start, end: offset + a + piece.trimEnd().length, valueStart: offset + valueAt, valueEnd: offset + valueAt + valueRaw.length, value });
    }
    return pairs;
}

function readRef(s: string, at: number): NodeRef | null {
    const m = sticky(ID_RE, s, at);
    if (!m || !isId(m[0])) return null;
    const id = m[0];
    let i = at + id.length;
    if (!idEndsAt(s, i)) return null;
    let shape: ShapeName | null = null;
    let text: NodeRef['text'] = null;
    let data: ShapeData | null = null;
    if (s.startsWith('@{', i)) {
        data = readData(s, i);
        if (!data) return null;
        i = data.end;
    } else if (/[[({>]/.test(s[i] ?? '')) {
        const read = readShape(s, i);
        if (!read) return null;
        shape = read.shape;
        text = { raw: read.raw, value: read.value };
        i = read.end;
    }
    let cls = '';
    if (s.startsWith(':::', i)) {
        const c = sticky(CLASS_RE, s, i);
        if (!c || !idEndsAt(s, i + c[0].length)) return null;
        cls = c[0];
        i += cls.length;
    }
    return { id, start: at, end: i, shape, text, data, cls };
}

interface LinkRule { re: RegExp; stroke: Stroke; text: boolean; end?: RegExp; char?: RegExp }
// The lexer's link rules, in its order; `text` rules start a `-- text -->` link.
const END_NORMAL = /\s*([xo<]?)(--+)([-xo>])\s*/y;
const END_THICK = /\s*([xo<]?)(==+)([=xo>])\s*/y;
const END_DOTTED = /\s*([xo<]?)(-?\.+-)([xo>]?)\s*/y;
const LINK_RULES: readonly LinkRule[] = [
    { re: END_NORMAL, stroke: 'normal', text: false },
    { re: /\s*([xo<]?)--\s*/y, stroke: 'normal', text: true, end: END_NORMAL, char: /[^-]|-(?!-)/y },
    { re: END_THICK, stroke: 'thick', text: false },
    { re: /\s*([xo<]?)==\s*/y, stroke: 'thick', text: true, end: END_THICK, char: /[^=]/y },
    { re: END_DOTTED, stroke: 'dotted', text: false },
    { re: /\s*([xo<]?)-\.\s*/y, stroke: 'dotted', text: true, end: END_DOTTED, char: /[^.]/y },
    { re: /\s*(~~~+)\s*/y, stroke: 'invisible', text: false },
];

function heads(startChar: string, endToken: string): { startHead: StartHead; endHead: EndHead } {
    const last = endToken.at(-1)!;
    const endHead = (last === '>' || last === 'x' || last === 'o' ? last : '') as EndHead;
    return { startHead: (['<', 'x', 'o'].includes(startChar) ? startChar : '') as StartHead, endHead };
}

/** A link at `at` (right after a node group), or null. */
function readLink(s: string, at: number): Link | null {
    for (const rule of LINK_RULES) {
        const m = sticky(rule.re, s, at);
        if (!m) continue;
        const tokenStart = at + m[0].length - m[0].trimStart().length;
        if (!rule.text) {
            const token = m[0].trim();
            const h = rule.stroke === 'invisible' ? { startHead: '' as StartHead, endHead: '' as EndHead } : heads(m[1], token);
            let i = at + m[0].length;
            const tokenEnd = tokenStart + token.length;
            if (s[i] !== '|') return { start: at, end: i, stroke: rule.stroke, ...h, label: null, form: 'plain', token, tokenStart, tokenEnd, pipeEnd: tokenEnd };
            // `|text|` or `|"text"|`, then spaces.
            let label: string;
            let close: number;
            if (s[i + 1] === '"') {
                const q = s.indexOf('"', i + 2);
                if (q === -1 || s[i + 2] === '`' || s[q + 1] !== '|') return null;
                label = s.slice(i + 2, q);
                close = q + 1;
            } else {
                close = s.indexOf('|', i + 1);
                if (close === -1) return null;
                const raw = s.slice(i + 1, close);
                if (!PLAIN_TEXT.test(raw) || raw.includes('~~~') || raw.includes('@')) return null;
                label = raw.trim();
            }
            if (label.trim() === '') return null;
            i = close + 1;
            while (i < s.length && /\s/.test(s[i])) i++;
            return { start: at, end: i, stroke: rule.stroke, ...h, label, form: 'pipe', token, tokenStart, tokenEnd, pipeEnd: close + 1 };
        }
        // `-- text -->`: characters up to the first closing arrow, as the lexer reads them.
        let i = at + m[0].length;
        let label: string;
        if (s[i] === '"') {
            const q = s.indexOf('"', i + 1);
            if (q === -1 || s[i + 1] === '`') return null;
            label = s.slice(i + 1, q);
            i = q + 1;
            if (!sticky(rule.end!, s, i)) return null;
        } else {
            const from = i;
            while (i < s.length && !sticky(rule.end!, s, i)) {
                if (s[i] === '"' || !sticky(rule.char!, s, i)) return null;
                i++;
            }
            if (i >= s.length) return null;
            label = s.slice(from, i).trim();
            if (label.includes('~~~') || label.includes('@') || label.includes('|')) return null;
        }
        const end = sticky(rule.end!, s, i)!;
        if (label.trim() === '') return null;
        const token = `${m[0].trim()} ${end[0].trim()}`;
        const h = heads(m[1], end[0].trim());
        const tokenEnd = i + end[0].trimEnd().length;
        return { start: at, end: i + end[0].length, stroke: rule.stroke, ...h, label, form: 'inline', token, tokenStart, tokenEnd, pipeEnd: tokenEnd };
    }
    return null;
}

/** A statement of nodes and links (from `at` to `stop`), or null when any part is not read. */
function readNodes(s: string, at: number, stop: number): { groups: NodeRef[][]; links: Link[] } | null {
    const text = s.slice(0, stop);
    const groups: NodeRef[][] = [];
    const links: Link[] = [];
    let i = at;
    const group = (): boolean => {
        const refs: NodeRef[] = [];
        for (;;) {
            const ref = readRef(text, i);
            if (!ref) return false;
            refs.push(ref);
            i = ref.end;
            const amp = /\s*&\s*/y;
            const m = sticky(amp, text, i);
            if (!m) break;
            i += m[0].length;
        }
        groups.push(refs);
        return true;
    };
    if (!group()) return null;
    while (text.slice(i).trim() !== '') {
        // Spaces before an arrow belong to the link: the lexer's link rules start with \s*.
        const link = readLink(text, i);
        if (!link) return null;
        links.push(link);
        i = link.end;
        if (!group()) return null;
    }
    return { groups, links };
}

/** `subgraph …` (the statement text from `at`): its id as written, title and form. */
function readSubgraph(s: string, at: number, stop: number): Pick<SubgraphStatement, 'written' | 'title' | 'form' | 'restStart'> {
    const restStart = at + 'subgraph'.length;
    const rest = s.slice(restStart, stop).trim();
    const restAt = s.indexOf(rest, restStart);
    if (rest === '') return { written: null, title: '', form: 'none', restStart };
    const id = sticky(ID_RE, rest, 0)?.[0];
    if (id && isId(id)) {
        if (id === rest) return { written: id, title: id, form: 'id', restStart: restAt };
        const m = /^\s*\[(.*)\]$/.exec(rest.slice(id.length));
        if (m) {
            const inner = m[1];
            if (/^"[^"]*"$/.test(inner) && inner[1] !== '`' && inner.length > 2) return { written: id, title: inner.slice(1, -1), form: 'id-title', restStart: restAt };
            if (PLAIN_TEXT.test(inner) && inner.trim() !== '' && !inner.includes('@')) return { written: id, title: inner.trim(), form: 'id-title', restStart: restAt };
        }
    }
    // Words without an id: Mermaid makes an id up when there is a space (subGraph0, subGraph1, …).
    if (/^[\p{L}\p{N}_]+(?:[ \t]+[\p{L}\p{N}_]+)+$/u.test(rest) && rest.split(/\s+/).every((w) => isId(w) || !/^[\w-]+$/.test(w))) {
        return { written: null, title: rest, form: 'title', restStart: restAt };
    }
    return { written: null, title: rest, form: 'unknown', restStart: restAt };
}

/** Offsets of the statements of a line: split at `;` outside quotes, brackets, pipes and `@{ }`. */
function splitStatements(s: string): [number, number][] {
    const out: [number, number][] = [];
    let depth = 0;
    let pipe = false;
    let from = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '"') {
            const q = s.indexOf('"', i + 1);
            if (q === -1) break;
            i = q;
        } else if (c === '[' || c === '(' || c === '{') depth++;
        else if ((c === ']' || c === ')' || c === '}') && depth > 0) depth--;
        else if (c === '|' && depth === 0) pipe = !pipe;
        else if (c === ';' && depth === 0 && !pipe) {
            out.push([from, i]);
            from = i + 1;
        }
    }
    out.push([from, s.length]);
    // Trimmed, without the empty ones (`A-->B;` ends in an empty statement).
    return out.flatMap(([a, b]) => {
        const piece = s.slice(a, b);
        if (piece.trim() === '') return [];
        const lead = piece.length - piece.trimStart().length;
        return [[a + lead, a + lead + piece.trim().length] as [number, number]];
    });
}

const HEADER_RE = /^(graph|flowchart-elk|flowchart)(?:([\t ]+)(\S+))?$/;
const OTHER_START = /^(?:style|classDef|class|linkStyle|click|interpolate|default|direction|title|call|href)\b/;

/** The builder's model of `code`, or null when it is not a flowchart. */
export function parseFlowchart(code: string): FlowchartModel | null {
    const lines = code.split('\n');
    const { kind, header } = scanDiagram(lines);
    if (kind !== 'flowchart') return null;

    const statements: Statement[] = [];
    const lineRoles: LineRole[] = [];
    const stack: number[] = [];
    let block: { role: LineRole; close: (t: string) => boolean } | null = null;
    const push = (st: Unplaced<Statement>) => {
        const full = { ...st, index: statements.length, parent: stack.at(-1) ?? null } as Statement;
        statements.push(full);
        return full;
    };

    lines.forEach((raw, i) => {
        const text = stripCr(raw);
        const trimmed = text.trim();
        if (block) {
            lineRoles.push(block.role);
            if (block.close(text)) block = null;
            return;
        }
        if (i < header) return lineRoles.push(trimmed === '' ? 'blank' : /^%%(?!\{)/.test(trimmed) ? 'comment' : 'preamble');
        if (i > header && trimmed === '') return lineRoles.push('blank');
        if (i > header && trimmed.startsWith('%%{')) {
            if (!text.includes('}%%')) block = { role: 'directive', close: (t) => t.includes('}%%') };
            return lineRoles.push('directive');
        }
        if (i > header && trimmed.startsWith('%%')) return lineRoles.push('comment');
        if (i > header && /^accDescr[\t ]*\{/.test(trimmed)) {
            if (!trimmed.includes('}')) block = { role: 'unmanaged', close: (t) => t.includes('}') };
            push({ kind: 'other', role: 'accessibility', line: i, start: text.indexOf(trimmed), end: text.indexOf(trimmed) + trimmed.length });
            return lineRoles.push('unmanaged');
        }
        // Text that goes on to the next line (an `@{` block, a markdown string): left alone up to its end.
        const openData = /@\{[^}]*$/.test(text.replace(/"[^"]*"/g, '""'));
        const openMarkdown = (text.match(/"`/g)?.length ?? 0) > (text.match(/`"/g)?.length ?? 0);
        if (i > header && (openData || openMarkdown)) {
            block = openData ? { role: 'unmanaged', close: (t) => t.includes('}') } : { role: 'unmanaged', close: (t) => t.includes('`"') };
            push({ kind: 'other', role: 'unmanaged', line: i, start: text.indexOf(trimmed), end: text.indexOf(trimmed) + trimmed.length });
            return lineRoles.push('unmanaged');
        }

        const spans = splitStatements(text);
        // Read every statement first; one the reader does not know makes the whole line unknown.
        const read = spans.map(([a, b], k) => readStatement(text, a, b, i === header && k === 0));
        const lineKnown = read.every((r) => r.kind !== 'other' || r.role !== 'unmanaged') && !(i !== header && DIRECTION_RULE.test(text) && read.some((r) => r.kind !== 'other'));
        for (const [k, r] of read.entries()) {
            const [a, b] = spans[k];
            const st = lineKnown || r.kind === 'header' || r.kind === 'end' || r.kind === 'subgraph'
                ? r
                : { kind: 'other' as const, role: 'unmanaged' as const };
            if (st.kind === 'subgraph' && !lineKnown) st.form = 'unknown';
            if (st.kind === 'end') {
                const open = stack.pop() ?? null;
                // Pushed after the pop: the `end` belongs to the subgraph's parent level.
                const end = push({ ...st, open, line: i, start: a, end: b } as Unplaced<EndStatement>);
                if (open !== null) (statements[open] as SubgraphStatement).close = end.index;
                continue;
            }
            const full = push({ ...st, line: i, start: a, end: b } as Unplaced<Statement>);
            if (full.kind === 'subgraph') stack.push(full.index);
        }
        lineRoles.push(lineKnown ? 'statements' : 'unmanaged');
    });

    // `e1@{ animate: true }` is data for the edge with id e1, not a node.
    const edgeIds = new Set(lines.flatMap((l) => [...l.replace(/"[^"]*"/g, '""').matchAll(/([A-Za-z0-9_-]+)@(?![{"])/g)].map((m) => m[1])));
    for (const [k, st] of statements.entries()) {
        if (st.kind === 'nodes' && st.groups.flat().some((r) => edgeIds.has(r.id))) {
            statements[k] = { index: st.index, line: st.line, start: st.start, end: st.end, parent: st.parent, kind: 'other', role: 'unmanaged' };
        }
    }
    const headerStatement = statements.find((s) => s.kind === 'header') as HeaderStatement | undefined;
    const model: FlowchartModel = {
        lines, header, statements, lineRoles,
        direction: headerStatement?.direction ?? null,
        nodes: [], edges: [], subgraphs: [], unmanaged: [], linkStyleMax: -1,
    };
    derive(model);
    return model;
}

type Unplaced<T> = T extends unknown ? Omit<T, 'index' | 'parent'> : never;
type ReadStatement =
    | Omit<HeaderStatement, keyof Base>
    | Omit<NodesStatement, keyof Base>
    | Omit<SubgraphStatement, keyof Base>
    | Omit<EndStatement, keyof Base>
    | Omit<OtherStatement, keyof Base>;

function readStatement(text: string, a: number, b: number, isHeader: boolean): ReadStatement {
    const s = text.slice(a, b);
    if (isHeader) {
        const m = HEADER_RE.exec(s);
        if (!m) return { kind: 'header', keyword: s, direction: null, dirStart: -1, dirEnd: -1 };
        const dirStart = m[3] ? a + m[1].length + m[2].length : a + m[1].length;
        return { kind: 'header', keyword: m[1], direction: m[3] ?? null, dirStart, dirEnd: m[3] ? dirStart + m[3].length : dirStart };
    }
    if (s === 'end') return { kind: 'end', open: null };
    if (/^subgraph(?:[\t ]|$)/.test(s)) return { kind: 'subgraph', ...readSubgraph(text, a, b), close: null };
    if (DIRECTION_RULE.test(s) && /^direction\b/.test(s)) return { kind: 'other', role: 'direction' };
    if (/^acc(?:Title|Descr)\s*:/.test(s)) return { kind: 'other', role: 'accessibility' };
    if (OTHER_START.test(s) || DIRECTION_RULE.test(s)) return { kind: 'other', role: 'unmanaged' };
    // `@` outside quotes and `@{` is an edge id (or worse) to the lexer.
    if (/@(?!\{)/.test(s.replace(/"[^"]*"/g, '""'))) return { kind: 'other', role: 'unmanaged' };
    const nodes = readNodes(text, a, b);
    return nodes ? { kind: 'nodes', ...nodes } : { kind: 'other', role: 'unmanaged' };
}

/** Nodes, edges, subgraphs and the lines that are kept but not managed. */
function derive(model: FlowchartModel): void {
    const { statements } = model;
    const sgs = statements.filter((s): s is SubgraphStatement => s.kind === 'subgraph');
    // Mermaid adds a subgraph when it reaches its `end`, and numbers the made-up ids in that order.
    const byEnd = [...sgs].sort((x, y) => (x.close ?? Infinity) - (y.close ?? Infinity));
    const keyOf = new Map<number, string>();
    byEnd.forEach((sg, n) => {
        const id = sg.form === 'unknown' ? null : sg.written ?? `subGraph${n}`;
        keyOf.set(sg.index, id ?? `:${sg.index}`);
    });
    model.subgraphs = sgs.map((sg) => ({
        key: keyOf.get(sg.index)!,
        id: sg.form === 'unknown' ? null : keyOf.get(sg.index)!,
        title: sg.title,
        statement: sg.index,
        close: sg.close,
        parent: sg.parent === null ? null : keyOf.get(sg.parent)!,
        managed: sg.form !== 'unknown' && sg.close !== null,
    }));
    const sgIds = new Set(model.subgraphs.map((g) => g.id).filter((id): id is string => id !== null));

    const nodes = new Map<string, FlowNode>();
    const pairs = new Map<string, number>();
    for (const st of statements) {
        if (st.kind !== 'nodes') continue;
        for (const ref of st.groups.flat()) {
            if (sgIds.has(ref.id)) continue;
            let node = nodes.get(ref.id);
            if (!node) {
                node = { id: ref.id, label: null, shape: 'rect', icon: null, mentions: [], def: null, defCount: 0, parent: null };
                nodes.set(ref.id, node);
            }
            if (node.mentions.at(-1) !== st.index) node.mentions.push(st.index);
            if (ref.text) {
                node.label = ref.text.value;
                node.shape = ref.shape!;
            }
            if (ref.data) {
                const get = (k: string) => ref.data!.pairs?.find((p) => p.key === k)?.value;
                const icon = get('icon');
                const label = get('label');
                if (ref.data.pairs === null) node.shape = 'other';
                if (get('shape') !== undefined) node.shape = 'other';
                if (icon) {
                    node.icon = icon;
                    node.shape = 'icon';
                }
                if (label) node.label = label;
                else if (icon && node.label === null) node.label = '';
            }
            if (ref.text || ref.data) {
                node.def = { statement: st.index, ref };
                node.defCount++;
            }
        }
        const shared = st.groups.some((g) => g.length > 1);
        st.links.forEach((link, k) => {
            for (const a of st.groups[k]) {
                for (const b of st.groups[k + 1]) {
                    const pair = `${a.id}\u0000${b.id}`;
                    const n = pairs.get(pair) ?? 0;
                    pairs.set(pair, n + 1);
                    model.edges.push({
                        key: JSON.stringify([a.id, b.id, n]), domId: `L_${a.id}_${b.id}_${n === 0 ? 0 : n + 1}`,
                        from: a.id, to: b.id, statement: st.index, link: k, shared,
                        stroke: link.stroke, startHead: link.startHead, endHead: link.endHead, label: link.label,
                    });
                }
            }
        });
    }
    // Membership: subgraphs in the order they end; each claims the nodes its own statements mention.
    for (const sg of byEnd) {
        const key = keyOf.get(sg.index)!;
        for (const st of statements) {
            if (st.parent !== sg.index || st.kind !== 'nodes') continue;
            for (const ref of st.groups.flat()) {
                const node = nodes.get(ref.id);
                if (node && node.parent === null) node.parent = key;
            }
        }
    }
    model.nodes = [...nodes.values()];

    const unmanaged = new Set<number>();
    model.lineRoles.forEach((role, line) => { if (role === 'unmanaged') unmanaged.add(line); });
    for (const st of statements) {
        if (st.kind === 'other') unmanaged.add(st.line);
        if (st.kind === 'header' && st.dirStart === -1) unmanaged.add(st.line);
    }
    model.unmanaged = [...unmanaged].sort((x, y) => x - y);
    for (const st of statements) {
        if (st.kind !== 'other') continue;
        const m = /^linkStyle\s+([\d\s,]+)/.exec(stmtText(model, st));
        if (m) for (const n of m[1].split(/[\s,]+/).filter(Boolean)) model.linkStyleMax = Math.max(model.linkStyleMax, Number(n));
    }
}

export const stmtText = (model: Pick<FlowchartModel, 'lines'>, st: Statement): string => stripCr(model.lines[st.line]).slice(st.start, st.end);

// ---- queries --------------------------------------------------------------------------------------

export const findNode = (model: FlowchartModel, id: string): FlowNode | undefined => model.nodes.find((n) => n.id === id);
export const findSubgraph = (model: FlowchartModel, key: string): FlowSubgraph | undefined => model.subgraphs.find((g) => g.key === key);
export const findEdge = (model: FlowchartModel, key: string): FlowEdge | undefined => model.edges.find((e) => e.key === key);
/** What the builder calls a node: its label, or its id when it shows none. */
export const nodeName = (n: FlowNode): string => n.label || n.id;
export const subgraphName = (g: FlowSubgraph): string => g.title || g.id || 'Subgraph';
/** A node or subgraph by id, named. */
export function itemName(model: FlowchartModel, id: string): string {
    const n = findNode(model, id);
    if (n) return nodeName(n);
    const g = findSubgraph(model, id);
    return g ? subgraphName(g) : id;
}

/** The builder's name for the line of an edge, or null for one it does not write (`<-->`, `--o`, `~~~`, …). */
export function lineStyleOf(e: Pick<FlowEdge, 'stroke' | 'startHead' | 'endHead'>): LineStyle | null {
    if (e.startHead !== '') return null;
    if (e.stroke === 'normal') return e.endHead === '>' ? 'arrow' : e.endHead === '' ? 'line' : null;
    if (e.endHead !== '>') return null;
    return e.stroke === 'dotted' ? 'dotted' : e.stroke === 'thick' ? 'thick' : null;
}

/** The keys of the subgraphs inside subgraph `key`, at any depth. */
export function subgraphsInside(model: FlowchartModel, key: string): Set<string> {
    const found = new Set<string>();
    for (let grew = true; grew;) {
        grew = false;
        for (const g of model.subgraphs) {
            if (g.parent !== null && (g.parent === key || found.has(g.parent)) && !found.has(g.key)) {
                found.add(g.key);
                grew = true;
            }
        }
    }
    return found;
}

export type OutlineItem = { kind: 'subgraph'; subgraph: FlowSubgraph; depth: number } | { kind: 'node'; node: FlowNode; depth: number };

/** Subgraphs with their contents (indented), and nodes, each level in text order. */
export function flowOutline(model: FlowchartModel): OutlineItem[] {
    const keys = new Set(model.subgraphs.map((g) => g.key));
    const out: OutlineItem[] = [];
    const visit = (parent: string | null, depth: number) => {
        const here = [
            ...model.subgraphs.filter((g) => (parent === null ? g.parent === null || !keys.has(g.parent) : g.parent === parent))
                .map((g) => ({ at: g.statement, item: { kind: 'subgraph' as const, subgraph: g, depth } })),
            ...model.nodes.filter((n) => (parent === null ? n.parent === null || !keys.has(n.parent) : n.parent === parent))
                .map((n) => ({ at: n.mentions[0], item: { kind: 'node' as const, node: n, depth } })),
        ].sort((a, b) => a.at - b.at);
        for (const { item } of here) {
            out.push(item);
            if (item.kind === 'subgraph') visit(item.subgraph.key, depth + 1);
        }
    };
    visit(null, 0);
    return out;
}

/** Subgraphs that subgraph `key` (null: a new one) can be placed in: managed ones, not itself or inside it. */
export function subgraphChoices(model: FlowchartModel, key: string | null): FlowSubgraph[] {
    const below = key === null ? new Set<string>() : subgraphsInside(model, key);
    return model.subgraphs.filter((g) => g.managed && g.key !== key && !below.has(g.key));
}

// ---- validation of user input ---------------------------------------------------------------------

const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;
/** A label as it is written: trimmed, runs of spaces as one (Mermaid shows them as one anyway). */
export const normalizeLabel = (label: string): string => label.trim().replace(/\s+/g, ' ');

/**
 * Why `label` cannot be written so that the preview shows exactly this text, or null. The rules come
 * from what Mermaid 11 does with SVG labels: it has no escape for a double quote (`#quot;` shows as
 * `&quot;`), reads `<…>` as markup and drops a lone `>`, turns `#name;` and `&name;` into characters,
 * starts a markdown string at a leading backtick, and reads `direction LR` anywhere on a line.
 * `optional`: empty text means no label.
 */
export function labelProblem(label: string, optional = false): string | null {
    if (LINE_BREAK.test(label.trim())) return 'A label has to fit on one line.';
    const text = normalizeLabel(label);
    if (text === '') return optional ? null : 'Enter a label.';
    if (text.includes('"')) return 'A label cannot contain double quotes ("). Use \' or “ ” instead.';
    if (/[<>]/.test(text)) return 'A label cannot contain < or >.';
    if (/[#&]#?\w+;/.test(text)) return 'A label cannot contain # or & followed by a word and ; (Mermaid reads that as a special character).';
    if (text.startsWith('`')) return 'A label cannot start with `.';
    if (DIRECTION_RULE.test(text)) return 'A label cannot contain “direction” followed by TB, BT, LR, RL or TD.';
    return null;
}

/** Why `icon` is not a pack icon name (`prefix:name`), or null. */
export function iconProblem(icon: string): string | null {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icon) ? null : `"${icon}" is not an icon name. Choose one from an icon pack.`;
}

// ---- writing --------------------------------------------------------------------------------------

/** `id` with a bracket shape and a quoted label (quotes keep punctuation in the label plain text). */
const shapeText = (shape: ShapeName, label: string) => `${shapeOf(shape).open}"${label}"${shapeOf(shape).close}`;
/** Icon labels are markdown unless told otherwise; plain names are written the way the icon picker writes them. */
const needsPlainText = (label: string) => /[*_~`\\]/.test(label) || /^(?:[-+#]|\d+[.)])(?:\s|$)/.test(label);
const yamlString = (text: string) => `"${text.replace(/\\/g, '\\\\')}"`;
const dataText = (icon: string, label: string) =>
    `@{ icon: "${icon}", label: ${yamlString(label)}${needsPlainText(label) ? ', labelType: "text"' : ''} }`;

function arrowToken(stroke: Stroke, startHead: StartHead, endHead: EndHead): string {
    if (stroke === 'invisible') return '~~~';
    if (stroke === 'thick') return `${startHead}=${endHead === '' ? '==' : `=${endHead}`}`;
    if (stroke === 'dotted') return `${startHead}-.-${endHead}`;
    return `${startHead}--${endHead === '' ? '-' : endHead}`;
}
const styleToken = (style: LineStyle) => LINE_STYLES.find((s) => s.value === style)!.token;
const pipeLabel = (label: string | null) => (label ? `|"${label}"|` : '');

/** `from -->|"label"| to`. */
export function edgeStatement(from: string, to: string, style: LineStyle, label: string | null): string {
    return `${from} ${styleToken(style)}${pipeLabel(label)} ${to}`;
}

/** An id for a new node or subgraph, from its label: unique, and never a word Mermaid reads as syntax. */
function flowId(code: string, label: string, fallback: string): string {
    const id = uniqueId(code, label, fallback);
    return isId(id) ? id : uniqueId(code, `${id}_${fallback}`, fallback);
}

// ---- editing machinery ----------------------------------------------------------------------------

const fail = (code: EditErrorCode, message: string): EditResult => ({ ok: false, error: { code, message } });
const NOT_FLOWCHART = fail('not-flowchart', 'The builder works with flowcharts (flowchart or graph).');
const indentOf = (model: FlowchartModel, line: number) => /^[\t ]*/.exec(stripCr(model.lines[line]))![0];
const usesCrlf = (lines: readonly string[]) => lines.some((l) => l.endsWith('\r'));
const statementsOn = (model: FlowchartModel, line: number) => model.statements.filter((s) => s.line === line);
const endsWithSemicolon = (model: FlowchartModel, line: number) => stripCr(model.lines[line]).trimEnd().endsWith(';');

/** Changes to the original lines: span replacements, removed lines, and new lines after a line. */
class Draft {
    private changes: { line: number; start: number; end: number; text: string }[] = [];
    private inserts: { after: number; text: string }[] = [];
    private model: FlowchartModel;
    constructor(model: FlowchartModel) { this.model = model; }

    replace(line: number, start: number, end: number, text: string): void {
        this.changes.push({ line, start, end, text });
    }

    /** Remove a statement with the `;` that separates it from its neighbour; an emptied line goes. */
    remove(st: Statement): void {
        const text = stripCr(this.model.lines[st.line]);
        let j = st.end;
        while (j < text.length && /[\t ]/.test(text[j])) j++;
        if (text[j] === ';') {
            j++;
            while (j < text.length && /[\t ]/.test(text[j])) j++;
            return this.replace(st.line, st.start, j, '');
        }
        let k = st.start;
        while (k > 0 && /[\t ]/.test(text[k - 1])) k--;
        if (k > 0 && text[k - 1] === ';') return this.replace(st.line, k - 1, st.end, '');
        this.replace(st.line, st.start, st.end, '');
    }

    /** A new line after original line `after` (lines inserted after the same line keep their order). */
    insert(after: number, text: string): void {
        this.inserts.push({ after, text });
    }

    /** Replace a statement by several: on its own line, the rest go on new lines below it. */
    replaceWith(st: Statement, pieces: string[]): void {
        if (pieces.length === 0) return this.remove(st);
        if (statementsOn(this.model, st.line).length > 1) return this.replace(st.line, st.start, st.end, pieces.join('; '));
        this.replace(st.line, st.start, st.end, pieces[0]);
        const semi = endsWithSemicolon(this.model, st.line) ? ';' : '';
        for (const piece of pieces.slice(1)) this.insert(st.line, `${indentOf(this.model, st.line)}${piece}${semi}`);
    }

    build(): string {
        const { lines } = this.model;
        const crlf = usesCrlf(lines);
        const out: { text: string; fresh: boolean; last: boolean }[] = [];
        lines.forEach((raw, i) => {
            const cr = raw.endsWith('\r') ? '\r' : '';
            let text = stripCr(raw);
            const mine = this.changes.filter((c) => c.line === i).sort((a, b) => b.start - a.start);
            // Removals next to each other may share a separator: merge overlapping spans.
            let prevStart = Infinity;
            for (const c of mine) {
                const end = Math.min(c.end, prevStart);
                text = text.slice(0, c.start) + c.text + text.slice(Math.max(end, c.start));
                prevStart = c.start;
            }
            const emptied = mine.length > 0 && /^[\s;]*$/.test(text) && stripCr(raw).trim() !== '';
            if (!emptied) out.push({ text: text + cr, fresh: false, last: i === lines.length - 1 });
            for (const ins of this.inserts.filter((x) => x.after === i)) out.push({ text: ins.text + (crlf ? '\r' : ''), fresh: true, last: false });
        });
        // Line endings: the last line has none; a line that stopped being last gets the document's ending.
        out.forEach((entry, k) => {
            const isLast = k === out.length - 1;
            if (isLast && entry.text.endsWith('\r') && (entry.fresh || !entry.last)) entry.text = entry.text.slice(0, -1);
            if (!isLast && entry.last && crlf && !entry.text.endsWith('\r')) entry.text += '\r';
        });
        return out.map((e) => e.text).join('\n');
    }
}

/** Where a new statement goes: inside subgraph `parent` before its `end`, or after the last top-level statement. */
function insertPoint(model: FlowchartModel, parent: string | null): { after: number; indent: string; semi: string } | EditError {
    if (parent !== null) {
        const sg = findSubgraph(model, parent);
        if (!sg || !sg.managed || sg.close === null) return { code: 'parent', message: 'That subgraph is not one the builder can add to.' };
        const open = model.statements[sg.statement];
        const close = model.statements[sg.close];
        if (open.line === close.line) return { code: 'unmanaged', message: `${subgraphName(sg)} is written on one line. Add to it in the Code tab.` };
        const body = model.statements.filter((s) => s.parent === sg.statement && s.line > open.line && s.line < close.line);
        const last = body.at(-1);
        const indent = last ? indentOf(model, last.line) : indentOf(model, open.line) + (indentOf(model, open.line).includes('\t') ? '\t' : '  ');
        const semi = endsWithSemicolon(model, last?.line ?? open.line) ? ';' : '';
        return { after: close.line - 1, indent, semi };
    }
    const top = model.statements.filter((s) => s.parent === null && (s.kind === 'nodes' || s.kind === 'end'));
    const last = top.at(-1);
    const first = model.statements.find((s) => s.kind !== 'header' && s.line !== model.header);
    const anchor = last ? last.line : model.header;
    const indent = last && last.line !== model.header ? indentOf(model, last.line) : first ? indentOf(model, first.line) : '  ';
    return { after: anchor, indent, semi: endsWithSemicolon(model, anchor) ? ';' : '' };
}
const isError = (x: object): x is EditError => 'message' in x;

// What a model says about its nodes, edges and subgraphs, independent of where things are written.
// Subgraphs are named by their path of ids and titles, because made-up ids (subGraph0) can be renumbered.
function pathOf(model: FlowchartModel, key: string | null): string {
    const parts: string[] = [];
    for (let k = key, guard = 0; k !== null && guard < 100; guard++) {
        const g = findSubgraph(model, k);
        if (!g) break;
        const st = model.statements[g.statement] as SubgraphStatement;
        parts.unshift(`${st.written ?? '*'}:${g.title}`);
        k = g.parent;
    }
    return parts.join(' / ');
}
const nodeSig = (model: FlowchartModel, n: FlowNode) => JSON.stringify([n.label, n.shape, n.icon, pathOf(model, n.parent)]);
const edgeSig = (e: FlowEdge) => JSON.stringify([e.from, e.to, e.stroke, e.startHead, e.endHead, e.label]);
export interface Snapshot { nodes: Map<string, string>; edges: string[]; subgraphs: string[] }
export function snapshot(model: FlowchartModel): Snapshot {
    return {
        nodes: new Map(model.nodes.map((n) => [n.id, nodeSig(model, n)])),
        edges: model.edges.map(edgeSig).sort(),
        subgraphs: model.subgraphs.map((g) => pathOf(model, g.key)).sort(),
    };
}
function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
    if (a.nodes.size !== b.nodes.size || [...a.nodes].some(([id, sig]) => b.nodes.get(id) !== sig)) return false;
    return JSON.stringify(a.edges) === JSON.stringify(b.edges) && JSON.stringify(a.subgraphs) === JSON.stringify(b.subgraphs);
}

/** Every line and statement the builder does not edit, as text (a multiset, in order). */
function keptTexts(model: FlowchartModel, withHeader: boolean): string[] {
    const out: string[] = [];
    model.lineRoles.forEach((role, line) => {
        // Indentation is not part of a statement: moving a subgraph re-indents its lines.
        if (role === 'comment' || role === 'directive' || role === 'preamble' || role === 'unmanaged') out.push(stripCr(model.lines[line]).trimStart());
    });
    for (const st of model.statements) {
        if (st.kind === 'other' && model.lineRoles[st.line] !== 'unmanaged') out.push(stmtText(model, st));
        if (st.kind === 'header' && withHeader) out.push(stmtText(model, st));
    }
    return out;
}

const LINK_STYLE_MESSAGE = 'A linkStyle line styles connections by their number, and this change would renumber them. Change that line in the Code tab first.';
const STYLE_RULE = /(?:style|classDef).*:\S*#.*;/;

/**
 * The finished edit: refused unless the new text reads back as a flowchart, keeps every line it does
 * not manage, keeps the numbers linkStyle lines use, and `check` finds the intended change.
 */
function finish(before: FlowchartModel, code: string, check: (after: FlowchartModel) => string | null, extra: { id?: string; key?: string } = {}, header = false): EditResult {
    if (code === before.lines.join('\n')) return { ok: true, code, ...extra };
    const after = parseFlowchart(code);
    if (!after) return fail('invalid', 'The change would break the diagram.');
    if (JSON.stringify(keptTexts(before, !header)) !== JSON.stringify(keptTexts(after, !header))) {
        return fail('unmanaged', 'The change would touch a line the builder does not manage, so it was not made.');
    }
    if (before.linkStyleMax >= 0) {
        for (let i = 0; i <= before.linkStyleMax; i++) {
            const a = before.edges[i];
            const b = after.edges[i];
            if (a && (!b || a.from !== b.from || a.to !== b.to)) return fail('in-use', LINK_STYLE_MESSAGE);
        }
    }
    const oldStyled = new Set(before.lines.filter((l) => STYLE_RULE.test(l)));
    if (after.lines.some((l, i) => STYLE_RULE.test(l) && after.lineRoles[i] === 'statements' && !oldStyled.has(l) && after.statements.some((s) => s.line === i && s.kind === 'nodes'))) {
        return fail('label', 'Mermaid would read this label as a style. Change the text around the colon or #.');
    }
    const problem = check(after);
    if (problem) return fail('invalid', problem);
    return { ok: true, code, ...extra };
}

/** Lines of statements the builder does not manage that name `id` (outside quoted text). */
function namedBy(model: FlowchartModel, id: string): number | null {
    const word = new RegExp(String.raw`(?<![\w-])${id.replace(/[-]/g, '\\-')}(?![\w-])`);
    for (const st of model.statements) {
        if (st.kind !== 'other') continue;
        if (word.test(stmtText(model, st).replace(/"[^"]*"/g, '""'))) return st.line;
    }
    for (const line of model.unmanaged) {
        if (model.statements.some((s) => s.line === line)) continue;
        if (word.test(stripCr(model.lines[line]).replace(/"[^"]*"/g, '""'))) return line;
    }
    return null;
}
/** "Line 3 (style) names Stop." or "Line 2 names B in a form the builder does not edit." */
function namedMessage(model: FlowchartModel, line: number, name: string): string {
    const keyword = /^\s*(style|classDef|class|linkStyle|click)\b/.exec(stripCr(model.lines[line]))?.[1];
    return keyword
        ? `Line ${line + 1} (${keyword}) names ${name}. Change or delete that line in the Code tab first.`
        : `Line ${line + 1} names ${name} in a form the builder does not edit. Change or delete that line in the Code tab first.`;
}

/** A statement split where references were removed (`keep`) or a link cut, as pieces of the original text. */
interface Piece { text: string; bare: boolean }
function pieces(model: FlowchartModel, st: NodesStatement, keep: (ref: NodeRef) => boolean, cut: number | null = null): Piece[] {
    const line = stripCr(model.lines[st.line]);
    const groups = st.groups.map((g) => g.filter(keep));
    const groupText = (k: number) => (groups[k].length === st.groups[k].length
        ? line.slice(st.groups[k][0].start, st.groups[k].at(-1)!.end)
        : groups[k].map((r) => line.slice(r.start, r.end)).join(' & '));
    const out: Piece[] = [];
    let from: number | null = null;
    const close = (to: number) => {
        if (from === null) return;
        let text = groupText(from);
        for (let k = from + 1; k <= to; k++) text += line.slice(st.links[k - 1].start, st.links[k - 1].end) + groupText(k);
        out.push({ text, bare: from === to && groups[from].every((r) => !r.text && !r.data && !r.cls) });
        from = null;
    };
    groups.forEach((g, k) => {
        if (from !== null && cut === k - 1) close(k - 1);
        if (g.length === 0) close(k - 1);
        else if (from === null) from = k;
    });
    close(groups.length - 1);
    return out;
}

/**
 * Apply `plan` (statements and what replaces them) with as few leftover bare mentions as possible:
 * a piece that only names a node (`B`) is dropped when the diagram reads the same without it.
 */
function buildPlan(model: FlowchartModel, plan: { st: Statement; pieces: Piece[] }[], extra: (d: Draft) => void, ok: (after: FlowchartModel | null) => boolean): string | null {
    const make = (drop: Set<Piece>) => {
        const d = new Draft(model);
        for (const { st, pieces: ps } of plan) d.replaceWith(st, ps.filter((p) => !drop.has(p)).map((p) => p.text));
        extra(d);
        return d.build();
    };
    const test = (code: string) => ok(parseFlowchart(code));
    const bare = plan.flatMap((p) => p.pieces.filter((x) => x.bare));
    const all = make(new Set(bare));
    if (test(all)) return all;
    const drop = new Set<Piece>();
    if (!test(make(drop))) return null;
    for (const piece of bare) {
        drop.add(piece);
        if (!test(make(drop))) drop.delete(piece);
    }
    return make(drop);
}

// ---- operations -----------------------------------------------------------------------------------

/** A new flowchart for an empty editor (comments in it are kept above the header). */
export function startFlowchart(code: string): string {
    const head = code.trim() === '' ? '' : `${code}${code.endsWith('\n') ? '' : '\n'}`;
    return `${head}flowchart TD\n`;
}

/** Write the direction into the header (`flowchart LR`). */
export function setDirection(code: string, direction: FlowDirection): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const header = model.statements.find((s): s is HeaderStatement => s.kind === 'header')!;
    if (header.dirStart === -1) return fail('unmanaged', 'The first line is not one the builder can change. Change it in the Code tab.');
    const same = (a: string | null) => a === direction || (direction === 'TD' && (a === 'TB' || a === null));
    if (same(header.direction)) return { ok: true, code };
    const d = new Draft(model);
    d.replace(header.line, header.dirStart, header.dirEnd, header.direction === null ? ` ${direction}` : direction);
    return finish(model, d.build(), (after) => (after.direction === direction ? null : 'The direction was not written.'), {}, true);
}

export interface FlowNodeSpec { label?: string; shape?: ShapeName; icon?: string | null; parent?: string | null }

function checkNodeSpec(model: FlowchartModel, spec: FlowNodeSpec, required: boolean): EditError | null {
    if (spec.label !== undefined || required) {
        const problem = labelProblem(spec.label ?? '');
        if (problem) return { code: 'label', message: problem };
    }
    if (spec.icon) {
        const problem = iconProblem(spec.icon);
        if (problem) return { code: 'icon', message: problem };
    }
    if (spec.shape !== undefined && !SHAPES.some((s) => s.name === spec.shape)) return { code: 'invalid', message: 'Choose a shape.' };
    if (spec.parent) {
        const g = findSubgraph(model, spec.parent);
        if (!g || !g.managed) return { code: 'parent', message: `There is no subgraph ${spec.parent}.` };
    }
    return null;
}

/**
 * Add a node with this label: a bracket shape (`id["Label"]`), or with an icon an icon node
 * (`id@{ icon: "gcp:cloud-run", label: "Cloud Run" }`), in subgraph `parent` or at the top level.
 */
export function addNode(code: string, spec: FlowNodeSpec): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const error = checkNodeSpec(model, spec, true);
    if (error) return { ok: false, error };
    const label = normalizeLabel(spec.label!);
    const parent = spec.parent || null;
    const at = insertPoint(model, parent);
    if (isError(at)) return { ok: false, error: at };
    const id = flowId(code, label, 'node');
    const d = new Draft(model);
    d.insert(at.after, `${at.indent}${id}${spec.icon ? dataText(spec.icon, label) : shapeText(spec.shape ?? 'rect', label)}${at.semi}`);
    const expected = snapshot(model);
    return finish(model, d.build(), (after) => {
        const n = findNode(after, id);
        if (!n || n.label !== label || n.icon !== (spec.icon || null) || n.parent !== parent) return 'The node was not added as intended.';
        expected.nodes.set(id, nodeSig(after, n));
        return sameSnapshot(expected, snapshot(after)) ? null : 'The change would alter other parts of the diagram.';
    }, { id });
}

/**
 * Change a node's label, shape or icon; a field left undefined is kept as written. The definition
 * that Mermaid uses (the last one) is rewritten; a node without one gets it at its first mention.
 * `icon: null` turns an icon node back into a shape (a rectangle unless `shape` says otherwise).
 */
export function updateNode(code: string, id: string, spec: FlowNodeSpec): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const node = findNode(model, id);
    if (!node) return fail('not-found', `There is no node ${id}.`);
    const label = spec.label === undefined ? undefined : normalizeLabel(spec.label);
    const changes: FlowNodeSpec = {};
    if (label !== undefined && label !== (node.label || id)) changes.label = label;
    if (spec.icon !== undefined && (spec.icon || null) !== node.icon) changes.icon = spec.icon || null;
    const shapeNow = node.shape === 'icon' || node.shape === 'other' ? null : node.shape;
    if (spec.shape !== undefined && spec.shape !== shapeNow && !(changes.icon === undefined && node.icon)) changes.shape = spec.shape;
    if (changes.icon === null && spec.shape === undefined) changes.shape = 'rect';
    if (Object.keys(changes).length === 0) return { ok: true, code, id };
    const error = checkNodeSpec(model, changes, false);
    if (error) return { ok: false, error };
    const name = nodeName(node);
    if (node.defCount > 1 && (changes.shape !== undefined || changes.icon !== undefined)) {
        return fail('unmanaged', `${name} is defined in more than one place. Change its shape or icon in the Code tab.`);
    }

    const st = model.statements[node.def?.statement ?? node.mentions[0]] as NodesStatement;
    const ref = node.def?.ref ?? st.groups.flat().find((r) => r.id === id)!;
    const finalLabel = changes.label ?? (node.label || id);
    const icon = changes.icon !== undefined ? changes.icon : node.icon;
    const d = new Draft(model);
    if (ref.data && (icon || changes.icon === undefined)) {
        // Edit the @{ } block in place: other keys (form, pos, h, …) stay as they are.
        const pairs = ref.data.pairs;
        if (!pairs) return fail('unmanaged', `${name} is written in a form the builder does not edit. Change it in the Code tab.`);
        if (changes.shape !== undefined) return fail('unmanaged', `The shape of ${name} is set in an @{ } block. Change it in the Code tab.`);
        if (icon && !pairs.some((p) => p.key === 'icon') && changes.icon !== undefined) return fail('unmanaged', `${name} has an @{ } block without an icon. Change it in the Code tab.`);
        const get = (k: string) => pairs.find((p) => p.key === k);
        const adds: string[] = [];
        if (changes.icon) d.replace(st.line, get('icon')!.valueStart, get('icon')!.valueEnd, `"${changes.icon}"`);
        if (changes.label !== undefined) {
            const p = get('label');
            if (p) d.replace(st.line, p.valueStart, p.valueEnd, yamlString(finalLabel));
            else adds.push(`label: ${yamlString(finalLabel)}`);
            const type = get('labelType');
            if (needsPlainText(finalLabel) && (!type || type.value === 'markdown')) {
                if (type) d.replace(st.line, type.valueStart, type.valueEnd, '"text"');
                else adds.push('labelType: "text"');
            }
        }
        if (adds.length) {
            const last = pairs.at(-1);
            if (last) d.replace(st.line, last.end, last.end, `, ${adds.join(', ')}`);
            else d.replace(st.line, ref.data.start + 2, ref.data.end - 1, ` ${adds.join(', ')} `);
        }
    } else {
        let body: string;
        if (icon) body = dataText(icon, finalLabel);
        else {
            const shape = changes.shape ?? ref.shape ?? 'rect';
            const raw = ref.text?.raw;
            const trap = /^\[[/\\]/.test(shapeOf(shape).open);
            // The label as written moves into the new brackets when it is not changed, if it can.
            const keep = changes.label === undefined && raw !== undefined && (raw.startsWith('"') || !(trap && /[/\\]/.test(raw)));
            if (!keep) {
                const problem = labelProblem(finalLabel);
                if (problem) return fail('label', changes.label === undefined ? `The label of ${name} cannot be written in that shape. ${problem}` : problem);
            }
            body = keep ? `${shapeOf(shape).open}${raw}${shapeOf(shape).close}` : shapeText(shape, finalLabel);
        }
        d.replace(st.line, ref.start, ref.end, `${id}${body}${ref.cls}`);
    }
    const expected = snapshot(model);
    return finish(model, d.build(), (after) => {
        const n = findNode(after, id);
        if (!n) return 'The node would disappear.';
        if ((n.label || id) !== finalLabel || n.icon !== (icon || null) || n.parent !== node.parent) return 'The node was not changed as intended.';
        if (changes.shape !== undefined && !icon && n.shape !== changes.shape) return 'The shape was not changed as intended.';
        expected.nodes.set(id, nodeSig(after, n));
        return sameSnapshot(expected, snapshot(after)) ? null : 'The change would alter other parts of the diagram.';
    }, { id });
}

/** Statement index of subgraph `key`, or null for the top level. */
const statementOf = (model: FlowchartModel, key: string | null) => (key === null ? null : findSubgraph(model, key)?.statement ?? null);

/**
 * Move a node into subgraph `target`, or to the top level (null). Mermaid puts a node in the first
 * subgraph (in the order they end) that mentions it, so every mention inside another subgraph goes:
 * a node line moves, a line with connections moves to the top level (the other nodes it names keep
 * their place with a bare mention when they need one).
 */
export function setNodeParent(code: string, id: string, target: string | null): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const node = findNode(model, id);
    if (!node) return fail('not-found', `There is no node ${id}.`);
    if (node.parent === target) return { ok: true, code, id };
    const targetAt = statementOf(model, target);
    if (target !== null) {
        const g = findSubgraph(model, target);
        if (!g || !g.managed) return fail('parent', `There is no subgraph ${target}.`);
    }
    const at = insertPoint(model, target);
    if (isError(at)) return { ok: false, error: at };
    const top = insertPoint(model, null) as Exclude<ReturnType<typeof insertPoint>, EditError>;

    const plan: { st: Statement; pieces: Piece[] }[] = [];
    const carried: string[] = [];
    const moved: string[] = [];
    let remaining = false;
    for (const si of node.mentions) {
        const st = model.statements[si] as NodesStatement;
        if (st.parent === null || st.parent === targetAt) {
            remaining ||= st.parent === targetAt && target !== null;
            remaining ||= st.parent === null && target === null;
            continue;
        }
        if (!model.subgraphs.find((g) => g.statement === st.parent)?.managed) {
            return fail('unmanaged', `${nodeName(node)} is named in a subgraph the builder does not manage. Move it in the Code tab.`);
        }
        const refs = st.groups.flat();
        if (st.links.length === 0 && refs.length === 1) {
            const ref = refs[0];
            if (ref.text || ref.data || ref.cls) carried.push(stmtText(model, st));
            plan.push({ st, pieces: [] });
        } else {
            moved.push(stmtText(model, st));
            remaining ||= target === null;
            const others = [...new Set(refs.map((r) => r.id).filter((x) => x !== id))];
            plan.push({ st, pieces: others.map((x) => ({ text: x, bare: true })) });
        }
    }
    const semiTop = top.semi;
    const extra = (d: Draft) => {
        const into = target === null ? top : at;
        for (const text of carried) d.insert(into.after, `${into.indent}${text}${into.semi}`);
        if (carried.length === 0 && !remaining) d.insert(into.after, `${into.indent}${id}${into.semi}`);
        for (const text of moved) d.insert(top.after, `${top.indent}${text}${semiTop}`);
    };
    const expected = snapshot(model);
    const check = (after: FlowchartModel | null): string | null => {
        if (!after) return 'The change would break the diagram.';
        const n = findNode(after, id);
        if (!n || n.parent !== (target === null ? null : findSubgraph(after, target)?.key ?? '?')) return `${nodeName(node)} cannot be moved there here. Move it in the Code tab.`;
        expected.nodes.set(id, nodeSig(after, n));
        return sameSnapshot(expected, snapshot(after)) ? null : 'Moving it would change other parts of the diagram. Move it in the Code tab.';
    };
    const result = buildPlan(model, plan, extra, (after) => check(after) === null);
    if (result === null) {
        const d = new Draft(model);
        for (const { st, pieces: ps } of plan) d.replaceWith(st, ps.map((p) => p.text));
        extra(d);
        return fail('invalid', check(parseFlowchart(d.build())) ?? 'It cannot be moved there.');
    }
    return finish(model, result, check, { id });
}

/** The statements that name `id` (a node, or a subgraph used as an end), each split where its references go. */
function removeRefs(model: FlowchartModel, id: string): { st: Statement; pieces: Piece[] }[] {
    const plan: { st: Statement; pieces: Piece[] }[] = [];
    for (const st of model.statements) {
        if (st.kind !== 'nodes' || !st.groups.flat().some((r) => r.id === id)) continue;
        plan.push({ st, pieces: pieces(model, st, (r) => r.id !== id) });
    }
    return plan;
}

/**
 * Remove a node and the connections that touch it. A chain through it is split
 * (`A --> B --> C` without B: `A` and `C`), and what the rest of the chain defines stays.
 * Refused when a line the builder does not manage names the node (style, class, click, …).
 */
export function removeNode(code: string, id: string): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const node = findNode(model, id);
    if (!node) return fail('not-found', `There is no node ${id}.`);
    const named = namedBy(model, id);
    if (named !== null) return fail('in-use', namedMessage(model, named, nodeName(node)));
    const plan = removeRefs(model, id);
    const expected = snapshot(model);
    expected.nodes.delete(id);
    const gone = model.edges.filter((e) => e.from === id || e.to === id).map(edgeSig);
    expected.edges = without(expected.edges, gone);
    const check = (after: FlowchartModel | null) => (after !== null && sameSnapshot(expected, snapshot(after)) ? null : `${nodeName(node)} cannot be deleted here. Delete it in the Code tab.`);
    const result = buildPlan(model, plan, () => {}, (after) => check(after) === null);
    if (result === null) return fail('invalid', check(null)!);
    return finish(model, result, check);
}

function without(list: string[], remove: string[]): string[] {
    const out = [...list];
    for (const r of remove) {
        const k = out.indexOf(r);
        if (k !== -1) out.splice(k, 1);
    }
    return out;
}

export interface FlowEdgeSpec { from: string; to: string; label?: string | null; line?: LineStyle }

function checkEdge(model: FlowchartModel, spec: FlowEdgeSpec, ignore: string | null): EditError | null {
    for (const [end, name] of [[spec.from, 'start'], [spec.to, 'end']] as const) {
        if (!findNode(model, end)) return { code: 'endpoint', message: `Choose the node the connection should ${name} at.` };
    }
    if (spec.from === spec.to) return { code: 'endpoint', message: 'A connection needs two different nodes.' };
    const problem = labelProblem(spec.label ?? '', true);
    if (problem) return { code: 'label', message: problem };
    const label = normalizeLabel(spec.label ?? '') || null;
    const style = spec.line ?? 'arrow';
    if (model.edges.some((e) => e.key !== ignore && e.from === spec.from && e.to === spec.to && lineStyleOf(e) === style && e.label === label)) {
        return { code: 'duplicate', message: `There is already a connection like that from ${itemName(model, spec.from)} to ${itemName(model, spec.to)}.` };
    }
    return null;
}

/** The key the next edge from `from` to `to` gets. */
const nextKey = (model: FlowchartModel, from: string, to: string) => JSON.stringify([from, to, model.edges.filter((e) => e.from === from && e.to === to).length]);

/** Add `from --> to` (with a label and a line style) on a new line after the last top-level statement. */
export function addEdge(code: string, spec: FlowEdgeSpec): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const error = checkEdge(model, spec, null);
    if (error) return { ok: false, error };
    const label = normalizeLabel(spec.label ?? '') || null;
    const style = spec.line ?? 'arrow';
    const at = insertPoint(model, null) as Exclude<ReturnType<typeof insertPoint>, EditError>;
    const d = new Draft(model);
    d.insert(at.after, `${at.indent}${edgeStatement(spec.from, spec.to, style, label)}${at.semi}`);
    const key = nextKey(model, spec.from, spec.to);
    const expected = snapshot(model);
    return finish(model, d.build(), (after) => {
        const e = findEdge(after, key);
        if (!e || e.label !== label || lineStyleOf(e) !== style) return 'The connection was not added as intended.';
        expected.edges = [...expected.edges, edgeSig(e)].sort();
        return sameSnapshot(expected, snapshot(after)) ? null : 'The change would alter other parts of the diagram.';
    }, { key });
}

/** Connect by clicking: an arrow from `from` to `to`. */
export function connectNodes(code: string, from: string, to: string): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const a = findNode(model, from);
    const b = findNode(model, to);
    if (!a || !b) return fail('not-found', 'That node is no longer in the diagram.');
    if (from === to) return fail('endpoint', `${nodeName(a)} cannot be connected to itself. Choose another node.`);
    if (model.edges.some((e) => e.from === from && e.to === to && lineStyleOf(e) === 'arrow' && e.label === null)) {
        return fail('duplicate', `${nodeName(a)} already has an arrow to ${nodeName(b)}. Use Connect to add another kind of connection.`);
    }
    return addEdge(code, { from, to });
}

/** Remove an edge; a chain is split at it (`A --> B --> C` without B --> C: `A --> B` and `C`). */
export function removeEdge(code: string, key: string): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const edge = findEdge(model, key);
    if (!edge) return fail('not-found', 'That connection is no longer in the diagram.');
    const st = model.statements[edge.statement] as NodesStatement;
    if (edge.shared) return fail('unmanaged', `This connection is written together with others (with &) on line ${st.line + 1}. Change it in the Code tab.`);
    const expected = snapshot(model);
    expected.edges = without(expected.edges, [edgeSig(edge)]);
    const check = (after: FlowchartModel | null) => (after !== null && sameSnapshot(expected, snapshot(after)) ? null : 'This connection cannot be deleted here. Delete it in the Code tab.');
    const result = buildPlan(model, [{ st, pieces: pieces(model, st, () => true, edge.link) }], () => {}, (after) => check(after) === null);
    if (result === null) return fail('invalid', check(null)!);
    return finish(model, result, check);
}

/**
 * Change an edge's label or line; other ends make it a new connection (the old one is removed, the
 * new one added after the last statement). A label keeps its pipe form (`-->|"Yes"|`); a
 * `-- text -->` link is rewritten in that form when it changes.
 */
export function updateEdge(code: string, key: string, spec: Partial<FlowEdgeSpec>): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const edge = findEdge(model, key);
    if (!edge) return fail('not-found', 'That connection is no longer in the diagram.');
    const label = spec.label === undefined ? edge.label : normalizeLabel(spec.label ?? '') || null;
    const styleNow = lineStyleOf(edge);
    const style = spec.line ?? styleNow;
    const from = spec.from ?? edge.from;
    const to = spec.to ?? edge.to;
    if (from !== edge.from || to !== edge.to) {
        if (style === null) return fail('unmanaged', 'This connection has a line the builder does not write. Change it in the Code tab.');
        const error = checkEdge(model, { from, to, label, line: style }, key);
        if (error) return { ok: false, error };
        const removed = removeEdge(code, key);
        if (!removed.ok) return removed;
        const added = addEdge(removed.code, { from, to, label, line: style });
        if (!added.ok) return added;
        return finish(model, added.code, () => null, { key: added.key });
    }
    const labelChanged = label !== edge.label;
    const styleChanged = style !== styleNow;
    if (!labelChanged && !styleChanged) return { ok: true, code, key };
    if (edge.shared) return fail('unmanaged', `This connection is written together with others (with &) on line ${model.statements[edge.statement].line + 1}. Change it in the Code tab.`);
    if (labelChanged) {
        const problem = labelProblem(label ?? '', true);
        if (problem) return fail('label', problem);
    }
    const duplicate = model.edges.some((e) => e.key !== key && e.from === from && e.to === to && lineStyleOf(e) === style && e.label === label);
    if (duplicate) return fail('duplicate', `There is already a connection like that from ${itemName(model, from)} to ${itemName(model, to)}.`);
    const st = model.statements[edge.statement] as NodesStatement;
    const link = st.links[edge.link];
    const d = new Draft(model);
    if (link.form === 'inline') {
        const line = stripCr(model.lines[st.line]);
        const lead = line.slice(link.start, link.tokenStart);
        const trail = line.slice(link.tokenEnd, link.end);
        const token = style ? styleToken(style) : arrowToken(link.stroke, link.startHead, link.endHead);
        d.replace(st.line, link.start, link.end, `${lead}${token}${pipeLabel(label)}${trail || ' '}`);
    } else {
        if (labelChanged) d.replace(st.line, link.tokenEnd, link.pipeEnd, pipeLabel(label));
        if (styleChanged && style) d.replace(st.line, link.tokenStart, link.tokenEnd, styleToken(style));
    }
    const expected = snapshot(model);
    return finish(model, d.build(), (after) => {
        const e = findEdge(after, key);
        if (!e || e.label !== label || lineStyleOf(e) !== style) return 'The connection was not changed as intended.';
        expected.edges = [...without(expected.edges, [edgeSig(edge)]), edgeSig(e)].sort();
        return sameSnapshot(expected, snapshot(after)) ? null : 'The change would alter other parts of the diagram.';
    }, { key });
}

export interface SubgraphSpec { title?: string; parent?: string | null }

/** Add an empty subgraph `subgraph id ["Title"]` … `end`, in subgraph `parent` or at the top level. */
export function addSubgraph(code: string, spec: SubgraphSpec): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const problem = labelProblem(spec.title ?? '');
    if (problem) return fail('label', problem);
    const title = normalizeLabel(spec.title!);
    const parent = spec.parent || null;
    if (parent && !findSubgraph(model, parent)?.managed) return fail('parent', `There is no subgraph ${parent}.`);
    const at = insertPoint(model, parent);
    if (isError(at)) return { ok: false, error: at };
    const id = flowId(code, title, 'group');
    const d = new Draft(model);
    d.insert(at.after, `${at.indent}subgraph ${id} ["${title}"]${at.semi}`);
    d.insert(at.after, `${at.indent}end${at.semi}`);
    const expected = snapshot(model);
    return finish(model, d.build(), (after) => {
        const g = findSubgraph(after, id);
        if (!g || g.title !== title || g.parent !== parent) return 'The subgraph was not added as intended.';
        expected.subgraphs = [...expected.subgraphs, pathOf(after, id)].sort();
        return sameSnapshot(expected, snapshot(after)) ? null : 'The change would alter other parts of the diagram.';
    }, { id });
}

/**
 * Rename a subgraph or move it into another subgraph (or to the top level). A subgraph without an
 * id of its own (`subgraph Two words`) gets one when it is renamed. A move takes the subgraph's lines,
 * unchanged, to the end of the new parent (or after its outermost subgraph).
 */
export function updateSubgraph(code: string, key: string, spec: SubgraphSpec): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const sg = findSubgraph(model, key);
    if (!sg) return fail('not-found', 'That subgraph is no longer in the diagram.');
    if (!sg.managed) return fail('unmanaged', 'This subgraph is written in a form the builder does not edit. Change it in the Code tab.');
    const title = spec.title === undefined ? sg.title : normalizeLabel(spec.title);
    const parent = spec.parent === undefined ? sg.parent : spec.parent || null;
    if (title !== sg.title) {
        const problem = labelProblem(title);
        if (problem) return fail('label', problem);
    }
    if (parent !== sg.parent && parent !== null) {
        if (parent === key) return fail('cycle', 'A subgraph cannot be placed in itself.');
        if (subgraphsInside(model, key).has(parent)) return fail('cycle', `${itemName(model, parent)} is inside ${subgraphName(sg)}, so it cannot hold it.`);
        if (!findSubgraph(model, parent)?.managed) return fail('parent', `There is no subgraph ${parent}.`);
    }
    if (title === sg.title && parent === sg.parent) return { ok: true, code, id: key };

    const st = model.statements[sg.statement] as SubgraphStatement;
    const line = stripCr(model.lines[st.line]);
    const d = new Draft(model);
    let id = key;
    if (title !== sg.title) {
        if (st.form === 'id-title') d.replace(st.line, line.indexOf('[', st.restStart + st.written!.length), st.end, `["${title}"]`);
        else if (st.form === 'id') d.replace(st.line, st.end, st.end, ` ["${title}"]`);
        else {
            if (namedBy(model, key) !== null) return fail('in-use', `A line the builder does not manage names ${key}. Change it in the Code tab first.`);
            id = flowId(code, title, 'group');
            d.replace(st.line, st.start, st.end, `subgraph ${id} ["${title}"]`);
        }
    }
    if (parent !== sg.parent) {
        const close = model.statements[sg.close!];
        if (statementsOn(model, st.line).length > 1 || statementsOn(model, close.line).length > 1) {
            return fail('unmanaged', `${subgraphName(sg)} shares a line with other statements. Move it in the Code tab.`);
        }
        let after: number;
        let indent: string;
        if (parent === null) {
            let outer = sg;
            while (outer.parent !== null) outer = findSubgraph(model, outer.parent)!;
            after = model.statements[outer.close!].line;
            indent = indentOf(model, model.statements[outer.statement].line);
        } else {
            const at = insertPoint(model, parent);
            if (isError(at)) return { ok: false, error: at };
            ({ after, indent } = at);
        }
        // The block's lines (with the new title), re-indented for their new place.
        const old = indentOf(model, st.line);
        const block = d.build().split('\n').slice(st.line, close.line + 1).map(stripCr)
            .map((text) => (text.startsWith(old) && text.trim() !== '' ? indent + text.slice(old.length) : text));
        const mv = new Draft(model);
        for (let l = st.line; l <= close.line; l++) mv.replace(l, 0, stripCr(model.lines[l]).length, '');
        for (const text of block) mv.insert(after, text);
        return finishSubgraph(model, mv.build(), key, id, title, parent);
    }
    return finishSubgraph(model, d.build(), key, id, title, parent);
}

function finishSubgraph(model: FlowchartModel, code: string, key: string, id: string, title: string, parent: string | null): EditResult {
    const from = pathOf(model, key);
    return finish(model, code, (after) => {
        const g = findSubgraph(after, id);
        if (!g || g.title !== title || g.parent !== (parent === null ? null : findSubgraph(after, parent)?.key ?? '?')) return 'The subgraph cannot be changed that way here. Change it in the Code tab.';
        // Only the path of this subgraph changes, for everything inside it too.
        const to = pathOf(after, id);
        const moved = (p: string) => (p === from || p.startsWith(`${from} / `) ? to + p.slice(from.length) : p);
        const expected = snapshot(model);
        expected.subgraphs = expected.subgraphs.map(moved).sort();
        for (const n of model.nodes) expected.nodes.set(n.id, JSON.stringify([n.label, n.shape, n.icon, moved(pathOf(model, n.parent))]));
        return sameSnapshot(expected, snapshot(after)) ? null : 'Changing it would alter other parts of the diagram. Change it in the Code tab.';
    }, { id });
}

/**
 * Remove a subgraph: its `subgraph` and `end` lines go, and what was inside it now belongs to its
 * parent (or the top level). Connections to the subgraph itself are removed.
 */
export function removeSubgraph(code: string, key: string): EditResult {
    const model = parseFlowchart(code);
    if (!model) return NOT_FLOWCHART;
    const sg = findSubgraph(model, key);
    if (!sg) return fail('not-found', 'That subgraph is no longer in the diagram.');
    if (!sg.managed) return fail('unmanaged', 'This subgraph is written in a form the builder does not edit. Change it in the Code tab.');
    const named = namedBy(model, key);
    if (named !== null) return fail('in-use', namedMessage(model, named, subgraphName(sg)));
    // Its `direction` line would then set the direction of the subgraph around it.
    const direction = model.statements.find((s) => s.parent === sg.statement && s.kind === 'other' && s.role === 'direction');
    if (direction) return fail('unmanaged', `${subgraphName(sg)} sets its own direction on line ${direction.line + 1}. Delete that line in the Code tab first.`);
    const plan = removeRefs(model, key);
    const open = model.statements[sg.statement];
    const close = model.statements[sg.close!];
    const gone = model.edges.filter((e) => e.from === key || e.to === key).map(edgeSig);
    // What was inside it is now inside its parent: its segment leaves every path.
    const from = pathOf(model, key);
    const to = pathOf(model, sg.parent);
    const lifted = (p: string) => (p === from || p.startsWith(`${from} / `) ? `${to}${to && p !== from ? ' / ' : ''}${p.slice(from.length + (p === from ? 0 : 3))}` : p);
    const expected = snapshot(model);
    expected.edges = without(expected.edges, gone);
    expected.subgraphs = without(expected.subgraphs, [from]).map(lifted).sort();
    for (const n of model.nodes) expected.nodes.set(n.id, JSON.stringify([n.label, n.shape, n.icon, lifted(pathOf(model, n.parent))]));
    const check = (after: FlowchartModel | null) => (after !== null && sameSnapshot(expected, snapshot(after)) ? null : 'This subgraph cannot be deleted here. Delete it in the Code tab.');
    // The lines inside lose one level of indentation, when they all have it.
    const body = model.lines.slice(open.line + 1, close.line).map(stripCr);
    const outer = indentOf(model, open.line);
    const inner = body.find((t) => t.trim() !== '')?.match(/^[\t ]*/)?.[0] ?? outer;
    const unit = inner.startsWith(outer) ? inner.slice(outer.length) : '';
    const dedent = unit !== '' && open.line !== close.line && body.every((t) => t.trim() === '' || t.startsWith(outer + unit));
    const result = buildPlan(model, plan, (d) => {
        d.remove(open);
        d.remove(close);
        if (dedent) body.forEach((t, k) => { if (t.trim() !== '') d.replace(open.line + 1 + k, outer.length, outer.length + unit.length, ''); });
    }, (after) => check(after) === null);
    if (result === null) return fail('invalid', 'This subgraph cannot be deleted here. Delete it in the Code tab.');
    return finish(model, result, check);
}
