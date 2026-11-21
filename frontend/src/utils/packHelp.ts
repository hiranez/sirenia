/**
 * What the "How to add an icon pack" help shows. `/pack-recipes.json` (served by the front door)
 * lists the recipes this installation offers; it is empty on a hosted edition, which bundles its
 * packs, and then the editor offers no install instructions.
 *
 * The functions are pure, so they also run under `node --test`. The route's answer is untrusted
 * input: anything unexpected drops the entry (or the whole answer) and never throws into the UI.
 */
import type { PackEntry } from './iconPacks';

export const PACK_RECIPES_URL = '/pack-recipes.json';

const PREFIX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const NAME_MAX = 80;
const VERSION_MAX = 40;
const MAX_RECIPES = 100;
const IMAGE = 'ghcr.io/hiranez/sirenia';
const VERSION_PLACEHOLDER = '<version>';

export interface Recipe {
    prefix: string;
    label: string;
    owner: string;
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
    id: 'docker' | 'compose' | 'source';
    title: string;
    steps: HelpStep[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const NONE: RecipeInfo = { version: null, recipes: [] };

function name(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '' || value.length > NAME_MAX || CONTROL_CHARS.test(value)) return null;
    return value;
}

/**
 * Validate a parsed `/pack-recipes.json`. A wrong shape means no recipes; a bad entry is dropped; a
 * repeated prefix keeps the first. An unusable label falls back to the prefix, an unusable owner to "".
 */
export function parseRecipes(data: unknown): RecipeInfo {
    if (!isObject(data) || data.format !== 1 || !Array.isArray(data.recipes) || data.recipes.length > MAX_RECIPES) return NONE;
    const version = typeof data.version === 'string' && data.version.length <= VERSION_MAX && VERSION.test(data.version) ? data.version : null;
    const seen = new Set<string>();
    const recipes: Recipe[] = [];
    for (const raw of data.recipes) {
        if (!isObject(raw) || typeof raw.prefix !== 'string' || !PREFIX.test(raw.prefix) || seen.has(raw.prefix)) continue;
        seen.add(raw.prefix);
        recipes.push({ prefix: raw.prefix, label: name(raw.label) ?? raw.prefix, owner: name(raw.owner) ?? '' });
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

/** The recipe the commands are shown for: the first that is not installed, else the first. */
export function suggestedRecipe(rows: RecipeRow[]): RecipeRow | null {
    return rows.find((r) => !r.installed) ?? rows[0] ?? null;
}

/** `packs list`, run the way the published image is run. */
export function listCommand(version: string | null): string {
    return `docker run --rm -it -v sirenia-packs:/packs ${IMAGE}:${version ?? VERSION_PLACEHOLDER} packs list`;
}

/** The three ways to add the pack of `prefix`, each as numbered steps with the exact commands. */
export function helpSections(prefix: string, version: string | null): HelpSection[] {
    const reload = { text: 'Reload this page. The pack is then listed here and in the editor.' };
    return [
        {
            id: 'docker',
            title: 'Docker, published image',
            steps: [
                {
                    text: "Run this in a terminal. It shows the vendor's terms, asks you to accept them, then downloads the icons:",
                    command: `docker run --rm -it -v sirenia-packs:/packs ${IMAGE}:${version ?? VERSION_PLACEHOLDER} packs add ${prefix}`,
                    note: 'The -v sirenia-packs:/packs part must be the same volume the server was started with. A different volume installs the pack where the server does not look.',
                },
                { text: 'Stop the running container, then start it again with the same command as before. Packs are read when the server starts, so a restart is needed.' },
                reload,
            ],
        },
        {
            id: 'compose',
            title: 'Docker Compose (built from source)',
            steps: [
                { text: "Run this in the project folder. It shows the vendor's terms, asks you to accept them, then downloads the icons:", command: `docker compose run --rm sirenia packs add ${prefix}` },
                { text: 'Restart the server so that it reads the pack:', command: 'docker compose restart sirenia' },
                reload,
            ],
        },
        {
            id: 'source',
            title: 'From source',
            steps: [
                { text: "Run this in the project folder. It shows the vendor's terms, asks you to accept them, then downloads the icons:", command: `npm run packs -- add ${prefix}` },
                { text: 'Restart the two programs, the render service and the editor\'s server, so that they read the pack.' },
                reload,
            ],
        },
    ];
}
