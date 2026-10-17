// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * @setremote/license : format des clés de licence et vérification hors ligne
 * des baux signés (docs/LICENSING.md). Zéro dépendance, WebCrypto seulement.
 *
 * PRÉPARATION : rien dans l'app n'importe ce paquet. La version libre /
 * auto-hébergée ne vérifie aucune licence (LICENSING: 'off', web/js/01-config.js).
 */
export {
  KEY_ALPHABET, KEY_LENGTH, KEY_DATA_LENGTH, KEY_GROUP_LENGTH, KEY_ENTROPY_BITS,
  checkCharacter, normalizeLicenseKey, parseLicenseKey, isValidLicenseKey,
  formatLicenseKey, formatKeyInput, generateLicenseKey,
} from './key.js';
export {
  LEASE_PREFIX, LEASE_VERSION, LEASE_DEFAULTS, toBase64Url, fromBase64Url,
  setEd25519Verifier, ed25519Support, resetEd25519Probe, leasePayloadProblem, decodeLease, verifyLease,
} from './lease.js';
export { randomId, signLease } from './issue.js';
