/**
 * The visual builder's view of an `architecture-beta` diagram, and its edits. Pure functions, so they
 * also run under `node --test`.
 *
 * The diagram text is the only copy of the diagram. parseArchitecture reads it into one item per line;
 * every edit returns new text that differs from the old only in the lines it had to touch. Lines the
 * builder does not understand are kept byte for byte, and so are line endings: a document with CRLF
 * line endings keeps them, and new lines get them too.
 *
 * The statements recognised are exactly those of Mermaid's architecture grammar (@mermaid-js/parser):
 *   group id(icon)[title] in parent        service id(icon)[title] in parent     junction id in parent
 *   lhs{group}:R <-[title]-> L:rhs{group}  (every part after the id optional; `--` without a title)
 * plus the lexer rules that make a word an id. A line that could be read another way is `other`.
 * The rules that need the whole diagram follow Mermaid's architecture database: all groups are
 * added first, in text order (a group's parent group has to come before it), then services and
 * junctions, then edges, which may only join services and junctions.
 *
 * Errors are values, never exceptions: an edit refuses with a message the UI can show.
 */
import { scanDiagram, uniqueId } from './iconPicker.ts';

export type Side = 'T' | 'B' | 'L' | 'R';
export const SIDES: readonly Side[] = ['L', 'R', 'T', 'B'];

/** Icons that Mermaid draws for architecture diagrams without any pack (its `architectureIcons`). */
export const BUILTIN_ICONS: readonly string[] = ['cloud', 'database', 'disk', 'internet', 'server'];

export interface GroupItem { kind: 'group'; line: number; id: string; icon: string | null; label: string | null; parent: string | null }
export interface ServiceItem {
    kind: 'service'; line: number; id: string; icon: string | null;
    /** A quoted text shown instead of an icon (`service id "text"[title]`). */
    iconText: string | null;
    label: string | null; parent: string | null;
}
export interface JunctionItem { kind: 'junction'; line: number; id: string; parent: string | null }
export interface EdgeEnd {
    id: string;
    side: Side;
    /** The `{group}` modifier: the edge leaves from the boundary of the node's group. */
    group: boolean;
    /** An arrowhead at this end. */
    arrow: boolean;
}
export interface EdgeItem { kind: 'edge'; line: number; from: EdgeEnd; to: EdgeEnd; label: string | null }
export type OtherRole = 'blank' | 'comment' | 'header' | 'preamble' | 'directive' | 'title' | 'accessibility' | 'unmanaged';
export interface OtherItem { kind: 'other'; line: number; role: OtherRole }
export type NodeItem = GroupItem | ServiceItem | JunctionItem;
export type Item = NodeItem | EdgeItem | OtherItem;
export type NodeKind = NodeItem['kind'];

export interface ArchitectureModel {
    /** `code.split('\n')`: joined with '\n' they give the code back. A final '' is the final newline. */
    lines: string[];
    header: number;
    /** One per line: items[i].line === i. */
    items: Item[];
    /** Lines of `other` items that are not blank, comments or the header: kept, but not managed. */
    unmanaged: number[];
}

export type EditErrorCode = 'not-architecture' | 'label' | 'icon' | 'parent' | 'cycle' | 'endpoint' | 'not-found' | 'in-use' | 'invalid';
export interface EditError { code: EditErrorCode; message: string }
export type EditResult = { ok: true; code: string; id?: string; line?: number } | { ok: false; error: EditError };

// ---- tokens ---------------------------------------------------------------------------------------
// Sources of the grammar's terminals. Patterns are built once without the `g` flag, so exec() keeps no state.
const ID = String.raw`[A-Za-z0-9_](?:[-\w]*\w)?(?![-\w])`;
const ICON = String.raw`\([\w:-]+\)`;
const STRING = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'`;
const TITLE = String.raw`\[(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^[\]\r\n]+)\]`;
const IN = String.raw`([\t ]*in[\t ]+(${ID}))?`;
// Trailing whitespace and an optional end-of-line comment, which the grammar hides.
const TAIL = String.raw`([\t ]*(?:%%.*)?)`;

const GROUP_RE = new RegExp(String.raw`^([\t ]*)(group[\t ]+)(${ID})([\t ]*${ICON})?([\t ]*${TITLE})?${IN}${TAIL}$`);
const SERVICE_RE = new RegExp(String.raw`^([\t ]*)(service[\t ]+)(${ID})([\t ]*(?:${ICON}|${STRING}))?([\t ]*${TITLE})?${IN}${TAIL}$`);
const JUNCTION_RE = new RegExp(String.raw`^([\t ]*)(junction[\t ]+)(${ID})()()${IN}${TAIL}$`);
const EDGE_RE = new RegExp(String.raw`^([\t ]*)(${ID})([\t ]*\{group\})?[\t ]*:[\t ]*([LRTB])[\t ]*([<>])?[\t ]*(?:--|-[\t ]*(${TITLE})[\t ]*-)[\t ]*([<>])?[\t ]*([LRTB])[\t ]*:[\t ]*(${ID})([\t ]*\{group\})?${TAIL}$`);
const ALIGN_RE = /^[\t ]*align[\t ]+(?:row|column)((?:[\t ]+[\w-]+)+)[\t ]*(?:%%.*)?$/;
const KEYWORDS = new Set(['architecture-beta', 'group', 'service', 'junction', 'in', 'align', 'row', 'column']);

/**
 * Whether the lexer reads `id` as an id. It tries the side letters, `title` and the accessibility
 * statements first, so `Rx`, `titleBar` and `accTitle` are not ids; keywords are not either. Ids
 * that start with a digit are left alone too (numbers have tokens of their own).
 */
function isLexedAsId(id: string): boolean {
    return !/^[LRTB]/.test(id) && !id.startsWith('title') && !/^acc(?:Title|Descr)/.test(id) && !/^\d/.test(id) && !KEYWORDS.has(id);
}

/** The grammar's value of a title token: brackets, then one pair of quotes, removed; trimmed. */
function titleValue(raw: string): string {
    let text = raw.slice(1, -1).trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\'", "'");
    }
    return text.trim();
}

interface NodeParts {
    kind: NodeKind;
    indent: string; keyword: string; id: string;
    /** Raw segments, each with the whitespace before it; '' when absent. */
    iconSeg: string; titleSeg: string; inSeg: string;
    parent: string | null; tail: string;
}

function nodeParts(text: string): NodeParts | null {
    for (const [kind, re] of [['group', GROUP_RE], ['service', SERVICE_RE], ['junction', JUNCTION_RE]] as const) {
        const m = re.exec(text);
        if (!m) continue;
        const [, indent, keyword, id, iconSeg = '', titleSeg = '', inSeg = '', parent, tail] = m;
        if (!isLexedAsId(id) || (parent !== undefined && !isLexedAsId(parent))) return null;
        return { kind, indent, keyword, id, iconSeg, titleSeg, inSeg, parent: parent ?? null, tail };
    }
    return null;
}

interface EdgeParts { indent: string; edge: Omit<EdgeItem, 'line'>; tail: string }

function edgeParts(text: string): EdgeParts | null {
    const m = EDGE_RE.exec(text);
    if (!m) return null;
    const [, indent, lhs, lhsGroup, lhsDir, lhsInto, title, rhsInto, rhsDir, rhs, rhsGroup, tail] = m;
    if (!isLexedAsId(lhs) || !isLexedAsId(rhs)) return null;
    return {
        indent,
        edge: {
            kind: 'edge',
            from: { id: lhs, side: lhsDir as Side, group: lhsGroup !== undefined, arrow: lhsInto !== undefined },
            to: { id: rhs, side: rhsDir as Side, group: rhsGroup !== undefined, arrow: rhsInto !== undefined },
            label: title === undefined ? null : titleValue(title),
        },
        tail,
    };
}

function nodeItem(parts: NodeParts, line: number): NodeItem {
    const { kind, id, parent } = parts;
    if (kind === 'junction') return { kind, line, id, parent };
    const raw = parts.iconSeg.trim();
    const icon = raw.startsWith('(') ? raw.slice(1, -1).trim() : null;
    const label = parts.titleSeg ? titleValue(parts.titleSeg.trim()) : null;
    if (kind === 'group') return { kind, line, id, icon, label, parent };
    // A string token's value: without its quotes, escapes resolved.
    const iconText = raw && !icon ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : null;
    return { kind, line, id, icon, iconText, label, parent };
}

// ---- parsing --------------------------------------------------------------------------------------

/** The builder's model of `code`, or null when it is not an architecture-beta diagram. */
export function parseArchitecture(code: string): ArchitectureModel | null {
    const lines = code.split('\n');
    const { kind, header } = scanDiagram(lines);
    if (kind !== 'architecture') return null;

    const items: Item[] = [];
    const other = (line: number, role: OtherRole) => items.push({ kind: 'other', line, role });
    // Inside a multi-line `accDescr { … }` or `%%{ … }%%`: everything up to the closing line is part of it.
    let block: { role: OtherRole; close: string } | null = null;
    lines.forEach((raw, i) => {
        const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        const trimmed = text.trim();
        if (block) {
            other(i, block.role);
            if (text.includes(block.close)) block = null;
            return;
        }
        if (i < header) return other(i, trimmed === '' ? 'blank' : /^%%(?!\{)/.test(trimmed) ? 'comment' : 'preamble');
        if (i === header) return other(i, 'header');
        if (trimmed === '') return other(i, 'blank');
        const directive = text.indexOf('%%{');
        if (directive !== -1 && !text.includes('}%%', directive)) {
            block = { role: 'directive', close: '}%%' };
            return other(i, 'directive');
        }
        if (trimmed.startsWith('%%{')) return other(i, 'directive');
        if (trimmed.startsWith('%%')) return other(i, 'comment');
        if (/^title(?:[\t ]|$)/.test(trimmed)) return other(i, 'title');
        if (/^accDescr[\t ]*\{/.test(trimmed)) {
            if (!trimmed.includes('}')) block = { role: 'accessibility', close: '}' };
            return other(i, 'accessibility');
        }
        if (/^acc(?:Title|Descr)[\t ]*:/.test(trimmed)) return other(i, 'accessibility');
        const node = nodeParts(text);
        if (node) return items.push(nodeItem(node, i));
        const edge = edgeParts(text);
        if (edge) return items.push({ ...edge.edge, line: i });
        other(i, 'unmanaged');
    });
    const unmanaged = items.filter((it) => it.kind === 'other' && !['blank', 'comment', 'header'].includes(it.role)).map((it) => it.line);
    return { lines, header, items, unmanaged };
}

export const isNode = (item: Item): item is NodeItem => item.kind === 'group' || item.kind === 'service' || item.kind === 'junction';
export const nodes = (model: ArchitectureModel): NodeItem[] => model.items.filter(isNode);
export const edges = (model: ArchitectureModel): EdgeItem[] => model.items.filter((it): it is EdgeItem => it.kind === 'edge');
export const findNode = (model: ArchitectureModel, id: string): NodeItem | undefined => nodes(model).find((n) => n.id === id);
/** What the builder calls a node: its label, or its id when it has none. */
export const nodeName = (n: NodeItem): string => (n.kind !== 'junction' && n.label ? n.label : n.id);

/** The edge on line `line` if that line still reads `text`, else the first edge line that does (lines move as the text changes). */
export function findEdge(model: ArchitectureModel, line: number, text: string): EdgeItem | undefined {
    const at = model.items[line];
    if (at?.kind === 'edge' && model.lines[line] === text) return at;
    return edges(model).find((e) => model.lines[e.line] === text);
}

/** The ids of the groups inside group `id`, at any depth. */
export function descendantGroups(model: ArchitectureModel, id: string): Set<string> {
    const found = new Set<string>();
    const groups = nodes(model).filter((n) => n.kind === 'group');
    for (let grew = true; grew;) {
        grew = false;
        for (const g of groups) {
            if (g.parent !== null && (g.parent === id || found.has(g.parent)) && !found.has(g.id) && g.id !== id) {
                found.add(g.id);
                grew = true;
            }
        }
    }
    return found;
}

/**
 * Nodes in outline order, with their depth: each top-level group followed by its contents (its groups,
 * then its other nodes, in text order), then the top-level services and junctions. A node whose group
 * is missing, or part of a cycle, is listed at the top level.
 */
export function nodeOutline(model: ArchitectureModel): { node: NodeItem; depth: number }[] {
    const all = nodes(model);
    const groupIds = new Set(all.filter((n) => n.kind === 'group').map((n) => n.id));
    const out: { node: NodeItem; depth: number }[] = [];
    const seen = new Set<NodeItem>();
    const add = (n: NodeItem, depth: number) => {
        seen.add(n);
        out.push({ node: n, depth });
        if (n.kind === 'group') visit(n.id, depth + 1);
    };
    const visit = (parent: string | null, depth: number) => {
        const inside = all.filter((n) => parent === null ? n.parent === null || !groupIds.has(n.parent) : n.parent === parent);
        for (const n of [...inside.filter((x) => x.kind === 'group'), ...inside.filter((x) => x.kind !== 'group')]) {
            if (!seen.has(n)) add(n, depth);
        }
    };
    visit(null, 0);
    for (const n of all) if (!seen.has(n)) add(n, 0);
    return out;
}

export type Direction = 'none' | 'forward' | 'backward' | 'both';
export const directionOf = (edge: Pick<EdgeItem, 'from' | 'to'>): Direction =>
    edge.from.arrow ? (edge.to.arrow ? 'both' : 'backward') : edge.to.arrow ? 'forward' : 'none';
export const arrowsOf = (direction: Direction) => ({
    from: direction === 'backward' || direction === 'both',
    to: direction === 'forward' || direction === 'both',
});

/** Groups that node `id` (null: a new node) can be placed in: every group, except itself and its own groups. */
export function parentChoices(model: ArchitectureModel, id: string | null): GroupItem[] {
    const below = id === null ? new Set<string>() : descendantGroups(model, id);
    return nodes(model).filter((n): n is GroupItem => n.kind === 'group' && n.id !== id && !below.has(n.id));
}

/**
 * Problems Mermaid's architecture database would raise for this model, in its order. Only what the
 * builder can see is checked: a node defined on a line the builder does not manage looks missing.
 */
export function diagramProblems(model: ArchitectureModel): string[] {
    const problems: string[] = [];
    const all = nodes(model);
    const registered = new Map<string, 'group' | 'node'>();
    // All groups first, then services, then junctions, each kind in text order.
    for (const kind of ['group', 'service', 'junction'] as const) {
        for (const n of all.filter((x) => x.kind === kind)) {
            if (registered.has(n.id)) {
                problems.push(`The id ${n.id} is used twice.`);
                continue;
            }
            if (n.parent === n.id) problems.push(`${n.id} cannot be placed in itself.`);
            else if (n.parent !== null && !registered.has(n.parent)) problems.push(`The group ${n.parent} of ${n.id} has to be defined before it.`);
            else if (n.parent !== null && registered.get(n.parent) !== 'group') problems.push(`${n.id} is placed in ${n.parent}, which is not a group.`);
            registered.set(n.id, kind === 'group' ? 'group' : 'node');
        }
    }
    const parentOf = new Map(all.map((n) => [n.id, n.parent]));
    for (const e of edges(model)) {
        const missing = [e.from.id, e.to.id].filter((id) => registered.get(id) !== 'node');
        if (missing.length) {
            problems.push(`The connection ${e.from.id} - ${e.to.id} has to join services or junctions; ${missing.join(' and ')} is not one.`);
            continue;
        }
        const a = parentOf.get(e.from.id), b = parentOf.get(e.to.id);
        if ((e.from.group || e.to.group) && a && b && a === b) {
            problems.push(`The connection ${e.from.id} - ${e.to.id} leaves a group boundary ({group}), but both ends are in the same group.`);
        }
    }
    // The layout names every group and node by its id and every edge `lhs-rhs`; a name used twice fails
    // ("Can not create second element"): one edge per pair and direction, none named like a node.
    const names = new Set(all.map((n) => n.id));
    for (const e of edges(model)) {
        const name = `${e.from.id}-${e.to.id}`;
        if (names.has(name)) problems.push(`The connection ${e.from.id} - ${e.to.id} has the same name in Mermaid's layout (${name}) as another node or connection.`);
        names.add(name);
    }
    for (const line of model.unmanaged) {
        const m = ALIGN_RE.exec(stripCr(model.lines[line]));
        if (!m) continue;
        for (const id of m[1].trim().split(/[\t ]+/)) {
            if (registered.get(id) !== 'node') problems.push(`An align line names ${id}, which is not a service or junction.`);
        }
    }
    return problems;
}

// ---- validation of user input ----------------------------------------------------------------------

const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;

/** Why `label` cannot be written as a title, or null. `optional`: empty text means no title. */
export function labelProblem(label: string, optional = false): string | null {
    const text = label.trim();
    if (text === '') return optional ? null : 'Enter a label.';
    if (LINE_BREAK.test(text)) return 'A label has to fit on one line.';
    if (text.includes('[') || text.includes(']')) return 'A label cannot contain [ or ].';
    if (text.includes('%%')) return 'A label cannot contain %%.';
    // Mermaid drops one pair of quotes around a title, so `"Web"` would show as Web.
    if (titleValue(`[${text}]`) !== text) return 'A label cannot start and end with quotes.';
    return null;
}

/** Why `icon` is not a usable icon name, or null: a built-in name, or `prefix:name` of a pack icon. */
export function iconProblem(icon: string): string | null {
    if (BUILTIN_ICONS.includes(icon) || /^[\w-]+:[\w-]+$/.test(icon)) return null;
    return `"${icon}" is not an icon name. Use one of ${BUILTIN_ICONS.join(', ')}, or prefix:name for an icon of a pack.`;
}

// ---- editing helpers -------------------------------------------------------------------------------

const stripCr = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);
const fail = (code: EditErrorCode, message: string): EditResult => ({ ok: false, error: { code, message } });
const NOT_ARCHITECTURE = fail('not-architecture', 'The builder works with architecture diagrams (architecture-beta).');

/** Whether new lines get CRLF endings: when any line of the document has one. */
const usesCrlf = (lines: readonly string[]) => lines.some((l) => l.endsWith('\r'));

/** Index of the line after the content: before a final newline's ''. */
const endIndex = (lines: readonly string[]) => (lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length);

/** Put `text` (no line ending) at index `at`, with the document's line ending. */
function insertLine(lines: string[], at: number, text: string): void {
    const crlf = usesCrlf(lines);
    if (at >= lines.length) {
        // A new last line, without a final newline: the line before it gets the ending.
        if (crlf && !lines[lines.length - 1].endsWith('\r')) lines[lines.length - 1] += '\r';
        lines.push(text);
    } else {
        lines.splice(at, 0, crlf ? `${text}\r` : text);
    }
}

function removeLine(lines: string[], at: number): void {
    lines.splice(at, 1);
    // The old last line had no ending; the new last line loses its CR instead of keeping a stray one.
    if (at === lines.length && at > 0) lines[at - 1] = stripCr(lines[at - 1]);
}

/** Replace the line at `at`, keeping its own line ending. */
function setLine(lines: string[], at: number, text: string): void {
    lines[at] = lines[at].endsWith('\r') ? `${text}\r` : text;
}

const isStatement = (item: Item | undefined) => item !== undefined && item.kind !== 'other';
const indentOf = (model: ArchitectureModel, line: number) => /^[\t ]*/.exec(stripCr(model.lines[line]))![0];

/** Indentation for a line inserted after `anchor`: that statement's, else the first statement's, else two spaces. */
function indentAfter(model: ArchitectureModel, anchor: number): string {
    if (isStatement(model.items[anchor])) return indentOf(model, anchor);
    const first = model.items.find(isStatement);
    return first ? indentOf(model, first.line) : '  ';
}

/** The last line with content before `before` (never above the header). */
function lastContent(model: ArchitectureModel, before: number): number {
    let at = Math.min(before, endIndex(model.lines)) - 1;
    while (at > model.header && model.items[at].kind === 'other' && (model.items[at] as OtherItem).role === 'blank') at--;
    return Math.max(at, model.header);
}

/**
 * The line after which a new node goes: after the last node of its kind in the same parent; otherwise
 * after the last node line; in a diagram without nodes, after the last content before the first edge.
 * A group's parent line is always above that point, as the ordering rule needs.
 */
function nodeAnchor(model: ArchitectureModel, kind: NodeKind, parent: string | null): number {
    const all = nodes(model);
    const siblings = all.filter((n) => n.kind === kind && n.parent === parent);
    const parentLine = parent === null ? -1 : (findNode(model, parent)?.line ?? -1);
    const last = siblings.at(-1);
    if (last && last.line > parentLine) return last.line;
    if (all.length) return all[all.length - 1].line;
    const firstEdge = edges(model)[0];
    return lastContent(model, firstEdge ? firstEdge.line : model.lines.length);
}

/** After the last edge; without edges, after the last content line. */
function edgeAnchor(model: ArchitectureModel): number {
    const last = edges(model).at(-1);
    return last ? last.line : lastContent(model, model.lines.length);
}

/**
 * The finished edit, refused when the new text has a problem (in Mermaid's terms) that the old text
 * did not have. Problems the text already had do not block unrelated edits.
 */
function finish(before: ArchitectureModel, lines: string[], extra: { id?: string; line?: number } = {}): EditResult {
    const code = lines.join('\n');
    const after = parseArchitecture(code);
    if (!after) return fail('invalid', 'The edit would break the diagram.');
    const known = new Set(diagramProblems(before));
    const added = diagramProblems(after).filter((p) => !known.has(p));
    if (added.length) return fail('invalid', added[0]);
    return { ok: true, code, ...extra };
}

// ---- statements ----------------------------------------------------------------------------------

function nodeStatement(kind: NodeKind, id: string, icon: string | null, label: string | null, parent: string | null): string {
    const iconPart = kind !== 'junction' && icon ? `(${icon})` : '';
    const titlePart = kind !== 'junction' && label ? `[${label}]` : '';
    return `${kind} ${id}${iconPart}${titlePart}${parent ? ` in ${parent}` : ''}`;
}

/** `lhs:R --> L:rhs`, `lhs:R <-[title]-> L:rhs`, with `{group}` after an id that has it. */
export function edgeStatement(edge: Pick<EdgeItem, 'from' | 'to' | 'label'>): string {
    const { from, to, label } = edge;
    const line = label ? `-[${label}]-` : '--';
    return `${from.id}${from.group ? '{group}' : ''}:${from.side} ${from.arrow ? '<' : ''}${line}${to.arrow ? '>' : ''} ${to.side}:${to.id}${to.group ? '{group}' : ''}`;
}

export interface NodeSpec { label?: string; icon?: string | null; parent?: string | null }

function checkSpec(model: ArchitectureModel, kind: NodeKind, spec: NodeSpec, required: boolean): EditError | null {
    if (kind !== 'junction' && (spec.label !== undefined || required)) {
        const problem = labelProblem(spec.label ?? '');
        if (problem) return { code: 'label', message: problem };
    }
    if (kind !== 'junction' && spec.icon) {
        const problem = iconProblem(spec.icon);
        if (problem) return { code: 'icon', message: problem };
    }
    if (spec.parent) {
        const target = findNode(model, spec.parent);
        if (!target || target.kind !== 'group') return { code: 'parent', message: `There is no group ${spec.parent}.` };
    }
    return null;
}

// ---- operations ----------------------------------------------------------------------------------

/** A new architecture diagram for an empty editor (comments in it are kept above the header). */
export function startArchitecture(code: string): string {
    const head = code.trim() === '' ? '' : `${code}${code.endsWith('\n') ? '' : '\n'}`;
    return `${head}architecture-beta\n`;
}

/** Junctions have no label: junction_1, junction_2, …, the first number whose id is free. */
function junctionId(code: string): string {
    for (let n = 1; ; n++) {
        const id = uniqueId(code, `junction_${n}`);
        if (id === `junction_${n}`) return id;
    }
}

/**
 * Add a group, service or junction. Its id is made from the label (a junction's is junction_1, …),
 * unique in the diagram. Returns the new text and the id.
 */
export function addNode(code: string, kind: NodeKind, spec: NodeSpec = {}): EditResult {
    const model = parseArchitecture(code);
    if (!model) return NOT_ARCHITECTURE;
    const error = checkSpec(model, kind, spec, kind !== 'junction');
    if (error) return { ok: false, error };
    const label = kind === 'junction' ? null : spec.label!.trim();
    const parent = spec.parent || null;
    const id = kind === 'junction' ? junctionId(code) : uniqueId(code, label!, kind === 'group' ? 'grp' : 'node');
    const anchor = nodeAnchor(model, kind, parent);
    const lines = [...model.lines];
    insertLine(lines, anchor + 1, indentAfter(model, anchor) + nodeStatement(kind, id, spec.icon || null, label, parent));
    return finish(model, lines, { id, line: anchor + 1 });
}

/**
 * Change a node's label, icon or group; a field left undefined is kept as written. `icon: null`
 * removes the icon (or icon text). Moving a group into a group whose line comes after it moves the
 * group's line (and those of its own groups that would otherwise come before it) to just after the
 * new parent's line, since Mermaid needs a parent group before its children.
 */
export function updateNode(code: string, id: string, spec: NodeSpec): EditResult {
    const model = parseArchitecture(code);
    if (!model) return NOT_ARCHITECTURE;
    const node = findNode(model, id);
    if (!node) return fail('not-found', `There is no node ${id}.`);
    // Only what changes is checked and rewritten: a value already in the text is kept as written.
    const changes: NodeSpec = {};
    if (node.kind !== 'junction') {
        const iconNow = node.kind === 'service' && node.iconText !== null ? undefined : node.icon;
        if (spec.icon !== undefined && (spec.icon || null) !== iconNow) changes.icon = spec.icon || null;
        const label = spec.label?.trim();
        if (label !== undefined && label !== node.label) changes.label = label;
    }
    const parent = spec.parent === undefined ? node.parent : spec.parent || null;
    if (parent !== node.parent) changes.parent = parent;
    const error = checkSpec(model, node.kind, changes, false);
    if (error) return { ok: false, error };
    if (parent !== null && node.kind === 'group' && (parent === id || descendantGroups(model, id).has(parent))) {
        return fail('cycle', parent === id ? 'A group cannot be placed in itself.' : `${parent} is inside ${id}, so ${id} cannot be placed in it.`);
    }

    const parts = nodeParts(stripCr(model.lines[node.line]))!;
    let { iconSeg, titleSeg, inSeg } = parts;
    const lead = (seg: string) => /^[\t ]*/.exec(seg)![0];
    if (changes.icon !== undefined) iconSeg = changes.icon ? `${lead(iconSeg)}(${changes.icon})` : '';
    if (changes.label !== undefined) titleSeg = `${lead(titleSeg)}[${changes.label}]`;
    if (changes.parent !== undefined) inSeg = parent ? ` in ${parent}` : '';

    const lines = [...model.lines];
    setLine(lines, node.line, `${parts.indent}${parts.keyword}${parts.id}${iconSeg}${titleSeg}${inSeg}${parts.tail}`);
    const target = parent === null ? undefined : findNode(model, parent);
    if (changes.parent !== undefined && node.kind === 'group' && target && target.line > node.line) {
        // The group and its own groups that sit above the new parent move, in their order, below it.
        const inside = descendantGroups(model, id);
        const moving = nodes(model).filter((n) => n.id === id || (n.kind === 'group' && inside.has(n.id) && n.line < target.line)).map((n) => n.line);
        const texts = moving.map((l) => stripCr(lines[l]));
        for (const l of [...moving].reverse()) removeLine(lines, l);
        const at = target.line - moving.length + 1;
        texts.forEach((text, k) => insertLine(lines, at + k, text));
    }
    if (lines.join('\n') === code) return { ok: true, code, id };
    return finish(model, lines, { id });
}

/**
 * Remove a node and the edges that touch it. A removed group's own nodes move to its parent group
 * (or to the top level). Refused when an `align` line names the node: that line is not managed here.
 */
export function removeNode(code: string, id: string): EditResult {
    const model = parseArchitecture(code);
    if (!model) return NOT_ARCHITECTURE;
    const node = findNode(model, id);
    if (!node) return fail('not-found', `There is no node ${id}.`);
    const named = model.unmanaged.find((l) => ALIGN_RE.exec(stripCr(model.lines[l]))?.[1].trim().split(/[\t ]+/).includes(id));
    if (named !== undefined) return fail('in-use', `Line ${named + 1} (align) names ${id}. Change that line in the Code tab first.`);

    const lines = [...model.lines];
    for (const child of nodes(model).filter((n) => n.parent === id)) {
        const parts = nodeParts(stripCr(lines[child.line]))!;
        setLine(lines, child.line, `${parts.indent}${parts.keyword}${parts.id}${parts.iconSeg}${parts.titleSeg}${node.parent ? ` in ${node.parent}` : ''}${parts.tail}`);
    }
    const gone = [node.line, ...edges(model).filter((e) => e.from.id === id || e.to.id === id).map((e) => e.line)].sort((a, b) => b - a);
    for (const l of gone) removeLine(lines, l);
    return finish(model, lines);
}

export interface EdgeSpec {
    from: Pick<EdgeEnd, 'id' | 'side'> & Partial<Pick<EdgeEnd, 'group' | 'arrow'>>;
    to: Pick<EdgeEnd, 'id' | 'side'> & Partial<Pick<EdgeEnd, 'group' | 'arrow'>>;
    label?: string | null;
}

/** `line`: the edge being changed, which does not count as a duplicate of itself. */
function checkEdge(model: ArchitectureModel, spec: EdgeSpec, line: number | null = null): EditError | null {
    for (const [end, name] of [[spec.from, 'start'], [spec.to, 'end']] as const) {
        const node = findNode(model, end.id);
        if (!node) return { code: 'endpoint', message: `Choose the node the connection should ${name} at.` };
        if (node.kind === 'group') return { code: 'endpoint', message: 'A connection joins services or junctions, not groups.' };
        if (!SIDES.includes(end.side)) return { code: 'endpoint', message: 'A side is one of L, R, T, B.' };
    }
    if (spec.from.id === spec.to.id) return { code: 'endpoint', message: 'A connection needs two different nodes.' };
    if (edges(model).some((e) => e.line !== line && e.from.id === spec.from.id && e.to.id === spec.to.id)) {
        return { code: 'endpoint', message: 'There is already a connection from that node to that node, and Mermaid draws only one. Change that one, or connect the other way round.' };
    }
    const problem = labelProblem(spec.label ?? '', true);
    return problem ? { code: 'label', message: problem } : null;
}

function edgeOf(spec: EdgeSpec): Pick<EdgeItem, 'from' | 'to' | 'label'> {
    const end = (e: EdgeSpec['from']): EdgeEnd => ({ id: e.id, side: e.side, group: e.group ?? false, arrow: e.arrow ?? false });
    return { from: end(spec.from), to: end(spec.to), label: spec.label?.trim() || null };
}

/** Add an edge after the last edge (or at the end). Returns the new text and the edge's line. */
export function addEdge(code: string, spec: EdgeSpec): EditResult {
    const model = parseArchitecture(code);
    if (!model) return NOT_ARCHITECTURE;
    const error = checkEdge(model, spec);
    if (error) return { ok: false, error };
    const anchor = edgeAnchor(model);
    const lines = [...model.lines];
    insertLine(lines, anchor + 1, indentAfter(model, anchor) + edgeStatement(edgeOf(spec)));
    return finish(model, lines, { line: anchor + 1 });
}

/** Rewrite the edge on line `line` (ends, sides, arrows, label); its indentation and comment stay. */
export function updateEdge(code: string, line: number, spec: Partial<EdgeSpec>): EditResult {
    const model = parseArchitecture(code);
    if (!model) return NOT_ARCHITECTURE;
    const edge = model.items[line];
    if (!edge || edge.kind !== 'edge') return fail('not-found', 'That connection is no longer in the diagram.');
    const full: EdgeSpec = {
        from: { ...edge.from, ...spec.from },
        to: { ...edge.to, ...spec.to },
        label: spec.label === undefined ? edge.label : spec.label,
    };
    const next = edgeOf(full);
    const same = (a: EdgeEnd, b: EdgeEnd) => a.id === b.id && a.side === b.side && a.group === b.group && a.arrow === b.arrow;
    if (same(next.from, edge.from) && same(next.to, edge.to) && next.label === edge.label) return { ok: true, code, line };
    // A label already in the text is kept as written, even one the builder would not write.
    const error = checkEdge(model, next.label === edge.label ? { ...full, label: null } : full, line);
    if (error) return { ok: false, error };
    const parts = edgeParts(stripCr(model.lines[line]))!;
    const lines = [...model.lines];
    setLine(lines, line, parts.indent + edgeStatement(next) + parts.tail);
    return finish(model, lines, { line });
}

/** A box in the preview's coordinates. */
export interface Box { x: number; y: number; width: number; height: number }

/**
 * The sides for a line from box `from` to box `to` that takes the short way: along the axis on which
 * their centres are further apart (target to the right: R to L; below: B to T; left: L to R; above: T to B).
 */
export function sidesBetween(from: Box, to: Box): { from: Side; to: Side } {
    const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
    const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: 'R', to: 'L' } : { from: 'L', to: 'R' };
    return dy >= 0 ? { from: 'B', to: 'T' } : { from: 'T', to: 'B' };
}

/**
 * Connect node `fromId` to node `toId` with an arrow at `toId`, on the given sides. Refuses a node
 * joined to itself and a pair that is already connected, either way round (the Connect form can
 * still add the other direction).
 */
export function connectNodes(code: string, fromId: string, toId: string, sides: { from: Side; to: Side }): EditResult {
    const model = parseArchitecture(code);
    if (!model) return NOT_ARCHITECTURE;
    const from = findNode(model, fromId);
    const to = findNode(model, toId);
    if (!from || !to) return fail('not-found', 'That node is no longer in the diagram.');
    if (fromId === toId) return fail('endpoint', `${nodeName(from)} cannot be connected to itself. Choose another node.`);
    if (from.kind === 'group' || to.kind === 'group') return fail('endpoint', 'A connection joins services or junctions, not groups.');
    const existing = edges(model).some((e) => (e.from.id === fromId && e.to.id === toId) || (e.from.id === toId && e.to.id === fromId));
    if (existing) return fail('endpoint', `${nodeName(from)} and ${nodeName(to)} are already connected. Use Connect to add another connection.`);
    return addEdge(code, { from: { id: fromId, side: sides.from }, to: { id: toId, side: sides.to, arrow: true } });
}

export function removeEdge(code: string, line: number): EditResult {
    const model = parseArchitecture(code);
    if (!model) return NOT_ARCHITECTURE;
    if (model.items[line]?.kind !== 'edge') return fail('not-found', 'That connection is no longer in the diagram.');
    const lines = [...model.lines];
    removeLine(lines, line);
    return finish(model, lines);
}
