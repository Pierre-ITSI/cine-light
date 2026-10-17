// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * Encodages sans dépendance (base64url, UTF-8, utilitaires d'octets).
 *
 * Écrits à la main car Hermes (React Native) n'expose ni Buffer, ni toujours
 * TextDecoder ; les implémentations natives sont utilisées quand elles
 * existent, avec un repli JS strict et testé.
 */
import { ProtocolError } from './errors.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ENC = new Uint8Array(64);
const DEC = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  ENC[i] = ALPHABET.charCodeAt(i);
  DEC[ALPHABET.charCodeAt(i)] = i;
}

const FROM_CHAR_CODE_SLICE = 8192;

/**
 * @param {ArrayLike<number> & { subarray?: Function, length: number }} codes
 * @returns {string}
 */
function stringFromCodes(codes) {
  let s = '';
  for (let i = 0; i < codes.length; i += FROM_CHAR_CODE_SLICE) {
    const part = /** @type {any} */ (codes).subarray(i, i + FROM_CHAR_CODE_SLICE);
    s += String.fromCharCode.apply(null, /** @type {any} */ (part));
  }
  return s;
}

/**
 * Encode en base64url sans remplissage (RFC 4648 §5).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToB64u(bytes) {
  const n = bytes.length;
  const rem = n % 3;
  const out = new Uint8Array(Math.floor(n / 3) * 4 + (rem === 0 ? 0 : rem + 1));
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out[o++] = ENC[(v >> 18) & 63];
    out[o++] = ENC[(v >> 12) & 63];
    out[o++] = ENC[(v >> 6) & 63];
    out[o++] = ENC[v & 63];
  }
  if (rem === 1) {
    const v = bytes[i] << 16;
    out[o++] = ENC[(v >> 18) & 63];
    out[o++] = ENC[(v >> 12) & 63];
  } else if (rem === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out[o++] = ENC[(v >> 18) & 63];
    out[o++] = ENC[(v >> 12) & 63];
    out[o++] = ENC[(v >> 6) & 63];
  }
  return stringFromCodes(out);
}

/**
 * Décode du base64url STRICT : alphabet url-safe uniquement, sans
 * remplissage, et forme canonique (bits de bourrage nuls). Deux chaînes
 * différentes ne peuvent donc jamais donner les mêmes octets.
 *
 * @param {string} str
 * @returns {Uint8Array}
 */
export function b64uToBytes(str) {
  if (typeof str !== 'string') throw new ProtocolError('malformed', 'base64url attendu');
  const n = str.length;
  const rem = n % 4;
  if (rem === 1) throw new ProtocolError('malformed', 'longueur base64url invalide');
  const out = new Uint8Array(Math.floor(n / 4) * 3 + (rem === 0 ? 0 : rem - 1));
  const at = (/** @type {number} */ k) => {
    const c = str.charCodeAt(k);
    const v = c < 128 ? DEC[c] : -1;
    if (v < 0) throw new ProtocolError('malformed', 'caractère base64url invalide');
    return v;
  };
  let o = 0;
  let i = 0;
  for (; i + 3 < n; i += 4) {
    const v = (at(i) << 18) | (at(i + 1) << 12) | (at(i + 2) << 6) | at(i + 3);
    out[o++] = (v >> 16) & 255;
    out[o++] = (v >> 8) & 255;
    out[o++] = v & 255;
  }
  if (rem === 2) {
    const c1 = at(i + 1);
    if (c1 & 15) throw new ProtocolError('malformed', 'base64url non canonique');
    out[o++] = ((at(i) << 18) | (c1 << 12)) >> 16;
  } else if (rem === 3) {
    const c2 = at(i + 2);
    if (c2 & 3) throw new ProtocolError('malformed', 'base64url non canonique');
    const v = (at(i) << 18) | (at(i + 1) << 12) | (c2 << 6);
    out[o++] = (v >> 16) & 255;
    out[o++] = (v >> 8) & 255;
  }
  return out;
}

/**
 * Encodeur UTF-8 en JS pur (les surrogates isolés deviennent U+FFFD, comme
 * TextEncoder). Exporté pour les tests.
 * @param {string} str
 * @returns {Uint8Array}
 */
export function utf8EncodeJs(str) {
  const out = new Uint8Array(str.length * 3);
  let o = 0;
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else {
        c = 0xfffd;
      }
    } else if (c >= 0xd800 && c <= 0xdfff) {
      c = 0xfffd;
    }
    if (c < 0x80) {
      out[o++] = c;
    } else if (c < 0x800) {
      out[o++] = 0xc0 | (c >> 6);
      out[o++] = 0x80 | (c & 63);
    } else if (c < 0x10000) {
      out[o++] = 0xe0 | (c >> 12);
      out[o++] = 0x80 | ((c >> 6) & 63);
      out[o++] = 0x80 | (c & 63);
    } else {
      out[o++] = 0xf0 | (c >> 18);
      out[o++] = 0x80 | ((c >> 12) & 63);
      out[o++] = 0x80 | ((c >> 6) & 63);
      out[o++] = 0x80 | (c & 63);
    }
  }
  return out.slice(0, o);
}

/**
 * Décodeur UTF-8 strict en JS pur : rejette séquences tronquées, formes
 * trop longues, surrogates encodés et points de code > U+10FFFF.
 * Exporté pour les tests.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function utf8DecodeJs(bytes) {
  const n = bytes.length;
  const units = new Uint16Array(n);
  let u = 0;
  for (let i = 0; i < n; ) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      units[u++] = b0;
      i++;
      continue;
    }
    let need;
    let cp;
    let min;
    if (b0 >= 0xc2 && b0 <= 0xdf) { need = 1; cp = b0 & 0x1f; min = 0x80; }
    else if (b0 >= 0xe0 && b0 <= 0xef) { need = 2; cp = b0 & 0x0f; min = 0x800; }
    else if (b0 >= 0xf0 && b0 <= 0xf4) { need = 3; cp = b0 & 0x07; min = 0x10000; }
    else throw new ProtocolError('malformed', 'UTF-8 invalide');
    if (i + need > n - 1) throw new ProtocolError('malformed', 'UTF-8 tronqué');
    for (let k = 1; k <= need; k++) {
      const b = bytes[i + k];
      if ((b & 0xc0) !== 0x80) throw new ProtocolError('malformed', 'UTF-8 invalide');
      cp = (cp << 6) | (b & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      throw new ProtocolError('malformed', 'UTF-8 invalide');
    }
    i += need + 1;
    if (cp >= 0x10000) {
      cp -= 0x10000;
      units[u++] = 0xd800 + (cp >> 10);
      units[u++] = 0xdc00 + (cp & 0x3ff);
    } else {
      units[u++] = cp;
    }
  }
  return stringFromCodes(units.subarray(0, u));
}

/** @type {TextEncoder | null} */
let nativeEncoder = null;
/** @type {TextDecoder | null} */
let nativeDecoder = null;
try {
  if (typeof TextEncoder === 'function') nativeEncoder = new TextEncoder();
} catch (_) { nativeEncoder = null; }
try {
  // ignoreBOM : on conserve un éventuel BOM, comme le repli JS (comportement identique).
  if (typeof TextDecoder === 'function') nativeDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
} catch (_) { nativeDecoder = null; }

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
export function utf8Encode(str) {
  return nativeEncoder ? nativeEncoder.encode(str) : utf8EncodeJs(str);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function utf8Decode(bytes) {
  if (nativeDecoder) {
    try {
      return nativeDecoder.decode(bytes);
    } catch (_) {
      throw new ProtocolError('malformed', 'UTF-8 invalide');
    }
  }
  return utf8DecodeJs(bytes);
}

/**
 * @param {...Uint8Array} parts
 * @returns {Uint8Array}
 */
export function concatBytes(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Comparaison à temps constant (pour des longueurs égales).
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Copie exacte si la vue ne couvre pas tout son ArrayBuffer : certaines
 * implémentations WebCrypto (polyfills) ignorent byteOffset.
 * @param {Uint8Array} u8
 * @returns {Uint8Array}
 */
export function exactBytes(u8) {
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8 : u8.slice();
}

/**
 * Encode une chaîne ASCII déjà validée.
 * @param {string} s
 * @returns {Uint8Array}
 */
export function asciiBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function asciiString(bytes) {
  return stringFromCodes(bytes);
}
