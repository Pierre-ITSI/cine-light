// Relais WebSocket (relay/server.js) : routes et validation, rediffusion,
// limites (taille, débit, salles, IP), rendez-vous, TOFU, X-Forwarded-For,
// keepalive, arrêt propre. Aucune dépendance hors ws ; trames et topics réels
// produits par packages/protocol.
//   cd relay && npm test     (aussi exécuté par le `npm test` racine)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createRelay, configFromEnv, ipKey, PROTOCOL } from '../server.js';
import * as SRP from '../../packages/protocol/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const topic = () => randomBytes(16).toString('base64url'); // 22 caractères canoniques, comme session.topic
const proof = () => 'auth.' + randomBytes(32).toString('base64url');

async function start(opts = {}) {
  const relay = createRelay({ memLimitMb: 1 << 16, ...opts });
  const { port } = await relay.listen(0, '127.0.0.1');
  return { relay, ws: `ws://127.0.0.1:${port}`, http: `http://127.0.0.1:${port}`, close: () => relay.close(200) };
}

/** Client de test : ouvre, collecte les messages (battements vides comptés à part). */
function connect(url, { protocols = [PROTOCOL], ...opts } = {}) {
  return new Promise((resolve, reject) => {
    const ws = /** @type {any} */ (new WebSocket(url, protocols, opts));
    ws.inbox = []; ws.beats = 0; ws.waiters = [];
    ws.closed = new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: String(reason) })));
    ws.on('message', (d, bin) => {
      if (!bin && d.length === 0) { ws.beats++; return; }
      ws.inbox.push(bin ? d : String(d));
      ws.waiters.splice(0).forEach((f) => f());
    });
    ws.on('error', (e) => {
      const m = /Unexpected server response: (\d+)/.exec(e.message);
      reject(Object.assign(e, { status: m ? Number(m[1]) : 0 }));
    });
    ws.once('open', () => resolve(ws));
  });
}
const refused = (url, opts) => connect(url, opts).then((ws) => { ws.close(); return 101; }, (e) => e.status);
async function next(ws, timeout = 2000) {
  const t0 = Date.now();
  while (!ws.inbox.length) {
    if (Date.now() - t0 > timeout) throw new Error('aucun message');
    await new Promise((r) => { ws.waiters.push(r); setTimeout(r, 50); });
  }
  return ws.inbox.shift();
}
async function silent(ws, ms = 150) { await sleep(ms); assert.deepEqual(ws.inbox, [], 'aucun message attendu'); }
const closeAll = (...l) => Promise.all(l.map((ws) => (ws.close(), ws.closed)));

test('routes : /healthz, 404, 426, topics exactement comme packages/protocol les dérive', async () => {
  const r = await start();
  const h = await fetch(r.http + '/healthz');
  assert.equal(h.status, 200);
  const j = await h.json();
  assert.equal(j.ok, true);
  assert.deepEqual([j.sockets, j.rooms, j.rdv_rooms], [0, 0, 0]);
  assert.equal(typeof j.counters.frames_in, 'number');
  assert.equal((await fetch(r.http + '/')).status, 404);
  const t = topic();
  assert.equal((await fetch(`${r.http}/v2/s/${t}`)).status, 426, 'route valide sans WebSocket');
  // Topic et rendez-vous réels
  const { topic: st, relayAuth } = await SRP.deriveSession(SRP.createPairing());
  const rdv = await SRP.rendezvousTopic(SRP.createRendezvous().code);
  const a = await connect(`${r.ws}/v2/s/${st}`, { protocols: [PROTOCOL, 'auth.' + relayAuth] });
  assert.equal(a.protocol, PROTOCOL, 'le relais ne renvoie jamais la preuve');
  const b = await connect(`${r.ws}/v2/rdv/${rdv}`);
  // Chemins refusés
  for (const bad of ['/v2/s/abc', `/v2/s/${t}x`, `/v2/s/${t.slice(0, 21)}B`, `/v2/s/${t}?auth=x`, `/v2/x/${t}`, `/v2/s/${t}/`, `/v1/s/${t}`, '/']) {
    assert.equal(await refused(r.ws + bad), 404, bad);
  }
  assert.deepEqual([(await (await fetch(r.http + '/healthz')).json()).rooms], [1]);
  await closeAll(a, b);
  await r.close();
});

test('rediffusion : aux AUTRES sockets de la même salle, trames réelles inchangées', async () => {
  const r = await start();
  const pairing = SRP.createPairing();
  const remote = await SRP.createSecureChannel({ pairing, role: 'remote' });
  const t = remote.topic;
  const [a1, a2, a3] = await Promise.all([1, 2, 3].map(() => connect(`${r.ws}/v2/s/${t}`)));
  const b1 = await connect(`${r.ws}/v2/s/${topic()}`);
  const frame = await remote.seal({ type: 'color', color: '#ff8800' });
  a1.send(frame);
  assert.equal(await next(a2), frame);
  assert.equal(await next(a3), frame);
  await silent(a1); await silent(b1);
  // Écran → télécommande : l'écran l'ouvre telle quelle
  const screen = await SRP.createSecureChannel({ pairing, role: 'screen', screenId: SRP.createScreenId() });
  a2.send(await screen.seal({ type: 'screen:alive' }));
  assert.deepEqual((await remote.receive(await next(a1))).message, { type: 'screen:alive' });
  await next(a3);
  // Fragment de média (trame la plus lourde) et message maximal
  const chunk = await remote.sealChunk(randomBytes(16 * 1024), { mediaId: 'm1', index: 0, total: 1 });
  a1.send(chunk);
  assert.equal(await next(a2), chunk);
  await next(a3);
  a1.send('');
  await silent(a2);
  // Rendez-vous : JSON compact des messages pair:*
  const id = await SRP.rendezvousTopic(SRP.createRendezvous().code);
  const [x, y] = await Promise.all([connect(`${r.ws}/v2/rdv/${id}`), connect(`${r.ws}/v2/rdv/${id}`)]);
  const kp = await SRP.ecdhKeyPair();
  for (const m of [
    { type: 'pair:commit', v: 1, commit: await SRP.commitPublicKey(kp.publicJwk) },
    { type: 'pair:key', v: 1, jwk: kp.publicJwk },
    { type: 'pair:session', v: 1, frame: await SRP.sealSessionForPeer(SRP.createPairing(), SRP.createPairing()) },
    { type: 'pair:abort', v: 1, reason: 'mismatch' },
  ]) {
    assert.ok(SRP.validateRendezvousMessage(m));
    x.send(JSON.stringify(m));
    assert.deepEqual(JSON.parse(await next(y)), m);
  }
  const st = r.relay.stats();
  assert.deepEqual([st.sockets, st.rooms, st.rdv_rooms], [6, 2, 1]);
  assert.deepEqual([st.counters.frames_in, st.counters.frames_out], [7, 10], 'trame vide ignorée');
  await closeAll(a1, a2, a3, b1, x, y);
  await sleep(50);
  assert.deepEqual([r.relay.stats().sockets, r.relay.stats().rooms, r.relay.stats().rdv_rooms], [0, 0, 0], 'salles vides libérées');
  await r.close();
});

test('validation : binaire refusé (1003), caractère hors alphabet refusé (1007)', async () => {
  const r = await start();
  const t = topic();
  const bin = await connect(`${r.ws}/v2/s/${t}`);
  const peer = await connect(`${r.ws}/v2/s/${t}`);
  bin.send(Buffer.from('QUJD'), { binary: true });
  assert.equal((await bin.closed).code, 1003);
  for (const bad of ['{"type":"color"}', 'abc def', 'abcé', 'abc=', 'abc\n', 'abc.def']) {
    const c = await connect(`${r.ws}/v2/s/${t}`);
    c.send(bad);
    assert.equal((await c.closed).code, 1007, JSON.stringify(bad));
  }
  await silent(peer);
  const id = topic();
  const ok = await connect(`${r.ws}/v2/rdv/${id}`);
  const rp = await connect(`${r.ws}/v2/rdv/${id}`);
  ok.send('{"type":"pair:abort","v":1}');
  assert.equal(await next(rp), '{"type":"pair:abort","v":1}');
  for (const bad of ['<script>', '{"a": 1}', "{'a':1}", '{"a":"é"}']) {
    const c = await connect(`${r.ws}/v2/rdv/${topic()}`);
    c.send(bad);
    assert.equal((await c.closed).code, 1007, bad);
  }
  const { counters } = r.relay.stats();
  assert.deepEqual([counters.closed_binary, counters.closed_charset], [1, 10]);
  await closeAll(peer, ok, rp);
  await r.close();
});

test('taille : 64 Kio max par trame de session (1009), 4 Kio en rendez-vous', async () => {
  const r = await start();
  const t = topic();
  const a = await connect(`${r.ws}/v2/s/${t}`);
  const b = await connect(`${r.ws}/v2/s/${t}`);
  a.send('A'.repeat(SRP.MAX_FRAME_CHARS));
  assert.equal((await next(b)).length, SRP.MAX_FRAME_CHARS, 'trame légitime maximale');
  a.send('A'.repeat(64 * 1024));
  assert.equal((await next(b)).length, 64 * 1024);
  a.send('A'.repeat(64 * 1024 + 1));
  assert.equal((await a.closed).code, 1009);
  await silent(b);
  const id = topic();
  const x = await connect(`${r.ws}/v2/rdv/${id}`);
  const y = await connect(`${r.ws}/v2/rdv/${id}`);
  x.send('A'.repeat(4096));
  assert.equal((await next(y)).length, 4096);
  x.send('A'.repeat(4097));
  assert.equal((await x.closed).code, 1009);
  assert.equal(r.relay.stats().counters.closed_size, 2);
  await closeAll(b, y);
  await r.close();
});

test('débit : seau à jetons par socket (trames et octets) — lecture ralentie, aucune perte', async () => {
  const r = await start({ rateFrames: 20 });
  const t = topic();
  const a = await connect(`${r.ws}/v2/s/${t}`);
  const b = await connect(`${r.ws}/v2/s/${t}`);
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) a.send('f' + i);
  const got = [];
  for (let i = 0; i < 60; i++) got.push(await next(b, 5000));
  const dt = Date.now() - t0;
  assert.deepEqual(got, Array.from({ length: 60 }, (_, i) => 'f' + i), 'toutes les trames, dans l\'ordre');
  assert.ok(dt >= 1500, `60 trames à 20/s (rafale 20) : ≥ 2 s attendues, ${dt} ms`);
  assert.ok(r.relay.stats().counters.throttled >= 1);
  await closeAll(a, b);
  await r.close();

  const r2 = await start({ rateBytes: 100_000 });
  const c = await connect(`${r2.ws}/v2/s/${t}`);
  const d = await connect(`${r2.ws}/v2/s/${t}`);
  const t1 = Date.now();
  for (let i = 0; i < 5; i++) c.send(String(i).repeat(50_000));
  for (let i = 0; i < 5; i++) assert.equal((await next(d, 5000))[0], String(i));
  const dt2 = Date.now() - t1;
  assert.ok(dt2 >= 1000, `250 ko à 100 ko/s (rafale 100 ko) : ≥ 1,5 s attendues, ${dt2} ms`);
  await closeAll(c, d);
  await r2.close();
});

test('limites : sockets par salle, rendez-vous, salles et sockets globaux, IP', async () => {
  const r = await start({ roomMaxSockets: 3, maxRooms: 2, ipMaxSockets: 100 });
  const t = topic();
  const room = await Promise.all([1, 2, 3].map(() => connect(`${r.ws}/v2/s/${t}`)));
  assert.equal(await refused(`${r.ws}/v2/s/${t}`), 503, 'salle pleine');
  const other = await connect(`${r.ws}/v2/s/${topic()}`);
  assert.equal(await refused(`${r.ws}/v2/s/${topic()}`), 503, 'trop de salles');
  await closeAll(other);
  await sleep(30);
  const again = await connect(`${r.ws}/v2/rdv/${topic()}`);
  assert.equal(r.relay.stats().rdv_rooms, 1, 'une salle libérée est réutilisable');
  await closeAll(...room, again);
  await r.close();

  const r2 = await start();
  const id = topic();
  const four = await Promise.all([1, 2, 3, 4].map(() => connect(`${r2.ws}/v2/rdv/${id}`)));
  assert.equal(await refused(`${r2.ws}/v2/rdv/${id}`), 503, 'rendez-vous : 4 sockets');
  await closeAll(...four);
  await r2.close();

  const r3 = await start({ maxSockets: 2 });
  const two = [await connect(`${r3.ws}/v2/s/${topic()}`), await connect(`${r3.ws}/v2/s/${topic()}`)];
  assert.equal(await refused(`${r3.ws}/v2/s/${topic()}`), 503, 'plafond global de sockets');
  await closeAll(...two);
  await r3.close();

  const r4 = await start({ ipMaxSockets: 2 });
  const mine = [await connect(`${r4.ws}/v2/s/${topic()}`), await connect(`${r4.ws}/v2/s/${topic()}`)];
  assert.equal(await refused(`${r4.ws}/v2/s/${topic()}`), 429, 'sockets par IP');
  await closeAll(...mine);
  await r4.close();

  const r5 = await start({ ipConnBurst: 3, ipConnPerMin: 60 });
  for (let i = 0; i < 3; i++) await closeAll(await connect(`${r5.ws}/v2/s/${topic()}`));
  assert.equal(await refused(`${r5.ws}/v2/s/${topic()}`), 429, 'nouvelles connexions par IP');
  await sleep(1100); // 1 connexion/s regagnée
  await closeAll(await connect(`${r5.ws}/v2/s/${topic()}`));
  assert.ok(r5.relay.stats().counters.refused_by_status[429] >= 1);
  await r5.close();

  const r6 = await start({ memLimitMb: 1 });
  assert.equal(await refused(`${r6.ws}/v2/s/${topic()}`), 503, 'plafond mémoire');
  assert.equal((await fetch(r6.http + '/healthz')).status, 503);
  await r6.close();
});

test('rendez-vous : durée de vie bornée (fermeture 4410), identifiant non réutilisable avant expiration', async () => {
  let clock = Date.now();
  const r = await start({ rdvTtlMs: 300, now: () => clock });
  const id = topic();
  const a = await connect(`${r.ws}/v2/rdv/${id}`);
  const b = await connect(`${r.ws}/v2/rdv/${id}`);
  await closeAll(b);
  clock += 100;
  const c = await connect(`${r.ws}/v2/rdv/${id}`); // la salle garde son échéance d'origine
  clock += 200;
  const [ca, cc] = await Promise.all([a.closed, c.closed]);
  assert.deepEqual([ca.code, cc.code], [4410, 4410]);
  assert.equal(await refused(`${r.ws}/v2/rdv/${id}`), 410, 'rendez-vous expiré');
  assert.equal(r.relay.stats().rdv_rooms, 0);
  await closeAll(await connect(`${r.ws}/v2/rdv/${topic()}`));
  clock += 400;
  r.relay.sweep();
  await closeAll(await connect(`${r.ws}/v2/rdv/${id}`)); // oublié après 2 × TTL
  assert.equal(r.relay.stats().counters.rdv_expired, 1);
  await r.close();
});

test('TOFU : la 1re preuve fait foi, refus sinon, oubli après 30 jours d\'inactivité', async () => {
  let clock = Date.now();
  const r = await start({ now: () => clock });
  const t = topic(), A = proof(), B = proof();
  const a1 = await connect(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, A] });
  const a2 = await connect(`${r.ws}/v2/s/${t}`, { protocols: [A, PROTOCOL] });
  assert.equal(await refused(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, B] }), 401, 'autre preuve');
  assert.equal(await refused(`${r.ws}/v2/s/${t}`), 401, 'sans preuve, salle protégée');
  assert.equal(await refused(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, A, B] }), 401, 'deux preuves');
  assert.equal(await refused(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, 'auth.court'] }), 401, 'preuve mal formée');
  await closeAll(a1, a2);
  await sleep(30);
  assert.equal(r.relay.stats().rooms, 0);
  assert.equal(await refused(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, B] }), 401, 'l\'empreinte survit à la salle vide');
  clock += 29 * 86_400_000; r.relay.sweep();
  assert.equal(await refused(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, B] }), 401, '29 jours : toujours protégée');
  closeAll(await connect(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, A] })); // activité : délai repoussé
  await sleep(30);
  clock += 29 * 86_400_000; r.relay.sweep();
  assert.equal(await refused(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, B] }), 401);
  clock += 2 * 86_400_000; r.relay.sweep();
  assert.equal(r.relay.stats().tofu_entries, 0, '30 jours sans activité : oubliée');
  const b = await connect(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, B] });
  assert.equal(await refused(`${r.ws}/v2/s/${t}`, { protocols: [PROTOCOL, A] }), 401, 'réarmée sur la nouvelle preuve');
  // Sockets sans preuve évincés quand la 1re preuve arrive ; rendez-vous jamais concernés
  const t2 = topic();
  const anon = await connect(`${r.ws}/v2/s/${t2}`);
  const auth = await connect(`${r.ws}/v2/s/${t2}`, { protocols: [PROTOCOL, proof()] });
  assert.equal((await anon.closed).code, 4401);
  await closeAll(b, auth);
  await r.close();
  const strict = await start({ requireAuth: true });
  assert.equal(await refused(`${strict.ws}/v2/s/${topic()}`), 401, 'preuve exigée');
  await closeAll(await connect(`${strict.ws}/v2/s/${topic()}`, { protocols: [PROTOCOL, proof()] }));
  await closeAll(await connect(`${strict.ws}/v2/rdv/${topic()}`));
  assert.ok(strict.relay.stats().counters.tofu_rejected >= 1);
  await strict.close();
});

test('TOFU : persistance facultative (JSON, topic haché) ; sans fichier, un redémarrage réarme', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'relay-tofu-'));
  const file = path.join(dir, 'tofu.json');
  try {
    const { topic: t, relayAuth } = await SRP.deriveSession(SRP.createPairing());
    const A = 'auth.' + relayAuth, B = proof();
    const r1 = await start({ authFile: file });
    const a = await connect(`${r1.ws}/v2/s/${t}`, { protocols: [PROTOCOL, A] });
    await r1.close();
    assert.equal((await a.closed).code, 1001, 'arrêt propre : « going away »');
    const raw = readFileSync(file, 'utf8');
    const j = JSON.parse(raw);
    assert.equal(j.v, 1);
    assert.equal(j.e.length, 1);
    assert.ok(!raw.includes(t) && !raw.includes(relayAuth), 'ni topic ni preuve en clair');
    assert.equal(j.e[0][2], Math.floor(Date.now() / 86_400_000), 'jour d\'activité seulement');
    const r2 = await start({ authFile: file });
    assert.equal(await refused(`${r2.ws}/v2/s/${t}`, { protocols: [PROTOCOL, B] }), 401, 'empreinte rechargée');
    await closeAll(await connect(`${r2.ws}/v2/s/${t}`, { protocols: [PROTOCOL, A] }));
    await r2.close();
    const r3 = await start();
    await closeAll(await connect(`${r3.ws}/v2/s/${t}`, { protocols: [PROTOCOL, B] }));
    await r3.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('X-Forwarded-For : pris en compte seulement depuis le proxy de confiance (IPv6 : par /64)', async () => {
  const xff = (v) => ({ headers: { 'x-forwarded-for': v } });
  const plain = await start({ ipMaxSockets: 1 });
  const p1 = await connect(`${plain.ws}/v2/s/${topic()}`, xff('203.0.113.1'));
  assert.equal(await refused(`${plain.ws}/v2/s/${topic()}`, xff('203.0.113.2')), 429, 'en-tête ignoré sans proxy de confiance');
  await closeAll(p1);
  await plain.close();
  const other = await start({ ipMaxSockets: 1, trustProxy: '10.0.0.1' });
  const o1 = await connect(`${other.ws}/v2/s/${topic()}`, xff('203.0.113.1'));
  assert.equal(await refused(`${other.ws}/v2/s/${topic()}`, xff('203.0.113.2')), 429, 'en-tête ignoré d\'un pair non déclaré');
  await closeAll(o1);
  await other.close();

  const r = await start({ ipMaxSockets: 1, trustProxy: '127.0.0.1, ::1' });
  const url = () => `${r.ws}/v2/s/${topic()}`;
  const keep = [await connect(url(), xff('203.0.113.1')), await connect(url(), xff('203.0.113.2'))];
  assert.equal(await refused(url(), xff('203.0.113.1')), 429, 'même client derrière le proxy');
  // Seule l'entrée ajoutée par le proxy (la plus à droite) compte : la partie gauche est falsifiable
  keep.push(await connect(url(), xff('203.0.113.1, 198.51.100.9')));
  assert.equal(await refused(url(), xff('198.51.100.9')), 429);
  keep.push(await connect(url(), xff('2001:db8:1:2::1')));
  assert.equal(await refused(url(), xff('2001:db8:1:2:aaaa::2')), 429, 'même /64');
  keep.push(await connect(url(), xff('2001:db8:1:3::1')));
  keep.push(await connect(url(), xff('pas-une-ip'))); // repli : l'adresse du proxy
  assert.equal(await refused(url()), 429, 'sans en-tête : l\'adresse du proxy');
  await closeAll(...keep);
  await r.close();
  const cidr = await start({ ipMaxSockets: 1, trustProxy: '127.0.0.0/8' });
  const c1 = await connect(`${cidr.ws}/v2/s/${topic()}`, xff('203.0.113.1'));
  await closeAll(c1, await connect(`${cidr.ws}/v2/s/${topic()}`, xff('203.0.113.2')));
  await cidr.close();
  assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('2001:0db8:0001:0002:0003:0004:0005:0006'), '2001:db8:1:2::/64');
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
});

test('keepalive : ping/pong et battement vide, socket muet coupé, salle vide libérée', async () => {
  const r = await start({ pingMs: 100 });
  const t = topic();
  const live = await connect(`${r.ws}/v2/s/${t}`);
  const mute = await connect(`${r.ws}/v2/s/${t}`, { autoPong: false });
  assert.equal((await mute.closed).code, 1006, 'socket muet coupé');
  await sleep(250);
  assert.equal(live.readyState, WebSocket.OPEN);
  assert.ok(live.beats >= 2, 'battements texte vides reçus');
  assert.ok(r.relay.stats().counters.ping_timeouts >= 1);
  await closeAll(live);
  await sleep(30);
  assert.equal(r.relay.stats().rooms, 0);
  await r.close();
});

test('arrêt propre, origines autorisées, configuration par variables d\'environnement', async () => {
  const r = await start({ origins: 'https://app.example' });
  assert.equal(await refused(`${r.ws}/v2/s/${topic()}`, { origin: 'https://evil.example' }), 403);
  const a = await connect(`${r.ws}/v2/s/${topic()}`, { origin: 'https://app.example' });
  await r.close();
  assert.equal((await a.closed).code, 1001);
  assert.equal(await refused(`${r.ws}/v2/s/${topic()}`), 0, 'plus d\'écoute après l\'arrêt');
  assert.deepEqual(configFromEnv({ PORT: '9000', HOST: '::', RELAY_REQUIRE_AUTH: '1', RELAY_TRUST_PROXY: '172.30.53.0/24',
    RELAY_AUTH_FILE: '/data/tofu.json', RELAY_IP_CONN_PER_MIN: '120', RELAY_MEM_LIMIT_MB: '256', OTHER: 'x', RELAY_MAX_ROOMS: '', RELAY_NOW: '1' }),
  { port: 9000, host: '::', requireAuth: true, trustProxy: '172.30.53.0/24', authFile: '/data/tofu.json', ipConnPerMin: 120, memLimitMb: 256 });
  assert.equal(configFromEnv({ RELAY_REQUIRE_AUTH: '0' }).requireAuth, false);
  assert.throws(() => configFromEnv({ RELAY_RATE_FRAMES: 'beaucoup' }), /RELAY_RATE_FRAMES/);
  assert.throws(() => createRelay({ trustProxy: 'proxy.local' }), /RELAY_TRUST_PROXY/);
});
