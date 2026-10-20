// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Harnais Playwright commun aux tests (aucune dépendance hors playwright).
//
// • Chromium : chemin configurable par PW_CHROMIUM (sinon navigateur géré par
//   Playwright, installé en CI via « npx playwright install --with-deps »).
// • Hermétique : toute requête http(s) est bloquée (images QR…) ; les
//   polices, servies depuis vendor/fonts/ en file://, se chargent,
//   Math.random est déterministe, et la bibliothèque mqtt.js est remplacée
//   par un faux client qui ne se connecte jamais tout seul : mqttClient ne
//   joint aucun broker et sendMsg reste sans effet, sauf si un test le
//   connecte explicitement (FakeBroker) pour observer le protocole.
// • Chiffrement de bout en bout : les trames publiées sont opaques ; les tests
//   les déchiffrent côté Node avec le paquet protocole (decodeFrames, sent())
//   et forgent des trames de pairs (fakePeer) pour éprouver la réception.
import { createRequire } from 'node:module';
import * as SRP from '../../packages/protocol/index.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INDEX_PATH = path.join(ROOT, 'index.html');
export const fileUrl = (p) => pathToFileURL(p).href;

let _pw = null;
export function playwright() { return (_pw ||= require('playwright')); }

export async function launchBrowser() {
  // --disable-partial-raster : sans lui, une page re-rastérisée en partie
  // (invalidation tardive) gardait parfois des coins arrondis anticrénelés
  // autrement (±4 sur ~30 pixels) : captures instables d'un rendu à l'autre
  // (remote-qr ≈ 1 fois sur 10, déjà sur main). Rastérisation complète = rendu
  // reproductible, identique aux captures stockées.
  const opts = { args: ['--no-sandbox', '--disable-partial-raster'] };
  if (process.env.PW_CHROMIUM) opts.executablePath = process.env.PW_CHROMIUM;
  return playwright().chromium.launch(opts);
}

// Heure figée des tests (écran verrouillé, horloges) : ven. 17 juil. 2026, 00:10 Paris
export const T0 = Date.parse('2026-07-17T00:10:00+02:00');

// ── Script injecté avant l'app ──
function initScript({ seed }) {
  // PRNG mulberry32 : rend déterministes canal aléatoire, effets, etc.
  let s = seed >>> 0;
  Math.random = function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Faux mqtt.js : même surface que ce qu'utilise l'app (connect, on,
  // subscribe, publish, end, connected, disconnecting).
  const clients = [];
  class FakeClient {
    constructor(url, opts) {
      this.url = url; this.options = opts || {};
      this.connected = false; this.disconnecting = false; this.reconnecting = false;
      this._h = {}; this.published = []; this.subscriptions = [];
      clients.push(this);
      // Option autoConnect : le « broker » accepte aussitôt chaque client
      if (window.__fakeAutoConnect) setTimeout(() => { if (!this.connected && !this.disconnecting) this._connect(); }, 0);
    }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
    emit(ev, ...args) { (this._h[ev] || []).slice().forEach((fn) => fn(...args)); }
    subscribe(topic, opts, cb) {
      if (!this.subscriptions.includes(topic)) this.subscriptions.push(topic);
      if (typeof cb === 'function') setTimeout(() => cb(null, [{ topic, qos: 0 }]), 0);
      return this;
    }
    publish(topic, payload) {
      const str = String(payload);
      this.published.push({ topic, payload: str });
      if (this.connected && typeof window.__fakeBrokerPublish === 'function') {
        window.__fakeBrokerPublish(topic, str);
      }
      return this;
    }
    end() {
      if (this.disconnecting) return this;
      this.disconnecting = true;
      const was = this.connected; this.connected = false;
      this.emit('close');
      if (was) this.emit('offline');
      this.emit('end');
      return this;
    }
    // ── Pilotage par les tests ──
    _connect() { this.connected = true; this.reconnecting = false; this.emit('connect', { sessionPresent: false }); }
    _drop() { // coupure réseau : close + offline puis tentative de reconnexion
      this.connected = false; this.emit('close'); this.emit('offline');
      this.reconnecting = true; this.emit('reconnect');
    }
    _deliver(topic, payload) {
      const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
      this.emit('message', topic, { toString: () => str });
    }
  }
  const fake = { connect: (url, opts) => new FakeClient(url, opts), __fake: true };
  window.__mqttClients = clients;
  // Livraison venant du faux broker (Node) : à tout client connecté abonné.
  window.__fakeMqttDeliver = (topic, payload) => {
    for (const c of clients) {
      if (c.connected && !c.disconnecting && c.subscriptions.includes(topic)) c._deliver(topic, payload);
    }
  };
  // La balise <script src="vendor/mqtt…"> déclare « var mqtt = … » : l'accesseur
  // ignore l'affectation et conserve le faux.
  Object.defineProperty(window, 'mqtt', { configurable: false, enumerable: true, get: () => fake, set: () => {} });
}

// Ouvre une page isolée (contexte dédié) sur index.html (ou un autre fichier).
export async function openPage(browser, opts = {}) {
  const {
    file = INDEX_PATH, hash = '', viewport = { width: 390, height: 844 },
    clock = false, seed = 42, broker = null, waitLoad = true, autoConnect = false, init = null,
  } = opts;
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 1, locale: 'fr-FR', timezoneId: 'Europe/Paris',
    hasTouch: false, isMobile: false,
  });
  await context.route('**/*', (route) => {
    const u = route.request().url();
    return u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') ? route.continue() : route.abort();
  });
  await context.addInitScript(initScript, { seed });
  if (autoConnect) await context.addInitScript(() => { window.__fakeAutoConnect = true; });
  if (init) await context.addInitScript(init.fn || init, init.arg);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message || String(e)));
  if (broker) await broker.attach(context, page);
  if (clock) {
    await page.clock.install({ time: T0 });
    await page.clock.pauseAt(T0 + 1000);
  }
  if (waitLoad) await page.goto(fileUrl(file) + (hash ? '#' + hash : ''));
  return { context, page, errors, close: () => context.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Attend qu'une condition évaluée dans la page devienne vraie.
export async function waitFor(page, fn, arg, { timeout = 5000, interval = 25 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('waitFor: délai dépassé — ' + fn.toString().slice(0, 120));
    await sleep(interval);
  }
}

// ── Faux broker MQTT côté Node : relaie les publications entre pages ──
// (chaque page garde son vrai code applicatif ; seul le transport est simulé)
export class FakeBroker {
  constructor() { this.pages = []; this.log = []; this._chains = new Map(); }
  async attach(context, page) {
    this.pages.push(page);
    this._chains.set(page, Promise.resolve());
    await context.exposeFunction('__fakeBrokerPublish', (topic, payload) => {
      let msg = null; try { msg = JSON.parse(payload); } catch (_) {}
      this.log.push({ from: page, topic, msg, payload });
      for (const p of this.pages) {
        // Comme un vrai broker : l'émetteur abonné reçoit aussi son message
        const next = this._chains.get(p).then(() => p.evaluate(([t, pl]) => window.__fakeMqttDeliver(t, pl), [topic, payload])).catch(() => {});
        this._chains.set(p, next);
      }
    });
  }
  async flush() { await Promise.all([...this._chains.values()]); }
  // Messages de SESSION publiés par une page, déchiffrés (types optionnellement filtrés)
  async sent(page, type) {
    const pairing = await page.evaluate(() => _session);
    const frames = this.log.filter((e) => e.from === page && e.topic.startsWith(SRP.SESSION_TOPIC_PREFIX)).map((e) => e.payload);
    const msgs = await decodeFrames(pairing, frames);
    return type ? msgs.filter((m) => m.type === type) : msgs;
  }
  // Messages EN CLAIR (rendez-vous d'appairage) publiés par une page
  plain(page, type) { return this.log.filter((e) => e.from === page && e.msg && (!type || e.msg.type === type)).map((e) => e.msg); }
  clear() { this.log.length = 0; }
}

export { SRP };

// Déchiffre des trames d'une session (messages des deux sens ; fragments et
// trames illisibles ignorés). Sans anti-rejeu : pour observer, pas pour filtrer.
export async function decodeFrames(pairing, frames) {
  const { keys } = await SRP.deriveSession(pairing);
  const out = [];
  for (const f of frames) {
    for (const key of [keys.r2s, keys.s2r]) {
      try { out.push(await SRP.open(f, key, null)); break; } catch (_) {}
    }
  }
  return out;
}

// Messages publiés par le client MQTT courant d'une page, déchiffrés
export async function publishedBy(page, type) {
  const { pairing, frames } = await page.evaluate(() => ({
    pairing: _session, frames: mqttClient ? mqttClient.published.map((p) => p.payload) : [],
  }));
  const msgs = await decodeFrames(pairing, frames);
  return type ? msgs.filter((m) => m.type === type) : msgs;
}

// Pair simulé côté Node (télécommande ou écran) sur la session d'une page :
//   seal(msg)  → trame valide (schéma vérifié), comme l'app
//   forge(msg) → trame authentique mais HORS schéma (2e barrière, rejets)
export async function fakePeer(pairing, role = 'remote', screenId = SRP.createScreenId()) {
  const ch = await SRP.createSecureChannel({ pairing, role, screenId: role === 'screen' ? screenId : undefined });
  const { keys } = await SRP.deriveSession(pairing);
  const sender = SRP.newSenderTag(role === 'remote' ? 'r' : 's');
  let seq = 0;
  return {
    ch, screenId, topic: ch.mqttTopic,
    seal: (msg) => ch.seal(msg),
    forge: (msg, o = {}) => SRP.seal(msg, role === 'remote' ? keys.r2s : keys.s2r, { sender, seq: seq++, ...o }),
    receive: (frame) => ch.receive(frame),
  };
}

// Livre une trame au client MQTT de la page (vrai gestionnaire 'message') et
// attend qu'elle soit traitée (déchiffrement + aiguillage)
export async function deliverFrame(page, frame, topic) {
  await page.evaluate(([f, t]) => {
    mqttClient._deliver(t || _sec.mqttTopic, f);
    return _rxChain.then(() => null);
  }, [frame, topic || null]);
}

// Fragment d'appairage (« p=v1.… ») de la session de la télécommande d'une
// page (indépendant de l'adresse publique : en file://, pas d'adresse)
export const pairingHash = (page) => page.evaluate(() => SRP.pairingUrl('https://setremote.test/', _session).split('#')[1]);

// Coque native simulée : adresse publique fournie par l'app (et pont natif si bridge)
export const nativeShell = (publicUrl, bridge = false) => ({
  fn: ([url, withBridge]) => {
    window.SETREMOTE_NATIVE = { platform: 'ios', bridge: 1, publicUrl: url };
    if (withBridge) window.ReactNativeWebView = { postMessage: () => {} };
  },
  arg: [publicUrl, bridge],
});

// Connecte tous les faux clients non connectés d'une page (simule le broker)
export async function connectFakeClients(page) {
  await page.evaluate(() => { for (const c of window.__mqttClients) if (!c.connected && !c.disconnecting) c._connect(); });
}

// ── Tel › Discussion (phase 4) : l'action est la barre fixe ──
// « Envoyer n° X » : ouvre d'abord la discussion sur l'écran (« Ouvrir sur l'écran ») si besoin, puis envoie
export async function chatGo(page) {
  if (!(await page.evaluate(() => _chat.open))) await page.click('#dcOpenBtn');
  await page.click('#dcGo');
}
// « Lecture auto » (bascule de la barre, devenue « Pause » tant qu'elle tourne) ; ouvre la discussion si besoin
export async function chatAutoToggle(page) {
  if (!(await page.evaluate(() => _chat.open))) await page.click('#dcOpenBtn');
  await page.click('#dcAutoPlay');
}
// Menu ⋯ du titre « Fil » : une entrée par son libellé
export async function chatThreadMenu(page, label) {
  await page.click('#dcThreadMore');
  await page.locator('#srSheetBody .dc-menu-btn', { hasText: label }).click();
}
// Indicateur « … écrit » (interrupteur de la carte, case masquée sous son dessin)
export const chatTyping = (page, on) => page.evaluate((on) => { const el = document.getElementById('dcTypingToggle'); el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); }, on);
