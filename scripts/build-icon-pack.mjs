#!/usr/bin/env node
/**
 * build-icon-pack.mjs: a vendor's official icon ZIP → Iconify JSON pack, for icon sets whose file
 * names carry the product names (AWS, Microsoft Azure). The Google Cloud set has its own generator
 * (build-gcp-icon-pack.mjs), because Google's product → icon mapping comes from a guide, not from
 * file names.
 *
 *   node scripts/build-icon-pack.mjs --mapping icons/aws/mapping.json            # build packs + catalog
 *   node scripts/build-icon-pack.mjs --mapping icons/aws/mapping.json --check    # fail if outputs differ
 *   ... --out <dir>/<prefix>.json (repeatable) --no-docs --docs <file> --offline --cache <dir>
 *
 * Same contract as the Google Cloud generator, which is what scripts/packs.mjs relies on:
 * `--mapping --out --no-docs --offline --cache`. Defaults: outputs backend/packs/<prefix>.json and
 * frontend/public/packs/<prefix>.json, catalog CATALOG.md next to the recipe, cache .cache/<prefix>-icons.
 *
 * The recipe (`mapping.json`) pins each ZIP by SHA-256 and says which files become icons (`sets`: a
 * pattern per kind of icon, whose named groups `name`, `group` and `id` are read from the path),
 * which files are left out and why (`exclude`), the display names of the vendor's categories
 * (`groups`; a set with `nameFromGroups` takes its names from there too), and the few names a file
 * name cannot spell (`overrides`, by file path).
 *
 * The artwork is not changed. Normalization is render-identical only: the file's metadata (title,
 * comments, ids nothing refers to) is dropped, `<style>` class rules are written onto the elements
 * they style, and the ids that are referenced (gradients, clip paths, masks) are renamed to names
 * that belong to the icon, so that many icons can share one SVG document. Anything the normalizer
 * does not understand fails the build.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_FILE, buildPackIndex } from './packs/pack-index.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_SVG_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const NAME_MAX = 80; // same limit as the pack validator's catalog names

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export class BuildError extends Error {}
const fail = (message) => { throw new BuildError(message); };

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- names -----------------------------------------------------------------------------------

/** Display name from a file-name fragment: `_` and `-` separate words in the vendors' file names. */
export function displayName(raw) {
  return raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Icon key: lowercase kebab-case of a name (`Amazon EC2` → `amazon-ec2`). */
export function iconKey(name) {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---- SVG normalization -----------------------------------------------------------------------

// Properties a class rule may set. Each is also an SVG presentation attribute, so a rule can be
// written onto its element as an attribute.
const PRESENTATION = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'clip-path',
  'clip-rule', 'mask', 'stop-color', 'stop-opacity', 'display', 'visibility', 'color', 'isolation',
  'mix-blend-mode', 'filter',
]);
const DROPPED_ELEMENTS = /<(title|desc|metadata)\b[^>]*>[\s\S]*?<\/\1\s*>|<(?:title|desc|metadata)\b[^>]*\/>/gi;
// Constructs a diagram icon never needs. Some are also refused by the pack validator; finding them
// here gives the maintainer a precise message at build time.
const FORBIDDEN = [
  [/<(?:[\w.-]+:)?(script|foreignobject|iframe|object|embed|image|img|a|text|animate\w*|set|switch|use|font|style)\b/i, 'element'],
  [/\son[a-z]+\s*=/i, 'event-handler attribute'],
  [/javascript:/i, 'javascript: URL'],
  [/@import/i, 'CSS @import'],
];
const TOKEN = /<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|</g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const URL_REF = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g;
const LINK = /^(xlink:)?href$/;

function parseAttrs(source) {
  return [...source.matchAll(ATTR)].map((m) => [m[1], m[2] ?? m[3]]);
}

const escapeAttr = (v) => v.replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Tokens of an SVG fragment: `{ tag, close, self, attrs }`. Text other than whitespace fails. */
function tokenize(source, where) {
  const tokens = [];
  const stack = [];
  for (const m of source.matchAll(TOKEN)) {
    if (m[0].startsWith('<![CDATA[')) fail(`${where}: unexpected CDATA section`);
    if (m[5] !== undefined) {
      // Character data outside <text> is not drawn; whitespace (zero-width included) is dropped.
      if (m[5].replace(/[\s​-‍﻿]/g, '')) fail(`${where}: unexpected text "${m[5].trim().slice(0, 40)}"`);
      continue;
    }
    if (m[2] === undefined) fail(`${where}: malformed markup near "${source.slice(m.index, m.index + 40)}"`);
    const tag = m[2];
    if (m[1]) {
      if (stack.pop() !== tag) fail(`${where}: unbalanced </${tag}>`);
      tokens.push({ tag, close: true });
    } else {
      const self = m[4] === '/';
      if (!self) stack.push(tag);
      tokens.push({ tag, close: false, self, attrs: parseAttrs(m[3]) });
    }
  }
  if (stack.length) fail(`${where}: <${stack.at(-1)}> is not closed`);
  return tokens;
}

function serialize(tokens) {
  return tokens.map((t) => {
    if (t.close) return `</${t.tag}>`;
    const attrs = t.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
    return `<${t.tag}${attrs}${t.self ? '/>' : '>'}`;
  }).join('');
}

/** Class rules of a <style> block, in stylesheet order: [{ classes: Set, decls: [[prop, value]] }]. */
function parseStyles(css, where) {
  const rules = [];
  const text = css.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (text.includes('@')) fail(`${where}: at-rules in <style> are not supported`);
  for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const classes = new Set();
    for (const sel of m[1].split(',')) {
      const s = sel.trim();
      if (!/^\.[\w-]+$/.test(s)) fail(`${where}: unsupported CSS selector "${s}"`);
      classes.add(s.slice(1));
    }
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      if (i < 1) fail(`${where}: malformed CSS declaration "${d}"`);
      const prop = d.slice(0, i).trim().toLowerCase();
      const value = d.slice(i + 1).trim();
      if (!PRESENTATION.has(prop)) fail(`${where}: CSS property "${prop}" cannot be written as an attribute`);
      if (/!important/i.test(value)) fail(`${where}: !important is not supported`);
      return [prop, value];
    });
    rules.push({ classes, decls });
  }
  if (text.replace(/([^{}]+)\{([^}]*)\}/g, '').trim()) fail(`${where}: <style> content not understood`);
  return rules;
}

/**
 * Render-identical normalization of one vendor SVG file.
 * @param {string} source the file's text
 * @param {string} idBase prefix of the ids the icon keeps (`aws-amazon-ec2`); unique per icon
 * @param {string} where for messages
 * @returns {{ body: string, left: number, top: number, width: number, height: number }}
 */
export function normalizeSvg(source, idBase, where = 'svg') {
  const s = source.replace(/^﻿/, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const open = s.match(/<svg\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*>/);
  const end = s.lastIndexOf('</svg>');
  if (!open || end < open.index) fail(`${where}: no <svg> root`);
  if (s.slice(0, open.index).trim() || s.slice(end + '</svg>'.length).trim()) fail(`${where}: content outside the <svg> root`);
  const rootAttrs = parseAttrs(open[1]);
  const rootAttr = (name) => rootAttrs.find(([k]) => k === name)?.[1]?.trim();
  // Without a viewBox, the file's own width and height (in px) are its coordinate system.
  const size = (v) => (v !== undefined && /^\d+(\.\d+)?(px)?$/.test(v) ? Number.parseFloat(v) : null);
  const viewBox = rootAttr('viewBox')
    ?? (size(rootAttr('width')) && size(rootAttr('height')) ? `0 0 ${size(rootAttr('width'))} ${size(rootAttr('height'))}` : null);
  if (!viewBox) fail(`${where}: no viewBox, and no width and height to take it from`);
  const box = viewBox.split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) fail(`${where}: invalid viewBox "${viewBox}"`);
  const aspect = rootAttr('preserveAspectRatio');
  if (aspect !== undefined && aspect !== 'xMidYMid meet' && aspect !== 'xMidYMid') fail(`${where}: preserveAspectRatio="${aspect}" is not supported`);

  let rules = [];
  const body = s.slice(open.index + open[0].length, end)
    .replace(DROPPED_ELEMENTS, '')
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, css) => { rules = rules.concat(parseStyles(css, where)); return ''; });
  for (const [re, what] of FORBIDDEN) {
    const hit = body.match(re);
    if (hit) fail(`${where}: forbidden ${what} ${hit[0]}`);
  }

  // Of the root's attributes only presentation attributes, style and class reach the content; they
  // stay, on a group around it. The others (size, namespaces, ids) mean nothing inside a pack.
  if (rootAttr('transform') !== undefined) fail(`${where}: a transform on the <svg> root is not supported`);
  const kept = rootAttrs.filter(([k]) => PRESENTATION.has(k) || k === 'style' || k === 'class');
  const tokens = tokenize(body, where);
  if (kept.length) {
    tokens.unshift({ tag: 'g', close: false, self: false, attrs: kept });
    tokens.push({ tag: 'g', close: true });
  }

  // 1. Class rules become attributes of the elements they match. A rule beats a presentation
  //    attribute, so it replaces one of the same name; a style attribute still beats both. Every
  //    class attribute is then dropped: in a shared document a class could pick up another icon's
  //    rules or the diagram's own CSS.
  for (const t of tokens) {
    if (t.close) continue;
    const cls = t.attrs.find(([k]) => k === 'class');
    if (!cls) continue;
    const names = new Set(cls[1].trim().split(/\s+/));
    const decls = new Map();
    for (const rule of rules) {
      if ([...rule.classes].some((c) => names.has(c))) for (const [p, v] of rule.decls) decls.set(p, v);
    }
    t.attrs = t.attrs.filter(([k]) => k !== 'class' && !decls.has(k));
    for (const [p, v] of decls) t.attrs.push([p, v]);
  }

  // 2. Ids: those nothing refers to are dropped; the others are renamed to names of this icon.
  const declared = [];
  const referenced = new Set();
  for (const t of tokens) {
    if (t.close) continue;
    for (const [k, v] of t.attrs) {
      if (k === 'id') declared.push(v);
      else if (LINK.test(k)) {
        if (!v.startsWith('#')) fail(`${where}: external reference ${k}="${v.slice(0, 60)}"`);
        referenced.add(v.slice(1));
      } else if (/url\(/i.test(v)) {
        if (/url\(\s*(?!['"]?#)/i.test(v)) fail(`${where}: external reference in ${k}="${v.slice(0, 60)}"`);
        for (const m of v.matchAll(URL_REF)) referenced.add(m[1]);
      }
    }
  }
  const renamed = new Map();
  for (const id of [...declared, ...referenced]) {
    if (referenced.has(id) && !renamed.has(id)) renamed.set(id, `${idBase}-${renamed.size + 1}`);
  }
  for (const t of tokens) {
    if (t.close) continue;
    t.attrs = t.attrs.flatMap(([k, v]) => {
      if (k === 'id') return renamed.has(v) ? [[k, renamed.get(v)]] : [];
      if (k === 'data-name') return [];
      if (LINK.test(k)) return [[k, `#${renamed.get(v.slice(1))}`]];
      return [[k, v.replace(URL_REF, (_, id) => `url(#${renamed.get(id)})`)]];
    });
  }

  const out = serialize(tokens);
  if (!/<(path|polygon|circle|rect|ellipse|polyline|line)\b/.test(out)) fail(`${where}: no shapes`);
  return { body: out, left: box[0], top: box[1], width: box[2], height: box[3] };
}

// ---- selection -------------------------------------------------------------------------------

function compileSets(mapping) {
  return (mapping.sets || []).map((set, i) => {
    if (typeof set.pattern !== 'string' || typeof set.kind !== 'string' || typeof set.zip !== 'string') {
      fail(`sets[${i}] needs "kind", "zip" and "pattern"`);
    }
    return { ...set, re: new RegExp(set.pattern) };
  });
}

function compileExcludes(mapping) {
  return (mapping.exclude || []).map((e, i) => {
    if (typeof e.pattern !== 'string' || typeof e.reason !== 'string' || !e.reason.trim()) fail(`exclude[${i}] needs "pattern" and "reason"`);
    return { ...e, re: new RegExp(e.pattern), hits: [] };
  });
}

/** Whether a ZIP entry can matter to the recipe (only those entries are decompressed). */
export function wantedEntry(sets, zipKey, name) {
  return name.toLowerCase().endsWith('.svg') && !name.startsWith('__MACOSX/')
    && sets.some((s) => s.zip === zipKey && s.re.test(name));
}

/**
 * The pack's icons, aliases and name list, from the ZIP entries.
 * @param {object} mapping the recipe
 * @param {Record<string, Record<string, string>>} files zip key → path → SVG text
 */
export function selectIcons(mapping, files) {
  const { prefix } = mapping;
  const sets = compileSets(mapping);
  const excludes = compileExcludes(mapping);
  const groups = mapping.groups || {};
  const groupOrder = Object.keys(groups);
  const overrides = new Map(Object.entries(mapping.overrides || {}));
  const usedOverrides = new Set();

  const candidates = [];
  sets.forEach((set, setIndex) => {
    for (const filePath of Object.keys(files[set.zip] || {}).sort()) {
      const m = set.re.exec(filePath);
      if (!m) continue;
      const excluded = excludes.find((e) => e.re.test(filePath));
      if (excluded) { excluded.hits.push(filePath); continue; }
      const raw = m.groups?.name;
      if (!raw) fail(`sets[${setIndex}]: the pattern has no "name" group (${filePath})`);
      let group = set.group;
      if (m.groups.group !== undefined) {
        group = groups[m.groups.group];
        if (group === undefined) fail(`${filePath}: the vendor's category "${m.groups.group}" is not in "groups"; add it with its display name`);
      }
      const override = overrides.get(filePath);
      if (override) usedOverrides.add(filePath);
      // A category icon is named like the category (`nameFromGroups`).
      const name = set.nameFromGroups && groups[raw] !== undefined ? groups[raw] : displayName(raw);
      candidates.push({
        path: filePath, set, setIndex, kind: set.kind, group,
        name: override?.name ?? name,
        key: override?.key ?? iconKey(displayName(raw)),
        vendorId: m.groups.id,
        rank: m.groups.group === undefined ? -1 : groupOrder.indexOf(m.groups.group),
      });
    }
  });
  for (const filePath of overrides.keys()) if (!usedOverrides.has(filePath)) fail(`overrides: "${filePath}" matches no icon file; remove or update it`);

  // Order: set order, then the recipe's category order (an icon filed in several categories takes the
  // first), then the key, shorter first (of two names with one drawing, the shorter is the icon and
  // the other its alias), then the path (of two different icons with one name, the first keeps the
  // plain key).
  candidates.sort((a, b) => a.setIndex - b.setIndex || a.rank - b.rank || a.key.length - b.key.length
    || byText(a.key, b.key) || byText(a.path, b.path));

  const icons = {};
  const aliases = {};
  const entries = [];
  const owner = new Map(); // key → { path, print }
  const byArtwork = new Map(); // artwork fingerprint → key of the first icon drawn that way
  const merged = [];
  const renamedForConflict = [];

  const normalized = (c, key) => {
    const svg = files[c.set.zip][c.path];
    if (Buffer.byteLength(svg) > MAX_SVG_BYTES) fail(`${c.path}: larger than ${MAX_SVG_BYTES} bytes`);
    return normalizeSvg(svg, `${prefix}-${key}`, c.path);
  };
  // Artwork identity, independent of the id names the key puts in.
  const fingerprint = (c) => {
    const n = normalized(c, 'x');
    return sha256(JSON.stringify([n.body, n.left, n.top, n.width, n.height]));
  };

  for (const c of candidates) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.key)) fail(`${c.path}: no usable icon name ("${c.key}")`);
    if (!c.name || c.name.length > NAME_MAX) fail(`${c.path}: display name "${c.name}" is empty or longer than ${NAME_MAX} characters`);
    const print = fingerprint(c);
    let key = c.key;
    const previous = owner.get(key);
    if (previous) {
      if (previous.print === print) { merged.push(`${c.path} = ${previous.path}`); continue; }
      // Two different icons the vendor gave the same name: the later one is told apart by the
      // vendor's own file number when the pattern captures one; otherwise the recipe must decide.
      if (!c.vendorId) fail(`"${prefix}:${key}" is the name of two different icons: ${previous.path} and ${c.path}. Add an override for one of them.`);
      key = `${key}-${c.vendorId}`;
      if (owner.has(key)) fail(`"${prefix}:${key}" is used twice (${owner.get(key).path}, ${c.path})`);
      renamedForConflict.push({ key, path: c.path, plain: c.key, plainPath: previous.path });
    }
    owner.set(key, { path: c.path, print });
    const same = byArtwork.get(print);
    if (same) {
      aliases[key] = { parent: same };
    } else {
      const n = normalized(c, key);
      const icon = { body: n.body };
      if (n.left) icon.left = n.left;
      if (n.top) icon.top = n.top;
      icon.width = n.width;
      icon.height = n.height;
      icons[key] = icon;
      byArtwork.set(print, key);
    }
    entries.push({ icon: key, name: c.name, group: c.group, kind: c.kind });
  }
  if (!entries.length) fail('no icon matched the recipe\'s "sets"');

  return {
    icons, aliases, entries, merged, renamedForConflict,
    excluded: excludes.map((e) => ({ pattern: e.pattern, reason: e.reason, count: e.hits.length })),
  };
}

// ---- pack ------------------------------------------------------------------------------------

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/** Pack metadata for the application, from the recipe's `pack` (only the keys a pack may carry). */
export function sireniaMeta(meta) {
  if (!meta) return undefined;
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
  const out = { format: 1, ...pick(meta, ['label', 'owner', 'termsUrl']) };
  if (meta.notice) out.notice = pick(meta.notice, ['editor', 'editorAfter', 'export']);
  return out;
}

/** The pack (Iconify JSON plus `sirenia`), its catalog sorted by name. */
export function buildPack(mapping, selection) {
  const { icons, aliases, entries } = selection;
  // The most common size is the pack's default; icons of another size keep their own.
  const sizes = new Map();
  for (const i of Object.values(icons)) sizes.set(`${i.width}x${i.height}`, (sizes.get(`${i.width}x${i.height}`) || 0) + 1);
  const common = [...sizes].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))[0][0];
  const [width, height] = common.split('x').map(Number);
  const compact = {};
  for (const [key, icon] of Object.entries(icons)) {
    const c = { ...icon };
    if (c.width === width && c.height === height) { delete c.width; delete c.height; }
    compact[key] = c;
  }
  const catalog = entries.map(({ icon, name, group }) => (group ? { icon, name, group } : { icon, name }))
    .sort((a, b) => byText(a.name.toLowerCase(), b.name.toLowerCase()) || byText(a.icon, b.icon));
  const meta = sireniaMeta(mapping.pack);
  const info = mapping.info || {};
  return {
    prefix: mapping.prefix,
    ...(meta ? { sirenia: { ...meta, catalog } } : {}),
    info: {
      name: info.name || mapping.pack?.label || mapping.prefix,
      total: Object.keys(icons).length,
      version: mapping.version,
      author: { name: info.author || mapping.pack?.owner || '', url: mapping.upstream?.page },
      license: { title: info.license || 'Vendor icons, used under the vendor\'s terms (see the recipe)', url: mapping.pack?.terms?.url || mapping.upstream?.page },
      ...(Array.isArray(info.samples) ? { samples: info.samples } : {}),
      height,
      palette: true,
    },
    width,
    height,
    icons: sortKeys(compact),
    aliases: sortKeys(aliases),
  };
}

/** The generated name list (no artwork): every name by category, and what the pack leaves out. */
export function renderCatalog(mapping, selection, mappingPath = `icons/${mapping.prefix}/mapping.json`) {
  const { prefix } = mapping;
  const label = mapping.pack?.label || prefix;
  const code = (s) => `\`${s}\``;
  const kinds = mapping.kinds || {};
  const kindName = (k) => kinds[k] || k;
  const { entries } = selection;
  const groups = [...new Set(entries.map((e) => e.group || 'Other'))].sort((a, b) => byText(a.toLowerCase(), b.toLowerCase()));
  const kindCounts = [...new Set(entries.map((e) => e.kind))].map((k) => `${entries.filter((e) => e.kind === k).length} ${kindName(k)}`);
  const lines = [
    `# ${label} icon catalog (\`${prefix}:\` pack)`,
    '',
    `> **Generated** by \`scripts/build-icon-pack.mjs\` from \`${mappingPath}\` (version ${mapping.version}). Do not edit by hand.`,
    `> The icons come from the vendor's official set at <${mapping.upstream.page}>. This file lists names only: the artwork is downloaded when you install the pack.`,
    '',
    `**${entries.length} names**, ${kindCounts.join(', ')}. ${Object.keys(selection.icons).length} distinct drawings; a name whose drawing is the same as another's is an alias of it.`,
    '',
    `Usage: \`service x(${prefix}:<icon>)[Name]\` in \`architecture-beta\`, or \`n@{ icon: "${prefix}:<icon>", label: "Name" }\` in a flowchart. Label each icon with its name.`,
  ];
  for (const group of groups) {
    lines.push('', `## ${group}`, '', '| Name | Icon | Kind |', '|---|---|---|');
    const inGroup = entries.filter((x) => (x.group || 'Other') === group)
      .sort((a, b) => byText(a.name.toLowerCase(), b.name.toLowerCase()) || byText(a.icon, b.icon));
    for (const e of inGroup) lines.push(`| ${e.name.replace(/\|/g, '\\|')} | ${code(`${prefix}:${e.icon}`)} | ${kindName(e.kind)} |`);
  }
  lines.push('', '## Not included', '');
  const excluded = selection.excluded.filter((e) => e.count > 0);
  if (excluded.length) for (const e of excluded) lines.push(`- ${e.reason} (${e.count} file${e.count === 1 ? '' : 's'})`);
  else lines.push('- Nothing beyond the files the recipe does not select.');
  if (selection.renamedForConflict.length) {
    lines.push('', '## Same name, different icons', '', 'The vendor gives these icons the name of another icon. Their key ends in the vendor\'s file number:', '');
    for (const r of selection.renamedForConflict) lines.push(`- ${code(`${prefix}:${r.key}`)} (${code(`${prefix}:${r.plain}`)} is the other one)`);
  }
  return `${lines.join('\n')}\n`;
}

// ---- download --------------------------------------------------------------------------------

async function download(url) {
  const chunks = [];
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) fail(`could not download ${url}: HTTP ${res.status}`);
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_ZIP_BYTES) fail(`${url} is larger than ${MAX_ZIP_BYTES} bytes; refusing it`);
      chunks.push(chunk);
    }
  } catch (e) {
    if (e instanceof BuildError) throw e;
    fail(`could not download ${url}: ${e.cause?.code || e.cause?.message || e.message} (check the network connection and try again)`);
  }
  return Buffer.concat(chunks);
}

/** The ZIP's bytes, from the cache or the network, checked against the pinned SHA-256. */
export async function fetchZip({ key, spec, cacheDir, offline, mappingPath }) {
  if (!/^[0-9a-f]{64}$/.test(spec?.sha256 || '')) fail(`upstream.zips.${key}.sha256 must be a SHA-256 hex digest`);
  if (typeof spec.url !== 'string' || !spec.url.startsWith('https://')) fail(`upstream.zips.${key}.url must be an https:// URL`);
  const cached = path.join(cacheDir, `${key}-${spec.sha256.slice(0, 12)}.zip`);
  let buf = await fs.readFile(cached).catch(() => null);
  const downloaded = !buf;
  if (downloaded) {
    if (offline) fail(`--offline, but ${cached} is not in the download cache`);
    console.log(`↓ ${spec.url}`);
    buf = await download(spec.url);
  }
  const digest = sha256(buf);
  if (digest !== spec.sha256) {
    fail([
      `sha256 mismatch for ${spec.url}`,
      `  expected ${spec.sha256}`,
      `  got      ${digest}`,
      'The vendor has changed this file since the recipe was reviewed, so it is not used. Nothing was installed.',
      '  Installing: use the recipe of a newer Sirenia release, or report the mismatch to the project.',
      `  Maintaining the recipe: review the new icons, update upstream.zips.${key} (url, sha256) and "version" in ${mappingPath},`,
      `  then regenerate with: node scripts/build-icon-pack.mjs --mapping ${mappingPath} (this also rewrites CATALOG.md) and commit.`,
    ].join('\n'));
  }
  if (downloaded) {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cached, buf);
  }
  return buf;
}

/** The SVG entries of a ZIP that the recipe selects: path → text. Only those are decompressed. */
export function readZipEntries(buf, mapping, zipKey) {
  const { unzipSync, strFromU8 } = require('fflate');
  const sets = compileSets(mapping);
  const entries = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      if (!wantedEntry(sets, zipKey, f.name)) return false;
      if (f.originalSize > MAX_SVG_BYTES) fail(`${f.name}: larger than ${MAX_SVG_BYTES} bytes`);
      return true;
    },
  });
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]));
}

// ---- command line ----------------------------------------------------------------------------

/** The command line (same flags as build-gcp-icon-pack.mjs, plus a required --mapping). */
export function parseArgs(argv) {
  const opts = { mapping: null, outs: [], docs: null, noDocs: false, offline: false, cache: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v === '' || v.startsWith('--')) fail(`${a} needs a value`);
      return v;
    };
    if (a === '--mapping') opts.mapping = value();
    else if (a === '--out') opts.outs.push(value());
    else if (a === '--docs') opts.docs = value();
    else if (a === '--cache') opts.cache = value();
    else if (a === '--no-docs') opts.noDocs = true;
    else if (a === '--offline') opts.offline = true;
    else if (a === '--check') opts.check = true;
    else fail(`unknown argument ${a}`);
  }
  if (!opts.mapping) fail('--mapping <recipe mapping.json> is required');
  return opts;
}

/** The render service's own validator, run on the pack the way it will be installed. */
async function validateWithBackend(pack) {
  const { readPack } = require('../backend/utils/packFile.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'icon-pack-'));
  try {
    const file = path.join(dir, `${pack.prefix}.json`);
    await fs.writeFile(file, JSON.stringify(pack));
    readPack(file);
  } catch (e) {
    fail(`the generated pack does not pass the pack validator: ${e.message}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function main(argv) {
  const opts = parseArgs(argv);
  const mappingPath = path.resolve(repoRoot, opts.mapping);
  const mapping = JSON.parse(await fs.readFile(mappingPath, 'utf8'));
  const { prefix } = mapping;
  if (typeof prefix !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(prefix)) fail(`${mappingPath}: invalid "prefix"`);
  const relMapping = path.relative(repoRoot, mappingPath).split(path.sep).join('/');
  const cacheDir = path.resolve(repoRoot, opts.cache || `.cache/${prefix}-icons`);
  const outs = opts.outs.length
    ? opts.outs.map((o) => path.resolve(repoRoot, o))
    : [path.join(repoRoot, 'backend', 'packs', `${prefix}.json`), path.join(repoRoot, 'frontend', 'public', 'packs', `${prefix}.json`)];
  const docs = path.resolve(repoRoot, opts.docs || path.join(path.dirname(mappingPath), 'CATALOG.md'));

  const files = {};
  for (const [key, spec] of Object.entries(mapping.upstream?.zips || {})) {
    const buf = await fetchZip({ key, spec, cacheDir, offline: opts.offline, mappingPath: relMapping });
    files[key] = readZipEntries(buf, mapping, key);
  }
  const selection = selectIcons(mapping, files);
  const pack = buildPack(mapping, selection);
  await validateWithBackend(pack);

  const outputs = outs.map((p) => ({ path: p, text: `${JSON.stringify(pack)}\n` }));
  if (!opts.noDocs) outputs.push({ path: docs, text: renderCatalog(mapping, selection, relMapping) });

  let drift = false;
  const regenerate = `node scripts/build-icon-pack.mjs --mapping ${relMapping}`;
  const compare = async (file, text) => {
    const current = await fs.readFile(file, 'utf8').catch(() => null);
    if (current === text) console.log(`✓ ${file} up to date`);
    else { drift = true; console.error(`✖ ${file} is out of date; run: ${regenerate}`); }
  };
  for (const o of outputs) {
    if (opts.check) await compare(o.path, o.text);
    else {
      await fs.mkdir(path.dirname(o.path), { recursive: true });
      await fs.writeFile(o.path, o.text);
      console.log(`✓ wrote ${o.path} (${(Buffer.byteLength(o.text) / 1024).toFixed(1)} KiB)`);
    }
  }
  // index.json beside every pack written, rebuilt from all packs in that directory.
  for (const dir of new Set(outs.map((p) => path.dirname(p)))) {
    const indexPath = path.join(dir, INDEX_FILE);
    let json;
    try {
      json = await buildPackIndex(dir, { [`${prefix}.json`]: pack });
    } catch (e) {
      fail(`${indexPath}: ${e.message}`);
    }
    if (opts.check) await compare(indexPath, json);
    else {
      await fs.writeFile(indexPath, json);
      console.log(`✓ wrote ${indexPath}`);
    }
  }
  const kinds = {};
  for (const e of selection.entries) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  console.log(`${prefix}: ${pack.info.total} icons, ${Object.keys(pack.aliases).length} aliases, ${selection.entries.length} names ${JSON.stringify(kinds)}`);
  for (const r of selection.renamedForConflict) console.log(`  same name as ${prefix}:${r.plain}, different icon: ${prefix}:${r.key} (${r.path})`);
  return drift ? 1 : 0;
}

// Run only when executed, not when imported by the tests (compared as real paths).
const invoked = (() => {
  try { return realpathSync(process.argv[1] ?? ''); } catch { return null; }
})();
if (invoked === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`✖ ${e instanceof BuildError ? e.message : (e.stack || e.message)}`);
    process.exitCode = 1;
  }
}
