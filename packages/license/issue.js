// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * Côté SERVICE de licence (et tests) : émission d'un bail signé et tirage des
 * identifiants opaques. L'app n'en a pas besoin ; aucune clé privée n'est
 * dans ce dépôt (docs/LICENSING.md §8 : la clé de signature vit dans le .env
 * du VPS).
 */
import { LEASE_PREFIX, LEASE_DEFAULTS, toBase64Url, leasePayloadProblem } from './lease.js';

/**
 * Identifiant opaque aléatoire (128 bits, 22 caractères base64url) : siège
 * d'une installation (« seat ») ou identifiant de licence (« lid »).
 * @returns {string}
 */
export function randomId() {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Signe une charge utile de bail (forme contrôlée par leasePayloadProblem).
 * @param {object} payload  { v, kid, lid, seat, iat, exp, lexp, feat }
 * @param {CryptoKey} privateKey  clé privée Ed25519 WebCrypto (usage « sign »)
 * @param {{ maxLeaseSeconds?: number }} [opts]
 * @returns {Promise<string>} « SRL1.<charge utile>.<signature> »
 */
export async function signLease(payload, privateKey, opts = {}) {
  const problem = leasePayloadProblem(payload, { maxLeaseSeconds: opts.maxLeaseSeconds ?? LEASE_DEFAULTS.maxLeaseSeconds });
  if (problem) throw new TypeError('signLease : charge utile refusée (' + problem + ')');
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signed = new TextEncoder().encode(LEASE_PREFIX + body);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, privateKey, signed));
  return LEASE_PREFIX + body + '.' + toBase64Url(sig);
}
