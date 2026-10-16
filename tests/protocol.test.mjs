// Robustesse du protocole (Partie 3) : table d'aiguillage + validateurs
// (2e barrière, après le schéma strict du paquet protocole), bornage des
// effets, cycle de vie MQTT (coupure / reconnexion) et resynchronisation
// complète d'un écran (re)connecté — le tout sur la session chiffrée.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  launchBrowser, openPage, waitFor, sleep, connectFakeClients, FakeBroker, SRP,
  fakePeer, deliverFrame, publishedBy, pairingHash,
} from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

// Espionne des fonctions globales de l'app (les liaisons function sont réassignables)
async function spy(page, names) {
  await page.evaluate((names) => {
    window.__calls = {};
    for (const n of names) {
      const orig = window[n];
      window.__calls[n] = [];
      window[n] = function (...args) { (window.__calls[n] ||= []).push(JSON.parse(JSON.stringify(args))); return orig.apply(this, args); };
    }
  }, names);
}
const calls = (page, n) => page.evaluate((n) => window.__calls[n], n);
// 2e barrière : un message déjà authentifié et conforme au schéma passe par
// la table d'aiguillage (rôle, bornage, traitement). On l'y présente
// directement pour éprouver ses validateurs (valeurs que le schéma refuserait).
const deliver = (page, msg) => page.evaluate((msg) => { dispatchMessage(msg); }, msg);

describe('écran : validation des messages reçus', () => {
  let ctx, remote;
  before(async () => {
    ctx = await openPage(browser);
    const pairing = SRP.createPairing();
    await ctx.page.evaluate((p) => screenJoinSession(p), pairing);
    await waitFor(ctx.page, () => !!mqttClient);
    await connectFakeClients(ctx.page);
    await waitFor(ctx.page, () => mqttClient.connected);
    remote = await fakePeer(pairing, 'remote');
  });
  after(async () => { await ctx?.close(); });

  test('couleur : seules les couleurs #rrggbb sont appliquées', async () => {
    const { page } = ctx;
    for (const color of ['red', 'url(https://x)', '#12345', '#1234567', 42, null, '#GGGGGG']) {
      await deliver(page, { type: 'color', color });
    }
    assert.equal(await page.evaluate(() => screenBaseColor), '#1a1a1a', 'aucune couleur invalide appliquée');
    await deliver(page, { type: 'color', color: '#A0B1C2' });
    assert.equal(await page.evaluate(() => screenBaseColor), '#A0B1C2');
  });

  test('messages inconnus, hors rôle, mal formés, non chiffrés ou écho : ignorés sans erreur', async () => {
    const { page } = ctx;
    await spy(page, ['applyReceiverCaps', 'receiveColor', 'remoteOnCallState', 'dispatchMessage']);
    const dropped0 = await page.evaluate(() => secStats.dropped);
    // Ancien protocole en clair et charges quelconques : rejetées avant tout traitement
    const raws = ['42', 'null', '[]', '"color"', '{"type":"color","color":"#010203"}', '{"type":{"x":1}}', '{"type":"__proto__"}', 'pas du json'];
    for (const raw of raws) await deliverFrame(page, raw);
    assert.equal(await page.evaluate(() => secStats.dropped) - dropped0, raws.length);
    // Authentifiées mais hors schéma ou hors sens : rejetées par le schéma strict
    await deliverFrame(page, await remote.forge({ type: 'caps', torch: false, vibrate: false })); // réservé à la télécommande
    await deliverFrame(page, await remote.forge({ type: 'call:state', state: 'ringing' }));
    await deliverFrame(page, await remote.forge({ type: 'color', color: 'red' }));
    await deliverFrame(page, await remote.forge({ type: 'eval', code: 'alert(1)' }));
    assert.equal(await page.evaluate(() => secStats.lastError), 'invalid-message');
    // Vocabulaire natif connu du schéma mais pas de la PWA : ignoré par l'aiguillage
    await deliverFrame(page, await remote.seal({ type: 'media:clear', mediaId: 'all' }));
    // Écho : la propre trame de l'écran ne lui revient pas
    const echo = await page.evaluate(async () => { const f = await _sec.seal({ type: 'screen:alive' }); return f; });
    await deliverFrame(page, echo);
    assert.deepEqual((await calls(page, 'dispatchMessage')).map((a) => a[0].type), ['media:clear']);
    assert.deepEqual(await calls(page, 'applyReceiverCaps'), []);
    assert.deepEqual(await calls(page, 'remoteOnCallState'), []);
    assert.deepEqual(await calls(page, 'receiveColor'), []);
    assert.deepEqual(ctx.errors, []);
  });

  test('strobe : fréquence ≤ 30 Hz, flash ≥ 15 ms, champs requis', async () => {
    const { page } = ctx;
    await spy(page, ['receiveStrobe']);
    await deliver(page, { type: 'strobe', active: true });                          // freq/dur absents → rejet
    await deliver(page, { type: 'strobe', active: true, freq: 'x', dur: 50 });       // non numérique → rejet
    await deliver(page, { type: 'strobe', active: true, freq: 1e9, dur: 1, torch: 0 });
    await deliver(page, { type: 'strobe', active: true, random: true, freq: 0, dur: 50, freqMin: -5, freqMax: 500, durMin: 2, durMax: 1e9 });
    await deliver(page, { type: 'strobe', active: true, freq: 12.5, dur: 40, vibrate: true }); // charge utile de l'app native
    await deliver(page, { type: 'strobe', active: false });
    const c = (await calls(page, 'receiveStrobe')).map((a) => a[0]);
    assert.equal(c.length, 4);
    assert.equal(c[0].freq, 30); assert.equal(c[0].dur, 15); assert.equal(c[0].torch, false);
    assert.deepEqual([c[1].freq, c[1].freqMin, c[1].freqMax, c[1].durMin, c[1].durMax], [0.1, 0.1, 30, 15, 2000]);
    assert.deepEqual([c[2].freq, c[2].dur, c[2].vibrate], [12.5, 40, true], 'valeurs valides inchangées');
    assert.equal(c[3].active, false);
    // Période effective ≥ durée + 5 ms : le strobe tourne sans boucle serrée
    await page.evaluate(() => { window.__flips = 0; const sc = document.getElementById('screen-mode'); new MutationObserver(() => window.__flips++).observe(sc, { attributes: true, attributeFilter: ['style'] }); });
    await deliver(page, { type: 'strobe', active: true, freq: 1e6, dur: 0 });
    await sleep(500);
    const flips = await page.evaluate(() => window.__flips);
    assert.ok(flips <= 2 * (500 / 33) + 6, 'au plus ~30 flashes/s, obtenu ' + flips + ' changements en 500 ms');
    await deliver(page, { type: 'strobe', active: false });
  });

  test('vibreur, torche, luminosité : types et plafonds', async () => {
    const { page } = ctx;
    await spy(page, ['doVibrate', 'receiveTorchDim', 'receiveTorchEffect', 'setScreenDim', 'receiveTorchOnOff']);
    await deliver(page, { type: 'vibrate', pattern: Array(21).fill(10) });   // > 20 entrées
    await deliver(page, { type: 'vibrate', pattern: [100, 'x'] });
    await deliver(page, { type: 'vibrate', pattern: 'SOS' });
    await deliver(page, { type: 'vibrate', pattern: [0, 200, 100, 200], repeat: false }); // app native
    await deliver(page, { type: 'vibrate', pattern: [99999, -4] });
    await deliver(page, { type: 'vibrate', pattern: 1e9 });
    assert.deepEqual((await calls(page, 'doVibrate')).map((a) => a[0]), [[0, 200, 100, 200], [2000, 0], 2000]);
    await deliver(page, { type: 'torch-dim', level: 'abc' });
    await deliver(page, { type: 'torch-dim', level: 250 });
    await deliver(page, { type: 'torch-effect', effect: '__proto__' });
    await deliver(page, { type: 'torch-effect', effect: 'constructor' });
    await deliver(page, { type: 'torch-effect', effect: 'sos' });
    await deliver(page, { type: 'torch-effect', effect: 'stop' });
    await deliver(page, { type: 'torch-onoff', on: 'yes' });
    assert.deepEqual((await calls(page, 'receiveTorchDim')).map((a) => a[0]), [100]);
    assert.deepEqual((await calls(page, 'receiveTorchEffect')).map((a) => a[0]), ['sos', 'stop']);
    assert.deepEqual((await calls(page, 'receiveTorchOnOff')).map((a) => a[0]), [true]);
    await deliver(page, { type: 'torch-onoff', on: false });
    await deliver(page, { type: 'screen:brightness', value: 'x' });
    await deliver(page, { type: 'screen:brightness', value: 5 });
    await deliver(page, { type: 'screen:brightness', value: 0.25 });
    assert.deepEqual((await calls(page, 'setScreenDim')).map((a) => a[0]), [1, 0.25]);
    assert.equal(await page.evaluate(() => document.getElementById('screen-dim').style.opacity), '0.75');
    await deliver(page, { type: 'screen:brightness', value: 1 });
  });

  test('effets : nom connu, paramètres bornés par EFFECT_CONFIG (Paparazzi / Chaser)', async () => {
    const { page } = ctx;
    await deliver(page, { type: 'effect', active: true, name: 'nope', params: {} });
    await deliver(page, { type: 'effect', active: true, name: '__proto__', params: {} });
    await deliver(page, { type: 'effect', active: true, name: 'police', params: 'x' });
    assert.equal(await page.evaluate(() => _screenEffect), null);
    await deliver(page, { type: 'effect', active: true, name: 'paparazzi',
      params: { count: 1e9, speed: 1e9, intensity: 1e6, color1: 'javascript:x', color2: '#00ff00', chaos: -50, extra: 'x' } });
    const p = await page.evaluate(() => _screenFxParams);
    assert.deepEqual(p, { speed: 4, intensity: 100, chaos: 0, count: 10, color2: '#00ff00' });
    await deliver(page, { type: 'effect', active: true, name: 'chaser',
      params: { count: 1e6, width: 1e6, wing: 99, rot: -10, lead: 1e9, fade: 1e9, shape: 'star', dir: 'v', mode: 'bounce', invert: 'yes', speed: 0 } });
    assert.deepEqual(await page.evaluate(() => _screenFxParams),
      { speed: 0.1, width: 60, wing: 4, rot: 0, lead: 600, fade: 600, count: 12, dir: 'v', mode: 'bounce' });
    await deliver(page, { type: 'effect', active: true, name: 'tv', params: { blocks: Array(100).fill('#ff0000').concat(['bad']), smooth: 500 } });
    const tv = await page.evaluate(() => _screenFxParams);
    assert.equal(tv.blocks.length, 8); assert.equal(tv.smooth, 100);
    // Une frame Paparazzi « forgée » reste instantanée
    const ms = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 240; c.height = 136;
      const p = _fxSanitizeParams('paparazzi', { count: 1e9, speed: 1e9 }), st = {};
      const t0 = performance.now();
      for (let i = 0; i < 60; i++) FX_LIB.paparazzi(c.getContext('2d'), 240, 136, i / 30, _fxModulate(p, st, i / 30), st);
      return performance.now() - t0;
    });
    assert.ok(ms < 200, '60 frames en ' + ms.toFixed(1) + ' ms');
    await deliver(page, { type: 'effect', active: false });
    assert.equal(await page.evaluate(() => _screenEffect), null);
  });

  test("appel : sonnerie inconnue → classique, champs plafonnés", async () => {
    const { page } = ctx;
    await deliver(page, { type: 'call:start', kind: 'call', style: 'glass', name: 'N'.repeat(500), ring: '__proto__', autoAnswer: 'x', lock: true, photo: 'data:image/png;base64,AAAA' });
    const cfg = await page.evaluate(() => ({ ..._callCfg }));
    assert.equal(cfg.ring, 'classic');
    assert.equal(cfg.name.length, 40);
    assert.equal(cfg.autoAnswer, 0);
    assert.equal(cfg.lock, null);
    assert.equal(cfg.photo, null, 'photo en ligne ignorée (seul le cache __callphoto compte)');
    // Cadence normale de la sonnerie (aucune boucle à 0 ms)
    const n = await page.evaluate(async () => { let k = 0; const o = window._ringBurst; window._ringBurst = (x) => { k++; return o(x); }; await new Promise((r) => setTimeout(r, 400)); window._ringBurst = o; return k; });
    assert.ok(n <= 1, 'sonnerie répétée ' + n + ' fois en 400 ms');
    await deliver(page, { type: 'call:end' });
    assert.equal(await page.evaluate(() => _callState), 'idle');
  });

  test('son importé : id hors format ignoré, volume borné, absent du cache → son intégré', async () => {
    const { page } = ctx;
    const cfgOf = async (m) => {
      await deliver(page, { type: 'call:start', kind: 'sms', style: 'glass', name: 'A', ring: 'silent', ...m });
      const c = await page.evaluate(() => ({ ringId: _callCfg.ringId, ringVolume: _callCfg.ringVolume, player: !!_ringPlayer }));
      await deliver(page, { type: 'call:end' });
      return c;
    };
    for (const ringId of ['__callaudio', '../../x', '__ring_0123456789ABCDEF', 'data:audio/mpeg;base64,SUQz', 42, { id: 'x' }]) {
      assert.deepEqual(await cfgOf({ ringId }), { ringId: null, ringVolume: 1, player: false }, JSON.stringify(ringId));
    }
    assert.equal((await cfgOf({ ringVolume: 7 })).ringVolume, 1);
    assert.equal((await cfgOf({ ringVolume: -3 })).ringVolume, 0);
    assert.equal((await cfgOf({ ringVolume: 'fort' })).ringVolume, 1);
    assert.equal((await cfgOf({ ringVolume: 0.25 })).ringVolume, 0.25);
    // Id valide mais absent du cache : pas de lecture importée (repli intégré, ici silencieux)
    assert.deepEqual(await cfgOf({ ringId: '__ring_0123456789abcdef' }), { ringId: '__ring_0123456789abcdef', ringVolume: 1, player: false });
    // Émission : bornage avant scellement (le schéma refuserait)
    const out = await page.evaluate(() => clampOutgoing({ type: 'call:start', kind: 'call', ringVolume: 4, ringId: '__ring_../x' }));
    assert.deepEqual([out.ringVolume, 'ringId' in out], [1, false]);
  });

  test('médias : identifiants, ordre, contrôle, fragments vidéo', async () => {
    const { page } = ctx;
    await deliver(page, { type: 'media:order', ids: 'm1,m2' });
    await deliver(page, { type: 'media:order', ids: ['m1', '<x>'] });
    assert.deepEqual(await page.evaluate(() => _mediaOrder), []);
    await deliver(page, { type: 'media:order', ids: ['m1', 'm2'] });
    assert.deepEqual(await page.evaluate(() => _mediaOrder), ['m1', 'm2']);
    await spy(page, ['screenMediaCtrl', 'screenVidUploadChunk', 'screenShowCached', 'screenSetEndMode']);
    await deliver(page, { type: 'media-ctrl', action: 'seek', time: 'NaN' });
    await deliver(page, { type: 'media-ctrl', action: 'eval' });
    await deliver(page, { type: 'media-ctrl', action: 'seek', time: -3 });
    assert.deepEqual((await calls(page, 'screenMediaCtrl')).map((a) => a[0].time), [0]);
    await deliver(page, { type: 'media:show', id: '../x' });
    await deliver(page, { type: 'media:endmode', mode: 'explode' });
    await deliver(page, { type: 'media:endmode', mode: 'pause' });
    assert.deepEqual(await calls(page, 'screenShowCached'), []);
    assert.deepEqual((await calls(page, 'screenSetEndMode')).map((a) => a[0]), ['pause']);
    await deliver(page, { type: 'media:upload', mediaId: 'v1', totalChunks: 1e9 });
    assert.equal(await page.evaluate(() => _vidUp), null);
    await deliver(page, { type: 'media:upload', mediaId: 'v1', mime: 'video/mp4"><x', totalChunks: 3, kind: 'video' });
    assert.deepEqual(await page.evaluate(() => [_vidUp.total, _vidUp.mime]), [3, 'video/mp4']);
    await deliver(page, { type: 'media:chunk', mediaId: 'v1', index: 3, data: 'AAAA' });     // hors bornes
    await deliver(page, { type: 'media:chunk', mediaId: 'v1', index: 'foo', data: 'AAAA' });
    await deliver(page, { type: 'media:chunk', mediaId: 'v1', index: 0, data: 'A'.repeat(20001) });
    await deliver(page, { type: 'media:chunk', mediaId: 'v1', index: 1, data: 'AAAA' });
    assert.deepEqual((await calls(page, 'screenVidUploadChunk')).map((a) => a[0].index), [1]);
    assert.equal(await page.evaluate(() => _vidUp.got), 1);
    // Fragments d'image : validés avant le tampon
    await deliver(page, { type: 'media-img-start', id: 'k', total: 1e6 });
    assert.equal(await page.evaluate(() => _imgBufs.has('k')), false);
    await page.evaluate(() => { _vidUp = null; screenSetEndMode('loop'); });
    assert.deepEqual(ctx.errors, []);
  });
});

describe('cycle de vie MQTT', () => {
  test('télécommande : coupure → « Reconnexion… », reconnexion → « Internet · chiffré », réabonnement + hello', async () => {
    const { page, errors, close } = await openPage(browser);
    await page.evaluate(() => startMode('remote'));
    await waitFor(page, () => !!mqttClient);
    const status = () => page.evaluate(() => ({ pill: document.getElementById('linkPill').className, label: document.getElementById('linkPillLabel').textContent }));
    assert.deepEqual(await status(), { pill: 'link-pill reconnecting', label: 'Connexion…' });
    await connectFakeClients(page);
    await waitFor(page, () => document.getElementById('linkPill').classList.contains('online'));
    assert.equal((await status()).label, 'Internet · chiffré');
    const hellos = async () => (await publishedBy(page, 'hello')).length;
    assert.equal(await hellos(), 1);
    // Coupure réseau : close + offline + reconnect
    await page.evaluate(() => mqttClient._drop());
    assert.deepEqual(await status(), { pill: 'link-pill reconnecting', label: 'Reconnexion…' });
    await page.evaluate(() => mqttClient.emit('error', new Error('ws')));
    assert.equal((await status()).label, 'Reconnexion…');
    await page.evaluate(() => mqttClient.emit('reconnect'));
    assert.equal((await status()).pill, 'link-pill reconnecting');
    await page.evaluate(() => mqttClient._connect());
    await waitFor(page, () => document.getElementById('linkPill').classList.contains('online'));
    await sleep(50);
    assert.equal(await hellos(), 2, 'hello renvoyé à la reconnexion → resynchronisation');
    const topic = await page.evaluate(() => _sec.mqttTopic);
    assert.match(topic, /^setremote\/v2\/s\/[A-Za-z0-9_-]{22}$/);
    assert.deepEqual(await page.evaluate(() => mqttClient.subscriptions), [topic]);
    // Nouvelle session : nouveau topic, les évènements de l'ancien client sont ignorés
    await page.evaluate(() => { window.__old = mqttClient; window.__oldSession = _session; newRemoteSession(); });
    await waitFor(page, () => mqttClient && mqttClient !== window.__old);
    await connectFakeClients(page);
    await waitFor(page, () => document.getElementById('linkPill').classList.contains('online'));
    const renewed = await page.evaluate(() => ({ topic: _sec.mqttTopic, same: JSON.stringify(_session) === JSON.stringify(window.__oldSession),
      stored: JSON.stringify(JSON.parse(localStorage.getItem('setremote-session-v1'))) === JSON.stringify(_session) }));
    assert.notEqual(renewed.topic, topic);
    assert.equal(renewed.same, false);
    assert.equal(renewed.stored, true);
    await page.evaluate(() => { window.__old.disconnecting = false; window.__old.emit('close'); window.__old.emit('reconnect'); });
    assert.equal((await status()).pill, 'link-pill online');
    // Fin volontaire (retour) : pas d'état « Reconnexion… » parasite
    await page.evaluate(() => goBack());
    assert.equal((await status()).pill, 'link-pill online');
    assert.deepEqual(errors, []);
    await close();
  });

  test('écran : reconnexion silencieuse, capacités renvoyées (avec cache, média actif et screenId)', async () => {
    const { page, errors, close } = await openPage(browser);
    await page.evaluate((p) => screenJoinSession(p), SRP.createPairing());
    await waitFor(page, () => !!mqttClient);
    await connectFakeClients(page);
    await waitFor(page, () => document.getElementById('screen-status').textContent.startsWith('✓'));
    const caps = () => publishedBy(page, 'caps');
    assert.equal((await caps()).length, 1);
    assert.deepEqual((await caps())[0].cached, []);
    assert.equal((await caps())[0].active, null);
    assert.equal((await caps())[0].screenId, await page.evaluate(() => localStorage.getItem('setremote-screen-id')));
    await page.evaluate(() => mqttClient._drop());
    assert.equal(await page.textContent('#screen-status'), 'Connexion…');
    await page.evaluate(() => { document.getElementById('screen-notice').style.display = 'none'; mqttClient._connect(); });
    await waitFor(page, () => document.getElementById('screen-status').textContent.startsWith('✓'));
    await sleep(50);
    assert.equal((await caps()).length, 2);
    assert.equal(await page.evaluate(() => document.getElementById('screen-notice').style.display), 'none', 'aucune notice visible à la reconnexion');
    assert.deepEqual(errors, []);
    await close();
  });
});

describe('resynchronisation télécommande → écran', () => {
  test("écran rechargé : état complet restauré ; reconnexions : aucun renvoi lourd", async () => {
    const broker = new FakeBroker();
    const remote = await openPage(browser, { broker, seed: 7 });
    const rp = remote.page;
    await rp.evaluate(() => startMode('remote'));
    await waitFor(rp, () => !!mqttClient);
    await connectFakeClients(rp);
    const hash = await pairingHash(rp);
    let screen = await openPage(browser, { broker, hash, seed: 8 });
    await waitFor(screen.page, () => !!mqttClient);
    await connectFakeClients(screen.page);
    await broker.flush();

    // État de la télécommande : couleur, OFF, luminosité, effet, strobe, médias
    await rp.evaluate(async () => {
      setKelvin(3200); setTint(20);
      toggleBlackout();
      const b = document.getElementById('screenBrightnessSlider'); b.value = 40; onScreenBrightnessChange();
      selectEffect('chaser');
      document.getElementById('strobeToggle').checked = true; onStrobeToggle();
      setAutoAdvance(true); setVideoEndMode('pause');
      const mk = (col) => new Promise((res) => { const c = document.createElement('canvas'); c.width = 64; c.height = 40; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 64, 40); c.toBlob((bl) => res(new File([bl], col.slice(1) + '.png', { type: 'image/png' })), 'image/png'); });
      onAddImages([await mk('#ff0000'), await mk('#00ff00')]);
      // Fond d'écran verrouillé (même chemin que onLockWall, sans sélecteur de fichier)
      const c = document.createElement('canvas'); c.width = 30; c.height = 60; c.getContext('2d').fillRect(0, 0, 30, 60);
      _lockWallData = c.toDataURL('image/jpeg', 0.7);
      await sendImageChunks(_lockWallData, { mediaId: '__lockwall', show: false });
    });
    // Le média actif (1er ajouté) est diffusé puis mis en cache par l'écran
    await waitFor(rp, () => _screenCached.has('m1') && _screenCached.has('m2') && _screenCached.has('__lockwall'), null, { timeout: 15000 });
    await sleep(300); await broker.flush();
    const expectState = async (sp) => {
      const r = await rp.evaluate(() => ({ color: currentColor, active: _activeMediaId, ids: _mediaPool.map((m) => m.id) }));
      return waitFor(sp, (r) => {
        const img = document.getElementById('screen-media-img');
        const ok = screenBaseColor === r.color && screenBlackoutOn === true
          && document.getElementById('screen-dim').style.opacity === '0.6'
          && _screenEffect === 'chaser' && _screenFxSuspended === true && !!screenStrobeTimer
          && _screenAutoAdvance === true && _screenVidEndMode === 'pause'
          && _mediaCache.has('__lockwall') && img.style.display === 'block' && _screenActiveId === r.active
          && JSON.stringify(_mediaOrder) === JSON.stringify(r.ids);
        return ok;
      }, r, { timeout: 15000 });
    };
    await expectState(screen.page);

    // 1) Rechargement de l'écran : nouvel écran vierge sur le même canal
    await screen.close();
    broker.pages.splice(broker.pages.indexOf(screen.page), 1);
    broker.clear();
    screen = await openPage(browser, { broker, hash, seed: 9 });
    assert.equal(await screen.page.evaluate(() => screenBlackoutOn), false, 'écran neuf');
    await waitFor(screen.page, () => !!mqttClient);
    await connectFakeClients(screen.page);
    await expectState(screen.page);
    await sleep(800); await broker.flush();
    const sentAfterReload = (await broker.sent(rp)).map((m) => m.type + (m.mediaId ? ':' + m.mediaId : ''));
    assert.ok(sentAfterReload.includes('media-img-start:__lockwall'), 'fond verrouillé renvoyé à l\'écran qui l\'a perdu');
    assert.ok(sentAfterReload.includes('media-img-start:m1'), 'média actif re-diffusé');
    assert.equal(sentAfterReload.filter((t) => t === 'blackout').length, 1, 'un seul instantané');

    // 2) Coupure réseau de la télécommande (écran intact) : instantané léger, aucun renvoi lourd
    await sleep(500); await broker.flush(); broker.clear();
    await rp.evaluate(() => mqttClient._drop());
    await rp.evaluate(() => mqttClient._connect());
    await waitFor(rp, () => document.getElementById('linkPill').classList.contains('online'));
    await sleep(700); await broker.flush();
    let types = (await broker.sent(rp)).map((m) => m.type);
    assert.ok(types.includes('hello') && types.includes('blackout') && types.includes('effect') && types.includes('strobe'), types.join(','));
    assert.ok(!types.includes('media-img-start') && !types.includes('media:show'), 'aucun média renvoyé : ' + types.join(','));
    await expectState(screen.page);

    // 3) Coupure réseau de l'écran : il renvoie ses capacités, rien de lourd en retour
    broker.clear();
    await screen.page.evaluate(() => { mqttClient._drop(); mqttClient._connect(); });
    await sleep(700); await broker.flush();
    assert.ok((await broker.sent(screen.page, 'caps')).length === 1);
    types = (await broker.sent(rp)).map((m) => m.type);
    assert.ok(types.includes('color') && !types.includes('media-img-start'), types.join(','));
    await expectState(screen.page);

    assert.deepEqual(remote.errors, []);
    assert.deepEqual(screen.errors, []);
    await screen.close(); await remote.close();
  });

  test('plusieurs « caps » rapprochés → un seul instantané ; écran sans liste de cache (ancien/natif) accepté', async () => {
    const { page, errors, close } = await openPage(browser);
    await page.evaluate(() => startMode('remote'));
    await waitFor(page, () => !!mqttClient);
    await connectFakeClients(page);
    await waitFor(page, () => mqttClient.connected);
    await sleep(100);
    await page.evaluate(() => { mqttClient.published.length = 0; });
    const pairing = await page.evaluate(() => _session);
    const [a, b, c] = await Promise.all([fakePeer(pairing, 'screen'), fakePeer(pairing, 'screen'), fakePeer(pairing, 'screen')]);
    await deliverFrame(page, await a.seal({ type: 'caps', torch: true, vibrate: true, videoMode: 'rtc', cached: [], active: null, screenId: a.screenId }));
    await deliverFrame(page, await b.seal({ type: 'caps', torch: false, vibrate: true, media: true, videoMode: 'b64' })); // écran natif
    await deliverFrame(page, await c.forge({ type: 'caps', torch: true, cached: 'x', active: '<bad>' }));               // hors schéma : rejeté
    assert.equal(await page.evaluate(() => secStats.lastError), 'invalid-message');
    await sleep(600);
    const sent = (await publishedBy(page)).map((m) => m.type);
    assert.equal(sent.filter((t) => t === 'color').length, 1, sent.join(','));
    assert.equal(sent.filter((t) => t === 'blackout').length, 0, 'OFF jamais imposé tant que l\'utilisateur n\'y a pas touché');
    assert.equal(await page.evaluate(() => document.getElementById('content-flash').classList.contains('torch-unavailable')), true);
    assert.deepEqual(errors, []);
    await close();
  });

  test('télécommande rechargée : ne rallume jamais un écran éteint, reprend son état OFF', async () => {
    const broker = new FakeBroker();
    const pairing = SRP.createPairing();
    const screen = await openPage(browser, { broker, hash: SRP.pairingUrl('x', pairing).split('#')[1], seed: 11 });
    await waitFor(screen.page, () => !!mqttClient);
    await connectFakeClients(screen.page);
    await screen.page.evaluate(() => setBlackout(true));
    // Télécommande rechargée : elle retrouve sa session persistée
    const remote = await openPage(browser, { broker, seed: 12 });
    const rp = remote.page;
    await rp.evaluate((p) => { localStorage.setItem('setremote-session-v1', JSON.stringify(p)); startMode('remote'); }, pairing);
    await waitFor(rp, () => !!mqttClient);
    await connectFakeClients(rp);
    await sleep(800); await broker.flush();
    assert.equal(await screen.page.evaluate(() => screenBlackoutOn), true, 'écran toujours éteint');
    assert.ok(!(await broker.sent(rp, 'blackout')).length, 'aucun ordre OFF/ON envoyé');
    assert.equal(await rp.evaluate(() => remoteBlackout), true, 'la télécommande affiche l\'état réel');
    assert.equal(await rp.evaluate(() => document.getElementById('stickyBlackoutBtn').textContent), 'Écran OFF');
    // L'utilisateur rallume : l'ordre passe, puis reste imposé aux resynchronisations
    await rp.evaluate(() => toggleBlackout());
    await sleep(300); await broker.flush();
    assert.equal(await screen.page.evaluate(() => screenBlackoutOn), false);
    broker.clear();
    await screen.page.evaluate(() => { setBlackout(true); mqttClient._drop(); mqttClient._connect(); });
    await sleep(800); await broker.flush();
    assert.equal((await broker.sent(rp, 'blackout')).length, 1);
    assert.equal(await screen.page.evaluate(() => screenBlackoutOn), false, 'choix de l\'utilisateur réappliqué');
    assert.deepEqual(remote.errors, []);
    assert.deepEqual(screen.errors, []);
    await screen.close(); await remote.close();
  });
});
