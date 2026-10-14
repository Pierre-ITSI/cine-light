// Harnais Playwright commun aux tests (aucune dépendance hors playwright).
//
// • Chromium : chemin configurable par PW_CHROMIUM (sinon navigateur géré par
//   Playwright, installé en CI via « npx playwright install --with-deps »).
// • Hermétique : toute requête http(s) est bloquée (polices Google, QR…),
//   Math.random est déterministe, et la bibliothèque mqtt.js est remplacée
//   par un faux client qui ne se connecte jamais tout seul : mqttClient ne
//   joint aucun broker et sendMsg reste sans effet, sauf si un test le
//   connecte explicitement (FakeBroker) pour observer le protocole.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INDEX_PATH = path.join(ROOT, 'index.html');
export const fileUrl = (p) => pathToFileURL(p).href;

let _pw = null;
export function playwright() { return (_pw ||= require('playwright')); }

export async function launchBrowser() {
  const opts = { args: ['--no-sandbox'] };
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
    clock = false, seed = 42, broker = null, waitLoad = true,
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
  // Messages publiés par une page (types optionnellement filtrés)
  sent(page, type) { return this.log.filter((e) => e.from === page && e.msg && (!type || e.msg.type === type)).map((e) => e.msg); }
  clear() { this.log.length = 0; }
}

// Connecte tous les faux clients non connectés d'une page (simule le broker)
export async function connectFakeClients(page) {
  await page.evaluate(() => { for (const c of window.__mqttClients) if (!c.connected && !c.disconnecting) c._connect(); });
}
