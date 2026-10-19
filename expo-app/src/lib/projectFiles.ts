// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// Fichiers projet .setremote (web/js/72-project.js, docs/PROJECTS.md § 6) :
// logique pure, sans React Native, testée sous Node (test/project-files.test.mjs).
// Dans la vue web, <a download> ne fait rien et <input type=file> n'ouvre pas
// le sélecteur de documents : la coque s'en charge, par morceaux base64.
//
//   page → coque  { type: 'project:save', id, name, size, i, n, data }
//                 morceaux dans l'ordre (i = 0 … n − 1), data ≤ PROJECT_CHUNK
//                 caractères base64 (multiple de 4 sauf le dernier). La coque
//                 les ajoute à un fichier temporaire (cache/projets/<nom>) ;
//                 au dernier, feuille de partage (expo-sharing).
//   page → coque  { type: 'project:open', id }  → sélecteur de fichier
//                 (expo-file-system : File.pickFileAsync), lecture par
//                 morceaux de PROJECT_CHUNK caractères renvoyés un par un.
//   coque → page  { type: 'project:saved', id, ok: true, shared }
//                 { type: 'project:file', id, name, size, i, n, data } | { …, cancelled: true }
//                 { type: 'project:error', id, reason }   (PROJECT_ERROR_REASONS)
// Une seule opération de chaque sorte à la fois (une nouvelle remplace
// l'enregistrement en cours ; une ouverture en cours fait refuser la suivante).
// Fichier au plus PROJECT_MAX_BYTES (256 Mo : tout passe en mémoire en base64).
// ════════════════════════════════════════════════════════════════════════════

export const PROJECT_CHUNK = 512 * 1024;                 // caractères base64 par message
export const PROJECT_CHUNK_BYTES = (PROJECT_CHUNK / 4) * 3;
export const PROJECT_MAX_BYTES = 256 * 1024 * 1024;
export const PROJECT_MAX_CHUNKS = Math.ceil(PROJECT_MAX_BYTES / PROJECT_CHUNK_BYTES);
export const PROJECT_MIME = 'application/zip';
export const PROJECT_UTI = 'public.zip-archive';

export const PROJECT_ERROR_REASONS = [
  'bad-chunk', // morceau invalide ou hors d'ordre
  'too-large', // fichier de plus de 256 Mo
  'unavailable', // binaire sans expo-sharing / sélecteur (ancien build de développement)
  'read-failed', // lecture du fichier choisi impossible
  'write-failed', // écriture du fichier temporaire impossible
  'share-failed', // feuille de partage en échec
] as const;
export type ProjectErrorReason = (typeof PROJECT_ERROR_REASONS)[number];

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Nom de fichier sûr : sans séparateur ni caractère de contrôle, terminé par .setremote. */
export function projectFileName(name: unknown): string {
  const base = String(typeof name === 'string' ? name : '')
    .replace(/\.setremote$/i, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, 60)
    .trim();
  return (base || 'Projet') + '.setremote';
}

// ── base64 (Hermes a atob/btoa, mais on évite les chaînes binaires géantes) ──
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REV = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHA.length; i++) REV[ALPHA.charCodeAt(i)] = i;
export function bytesToBase64(u: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < u.length; i += 3) {
    const n = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2];
    out += ALPHA[n >> 18] + ALPHA[(n >> 12) & 63] + ALPHA[(n >> 6) & 63] + ALPHA[n & 63];
  }
  if (i < u.length) {
    const n = (u[i] << 16) | ((i + 1 < u.length ? u[i + 1] : 0) << 8);
    out += ALPHA[n >> 18] + ALPHA[(n >> 12) & 63] + (i + 1 < u.length ? ALPHA[(n >> 6) & 63] : '=') + '=';
  }
  return out;
}
export function base64ToBytes(s: string): Uint8Array {
  const len = s.length;
  if (len % 4 !== 0 || !B64_RE.test(s)) throw new Error('base64');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((len / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = REV[s.charCodeAt(i)], b = REV[s.charCodeAt(i + 1)];
    const c = s[i + 2] === '=' ? 0 : REV[s.charCodeAt(i + 2)], d = s[i + 3] === '=' ? 0 : REV[s.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

export interface SaveChunk { id: string; name: string; size: number; i: number; n: number; data: string }
export type ChunkParse = { ok: true; chunk: SaveChunk } | { ok: false; id: string | null; reason: ProjectErrorReason } | null;

/** null : message étranger ; sinon morceau validé (forme seulement) ou raison du refus. */
export function parseSaveChunk(msg: unknown): ChunkParse {
  if (!msg || typeof msg !== 'object' || (msg as { type?: unknown }).type !== 'project:save') return null;
  const m = msg as Record<string, unknown>;
  const id = typeof m.id === 'string' && ID_RE.test(m.id) ? m.id : null;
  if (!id) return { ok: false, id: null, reason: 'bad-chunk' };
  const { i, n, size, data } = m;
  if (typeof size === 'number' && size > PROJECT_MAX_BYTES) return { ok: false, id, reason: 'too-large' };
  if (!Number.isInteger(i) || !Number.isInteger(n) || !Number.isInteger(size)) return { ok: false, id, reason: 'bad-chunk' };
  const ii = i as number, nn = n as number, sz = size as number;
  if (nn < 1 || nn > PROJECT_MAX_CHUNKS || ii < 0 || ii >= nn || sz < 0) return { ok: false, id, reason: 'bad-chunk' };
  if (typeof data !== 'string' || data.length > PROJECT_CHUNK || data.length % 4 !== 0 || !B64_RE.test(data)) return { ok: false, id, reason: 'bad-chunk' };
  if (ii < nn - 1 && data.endsWith('=')) return { ok: false, id, reason: 'bad-chunk' };
  return { ok: true, chunk: { id, name: projectFileName(m.name), size: sz, i: ii, n: nn, data } };
}

/** Script injecté : message remis à window.SRNative.receive. */
export function projectScript(msg: Record<string, unknown>): string {
  return 'window.SRNative&&window.SRNative.receive(' + JSON.stringify(msg) + ');true;';
}

/** Fichier temporaire écrit par morceaux (expo-file-system, File.write en base64, append). */
export interface TempFile {
  write(base64: string, append: boolean): void;
  readonly uri: string;
  readonly size: number;
  delete(): void;
}
/** Fichier choisi, lu par morceaux (FileHandle.readBytes). */
export interface PickedFile {
  readonly name: string;
  readonly size: number;
  read(length: number): Uint8Array;
  close(): void;
}
export interface ProjectBridgeOptions {
  /** Fichier temporaire du nom donné (remplace l'ancien) ; null : indisponible. */
  createTemp: (name: string) => TempFile | null;
  /** Feuille de partage ; null : expo-sharing absent. */
  loadShare: () => ((uri: string, opts: { mimeType: string; UTI: string; dialogTitle: string }) => Promise<void>) | null;
  /** Sélecteur de fichier : null = annulé ; lève si indisponible. */
  pick: () => Promise<PickedFile | null>;
  inject: (script: string) => void;
  /** Laisse respirer la vue web entre deux morceaux (setTimeout 0 par défaut). */
  tick?: () => Promise<void>;
}
export interface ProjectBridge {
  /** true si le message était pour ce pont (traité ou refusé). */
  handle(msg: unknown): boolean;
}

export function createProjectBridge(opts: ProjectBridgeOptions): ProjectBridge {
  const send = (m: Record<string, unknown>) => { try { opts.inject(projectScript(m)); } catch { /* vue web absente */ } };
  const fail = (id: string | null, reason: ProjectErrorReason) => { if (id) send({ type: 'project:error', id, reason }); };
  const tick = opts.tick || (() => new Promise<void>((r) => setTimeout(r, 0)));
  let save: { id: string; n: number; next: number; size: number; file: TempFile } | null = null;
  let opening = false;

  async function finish(id: string, file: TempFile) {
    let share = null;
    try { share = opts.loadShare(); } catch { share = null; }
    if (!share) { fail(id, 'unavailable'); return; }
    try {
      await share(file.uri, { mimeType: PROJECT_MIME, UTI: PROJECT_UTI, dialogTitle: 'SetRemote' });
      send({ type: 'project:saved', id, ok: true, shared: true });
    } catch {
      fail(id, 'share-failed');
    }
  }
  function onSave(c: SaveChunk) {
    if (c.i === 0) {
      let file: TempFile | null = null;
      try { file = opts.createTemp(c.name); } catch { file = null; }
      if (!file) { save = null; fail(c.id, 'write-failed'); return; }
      save = { id: c.id, n: c.n, next: 0, size: c.size, file };
    }
    const s = save;
    if (!s || s.id !== c.id || s.next !== c.i || s.n !== c.n) { fail(c.id, 'bad-chunk'); return; }
    try { s.file.write(c.data, c.i > 0); } catch { save = null; fail(c.id, 'write-failed'); return; }
    s.next++;
    if (s.next < s.n) return;
    save = null;
    if (s.file.size !== s.size) { fail(c.id, 'bad-chunk'); return; }
    void finish(c.id, s.file);
  }
  async function onOpen(id: string) {
    if (opening) { fail(id, 'unavailable'); return; }
    opening = true;
    let f: PickedFile | null = null;
    try {
      try { f = await opts.pick(); } catch { fail(id, 'unavailable'); return; }
      if (!f) { send({ type: 'project:file', id, cancelled: true }); return; }
      if (f.size > PROJECT_MAX_BYTES) { fail(id, 'too-large'); return; }
      const n = Math.max(1, Math.ceil(f.size / PROJECT_CHUNK_BYTES));
      const name = projectFileName(f.name);
      for (let i = 0; i < n; i++) {
        let bytes: Uint8Array;
        try { bytes = f.read(Math.min(PROJECT_CHUNK_BYTES, f.size - i * PROJECT_CHUNK_BYTES)); } catch { fail(id, 'read-failed'); return; }
        send({ type: 'project:file', id, name, size: f.size, i, n, data: bytesToBase64(bytes) });
        await tick();
      }
    } finally {
      try { f?.close(); } catch { /* déjà fermé */ }
      opening = false;
    }
  }
  return {
    handle(msg: unknown): boolean {
      const r = parseSaveChunk(msg);
      if (r) {
        if (!r.ok) { if (save && save.id === r.id) save = null; fail(r.id, r.reason); } else onSave(r.chunk);
        return true;
      }
      if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'project:open') {
        const id = (msg as { id?: unknown }).id;
        if (typeof id === 'string' && ID_RE.test(id)) void onOpen(id);
        return true;
      }
      return false;
    },
  };
}
