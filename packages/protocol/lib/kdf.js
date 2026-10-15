import { subtle } from './env.js';
import { exactBytes, utf8Encode } from './encoding.js';

/**
 * HKDF-SHA256 (RFC 5869) via WebCrypto.
 *
 * @param {Uint8Array} ikm   matériau secret d'entrée
 * @param {Uint8Array} salt  sel (peut être public)
 * @param {string} info      étiquette de séparation de domaine
 * @param {number} bits      longueur de sortie (multiple de 8)
 * @returns {Promise<Uint8Array>}
 */
export async function hkdfBits(ikm, salt, info, bits) {
  const s = subtle();
  const base = await s.importKey('raw', exactBytes(ikm), 'HKDF', false, ['deriveBits']);
  const out = await s.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: exactBytes(salt), info: utf8Encode(info) },
    base,
    bits,
  );
  return new Uint8Array(out);
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function sha256(bytes) {
  return new Uint8Array(await subtle().digest('SHA-256', exactBytes(bytes)));
}

/**
 * Préfixe de longueur 32 bits big-endian, pour des transcriptions non ambiguës.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function lengthPrefixed(bytes) {
  const out = new Uint8Array(4 + bytes.length);
  const n = bytes.length;
  out[0] = (n >>> 24) & 255;
  out[1] = (n >>> 16) & 255;
  out[2] = (n >>> 8) & 255;
  out[3] = n & 255;
  out.set(bytes, 4);
  return out;
}
