// Offline unit tests for provenance metadata injection (no server/network required).
const assert = require('node:assert');
const { injectMetadata, escapeXml } = require('../utils/metadata');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS  ${name}`); } catch (e) { failures++; console.error(`FAIL  ${name}: ${e.message}`); }
}

check('escapeXml escapes markup metacharacters', () => {
  assert.strictEqual(escapeXml('<a> & </a>'), '&lt;a&gt; &amp; &lt;/a&gt;');
});

check('escapeXml strips illegal control characters', () => {
  assert.strictEqual(escapeXml('a\u0000b\u0007c'), 'abc');
});

check('SVG injection cannot break out of the SireniaSource element', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>');
  const evil = '</SireniaSource></metadata><script>alert(1)</script>';
  const out = injectMetadata(svg, 'SireniaSource', evil).toString();
  assert.ok(!out.includes('</SireniaSource></metadata><script>'), 'breakout string present');
  assert.ok(out.includes('&lt;script&gt;'), 'payload not escaped');
  assert.strictEqual((out.match(/<\/SireniaSource>/g) || []).length, 1, 'duplicate closing tag');
});

// Build a valid 1x1 RGB PNG so png-chunks-extract's CRC check passes.
function minimalPng() {
  const zlib = require('node:zlib');
  const encode = require('png-chunks-encode');
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]); // 1x1, 8-bit, RGB
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0])); // filter byte + one RGB pixel
  return Buffer.from(
    encode([
      { name: 'IHDR', data: ihdr },
      { name: 'IDAT', data: idat },
      { name: 'IEND', data: Buffer.alloc(0) },
    ])
  );
}

// Independent decoder for an uncompressed iTXt chunk, written here so the test does not trust the
// writer: keyword \0 flag method language \0 translated \0 text.
function decodeITXt(data) {
  const buf = Buffer.from(data);
  const keywordEnd = buf.indexOf(0);
  const keyword = buf.subarray(0, keywordEnd).toString('latin1');
  const compressionFlag = buf[keywordEnd + 1];
  const compressionMethod = buf[keywordEnd + 2];
  const languageEnd = buf.indexOf(0, keywordEnd + 3);
  const translatedEnd = buf.indexOf(0, languageEnd + 1);
  return {
    keyword,
    compressionFlag,
    compressionMethod,
    language: buf.subarray(keywordEnd + 3, languageEnd).toString('latin1'),
    translated: buf.subarray(languageEnd + 1, translatedEnd).toString('utf8'),
    textBytes: buf.subarray(translatedEnd + 1),
  };
}

function findITXt(png, keyword) {
  const extract = require('png-chunks-extract');
  const chunks = extract(png);
  const index = chunks.findIndex((c) => c.name === 'iTXt' && decodeITXt(c.data).keyword === keyword);
  return { chunks, index, chunk: chunks[index] };
}

check('PNG iTXt chunk round-trips a source with characters outside Latin-1 byte-exactly', () => {
  const code = 'graph TD; A["日本語 → ✓ 🚀"] --> B["Größe ™"]';
  const out = injectMetadata(minimalPng(), 'SireniaSource', code);
  const { chunk } = findITXt(out, 'SireniaSource');
  assert.ok(chunk, 'SireniaSource iTXt chunk missing (writer fell back to the original buffer?)');
  const decoded = decodeITXt(chunk.data);
  assert.strictEqual(decoded.compressionFlag, 0);
  assert.strictEqual(decoded.compressionMethod, 0);
  assert.strictEqual(decoded.language, '');
  assert.strictEqual(decoded.translated, '');
  assert.ok(decoded.textBytes.equals(Buffer.from(code, 'utf8')), 'text bytes differ from the UTF-8 source');
  assert.strictEqual(new TextDecoder('utf-8', { fatal: true }).decode(decoded.textBytes), code);
});

check('PNG metadata chunks are written before IEND, and IEND stays last', () => {
  let out = injectMetadata(minimalPng(), 'SireniaSource', 'graph TD; A-->B;');
  out = injectMetadata(out, 'Disclaimer', 'Notice ™');
  const { chunks, index } = findITXt(out, 'SireniaSource');
  const disclaimer = findITXt(out, 'Disclaimer').index;
  const iend = chunks.findIndex((c) => c.name === 'IEND');
  assert.ok(index !== -1 && disclaimer !== -1, 'chunk missing');
  assert.ok(index < iend && disclaimer < iend, 'metadata chunk after IEND');
  assert.strictEqual(iend, chunks.length - 1, 'IEND is not the last chunk');
  assert.strictEqual(chunks.filter((c) => c.name === 'tEXt').length, 0, 'unexpected tEXt chunk');
});

check('PNG metadata strips NUL characters from the value', () => {
  const out = injectMetadata(minimalPng(), 'SireniaSource', 'A\u0000B\u0000\u0000C');
  const { chunk } = findITXt(out, 'SireniaSource');
  assert.strictEqual(decodeITXt(chunk.data).textBytes.toString('utf8'), 'ABC');
});

check('PNG metadata respects the length cap without splitting a surrogate pair', () => {
  // 9,999 ASCII characters followed by emoji: the cap falls between the two halves of the first one.
  const value = 'x'.repeat(9999) + '🚀'.repeat(10);
  const out = injectMetadata(minimalPng(), 'SireniaSource', value);
  const { chunk } = findITXt(out, 'SireniaSource');
  assert.ok(chunk, 'SireniaSource iTXt chunk missing');
  const stored = new TextDecoder('utf-8', { fatal: true }).decode(decodeITXt(chunk.data).textBytes);
  assert.strictEqual(stored, 'x'.repeat(9999), 'expected the half emoji to be dropped');
  assert.ok(stored.isWellFormed(), 'stored text has a lone surrogate');
});

check('PNG metadata replaces a lone surrogate from the input instead of writing invalid UTF-8', () => {
  const out = injectMetadata(minimalPng(), 'SireniaSource', 'A\uD800B');
  const { chunk } = findITXt(out, 'SireniaSource');
  assert.strictEqual(new TextDecoder('utf-8', { fatal: true }).decode(decodeITXt(chunk.data).textBytes), 'A\uFFFDB');
});

check('PNG metadata with an invalid keyword returns the original buffer', () => {
  const png = minimalPng();
  assert.strictEqual(injectMetadata(png, 'k'.repeat(80), 'v'), png);
  assert.strictEqual(injectMetadata(png, 'Schlüssel→', 'v'), png);
});

check('SVG metadata output is unchanged for a source outside Latin-1', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>');
  const code = 'graph TD; A["日本語 → ✓ 🚀"] --> B["Größe ™ <x> & y"]';
  const out = injectMetadata(svg, 'SireniaSource', code).toString('utf8');
  assert.strictEqual(
    out,
    '<svg xmlns="http://www.w3.org/2000/svg"><g/>\n<metadata><SireniaSource>' +
      'graph TD; A["日本語 → ✓ 🚀"] --&gt; B["Größe ™ &lt;x&gt; &amp; y"]' +
      '</SireniaSource></metadata></svg>'
  );
});

check('non-buffer input is rejected', () => {
  assert.throws(() => injectMetadata('not-a-buffer', 'k', 'v'));
});

check('oversized value is bounded', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const out = injectMetadata(svg, 'SireniaSource', 'x'.repeat(20000)).toString();
  const inner = out.slice(out.indexOf('<SireniaSource>') + '<SireniaSource>'.length, out.indexOf('</SireniaSource>'));
  assert.ok(inner.length <= 10000, `stored length ${inner.length} exceeds cap`);
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('\nAll metadata tests passed');
