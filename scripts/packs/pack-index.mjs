// Builds `index.json` for a directory of icon packs (`<prefix>.json`, Iconify JSON plus an optional
// `sirenia` object). The editor reads the index to learn which packs are installed, their labels and
// the notice text its footer shows; it never lists directories. The index is always generated from
// the pack files, never written by hand. Node built-ins only.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const INDEX_FILE = 'index.json';
export const INDEX_FORMAT = 1;
const PACK_FILE = /^[a-z0-9]+(-[a-z0-9]+)*\.json$/;

/** The index entry for one pack. Only what the editor needs: no export notice, no icon bodies. */
export function packIndexEntry(file, pack) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error(`${file}: not a JSON object`);
  if (`${pack.prefix}.json` !== file) throw new Error(`${file}: prefix "${pack.prefix}" does not match the file name`);
  if (!pack.icons || typeof pack.icons !== 'object' || Array.isArray(pack.icons)) throw new Error(`${file}: missing icons`);
  const meta = pack.sirenia && typeof pack.sirenia === 'object' ? pack.sirenia : {};
  const entry = { prefix: pack.prefix, file, label: meta.label || pack.info?.name || pack.prefix };
  if (meta.owner) entry.owner = meta.owner;
  if (meta.termsUrl) entry.termsUrl = meta.termsUrl;
  const notice = {};
  if (meta.notice?.editor) notice.editor = meta.notice.editor;
  if (meta.notice?.editorAfter) notice.editorAfter = meta.notice.editorAfter;
  if (Object.keys(notice).length) entry.notice = notice;
  entry.icons = Object.keys(pack.icons).length;
  return entry;
}

/**
 * Index text for `dir`: every `*.json` pack except the index itself, sorted by prefix.
 * `overrides` maps a file name to a pack object used instead of (or in addition to) the file on
 * disk, so a drift check can compute the index the generator would write.
 */
export async function buildPackIndex(dir, overrides = {}) {
  const files = new Set(Object.keys(overrides));
  let names = [];
  try {
    names = await readdir(dir);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  // Same selection as the render service: every *.json except the index; dotfiles are not packs.
  for (const name of names) if (name.endsWith('.json') && !name.startsWith('.') && name !== INDEX_FILE) files.add(name);
  const packs = [];
  for (const file of files) {
    if (!PACK_FILE.test(file) || file === INDEX_FILE) throw new Error(`${file}: not a pack file name`);
    const pack = file in overrides ? overrides[file] : JSON.parse(await readFile(join(dir, file), 'utf8'));
    packs.push(packIndexEntry(file, pack));
  }
  packs.sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
  return `${JSON.stringify({ format: INDEX_FORMAT, packs }, null, 2)}\n`;
}

/** Rebuild `dir/index.json` from the packs in `dir`. Returns the path written. */
export async function writePackIndex(dir) {
  const path = join(dir, INDEX_FILE);
  await writeFile(path, await buildPackIndex(dir));
  return path;
}
