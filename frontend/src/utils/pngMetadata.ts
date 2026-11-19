/**
 * Read the text metadata (iTXt or tEXt chunk) that the render backend embeds in exported PNGs.
 * Pure: no DOM APIs, no dependencies, so it also runs under `node --test`.
 *
 * The file is untrusted. Every read is bounds-checked and the chunk walk always moves forward, so a
 * truncated or crafted file ends the walk instead of reading out of range or looping. CRCs are not
 * validated: a damaged CRC does not make the text less readable, and the text is only ever placed in
 * the editor as plain text.
 */

/** Metadata keys that carry the diagram source: new key first, legacy key second. */
export const SOURCE_KEYS = ['SireniaSource', 'ClonixSource'] as const;

/** Same ceiling as the backend's diagram source limit, in UTF-16 code units (String length). */
export const MAX_SOURCE_LENGTH = 10_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True when the bytes start with the 8-byte PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
    return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

// ISO-8859-1 decoding done by hand: TextDecoder's 'latin1' label is really windows-1252, which
// changes bytes 0x80-0x9F.
function decodeLatin1(bytes: Uint8Array): string {
    let out = '';
    for (const byte of bytes) out += String.fromCharCode(byte);
    return out;
}

/** Text of an iTXt chunk with this keyword, or null if it is another keyword or unusable. */
function readITXt(data: Uint8Array, keyword: string): string | null {
    // keyword 0 | compression flag | compression method | language tag 0 | translated keyword 0 | text
    const keywordEnd = data.indexOf(0);
    if (keywordEnd < 1 || decodeLatin1(data.subarray(0, keywordEnd)) !== keyword) return null;
    if (keywordEnd + 2 >= data.length || data[keywordEnd + 1] !== 0) return null; // compressed or cut short
    const languageEnd = data.indexOf(0, keywordEnd + 3);
    if (languageEnd === -1) return null;
    const translatedEnd = data.indexOf(0, languageEnd + 1);
    if (translatedEnd === -1) return null;
    const text = data.subarray(translatedEnd + 1);
    // A UTF-16 code unit takes at most 3 UTF-8 bytes, so anything longer is over the limit.
    if (text.length > MAX_SOURCE_LENGTH * 3) return null;
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(text);
    } catch {
        return null; // invalid UTF-8
    }
}

/** Text of a tEXt chunk with this keyword, or null if it is another keyword or unusable. */
function readTEXt(data: Uint8Array, keyword: string): string | null {
    // keyword 0 | text (ISO-8859-1)
    const keywordEnd = data.indexOf(0);
    if (keywordEnd < 1 || decodeLatin1(data.subarray(0, keywordEnd)) !== keyword) return null;
    const text = data.subarray(keywordEnd + 1);
    if (text.length > MAX_SOURCE_LENGTH) return null;
    return decodeLatin1(text);
}

/**
 * Return the text stored under `keyword` in a PNG, or null when there is none that can be used.
 * A chunk is skipped when it is compressed, malformed, not valid UTF-8 (iTXt) or longer than
 * MAX_SOURCE_LENGTH; over-long text is rejected, never truncated. An iTXt chunk wins over a tEXt
 * chunk (exports made before iTXt was introduced only have tEXt); among chunks of the same kind
 * the first usable one wins.
 */
export function readPngText(input: ArrayBuffer | Uint8Array, keyword: string): string | null {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!isPng(bytes)) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let fromTEXt: string | null = null;
    let offset = PNG_SIGNATURE.length;
    // Each chunk: length (4) | type (4) | data (length) | CRC (4).
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > bytes.length) break; // length points past the end of the file
        const type = decodeLatin1(bytes.subarray(offset + 4, dataStart));
        if (type === 'IEND') break;

        const data = bytes.subarray(dataStart, dataEnd);
        if (type === 'iTXt') {
            const text = readITXt(data, keyword);
            if (text !== null && text.length <= MAX_SOURCE_LENGTH) return text;
        } else if (type === 'tEXt' && fromTEXt === null) {
            fromTEXt = readTEXt(data, keyword);
        }
        offset = dataEnd + 4;
    }
    return fromTEXt;
}
