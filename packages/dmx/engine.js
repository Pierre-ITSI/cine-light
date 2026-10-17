// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// GatewayEngine — turns received sACN / Art-Net datagrams into per-screen looks.
//
//   datagram ─► parse (sacn.js / artnet.js) ─► merge per universe (merge.js)
//            ─► per screen: slice at its address ─► FixtureDecoder (personalities.js)
//            ─► 'dmx:look' messages (messages.js), Call/SMS triggers
//
// Priority and loss of signal (single policy):
//   • While the console signal is present, the console has priority: looks are
//     sent with live: true and the screen ignores the remote's look commands.
//   • When the protocol declares the signal lost (sACN 2.5 s, Art-Net 5 s), each
//     screen receives its last look once more with live: false: it KEEPS that
//     look and the remote's next change applies.
//   • As soon as the signal returns, looks are sent again with live: true and the
//     console regains priority immediately.
// Sending: only on change, at most `maxRate` messages per second per screen
// (default 30), keep-alive every second while live, identical looks grouped in
// one message (target.screens ≤ 64).
// The engine owns no timer: call tick() regularly (or start()) — tests inject a fake clock.

import { toBytes } from './bytes.js';
import { parseSacn, looksLikeSacn } from './sacn.js';
import { parseArtNet, looksLikeArtNet, buildArtPollReplies, shouldReplyToPoll, ARTNET_PORT } from './artnet.js';
import { SacnMerger, ArtNetMerger, defaultNow } from './merge.js';
import { FixtureDecoder, footprint } from './personalities.js';
import { MSG_LOOK, encodeLook, lookKey, chunkScreens, triggerMessage } from './messages.js';
import { Patch } from './patch.js';

export const DEFAULT_MAX_RATE = 30;
export const DEFAULT_KEEPALIVE_MS = 1000;

/**
 * @typedef {object} GatewayOptions
 * @property {(msg: object) => void} send       session messages to screens ('dmx:look', 'call:start', 'call:end')
 * @property {(bytes: Uint8Array, address: string, port: number) => void} [sendUdp] UDP out (ArtPollReply)
 * @property {Patch | Record<string, import('./patch.js').PatchEntry>} [patch]
 * @property {() => number} [now]               clock in ms (monotonic)
 * @property {number} [maxRate=30]              max messages per second per screen
 * @property {number} [keepAliveMs=1000]        re-send period while live
 * @property {number} [sacnTimeoutMs=2500]      E1.31 network data loss timeout
 * @property {boolean} [honorSacnSync=true]     E1.31 universe synchronisation
 * @property {number} [artnetLossTimeoutMs=5000]
 * @property {number} [artnetSourceTimeoutMs=10000]
 * @property {'htp'|'ltp'} [artnetMergeMode='htp']
 * @property {boolean} [artnetStrictLength=true] reject ArtDmx with odd Length
 * @property {object} [artPollReply]            identity for ArtPollReply (see artnet.js ArtPollReplyOptions, minus ports)
 * @property {object[]} [callEntries]           remote's saved call list (entry n = index n − 1)
 * @property {object[]} [smsEntries]            remote's saved SMS list
 * @property {(t: {kind: 'call'|'sms', index: number, screens: string[], sent: boolean}) => void} [onTrigger]
 */

export class GatewayEngine {
  /** @param {GatewayOptions} opts */
  constructor(opts) {
    const o = opts || /** @type {any} */ ({});
    if (typeof o.send !== 'function') throw new TypeError('GatewayEngine: send(msg) est requis');
    this.send = o.send;
    this.sendUdp = typeof o.sendUdp === 'function' ? o.sendUdp : null;
    this.now = o.now || defaultNow;
    this.maxRate = o.maxRate || DEFAULT_MAX_RATE;
    this.keepAliveMs = o.keepAliveMs || DEFAULT_KEEPALIVE_MS;
    this.artnetStrictLength = o.artnetStrictLength !== false;
    this.artPollReply = o.artPollReply || null;
    this.onTrigger = typeof o.onTrigger === 'function' ? o.onTrigger : null;
    this.callEntries = o.callEntries || [];
    this.smsEntries = o.smsEntries || [];
    this.sacn = new SacnMerger({
      now: this.now, timeoutMs: o.sacnTimeoutMs, honorSync: o.honorSacnSync,
      onUniverse: (u, d) => this._onUniverse('sacn', u, d),
      onSignal: (u, lost) => this._onSignal('sacn', u, lost),
    });
    this.artnet = new ArtNetMerger({
      now: this.now, lossTimeoutMs: o.artnetLossTimeoutMs, sourceTimeoutMs: o.artnetSourceTimeoutMs, mergeMode: o.artnetMergeMode,
      onUniverse: (u, d) => this._onUniverse('artnet', u, d),
      onSignal: (u, lost) => this._onSignal('artnet', u, lost),
    });
    this.counters = { packets: { sacn: 0, artnet: 0 }, rejected: {}, outcomes: {}, messages: 0, triggers: 0, pollReplies: 0 };
    this._seq = 0;
    this._pollReplies = 0;
    /** @type {Map<string, any>} screenId → runtime state */
    this._screens = new Map();
    /** @type {Map<string, any[]>} 'protocol:universe' → screen states */
    this._index = new Map();
    this._pendingTriggers = [];
    this._timer = null;
    this.patch = new Patch();
    if (o.patch) this.setPatch(o.patch);
  }

  // ───────────────────────────── configuration ─────────────────────────────

  /**
   * Replace the patch. Screens removed from the patch get their last look with
   * live: false (the remote may take them over); new ones are decoded at once
   * from the current universe data.
   * @param {Patch | Record<string, import('./patch.js').PatchEntry>} patch
   */
  setPatch(patch) {
    const next = patch instanceof Patch ? patch : new Patch(patch);
    const t = this.now();
    const old = this._screens;
    this._screens = new Map();
    for (const [id, e] of next.entries()) {
      const prev = old.get(id);
      const same = prev && prev.entry.protocol === e.protocol && prev.entry.universe === e.universe
        && prev.entry.address === e.address && prev.entry.personality === e.personality;
      if (same) { prev.entry = e; this._screens.set(id, prev); continue; }
      const st = {
        id, entry: e, decoder: new FixtureDecoder(e.personality),
        look: null, lookKey: null, live: false, dirty: false, lastSentAt: -Infinity, overlay: null,
      };
      if (prev && prev.live) st.overlay = prev.overlay;
      this._screens.set(id, st);
      if (e.address + footprint(e.personality) - 1 > 512) continue; // out of range: never driven
      const merger = e.protocol === 'sacn' ? this.sacn : this.artnet;
      const u = merger.getUniverse(e.universe);
      if (u && u.data) {
        this._decodeScreen(st, u.data);
        st.live = !u.lost;
        st.dirty = true;
      }
    }
    for (const [id, st] of old) {
      if (!this._screens.has(id) && st.live && st.look) {
        this._sendLooks([{ st, live: false }]);
      }
    }
    this.patch = next;
    this._rebuildIndex();
    this._flush(t);
  }

  /** Update the remote's saved Call / SMS lists used by the Call and SMS channels. */
  setTriggerEntries(entries) {
    if (entries && Array.isArray(entries.call)) this.callEntries = entries.call;
    if (entries && Array.isArray(entries.sms)) this.smsEntries = entries.sms;
  }

  _rebuildIndex() {
    this._index = new Map();
    for (const st of this._screens.values()) {
      const e = st.entry;
      if (e.address + footprint(e.personality) - 1 > 512) continue;
      const k = e.protocol + ':' + e.universe;
      if (!this._index.has(k)) this._index.set(k, []);
      this._index.get(k).push(st);
    }
  }

  // ───────────────────────────── input ─────────────────────────────

  /**
   * Feed one received UDP datagram (port 5568 or 6454).
   * @param {import('./bytes.js').ByteInput} bytes
   * @param {{address?: string, port?: number}} [rinfo] sender
   * @returns {{protocol: 'sacn'|'artnet'|null, ok: boolean, kind?: string, reason?: string, outcome?: string}}
   */
  handlePacket(bytes, rinfo) {
    const b = toBytes(bytes);
    let res;
    if (b && looksLikeArtNet(b)) {
      this.counters.packets.artnet++;
      const p = parseArtNet(b, { strictLength: this.artnetStrictLength });
      res = { protocol: 'artnet', ok: p.ok, kind: p.ok ? p.kind : undefined, reason: p.ok ? undefined : p.reason };
      if (p.ok && p.kind === 'dmx') res.outcome = this.artnet.push(p, rinfo && rinfo.address);
      else if (p.ok && p.kind === 'poll') res.outcome = this._answerPoll(p, rinfo);
    } else if (b && looksLikeSacn(b)) {
      this.counters.packets.sacn++;
      const p = parseSacn(b);
      res = { protocol: 'sacn', ok: p.ok, kind: p.ok ? p.kind : undefined, reason: p.ok ? undefined : p.reason };
      if (p.ok) res.outcome = this.sacn.push(p);
    } else {
      res = { protocol: null, ok: false, reason: b ? 'unknown-protocol' : 'type' };
    }
    if (!res.ok) this.counters.rejected[res.reason] = (this.counters.rejected[res.reason] || 0) + 1;
    if (res.outcome) this.counters.outcomes[res.outcome] = (this.counters.outcomes[res.outcome] || 0) + 1;
    this._dispatchTriggers();
    this._flush(this.now());
    return res;
  }

  /** Apply timeouts, rate-limited sends and keep-alives. Call every ~10 ms. */
  tick() {
    this.sacn.tick();
    this.artnet.tick();
    this._dispatchTriggers();
    this._flush(this.now());
  }

  /**
   * Drive tick() with a timer.
   * @param {{intervalMs?: number, setInterval?: Function, clearInterval?: Function}} [timers]
   */
  start(timers) {
    const o = timers || {};
    const si = o.setInterval || setInterval, ci = o.clearInterval || clearInterval;
    this.stopTimer();
    const id = si(() => this.tick(), o.intervalMs || 10);
    this._timer = { id, ci };
  }

  stopTimer() {
    if (!this._timer) return;
    // Appel en fonction simple : dans un navigateur, clearInterval appelé comme
    // méthode d'un autre objet lève « Illegal invocation ».
    const { id, ci } = this._timer;
    this._timer = null;
    ci(id);
  }

  /** Stop the gateway: every live screen gets its look with live: false (remote may take over). */
  stop() {
    this.stopTimer();
    this.releaseAll();
  }

  /** Hand every live screen back to the remote, keeping its current look. */
  releaseAll() {
    const items = [];
    for (const st of this._screens.values()) {
      if (st.live && st.look) { st.live = false; items.push({ st, live: false }); }
    }
    this._sendLooks(items);
  }

  // ───────────────────────────── merger callbacks ─────────────────────────────

  _onUniverse(protocol, universe, data) {
    const list = this._index.get(protocol + ':' + universe);
    if (list) for (const st of list) this._decodeScreen(st, data);
  }

  _onSignal(protocol, universe, lost) {
    const list = this._index.get(protocol + ':' + universe);
    if (!list) return;
    for (const st of list) {
      if (st.live === !lost) continue;
      st.live = !lost;
      st.dirty = true; // lost: one last message with live:false; back: console regains priority now
      if (!lost) st.lastSentAt = -Infinity; // regain priority immediately (no rate-limit wait)
    }
  }

  _decodeScreen(st, data) {
    const e = st.entry;
    const { look, triggers } = st.decoder.decode(data.subarray(e.address - 1, e.address - 1 + footprint(e.personality)));
    const k = lookKey(look);
    if (k !== st.lookKey) { st.look = look; st.lookKey = k; st.dirty = true; }
    for (const t of triggers) this._pendingTriggers.push({ st, trigger: t });
  }

  // ───────────────────────────── output ─────────────────────────────

  _nextSeq() {
    this._seq = (this._seq + 1) & 0xffff;
    return this._seq;
  }

  _flush(t) {
    const minInterval = 1000 / this.maxRate;
    const items = [];
    for (const st of this._screens.values()) {
      if (!st.look) continue;
      const since = t - st.lastSentAt;
      const due = st.dirty ? since >= minInterval : (st.live && since >= this.keepAliveMs);
      if (due) items.push({ st, live: st.live });
    }
    this._sendLooks(items, t);
  }

  /** Group identical looks and send them. */
  _sendLooks(items, t) {
    if (!items.length) return;
    const now = t == null ? this.now() : t;
    const groups = new Map();
    for (const { st, live } of items) {
      const k = st.lookKey + '|' + (live ? 1 : 0);
      if (!groups.has(k)) groups.set(k, { look: st.look, live, ids: [] });
      groups.get(k).ids.push(st.id);
      st.dirty = false;
      st.lastSentAt = now;
    }
    for (const g of groups.values()) {
      const look = encodeLook(g.look);
      for (const screens of chunkScreens(g.ids.sort())) {
        this.send({ type: MSG_LOOK, target: { screens }, seq: this._nextSeq(), live: g.live, look });
        this.counters.messages++;
      }
    }
  }

  _dispatchTriggers() {
    if (!this._pendingTriggers.length) return;
    const pending = this._pendingTriggers;
    this._pendingTriggers = [];
    const groups = new Map();
    for (const { st, trigger } of pending) {
      const k = trigger.kind + ':' + trigger.index;
      if (!groups.has(k)) groups.set(k, { trigger, sts: [] });
      groups.get(k).sts.push(st);
    }
    for (const { trigger, sts } of groups.values()) {
      let targets = sts;
      if (trigger.index === 0) {
        // Call 0 hangs up a call, SMS 0 dismisses a notification: never close the other kind.
        const other = trigger.kind === 'call' ? 'sms' : 'call';
        targets = sts.filter((st) => st.overlay !== other);
        for (const st of targets) st.overlay = null;
      }
      const list = trigger.kind === 'call' ? this.callEntries : this.smsEntries;
      const entry = trigger.index > 0 ? list[trigger.index - 1] : null;
      const ids = targets.map((st) => st.id).sort();
      let sent = false;
      if (ids.length) {
        for (const screens of chunkScreens(ids)) {
          const msg = triggerMessage(trigger, entry, screens);
          if (msg) { this.send(msg); this.counters.messages++; sent = true; }
        }
        if (sent && trigger.index > 0) for (const st of targets) st.overlay = trigger.kind;
      }
      this.counters.triggers++;
      if (this.onTrigger) this.onTrigger({ kind: trigger.kind, index: trigger.index, screens: ids, sent });
    }
  }

  _answerPoll(poll, rinfo) {
    if (!this.artPollReply || !this.sendUdp || !rinfo || !rinfo.address) return 'poll-ignored';
    const portAddresses = this.patch.universes('artnet');
    if (!shouldReplyToPoll(poll, portAddresses.length ? portAddresses : [0])) return 'poll-not-targeted';
    const active = [], merging = [];
    for (const pa of portAddresses) {
      const u = this.artnet.getUniverse(pa);
      if (u && u.data && !u.lost) active.push(pa);
      if (u && u.merging) merging.push(pa);
    }
    const replies = buildArtPollReplies(Object.assign({}, this.artPollReply, {
      portAddresses, activePortAddresses: active, mergingPortAddresses: merging,
      ltp: this.artnet.mergeMode === 'ltp', replyCounter: ++this._pollReplies,
    }));
    // Art-Net 4: ArtPollReply is unicast to the controller that polled.
    for (const r of replies) this.sendUdp(r, rinfo.address, ARTNET_PORT);
    this.counters.pollReplies += replies.length;
    return 'poll-replied';
  }

  // ───────────────────────────── status ─────────────────────────────

  /** Current state for a gateway UI. */
  snapshot() {
    const universes = [];
    for (const [protocol, m] of [['sacn', this.sacn], ['artnet', this.artnet]]) {
      for (const u of m.universes()) {
        const s = m.getUniverse(u);
        universes.push({ protocol, universe: u, lost: !!s.lost, hasData: !!s.data, sources: s.sources });
      }
    }
    const screens = [];
    for (const st of this._screens.values()) {
      screens.push({ id: st.id, ...st.entry, live: st.live, look: st.look, lastSentAt: st.lastSentAt });
    }
    return { universes, screens, counters: JSON.parse(JSON.stringify(this.counters)) };
  }
}
