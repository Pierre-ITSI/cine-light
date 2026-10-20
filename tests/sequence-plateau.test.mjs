// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Séquence, phase 4 (maquettes 4f à 4g2) : modes Préparer / Plateau, Plateau verrouillé (fiche en
// lecture seule, jamais l'éditeur), GO gardé, « Pause auto », « Recommencer » confirmé par un
// appui long, déplacement des étapes au bouton, « Jouer la séquence » en raccourci.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const fixtures = (page) => page.evaluate(() => {
  callList.call = [{ id: 'c1', kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, hasPhoto: false, hasAudio: false }];
  callList.sms = [
    { id: 's1', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ?', appName: 'SMS', appColor: '#2f8cf0', ring: 'silent', ringVolume: 1, lock: { time: '', date: '' }, hasPhoto: false, hasAudio: false },
    { id: 's2', kind: 'sms', style: 'glass', name: 'Léa', msg: 'Rappelle-moi stp', appName: 'SMS', appColor: '#2f8cf0', ring: 'silent', ringVolume: 1, lock: null, hasPhoto: false, hasAudio: false },
  ];
  persistCallList();
  colorMemories = [{ id: 'k1', name: 'ambiance nuit', spec: { kelvin: 3200, tint: 0, dimmer: 40, wheelHex: '#ffffff', crossfade: 0 }, strobe: { active: false, random: false, freq: 2, dur: 50, freqMax: 8, durMax: 200, torch: false } }];
  persistColorMemories();
  _seq.name = 'Séq. 12';
  _seq.steps = seqSanitizeSteps([
    { id: 'p1', kind: 'color', ref: 'k1', target: { k: 'all' }, trig: { k: 'go' }, opt: {} },
    { id: 'p2', kind: 'sms', ref: 's1', target: { k: 'all' }, trig: { k: 'after', s: 6 }, opt: {} },
    { id: 'p3', kind: 'call', ref: 'c1', target: { k: 'all' }, trig: { k: 'gesture', g: 'hangup', t: 12 }, opt: {} },
    { id: 'p4', kind: 'sms', ref: 's2', target: { k: 'all' }, trig: { k: 'go' }, opt: {} },
  ]);
  seqSave(); renderSeq();
});
const shown = (page, id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; }, id);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s).textContent.replace(/\s+/g, ' ').trim(), sel);
const start = async (opts = {}) => {
  const p = await openPage(browser, opts);
  await p.page.evaluate(() => { startMode('remote'); switchTab('seq'); SEQ_GO_GUARD_MS = 0; });
  await fixtures(p.page);
  return p;
};

test('Préparer | Plateau : carte de séquence, liste, barre « + Étape / Jouer la séquence » ; le mode est gardé en mémoire', async () => {
  const { page, errors, close } = await start();
  // Préparer au départ : bascule, carte, « Téléphone au départ », « Séquences enregistrées », Nouvelle séquence visible
  assert.equal(await page.evaluate(() => _seqMode), 'prep');
  assert.deepEqual(await page.$$eval('.sq-seg button', (b) => b.map((x) => x.textContent.trim() + (x.classList.contains('active') ? ' *' : ''))), ['Préparer *', 'Plateau']);
  assert.equal(await text(page, '#seqName'), 'Séq. 12');
  assert.match(await text(page, '#seqMeta'), /^4 étapes · Cible : Tous les écrans$/);
  assert.equal(await text(page, '#seqPhoneBtn .tl-k b'), 'Téléphone au départ');
  assert.equal(await text(page, '#seqSavedBtn .tl-k b'), 'Séquences enregistrées');
  assert.equal(await shown(page, 'seqNewBtn'), true, '« Nouvelle séquence » : bouton visible, pas caché dans ⋯');
  assert.equal(await text(page, '#seqStepsTitle'), 'Étapes · 4');
  assert.equal(await text(page, '#seqAddRow'), 'Ajouter une étape');
  // Plus de légende GO / automatique / geste : les badges suffisent
  assert.equal(await page.evaluate(() => !!document.querySelector('.sq-legend')), false);
  assert.deepEqual(await page.$$eval('#seqRows .sq-badge', (b) => b.map((x) => x.className.replace('sq-badge ', '') + ':' + x.textContent)), ['go:GO', 'auto:après 6 s', 'actor:refuse / 12 s', 'go:GO']);
  // Barre : une seule, « + Étape » et « Jouer la séquence »
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#nv-bar .nb')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.id)), ['seq-bar']);
  assert.deepEqual(await page.$$eval('#seq-bar button', (b) => b.filter((x) => x.offsetParent).map((x) => x.id)), ['seqAddBtn', 'seqPlayBtn']);
  assert.equal(await shown(page, 'seqBarPlay'), false, 'pas de GO en préparation');
  // « Jouer la séquence » : raccourci vers le Plateau
  await page.click('#seqPlayBtn');
  assert.equal(await page.evaluate(() => _seqMode), 'play');
  assert.equal(await shown(page, 'seqGoBtn'), true);
  assert.equal(await shown(page, 'seqPrepView'), false);
  assert.equal(await page.evaluate(() => document.body.classList.contains('nv-plateau')), true);
  // Le mode est gardé : on quitte l'onglet puis on revient
  await page.evaluate(() => { switchTab('color'); switchTab('seq'); });
  assert.equal(await shown(page, 'seqPlayView'), true);
  await page.click('#seqMode-prep');
  assert.equal(await shown(page, 'seqPrepView'), true);
  assert.equal(await page.evaluate(() => document.body.classList.contains('nv-plateau')), false);
  assert.deepEqual(errors, []);
  await close();
});

test('Plateau : EN COURS, ENSUITE, étapes jouées repliées, liste restante verrouillée, fiche en lecture seule (jamais l\'éditeur)', async () => {
  const { page, errors, close } = await start();
  await page.click('#seqMode-play');
  // En-tête réduit : plus de bascule Tel | Séquence ni de pastille couleur ; pastille de liaison dans la barre de mode
  assert.equal(await shown(page, 'nv-head'), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#nv-head .nv-r1')).display), 'none');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#content-scn > .nv-sub')).display), 'none');
  assert.equal(await page.evaluate(() => document.getElementById('linkPill').parentElement.id), 'seqPillSlot');
  assert.equal(await shown(page, 'targetBtn'), true, 'la cible reste');
  assert.equal(await shown(page, 'blackoutOn'), true, 'Allumé / Noir restent');
  // Avant le premier GO
  assert.equal(await text(page, '#seqPlayPos'), '0 / 4');
  assert.match(await text(page, '#seqNow'), /^PrêtGO lance l'étape 1$/);
  assert.equal(await text(page, '#seqGoSub'), 'déclenche l\'étape 1');
  assert.equal(await page.getAttribute('#seqGoBtn', 'aria-label'), 'GO, déclenche l\'étape 1');
  // GO ×2 : l'étape 2 est en cours, l'étape 3 vient ensuite
  await page.click('#seqGoBtn');
  await page.click('#seqGoBtn');
  assert.equal(await text(page, '#seqPlayPos'), '2 / 4');
  assert.match(await text(page, '#seqNow'), /^En cours · 2/);
  assert.match(await text(page, '#seqNext'), /^Ensuite · 3Appel entrant « Maman · mobile »si le comédien refusesinon dans 12 s/);
  assert.equal(await text(page, '#seqDoneTxt'), '1 étape jouée');
  assert.equal(await shown(page, 'seqDoneRows'), false, 'étapes jouées repliées');
  await page.click('#seqDoneBtn');
  assert.equal(await shown(page, 'seqDoneRows'), true);
  assert.equal(await page.$$eval('#seqDoneRows .sq-row', (r) => r.length), 1);
  await page.click('#seqDoneBtn');
  // Liste restante : l'étape 4 seulement (la 3 est dans ENSUITE), verrouillée
  assert.deepEqual(await page.$$eval('#seqPlayRows .sq-row', (r) => r.map((x) => x.querySelector('.sq-num').textContent)), ['4']);
  assert.equal(await page.evaluate(() => !!document.querySelector('#seqPlayRows .sq-mv, #seqPlayRows [draggable]')), false);
  // Toucher une ligne : fiche en lecture seule, l'éditeur ne s'ouvre jamais
  await page.locator('#seqPlayRows .sq-row').nth(0).click();
  assert.equal(await page.textContent('#srSheetTitle'), 'Étape 4 sur 4');
  assert.deepEqual(await page.$$eval('#srSheetBody .dt', (d) => d.map((x) => x.textContent.replace(/\s+/g, ' '))), ['TypeSMS', 'ÉlémentSMS « Rappelle-moi stp »', 'Départau GO', 'CibleTous les écrans', 'Étatà venir']);
  assert.match(await text(page, '#srSheetBody .sr-sheet-note'), /^Lecture seule pendant le jeu/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('seq-step-view')).display), 'none');
  assert.equal(await page.evaluate(() => !!_seqEdit), false);
  await page.click('#sr-sheet .sr-cancel');
  // Une étape jouée : sa fiche dit « jouée »
  await page.click('#seqDoneBtn');
  await page.locator('#seqDoneRows .sq-row').nth(0).click();
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#srSheetBody .dt b')].at(-1).textContent), 'jouée');
  await page.click('#sr-sheet .sr-cancel');
  // « Téléphone au départ » : visible au Plateau, modifiable en Préparer seulement
  assert.match(await text(page, '#seqPlayPhone'), /^Téléphone au départ · Heure réelle/);
  assert.equal(await page.evaluate(() => document.querySelector('#seqPlayPhone button, #seqPlayView #seqPhoneBtn')), null);
  assert.equal(await page.evaluate(() => !!document.getElementById('seqPlayView').contains(document.getElementById('seqPhoneBtn'))), false);
  assert.deepEqual(errors, []);
  await close();
});

test('GO 96 px et son garde, Revenir, « Pause auto » (ex-Stop : rien ne s\'éteint), cibles ≥ 44 px', async () => {
  const { page, errors, close } = await start();
  await page.click('#seqMode-play');
  const geo = await page.evaluate(() => ['seqGoBtn', 'seqBackBtn', 'seqStopBtn', 'seqRestartBtn'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, Math.round(r.height), Math.round(r.width)]; }));
  assert.equal(geo[0][1], 96, 'GO : 96 px');
  for (const [id, h, w] of geo.slice(1)) assert.ok(h >= 44 && w >= 44, id + ' ' + w + '×' + h);
  assert.deepEqual(await page.$$eval('.sq-ctl button', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim())), ['Revenir', 'Pause auto', 'Recommencer']);
  assert.equal(await page.evaluate(() => document.body.innerText.includes('Stop') || /\bSTOP\b/.test(document.body.innerText)), false, 'plus de « Stop »');
  // Garde du double GO : le second GO, 600 ms après, est ignoré
  await page.evaluate(() => { SEQ_GO_GUARD_MS = 600; window.__vib = []; navigator.vibrate = (p) => { window.__vib.push(p); return true; }; });
  await page.click('#seqGoBtn');
  await page.click('#seqGoBtn');
  assert.equal(await page.evaluate(() => seqPos() + 1), 1, 'double GO : un seul départ');
  assert.deepEqual(await page.evaluate(() => window.__vib), [[20]]);
  await page.evaluate(() => { SEQ_GO_GUARD_MS = 0; });
  // Pause auto : la minuterie « après 6 s » est coupée, rien n'est éteint, GO relance
  await page.click('#seqGoBtn'); // étape 2 (après 6 s ensuite l'étape 3 par geste : minuterie de secours)
  assert.equal(await page.evaluate(() => _seqRun.timer !== null), true, 'minuterie armée');
  await page.click('#seqStopBtn');
  assert.deepEqual(await page.evaluate(() => [_seqRun.state, _seqRun.timer]), ['stopped', null]);
  assert.equal(await page.isDisabled('#seqStopBtn'), true);
  assert.match(await text(page, '#seqNow'), /En pause auto : GO relance\./);
  assert.match(await text(page, '#seqNow'), /en pause auto/);
  assert.equal(await page.isDisabled('#seqGoBtn'), false, 'GO relance');
  await page.click('#seqGoBtn');
  assert.deepEqual(await page.evaluate(() => [seqPos() + 1, _seqRun.state]), [3, 'running']);
  // Revenir : défait l'étape en cours
  await page.click('#seqBackBtn');
  assert.equal(await page.evaluate(() => seqPos() + 1), 2);
  assert.deepEqual(errors, []);
  await close();
});

test('Recommencer : appui long (600 ms) ; un simple toucher n\'affiche que « Appui long pour recommencer »', async () => {
  const { page, errors, close } = await start();
  await page.click('#seqMode-play');
  assert.equal(await page.isDisabled('#seqRestartBtn'), true, 'rien à recommencer avant le premier GO');
  await page.click('#seqGoBtn');
  await page.click('#seqGoBtn');
  assert.equal(await page.evaluate(() => seqPos() + 1), 2);
  // Simple toucher : indication seulement
  assert.equal(await text(page, '#seqRestartHint'), '');
  await page.click('#seqRestartBtn');
  assert.equal(await text(page, '#seqRestartHint'), 'Appui long pour recommencer');
  assert.equal(await page.evaluate(() => seqPos() + 1), 2, 'pas de redémarrage');
  // Appui trop court (300 ms) : rien
  const b = await page.locator('#seqRestartBtn').boundingBox();
  const hold = async (ms) => { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await sleep(ms); await page.mouse.up(); };
  await hold(300);
  assert.equal(await page.evaluate(() => seqPos() + 1), 2);
  // Appui long : recommencé
  await hold(750);
  await waitFor(page, () => seqPos() === -1);
  assert.equal(await page.evaluate(() => _seqRun.state), 'idle');
  assert.equal(await text(page, '#seqRestartHint'), '');
  assert.equal(await text(page, '#seqPlayPos'), '0 / 4');
  // Au clavier (clic sans pointeur) : confirmation par la boîte de l'app
  await page.click('#seqGoBtn');
  await page.evaluate(() => document.getElementById('seqRestartBtn').click());
  assert.equal(await page.textContent('#acTitle'), 'Recommencer la séquence ?');
  await page.click('#acOk');
  await waitFor(page, () => seqPos() === -1);
  assert.deepEqual(errors, []);
  await close();
});

test('Préparer : monter / descendre les étapes au bouton (Trier), en plus du glisser', async () => {
  const { page, errors, close } = await start();
  const order = () => page.$$eval('#seqRows .sq-row', (r) => r.map((x) => x.dataset.id));
  assert.deepEqual(await order(), ['p1', 'p2', 'p3', 'p4']);
  assert.equal(await shown(page, 'seqSortBtn'), true);
  await page.click('#seqSortBtn');
  assert.equal(await page.getAttribute('#seqSortBtn', 'aria-pressed'), 'true');
  await page.locator('#seqRows .sq-row').nth(0).locator('.sq-mv button').nth(1).click(); // p1 descend
  assert.deepEqual(await order(), ['p2', 'p1', 'p3', 'p4']);
  await page.locator('#seqRows .sq-row').nth(3).locator('.sq-mv button').nth(0).click(); // p4 monte
  assert.deepEqual(await order(), ['p2', 'p1', 'p4', 'p3']);
  assert.equal(await page.locator('#seqRows .sq-row').nth(0).locator('.sq-mv button').nth(0).isDisabled(), true, 'premier : ↑ inactif');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('setremote-seq-v1')).steps.map((s) => s.id)), ['p2', 'p1', 'p4', 'p3'], 'gardé');
  for (const [w, h] of await page.$$eval('#seqRows .sq-mv button', (b) => b.map((x) => [x.offsetWidth, x.offsetHeight]))) assert.ok(w >= 44 && h >= 44);
  await page.click('#seqSortBtn');
  // Éditeur ⋯ : monter, dupliquer
  await page.locator('#seqRows .sq-row').nth(1).click(); // p1, rang 2
  await page.click('#ssMore');
  await page.click('#ssMenuUp');
  assert.deepEqual(await order(), ['p1', 'p2', 'p4', 'p3']);
  assert.equal(await page.textContent('#ssTitle'), 'Étape 1 sur 4');
  await page.click('#ssMore');
  await page.click('#ssMenuDup');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('seq-step-view')).display), 'none');
  assert.equal((await order()).length, 5);
  assert.deepEqual((await order()).filter((id) => id !== 'p1' && id !== 'p2' && id !== 'p3' && id !== 'p4').length, 1);
  assert.equal(await page.evaluate(() => _seq.steps[1].kind + _seq.steps[1].ref), 'colork1', 'copie juste après l\'original');
  // Brouillon modifié : dupliquer / déplacer sont inactifs (rien ne se perd en silence)
  await page.locator('#seqRows .sq-row').nth(0).click();
  await page.locator('#ssTrigCard .ss-opt', { hasText: 'Après un délai' }).click();
  await page.click('#ssMore');
  assert.equal(await page.isDisabled('#ssMenuDup'), true);
  assert.equal(await page.isDisabled('#ssMenuDown'), true);
  assert.match(await text(page, '#srSheetBody .sr-sheet-note'), /Enregistrez l'étape pour la dupliquer ou la déplacer\./);
  assert.deepEqual(errors, []);
  await close();
});

test('Plateau et Préparer : aperçu sans licence — étapes jouables au Plateau, liste de préparation verrouillée', async () => {
  const { page, errors, close } = await start();
  await page.evaluate(() => { _licPreview.seq = true; _licLockUi('seq', true); });
  assert.equal(await page.evaluate(() => ['seqAddBtn', 'seqAddRow', 'seqNewBtn', 'seqPhoneBtn', 'seqSavedBtn', 'seqRows'].map((id) => document.getElementById(id).inert).every(Boolean)), true);
  assert.equal(await page.evaluate(() => document.getElementById('seqPlayBtn').inert), false, 'Jouer la séquence : libre');
  await page.click('#seqPlayBtn');
  await page.click('#seqGoBtn');
  assert.equal(await page.evaluate(() => seqPos() + 1), 1, 'GO libre en aperçu');
  await page.evaluate(() => { _licPreview.seq = false; _licLockUi('seq', false); });
  assert.deepEqual(errors, []);
  await close();
});
