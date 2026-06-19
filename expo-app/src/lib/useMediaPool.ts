/**
 * Pool Média côté télécommande.
 *
 * Gère la sélection d'un média, son transfert À L'AVANCE (chunké en base64
 * via le RemoteTransport), le suivi de l'accusé de réception (media:ready)
 * envoyé par l'écran, et les commandes play/stop/clear.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MEDIA_CHUNK_SIZE, MediaKind, extensionFor, newMediaId } from './mediaTypes';
import type { RemoteTransport } from '../transport/RemoteTransport';

export type MediaStatus = 'uploading' | 'ready' | 'error';

export interface RemoteMediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  mime: string;
  status: MediaStatus;
  progress: number; // 0..1
}

async function readBase64(uri: string, fromPicker?: string | null): Promise<string> {
  if (fromPicker) return fromPicker;
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  const { File } = require('expo-file-system') as typeof import('expo-file-system');
  return new File(uri).base64();
}

export function useMediaPool(transport: RemoteTransport, enabled: boolean) {
  const [items, setItems] = useState<RemoteMediaItem[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const update = useCallback((id: string, patch: Partial<RemoteMediaItem>) => {
    setItems(list => list.map(it => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  // Accusés de réception de l'écran.
  useEffect(() => {
    transport.onMessage(msg => {
      if (msg.type === 'media:ready' && typeof msg.mediaId === 'string') {
        update(msg.mediaId, { status: 'ready', progress: 1 });
      }
    });
  }, [transport, update]);

  const sendChunks = useCallback(async (id: string, base64: string) => {
    const total = Math.ceil(base64.length / MEDIA_CHUNK_SIZE);
    for (let i = 0; i < total; i++) {
      transport.send({
        type: 'media:chunk',
        mediaId: id,
        index: i,
        data: base64.slice(i * MEDIA_CHUNK_SIZE, (i + 1) * MEDIA_CHUNK_SIZE),
      });
      update(id, { progress: (i + 1) / total });
      // Laisser respirer le broker entre les lots.
      if (i % 16 === 15) await new Promise(r => setTimeout(r, 8));
    }
  }, [transport, update]);

  const pickAndUpload = useCallback(async (kind: MediaKind) => {
    if (!enabled) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'video' ? 'videos' : 'images',
      quality: 0.8,
      base64: kind === 'image',
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const mime = asset.mimeType || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
    const id = newMediaId();
    const name = asset.fileName || (kind === 'video' ? 'Vidéo' : 'Image') + ' ' + (items.length + 1);

    setItems(list => [...list, { id, kind, name, mime, status: 'uploading', progress: 0 }]);

    try {
      const base64 = await readBase64(asset.uri, asset.base64);
      const total = Math.ceil(base64.length / MEDIA_CHUNK_SIZE);
      transport.send({ type: 'media:upload', mediaId: id, kind, mime, totalChunks: total });
      await sendChunks(id, base64);
    } catch (_) {
      update(id, { status: 'error' });
    }
  }, [enabled, items.length, transport, sendChunks, update]);

  const play = useCallback((id: string) => {
    transport.send({ type: 'media:play', mediaId: id });
    setPlayingId(id);
  }, [transport]);

  const stop = useCallback(() => {
    transport.send({ type: 'media:stop' });
    setPlayingId(null);
  }, [transport]);

  const clear = useCallback((id: string) => {
    transport.send({ type: 'media:clear', mediaId: id });
    setItems(list => list.filter(it => it.id !== id));
    setPlayingId(p => (p === id ? null : p));
  }, [transport]);

  return { items, playingId, pickAndUpload, play, stop, clear };
}
