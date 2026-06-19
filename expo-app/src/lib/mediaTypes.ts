/**
 * Pool Média — types et constantes partagés télécommande / écran projecteur.
 *
 * Protocole (étend le protocole WS existant) :
 *   { type:'media:upload', mediaId, kind, mime, totalChunks }
 *   { type:'media:chunk',  mediaId, index, data }   // data = base64
 *   { type:'media:ready',  mediaId }                // écran → télécommande
 *   { type:'media:play',   mediaId }
 *   { type:'media:stop' }                            // masque le média, revient à la lumière
 *   { type:'media:clear',  mediaId }                 // mediaId='all' pour tout vider
 *
 * Le transfert se fait À L'AVANCE (dès la sélection). La lecture pendant la
 * prise (media:play) est instantanée : elle lit un fichier déjà en cache.
 */

export type MediaKind = 'image' | 'video';

// Taille d'un chunk base64 (caractères). ~12 Ko comme la PWA → sûr pour MQTT.
export const MEDIA_CHUNK_SIZE = 12000;

export interface MediaUploadMsg {
  type: 'media:upload';
  mediaId: string;
  kind: MediaKind;
  mime: string;
  totalChunks: number;
}

export interface MediaChunkMsg {
  type: 'media:chunk';
  mediaId: string;
  index: number;
  data: string;
}

export function extensionFor(mime: string, kind: MediaKind): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
  };
  return map[mime] || (kind === 'video' ? 'mp4' : 'jpg');
}

export function newMediaId(): string {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}
