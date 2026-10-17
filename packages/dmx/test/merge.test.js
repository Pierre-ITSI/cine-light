// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SacnMerger, ArtNetMerger, isOutOfSequence } from '../merge.js';
import { parseSacn } from '../sacn.js';
import { parseArtNet } from '../artnet.js';
import { sacnData, sacnSync, sacnDiscovery, artDmx, fakeClock, CID, CID2 } from './helpers.js';

function sacnRig(opts) {
  const clock = fakeClock();
  const events = [], signals = [];
  const m = new SacnMerger({
    now: clock.now, ...opts,
    onUniverse: (u, d, info) => events.push({ u, d: Array.from(d.subarray(0, 4)), info }),
    onSignal: (u, lost, info) => signals.push({ u, lost, reason: info.reason }),
  });
  const push = (o) => m.push(parseSacn(sacnData(o)));
  return { clock, m, events, signals, push };
}

test('sACN : une source, émission seulement au changement', () => {
  const { m, events, signals, push } = sacnRig();
  assert.equal(push({ seq: 1, slots: [10, 20, 30] }), 'applied');
  assert.equal(push({ seq: 2, slots: [10, 20, 30] }), 'unchanged');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].d, [10, 20, 30, 0], 'slots manquants = 0');
  assert.equal(events[0].info.priority, 100);
  assert.deepEqual(signals, [{ u: 1, lost: false, reason: 'data' }]);
  assert.equal(m.getUniverse(1).data.length, 512);
});

test('sACN : la priorité la plus haute gagne ; repli sur la source restante après 2,5 s', () => {
  const { clock, m, events, push } = sacnRig();
  push({ cid: CID, priority: 100, seq: 1, slots: [50] });
  push({ cid: CID2, priority: 150, seq: 1, slots: [20] });
  assert.equal(m.getUniverse(1).data[0], 20, 'priorité 150 gagne même avec une valeur plus basse');
  clock.advance(2000);
  push({ cid: CID, priority: 100, seq: 2, slots: [50] }); // seule la source 100 continue
  clock.advance(500); m.tick();
  assert.equal(m.getUniverse(1).data[0], 20, '2,5 s pile : encore vivante');
  clock.advance(1); m.tick();
  assert.equal(m.getUniverse(1).data[0], 50, 'au-delà de 2,5 s : la source 150 est perdue');
  assert.equal(events.at(-1).info.reason, 'timeout');
});

test('sACN : priorité égale → fusion HTP canal par canal', () => {
  const { m, events, push } = sacnRig();
  push({ cid: CID, seq: 1, slots: [255, 0, 100] });
  push({ cid: CID2, seq: 1, slots: [0, 200, 50] });
  assert.deepEqual(Array.from(m.getUniverse(1).data.subarray(0, 3)), [255, 200, 100]);
  assert.equal(events.at(-1).info.htp, true);
});

test('sACN : numéros de séquence (§6.7.2), fenêtre de −20', () => {
  assert.equal(isOutOfSequence(9, 10), true);
  assert.equal(isOutOfSequence(10, 10), true, 'doublon');
  assert.equal(isOutOfSequence(11, 10), false);
  assert.equal(isOutOfSequence(0, 255), false, 'rebouclage');
  assert.equal(isOutOfSequence(250, 10), true, '250 − 10 = −16 en 8 bits signés');
  assert.equal(isOutOfSequence(246, 10), false, '−20 : accepté (redémarrage de la source)');
  const { push } = sacnRig();
  assert.equal(push({ seq: 10, slots: [1] }), 'applied');
  assert.equal(push({ seq: 9, slots: [2] }), 'out-of-sequence');
  assert.equal(push({ seq: 10, slots: [2] }), 'out-of-sequence');
  assert.equal(push({ seq: 11, slots: [2] }), 'applied');
});

test('sACN : une source redémarrée après expiration repart de zéro', () => {
  const { clock, push } = sacnRig();
  push({ seq: 100, slots: [1] });
  clock.advance(3000);
  assert.equal(push({ seq: 95, slots: [2] }), 'applied');
});

test('sACN : Stream_Terminated → perte immédiate, données ignorées', () => {
  const { m, signals, push } = sacnRig();
  push({ cid: CID, seq: 1, slots: [77] });
  assert.equal(push({ cid: CID, seq: 2, options: 0x40, slots: [0] }), 'terminated');
  assert.equal(m.isLost(1), true);
  assert.equal(m.getUniverse(1).data[0], 77, 'dernière sortie conservée, valeurs du paquet de fin ignorées');
  assert.deepEqual(signals.at(-1), { u: 1, lost: true, reason: 'terminated' });
  // les 2 autres paquets de fin (envoyés 3 fois) sont sans effet
  assert.equal(push({ cid: CID, seq: 3, options: 0x40, slots: [0] }), 'terminated');
  assert.equal(signals.length, 2);
});

test('sACN : Stream_Terminated d’une source parmi deux → l’autre continue', () => {
  const { m, push } = sacnRig();
  push({ cid: CID, priority: 120, seq: 1, slots: [10] });
  push({ cid: CID2, priority: 100, seq: 1, slots: [90] });
  push({ cid: CID, priority: 120, seq: 2, options: 0x40 });
  assert.equal(m.isLost(1), false);
  assert.equal(m.getUniverse(1).data[0], 90);
});

test('sACN : Preview_Data jamais utilisé en sortie', () => {
  const { m, events, push } = sacnRig();
  assert.equal(push({ seq: 1, options: 0x80, slots: [200] }), 'ignored-preview');
  assert.equal(events.length, 0);
  assert.equal(m.getUniverse(1), null);
});

test('sACN : perte du signal après 2,5 s, sortie conservée, retour du signal', () => {
  const { clock, m, signals, push } = sacnRig();
  push({ seq: 1, slots: [33] });
  clock.advance(2500); m.tick();
  assert.equal(m.isLost(1), false);
  clock.advance(1); m.tick();
  assert.equal(m.isLost(1), true);
  assert.equal(m.getUniverse(1).data[0], 33);
  push({ seq: 2, slots: [33] });
  assert.deepEqual(signals.map((s) => s.lost), [false, true, false]);
});

test('sACN : synchronisation d’univers', () => {
  const { clock, m, push } = sacnRig();
  // Jamais synchronisé : appliqué tout de suite
  assert.equal(push({ seq: 1, sync: 7, slots: [1] }), 'applied');
  assert.equal(m.push(parseSacn(sacnSync({ seq: 1, syncAddress: 7 }))), 'synced');
  // Désormais synchronisé : mis en attente jusqu'au paquet de sync
  assert.equal(push({ seq: 2, sync: 7, slots: [2] }), 'staged');
  assert.equal(m.getUniverse(1).data[0], 1);
  assert.equal(m.push(parseSacn(sacnSync({ seq: 1, syncAddress: 7 }))), 'out-of-sequence');
  assert.equal(m.push(parseSacn(sacnSync({ seq: 2, syncAddress: 7 }))), 'synced');
  assert.equal(m.getUniverse(1).data[0], 2);
  // Sync perdue (> 2,5 s) : Force_Synchronization = 0 → on garde le dernier état synchronisé
  clock.advance(2000); push({ seq: 3, sync: 7, slots: [2] });
  clock.advance(1000);
  assert.equal(push({ seq: 4, sync: 7, slots: [3] }), 'held');
  assert.equal(m.getUniverse(1).data[0], 2);
  // Force_Synchronization = 1 → mise à jour sans attendre
  assert.equal(push({ seq: 5, sync: 7, options: 0x20, slots: [4] }), 'applied');
  assert.equal(m.getUniverse(1).data[0], 4);
});

test('sACN : les paquets de sync et de découverte ne maintiennent pas une source en vie (E1.31-2025)', () => {
  const { clock, m, push } = sacnRig();
  push({ seq: 1, slots: [5] });
  for (let i = 0; i < 6; i++) {
    clock.advance(500);
    m.push(parseSacn(sacnSync({ seq: i + 1, syncAddress: 9 })));
    m.push(parseSacn(sacnDiscovery({ universes: [1] })));
    m.tick();
  }
  assert.equal(m.isLost(1), true);
  assert.deepEqual(m.discovered.get(CID).universes, [1]);
});

test('sACN : univers indépendants', () => {
  const { m, push } = sacnRig();
  push({ universe: 1, seq: 1, slots: [1] });
  push({ universe: 2, seq: 1, slots: [2] });
  assert.deepEqual(m.universes().sort(), [1, 2]);
  assert.equal(m.getUniverse(2).data[0], 2);
});

function artRig(opts) {
  const clock = fakeClock();
  const events = [], signals = [];
  const m = new ArtNetMerger({
    now: clock.now, ...opts,
    onUniverse: (u, d, info) => events.push({ u, d: Array.from(d.subarray(0, 4)), info }),
    onSignal: (u, lost) => signals.push({ u, lost }),
  });
  const push = (ip, o) => m.push(parseArtNet(artDmx(o)), ip);
  return { clock, m, events, signals, push };
}

test('Art-Net : HTP de deux sources par IP, troisième ignorée', () => {
  const { m, events, push } = artRig();
  assert.equal(push('10.0.0.1', { data: [100, 0, 50, 0] }), 'applied');
  assert.equal(push('10.0.0.2', { data: [0, 200, 60, 0] }), 'applied');
  assert.deepEqual(Array.from(m.getUniverse(0).data.subarray(0, 3)), [100, 200, 60]);
  assert.equal(events.at(-1).info.merging, true);
  assert.equal(push('10.0.0.3', { data: [255, 255, 255, 255] }), 'ignored-extra-source');
  assert.equal(m.getUniverse(0).data[0], 100);
});

test('Art-Net : source défaillante gardée 10 s dans la fusion, puis retirée', () => {
  const { clock, m, push } = artRig();
  push('10.0.0.1', { data: [200, 0] });
  push('10.0.0.2', { data: [10, 0] });
  for (let i = 0; i < 10; i++) { clock.advance(1000); push('10.0.0.2', { data: [10, 0] }); m.tick(); }
  assert.equal(m.getUniverse(0).data[0], 200, 'encore dans le tampon de fusion à 10 s');
  clock.advance(1); push('10.0.0.2', { data: [10, 0] }); m.tick();
  assert.equal(m.getUniverse(0).data[0], 10, 'retirée au-delà de 10 s');
  assert.equal(push('10.0.0.3', { data: [50, 0] }), 'applied', 'une place s’est libérée');
});

test('Art-Net : mode LTP canal par canal', () => {
  const { m, push } = artRig({ mergeMode: 'ltp' });
  push('10.0.0.1', { data: [100, 100] });
  push('10.0.0.2', { data: [50, 100] });
  assert.deepEqual(Array.from(m.getUniverse(0).data.subarray(0, 2)), [50, 100]);
  push('10.0.0.1', { data: [100, 20] }); // seul le canal 2 change chez la source 1
  assert.deepEqual(Array.from(m.getUniverse(0).data.subarray(0, 2)), [50, 20]);
});

test('Art-Net : perte du signal après 5 s sans ArtDmx, sortie conservée', () => {
  const { clock, m, signals, push } = artRig();
  push('10.0.0.1', { net: 1, subUni: 0x23, data: [9, 9] });
  clock.advance(5000); m.tick();
  assert.equal(m.isLost(0x123), false);
  clock.advance(1); m.tick();
  assert.equal(m.isLost(0x123), true);
  assert.equal(m.getUniverse(0x123).data[0], 9);
  push('10.0.0.1', { net: 1, subUni: 0x23, data: [9, 9] });
  assert.deepEqual(signals.map((s) => s.lost), [false, true, false]);
});

test('Art-Net : séquence (0 = désactivée, paquets en retard ignorés)', () => {
  const { push } = artRig();
  assert.equal(push('a', { seq: 10, data: [1, 0] }), 'applied');
  assert.equal(push('a', { seq: 9, data: [2, 0] }), 'out-of-sequence');
  assert.equal(push('a', { seq: 11, data: [3, 0] }), 'applied');
  assert.equal(push('a', { seq: 0, data: [4, 0] }), 'applied');
  assert.equal(push('b', { seq: 255, data: [0, 5] }), 'applied');
  assert.equal(push('b', { seq: 1, data: [0, 6] }), 'applied', 'rebouclage 255 → 1');
});
