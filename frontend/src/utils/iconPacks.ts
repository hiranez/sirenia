/**
 * Icon packs installed next to the editor, under /packs/ on its own origin (the Content-Security-
 * Policy allows nothing else). `/packs/index.json` lists them; each pack is `/packs/<prefix>.json`
 * (Iconify JSON plus an optional `sirenia` object with the pack's label and notices).
 *
 * The parsing and composing functions are pure, so they also run under `node --test`. The index is
 * untrusted input: anything unexpected drops the entry (or the whole index) and never throws into the
 * UI. No pack installed is a normal state, not an error.
 */

export const PACKS_BASE = '/packs/';
export const PACK_INDEX_URL = `${PACKS_BASE}index.json`;

const PREFIX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const FILE = /^[a-z0-9]+(-[a-z0-9]+)*\.json$/;
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const NAME_MAX = 80;
const NOTICE_MAX = 1000;
const URL_MAX = 500;
const MAX_PACKS = 100;

export interface PackNotice {
    /** Sentence(s) shown before the application's independence sentence. */
    editor: string;
    /** Optional sentence(s) shown after it. */
    editorAfter: string | null;
}

export interface PackEntry {
    prefix: string;
    file: string;
    label: string;
    owner: string | null;
    termsUrl: string | null;
    notice: PackNotice | null;
    icons: number | null;
}

/** The branding values the footer sentence needs (see branding.ts). */
export interface PackBranding {
    productName: string;
    vendorName: string | null;
}

/** What Mermaid receives: the Iconify part of a pack, without the `sirenia` object. */
export interface IconifyPart {
    prefix: string;
    icons: Record<string, unknown>;
    [key: string]: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// undefined = absent; null = present but invalid; otherwise the string.
function text(value: unknown, max: number): string | null | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim() === '' || value.length > max || CONTROL_CHARS.test(value)) return null;
    return value;
}

function parseEntry(raw: unknown): PackEntry | null {
    if (!isObject(raw)) return null;
    const { prefix, file } = raw;
    if (typeof prefix !== 'string' || !PREFIX.test(prefix)) return null;
    if (typeof file !== 'string' || !FILE.test(file) || file !== `${prefix}.json`) return null;

    const label = text(raw.label, NAME_MAX);
    const owner = text(raw.owner, NAME_MAX);
    const termsUrl = text(raw.termsUrl, URL_MAX);
    if (label === null || owner === null || termsUrl === null) return null;
    if (termsUrl !== undefined && !termsUrl.startsWith('https://')) return null;

    let notice: PackNotice | null = null;
    if (raw.notice !== undefined) {
        if (!isObject(raw.notice)) return null;
        if (Object.keys(raw.notice).some((k) => k !== 'editor' && k !== 'editorAfter')) return null;
        const editor = text(raw.notice.editor, NOTICE_MAX);
        const editorAfter = text(raw.notice.editorAfter, NOTICE_MAX);
        if (editor === null || editorAfter === null) return null;
        if (editor !== undefined) notice = { editor, editorAfter: editorAfter ?? null };
    }

    let icons: number | null = null;
    if (raw.icons !== undefined) {
        if (typeof raw.icons !== 'number' || !Number.isInteger(raw.icons) || raw.icons < 0) return null;
        icons = raw.icons;
    }
    return { prefix, file, label: label ?? prefix, owner: owner ?? null, termsUrl: termsUrl ?? null, notice, icons };
}

/**
 * Validate a parsed `/packs/index.json`. A wrong shape drops the whole index (returns []); a bad
 * entry drops that entry; a repeated prefix keeps the first.
 */
export function parsePackIndex(data: unknown): PackEntry[] {
    if (!isObject(data) || data.format !== 1 || !Array.isArray(data.packs) || data.packs.length > MAX_PACKS) return [];
    const seen = new Set<string>();
    const entries: PackEntry[] = [];
    for (const raw of data.packs) {
        const entry = parseEntry(raw);
        if (!entry || seen.has(entry.prefix)) continue;
        seen.add(entry.prefix);
        entries.push(entry);
    }
    return entries;
}

/**
 * Footer paragraph for one pack: the pack's sentence(s), the application's independence sentence
 * (naming the pack owner), then the pack's closing sentence(s). null when the pack has no notice or
 * no owner.
 */
export function composeFooterNotice(entry: PackEntry, branding: PackBranding): string | null {
    if (!entry.notice || !entry.owner) return null;
    const { productName, vendorName } = branding;
    const independence = vendorName
        ? `${productName} is an independent product; ${vendorName} is not affiliated with, sponsored by, or endorsed by ${entry.owner}.`
        : `${productName} is an independent project, not affiliated with, sponsored by, or endorsed by ${entry.owner}.`;
    return [entry.notice.editor, independence, entry.notice.editorAfter].filter(Boolean).join(' ');
}

/** The Iconify part of a pack file (drops `sirenia`). Throws on anything that is not a pack. */
export function iconifyPart(data: unknown, prefix: string): IconifyPart {
    if (!isObject(data) || data.prefix !== prefix || !isObject(data.icons)) {
        throw new Error(`Icon pack ${prefix}: not a valid pack file`);
    }
    const copy: Record<string, unknown> = { ...data };
    delete copy.sirenia;
    return copy as IconifyPart;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
// Called as a plain function, never as a method of another object ("Illegal invocation").
const globalFetch: Fetch = (input, init) => fetch(input, init);

/**
 * The installed packs, from `/packs/index.json` on this origin. Any failure (404, the SPA's
 * index.html instead of JSON, an invalid shape, a network error) means "no packs installed".
 */
export async function loadPackIndex(fetchImpl: Fetch = globalFetch): Promise<PackEntry[]> {
    try {
        const res = await fetchImpl(PACK_INDEX_URL, { cache: 'no-cache' });
        if (!res.ok) return [];
        return parsePackIndex(await res.json());
    } catch {
        return [];
    }
}

/** Mermaid loader for one pack: rejects on a non-OK response or non-JSON. */
export async function fetchPack(entry: PackEntry, fetchImpl: Fetch = globalFetch): Promise<IconifyPart> {
    const res = await fetchImpl(`${PACKS_BASE}${entry.file}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Icon pack ${entry.prefix}: HTTP ${res.status}`);
    return iconifyPart(await res.json(), entry.prefix);
}
