// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * Baux de licence (« leases ») : jeton signé Ed25519 par le service de
 * licence, vérifié HORS LIGNE par la télécommande (docs/LICENSING.md §6).
 *
 *   SRL1.<charge utile base64url>.<signature base64url>
 *
 * La signature (64 octets) porte sur les octets ASCII de
 * « SRL1.<charge utile base64url> » : le préfixe sépare ce format de tout
 * autre usage de la clé. Charge utile = JSON, champs EXACTS (tout champ
 * inconnu est refusé : aucune donnée personnelle ne peut s'y glisser) :
 *
 *   v     1                               version du format
 *   kid   [A-Za-z0-9_-]{1,32}             clé de signature (rotation, §8)
 *   lid   [A-Za-z0-9_-]{16,64}            identifiant opaque de la licence
 *                                         (aléatoire, ni la clé ni son empreinte)
 *   seat  [A-Za-z0-9_-]{16,64}            identifiant d'installation de la
 *                                         télécommande titulaire du siège
 *   iat   entier (s depuis l'époque Unix) émission du bail
 *   exp   entier (s)                      fin du bail (iat < exp ≤ lexp)
 *   lexp  entier (s)                      fin de la licence (6 mois)
 *   feat  tableau de [a-z0-9-]{1,32}, ≤ 16  fonctions débloquées
 *
 * Aucune dépendance. Vérification par WebCrypto (Ed25519) quand le moteur la
 * fournit, sinon par une fonction injectée (setEd25519Verifier) : voir
 * ed25519Support() et docs/LICENSING.md §6.4 pour la prise en charge.
 */

export const LEASE_PREFIX = 'SRL1.';
export const LEASE_VERSION = 1;
const MAX_TOKEN = 2048;
const ID = /^[A-Za-z0-9_-]{16,64}$/;
const KID = /^[A-Za-z0-9_-]{1,32}$/;
const FEAT = /^[a-z0-9-]{1,32}$/;
const FIELDS = ['v', 'kid', 'lid', 'seat', 'iat', 'exp', 'lexp', 'feat'];
const DAY = 86400;

export const LEASE_DEFAULTS = Object.freeze({
  graceSeconds: 3 * DAY, // après la fin du bail, hors ligne : avertissement, fonctions gardées
  maxLeaseSeconds: 31 * DAY, // un bail plus long est refusé (protection en cas de fuite de clé)
  clockSkewSeconds: 300, // tolérance d'horloge sur iat
});

// ── base64url ───────────────────────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_VAL = new Map([...B64].map((c, i) => [c, i]));

/** @param {Uint8Array} bytes @returns {string} */
export function toBase64Url(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[n >> 18] + B64[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63];
  }
  return out;
}

/** @param {string} str @returns {Uint8Array | null} null si invalide (canonique strict) */
export function fromBase64Url(str) {
  if (typeof str !== 'string' || str.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((str.length * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (const c of str) {
    const v = B64_VAL.get(c);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
  }
  if (acc & ((1 << bits) - 1)) return null; // bits de remplissage non nuls : non canonique
  return out;
}

const utf8 = (s) => new TextEncoder().encode(s);

// ── Ed25519 : WebCrypto ou vérificateur injecté ─────────────────────────────
/** @typedef {(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array) => Promise<boolean>} Ed25519Verifier */
/** @type {Ed25519Verifier | null} */
let injected = null;
/** @type {Promise<boolean> | null} */
let webCryptoProbe = null;

/**
 * Remplace la vérification WebCrypto (WebView sans Ed25519 : module natif
 * CryptoKit / java.security, ou implémentation JS auditée). null = défaut.
 * @param {Ed25519Verifier | null} fn
 */
export function setEd25519Verifier(fn) {
  if (fn !== null && typeof fn !== 'function') throw new TypeError('setEd25519Verifier : fonction ou null attendue');
  injected = fn;
}

// RFC 8032 §7.1, TEST 1 (message vide)
const RFC8032_PUB = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const RFC8032_SIG = 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';
const hex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));

async function webCryptoVerify(publicKey, signature, message) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']);
  return subtle.verify({ name: 'Ed25519' }, key, signature, message);
}

/** Vérifie le vecteur RFC 8032 (et qu'une signature altérée est refusée). */
async function selfTest(verify) {
  try {
    const sig = hex(RFC8032_SIG);
    if (!(await verify(hex(RFC8032_PUB), sig, new Uint8Array(0)))) return false;
    sig[0] ^= 1;
    return (await verify(hex(RFC8032_PUB), sig, new Uint8Array(0))) === false;
  } catch (_) {
    return false;
  }
}

/**
 * Moyen de vérification disponible : 'injected' (setEd25519Verifier),
 * 'webcrypto' (Ed25519 natif, vecteur RFC 8032 vérifié) ou 'none'.
 * @returns {Promise<'injected' | 'webcrypto' | 'none'>}
 */
export async function ed25519Support() {
  if (injected) return (await selfTest(injected)) ? 'injected' : 'none';
  if (!(globalThis.crypto && globalThis.crypto.subtle)) return 'none';
  if (!webCryptoProbe) webCryptoProbe = selfTest(webCryptoVerify);
  return (await webCryptoProbe) ? 'webcrypto' : 'none';
}

/** Oublie le résultat mis en cache de la sonde WebCrypto (tests). */
export function resetEd25519Probe() {
  webCryptoProbe = null;
}

// ── Charge utile ────────────────────────────────────────────────────────────
const isTime = (n) => Number.isSafeInteger(n) && n > 0;

/**
 * Contrôle de forme d'une charge utile (sans signature ni horloge).
 * @param {unknown} p
 * @param {{ maxLeaseSeconds?: number }} [opts]
 * @returns {string | null} motif du refus, ou null si la forme est correcte
 */
export function leasePayloadProblem(p, opts = {}) {
  const maxLease = opts.maxLeaseSeconds ?? LEASE_DEFAULTS.maxLeaseSeconds;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'payload';
  const keys = Object.keys(p);
  if (keys.length !== FIELDS.length || !FIELDS.every((k) => keys.includes(k))) return 'payload';
  if (p.v !== LEASE_VERSION) return 'version';
  if (typeof p.kid !== 'string' || !KID.test(p.kid)) return 'payload';
  if (typeof p.lid !== 'string' || !ID.test(p.lid)) return 'payload';
  if (typeof p.seat !== 'string' || !ID.test(p.seat)) return 'payload';
  if (!isTime(p.iat) || !isTime(p.exp) || !isTime(p.lexp)) return 'payload';
  if (!(p.iat < p.exp && p.exp <= p.lexp)) return 'payload';
  if (p.exp - p.iat > maxLease) return 'too-long';
  if (!Array.isArray(p.feat) || p.feat.length > 16 || !p.feat.every((f) => typeof f === 'string' && FEAT.test(f))) return 'payload';
  if (new Set(p.feat).size !== p.feat.length) return 'payload';
  return null;
}

/**
 * Découpe un jeton sans rien vérifier (affichage, diagnostic).
 * @param {unknown} token
 * @returns {{ payload: object, signed: Uint8Array, signature: Uint8Array } | null}
 */
export function decodeLease(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN || !token.startsWith(LEASE_PREFIX)) return null;
  const parts = token.slice(LEASE_PREFIX.length).split('.');
  if (parts.length !== 2) return null;
  const body = fromBase64Url(parts[0]);
  const signature = fromBase64Url(parts[1]);
  if (!body || !signature || signature.length !== 64) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch (_) { return null; }
  return { payload, signed: utf8(LEASE_PREFIX + parts[0]), signature };
}

function publicKeyBytes(k) {
  if (k instanceof Uint8Array) return k.length === 32 ? k : null;
  if (typeof k === 'string') {
    const b = fromBase64Url(k);
    return b && b.length === 32 ? b : null;
  }
  return null;
}

/**
 * Vérifie un bail hors ligne.
 *
 * @param {unknown} token
 * @param {{
 *   keys: Record<string, Uint8Array | string>,  // kid → clé publique Ed25519 brute (32 octets, ou base64url)
 *   seat: string,                               // identifiant d'installation de CETTE télécommande
 *   now?: number,                               // ms (Date.now() par défaut)
 *   graceSeconds?: number, maxLeaseSeconds?: number, clockSkewSeconds?: number,
 * }} opts
 * @returns {Promise<
 *   | { ok: true, status: 'valid' | 'grace', payload: object, expiresAt: number, graceEndsAt: number, licenceExpiresAt: number }
 *   | { ok: false, status: 'expired' | 'licence-expired', payload: object, expiresAt: number, graceEndsAt: number, licenceExpiresAt: number }
 *   | { ok: false, status: 'invalid', reason: 'format' | 'payload' | 'version' | 'too-long' | 'unknown-key' | 'unsupported' | 'signature' | 'seat' | 'not-yet-valid' }
 * >}
 *   expiresAt, graceEndsAt, licenceExpiresAt en ms. Ne lève jamais d'exception
 *   pour un jeton invalide.
 */
export async function verifyLease(token, opts) {
  const o = { ...LEASE_DEFAULTS, ...opts };
  const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
  const d = decodeLease(token);
  if (!d) return invalid('format');
  const problem = leasePayloadProblem(d.payload, o);
  if (problem) return invalid(problem);
  const p = d.payload;
  const pub = o.keys && Object.prototype.hasOwnProperty.call(o.keys, p.kid) ? publicKeyBytes(o.keys[p.kid]) : null;
  if (!pub) return invalid('unknown-key');
  const support = await ed25519Support();
  if (support === 'none') return invalid('unsupported');
  let good = false;
  try {
    good = support === 'injected' ? await injected(pub, d.signature, d.signed) : await webCryptoVerify(pub, d.signature, d.signed);
  } catch (_) {
    good = false;
  }
  if (good !== true) return invalid('signature');
  // Comparaison simple : le siège n'est pas un secret (il figure dans le bail)
  if (typeof o.seat !== 'string' || p.seat !== o.seat) return invalid('seat');
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  if (now + o.clockSkewSeconds < p.iat) return invalid('not-yet-valid');
  const times = { payload: p, expiresAt: p.exp * 1000, graceEndsAt: Math.min(p.exp + o.graceSeconds, p.lexp) * 1000, licenceExpiresAt: p.lexp * 1000 };
  if (now > p.lexp) return { ok: false, status: 'licence-expired', ...times };
  if (now <= p.exp) return { ok: true, status: 'valid', ...times };
  if (now <= p.exp + o.graceSeconds) return { ok: true, status: 'grace', ...times };
  return { ok: false, status: 'expired', ...times };
}
