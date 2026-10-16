// ════════════════════════════════════════════════════════════════════════════
// Pont des liaisons hors ligne WebView ↔ natif : logique pure, sans React Native.
//
// Contrat (docs/OFFLINE-NATIVE.md § 2, figé : le côté web est construit dessus)
//
//   web → natif, JSON via window.ReactNativeWebView.postMessage
//     { type: 'link:start', modes: ('lan' | 'ble')[], role: 'remote' | 'screen',
//       room: <topic base64url, 22 caractères>, name?: string }
//     { type: 'link:stop', modes?: ('lan' | 'ble')[] }
//     { type: 'link:send', frames: string[], to?: peerId[] }
//     { type: 'link:state?' }
//
//   natif → web, par webView.injectJavaScript(nativeScript(message))
//     { type: 'link:frames', frames: [{ peer, mode, data }] }     par lots (≈ 20 ms)
//     { type: 'link:peers', peers: [{ peer, mode, name? }] }      après chaque link:start, puis à chaque changement
//     { type: 'link:state', lan: { available, active, error? }, ble: { … } }
//     { type: 'link:error', mode: 'lan' | 'ble' | null, reason }
//
// Les trames sont des chaînes OPAQUES, déjà chiffrées et authentifiées par la
// vue web (packages/protocol) : le natif ne fait que les transporter.
//
// Le topic (« room ») ne quitte pas ce fichier : on en dérive ici
//   roomTag = 8 premiers octets de SHA-256(room), en hexadécimal (découverte :
//             TXT Bonjour, annonce BLE) ;
//   authKey = SHA-256("setremote-link/v1/auth:" + room) (poignée de main locale
//             qui écarte les appareils étrangers au plateau, voir src/wire.ts).
// Le natif ne reçoit que ces deux valeurs.
//
// Les trames reçues attendent dans une file bornée côté natif ; ce pont la
// vide toutes les FLUSH_MS (au plus MAX_BATCH_FRAMES trames et MAX_BATCH_BYTES
// octets par lot, rien quand elle est vide). Si JS prend du retard, la file
// native jette les trames les PLUS ANCIENNES.
//
// Testé sous Node : expo-app/modules/setremote-link/test/*.test.mjs.
// ════════════════════════════════════════════════════════════════════════════

import { sha256, toHex, utf8Encode, utf8Length } from './sha256.ts';

export const LINK_MODES = ['lan', 'ble'] as const;
export type LinkMode = (typeof LINK_MODES)[number];
export type LinkRole = 'remote' | 'screen';

/** Taille maximale d'une trame, en octets UTF-8, selon la liaison. */
export const MAX_FRAME_BYTES: Readonly<Record<LinkMode, number>> = Object.freeze({ lan: 64 * 1024, ble: 4 * 1024 });
/** Trames au plus par link:send. */
export const MAX_SEND_FRAMES = 256;
/** Destinataires au plus dans `to`. */
export const MAX_TO_PEERS = 64;
/** Nom affiché d'un appareil : 64 caractères, 128 octets UTF-8 au plus. */
export const MAX_NAME_CHARS = 64;
export const MAX_NAME_BYTES = 128;
export const ROOM_LENGTH = 22;
export const ROOM_TAG_BYTES = 8;
export const AUTH_KEY_CONTEXT = 'setremote-link/v1/auth:';
export const FLUSH_MS = 20;
export const MAX_BATCH_FRAMES = 256;
export const MAX_BATCH_BYTES = 1024 * 1024;

/**
 * Identifiant de pair attribué par le natif : opaque, tiré à chaque connexion,
 * préfixé par la liaison (« lan-3fa9c2e1b07d », « ble-… ») : un même appareil
 * joint par les deux liaisons a deux identifiants distincts.
 */
export const PEER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ROOM_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const REASON_PATTERN = /^[a-z0-9-]{1,40}$/;
// C0, DEL, C1 et séparateurs de ligne / paragraphe Unicode
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const CONTROL_CHARS_G = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * Raisons de `link:error`. Validation et `native-unavailable` viennent de ce
 * pont (mode null, sauf `too-large` et `native-unavailable` sur link:start) ;
 * les autres du natif (ios/*.swift, android/…/*.kt), avec la liaison en cause.
 * Tableau détaillé : docs/OFFLINE-NATIVE.md § 2.4.
 */
export const ERROR_REASONS = [
  'invalid-modes', // modes : pas un tableau non vide de 'lan' / 'ble'
  'invalid-role', // role : ni 'remote' ni 'screen'
  'invalid-room', // room : pas 22 caractères base64url
  'invalid-name', // name : pas une chaîne, plus de 64 caractères / 128 octets, ou caractère de contrôle
  'invalid-frames', // frames : pas un tableau de 1 à 256 chaînes non vides
  'invalid-peers', // to : pas un tableau de 1 à 64 identifiants de pair
  'too-large', // trame au-delà du plafond de la liaison (lan 64 Kio, ble 4 Kio) : refusée pour cette liaison
  'not-started', // link:send sans liaison démarrée
  'unknown-peer', // link:send : un destinataire n'est pas (ou plus) connecté ; les autres reçoivent
  'native-unavailable', // binaire sans le module (Expo Go, ancien build)
  'start-failed', // erreur inattendue du natif au démarrage
  'no-network', // lan : ni Wi-Fi ni Ethernet ; la liaison reprend seule quand un réseau revient
  'local-network-denied', // lan, iOS : accès au réseau local refusé (Réglages › SetRemote)
  'listen-failed', // lan, télécommande : écoute TCP impossible
  'advertise-failed', // lan : publication Bonjour / NSD refusée ; ble : annonce refusée
  'browse-failed', // lan, écran : recherche Bonjour / NSD impossible
  'unsupported', // ble : pas de Bluetooth LE, ou rôle périphérique / annonce non pris en charge
  'powered-off', // ble : Bluetooth désactivé ; reprend seul quand il est réactivé
  'unauthorized', // ble : autorisation Bluetooth (ou « appareils à proximité ») refusée
  'location-off', // ble, Android ≤ 11, télécommande : localisation coupée, le scan ne voit rien
  'scan-failed', // ble, télécommande : scan refusé par le système
  'gatt-failed', // ble, écran : service GATT impossible à publier
  'too-many-peers', // plafond de pairs atteint (lan 64, ble 8 côté télécommande) : nouveau pair refusé
  'congested', // file d'envoi d'un pair pleine : ses trames les plus anciennes sont jetées
  'link-failed', // arrêt sur une erreur inattendue
] as const;
export type LinkErrorReason = (typeof ERROR_REASONS)[number];

export interface LinkFrame {
  peer: string;
  mode: LinkMode;
  data: string;
}

export interface LinkPeer {
  peer: string;
  mode: LinkMode;
  name?: string;
}

export interface LinkModeState {
  available: boolean;
  active: boolean;
  error?: string;
}

export interface LinkState {
  lan: LinkModeState;
  ble: LinkModeState;
}

export type WebCommand =
  | { type: 'link:start'; modes: LinkMode[]; role: LinkRole; room: string; name: string }
  | { type: 'link:stop'; modes: LinkMode[] }
  | { type: 'link:send'; frames: string[]; to: string[] | null }
  | { type: 'link:state?' };

export type NativeMessage =
  | { type: 'link:frames'; frames: LinkFrame[] }
  | { type: 'link:peers'; peers: LinkPeer[] }
  | ({ type: 'link:state' } & LinkState)
  | { type: 'link:error'; mode: LinkMode | null; reason: string };

export type ParseResult = { ok: true; command: WebCommand } | { ok: false; reason: LinkErrorReason };

const COMMANDS: ReadonlySet<string> = new Set(['link:start', 'link:stop', 'link:send', 'link:state?']);

export function isLinkMode(m: unknown): m is LinkMode {
  return m === 'lan' || m === 'ble';
}

/** Vrai si le message relève du pont des liaisons (même s'il est invalide). */
export function isBridgeCommand(msg: unknown): boolean {
  return !!msg && typeof msg === 'object' && COMMANDS.has((msg as { type?: unknown }).type as string);
}

/** Liste de modes sans doublon, ou null si invalide. `allowAbsent` : absent = toutes. */
function parseModes(raw: unknown, allowAbsent: boolean): LinkMode[] | null {
  if (raw === undefined && allowAbsent) return [...LINK_MODES];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return null;
  const out: LinkMode[] = [];
  for (const m of raw) {
    if (!isLinkMode(m)) return null;
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** Nom valide (ou absent → ''), sinon null. */
export function parseName(raw: unknown): string | null {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length > MAX_NAME_CHARS || CONTROL_CHARS.test(name)) return null;
  if (utf8Length(name, MAX_NAME_BYTES) > MAX_NAME_BYTES) return null;
  return name;
}

/**
 * Valide un message de la page. Renvoie null s'il ne relève pas du pont des
 * liaisons (DMX, luminosité…), sinon la commande normalisée ou la raison du refus.
 * La taille des trames n'est pas vérifiée ici (voir createLinkBridge).
 */
export function parseCommand(msg: unknown): ParseResult | null {
  if (!isBridgeCommand(msg)) return null;
  const m = msg as Record<string, unknown>;
  switch (m.type) {
    case 'link:start': {
      const modes = parseModes(m.modes, false);
      if (!modes) return { ok: false, reason: 'invalid-modes' };
      if (m.role !== 'remote' && m.role !== 'screen') return { ok: false, reason: 'invalid-role' };
      if (typeof m.room !== 'string' || !ROOM_PATTERN.test(m.room)) return { ok: false, reason: 'invalid-room' };
      const name = parseName(m.name);
      if (name === null) return { ok: false, reason: 'invalid-name' };
      return { ok: true, command: { type: 'link:start', modes, role: m.role, room: m.room, name } };
    }
    case 'link:stop': {
      const modes = parseModes(m.modes, true);
      if (!modes) return { ok: false, reason: 'invalid-modes' };
      return { ok: true, command: { type: 'link:stop', modes } };
    }
    case 'link:send': {
      const frames = m.frames;
      if (!Array.isArray(frames) || frames.length === 0 || frames.length > MAX_SEND_FRAMES) {
        return { ok: false, reason: 'invalid-frames' };
      }
      for (const f of frames) if (typeof f !== 'string' || f.length === 0) return { ok: false, reason: 'invalid-frames' };
      let to: string[] | null = null;
      if (m.to !== undefined && m.to !== null) {
        if (!Array.isArray(m.to) || m.to.length === 0 || m.to.length > MAX_TO_PEERS) return { ok: false, reason: 'invalid-peers' };
        to = [];
        for (const p of m.to) {
          if (typeof p !== 'string' || !PEER_ID_PATTERN.test(p)) return { ok: false, reason: 'invalid-peers' };
          if (!to.includes(p)) to.push(p);
        }
      }
      return { ok: true, command: { type: 'link:send', frames: frames as string[], to } };
    }
    default:
      return { ok: true, command: { type: 'link:state?' } };
  }
}

// ───────────────────────────── dérivations du topic ─────────────────────────────

/** 8 premiers octets de SHA-256(room), en hexadécimal minuscule (16 caractères). */
export function roomTag(room: string): string {
  return toHex(sha256(utf8Encode(room)).subarray(0, ROOM_TAG_BYTES));
}

/** Clé de la poignée de main locale : SHA-256(AUTH_KEY_CONTEXT + room), hexadécimal (64 caractères). */
export function authKey(room: string): string {
  return toHex(sha256(utf8Encode(AUTH_KEY_CONTEXT + room)));
}

// ───────────────────────────── natif → page ─────────────────────────────

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

/** Nom reçu d'un pair : sans caractère de contrôle, 64 caractères au plus (le natif le fait déjà). */
export function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.replace(CONTROL_CHARS_G, '').trim().slice(0, MAX_NAME_CHARS);
  return name === '' ? undefined : name;
}

/** Liste de pairs bien formée (le natif l'est déjà) : identifiants uniques, au plus 256. */
export function cleanPeers(list: unknown): LinkPeer[] {
  if (!Array.isArray(list)) return [];
  const out: LinkPeer[] = [];
  const seen = new Set<string>();
  for (const p of list) {
    if (out.length >= 256) break;
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    if (typeof r.peer !== 'string' || !PEER_ID_PATTERN.test(r.peer) || !isLinkMode(r.mode) || seen.has(r.peer)) continue;
    seen.add(r.peer);
    const name = cleanName(r.name);
    out.push(name === undefined ? { peer: r.peer, mode: r.mode } : { peer: r.peer, mode: r.mode, name });
  }
  return out;
}

function cleanModeState(raw: unknown): LinkModeState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const s: LinkModeState = { available: r.available === true, active: r.active === true };
  if (typeof r.error === 'string' && REASON_PATTERN.test(r.error)) s.error = r.error;
  return s;
}

export function cleanState(raw: unknown): LinkState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { lan: cleanModeState(r.lan), ble: cleanModeState(r.ble) };
}

/** État publié quand le binaire n'a pas le module natif. */
export const UNAVAILABLE_STATE: LinkState = Object.freeze({
  lan: Object.freeze({ available: false, active: false, error: 'native-unavailable' }),
  ble: Object.freeze({ available: false, active: false, error: 'native-unavailable' }),
}) as LinkState;

export function cleanFrames(list: unknown[]): LinkFrame[] {
  const out: LinkFrame[] = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    if (typeof r.peer !== 'string' || !isLinkMode(r.mode) || typeof r.data !== 'string' || r.data.length === 0) continue;
    out.push({ peer: r.peer, mode: r.mode, data: r.data });
  }
  return out;
}

// ─────────────────────────────── le pont ───────────────────────────────

export type SetRemoteLinkEvents = {
  onSetRemoteLinkPeers: (event: { peers: LinkPeer[] }) => void;
  onSetRemoteLinkState: (event: LinkState) => void;
  onSetRemoteLinkError: (event: { mode?: string | null; reason: string }) => void;
};

/**
 * Ce que le pont attend du module natif (SetRemoteLinkModule.ts). Toutes les
 * fonctions sont SYNCHRONES : elles ne font que poster le travail sur la file
 * interne du natif, dans l'ordre des appels (pas de course entre deux
 * link:send, ni entre link:start et le premier link:send).
 */
export interface LinkNativeModule {
  /** Démarre ou remplace les liaisons ; roomTag 16 hex, authKey 64 hex, name ≤ 128 octets. */
  start(modes: LinkMode[], role: LinkRole, roomTag: string, authKey: string, name: string): void;
  /** Arrête les liaisons listées (toutes si la liste est vide). */
  stop(modes: LinkMode[]): void;
  /** Envoie à tous les pairs (`to` vide) ou à ceux listés. */
  send(frames: string[], to: string[]): void;
  /** Vide la file de réception : au plus maxFrames trames et maxBytes octets ; le reste attend. */
  drain(maxFrames: number, maxBytes: number): LinkFrame[];
  getState(): LinkState;
  addListener<K extends keyof SetRemoteLinkEvents>(event: K, listener: SetRemoteLinkEvents[K]): { remove(): void };
}

type Timer = unknown;

export interface LinkBridgeOptions {
  /** Module natif, ou null s'il manque au binaire. */
  native: LinkNativeModule | null;
  /** Exécute un script dans la page (webView.injectJavaScript). */
  inject: (script: string) => void;
  flushMs?: number;
  maxBatchFrames?: number;
  maxBatchBytes?: number;
  setInterval?: (fn: () => void, ms: number) => Timer;
  clearInterval?: (t: Timer) => void;
}

export interface LinkBridge {
  /** Traite un message de la page ; false s'il ne relève pas du pont des liaisons. */
  handle(msg: unknown): boolean;
  /** Relève la file native maintenant (appelé par le minuteur). */
  flush(): void;
  /** La page change (navigation, rechargement) : arrête toutes les liaisons. */
  reset(): void;
  /** Démontage : arrête les liaisons et se désabonne du natif. */
  dispose(): void;
  /** Vrai tant que le pont relève la file native. */
  readonly pumping: boolean;
  /** Liaisons demandées par la page et non arrêtées. */
  readonly activeModes: readonly LinkMode[];
}

export function createLinkBridge(opts: LinkBridgeOptions): LinkBridge {
  const { native, inject } = opts;
  const flushMs = opts.flushMs ?? FLUSH_MS;
  const maxBatchFrames = Math.max(1, Math.floor(opts.maxBatchFrames ?? MAX_BATCH_FRAMES));
  const maxBatchBytes = Math.max(1, Math.floor(opts.maxBatchBytes ?? MAX_BATCH_BYTES));
  const every = opts.setInterval ?? ((fn: () => void, ms: number): Timer => setInterval(fn, ms));
  const cancel = opts.clearInterval ?? ((t: Timer) => clearInterval(t as ReturnType<typeof setInterval>));
  let timer: Timer | null = null;
  const active = new Set<LinkMode>(); // liaisons demandées par la page
  let keys: { room: string; roomTag: string; authKey: string } | null = null;
  let disposed = false;

  const post = (message: NativeMessage) => {
    if (disposed) return;
    try { inject(nativeScript(message)); } catch { /* vue web absente : sans effet */ }
  };
  const fail = (mode: LinkMode | null, reason: string) => post({ type: 'link:error', mode, reason });

  const startPump = () => { if (timer === null && !disposed) timer = every(flush, flushMs); };
  const stopPump = () => { if (timer !== null) { cancel(timer); timer = null; } };

  function flush() {
    if (!native || disposed) return;
    let frames: unknown;
    try { frames = native.drain(maxBatchFrames, maxBatchBytes); } catch { return; }
    if (!Array.isArray(frames) || frames.length === 0) return; // pas de lot vide
    // Garde-fou : le natif plafonne déjà ; sinon on garde les plus récentes.
    const list = frames.length > maxBatchFrames ? frames.slice(frames.length - maxBatchFrames) : frames;
    const clean = cleanFrames(list);
    if (clean.length > 0) post({ type: 'link:frames', frames: clean });
  }

  const subscriptions = native
    ? [
        native.addListener('onSetRemoteLinkPeers', (e) => {
          // Les trames déjà reçues passent avant le changement de pairs.
          if (timer !== null) flush();
          post({ type: 'link:peers', peers: cleanPeers(e?.peers) });
        }),
        native.addListener('onSetRemoteLinkState', (e) => {
          post({ type: 'link:state', ...cleanState(e) });
        }),
        native.addListener('onSetRemoteLinkError', (e) => {
          const mode = isLinkMode(e?.mode) ? e.mode : null;
          const reason = typeof e?.reason === 'string' && REASON_PATTERN.test(e.reason) ? e.reason : 'link-failed';
          fail(mode, reason);
        }),
      ]
    : [];

  function stopAll() {
    active.clear();
    stopPump();
    try { native?.stop([...LINK_MODES]); } catch { /* natif détruit */ }
  }

  function reset() {
    if (active.size > 0 || timer !== null) stopAll();
  }

  function deriveKeys(room: string) {
    if (!keys || keys.room !== room) keys = { room, roomTag: roomTag(room), authKey: authKey(room) };
    return keys;
  }

  function handle(msg: unknown): boolean {
    const parsed = parseCommand(msg);
    if (parsed === null) return false;
    if (disposed) return true;
    if (!parsed.ok) { fail(null, parsed.reason); return true; }
    const c = parsed.command;
    switch (c.type) {
      case 'link:start': {
        if (!native) {
          for (const m of c.modes) fail(m, 'native-unavailable');
          post({ type: 'link:state', ...UNAVAILABLE_STATE });
          post({ type: 'link:peers', peers: [] }); // contrat : link:peers après chaque link:start
          break;
        }
        const k = deriveKeys(c.room);
        active.clear();
        for (const m of c.modes) active.add(m);
        startPump();
        try {
          native.start(c.modes, c.role, k.roomTag, k.authKey, c.name);
        } catch {
          active.clear();
          stopPump();
          for (const m of c.modes) fail(m, 'start-failed');
          post({ type: 'link:peers', peers: [] });
        }
        break;
      }
      case 'link:stop':
        for (const m of c.modes) active.delete(m);
        if (active.size === 0) stopPump();
        try { native?.stop(c.modes); } catch { /* natif détruit */ }
        break;
      case 'link:send': {
        if (!native) { fail(null, 'native-unavailable'); break; }
        if (active.size === 0) { fail(null, 'not-started'); break; }
        // Au-delà du plus grand plafond (lan, 64 Kio), la trame ne passe nulle
        // part : refusée ici, sans traverser le pont. Entre 4 et 64 Kio, c'est
        // le natif qui la refuse pour les seuls pairs Bluetooth.
        const cap = MAX_FRAME_BYTES.lan;
        const keep: string[] = [];
        let oversize = false;
        for (const f of c.frames) {
          if (utf8Length(f, cap) > cap) oversize = true;
          else keep.push(f);
        }
        if (oversize) for (const m of LINK_MODES) if (active.has(m)) fail(m, 'too-large');
        if (keep.length > 0) {
          try { native.send(keep, c.to ?? []); } catch { fail(null, 'link-failed'); }
        }
        break;
      }
      case 'link:state?': {
        if (!native) { post({ type: 'link:state', ...UNAVAILABLE_STATE }); break; }
        let state: unknown = null;
        try { state = native.getState(); } catch { /* natif détruit */ }
        post({ type: 'link:state', ...cleanState(state) });
        break;
      }
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
    get activeModes() { return LINK_MODES.filter((m) => active.has(m)); },
  };
}
