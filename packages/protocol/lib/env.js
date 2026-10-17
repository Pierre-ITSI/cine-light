// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { ProtocolError } from './errors.js';

/**
 * Sous-ensemble de l'API WebCrypto dont le protocole a besoin.
 * @typedef {{ subtle: SubtleCrypto, getRandomValues: <T extends ArrayBufferView>(a: T) => T }} CryptoLike
 */

/** @type {CryptoLike | null} */
let injected = null;

/**
 * Injecte une implémentation WebCrypto (ex. `react-native-quick-crypto`).
 * Sans injection, on utilise `globalThis.crypto` (navigateurs, Node ≥ 19).
 * Passer `null` revient au comportement par défaut.
 *
 * @param {CryptoLike | null} impl
 */
export function setCrypto(impl) {
  if (impl !== null) {
    if (!impl || typeof impl !== 'object' || !impl.subtle || typeof impl.getRandomValues !== 'function') {
      throw new ProtocolError('no-crypto', 'setCrypto() attend un objet { subtle, getRandomValues }');
    }
  }
  injected = impl;
}

/** @returns {CryptoLike} */
export function getCrypto() {
  const c = injected || /** @type {any} */ (globalThis).crypto;
  if (!c || !c.subtle || typeof c.getRandomValues !== 'function') {
    throw new ProtocolError(
      'no-crypto',
      'WebCrypto indisponible : contexte non sécurisé (http://) ou polyfill non injecté (voir setCrypto)',
    );
  }
  return c;
}

/** @returns {SubtleCrypto} */
export function subtle() {
  return getCrypto().subtle;
}

/**
 * Octets aléatoires cryptographiques.
 * @param {number} n
 * @returns {Uint8Array}
 */
export function randomBytes(n) {
  const out = new Uint8Array(n);
  getCrypto().getRandomValues(out);
  return out;
}
