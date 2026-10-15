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
  FRAME_KIND, MAX_SEQ, createReplayState, deriveSession, newSenderTag, open, openChunk, peekFrame, seal, sealChunk,
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
 * @typedef {null
 *   | { kind: 'message', message: { type: string, [k: string]: unknown }, sender: string }
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
      const why = explainInvalid(msg, { direction: sendDir });
      if (why) throw new ProtocolError('invalid-message', why);
      return seal(msg, sendKey, { sender, seq: nextSeq() });
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
     * @param {string} str
     * @returns {Promise<Received>}
     */
    async receive(str) {
      const h = peekFrame(str);
      if (h.sender === sender) return null;
      if (h.sender[0] !== peerPrefix) return null;
      if (h.kind === FRAME_KIND.CHUNK) {
        const chunk = await openChunk(str, recvKey, replay);
        return { kind: 'chunk', chunk, sender: chunk.sender };
      }
      const message = await open(str, recvKey, replay);
      const why = explainInvalid(message, { direction: recvDir });
      if (why) throw new ProtocolError('invalid-message', why);
      if (role === 'screen' && !isAddressedTo(message, { screenId: /** @type {string} */ (screenId), groups })) return null;
      return { kind: 'message', message, sender: h.sender };
    },
  };
}
