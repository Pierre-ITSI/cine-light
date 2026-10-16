// ════════════════════════════════════════════════════════════════════════════
// Format sur le fil des liaisons hors ligne, version 1 : IMPLÉMENTATION DE
// RÉFÉRENCE en TypeScript. L'app ne l'exécute pas (index.ts ne l'exporte pas :
// rien n'entre dans le bundle) ; le natif l'implémente à l'identique
// (ios/LinkWire.swift, android/…/LinkWire.kt). Elle sert de spécification
// exécutable : tests Node (test/wire.test.mjs) et vecteurs rejoués contre le
// Kotlin compilé. Spécification rédigée : docs/OFFLINE-NATIVE.md § 4.
//
// Couches :
//   message   [kind u8][corps]              HELLO, AUTH, DATA, PING
//   Wi-Fi     [longueur u32 BE][message]    un flux TCP par pair
//   Bluetooth [frameId u8][index u16 BE][count u16 BE][morceau]
//             un message découpé selon le MTU, une valeur GATT par fragment
//
// Poignée de main (identique sur les deux liaisons) : chaque côté envoie HELLO
// dès que le canal est prêt ; à réception du HELLO de l'autre, il envoie AUTH ;
// il ADMET le pair quand l'AUTH reçu est vérifié. Rien d'autre que HELLO, AUTH
// et PING n'est accepté avant ; un pair non admis en 5 s est déconnecté.
//   AUTH = HMAC-SHA256(authKey, "SRL1" ‖ rôle de l'émetteur ‖ nonce du
//          destinataire ‖ nonce de l'émetteur)
// Le rôle dans le MAC empêche de renvoyer à la télécommande son propre AUTH.
// Ce n'est PAS la sécurité des trames (chiffrées et authentifiées de bout en
// bout par la vue web) : c'est un filtre qui écarte, avant d'occuper une place
// de pair ou la file de réception, tout appareil qui ne connaît pas le topic.
// ════════════════════════════════════════════════════════════════════════════

import { MAX_FRAME_BYTES, MAX_NAME_BYTES, MAX_NAME_CHARS, ROOM_TAG_BYTES } from './bridge.ts';
import { hmacSha256, utf8Encode } from './sha256.ts';

export const WIRE_VERSION = 1;

// Découverte
export const SERVICE_TYPE = '_setremote._tcp';
export const TXT_ROOM_KEY = 'r';
export const TXT_VERSION_KEY = 'v';
/** Service GATT SetRemote (128 bits, propre au projet). */
export const BLE_SERVICE_UUID = 'ca098d33-dca0-45ed-8875-d0da84ef2400';
/** Caractéristique écrite par la télécommande (central → écran) : write + write without response. */
export const BLE_RX_UUID = 'ca098d33-dca0-45ed-8875-d0da84ef2401';
/** Caractéristique notifiée par l'écran (écran → central) : notify. */
export const BLE_TX_UUID = 'ca098d33-dca0-45ed-8875-d0da84ef2402';
/** Nom local annoncé par un écran iOS : « SR » + roomTag hexadécimal (18 caractères). */
export const BLE_NAME_PREFIX = 'SR';
/** Données de service annoncées par un écran Android (réponse au scan) : [version][roomTag]. */
export const BLE_SERVICE_DATA_BYTES = 1 + ROOM_TAG_BYTES;

// Messages
export const KIND_HELLO = 0x01;
export const KIND_AUTH = 0x02;
export const KIND_DATA = 0x03;
export const KIND_PING = 0x04;
export const ROLE_REMOTE = 0x52; // 'R'
export const ROLE_SCREEN = 0x53; // 'S'
export const NONCE_BYTES = 16;
export const MAC_BYTES = 32;
export const MAC_CONTEXT = 'SRL1';
/** HELLO = kind, version, rôle, roomTag (8), nonce (16), longueur du nom (1) + nom. */
export const HELLO_FIXED_BYTES = 1 + 1 + 1 + ROOM_TAG_BYTES + NONCE_BYTES + 1;
export const HELLO_MAX_BYTES = HELLO_FIXED_BYTES + MAX_NAME_BYTES;
export const AUTH_BYTES = 1 + MAC_BYTES;
/** Message le plus long admis avant admission (HELLO maximal arrondi). */
export const PREAUTH_MAX_MESSAGE = 160;
/** Wi-Fi : octets reçus au plus avant admission (en-têtes compris). */
export const PREAUTH_MAX_BYTES = 256;
export const LAN_MAX_MESSAGE = 1 + MAX_FRAME_BYTES.lan;
export const BLE_MAX_MESSAGE = 1 + MAX_FRAME_BYTES.ble;
export const LAN_HEADER_BYTES = 4;

// Fragmentation Bluetooth
export const FRAG_HEADER_BYTES = 5;
/** ATT : une valeur fait au plus 512 octets, quel que soit le MTU. */
export const MAX_ATT_VALUE = 512;
/** MTU minimal (23) − 3 = 20 octets par valeur ; 4 097 octets / 15 = 274 fragments. */
export const MAX_FRAGMENTS = 512;
export const REASSEMBLY_TIMEOUT_MS = 5000;
export const MAX_PARTIALS = 4;

// Temps
export const HANDSHAKE_TIMEOUT_MS = 5000;
export const KEEPALIVE_MS = 5000;
export const DEAD_AFTER_MS = 15000;

export type Role = 'remote' | 'screen';
const roleByte = (r: Role) => (r === 'remote' ? ROLE_REMOTE : ROLE_SCREEN);
const ASCII = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; // temps constant
  return d === 0;
}

/** Tronque un UTF-8 à `max` octets sans couper un caractère. */
export function truncateUtf8(bytes: Uint8Array, max: number): Uint8Array {
  if (bytes.length <= max) return bytes;
  let end = max;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--; // pas au milieu d'une séquence
  return bytes.subarray(0, end);
}

/** Nom reçu : UTF-8 tolérant, sans caractère de contrôle, 64 caractères au plus. */
export function sanitizeName(bytes: Uint8Array): string {
  const s = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return Array.from(s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim()).slice(0, MAX_NAME_CHARS).join('');
}

// ───────────────────────────── messages ─────────────────────────────

export interface Hello {
  role: Role;
  roomTag: Uint8Array;
  nonce: Uint8Array;
  name: string;
}

export function encodeHello(h: Hello): Uint8Array {
  const name = truncateUtf8(utf8Encode(h.name), MAX_NAME_BYTES);
  return concat(Uint8Array.of(KIND_HELLO, WIRE_VERSION, roleByte(h.role)), h.roomTag, h.nonce, Uint8Array.of(name.length), name);
}

/** HELLO strict : longueur exacte, version 1, rôle connu. Sinon null. */
export function decodeHello(m: Uint8Array): Hello | null {
  if (m.length < HELLO_FIXED_BYTES || m.length > HELLO_MAX_BYTES || m[0] !== KIND_HELLO || m[1] !== WIRE_VERSION) return null;
  const role = m[2] === ROLE_REMOTE ? 'remote' : m[2] === ROLE_SCREEN ? 'screen' : null;
  if (!role) return null;
  const nameLen = m[HELLO_FIXED_BYTES - 1];
  if (nameLen > MAX_NAME_BYTES || m.length !== HELLO_FIXED_BYTES + nameLen) return null;
  return {
    role,
    roomTag: m.slice(3, 3 + ROOM_TAG_BYTES),
    nonce: m.slice(3 + ROOM_TAG_BYTES, 3 + ROOM_TAG_BYTES + NONCE_BYTES),
    name: sanitizeName(m.subarray(HELLO_FIXED_BYTES)),
  };
}

/** HMAC-SHA256(authKey, "SRL1" ‖ rôle émetteur ‖ nonce destinataire ‖ nonce émetteur). */
export function authMac(key: Uint8Array, sender: Role, receiverNonce: Uint8Array, senderNonce: Uint8Array): Uint8Array {
  return hmacSha256(key, concat(ASCII(MAC_CONTEXT), Uint8Array.of(roleByte(sender)), receiverNonce, senderNonce));
}

export const encodeAuth = (mac: Uint8Array) => concat(Uint8Array.of(KIND_AUTH), mac);
export const encodeData = (frame: string) => concat(Uint8Array.of(KIND_DATA), utf8Encode(frame));
export const encodePing = () => Uint8Array.of(KIND_PING);

// ───────────────────────────── poignée de main ─────────────────────────────

export interface HandshakeOptions {
  role: Role;
  roomTag: Uint8Array;
  authKey: Uint8Array;
  nonce: Uint8Array;
  name: string;
}

export interface HandshakeEvent {
  /** Messages à envoyer au pair, dans l'ordre. */
  send?: Uint8Array[];
  /** Le pair vient d'être admis, avec son nom (éventuellement vide). */
  admitted?: { name: string };
  /** Trame reçue d'un pair admis. */
  data?: string;
  /** Violation : fermer la connexion. */
  error?: 'hello' | 'role' | 'room' | 'auth' | 'unauthenticated' | 'protocol' | 'empty';
}

/**
 * Machine d'état d'une connexion (un pair), identique côté télécommande et
 * côté écran. Natif : LinkWire.swift / LinkWire.kt, classe Handshake.
 */
export class Handshake {
  private readonly o: HandshakeOptions;
  private peerNonce: Uint8Array | null = null;
  private peerName = '';
  private state: 'wait-hello' | 'wait-auth' | 'open' | 'closed' = 'wait-hello';
  private helloSent = false;

  constructor(options: HandshakeOptions) {
    this.o = options;
  }

  get admitted(): boolean { return this.state === 'open'; }

  /** HELLO à envoyer dès que le canal est prêt (une seule fois). */
  hello(): Uint8Array {
    this.helloSent = true;
    return encodeHello({ role: this.o.role, roomTag: this.o.roomTag, nonce: this.o.nonce, name: this.o.name });
  }

  private fail(error: NonNullable<HandshakeEvent['error']>): HandshakeEvent {
    this.state = 'closed';
    return { error };
  }

  receive(m: Uint8Array): HandshakeEvent {
    if (this.state === 'closed') return { error: 'protocol' };
    if (m.length === 0) return this.fail('empty');
    const kind = m[0];
    if (kind === KIND_PING) return {};
    if (this.state === 'wait-hello') {
      if (kind !== KIND_HELLO) return this.fail(kind === KIND_DATA ? 'unauthenticated' : 'hello');
      const h = decodeHello(m);
      if (!h) return this.fail('hello');
      if (h.role === this.o.role) return this.fail('role');
      if (!equalBytes(h.roomTag, this.o.roomTag)) return this.fail('room');
      this.peerNonce = h.nonce;
      this.peerName = h.name;
      this.state = 'wait-auth';
      const auth = encodeAuth(authMac(this.o.authKey, this.o.role, h.nonce, this.o.nonce));
      // Le pair attend notre HELLO avant notre AUTH : s'il n'est pas encore
      // parti (canal prêt d'un seul côté), il part maintenant, en premier.
      return { send: this.helloSent ? [auth] : [this.hello(), auth] };
    }
    if (this.state === 'wait-auth') {
      if (kind !== KIND_AUTH || m.length !== AUTH_BYTES) return this.fail(kind === KIND_DATA ? 'unauthenticated' : 'auth');
      const peerRole: Role = this.o.role === 'remote' ? 'screen' : 'remote';
      const expected = authMac(this.o.authKey, peerRole, this.o.nonce, this.peerNonce!);
      if (!equalBytes(m.subarray(1), expected)) return this.fail('auth');
      this.state = 'open';
      return { admitted: { name: this.peerName } };
    }
    // open
    if (kind === KIND_DATA) {
      if (m.length < 2) return {}; // trame vide : ignorée
      return { data: new TextDecoder('utf-8', { fatal: false }).decode(m.subarray(1)) };
    }
    if (kind === KIND_HELLO || kind === KIND_AUTH) return this.fail('protocol');
    return {}; // type inconnu après admission : ignoré (extensions futures)
  }
}

// ───────────────────────────── Wi-Fi : enregistrements ─────────────────────────────

export function lanRecord(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(LAN_HEADER_BYTES + message.length);
  new DataView(out.buffer).setUint32(0, message.length);
  out.set(message, LAN_HEADER_BYTES);
  return out;
}

export type LanReadResult = { message: Uint8Array } | { error: 'empty' | 'too-large' | 'preauth-overflow' } | null;

/**
 * Lecture d'un flux TCP, un enregistrement à la fois. Avant admission : messages
 * de PREAUTH_MAX_MESSAGE octets au plus et PREAUTH_MAX_BYTES octets en tout ;
 * après : LAN_MAX_MESSAGE. La longueur est vérifiée AVANT d'attendre le corps :
 * un en-tête annonçant 4 Go ferme la connexion sans rien allouer.
 */
export class LanReader {
  admitted = false;
  private buf: Uint8Array = new Uint8Array(0);
  private preauthBytes = 0;

  push(chunk: Uint8Array): void {
    if (!this.admitted) this.preauthBytes += chunk.length;
    this.buf = concat(this.buf, chunk);
  }

  next(): LanReadResult {
    if (!this.admitted && this.preauthBytes > PREAUTH_MAX_BYTES) return { error: 'preauth-overflow' };
    if (this.buf.length < LAN_HEADER_BYTES) return null;
    const len = new DataView(this.buf.buffer, this.buf.byteOffset).getUint32(0);
    if (len === 0) return { error: 'empty' };
    if (len > (this.admitted ? LAN_MAX_MESSAGE : PREAUTH_MAX_MESSAGE)) return { error: 'too-large' };
    if (this.buf.length < LAN_HEADER_BYTES + len) return null;
    const message = this.buf.slice(LAN_HEADER_BYTES, LAN_HEADER_BYTES + len);
    this.buf = this.buf.slice(LAN_HEADER_BYTES + len);
    return { message };
  }
}

// ───────────────────────────── Bluetooth : fragmentation ─────────────────────────────

/**
 * Découpe un message en valeurs GATT d'au plus `maxValue` octets (MTU − 3,
 * plafonné à 512). frameId : compteur 8 bits propre à chaque pair et sens.
 */
export function fragment(message: Uint8Array, frameId: number, maxValue: number): Uint8Array[] {
  const chunk = Math.min(maxValue, MAX_ATT_VALUE) - FRAG_HEADER_BYTES;
  if (message.length === 0 || chunk < 1) throw new Error('fragmentation impossible');
  const count = Math.ceil(message.length / chunk);
  if (count > MAX_FRAGMENTS) throw new Error('trop de fragments');
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const part = message.subarray(i * chunk, Math.min(message.length, (i + 1) * chunk));
    const p = new Uint8Array(FRAG_HEADER_BYTES + part.length);
    p[0] = frameId & 0xff;
    p[1] = i >> 8; p[2] = i & 0xff;
    p[3] = count >> 8; p[4] = count & 0xff;
    p.set(part, FRAG_HEADER_BYTES);
    out.push(p);
  }
  return out;
}

export type ReassemblyResult = { message: Uint8Array } | { error: 'short' | 'header' | 'too-large' } | null;

interface PartialMessage {
  count: number;
  parts: (Uint8Array | undefined)[];
  received: number;
  bytes: number;
  started: number;
}

/**
 * Réassemblage par pair. Tolère le désordre et les doublons (le premier
 * fragment reçu l'emporte). Limites : `maxMessage` octets par message,
 * MAX_PARTIALS messages incomplets à la fois (au-delà, le plus ancien est
 * jeté), REASSEMBLY_TIMEOUT_MS pour compléter un message. Un frameId réutilisé
 * avec un autre `count` remplace le message incomplet.
 */
export class Reassembler {
  private partials = new Map<number, PartialMessage>();
  private readonly timeoutMs: number;
  maxMessage: number;
  dropped = 0;

  constructor(maxMessage: number, timeoutMs = REASSEMBLY_TIMEOUT_MS) {
    this.maxMessage = maxMessage;
    this.timeoutMs = timeoutMs;
  }

  get pending(): number { return this.partials.size; }

  /** Jette les messages incomplets trop vieux. */
  sweep(now: number): void {
    for (const [id, p] of this.partials) {
      if (now - p.started > this.timeoutMs) { this.partials.delete(id); this.dropped++; }
    }
  }

  push(packet: Uint8Array, now: number): ReassemblyResult {
    if (packet.length <= FRAG_HEADER_BYTES) return { error: 'short' };
    const id = packet[0];
    const index = (packet[1] << 8) | packet[2];
    const count = (packet[3] << 8) | packet[4];
    if (count === 0 || count > MAX_FRAGMENTS || index >= count) return { error: 'header' };
    const chunk = packet.subarray(FRAG_HEADER_BYTES);
    this.sweep(now);
    if (count === 1) {
      this.partials.delete(id);
      if (chunk.length > this.maxMessage) return { error: 'too-large' };
      return { message: chunk.slice() };
    }
    let p = this.partials.get(id);
    if (p && p.count !== count) { this.partials.delete(id); this.dropped++; p = undefined; }
    if (!p) {
      if (this.partials.size >= MAX_PARTIALS) {
        let oldest = -1, t = Infinity;
        for (const [k, v] of this.partials) if (v.started < t) { t = v.started; oldest = k; }
        this.partials.delete(oldest);
        this.dropped++;
      }
      p = { count, parts: new Array(count), received: 0, bytes: 0, started: now };
      this.partials.set(id, p);
    }
    if (p.parts[index]) return null; // doublon
    p.bytes += chunk.length;
    if (p.bytes > this.maxMessage) { this.partials.delete(id); this.dropped++; return { error: 'too-large' }; }
    p.parts[index] = chunk.slice();
    p.received++;
    if (p.received < count) return null;
    this.partials.delete(id);
    return { message: concat(...(p.parts as Uint8Array[])) };
  }
}
