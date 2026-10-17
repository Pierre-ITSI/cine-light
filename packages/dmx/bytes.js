// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Small byte helpers shared by the protocol parsers.
// Written for every target runtime: browsers, Node 22 and React Native/Hermes.
// Hermes has no TextDecoder, so UTF-8 decoding is done by hand.

/**
 * Bytes accepted by the parsers: a Uint8Array (Node Buffer included), any
 * ArrayBuffer view, an ArrayBuffer, or a plain array of byte values (what a
 * React Native bridge sometimes hands over).
 * @typedef {Uint8Array | ArrayBuffer | ArrayBufferView | number[]} ByteInput
 */

/**
 * Normalise input to a Uint8Array view without copying when possible.
 * @param {ByteInput} input
 * @returns {Uint8Array | null} null when the input is not byte-like
 */
export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (typeof ArrayBuffer !== 'undefined') {
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
  }
  if (Array.isArray(input)) {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const v = input[i];
      if (typeof v !== 'number' || !(v >= 0 && v <= 255) || (v | 0) !== v) return null;
      out[i] = v;
    }
    return out;
  }
  return null;
}

/** Big-endian unsigned 16-bit read. */
export function u16be(b, o) { return (b[o] << 8) | b[o + 1]; }

/** Little-endian unsigned 16-bit read. */
export function u16le(b, o) { return b[o] | (b[o + 1] << 8); }

/** Big-endian unsigned 32-bit read (returns a non-negative number). */
export function u32be(b, o) { return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }

/** Write a big-endian unsigned 16-bit value. */
export function w16be(b, o, v) { b[o] = (v >> 8) & 0xff; b[o + 1] = v & 0xff; }

/** Write a little-endian unsigned 16-bit value. */
export function w16le(b, o, v) { b[o] = v & 0xff; b[o + 1] = (v >> 8) & 0xff; }

/** Write a big-endian unsigned 32-bit value. */
export function w32be(b, o, v) {
  b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff; b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff;
}

/** Interpret an 8-bit difference as signed (two's complement), e.g. for sequence numbers. */
export function int8(v) { const x = v & 0xff; return x > 127 ? x - 256 : x; }

/** True when b[o..o+ref.length) equals ref. */
export function bytesEqual(b, o, ref) {
  if (o + ref.length > b.length) return false;
  for (let i = 0; i < ref.length; i++) if (b[o + i] !== ref[i]) return false;
  return true;
}

/**
 * Decode a NUL-terminated UTF-8 field (lenient: malformed sequences become U+FFFD).
 * @param {Uint8Array} b
 * @param {number} start
 * @param {number} maxLen field size in bytes
 * @returns {string}
 */
export function decodeUtf8Field(b, start, maxLen) {
  let end = start;
  const limit = Math.min(b.length, start + maxLen);
  while (end < limit && b[end] !== 0) end++;
  let s = '';
  for (let i = start; i < end;) {
    const c = b[i];
    let cp = 0xfffd, n = 1;
    if (c < 0x80) { cp = c; }
    else if (c >= 0xc2 && c <= 0xdf && i + 1 < end && (b[i + 1] & 0xc0) === 0x80) {
      cp = ((c & 0x1f) << 6) | (b[i + 1] & 0x3f); n = 2;
    } else if (c >= 0xe0 && c <= 0xef && i + 2 < end && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80) {
      cp = ((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f); n = 3;
      if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
    } else if (c >= 0xf0 && c <= 0xf4 && i + 3 < end && (b[i + 1] & 0xc0) === 0x80
      && (b[i + 2] & 0xc0) === 0x80 && (b[i + 3] & 0xc0) === 0x80) {
      cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f); n = 4;
      if (cp < 0x10000 || cp > 0x10ffff) cp = 0xfffd;
    }
    s += String.fromCodePoint(cp);
    i += n;
  }
  return s;
}

/**
 * Encode a string as UTF-8 into a fixed NUL-padded field (truncated on a
 * character boundary so that at least one NUL byte terminates the field).
 * @param {Uint8Array} b
 * @param {number} start
 * @param {number} size field size in bytes
 * @param {string} str
 */
export function writeUtf8Field(b, start, size, str) {
  let o = start;
  const max = start + size - 1; // keep room for the terminating NUL
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (o + n > max) break;
    if (n === 1) b[o++] = cp;
    else if (n === 2) { b[o++] = 0xc0 | (cp >> 6); b[o++] = 0x80 | (cp & 0x3f); }
    else if (n === 3) { b[o++] = 0xe0 | (cp >> 12); b[o++] = 0x80 | ((cp >> 6) & 0x3f); b[o++] = 0x80 | (cp & 0x3f); }
    else {
      b[o++] = 0xf0 | (cp >> 18); b[o++] = 0x80 | ((cp >> 12) & 0x3f);
      b[o++] = 0x80 | ((cp >> 6) & 0x3f); b[o++] = 0x80 | (cp & 0x3f);
    }
  }
  for (; o < start + size; o++) b[o] = 0;
}

// Accented Latin letters folded to ASCII for fields the Art-Net spec defines
// as ASCII (ShortName, LongName, NodeReport). String.prototype.normalize is
// not guaranteed on Hermes builds without Intl, hence the small table.
const FOLD = {
  à: 'a', â: 'a', ä: 'a', á: 'a', ã: 'a', å: 'a', ç: 'c', é: 'e', è: 'e', ê: 'e', ë: 'e',
  î: 'i', ï: 'i', í: 'i', ì: 'i', ñ: 'n', ô: 'o', ö: 'o', ó: 'o', ò: 'o', õ: 'o',
  ù: 'u', û: 'u', ü: 'u', ú: 'u', ÿ: 'y', œ: 'oe', æ: 'ae',
  À: 'A', Â: 'A', Ä: 'A', Á: 'A', Ç: 'C', É: 'E', È: 'E', Ê: 'E', Ë: 'E', Î: 'I', Ï: 'I',
  Ô: 'O', Ö: 'O', Ù: 'U', Û: 'U', Ü: 'U', Œ: 'OE', Æ: 'AE',
};

/**
 * Write printable ASCII into a fixed NUL-padded field; accents are folded,
 * anything else outside 0x20–0x7E becomes '?'.
 */
export function writeAsciiField(b, start, size, str) {
  let ascii = '';
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    if (code >= 0x20 && code <= 0x7e) ascii += ch;
    else ascii += FOLD[ch] || '?';
  }
  let o = start;
  for (let i = 0; i < ascii.length && o < start + size - 1; i++) b[o++] = ascii.charCodeAt(i);
  for (; o < start + size; o++) b[o] = 0;
}

/** Decode a NUL-terminated ASCII field. */
export function decodeAsciiField(b, start, size) {
  let s = '';
  for (let i = start; i < Math.min(b.length, start + size) && b[i] !== 0; i++) {
    s += b[i] >= 0x20 && b[i] <= 0x7e ? String.fromCharCode(b[i]) : '?';
  }
  return s;
}

/** Format 16 bytes as a lowercase UUID string (8-4-4-4-12). */
export function uuidString(b, o) {
  let h = '';
  for (let i = 0; i < 16; i++) {
    h += (b[o + i] < 16 ? '0' : '') + b[o + i].toString(16);
    if (i === 3 || i === 5 || i === 7 || i === 9) h += '-';
  }
  return h;
}

/** Parse a UUID string (with or without dashes) to 16 bytes, or null. */
export function uuidBytes(str) {
  const hex = String(str).replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Parse dotted IPv4 (or a 4-number array) to 4 bytes, or null. */
export function ipv4Bytes(ip) {
  const parts = Array.isArray(ip) ? ip : String(ip).split('.').map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return Uint8Array.from(parts);
}

/** Parse a MAC address ("aa:bb:cc:dd:ee:ff", "-" separators, or 6-number array) to 6 bytes, or null. */
export function macBytes(mac) {
  if (mac == null) return new Uint8Array(6);
  const parts = Array.isArray(mac) ? mac : String(mac).split(/[:-]/).map((p) => (/^[0-9a-fA-F]{1,2}$/.test(p) ? parseInt(p, 16) : NaN));
  if (parts.length !== 6 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return Uint8Array.from(parts);
}
