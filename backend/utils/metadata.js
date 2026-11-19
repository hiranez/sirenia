const extract = require('png-chunks-extract');
const encode = require('png-chunks-encode');

// Cap stored provenance to the same ceiling as accepted diagram code (defense in depth).
const MAX_METADATA_LENGTH = 10000;
// PNG keywords are 1-79 printable Latin-1 characters.
const PNG_KEYWORD = /^[\x20-\x7E\xA1-\xFF]{1,79}$/;

/**
 * Cut a string to at most `max` UTF-16 code units without leaving half of a surrogate pair at the
 * end, and replace any lone surrogate already in the (untrusted) input with U+FFFD.
 */
function truncateWellFormed(value, max) {
  let cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.toWellFormed();
}

/**
 * Build an uncompressed PNG iTXt chunk (UTF-8 text). Layout:
 * keyword | 0 | compression flag 0 | compression method 0 | language tag "" | 0 | translated keyword "" | 0 | text
 * Length and CRC are added by png-chunks-encode.
 */
function encodeITXt(keyword, value) {
  if (!PNG_KEYWORD.test(keyword)) {
    throw new Error('Invalid PNG keyword');
  }
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(value, 'utf8'),
  ]);
  return { name: 'iTXt', data: new Uint8Array(data) };
}

/**
 * Escape a string for safe inclusion as XML element text content.
 * Prevents the raw user-supplied diagram source from breaking out of the
 * <SireniaSource> element (SVG corruption / markup injection into the stored file).
 */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Strip control characters that are illegal in XML 1.0 (keep tab/newline/CR).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/**
 * Injects provenance metadata into an image buffer. Supports PNG (iTXt chunk, UTF-8)
 * and SVG (<metadata> element). The value is treated as untrusted input.
 *
 * @param {Buffer} buffer - The image buffer.
 * @param {string} key - The metadata key (e.g., 'SireniaSource').
 * @param {string} value - The metadata value (untrusted diagram source).
 * @returns {Buffer} - The new buffer with metadata, or the original on failure.
 */
function injectMetadata(buffer, key, value) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Input must be a buffer');
  }

  // Normalize + bound the stored value regardless of output type.
  const safeValue = truncateWellFormed(String(value == null ? '' : value), MAX_METADATA_LENGTH);

  // Detect PNG by magic bytes.
  const isPng =
    buffer.length >= 4 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;

  if (isPng) {
    try {
      const chunks = extract(buffer);
      const iend = chunks.findIndex((chunk) => chunk.name === 'IEND');
      if (iend === -1) throw new Error('IEND chunk missing');
      // NUL separates the fields of a PNG text chunk, so it never belongs in the value.
      chunks.splice(iend, 0, encodeITXt(key, safeValue.replaceAll('\u0000', '')));
      return Buffer.from(encode(chunks));
    } catch (e) {
      console.error('Error injecting PNG metadata:', e.message);
      return buffer; // Return original on failure.
    }
  }

  // Otherwise treat as SVG text.
  const str = buffer.toString('utf8');
  if (str.includes('<svg')) {
    const metadataStr = `\n<metadata><${key}>${escapeXml(safeValue)}</${key}></metadata>`;
    const closingIndex = str.lastIndexOf('</svg>');
    if (closingIndex !== -1) {
      return Buffer.from(str.slice(0, closingIndex) + metadataStr + str.slice(closingIndex));
    }
    return Buffer.from(str + metadataStr);
  }

  // Unknown type, return original.
  return buffer;
}

module.exports = { injectMetadata, escapeXml };
