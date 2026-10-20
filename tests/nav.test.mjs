// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Navigation de la télécommande (phase 3) : en-tête fixe, barre de 5 onglets
// fixe en bas (rail latéral dès 700 px ou en paysage bas), alias des anciens
// onglets, pastilles de l'onglet Écrans, segmenté Allumé | Noir, « Tout
// arrêter », puce Cible toujours visible, clavier, débordements, cibles tactiles.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, publishedBy } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const TABS = ['light', 'effects', 'media', 'scenario', 'screens'];
async function remote(opts = {}) {
  const p = await openPage(browser, opts);
  await p.page.evaluate(() => startMode('remote'));
  return p;
}
// Télécommande reliée au faux broker : ses trames sont publiées (publishedBy)
async function linked() {
  const p = await remote({ autoConnect: true });
  await waitFor(p.page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
  await sleep(50);
  await p.page.evaluate(() => { mqttClient.published.length = 0; });
  return p;
}
const addScreens = (page, n) => page.evaluate((n) => {
  setConnStatus('connected');
  for (let i = 0; i < n; i++) remoteNoteScreen('s' + i + 'SCRAAAAA', { type: 'caps', screenId: 'ScreenNum' + String(i).padStart(7, '0') });
  renderLinkStatus();
}, n);
const rect = (page, sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }; }, sel);
const active = (page) => page.evaluate(() => [...document.querySelectorAll('.tab-content.active')].map((c) => c.id));

test('coque : en-tête et barre de 5 onglets fixes, toujours visibles après défilement', async () => {
  const { page, errors, close } = await remote();
  const ids = await page.$$eval('#nv-tabs [role=tab]', (b) => b.map((x) => x.id));
  assert.deepEqual(ids, ['tab-light', 'tab-effects', 'tab-media', 'tab-scenario', 'tab-screens']);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('remote-mode')).overflowY), 'hidden', 'la coque ne défile pas');
  for (const t of TABS) {
    await page.evaluate((t) => switchTab(t), t);
    await page.evaluate(() => { const s = document.getElementById('nv-scroll'); s.scrollTop = s.scrollHeight; });
    const tabs = await rect(page, '#nv-tabs'), head = await rect(page, '#nv-head');
    assert.equal(Math.round(tabs.bottom), 844, 'barre collée au bas de la fenêtre : ' + t);
    assert.ok(tabs.top > 700 && tabs.h >= 60, 'barre visible : ' + t);
    assert.ok(head.top >= 0 && head.top < 1, 'en-tête collé en haut : ' + t);
    assert.equal(await page.evaluate(() => document.documentElement.scrollTop + document.body.scrollTop), 0);
  }
  // L'aperçu, la liaison, la cible et Allumé | Noir sont dans l'en-tête, jamais dans le contenu qui défile
  const inHead = await page.evaluate(() => ['previewSwatch', 'previewHex', 'linkPill', 'settingsBtn', 'targetBtn', 'blackoutSeg'].every((id) => document.getElementById(id).closest('#nv-head')));
  assert.equal(inHead, true);
  assert.equal(await page.evaluate(() => !document.getElementById('homeBtn') && !document.getElementById('stickyPreview') && !document.getElementById('blackoutBtn')), true, 'Accueil quitte l\'en-tête, plus de mini-carte ni de gros bouton Écran ON');
  assert.deepEqual(errors, []);
  await close();
});

test('onglets : 5 onglets, anciens identifiants gardés comme alias (couleur, flash, call, seq, qr)', async () => {
  const { page, errors, close } = await remote();
  const sel = () => page.evaluate(() => [...document.querySelectorAll('#nv-tabs [role=tab]')].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.id));
  const cases = [
    ['light', ['content-light', 'content-color'], 'tab-light'],
    ['color', ['content-light', 'content-color'], 'tab-light'],
    ['flash', ['content-light', 'content-flash'], 'tab-light'],
    ['effects', ['content-effects'], 'tab-effects'],
    ['media', ['content-media'], 'tab-media'],
    ['call', ['content-scn', 'content-call'], 'tab-scenario'],
    ['seq', ['content-scn', 'content-seq'], 'tab-scenario'],
    ['scenario', ['content-scn', 'content-seq'], 'tab-scenario'], // reprend la dernière vue (Séquence)
    ['qr', ['content-screens'], 'tab-screens'],
    ['screens', ['content-screens'], 'tab-screens'],
    ['light', ['content-light', 'content-flash'], 'tab-light'], // Lumière reprend Flash
  ];
  for (const [t, content, tab] of cases) {
    await page.evaluate((t) => switchTab(t), t);
    assert.deepEqual(await active(page), content, t);
    assert.deepEqual(await sel(), [tab], t);
    const shown = await page.evaluate(() => [...document.querySelectorAll('.tab-content')].filter((c) => c.offsetHeight > 0).map((c) => c.id));
    assert.deepEqual(shown, content, 'seules les vues actives sont visibles : ' + t);
  }
  // Les onglets se touchent ; les segmentés internes aussi
  await page.click('#tab-scenario');
  await page.click('#scnSeg-call');
  assert.deepEqual(await active(page), ['content-scn', 'content-call']);
  await page.click('#lightSeg-color').catch(() => {}); // masqué : sans effet
  await page.click('#tab-light');
  await page.click('#lightSeg-color');
  assert.deepEqual(await active(page), ['content-light', 'content-color']);
  await page.click('#lightSeg-flash');
  assert.deepEqual(await active(page), ['content-light', 'content-flash']);
  assert.equal(await page.getAttribute('#lightSeg-flash', 'aria-selected'), 'true');
  // Inconnu : sans effet
  await page.evaluate(() => switchTab('nimporte'));
  assert.deepEqual(await active(page), ['content-light', 'content-flash']);
  // Le code d'appairage ne tourne que sur Écrans
  await page.evaluate(() => switchTab('qr'));
  assert.equal(await page.evaluate(() => _rdv && _rdv.role), 'remote');
  await page.evaluate(() => switchTab('color'));
  assert.equal(await page.evaluate(() => _rdv && _rdv.role), null);
  assert.deepEqual(errors, []);
  await close();
});

test('onglets : la position de défilement est retenue par vue, remise à zéro à l\'arrivée sur une vue neuve', async () => {
  const { page, errors, close } = await remote();
  await page.evaluate(() => { document.getElementById('nv-scroll').scrollTop = 300; switchTab('effects'); });
  assert.equal(await page.evaluate(() => document.getElementById('nv-scroll').scrollTop), 0);
  await page.evaluate(() => switchTab('color'));
  assert.equal(await page.evaluate(() => document.getElementById('nv-scroll').scrollTop), 300);
  await page.evaluate(() => switchTab('flash'));
  assert.equal(await page.evaluate(() => document.getElementById('nv-scroll').scrollTop), 0);
  assert.deepEqual(errors, []);
  await close();
});

test('pastilles de l\'onglet Écrans : écrans hors ligne (nombre), point orange pendant une vérification, rien pour un écran qui se connecte', async () => {
  const { page, errors, close } = await remote();
  const badge = () => page.evaluate(() => ({
    shown: getComputedStyle(document.getElementById('screensBadge')).display !== 'none', text: document.getElementById('screensBadge').textContent,
    pend: document.getElementById('tab-screens').classList.contains('pend'), label: document.getElementById('tab-screens').getAttribute('aria-label'),
    pill: document.getElementById('linkPillLabel').textContent,
  }));
  await addScreens(page, 2);
  assert.deepEqual(await badge(), { shown: false, text: '0', pend: false, label: 'Écrans', pill: 'Internet' });
  // Un troisième écran vient de se connecter : aucune pastille
  await addScreens(page, 3);
  assert.equal((await badge()).shown, false);
  // Un écran muet depuis plus de 40 s : « 1 », la pastille de liaison ne dit plus que la liaison
  await page.evaluate(() => { _pairedScreens.get(scrList()[1]).lastSeen -= 60000; renderLinkStatus(); });
  assert.deepEqual(await badge(), { shown: true, text: '1', pend: false, label: 'Écrans, 1 hors ligne', pill: 'Internet' });
  await page.evaluate(() => { _pairedScreens.get(scrList()[2]).lastSeen -= 60000; renderLinkStatus(); });
  assert.equal((await badge()).text, '2');
  assert.equal((await badge()).label, 'Écrans, 2 hors ligne');
  // Vérification d'un appairage : point orange en plus
  await page.evaluate(() => showPairVerify('remote', '482917', () => {}));
  const b = await badge();
  assert.equal(b.pend, true);
  assert.match(b.label, /vérification en attente/);
  assert.equal(await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#tab-screens .nt-ic'), '::after'); return c.backgroundColor; }), 'rgb(255, 107, 44)');
  await page.evaluate(() => hidePairVerify());
  assert.equal((await badge()).pend, false);
  // Écran qui revient : plus de pastille
  await page.evaluate(() => { for (const id of scrList()) _pairedScreens.get(id).lastSeen = Date.now(); renderLinkStatus(); });
  assert.equal((await badge()).shown, false);
  assert.deepEqual(errors, []);
  await close();
});

test('Allumé | Noir : segmenté de l\'en-tête, un seul segment coché, envoie l\'ordre, gris (pas de blanc plein)', async () => {
  const { page, errors, close } = await linked();
  const st = () => page.evaluate(() => ({
    on: document.getElementById('blackoutOn').getAttribute('aria-checked'), off: document.getElementById('blackoutOff').getAttribute('aria-checked'),
    cls: [document.getElementById('blackoutOn').className, document.getElementById('blackoutOff').className], black: remoteBlackout,
  }));
  assert.deepEqual(await st(), { on: 'true', off: 'false', cls: ['on', ''], black: false });
  const colors = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('blackoutOn')); return [cs.backgroundColor, cs.boxShadow]; });
  assert.equal(colors[0], 'rgb(42, 42, 48)', 'surface-3, pas de blanc plein');
  assert.match(colors[1], /255, 107, 44/, 'liseré orange');
  await page.click('#blackoutOff');
  assert.deepEqual(await st(), { on: 'false', off: 'true', cls: ['', 'on'], black: true });
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('blackoutOff')).backgroundColor), 'rgb(0, 0, 0)');
  assert.deepEqual((await publishedBy(page, 'blackout')).map((m) => m.on), [true]);
  assert.ok(await page.evaluate(() => document.getElementById('previewSwatch').classList.contains('st-off')), 'anneau rouge de l\'aperçu');
  await page.click('#blackoutOff'); // déjà noir : sans effet
  assert.equal((await publishedBy(page, 'blackout')).length, 1);
  await page.click('#blackoutOn');
  assert.deepEqual(await st(), { on: 'true', off: 'false', cls: ['on', ''], black: false });
  assert.deepEqual((await publishedBy(page, 'blackout')).map((m) => m.on), [true, false]);
  assert.deepEqual(errors, []);
  await close();
});

test('« Tout arrêter » : barre « en cours » dans l\'en-tête, coupe strobe, effet, média et torche, sans passer le garde-fou', async () => {
  const { page, errors, close } = await linked();
  const strip = () => page.evaluate(() => ({ shown: getComputedStyle(document.getElementById('nvStrip')).display !== 'none', text: document.getElementById('nvStripTxt').textContent }));
  assert.equal((await strip()).shown, false, 'rien ne tourne : pas de barre');
  await page.evaluate(() => {
    setFlashWarningSkipped(true);
    _mediaPool = [{ id: 'm1', kind: 'img', name: 'plage', file: null, thumb: null }];
    document.getElementById('strobeToggle').checked = true; onStrobeToggle();
    selectEffect('tv');
    _activeMediaId = 'm1'; updateStatusRings();
    onRemoteTorchToggle();
  });
  assert.equal(await page.evaluate(() => [strobeActive, !!activeScreenEffect, !!_activeMediaId, remoteTorchOn].join()), 'true,true,true,true');
  let s = await strip();
  assert.equal(s.shown, true);
  assert.match(s.text, /^Stroboscope actif · 2 Hz · \+3$/);
  // Points sur les onglets concernés
  assert.deepEqual(await page.evaluate(() => ['light', 'effects', 'media', 'scenario'].map((t) => document.getElementById('tab-' + t).classList.contains('run'))), [true, true, true, false]);
  // La barre reste utilisable depuis n'importe quel onglet
  await page.evaluate(() => switchTab('screens'));
  assert.equal((await strip()).shown, true);
  await page.evaluate(() => { mqttClient.published.length = 0; });
  assert.ok((await rect(page, '#nvStopAll')).h >= 44);
  await page.click('#nvStopAll');
  assert.equal(await page.evaluate(() => [strobeActive, !!activeScreenEffect, !!_activeMediaId, remoteTorchOn, activeEffect].join()), 'false,false,false,false,');
  assert.equal((await strip()).shown, false);
  assert.equal(await page.evaluate(() => ['light', 'effects', 'media'].some((t) => document.getElementById('tab-' + t).classList.contains('run'))), false);
  const msgs = await publishedBy(page);
  assert.ok(msgs.some((m) => m.type === 'strobe' && m.active === false));
  assert.ok(msgs.some((m) => m.type === 'effect' && m.active === false));
  assert.ok(msgs.some((m) => m.type === 'media-stop'));
  assert.ok(msgs.some((m) => m.type === 'torch-onoff' && m.on === false));
  assert.ok(msgs.every((m) => !(m.type === 'strobe' && m.active)), 'ne réactive rien');
  // Ne contourne pas l'avertissement : la (ré)activation repasse par la boîte
  await page.evaluate(() => { setFlashWarningSkipped(false); switchTab('flash'); });
  await page.locator('label.toggle-switch:has(#strobeToggle)').click();
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('strobe-warn')).display), 'block');
  assert.equal(await page.evaluate(() => strobeActive), false);
  await page.evaluate(() => flashWarningAnswer(false));
  // Torche en motif : coupée aussi
  await page.evaluate(() => { setFlashWarningSkipped(true); sendTorchEffect('sos'); });
  assert.equal((await strip()).text, 'Torche allumée');
  await page.click('#nvStopAll');
  assert.equal(await page.evaluate(() => [remoteTorchOn, activeEffect].join()), 'false,');
  assert.deepEqual(errors, []);
  await close();
});

test('puce Cible : toujours visible, même avec un seul écran ou aucun ; libellés courts', async () => {
  const { page, errors, close } = await remote();
  const chip = () => page.evaluate(() => {
    const b = document.getElementById('targetBtn'), r = b.getBoundingClientRect();
    return { visible: r.width > 0 && r.height >= 44 && getComputedStyle(b).display !== 'none', text: document.getElementById('targetBtnLabel').textContent, subset: b.classList.contains('subset') };
  });
  await page.evaluate(() => renderScreensUi());
  assert.deepEqual(await chip(), { visible: true, text: 'Cible : Aucun écran', subset: false });
  await addScreens(page, 1);
  assert.deepEqual(await chip(), { visible: true, text: 'Cible : Tous · 1', subset: false });
  await addScreens(page, 3);
  assert.deepEqual(await chip(), { visible: true, text: 'Cible : Tous · 3', subset: false });
  await page.evaluate(() => { scrCreateGroup('Salon', scrList().slice(0, 2)); scrSetTarget({ k: 'group', id: _scrReg.groups[0].id }); });
  assert.deepEqual(await chip(), { visible: true, text: 'Cible : Salon · 2', subset: true });
  // Visible sur chaque onglet (en-tête fixe)
  for (const t of TABS) { await page.evaluate((t) => switchTab(t), t); assert.equal((await chip()).visible, true, t); }
  // Elle ouvre la feuille « Envoyer les commandes à… »
  await page.click('#targetBtn');
  assert.equal(await page.textContent('#srSheetTitle'), 'Envoyer les commandes à…');
  assert.deepEqual(errors, []);
  await close();
});

test('Écrans : une ligne par écran qui ouvre la feuille « Écran » (identifier, renommer, groupes, retirer)', async () => {
  const { page, errors, close } = await linked();
  await addScreens(page, 2);
  await page.evaluate(() => { switchTab('screens'); scrRenameScreen(scrList()[0], 'Téléphone de Julie'); });
  await waitFor(page, () => document.querySelector('#pairScreensList .ps-name').textContent === 'Téléphone de Julie'); // rendu différé de 120 ms (scrChanged)
  assert.equal(await page.textContent('#pairScreensCount'), '2');
  assert.deepEqual(await page.$$eval('#pairScreensList .ps-name', (e) => e.map((x) => x.textContent)), ['Téléphone de Julie', 'Écran 2']);
  assert.ok((await rect(page, '#pairScreensList .pair-screen')).h >= 60);
  await page.click('#pairScreensList .pair-screen');
  assert.equal(await page.textContent('#srSheetTitle'), 'Téléphone de Julie');
  assert.deepEqual(await page.$$eval('#srSheetBody .sr-act-label', (e) => e.map((x) => x.textContent)), ['Identifier', 'Renommer', 'Groupes', 'Retirer l\'écran']);
  await page.click('#srSheetBody .sr-act >> nth=0');
  assert.deepEqual((await publishedBy(page, 'screen:identify')).map((m) => m.target.screens.length), [1]);
  await page.click('#srSheetBody .sr-act >> nth=3');
  assert.equal(await page.evaluate(() => document.getElementById('sr-revoke').classList.contains('open')), true);
  await page.evaluate(() => closeRevokeDialog());
  // « Identifier tous »
  await page.click('#identifyAllBtn');
  assert.deepEqual((await publishedBy(page, 'screen:identify')).map((m) => m.target.screens.length), [1, 2]);
  assert.deepEqual(errors, []);
  await close();
});

test('rail latéral : dès 700 px de large et en paysage bas ; barre du bas en portrait', async () => {
  for (const [name, vp, rail] of [['portrait 390', { width: 390, height: 844 }, false], ['tablette 1024', { width: 1024, height: 768 }, true], ['700 px', { width: 700, height: 900 }, true], ['paysage 844', { width: 844, height: 390 }, true], ['699 px', { width: 699, height: 900 }, false]]) {
    const { page, errors, close } = await remote({ viewport: vp });
    const g = await page.evaluate(() => {
      const t = document.getElementById('nv-tabs').getBoundingClientRect(), h = document.getElementById('nv-head').getBoundingClientRect(), s = document.getElementById('nv-scroll').getBoundingClientRect();
      const cols = getComputedStyle(document.getElementById('content-color')).columnCount;
      return { tabs: [t.left, t.top, t.width, t.height], head: [h.left, h.top], scroll: [s.left, s.top], dir: getComputedStyle(document.getElementById('nv-tabs')).flexDirection, cols, vh: innerHeight };
    });
    if (rail) {
      assert.equal(g.dir, 'column', name);
      assert.equal(Math.round(g.tabs[0]), 0, name);
      assert.ok(g.tabs[2] >= 80 && g.tabs[2] <= 100, name + ' : largeur du rail ' + g.tabs[2]);
      assert.equal(Math.round(g.tabs[3]), g.vh, name + ' : le rail occupe toute la hauteur');
      assert.ok(g.head[0] >= g.tabs[2] - 1 && g.scroll[0] >= g.tabs[2] - 1, name + ' : contenu à droite du rail');
      assert.equal(g.cols, '2', name + ' : 2 colonnes');
      // Les 5 onglets restent atteignables
      const bs = await page.$$eval('#nv-tabs button', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return [r.top, r.bottom, r.width, r.height]; }));
      assert.equal(bs.length, 5);
      for (const [top, bottom, w, h] of bs) assert.ok(top >= 0 && bottom <= g.vh && w >= 44 && h >= 44, name + ' ' + [top, bottom, w, h]);
    } else {
      assert.equal(g.dir, 'row', name);
      assert.equal(Math.round(g.tabs[1] + g.tabs[3]), g.vh, name + ' : barre collée au bas');
      assert.equal(g.cols, 'auto', name + ' : une colonne');
    }
    assert.deepEqual(errors, [], name);
    await close();
  }
});

test('clavier : un champ de texte actif masque la barre d\'onglets, un curseur non', async () => {
  const { page, errors, close } = await remote();
  const barShown = () => page.evaluate(() => getComputedStyle(document.getElementById('nv-tabs')).display !== 'none');
  await page.evaluate(() => { switchTab('call'); setCallKind('sms'); });
  assert.equal(await barShown(), true);
  await page.focus('#callMsgText');
  assert.equal(await barShown(), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('tel-bar')).display), 'none', 'la barre d\'action s\'efface aussi');
  await page.evaluate(() => document.getElementById('callMsgText').blur());
  await sleep(30);
  assert.equal(await barShown(), true);
  await page.evaluate(() => switchTab('color'));
  await page.focus('#dimmerSlider');
  assert.equal(await barShown(), true, 'un curseur n\'ouvre pas de clavier');
  assert.deepEqual(errors, []);
  await close();
});

test('en-tête : une ligne de texte sous 700 px de haut (méta masquée), complète au-dessus', async () => {
  for (const [h, meta] of [[667, false], [844, true]]) {
    const { page, errors, close } = await remote({ viewport: { width: 375, height: h } });
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('previewMeta')).display !== 'none'), meta, 'hauteur ' + h);
    assert.deepEqual(errors, []);
    await close();
  }
});

test('Séquence : au Plateau, GO et ses commandes restent à 12 px au moins de la barre d\'onglets, quel que soit le défilement', async () => {
  const { page, errors, close } = await remote();
  await page.evaluate(() => { switchTab('seq'); setSeqMode('play'); });
  const gap = async () => {
    const ctl = await rect(page, '#seqBackBtn'), go = await rect(page, '#seqGoBtn'), bar = await rect(page, '#nv-tabs');
    assert.ok(go.bottom <= ctl.top, 'GO au-dessus de Revenir / Pause auto / Recommencer');
    return bar.top - ctl.bottom;
  };
  assert.ok(await gap() >= 12, 'au repos : ' + await gap());
  assert.equal((await rect(page, '#seqGoBtn')).h, 96, 'GO : 96 px');
  await page.evaluate(() => { document.getElementById('seqPlayRows').style.minHeight = '1600px'; document.getElementById('nv-scroll').scrollTop = 400; });
  assert.ok(await gap() >= 12, 'barre fixe pendant le défilement : ' + await gap());
  assert.deepEqual(errors, []);
  await close();
});

for (const width of [360, 375, 390]) {
  test(`aucun débordement horizontal à ${width} px : 5 onglets et leurs vues, barre « en cours » comprise`, async () => {
    const { page, errors, close } = await remote({ viewport: { width, height: 740 } });
    await addScreens(page, 3);
    await page.evaluate(() => {
      scrCreateGroup('Salon et cuisine du premier étage', scrList().slice(0, 2)); scrSetTarget({ k: 'group', id: _scrReg.groups[0].id });
      setFlashWarningSkipped(true); document.getElementById('strobeToggle').checked = true; onStrobeToggle();
      _pairedScreens.get(scrList()[2]).lastSeen -= 60000; renderLinkStatus();
    });
    const wide = [];
    for (const t of ['color', 'flash', 'effects', 'media', 'call', 'seq', 'screens']) {
      await page.evaluate((t) => switchTab(t), t);
      const w = await page.evaluate(() => {
        const out = [];
        for (const id of ['remote-mode', 'nv-main', 'nv-head', 'nv-scroll', 'nv-bar', 'nv-tabs']) { const e = document.getElementById(id); if (e.scrollWidth > e.clientWidth + 1) out.push(id + ' ' + e.scrollWidth + '>' + e.clientWidth); }
        if (document.documentElement.scrollWidth > innerWidth) out.push('document ' + document.documentElement.scrollWidth);
        for (const e of document.querySelectorAll('#nv-head *, #nv-tabs *')) { const r = e.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 1 || r.left < -1)) out.push((e.id || e.className) + ' hors fenêtre'); }
        return out;
      });
      wide.push(...w.map((x) => t + ' ' + x));
    }
    assert.deepEqual(wide, []);
    assert.deepEqual(errors, []);
    await close();
  });
}

test('cibles tactiles : en-tête, segmentés et onglets d\'au moins 44 px', async () => {
  const { page, errors, close } = await remote();
  await page.evaluate(() => { setFlashWarningSkipped(true); document.getElementById('strobeToggle').checked = true; onStrobeToggle(); });
  const small = [];
  for (const t of ['color', 'call']) {
    await page.evaluate((t) => switchTab(t), t);
    for (const sel of ['#settingsBtn', '#linkPill', '#targetBtn', '#blackoutOn', '#blackoutOff', '#nv-tabs button', '#nvStopAll', '.nv-seg2 button']) {
      for (const [w, h] of await page.$$eval(sel, (e) => e.filter((x) => x.getBoundingClientRect().width > 0).map((x) => { const b = x.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }))) if (w < 44 || h < 44) small.push(`${t} ${sel} ${w}×${h}`);
    }
  }
  assert.deepEqual(small, []);
  assert.deepEqual(errors, []);
  await close();
});

// Tel (4 types, avec la barre dans ses états), Séquence (Préparer, Plateau), éditeur d'étape et vue de réglage :
// ni débordement horizontal ni cible tactile < 44 px, à 360 et 390 px
for (const width of [360, 390]) {
  test(`Tel et Séquence à ${width} px : aucun débordement horizontal, cibles tactiles d'au moins 44 px`, async () => {
    const { page, errors, close } = await remote({ viewport: { width, height: 740 } });
    await addScreens(page, 2);
    await page.evaluate(() => {
      setCallRing('silent');
      document.getElementById('callName').value = 'Un contact au nom vraiment très long pour la rangée';
      document.getElementById('callLabel').value = 'mobile professionnel de nuit';
      renderCallerState();
      for (const n of ['Un', 'Deux']) { document.getElementById('callName').value = n; saveCurrentCall(); }
      chatSaved.push({ id: 'c1', name: 'Séq. 12 — Maman inquiète avec un nom très long', contact: 'Maman', actor: 'Julie', style: 'glass', msgs: _chat.msgs.map((m) => chatMsgCopy(m)), hasPhoto: false, photoSig: null });
      renderSavedChats();
    });
    const issues = [];
    const check = async (label) => {
      const r = await page.evaluate(() => {
        const out = [];
        for (const id of ['remote-mode', 'nv-main', 'nv-scroll', 'nv-bar']) { const e = document.getElementById(id); if (e.scrollWidth > e.clientWidth + 1) out.push(id + ' déborde ' + e.scrollWidth + '>' + e.clientWidth); }
        if (document.documentElement.scrollWidth > innerWidth) out.push('document ' + document.documentElement.scrollWidth);
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
        for (const e of document.querySelectorAll('#nv-bar *, #content-call *, #content-seq *')) {
          if (!vis(e)) continue;
          const b = e.getBoundingClientRect();
          if (b.right > innerWidth + 1 || b.left < -1) out.push((e.id || e.className) + ' hors fenêtre');
        }
        for (const e of document.querySelectorAll('#nv-bar button, #content-call button, #content-seq button, #content-call .tl-row, #content-seq .tl-row')) {
          if (!vis(e) || e.closest('[style*="display: none"]') || e.disabled) continue;
          const b = e.getBoundingClientRect();
          if (b.width < 44 || b.height < 44) out.push((e.id || e.className) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
        }
        return out;
      });
      issues.push(...r.map((x) => label + ' : ' + x));
    };
    await page.evaluate(() => switchTab('call'));
    for (const k of ['call', 'sms', 'notif', 'discussion']) {
      await page.evaluate((k) => setCallKind(k), k);
      await check('Tel ' + k);
      if (k === 'discussion') {
        await page.evaluate(() => { openChatOnTarget(); editChatMessage(_chat.msgs[1].id); });
        await check('Tel discussion ouverte, message touché');
        await page.evaluate(() => closeChat());
      }
    }
    await page.evaluate(() => { setCallKind('call'); callListKind = 'call'; _clSort = true; renderCallList(); });
    await check('Tel liste, mode Trier');
    await page.evaluate(() => { _clSort = false; telCallSent('call', 8); remoteOnCallState({ state: 'ringing' }); });
    await check('Tel appel qui sonne');
    await page.evaluate(() => telCallPhase('idle', ''));
    await page.evaluate(() => { _sheet = { kind: 'callMenu', id: callList.call[0].id }; renderSheet(); });
    await check('Tel menu ⋯');
    await page.evaluate(() => closeSheet());
    await page.evaluate(() => { switchTab('seq'); _seq.steps = ['color', 'call', 'sms', 'notif', 'chat'].map((k, i) => ({ id: 's' + i, kind: k, ref: null, target: { k: 'all' }, trig: i % 2 ? { k: 'after', s: 6 } : { k: 'go' }, opt: {} })); renderSeq(); });
    await check('Séquence Préparer');
    await page.evaluate(() => { _seqSort = true; renderSeq(); });
    await check('Séquence Préparer, mode Trier');
    await page.evaluate(() => { _seqSort = false; setSeqMode('play'); });
    await check('Séquence Plateau');
    await page.evaluate(() => { setSeqMode('prep'); openSeqStep('s1'); });
    await check('Éditeur d\'étape');
    await page.evaluate(() => { closeSeqStep(); openTelDetail('who'); });
    await check('Vue Appelant');
    assert.deepEqual(issues, []);
    assert.deepEqual(errors, []);
    await close();
  });
}
