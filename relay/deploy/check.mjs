#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Vérification du relais SetRemote depuis l'EXTÉRIEUR, sans dépendance (Node ≥ 22,
// lancé par check.sh) :
//   wss  : deux sockets dans une salle de session neuve (preuve TOFU), trame relayée,
//          preuve différente refusée, rendez-vous, chemin invalide refusé ;
//   stun : requête Binding sur le port 3478 en UDP (IPv4, et IPv6 si le nom en a
//          une) et en TCP ; affiche l'adresse publique renvoyée.
// Usage : node check.mjs relais.exemple.fr
// Essai local : CHECK_WS_URL=ws://127.0.0.1:8080 CHECK_STUN_HOST=127.0.0.1 node check.mjs x
import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import net from 'node:net';

const domain = process.argv[2];
if (!domain) { console.error('Usage : node check.mjs relais.exemple.fr'); process.exit(2); }
const base = process.env.CHECK_WS_URL || `wss://${domain}`;
const stunHost = process.env.CHECK_STUN_HOST || domain;
const STUN_PORT = 3478, COOKIE = 0x2112a442;
let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const ko = (m) => { failures++; console.log('  ✗ ' + m); };
const id = (n) => randomBytes(n).toString('base64url'); // 16 octets : 22 car. canoniques, comme un vrai topic

/** Ouvre un WebSocket ; null si refusé ou injoignable (8 s). */
function open(path, protocols = ['setremote.v2']) {
  return new Promise((resolve) => {
    const ws = new WebSocket(base + path, protocols);
    const t = setTimeout(() => { ws.close(); resolve(null); }, 8000);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); resolve(null); };
  });
}
/** Prochain message non vide (le relais envoie aussi un battement vide). */
function next(ws, ms = 5000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    ws.addEventListener('message', (e) => { if (e.data) { clearTimeout(t); resolve(String(e.data)); } });
  });
}

async function checkWebSocket() {
  console.log(`WebSocket (${base})`);
  const topic = id(16), proof = 'auth.' + id(32);
  const a = await open(`/v2/s/${topic}`, ['setremote.v2', proof]);
  const b = a && await open(`/v2/s/${topic}`, ['setremote.v2', proof]);
  if (!a || !b) return ko('connexion à une salle de session impossible (proxy, certificat, relais arrêté ?)');
  if (a.protocol === 'setremote.v2') ok('poignée de main WebSocket, sous-protocole setremote.v2');
  else ko(`sous-protocole inattendu : « ${a.protocol} »`);
  const frame = id(48), got = next(b);
  a.send(frame);
  if ((await got) === frame) ok('trame relayée d\'un socket à l\'autre'); else ko('trame non relayée');
  const intruder = await open(`/v2/s/${topic}`, ['setremote.v2', 'auth.' + id(32)]);
  if (!intruder) ok('preuve différente refusée (TOFU)'); else { intruder.close(); ko('preuve différente ACCEPTÉE'); }
  const rdv = id(16), x = await open(`/v2/rdv/${rdv}`), y = x && await open(`/v2/rdv/${rdv}`);
  if (x && y) {
    const msg = '{"type":"pair:abort","v":1}', r = next(y);
    x.send(msg);
    if ((await r) === msg) ok('rendez-vous d\'appairage relayé'); else ko('rendez-vous non relayé');
  } else ko('connexion au rendez-vous impossible');
  const bad = await open('/v2/s/topic-invalide');
  if (!bad) ok('chemin invalide refusé'); else { bad.close(); ko('chemin invalide ACCEPTÉ'); }
  for (const ws of [a, b, x, y]) ws?.close();
}

function stunRequest() {
  const tid = randomBytes(12), msg = Buffer.alloc(20);
  msg.writeUInt16BE(0x0001, 0); // Binding Request, sans attribut
  msg.writeUInt32BE(COOKIE, 4);
  tid.copy(msg, 8);
  return { msg, tid };
}
/** Adresse (XOR-)MAPPED-ADDRESS d'une réponse Binding Success, ou null. */
function stunAddress(buf, tid) {
  if (buf.length < 20 || buf.readUInt16BE(0) !== 0x0101 || !buf.subarray(8, 20).equals(tid)) return null;
  for (let i = 20; i + 4 <= Math.min(buf.length, 20 + buf.readUInt16BE(2));) {
    const type = buf.readUInt16BE(i), len = buf.readUInt16BE(i + 2), v = buf.subarray(i + 4, i + 4 + len);
    if (type === 0x0020 || type === 0x0001) {
      const x = type === 0x0020, mask = Buffer.concat([buf.subarray(4, 8), tid]);
      const port = v.readUInt16BE(2) ^ (x ? 0x2112 : 0);
      const addr = Buffer.from(v.subarray(4).map((b, k) => b ^ (x ? mask[k] : 0)));
      return v[1] === 1 ? `${[...addr].join('.')}:${port}` : `[${addr.toString('hex').match(/.{4}/g).join(':')}]:${port}`;
    }
    i += 4 + len + ((4 - (len % 4)) % 4);
  }
  return null;
}
function stunUdp(host, family) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
    const { msg, tid } = stunRequest();
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(t); timers.forEach(clearTimeout); sock.close(); resolve(r); };
    const t = setTimeout(() => finish(null), 3000);
    sock.on('message', (m) => { const r = stunAddress(m, tid); if (r) finish(r); });
    sock.on('error', () => finish(null));
    const timers = [0, 500, 1500].map((d) => setTimeout(() => { if (!done) sock.send(msg, STUN_PORT, host); }, d));
  });
}
function stunTcp(host) {
  return new Promise((resolve) => {
    const { msg, tid } = stunRequest();
    const s = net.connect({ host, port: STUN_PORT, timeout: 4000 }, () => s.write(msg));
    let buf = Buffer.alloc(0);
    const finish = (r) => { s.destroy(); resolve(r); };
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 20 && buf.length >= 20 + buf.readUInt16BE(2)) finish(stunAddress(buf, tid));
    });
    s.on('timeout', () => finish(null));
    s.on('error', () => finish(null));
  });
}

async function checkStun() {
  console.log(`STUN (${stunHost}:${STUN_PORT})`);
  let addrs = [];
  try { addrs = await dns.lookup(stunHost, { all: true }); } catch (_) {}
  if (!addrs.length) return ko(`${stunHost} ne se résout pas`);
  for (const family of [4, 6]) {
    const a = addrs.find((x) => x.family === family);
    if (!a) continue;
    const r = await stunUdp(a.address, family);
    if (r) ok(`UDP IPv${family} : adresse publique vue par le serveur ${r}`);
    else ko(`UDP IPv${family} sans réponse (port 3478/udp fermé ? pare-feu OVH, ufw)`);
  }
  const r = await stunTcp(stunHost);
  if (r) ok(`TCP : adresse publique vue par le serveur ${r}`); else ko('TCP sans réponse (port 3478/tcp fermé ?)');
}

await checkWebSocket();
await checkStun();
process.exit(failures ? 1 : 0);
