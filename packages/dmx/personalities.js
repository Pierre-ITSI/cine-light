// Fixture personalities ("modes") a console programmer patches for a SetRemote
// screen, and decoding of a DMX slice into a Look the screen can apply.
// These tables are the source of truth for docs/DMX.md (the fixture manual).
//
// A Look is a plain object:
//   {
//     color:    '#rrggbb'                        already dimmed, colour/white mix applied
//     strobe:   { active, freq (Hz), dur (ms) }   0.5–30 Hz, flash ≥ 15 ms
//     effect:   { name, speed, intensity } | null intensity (0–100) = Dimmer, the master
//     media:    { index (1–25), playback } | null null = media hidden
//     blackout: boolean
//   }
// Effect select and Media select keep their last choice on "no change" values,
// and Call/SMS are edge-triggered, so decoding is stateful: use FixtureDecoder
// (one per screen). decode() is the stateless shortcut for a single frame.

import { dmxToKelvin, dmxToTint, mixColor, rgbToHex } from './color.js';

/** Strobe frequency limits (Hz). 30 Hz is a hard cap. */
export const STROBE_FREQ_MIN = 0.5;
export const STROBE_FREQ_MAX = 30;
/** Flash duration: automatic, min(50 ms, half period), never under 15 ms (screens' minimum). */
export const STROBE_DUR_MIN = 15;
export const STROBE_DUR_AUTO_MAX = 50;

/**
 * App effects in the order of web/js/50-effects-remote.js (EFFECT_CONFIG), with
 * their speed range (effect's own unit) — the order is the DMX slot order.
 */
export const EFFECTS = Object.freeze([
  { name: 'chaser', label: 'Chaser', min: 0.1, max: 6, unit: 'vitesse' },
  { name: 'noise', label: 'Noise', min: 1, max: 30, unit: 'img/s' },
  { name: 'aurora', label: 'Aurora', min: 0.05, max: 2, unit: 'dérive' },
  { name: 'water', label: 'Caustiques', min: 0.1, max: 3, unit: 'vitesse' },
  { name: 'pulse', label: 'Pulse BPM', min: 20, max: 240, unit: 'BPM' },
  { name: 'traffic', label: 'Phares', min: 0.05, max: 2, unit: 'passages/s' },
  { name: 'weld', label: 'Soudure', min: 0.2, max: 6, unit: 'cadence' },
  { name: 'neon', label: 'Néon HS', min: 0.2, max: 6, unit: 'nervosité' },
  { name: 'police', label: 'Police', min: 0.5, max: 8, unit: 'alternances/s' },
  { name: 'lightning', label: 'Éclair', min: 0.1, max: 3, unit: 'fréquence' },
  { name: 'paparazzi', label: 'Paparazzi', min: 0.2, max: 4, unit: 'rafales/s' },
  { name: 'tv', label: 'TV', min: 0.5, max: 15, unit: 'img/s' },
  { name: 'candle', label: 'Bougie', min: 0.2, max: 5, unit: 'vacillement' },
  { name: 'fire', label: 'Feu', min: 0.5, max: 10, unit: 'intensité rapide' },
]);
export const EFFECT_NAMES = Object.freeze(EFFECTS.map((e) => e.name));

/** Number of selectable items per slot channel. */
export const MEDIA_ITEMS = 25;
export const CALL_ITEMS = 20;
export const SMS_ITEMS = 20;

/** Playback channel ranges, in DMX order. */
export const PLAYBACK = Object.freeze(['play', 'pause', 'loop', 'rewind']);

/**
 * Slot convention shared by Effect select, Media select, Call and SMS:
 * 0 → 0; n×10 … n×10+9 → n (1 ≤ n ≤ items); 1–9 and values above the last item → null ("no change").
 * @param {number} v DMX value
 * @param {number} items number of items
 * @returns {number | null}
 */
export function slotOf(v, items) {
  if (v === 0) return 0;
  const n = Math.floor(v / 10);
  return n >= 1 && n <= items ? n : null;
}

/**
 * @typedef {object} ChannelRange
 * @property {number} from  first DMX value (inclusive)
 * @property {number} to    last DMX value (inclusive)
 * @property {string} label what the range does (French, as printed in the manual)
 */

/**
 * @typedef {object} ChannelDef
 * @property {number} n         channel offset from the start address (1-based)
 * @property {string} key       attribute key
 * @property {string} label     console-style name (French)
 * @property {number} default   home value
 * @property {ChannelRange[]} ranges contiguous, covering 0–255
 */

/**
 * @typedef {object} Personality
 * @property {string} id
 * @property {string} name
 * @property {number} footprint
 * @property {ChannelDef[]} channels
 */

const full = (label) => [{ from: 0, to: 255, label }];

function slotRanges(items, itemLabel, zeroLabel) {
  const r = [{ from: 0, to: 0, label: zeroLabel }, { from: 1, to: 9, label: 'Pas de changement' }];
  for (let n = 1; n <= items; n++) {
    r.push({ from: n * 10, to: Math.min(255, n * 10 + 9), label: itemLabel(n) });
  }
  if (items * 10 + 10 <= 255) r.push({ from: items * 10 + 10, to: 255, label: 'Pas de changement' });
  return r;
}

const DIMMER = { key: 'dimmer', label: 'Dimmer', default: 0, ranges: full('0 → 100 %, linéaire') };
const red = (def) => ({ key: 'red', label: 'Rouge', default: def, ranges: full('0 → 255') });
const green = (def) => ({ key: 'green', label: 'Vert', default: def, ranges: full('0 → 255') });
const blue = (def) => ({ key: 'blue', label: 'Bleu', default: def, ranges: full('0 → 255') });
const CCT = {
  key: 'cct', label: 'CCT', default: 54,
  ranges: full('1700 → 20000 K : K = round(1700 + v/255 × 18300) (54 ≈ 5575 K, 21 ≈ 3207 K)'),
};
const TINT = {
  key: 'tint', label: 'Tint', default: 128,
  ranges: [
    { from: 0, to: 127, label: 'Magenta : −100 (0) → −0,8 (127)' },
    { from: 128, to: 128, label: 'Neutre' },
    { from: 129, to: 255, label: 'Vert : +0,8 (129) → +100 (255)' },
  ],
};
const MIX = {
  key: 'mix', label: 'Mix couleur/blanc', default: 0,
  ranges: full('0 = RGB pur → 255 = blanc CCT pur (fondu linéaire entre les deux)'),
};
const STROBE = {
  key: 'strobe', label: 'Strobe', default: 0,
  ranges: [
    { from: 0, to: 0, label: 'Pas de strobe' },
    { from: 1, to: 255, label: '0,5 → 30 Hz : f = 0,5 + (v − 1) × 29,5 / 254' },
  ],
};

/** @type {Readonly<Record<string, Personality>>} */
export const PERSONALITIES = Object.freeze({
  simple3: {
    id: 'simple3',
    name: 'Simple 3',
    footprint: 3,
    channels: [
      { n: 1, ...red(0) },
      { n: 2, ...green(0) },
      { n: 3, ...blue(0) },
    ],
  },
  color5: {
    id: 'color5',
    name: 'Couleur 5',
    footprint: 5,
    channels: [
      { n: 1, ...DIMMER },
      { n: 2, ...red(255) },
      { n: 3, ...green(255) },
      { n: 4, ...blue(255) },
      { n: 5, ...STROBE },
    ],
  },
  standard8: {
    id: 'standard8',
    name: 'Standard 8',
    footprint: 8,
    channels: [
      { n: 1, ...DIMMER },
      { n: 2, ...red(255) },
      { n: 3, ...green(255) },
      { n: 4, ...blue(255) },
      { n: 5, ...CCT },
      { n: 6, ...TINT },
      { n: 7, ...MIX },
      { n: 8, ...STROBE },
    ],
  },
  extended16: {
    id: 'extended16',
    name: 'Étendu 16',
    footprint: 16,
    channels: [
      { n: 1, key: 'dimmer', label: 'Dimmer', default: 0, ranges: full('0 → 100 % (octet fort du 16 bits) ; maître des effets aussi') },
      { n: 2, key: 'dimmerFine', label: 'Dimmer fin', default: 0, ranges: full('Octet faible du 16 bits') },
      { n: 3, ...red(255) },
      { n: 4, ...green(255) },
      { n: 5, ...blue(255) },
      { n: 6, ...CCT },
      { n: 7, ...TINT },
      { n: 8, ...MIX },
      { n: 9, ...STROBE },
      {
        n: 10, key: 'effect', label: 'Effet', default: 0,
        ranges: slotRanges(EFFECTS.length, (n) => EFFECTS[n - 1].label + ' (' + EFFECTS[n - 1].name + ')', 'Aucun effet'),
      },
      {
        n: 11, key: 'effectSpeed', label: 'Vitesse effet', default: 128,
        ranges: full('Plage de vitesse de l\'effet : s = min + v/255 × (max − min)'),
      },
      {
        n: 12, key: 'media', label: 'Média', default: 0,
        ranges: slotRanges(MEDIA_ITEMS, (n) => 'Média n° ' + n + ' du pool', 'Masquer le média'),
      },
      {
        n: 13, key: 'playback', label: 'Lecture', default: 0,
        ranges: [
          { from: 0, to: 63, label: 'Lecture' },
          { from: 64, to: 127, label: 'Pause' },
          { from: 128, to: 191, label: 'Lecture en boucle' },
          { from: 192, to: 255, label: 'Retour au début et pause' },
        ],
      },
      {
        n: 14, key: 'call', label: 'Appel', default: 0,
        ranges: slotRanges(CALL_ITEMS, (n) => 'Déclenche l\'appel n° ' + n, 'Raccrocher (fin ou refus de l\'appel en cours)'),
      },
      {
        n: 15, key: 'sms', label: 'SMS', default: 0,
        ranges: slotRanges(SMS_ITEMS, (n) => 'Déclenche le SMS n° ' + n, 'Fermer la notification'),
      },
      {
        n: 16, key: 'screen', label: 'Écran', default: 0,
        ranges: [
          { from: 0, to: 127, label: 'Écran allumé' },
          { from: 128, to: 255, label: 'Blackout (noir total, média et effet compris)' },
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
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PERSONALITIES, id) ? PERSONALITIES[id] : null;
}

/** Number of DMX channels used by a personality (0 if unknown). */
export function footprint(id) {
  const p = getPersonality(id);
  return p ? p.footprint : 0;
}

/** Home values of a personality as a slice. */
export function defaultSlice(id) {
  const p = getPersonality(id);
  return p ? Uint8Array.from(p.channels.map((c) => c.default)) : new Uint8Array(0);
}

const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Strobe channel → { active, freq, dur }: 0 = off, 1–255 → 0.5–30 Hz linear (hard cap 30 Hz).
 * The flash lasts min(50 ms, half the period), at least 15 ms.
 * @param {number} v
 */
export function decodeStrobe(v) {
  if (!v) return { active: false, freq: 0, dur: 0 };
  const freq = Math.min(STROBE_FREQ_MAX, round2(STROBE_FREQ_MIN + (v - 1) * (STROBE_FREQ_MAX - STROBE_FREQ_MIN) / 254));
  const dur = Math.max(STROBE_DUR_MIN, Math.min(STROBE_DUR_AUTO_MAX, Math.round(500 / freq)));
  return { active: true, freq, dur };
}

/** Playback value → 'play' | 'pause' | 'loop' | 'rewind'. */
export function playbackOf(v) {
  return PLAYBACK[v >> 6];
}

/** Effect speed value → speed in the effect's own unit. */
export function effectSpeed(effect, v) {
  return round3(effect.min + (v / 255) * (effect.max - effect.min));
}

const OFF_STROBE = Object.freeze({ active: false, freq: 0, dur: 0 });

/**
 * @typedef {object} Trigger
 * @property {'call'|'sms'} kind
 * @property {number} index  1–20 = start entry n; 0 = hang up (call) / dismiss (sms)
 */

/**
 * Stateful decoder for one screen: remembers Effect/Media choices across
 * "no change" values and fires Call/SMS triggers on edges only.
 * The first frame after creation (or reset) arms the Call/SMS channels without
 * firing, so a reconnecting gateway never replays a call.
 */
export class FixtureDecoder {
  /** @param {string} personality */
  constructor(personality) {
    const p = getPersonality(personality);
    if (!p) throw new RangeError('Personnalité inconnue : ' + personality);
    this.personality = p;
    this.reset();
  }

  reset() {
    this.effectSlot = 0;
    this.mediaSlot = 0;
    /** last Call / SMS slot seen (null = not armed yet) */
    this.callSlot = null;
    this.smsSlot = null;
  }

  /**
   * @param {ArrayLike<number>} slice the fixture's channels (index 0 = start address); missing channels read as 0
   * @returns {{look: import('./messages.js').Look, triggers: Trigger[]}}
   */
  decode(slice) {
    const ch = (n) => {
      const v = slice[n - 1];
      return typeof v === 'number' && v >= 0 && v <= 255 ? v | 0 : 0;
    };
    const triggers = [];
    let look;
    switch (this.personality.id) {
      case 'simple3':
        look = { color: rgbToHex(ch(1), ch(2), ch(3)), strobe: OFF_STROBE, effect: null, media: null, blackout: false };
        break;
      case 'color5': {
        const f = ch(1) / 255;
        look = { color: rgbToHex(ch(2) * f, ch(3) * f, ch(4) * f), strobe: decodeStrobe(ch(5)), effect: null, media: null, blackout: false };
        break;
      }
      case 'standard8':
        look = {
          color: mixed(ch(1) / 255, ch(2), ch(3), ch(4), ch(5), ch(6), ch(7)),
          strobe: decodeStrobe(ch(8)), effect: null, media: null, blackout: false,
        };
        break;
      case 'extended16': {
        const dimmer = ((ch(1) << 8) | ch(2)) / 65535;
        const fx = slotOf(ch(10), EFFECTS.length);
        if (fx !== null) this.effectSlot = fx;
        const media = slotOf(ch(12), MEDIA_ITEMS);
        if (media !== null) this.mediaSlot = media;
        const effect = this.effectSlot ? EFFECTS[this.effectSlot - 1] : null;
        look = {
          color: mixed(dimmer, ch(3), ch(4), ch(5), ch(6), ch(7), ch(8)),
          strobe: decodeStrobe(ch(9)),
          effect: effect ? { name: effect.name, speed: effectSpeed(effect, ch(11)), intensity: Math.round(dimmer * 100) } : null,
          media: this.mediaSlot ? { index: this.mediaSlot, playback: playbackOf(ch(13)) } : null,
          blackout: ch(16) >= 128,
        };
        const call = this._edge('callSlot', slotOf(ch(14), CALL_ITEMS));
        if (call !== null) triggers.push({ kind: 'call', index: call });
        const sms = this._edge('smsSlot', slotOf(ch(15), SMS_ITEMS));
        if (sms !== null) triggers.push({ kind: 'sms', index: sms });
        break;
      }
      default:
        throw new RangeError('Personnalité sans décodeur : ' + this.personality.id);
    }
    return { look, triggers };
  }

  /** Edge detector: returns the slot to fire, or null. */
  _edge(key, slot) {
    if (slot === null) return null;           // "no change" value
    if (this[key] === null) { this[key] = slot; return null; } // first frame: arm only
    if (slot === this[key]) return null;      // value stays in the same slot
    this[key] = slot;
    return slot;
  }
}

/** Colour of Standard 8 / Étendu 16: RGB crossfaded with CCT white (mix 255 = white), × dimmer. */
function mixed(dimmer, r, g, b, cctV, tintV, mixV) {
  // mixColor follows the app: (white × (1 − c) + colour × c) × dimmer, c = 1 − mix.
  return mixColor({ kelvin: dmxToKelvin(cctV), gm: dmxToTint(tintV), wheel: { r, g, b }, crossfade: 1 - mixV / 255, dimmer });
}

/**
 * Stateless single-frame decode (Effect/Media "no change" values read as
 * "nothing selected"; no Call/SMS triggers). Prefer FixtureDecoder in the gateway.
 * @param {string} personality
 * @param {ArrayLike<number>} slice
 */
export function decode(personality, slice) {
  return new FixtureDecoder(personality).decode(slice).look;
}
