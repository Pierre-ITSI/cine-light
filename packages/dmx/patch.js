// Gateway patch: which DMX universe/address/personality drives each screen.
//
//   { screenId → { protocol: 'sacn'|'artnet', universe, address (1–512), personality, name?, loss? } }
//
// sACN universes are 1–63999; Art-Net universes are 15-bit Port-Addresses
// 0–32767 (Net·Sub-Net·Universe). The two namespaces are distinct: sACN 1 and
// Art-Net 1 are different universes.
// The GatewayEngine lives in engine.js (it imports this module).

import { footprint, getPersonality, PERSONALITY_IDS } from './personalities.js';

export const PROTOCOLS = Object.freeze(['sacn', 'artnet']);
export const UNIVERSE_RANGE = Object.freeze({ sacn: [1, 63999], artnet: [0, 32767] });
export const LOSS_MODES = Object.freeze(['hold', 'black', 'release']);
/** Default loss-of-signal timings (ms) once the protocol has declared the signal lost. */
export const LOSS_DEFAULTS = Object.freeze({ afterMs: 3000, fadeMs: 1000 });
const SCREEN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @typedef {object} LossPolicy
 * @property {'hold'|'black'|'release'} mode
 *   hold: keep the last look; black: fade to black after afterMs; release: hand
 *   the screen back to the remote app after afterMs
 * @property {number} [afterMs]  delay after the signal is declared lost (default 3000)
 * @property {number} [fadeMs]   fade duration for 'black' (default 1000)
 */

/**
 * @typedef {object} PatchEntry
 * @property {'sacn'|'artnet'} protocol
 * @property {number} universe
 * @property {number} address      DMX start address 1–512
 * @property {string} personality  simple3 | standard8 | rgb6 | extended16
 * @property {string} [name]       display name (UI only)
 * @property {LossPolicy} [loss]   overrides the engine default
 */

/**
 * @typedef {object} PatchIssue
 * @property {'invalid'|'out-of-range'|'overlap'|'mirror'|'mirror-mismatch'} code
 * @property {'error'|'warning'|'info'} level
 * @property {string[]} screens
 * @property {string} message  French, ready to display
 * @property {string} [protocol]
 * @property {number} [universe]
 */

/** Normalise a loss policy; returns null if invalid. */
export function normalizeLoss(loss) {
  if (loss == null) return null;
  if (typeof loss !== 'object' || LOSS_MODES.indexOf(loss.mode) === -1) return null;
  const ms = (v, d, max) => (v == null ? d : (Number.isFinite(v) && v >= 0 && v <= max ? v : NaN));
  const out = { mode: loss.mode, afterMs: ms(loss.afterMs, LOSS_DEFAULTS.afterMs, 600000), fadeMs: ms(loss.fadeMs, LOSS_DEFAULTS.fadeMs, 10000) };
  return Number.isNaN(out.afterMs) || Number.isNaN(out.fadeMs) ? null : out;
}

/**
 * Structural validation of one entry (types, ranges). Range overflow
 * (address + footprint − 1 > 512) is reported separately by checkPatch().
 * @param {string} screenId
 * @param {any} e
 * @returns {string[]} problems (empty when valid)
 */
export function validateEntry(screenId, e) {
  const errs = [];
  if (typeof screenId !== 'string' || !SCREEN_ID_RE.test(screenId)) errs.push('screenId invalide');
  if (!e || typeof e !== 'object') return errs.concat('entrée manquante');
  if (PROTOCOLS.indexOf(e.protocol) === -1) errs.push('protocole inconnu : ' + e.protocol);
  const range = UNIVERSE_RANGE[e.protocol];
  if (range && !(Number.isInteger(e.universe) && e.universe >= range[0] && e.universe <= range[1])) {
    errs.push('univers hors plage ' + range[0] + '–' + range[1] + ' : ' + e.universe);
  }
  if (!(Number.isInteger(e.address) && e.address >= 1 && e.address <= 512)) errs.push('adresse hors plage 1–512 : ' + e.address);
  if (!getPersonality(e.personality)) errs.push('personnalité inconnue : ' + e.personality + ' (' + PERSONALITY_IDS.join(', ') + ')');
  if (e.loss != null && !normalizeLoss(e.loss)) errs.push('politique de perte de signal invalide');
  if (e.name != null && typeof e.name !== 'string') errs.push('nom invalide');
  return errs;
}

/** Last channel used by an entry (may exceed 512 when misconfigured). */
export function lastChannel(e) {
  return e.address + footprint(e.personality) - 1;
}

export class Patch {
  /**
   * @param {Record<string, PatchEntry> | Array<PatchEntry & {screenId: string}> | {screens: Record<string, PatchEntry>}} [init]
   */
  constructor(init) {
    /** @type {Map<string, PatchEntry>} */
    this._m = new Map();
    if (!init) return;
    if (Array.isArray(init)) for (const e of init) this.set(e.screenId, e);
    else {
      const src = init.screens && typeof init.screens === 'object' ? init.screens : init;
      for (const id of Object.keys(src)) this.set(id, src[id]);
    }
  }

  /**
   * Add or replace a screen's entry. Throws TypeError on structurally invalid input.
   * @param {string} screenId
   * @param {PatchEntry} entry
   */
  set(screenId, entry) {
    const errs = validateEntry(screenId, entry);
    if (errs.length) throw new TypeError('Patch ' + screenId + ' : ' + errs.join(' ; '));
    const e = { protocol: entry.protocol, universe: entry.universe, address: entry.address, personality: entry.personality };
    if (entry.name) e.name = entry.name;
    if (entry.loss) e.loss = normalizeLoss(entry.loss);
    this._m.set(screenId, e);
    return this;
  }

  get(screenId) { return this._m.get(screenId) || null; }
  has(screenId) { return this._m.has(screenId); }
  delete(screenId) { return this._m.delete(screenId); }
  ids() { return Array.from(this._m.keys()); }
  entries() { return Array.from(this._m.entries()); }
  get size() { return this._m.size; }

  /** Universes in use, per protocol. */
  universes(protocol) {
    const s = new Set();
    for (const e of this._m.values()) if (e.protocol === protocol) s.add(e.universe);
    return Array.from(s).sort((a, b) => a - b);
  }

  /** Overlaps, mirrors and out-of-range entries. */
  check() { return checkPatch(this); }

  /**
   * Assign consecutive addresses (see autoAddress) and store the result.
   * @returns {{overflow: string[]}}
   */
  autoAddress(screenIds, opts) {
    const r = autoAddress(screenIds, opts);
    for (const id of Object.keys(r.entries)) {
      const prev = this.get(id);
      this.set(id, Object.assign({}, r.entries[id], prev && prev.name ? { name: prev.name } : null, prev && prev.loss ? { loss: prev.loss } : null));
    }
    return { overflow: r.overflow };
  }

  toJSON() {
    const screens = {};
    for (const [id, e] of this._m) screens[id] = Object.assign({}, e);
    return { version: 1, screens };
  }

  static fromJSON(json) {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    return new Patch(obj && obj.screens ? obj.screens : obj);
  }
}

/**
 * Detect configuration problems.
 *   • out-of-range (error): address + footprint − 1 > 512
 *   • overlap (warning): two screens share channels in the same universe
 *   • mirror (info): two screens start at the same address with the same personality —
 *     an intentional way to drive several screens identically
 *   • mirror-mismatch (warning): same start address but different personalities
 * @param {Patch | Record<string, PatchEntry>} patch
 * @returns {{errors: PatchIssue[], warnings: PatchIssue[], infos: PatchIssue[]}}
 */
export function checkPatch(patch) {
  const p = patch instanceof Patch ? patch : new Patch(patch);
  const errors = [], warnings = [], infos = [];
  const groups = new Map();
  for (const [id, e] of p.entries()) {
    const last = lastChannel(e);
    if (last > 512) {
      errors.push({
        code: 'out-of-range', level: 'error', screens: [id], protocol: e.protocol, universe: e.universe,
        message: 'Écran ' + (e.name || id) + ' : ' + e.personality + ' à l\'adresse ' + e.address
          + ' occupe les canaux ' + e.address + '–' + last + ', au-delà de 512.',
      });
    }
    const k = e.protocol + ':' + e.universe;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([id, e]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a[1].address - b[1].address);
    for (let i = 0; i < list.length; i++) {
      const [ida, a] = list[i];
      const aEnd = Math.min(512, lastChannel(a));
      for (let j = i + 1; j < list.length && list[j][1].address <= aEnd; j++) {
        const [idb, b] = list[j];
        const where = { protocol: a.protocol, universe: a.universe };
        const na = a.name || ida, nb = b.name || idb;
        if (a.address === b.address && a.personality === b.personality) {
          infos.push({ code: 'mirror', level: 'info', screens: [ida, idb], ...where,
            message: na + ' et ' + nb + ' sont en miroir (même adresse ' + a.address + ', même personnalité).' });
        } else if (a.address === b.address) {
          warnings.push({ code: 'mirror-mismatch', level: 'warning', screens: [ida, idb], ...where,
            message: na + ' (' + a.personality + ') et ' + nb + ' (' + b.personality + ') partent de la même adresse '
              + a.address + ' avec des personnalités différentes.' });
        } else {
          warnings.push({ code: 'overlap', level: 'warning', screens: [ida, idb], ...where,
            message: na + ' (' + a.address + '–' + lastChannel(a) + ') et ' + nb + ' (' + b.address + '–'
              + lastChannel(b) + ') se chevauchent.' });
        }
      }
    }
  }
  return { errors, warnings, infos };
}

/**
 * Pack screens consecutively from a start address.
 * @param {string[]} screenIds  order = patch order
 * @param {object} [opts]
 * @param {'sacn'|'artnet'} [opts.protocol='sacn']
 * @param {number} [opts.universe]          default 1 for sACN, 0 for Art-Net
 * @param {number} [opts.startAddress=1]
 * @param {string} [opts.personality='standard8']
 * @param {Record<string, string>} [opts.personalities]  per-screen personality override
 * @param {number} [opts.gap=0]             free channels left between two screens
 * @param {boolean} [opts.nextUniverse=true] continue on the next universe when one is full
 * @returns {{entries: Record<string, PatchEntry>, overflow: string[]}}
 */
export function autoAddress(screenIds, opts) {
  const o = opts || {};
  const protocol = o.protocol || 'sacn';
  if (PROTOCOLS.indexOf(protocol) === -1) throw new RangeError('protocole inconnu : ' + protocol);
  const [uMin, uMax] = UNIVERSE_RANGE[protocol];
  let universe = o.universe == null ? (protocol === 'sacn' ? 1 : 0) : o.universe;
  let address = o.startAddress == null ? 1 : o.startAddress;
  const gap = o.gap || 0;
  if (!Number.isInteger(universe) || universe < uMin || universe > uMax) throw new RangeError('univers hors plage : ' + universe);
  if (!Number.isInteger(address) || address < 1 || address > 512) throw new RangeError('adresse hors plage : ' + address);
  if (!Number.isInteger(gap) || gap < 0 || gap > 511) throw new RangeError('écart invalide : ' + gap);
  const entries = {}, overflow = [];
  for (const id of screenIds) {
    const personality = (o.personalities && o.personalities[id]) || o.personality || 'standard8';
    const fp = footprint(personality);
    if (!fp) throw new RangeError('personnalité inconnue : ' + personality);
    if (address + fp - 1 > 512) {
      if (o.nextUniverse === false || universe >= uMax) { overflow.push(id); continue; }
      universe += 1;
      address = 1;
    }
    entries[id] = { protocol, universe, address, personality };
    address += fp + gap;
  }
  return { entries, overflow };
}
