// Unit tests for the PNG metadata reader used by "Restore from export...". Run with: npm test
// The module is TypeScript; Node 22 runs it directly (type stripping), so no build step is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPng, readPngText, MAX_SOURCE_LENGTH, SOURCE_KEYS } from './src/utils/pngMetadata.ts';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const utf8 = (s) => new TextEncoder().encode(s);
const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// length | type | data | CRC. The reader does not check CRCs, so they are left as zeros.
function chunk(type, data = new Uint8Array(0)) {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(latin1(type), 4);
  out.set(data, 8);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const png = (...chunks) => concat(Uint8Array.from(SIGNATURE), chunk('IHDR', new Uint8Array(13)), ...chunks);

function iTXt(keyword, text, { compressed = false, textBytes = utf8(text) } = {}) {
  return chunk('iTXt', concat(latin1(keyword), Uint8Array.of(0, compressed ? 1 : 0, 0, 0, 0), textBytes));
}

function tEXt(keyword, text) {
  return chunk('tEXt', concat(latin1(keyword), Uint8Array.of(0), latin1(text)));
}

const IEND = chunk('IEND');
const SOURCE = 'graph TD; A["日本語 → ✓ 🚀"] --> B["Größe ™"]';

test('reads UTF-8 text from an iTXt chunk', () => {
  assert.equal(readPngText(png(iTXt('ClonixSource', SOURCE), IEND), 'ClonixSource'), SOURCE);
});

test('accepts an ArrayBuffer as well as a Uint8Array', () => {
  const bytes = png(iTXt('ClonixSource', SOURCE), IEND);
  assert.equal(readPngText(bytes.buffer, 'ClonixSource'), SOURCE);
});

test('reads legacy tEXt chunks as ISO-8859-1 (exports made before iTXt)', () => {
  // \u0080 checks for real ISO-8859-1: windows-1252 would turn byte 0x80 into "€".
  const legacy = 'graph TD; A[Größe] --> B[Café \u0080]';
  assert.equal(readPngText(png(tEXt('ClonixSource', legacy), IEND), 'ClonixSource'), legacy);
});

test('prefers iTXt over tEXt whichever comes first', () => {
  const both = png(tEXt('ClonixSource', 'old'), iTXt('ClonixSource', SOURCE), IEND);
  assert.equal(readPngText(both, 'ClonixSource'), SOURCE);
  const reversed = png(iTXt('ClonixSource', SOURCE), tEXt('ClonixSource', 'old'), IEND);
  assert.equal(readPngText(reversed, 'ClonixSource'), SOURCE);
});

test('picks the chunk with the requested keyword', () => {
  const file = png(iTXt('Disclaimer', 'notice'), iTXt('ClonixSource', SOURCE), IEND);
  assert.equal(readPngText(file, 'ClonixSource'), SOURCE);
  assert.equal(readPngText(file, 'Disclaimer'), 'notice');
});

test('SOURCE_KEYS lists the new key first and the legacy key second; each is readable', () => {
  assert.deepEqual([...SOURCE_KEYS], ['SireniaSource', 'ClonixSource']);
  const file = png(iTXt('SireniaSource', SOURCE), IEND);
  assert.equal(readPngText(file, SOURCE_KEYS[0]), SOURCE);
  assert.equal(readPngText(file, SOURCE_KEYS[1]), null);
});

test('skips a compressed iTXt chunk', () => {
  assert.equal(readPngText(png(iTXt('ClonixSource', SOURCE, { compressed: true }), IEND), 'ClonixSource'), null);
  const withLegacy = png(iTXt('ClonixSource', SOURCE, { compressed: true }), tEXt('ClonixSource', 'legacy'), IEND);
  assert.equal(readPngText(withLegacy, 'ClonixSource'), 'legacy');
});

test('returns null for invalid UTF-8 instead of replacement characters', () => {
  const bad = iTXt('ClonixSource', '', { textBytes: Uint8Array.of(0x41, 0xc3, 0x28) });
  assert.equal(readPngText(png(bad, IEND), 'ClonixSource'), null);
});

test('returns null for an iTXt chunk whose header fields are not terminated', () => {
  // Keyword, flag and method, then no NUL after the language tag.
  const cut = chunk('iTXt', concat(latin1('ClonixSource'), Uint8Array.of(0, 0, 0), latin1('en')));
  assert.equal(readPngText(png(cut, IEND), 'ClonixSource'), null);
  const keywordOnly = chunk('iTXt', latin1('ClonixSource'));
  assert.equal(readPngText(png(keywordOnly, IEND), 'ClonixSource'), null);
});

test('returns null when the keyword is missing', () => {
  assert.equal(readPngText(png(iTXt('Other', SOURCE), tEXt('Another', 'x'), IEND), 'ClonixSource'), null);
  assert.equal(readPngText(png(IEND), 'ClonixSource'), null);
});

test('returns null for a bad signature or a non-PNG file', () => {
  const file = png(iTXt('ClonixSource', SOURCE), IEND);
  file[1] = 0x51;
  assert.equal(readPngText(file, 'ClonixSource'), null);
  assert.equal(readPngText(utf8('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'ClonixSource'), null);
  assert.equal(readPngText(new Uint8Array(0), 'ClonixSource'), null);
  assert.equal(readPngText(Uint8Array.from(SIGNATURE), 'ClonixSource'), null);
});

test('stops at a truncated chunk without reading past the end', () => {
  const file = png(iTXt('ClonixSource', SOURCE), IEND);
  const textEnd = file.length - IEND.length;
  for (const cut of [textEnd - 1, textEnd - 4, textEnd - 10, 20, 9]) {
    assert.equal(readPngText(file.subarray(0, cut), 'ClonixSource'), null, `cut at ${cut}`);
  }
  // Text chunk complete, only IEND missing: the text is intact, so it is returned.
  assert.equal(readPngText(file.subarray(0, textEnd), 'ClonixSource'), SOURCE);
});

test('a chunk length pointing past the end stops the walk', () => {
  for (const length of [1000, 0x7fffffff, 0xffffffff]) {
    const lying = chunk('iTXt', concat(latin1('ClonixSource'), Uint8Array.of(0, 0, 0, 0, 0), utf8('x')));
    new DataView(lying.buffer).setUint32(0, length);
    assert.equal(readPngText(png(lying, IEND), 'ClonixSource'), null, `length ${length}`);
  }
});

test('ignores chunks after IEND', () => {
  assert.equal(readPngText(png(IEND, iTXt('ClonixSource', SOURCE)), 'ClonixSource'), null);
});

test('accepts text at the length limit and rejects longer text without truncating', () => {
  const atLimit = 'x'.repeat(MAX_SOURCE_LENGTH);
  assert.equal(MAX_SOURCE_LENGTH, 10000);
  assert.equal(readPngText(png(iTXt('ClonixSource', atLimit), IEND), 'ClonixSource'), atLimit);
  assert.equal(readPngText(png(tEXt('ClonixSource', atLimit), IEND), 'ClonixSource'), atLimit);
  assert.equal(readPngText(png(iTXt('ClonixSource', atLimit + 'x'), IEND), 'ClonixSource'), null);
  assert.equal(readPngText(png(tEXt('ClonixSource', atLimit + 'x'), IEND), 'ClonixSource'), null);
  // Length is counted like the backend counts it (String length), not in bytes.
  const cjk = '語'.repeat(MAX_SOURCE_LENGTH);
  assert.equal(readPngText(png(iTXt('ClonixSource', cjk), IEND), 'ClonixSource'), cjk);
  assert.equal(readPngText(png(iTXt('ClonixSource', cjk + '語'), IEND), 'ClonixSource'), null);
});

test('isPng checks the full 8-byte signature', () => {
  assert.equal(isPng(Uint8Array.from(SIGNATURE)), true);
  assert.equal(isPng(Uint8Array.from(SIGNATURE.slice(0, 7))), false);
  assert.equal(isPng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x0a, 0x0a])), false);
});
