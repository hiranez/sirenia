/**
 * What the "How to add an icon pack" help shows. `/pack-recipes.json` (served by the front door)
 * lists the recipes this installation offers; it is empty on a hosted edition, which bundles its
 * packs, and then the editor offers no install instructions.
 *
 * The functions are pure, so they also run under `node --test`. The route's answer is untrusted
 * input: anything unexpected drops the entry (or the whole answer) and never throws into the UI. The
 * two vendor links of a recipe are shown as links, so each must be a plain https URL; a recipe with
 * a link that is not is dropped.
 */
import type { PackEntry } from './iconPacks';

export const PACK_RECIPES_URL = '/pack-recipes.json';

const PREFIX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const NAME_MAX = 80;
const VERSION_MAX = 40;
const URL_MAX = 500;
const MAX_RECIPES = 100;
const IMAGE = 'ghcr.io/hiranez/sirenia';
const VERSION_PLACEHOLDER = '<version>';

export interface Recipe {
    prefix: string;
    label: string;
    owner: string;
    /** The vendor's page of official icons. */
    iconsUrl: string | null;
    /** The vendor's terms for the icons. */
    termsUrl: string | null;
}

export interface RecipeInfo {
    /** The editor's version, which is also the tag of the published image; null when not usable. */
    version: string | null;
    recipes: Recipe[];
}

export interface RecipeRow extends Recipe {
    installed: boolean;
}

export interface HelpStep {
    text: string;
    /** A command to run, shown in its own block with a Copy button. */
    command?: string;
    /** A remark that belongs to the step. */
    note?: string;
}

export interface HelpSection {
    id: 'start' | 'docker' | 'compose' | 'source';
    title: string;
    steps: HelpStep[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const NONE: RecipeInfo = { version: null, recipes: [] };

function name(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '' || value.length > NAME_MAX || CONTROL_CHARS.test(value)) return null;
    return value;
}

/** A link to show: absent or null is null; an https URL is kept; anything else is undefined (unusable). */
export function link(value: unknown): string | null | undefined {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.length > URL_MAX || !value.startsWith('https://') || /[\s\p{Cc}]/u.test(value)) return undefined;
    try {
        return new URL(value).protocol === 'https:' ? value : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Validate a parsed `/pack-recipes.json`. A wrong shape means no recipes; a bad entry (including one
 * whose icon or terms link is not an https URL) is dropped; a repeated prefix keeps the first. An
 * unusable label falls back to the prefix, an unusable owner to "".
 */
export function parseRecipes(data: unknown): RecipeInfo {
    if (!isObject(data) || data.format !== 1 || !Array.isArray(data.recipes) || data.recipes.length > MAX_RECIPES) return NONE;
    const version = typeof data.version === 'string' && data.version.length <= VERSION_MAX && VERSION.test(data.version) ? data.version : null;
    const seen = new Set<string>();
    const recipes: Recipe[] = [];
    for (const raw of data.recipes) {
        if (!isObject(raw) || typeof raw.prefix !== 'string' || !PREFIX.test(raw.prefix) || seen.has(raw.prefix)) continue;
        const iconsUrl = link(raw.iconsUrl);
        const termsUrl = link(raw.termsUrl);
        if (iconsUrl === undefined || termsUrl === undefined) continue;
        seen.add(raw.prefix);
        recipes.push({ prefix: raw.prefix, label: name(raw.label) ?? raw.prefix, owner: name(raw.owner) ?? '', iconsUrl, termsUrl });
    }
    return { version, recipes };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
// Called as a plain function, never as a method of another object ("Illegal invocation").
const globalFetch: Fetch = (input, init) => fetch(input, init);

/**
 * The recipes this installation offers. Any failure (404, the SPA's index.html instead of JSON, an
 * invalid shape, a network error) means "none": nothing about packs is then offered.
 */
export async function loadRecipes(fetchImpl: Fetch = globalFetch): Promise<RecipeInfo> {
    try {
        const res = await fetchImpl(PACK_RECIPES_URL, { cache: 'no-cache' });
        if (!res.ok) return NONE;
        return parseRecipes(await res.json());
    } catch {
        return NONE;
    }
}

/** The recipes, each marked with whether a pack of that prefix is installed. */
export function recipeRows(recipes: Recipe[], installed: Pick<PackEntry, 'prefix'>[]): RecipeRow[] {
    const have = new Set(installed.map((p) => p.prefix));
    return recipes.map((r) => ({ ...r, installed: have.has(r.prefix) }));
}

/** The recipes the commands are shown for: those not installed yet, or all of them when every one is. */
export function suggestedRecipes(rows: RecipeRow[]): RecipeRow[] {
    const missing = rows.filter((r) => !r.installed);
    return missing.length ? missing : rows;
}

/** `packs list`, run the way the published image is run. */
export function listCommand(version: string | null): string {
    return `docker run --rm -it -v sirenia-packs:/packs ${IMAGE}:${version ?? VERSION_PLACEHOLDER} packs list`;
}

/** The one-command start: the published image, installing `prefixes` before it starts. */
export function startCommand(prefixes: string[], version: string | null): string {
    return `docker run --rm -p 8080:8080 -v sirenia-packs:/packs -e SIRENIA_PACKS=${prefixes.join(',')} -e SIRENIA_ACCEPT_PACK_TERMS=yes ${IMAGE}:${version ?? VERSION_PLACEHOLDER}`;
}

/** The ways to add the packs of `prefixes`, simplest first, each as numbered steps with the exact commands. */
export function helpSections(prefixes: string[], version: string | null): HelpSection[] {
    const names = prefixes.join(' ');
    const image = `${IMAGE}:${version ?? VERSION_PLACEHOLDER}`;
    const volume = 'The -v sirenia-packs:/packs part must be the same volume the server was started with. A different volume installs the packs where the server does not look.';
    const asks = `It shows each vendor's terms, asks you to accept them, then downloads the icons:`;
    const reload = { text: 'Reload this page. The packs are then listed here and in the editor.' };
    return [
        {
            id: 'start',
            title: 'Docker, published image: start with the packs (simplest)',
            steps: [
                { text: 'Stop the running container.' },
                {
                    text: "Start it again with two more settings. SIRENIA_PACKS names the packs; SIRENIA_ACCEPT_PACK_TERMS=yes says that you accept each vendor's terms, linked in the table above. The icons are downloaded once, into the volume:",
                    command: startCommand(prefixes, version),
                    note: volume,
                },
                reload,
            ],
        },
        {
            id: 'docker',
            title: 'Docker, published image: add to the installation',
            steps: [
                { text: `Run this in a terminal. ${asks}`, command: `docker run --rm -it -v sirenia-packs:/packs ${image} packs add ${names}`, note: volume },
                { text: 'Stop the running container, then start it again with the same command as before. Packs are read when the server starts, so a restart is needed.' },
                reload,
            ],
        },
        {
            id: 'compose',
            title: 'Docker Compose (built from source)',
            steps: [
                { text: `Run this in the project folder. ${asks}`, command: `docker compose run --rm sirenia packs add ${names}` },
                { text: 'Restart the server so that it reads the packs:', command: 'docker compose restart sirenia' },
                reload,
            ],
        },
        {
            id: 'source',
            title: 'From source',
            steps: [
                { text: `Run this in the project folder. ${asks}`, command: `npm run packs -- add ${names}` },
                { text: 'Restart the two programs, the render service and the editor\'s server, so that they read the packs.' },
                reload,
            ],
        },
    ];
}
