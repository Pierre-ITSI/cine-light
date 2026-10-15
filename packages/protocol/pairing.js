/**
 * Appairage télécommande ↔ écrans.
 *
 * Modèle : la TÉLÉCOMMANDE possède UN secret de session { channelId, key }
 * partagé par TOUS ses écrans.
 *
 *  (a) QR : la télécommande affiche pairingUrl(base, session). Le secret est
 *      dans le FRAGMENT (#p=v1.<channelId>.<key>) : jamais envoyé au serveur
 *      web. Autant d'écrans que voulu peuvent scanner le même QR.
 *
 *  (b) Code manuel (sans caméra) : UN nouveau code court par écran.
 *      Échange ECDH P-256 sur un topic de rendez-vous dérivé du code, avec
 *      engagement (commit/reveal) puis Short Authentication String (SAS) à
 *      6 chiffres comparée par l'utilisateur. Le secret ECDH ne sert qu'à
 *      établir un canal temporaire par lequel la télécommande remet le
 *      secret de session à l'écran (sealSessionForPeer / openSessionFromPeer).
 *
 * Déroulé (b), messages en clair sur le topic de rendez-vous, voir
 * RENDEZVOUS_MESSAGE_TYPES :
 *   1. Télécommande : createRendezvous() → affiche le code, s'abonne.
 *   2. Écran : saisit le code, ecdhKeyPair(), publie pair:commit { commit = H(pkÉcran) }.
 *   3. Télécommande : ecdhKeyPair(), publie pair:key { jwk = pkTélécommande }.
 *   4. Écran : publie pair:reveal { jwk = pkÉcran }.
 *   5. Télécommande : verifyCommitment(pkÉcran, commit) sinon abandon.
 *   6. Les deux : deriveSharedPairing(...) → { pairing: temporaire, sas }.
 *      L'utilisateur compare les 6 chiffres sur les deux appareils.
 *   7. Après confirmation sur la télécommande : pair:session { frame = sealSessionForPeer(...) }.
 *   8. Après confirmation sur l'écran : openSessionFromPeer(frame, temporaire) → session.
 *
 * L'engagement (étape 2 avant 3) empêche un attaquant actif de « chercher »
 * une paire de clés donnant la même SAS des deux côtés : sa probabilité de
 * succès reste 1/10⁶ par tentative au lieu d'être triviale.
 */
import { ProtocolError } from './lib/errors.js';
import { randomBytes, subtle } from './lib/env.js';
import { b64uToBytes, bytesToB64u, concatBytes, timingSafeEqual, utf8Encode } from './lib/encoding.js';
import { hkdfBits, lengthPrefixed, sha256 } from './lib/kdf.js';
import {
  assertPairing, isValidPairing, CHANNEL_ID_BYTES, PAIRING_KEY_BYTES, CHANNEL_ID_CHARS, PAIRING_KEY_CHARS,
} from './lib/pairingFormat.js';
import { createReplayState, deriveSession, open, seal } from './crypto.js';

export { isValidPairing, assertPairing, CHANNEL_ID_BYTES, PAIRING_KEY_BYTES };

/** @typedef {import('./lib/pairingFormat.js').Pairing} Pairing */

export const PAIRING_VERSION = 'v1';
const MAX_URL_LENGTH = 4096;
const FRAGMENT_RE = new RegExp(`^p=v1\\.([A-Za-z0-9_-]{${CHANNEL_ID_CHARS}})\\.([A-Za-z0-9_-]{${PAIRING_KEY_CHARS}})$`);

/**
 * Nouveau secret de session (128 bits de channelId, 256 bits de clé).
 * @returns {Pairing}
 */
export function createPairing() {
  return {
    channelId: bytesToB64u(randomBytes(CHANNEL_ID_BYTES)),
    key: bytesToB64u(randomBytes(PAIRING_KEY_BYTES)),
  };
}

/**
 * URL d'appairage (contenu du QR). Le secret est UNIQUEMENT dans le
 * fragment ; un éventuel fragment existant de `base` est remplacé.
 *
 * @param {string} base  ex. 'https://exemple.app/' (query conservée)
 * @param {Pairing} pairing
 * @returns {string}
 */
export function pairingUrl(base, pairing) {
  assertPairing(pairing);
  if (typeof base !== 'string') throw new ProtocolError('bad-argument', 'base doit être une chaîne');
  const i = base.indexOf('#');
  const clean = i >= 0 ? base.slice(0, i) : base;
  return `${clean}#p=${PAIRING_VERSION}.${pairing.channelId}.${pairing.key}`;
}

/**
 * Extrait l'appairage d'une URL complète, d'un fragment (« #p=… ») ou de la
 * valeur seule (« p=v1.… »). Renvoie null si absent ou invalide — y compris
 * pour un ancien code canal (« #set4271 »), que l'appelant traite alors en
 * mode historique.
 *
 * Après lecture, l'app doit effacer le fragment de la barre d'adresse
 * (history.replaceState) pour qu'il ne reste pas dans l'historique.
 *
 * @param {string} str
 * @returns {Pairing | null}
 */
export function parsePairingUrl(str) {
  if (typeof str !== 'string' || str.length > MAX_URL_LENGTH) return null;
  const i = str.indexOf('#');
  const frag = i >= 0 ? str.slice(i + 1) : str;
  for (const part of frag.split('&')) {
    if (!part.startsWith('p=')) continue;
    const m = FRAGMENT_RE.exec(part);
    if (!m) return null;
    const pairing = { channelId: m[1], key: m[2] };
    return isValidPairing(pairing) ? pairing : null;
  }
  return null;
}

// ─────────────────────────── Rendez-vous (code court) ───────────────────────────

/** Sans I, L, O, 0, 1 (confusions à la lecture/saisie). 31 symboles. */
export const RENDEZVOUS_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RENDEZVOUS_CODE_LENGTH = 6;
export const RENDEZVOUS_TTL_MS = 2 * 60 * 1000;

/**
 * Nouveau code de rendez-vous (≈ 29,7 bits, tirage sans biais).
 * Un code par écran à appairer ; à jeter après usage ou expiration.
 *
 * @param {{ now?: number, ttlMs?: number }} [opts]
 * @returns {{ code: string, expiresAt: number }}
 */
export function createRendezvous(opts = {}) {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? RENDEZVOUS_TTL_MS;
  const A = RENDEZVOUS_ALPHABET;
  const limit = 256 - (256 % A.length); // rejet des octets ≥ 248 : pas de biais modulo
  let code = '';
  while (code.length < RENDEZVOUS_CODE_LENGTH) {
    for (const b of randomBytes(16)) {
      if (b < limit && code.length < RENDEZVOUS_CODE_LENGTH) code += A[b % A.length];
    }
  }
  return { code, expiresAt: now + ttlMs };
}

/**
 * Normalise une saisie (« abc-def », « ABC DEF ») ; null si invalide.
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeRendezvousCode(input) {
  if (typeof input !== 'string' || input.length > 32) return null;
  const s = input.toUpperCase().replace(/[\s._-]/g, '');
  if (s.length !== RENDEZVOUS_CODE_LENGTH) return null;
  for (const ch of s) if (!RENDEZVOUS_ALPHABET.includes(ch)) return null;
  return s;
}

/** « K7PQ4X » → « K7P-Q4X » */
export function formatRendezvousCode(/** @type {string} */ code) {
  const c = normalizeRendezvousCode(code);
  if (!c) throw new ProtocolError('bad-argument', 'code de rendez-vous invalide');
  return `${c.slice(0, 3)}-${c.slice(3)}`;
}

/**
 * Identifiant opaque (base64url, 128 bits) du topic de rendez-vous.
 * Topic MQTT complet : RENDEZVOUS_TOPIC_PREFIX + rendezvousTopic(code).
 *
 * @param {string} code
 * @returns {Promise<string>}
 */
export async function rendezvousTopic(code) {
  const c = normalizeRendezvousCode(code);
  if (!c) throw new ProtocolError('bad-argument', 'code de rendez-vous invalide');
  const h = await sha256(utf8Encode(`setremote/v1/rendezvous/${c}`));
  return bytesToB64u(h.subarray(0, 16));
}

// ─────────────────────────── ECDH P-256 + SAS ───────────────────────────

const EC_ALG = Object.freeze({ name: 'ECDH', namedCurve: 'P-256' });

/** @typedef {{ kty: 'EC', crv: 'P-256', x: string, y: string }} PublicJwk */
/** @typedef {{ privateKey: CryptoKey, publicJwk: PublicJwk }} EcdhKeyPair */

/**
 * Valide et réduit un JWK public P-256 à { kty, crv, x, y }.
 * @param {unknown} jwk
 * @returns {PublicJwk}
 */
export function sanitizePublicJwk(jwk) {
  const j = /** @type {any} */ (jwk);
  if (!j || typeof j !== 'object' || j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.x !== 'string' || typeof j.y !== 'string') {
    throw new ProtocolError('bad-key', 'JWK public P-256 attendu');
  }
  if (Object.prototype.hasOwnProperty.call(j, 'd')) throw new ProtocolError('bad-key', 'clé privée présente dans le JWK');
  let x;
  let y;
  try {
    x = b64uToBytes(j.x);
    y = b64uToBytes(j.y);
  } catch (_) {
    throw new ProtocolError('bad-key', 'coordonnées non base64url');
  }
  if (x.length !== 32 || y.length !== 32) throw new ProtocolError('bad-key', 'coordonnées de 32 octets attendues');
  return { kty: 'EC', crv: 'P-256', x: j.x, y: j.y };
}

/** Point non compressé 0x04 ‖ x ‖ y */
function jwkPoint(/** @type {unknown} */ jwk) {
  const j = sanitizePublicJwk(jwk);
  return concatBytes(Uint8Array.of(4), b64uToBytes(j.x), b64uToBytes(j.y));
}

/**
 * Paire de clés éphémère (clé privée non exportable). Une par tentative.
 * @returns {Promise<EcdhKeyPair>}
 */
export async function ecdhKeyPair() {
  const s = subtle();
  const kp = /** @type {CryptoKeyPair} */ (await s.generateKey(EC_ALG, false, ['deriveBits']));
  const jwk = await s.exportKey('jwk', kp.publicKey);
  return { privateKey: kp.privateKey, publicJwk: sanitizePublicJwk(jwk) };
}

/**
 * Engagement sur une clé publique (étape pair:commit).
 * @param {PublicJwk} publicJwk
 * @returns {Promise<string>} base64url (43 caractères)
 */
export async function commitPublicKey(publicJwk) {
  const h = await sha256(concatBytes(utf8Encode('setremote/v1/pair/commit'), jwkPoint(publicJwk)));
  return bytesToB64u(h);
}

/**
 * @param {unknown} publicJwk
 * @param {unknown} commitment
 * @returns {Promise<boolean>}
 */
export async function verifyCommitment(publicJwk, commitment) {
  try {
    if (typeof commitment !== 'string') return false;
    const expected = b64uToBytes(await commitPublicKey(/** @type {PublicJwk} */ (publicJwk)));
    return timingSafeEqual(expected, b64uToBytes(commitment));
  } catch (_) {
    return false;
  }
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function compareBytes(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * Calcule le secret partagé et en dérive (HKDF-SHA256) :
 *  - un appairage { channelId, key } (temporaire dans le flux multi-écran),
 *  - la SAS : 6 chiffres dérivés du secret ECDH ET des deux clés publiques
 *    (transcription ordonnée canoniquement : les deux côtés obtiennent la
 *    même valeur quel que soit leur rôle).
 *
 * Un attaquant au milieu établit deux secrets distincts : les SAS affichées
 * diffèrent (sauf avec probabilité 10⁻⁶).
 *
 * @param {EcdhKeyPair} myKeyPair
 * @param {unknown} peerPublicJwk
 * @param {{ code?: string, context?: string }} [transcript]  code de rendez-vous saisi, contexte libre
 * @returns {Promise<{ pairing: Pairing, sas: string }>}
 */
export async function deriveSharedPairing(myKeyPair, peerPublicJwk, transcript = {}) {
  if (!myKeyPair || typeof myKeyPair !== 'object' || !myKeyPair.privateKey) {
    throw new ProtocolError('bad-argument', 'paire de clés ECDH attendue');
  }
  const myPoint = jwkPoint(myKeyPair.publicJwk);
  const peerPoint = jwkPoint(peerPublicJwk);
  if (timingSafeEqual(myPoint, peerPoint)) throw new ProtocolError('bad-key', 'clé réfléchie (identique à la nôtre)');

  let code = '';
  if (transcript.code !== undefined) {
    const c = normalizeRendezvousCode(transcript.code);
    if (!c) throw new ProtocolError('bad-argument', 'code de rendez-vous invalide');
    code = c;
  }
  const context = transcript.context ?? '';
  if (typeof context !== 'string' || context.length > 256) throw new ProtocolError('bad-argument', 'contexte invalide');

  const s = subtle();
  /** @type {CryptoKey} */
  let peerKey;
  try {
    peerKey = await s.importKey('jwk', { ...sanitizePublicJwk(peerPublicJwk), ext: true }, EC_ALG, true, []);
  } catch (_) {
    throw new ProtocolError('bad-key', 'point invalide (hors courbe)');
  }
  const z = new Uint8Array(await s.deriveBits({ name: 'ECDH', public: peerKey }, myKeyPair.privateKey, 256));

  const [lo, hi] = compareBytes(myPoint, peerPoint) < 0 ? [myPoint, peerPoint] : [peerPoint, myPoint];
  const th = await sha256(concatBytes(
    utf8Encode('setremote/v1/pair/transcript'),
    lengthPrefixed(utf8Encode(code)),
    lengthPrefixed(utf8Encode(context)),
    lengthPrefixed(lo),
    lengthPrefixed(hi),
  ));
  const [channelId, key, sasBytes] = await Promise.all([
    hkdfBits(z, th, 'setremote/v1/pair/channel-id', 128),
    hkdfBits(z, th, 'setremote/v1/pair/key', 256),
    hkdfBits(z, th, 'setremote/v1/pair/sas', 48),
  ]);
  z.fill(0);
  let n = 0;
  for (const b of sasBytes) n = n * 256 + b; // 48 bits : entier exact en double
  const sas = String(n % 1_000_000).padStart(6, '0');
  const pairing = { channelId: bytesToB64u(channelId), key: bytesToB64u(key) };
  key.fill(0);
  return { pairing, sas };
}

/** « 042913 » → « 042 913 » */
export function formatSas(/** @type {string} */ sas) {
  if (typeof sas !== 'string' || !/^\d{6}$/.test(sas)) throw new ProtocolError('bad-argument', 'SAS invalide');
  return `${sas.slice(0, 3)} ${sas.slice(3)}`;
}

// ─────────────────────────── Remise du secret de session ───────────────────────────

const SESSION_TRANSFER_TYPE = 'pair:session';

/**
 * Télécommande → écran : chiffre le secret de session avec le canal
 * temporaire issu de l'ECDH (clé r2s de la session dérivée de
 * `peerPairing`). À n'appeler qu'APRÈS confirmation de la SAS par
 * l'utilisateur sur la télécommande.
 *
 * @param {Pairing} sessionPairing  secret de session partagé par tous les écrans
 * @param {Pairing} peerPairing     appairage temporaire (deriveSharedPairing)
 * @param {{ label?: string, sender?: string }} [opts]  label : nom du plateau affiché par l'écran
 * @returns {Promise<string>}
 */
export async function sealSessionForPeer(sessionPairing, peerPairing, opts = {}) {
  assertPairing(sessionPairing);
  assertPairing(peerPairing);
  if (sessionPairing.channelId === peerPairing.channelId) {
    throw new ProtocolError('bad-argument', 'le secret de session ne doit pas être l’appairage temporaire');
  }
  const label = opts.label ?? '';
  if (typeof label !== 'string' || label.length > 40) throw new ProtocolError('bad-argument', 'label ≤ 40 caractères');
  const temp = await deriveSession(peerPairing);
  /** @type {{ type: string, channelId: string, key: string, label?: string }} */
  const msg = { type: SESSION_TRANSFER_TYPE, channelId: sessionPairing.channelId, key: sessionPairing.key };
  if (label) msg.label = label;
  return seal(msg, temp.keys.r2s, { sender: opts.sender ?? 'rdv', seq: 0 });
}

/**
 * Écran : déchiffre le secret de session remis par la télécommande.
 * À n'appeler qu'APRÈS confirmation de la SAS par l'utilisateur sur l'écran.
 *
 * @param {string} frame
 * @param {Pairing} peerPairing  appairage temporaire (deriveSharedPairing)
 * @returns {Promise<{ pairing: Pairing, label: string }>}
 */
export async function openSessionFromPeer(frame, peerPairing) {
  assertPairing(peerPairing);
  const temp = await deriveSession(peerPairing);
  const msg = await open(frame, temp.keys.r2s, createReplayState({ maxSkewMs: RENDEZVOUS_TTL_MS * 2 }));
  if (msg.type !== SESSION_TRANSFER_TYPE) throw new ProtocolError('invalid-message', 'type de remise inattendu');
  const keys = Object.keys(msg);
  if (keys.some(k => !['type', 'channelId', 'key', 'label'].includes(k))) {
    throw new ProtocolError('invalid-message', 'champ inattendu dans la remise de session');
  }
  const pairing = { channelId: msg.channelId, key: msg.key };
  if (!isValidPairing(pairing)) throw new ProtocolError('bad-pairing', 'secret de session invalide');
  const label = msg.label ?? '';
  if (typeof label !== 'string' || label.length > 40) throw new ProtocolError('invalid-message', 'label invalide');
  return { pairing: /** @type {Pairing} */ (pairing), label };
}

// ─────────────────────────── Messages de rendez-vous ───────────────────────────

const B64U_43 = /^[A-Za-z0-9_-]{43}$/;

/**
 * Messages EN CLAIR échangés sur le topic de rendez-vous (v = 1).
 * Rien de secret n'y circule : clés publiques, engagement, secret de
 * session chiffré. Un attaquant peut seulement perturber (DoS) ou provoquer
 * des SAS différentes, que l'utilisateur détecte.
 */
export const RENDEZVOUS_MESSAGE_TYPES = Object.freeze({
  'pair:commit': { from: 'screen', fields: { v: '1', commit: 'SHA-256 de la clé publique de l’écran (base64url 43)' } },
  'pair:key': { from: 'remote', fields: { v: '1', jwk: 'clé publique ECDH P-256 de la télécommande' } },
  'pair:reveal': { from: 'screen', fields: { v: '1', jwk: 'clé publique ECDH P-256 de l’écran' } },
  'pair:session': { from: 'remote', fields: { v: '1', frame: 'sealSessionForPeer(...) — secret de session chiffré' } },
  'pair:abort': { from: 'both', fields: { v: '1', reason: "'mismatch' | 'timeout' | 'cancel' (facultatif)" } },
});

/**
 * @param {unknown} msg
 * @returns {boolean}
 */
export function validateRendezvousMessage(msg) {
  try {
    const m = /** @type {any} */ (msg);
    if (!m || typeof m !== 'object' || Array.isArray(m) || m.v !== 1) return false;
    const keys = Object.keys(m);
    const only = (/** @type {string[]} */ allowed) => keys.every(k => allowed.includes(k));
    switch (m.type) {
      case 'pair:commit':
        return only(['type', 'v', 'commit']) && typeof m.commit === 'string' && B64U_43.test(m.commit);
      case 'pair:key':
      case 'pair:reveal':
        if (!only(['type', 'v', 'jwk'])) return false;
        sanitizePublicJwk(m.jwk);
        return Object.keys(m.jwk).every(k => ['kty', 'crv', 'x', 'y', 'ext', 'key_ops'].includes(k));
      case 'pair:session':
        return only(['type', 'v', 'frame']) && typeof m.frame === 'string' && m.frame.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(m.frame);
      case 'pair:abort':
        return only(['type', 'v', 'reason']) && (m.reason === undefined || ['mismatch', 'timeout', 'cancel'].includes(m.reason));
      default:
        return false;
    }
  } catch (_) {
    return false;
  }
}
