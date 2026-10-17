// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Messages sent by the gateway to the screens (inside the encrypted session),
// following packages/protocol/schema.js conventions (direction r2s, optional `target`).
//
//   { type: 'dmx:look', target: { screens: [screenId, …] }, seq, live, look }
//
// • look omits default fields (typical message ≈ 110 bytes):
//     { color: '#rrggbb', strobe?: {freq, dur}, effect?: {name, speed, intensity},
//       media?: {index, playback}, blackout?: true }
// • live: true while the console signal is present (the console has priority and
//   the screen ignores the remote's look commands); false once, when the signal is
//   lost: the screen keeps this look and the remote may take over.
// • seq: 16-bit counter shared by all gateway messages (wraps 65535 → 0).
//
// Call/SMS triggers reuse the existing 'call:start' / 'call:end' messages.

import { EFFECTS, EFFECT_NAMES, MEDIA_ITEMS, PLAYBACK, STROBE_FREQ_MIN, STROBE_FREQ_MAX, STROBE_DUR_MIN } from './personalities.js';

export const MSG_LOOK = 'dmx:look';
/** Same rules as SCREEN_ID_RE / LIMITS.targetScreens in packages/protocol/schema.js. */
export const SCREEN_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
export const MAX_TARGET_SCREENS = 64;
const STROBE_DUR_WIRE_MAX = 2000;
const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * @typedef {object} Look
 * @property {string} color
 * @property {{active: boolean, freq: number, dur: number}} strobe
 * @property {{name: string, speed: number, intensity: number} | null} effect
 * @property {{index: number, playback: 'play'|'pause'|'loop'|'rewind'} | null} media
 * @property {boolean} blackout
 */

/**
 * Stable string key of a look (change detection, grouping of identical looks).
 * @param {Look} l
 */
export function lookKey(l) {
  const s = l.strobe && l.strobe.active ? l.strobe.freq + '/' + l.strobe.dur : '-';
  const e = l.effect ? l.effect.name + '/' + l.effect.speed + '/' + l.effect.intensity : '-';
  const m = l.media ? l.media.index + '/' + l.media.playback : '-';
  return l.color + '|' + s + '|' + e + '|' + m + '|' + (l.blackout ? 1 : 0);
}

/**
 * Wire form of a look (defaults omitted).
 * @param {Look} l
 */
export function encodeLook(l) {
  const w = { color: l.color };
  if (l.strobe && l.strobe.active) w.strobe = { freq: l.strobe.freq, dur: l.strobe.dur };
  if (l.effect) w.effect = { name: l.effect.name, speed: l.effect.speed, intensity: l.effect.intensity };
  if (l.media) w.media = { index: l.media.index, playback: l.media.playback };
  if (l.blackout) w.blackout = true;
  return w;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inRange = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/**
 * Screen side: wire look → full Look (expects a schema-validated message; still
 * defensive: anything malformed returns null).
 * @param {unknown} w
 * @returns {Look | null}
 */
export function expandLook(w) {
  if (!isObj(w) || typeof w.color !== 'string' || !HEX_RE.test(w.color)) return null;
  const look = { color: w.color.toLowerCase(), strobe: { active: false, freq: 0, dur: 0 }, effect: null, media: null, blackout: w.blackout === true };
  if (w.strobe !== undefined) {
    if (!isObj(w.strobe) || !inRange(w.strobe.freq, STROBE_FREQ_MIN, STROBE_FREQ_MAX)
      || !inRange(w.strobe.dur, STROBE_DUR_MIN, STROBE_DUR_WIRE_MAX)) return null;
    look.strobe = { active: true, freq: w.strobe.freq, dur: w.strobe.dur };
  }
  if (w.effect !== undefined) {
    const i = isObj(w.effect) ? EFFECT_NAMES.indexOf(w.effect.name) : -1;
    if (i === -1 || !inRange(w.effect.speed, EFFECTS[i].min, EFFECTS[i].max)
      || !Number.isInteger(w.effect.intensity) || w.effect.intensity < 0 || w.effect.intensity > 100) return null;
    look.effect = { name: EFFECTS[i].name, speed: w.effect.speed, intensity: w.effect.intensity };
  }
  if (w.media !== undefined) {
    if (!isObj(w.media) || !Number.isInteger(w.media.index) || w.media.index < 1 || w.media.index > MEDIA_ITEMS
      || PLAYBACK.indexOf(w.media.playback) === -1) return null;
    look.media = { index: w.media.index, playback: w.media.playback };
  }
  return look;
}

/**
 * True when `seq` is newer than `last` in 16-bit serial arithmetic. Screens drop
 * older/duplicate gateway messages; `last == null` accepts anything.
 */
export function isNewerSeq(seq, last) {
  if (last == null) return true;
  const d = (seq - last) & 0xffff;
  return d !== 0 && d < 0x8000;
}

/** Split recipients into chunks the schema accepts (≤ 64 screens per target). */
export function chunkScreens(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += MAX_TARGET_SCREENS) out.push(ids.slice(i, i + MAX_TARGET_SCREENS));
  return out;
}

/** call:start fields the protocol schema accepts (copied from a saved entry). */
const CALL_FIELDS = ['style', 'name', 'label', 'msg', 'appName', 'appColor', 'photo', 'ring', 'present', 'photoMode', 'hasAudio', 'autoAnswer', 'lock'];

/**
 * Build the session message for a Call/SMS trigger.
 * @param {{kind: 'call'|'sms', index: number}} trigger
 * @param {object | null | undefined} entry  saved entry n of the remote's call (or SMS) list;
 *   ignored for index 0
 * @param {string[]} screens recipients (≤ 64)
 * @returns {object | null} 'call:start' / 'call:end' message, or null when entry n does not exist
 */
export function triggerMessage(trigger, entry, screens) {
  const target = { screens: screens.slice() };
  if (trigger.index === 0) return { type: 'call:end', target };
  if (!isObj(entry)) return null;
  const msg = { type: 'call:start' };
  if (trigger.kind === 'call') msg.kind = 'call';
  else msg.kind = 'sms'; // l'ancienne messagerie (chat) est devenue SMS ; jamais de notification ni de discussion
  for (const k of CALL_FIELDS) if (entry[k] !== undefined) msg[k] = entry[k];
  msg.target = target;
  return msg;
}
