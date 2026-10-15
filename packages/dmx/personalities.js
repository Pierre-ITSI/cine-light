// Fixture personalities ("modes") a console programmer patches for a SetRemote screen,
// and decoding of a DMX slice into a Look the screen can apply.
//
// The tables below are the single source of truth for docs/DMX.md (the fixture manual).
// A Look is a plain object:
//   {
//     color:    '#rrggbb'                       already dimmed, tint and crossfade applied
//     strobe:   { active, freq (Hz), dur (ms) }  freq ≤ 30 Hz, dur ≥ 15 ms
//     effect:   { name, speed, intensity, color? } | null   intensity already × dimmer (0–100)
//     media:    { index (1–255), action } | null            null = no media shown
//     blackout: boolean
//   }

import { dmxToKelvin, dmxToTint, hsvToRgb, mixColor, rgbToHex } from './color.js';

/** Strobe frequency limits (Hz). 30 Hz is the product cap (and the screens' network cap). */
export const STROBE_FREQ_MIN = 0.5;
export const STROBE_FREQ_MAX = 30;
/** Flash duration limits (ms). 15 ms is the screens' minimum (web/js/22-protocol.js). */
export const STROBE_DUR_MIN = 15;
export const STROBE_DUR_MAX = 500;
const STROBE_DUR_AUTO_MAX = 50;

/**
 * App effects (web/js/50-effects-remote.js, EFFECT_CONFIG): speed range in the
 * effect's own unit and its default. Order = DMX order on the Effect select channel.
 */
export const EFFECTS = Object.freeze([
  { name: 'chaser', label: 'Chaser', min: 0.1, max: 6, def: 1, unit: 'vitesse' },
  { name: 'noise', label: 'Noise', min: 1, max: 30, def: 12, unit: 'img/s' },
  { name: 'aurora', label: 'Aurora', min: 0.05, max: 2, def: 0.3, unit: 'dérive' },
  { name: 'water', label: 'Caustiques', min: 0.1, max: 3, def: 0.8, unit: 'vitesse' },
  { name: 'pulse', label: 'Pulse BPM', min: 20, max: 240, def: 60, unit: 'BPM' },
  { name: 'traffic', label: 'Phares', min: 0.05, max: 2, def: 0.3, unit: 'passages/s' },
  { name: 'weld', label: 'Soudure', min: 0.2, max: 6, def: 1.5, unit: 'cadence' },
  { name: 'neon', label: 'Néon HS', min: 0.2, max: 6, def: 1.5, unit: 'nervosité' },
  { name: 'police', label: 'Police', min: 0.5, max: 8, def: 3, unit: 'alternances' },
  { name: 'lightning', label: 'Éclair', min: 0.1, max: 3, def: 0.8, unit: 'fréquence' },
  { name: 'paparazzi', label: 'Paparazzi', min: 0.2, max: 4, def: 1, unit: 'rafales/s' },
  { name: 'tv', label: 'TV', min: 0.5, max: 15, def: 4, unit: 'img/s' },
  { name: 'candle', label: 'Bougie', min: 0.2, max: 5, def: 1.2, unit: 'vacillement' },
  { name: 'fire', label: 'Feu', min: 0.5, max: 10, def: 3, unit: 'intensité rapide' },
]);
export const EFFECT_NAMES = Object.freeze(EFFECTS.map((e) => e.name));

/** Media control actions, in DMX order. */
export const MEDIA_ACTIONS = Object.freeze(['stop', 'play', 'pause', 'restart']);

/**
 * @typedef {object} ChannelRange
 * @property {number} from   first DMX value (inclusive)
 * @property {number} to     last DMX value (inclusive)
 * @property {string} label  what the range does (French, as printed in the manual)
 */

/**
 * @typedef {object} ChannelDef
 * @property {number} n          channel number inside the footprint (1-based)
 * @property {string} key        attribute key
 * @property {string} label      short console-style name
 * @property {number} default    home value
 * @property {ChannelRange[]} ranges  contiguous, covering 0–255
 */

/**
 * @typedef {object} Personality
 * @property {string} id
 * @property {string} name
 * @property {number} footprint
 * @property {ChannelDef[]} channels
 */

const full = (label) => [{ from: 0, to: 255, label }];

const DIMMER = { key: 'dimmer', label: 'Dimmer', default: 0, ranges: full('0 → 100 %, linéaire') };
const CCT = {
  key: 'cct', label: 'CCT', default: 54,
  ranges: full('1700 → 20000 K : K = round(1700 + v/255 × 18300) — 54 ≈ 5575 K, 21 ≈ 3207 K'),
};
const TINT = {
  key: 'tint', label: 'Tint +/-G', default: 128,
  ranges: [
    { from: 0, to: 126, label: 'Magenta −100 → −0,8 (0 = magenta max)' },
    { from: 127, to: 128, label: 'Neutre (0)' },
    { from: 129, to: 255, label: 'Vert +0,8 → +100 (255 = vert max)' },
  ],
};
const STROBE = {
  key: 'strobe', label: 'Strobe', default: 0,
  ranges: [
    { from: 0, to: 0, label: 'Pas de strobe' },
    { from: 1, to: 255, label: 'Strobe 0,5 → 30 Hz : f = 0,5 + (v−1) × 29,5/254' },
  ],
};
const STROBE_DUR = {
  key: 'strobeDur', label: 'Strobe durée', default: 0,
  ranges: [
    { from: 0, to: 0, label: 'Auto : min(50 ms, demi-période), ≥ 15 ms' },
    { from: 1, to: 255, label: 'Flash 15 → 500 ms : d = 15 + (v−1) × 485/254 (≤ période − 5 ms)' },
  ],
};

const EFFECT_SELECT_RANGES = (() => {
  const r = [{ from: 0, to: 15, label: 'Aucun effet' }];
  EFFECTS.forEach((e, i) => r.push({ from: 16 * (i + 1), to: 16 * (i + 1) + 15, label: e.label + ' (' + e.name + ')' }));
  r.push({ from: 240, to: 255, label: 'Réservé (aucun effet)' });
  return r;
})();

/** @type {Readonly<Record<string, Personality>>} */
export const PERSONALITIES = Object.freeze({
  simple3: {
    id: 'simple3',
    name: 'Simple 3 canaux (compatible ancien mode 3CH)',
    footprint: 3,
    channels: [
      { n: 1, ...DIMMER },
      { n: 2, ...CCT },
      { n: 3, ...TINT },
    ],
  },
  standard8: {
    id: 'standard8',
    name: 'Standard 8 canaux',
    footprint: 8,
    channels: [
      { n: 1, key: 'dimmer', label: 'Dimmer', default: 0, ranges: full('0 → 100 % (octet fort du 16 bits)') },
      { n: 2, key: 'dimmerFine', label: 'Dimmer fin', default: 0, ranges: full('Octet faible du 16 bits') },
      { n: 3, ...CCT },
      { n: 4, ...TINT },
      {
        n: 5, key: 'crossfade', label: 'Crossfade', default: 0,
        ranges: full('0 = blanc (CCT + tint) → 255 = couleur (teinte + saturation)'),
      },
      { n: 6, key: 'hue', label: 'Teinte', default: 0, ranges: full('0 → 360° : h = v/255 × 360 (0 et 255 = rouge)') },
      { n: 7, key: 'saturation', label: 'Saturation', default: 255, ranges: full('0 = blanc → 255 = couleur pure') },
      { n: 8, ...STROBE },
    ],
  },
  rgb6: {
    id: 'rgb6',
    name: 'RGB 6 canaux',
    footprint: 6,
    channels: [
      { n: 1, key: 'red', label: 'Rouge', default: 255, ranges: full('0 → 255') },
      { n: 2, key: 'green', label: 'Vert', default: 255, ranges: full('0 → 255') },
      { n: 3, key: 'blue', label: 'Bleu', default: 255, ranges: full('0 → 255') },
      { n: 4, ...DIMMER },
      { n: 5, ...STROBE },
      { n: 6, ...STROBE_DUR },
    ],
  },
  extended16: {
    id: 'extended16',
    name: 'Étendu 16 canaux',
    footprint: 16,
    channels: [
      { n: 1, key: 'dimmer', label: 'Dimmer', default: 0, ranges: full('0 → 100 % (octet fort du 16 bits), maître des effets aussi') },
      { n: 2, key: 'dimmerFine', label: 'Dimmer fin', default: 0, ranges: full('Octet faible du 16 bits') },
      { n: 3, ...CCT },
      { n: 4, ...TINT },
      { n: 5, key: 'crossfade', label: 'Crossfade', default: 0, ranges: full('0 = blanc (CCT + tint) → 255 = couleur') },
      { n: 6, key: 'hue', label: 'Teinte', default: 0, ranges: full('0 → 360°') },
      { n: 7, key: 'saturation', label: 'Saturation', default: 255, ranges: full('0 = blanc → 255 = couleur pure') },
      { n: 8, ...STROBE },
      { n: 9, key: 'effect', label: 'Effet', default: 0, ranges: EFFECT_SELECT_RANGES },
      {
        n: 10, key: 'effectSpeed', label: 'Effet vitesse', default: 0,
        ranges: [
          { from: 0, to: 0, label: 'Vitesse par défaut de l\'effet' },
          { from: 1, to: 255, label: 'min → max de l\'effet : s = min + (v−1)/254 × (max − min)' },
        ],
      },
      { n: 11, key: 'effectIntensity', label: 'Effet intensité', default: 255, ranges: full('0 → 100 % (× Dimmer)') },
      {
        n: 12, key: 'media', label: 'Média', default: 0,
        ranges: [
          { from: 0, to: 0, label: 'Aucun média' },
          { from: 1, to: 255, label: 'Élément n° v du pool média (ordre du pool)' },
        ],
      },
      {
        n: 13, key: 'mediaControl', label: 'Média contrôle', default: 0,
        ranges: [
          { from: 0, to: 63, label: 'Stop (média masqué, retour au début)' },
          { from: 64, to: 127, label: 'Lecture' },
          { from: 128, to: 191, label: 'Pause' },
          { from: 192, to: 255, label: 'Redémarrer (au passage dans la plage) puis lecture' },
        ],
      },
      {
        n: 14, key: 'screen', label: 'Écran', default: 0,
        ranges: [
          { from: 0, to: 127, label: 'Normal' },
          { from: 128, to: 255, label: 'Blackout (tout noir, média et effet compris)' },
        ],
      },
      { n: 15, ...STROBE_DUR },
      {
        n: 16, key: 'effectColor', label: 'Effet couleur', default: 0,
        ranges: [
          { from: 0, to: 127, label: 'Couleurs propres de l\'effet' },
          { from: 128, to: 255, label: 'Couleur de la fixture (canaux 3–7) comme couleur principale de l\'effet' },
        ],
      },
    ],
  },
});

export const PERSONALITY_IDS = Object.freeze(Object.keys(PERSONALITIES));

/**
 * @param {string} id
 * @returns {Personality | null}
 */
export function getPersonality(id) {
  return Object.prototype.hasOwnProperty.call(PERSONALITIES, id) ? PERSONALITIES[id] : null;
}

/** Number of DMX channels used by a personality (0 if unknown). */
export function footprint(id) {
  const p = getPersonality(id);
  return p ? p.footprint : 0;
}

/** Home values of a personality, as a slice (useful for tests and for a "home" button). */
export function defaultSlice(id) {
  const p = getPersonality(id);
  return p ? Uint8Array.from(p.channels.map((c) => c.default)) : new Uint8Array(0);
}

const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;

/** Strobe channel → { active, freq, dur }. durValue = null when the personality has no duration channel. */
export function decodeStrobe(rateValue, durValue) {
  if (!rateValue) return { active: false, freq: 0, dur: 0 };
  const freq = Math.min(STROBE_FREQ_MAX, round2(STROBE_FREQ_MIN + (rateValue - 1) * (STROBE_FREQ_MAX - STROBE_FREQ_MIN) / 254));
  const period = 1000 / freq;
  let dur;
  if (!durValue) dur = Math.min(STROBE_DUR_AUTO_MAX, Math.round(period / 2));
  else dur = Math.round(STROBE_DUR_MIN + (durValue - 1) * (STROBE_DUR_MAX - STROBE_DUR_MIN) / 254);
  // Keep the requested frequency honest: the screen waits max(dur + 5, period) between flashes.
  dur = Math.max(STROBE_DUR_MIN, Math.min(dur, Math.floor(period - 5)));
  return { active: true, freq, dur };
}

/** Effect select value → EFFECTS entry or null. */
export function effectFromDmx(v) {
  const i = (v >> 4) - 1;
  return i >= 0 && i < EFFECTS.length ? EFFECTS[i] : null;
}

/** Media control value → action. */
export function mediaActionFromDmx(v) {
  return MEDIA_ACTIONS[v >> 6];
}

const BLANK_STROBE = Object.freeze({ active: false, freq: 0, dur: 0 });

function wheelFromHueSat(hueV, satV) {
  return hsvToRgb((hueV / 255) * 360, satV / 255, 1);
}

/**
 * Decode a fixture's DMX slice into a Look.
 * @param {string | Personality} personality  id or definition
 * @param {ArrayLike<number>} slice  the fixture's channels (index 0 = its start address);
 *   missing channels read as 0
 * @returns {import('./messages.js').Look}
 */
export function decode(personality, slice) {
  const p = typeof personality === 'string' ? getPersonality(personality) : personality;
  if (!p) throw new RangeError('Unknown personality: ' + personality);
  const ch = (n) => {
    const v = slice[n - 1];
    return typeof v === 'number' && v >= 0 && v <= 255 ? v | 0 : 0;
  };

  switch (p.id) {
    case 'simple3':
      // Identical to the legacy 3ch decoding (screenApplyDmx / dmxKelvinGM).
      return {
        color: mixColor({ kelvin: dmxToKelvin(ch(2)), gm: dmxToTint(ch(3)), dimmer: ch(1) / 255 }),
        strobe: BLANK_STROBE, effect: null, media: null, blackout: false,
      };

    case 'rgb6': {
      const f = ch(4) / 255;
      return {
        color: rgbToHex(ch(1) * f, ch(2) * f, ch(3) * f),
        strobe: decodeStrobe(ch(5), ch(6)),
        effect: null, media: null, blackout: false,
      };
    }

    case 'standard8':
    case 'extended16': {
      const dimmer = ((ch(1) << 8) | ch(2)) / 65535;
      const kelvin = dmxToKelvin(ch(3));
      const gm = dmxToTint(ch(4));
      const crossfade = ch(5) / 255;
      const wheel = wheelFromHueSat(ch(6), ch(7));
      const color = mixColor({ kelvin, gm, wheel, crossfade, dimmer });
      if (p.id === 'standard8') {
        return { color, strobe: decodeStrobe(ch(8), null), effect: null, media: null, blackout: false };
      }
      const fx = effectFromDmx(ch(9));
      let effect = null;
      if (fx) {
        const sv = ch(10);
        effect = {
          name: fx.name,
          speed: sv === 0 ? fx.def : round3(fx.min + ((sv - 1) / 254) * (fx.max - fx.min)),
          intensity: Math.round((ch(11) / 255) * dimmer * 100),
        };
        if (ch(16) >= 128) effect.color = mixColor({ kelvin, gm, wheel, crossfade, dimmer: 1 });
      }
      const mediaIndex = ch(12);
      return {
        color,
        strobe: decodeStrobe(ch(8), ch(15)),
        effect,
        media: mediaIndex ? { index: mediaIndex, action: mediaActionFromDmx(ch(13)) } : null,
        blackout: ch(14) >= 128,
      };
    }

    default:
      throw new RangeError('Personality without decoder: ' + p.id);
  }
}
