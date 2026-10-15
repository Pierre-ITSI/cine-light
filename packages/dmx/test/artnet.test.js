import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArtNet, looksLikeArtNet, buildArtPollReplies, buildArtPollReply, buildArtDmx, buildArtPoll,
  shouldReplyToPoll, splitPortAddress, makePortAddress, formatNodeReport,
  ARTNET_PORT, ARTPOLLREPLY_LEN,
} from '../artnet.js';
import { artDmx, artPoll } from './helpers.js';

const data512 = Array.from({ length: 512 }, (_, i) => (i * 3) & 0xff);

test('Art-Net : ArtDmx complet, Port-Address 15 bits = Net(7) · Sub-Net(4) · Univers(4)', () => {
  const p = parseArtNet(artDmx({ seq: 17, physical: 2, net: 0x12, subUni: 0x34, data: data512 }));
  assert.equal(p.ok, true, p.reason);
  assert.equal(p.kind, 'dmx');
  assert.equal(p.protVer, 14);
  assert.equal(p.sequence, 17);
  assert.equal(p.physical, 2);
  assert.deepEqual([p.net, p.subNet, p.universe], [0x12, 0x3, 0x4]);
  assert.equal(p.portAddress, 0x1234);
  assert.deepEqual(Array.from(p.data), data512);
  assert.equal(ARTNET_PORT, 6454);
  assert.deepEqual(splitPortAddress(0x7fff), { net: 127, subNet: 15, universe: 15 });
  assert.equal(makePortAddress(1, 2, 3), 0x0123);
});

test('Art-Net : le constructeur ArtDmx produit les mêmes octets que la spécification', () => {
  assert.deepEqual(Array.from(buildArtDmx({ portAddress: 0x0a05, sequence: 3, physical: 1, data: [9, 8, 7, 6] })),
    Array.from(artDmx({ seq: 3, physical: 1, net: 0x0a, subUni: 0x05, data: [9, 8, 7, 6] })));
  assert.deepEqual(Array.from(buildArtPoll({ flags: 0x20, targetTop: 10, targetBottom: 2 })),
    Array.from(artPoll({ flags: 0x20, top: 10, bottom: 2 })));
});

test('Art-Net : règles de Length (pair, 2–512) et tailles', () => {
  assert.equal(parseArtNet(artDmx({ data: [1, 2] })).ok, true);
  assert.equal(parseArtNet(artDmx({ data: [1, 2, 3] })).reason, 'length', 'impair refusé (strict)');
  assert.equal(parseArtNet(artDmx({ data: [1, 2, 3] }), { strictLength: false }).ok, true, 'impair accepté (souple)');
  assert.equal(parseArtNet(artDmx({ data: [] , length: 0 })).reason, 'too-short');
  assert.equal(parseArtNet(artDmx({ data: [0, 0], length: 0 })).reason, 'length');
  assert.equal(parseArtNet(artDmx({ data: [0, 0], length: 514 })).reason, 'length');
  assert.equal(parseArtNet(artDmx({ data: [1, 2], length: 4 })).reason, 'truncated');
  const tooBig = artDmx({ data: data512.concat([0, 0]), length: 512 });
  assert.equal(parseArtNet(tooBig).reason, 'too-long');
  assert.equal(parseArtNet(new Uint8Array(1025)).reason, 'too-long');
  // Données plus longues que Length : seules Length valeurs sont prises
  const p = parseArtNet(artDmx({ data: [1, 2, 3, 4], length: 2 }));
  assert.deepEqual(Array.from(p.data), [1, 2]);
});

test('Art-Net : rejets (ID, version, Net, OpCode inconnu), sans exception', () => {
  const bad = artDmx({ data: [1, 2] }); bad[3] = 0x2e;
  assert.equal(parseArtNet(bad).reason, 'id');
  assert.equal(parseArtNet(artDmx({ data: [1, 2], protVer: 13 })).reason, 'protocol-version');
  assert.equal(parseArtNet(artDmx({ data: [1, 2], net: 0x80 })).reason, 'port-address');
  const op = artDmx({ data: [1, 2] }); op[9] = 0x97;
  assert.deepEqual([parseArtNet(op).reason, parseArtNet(op).opCode], ['unsupported-opcode', 0x9700]);
  assert.equal(parseArtNet('x').reason, 'type');
  const b = artDmx({ data: data512.slice(0, 32) });
  for (let n = 0; n < b.length; n++) assert.equal(parseArtNet(b.subarray(0, n)).ok, false, 'préfixe ' + n);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  for (let i = 0; i < 2000; i++) {
    const junk = Uint8Array.from({ length: 1 + (i % 600) }, rnd);
    if (i % 2) junk.set(b.subarray(0, Math.min(12, junk.length)));
    assert.doesNotThrow(() => parseArtNet(junk));
  }
});

test('Art-Net : ArtPoll 14 octets (ancien) et 22 octets (Art-Net 4, mode ciblé)', () => {
  const old = parseArtNet(artPoll({ flags: 0x02, diagPriority: 0x10 }));
  assert.equal(old.ok, true);
  assert.equal(old.kind, 'poll');
  assert.equal(old.replyOnChange, true);
  assert.equal(old.targeted, false);
  assert.equal(old.targetTop, null);
  const t = parseArtNet(artPoll({ flags: 0x20, top: 0x0105, bottom: 0x0100 }));
  assert.deepEqual([t.targeted, t.targetTop, t.targetBottom], [true, 0x0105, 0x0100]);
  assert.equal(shouldReplyToPoll(t, [0x0101]), true);
  assert.equal(shouldReplyToPoll(t, [0x0001, 0x0200]), false);
  assert.equal(shouldReplyToPoll(old, [0x7fff]), true);
  assert.equal(parseArtNet(artPoll({ protVer: 12 })).reason, 'protocol-version');
});

test('Art-Net : ArtPollReply de 239 octets conforme (offsets de la spécification)', () => {
  const r = buildArtPollReply({
    ip: '10.0.0.42', mac: 'aa:bb:cc:dd:ee:01', shortName: 'Écran plateau', longName: 'SetRemote — passerelle DMX',
    portAddresses: [0x0123, 0x0121], activePortAddresses: [0x0121], mergingPortAddresses: [0x0123],
    firmwareVersion: 0x0102, estaMan: 0x7ff0, oem: 0x00ff, replyCounter: 1, dhcp: true, refreshRate: 44,
  });
  assert.equal(r.length, ARTPOLLREPLY_LEN);
  assert.equal(r.length, 239);
  assert.deepEqual(Array.from(r.subarray(0, 8)), [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00]);
  assert.deepEqual([r[8], r[9]], [0x00, 0x21], 'OpCode 0x2100 poids faible en premier');
  assert.deepEqual(Array.from(r.subarray(10, 14)), [10, 0, 0, 42]);
  assert.deepEqual([r[14], r[15]], [0x36, 0x19], 'Port 0x1936 poids faible en premier');
  assert.deepEqual([r[16], r[17]], [0x01, 0x02], 'VersInfoH/L');
  assert.deepEqual([r[18], r[19]], [0x01, 0x02], 'NetSwitch / SubSwitch');
  assert.deepEqual([r[20], r[21]], [0x00, 0xff], 'OemHi/Lo');
  assert.equal(r[23], 0xd0, 'Status1 : indicateurs normaux, adresse fixée localement');
  assert.deepEqual([r[24], r[25]], [0xf0, 0x7f], 'EstaManLo puis EstaManHi');
  assert.equal(String.fromCharCode(...r.subarray(26, 39)), 'Ecran plateau');
  assert.equal(r[39], 0);
  assert.equal(String.fromCharCode(...r.subarray(44, 68)), 'SetRemote ? passerelle D');
  assert.equal(String.fromCharCode(...r.subarray(108, 124)), '#0001 [0001] OK\0');
  assert.deepEqual([r[172], r[173]], [0, 2], 'NumPorts');
  assert.deepEqual(Array.from(r.subarray(174, 178)), [0x80, 0x80, 0, 0], 'PortTypes : sortie DMX512');
  assert.deepEqual(Array.from(r.subarray(182, 186)), [0x80, 0x08, 0, 0], 'GoodOutputA : 0x121 actif, 0x123 en fusion');
  assert.deepEqual(Array.from(r.subarray(190, 194)), [0x1, 0x3, 0, 0], 'SwOut');
  assert.equal(r[200], 0x00, 'Style StNode');
  assert.deepEqual(Array.from(r.subarray(201, 207)), [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x01]);
  assert.deepEqual(Array.from(r.subarray(207, 211)), [10, 0, 0, 42], 'BindIp');
  assert.equal(r[211], 1, 'BindIndex');
  assert.equal(r[212], 0x08 | 0x04 | 0x02, 'Status2 : 15 bits + DHCP');
  assert.deepEqual(Array.from(r.subarray(213, 217)), [0x80, 0x80, 0, 0], 'GoodOutputB : RDM désactivé');
  assert.equal(r[217], 0x00, 'Status3 : maintien (hold)');
  assert.deepEqual([r[226], r[227]], [0, 44], 'RefreshRateHi/Lo');
  assert.ok(r.subarray(228).every((x) => x === 0), 'BackgroundQueuePolicy et Filler à zéro');
  // Relecture par notre propre parseur
  const p = parseArtNet(r);
  assert.equal(p.kind, 'pollReply');
  assert.equal(p.ip, '10.0.0.42');
  assert.equal(p.port, ARTNET_PORT);
  assert.equal(p.shortName, 'Ecran plateau');
  assert.deepEqual(p.ports.map((x) => x.portAddress), [0x0121, 0x0123]);
  assert.equal(p.refreshRate, 44);
});

test('Art-Net : plusieurs ArtPollReply (BindIndex) quand les ports ne partagent pas Net/Sub-Net', () => {
  const rs = buildArtPollReplies({ ip: [192, 168, 1, 9], portAddresses: [0x0001, 0x0002, 0x0010, 0x0105, 0x0003, 0x0004, 0x0005] });
  assert.equal(rs.length, 4);
  const parsed = rs.map((r) => parseArtNet(r));
  assert.deepEqual(parsed.map((p) => p.bindIndex), [1, 2, 3, 4]);
  assert.deepEqual(parsed.map((p) => p.ports.map((x) => x.portAddress)), [[1, 2, 3, 4], [5], [0x10], [0x105]]);
  assert.equal(buildArtPollReplies({ ip: '1.2.3.4', portAddresses: [1, 2], portsPerReply: 1 }).length, 2);
  assert.equal(buildArtPollReplies({ ip: '1.2.3.4', portAddresses: [] })[0][173], 1, 'au moins un port annoncé');
  assert.throws(() => buildArtPollReply({ ip: '300.1.1.1', portAddresses: [1] }), TypeError);
  assert.throws(() => buildArtPollReply({ ip: '1.1.1.1', mac: 'zz', portAddresses: [1] }), TypeError);
  assert.equal(formatNodeReport(0x0001, 12345, 'x'), '#0001 [2345] x');
});

test('Art-Net : détection rapide', () => {
  assert.equal(looksLikeArtNet(artPoll()), true);
  assert.equal(looksLikeArtNet(new Uint8Array(12)), false);
});
