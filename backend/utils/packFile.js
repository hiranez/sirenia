// Validation of one icon pack file (`<prefix>.json`: Iconify JSON plus an optional `sirenia`
// object). Side-effect free: requiring this module reads nothing, so tools (scripts/packs.mjs) can
// validate a pack without loading the packs directory the render service reads at start-up.
const fs = require('node:fs');
const path = require('node:path');

const { cssExternalRefs } = require('./externalRefs');

const PREFIX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const NAME_MAX = 80;
const NOTICE_MAX = 1000;
const URL_MAX = 500;
const SIRENIA_KEYS = new Set(['format', 'label', 'owner', 'termsUrl', 'notice']);
const NOTICE_KEYS = new Set(['editor', 'editorAfter', 'export']);
// Iconify fields that end up inside generated SVG attributes; they must be what Iconify expects.
const NUMBER_FIELDS = ['left', 'top', 'width', 'height', 'rotate'];
const BOOLEAN_FIELDS = ['hFlip', 'vFlip'];

// Active or loading content in an icon body. Security rules only: gradients, ids, `<use href="#id">`
// and `url(#id)` are legitimate in third-party packs. Each pattern is non-global (stateless).
const FORBIDDEN_BODY = [
  [/<(?:[\w.-]+:)?(?:script|foreignobject|iframe|object|embed)/i, 'active or embedding element'],
  // HTML elements that load or navigate (the HTML parser lifts them out of inline SVG).
  [/<(?:[\w.-]+:)?(?:img|meta|link|base)\b/i, 'HTML loading element'],
  [/[\s/"'](?:[\w.-]+:)?on[a-z]+\s*=/i, 'event-handler attribute'],
  [/javascript:/i, 'javascript: URL'],
  // SMIL can rewrite a link attribute after load (<set attributeName="href" to="https://…">).
  [/attributename\s*=\s*["']?\s*(?:[\w.-]+:)?(?:href|src)\b/i, 'animation of a link attribute'],
];
// href / xlink:href / src values; only same-document references (`#id`) are allowed.
// The look-behind does not consume the separator, so `href="#a"src="…"` still finds the second one.
const LINK_ATTR_SOURCE = String.raw`(?<=^|[\s/"'])((?:[\w.-]+:)?(?:href|src))\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Reason why an icon body is not inert, or null. */
function bodyProblem(body) {
  for (const [re, reason] of FORBIDDEN_BODY) if (re.test(body)) return reason;
  const css = cssExternalRefs(body);
  if (css.length) return `external reference (${css[0]})`;
  for (const m of body.matchAll(new RegExp(LINK_ATTR_SOURCE, 'gi'))) {
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (!value.trim().startsWith('#')) return `external reference (${m[1]}="${value.slice(0, 60)}")`;
  }
  return null;
}

function checkTransforms(obj, where, fail) {
  for (const k of NUMBER_FIELDS) {
    if (obj[k] !== undefined && !(typeof obj[k] === 'number' && Number.isFinite(obj[k]))) fail(`${where}: "${k}" must be a number`);
  }
  for (const k of BOOLEAN_FIELDS) {
    if (obj[k] !== undefined && typeof obj[k] !== 'boolean') fail(`${where}: "${k}" must be true or false`);
  }
}

function checkText(value, where, max, fail) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${where} must be a non-empty string`);
  if (value.length > max) fail(`${where} must be at most ${max} characters`);
  if (CONTROL_CHARS.test(value)) fail(`${where} must not contain control characters`);
}

function checkSirenia(meta, fail) {
  if (!isPlainObject(meta)) fail('"sirenia" must be an object');
  for (const k of Object.keys(meta)) if (!SIRENIA_KEYS.has(k)) fail(`"sirenia" has unknown key "${k}"`);
  if (meta.format !== 1) fail('"sirenia.format" must be 1');
  if (meta.label !== undefined) checkText(meta.label, '"sirenia.label"', NAME_MAX, fail);
  if (meta.owner !== undefined) checkText(meta.owner, '"sirenia.owner"', NAME_MAX, fail);
  if (meta.termsUrl !== undefined) {
    checkText(meta.termsUrl, '"sirenia.termsUrl"', URL_MAX, fail);
    let ok = false;
    try { ok = meta.termsUrl.startsWith('https://') && new URL(meta.termsUrl).protocol === 'https:'; } catch { ok = false; }
    if (!ok) fail('"sirenia.termsUrl" must be an https:// URL');
  }
  if (meta.notice !== undefined) {
    if (!isPlainObject(meta.notice)) fail('"sirenia.notice" must be an object');
    for (const k of Object.keys(meta.notice)) {
      if (!NOTICE_KEYS.has(k)) fail(`"sirenia.notice" has unknown key "${k}"`);
      checkText(meta.notice[k], `"sirenia.notice.${k}"`, NOTICE_MAX, fail);
    }
  }
}

/** Parse and validate one pack file. Throws an Error naming the file (and the icon) on any problem. */
function readPack(file) {
  const fail = (msg) => { throw new Error(`Invalid icon pack ${file}: ${msg}`); };
  let pack;
  try {
    pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(e.message);
  }
  if (!isPlainObject(pack)) fail('expected a JSON object');
  const expected = path.basename(file, '.json');
  if (typeof pack.prefix !== 'string' || !PREFIX.test(pack.prefix)) fail(`prefix ${JSON.stringify(pack.prefix)} is not lowercase letters, digits and single hyphens`);
  if (pack.prefix !== expected) fail(`prefix "${pack.prefix}" does not match the file name (expected "${expected}")`);
  checkTransforms(pack, 'pack', fail);
  if (!isPlainObject(pack.icons) || Object.keys(pack.icons).length === 0) fail('"icons" must be a non-empty object');
  for (const [name, icon] of Object.entries(pack.icons)) {
    if (!isPlainObject(icon) || typeof icon.body !== 'string') fail(`icon "${name}": missing string "body"`);
    const problem = bodyProblem(icon.body);
    if (problem) fail(`icon "${name}": ${problem}`);
    checkTransforms(icon, `icon "${name}"`, fail);
  }
  if (pack.aliases !== undefined) {
    if (!isPlainObject(pack.aliases)) fail('"aliases" must be an object');
    for (const [name, alias] of Object.entries(pack.aliases)) {
      if (!isPlainObject(alias) || typeof alias.parent !== 'string' || !Object.hasOwn(pack.icons, alias.parent)) {
        fail(`alias "${name}": "parent" must name an icon in "icons"`);
      }
      checkTransforms(alias, `alias "${name}"`, fail);
    }
  }
  if (pack.sirenia !== undefined) checkSirenia(pack.sirenia, fail);
  return pack;
}

module.exports = { PREFIX, readPack };
