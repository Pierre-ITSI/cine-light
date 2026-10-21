// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// Pont « audio de l'appel décroché » WebView ↔ natif : logique pure, sans React
// Native. Contrat complet et choix techniques : docs/CALL-AUDIO-NATIVE.md ; côté
// page : web/js/00-native-bridge.js et 80-call-simulator.js (écran de jeu).
//
//   page → coque, JSON via window.ReactNativeWebView.postMessage
//     { type: 'audio:load', id, mime, size, i, n, data }   bande son en morceaux base64 (≤ AUDIO_CHUNK
//                                                          caractères, multiple de 4 sauf le dernier) ;
//                                                          fichier temporaire, prêt au dernier morceau
//     { type: 'audio:call-start', route: 'ear'|'speaker', proximity: boolean }
//     { type: 'audio:play', id, delay }                    voix du fichier `id` après `delay` s (0 à 15)
//     { type: 'audio:route', route }                       bascule de la sortie en cours d'appel
//     { type: 'audio:call-end' }                           sortie rendue, capteur coupé, lecture arrêtée
//
//   coque → page, par webView.injectJavaScript(audioScript(message))
//     { type: 'audio:state', route?, proximityNear?, proximityAvailable? }
//     { type: 'audio:loaded', id }
//     { type: 'audio:error', reason }                      (AUDIO_ERROR_REASONS)
//
// La bande son vient du cache de l'écran (≤ 8 Mo) : le pont l'écrit dans un fichier
// temporaire (mêmes morceaux que les fichiers projet, src/lib/projectFiles.ts) et ne
// confie au module natif qu'un chemin. Tout ce qui vient de la page est validé ici.
// Testé sous Node : expo-app/modules/setremote-audio/test/bridge.test.mjs.
// ════════════════════════════════════════════════════════════════════════════

export const AUDIO_CHUNK = 512 * 1024;                   // caractères base64 par message
export const AUDIO_MAX_CHARS = 12 * 1024 * 1024;         // ≈ 9 Mo de fichier (plafond de la page : 8 Mo)
export const AUDIO_MAX_CHUNKS = Math.ceil(AUDIO_MAX_CHARS / AUDIO_CHUNK);
export const AUDIO_MAX_DELAY = 15;                       // s, comme call:start.audio.delay
export const AUDIO_KEEP_FILES = 3;                       // fichiers temporaires gardés (le dernier appel les rejoue)

export type AudioRoute = 'ear' | 'speaker';

export const AUDIO_ERROR_REASONS = [
  'bad-chunk', // morceau invalide, hors d'ordre ou fichier trop gros
  'write-failed', // fichier temporaire impossible à écrire
  'not-loaded', // audio:play d'une bande son que le pont n'a pas (ou plus)
  'unavailable', // binaire sans le module natif (Expo Go, ancien build)
  'session-failed', // session audio refusée par le système
  'route-failed', // sortie introuvable ou refusée (pas d'écouteur, par exemple)
  'play-failed', // lecture impossible (fichier illisible, erreur du lecteur)
] as const;
export type AudioErrorReason = (typeof AUDIO_ERROR_REASONS)[number];

export type AudioCommand =
  | { type: 'audio:load'; id: string; mime: string; size: number; i: number; n: number; data: string }
  | { type: 'audio:call-start'; route: AudioRoute; proximity: boolean }
  | { type: 'audio:play'; id: string; delay: number }
  | { type: 'audio:route'; route: AudioRoute }
  | { type: 'audio:call-end' };

export type AudioNativeMessage =
  | { type: 'audio:state'; route?: AudioRoute; proximityNear?: boolean; proximityAvailable?: boolean }
  | { type: 'audio:loaded'; id: string }
  | { type: 'audio:error'; reason: AudioErrorReason };

export type ParseResult =
  | { ok: true; command: AudioCommand }
  | { ok: false; reason: AudioErrorReason; id: string | null };

const COMMANDS: ReadonlySet<string> = new Set(['audio:load', 'audio:call-start', 'audio:play', 'audio:route', 'audio:call-end']);
// Identifiant d'une bande son : empreinte courte du contenu côté page (80-call-simulator.js)
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MIME_RE = /^audio\/[a-z0-9.+-]{1,30}$/i;

/** Extension du fichier temporaire d'après le type MIME annoncé (les lecteurs natifs s'en servent comme indice). */
export function audioExtension(mime: unknown): string {
  const m = typeof mime === 'string' ? mime.toLowerCase() : '';
  if (/mp4|m4a|aac|x-m4a/.test(m)) return 'm4a';
  if (/mpeg|mp3/.test(m)) return 'mp3';
  if (/wav|wave/.test(m)) return 'wav';
  if (/ogg|opus/.test(m)) return 'ogg';
  if (/caf/.test(m)) return 'caf';
  return 'm4a';
}
export function audioFileName(id: string, mime: unknown): string {
  return 'voix-' + id + '.' + audioExtension(mime);
}

/** Vrai si le message relève de ce pont (même s'il est invalide). */
export function isAudioCommand(msg: unknown): boolean {
  return !!msg && typeof msg === 'object' && COMMANDS.has((msg as { type?: unknown }).type as string);
}

const isRoute = (v: unknown): v is AudioRoute => v === 'ear' || v === 'speaker';

/** null : message étranger au pont ; sinon la commande normalisée ou la raison du refus. */
export function parseCommand(msg: unknown): ParseResult | null {
  if (!isAudioCommand(msg)) return null;
  const m = msg as Record<string, unknown>;
  const idOf = typeof m.id === 'string' && ID_RE.test(m.id) ? m.id : null;
  switch (m.type) {
    case 'audio:load': {
      const { i, n, size, data } = m;
      if (!idOf) return { ok: false, reason: 'bad-chunk', id: null };
      if (!Number.isInteger(i) || !Number.isInteger(n) || !Number.isInteger(size)) return { ok: false, reason: 'bad-chunk', id: idOf };
      const ii = i as number, nn = n as number, sz = size as number;
      if (nn < 1 || nn > AUDIO_MAX_CHUNKS || ii < 0 || ii >= nn || sz < 0 || sz > AUDIO_MAX_CHARS) return { ok: false, reason: 'bad-chunk', id: idOf };
      if (nn !== Math.max(1, Math.ceil(sz / AUDIO_CHUNK))) return { ok: false, reason: 'bad-chunk', id: idOf };
      if (typeof data !== 'string' || data.length > AUDIO_CHUNK || data.length % 4 !== 0 || !B64_RE.test(data)) return { ok: false, reason: 'bad-chunk', id: idOf };
      // `size` fait foi : tous les morceaux sont pleins, le dernier porte le reste exact (rien de tronqué, rien en trop)
      if (data.length !== (ii < nn - 1 ? AUDIO_CHUNK : sz - ii * AUDIO_CHUNK) || (ii < nn - 1 && data.endsWith('='))) return { ok: false, reason: 'bad-chunk', id: idOf };
      const mime = typeof m.mime === 'string' && MIME_RE.test(m.mime) ? m.mime : '';
      return { ok: true, command: { type: 'audio:load', id: idOf, mime, size: sz, i: ii, n: nn, data } };
    }
    case 'audio:call-start':
      if (!isRoute(m.route)) return { ok: false, reason: 'route-failed', id: null };
      return { ok: true, command: { type: 'audio:call-start', route: m.route, proximity: m.proximity === true } };
    case 'audio:play': {
      if (!idOf) return { ok: false, reason: 'not-loaded', id: null };
      const d = m.delay;
      const delay = typeof d === 'number' && Number.isFinite(d) ? Math.min(AUDIO_MAX_DELAY, Math.max(0, d)) : 0;
      return { ok: true, command: { type: 'audio:play', id: idOf, delay } };
    }
    case 'audio:route':
      if (!isRoute(m.route)) return { ok: false, reason: 'route-failed', id: null };
      return { ok: true, command: { type: 'audio:route', route: m.route } };
    default:
      return { ok: true, command: { type: 'audio:call-end' } };
  }
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
/** Script injecté : message remis à window.SRNative.receive. */
export function audioScript(message: AudioNativeMessage): string {
  const json = JSON.stringify(message).split(LINE_SEPARATOR).join('\\u2028').split(PARAGRAPH_SEPARATOR).join('\\u2029');
  return 'window.SRNative&&window.SRNative.receive(' + json + ');true;';
}

/** Événement du module natif nettoyé avant d'être remis à la page. */
export function cleanState(e: unknown): Extract<AudioNativeMessage, { type: 'audio:state' }> {
  const out: Extract<AudioNativeMessage, { type: 'audio:state' }> = { type: 'audio:state' };
  if (!e || typeof e !== 'object') return out;
  const r = e as Record<string, unknown>;
  if (isRoute(r.route)) out.route = r.route;
  if (typeof r.proximityNear === 'boolean') out.proximityNear = r.proximityNear;
  if (typeof r.proximityAvailable === 'boolean') out.proximityAvailable = r.proximityAvailable;
  return out;
}
export function cleanReason(r: unknown): AudioErrorReason {
  return (AUDIO_ERROR_REASONS as readonly string[]).includes(r as string) ? (r as AudioErrorReason) : 'play-failed';
}

// ─────────────────────────────── le pont ───────────────────────────────

export type SetRemoteAudioEvents = {
  onSetRemoteAudioState: (event: { route?: string; proximityNear?: boolean; proximityAvailable?: boolean }) => void;
  onSetRemoteAudioError: (event: { reason: string }) => void;
};

/** Ce que le pont attend du module natif (SetRemoteAudioModule.ts ; Swift et Kotlin). */
export interface AudioNativeModule {
  /** Session d'appel : sortie (écouteur par défaut), capteur de proximité (écran noir contre l'oreille). */
  startCall(route: AudioRoute, proximity: boolean): Promise<void>;
  /** Joue le fichier (chemin local) après `delay` secondes ; remplace une lecture en cours. */
  play(uri: string, delay: number): Promise<void>;
  setRoute(route: AudioRoute): Promise<void>;
  /** Arrête la lecture, rend la sortie et la session, coupe le capteur. Sans effet hors appel. */
  endCall(): Promise<void>;
  addListener<K extends keyof SetRemoteAudioEvents>(event: K, listener: SetRemoteAudioEvents[K]): { remove(): void };
}

/** Fichier temporaire écrit par morceaux (expo-file-system, File.write en base64, append). */
export interface AudioTempFile {
  write(base64: string, append: boolean): void;
  readonly uri: string;
  delete(): void;
}

export interface AudioBridgeOptions {
  /** Module natif, ou null s'il manque au binaire. */
  native: AudioNativeModule | null;
  /** Fichier temporaire du nom donné (remplace l'ancien) ; null : indisponible. */
  createTemp: (name: string) => AudioTempFile | null;
  /** Exécute un script dans la page (webView.injectJavaScript). */
  inject: (script: string) => void;
}

export interface AudioBridge {
  /** Traite un message de la page ; false s'il ne relève pas du pont audio. */
  handle(msg: unknown): boolean;
  /** La page change (navigation, rechargement) : fin d'appel et fichiers temporaires effacés. */
  reset(): void;
  /** Démontage : reset et désabonnement du natif. */
  dispose(): void;
  /** Vrai entre audio:call-start et audio:call-end. */
  readonly inCall: boolean;
}

export function createAudioBridge(opts: AudioBridgeOptions): AudioBridge {
  const { native, createTemp, inject } = opts;
  const files = new Map<string, { file: AudioTempFile }>(); // bandes son complètes, la plus récente en dernier
  let load: { id: string; n: number; next: number; file: AudioTempFile } | null = null;
  let inCall = false;
  let playing: string | null = null;
  let disposed = false;

  const post = (m: AudioNativeMessage) => {
    if (disposed) return;
    try { inject(audioScript(m)); } catch { /* vue web absente : sans effet */ }
  };
  const fail = (reason: AudioErrorReason) => post({ type: 'audio:error', reason });

  const subs: { remove(): void }[] = [];
  if (native) {
    try {
      subs.push(native.addListener('onSetRemoteAudioState', (e) => post(cleanState(e))));
      subs.push(native.addListener('onSetRemoteAudioError', (e) => fail(cleanReason(e && e.reason))));
    } catch { /* module sans événements : seules les réponses directes remontent */ }
  }

  const drop = (id: string) => {
    const f = files.get(id);
    if (!f) return;
    files.delete(id);
    try { f.file.delete(); } catch { /* déjà supprimé */ }
  };
  const keep = (id: string, file: AudioTempFile) => {
    drop(id);
    files.set(id, { file });
    // Les plus anciennes disparaissent ; jamais celle qui joue
    for (const old of [...files.keys()]) {
      if (files.size <= AUDIO_KEEP_FILES) break;
      if (old !== id && old !== playing) drop(old);
    }
  };

  function onLoad(c: Extract<AudioCommand, { type: 'audio:load' }>) {
    if (c.i === 0) {
      if (load) { try { load.file.delete(); } catch { /* ignoré */ } load = null; }
      let file: AudioTempFile | null = null;
      try { file = createTemp(audioFileName(c.id, c.mime)); } catch { file = null; }
      if (!file) { fail('write-failed'); return; }
      load = { id: c.id, n: c.n, next: 0, file };
    }
    const l = load;
    if (!l || l.id !== c.id || l.next !== c.i || l.n !== c.n) { load = null; fail('bad-chunk'); return; }
    try { l.file.write(c.data, c.i > 0); } catch { load = null; fail('write-failed'); return; }
    l.next++;
    if (l.next < l.n) return;
    load = null;
    keep(l.id, l.file);
    post({ type: 'audio:loaded', id: l.id });
  }

  function run(p: Promise<void>, reason: AudioErrorReason) {
    p.catch(() => fail(reason));
  }

  function onCommand(c: AudioCommand) {
    switch (c.type) {
      case 'audio:load': onLoad(c); return;
      case 'audio:call-start':
        if (!native) { fail('unavailable'); return; }
        inCall = true;
        run(native.startCall(c.route, c.proximity), 'session-failed');
        return;
      case 'audio:play': {
        const f = files.get(c.id);
        if (!native) { fail('unavailable'); return; }
        if (!f) { fail('not-loaded'); return; }
        playing = c.id;
        run(native.play(f.file.uri, c.delay), 'play-failed');
        return;
      }
      case 'audio:route':
        if (!native) { fail('unavailable'); return; }
        run(native.setRoute(c.route), 'route-failed');
        return;
      case 'audio:call-end':
        endCall();
        return;
    }
  }

  function endCall() {
    playing = null;
    if (!inCall) return;
    inCall = false;
    if (native) native.endCall().catch(() => { /* rien à rendre */ });
  }

  function clearFiles() {
    if (load) { try { load.file.delete(); } catch { /* ignoré */ } load = null; }
    for (const id of [...files.keys()]) drop(id);
  }

  return {
    handle(msg: unknown): boolean {
      const r = parseCommand(msg);
      if (!r) return false;
      if (!r.ok) { if (load && r.id === load.id) load = null; fail(r.reason); return true; }
      onCommand(r.command);
      return true;
    },
    reset() { endCall(); clearFiles(); },
    dispose() {
      endCall(); clearFiles();
      disposed = true;
      for (const s of subs.splice(0)) { try { s.remove(); } catch { /* ignoré */ } }
    },
    get inCall() { return inCall; },
  };
}
