// Chiffrement de bout en bout dans l'app : ce que voit le relais, trames
// falsifiées / rejouées / non chiffrées ignorées, médias (images, photo
// d'appel) et signalisation WebRTC chiffrés, bornage à l'émission.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  launchBrowser, openPage, waitFor, sleep, FakeBroker, SRP, fakePeer, deliverFrame, pairingHash, publishedBy,
} from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
async function pair(seedR, seedS) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed: seedR, autoConnect: true });
  await remote.page.evaluate(() => startMode('remote'));
  await connected(remote.page);
  const screen = await openPage(browser, { broker, seed: seedS, autoConnect: true, hash: await pairingHash(remote.page) });
  await connected(screen.page);
  await waitFor(remote.page, () => _pairedScreens.size === 1);
  return { broker, remote, screen, rp: remote.page, sp: screen.page };
}
const canvasFile = (page, color, name) => page.evaluate(([color, name]) => new Promise((res) => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 40;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 64, 40);
  c.toBlob((b) => { window.__files = window.__files || {}; window.__files[name] = new File([b], name, { type: 'image/png' }); res(true); }, 'image/png');
}), [color, name]);

test('relais : topic opaque, trames illisibles (ni type, ni contenu, ni média en clair)', async () => {
  const { broker, remote, screen, rp, sp } = await pair(71, 72);
  await canvasFile(rp, '#ff0000', 'rouge.png');
  await rp.evaluate(() => {
    setKelvin(2700);
    document.getElementById('callName').value = 'Maman Secrète';
    triggerCall();
    onAddImages([window.__files['rouge.png']]);
  });
  await waitFor(sp, () => _mediaCache.has('m1') && _callState === 'ringing', null, { timeout: 10000 });
  await broker.flush();
  const session = await rp.evaluate(() => _session);
  const topics = new Set(broker.log.map((e) => e.topic));
  assert.deepEqual([...topics].filter((t) => !t.startsWith('setremote/v2/')), [], 'aucun ancien topic setremote/v1');
  const sessionFrames = broker.log.filter((e) => e.topic.startsWith(SRP.SESSION_TOPIC_PREFIX));
  assert.ok(sessionFrames.length > 10);
  for (const e of sessionFrames) {
    assert.equal(e.msg, null, 'jamais de JSON en clair');
    assert.match(e.payload, /^[A-Za-z0-9_-]+$/);
    for (const leak of ['color', 'call', 'Maman', 'media', 'data:image', 'type', session.key, session.channelId]) {
      assert.ok(!e.payload.includes(leak), 'fuite « ' + leak + ' » dans une trame');
    }
    const h = SRP.peekFrame(e.payload);
    assert.equal(h.version, 2); assert.equal(h.type, undefined);
  }
  assert.ok(!topics.has(SRP.SESSION_TOPIC_PREFIX + session.channelId));
  // Déchiffrées avec le secret : les vrais messages, dont les fragments d'image
  const types = (await broker.sent(rp)).map((m) => m.type);
  assert.ok(types.includes('media-img-chunk') && types.includes('call:start') && types.includes('color'), types.join());
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('écran : trames falsifiées, rejouées, périmées, non chiffrées ou d\'une autre session ignorées', async () => {
  const screen = await openPage(browser, { autoConnect: true });
  const sp = screen.page;
  const pairing = SRP.createPairing();
  await sp.evaluate((p) => screenJoinSession(p), pairing);
  await connected(sp);
  const remote = await fakePeer(pairing, 'remote');
  const stats = () => sp.evaluate(() => ({ ...secStats }));
  const color = () => sp.evaluate(() => screenBaseColor);
  // Trame légitime : appliquée
  const ok = await remote.seal({ type: 'color', color: '#112233' });
  await deliverFrame(sp, ok);
  assert.equal(await color(), '#112233');
  // Rejouée (même trame) : ignorée
  await sp.evaluate(() => receiveColor('#000000'));
  await deliverFrame(sp, ok);
  assert.equal(await color(), '#000000');
  assert.equal((await stats()).lastError, 'replay');
  // Falsifiée : chaque zone (en-tête AAD, IV, chiffré, tag) protégée
  const forged = await remote.seal({ type: 'color', color: '#445566' });
  const bytes = SRP.b64uToBytes(forged);
  // octets : version, émetteur, seq, horodatage, IV, chiffré, tag
  for (const i of [0, 4, 12, 20, 25, bytes.length - 20, bytes.length - 1]) {
    const t = bytes.slice(); t[i] ^= 0x01;
    await deliverFrame(sp, SRP.bytesToB64u(t));
  }
  assert.equal(await color(), '#000000');
  // Non chiffrée (ancien protocole), autre session, mauvais sens, périmée
  await deliverFrame(sp, JSON.stringify({ type: 'color', color: '#ffffff' }));
  const stranger = await fakePeer(SRP.createPairing(), 'remote');
  await deliverFrame(sp, await stranger.seal({ type: 'color', color: '#ffffff' }));
  const otherScreen = await fakePeer(pairing, 'screen');
  await deliverFrame(sp, await otherScreen.seal({ type: 'caps', torch: true, vibrate: true }));
  await deliverFrame(sp, await remote.forge({ type: 'color', color: '#ffffff' }, { ts: Date.now() - 10 * 60_000 }));
  assert.equal((await stats()).lastError, 'stale');
  // Trame v1 (type en clair dans l'en-tête) : refusée
  const v1 = SRP.b64uToBytes(await remote.seal({ type: 'color', color: '#ffffff' })); v1[0] = 1;
  await deliverFrame(sp, SRP.bytesToB64u(v1));
  assert.equal((await stats()).lastError, 'version');
  assert.equal(await color(), '#000000', 'aucune de ces trames n\'a été appliquée');
  const st = await stats();
  assert.equal(st.received, 1);
  assert.equal(st.dropped, 12, 'trames comptées comme rejetées');
  // La réception continue normalement ensuite
  await deliverFrame(sp, await remote.seal({ type: 'color', color: '#778899' }));
  assert.equal(await color(), '#778899');
  assert.deepEqual(screen.errors, []);
  await screen.close();
});

test('médias chiffrés : image du pool et photo d\'appel (__callphoto) en fragments', async () => {
  const { broker, remote, screen, rp, sp } = await pair(81, 82);
  await canvasFile(rp, '#00ff00', 'vert.png');
  await canvasFile(rp, '#0000ff', 'photo.png');
  await rp.evaluate(() => onAddImages([window.__files['vert.png']]));
  await waitFor(sp, () => _mediaCache.has('m1') && document.getElementById('screen-media-img').style.display === 'block', null, { timeout: 10000 });
  assert.match(await sp.evaluate(() => _mediaCache.get('m1').data), /^data:image\/jpeg;base64,/);
  await waitFor(rp, () => _screenCached.has('m1'));
  // Photo de l'appelant : fragments mis en cache AVANT l'appel, qui l'annonce seulement
  await rp.evaluate(() => onCallPhoto([window.__files['photo.png']]));
  await waitFor(sp, () => _mediaCache.has('__callphoto'), null, { timeout: 10000 });
  await rp.evaluate(() => triggerCall());
  await waitFor(sp, () => _callState === 'ringing');
  assert.equal(await sp.evaluate(() => _callCfg.photo), await rp.evaluate(() => _callPhoto));
  await broker.flush();
  const starts = await broker.sent(rp, 'call:start');
  assert.equal(starts.at(-1).hasPhoto, true);
  assert.equal(starts.at(-1).photo, undefined, 'plus de photo en ligne');
  const frames = broker.log.filter((e) => e.from === rp).map((e) => e.payload.length);
  assert.ok(Math.max(...frames) <= SRP.MAX_FRAME_CHARS && Math.max(...frames) < 64 * 1024, 'trames ≤ 64 Kio');
  assert.ok((await broker.sent(rp, 'media-img-start')).some((m) => m.mediaId === '__callphoto'));
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('vidéo : signalisation WebRTC chiffrée (offre, réponse, ICE) puis transfert pair-à-pair', async () => {
  const { broker, remote, screen, rp, sp } = await pair(91, 92);
  await rp.evaluate(() => {
    const bytes = new Uint8Array(150000).map((_, i) => (i * 7) & 255);
    broadcastVideo(new File([bytes], 'plan.mp4', { type: 'video/mp4' }), 'v1');
  });
  await waitFor(sp, () => _mediaCache.has('v1') && _mediaCache.get('v1').kind === 'vid', null, { timeout: 20000 });
  await broker.flush();
  const fromR = await broker.sent(rp), fromS = await broker.sent(sp);
  const offer = fromR.find((m) => m.type === 'rtc-offer');
  const answer = fromS.find((m) => m.type === 'rtc-answer');
  assert.equal(offer.sdp.type, 'offer'); assert.match(offer.sdp.sdp, /^v=0/);
  assert.equal(answer.sdp.type, 'answer');
  assert.ok(fromR.some((m) => m.type === 'rtc-ice' && m.from === 'remote'), 'ICE télécommande');
  assert.ok(fromS.some((m) => m.type === 'rtc-ice' && m.from === 'screen'), 'ICE écran');
  // Aucune ligne SDP / candidat en clair sur le relais
  for (const e of broker.log) assert.ok(!e.payload.includes('candidate') && !e.payload.includes('v=0'));
  assert.deepEqual(await rp.evaluate(() => [_rtcTransferDone, _rtcBroken]), [true, false]);
  await waitFor(rp, () => _screenCached.has('v1'));
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('émission : valeurs bornées aux plages du schéma, curseurs inchangés, aucun refus', async () => {
  const page = (await openPage(browser, { autoConnect: true })).page;
  await page.evaluate(() => startMode('remote'));
  await connected(page);
  // Curseurs d'origine conservés (flash dès 5 ms)
  assert.deepEqual(await page.evaluate(() => ['flashDurSlider', 'flashDurMaxSlider'].map((id) => document.getElementById(id).min)), ['5', '5']);
  await page.evaluate(() => {
    mqttClient.published.length = 0;
    strobeMode = 'random'; strobeFreq = 50; strobeFlashDur = 5; strobeFreqMax = 0.01; strobeFlashDurMax = 9000;
    document.getElementById('strobeToggle').checked = true; onStrobeToggle();
    sendVibrate(Array(30).fill(5000));
    sendMsg({ type: 'screen:brightness', value: 3 });
    sendMsg({ type: 'media-ctrl', action: 'seek', time: -5 });
  });
  await sleep(200);
  const strobe = (await publishedBy(page, 'strobe')).at(-1);
  assert.deepEqual([strobe.freq, strobe.dur, strobe.freqMin, strobe.freqMax, strobe.durMin, strobe.durMax], [30, 15, 30, 0.1, 15, 2000]);
  const vib = (await publishedBy(page, 'vibrate')).at(-1);
  assert.equal(vib.pattern.length, 20); assert.ok(vib.pattern.every((v) => v === 2000));
  assert.equal((await publishedBy(page, 'screen:brightness')).at(-1).value, 1);
  assert.equal((await publishedBy(page, 'media-ctrl')).at(-1).time, 0);
  // Tous les effets, avec leurs réglages extrêmes, passent le schéma
  await page.evaluate(async () => {
    switchTab('effects');
    for (const name of Object.keys(EFFECT_CONFIG)) {
      selectEffect(name);
      for (const id of ['effectSpeedSlider', 'effectIntensitySlider', 'effectBurstSlider', 'effectWidthSlider', 'effectRotSlider', 'effectLeadSlider', 'effectFadeSlider']) {
        const s = document.getElementById(id); s.value = s.max;
      }
      sendMsg({ type: 'effect', name, active: true, params: buildEffectParams() });
      await new Promise((r) => setTimeout(r, 20));
      selectEffect(name); // arrêt
    }
  });
  await sleep(200);
  assert.ok((await publishedBy(page, 'effect')).filter((m) => m.active).length >= 14);
  assert.deepEqual(await page.evaluate(() => [secStats.refused, secStats.lastError]), [0, null], 'aucun message refusé par le schéma à l\'envoi');
});
