import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecureChannel, createScreenId, SESSION_TOPIC_PREFIX } from '../channel.js';
import { createPairing } from '../pairing.js';
import { createChunkAssembler, splitIntoChunks, deriveSession, seal } from '../crypto.js';

const isCode = (/** @type {string} */ code) => (/** @type {any} */ e) => e && e.name === 'ProtocolError' && e.code === code;

/**
 * Relais simulé : comme un topic MQTT, chaque trame publiée est remise à
 * TOUS les abonnés, émetteur compris.
 */
function makeBus() {
  /** @type {Array<{ ch: any, inbox: any[], errors: string[] }>} */
  const peers = [];
  /** @type {string[]} */
  const wire = [];
  return {
    wire,
    /** @param {any} ch */
    join(ch) {
      const peer = { ch, inbox: /** @type {any[]} */ ([]), errors: /** @type {string[]} */ ([]) };
      peers.push(peer);
      return peer;
    },
    /** @param {string} frame */
    async publish(frame) {
      wire.push(frame);
      for (const p of peers) {
        try {
          const r = await p.ch.receive(frame);
          if (r) p.inbox.push(r);
        } catch (e) {
          p.errors.push(/** @type {any} */ (e).code);
        }
      }
    },
  };
}

async function setup() {
  const pairing = createPairing();
  const idA = createScreenId();
  const idB = createScreenId();
  const remote = await createSecureChannel({ pairing, role: 'remote' });
  const screenA = await createSecureChannel({ pairing, role: 'screen', screenId: idA });
  const screenB = await createSecureChannel({ pairing, role: 'screen', screenId: idB, groups: ['salon'] });
  const bus = makeBus();
  return { pairing, idA, idB, remote, screenA, screenB, bus, R: bus.join(remote), A: bus.join(screenA), B: bus.join(screenB) };
}

test('tous les participants partagent le même topic opaque', async () => {
  const { pairing, remote, screenA, screenB } = await setup();
  assert.equal(remote.topic, screenA.topic);
  assert.equal(remote.topic, screenB.topic);
  assert.equal(remote.mqttTopic, SESSION_TOPIC_PREFIX + remote.topic);
  assert.ok(!remote.mqttTopic.includes(pairing.channelId));
  assert.match(createScreenId(), /^[A-Za-z0-9_-]{16}$/);
});

test('diffusion à tous les écrans, sans écho ni fuite entre écrans', async () => {
  const { remote, bus, R, A, B } = await setup();
  await bus.publish(await remote.seal({ type: 'color', color: '#ff0000' }));
  assert.equal(A.inbox.length, 1);
  assert.equal(B.inbox.length, 1);
  assert.deepEqual(A.inbox[0].message, { type: 'color', color: '#ff0000' });
  assert.equal(A.inbox[0].sender, remote.sender);
  assert.equal(R.inbox.length, 0, 'la télécommande ignore son propre écho');
  assert.deepEqual([...R.errors, ...A.errors, ...B.errors], []);
});

test('adressage : un écran, un groupe, configuration des groupes', async () => {
  const { remote, screenA, idA, idB, bus, A, B } = await setup();
  await bus.publish(await remote.seal({ type: 'blackout', on: true, target: { screens: [idA] } }));
  assert.equal(A.inbox.length, 1);
  assert.equal(B.inbox.length, 0, 'B n’est pas visé');

  await bus.publish(await remote.seal({ type: 'color', color: '#00ff00', target: { group: 'salon' } }));
  assert.equal(A.inbox.length, 1, 'A n’est pas dans le groupe salon');
  assert.equal(B.inbox.length, 1);

  // La télécommande range A dans « salon » ; l'app de l'écran applique la config
  await bus.publish(await remote.seal({ type: 'screen:config', target: { screens: [idA] }, name: 'Écran A', groups: ['salon'] }));
  const cfg = A.inbox.at(-1).message;
  assert.equal(cfg.type, 'screen:config');
  screenA.setGroups(cfg.groups);
  assert.deepEqual(screenA.groups, ['salon']);
  await bus.publish(await remote.seal({ type: 'color', color: '#0000ff', target: { group: 'salon' } }));
  assert.equal(A.inbox.at(-1).message.color, '#0000ff');
  assert.equal(B.inbox.at(-1).message.color, '#0000ff');
  await bus.publish(await remote.seal({ type: 'hello', target: { screens: [idA, idB] } }));
  assert.equal(A.inbox.at(-1).message.type, 'hello');
  assert.equal(B.inbox.at(-1).message.type, 'hello');
});

test('dmx:look (passerelle DMX) : chiffré, ciblé, type invisible sur le relais', async () => {
  const { remote, idA, bus, A, B } = await setup();
  const look = { type: 'dmx:look', target: { screens: [idA] }, seq: 7, live: true, look: { color: '#ff8800', strobe: { freq: 12, dur: 30 } } };
  const frame = await remote.seal(look);
  assert.ok(!Buffer.from(frame, 'base64url').includes('dmx'), 'type absent de la trame');
  await bus.publish(frame);
  assert.deepEqual(A.inbox.at(-1).message, look);
  assert.equal(B.inbox.length, 0, 'B n’est pas visé');
  await assert.rejects(remote.seal({ ...look, look: { color: '#ff8800', strobe: { freq: 31, dur: 30 } } }), isCode('invalid-message'));
});

test('écrans → télécommande : identité dans caps, fenêtres anti-rejeu par émetteur', async () => {
  const { screenA, screenB, idA, idB, bus, R, A, B } = await setup();
  const capsA = await screenA.seal({ type: 'caps', torch: true, vibrate: true, videoMode: 'rtc', screenId: idA, name: 'Écran A' });
  const capsB = await screenB.seal({ type: 'caps', torch: false, vibrate: false, videoMode: 'b64', screenId: idB, name: 'Écran B', groups: ['salon'] });
  await bus.publish(capsA);
  await bus.publish(capsB);
  // Les deux écrans ont commencé à seq 0 : acceptés car émetteurs distincts
  assert.equal(R.inbox.length, 2);
  assert.notEqual(R.inbox[0].sender, R.inbox[1].sender);
  assert.equal(R.inbox[0].message.screenId, idA);
  assert.equal(R.inbox[1].message.name, 'Écran B');
  // Les écrans ignorent les trames des autres écrans (même sens)
  assert.equal(A.inbox.length, 0);
  assert.equal(B.inbox.length, 0);
  // Rejeu d'une trame d'écran : refusé
  await bus.publish(capsA);
  assert.deepEqual(R.errors, ['replay']);
});

test('messages hors schéma : refusés à l’envoi et à la réception', async () => {
  const { pairing, remote, screenA, bus, A } = await setup();
  await assert.rejects(remote.seal({ type: 'strobe', active: true, freq: 0 }), isCode('invalid-message'));
  await assert.rejects(remote.seal({ type: 'caps', torch: true, vibrate: true }), isCode('invalid-message'), 'mauvais sens');
  await assert.rejects(screenA.seal({ type: 'color', color: '#ffffff' }), isCode('invalid-message'), 'un écran ne pilote pas');
  // Un détenteur de la clé qui contournerait le schéma (seal brut) est quand même filtré à la réception
  const s = await deriveSession(pairing);
  const raw = await seal({ type: 'effect', name: 'noise', active: true, params: { count: 1e8 } }, s.keys.r2s, { sender: 'rEvil0001', seq: 0 });
  await bus.publish(raw);
  assert.equal(A.inbox.length, 0);
  assert.deepEqual(A.errors, ['invalid-message']);
});

test('trame d’une autre session ou falsifiée : rejetée (auth)', async () => {
  const { bus, A } = await setup();
  const intruder = await createSecureChannel({ pairing: createPairing(), role: 'remote' });
  await bus.publish(await intruder.seal({ type: 'blackout', on: true }));
  assert.equal(A.inbox.length, 0);
  assert.deepEqual(A.errors, ['auth']);
});

test('média par fragments vers UN écran : seul l’écran visé réassemble', async () => {
  const { remote, idA, bus, A, B } = await setup();
  const file = new Uint8Array(50_000).map((_, i) => (i * 31) & 255);
  const parts = splitIntoChunks(file);
  const mediaId = 'vid-001';
  const asmA = createChunkAssembler();
  const asmB = createChunkAssembler();
  await bus.publish(await remote.seal({ type: 'media:upload', mediaId, kind: 'video', mime: 'video/mp4', totalChunks: parts.length, target: { screens: [idA] } }));
  // Logique applicative : seul un media:upload reçu (donc adressé) ouvre le réassemblage
  for (const [peer, asm] of /** @type {const} */ ([[A, asmA], [B, asmB]])) {
    for (const r of peer.inbox) if (r.message.type === 'media:upload') asm.expect(r.message.mediaId, r.message.totalChunks);
  }
  /** @type {Uint8Array | null} */
  let doneA = null;
  /** @type {Uint8Array | null} */
  let doneB = null;
  for (let i = parts.length - 1; i >= 0; i--) { // ordre inversé : QoS 0 ne garantit rien
    await bus.publish(await remote.sealChunk(parts[i], { mediaId, index: i, total: parts.length }));
  }
  for (const r of A.inbox) if (r.kind === 'chunk') doneA = asmA.add(r.chunk) ?? doneA;
  for (const r of B.inbox) if (r.kind === 'chunk') doneB = asmB.add(r.chunk) ?? doneB;
  assert.deepEqual(doneA, file);
  assert.equal(doneB, null);
});

test('arguments', async () => {
  await assert.rejects(createSecureChannel(/** @type {any} */ ({ pairing: createPairing(), role: 'admin' })), isCode('bad-argument'));
  await assert.rejects(createSecureChannel({ pairing: createPairing(), role: 'screen' }), isCode('bad-argument'), 'screenId requis');
  await assert.rejects(createSecureChannel({ pairing: createPairing(), role: 'screen', screenId: createScreenId(), groups: ['bad group'] }), isCode('bad-argument'));
});
