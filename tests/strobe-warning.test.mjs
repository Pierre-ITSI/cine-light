// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Avertissement stroboscope (maquette 11) : affiché sur la télécommande AVANT
// le strobe, les effets à flashs rapides, les mémoires qui les rallument et
// les clignotements rapides de la torche. « Annuler » n'envoie rien,
// « Activer » lance l'action, « Ne plus demander pour ce projet » vaut pour la
// session appairée (les projets n'existent pas encore). La passerelle DMX
// (console) n'est jamais bloquée. Curseurs du strobe alignés sur les plafonds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, publishedBy, FakeBroker, pairingHash, SRP } from './helpers/harness.mjs';
import { buildSacnDataPacket, STROBE_DUR_MIN, STROBE_FREQ_MAX } from '../packages/dmx/index.js';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const shown = (page) => page.evaluate(() => getComputedStyle(document.getElementById('strobe-warn')).display === 'block');
const toggle = (page) => page.locator('label.toggle-switch:has(#strobeToggle)').click();
const strobeState = (page) => page.evaluate(() => ({
  active: strobeActive, checked: document.getElementById('strobeToggle').checked,
  badge: document.getElementById('strobeActiveBadge').style.display,
}));

// Télécommande reliée au faux broker (toutes ses trames sont publiées)
async function remote() {
  const p = await openPage(browser, { autoConnect: true });
  await p.page.evaluate(() => startMode('remote'));
  await connected(p.page);
  await sleep(50);
  await p.page.evaluate(() => { mqttClient.published.length = 0; });
  return p;
}

test('strobe : avertissement avant l\'activation, textes de la maquette ; « Annuler » n\'envoie rien', async () => {
  const { page, errors, close } = await remote();
  await toggle(page);
  assert.equal(await shown(page), true);
  // Maquette 11 : l'interrupteur reste ouvert derrière la boîte, rien n'est encore parti
  assert.deepEqual(await strobeState(page), { active: false, checked: true, badge: 'none' });
  const ui = await page.evaluate(() => {
    const d = document.querySelector('#strobe-warn [role=alertdialog]');
    const t = (s) => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim();
    return {
      modal: d.getAttribute('aria-modal'), label: document.getElementById(d.getAttribute('aria-labelledby')).textContent,
      title: t('#swTitle'), text: t('#swDesc'), limits: t('#swLimits'),
      skip: t('.sw-skip'), skipChecked: document.getElementById('swSkip').checked,
      buttons: [...d.querySelectorAll('.sw-actions button')].map((b) => [b.textContent, getComputedStyle(b).textTransform]),
      caps: [PROTO.STROBE_FREQ_MAX, PROTO.STROBE_DUR_MIN],
    };
  });
  assert.deepEqual(ui, {
    modal: 'true', label: 'Lumière stroboscopique', title: 'Lumière stroboscopique',
    text: 'Les flashs rapides peuvent déclencher des crises chez les personnes photosensibles. Prévenez l\'équipe et les comédiens avant de lancer l\'effet.',
    limits: 'Fréquence limitée à 30 Hz · flash de 15 ms minimum.',
    skip: 'Ne plus demander pour ce projet', skipChecked: false,
    buttons: [['Annuler', 'none'], ['Activer', 'none']],
    caps: [30, 15],
  });
  // Les chiffres annoncés sont les plafonds réels (protocole, schéma, passerelle DMX)
  assert.equal(SRP.LIMITS.strobeFreqHz[1], 30);
  assert.equal(SRP.LIMITS.strobeFlashMs[0], 15);
  assert.deepEqual([STROBE_FREQ_MAX, STROBE_DUR_MIN], [30, 15]);
  await page.click('#swCancel');
  assert.equal(await shown(page), false);
  assert.deepEqual(await strobeState(page), { active: false, checked: false, badge: 'none' });
  await sleep(150);
  assert.deepEqual(await publishedBy(page, 'strobe'), [], 'aucune commande de strobe');
  assert.deepEqual(errors, []);
  await close();
});

test('strobe : « Activer » le lance ; l\'avertissement revient à chaque activation', async () => {
  const { page, errors, close } = await remote();
  await toggle(page);
  await page.click('#swOk');
  assert.equal(await shown(page), false);
  assert.deepEqual(await strobeState(page), { active: true, checked: true, badge: 'block' });
  await sleep(150);
  const sent = await publishedBy(page, 'strobe');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].active, true);
  assert.ok(sent[0].dur >= 15 && sent[0].freq <= 30);
  // Arrêt : jamais d'avertissement
  await toggle(page);
  assert.equal(await shown(page), false);
  assert.deepEqual(await strobeState(page), { active: false, checked: false, badge: 'none' });
  // Nouvelle activation : redemandé (« Ne plus demander » non coché)
  await toggle(page);
  assert.equal(await shown(page), true);
  await page.click('#swCancel');
  assert.equal(await page.evaluate(() => localStorage.getItem('setremote-strobe-warning-v1')), null);
  assert.deepEqual(errors, []);
  await close();
});

test('« Ne plus demander pour ce projet » : vaut pour la session appairée, jusqu\'à la nouvelle session', async () => {
  const { page, errors, close } = await remote();
  // Coché puis « Annuler » : rien n'est retenu
  await toggle(page);
  await page.check('#swSkip');
  await page.click('#swCancel');
  assert.equal(await page.evaluate(() => flashWarningSkipped()), false);
  // Coché puis « Activer »
  await toggle(page);
  await page.check('#swSkip');
  await page.click('#swOk');
  assert.equal((await strobeState(page)).active, true);
  const st = await page.evaluate(() => ({ stored: JSON.parse(localStorage.getItem('setremote-strobe-warning-v1')), id: _session.channelId }));
  assert.deepEqual(st.stored, { skip: st.id }, 'retenu pour la session appairée');
  await toggle(page); // arrêt
  await toggle(page); // relance sans avertissement
  assert.equal(await shown(page), false);
  assert.equal((await strobeState(page)).active, true);
  await toggle(page);
  // Télécommande relancée, même session : toujours sans avertissement
  await page.evaluate(() => { goBack(); startMode('remote'); });
  await toggle(page);
  assert.equal(await shown(page), false);
  await toggle(page);
  // Nouvelle session (= « Oublier tous les écrans ») : l'avertissement revient
  await page.evaluate(() => newRemoteSession());
  await toggle(page);
  assert.equal(await shown(page), true, 'nouvelle session : redemandé');
  await page.click('#swCancel');
  assert.deepEqual(errors, []);
  await close();
});

test('effets à flashs rapides et mémoires : avertis ; « Annuler » ne lance rien', async () => {
  const { page, errors, close } = await remote();
  // Décision documentée (46-strobe-warning.js) : flashs d'ensemble > 3/s dès les réglages par défaut
  assert.deepEqual(await page.evaluate(() => [...FLASH_RISK.effect]), ['police', 'lightning', 'paparazzi', 'weld', 'neon']);
  await page.evaluate(() => switchTab('effects'));
  await page.click('#efxcard-lightning');
  assert.equal(await shown(page), true);
  await page.click('#swCancel');
  assert.deepEqual(await page.evaluate(() => [activeScreenEffect, document.querySelectorAll('.effect-card.active').length]), [null, 0]);
  await sleep(150);
  assert.deepEqual(await publishedBy(page, 'effect'), [], 'Annuler : aucun effet envoyé');
  // Effet sans flash rapide : aucun avertissement
  await page.click('#efxcard-candle');
  assert.equal(await shown(page), false);
  assert.equal(await page.evaluate(() => activeScreenEffect), 'candle');
  // Passage à Paparazzi : averti, puis lancé avec « Activer »
  await page.click('#efxcard-paparazzi');
  assert.equal(await shown(page), true);
  assert.equal(await page.evaluate(() => activeScreenEffect), 'candle', 'rien ne change avant la réponse');
  await page.click('#swOk');
  assert.equal(await page.evaluate(() => activeScreenEffect), 'paparazzi');
  await sleep(150);
  assert.equal((await publishedBy(page, 'effect')).at(-1).name, 'paparazzi');
  // Mémoire d'effet Paparazzi (8 flashs par rafale) rappelée plus tard : avertie
  const memId = await page.evaluate(() => {
    const s = document.getElementById('effectBurstSlider'); s.value = 8; onEffectParamChange();
    saveFxMemory(); const id = selectedFxMemId; stopAllEffects(); return id;
  });
  await page.evaluate((id) => applyFxMemory(id), memId);
  assert.equal(await shown(page), true);
  await page.click('#swCancel');
  assert.equal(await page.evaluate(() => activeScreenEffect), null);
  await page.evaluate((id) => applyFxMemory(id), memId);
  await page.click('#swOk');
  assert.deepEqual(await page.evaluate(() => [activeScreenEffect, buildEffectParams().count]), ['paparazzi', 8]);
  // Arrêt (re-sélection) : jamais d'avertissement
  await page.click('#efxcard-paparazzi');
  assert.equal(await shown(page), false);
  assert.equal(await page.evaluate(() => activeScreenEffect), null);
  // Mémoire de couleur qui rallume le strobe : avertie
  await page.evaluate(() => switchTab('color'));
  await toggle(page); await page.click('#swOk');
  await page.evaluate(() => { saveColorMemory(); stopStrobe(); });
  const colorMem = await page.evaluate(() => selectedMemoryId);
  await page.evaluate((id) => applyColorMemory(id), colorMem);
  assert.equal(await shown(page), true);
  await page.click('#swCancel');
  assert.equal((await strobeState(page)).active, false);
  await page.evaluate((id) => applyColorMemory(id), colorMem);
  await page.click('#swOk');
  assert.equal((await strobeState(page)).active, true);
  assert.deepEqual(errors, []);
  await close();
});

test('torche : « Clignotement rapide » et « Police » avertis ; SOS, lent et battement non', async () => {
  const { page, errors, close } = await remote();
  assert.deepEqual(await page.evaluate(() => [...FLASH_RISK.torch]), ['blink-fast', 'police']);
  await page.evaluate(() => switchTab('flash'));
  await page.click('#efx-blink-fast');
  assert.equal(await shown(page), true);
  await page.click('#swCancel');
  assert.equal(await page.evaluate(() => activeEffect), null);
  for (const fx of ['sos', 'blink-slow', 'heartbeat']) {
    await page.click('#efx-' + fx);
    assert.equal(await shown(page), false, fx);
  }
  await page.click('#efx-police');
  await page.click('#swOk');
  assert.equal(await page.evaluate(() => activeEffect), 'police');
  await sleep(150);
  assert.deepEqual((await publishedBy(page, 'torch-effect')).map((m) => m.effect), ['sos', 'blink-slow', 'heartbeat', 'police']);
  assert.deepEqual(errors, []);
  await close();
});

test('curseurs du strobe alignés sur les plafonds ; une ancienne mémoire à 5 ms revient à 15 ms', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => startMode('remote'));
  const r = await page.evaluate(() => {
    const g = (id) => { const s = document.getElementById(id); return [+s.min, +s.max]; };
    return { freq: g('freqSlider'), freqMax: g('freqMaxSlider'), dur: g('flashDurSlider'), durMax: g('flashDurMaxSlider'), proto: [PROTO.STROBE_FREQ_MIN, PROTO.STROBE_FREQ_MAX, PROTO.STROBE_DUR_MIN, PROTO.STROBE_DUR_MAX] };
  });
  assert.deepEqual(r.proto, [0.1, 30, 15, 2000]);
  for (const k of ['freq', 'freqMax']) assert.ok(r[k][0] >= r.proto[0] && r[k][1] === r.proto[1], k + ' ' + r[k]);
  for (const k of ['dur', 'durMax']) assert.ok(r[k][0] === r.proto[2] && r[k][1] <= r.proto[3], k + ' ' + r[k]);
  const st = await page.evaluate(() => {
    colorMemories = [{ id: 'old', name: 'Ancienne', spec: currentColorSpec(), strobe: { active: false, random: true, freq: 2, dur: 5, freqMax: 8, durMax: 5, torch: false } }];
    applyColorMemory('old');
    return { vars: [strobeFlashDur, strobeFlashDurMax], sliders: [document.getElementById('flashDurSlider').value, document.getElementById('flashDurMaxSlider').value], label: document.getElementById('flashDurVal').textContent, mode: strobeMode };
  });
  assert.deepEqual(st, { vars: [15, 15], sliders: ['15', '15'], label: '15 ms', mode: 'random' });
  assert.deepEqual(errors, []);
  await close();
});

// ── Passerelle DMX : le pupitreur est responsable, aucun avertissement ──
const NATIVE = { fn: () => { window.SETREMOTE_NATIVE = { platform: 'android', bridge: 1 }; window.ReactNativeWebView = { postMessage: () => {} }; } };
const CID = '5f1e7a52-3c4b-4d8e-9a10-2b3c4d5e6f70';

test('passerelle DMX : la console lance strobe et Police sans avertissement ; la télécommande reste avertie', async () => {
  const broker = new FakeBroker();
  const remoteP = await openPage(browser, { broker, seed: 3, autoConnect: true, init: NATIVE });
  const rp = remoteP.page;
  await rp.evaluate(() => startMode('remote'));
  await connected(rp);
  const screen = await openPage(browser, { broker, seed: 31, autoConnect: true, hash: await pairingHash(rp) });
  await connected(screen.page);
  const id = await screen.page.evaluate(() => screenId());
  await waitFor(rp, () => _screenOfSender.size === 1);
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(150);
  await broker.flush();
  await rp.evaluate((id) => { openDmxGateway(); gwPatchSet(id, { universe: 1, address: 1, personality: 'extended16' }); }, id);
  let seq = 0;
  const sacn = (o) => {
    const s = [255, 255, 255, 0, 0, 54, 128, 0, 0, 0, 128, 0, 0, 0, 0, 0];
    for (const [k, v] of Object.entries(o)) s[k - 1] = v;
    const data = Buffer.from(buildSacnDataPacket({ cid: CID, universe: 1, data: s, sequence: ++seq & 0xff, sourceName: 'Console' })).toString('base64');
    return rp.evaluate((d) => window.SRNative.receive({ type: 'dmx:packets', packets: [{ src: '10.0.0.10', port: 5568, data: d }] }), data);
  };
  // Effet Police (90) puis strobe plein (255) depuis la console
  await sacn({ 10: 90 });
  await waitFor(screen.page, () => _screenEffect === 'police');
  await sacn({ 10: 90, 9: 255 });
  await waitFor(screen.page, () => !!screenStrobeTimer);
  assert.equal(await shown(rp), false, 'aucun avertissement sur le chemin console');
  assert.equal(await rp.evaluate(() => flashWarningSkipped()), false, 'avertissement toujours armé pour la télécommande');
  // La télécommande, elle, avertit toujours
  await rp.evaluate(() => closeDmxGateway());
  await toggle(rp);
  assert.equal(await shown(rp), true);
  await rp.click('#swCancel');
  assert.deepEqual(remoteP.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remoteP.close();
});
