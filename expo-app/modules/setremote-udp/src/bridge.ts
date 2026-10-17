// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// Pont DMX WebView ↔ natif : logique pure, sans React Native.
//
// Contrat (docs/DMX-NATIVE.md § 9, à ne pas modifier sans le côté web) :
//
//   web → natif, JSON via window.ReactNativeWebView.postMessage
//     { type: 'dmx:listen', protocol: 'sacn' | 'artnet', universes: int[], multicast: boolean }
//     { type: 'dmx:stop' }
//     { type: 'udp:send', host: string, port: int, data: base64 }
//     { type: 'net:info' }
//
//   natif → web, par webView.injectJavaScript(nativeScript(message))
//     { type: 'dmx:packets', packets: [{ src: 'ip', port: int, data: base64 }] }
//     { type: 'net:info', interfaces: [{ name, kind: 'ethernet' | 'wifi' | 'other', ip, mask }] }
//     { type: 'dmx:error', reason: string }
//
// Tout ce qui vient de la page est validé ici (le natif revalide) : ports
// 1–65535, au plus 64 univers, datagramme d'au plus 1500 octets, IPv4
// littérale uniquement (jamais de résolution DNS).
//
// Les datagrammes reçus attendent dans une file bornée côté natif ; ce pont la
// vide toutes les FLUSH_MS (lot d'au plus MAX_BATCH paquets, rien quand elle est
// vide). Si JS prend du retard, ce sont les paquets les PLUS ANCIENS qui sont
// jetés (natif : file pleine ou plus de MAX_BATCH en attente ; ici : garde-fou).
// En DMX, seul l'état le plus récent d'un univers compte.
//
// Testé sous Node : expo-app/modules/setremote-udp/test/bridge.test.mjs.
// ════════════════════════════════════════════════════════════════════════════

export const SACN_PORT = 5568;
export const ARTNET_PORT = 6454;
export const MAX_UNIVERSES = 64;
export const MAX_DATAGRAM = 1500;
export const FLUSH_MS = 20;
export const MAX_BATCH = 128;
/** Univers de découverte sACN (E1.31 § 4.3), admis en plus de 1–63999. */
export const SACN_DISCOVERY_UNIVERSE = 64214;

export type DmxProtocol = 'sacn' | 'artnet';
export type NetKind = 'ethernet' | 'wifi' | 'other';

export interface NetInterface {
  name: string;
  kind: NetKind;
  ip: string;
  mask: string;
}

/** Datagramme reçu : adresse et port de l'émetteur, contenu en base64. */
export interface UdpPacket {
  src: string;
  port: number;
  data: string;
}

export type WebCommand =
  | { type: 'dmx:listen'; protocol: DmxProtocol; universes: number[]; multicast: boolean }
  | { type: 'dmx:stop' }
  | { type: 'udp:send'; host: string; port: number; data: string }
  | { type: 'net:info' };

export type NativeMessage =
  | { type: 'dmx:packets'; packets: UdpPacket[] }
  | { type: 'net:info'; interfaces: NetInterface[] }
  | { type: 'dmx:error'; reason: string };

export type ParseResult = { ok: true; command: WebCommand } | { ok: false; reason: string };

/**
 * Raisons de `dmx:error`. Les validations (invalid-*) et `native-unavailable`
 * viennent de ce pont, les autres du natif (SetRemoteUdpModule.swift / .kt).
 */
export const ERROR_REASONS = [
  'invalid-protocol', // dmx:listen : protocole autre que 'sacn' ou 'artnet'
  'invalid-universes', // pas un tableau, plus de 64, ou univers hors plage
  'invalid-host', // udp:send : pas une IPv4 littérale a.b.c.d
  'invalid-port', // udp:send : hors 1–65535
  'invalid-data', // udp:send : base64 invalide, vide ou plus de 1500 octets
  'native-unavailable', // binaire sans le module (Expo Go, ancien build)
  'listen-failed', // erreur inattendue du natif au démarrage de l'écoute
  'bind-failed', // port occupé ou refusé : l'écoute est arrêtée
  'socket-failed', // erreur de réception : l'écoute est arrêtée
  'multicast-not-permitted', // iOS sans l'entitlement multicast : l'unicast continue
  'multicast-failed', // adhésion multicast refusée : l'unicast continue
  'not-listening', // udp:send sans écoute active (le port source n'existe pas)
  'send-failed', // échec de l'envoi
] as const;

/** Après ces erreurs, le natif n'écoute plus : le pont arrête de relever la file. */
export const FATAL_REASONS: ReadonlySet<string> = new Set(['bind-failed', 'socket-failed', 'listen-failed']);

const COMMANDS: ReadonlySet<string> = new Set(['dmx:listen', 'dmx:stop', 'udp:send', 'net:info']);

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`);
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** 1500 octets = 2000 caractères base64 : au-delà, inutile d'examiner la chaîne. */
const MAX_BASE64_CHARS = 4 * Math.ceil(MAX_DATAGRAM / 3);

/** IPv4 littérale « a.b.c.d » (sans zéro de tête), hors 0.0.0.0. */
export function isIPv4(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 15 && IPV4.test(s) && s !== '0.0.0.0';
}

/** Taille décodée d'une chaîne base64 avec bourrage, ou -1 si elle est invalide. */
export function base64DecodedLength(s: unknown): number {
  if (typeof s !== 'string' || s.length % 4 !== 0 || s.length > MAX_BASE64_CHARS + 4) return -1;
  if (!BASE64.test(s)) return -1;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

export function isValidUniverse(protocol: DmxProtocol, u: unknown): u is number {
  if (typeof u !== 'number' || !Number.isInteger(u)) return false;
  if (protocol === 'sacn') return (u >= 1 && u <= 63999) || u === SACN_DISCOVERY_UNIVERSE;
  return u >= 0 && u <= 32767; // Port-Address Art-Net 15 bits
}

/** Groupe multicast sACN d'un univers : 239.255.(u >> 8).(u & 255) (E1.31 § 9.3.1). */
export function sacnMulticastGroup(universe: number): string {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

/** Vrai si le message relève du pont DMX (même s'il est invalide). */
export function isBridgeCommand(msg: unknown): boolean {
  return !!msg && typeof msg === 'object' && COMMANDS.has((msg as { type?: unknown }).type as string);
}

/**
 * Valide un message de la page. Renvoie null s'il ne relève pas du pont DMX
 * (luminosité, etc.), sinon la commande normalisée ou la raison du refus.
 */
export function parseCommand(msg: unknown): ParseResult | null {
  if (!isBridgeCommand(msg)) return null;
  const m = msg as Record<string, unknown>;
  switch (m.type) {
    case 'dmx:listen': {
      const protocol = m.protocol;
      if (protocol !== 'sacn' && protocol !== 'artnet') return { ok: false, reason: 'invalid-protocol' };
      const raw = m.universes === undefined ? [] : m.universes;
      if (!Array.isArray(raw) || raw.length > MAX_UNIVERSES) return { ok: false, reason: 'invalid-universes' };
      const universes: number[] = [];
      for (const u of raw) {
        if (!isValidUniverse(protocol, u)) return { ok: false, reason: 'invalid-universes' };
        if (!universes.includes(u)) universes.push(u);
      }
      return { ok: true, command: { type: 'dmx:listen', protocol, universes, multicast: m.multicast === true } };
    }
    case 'udp:send': {
      if (!isIPv4(m.host)) return { ok: false, reason: 'invalid-host' };
      const port = m.port;
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, reason: 'invalid-port' };
      }
      const n = base64DecodedLength(m.data);
      if (n < 1 || n > MAX_DATAGRAM) return { ok: false, reason: 'invalid-data' };
      return { ok: true, command: { type: 'udp:send', host: m.host, port, data: m.data as string } };
    }
    case 'dmx:stop':
      return { ok: true, command: { type: 'dmx:stop' } };
    default:
      return { ok: true, command: { type: 'net:info' } };
  }
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * Script injecté dans la page pour lui remettre un message.
 * U+2028 / U+2029 sont échappés : valides en JSON, ils ont longtemps été des
 * fins de ligne en JavaScript.
 */
export function nativeScript(message: NativeMessage): string {
  const json = JSON.stringify(message).split(LINE_SEPARATOR).join('\\u2028').split(PARAGRAPH_SEPARATOR).join('\\u2029');
  return 'window.SRNative&&window.SRNative.receive(' + json + ');true;';
}

function toKind(k: unknown): NetKind {
  return k === 'ethernet' || k === 'wifi' ? k : 'other';
}

/** Ne garde que des interfaces IPv4 bien formées (le natif les filtre déjà). */
export function cleanInterfaces(list: unknown): NetInterface[] {
  if (!Array.isArray(list)) return [];
  const out: NetInterface[] = [];
  for (const i of list) {
    if (!i || typeof i !== 'object') continue;
    const r = i as Record<string, unknown>;
    if (typeof r.name !== 'string' || !isIPv4(r.ip) || typeof r.mask !== 'string') continue;
    out.push({ name: r.name, kind: toKind(r.kind), ip: r.ip, mask: r.mask });
  }
  return out;
}

// ─────────────────────────────── le pont ───────────────────────────────

export type SetRemoteUdpEvents = {
  onSetRemoteUdpError: (event: { reason: string }) => void;
  onSetRemoteUdpNetwork: (event: { interfaces: NetInterface[] }) => void;
};

/** Ce que le pont attend du module natif (SetRemoteUdpModule.ts). */
export interface UdpNativeModule {
  listen(protocol: DmxProtocol, universes: number[], multicast: boolean): Promise<void>;
  stop(): Promise<void>;
  send(host: string, port: number, data: string): Promise<void>;
  /** Vide la file native : au plus `max` paquets, les plus récents. Synchrone. */
  drain(max: number): UdpPacket[];
  getNetworkInfo(): Promise<NetInterface[]>;
  addListener<K extends keyof SetRemoteUdpEvents>(event: K, listener: SetRemoteUdpEvents[K]): { remove(): void };
}

type Timer = unknown;

export interface DmxBridgeOptions {
  /** Module natif, ou null s'il manque au binaire. */
  native: UdpNativeModule | null;
  /** Exécute un script dans la page (webView.injectJavaScript). */
  inject: (script: string) => void;
  flushMs?: number;
  maxBatch?: number;
  setInterval?: (fn: () => void, ms: number) => Timer;
  clearInterval?: (t: Timer) => void;
}

export interface DmxBridge {
  /** Traite un message de la page ; false s'il ne relève pas du pont DMX. */
  handle(msg: unknown): boolean;
  /** Relève la file native maintenant (appelé par le minuteur). */
  flush(): void;
  /** La page change (navigation, rechargement) : arrête l'écoute. */
  reset(): void;
  /** Démontage : arrête l'écoute et se désabonne du natif. */
  dispose(): void;
  /** Vrai tant que le pont relève la file native. */
  readonly pumping: boolean;
}

export function createDmxBridge(opts: DmxBridgeOptions): DmxBridge {
  const { native, inject } = opts;
  const flushMs = opts.flushMs ?? FLUSH_MS;
  const maxBatch = Math.max(1, Math.floor(opts.maxBatch ?? MAX_BATCH));
  const every = opts.setInterval ?? ((fn: () => void, ms: number): Timer => setInterval(fn, ms));
  const cancel = opts.clearInterval ?? ((t: Timer) => clearInterval(t as ReturnType<typeof setInterval>));
  let timer: Timer | null = null;
  let listening = false; // une écoute a été demandée au natif et n'a pas été arrêtée
  let disposed = false;

  const post = (message: NativeMessage) => {
    if (disposed) return;
    try { inject(nativeScript(message)); } catch { /* vue web absente : sans effet */ }
  };
  const fail = (reason: string) => post({ type: 'dmx:error', reason });

  const startPump = () => { if (timer === null && !disposed) timer = every(flush, flushMs); };
  const stopPump = () => { if (timer !== null) { cancel(timer); timer = null; } };

  function flush() {
    if (!native || disposed) return;
    let packets: UdpPacket[];
    try { packets = native.drain(maxBatch); } catch { return; }
    if (!Array.isArray(packets) || packets.length === 0) return; // pas de lot vide
    // Garde-fou : le natif plafonne déjà ; sinon on garde les plus récents.
    if (packets.length > maxBatch) packets = packets.slice(packets.length - maxBatch);
    post({ type: 'dmx:packets', packets });
  }

  const subscriptions = native
    ? [
        native.addListener('onSetRemoteUdpError', (e) => {
          const reason = typeof e?.reason === 'string' ? e.reason : 'socket-failed';
          if (FATAL_REASONS.has(reason)) { listening = false; stopPump(); }
          fail(reason);
        }),
        native.addListener('onSetRemoteUdpNetwork', (e) => {
          post({ type: 'net:info', interfaces: cleanInterfaces(e?.interfaces) });
        }),
      ]
    : [];

  function stopNative() {
    listening = false;
    stopPump();
    native?.stop().catch(() => {});
  }

  /** Arrêt implicite (page remplacée, démontage) : seulement si une écoute est en cours. */
  function reset() {
    if (listening || timer !== null) stopNative();
  }

  function handle(msg: unknown): boolean {
    const parsed = parseCommand(msg);
    if (parsed === null) return false;
    if (disposed) return true;
    if (!parsed.ok) { fail(parsed.reason); return true; }
    const c = parsed.command;
    switch (c.type) {
      case 'dmx:listen':
        if (!native) { fail('native-unavailable'); break; }
        listening = true;
        startPump();
        native.listen(c.protocol, c.universes, c.multicast).catch(() => {
          listening = false;
          stopPump();
          fail('listen-failed');
        });
        break;
      case 'dmx:stop':
        stopNative();
        break;
      case 'udp:send':
        if (!native) { fail('native-unavailable'); break; }
        native.send(c.host, c.port, c.data).catch(() => fail('send-failed'));
        break;
      case 'net:info':
        if (!native) { post({ type: 'net:info', interfaces: [] }); break; }
        native.getNetworkInfo().then(
          (list) => post({ type: 'net:info', interfaces: cleanInterfaces(list) }),
          () => post({ type: 'net:info', interfaces: [] }),
        );
        break;
    }
    return true;
  }

  return {
    handle,
    flush,
    reset,
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      for (const s of subscriptions) s.remove();
    },
    get pumping() { return timer !== null; },
  };
}
