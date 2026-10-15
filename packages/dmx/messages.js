// Messages sent by the gateway to the screens (inside the encrypted session).
//
//   { type: 'dmx:look',    to: [screenId, …], seq, look, fade? }
//   { type: 'dmx:release', to: [screenId, …], seq }
//
// `look` on the wire omits default fields to stay small (typical message ≈ 80 bytes):
//   { color: '#rrggbb', strobe?: {freq, dur}, effect?: {name, speed, intensity, color?},
//     media?: {index, action}, blackout?: true }
// `seq` is a 16-bit counter shared by all gateway messages (wraps 65535 → 0).
// `fade` (ms) asks the screen to transition smoothly (used by the "black" loss policy).
//
// The screen side (web/js/22-protocol.js MSG_ROUTES) can reuse validateGatewayMessage().

import { EFFECTS, EFFECT_NAMES, MEDIA_ACTIONS, STROBE_FREQ_MIN, STROBE_FREQ_MAX, STROBE_DUR_MIN } from './personalities.js';

export const MSG_LOOK = 'dmx:look';
export const MSG_RELEASE = 'dmx:release';
/** Screens accept flashes up to 2000 ms (PROTO.STROBE_DUR_MAX in web/js/22-protocol.js). */
const STROBE_DUR_WIRE_MAX = 2000;
const FADE_MAX = 10000;
const MAX_RECIPIENTS = 256;
const SCREEN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * @typedef {object} Look
 * @property {string} color
 * @property {{active: boolean, freq: number, dur: number}} strobe
 * @property {{name: string, speed: number, intensity: number, color?: string} | null} effect
 * @property {{index: number, action: 'stop'|'play'|'pause'|'restart'} | null} media
 * @property {boolean} blackout
 */

/** The all-dark look used before any data or for tests. */
export const BLACK_LOOK = Object.freeze({
  color: '#000000', strobe: Object.freeze({ active: false, freq: 0, dur: 0 }), effect: null, media: null, blackout: false,
});

/**
 * Stable string key of a look (change detection and grouping of identical looks).
 * @param {Look} l
 */
export function lookKey(l) {
  const s = l.strobe && l.strobe.active ? l.strobe.freq + '/' + l.strobe.dur : '-';
  const e = l.effect ? l.effect.name + '/' + l.effect.speed + '/' + l.effect.intensity + '/' + (l.effect.color || '') : '-';
  const m = l.media ? l.media.index + '/' + l.media.action : '-';
  return l.color + '|' + s + '|' + e + '|' + m + '|' + (l.blackout ? 1 : 0);
}

/**
 * Wire form of a look (defaults omitted).
 * @param {Look} l
 */
export function encodeLook(l) {
  const w = { color: l.color };
  if (l.strobe && l.strobe.active) w.strobe = { freq: l.strobe.freq, dur: l.strobe.dur };
  if (l.effect) {
    w.effect = { name: l.effect.name, speed: l.effect.speed, intensity: l.effect.intensity };
    if (l.effect.color) w.effect.color = l.effect.color;
  }
  if (l.media) w.media = { index: l.media.index, action: l.media.action };
  if (l.blackout) w.blackout = true;
  return w;
}

const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate and expand a wire look into a full Look. Out-of-range numbers are
 * clamped; structurally wrong input returns null.
 * @param {unknown} w
 * @returns {Look | null}
 */
export function expandLook(w) {
  if (!isObj(w) || typeof w.color !== 'string' || !HEX_RE.test(w.color)) return null;
  const look = { color: w.color.toLowerCase(), strobe: { active: false, freq: 0, dur: 0 }, effect: null, media: null, blackout: w.blackout === true };
  if (w.strobe != null) {
    if (!isObj(w.strobe)) return null;
    const freq = num(w.strobe.freq, STROBE_FREQ_MIN, STROBE_FREQ_MAX);
    const dur = num(w.strobe.dur, STROBE_DUR_MIN, STROBE_DUR_WIRE_MAX);
    if (freq === null || dur === null) return null;
    look.strobe = { active: true, freq, dur };
  }
  if (w.effect != null) {
    if (!isObj(w.effect) || EFFECT_NAMES.indexOf(w.effect.name) === -1) return null;
    const fx = EFFECTS[EFFECT_NAMES.indexOf(w.effect.name)];
    const speed = num(w.effect.speed, fx.min, fx.max);
    const intensity = num(w.effect.intensity, 0, 100);
    if (speed === null || intensity === null) return null;
    look.effect = { name: fx.name, speed, intensity };
    if (w.effect.color != null) {
      if (typeof w.effect.color !== 'string' || !HEX_RE.test(w.effect.color)) return null;
      look.effect.color = w.effect.color.toLowerCase();
    }
  }
  if (w.media != null) {
    if (!isObj(w.media) || !Number.isInteger(w.media.index) || w.media.index < 1 || w.media.index > 255
      || MEDIA_ACTIONS.indexOf(w.media.action) === -1) return null;
    look.media = { index: w.media.index, action: w.media.action };
  }
  return look;
}

/**
 * Validate a gateway → screen message (screen side). Returns a normalised copy or null.
 * @param {unknown} m
 * @returns {{type: 'dmx:look', to: string[], seq: number, look: Look, fade: number} |
 *           {type: 'dmx:release', to: string[], seq: number} | null}
 */
export function validateGatewayMessage(m) {
  if (!isObj(m) || (m.type !== MSG_LOOK && m.type !== MSG_RELEASE)) return null;
  if (!Array.isArray(m.to) || m.to.length < 1 || m.to.length > MAX_RECIPIENTS
    || !m.to.every((id) => typeof id === 'string' && SCREEN_ID_RE.test(id))) return null;
  if (!Number.isInteger(m.seq) || m.seq < 0 || m.seq > 0xffff) return null;
  if (m.type === MSG_RELEASE) return { type: MSG_RELEASE, to: m.to.slice(), seq: m.seq };
  const look = expandLook(m.look);
  if (!look) return null;
  const fade = m.fade == null ? 0 : num(m.fade, 0, FADE_MAX);
  if (fade === null) return null;
  return { type: MSG_LOOK, to: m.to.slice(), seq: m.seq, look, fade };
}

/**
 * True when `seq` is newer than `last` in 16-bit serial arithmetic (RFC 1982 style).
 * Screens drop older/duplicate messages; `last == null` accepts anything.
 * @param {number} seq
 * @param {number | null | undefined} last
 */
export function isNewerSeq(seq, last) {
  if (last == null) return true;
  const d = (seq - last) & 0xffff;
  return d !== 0 && d < 0x8000;
}
