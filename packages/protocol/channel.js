// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * Canal sécurisé prêt à l'emploi : assemble deriveSession + seal/open +
 * anti-rejeu + schéma + adressage multi-écran, pour qu'une intégration
 * (index.html, expo-app) n'ait qu'à brancher son transport (MQTT, WebSocket,
 * Wi-Fi local, BLE) sur `seal()` / `receive()`.
 *
 *   const ch = await createSecureChannel({ pairing, role: 'screen', screenId });
 *   transport.subscribe(ch.mqttTopic);
 *   transport.onMessage(async str => {
 *     const r = await ch.receive(str).catch(() => null); // ProtocolError → ignorer
 *     if (r?.kind === 'message') handle(r.message);
 *   });
 *   transport.publish(ch.mqttTopic, await ch.seal({ type: 'caps', ... }));
 */
import { ProtocolError } from './lib/errors.js';
import { randomBytes } from './lib/env.js';
import { bytesToB64u } from './lib/encoding.js';
import {
  FRAME_KIND, MAX_SEQ, createReplayState, deriveSession, newSenderTag, open, openChunk, openPairwise, peekFrame, seal, sealChunk, sealPairwise,
} from './crypto.js';
import { GROUP_ID_RE, SCREEN_ID_RE, explainInvalid, isAddressedTo } from './schema.js';

/** Topic MQTT d'une session : SESSION_TOPIC_PREFIX + session.topic */
export const SESSION_TOPIC_PREFIX = 'setremote/v2/s/';
/** Topic MQTT d'un rendez-vous : RENDEZVOUS_TOPIC_PREFIX + await rendezvousTopic(code) */
export const RENDEZVOUS_TOPIC_PREFIX = 'setremote/v2/rdv/';

/**
 * Identifiant d'écran stable (96 bits, 16 caractères base64url). À tirer au
 * PREMIER lancement et à conserver (localStorage / stockage natif).
 * @returns {string}
 */
export function createScreenId() {
  return bytesToB64u(randomBytes(12));
}

/**
 * @typedef {{
 *   pairing: import('./lib/pairingFormat.js').Pairing,
 *   role: 'remote' | 'screen',
 *   screenId?: string,
 *   groups?: string[],
 *   replay?: ConstructorParameters<typeof import('./crypto.js').ReplayState>[0],
 * }} SecureChannelOptions
 *
 * @typedef {{ r2s: CryptoKey, s2r: CryptoKey }} PairwiseKeys  (pairwiseKeys() de pairwise.js)
 * @typedef {{ keys: PairwiseKeys, tag?: unknown }} PairwiseCandidate
 * @typedef {{ pairwise?: (sender: string) => (PairwiseCandidate[] | null | Promise<PairwiseCandidate[] | null>) }} ReceiveOptions
 *   pairwise : clés pairwise à essayer pour une trame 0x03 de cet émetteur
 *   (écran : la sienne, et celle d'un échange en cours ; télécommande : celle
 *   de l'écran rattaché à l'émetteur). Absent : trames pairwise ignorées.
 *
 * @typedef {null
 *   | { kind: 'message', message: { type: string, [k: string]: unknown }, sender: string }
 *   | { kind: 'pairwise', message: { type: string, [k: string]: unknown }, sender: string, tag: unknown }
 *   | { kind: 'chunk', chunk: import('./crypto.js').OpenedChunk, sender: string }} Received
 */

/**
 * @param {SecureChannelOptions} opts
 */
export async function createSecureChannel(opts) {
  const { role } = opts || /** @type {any} */ ({});
  if (role !== 'remote' && role !== 'screen') throw new ProtocolError('bad-argument', "role : 'remote' | 'screen'");
  const screenId = opts.screenId;
  if (role === 'screen' && (typeof screenId !== 'string' || !SCREEN_ID_RE.test(screenId))) {
    throw new ProtocolError('bad-argument', 'screenId requis pour un écran (createScreenId)');
  }
  /** @param {unknown} g */
  const checkGroups = g => {
    if (!Array.isArray(g) || g.length > 16 || !g.every(x => typeof x === 'string' && GROUP_ID_RE.test(x))) {
      throw new ProtocolError('bad-argument', 'groupes invalides');
    }
    return [...g];
  };
  let groups = checkGroups(opts.groups ?? []);

  const session = await deriveSession(opts.pairing);
  const isRemote = role === 'remote';
  const sender = newSenderTag(isRemote ? 'r' : 's');
  const peerPrefix = isRemote ? 's' : 'r';
  const sendKey = isRemote ? session.keys.r2s : session.keys.s2r;
  const recvKey = isRemote ? session.keys.s2r : session.keys.r2s;
  /** @type {'r2s' | 's2r'} */
  const sendDir = isRemote ? 'r2s' : 's2r';
  /** @type {'r2s' | 's2r'} */
  const recvDir = isRemote ? 's2r' : 'r2s';
  const replay = createReplayState(opts.replay);
  const pairwiseReplay = createReplayState(opts.replay); // trames pairwise : fenêtre distincte
  let seq = 0;
  const nextSeq = () => {
    if (seq > MAX_SEQ) throw new ProtocolError('too-large', 'compteur de séquence épuisé : recréer le canal');
    return seq++;
  };

  return {
    role,
    /** Étiquette d'émetteur de ce lancement (fenêtre anti-rejeu distincte chez les pairs). */
    sender,
    screenId: role === 'screen' ? screenId : undefined,
    /** Identifiant opaque de la session (chemin de relais WebSocket, ACL…). */
    topic: session.topic,
    /** Topic MQTT complet. */
    mqttTopic: SESSION_TOPIC_PREFIX + session.topic,
    /** Preuve facultative à présenter au relais (voir docs/BROKER.md). */
    relayAuth: session.relayAuth,

    /** @param {string[]} g  groupes de cet écran (après un screen:config) */
    setGroups(g) {
      groups = checkGroups(g);
    },
    get groups() {
      return [...groups];
    },

    /**
     * Valide (schéma + sens) puis chiffre un message.
     * @param {{ type: string, [k: string]: unknown }} msg
     * @returns {Promise<string>}
     */
    async seal(msg) {
      const why = explainInvalid(msg, { direction: sendDir, channel: 'session' });
      if (why) throw new ProtocolError('invalid-message', why);
      return seal(msg, sendKey, { sender, seq: nextSeq() });
    },

    /**
     * Valide (schéma : canal pairwise + sens) puis scelle avec une clé PAR
     * ÉCRAN (trame 0x03) : seul le détenteur de cette clé peut l'ouvrir.
     * @param {{ type: string, [k: string]: unknown }} msg
     * @param {PairwiseKeys} keys
     * @returns {Promise<string>}
     */
    async sealPairwise(msg, keys) {
      const why = explainInvalid(msg, { direction: sendDir, channel: 'pairwise' });
      if (why) throw new ProtocolError('invalid-message', why);
      if (!keys || !keys[sendDir]) throw new ProtocolError('bad-argument', 'clés pairwise attendues');
      return sealPairwise(msg, keys[sendDir], { sender, seq: nextSeq() });
    },

    /**
     * @param {Uint8Array | ArrayBuffer} data
     * @param {{ mediaId: string, index: number, total: number }} meta
     * @returns {Promise<string>}
     */
    async sealChunk(data, meta) {
      return sealChunk(data, sendKey, { sender, seq: nextSeq(), mediaId: meta.mediaId, index: meta.index, total: meta.total });
    },

    /**
     * Ouvre une trame reçue.
     *  - null : trame légitimement ignorée (notre écho, trame d'un autre
     *    écran, message adressé à d'autres écrans) ;
     *  - ProtocolError : trame invalide / falsifiée / rejouée → l'ignorer
     *    (éventuellement la compter pour détecter une attaque).
     *
     * Trame pairwise (0x03) : ouverte avec les clés proposées par
     * opts.pairwise ; null si aucune ne convient (trame destinée à un autre
     * écran, ou sans résolveur). Jamais avec la clé de session.
     *
     * @param {string} str
     * @param {ReceiveOptions} [ropts]
     * @returns {Promise<Received>}
     */
    async receive(str, ropts) {
      const h = peekFrame(str);
      if (h.sender === sender) return null;
      if (h.sender[0] !== peerPrefix) return null;
      if (h.kind === FRAME_KIND.PAIRWISE) {
        const cands = ropts && typeof ropts.pairwise === 'function' ? await ropts.pairwise(h.sender) : null;
        for (const c of Array.isArray(cands) ? cands : []) {
          let message;
          try { message = await openPairwise(str, c.keys[recvDir], pairwiseReplay); }
          catch (_) { continue; } // autre clé : trame destinée à un autre écran (ou forgée)
          const why = explainInvalid(message, { direction: recvDir, channel: 'pairwise' });
          if (why) throw new ProtocolError('invalid-message', why);
          return { kind: 'pairwise', message, sender: h.sender, tag: c.tag };
        }
        return null;
      }
      if (h.kind === FRAME_KIND.CHUNK) {
        const chunk = await openChunk(str, recvKey, replay);
        return { kind: 'chunk', chunk, sender: chunk.sender };
      }
      const message = await open(str, recvKey, replay);
      const why = explainInvalid(message, { direction: recvDir, channel: 'session' });
      if (why) throw new ProtocolError('invalid-message', why);
      if (role === 'screen' && !isAddressedTo(message, { screenId: /** @type {string} */ (screenId), groups })) return null;
      return { kind: 'message', message, sender: h.sender };
    },
  };
}
