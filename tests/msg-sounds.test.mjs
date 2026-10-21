// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Sons de message synthétisés (Métallophone Do / Sol, Envoi) : buffers conformes
// aux WAV de référence validés (tests/fixtures/sounds/), puces présentes pour
// SMS / notification / discussion et absentes pour l'appel, lecture sur l'écran
// (volume, jamais pour un appel), validation réseau et nettoyage des
// enregistrements (liste, projet, séquence) avec repli « classic » pour un appel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, openPage } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const REF = {
  'metal-do': { file: 'metallophone-do-C7-v3.wav', freq: 2093 },
  'metal-sol': { file: 'metallophone-sol-G7-v3.wav', freq: 3135.96 },
  sent: { file: 'envoi-v3.wav', freq: null },
};
const SR = 44100;

// WAV PCM 16 bits mono → Float32Array
function readWav(file) {
  const b = readFileSync(new URL('./fixtures/sounds/' + file, import.meta.url));
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.equal(b.readUInt32LE(24), SR, 'référence à 44100 Hz');
  const n = b.readUInt32LE(40) / 2, s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = b.readInt16LE(44 + i * 2) / 32767;
  return s;
}
// RMS par tranche de 10 ms
function rmsEnv(s, rate) {
  const w = Math.round(rate * 0.01), out = [];
  for (let i = 0; i + w <= s.length; i += w) { let e = 0; for (let j = 0; j < w; j++) e += s[i + j] * s[i + j]; out.push(Math.sqrt(e / w)); }
  return out;
}
// Fréquence dominante (Goertzel, pas de 1 Hz) sur la fenêtre [t0 ; t1] s
function dominant(s, rate, t0, t1, lo = 150, hi = 4000) {
  const a = Math.floor(t0 * rate), b = Math.min(s.length, Math.floor(t1 * rate));
  let best = 0, bf = 0;
  for (let f = lo; f <= hi; f++) {
    const w = 2 * Math.PI * f / rate, c = 2 * Math.cos(w);
    let q1 = 0, q2 = 0;
    for (let i = a; i < b; i++) { const q0 = c * q1 - q2 + s[i]; q2 = q1; q1 = q0; }
    const p = q1 * q1 + q2 * q2 - c * q1 * q2;
    if (p > best) { best = p; bf = f; }
  }
  return bf;
}
const peak = (s) => s.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

test('buffers synthétisés : identiques aux WAV de référence (échantillons, durée, enveloppe, fréquence)', async () => {
  const { page, errors, close } = await openPage(browser);
  const out = await page.evaluate((SR) => {
    const ctx = _ac(), r = { rate: ctx.sampleRate, ids: {} };
    for (const id of ['metal-do', 'metal-sol', 'sent']) {
      const at44 = Array.from(msgSoundSamples(id, SR));
      const buf = msgSoundBuffer(ctx, id);
      r.ids[id] = { at44, native: Array.from(buf.getChannelData(0)), dur: buf.duration, len: buf.length, ch: buf.numberOfChannels, same: msgSoundBuffer(ctx, id) === buf };
    }
    return r;
  }, SR);
  const dir = process.env.SOUNDS_EXPORT_DIR; // export facultatif des WAV du navigateur, pour les écouter
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [id, ref] of Object.entries(REF)) {
    const got = out.ids[id], want = readWav(ref.file);
    // 44,1 kHz : échantillon par échantillon (le WAV est quantifié sur 16 bits)
    assert.equal(got.at44.length, want.length, id + ' : même nombre d\'échantillons');
    let maxDiff = 0;
    for (let i = 0; i < want.length; i++) maxDiff = Math.max(maxDiff, Math.abs(got.at44[i] - want[i]));
    assert.ok(maxDiff < 2e-3, id + ' : écart maximal ' + maxDiff);
    assert.ok(Math.abs(peak(got.at44) - 0.89) < 1e-4, id + ' : crête 0,89');
    // Fréquence de l'appareil (48 kHz en général) : mêmes durée, enveloppe et fréquence dominante
    const nat = Float32Array.from(got.native), rate = out.rate;
    assert.equal(got.ch, 1);
    assert.equal(got.same, true, id + ' : buffer gardé en cache');
    assert.ok(Math.abs(got.dur - want.length / SR) < 0.001, id + ' : durée ' + got.dur);
    assert.ok(Math.abs(peak(nat) - 0.89) < 1e-4, id + ' : crête 0,89 à ' + rate + ' Hz');
    const ea = rmsEnv(nat, rate), eb = rmsEnv(want, SR);
    assert.ok(Math.abs(ea.length - eb.length) <= 1, id + ' : même nombre de tranches de 10 ms');
    let envMax = 0;
    for (let i = 0; i < Math.min(ea.length, eb.length); i++) envMax = Math.max(envMax, Math.abs(ea[i] - eb[i]));
    assert.ok(envMax < 0.04, id + ' : enveloppe RMS, écart ' + envMax);
    const win = id === 'sent' ? [0.22, 0.26] : [0.05, 0.3];
    const fw = dominant(want, SR, ...win), fn = dominant(nat, rate, ...win);
    assert.ok(Math.abs(fn - fw) <= Math.max(2, fw * 0.005), id + ' : fréquence dominante ' + fn + ' vs ' + fw);
    if (ref.freq) assert.ok(Math.abs(fn - ref.freq) < 5, id + ' : ' + fn + ' ≈ ' + ref.freq);
    if (dir) {
      for (const [suffix, data, r] of [['44100', Float32Array.from(got.at44), SR], ['device-' + rate, nat, rate]]) {
        const b = Buffer.alloc(44 + data.length * 2);
        b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write('WAVEfmt ', 8);
        b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(r, 24);
        b.writeUInt32LE(r * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
        data.forEach((x, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), 44 + i * 2));
        writeFileSync(`${dir}/${id}-app-${suffix}.wav`, b);
      }
    }
  }
  assert.deepEqual(errors, []);
  await close();
});

test('puces : présentes pour SMS, notification et discussion, absentes pour l\'appel ; choix et repli', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  const NEW = ['metal-do', 'metal-sol', 'sent'];
  const chips = () => page.evaluate((ids) => ids.map((x) => {
    const b = document.getElementById('callring-' + x);
    return [b.textContent, getComputedStyle(b).display !== 'none'];
  }), NEW);
  const labels = [['Métallophone Do'], ['Métallophone Sol'], ['Envoi']].map((x) => x[0]);
  await page.evaluate(() => setCallKind('call'));
  assert.deepEqual(await chips(), labels.map((l) => [l, false]), 'appel : liste inchangée');
  for (const k of ['sms', 'notif', 'discussion']) {
    await page.evaluate((k) => setCallKind(k), k);
    assert.deepEqual(await chips(), labels.map((l) => [l, true]), k);
  }
  // Choix pour un SMS : mémorisé, champs envoyés, résumé de la rangée
  await page.evaluate(() => { setCallKind('sms'); setCallRing('metal-sol'); });
  assert.equal(await page.evaluate(() => document.getElementById('callring-metal-sol').classList.contains('active')), true);
  assert.deepEqual(await page.evaluate(() => [ringSettings.sms.sound, callFormFields().ring, telSoundName('metal-sol'), telSoundName('sent')]), ['metal-sol', 'metal-sol', 'Métallophone Sol', 'Envoi']);
  await page.evaluate(() => { setCallKind('notif'); setCallRing('sent'); setCallKind('discussion'); setCallRing('metal-do'); });
  assert.equal(await page.evaluate(() => ringChatFields().ring), 'metal-do');
  // Appel : refusé, reste Classique (jamais un son de message)
  await page.evaluate(() => { setCallKind('call'); setCallRing('metal-do'); });
  assert.deepEqual(await page.evaluate(() => [ringSettings.call.sound, callFormFields().ring]), ['classic', 'classic']);
  assert.deepEqual(await page.evaluate(() => ringMsgFields('sent', 1, 'call').ring), 'classic');
  // Rechargement : chaque type retrouve son choix ; un appel enregistré avec un son de message est ramené à Classique
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  assert.deepEqual(await page.evaluate(() => [ringSettings.sms.sound, ringSettings.notif.sound, ringSettings.discussion.sound, ringSettings.call.sound]), ['metal-sol', 'sent', 'metal-do', 'classic']);
  await page.evaluate(() => localStorage.setItem(RING_SETTINGS_KEY, JSON.stringify({ v: 1, call: { sound: 'sent' }, sms: { sound: 'sent' } })));
  await page.reload();
  assert.deepEqual(await page.evaluate(() => [ringSettings.call.sound, ringSettings.sms.sound, ringSettings.discussion.sound]), ['classic', 'sent', 'silent']);
  assert.deepEqual(errors, []);
  await close();
});

test('écran : lecture une fois au volume choisi pour les messages, rien de tel pour un appel', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => {
    window.__ev = []; window.__gains = [];
    const S = AudioBufferSourceNode.prototype, start = S.start;
    S.start = function (...a) { window.__ev.push({ dur: Math.round(this.buffer.duration * 100) / 100, loop: this.loop }); return start.apply(this, a); };
    const C = BaseAudioContext.prototype, cg = C.createGain;
    C.createGain = function () { const g = cg.call(this); window.__gains.push(g); return g; };
  });
  const r = await page.evaluate(() => {
    const res = {};
    _notifBuiltin('sms', 'metal-do', 0.5); res.sms = window.__ev.length;
    _notifBuiltin('notif', 'sent', 1); res.notif = window.__ev.length;
    _notifBuiltin('discussion', 'metal-sol', 1); res.chat = window.__ev.length;
    res.gain = window.__gains[0].gain.value;
    _notifBuiltin('call', 'metal-do', 1); res.call = window.__ev.length;
    _playNotifSound({ kind: 'sms', ring: 'sent', ringId: null, ringVolume: 0.25 }); res.play = window.__ev.length;
    res.last = window.__gains.at(-1).gain.value;
    res.ev = window.__ev.slice();
    return res;
  });
  assert.deepEqual([r.sms, r.notif, r.chat, r.call, r.play], [1, 2, 3, 3, 4]);
  assert.equal(r.gain, 0.5);
  assert.equal(r.last, 0.25);
  assert.deepEqual(r.ev.map((e) => [e.dur, e.loop]), [[2.1, false], [0.46, false], [2.1, false], [0.46, false]]);
  assert.deepEqual(errors, []);
  await close();
});

test('réseau, liste, projet, séquence : ids acceptés pour les messages, Classique pour un appel', async () => {
  const { page, errors, close } = await openPage(browser);
  const r = await page.evaluate(() => {
    const call = (kind, ring) => { const m = { type: 'call:start', kind, ring }; _validCallStart(m); return m.ring; };
    const chat = { type: 'chat:open', name: 'M', style: 'glass', ids: [], sent: [], ring: 'metal-sol' }; _validChatOpen(chat);
    const chat2 = { type: 'chat:open', name: 'M', style: 'glass', ids: [], sent: [], ring: 'metal-la' }; _validChatOpen(chat2);
    const ph = (ring) => { const m = { type: 'phone:state', mode: 'locked', style: 'glass', notifs: [{ id: 'n1', kind: 'sms', app: 'SMS', name: 'A', ago: 0 }], chime: { id: 'n1', ring } }; _validPhoneState(m); return m.chime.ring; };
    const ent = (kind, ring) => { const e = _clSanitize({ id: 'e1', kind, ring, ringVolume: 1 }); return e && e.ring; };
    const prj = (kind, ring) => { const e = _prjCallEntry({ id: 'e1', kind, ring, ringVolume: 1 }, kind === 'call' ? 'call' : kind); return e && e.ring; };
    const rs = _prjRingSettings({ call: { sound: 'sent' }, sms: { sound: 'metal-do' }, notif: { sound: 'sent' }, discussion: { sound: 'metal-sol' } });
    return {
      callNet: ['call', 'sms', 'notif', 'chat'].map((k) => call(k, 'metal-do')), callOld: call('call', 'soft'),
      chat: [chat.ring, chat2.ring], chime: [ph('sent'), ph('nope')],
      list: [ent('call', 'metal-do'), ent('sms', 'metal-do'), ent('notif', 'sent'), ent('chat', 'metal-sol'), ent('sms', 'metal-la')],
      prj: [prj('call', 'sent'), prj('sms', 'sent'), prj('notif', 'metal-sol')],
      rs: [rs.call.sound, rs.sms.sound, rs.notif.sound, rs.discussion.sound],
      msg: ['call', 'sms', 'notif'].map((k) => ringMsgFields('metal-do', 0.5, k).ring),
    };
  });
  assert.deepEqual(r.callNet, ['classic', 'metal-do', 'metal-do', 'metal-do'], 'écran : appel ramené à classic');
  assert.equal(r.callOld, 'soft');
  assert.deepEqual(r.chat, ['metal-sol', 'classic'], 'discussion : id inconnu → classic (comme un ancien écran)');
  assert.deepEqual(r.chime, ['sent', 'classic']);
  assert.deepEqual(r.list, ['classic', 'metal-do', 'sent', 'metal-sol', 'classic']);
  assert.deepEqual(r.prj, ['classic', 'sent', 'metal-sol']);
  assert.deepEqual(r.rs, ['classic', 'metal-do', 'sent', 'metal-sol']);
  assert.deepEqual(r.msg, ['classic', 'metal-do', 'metal-do']);
  assert.deepEqual(errors, []);
  await close();
});
