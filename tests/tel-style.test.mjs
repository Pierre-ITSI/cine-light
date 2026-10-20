// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Onglet Tel, maquettes validées 36 : rangée « Style et sonnerie » / « Style
// et son » et sa vue plein écran (style, son, vibreur), vibreur par type
// envoyé à l'écran (navigator.vibrate ou coque native), son des messages de la
// discussion, appelants enregistrés (feuille, migration, stockage des photos).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const shown = (page, id) => page.evaluate((id) => getComputedStyle(document.getElementById(id)).display !== 'none', id);
const remote = (page, kind = 'call') => page.evaluate((k) => { startMode('remote'); switchTab('call'); setCallKind(k); }, kind);
// Espions : vibreur du navigateur, pont natif, sons de notification intégrés, messages envoyés
const SPY = {
  fn: (native) => {
    window.__vib = []; window.__native = []; window.__sent = [];
    if (native) {
      window.SETREMOTE_NATIVE = { platform: 'android', bridge: 1 };
      window.ReactNativeWebView = { postMessage: (s) => window.__native.push(JSON.parse(s)) };
    }
    Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: (p) => { window.__vib.push(p); return true; } });
  },
};
const spySent = (page) => page.evaluate(() => {
  const orig = window.sendMsg;
  window.sendMsg = (m) => { window.__sent.push(JSON.parse(JSON.stringify(m))); return orig(m); };
});
const spyChime = (page) => page.evaluate(() => {
  window.__chime = [];
  const orig = window._notifBuiltin;
  window._notifBuiltin = (kind, ring, vol) => { window.__chime.push([kind, ring, vol]); return orig(kind, ring, vol); };
});

test('36 · appel : rangée résumé, vue « Style et sonnerie », panneau « Au décroché » ; titres par type', async () => {
  const { page, errors, close } = await openPage(browser);
  await remote(page);
  // Style, présentation, photo et sonnerie ne sont plus dans l'onglet : dans la vue
  for (const id of ['callStyleRow', 'callPresentRow', 'callPhotoModeRow', 'callRingPanel']) {
    assert.equal(await page.evaluate((id) => !!document.getElementById(id).closest('#tel-style-view'), id), true, id);
  }
  assert.equal(await shown(page, 'tel-style-view'), false);
  // Carte « À jouer » (phase 4) : rangées « Apparence » et « Sonnerie », chacune avec sa valeur courte
  assert.equal(await page.textContent('#telStyleLabel'), 'Apparence');
  assert.equal(await page.textContent('#telStyleSum'), 'Verre · plein écran');
  assert.equal(await page.textContent('#telRingSum'), 'Classique · 100 %');
  // « Au décroché » : sa rangée ouvre la vue de la bande son et du décroché automatique
  assert.equal(await shown(page, 'callAnswerBlock'), true);
  assert.equal(await page.textContent('#telAnswerVal'), 'Silence · manuel');
  await page.click('#callAnswerBlock');
  assert.equal(await shown(page, 'tel-detail-view'), true);
  assert.equal(await page.textContent('#tdTitle'), 'Au décroché');
  assert.match(await page.textContent('#tdAnswer .panel-label'), /^Au décroché · bande son$/);
  await page.keyboard.press('Escape');
  assert.equal(await shown(page, 'tel-detail-view'), false, 'Échap ferme la vue');
  // La vue : aperçu, Style / Présentation / Photo, Sonnerie, Vibreur
  await page.click('#telStyleBtn');
  assert.equal(await shown(page, 'tel-style-view'), true);
  assert.deepEqual(await page.evaluate(() => ['tsTitle', 'tsBack', 'tsCap', 'ringPanelLabel'].map((id) => document.getElementById(id).textContent)),
    ['Style et sonnerie', 'Tel', 'Aperçu de l\'appel sur l\'écran de jeu', 'Sonnerie']);
  assert.equal(await page.textContent('#tsVibNote'), 'Vibre avec la sonnerie, même en Silencieux. Écran de jeu Android ou app SetRemote : iPhone dans Safari ne sait pas vibrer.');
  assert.equal(await page.textContent('#tsPreview .tp-nm'), 'Maman');
  assert.equal(await page.evaluate(() => !!document.querySelector('#tsPreview .tp-vib')), false, 'vibreur coupé : pas de badge');
  await page.click('#callstyle-tonal');
  await page.click('#callpres-banner');
  await page.click('#callring-digital');
  await page.click('#tsVibCard .ts-vib'); // l'interrupteur (case masquée sous son dessin)
  assert.equal(await page.isChecked('#telVibToggle'), true);
  assert.equal(await page.textContent('#tsPreview .tp-vib'), '〰 vibreur');
  assert.match(await page.getAttribute('#tsPreview', 'class'), /tonal banner/);
  await page.click('#callstyle-minimal');
  assert.equal(await shown(page, 'callPhotoModeRow'), false, 'Épuré : pas de photo plein écran');
  await page.click('#callstyle-tonal');
  await page.keyboard.press('Escape');
  assert.equal(await shown(page, 'tel-style-view'), false, 'Échap ferme la vue');
  assert.equal(await page.textContent('#telStyleSum'), 'Tonal · bandeau haut');
  assert.equal(await page.textContent('#telRingSum'), 'Digitale · 100 % · vibreur');
  // Titres et contenus selon le type
  const view = (k) => page.evaluate((k) => {
    setCallKind(k); openTelStyle();
    const v = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
    const r = [document.getElementById('tsTitle').textContent, document.getElementById('ringPanelLabel').textContent, v('callStyleRow'), v('callPresentRow'), v('ntDetail-wall')];
    closeTelStyle();
    return r;
  }, k);
  assert.deepEqual(await view('sms'), ['Style et son', 'Son de notification', true, false, false]);
  assert.deepEqual(await view('discussion'), ['Style et son', 'Son des messages', true, false, false]);
  assert.deepEqual(await view('notif'), ['Style et son', 'Son de notification', false, false, true]);
  assert.equal(await shown(page, 'telStyleRow'), false, 'notification : sa propre rangée « Style et son »');
  assert.equal(await shown(page, 'ntStyleBtn'), true);
  await page.evaluate(() => setCallKind('sms'));
  assert.equal(await shown(page, 'telStyleRow'), true);
  assert.equal(await shown(page, 'telCallRows'), false, 'pas d\'Apparence, de Sonnerie ni de décroché pour un SMS');
  assert.deepEqual(errors, []);
  await close();
});

test('vibreur : propre à chaque type, gardé au rechargement, envoyé (vib) ; entrées enregistrées', async () => {
  const { page, errors, close } = await openPage(browser);
  await remote(page);
  const vib = (k) => page.evaluate((k) => { setCallKind(k); return 'vib' in callFormFields() ? callFormFields().vib : null; }, k);
  assert.deepEqual([await vib('call'), await vib('sms'), await vib('notif')], [null, null, null], 'par défaut : non, rien n\'est envoyé');
  await page.evaluate(() => { setCallKind('sms'); setTelVib(true); setCallKind('discussion'); setTelVib(true); });
  assert.deepEqual([await vib('call'), await vib('sms'), await vib('notif')], [null, true, null]);
  assert.deepEqual(await page.evaluate(() => RING_KINDS.map((k) => ringSettings[k].vib)), [false, true, false, true]);
  // Rechargement : chaque type retrouve son vibreur
  await page.reload();
  await remote(page, 'sms');
  assert.deepEqual(await page.evaluate(() => RING_KINDS.map((k) => ringSettings[k].vib)), [false, true, false, true]);
  await page.evaluate(() => openTelStyle());
  assert.equal(await page.isChecked('#telVibToggle'), true);
  await page.evaluate(() => setCallKind('call'));
  assert.equal(await page.isChecked('#telVibToggle'), false, 'la vue suit le type affiché');
  await page.evaluate(() => closeTelStyle());
  // Entrée enregistrée : garde le vibreur ; rechargée, il revient ; ancienne entrée : non
  await page.evaluate(async () => {
    setCallKind('sms'); document.getElementById('callName').value = 'Léa'; await saveCurrentCall();
    setTelVib(false);
    callList.sms.push(_clSanitize({ id: 'old1', kind: 'sms', name: 'Ancien', ring: 'soft', ringVolume: 1, vib: 'oui' }));
  });
  assert.deepEqual(await page.evaluate(() => callList.sms.map((e) => [e.name, e.vib])), [['Léa', true], ['Ancien', undefined]]);
  assert.equal(await page.evaluate(() => callEntryMessage(callList.sms[0], {}).vib), true);
  assert.equal(await page.evaluate(() => 'vib' in callEntryMessage(callList.sms[1], {})), false);
  await page.evaluate(() => selectCallEntry(callList.sms[0].id));
  await waitFor(page, () => ringSettings.sms.vib === true);
  await page.evaluate(() => selectCallEntry('old1'));
  await waitFor(page, () => ringSettings.sms.vib === false);
  assert.deepEqual(errors, []);
  await close();
});

test('écran : l\'appel vibre en boucle tant qu\'il sonne, le SMS une fois ; sans vib, rien', async () => {
  const { page, errors, close } = await openPage(browser, { init: { fn: SPY.fn, arg: false } });
  await page.evaluate(() => startMode('screen'));
  await page.evaluate(() => screenCallStart({ kind: 'call', name: 'Maman', ring: 'silent' }));
  await sleep(300);
  assert.deepEqual(await page.evaluate(() => window.__vib), [], 'vibreur coupé : aucune vibration');
  await page.evaluate(() => screenCallAnswer());
  await page.evaluate(() => screenCallEnd());
  await page.evaluate(() => { window.__vib.length = 0; screenCallStart({ kind: 'call', name: 'Maman', ring: 'silent', vib: true }); });
  await waitFor(page, () => window.__vib.length >= 2, null, { timeout: 4000 });
  assert.deepEqual(await page.evaluate(() => window.__vib.slice(0, 2)), [[700, 300, 700], [700, 300, 700]], 'répété tant que ça sonne');
  await page.evaluate(() => screenCallAnswer());
  const n = await page.evaluate(() => window.__vib.length);
  assert.equal(await page.evaluate(() => window.__vib.at(-1)), 0, 'décroché : vibration arrêtée');
  await sleep(2500);
  assert.equal(await page.evaluate(() => window.__vib.length), n, 'plus rien après le décroché');
  await page.evaluate(() => screenCallEnd());
  await page.evaluate(() => { window.__vib.length = 0; screenCallStart({ kind: 'sms', name: 'Léa', msg: 'A', ring: 'silent', vib: true }); });
  assert.deepEqual(await page.evaluate(() => window.__vib), [[200, 120, 200]]);
  await page.evaluate(() => screenCallEnd());
  // Faux téléphone d'une Séquence : notification empilée avec le vibreur de l'entrée
  await page.evaluate(() => { window.__vib.length = 0; screenPhoneState({ mode: 'locked', style: 'glass', notifs: [{ id: 'n1', kind: 'sms', app: 'SMS', name: 'Maman', msg: 'A', ago: 0 }], unlock: null, home: false, watch: [], chime: { id: 'n1', ring: 'silent', vol: 1, vib: true } }); });
  assert.deepEqual(await page.evaluate(() => window.__vib), [[200, 120, 200]]);
  assert.deepEqual(errors, []);
  await close();
});

test('écran dans l\'app SetRemote : vibreur par la coque (vibrate, vibrate:stop)', async () => {
  const { page, errors, close } = await openPage(browser, { init: { fn: SPY.fn, arg: true } });
  await page.evaluate(() => startMode('screen'));
  await page.evaluate(() => { window.__native.length = 0; screenCallStart({ kind: 'call', name: 'Maman', ring: 'silent', vib: true }); });
  await page.evaluate(() => screenCallDecline());
  const vib = await page.evaluate(() => window.__native.filter((m) => /^vibrate/.test(m.type)));
  assert.deepEqual(vib, [{ type: 'vibrate', pattern: [700, 300, 700] }, { type: 'vibrate:stop' }]);
  assert.deepEqual(await page.evaluate(() => window.__vib), [], 'pas de navigator.vibrate dans la coque');
  await page.evaluate(() => { window.__native.length = 0; screenCallStart({ kind: 'notif', name: 'Virement', appName: 'Banque', present: 'banner', ring: 'silent', vib: true, received: { mode: 'now' } }); });
  assert.deepEqual(await page.evaluate(() => window.__native.filter((m) => /^vibrate/.test(m.type))), [{ type: 'vibrate', pattern: [200, 120, 200] }]);
  assert.deepEqual(errors, []);
  await close();
});

test('36d · discussion : son des messages et vibreur portés par chat:open, joués à chaque message du contact', async () => {
  const { page, errors, close } = await openPage(browser, { init: { fn: SPY.fn, arg: false } });
  await remote(page, 'discussion');
  await spySent(page);
  assert.equal(await page.textContent('#telStyleSum2'), 'Épuré · Silencieux', 'par défaut : silencieux, comme avant');
  await page.evaluate(() => openChatOnTarget());
  let open = await page.evaluate(() => window.__sent.filter((m) => m.type === 'chat:open').at(-1));
  assert.deepEqual(['ring', 'ringId', 'ringVolume', 'vib'].filter((k) => k in open), [], 'silencieux : aucun champ');
  // Douce à 60 %, vibreur : renvoyés à l'écran de la discussion ouverte
  await page.evaluate(() => { openTelStyle(); setCallRing('soft'); document.getElementById('ringVolSlider').value = '60'; onRingVolume(); setTelVib(true); closeTelStyle(); window.__sent.length = 0; });
  await waitFor(page, () => window.__sent.some((m) => m.type === 'chat:open'));
  open = await page.evaluate(() => window.__sent.filter((m) => m.type === 'chat:open').at(-1));
  assert.deepEqual([open.ring, open.ringVolume, open.vib], ['soft', 0.6, true]);
  assert.equal(await page.textContent('#telStyleSum2'), 'Épuré · Douce · vibreur');
  assert.deepEqual(await page.evaluate(() => [callFormFields().kind, ringSettings.call.sound, ringSettings.sms.vib]), ['discussion', 'classic', false], 'les autres types gardent les leurs');
  await page.evaluate(() => closeChat());
  // Écran : chaque message du contact sonne et vibre ; l'historique d'une reprise, non
  await page.evaluate(() => startMode('screen'));
  await spyChime(page);
  await page.evaluate(() => {
    for (const [id, from, text] of [['a', 'contact', 'Tu es où ?'], ['b', 'actor', 'ici'], ['c', 'contact', 'OK']]) screenChatMsg({ id, from, text });
    screenChatOpen({ name: 'Maman', style: 'glass', ids: ['a', 'b', 'c'], sent: [], typed: 0, ring: 'soft', ringVolume: 0.6, vib: true });
    screenChatPost({ id: 'a', typing: false });
  });
  assert.deepEqual(await page.evaluate(() => [window.__chime, window.__vib]), [[['discussion', 'soft', 0.6]], [[200, 120, 200]]]);
  await page.evaluate(() => screenChatOpen({ name: 'Maman', style: 'glass', ids: ['a', 'b', 'c'], sent: ['a', 'b'], typed: 0, history: true, ring: 'soft', vib: true }));
  assert.equal(await page.evaluate(() => window.__chime.length), 1, 'historique : aucun son');
  // Sans son ni vibreur (ancienne télécommande) : silencieux, comme avant
  await page.evaluate(() => { screenChatOpen({ name: 'Maman', style: 'glass', ids: ['a', 'b', 'c'], sent: ['a', 'b'], typed: 0 }); screenChatPost({ id: 'c', typing: false }); });
  assert.deepEqual(await page.evaluate(() => [window.__chime.length, window.__vib.length, document.querySelectorAll('#screen-chat .pt-b').length]), [1, 1, 3]);
  assert.deepEqual(errors, []);
  await close();
});

test('réseau : vib, son des messages et vibreur du téléphone de séquence validés', async () => {
  const { page, errors, close } = await openPage(browser);
  const v = await page.evaluate(() => {
    const call = { type: 'call:start', kind: 'call', vib: 'oui' }; _validCallStart(call);
    const open = { type: 'chat:open', name: 'M', style: 'glass', ids: [], sent: [], ring: '__proto__', ringId: 'x', ringVolume: 9, vib: 1 }; _validChatOpen(open);
    const open2 = { type: 'chat:open', name: 'M', style: 'glass', ids: [], sent: [], ringId: '__ring_0123456789abcdef' }; _validChatOpen(open2);
    return [call.vib, open.ring, open.ringId, open.ringVolume, open.vib, open2.ring];
  });
  assert.deepEqual(v, [false, 'classic', null, 1, false, 'classic']);
  assert.deepEqual(errors, []);
  await close();
});

// ── Appelants enregistrés (maquettes 36, 36c, 36e) ──
const photo = (page, color) => page.evaluate((c) => { const k = document.createElement('canvas'); k.width = k.height = 8; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 8, 8); return k.toDataURL('image/jpeg', 0.7); }, color);
const sheetRows = (page) => page.evaluate(() => [...document.querySelectorAll('#srSheetBody .cr-row')].map((r) => [r.querySelector('.cr-name').textContent, r.querySelector('.cr-meta').textContent, r.classList.contains('on')]));

test('36e · appelants : enregistrer, liste, appliquer (appel, SMS, discussion), renommer, supprimer ; photos hors localStorage', async () => {
  const { page, errors, close } = await openPage(browser);
  await remote(page);
  assert.equal(await page.textContent('#callWhoLabel'), 'Appelant');
  assert.equal(await page.textContent('#callWhoSaved'), 'Changer');
  assert.equal(await page.getAttribute('#callWhoSaved', 'aria-label'), 'Appelants enregistrés (0)');
  await page.evaluate(() => openTelDetail('who'));
  assert.equal(await shown(page, 'callerSaveBtn'), true);
  assert.equal(await page.textContent('#callerSaveBtn'), 'Enregistrer comme appelant');
  // « ☆ Enregistrer comme appelant » : Maman, mobile, avec photo
  const red = await photo(page, '#c08060');
  await page.evaluate((p) => { _callPhoto = p; renderCallerState(); }, red);
  await page.click('#callerSaveBtn');
  await waitFor(page, () => callers.length === 1);
  assert.equal(await shown(page, 'callerSaveBtn'), false);
  assert.equal(await page.textContent('#callerSavedNote'), 'Appelant enregistré');
  assert.equal(await page.getAttribute('#callWhoSaved', 'aria-label'), 'Appelants enregistrés (1)');
  await page.evaluate(() => closeTelDetail());
  // Photo changée : plus « enregistré » tel quel
  await page.evaluate(() => { _callPhoto = null; renderCallerState(); });
  assert.equal(await shown(page, 'callerSaveBtn'), true);
  // SMS : en-tête « Contact » ; un deuxième appelant sans photo, depuis la feuille
  await page.evaluate(() => { setCallKind('sms'); document.getElementById('callName').value = 'Agence immobilière'; document.getElementById('callLabel').value = 'bureau'; renderCallerState(); });
  assert.equal(await page.textContent('#callWhoLabel'), 'Contact');
  await page.click('#callWhoSaved');
  assert.equal(await page.textContent('#srSheetTitle'), 'Appelants enregistrés');
  assert.equal(await page.textContent('#crAdd'), 'Enregistrer « Agence immobilière » (actuel)');
  await page.click('#crAdd');
  await waitFor(page, () => callers.length === 2);
  await waitFor(page, () => document.querySelectorAll('#srSheetBody .cr-av[style*="background-image"]').length === 1);
  assert.deepEqual(await sheetRows(page), [['Maman', 'mobile · photo', false], ['Agence immobilière', 'bureau', true]]);
  assert.equal(await page.textContent('#crAdd'), '« Agence immobilière » enregistré');
  assert.equal(await page.isDisabled('#crAdd'), true);
  assert.match(await page.textContent('#srSheetBody .sr-sheet-note'), /^Un appelant enregistré sert aux appels, SMS et discussions/);
  // Toucher « Maman » : nom, sous-titre et photo dans le formulaire du SMS
  await page.locator('#srSheetBody .cr-row').nth(0).click();
  await waitFor(page, () => !_sheet);
  assert.deepEqual(await page.evaluate(() => [document.getElementById('callName').value, document.getElementById('callLabel').value, _callPhoto]), ['Maman', 'mobile', red]);
  assert.equal(await page.textContent('#callerSavedNote'), 'Appelant enregistré');
  // Discussion : en-tête « Contact · Enregistrés (2) › » ; l'appelant devient le contact (nom et photo)
  await page.evaluate(() => setCallKind('discussion'));
  assert.equal(await page.getAttribute('#dcCallersLink', 'aria-label'), 'Appelants enregistrés (2)');
  await page.click('#dcCallersLink');
  await page.locator('#srSheetBody .cr-row').nth(0).click();
  await waitFor(page, () => _chat.name === 'Maman' && _chatAvatar);
  assert.equal(await page.evaluate(() => _chatAvatar), red);
  await page.evaluate(() => openCallersSheet());
  assert.deepEqual((await sheetRows(page)).map((r) => r[2]), [true, false], 'discussion : contact reconnu par son nom');
  // « ⋯ » : renommer, puis supprimer (confirmation)
  await page.locator('#srSheetBody .cr-more').nth(1).click();
  assert.equal(await page.textContent('#srSheetTitle'), 'Agence immobilière');
  await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Renommer' }).click();
  await page.fill('#srName', 'Agence Riviera');
  await page.click('#srSheetBody .sr-ok');
  assert.deepEqual((await sheetRows(page)).map((r) => r[0]), ['Maman', 'Agence Riviera']);
  page.once('dialog', (d) => d.dismiss());
  await page.locator('#srSheetBody .cr-more').nth(1).click();
  await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Supprimer' }).click();
  assert.equal(await page.evaluate(() => callers.length), 2, 'annulé');
  page.once('dialog', (d) => d.accept());
  await page.locator('#srSheetBody .cr-more').nth(1).click();
  await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Supprimer' }).click();
  assert.deepEqual((await sheetRows(page)).map((r) => r[0]), ['Maman']);
  await page.click('#srSheetBody .sr-cancel');
  assert.equal(await page.evaluate(() => !!_sheet), false);
  // Stockage : textes en localStorage, photos en IndexedDB ; rechargement
  const ls = await page.evaluate(() => localStorage.getItem('setremote-callers-v1'));
  assert.doesNotMatch(ls, /data:image/, 'pas de photo en localStorage');
  await page.reload();
  await remote(page, 'call');
  assert.deepEqual(await page.evaluate(() => callers.map((e) => [e.name, e.label, e.hasPhoto])), [['Maman', 'mobile', true]]);
  assert.equal(await page.evaluate(async () => callerPhoto(callers[0])), red);
  assert.deepEqual(errors, []);
  await close();
});

test('36e · plafond de 50 appelants, entrées revalidées, textes jamais interprétés', async () => {
  const { page, errors, close } = await openPage(browser, { init: { fn: () => {
    if (sessionStorage.getItem('cr')) return;
    sessionStorage.setItem('cr', '1');
    const list = Array.from({ length: 60 }, (_, i) => ({ id: 'p' + i, name: 'Nom ' + i, label: 'mobile', hasPhoto: false }));
    list.unshift({ id: 'x1', name: '<img src=x onerror=window.__p=1>', label: '' }, { id: 'bad id', name: 'A' }, { id: 'x2', name: '' }, { id: 'x3', name: 'nom 0', label: 'MOBILE' });
    localStorage.setItem('setremote-callers-v1', JSON.stringify({ v: 1, list }));
  } } });
  await remote(page);
  assert.equal(await page.evaluate(() => callers.length), 50);
  assert.equal(await page.evaluate(() => callers[0].name), '<img src=x onerror=window.__p=1>');
  assert.equal(await page.evaluate(() => callers.filter((e) => e.name.toLowerCase() === 'nom 0').length), 1, 'doublon nom + sous-titre écarté');
  await page.evaluate(() => { document.getElementById('callName').value = 'Nouveau'; renderCallerState(); openCallersSheet(); });
  assert.equal(await page.evaluate(() => window.__p), undefined);
  assert.equal(await page.textContent('#crAdd'), 'Liste pleine (50 appelants)');
  assert.equal(await page.isDisabled('#callerSaveBtn'), true);
  assert.equal(await page.evaluate(() => saveCurrentCaller()), null);
  assert.deepEqual(errors, []);
  await close();
});

test('migration : appelants repris des appels, SMS et discussions enregistrés (une fois, sans doublon, photos comprises)', async () => {
  const { page, errors, close } = await openPage(browser);
  // Listes d'une version précédente, sans appelants enregistrés
  const ph = await photo(page, '#406080'), ph2 = await photo(page, '#80a040');
  await page.evaluate(async ([ph, ph2]) => {
    localStorage.setItem('setremote-call-list-v1', JSON.stringify({ v: 1,
      call: [{ id: 'c1', kind: 'call', name: 'Maman', label: 'mobile', style: 'glass', hasPhoto: true }, { id: 'c2', kind: 'call', name: 'Numéro masqué', style: 'minimal' }],
      sms: [{ id: 's1', kind: 'sms', name: 'MAMAN', label: 'Mobile', msg: 'A', style: 'glass', ringVolume: 1 }, { id: 's2', kind: 'sms', name: 'Léa', label: 'mobile', msg: 'B', style: 'glass', ringVolume: 1 }],
      notif: [{ id: 'n1', kind: 'notif', name: 'Virement', appName: 'Banque', style: 'glass' }] }));
    localStorage.setItem('setremote-chat-saved-v1', JSON.stringify({ v: 2, list: [
      { id: 'd1', name: 'Séq. 4', contact: 'Thomas', actor: 'Julie', style: 'glass', msgs: [{ id: 'm1', from: 'contact', text: 'Salut' }], hasPhoto: true, photoSig: _chsvPhotoSig(ph2) },
      { id: 'd2', name: 'Séq. 5', contact: 'Léa', actor: 'Julie', style: 'glass', msgs: [{ id: 'm1', from: 'contact', text: 'Salut' }] },
    ] }));
    localStorage.removeItem('setremote-callers-v1');
    await callAssetPut('c1:photo', ph);
    await callAssetPut('chat-d1:photo', ph2);
  }, [ph, ph2]);
  await page.reload();
  await remote(page);
  await waitFor(page, () => callers.filter((e) => e.hasPhoto).length === 2);
  assert.deepEqual(await page.evaluate(() => callers.map((e) => [e.name, e.label, e.hasPhoto])),
    [['Maman', 'mobile', true], ['Numéro masqué', '', false], ['Léa', 'mobile', false], ['Thomas', '', true], ['Léa', '', false]],
    'notifications ignorées ; « MAMAN / Mobile » = « Maman / mobile » ; « Léa » sans sous-titre ≠ « Léa / mobile »');
  assert.deepEqual(await page.evaluate(async () => [await callerPhoto(callers[0]), await callerPhoto(callers[3])]), [ph, ph2]);
  assert.equal(await page.evaluate(() => callList.call.length + callList.sms.length + chatSaved.length), 6, 'listes d\'origine inchangées');
  // Une seule fois : la liste (même vidée) n'est plus reprise
  await page.evaluate(() => { callers = []; _crPersist(); });
  await page.reload();
  await remote(page);
  await sleep(200);
  assert.equal(await page.evaluate(() => callers.length), 0);
  assert.deepEqual(errors, []);
  await close();
});
