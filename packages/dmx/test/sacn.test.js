// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSacn, looksLikeSacn, sacnMulticastAddress, buildSacnDataPacket, buildSacnSyncPacket,
  SACN_PORT, E131_NETWORK_DATA_LOSS_TIMEOUT_MS,
} from '../sacn.js';
import { sacnData, sacnSync, sacnDiscovery, CID } from './helpers.js';

const full = Array.from({ length: 512 }, (_, i) => (i * 7) & 0xff);

test('sACN : paquet de données complet (512 slots), tous les champs', () => {
  const b = sacnData({ name: 'Console Éclairage', priority: 150, sync: 7, seq: 42, options: 0x80 | 0x20, universe: 63999, slots: full });
  assert.equal(b.length, 638);
  const p = parseSacn(b);
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.kind, 'data');
  assert.equal(p.cid, CID);
  assert.equal(p.sourceName, 'Console Éclairage');
  assert.equal(p.priority, 150);
  assert.equal(p.syncAddress, 7);
  assert.equal(p.sequence, 42);
  assert.deepEqual(p.options, { preview: true, streamTerminated: false, forceSync: true });
  assert.equal(p.universe, 63999);
  assert.equal(p.startCode, 0);
  assert.equal(p.data.length, 512);
  assert.deepEqual(Array.from(p.data), full);
  // copie : modifier le datagramme ne modifie pas le résultat
  b[126] = 99;
  assert.equal(p.data[0], full[0]);
  assert.equal(parseSacn(sacnData({ options: 0x40 })).options.streamTerminated, true);
});

test('sACN : accepte ArrayBuffer, vues et tableaux ; paquets courts (0 à 512 slots)', () => {
  const b = sacnData({ slots: [1, 2, 3] });
  assert.equal(parseSacn(b.buffer).ok, true);
  assert.equal(parseSacn(new DataView(b.buffer)).ok, true);
  assert.equal(parseSacn(Array.from(b)).ok, true);
  assert.deepEqual(Array.from(parseSacn(b).data), [1, 2, 3]);
  const empty = parseSacn(sacnData({ slots: [] }));
  assert.equal(empty.ok, true);
  assert.equal(empty.data.length, 0);
});

test('sACN : le constructeur de la bibliothèque produit les mêmes octets que la table 4-1', () => {
  const hand = sacnData({ name: 'MA3', priority: 120, seq: 9, universe: 258, sync: 3, options: 0x40, slots: full.slice(0, 24) });
  const lib = buildSacnDataPacket({ cid: CID, sourceName: 'MA3', priority: 120, sequence: 9, universe: 258, syncAddress: 3, options: { streamTerminated: true }, data: full.slice(0, 24) });
  assert.deepEqual(Array.from(lib), Array.from(hand));
  assert.deepEqual(Array.from(buildSacnSyncPacket({ cid: CID, sequence: 5, syncAddress: 300 })), Array.from(sacnSync({ seq: 5, syncAddress: 300 })));
});

test('sACN : rejets sûrs (en-têtes, vecteurs, longueurs, plages)', () => {
  const ok = () => sacnData({ slots: [1, 2, 3, 4] });
  const cases = [
    ['type', 'pas des octets'],
    ['too-short', new Uint8Array(48)],
    ['too-long', new Uint8Array(1145)],
    ['preamble', (() => { const b = ok(); b[1] = 0x11; return b; })()],
    ['postamble', (() => { const b = ok(); b[3] = 1; return b; })()],
    ['acn-id', (() => { const b = ok(); b[8] = 0x46; return b; })()],
    ['root-flags', (() => { const b = ok(); b[16] = (b[16] & 0x0f) | 0x60; return b; })()],
    ['root-length', (() => { const b = ok(); b[17] += 1; return b; })()],
    ['root-vector', (() => { const b = ok(); b[21] = 0x05; return b; })()],
    ['framing-vector', (() => { const b = ok(); b[43] = 0x03; return b; })()],
    ['framing-length', (() => { const b = ok(); b[39] -= 1; return b; })()],
    ['priority', sacnData({ priority: 201, slots: [1] })],
    ['universe', sacnData({ universe: 0, slots: [1] })],
    ['universe', sacnData({ universe: 64000, slots: [1] })],
    ['sync-address', sacnData({ sync: 64000, slots: [1] })],
    ['dmp-vector', (() => { const b = ok(); b[117] = 0x01; return b; })()],
    ['dmp-address-type', (() => { const b = ok(); b[118] = 0xa2; return b; })()],
    ['dmp-first-address', (() => { const b = ok(); b[120] = 1; return b; })()],
    ['dmp-increment', (() => { const b = ok(); b[122] = 2; return b; })()],
    ['dmp-count', (() => { const b = ok(); b[124] = 0; b[123] = 0; return b; })()],
    ['dmp-count', (() => { const b = ok(); b[124] += 1; return b; })()],
    ['start-code', sacnData({ startCode: 0xdd, slots: [1, 2] })],
  ];
  for (const [reason, input] of cases) {
    const r = parseSacn(input);
    assert.equal(r.ok, false, reason);
    assert.equal(r.reason, reason);
  }
  assert.equal(parseSacn(sacnData({ startCode: 0xdd, universe: 9, slots: [1] })).startCode, 0xdd);
});

test('sACN : 513 valeurs maximum (1 START code + 512 slots)', () => {
  assert.equal(parseSacn(sacnData({ slots: full })).ok, true);
  // 513 slots, longueurs de PDU cohérentes : refusé
  assert.equal(parseSacn(sacnData({ slots: full.concat([1]) })).reason, 'too-long');
  // Datagramme plus long que ses PDU : refusé
  const longer = new Uint8Array(639);
  longer.set(sacnData({ slots: full }));
  assert.equal(parseSacn(longer).ok, false);
});

test('sACN : toute troncature et du bruit aléatoire sont rejetés sans exception', () => {
  const b = sacnData({ slots: full.slice(0, 64) });
  for (let n = 0; n < b.length; n++) {
    const r = parseSacn(b.subarray(0, n));
    assert.equal(r.ok, false, 'préfixe de ' + n + ' octets');
  }
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  for (let i = 0; i < 2000; i++) {
    const junk = Uint8Array.from({ length: 1 + (i % 700) }, rnd);
    if (i % 3 === 0) junk.set(b.subarray(0, Math.min(40, junk.length))); // en-tête plausible
    assert.doesNotThrow(() => parseSacn(junk));
  }
});

test('sACN : paquet de synchronisation (49 octets)', () => {
  const p = parseSacn(sacnSync({ seq: 200, syncAddress: 7 }));
  assert.deepEqual(p, { ok: true, kind: 'sync', cid: CID, sequence: 200, syncAddress: 7 });
  assert.equal(parseSacn(sacnSync({ syncAddress: 0 })).reason, 'sync-address');
  const longer = new Uint8Array(50); longer.set(sacnSync()); longer[17] += 1; longer[39] += 1;
  assert.equal(parseSacn(longer).reason, 'too-long');
});

test('sACN : découverte des univers (universe 64214)', () => {
  const p = parseSacn(sacnDiscovery({ name: 'Eos', page: 0, lastPage: 1, universes: [1, 2, 300] }));
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.kind, 'discovery');
  assert.equal(p.sourceName, 'Eos');
  assert.deepEqual([p.page, p.lastPage, p.universes], [0, 1, [1, 2, 300]]);
  const bad = sacnDiscovery({ universes: [1] });
  bad[117] = 0x02;
  assert.equal(parseSacn(bad).reason, 'discovery-vector');
});

test('sACN : adresse multicast 239.255.hi.lo, port 5568, perte 2,5 s', () => {
  assert.equal(SACN_PORT, 5568);
  assert.equal(E131_NETWORK_DATA_LOSS_TIMEOUT_MS, 2500);
  assert.equal(sacnMulticastAddress(1), '239.255.0.1');
  assert.equal(sacnMulticastAddress(256), '239.255.1.0');
  assert.equal(sacnMulticastAddress(63999), '239.255.249.255');
  assert.equal(sacnMulticastAddress(64214), '239.255.250.214');
  for (const bad of [0, 64000, 1.5, '1', -1]) assert.throws(() => sacnMulticastAddress(/** @type {any} */ (bad)), RangeError);
});

test('sACN : détection rapide du protocole', () => {
  assert.equal(looksLikeSacn(sacnData()), true);
  assert.equal(looksLikeSacn(new Uint8Array(20)), false);
  assert.equal(looksLikeSacn(null), false);
});
