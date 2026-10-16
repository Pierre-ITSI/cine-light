// Faux pont natif pour les liaisons locales (docs/OFFLINE.md) : relie les
// pages entre elles, dans le processus de test, en Wi-Fi local ('lan') et en
// Bluetooth ('ble'), comme le ferait la coque native.
//
// • Chaque page est une coque simulée (window.SETREMOTE_NATIVE +
//   ReactNativeWebView.postMessage) ; ses messages link:* arrivent ici.
// • Topologie en étoile : une télécommande et ses écrans sont pairs sur une
//   liaison quand ils ont ouvert la même salle (room) avec ce mode, que le mode
//   est disponible sur les deux appareils et que la liaison n'est pas coupée
//   (hub.setUp(mode, false) : coupure générale ; hub.cut(page, mode) : un seul
//   appareil). Identifiants de pairs distincts par liaison : 'lan-2', 'ble-2'.
// • link:peers à chaque changement, link:state en réponse à link:start,
//   link:stop et link:state?.
// • link:send : trames remises dans l'ordre aux pairs visés (to) ; une trame
//   de plus de 4 Kio vers un pair Bluetooth est REFUSÉE et notée dans
//   hub.violations (la PWA ne doit jamais en produire).
import { decodeFrames } from './harness.mjs';

export const BLE_MAX = 4096, LAN_MAX = 65536;

export class FakeLinkHub {
  constructor() {
    this.nodes = [];
    this.log = [];         // { from, to, mode, frame } trames remises
    this.violations = [];  // trames refusées (plafond Bluetooth, pair inconnu)
    this.posts = [];       // { node, msg } tous les messages PWA → coque
    this.up = { lan: true, ble: true };
  }

  // Coque simulée pour openPage({ init }) : pont présent dès le début
  static init() {
    return {
      fn: () => {
        window.SETREMOTE_NATIVE = { platform: 'android', bridge: 1 };
        window.ReactNativeWebView = { postMessage: (s) => window.__linkPost(s) };
      },
    };
  }

  // Branche une page (à passer dans openPage({ broker })), avec un faux broker éventuel
  with(broker, opts = {}) {
    return {
      attach: async (context, page) => {
        if (broker) await broker.attach(context, page);
        await this.attach(context, page, opts);
      },
    };
  }

  async attach(context, page, { available = { lan: true, ble: true } } = {}) {
    const node = { idx: this.nodes.length, page, available: { ...available }, role: null, room: null, modes: [], down: new Set(), peers: '[]', chain: Promise.resolve() };
    this.nodes.push(node);
    await context.exposeFunction('__linkPost', (s) => { let m = null; try { m = JSON.parse(s); } catch (_) {} if (m) this._onPost(node, m); });
    return node;
  }
  node(page) { return this.nodes.find((n) => n.page === page); }

  // ── Pilotage par les tests ──
  setUp(mode, on) { this.up[mode] = on; this._recompute(); }
  cut(page, mode, cut = true) { const n = this.node(page); if (cut) n.down.add(mode); else n.down.delete(mode); this._recompute(); }
  setAvailable(page, mode, on) { const n = this.node(page); n.available[mode] = on; this._sendState(n); this._recompute(); }
  async flush() { for (let i = 0; i < 3; i++) await Promise.all(this.nodes.map((n) => n.chain)); }
  clear() { this.log.length = 0; this.posts.length = 0; }
  posted(page, type) { const n = this.node(page); return this.posts.filter((p) => p.node === n && (!type || p.msg.type === type)).map((p) => p.msg); }
  // Messages de session remis par une liaison (déchiffrés)
  async sent(page, { mode, type } = {}) {
    const n = this.node(page);
    const pairing = await page.evaluate(() => _session);
    const frames = this.log.filter((e) => e.from === n.idx && (!mode || e.mode === mode)).map((e) => e.frame);
    const msgs = await decodeFrames(pairing, [...new Set(frames)]);
    return type ? msgs.filter((m) => m.type === type) : msgs;
  }

  // ── Coque ──
  _push(node, msg) {
    node.chain = node.chain.then(() => node.page.evaluate((m) => window.SRNative.receive(m), msg)).catch(() => {});
  }
  _active(node, mode) { return node.modes.includes(mode) && node.available[mode] && this.up[mode] && !node.down.has(mode); }
  _sendState(node) {
    const st = (m) => ({ available: !!node.available[m], active: node.modes.includes(m) && !!node.available[m] });
    this._push(node, { type: 'link:state', lan: st('lan'), ble: st('ble') });
  }
  _peersOf(node) {
    const out = [];
    if (!node.room) return out;
    for (const o of this.nodes) {
      if (o === node || o.room !== node.room || !o.role || o.role === node.role) continue;
      if (node.role === 'screen' && o.role !== 'remote') continue;
      for (const mode of ['lan', 'ble']) if (this._active(node, mode) && this._active(o, mode)) out.push({ peer: mode + '-' + o.idx, mode, node: o });
    }
    return out;
  }
  _recompute() {
    for (const n of this.nodes) {
      const peers = this._peersOf(n).map((p) => ({ peer: p.peer, mode: p.mode }));
      const k = JSON.stringify(peers);
      if (k === n.peers) continue;
      n.peers = k;
      this._push(n, { type: 'link:peers', peers });
    }
  }
  _onPost(node, msg) {
    this.posts.push({ node, msg });
    switch (msg.type) {
      case 'link:state?': this._sendState(node); break;
      case 'link:start':
        node.role = msg.role; node.room = msg.room;
        node.modes = (msg.modes || []).filter((m) => m === 'lan' || m === 'ble');
        this._sendState(node); this._recompute(); break;
      case 'link:stop':
        node.modes = msg.modes ? node.modes.filter((m) => !msg.modes.includes(m)) : [];
        if (!node.modes.length) node.room = null;
        this._sendState(node); this._recompute(); break;
      case 'link:send': {
        const peers = this._peersOf(node).filter((p) => !msg.to || msg.to.includes(p.peer));
        for (const frame of msg.frames || []) {
          for (const p of peers) {
            if (frame.length > (p.mode === 'ble' ? BLE_MAX : LAN_MAX)) { this.violations.push({ from: node.idx, mode: p.mode, size: frame.length }); continue; }
            this.log.push({ from: node.idx, to: p.node.idx, mode: p.mode, frame });
            this._push(p.node, { type: 'link:frames', frames: [{ peer: p.mode + '-' + node.idx, mode: p.mode, data: frame }] });
          }
        }
        break;
      }
    }
  }
}
