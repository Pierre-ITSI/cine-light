// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * Erreur typée du protocole. `code` est stable et destiné au code appelant
 * (journalisation, métriques) ; `message` est purement indicatif.
 *
 * Codes :
 *  - 'no-crypto'        : aucune implémentation WebCrypto disponible
 *  - 'bad-pairing'      : secret d'appairage absent ou mal formé
 *  - 'bad-key'          : clé publique ECDH invalide / réfléchie
 *  - 'bad-argument'     : paramètre d'appel invalide (bug côté appelant)
 *  - 'malformed'        : trame illisible (base64, en-tête, JSON, UTF-8)
 *  - 'version'          : version de trame non supportée
 *  - 'kind'             : trame message ouverte comme chunk ou inversement
 *  - 'too-large'        : dépassement d'un plafond de taille
 *  - 'auth'             : échec AES-GCM (falsification, mauvaise clé, mauvais sens)
 *  - 'replay'           : numéro de séquence déjà vu ou hors fenêtre
 *  - 'stale'            : horodatage hors de la tolérance d'horloge
 *  - 'invalid-message'  : message rejeté par le schéma
 */
export class ProtocolError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   */
  constructor(code, message) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'ProtocolError';
    /** @type {string} */
    this.code = code;
  }
}
