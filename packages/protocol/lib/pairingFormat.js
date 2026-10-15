import { ProtocolError } from './errors.js';
import { b64uToBytes } from './encoding.js';

/**
 * Secret d'appairage partagé par la télécommande et ses écrans.
 * @typedef {{ channelId: string, key: string }} Pairing
 *   channelId : 128 bits aléatoires, base64url (22 caractères)
 *   key       : 256 bits aléatoires, base64url (43 caractères)
 */

export const CHANNEL_ID_BYTES = 16;
export const PAIRING_KEY_BYTES = 32;
export const CHANNEL_ID_CHARS = 22;
export const PAIRING_KEY_CHARS = 43;

/**
 * @param {unknown} p
 * @returns {p is Pairing}
 */
export function isValidPairing(p) {
  if (!p || typeof p !== 'object') return false;
  const { channelId, key } = /** @type {any} */ (p);
  if (typeof channelId !== 'string' || typeof key !== 'string') return false;
  if (channelId.length !== CHANNEL_ID_CHARS || key.length !== PAIRING_KEY_CHARS) return false;
  try {
    return b64uToBytes(channelId).length === CHANNEL_ID_BYTES && b64uToBytes(key).length === PAIRING_KEY_BYTES;
  } catch (_) {
    return false;
  }
}

/**
 * @param {unknown} p
 * @returns {asserts p is Pairing}
 */
export function assertPairing(p) {
  if (!isValidPairing(p)) throw new ProtocolError('bad-pairing', 'appairage { channelId, key } invalide');
}
