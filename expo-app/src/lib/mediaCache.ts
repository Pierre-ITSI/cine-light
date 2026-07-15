/**
 * Cache média local de l'écran projecteur.
 *
 * Écrit les fichiers reçus dans le répertoire de cache de l'app via la
 * nouvelle API expo-file-system (File / Directory / Paths), et tient un
 * manifeste persistant (mediaId → chemin + mime + date) pour retrouver
 * instantanément un média déjà transféré sans le redemander.
 *
 * Indisponible sur le web (pas d'accès fichier natif) : les méthodes y sont
 * des no-op et `isAvailable` vaut false.
 */
import { Platform } from 'react-native';
import { extensionFor, MediaKind } from './mediaTypes';

export const isMediaCacheAvailable = Platform.OS !== 'web';

export interface CachedMedia {
  mediaId: string;
  kind: MediaKind;
  mime: string;
  uri: string;
  date: number;
}

const MEDIA_DIRNAME = 'setremote-media';
const MANIFEST_NAME = 'manifest.json';

// Import paresseux : expo-file-system n'est pas chargé sur web.
type FS = typeof import('expo-file-system');
let _fs: FS | null = null;
function fs(): FS {
  if (!_fs) _fs = require('expo-file-system') as FS;
  return _fs as FS;
}

function mediaDir() {
  const { Directory, Paths } = fs();
  return new Directory(Paths.cache, MEDIA_DIRNAME);
}

function ensureDir() {
  const dir = mediaDir();
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function manifestFile() {
  const { File, Paths } = fs();
  return new File(Paths.cache, MEDIA_DIRNAME, MANIFEST_NAME);
}

function loadManifest(): Record<string, CachedMedia> {
  if (!isMediaCacheAvailable) return {};
  try {
    const f = manifestFile();
    if (!f.exists) return {};
    return JSON.parse(f.textSync()) as Record<string, CachedMedia>;
  } catch (_) {
    return {};
  }
}

function saveManifest(m: Record<string, CachedMedia>) {
  if (!isMediaCacheAvailable) return;
  try {
    ensureDir();
    manifestFile().write(JSON.stringify(m));
  } catch (_) {}
}

let _manifest: Record<string, CachedMedia> | null = null;
function manifest(): Record<string, CachedMedia> {
  if (!_manifest) _manifest = loadManifest();
  return _manifest;
}

/** Réception en cours : buffers de chunks indexés par mediaId. */
interface Pending {
  kind: MediaKind;
  mime: string;
  totalChunks: number;
  chunks: (string | undefined)[];
  received: number;
}
const pending = new Map<string, Pending>();

export function hasMedia(mediaId: string): boolean {
  return !!manifest()[mediaId];
}

export function getMedia(mediaId: string): CachedMedia | null {
  return manifest()[mediaId] || null;
}

export function listMedia(): CachedMedia[] {
  return Object.values(manifest()).sort((a, b) => b.date - a.date);
}

/** Démarre la réception d'un média. Renvoie true si déjà en cache (rien à faire). */
export function beginUpload(
  mediaId: string,
  kind: MediaKind,
  mime: string,
  totalChunks: number,
): boolean {
  if (!isMediaCacheAvailable) return false;
  if (hasMedia(mediaId)) return true;
  pending.set(mediaId, { kind, mime, totalChunks, chunks: new Array(totalChunks), received: 0 });
  return false;
}

/**
 * Stocke un chunk. Quand tous les chunks sont là, écrit le fichier en cache,
 * met à jour le manifeste et renvoie le CachedMedia (sinon null).
 */
export function addChunk(mediaId: string, index: number, data: string): CachedMedia | null {
  const p = pending.get(mediaId);
  if (!p) return null;
  if (p.chunks[index] === undefined) {
    p.chunks[index] = data;
    p.received++;
  }
  if (p.received < p.totalChunks) return null;

  // Tous les chunks reçus → écrire le fichier.
  const { File } = fs();
  ensureDir();
  const ext = extensionFor(p.mime, p.kind);
  const file = new File(mediaDir(), mediaId + '.' + ext);
  if (file.exists) file.delete();
  file.create();
  file.write(p.chunks.join(''), { encoding: 'base64' });

  const entry: CachedMedia = {
    mediaId, kind: p.kind, mime: p.mime, uri: file.uri, date: Date.now(),
  };
  manifest()[mediaId] = entry;
  saveManifest(manifest());
  pending.delete(mediaId);
  return entry;
}

export function clearMedia(mediaId: string) {
  if (!isMediaCacheAvailable) return;
  if (mediaId === 'all') {
    const { File } = fs();
    for (const e of Object.values(manifest())) {
      try { const f = new File(e.uri); if (f.exists) f.delete(); } catch (_) {}
    }
    _manifest = {};
    saveManifest(_manifest);
    pending.clear();
    return;
  }
  const e = manifest()[mediaId];
  if (e) {
    try { const { File } = fs(); const f = new File(e.uri); if (f.exists) f.delete(); } catch (_) {}
    delete manifest()[mediaId];
    saveManifest(manifest());
  }
  pending.delete(mediaId);
}
