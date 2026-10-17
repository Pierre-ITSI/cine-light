// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * Chiffrement de bout en bout des messages SetRemote.
 *
 *   deriveSession(pairing)            → { topic, keys: { r2s, s2r }, relayAuth }
 *   seal(obj, key, { sender, seq })   → trame compacte (chaîne base64url)
 *   open(str, key, replayState)       → obj (authentifié, anti-rejeu)
 *   sealChunk / openChunk             → fragments binaires de média
 *
 * Format de trame (octets, puis base64url sans remplissage) :
 *
 *   0      version            0x02
 *   1      kind               0x01 = message JSON, 0x02 = fragment de média,
 *                             0x03 = message JSON scellé avec une clé PAR ÉCRAN
 *                             (pairwise.js : jamais avec la clé de session)
 *   2      senderLen          1..16
 *   3..    sender             ASCII [A-Za-z0-9_-]
 *   +4     seq                uint32 big-endian
 *   +6     ts                 uint48 big-endian (ms depuis l'époque Unix)
 *   kind=1, 3 : rien de plus (le TYPE du message est DANS le chiffré)
 *   kind=2 : idLen (1) + mediaId ASCII (≤ 64) + index uint16 + total uint16
 *   ── fin de l'en-tête : tout ce qui précède est l'AAD AES-GCM ──
 *   +12    IV                 96 bits aléatoires
 *   …      ciphertext ‖ tag   AES-256-GCM, tag 128 bits
 *
 * L'en-tête circule en clair mais il est intégralement authentifié (AAD) :
 * modifier la version, l'émetteur, la séquence, l'horodatage ou les
 * métadonnées de fragment fait échouer le déchiffrement. Le type d'un
 * message (« color », « call:start »…) n'apparaît pas en clair : le relais
 * ne voit que des messages et des fragments opaques.
 *
 * Version 2 : le type est passé de l'en-tête (v1, en clair) au chiffré.
 */
import { ProtocolError } from './lib/errors.js';
import { randomBytes, subtle } from './lib/env.js';
import {
  asciiBytes, asciiString, b64uToBytes, bytesToB64u, concatBytes, exactBytes, utf8Decode, utf8Encode,
} from './lib/encoding.js';
import { hkdfBits } from './lib/kdf.js';
import { assertPairing } from './lib/pairingFormat.js';
import { MEDIA_ID_RE } from './schema.js';

export const FRAME_VERSION = 2;
export const FRAME_KIND = Object.freeze({ MESSAGE: 1, CHUNK: 2, PAIRWISE: 3 });
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
/**
 * Plafond du JSON clair d'un message (octets UTF-8, type compris) : 40 Kio.
 * Tout message valide pour le schéma tient dessous (le plus gros : un
 * media:order / caps de 500 identifiants de 64 caractères, ≈ 36 Kio). Les
 * gros contenus (images, sons, photo d'appel, vidéo) voyagent en fragments
 * (media-img-chunk, media:chunk : ≤ 20 000 caractères chacun, ou sealChunk).
 * Trame chiffrée maximale : MAX_FRAME_CHARS = 54 782 caractères, donc un
 * relais plafonné à 64 Kio par trame suffit.
 */
export const MAX_MESSAGE_BYTES = 40 * 1024;
/** Plafond du clair d'un fragment de média. */
export const MAX_CHUNK_BYTES = 16 * 1024;
/** Nombre maximal de fragments par média (16 Ko × 4000 ≈ 64 Mo). */
export const MAX_CHUNKS = 4000;
export const MAX_SEQ = 0xffffffff;
export const MAX_TS = 2 ** 48 - 1;
export const DEFAULT_REPLAY_WINDOW = 1024;
export const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_SENDERS = 256;

export const SENDER_RE = /^[A-Za-z0-9_-]{1,16}$/;
export const TYPE_RE = /^[a-z][a-z0-9:_-]{0,31}$/;

/** En-tête le plus long : celui d'un fragment (le message n'a pas de partie variable). */
const MAX_HEADER_BYTES = 3 + 16 + 4 + 6 + 1 + 64 + 4;
/** Longueur maximale (caractères) d'une trame acceptée par open/openChunk. */
export const MAX_FRAME_CHARS = Math.ceil(((MAX_HEADER_BYTES + IV_BYTES + MAX_MESSAGE_BYTES + TAG_BYTES) * 4) / 3);

const INFO = Object.freeze({
  topic: 'setremote/v1/session/topic',
  r2s: 'setremote/v1/session/key/remote-to-screen',
  s2r: 'setremote/v1/session/key/screen-to-remote',
  relayAuth: 'setremote/v1/session/relay-auth',
});

/**
 * @typedef {{ r2s: CryptoKey, s2r: CryptoKey }} SessionKeys
 * @typedef {{ topic: string, keys: SessionKeys, relayAuth: string }} Session
 */

/**
 * Dérive la session à partir du secret d'appairage (HKDF-SHA256,
 * IKM = key, sel = channelId).
 *
 *  - topic     : 128 bits base64url. Opaque : ne révèle ni channelId ni key.
 *  - keys.r2s  : AES-256-GCM télécommande → écran(s)
 *  - keys.s2r  : AES-256-GCM écran(s) → télécommande
 *  - relayAuth : 256 bits base64url, preuve facultative de connaissance du
 *                secret à présenter à un relais privé (voir docs/BROKER.md).
 *
 * @param {import('./lib/pairingFormat.js').Pairing} pairing
 * @returns {Promise<Session>}
 */
export async function deriveSession(pairing) {
  assertPairing(pairing);
  const ikm = b64uToBytes(pairing.key);
  const salt = b64uToBytes(pairing.channelId);
  const [topic, r2sRaw, s2rRaw, relayAuth] = await Promise.all([
    hkdfBits(ikm, salt, INFO.topic, 128),
    hkdfBits(ikm, salt, INFO.r2s, 256),
    hkdfBits(ikm, salt, INFO.s2r, 256),
    hkdfBits(ikm, salt, INFO.relayAuth, 256),
  ]);
  const s = subtle();
  const alg = { name: 'AES-GCM' };
  const [r2s, s2r] = await Promise.all([
    s.importKey('raw', r2sRaw, alg, false, ['encrypt', 'decrypt']),
    s.importKey('raw', s2rRaw, alg, false, ['encrypt', 'decrypt']),
  ]);
  ikm.fill(0);
  r2sRaw.fill(0);
  s2rRaw.fill(0);
  return { topic: bytesToB64u(topic), keys: { r2s, s2r }, relayAuth: bytesToB64u(relayAuth) };
}

/**
 * Étiquette d'émetteur aléatoire (une par appareil et par lancement).
 * Le préfixe ('r' télécommande, 's' écran) permet d'écarter sans
 * déchiffrer les trames qui ne nous sont pas destinées.
 * @param {string} [prefix]
 */
export function newSenderTag(prefix = '') {
  if (typeof prefix !== 'string' || !/^[A-Za-z0-9_-]{0,8}$/.test(prefix)) {
    throw new ProtocolError('bad-argument', 'préfixe d’émetteur invalide');
  }
  return prefix + bytesToB64u(randomBytes(6));
}

// ─────────────────────────── En-tête ───────────────────────────

/**
 * @typedef {{
 *   version: number, kind: number, sender: string, seq: number, ts: number,
 *   mediaId?: string, index?: number, total?: number,
 *   headerLength: number
 * }} FrameHeader
 */

function checkSenderSeqTs(/** @type {any} */ o) {
  if (!o || typeof o !== 'object') throw new ProtocolError('bad-argument', 'options { sender, seq } requises');
  const { sender, seq } = o;
  const ts = o.ts === undefined ? Date.now() : o.ts;
  if (typeof sender !== 'string' || !SENDER_RE.test(sender)) throw new ProtocolError('bad-argument', 'sender invalide');
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) throw new ProtocolError('bad-argument', 'seq invalide (uint32)');
  if (!Number.isInteger(ts) || ts < 0 || ts > MAX_TS) throw new ProtocolError('bad-argument', 'ts invalide');
  return { sender, seq, ts };
}

/**
 * @param {{ kind: number, sender: string, seq: number, ts: number,
 *           mediaId?: string, index?: number, total?: number }} h
 */
function writeHeader(h) {
  const sender = asciiBytes(h.sender);
  /** @type {Uint8Array} */
  let tail;
  if (h.kind === FRAME_KIND.MESSAGE || h.kind === FRAME_KIND.PAIRWISE) {
    tail = new Uint8Array(0);
  } else {
    const id = asciiBytes(/** @type {string} */ (h.mediaId));
    const idx = /** @type {number} */ (h.index);
    const tot = /** @type {number} */ (h.total);
    tail = concatBytes(Uint8Array.of(id.length), id, Uint8Array.of(idx >> 8, idx & 255, tot >> 8, tot & 255));
  }
  const out = new Uint8Array(3 + sender.length + 10 + tail.length);
  let o = 0;
  out[o++] = FRAME_VERSION;
  out[o++] = h.kind;
  out[o++] = sender.length;
  out.set(sender, o);
  o += sender.length;
  out[o++] = (h.seq >>> 24) & 255;
  out[o++] = (h.seq >>> 16) & 255;
  out[o++] = (h.seq >>> 8) & 255;
  out[o++] = h.seq & 255;
  const hi = Math.floor(h.ts / 2 ** 32);
  const lo = h.ts % 2 ** 32;
  out[o++] = (hi >>> 8) & 255;
  out[o++] = hi & 255;
  out[o++] = (lo >>> 24) & 255;
  out[o++] = (lo >>> 16) & 255;
  out[o++] = (lo >>> 8) & 255;
  out[o++] = lo & 255;
  out.set(tail, o);
  return out;
}

/**
 * @param {Uint8Array} b
 * @returns {FrameHeader}
 */
function readHeader(b) {
  const bad = (/** @type {string} */ why) => new ProtocolError('malformed', why);
  if (b.length < 3) throw bad('trame trop courte');
  const version = b[0];
  if (version !== FRAME_VERSION) throw new ProtocolError('version', `version de trame ${version} non supportée`);
  const kind = b[1];
  if (kind !== FRAME_KIND.MESSAGE && kind !== FRAME_KIND.CHUNK && kind !== FRAME_KIND.PAIRWISE) throw bad('type de trame inconnu');
  const sLen = b[2];
  if (sLen < 1 || sLen > 16) throw bad('longueur d’émetteur invalide');
  let o = 3;
  const need = (/** @type {number} */ n) => { if (o + n > b.length) throw bad('en-tête tronqué'); };
  need(sLen + 10);
  const sender = asciiString(b.subarray(o, o + sLen));
  if (!SENDER_RE.test(sender)) throw bad('émetteur invalide');
  o += sLen;
  const seq = ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  o += 4;
  const ts = (b[o] * 256 + b[o + 1]) * 2 ** 32 + ((b[o + 2] << 24) >>> 0) + (b[o + 3] << 16) + (b[o + 4] << 8) + b[o + 5];
  o += 6;
  /** @type {FrameHeader} */
  const h = { version, kind, sender, seq, ts, headerLength: 0 };
  if (kind === FRAME_KIND.CHUNK) {
    need(1);
    const len = b[o++];
    if (len < 1 || len > 64) throw bad('longueur de mediaId invalide');
    need(len + 4);
    const mediaId = asciiString(b.subarray(o, o + len));
    if (!MEDIA_ID_RE.test(mediaId)) throw bad('mediaId invalide');
    o += len;
    const index = (b[o] << 8) | b[o + 1];
    const total = (b[o + 2] << 8) | b[o + 3];
    o += 4;
    if (total < 1 || total > MAX_CHUNKS) throw new ProtocolError('too-large', 'nombre de fragments hors plafond');
    if (index >= total) throw bad('index de fragment hors bornes');
    h.mediaId = mediaId;
    h.index = index;
    h.total = total;
  }
  h.headerLength = o;
  if (b.length < o + IV_BYTES + TAG_BYTES) throw bad('trame trop courte');
  return h;
}

/**
 * Lit l'en-tête (authentifié seulement après open/openChunk !) sans
 * déchiffrer : utile pour router (message / fragment) et écarter ses
 * propres échos. Ne JAMAIS se fier à ces valeurs avant authentification.
 *
 * @param {string} str
 * @returns {Omit<FrameHeader, 'headerLength'>}
 */
export function peekFrame(str) {
  if (typeof str !== 'string') throw new ProtocolError('malformed', 'chaîne attendue');
  if (str.length > MAX_FRAME_CHARS) throw new ProtocolError('too-large', 'trame trop longue');
  // Décoder seulement le début suffit pour l'en-tête (≤ 98 octets).
  const prefix = str.slice(0, Math.min(str.length, 4 * Math.ceil((MAX_HEADER_BYTES + IV_BYTES + TAG_BYTES) / 3)));
  const usable = prefix.length === str.length ? prefix : prefix.slice(0, prefix.length - (prefix.length % 4));
  const h = readHeader(b64uToBytes(usable));
  const { headerLength, ...pub } = h;
  return pub;
}

// ─────────────────────────── Anti-rejeu ───────────────────────────

/**
 * Fenêtre glissante par émetteur (à la IPsec/DTLS) + tolérance d'horloge.
 *
 *  - un (sender, seq) déjà accepté est refusé ('replay') ;
 *  - un seq plus vieux que `windowSize` derrière le plus grand vu est refusé ;
 *  - un horodatage à plus de `maxSkewMs` de l'horloge locale est refusé
 *    ('stale') : protège contre le rejeu d'enregistrements anciens auprès
 *    d'un récepteur qui vient de redémarrer (état vide).
 *
 * L'état n'est modifié qu'APRÈS authentification : une trame forgée avec un
 * seq énorme ne peut donc pas « empoisonner » la fenêtre.
 */
export class ReplayState {
  /**
   * @param {{ windowSize?: number, maxSkewMs?: number, maxSenders?: number, now?: () => number }} [opts]
   */
  constructor(opts = {}) {
    const windowSize = opts.windowSize ?? DEFAULT_REPLAY_WINDOW;
    if (!Number.isInteger(windowSize) || windowSize < 32 || windowSize > 65536 || windowSize % 32 !== 0) {
      throw new ProtocolError('bad-argument', 'windowSize : multiple de 32 entre 32 et 65536');
    }
    this.windowSize = windowSize;
    this.maxSkewMs = opts.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
    this.maxSenders = opts.maxSenders ?? DEFAULT_MAX_SENDERS;
    this.now = opts.now ?? (() => Date.now());
    /** @type {Map<string, { max: number, bits: Uint32Array }>} */
    this.senders = new Map();
  }

  /**
   * Vérifie sans modifier l'état. Lève ProtocolError('replay' | 'stale').
   * @param {string} sender @param {number} seq @param {number} ts
   */
  check(sender, seq, ts) {
    if (this.maxSkewMs !== Infinity && Math.abs(this.now() - ts) > this.maxSkewMs) {
      throw new ProtocolError('stale', 'horodatage hors tolérance (horloge désynchronisée ou rejeu)');
    }
    const st = this.senders.get(sender);
    if (!st || seq > st.max) return;
    if (st.max - seq >= this.windowSize) throw new ProtocolError('replay', 'séquence trop ancienne');
    const pos = seq % this.windowSize;
    if (st.bits[pos >>> 5] & (1 << (pos & 31))) throw new ProtocolError('replay', 'séquence déjà reçue');
  }

  /**
   * Vérifie puis enregistre, de façon synchrone (donc atomique en JS).
   * @param {string} sender @param {number} seq @param {number} ts
   */
  accept(sender, seq, ts) {
    this.check(sender, seq, ts);
    let st = this.senders.get(sender);
    if (st) {
      // LRU : réinsertion en fin de Map
      this.senders.delete(sender);
    } else {
      if (this.senders.size >= this.maxSenders) {
        const oldest = this.senders.keys().next().value;
        if (oldest !== undefined) this.senders.delete(oldest);
      }
      st = { max: seq, bits: new Uint32Array(this.windowSize / 32) };
    }
    this.senders.set(sender, st);
    if (seq > st.max) {
      const shift = seq - st.max;
      if (shift >= this.windowSize) {
        st.bits.fill(0);
      } else {
        for (let s = st.max + 1; s <= seq; s++) {
          const p = s % this.windowSize;
          st.bits[p >>> 5] &= ~(1 << (p & 31));
        }
      }
      st.max = seq;
    }
    const pos = seq % this.windowSize;
    st.bits[pos >>> 5] |= 1 << (pos & 31);
  }
}

/**
 * @param {ConstructorParameters<typeof ReplayState>[0]} [opts]
 */
export function createReplayState(opts) {
  return new ReplayState(opts);
}

// ─────────────────────────── Chiffrement ───────────────────────────

/**
 * @param {Uint8Array} header @param {Uint8Array} plaintext @param {CryptoKey} key
 */
async function encryptFrame(header, plaintext, key) {
  if (!key || typeof key !== 'object') throw new ProtocolError('bad-argument', 'clé AES-GCM attendue');
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: header, tagLength: 128 }, key, exactBytes(plaintext)),
  );
  return bytesToB64u(concatBytes(header, iv, ct));
}

/**
 * @param {string} str @param {CryptoKey} key
 * @param {ReplayState | null | undefined} replayState @param {number} expectedKind
 */
async function decryptFrame(str, key, replayState, expectedKind) {
  if (replayState === undefined) {
    throw new ProtocolError('bad-argument', 'replayState requis (passer null pour désactiver explicitement)');
  }
  if (!key || typeof key !== 'object') throw new ProtocolError('bad-argument', 'clé AES-GCM attendue');
  if (typeof str !== 'string') throw new ProtocolError('malformed', 'chaîne attendue');
  if (str.length > MAX_FRAME_CHARS) throw new ProtocolError('too-large', 'trame trop longue');
  const bytes = b64uToBytes(str);
  const h = readHeader(bytes);
  if (h.kind !== expectedKind) {
    throw new ProtocolError('kind', `trame de type ${h.kind} reçue au lieu de ${expectedKind}`);
  }
  // Rejet précoce (sans coût de déchiffrement), revérifié dans accept().
  if (replayState) replayState.check(h.sender, h.seq, h.ts);
  const hl = h.headerLength;
  /** @type {Uint8Array} */
  let pt;
  try {
    pt = new Uint8Array(
      await subtle().decrypt(
        {
          name: 'AES-GCM',
          iv: bytes.slice(hl, hl + IV_BYTES),
          additionalData: bytes.slice(0, hl),
          tagLength: 128,
        },
        key,
        bytes.slice(hl + IV_BYTES),
      ),
    );
  } catch (_) {
    throw new ProtocolError('auth', 'authentification AES-GCM échouée');
  }
  if (replayState) replayState.accept(h.sender, h.seq, h.ts);
  return { h, pt };
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** @param {unknown} v */
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Chiffre un message JSON, `type` compris : seuls l'émetteur, la séquence et
 * l'horodatage restent visibles (en clair mais authentifiés).
 *
 * @param {{ type: string, [k: string]: unknown }} obj
 * @param {CryptoKey} key  clé du SENS d'émission (keys.r2s ou keys.s2r)
 * @param {{ sender: string, seq: number, ts?: number }} opts
 * @returns {Promise<string>}
 */
export async function seal(obj, key, opts) {
  return sealJson(obj, key, opts, FRAME_KIND.MESSAGE);
}

/**
 * Comme seal(), pour une clé PAR ÉCRAN (pairwise.js) : trame de type 0x03.
 * Le type de trame est dans l'AAD : une trame pairwise ne s'ouvre jamais avec
 * open() (et une trame de session jamais avec openPairwise()), même si l'on
 * se trompait de clé.
 *
 * @param {{ type: string, [k: string]: unknown }} obj
 * @param {CryptoKey} key  clé pairwise du SENS d'émission
 * @param {{ sender: string, seq: number, ts?: number }} opts
 * @returns {Promise<string>}
 */
export async function sealPairwise(obj, key, opts) {
  return sealJson(obj, key, opts, FRAME_KIND.PAIRWISE);
}

/**
 * @param {{ type: string, [k: string]: unknown }} obj @param {CryptoKey} key
 * @param {{ sender: string, seq: number, ts?: number }} opts @param {number} kind
 */
async function sealJson(obj, key, opts, kind) {
  const { sender, seq, ts } = checkSenderSeqTs(opts);
  if (!isPlainObject(obj) || typeof obj.type !== 'string' || !TYPE_RE.test(obj.type)) {
    throw new ProtocolError('bad-argument', 'objet { type } attendu');
  }
  /** @type {string} */
  let json;
  try {
    json = JSON.stringify(obj);
  } catch (_) {
    throw new ProtocolError('bad-argument', 'message non sérialisable en JSON');
  }
  const pt = utf8Encode(json);
  if (pt.length > MAX_MESSAGE_BYTES) throw new ProtocolError('too-large', `message > ${MAX_MESSAGE_BYTES} octets`);
  const header = writeHeader({ kind, sender, seq, ts });
  return encryptFrame(header, pt, key);
}

/**
 * Déchiffre et authentifie un message. Lève ProtocolError en cas de
 * falsification, mauvaise clé/mauvais sens ('auth'), rejeu ('replay'),
 * horodatage hors tolérance ('stale') ou contenu illisible ('malformed').
 *
 * ⚠ open() garantit l'origine (un détenteur de la clé) et la fraîcheur, pas
 * la validité métier : appeler ensuite validate() de schema.js.
 *
 * @param {string} str
 * @param {CryptoKey} key  clé du sens de RÉCEPTION
 * @param {ReplayState | null} replayState  null = sans anti-rejeu (déconseillé)
 * @returns {Promise<{ type: string, [k: string]: unknown }>}
 */
export async function open(str, key, replayState) {
  return openJson(str, key, replayState, FRAME_KIND.MESSAGE);
}

/**
 * Comme open(), pour une trame scellée avec une clé PAR ÉCRAN (type 0x03).
 *
 * @param {string} str
 * @param {CryptoKey} key  clé pairwise du sens de RÉCEPTION
 * @param {ReplayState | null} replayState
 * @returns {Promise<{ type: string, [k: string]: unknown }>}
 */
export async function openPairwise(str, key, replayState) {
  return openJson(str, key, replayState, FRAME_KIND.PAIRWISE);
}

/**
 * @param {string} str @param {CryptoKey} key @param {ReplayState | null} replayState @param {number} kind
 * @returns {Promise<{ type: string, [k: string]: unknown }>}
 */
async function openJson(str, key, replayState, kind) {
  const { pt } = await decryptFrame(str, key, replayState, kind);
  if (pt.length > MAX_MESSAGE_BYTES) throw new ProtocolError('too-large', 'message trop long');
  /** @type {unknown} */
  let body;
  try {
    body = JSON.parse(utf8Decode(pt), (k, v) => {
      if (FORBIDDEN_KEYS.has(k)) throw new ProtocolError('malformed', `clé interdite « ${k} »`);
      return v;
    });
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError('malformed', 'JSON invalide');
  }
  const m = /** @type {Record<string, unknown>} */ (body);
  if (!isPlainObject(body) || typeof m.type !== 'string' || !TYPE_RE.test(m.type)) {
    throw new ProtocolError('malformed', 'corps de message invalide');
  }
  return /** @type {{ type: string, [k: string]: unknown }} */ (m);
}

// ─────────────────────────── Fragments de média ───────────────────────────

/**
 * @param {Uint8Array | ArrayBuffer} data
 */
function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new ProtocolError('bad-argument', 'Uint8Array ou ArrayBuffer attendu');
}

/**
 * Chiffre un fragment binaire. mediaId, index et total sont liés par l'AAD :
 * un fragment ne peut être ni déplacé dans un autre média, ni renuméroté.
 *
 * @param {Uint8Array | ArrayBuffer} data  ≤ MAX_CHUNK_BYTES
 * @param {CryptoKey} key
 * @param {{ sender: string, seq: number, ts?: number, mediaId: string, index: number, total: number }} opts
 * @returns {Promise<string>}
 */
export async function sealChunk(data, key, opts) {
  const { sender, seq, ts } = checkSenderSeqTs(opts);
  const bytes = toBytes(data);
  const { mediaId, index, total } = opts;
  if (bytes.length > MAX_CHUNK_BYTES) throw new ProtocolError('too-large', `fragment > ${MAX_CHUNK_BYTES} octets`);
  if (typeof mediaId !== 'string' || !MEDIA_ID_RE.test(mediaId)) throw new ProtocolError('bad-argument', 'mediaId invalide');
  if (!Number.isInteger(total) || total < 1) throw new ProtocolError('bad-argument', 'total invalide');
  if (total > MAX_CHUNKS) throw new ProtocolError('too-large', `plus de ${MAX_CHUNKS} fragments`);
  if (!Number.isInteger(index) || index < 0 || index >= total) throw new ProtocolError('bad-argument', 'index invalide');
  const header = writeHeader({ kind: FRAME_KIND.CHUNK, sender, seq, ts, mediaId, index, total });
  return encryptFrame(header, bytes, key);
}

/**
 * @typedef {{ mediaId: string, index: number, total: number, data: Uint8Array,
 *             sender: string, seq: number, ts: number }} OpenedChunk
 */

/**
 * @param {string} str
 * @param {CryptoKey} key
 * @param {ReplayState | null} replayState
 * @returns {Promise<OpenedChunk>}
 */
export async function openChunk(str, key, replayState) {
  const { h, pt } = await decryptFrame(str, key, replayState, FRAME_KIND.CHUNK);
  if (pt.length > MAX_CHUNK_BYTES) throw new ProtocolError('too-large', 'fragment trop long');
  return {
    mediaId: /** @type {string} */ (h.mediaId),
    index: /** @type {number} */ (h.index),
    total: /** @type {number} */ (h.total),
    data: pt,
    sender: h.sender,
    seq: h.seq,
    ts: h.ts,
  };
}

/**
 * Découpe un média en fragments (vues sans copie).
 * @param {Uint8Array | ArrayBuffer} data
 * @param {number} [chunkSize]
 * @returns {Uint8Array[]}
 */
export function splitIntoChunks(data, chunkSize = MAX_CHUNK_BYTES) {
  const bytes = toBytes(data);
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_BYTES) {
    throw new ProtocolError('bad-argument', 'taille de fragment invalide');
  }
  const total = Math.max(1, Math.ceil(bytes.length / chunkSize));
  if (total > MAX_CHUNKS) throw new ProtocolError('too-large', `média > ${MAX_CHUNKS} fragments`);
  const out = [];
  for (let i = 0; i < total; i++) out.push(bytes.subarray(i * chunkSize, (i + 1) * chunkSize));
  return out;
}

/**
 * Réassemblage borné des fragments déjà authentifiés (openChunk).
 *
 * Par défaut (requireExpected: true), seuls les médias annoncés via
 * expect(mediaId, total) — typiquement à réception d'un media:upload qui
 * NOUS était adressé — sont réassemblés : en multi-écran, un écran non visé
 * ignore les fragments qui transitent sur le topic commun, et la mémoire
 * reste bornée aux transferts acceptés.
 *
 * @param {{ maxParallel?: number, maxTotalBytes?: number, requireExpected?: boolean }} [opts]
 */
export function createChunkAssembler(opts = {}) {
  const maxParallel = opts.maxParallel ?? 4;
  const maxTotalBytes = opts.maxTotalBytes ?? MAX_CHUNKS * MAX_CHUNK_BYTES;
  const requireExpected = opts.requireExpected ?? true;
  /** @type {Map<string, { total: number, parts: (Uint8Array|undefined)[], got: number, bytes: number }>} */
  const pending = new Map();
  /** @param {string} mediaId @param {number} total */
  const startEntry = (mediaId, total) => {
    pending.delete(mediaId);
    if (pending.size >= maxParallel) {
      const oldest = pending.keys().next().value;
      if (oldest !== undefined) pending.delete(oldest);
    }
    const e = { total, parts: new Array(total), got: 0, bytes: 0 };
    pending.set(mediaId, e);
    return e;
  };
  return {
    /**
     * Annonce un transfert (remet à zéro un éventuel transfert du même id).
     * @param {string} mediaId @param {number} total
     */
    expect(mediaId, total) {
      if (typeof mediaId !== 'string' || !MEDIA_ID_RE.test(mediaId)) throw new ProtocolError('bad-argument', 'mediaId invalide');
      if (!Number.isInteger(total) || total < 1 || total > MAX_CHUNKS) throw new ProtocolError('too-large', 'total hors plafond');
      startEntry(mediaId, total);
    },
    /**
     * Ajoute un fragment ; renvoie le média complet (Uint8Array) ou null.
     * @param {{ mediaId: string, index: number, total: number, data: Uint8Array }} c
     */
    add(c) {
      let e = pending.get(c.mediaId);
      if (!e && requireExpected) return null; // transfert non annoncé / pas pour nous
      if (e && e.total !== c.total) {
        if (requireExpected) return null; // incohérent avec l'annonce
        e = undefined; // nouvel envoi du même média (taille différente)
      }
      if (!e) e = startEntry(c.mediaId, c.total);
      if (e.parts[c.index] !== undefined) return null; // doublon (renvoi)
      if (e.bytes + c.data.length > maxTotalBytes) {
        pending.delete(c.mediaId);
        throw new ProtocolError('too-large', 'média réassemblé trop volumineux');
      }
      e.parts[c.index] = c.data;
      e.got++;
      e.bytes += c.data.length;
      if (e.got < e.total) return null;
      pending.delete(c.mediaId);
      return concatBytes(.../** @type {Uint8Array[]} */ (e.parts));
    },
    /**
     * Indices manquants (pour redemander les fragments perdus).
     * @param {string} mediaId @param {number} [limit]
     */
    missing(mediaId, limit = 400) {
      const e = pending.get(mediaId);
      if (!e) return [];
      const out = [];
      for (let i = 0; i < e.total && out.length < limit; i++) if (e.parts[i] === undefined) out.push(i);
      return out;
    },
    /** @param {string} mediaId */
    drop(mediaId) {
      pending.delete(mediaId);
    },
    get size() {
      return pending.size;
    },
  };
}
