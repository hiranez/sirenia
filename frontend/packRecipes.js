/**
 * Which icon-pack recipes this installation offers, for the editor's "How to add an icon pack" help.
 *
 * A recipe is `<root>/<name>/mapping.json` with a `pack` object and a `prefix`: the same rule as
 * `discoverRecipes` in scripts/packs.mjs, which is what `packs add` uses. Only the fields the help
 * shows leave this module: prefix, label, owner, and two links, the vendor's icon page (`iconsUrl`,
 * the recipe's `upstream.page`) and the vendor's terms (`termsUrl`, `pack.terms.url`); a link
 * that is not a plain https URL is null. A hosted edition has no recipes next to it, so its list is
 * empty and the editor offers no install instructions.
 *
 * Nothing here throws: a missing directory, an unreadable file or a malformed recipe is skipped.
 */
import fs from 'node:fs';
import path from 'node:path';

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/; // same rule as the pack prefix in scripts/packs.mjs
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const URL_MAX = 500; // same limit as the editor's check

/** `value` when it is an https URL of at most URL_MAX characters, otherwise null. */
export function httpsLink(value) {
  if (typeof value !== 'string' || value.length > URL_MAX || !value.startsWith('https://') || /[\s\p{Cc}]/u.test(value)) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The recipes under `root`, sorted by directory name; a repeated prefix keeps the later recipe,
 * in the first one's place (as scripts/packs.mjs does).
 * @param {string} root
 * @param {(message: string) => void} [warn]
 * @returns {{ prefix: string, label: string, owner: string, iconsUrl: string | null, termsUrl: string | null }[]}
 */
export function discoverRecipes(root, warn = () => {}) {
  const recipes = new Map();
  let names;
  try {
    names = fs.readdirSync(root).sort();
  } catch (e) {
    if (e.code !== 'ENOENT') warn(`Recipes directory ${root} is not readable: ${e.message}`);
    return [];
  }
  for (const name of names) {
    const file = path.join(root, name, 'mapping.json');
    let mapping;
    try {
      mapping = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') warn(`Recipe ${file} ignored: ${e.message}`);
      continue;
    }
    if (!isObject(mapping) || !isObject(mapping.pack) || typeof mapping.prefix !== 'string' || !NAME.test(mapping.prefix)) continue;
    recipes.set(mapping.prefix, {
      prefix: mapping.prefix,
      label: typeof mapping.pack.label === 'string' && mapping.pack.label ? mapping.pack.label : mapping.prefix,
      owner: typeof mapping.pack.owner === 'string' ? mapping.pack.owner : '',
      iconsUrl: httpsLink(mapping.upstream?.page),
      termsUrl: httpsLink(mapping.pack.terms?.url ?? mapping.pack.termsUrl),
    });
  }
  return [...recipes.values()];
}

/**
 * Where recipes are looked for: PACK_RECIPES_DIR when set, otherwise `icons/` next to the frontend
 * directory (a source checkout, or the local image). Whether it exists is `discoverRecipes`' business.
 * @param {Record<string, string | undefined>} env
 * @param {string} frontendDir
 */
export function recipesRoot(env, frontendDir) {
  return env.PACK_RECIPES_DIR ? path.resolve(env.PACK_RECIPES_DIR) : path.resolve(frontendDir, '..', 'icons');
}
