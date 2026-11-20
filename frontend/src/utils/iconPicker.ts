/**
 * Logic of the icon picker: the catalog of a pack, searching it, and inserting an icon into diagram
 * code. Pure functions, so they also run under `node --test`.
 *
 * Vendor icons appear only inside diagrams, with the official product name as the label, so nothing
 * here deals with artwork: an entry is text (name, group, `prefix:icon`).
 *
 * The pack file is untrusted input: parseCatalog applies the backend validator's rules to each entry
 * and drops what does not pass, instead of throwing.
 */

export interface CatalogEntry {
    /** An icon or alias name of the pack (`cloud-run`). */
    icon: string;
    /** Official product name, used as the label. */
    name: string;
    group: string | null;
}

export type DiagramKind = 'architecture' | 'flowchart' | 'empty' | 'other';

const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u;
// Characters with a meaning in Mermaid syntax; same set as the backend's pack validator.
const MERMAID_SYNTAX_CHARS = /[[\]{}<>"`\\|#;%]/;
const ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 80;
export const CATALOG_MAX = 5000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

function safeText(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '' && value.length <= NAME_MAX
        && !CONTROL_CHARS.test(value) && !MERMAID_SYNTAX_CHARS.test(value);
}

function parseEntry(raw: unknown, icons: object, aliases: object | null): CatalogEntry | null {
    if (!isObject(raw)) return null;
    if (Object.keys(raw).some((k) => k !== 'icon' && k !== 'name' && k !== 'group')) return null;
    const { icon, name, group } = raw;
    // The icon name ends up inside a diagram line, so it must be a plain Iconify name.
    if (typeof icon !== 'string' || !ICON_NAME.test(icon) || !(has(icons, icon) || (aliases !== null && has(aliases, icon)))) return null;
    if (!safeText(name)) return null;
    if (group !== undefined && !safeText(group)) return null;
    return { icon, name, group: group ?? null };
}

/**
 * The catalog of a pack file: `sirenia.catalog` when it has at least one valid entry, otherwise one
 * entry per icon and alias name. Never throws; an invalid entry is dropped (a repeated icon keeps the
 * first). Returns [] when the file is not a pack of that prefix.
 */
export function parseCatalog(packJson: unknown, prefix: string): CatalogEntry[] {
    if (!isObject(packJson) || packJson.prefix !== prefix || !isObject(packJson.icons)) return [];
    const { icons } = packJson;
    const aliases = isObject(packJson.aliases) ? packJson.aliases : null;

    const raw = isObject(packJson.sirenia) ? packJson.sirenia.catalog : undefined;
    if (Array.isArray(raw) && raw.length <= CATALOG_MAX) {
        const seen = new Set<string>();
        const entries: CatalogEntry[] = [];
        for (const item of raw) {
            const entry = parseEntry(item, icons, aliases);
            if (!entry || seen.has(entry.icon)) continue;
            seen.add(entry.icon);
            entries.push(entry);
        }
        if (entries.length > 0) return entries;
    }

    const names = [...Object.keys(icons), ...(aliases ? Object.keys(aliases) : [])]
        .filter((n) => ICON_NAME.test(n))
        .slice(0, CATALOG_MAX);
    return [...new Set(names)].sort().map((icon) => ({ icon, name: icon.replace(/-/g, ' '), group: null }));
}

/**
 * Entries in which every whitespace-separated term of `query` occurs (case-insensitive) in the name,
 * the icon name or the group. Catalog order is kept, except that names starting with the query come
 * first. An empty query returns everything.
 */
export function searchCatalog(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [...entries];
    const whole = terms.join(' ');
    const first: CatalogEntry[] = [];
    const rest: CatalogEntry[] = [];
    for (const entry of entries) {
        const name = entry.name.toLowerCase();
        const haystack = `${name}\n${entry.icon}\n${(entry.group ?? '').toLowerCase()}`;
        if (!terms.every((t) => haystack.includes(t))) continue;
        (name.startsWith(whole) ? first : rest).push(entry);
    }
    return [...first, ...rest];
}

// ---- diagram code ---------------------------------------------------------------------------------

/** The kind of diagram and the index of its header line, from the first meaningful line. */
export function scanDiagram(lines: readonly string[]): { kind: DiagramKind; header: number } {
    let i = 0;
    for (; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') continue;
        if (line === '---' && i === lines.findIndex((l) => l.trim() !== '')) {
            // YAML front matter: skip to the closing line (unclosed means not a diagram we know).
            const close = lines.findIndex((l, j) => j > i && l.trim() === '---');
            if (close === -1) return { kind: 'other', header: -1 };
            i = close;
            continue;
        }
        if (line.startsWith('%%{')) {
            // Directive, possibly over several lines, ending in `}%%`.
            while (i < lines.length && !lines[i].includes('}%%')) i++;
            if (i === lines.length) return { kind: 'other', header: -1 };
            continue;
        }
        if (line.startsWith('%%')) continue;
        const lower = line.toLowerCase();
        if (/^architecture-beta(\s|;|$)/.test(lower)) return { kind: 'architecture', header: i };
        if (/^(graph|flowchart(-elk)?)(\s|;|$)/.test(lower)) return { kind: 'flowchart', header: i };
        return { kind: 'other', header: i };
    }
    return { kind: 'empty', header: -1 };
}

/** What kind of diagram `code` is, judged by its first meaningful line. */
export function diagramKind(code: string): DiagramKind {
    return scanDiagram(code.split('\n')).kind;
}

// Words a node id must not be: Mermaid keywords of the two diagram kinds that take icons.
const RESERVED_IDS = new Set(['end', 'graph', 'flowchart', 'subgraph', 'style', 'class', 'classdef', 'click', 'default',
    'linkstyle', 'direction', 'architecture', 'service', 'group', 'junction', 'in', 'align', 'row', 'column']);
const ID_MAX = 40;

/**
 * An identifier made from `text` (an icon name or a label) that no word of `code` already uses,
 * compared case-insensitively: lower-case letters, digits and underscores, starting with a letter.
 * Lower case also keeps clear of the architecture lexer, which reads a leading L, R, T or B as a
 * side and a leading `title` as a title statement. `fallback` is used when `text` has no letters
 * or digits.
 */
export function uniqueId(code: string, text: string, fallback = 'node'): string {
    const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let base = plain.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, ID_MAX).replace(/_+$/, '') || fallback;
    if (!/^[a-z]/.test(base) || base.startsWith('title')) base = `n_${base}`;
    if (RESERVED_IDS.has(base)) base = `${base}_node`;
    const used = new Set((code.match(/\w+/g) ?? []).map((w) => w.toLowerCase()));
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    return id;
}

function iconLine(kind: 'architecture' | 'flowchart', code: string, prefix: string, entry: CatalogEntry): string {
    const id = uniqueId(code, entry.icon);
    return kind === 'architecture'
        ? `  service ${id}(${prefix}:${entry.icon})[${entry.name}]`
        : `  ${id}@{ icon: "${prefix}:${entry.icon}", label: "${entry.name}" }`;
}

export interface Insertion {
    code: string;
    /** Caret position: the end of the inserted line. */
    cursor: number;
}

/**
 * Add a node for `entry` to the diagram, on a new line after the line that holds `cursor` (null: at
 * the end), never above the header. An empty editor becomes a new architecture diagram. Returns null
 * when the diagram kind cannot take icons.
 */
export function insertIcon(code: string, cursor: number | null, prefix: string, entry: CatalogEntry): Insertion | null {
    const lines = code.split('\n');
    const { kind, header } = scanDiagram(lines);
    if (kind === 'other') return null;

    if (kind === 'empty') {
        const line = iconLine('architecture', code, prefix, entry);
        const head = code.trim() === '' ? '' : `${code}${code.endsWith('\n') ? '' : '\n'}`;
        const text = `${head}architecture-beta\n${line}`;
        return { code: text, cursor: text.length };
    }

    // A final newline ends the last line; it is not a line of its own.
    const trailing = code.endsWith('\n');
    const body = trailing ? lines.slice(0, -1) : lines;
    let after: number;
    if (cursor === null) {
        after = body.length - 1;
        while (after > header && body[after].trim() === '') after--;
    } else {
        const at = Math.min(Math.max(cursor, 0), code.length);
        after = Math.min(code.slice(0, at).split('\n').length - 1, body.length - 1);
    }
    after = Math.max(after, header);

    const line = iconLine(kind, code, prefix, entry);
    body.splice(after + 1, 0, line);
    const caret = body.slice(0, after + 2).reduce((n, l) => n + l.length + 1, 0) - 1;
    return { code: body.join('\n') + (trailing ? '\n' : ''), cursor: caret };
}

/** A one-node architecture diagram for the preview: the icon, labelled with its official name. */
export function previewCode(prefix: string, entry: CatalogEntry): string {
    return `architecture-beta\n  service preview(${prefix}:${entry.icon})[${entry.name}]`;
}
