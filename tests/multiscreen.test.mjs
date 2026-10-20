// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Plusieurs écrans (maquettes 5 et 6) : une télécommande et trois vrais écrans
// de jeu sur la même session chiffrée (FakeBroker). Couvre : noms et groupes
// (vue « Écrans connectés »), cible Tous / groupe / écran, écrans qui ignorent
// les ordres adressés à d'autres, resynchronisation d'un seul écran rechargé
// (les autres ne sont pas dérangés), vidéo vers les seuls écrans visés (une
// connexion pair-à-pair par écran, repli base64 par écran), « Identifier »,
// persistance, passerelle DMX (looks adressés) avec une cible active.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, SRP, pairingHash, fakePeer, deliverFrame } from './helpers/harness.mjs';
import { buildSacnDataPacket } from '../packages/dmx/index.js';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const settle = async (r) => {
  await waitFor(r.rp, () => _resyncTimer === null);
  await sleep(250);
  await r.broker.flush();
};

// Télécommande + n écrans appairés par le lien (QR)
async function rig(n, seed, init = null) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true, init });
  const rp = remote.page;
  await rp.evaluate(() => startMode('remote'));
  await connected(rp);
  const hash = await pairingHash(rp);
  const screens = [];
  for (let i = 0; i < n; i++) {
    const s = await openPage(browser, { broker, seed: seed * 10 + i, autoConnect: true, hash });
    await connected(s.page);
    s.id = await s.page.evaluate(() => screenId());
    screens.push(s);
  }
  await waitFor(rp, (k) => _screenOfSender.size === k && scrList().length === k, n);
  const r = { broker, remote, rp, screens, hash };
  await settle(r);
  r.close = async () => { for (const s of screens) await s.close(); await remote.close(); };
  return r;
}
const base = (s) => s.page.evaluate(() => screenBaseColor);
const noErrors = (r) => { for (const p of [r.remote, ...r.screens]) assert.deepEqual(p.errors, []); };
// Messages de la télécommande depuis le dernier broker.clear()
const sentBy = (r, type) => r.broker.sent(r.rp, type);
const pngFile = (page, color, name) => page.evaluate(([color, name]) => new Promise((res) => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 40;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 64, 40);
  c.toBlob((b) => { window.__files = window.__files || {}; window.__files[name] = new File([b], name, { type: 'image/png' }); res(true); }, 'image/png');
}), [color, name]);
// Espion : nombre d'appels de fonctions globales de l'écran (aiguillage des messages)
const spy = (page, names) => page.evaluate((names) => {
  window.__n = {};
  for (const n of names) {
    const orig = window[n];
    window.__n[n] = 0;
    window[n] = function (...a) { window.__n[n]++; return orig.apply(this, a); };
  }
}, names);
const spied = (page) => page.evaluate(() => ({ ...window.__n }));

describe('trois écrans : noms, groupes, cible', () => {
  let r, A, B, C, salon, cuisine;
  before(async () => {
    r = await rig(3, 7);
    [A, B, C] = r.screens;
  });
  after(async () => { noErrors(r); await r?.close(); });

  test('« Écrans connectés » : renommer (l\'écran apprend son nom), créer des groupes', async () => {
    const { rp } = r;
    // Vue plein écran « Écrans connectés » (plus de bouton « Gérer » : l'onglet Écrans montre lui-même les écrans)
    await rp.evaluate(() => switchTab('qr'));
    await rp.evaluate(() => openScreensView());
    await waitFor(rp, () => document.querySelectorAll('#svList .sv-card').length === 3);
    assert.deepEqual(await rp.$$eval('#svList .sv-name', (els) => els.map((e) => e.textContent)), ['Écran 1', 'Écran 2', 'Écran 3']);
    assert.deepEqual(await rp.$$eval('#svList .sv-link', (els) => els.map((e) => e.textContent)), ['Internet', 'Internet', 'Internet']);
    // Renommer A depuis sa carte (crayon)
    r.broker.clear();
    await rp.click(`.sv-card[data-id="${A.id}"] .sv-icon`);
    await rp.fill('#srName', '  Téléphone de\u0007 Julie ');
    await rp.click('#srSheetBody .sr-ok');
    await waitFor(A.page, () => _screenCfg.name === 'Téléphone de Julie');
    await rp.evaluate(([b, c]) => { scrRenameScreen(b, 'TV salon'); scrRenameScreen(c, 'Tablette cuisine'); }, [B.id, C.id]);
    await waitFor(C.page, () => _screenCfg.name === 'Tablette cuisine');
    await r.broker.flush();
    const cfgs = await sentBy(r, 'screen:config');
    assert.deepEqual(cfgs.map((m) => [m.target.screens, m.name]), [[[A.id], 'Téléphone de Julie'], [[B.id], 'TV salon'], [[C.id], 'Tablette cuisine']],
      'chaque écran ne reçoit que son nom');
    // L'écran affiche son nom dans son menu, l'annonce dans caps
    assert.equal(await A.page.evaluate(() => document.getElementById('screenMenuInfo').textContent), '« Téléphone de Julie » · liaison chiffrée de bout en bout');
    await waitFor(rp, () => [...document.querySelectorAll('#svList .sv-name')].map((e) => e.textContent).join('|') === 'Téléphone de Julie|TV salon|Tablette cuisine');
    // Nouveau groupe « Salon » (A et B) depuis « + Nouveau groupe »
    await rp.click('#svGroups .sv-chip.add');
    await rp.fill('#srName', 'Salon');
    await rp.locator('#srSheetBody .sr-row').nth(0).click();
    await rp.locator('#srSheetBody .sr-row').nth(1).click();
    await rp.click('#srSheetBody .sr-ok');
    salon = await rp.evaluate(() => _scrReg.groups[0].id);
    assert.match(salon, /^g[a-z0-9]{6}$/);
    // « Cuisine » depuis la pastille de groupe de C
    await rp.click(`.sv-card[data-id="${C.id}"] .sv-group`);
    assert.equal(await rp.textContent('#srSheetTitle'), 'Groupes de « Tablette cuisine »');
    await rp.click('#srSheetBody .sr-add');
    await rp.fill('#srName', 'Cuisine');
    assert.equal(await rp.locator('#srSheetBody .sr-row input').nth(2).isChecked(), true, 'C déjà cochée');
    await rp.click('#srSheetBody .sr-ok');
    cuisine = await rp.evaluate(() => _scrReg.groups[1].id);
    await waitFor(rp, () => document.querySelectorAll('#svGroups .sv-chip').length === 3);
    assert.deepEqual(await rp.$$eval('#svGroups .sv-chip', (els) => els.map((e) => e.textContent)), ['Salon · 2', 'Cuisine · 1', '+ Nouveau groupe']);
    assert.deepEqual(await rp.$$eval('#svList .sv-group', (els) => els.map((e) => e.textContent)), ['Salon', 'Salon', 'Cuisine']);
    // Chaque écran connaît ses groupes (canal chiffré : adressage { group })
    for (const [s, g] of [[A, [salon]], [B, [salon]], [C, [cuisine]]]) {
      await waitFor(s.page, (g) => JSON.stringify(_sec.groups) === JSON.stringify(g), g);
    }
    // Renommer le groupe ; un groupe supprimé disparaît des écrans
    await rp.click('#svGroups .sv-chip >> nth=1');
    await rp.fill('#srName', 'Cuisine & entrée');
    await rp.click('#srSheetBody .sr-ok');
    await waitFor(rp, () => document.querySelector('#svGroups .sv-chip:nth-child(2)').textContent === 'Cuisine & entrée · 1');
    const tmp = await rp.evaluate((ids) => scrCreateGroup('Temp', ids), [A.id, C.id]);
    await waitFor(A.page, (g) => _sec.groups.includes(g), tmp);
    await waitFor(rp, () => document.querySelectorAll('#svGroups .sv-chip').length === 4);
    rp.once('dialog', (d) => d.accept());
    await rp.click('#svGroups .sv-chip >> nth=2');
    await rp.click('#srSheetBody .sr-del');
    await waitFor(A.page, (g) => !_sec.groups.includes(g), tmp);
    assert.deepEqual(await rp.evaluate(() => _scrReg.groups.map((g) => g.name)), ['Salon', 'Cuisine & entrée']);
    await rp.click('#screens-view .sv-back');
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('screens-view')).display), 'none');
  });

  test('cible : un groupe, un écran, tous — seuls les écrans visés changent ; l\'aperçu suit la cible', async () => {
    const { rp } = r;
    await settle(r);
    // Puce « Cible » toujours visible, dans l'en-tête
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('targetBtn')).display), 'flex');
    assert.equal(await rp.textContent('#targetBtnLabel'), 'Cible : Tous · 3');
    const c0 = await base(C);
    // Feuille « Envoyer les commandes à… » : Tous, groupes, écrans
    await rp.click('#targetBtn');
    assert.equal(await rp.textContent('#srSheetTitle'), 'Envoyer les commandes à…');
    assert.deepEqual(await rp.$$eval('#srSheetBody .sr-row', (els) => els.map((e) => [e.querySelector('.sr-row-label').textContent, e.querySelector('.sr-row-meta').textContent])), [
      ['Tous les écrans', '3'], ['Groupe Salon', '2'], ['Groupe Cuisine & entrée', '1'],
      ['Téléphone de Julie', 'écran'], ['TV salon', 'écran'], ['Tablette cuisine', 'écran'],
    ]);
    await rp.locator('#srSheetBody .sr-row').nth(1).click();
    assert.equal(await rp.evaluate(() => document.getElementById('sr-sheet').classList.contains('open')), false);
    assert.equal(await rp.textContent('#targetBtnLabel'), 'Cible : Salon · 2');
    assert.equal(await rp.evaluate(() => document.getElementById('targetBtn').classList.contains('subset')), true);
    // Groupe Salon : A et B seulement
    r.broker.clear();
    await rp.evaluate(() => setKelvin(2700));
    const warm = await rp.evaluate(() => currentColor);
    await waitFor(A.page, (c) => screenBaseColor === c, warm);
    await waitFor(B.page, (c) => screenBaseColor === c, warm);
    // Effet à flashs rapides : l'avertissement photosensibilité passe d'abord
    await rp.evaluate(() => selectEffect('police'));
    await waitFor(rp, () => getComputedStyle(document.getElementById('strobe-warn')).display === 'block');
    await rp.click('#swOk');
    await waitFor(B.page, () => _screenEffect === 'police');
    await sleep(200); await r.broker.flush();
    assert.equal(await base(C), c0, 'C non concerné');
    assert.equal(await C.page.evaluate(() => _screenEffect), null);
    for (const m of await sentBy(r, null)) {
      assert.deepEqual(m.target, { screens: [A.id, B.id] }, m.type + ' adressé au groupe (résolu en écrans)');
    }
    // Un écran : C seul
    await rp.evaluate((c) => scrSetTarget({ k: 'screen', id: c }), C.id);
    assert.equal(await rp.textContent('#targetBtnLabel'), 'Cible : Tablette cuisine');
    // L'aperçu montre l'état de C (pas d'effet, sa couleur), sans rien envoyer
    assert.deepEqual(await rp.evaluate(() => [activeScreenEffect, currentColor]), [null, c0]);
    r.broker.clear();
    await rp.evaluate(() => setKelvin(9000));
    const cold = await rp.evaluate(() => currentColor);
    await waitFor(C.page, (c) => screenBaseColor === c, cold);
    await sleep(150);
    assert.deepEqual([await base(A), await base(B)], [warm, warm]);
    // Retour au groupe : l'aperçu et les curseurs reprennent l'état du groupe
    await rp.evaluate((g) => scrSetTarget({ k: 'group', id: g }), salon);
    assert.deepEqual(await rp.evaluate(() => [currentColor, kelvinK, document.getElementById('kelvinSlider').value, activeScreenEffect,
      document.getElementById('previewHex').textContent]), [warm, 2700, '2700', 'police', warm.toUpperCase()]);
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('strobe-warn')).display), 'none',
      'montrer l\'effet en cours sur la cible n\'est pas une activation : pas d\'avertissement');
    await sleep(200); await r.broker.flush();
    assert.deepEqual((await sentBy(r, null)).map((m) => m.type), ['color'], 'changer de cible n\'envoie rien');
    // « Écrans connectés » : ce que montre chaque écran
    await rp.evaluate(() => openScreensView());
    assert.deepEqual(await rp.$$eval('#svList .sv-now', (els) => els.map((e) => e.textContent)),
      ['Effet Police · intensité 100 %', 'Effet Police · intensité 100 %', '9000 K · 100 %']);
    assert.deepEqual(await rp.$$eval('#svGroups .sv-chip.on', (els) => els.map((e) => e.textContent)), ['Salon · 2'], 'groupe visé en évidence');
    await rp.evaluate(() => closeScreensView());
    // Tous : sans adresse, les trois écrans
    await rp.evaluate(() => { stopAllEffects(); scrSetTarget({ k: 'all' }); });
    r.broker.clear();
    await rp.evaluate(() => toggleBlackout());
    for (const s of r.screens) await waitFor(s.page, () => screenBlackoutOn === true);
    await rp.evaluate(() => toggleBlackout());
    for (const s of r.screens) await waitFor(s.page, () => screenBlackoutOn === false);
    await r.broker.flush();
    assert.ok((await sentBy(r, 'blackout')).every((m) => m.target === undefined), 'Tous : comportement historique, sans target');
    assert.equal(await rp.textContent('#targetBtnLabel'), 'Cible : Tous · 3');
  });

  test('chaque écran ignore les ordres adressés à d\'autres (écran ou groupe)', async () => {
    const pairing = await r.rp.evaluate(() => _session);
    const peer = await fakePeer(pairing, 'remote');
    const toB = await peer.seal({ type: 'color', color: '#123456', target: { screens: [B.id] } });
    const toSalon = await peer.seal({ type: 'color', color: '#654321', target: { group: salon } });
    const before = await Promise.all(r.screens.map(base));
    const recv0 = await A.page.evaluate(() => secStats.received);
    for (const s of [A, C]) await deliverFrame(s.page, toB);
    await deliverFrame(B.page, toB);
    assert.deepEqual(await Promise.all(r.screens.map(base)), [before[0], '#123456', before[2]]);
    assert.equal(await A.page.evaluate(() => secStats.received), recv0, 'ignoré avant tout traitement');
    // Groupe : appris par screen:config
    await deliverFrame(C.page, toSalon);
    await deliverFrame(A.page, toSalon);
    assert.deepEqual([await base(A), await base(C)], ['#654321', before[2]]);
  });

  test('« Identifier » : seul l\'écran choisi clignote', async () => {
    const { rp } = r;
    await rp.evaluate(() => openScreensView());
    r.broker.clear();
    await rp.click(`.sv-card[data-id="${B.id}"] .sv-btn`);
    await waitFor(B.page, () => document.getElementById('screen-identify').classList.contains('on'));
    await sleep(200); await r.broker.flush();
    for (const s of [A, C]) assert.equal(await s.page.evaluate(() => document.getElementById('screen-identify').classList.contains('on')), false);
    assert.deepEqual((await sentBy(r, 'screen:identify')).map((m) => m.target), [{ screens: [B.id] }]);
    await rp.evaluate(() => closeScreensView());
  });
});

test('un écran rechargé ne reçoit que SON état et ce qui lui manque ; les autres ne sont pas dérangés', async () => {
  const r = await rig(3, 8);
  const [A, B, C] = r.screens;
  const { rp } = r;
  await pngFile(rp, '#00aa00', 'vert.png');
  await rp.evaluate(() => onAddImages([window.__files['vert.png']])); // diffusée à tous (cible Tous)
  for (const s of r.screens) await waitFor(s.page, () => _mediaCache.has('m1') && screenMediaVisible());
  // A : couleur, noir et fond verrouillé à lui seul ; B : une vidéo à lui seul
  await rp.evaluate((a) => { scrSetTarget({ k: 'screen', id: a }); setKelvin(3200); }, A.id);
  const warm = await rp.evaluate(() => currentColor);
  await rp.evaluate(() => stopMediaBroadcast());
  await waitFor(A.page, () => !screenMediaVisible());
  await rp.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 30; c.height = 60; c.getContext('2d').fillRect(0, 0, 30, 60);
    _lockWallData = c.toDataURL('image/jpeg', 0.7);
    return ensureLockWall();
  });
  await waitFor(A.page, () => _mediaCache.has('__lockwall'));
  await rp.evaluate((b) => {
    scrSetTarget({ k: 'screen', id: b });
    onAddVideos([new File([new Uint8Array(90000).map((_, i) => (i * 3) & 255)], 'plan.mp4', { type: 'video/mp4' })]);
    selectMedia('m2');
  }, B.id);
  await waitFor(B.page, () => _mediaCache.has('m2') && _screenActiveId === 'm2', null, { timeout: 20000 });
  await settle(r);
  assert.equal(await A.page.evaluate(() => _mediaCache.has('__lockwall')), true);
  assert.equal(await C.page.evaluate(() => _mediaCache.has('__lockwall')), false, 'fond verrouillé envoyé à A seul');
  // Rechargement de A (même screenId) : il a tout perdu
  await Promise.all([B, C].map((s) => spy(s.page, ['receiveColor', 'screenShowCached', 'screenHandleOffer', 'mediaImgStart', 'setBlackout', 'screenSetEndMode'])));
  r.broker.clear();
  await A.page.reload();
  await A.page.evaluate(() => startMode('screen'));
  await connected(A.page);
  assert.equal(await A.page.evaluate(() => screenId()), A.id, 'même écran');
  await waitFor(A.page, (c) => screenBaseColor === c && _mediaCache.has('__lockwall') && _mediaCache.has('m1'), warm, { timeout: 15000 });
  await settle(r);
  await sleep(500); await r.broker.flush();
  // Tout ce que la télécommande a envoyé depuis : adressé à A seul
  const sent = await sentBy(r, null);
  assert.ok(sent.length > 5, sent.map((m) => m.type).join(','));
  for (const m of sent) assert.deepEqual(m.target, { screens: [A.id] }, m.type + ' adressé à A');
  const types = sent.map((m) => m.type + (m.mediaId ? ':' + m.mediaId : ''));
  assert.ok(types.includes('media-img-start:__lockwall') && types.includes('media-img-start:m1'), 'ce qui lui manque : ' + types.join(','));
  assert.ok(!types.includes('rtc-offer') && !types.includes('media:show'), 'aucun média à afficher (A n\'en montrait pas)');
  assert.equal(types.filter((t) => t === 'color').length, 1, 'un seul instantané');
  assert.equal(await A.page.evaluate(() => screenMediaVisible()), false, 'A ne montrait rien : rien ne s\'affiche');
  // B (vidéo en lecture) et C : aucun message traité
  for (const s of [B, C]) assert.deepEqual(Object.values(await spied(s.page)).reduce((a, b) => a + b, 0), 0, 'écran non dérangé');
  assert.equal(await B.page.evaluate(() => _screenActiveId), 'm2', 'la vidéo de B continue');
  noErrors(r);
  await r.close();
});

test('vidéo : vers les seuls écrans visés, une connexion par écran ; repli base64 par écran', async () => {
  const r = await rig(3, 9);
  const [A, B, C] = r.screens;
  const { rp } = r;
  const salon = await rp.evaluate(([a, b]) => scrCreateGroup('Salon', [a, b]), [A.id, B.id]);
  await rp.evaluate(() => {
    const vid = (n, k) => new File([new Uint8Array(n).map((_, i) => (i * k) & 255)], 'plan' + k + '.mp4', { type: 'video/mp4' });
    onAddVideos([vid(120000, 7), vid(60000, 5)]);
  });
  await waitFor(rp, () => _vidJobs.size === 3); // 1re vidéo (pool vide) : diffusée à tous
  for (const s of r.screens) await waitFor(s.page, () => _mediaCache.has('m1'), null, { timeout: 20000 });
  await settle(r);
  // Un écran (C) : offre adressée à C seul
  r.broker.clear();
  await rp.evaluate((c) => { scrSetTarget({ k: 'screen', id: c }); selectMedia('m2'); }, C.id);
  await waitFor(C.page, () => _mediaCache.has('m2') && _mediaCache.get('m2').kind === 'vid', null, { timeout: 20000 });
  await settle(r);
  let offers = await sentBy(r, 'rtc-offer');
  assert.deepEqual(offers.map((m) => m.target), [{ screens: [C.id] }]);
  assert.ok((await sentBy(r, 'rtc-ice')).every((m) => JSON.stringify(m.target) === JSON.stringify({ screens: [C.id] })));
  for (const s of [A, B]) assert.equal(await s.page.evaluate(() => _mediaCache.has('m2')), false);
  // Groupe (A, B) : deux connexions, chacune adressée à son écran ; C non dérangé
  r.broker.clear();
  await spy(C.page, ['screenHandleOffer', 'screenShowCached']);
  await rp.evaluate((g) => { scrSetTarget({ k: 'group', id: g }); selectMedia('m2'); }, salon);
  for (const s of [A, B]) await waitFor(s.page, () => _mediaCache.has('m2'), null, { timeout: 20000 });
  await settle(r);
  offers = await sentBy(r, 'rtc-offer');
  assert.deepEqual(offers.map((m) => m.target.screens).sort(), [[A.id], [B.id]].sort());
  assert.deepEqual((await r.broker.sent(A.page, 'rtc-answer')).length, 1);
  assert.deepEqual((await r.broker.sent(B.page, 'rtc-answer')).length, 1);
  assert.deepEqual(await spied(C.page), { screenHandleOffer: 0, screenShowCached: 0 });
  assert.deepEqual(await rp.evaluate(() => [_rtcTransferDone, _rtcBroken]), [true, false]);
  // Tous : la vidéo est déjà sur les trois écrans → media:show, aucun transfert
  r.broker.clear();
  await rp.evaluate(() => { scrSetTarget({ k: 'all' }); selectMedia('m1'); selectMedia('m2'); });
  await settle(r);
  assert.deepEqual(await sentBy(r, 'rtc-offer'), []);
  assert.deepEqual((await sentBy(r, 'media:show')).at(-1).target.screens.sort(), [A.id, B.id, C.id].sort());
  // Pair-à-pair bloqué vers B : B reçoit le fichier en base64, à lui seul, avec ses accusés
  r.broker.clear();
  await rp.evaluate((b) => {
    scrState(b).rtcBroken = true;
    scrSetTarget({ k: 'screen', id: b });
    onAddVideos([new File([new Uint8Array(50000).map((_, i) => (i * 11) & 255)], 'secours.mp4', { type: 'video/mp4' })]);
    selectMedia('m3');
  }, B.id);
  await waitFor(B.page, () => _mediaCache.has('m3') && _mediaCache.get('m3').kind === 'vid', null, { timeout: 20000 });
  await settle(r);
  const up = await sentBy(r, 'media:upload');
  assert.deepEqual(up.map((m) => [m.poolId, m.target]), [['m3', { screens: [B.id] }]]);
  assert.ok((await sentBy(r, 'media:chunk')).every((m) => m.target.screens.join() === B.id));
  assert.deepEqual(await sentBy(r, 'rtc-offer'), []);
  assert.ok((await r.broker.sent(B.page, 'media:chunkack')).length >= 1, 'accusés de B');
  for (const s of [A, C]) assert.equal(await s.page.evaluate(() => _mediaCache.has('m3')), false);
  await waitFor(rp, () => _screenCached.has('m3'));
  noErrors(r);
  await r.close();
});

test('persistance : noms, groupes et cible retrouvés après rechargement de la télécommande ; l\'écran garde son nom', async () => {
  const r = await rig(2, 11);
  const [A, B] = r.screens;
  const { rp } = r;
  const g = await rp.evaluate(([a, b]) => {
    scrRenameScreen(a, 'Régie'); scrRenameScreen(b, 'Fenêtre');
    const g = scrCreateGroup('Plateau', [b]);
    scrSetTarget({ k: 'group', id: g });
    return g;
  }, [A.id, B.id]);
  await waitFor(B.page, () => _screenCfg.name === 'Fenêtre' && _sec.groups.length === 1);
  // Télécommande rechargée : même session, registre relu
  await rp.reload();
  await rp.evaluate(() => startMode('remote'));
  await connected(rp);
  await waitFor(rp, () => _screenOfSender.size === 2);
  await waitFor(rp, () => getComputedStyle(document.getElementById('targetBtn')).display === 'flex');
  assert.deepEqual(await rp.evaluate(([a, b]) => [scrName(a), scrName(b), _scrReg.groups.map((x) => x.name), scrTarget()], [A.id, B.id]),
    ['Régie', 'Fenêtre', ['Plateau'], { k: 'group', id: g }]);
  assert.equal(await rp.textContent('#targetBtnLabel'), 'Cible : Plateau · 1');
  assert.deepEqual(await rp.evaluate(() => { switchTab('qr'); return [...document.querySelectorAll('#pairScreensList .ps-name')].map((e) => e.textContent); }), ['Régie', 'Fenêtre']);
  // La cible retenue s'applique aux ordres
  r.broker.clear();
  await rp.evaluate(() => setKelvin(4300));
  await waitFor(B.page, (c) => screenBaseColor === c, await rp.evaluate(() => currentColor));
  await r.broker.flush();
  assert.deepEqual((await sentBy(r, 'color')).at(-1).target, { screens: [B.id] });
  // Écran rechargé : il garde son nom et ses groupes (sans attendre la télécommande)
  await B.page.reload();
  assert.equal(await B.page.evaluate(() => { startMode('screen'); return document.getElementById('screenMenuInfo').textContent; }), '« Fenêtre » · liaison chiffrée de bout en bout');
  await connected(B.page);
  assert.deepEqual(await B.page.evaluate(() => _sec.groups), [g]);
  // Une autre session repart sans nom, sans groupe ni cible ; l'ancienne reste enregistrée
  const old = await rp.evaluate(() => _session.channelId);
  await rp.evaluate(() => newRemoteSession());
  await connected(rp);
  assert.deepEqual(await rp.evaluate(() => [_scrReg.screens.size, _scrReg.groups.length, scrTarget()]), [0, 0, { k: 'all' }]);
  await waitFor(rp, () => document.getElementById('targetBtnLabel').textContent === 'Cible : Aucun écran'); // puce toujours visible
  const stored = await rp.evaluate((sid) => JSON.parse(localStorage.getItem('setremote-screens-v1')).sessions[sid], old);
  assert.deepEqual(Object.values(stored.screens).map((e) => e.name).sort(), ['Fenêtre', 'Régie'], 'registre par session');
  noErrors(r);
  await r.close();
});

// ── Passerelle DMX : looks adressés à chaque écran patché, cible de la télécommande ailleurs ──
const NATIVE = { fn: () => { window.SETREMOTE_NATIVE = { platform: 'android', bridge: 1 }; window.ReactNativeWebView = { postMessage: () => {} }; } };
let _seq = 0;
const sacn = (page, slots) => page.evaluate((p) => window.SRNative.receive({ type: 'dmx:packets', packets: p }), [{
  src: '10.0.0.10', port: 5568,
  data: Buffer.from(buildSacnDataPacket({ cid: '5f1e7a52-3c4b-4d8e-9a10-2b3c4d5e6f70', universe: 1, data: slots, sequence: (++_seq) & 0xff, sourceName: 'Console' })).toString('base64'),
}]);

test('passerelle DMX : chaque look n\'atteint que son écran, la cible de la télécommande vise les autres', async () => {
  const r = await rig(3, 12, NATIVE);
  const [A, B, C] = r.screens;
  const { rp } = r;
  await rp.evaluate(([a, b, c]) => {
    scrRenameScreen(a, 'Gauche'); scrRenameScreen(c, 'Fond');
    openDmxGateway();
    gwPatchSet(a, { universe: 1, address: 1, personality: 'standard8' });
    gwPatchSet(b, { universe: 1, address: 9, personality: 'standard8' });
    scrSetTarget({ k: 'screen', id: c });
  }, [A.id, B.id, C.id]);
  // Noms donnés sur la télécommande : aussi dans le patch
  await rp.evaluate(() => gwShowView('patch'));
  assert.deepEqual(await rp.$$eval('#gwPatchRows .gw-pname', (els) => els.map((e) => e.textContent)), ['Gauche', 'Écran 2', 'Fond']);
  r.broker.clear();
  await sacn(rp, [255, 255, 0, 0, 0, 128, 0, 0, 255, 0, 255, 0, 0, 128, 0, 0]);
  await waitFor(A.page, () => screenBaseColor === '#ff0000' && screenDmxLive());
  await waitFor(B.page, () => screenBaseColor === '#00ff00' && screenDmxLive());
  // La télécommande (cible : C) pilote C pendant que la console tient A et B
  await rp.evaluate(() => sendMsg({ type: 'color', color: '#0000ff' }));
  await waitFor(C.page, () => screenBaseColor === '#0000ff');
  await sleep(200); await r.broker.flush();
  assert.equal(await C.page.evaluate(() => screenDmxLive()), false);
  const looks = await sentBy(r, 'dmx:look');
  assert.ok(looks.length >= 2);
  assert.ok(looks.every((m) => m.target.screens.length === 1 && m.target.screens[0] !== C.id), 'un look par écran patché, jamais vers C');
  assert.ok(looks.filter((m) => m.target.screens[0] === A.id).every((m) => m.look.color === '#ff0000'));
  assert.ok(looks.filter((m) => m.target.screens[0] === B.id).every((m) => m.look.color === '#00ff00'));
  assert.deepEqual((await sentBy(r, 'color')).map((m) => m.target), [{ screens: [C.id] }]);
  // Ordres de la télécommande vers A (console prioritaire) : ignorés par A
  await rp.evaluate((a) => { scrSetTarget({ k: 'screen', id: a }); sendMsg({ type: 'color', color: '#ffffff' }); }, A.id);
  await sleep(300);
  assert.equal(await base(A), '#ff0000');
  // « Écrans connectés » : A et B sous la console
  await rp.evaluate(() => { closeDmxGateway(); openScreensView(); });
  assert.deepEqual(await rp.$$eval('#svList .sv-now', (els) => els.map((e) => e.textContent)).then((t) => t.slice(0, 2)), ['Console DMX', 'Console DMX']);
  // Appel n° 1 déclenché pour A (comme par la console) alors que la cible est C :
  // sa photo part vers A seul, avant l'appel
  await rp.evaluate(async (c) => {
    closeScreensView(); scrSetTarget({ k: 'screen', id: c });
    switchTab('call'); setCallRing('silent');
    const k = document.createElement('canvas'); k.width = k.height = 8; k.getContext('2d').fillRect(0, 0, 8, 8);
    _callPhoto = k.toDataURL('image/jpeg', 0.7);
    document.getElementById('callName').value = 'Régie';
    await saveCurrentCall();
  }, C.id);
  r.broker.clear();
  await rp.evaluate((a) => sendCallEntry(callList.call[0], [{ screens: [a] }]), A.id);
  await waitFor(A.page, () => _callState === 'ringing' && _mediaCache.has('__callphoto'));
  await r.broker.flush();
  assert.deepEqual((await sentBy(r, 'media-img-start')).map((m) => [m.mediaId, m.target]), [['__callphoto', { screens: [A.id] }]]);
  assert.deepEqual((await sentBy(r, 'call:start')).map((m) => m.target), [{ screens: [A.id] }]);
  for (const s of [B, C]) assert.deepEqual(await s.page.evaluate(() => [_callState, _mediaCache.has('__callphoto')]), ['idle', false]);
  await rp.evaluate(() => gwStop());
  await waitFor(A.page, () => !screenDmxLive());
  noErrors(r);
  await r.close();
});
