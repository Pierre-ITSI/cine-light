// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayEngine } from '../engine.js';
import { Patch } from '../patch.js';
import { parseArtNet, ARTNET_PORT } from '../artnet.js';
import { isNewerSeq, expandLook } from '../messages.js';
import { explainInvalid } from '../../protocol/schema.js';
import { sacnData, artDmx, artPoll, fakeClock } from './helpers.js';

const A = 'screenAAAA01', B = 'screenBBBB02', C = 'screenCCCC03', D = 'screenDDDD04';
const S8 = (address = 1, universe = 1) => ({ protocol: 'sacn', universe, address, personality: 'standard8' });

function rig(patch, opts = {}) {
  const clock = fakeClock();
  const sent = [], udp = [], triggers = [];
  const engine = new GatewayEngine({
    now: clock.now, patch,
    send: (m) => {
      const why = explainInvalid(JSON.parse(JSON.stringify(m)), { direction: 'r2s' });
      assert.equal(why, null, 'message conforme au schéma du protocole : ' + JSON.stringify(m));
      sent.push(m);
    },
    sendUdp: (bytes, address, port) => udp.push({ bytes, address, port }),
    onTrigger: (t) => triggers.push(t),
    ...opts,
  });
  let seq = 0;
  const sacn = (slots, o = {}) => engine.handlePacket(sacnData({ seq: (seq = (seq + 1) & 0xff), slots, ...o }), { address: '10.0.0.1', port: 5568 });
  const looks = (id) => sent.filter((m) => m.type === 'dmx:look' && (!id || m.target.screens.includes(id)));
  const run = (ms, step = 10) => { for (let t = 0; t < ms; t += step) { clock.advance(step); engine.tick(); } };
  return { clock, engine, sent, udp, triggers, sacn, looks, run };
}

test('moteur : paquet sACN → dmx:look ciblé, live, conforme au schéma', () => {
  const { sent, sacn } = rig({ [A]: S8() });
  const r = sacn([255, 255, 0, 0, 0, 128, 0, 0]);
  assert.deepEqual(r, { protocol: 'sacn', ok: true, kind: 'data', reason: undefined, outcome: 'applied' });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: 'dmx:look', target: { screens: [A] }, seq: 1, live: true, look: { color: '#ff0000' } });
  assert.deepEqual(expandLook(sent[0].look), { color: '#ff0000', strobe: { active: false, freq: 0, dur: 0 }, effect: null, media: null, blackout: false });
});

test('moteur : émission seulement au changement', () => {
  const { clock, sent, sacn } = rig({ [A]: S8() });
  sacn([255, 10, 20, 30]);
  for (let i = 0; i < 20; i++) { clock.advance(23); sacn([255, 10, 20, 30]); }
  assert.equal(sent.length, 1);
  clock.advance(23); sacn([255, 10, 20, 31]);
  assert.equal(sent.length, 2);
});

test('moteur : au plus 30 messages/s par écran, la dernière valeur finit toujours par partir', () => {
  const { clock, engine, looks, sacn } = rig({ [A]: S8() });
  for (let i = 0; i < 200; i++) { clock.advance(5); sacn([i % 256, 255, 255, 255]); engine.tick(); }
  const n = looks(A).length;
  assert.ok(n <= 30 && n >= 25, n + ' messages en 1 s');
  clock.advance(40); engine.tick();
  const last = looks(A).at(-1);
  assert.equal(last.look.color, '#c7c7c7', 'dernier dimmer (199) envoyé après l’intervalle');
});

test('moteur : débit configurable (10/s)', () => {
  const { clock, engine, looks, sacn } = rig({ [A]: S8() }, { maxRate: 10 });
  for (let i = 0; i < 100; i++) { clock.advance(10); sacn([i, 255, 255, 255]); engine.tick(); }
  assert.ok(looks(A).length <= 10);
});

test('moteur : maintien (keep-alive) toutes les secondes tant que le signal est là', () => {
  const { clock, engine, looks, sacn } = rig({ [A]: S8() });
  sacn([255, 1, 2, 3]);
  for (let t = 0; t < 3600; t += 100) {
    clock.advance(100);
    if (t % 500 === 0) sacn([255, 1, 2, 3]);
    engine.tick();
  }
  const l = looks(A);
  assert.equal(l.length, 4, 'envoi initial + 3 maintiens');
  assert.ok(l.every((m) => m.live && m.look.color === l[0].look.color));
  for (let i = 1; i < l.length; i++) assert.ok(isNewerSeq(l[i].seq, l[i - 1].seq));
});

test('moteur : looks identiques regroupés dans un seul message (miroir et valeurs égales)', () => {
  const { sent, sacn } = rig({ [A]: S8(1), [B]: S8(1), [C]: S8(9), [D]: S8(17) });
  const v = [255, 0, 255, 0, 0, 128, 0, 0];
  sacn([...v, ...v, 255, 255, 255, 255]);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].target.screens, [A, B, C]);
  assert.equal(sent[0].look.color, '#00ff00');
  assert.deepEqual(sent[1].target.screens, [D]);
});

test('moteur : au-delà de 64 écrans, la cible est découpée (limite du schéma)', () => {
  const patch = {};
  for (let i = 0; i < 70; i++) patch['screen' + String(i).padStart(6, '0')] = S8();
  const { sent, sacn } = rig(patch);
  sacn([255, 255, 255, 255]);
  assert.deepEqual(sent.map((m) => m.target.screens.length), [64, 6]);
});

test('perte du signal sACN : look conservé envoyé une fois avec live:false, puis silence ; retour immédiat', () => {
  const { clock, engine, looks, sacn, run } = rig({ [A]: S8() });
  sacn([200, 255, 0, 0]);
  run(2400);
  const before = looks(A).length;
  assert.ok(looks(A).every((m) => m.live));
  run(200);
  const lost = looks(A).slice(before);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].live, false);
  assert.equal(lost[0].look.color, '#c80000', 'l’écran garde le dernier look');
  run(5000);
  assert.equal(looks(A).length, before + 1, 'plus rien tant que le signal est absent : la télécommande peut reprendre la main');
  clock.advance(1);
  sacn([200, 255, 0, 0]);
  const back = looks(A).at(-1);
  assert.equal(looks(A).length, before + 2, 'la console reprend la priorité tout de suite');
  assert.deepEqual([back.live, back.look.color], [true, '#c80000']);
  assert.equal(engine.snapshot().screens[0].live, true);
});

test('perte du signal Art-Net après 5 s', () => {
  const { clock, engine, looks, run } = rig({ [D]: { protocol: 'artnet', universe: 0x0101, address: 1, personality: 'color5' } });
  engine.handlePacket(artDmx({ net: 1, subUni: 0x01, data: [255, 0, 0, 255, 0, 0] }), { address: '10.0.0.9' });
  assert.equal(looks(D)[0].look.color, '#0000ff');
  run(4900);
  assert.ok(looks(D).every((m) => m.live));
  run(200);
  assert.equal(looks(D).at(-1).live, false);
  clock.advance(1);
  assert.equal(engine.snapshot().universes[0].lost, true);
});

test('Stream_Terminated : rend la main immédiatement', () => {
  const { clock, looks, sacn } = rig({ [A]: S8() });
  sacn([255, 0, 255, 0]);
  clock.advance(50);
  sacn([0], { options: 0x40 });
  assert.deepEqual(looks(A).map((m) => [m.live, m.look.color]), [[true, '#00ff00'], [false, '#00ff00']]);
});

test('déclenchements Appel / SMS : call:start depuis les listes enregistrées, call:end, fronts', () => {
  const callEntries = [{ name: 'Maman', label: 'mobile', ring: 'classic', style: 'glass' }, { name: 'Bureau' }];
  const smsEntries = [{ name: 'Paul', msg: 'Tu es où ?', appName: 'SMS' }];
  const { clock, sent, triggers, sacn } = rig({ [A]: { protocol: 'sacn', universe: 1, address: 1, personality: 'extended16' } }, { callEntries, smsEntries });
  const frame = (call, sms) => { clock.advance(40); sacn([255, 255, 0, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0, call, sms]); };
  const calls = () => sent.filter((m) => m.type !== 'dmx:look');
  frame(10, 0);
  assert.equal(calls().length, 0, 'première trame : armement seulement');
  frame(0, 0);
  frame(10, 0);
  assert.deepEqual(calls().at(-1), { type: 'call:start', kind: 'call', name: 'Maman', label: 'mobile', ring: 'classic', style: 'glass', target: { screens: [A] } });
  frame(10, 0);
  assert.equal(calls().length, 2, 'call:end puis call:start ; rien tant que la valeur reste');
  assert.deepEqual(calls()[0], { type: 'call:end', target: { screens: [A] } });
  frame(10, 10);
  assert.deepEqual(calls().at(-1), { type: 'call:start', kind: 'sms', name: 'Paul', msg: 'Tu es où ?', appName: 'SMS', target: { screens: [A] } });
  frame(20, 10);
  assert.equal(calls().at(-1).name, 'Bureau');
  frame(20, 0);
  assert.equal(calls().length, 4, 'SMS 0 ne raccroche pas un appel en cours');
  assert.deepEqual(triggers.at(-1), { kind: 'sms', index: 0, screens: [], sent: false });
  frame(0, 0);
  assert.equal(calls().at(-1).type, 'call:end');
  frame(50, 0);
  assert.deepEqual(triggers.at(-1), { kind: 'call', index: 5, screens: [A], sent: false }, 'entrée 5 absente : aucun message');
  assert.equal(calls().length, 5);
});

test('ArtPoll : ArtPollReply en unicast vers la console, mode ciblé respecté', () => {
  const patch = {
    [A]: { protocol: 'artnet', universe: 0x001, address: 1, personality: 'simple3' },
    [B]: { protocol: 'artnet', universe: 0x010, address: 1, personality: 'simple3' },
  };
  const { engine, udp } = rig(patch, { artPollReply: { ip: '10.0.0.50', shortName: 'SetRemote GW' } });
  assert.equal(engine.handlePacket(artPoll(), { address: '10.0.0.1', port: 6454 }).outcome, 'poll-replied');
  assert.equal(udp.length, 2, 'Sub-Nets différents : deux réponses (BindIndex 1 et 2)');
  for (const u of udp) {
    assert.deepEqual([u.address, u.port, u.bytes.length], ['10.0.0.1', ARTNET_PORT, 239]);
  }
  assert.deepEqual(udp.map((u) => parseArtNet(u.bytes).ports[0].portAddress), [0x001, 0x010]);
  assert.equal(engine.handlePacket(artPoll({ flags: 0x20, top: 0x200, bottom: 0x100 }), { address: '10.0.0.1' }).outcome, 'poll-not-targeted');
  const plain = rig(patch);
  plain.engine.artPollReply = null;
  assert.equal(plain.engine.handlePacket(artPoll(), { address: '10.0.0.1' }).outcome, 'poll-ignored');
});

test('setPatch : écran retiré → live:false ; écran ajouté → look immédiat', () => {
  const { engine, looks, sacn } = rig({ [A]: S8() });
  sacn([255, 255, 255, 0]);
  engine.setPatch(new Patch({ [B]: S8() }));
  assert.equal(looks(A).at(-1).live, false);
  assert.deepEqual([looks(B).length, looks(B)[0].live, looks(B)[0].look.color], [1, true, '#ffff00']);
});

test('écran hors plage (adresse + empreinte > 512) jamais piloté ; espaces sACN et Art-Net distincts', () => {
  const { sent, sacn } = rig({
    [A]: { protocol: 'sacn', universe: 1, address: 500, personality: 'extended16' },
    [B]: { protocol: 'artnet', universe: 1, address: 1, personality: 'simple3' },
  });
  sacn(new Array(512).fill(255));
  assert.equal(sent.length, 0);
});

test('paquets invalides : refusés, comptés, sans exception', () => {
  const { engine, sent } = rig({ [A]: S8() });
  assert.deepEqual(engine.handlePacket(new Uint8Array(3)), { protocol: null, ok: false, reason: 'unknown-protocol' });
  assert.equal(engine.handlePacket(/** @type {any} */ ({})).reason, 'type');
  const trunc = sacnData({ slots: [1, 2, 3] }).subarray(0, 100);
  assert.equal(engine.handlePacket(trunc).ok, false);
  assert.equal(engine.handlePacket(artDmx({ data: [1, 2, 3] })).reason, 'length');
  const c = engine.snapshot().counters;
  assert.equal(c.rejected['unknown-protocol'], 1);
  assert.equal(c.rejected.length, 1);
  assert.equal(sent.length, 0);
});

test('stop() : rend la main sur tous les écrans pilotés', () => {
  const { engine, looks, sacn, run } = rig({ [A]: S8(), [B]: S8(9) });
  sacn([255, 255, 255, 255, 0, 128, 0, 0, 255, 0, 0, 0, 0, 128, 0, 0]);
  engine.stop();
  assert.deepEqual([looks(A).at(-1).live, looks(B).at(-1).live], [false, false]);
  const n = looks().length;
  run(3000);
  assert.equal(looks().length, n);
});

test('seq : compteur 16 bits partagé, rebouclage 65535 → 0', () => {
  const { engine, sent, sacn, clock } = rig({ [A]: S8() });
  engine._seq = 65534;
  sacn([255, 1]);
  clock.advance(50);
  sacn([255, 2]);
  assert.deepEqual(sent.map((m) => m.seq), [65535, 0]);
  assert.equal(isNewerSeq(0, 65535), true);
  assert.equal(isNewerSeq(65535, 0), false);
});

test('start()/stopTimer() avec minuteries injectées', () => {
  const calls = [];
  const { engine } = rig({ [A]: S8() });
  engine.start({ intervalMs: 20, setInterval: (fn, ms) => { calls.push(['set', ms]); return 7; }, clearInterval: (id) => calls.push(['clear', id]) });
  engine.stopTimer();
  assert.deepEqual(calls, [['set', 20], ['clear', 7]]);
  assert.throws(() => new GatewayEngine(/** @type {any} */ ({})), TypeError);
});

test('stopTimer() appelle clearInterval comme une fonction (navigateur : sinon « Illegal invocation »)', () => {
  const { engine } = rig({ [A]: S8() });
  // Comme le clearInterval d'un navigateur : refuse tout « this » autre que le global
  const strictClear = function (id) { 'use strict'; if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); strictClear.id = id; };
  engine.start({ setInterval: () => 9, clearInterval: strictClear });
  engine.stop();
  assert.equal(strictClear.id, 9);
  engine.stopTimer(); // déjà arrêté : sans effet
});
