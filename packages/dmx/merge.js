// Per-universe source tracking and merging.
//
// sACN (ANSI E1.31-2018, superseded by E1.31-2025 with the same rules):
//   • §6.2.3 Priority 0–200: the highest-priority live source wins; sources at the
//     same highest priority are merged HTP (E1.31 leaves equal-priority handling
//     to the receiver; HTP is the usual choice).
//   • §6.7.1 / Appendix A: a source is lost after E131_NETWORK_DATA_LOSS_TIMEOUT
//     (2.5 s) without DATA packets (E1.31-2025: sync/discovery packets do not keep
//     a source alive).
//   • §6.7.2 Sequence numbering: with A the last accepted sequence and B the new
//     one, if (B − A) in signed 8-bit arithmetic is ≤ 0 and > −20, B is out of
//     order and discarded. Kept per source and per universe (and per sync address).
//   • §6.2.6 Stream_Terminated: enter data-loss for that source immediately and
//     ignore the packet's slots. Preview_Data: never used for live output.
//   • §6.2.4 / §11 Universe synchronisation: data carrying a Synchronization
//     Address is held until a sync packet for that address arrives. Never-synced
//     universes are applied immediately; if sync is lost, Force_Synchronization = 1
//     allows immediate updates, 0 holds the last synchronised data.
//
// Art-Net 4 ("Data merging"): sources are told apart by IP address; at most two
// are merged (extra sources ignored); HTP by default, LTP optional; a failed
// source stays in the merge buffer for 10 s; if both fail the output holds the
// last merge result.
//
// Both mergers emit onUniverse(universe, Uint8Array(512), info) only when the
// merged output changes, and onSignal(universe, lost, info) on signal changes.
// Time comes from an injected clock (`now`) and timeouts are applied on push()
// and tick(), so tests run on a fake clock.

import { int8 } from './bytes.js';
import { E131_NETWORK_DATA_LOSS_TIMEOUT_MS } from './sacn.js';

/** Art-Net merge buffer hold time for a failed source (Art-Net 4, "Data merging"). */
export const ARTNET_SOURCE_TIMEOUT_MS = 10000;
/** Art-Net merges at most two sources. */
export const ARTNET_MAX_MERGE_SOURCES = 2;
/** Sequence window of E1.31 §6.7.2. */
export const SEQUENCE_REJECT_WINDOW = 20;

const noop = () => {};
/** Monotonic clock in ms when available (browsers, Node, React Native), else Date.now. */
export const defaultNow = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
  ? () => performance.now()
  : () => Date.now();

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function to512(data) {
  const out = new Uint8Array(512);
  out.set(data.length > 512 ? data.subarray(0, 512) : data);
  return out;
}

/** True when `seq` must be discarded after `last` (E1.31 §6.7.2). */
export function isOutOfSequence(seq, last) {
  const d = int8(seq - last);
  return d <= 0 && d > -SEQUENCE_REJECT_WINDOW;
}

/**
 * @callback UniverseListener
 * @param {number} universe
 * @param {Uint8Array} data  512 slots, fresh array per change (treat as read-only)
 * @param {object} info
 */

/**
 * @callback SignalListener
 * @param {number} universe
 * @param {boolean} lost
 * @param {{reason: string}} info
 */

/**
 * sACN merger. Feed it parseSacn() results.
 */
export class SacnMerger {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now]
   * @param {number} [opts.timeoutMs=2500]
   * @param {boolean} [opts.honorSync=true]
   * @param {UniverseListener} [opts.onUniverse]
   * @param {SignalListener} [opts.onSignal]
   */
  constructor(opts) {
    const o = opts || {};
    this.now = o.now || defaultNow;
    this.timeoutMs = o.timeoutMs == null ? E131_NETWORK_DATA_LOSS_TIMEOUT_MS : o.timeoutMs;
    this.honorSync = o.honorSync !== false;
    this.onUniverse = o.onUniverse || noop;
    this.onSignal = o.onSignal || noop;
    /** @type {Map<number, any>} */
    this._universes = new Map();
    /** @type {Map<number, {lastSeen: number, seqByCid: Map<string, number>}>} */
    this._sync = new Map();
    /** @type {Map<string, {cid: string, sourceName: string, universes: number[], lastSeen: number}>} */
    this.discovered = new Map();
  }

  _universe(u) {
    let st = this._universes.get(u);
    if (!st) {
      st = { universe: u, sources: new Map(), output: null, lost: null };
      this._universes.set(u, st);
    }
    return st;
  }

  /**
   * Process a parsed packet.
   * @param {import('./sacn.js').SacnParseResult} pkt
   * @returns {string} outcome: applied | unchanged | staged | held | synced | terminated |
   *   ignored-preview | out-of-sequence | discovery | invalid
   */
  push(pkt) {
    if (!pkt || !pkt.ok) return 'invalid';
    const t = this.now();
    if (pkt.kind === 'sync') return this._pushSync(pkt, t);
    if (pkt.kind === 'discovery') {
      const prev = this.discovered.get(pkt.cid);
      const universes = prev && pkt.page > 0 ? prev.universes.concat(pkt.universes) : pkt.universes.slice();
      this.discovered.set(pkt.cid, { cid: pkt.cid, sourceName: pkt.sourceName, universes, lastSeen: t });
      return 'discovery';
    }
    if (pkt.kind !== 'data') return 'invalid';
    if (pkt.options.preview) return 'ignored-preview';

    const u = this._universe(pkt.universe);
    let s = u.sources.get(pkt.cid);
    if (s && t - s.lastSeen > this.timeoutMs) { u.sources.delete(pkt.cid); s = undefined; } // stale: start over
    if (s && isOutOfSequence(pkt.sequence, s.seq)) return 'out-of-sequence';

    if (pkt.options.streamTerminated) {
      if (s) {
        u.sources.delete(pkt.cid);
        this._recompute(u, t, 'terminated');
      }
      return 'terminated';
    }
    if (!s) {
      s = { cid: pkt.cid, sourceName: pkt.sourceName, priority: pkt.priority, seq: pkt.sequence, lastSeen: t, data: null, staged: null, stagedSync: 0 };
      u.sources.set(pkt.cid, s);
    }
    s.seq = pkt.sequence;
    s.lastSeen = t;
    s.priority = pkt.priority;
    s.sourceName = pkt.sourceName;
    const frame = to512(pkt.data);

    if (this.honorSync && pkt.syncAddress) {
      const sync = this._sync.get(pkt.syncAddress);
      const synchronised = sync && t - sync.lastSeen <= this.timeoutMs;
      if (synchronised || (sync && !pkt.options.forceSync)) {
        s.staged = frame;
        s.stagedSync = pkt.syncAddress;
        // The source is alive even while its data waits for the sync packet.
        if (synchronised && !s.data) return 'staged';
        this._recompute(u, t, 'data');
        return synchronised ? 'staged' : 'held';
      }
    }
    s.data = frame;
    s.staged = null;
    return this._recompute(u, t, 'data') ? 'applied' : 'unchanged';
  }

  _pushSync(pkt, t) {
    let sync = this._sync.get(pkt.syncAddress);
    if (!sync) { sync = { lastSeen: -Infinity, seqByCid: new Map() }; this._sync.set(pkt.syncAddress, sync); }
    const last = sync.seqByCid.get(pkt.cid);
    if (last != null && t - sync.lastSeen <= this.timeoutMs && isOutOfSequence(pkt.sequence, last)) return 'out-of-sequence';
    sync.seqByCid.set(pkt.cid, pkt.sequence);
    sync.lastSeen = t;
    for (const u of this._universes.values()) {
      let changed = false;
      for (const s of u.sources.values()) {
        if (s.staged && s.stagedSync === pkt.syncAddress) { s.data = s.staged; s.staged = null; changed = true; }
      }
      if (changed) this._recompute(u, t, 'sync');
    }
    return 'synced';
  }

  /** Apply timeouts (call periodically, e.g. every 10–50 ms). */
  tick() {
    const t = this.now();
    for (const u of this._universes.values()) {
      let expired = false;
      for (const [cid, s] of u.sources) {
        if (t - s.lastSeen > this.timeoutMs) { u.sources.delete(cid); expired = true; }
      }
      if (expired) this._recompute(u, t, 'timeout');
    }
    for (const [cid, d] of this.discovered) {
      if (t - d.lastSeen > 3 * 10000) this.discovered.delete(cid);
    }
  }

  /** @returns {boolean} true when the output changed */
  _recompute(u, t, reason) {
    for (const [cid, s] of u.sources) if (t - s.lastSeen > this.timeoutMs) u.sources.delete(cid);
    let maxP = -1;
    for (const s of u.sources.values()) if (s.data && s.priority > maxP) maxP = s.priority;
    if (maxP < 0) {
      if (u.output && u.lost !== true && !this._anyAlive(u)) {
        u.lost = true;
        this.onSignal(u.universe, true, { reason });
      }
      return false;
    }
    const winners = [];
    for (const s of u.sources.values()) if (s.data && s.priority === maxP) winners.push(s);
    let out;
    if (winners.length === 1) out = winners[0].data.slice();
    else {
      out = new Uint8Array(512);
      for (const s of winners) for (let i = 0; i < 512; i++) if (s.data[i] > out[i]) out[i] = s.data[i];
    }
    const info = { protocol: 'sacn', priority: maxP, sources: u.sources.size, htp: winners.length > 1, reason };
    if (u.lost !== false) { u.lost = false; this.onSignal(u.universe, false, info); }
    if (u.output && sameBytes(out, u.output)) return false;
    u.output = out;
    this.onUniverse(u.universe, out, info);
    return true;
  }

  _anyAlive(u) {
    return u.sources.size > 0;
  }

  /** Current state of a universe (null if never seen). */
  getUniverse(universe) {
    const u = this._universes.get(universe);
    if (!u) return null;
    return {
      universe,
      data: u.output,
      lost: u.lost,
      sources: Array.from(u.sources.values(), (s) => ({ cid: s.cid, sourceName: s.sourceName, priority: s.priority, lastSeen: s.lastSeen })),
    };
  }

  /** True when the universe had data and lost all its sources. */
  isLost(universe) {
    const u = this._universes.get(universe);
    return !!(u && u.lost);
  }

  universes() { return Array.from(this._universes.keys()); }
}

/**
 * Art-Net merger. Feed it parseArtNet() ArtDmx results with the sender's IP.
 */
export class ArtNetMerger {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now]
   * @param {number} [opts.timeoutMs=10000]  merge-buffer hold time of a failed source; also the loss timeout
   * @param {'htp'|'ltp'} [opts.mergeMode='htp']
   * @param {number} [opts.maxSources=2]
   * @param {UniverseListener} [opts.onUniverse]
   * @param {SignalListener} [opts.onSignal]
   */
  constructor(opts) {
    const o = opts || {};
    this.now = o.now || defaultNow;
    this.timeoutMs = o.timeoutMs == null ? ARTNET_SOURCE_TIMEOUT_MS : o.timeoutMs;
    this.mergeMode = o.mergeMode === 'ltp' ? 'ltp' : 'htp';
    this.maxSources = o.maxSources == null ? ARTNET_MAX_MERGE_SOURCES : o.maxSources;
    this.onUniverse = o.onUniverse || noop;
    this.onSignal = o.onSignal || noop;
    this._universes = new Map();
  }

  _universe(pa) {
    let st = this._universes.get(pa);
    if (!st) {
      st = { universe: pa, sources: new Map(), output: null, ltp: new Uint8Array(512), lost: null };
      this._universes.set(pa, st);
    }
    return st;
  }

  /**
   * @param {import('./artnet.js').ArtDmxPacket} pkt
   * @param {string} sourceIp sender IP address (rinfo.address)
   * @returns {string} outcome: applied | unchanged | ignored-extra-source | out-of-sequence | invalid
   */
  push(pkt, sourceIp) {
    if (!pkt || !pkt.ok || pkt.kind !== 'dmx') return 'invalid';
    const t = this.now();
    const ip = String(sourceIp || 'unknown');
    const u = this._universe(pkt.portAddress);
    for (const [k, s] of u.sources) if (t - s.lastSeen > this.timeoutMs) u.sources.delete(k);
    let s = u.sources.get(ip);
    if (!s) {
      if (u.sources.size >= this.maxSources) return 'ignored-extra-source';
      s = { ip, seq: 0, lastSeen: t, data: null };
      u.sources.set(ip, s);
    } else if (pkt.sequence !== 0 && s.seq !== 0) {
      // Art-Net sequence 0 disables the check; 1–255 wrap. Late packets are dropped,
      // duplicates (same number) are harmless and accepted.
      const d = int8(pkt.sequence - s.seq);
      if (d < 0 && d > -SEQUENCE_REJECT_WINDOW) return 'out-of-sequence';
    }
    const frame = to512(pkt.data);
    if (this.mergeMode === 'ltp') {
      // Latest takes precedence, per slot: a slot follows whichever source changed it last.
      for (let i = 0; i < 512; i++) if (!s.data || frame[i] !== s.data[i]) u.ltp[i] = frame[i];
    }
    s.seq = pkt.sequence;
    s.lastSeen = t;
    s.data = frame;
    return this._recompute(u, t, 'data') ? 'applied' : 'unchanged';
  }

  tick() {
    const t = this.now();
    for (const u of this._universes.values()) {
      let expired = false;
      for (const [k, s] of u.sources) if (t - s.lastSeen > this.timeoutMs) { u.sources.delete(k); expired = true; }
      if (expired) this._recompute(u, t, 'timeout');
    }
  }

  _recompute(u, t, reason) {
    const live = Array.from(u.sources.values()).filter((s) => s.data);
    if (!live.length) {
      if (u.output && u.lost !== true) { u.lost = true; this.onSignal(u.universe, true, { reason }); }
      return false; // output holds the last merge result
    }
    let out;
    if (this.mergeMode === 'ltp') out = u.ltp.slice();
    else if (live.length === 1) out = live[0].data.slice();
    else {
      out = new Uint8Array(512);
      for (const s of live) for (let i = 0; i < 512; i++) if (s.data[i] > out[i]) out[i] = s.data[i];
    }
    const info = { protocol: 'artnet', sources: live.length, merging: live.length > 1, mode: this.mergeMode, reason };
    if (u.lost !== false) { u.lost = false; this.onSignal(u.universe, false, info); }
    if (u.output && sameBytes(out, u.output)) return false;
    u.output = out;
    this.onUniverse(u.universe, out, info);
    return true;
  }

  getUniverse(portAddress) {
    const u = this._universes.get(portAddress);
    if (!u) return null;
    return {
      universe: portAddress,
      data: u.output,
      lost: u.lost,
      sources: Array.from(u.sources.values(), (s) => ({ ip: s.ip, lastSeen: s.lastSeen })),
      merging: u.sources.size > 1,
    };
  }

  isLost(portAddress) {
    const u = this._universes.get(portAddress);
    return !!(u && u.lost);
  }

  universes() { return Array.from(this._universes.keys()); }
}
