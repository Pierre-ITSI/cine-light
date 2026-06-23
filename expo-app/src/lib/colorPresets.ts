/**
 * Mémoires de couleur (presets) de la télécommande.
 *
 * Enregistre l'intégralité d'un état couleur (kelvin, tint, dimmer, roue,
 * crossfade) sous un nom, de façon persistante. Sur natif, on écrit un JSON
 * dans le répertoire « document » (non purgé par le système) via la nouvelle
 * API expo-file-system ; sur web, on retombe sur localStorage.
 */
import { Platform } from 'react-native';
import type { ColorSpec } from './color';

export interface ColorPreset {
  id: string;
  name: string;
  spec: ColorSpec;
}

const DIRNAME = 'cinelight';
const FILENAME = 'color-presets.json';
const WEB_KEY = 'cinelight-color-presets';
const isNative = Platform.OS !== 'web';

// Import paresseux : expo-file-system n'est pas chargé sur web.
type FS = typeof import('expo-file-system');
let _fs: FS | null = null;
function fs(): FS {
  if (!_fs) _fs = require('expo-file-system') as FS;
  return _fs as FS;
}

function presetsDir() {
  const { Directory, Paths } = fs();
  return new Directory(Paths.document, DIRNAME);
}

function presetsFile() {
  const { File, Paths } = fs();
  return new File(Paths.document, DIRNAME, FILENAME);
}

export function newPresetId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function loadPresets(): ColorPreset[] {
  try {
    if (isNative) {
      const f = presetsFile();
      if (!f.exists) return [];
      const parsed = JSON.parse(f.textSync());
      return Array.isArray(parsed) ? (parsed as ColorPreset[]) : [];
    }
    const raw = (globalThis as any).localStorage?.getItem(WEB_KEY);
    return raw ? (JSON.parse(raw) as ColorPreset[]) : [];
  } catch (_) {
    return [];
  }
}

export function savePresets(list: ColorPreset[]) {
  try {
    if (isNative) {
      const dir = presetsDir();
      if (!dir.exists) dir.create({ intermediates: true });
      presetsFile().write(JSON.stringify(list));
    } else {
      (globalThis as any).localStorage?.setItem(WEB_KEY, JSON.stringify(list));
    }
  } catch (_) {}
}
