#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
/**
 * SetRemote — relais WebSocket auto-hébergé. Conception de docs/BROKER.md §2.1
 * (Durable Objects Cloudflare) ramenée à UN processus Node, tout en mémoire.
 *
 *   GET /v2/s/<topic>  salle de session (topic : 22 car. base64url canoniques, packages/protocol)
 *   GET /v2/rdv/<id>   rendez-vous d'appairage par code : 4 sockets, trames ≤ 4 Kio, 5 min
 *   GET /healthz       état et compteurs AGRÉGÉS (JSON)
 *   GET /metrics       { channels, clients } : salles de session actives et sockets connectés,
 *                      sur une écoute INTERNE séparée (RELAY_METRICS_PORT, désactivée par
 *                      défaut), jamais routée par le proxy : lue dans le réseau Docker
 *
 * Chaque trame TEXTE est rediffusée telle quelle aux autres sockets de la salle :
 * le contenu est chiffré de bout en bout, le relais ne lit rien. Refus : binaire,
 * caractère hors de l'alphabet réel du protocole (base64url des trames scellées ;
 * JSON compact des messages pair:*). Preuve facultative relayAuth dans
 * Sec-WebSocket-Protocol (« auth.<43 car.> », jamais dans l'URL), en TOFU : la 1re
 * preuve d'une salle fait foi (SHA-256), oubliée après 30 jours sans activité,
 * persistance facultative (RELAY_AUTH_FILE). SANS fichier, un redémarrage RÉARME
 * le TOFU. Aucun journal de contenu, de topic ni d'IP : des compteurs seulement.
 * Configuration : options de createRelay() ou variables d'environnement (configFromEnv).
 */
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

/** Options (variable d'environnement : PORT, HOST, sinon RELAY_ + nom en SNAKE_CASE, ex. RELAY_TRUST_PROXY) */
export const DEFAULTS = Object.freeze({
  port: 8080, host: /** @type {string | undefined} */ (undefined), // toutes les interfaces
  maxFrameBytes: 64 * 1024, roomMaxSockets: 32,         // trame de session légitime ≤ 54 782 car.
  rdvMaxFrameBytes: 4 * 1024, rdvMaxSockets: 4, rdvTtlMs: 5 * 60_000,
  rateFrames: 100, rateBytes: 2 * 1024 * 1024,           // seau par socket, capacité = 1 s
  slowSocketBytes: 4 * 1024 * 1024,                      // destinataire trop lent : trames perdues (QoS 0)
  ipMaxSockets: 64, ipConnBurst: 30, ipConnPerMin: 60,   // par IP (IPv6 : par /64)
  maxSockets: 4000, maxRooms: 2000, memLimitMb: 384,     // plafonds globaux (RSS : nouvelles connexions refusées)
  pingMs: 25_000,                                        // ping/pong + battement texte vide
  requireAuth: false, authTtlMs: 30 * 86_400_000, authMaxEntries: 100_000, authFile: '',
  trustProxy: '',  // IP ou CIDR du proxy inverse (virgules) : seul cru pour X-Forwarded-For
  origins: '',     // origines autorisées (virgules ; vide = toutes)
  metricsPort: 0,  // écoute interne de GET /metrics (0 = désactivée)
  metricsHost: '127.0.0.1', // son adresse (Docker : 0.0.0.0, port NON publié)
  now: Date.now,   // horloge des échéances (tests)
});
export const PROTOCOL = 'setremote.v2';
const ROUTE = /^\/v2\/(s|rdv)\/([A-Za-z0-9_-]{21}[AQgw])$/;   // 16 octets, base64url canonique
const AUTH = /^auth\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/; // 32 octets (relayAuth)
const DAY = 86_400_000;
const table = (extra) => {
  const t = new Uint8Array(256);
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_' + extra) t[c.charCodeAt(0)] = 1;
  return t;
};
const CHARSET = { s: table(''), rdv: table('{}[]":,') }; // seal()/sealChunk() ; JSON.stringify(pair:*)
const sha256 = (s) => createHash('sha256').update(s).digest();
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const norm = (ip) => (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip);

/** Clé de limitation par IP : l'IPv4 telle quelle, le préfixe /64 d'une IPv6. @param {string} ip */
export function ipKey(ip) {
  if (isIP(ip) !== 6) return ip;
  const [a, b] = ip.split('%')[0].split('::');
  const head = a ? a.split(':') : [], tail = b ? b.split(':') : [];
  const full = b === undefined ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return full.slice(0, 4).map((h) => parseInt(h, 16).toString(16)).join(':') + '::/64';
}

/** @param {Record<string, string | undefined>} env @returns {Partial<typeof DEFAULTS>} */
export function configFromEnv(env) {
  const o = {};
  for (const [key, d] of Object.entries(DEFAULTS)) {
    const name = key === 'port' || key === 'host' ? key.toUpperCase() : 'RELAY_' + key.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase();
    const v = env[name];
    if (v === undefined || v === '' || typeof d === 'function') continue;
    if (typeof d === 'number' && !(Number(v) >= 0)) throw new Error(`configuration invalide : ${name}`);
    o[key] = typeof d === 'number' ? Number(v) : typeof d === 'boolean' ? /^(1|true|yes|on|oui)$/i.test(v) : v;
  }
  return o;
}

/** @param {Partial<typeof DEFAULTS>} [options] */
export function createRelay(options = {}) {
  const cfg = { ...DEFAULTS, ...options }, now = cfg.now;
  const trusted = new BlockList();
  for (const t of list(cfg.trustProxy)) {
    const [addr, bits] = t.split('/'), fam = isIP(addr) === 6 ? 'ipv6' : 'ipv4';
    if (!isIP(addr)) throw new Error('RELAY_TRUST_PROXY : adresse invalide');
    if (bits === undefined) trusted.addAddress(addr, fam); else trusted.addSubnet(addr, Number(bits), fam);
  }
  const isTrusted = (ip) => isIP(ip) !== 0 && trusted.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
  const origins = new Set(list(cfg.origins));
  const counters = { accepted: 0, refused: 0, closed_binary: 0, closed_charset: 0, closed_size: 0, closed_abuse: 0,
    frames_in: 0, frames_out: 0, bytes_in: 0, bytes_out: 0, throttled: 0, dropped_slow: 0, ping_timeouts: 0,
    rdv_expired: 0, tofu_rejected: 0, persist_errors: 0, refused_by_status: /** @type {Record<number, number>} */ ({}) };
  const rooms = new Map();  // 's:<topic>' | 'rdv:<id>' → { kind, key, sockets, tk, timer }
  const rdvExp = new Map(); // id de rendez-vous → échéance (survit à la salle vide : pas de prolongation)
  const ips = new Map();    // clé IP → { sockets, tokens, t }
  const auth = loadAuth();  // SHA-256(topic) → { h: SHA-256(relayAuth), t: dernière activité }, ordre LRU
  let sockets = 0, closing = false, authDirty = false;
  const t0 = now(), overMem = () => process.memoryUsage.rss() > cfg.memLimitMb * 1048576;

  const wsOpts = { noServer: true, clientTracking: false, perMessageDeflate: false, skipUTF8Validation: true,
    handleProtocols: (p) => (p.has(PROTOCOL) ? PROTOCOL : false) }; // jamais la preuve en réponse
  const wss = { s: new WebSocketServer({ ...wsOpts, maxPayload: cfg.maxFrameBytes }),
    rdv: new WebSocketServer({ ...wsOpts, maxPayload: cfg.rdvMaxFrameBytes }) };
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/healthz') return res.writeHead(ROUTE.test(req.url || '') ? 426 : 404).end();
    const s = stats();
    res.writeHead(s.ok ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(s));
  });
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const v = admit(req, clientIp(req));
    if (typeof v !== 'number') return wss[v.kind].handleUpgrade(req, socket, head, (ws) => join(ws, v));
    counters.refused++; counters.refused_by_status[v] = (counters.refused_by_status[v] || 0) + 1;
    socket.once('finish', () => socket.destroy());
    socket.end(`HTTP/1.1 ${v} ${http.STATUS_CODES[v]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });
  // Écoute interne : seulement GET /metrics, rien d'autre (ni WebSocket, ni /healthz)
  const metricsServer = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(metrics()));
  });
  metricsServer.on('upgrade', (req, socket) => socket.destroy());
  const timer = setInterval(sweep, cfg.pingMs);
  timer.unref();

  /** X-Forwarded-For lu de droite à gauche, et seulement si le pair est un proxy de confiance. */
  function clientIp(req) {
    let ip = norm(req.socket.remoteAddress || '');
    const xff = isTrusted(ip) ? String(req.headers['x-forwarded-for'] || '').split(',') : [];
    for (let i = xff.length - 1; i >= 0; i--) {
      const c = norm(xff[i].trim());
      if (!isIP(c)) break;
      ip = c;
      if (!isTrusted(c)) break;
    }
    return ip;
  }

  /** Contrôles AVANT la poignée de main : statut HTTP de refus, ou la salle visée. */
  function admit(req, ip) {
    if (closing || overMem()) return 503;
    const m = ROUTE.exec(req.url || '');
    if (!m) return 404;
    if (origins.size && !origins.has(String(req.headers.origin || ''))) return 403;
    const k = ipKey(ip);
    let st = ips.get(k);
    if (!st) {
      if (ips.size >= cfg.maxSockets * 4) return 503;
      ips.set(k, (st = { sockets: 0, tokens: cfg.ipConnBurst, t: performance.now() }));
    }
    refill(st);
    if (st.sockets >= cfg.ipMaxSockets || st.tokens < 1) return 429;
    st.tokens--;
    const kind = m[1], id = m[2], key = kind + ':' + id, room = rooms.get(key);
    const max = kind === 's' ? cfg.roomMaxSockets : cfg.rdvMaxSockets;
    if (sockets >= cfg.maxSockets || (room ? room.sockets.size >= max : rooms.size >= cfg.maxRooms)) return 503;
    if (kind === 'rdv') return rdvExp.get(id) <= now() ? 410 : { kind, id, key, st, proof: null };
    const offered = list(req.headers['sec-websocket-protocol']).filter((p) => p.startsWith('auth.'));
    const pm = offered.length === 1 ? AUTH.exec(offered[0]) : null;
    if (offered.length && !pm) return 401;
    const tk = sha256(id).toString('base64url'), e = auth.get(tk), proof = pm && { tk, h: sha256(pm[1]) };
    if (proof ? e && !timingSafeEqual(e.h, proof.h) : e || cfg.requireAuth) { counters.tofu_rejected++; return 401; }
    return { kind, id, key, st, proof };
  }
  function refill(st) {
    const t = performance.now();
    st.tokens = Math.min(cfg.ipConnBurst, st.tokens + ((t - st.t) * cfg.ipConnPerMin) / 60_000);
    st.t = t;
  }

  function join(ws, v) {
    let room = rooms.get(v.key);
    if (!room) {
      rooms.set(v.key, (room = { kind: v.kind, key: v.key, sockets: new Set(), tk: null, timer: null }));
      if (v.kind === 'rdv') {
        if (!rdvExp.has(v.id)) {
          if (rdvExp.size >= cfg.maxRooms * 8) rdvExp.delete(rdvExp.keys().next().value);
          rdvExp.set(v.id, now() + cfg.rdvTtlMs);
        }
        room.timer = setTimeout(() => {
          counters.rdv_expired++;
          for (const peer of room.sockets) peer.close(4410, 'expired');
        }, Math.max(0, rdvExp.get(v.id) - now()));
        room.timer.unref();
      }
    }
    if (v.proof) { // 1re preuve pour ce topic : elle fait foi, les sockets sans preuve sortent
      if (!auth.has(v.proof.tk)) for (const peer of room.sockets) if (!peer.authed) peer.close(4401, 'auth');
      room.tk = v.proof.tk;
      touchAuth(v.proof.tk, v.proof.h);
    }
    Object.assign(ws, { room, st: v.st, alive: true, authed: !!v.proof,
      tb: { f: cfg.rateFrames, b: cfg.rateBytes, t: performance.now(), q: [], qBytes: 0, timer: null } });
    room.sockets.add(ws);
    sockets++; v.st.sockets++; counters.accepted++;
    ws.on('message', (data, isBinary) => onFrame(ws, data, isBinary));
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', (e) => { if (e && e.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') counters.closed_size++; }); // 1009
    ws.on('close', () => leave(ws));
  }

  function leave(ws) {
    const room = ws.room;
    if (!room) return;
    ws.room = null;
    clearTimeout(ws.tb.timer); ws.tb.q.length = 0;
    sockets--; ws.st.sockets--;
    room.sockets.delete(ws);
    if (room.sockets.size) return;
    clearTimeout(room.timer); // salle vide libérée aussitôt
    if (room.tk) touchAuth(room.tk);
    if (rooms.get(room.key) === room) rooms.delete(room.key);
  }

  function onFrame(ws, data, isBinary) {
    ws.alive = true;
    if (!ws.room || ws.readyState !== WebSocket.OPEN) return;
    if (isBinary) { counters.closed_binary++; return ws.close(1003, 'text only'); }
    const n = data.length, t = CHARSET[ws.room.kind], tb = ws.tb;
    if (!n) return;
    for (let i = 0; i < n; i++) if (!t[data[i]]) { counters.closed_charset++; return ws.close(1007, 'charset'); }
    counters.frames_in++; counters.bytes_in += n;
    if (!tb.q.length && take(tb, n)) return forward(ws, data);
    // Hors budget : la trame attend son tour (ordre conservé) et la LECTURE du socket est
    // suspendue : l'émetteur est ralenti, rien n'est perdu. File démesurée = abus.
    tb.q.push(data); tb.qBytes += n;
    if (tb.q.length > 10 * cfg.rateFrames || tb.qBytes > 4 * cfg.rateBytes) {
      counters.closed_abuse++; tb.q.length = 0; ws.close(1008, 'rate'); return ws.resume();
    }
    if (!tb.timer) { counters.throttled++; ws.pause(); drain(ws); }
  }
  function drain(ws) {
    const tb = ws.tb;
    tb.timer = null;
    while (tb.q.length && take(tb, tb.q[0].length)) { const d = tb.q.shift(); tb.qBytes -= d.length; forward(ws, d); }
    if (!tb.q.length) return ws.resume();
    const n = Math.min(tb.q[0].length, cfg.rateBytes);
    tb.timer = setTimeout(drain, Math.ceil(1000 * Math.max((1 - tb.f) / cfg.rateFrames, (n - tb.b) / cfg.rateBytes, 0)), ws);
  }
  /** Seau à jetons (trames et octets, capacité = 1 s de débit) : true si la trame passe maintenant. */
  function take(tb, n) {
    const t = performance.now(), dt = (t - tb.t) / 1000;
    tb.t = t;
    tb.f = Math.min(cfg.rateFrames, tb.f + dt * cfg.rateFrames);
    tb.b = Math.min(cfg.rateBytes, tb.b + dt * cfg.rateBytes);
    n = Math.min(n, cfg.rateBytes);
    if (tb.f < 1 || tb.b < n) return false;
    tb.f -= 1; tb.b -= n;
    return true;
  }
  function forward(ws, data) {
    for (const peer of ws.room ? ws.room.sockets : []) {
      if (peer === ws || peer.readyState !== WebSocket.OPEN) continue;
      if (peer.bufferedAmount > cfg.slowSocketBytes) { counters.dropped_slow++; continue; }
      peer.send(data, { binary: false });
      counters.frames_out++; counters.bytes_out += data.length;
    }
  }

  // ── TOFU : SHA-256(relayAuth) par salle ; fichier : topic haché, jour d'activité seulement ──
  function touchAuth(tk, h) {
    const e = auth.get(tk), t = now();
    if (!e && !h) return;
    auth.delete(tk);
    auth.set(tk, { h: e ? e.h : h, t });
    if (auth.size > cfg.authMaxEntries) auth.delete(auth.keys().next().value);
    if (!e || Math.floor(e.t / DAY) !== Math.floor(t / DAY)) authDirty = true; // persistée au jour près
  }
  function loadAuth() {
    const m = new Map();
    try {
      if (cfg.authFile) {
        const ok = (s) => /^[A-Za-z0-9_-]{43}$/.test(s);
        const e = JSON.parse(readFileSync(cfg.authFile, 'utf8')).e.filter(([tk, h, d]) => ok(tk) && ok(h) && Number.isInteger(d));
        for (const [tk, h, d] of e.sort((x, y) => x[2] - y[2])) m.set(tk, { h: Buffer.from(h, 'base64url'), t: d * DAY });
      }
    } catch (e) { if (e.code !== 'ENOENT') console.error('relais SetRemote : fichier TOFU illisible, ignoré'); }
    return m;
  }
  function saveAuth() {
    if (!cfg.authFile || !authDirty) return;
    authDirty = false;
    try {
      const e = [...auth].map(([tk, v]) => [tk, v.h.toString('base64url'), Math.floor(v.t / DAY)]);
      writeFileSync(cfg.authFile + '.tmp', JSON.stringify({ v: 1, e }), { mode: 0o600 });
      renameSync(cfg.authFile + '.tmp', cfg.authFile);
    } catch (_) { counters.persist_errors++; authDirty = true; }
  }

  /** Maintenance périodique : ping/pong, battement, IP et rendez-vous oubliés, TOFU expiré, persistance. */
  function sweep() {
    const t = now();
    for (const room of rooms.values()) {
      if (room.tk) touchAuth(room.tk);
      for (const ws of room.sockets) {
        if (!ws.alive) { counters.ping_timeouts++; ws.terminate(); continue; }
        ws.alive = false;
        ws.ping();
        if (ws.readyState === WebSocket.OPEN) ws.send(''); // battement texte vide : le navigateur, qui ne voit pas les pings, détecte un lien mort
      }
    }
    for (const [k, st] of ips) { refill(st); if (!st.sockets && st.tokens >= cfg.ipConnBurst) ips.delete(k); }
    for (const [id, exp] of rdvExp) { if (exp + cfg.rdvTtlMs > t) break; rdvExp.delete(id); }
    for (const [tk, e] of auth) { if (e.t > t - cfg.authTtlMs) break; auth.delete(tk); authDirty = true; }
    saveAuth();
  }

  /** Tournages en cours : salles de session occupées, sockets connectés (rendez-vous compris). */
  function metrics() {
    let channels = 0;
    for (const r of rooms.values()) if (r.kind === 's' && r.sockets.size) channels++;
    return { channels, clients: sockets };
  }

  function stats() {
    let rdv = 0;
    for (const r of rooms.values()) if (r.kind === 'rdv') rdv++;
    return { ok: !closing && !overMem(), uptime_s: Math.round((now() - t0) / 1000), sockets,
      rooms: rooms.size - rdv, rdv_rooms: rdv, tofu_entries: auth.size, rss_mb: Math.round(process.memoryUsage.rss() / 1048576),
      counters: { ...counters, refused_by_status: { ...counters.refused_by_status } } };
  }

  return {
    server, stats, metrics, sweep, config: cfg,
    /** @returns {Promise<import('node:net').AddressInfo>} */
    listen: (port = cfg.port, host = cfg.host) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(/** @type {any} */ (server.address())));
    }),
    /** Écoute interne de GET /metrics. @returns {Promise<import('node:net').AddressInfo>} */
    listenMetrics: (port = cfg.metricsPort, host = cfg.metricsHost) => new Promise((resolve, reject) => {
      metricsServer.once('error', reject);
      metricsServer.listen(port, host, () => resolve(/** @type {any} */ (metricsServer.address())));
    }),
    /** Arrêt propre : plus de connexions, sockets fermés en 1001 (les clients se reconnectent), TOFU écrit. */
    async close(graceMs = 3000) {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      server.close();
      metricsServer.close();
      const all = [...rooms.values()].flatMap((r) => (clearTimeout(r.timer), [...r.sockets]));
      for (const ws of all) ws.close(1001, 'restart');
      for (let t = 0; sockets > 0 && t < graceMs; t += 50) await new Promise((r) => setTimeout(r, 50));
      for (const ws of all) ws.terminate();
      server.closeAllConnections();
      metricsServer.closeAllConnections();
      authDirty ||= auth.size > 0;
      saveAuth();
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cfg = { ...DEFAULTS, ...configFromEnv(process.env) };
  const relay = createRelay(cfg);
  relay.listen().then((a) => { // aucune donnée de connexion : démarrage et réglages généraux seulement
    console.log(`relais SetRemote : port ${a.port}, preuve ${cfg.requireAuth ? 'exigée' : 'facultative'}, TOFU `
      + `${cfg.authFile ? 'persistant' : 'en mémoire (réarmé au redémarrage)'}, proxy de confiance ${cfg.trustProxy ? 'oui' : 'non'}`);
  }, (e) => { console.error('relais SetRemote :', e.message); process.exit(1); });
  if (cfg.metricsPort > 0) {
    relay.listenMetrics().then((a) => console.log(`relais SetRemote : métriques internes sur ${a.address}:${a.port}`),
      (e) => { console.error('relais SetRemote : métriques', e.message); process.exit(1); });
  }
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => relay.close().then(() => { console.log('relais SetRemote : arrêté'); process.exit(0); }));
  }
}
