// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * Clés PAR ÉCRAN (« pairwise ») : une clé AES-256-GCM propre au couple
 * télécommande ↔ écran, en plus du secret de session commun à tous.
 *
 * Pourquoi : tous les écrans partagent la clé de session. Pour RETIRER un écran,
 * la télécommande crée une nouvelle session et la remet à chacun des AUTRES
 * écrans, chiffrée avec SA clé pairwise : l'écran retiré, qui connaît
 * l'ancienne session, ne peut pas la lire.
 *
 * Établissement (après l'appairage par QR ou par code, ou à la première
 * connexion d'un écran appairé avant cette version), DANS la session chiffrée :
 *
 *   télécommande                                   écran
 *   key:offer  { rid, xid, jwk_R }  ── session ──►        (clés ECDH P-256
 *          ◄── session ── key:answer { sid, rid, xid, jwk_E }  éphémères)
 *   derivePairwiseSecret(...)                      derivePairwiseSecret(...)
 *   key:confirm { sid, rid, xid } ── pairwise ──►  (preuve de possession :
 *          ◄── pairwise ── key:ok { sid, xid }      trame ouverte = même clé)
 *
 * Secret : HKDF-SHA256(ECDH(éphémère R, éphémère E), sel = SHA-256 de la
 * transcription), transcription = channelId de la session, identifiants
 * stables de la télécommande (rid) et de l'écran (sid), identifiant de
 * l'échange (xid) et les deux clés publiques. Clés de chiffrement (une par
 * sens) et identifiant de clé (kid, non secret) : HKDF du secret, liés à rid
 * et sid. Seul le secret (32 octets) est conservé, par les deux côtés.
 *
 * Authentification : par la session (les clés publiques circulent dans des
 * trames scellées avec la clé de session). Un appareil de la session qui
 * attaquerait activement l'échange d'un autre écran au moment où il a lieu
 * reste hors garanties (voir README § 2) ; la télécommande compare le kid
 * annoncé par chaque écran (caps) à celui qu'elle a enregistré.
 */
import { ProtocolError } from './lib/errors.js';
import { randomBytes, subtle } from './lib/env.js';
import { asciiBytes, b64uToBytes, bytesToB64u, concatBytes, timingSafeEqual, utf8Encode } from './lib/encoding.js';
import { hkdfBits, lengthPrefixed, sha256 } from './lib/kdf.js';
import { sanitizePublicJwk } from './pairing.js';
import { SCREEN_ID_RE } from './schema.js';

/** Secret pairwise conservé : 32 octets en base64url. */
export const PAIRWISE_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
/** Identifiant (non secret) d'une clé pairwise : 64 bits en base64url. */
export const KEY_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** Identifiant d'un échange de clés : 96 bits en base64url. */
export const EXCHANGE_ID_RE = /^[A-Za-z0-9_-]{16}$/;
const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * Identifiant stable de la télécommande (96 bits), à tirer au premier
 * lancement et à conserver. Même format qu'un screenId.
 * @returns {string}
 */
export function createRemoteId() {
  return bytesToB64u(randomBytes(12));
}

/** @returns {string} identifiant d'un échange de clés */
export function createExchangeId() {
  return bytesToB64u(randomBytes(12));
}

/** Point non compressé 0x04 ‖ x ‖ y d'un JWK public P-256 validé */
function point(/** @type {unknown} */ jwk) {
  const j = sanitizePublicJwk(jwk);
  return concatBytes(Uint8Array.of(4), b64uToBytes(j.x), b64uToBytes(j.y));
}

/** @param {unknown} v @param {RegExp} re @param {string} what */
function checkId(v, re, what) {
  if (typeof v !== 'string' || !re.test(v)) throw new ProtocolError('bad-argument', `${what} invalide`);
  return v;
}

/**
 * Sel lié aux deux identifiants : un secret recopié ailleurs (autre écran,
 * autre télécommande) donne d'autres clés.
 * @param {string} remoteId @param {string} screenId
 */
async function idsSalt(remoteId, screenId) {
  return sha256(concatBytes(asciiBytes('setremote/v1/pairwise/ids'), lengthPrefixed(asciiBytes(remoteId)), lengthPrefixed(asciiBytes(screenId))));
}

/**
 * Calcule le secret pairwise d'un échange, des deux côtés (même résultat).
 *
 * @param {import('./pairing.js').EcdhKeyPair} myKeyPair  paire éphémère de CE côté (ecdhKeyPair())
 * @param {{ offerJwk: unknown, answerJwk: unknown, channelId: string, remoteId: string, screenId: string, exchangeId: string }} t
 *   offerJwk : clé publique de la télécommande ; answerJwk : celle de l'écran
 *   (l'une des deux est la nôtre) ; channelId : session en cours.
 * @returns {Promise<{ secret: string, kid: string }>}
 */
export async function derivePairwiseSecret(myKeyPair, t) {
  if (!myKeyPair || typeof myKeyPair !== 'object' || !myKeyPair.privateKey) {
    throw new ProtocolError('bad-argument', 'paire de clés ECDH attendue');
  }
  if (!t || typeof t !== 'object') throw new ProtocolError('bad-argument', 'transcription attendue');
  const channelId = checkId(t.channelId, CHANNEL_ID_RE, 'channelId');
  const remoteId = checkId(t.remoteId, SCREEN_ID_RE, 'remoteId');
  const screenId = checkId(t.screenId, SCREEN_ID_RE, 'screenId');
  const exchangeId = checkId(t.exchangeId, EXCHANGE_ID_RE, 'exchangeId');
  if (remoteId === screenId) throw new ProtocolError('bad-argument', 'remoteId et screenId identiques');
  const offer = point(t.offerJwk);
  const answer = point(t.answerJwk);
  if (timingSafeEqual(offer, answer)) throw new ProtocolError('bad-key', 'clé réfléchie (offre = réponse)');
  const mine = point(myKeyPair.publicJwk);
  const peerJwk = timingSafeEqual(mine, offer) ? t.answerJwk : timingSafeEqual(mine, answer) ? t.offerJwk : null;
  if (!peerJwk) throw new ProtocolError('bad-argument', 'notre clé publique ne figure pas dans l’échange');

  const s = subtle();
  /** @type {CryptoKey} */
  let peerKey;
  try {
    peerKey = await s.importKey('jwk', { ...sanitizePublicJwk(peerJwk), ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  } catch (_) {
    throw new ProtocolError('bad-key', 'point invalide (hors courbe)');
  }
  const z = new Uint8Array(await s.deriveBits({ name: 'ECDH', public: peerKey }, myKeyPair.privateKey, 256));
  const th = await sha256(concatBytes(
    utf8Encode('setremote/v1/pairwise/transcript'),
    lengthPrefixed(asciiBytes(channelId)),
    lengthPrefixed(asciiBytes(remoteId)),
    lengthPrefixed(asciiBytes(screenId)),
    lengthPrefixed(asciiBytes(exchangeId)),
    lengthPrefixed(offer),
    lengthPrefixed(answer),
  ));
  const raw = await hkdfBits(z, th, 'setremote/v1/pairwise/secret', 256);
  z.fill(0);
  const secret = bytesToB64u(raw);
  raw.fill(0);
  const { kid } = await pairwiseKeys(secret, { remoteId, screenId });
  return { secret, kid };
}

/**
 * Clés de chiffrement d'un secret pairwise (non exportables) et son kid.
 *  - r2s : télécommande → écran ; s2r : écran → télécommande (comme la session)
 *  - kid : identifiant public de la clé (caps), pour vérifier que les deux
 *    côtés détiennent la même
 *
 * @param {string} secret  base64url 43 (derivePairwiseSecret)
 * @param {{ remoteId: string, screenId: string }} ids
 * @returns {Promise<{ r2s: CryptoKey, s2r: CryptoKey, kid: string }>}
 */
export async function pairwiseKeys(secret, ids) {
  checkId(secret, PAIRWISE_SECRET_RE, 'secret pairwise');
  const remoteId = checkId(ids && ids.remoteId, SCREEN_ID_RE, 'remoteId');
  const screenId = checkId(ids && ids.screenId, SCREEN_ID_RE, 'screenId');
  const ikm = b64uToBytes(secret);
  const salt = await idsSalt(remoteId, screenId);
  const [r2sRaw, s2rRaw, kidRaw] = await Promise.all([
    hkdfBits(ikm, salt, 'setremote/v1/pairwise/key/remote-to-screen', 256),
    hkdfBits(ikm, salt, 'setremote/v1/pairwise/key/screen-to-remote', 256),
    hkdfBits(ikm, salt, 'setremote/v1/pairwise/kid', 64),
  ]);
  const s = subtle();
  const alg = { name: 'AES-GCM' };
  const [r2s, s2r] = await Promise.all([
    s.importKey('raw', r2sRaw, alg, false, ['encrypt', 'decrypt']),
    s.importKey('raw', s2rRaw, alg, false, ['encrypt', 'decrypt']),
  ]);
  ikm.fill(0); r2sRaw.fill(0); s2rRaw.fill(0);
  return { r2s, s2r, kid: bytesToB64u(kidRaw) };
}
