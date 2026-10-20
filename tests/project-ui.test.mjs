// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Interface des projets (maquettes 45 à 47b, web/js/74-project-ui.js) : carte
// « Projet » des Réglages, export « Nom.rem » téléchargé, avertissement des
// sections, aperçu de l'import (.rem et ancien .setremote), modes Ajouter /
// Remplacer / Ouvrir comme nouveau projet, compte rendu, erreurs ; liste des
// projets (créer, ouvrir, renommer, dupliquer, supprimer), refus pendant le
// jeu ; « + Nouvelle séquence » et « + Nouvelle discussion » avec la question
// « Enregistrer avant ? ».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchBrowser, openPage, waitFor } from './helpers/harness.mjs';
import { unzip, json } from './helpers/zip.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

async function remote() {
  const p = await openPage(browser);
  await p.page.evaluate(() => startMode('remote'));
  return p;
}
const idle = (page) => page.evaluate(() => projectUiIdle());
const text = (page, sel) => page.locator(sel).innerText();
// Projet « Tournage B » : 4 séquences, 3 discussions, 8 appels et SMS, 6 appelants, 5 mémoires
const seed = (page) => page.evaluate(async () => {
  const msgs = (n) => Array.from({ length: n }, (_, i) => ({ id: 'm' + (i + 1), from: i % 2 ? 'actor' : 'contact', text: 'Message ' + (i + 1) }));
  localStorage.setItem(CHAT_SAVED_KEY, JSON.stringify({ v: 2, list: ['cD1', 'cD2', 'cD3'].map((id, i) => ({ id, name: 'Discussion ' + i, contact: 'Maman', actor: 'Julie', style: 'glass', msgs: msgs(3), hasPhoto: false, photoSig: null })) }));
  const call = (id, name) => ({ id, kind: 'call', style: 'glass', name, label: 'mobile', ring: 'classic', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, lock: null, hasPhoto: false, hasAudio: false });
  const sms = (id, name) => ({ id, kind: 'sms', style: 'glass', name, label: '', msg: 'Salut', appName: 'Messages', ring: 'digital', ringVolume: 1, autoAnswer: 0, lock: null, hasPhoto: false, hasAudio: false });
  localStorage.setItem(CALL_LIST_KEY, JSON.stringify({ v: 1, call: ['eA1', 'eA2', 'eA3', 'eA4', 'eA5'].map((id, i) => call(id, 'Appel ' + i)), sms: [sms('eS1', 'Léa'), sms('eS2', 'Maman')],
    notif: [{ id: 'eN1', kind: 'notif', style: 'glass', name: 'Alerte', label: '', msg: 'Nouveau', appName: 'Insta', ring: 'soft', ringVolume: 0.5, present: 'banner', phone: { date: '2026-07-17', time: '14:32' }, received: { mode: 'ago', min: 5 }, hasPhoto: false, hasAudio: false }] }));
  localStorage.setItem(CALLERS_KEY, JSON.stringify({ v: 1, list: Array.from({ length: 6 }, (_, i) => ({ id: 'pC' + i, name: 'Appelant ' + i, label: '', hasPhoto: false })) }));
  const spec = { kelvin: 3200, tint: 0, dimmer: 80, wheelHex: '#ffffff', crossfade: 0 };
  localStorage.setItem('setremote-color-memories', JSON.stringify(['col1', 'col2', 'col3'].map((id) => ({ id, name: id, spec, strobe: null }))));
  const fx = Object.keys(EFFECT_CONFIG);
  localStorage.setItem('setremote-fx-memories', JSON.stringify([{ id: 'fx1', name: 'A', effect: fx[0], params: {} }, { id: 'fx2', name: 'B', effect: fx[1], params: {} }]));
  const st = (id, kind, ref) => ({ id, kind, ref, target: { k: 'all' }, trig: { k: 'go' }, opt: {} });
  localStorage.setItem(SEQ_SAVED_KEY, JSON.stringify({ v: 1, list: ['qS1', 'qS2', 'qS3', 'qS4'].map((id, i) => ({ id, name: 'Scène ' + i, steps: [st('s1', 'color', 'col1'), st('s2', 'call', 'eA1'), st('s3', 'chat', 'cD1')] })) }));
  _licReloadTel(); seqLoad(); loadSavedSeqs(); renderSeq(); loadColorMemories(); loadFxMemories();
  await projectsInit();
  await projectRename(projectActiveId(), 'Tournage B');
});
const projects = (page) => page.evaluate(async () => { const r = await projectsList(); return r.list.map((m) => (m.active ? '*' : '') + m.name).sort(); });

test('Réglages › Projet : carte, export « Nom.rem » téléchargé, avertissement des sections non exportées', async () => {
  const { page, errors, close } = await remote();
  await seed(page);
  await page.evaluate(() => openSettings());
  await idle(page);
  assert.equal(await text(page, '#stPrjName'), 'Tournage B');
  assert.equal(await text(page, '#stPrjSub'), 'Projet ouvert · 4 séquences · 3 discussions · 8 appels et SMS');
  assert.equal(await page.locator('#stPrjLast').isVisible(), false, 'aucun export encore');
  await page.click('#stPrjExport');
  await idle(page);
  assert.equal(await text(page, '#pjTitle'), 'Exporter le projet');
  assert.equal(await page.inputValue('#pjExpName'), 'Tournage B');
  assert.deepEqual(await page.locator('#pjBody .prj-srow .prj-cnt').allInnerTexts(), ['4', '3', '8', '6', '0', '5', '0 · 0 Ko']);
  assert.match(await text(page, '#pjExp-calls'), /5 appels · 2 SMS · 1 notification/);
  assert.match(await text(page, '#pjExp-memories'), /3 couleurs · 2 effets/);
  assert.equal(await page.locator('#pjExpWarn').count(), 0);
  // Séquences cochées, appels décochés : étapes « introuvables » à l'arrivée
  await page.click('#pjExp-calls');
  assert.equal(await page.getAttribute('#pjExp-calls', 'aria-checked'), 'false');
  assert.match(await text(page, '#pjExpWarn'), /non exportés \(« Appels et SMS »\) : elles arriveront « introuvables »/);
  await page.click('#pjExp-chat');
  assert.match(await text(page, '#pjExpWarn'), /\(« Discussions » et « Appels et SMS »\)/);
  await page.click('#pjExp-seq');
  assert.equal(await page.locator('#pjExpWarn').count(), 0, 'sans séquences : rien à prévenir');
  await page.click('#pjExp-seq'); await page.click('#pjExp-calls'); await page.click('#pjExp-chat');
  assert.equal(await page.locator('#pjExpWarn').count(), 0);
  // Nom changé : nom de fichier nettoyé, projet ouvert renommé ; Mémoires non exportées
  await page.fill('#pjExpName', 'Tournage/B: 2');
  assert.equal(await text(page, '#pjExpFile'), 'Fichier : « Tournage B 2.rem »');
  await page.click('#pjExp-memories');
  assert.match(await text(page, '#pjExpWarn'), /\(« Mémoires »\)/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pjExpGo')]);
  assert.equal(dl.suggestedFilename(), 'Tournage B 2.rem');
  await idle(page);
  const z = unzip(readFileSync(await dl.path()));
  const man = json(z, 'project.json');
  assert.equal(man.format, 'setremote-project', 'identifiant interne du format inchangé');
  assert.equal(man.name, 'Tournage/B: 2');
  assert.deepEqual(man.sections, ['seq', 'chat', 'calls', 'callers', 'rings', 'work']);
  assert.match(await text(page, '.prj-done'), /« Tournage B 2\.rem » exporté\./);
  assert.deepEqual(await projects(page), ['*Tournage/B: 2']);
  // Retour aux Réglages : nom et dernier export à jour
  await page.click('#project-view .st-back');
  await idle(page);
  assert.equal(await page.locator('#project-view').isVisible(), false);
  assert.equal(await text(page, '#stPrjName'), 'Tournage/B: 2');
  assert.match(await text(page, '#stPrjLast'), /^Dernier export : aujourd'hui, \d\d:\d\d · « Tournage B 2\.rem »$/);
  assert.deepEqual(errors, []);
  await close();
});

test('Importer : aperçu d\'un .rem et d\'un ancien .setremote, Ajouter, Remplacer, Ouvrir comme nouveau projet, erreurs', async () => {
  const A = await remote();
  await seed(A.page);
  const buf = Buffer.from(await A.page.evaluate(async () => _prjBytesToB64(new Uint8Array(await (await projectExport({ name: 'Tournage B' })).arrayBuffer()))), 'base64');
  await A.close();
  const { page, errors, close } = await remote();
  // Données à moi : une séquence enregistrée
  await page.evaluate(() => {
    localStorage.setItem(SEQ_SAVED_KEY, JSON.stringify({ v: 1, list: [{ id: 'qM1', name: 'Mienne', steps: [] }] }));
    loadSavedSeqs(); renderSeq();
    openSettings();
  });
  await idle(page);
  const pick = async (name, b = buf, mimeType = 'application/octet-stream') => {
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(await page.locator('#project-view').isVisible() ? '#pjBody .prj-primary' : '#stPrjImport')]);
    assert.equal(await fc.element().getAttribute('accept'), '.rem,.setremote,application/zip');
    await fc.setFiles({ name, mimeType, buffer: b });
    await waitFor(page, () => _pjuPending.size === 0 && _pju.view);
    await idle(page);
  };
  // 45c · aperçu
  await pick('tournage-b.rem');
  assert.equal(await text(page, '#pjTitle'), 'Importer un projet');
  assert.equal(await text(page, '#pjBody .prj-name'), 'Tournage B');
  assert.match(await text(page, '#pjBody .prj-file .prj-sub'), /^tournage-b\.rem · \d+ Ko\nExporté le \d+ \S+ \d{4}, \d\d:\d\d · SetRemote 1\.0\.0$/);
  assert.deepEqual(await page.locator('#pjBody .prj-srow .prj-cnt').allInnerTexts(), ['4', '3', '8', '6', '0', '5', '—']);
  assert.equal(await page.getAttribute('#pjImp-media', 'aria-disabled'), 'true', 'médias absents du fichier');
  assert.match(await text(page, '#pjImp-media'), /Non inclus dans ce fichier/);
  assert.match(await text(page, '#pjMode-merge'), /À la suite de « Mon projet » ; doublons : « \(2\) »\./);
  await page.click('#pjMode-replace');
  assert.match(await text(page, '#pjImpWarn'), /1 séquence de « Mon projet » seront supprimés/);
  assert.equal(await text(page, '#pjImpGo'), 'REMPLACER ET IMPORTER');
  await page.click('#pjMode-new');
  assert.equal(await text(page, '#pjImpGo'), 'OUVRIR LE PROJET');
  assert.equal(await page.getAttribute('#pjImp-seq', 'aria-disabled'), 'true', 'nouveau projet : rangé en entier');
  // Ajouter, sans les mémoires
  await page.click('#pjMode-merge');
  await page.click('#pjImp-memories');
  assert.equal(await page.getAttribute('#pjImp-memories', 'aria-checked'), 'false');
  await page.click('#pjImpGo');
  await idle(page);
  assert.equal(await text(page, '#pjTitle'), 'Projet importé');
  assert.equal(await text(page, '#pjRepHead'), '« Tournage B » ajouté à « Mon projet »');
  assert.match(await text(page, '#pjRep-seq'), /\+4/);
  assert.match(await text(page, '#pjRep-memories'), /non importées/);
  assert.match(await text(page, '#pjRep-media'), /non inclus/);
  assert.deepEqual(await page.evaluate(() => [seqSaved.length, colorMemories.length]), [5, 0]);
  // « VOIR LES SÉQUENCES » est proposé ; FERMER revient aux Réglages
  assert.equal(await page.locator('#pjBody .prj-primary').innerText(), 'VOIR LES SÉQUENCES');
  await page.click('#pjBody .st-btn');
  assert.equal(await page.locator('#project-view').isVisible(), false);
  // Remplacer, depuis l'ancienne extension .setremote
  await pick('ancien.setremote', buf, 'application/zip');
  assert.equal(await text(page, '#pjBody .prj-name'), 'Tournage B');
  await page.click('#pjMode-replace');
  assert.match(await text(page, '#pjImpWarn'), /5 séquences, 3 discussions, 8 appels et SMS et 6 appelants de « Mon projet » seront supprimés/);
  await page.click('#pjImpGo');
  await idle(page);
  assert.equal(await text(page, '#pjRepHead'), '« Mon projet » : sections remplacées par « Tournage B »');
  assert.match(await text(page, '#pjRep-seq'), /5 supprimées/);
  assert.deepEqual(await page.evaluate(() => [seqSaved.length, seqSaved.map((e) => e.name).includes('Mienne'), colorMemories.length]), [4, false, 3]);
  // Ouvrir comme nouveau projet : rangé puis ouvert
  await page.click('#pjBody .st-btn');
  await pick('tournage-b.rem');
  await page.click('#pjMode-new');
  await page.click('#pjImpGo');
  await idle(page);
  assert.equal(await text(page, '#pjRepHead'), '« Tournage B » ouvert comme nouveau projet');
  assert.deepEqual(await projects(page), ['*Tournage B', 'Mon projet']);
  // 45e · fichier non reconnu : rien n'a été modifié ; « CHOISIR UN AUTRE FICHIER »
  await page.click('#pjBody .st-btn');
  await pick('vacances.zip', Buffer.from('ceci n\'est pas un projet SetRemote, juste du texte'));
  assert.equal(await text(page, '#pjErrTitle'), 'Fichier non reconnu');
  assert.equal(await text(page, '#pjErrText'), '« vacances.zip » n\'est pas un projet SetRemote (.rem).');
  assert.match(await text(page, '#pjBody'), /Rien n'a été modifié\./);
  await pick('tournage-b.rem');
  assert.equal(await text(page, '#pjTitle'), 'Importer un projet', 'autre fichier choisi depuis l\'erreur');
  assert.deepEqual(errors, []);
  await close();
});

test('Projets : créer, ouvrir, renommer, dupliquer, supprimer par l\'interface', async () => {
  const { page, errors, close } = await remote();
  await seed(page);
  await page.evaluate(() => openSettings());
  await idle(page);
  await page.click('#stPrjOpen');
  await idle(page);
  assert.equal(await text(page, '#pjTitle'), 'Projets');
  assert.equal(await page.locator('.prj-proj').count(), 1);
  assert.match(await text(page, '.prj-proj.act'), /Tournage B\s*ouvert/i);
  assert.match(await text(page, '.prj-proj.act .prj-pm'), /^Modifié aujourd'hui, \d\d:\d\d\n4 séq\. · 3 disc\. · 8 appels et SMS · \d+ Ko$/);
  // 46b · Nouveau projet « À partir du projet actuel » : créé puis ouvert
  await page.click('#pjNewBtn');
  assert.equal(await text(page, '#srSheetTitle'), 'Nouveau projet');
  await page.fill('#srName', 'Tournage C');
  await page.click('#srSheetBody .prj-opt >> nth=1');
  assert.equal(await page.inputValue('#srName'), 'Tournage C', 'nom gardé au changement de choix');
  assert.match(await text(page, '#srSheetBody'), /Copie de « Tournage B » \(sans les médias\)\./);
  await page.click('#srSheetBody .sr-ok');
  await idle(page);
  assert.deepEqual(await projects(page), ['*Tournage C', 'Tournage B']);
  assert.equal(await page.evaluate(() => seqSaved.length), 4, 'copie du projet actuel');
  assert.equal(await page.locator('#sr-sheet.open').count(), 0);
  // 46c · Ouvrir « Tournage B » (confirmation)
  await page.click('.prj-proj:not(.act)');
  assert.equal(await text(page, '#srSheetTitle'), 'Ouvrir « Tournage B » ?');
  assert.match(await text(page, '#srSheetBody'), /« Tournage C » est rangé tel quel/);
  await page.click('#pjOpenOk');
  await idle(page);
  assert.deepEqual(await projects(page), ['*Tournage B', 'Tournage C']);
  // Menu « ⋯ » d'un projet rangé : Ouvrir, Renommer, Dupliquer, Exporter…, Supprimer
  const menu = async (name) => { await page.click(`.prj-proj:has-text("${name}") .prj-more`); return page.locator('#srSheetBody .dc-menu-btn').allInnerTexts(); };
  assert.deepEqual(await menu('Tournage C'), ['Ouvrir', 'Renommer', 'Dupliquer', 'Exporter…', 'Supprimer']);
  await page.click('#srSheetBody .dc-menu-btn:has-text("Renommer")');
  await page.fill('#srName', 'Tournage D');
  await page.click('#srSheetBody .sr-ok');
  await idle(page);
  assert.deepEqual(await projects(page), ['*Tournage B', 'Tournage D']);
  await menu('Tournage D');
  await page.click('#srSheetBody .dc-menu-btn:has-text("Dupliquer")');
  await idle(page);
  assert.deepEqual(await projects(page), ['*Tournage B', 'Tournage D', 'Tournage D (copie)']);
  assert.equal(await page.locator('.prj-proj').count(), 3);
  // Exporter un projet rangé : fichier tel quel
  await menu('Tournage D (copie)');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#srSheetBody .dc-menu-btn:has-text("Exporter")')]);
  assert.equal(dl.suggestedFilename(), 'Tournage D (copie).rem');
  await idle(page);
  assert.equal(json(unzip(readFileSync(await dl.path())), 'project.json').name, 'Tournage D (copie)');
  // Supprimer (confirmation)
  await menu('Tournage D (copie)');
  page.once('dialog', (d) => d.accept());
  await page.click('#srSheetBody .dc-menu-btn:has-text("Supprimer")');
  await idle(page);
  assert.deepEqual(await projects(page), ['*Tournage B', 'Tournage D']);
  // Projet ouvert : ni « Ouvrir » ni « Supprimer » ; toucher sa ligne ouvre son menu
  await page.click('.prj-proj.act');
  assert.deepEqual(await page.locator('#srSheetBody .dc-menu-btn').allInnerTexts(), ['Renommer', 'Dupliquer', 'Exporter…']);
  await page.click('#srSheetBody .sr-cancel');
  // « Exporter… » du projet ouvert : vue d'export, retour à la liste
  await page.click('.prj-proj.act .prj-more');
  await page.click('#srSheetBody .dc-menu-btn:has-text("Exporter")');
  await idle(page);
  assert.equal(await text(page, '#pjTitle'), 'Exporter le projet');
  await page.click('#project-view .st-back');
  assert.equal(await text(page, '#pjTitle'), 'Projets');
  assert.deepEqual(errors, []);
  await close();
});

test('Projets : refus d\'ouvrir ou de créer un projet pendant qu\'une séquence est lancée', async () => {
  const { page, errors, close } = await remote();
  await seed(page);
  await page.evaluate(async () => {
    await projectCreate({ name: 'Autre' });
    switchTab('seq');
    setConnStatus('connected');
    remoteNoteScreen('s0SCRAAAAA', { type: 'caps', screenId: 'JulieScreen00001' });
    _seq.steps = seqSanitizeSteps([{ id: 'a1', kind: 'color', ref: 'col1', target: { k: 'all' }, trig: { k: 'go' } }, { id: 'a2', kind: 'color', ref: 'col2', target: { k: 'all' }, trig: { k: 'go' } }]);
    seqSave(); renderSeq();
    seqGo(); await _seqChain;
    openSettings();
  });
  await idle(page);
  await page.click('#stPrjOpen');
  await idle(page);
  await page.click('.prj-proj:not(.act)');
  assert.equal(await text(page, '#srSheetTitle'), 'Impossible pour l\'instant');
  assert.match(await text(page, '#srSheetBody'), /Une séquence est lancée sur les écrans\. Arrêtez-la \(↺ Recommencer\) avant d'ouvrir un autre projet\./);
  await page.click('#srSheetBody .sr-ok');
  await page.click('#pjNewBtn');
  await page.fill('#srName', 'Nouveau');
  await page.click('#srSheetBody .sr-ok');
  await idle(page);
  assert.equal(await text(page, '#srSheetTitle'), 'Impossible pour l\'instant');
  assert.deepEqual(await projects(page), ['*Tournage B', 'Autre'], 'rien ouvert, rien créé');
  // Recommencer : l'ouverture passe
  await page.evaluate(() => { closeSheet(); seqRestart(); });
  await page.click('.prj-proj:not(.act)');
  await page.click('#pjOpenOk');
  await idle(page);
  assert.deepEqual(await projects(page), ['*Autre', 'Tournage B']);
  assert.deepEqual(errors, []);
  await close();
});

test('« + Nouvelle séquence » : aussitôt sans modification ; sinon Enregistrer / Ne pas enregistrer / Annuler', async () => {
  const { page, errors, close } = await remote();
  const dirty = () => page.evaluate(() => {
    _seq.name = 'Séq. 12'; _seq.steps = seqSanitizeSteps([{ id: 'a1', kind: 'color', ref: 'k1', target: { k: 'all' }, trig: { k: 'go' } }]);
    seqSave(); renderSeq();
  });
  const state = () => page.evaluate(() => ({ steps: _seq.steps.length, saved: seqSaved.map((e) => e.name), sheet: _sheet && _sheet.kind }));
  await page.evaluate(() => switchTab('seq'));
  assert.equal(await text(page, '#seqNewBtn'), '+ NOUVELLE SÉQUENCE');
  await dirty();
  await page.click('#seqNewBtn');
  assert.equal(await text(page, '#srSheetTitle'), 'Enregistrer « Séq. 12 » avant ?');
  assert.match(await text(page, '#srSheetBody'), /modifications non enregistrées\. La nouvelle séquence part de zéro\./);
  // Annuler : rien ne change
  await page.click('#srSheetBody .sr-cancel');
  assert.deepEqual(await state(), { steps: 1, saved: [], sheet: null });
  // Ne pas enregistrer
  await page.click('#seqNewBtn');
  await page.click('#seqNewDiscard');
  assert.deepEqual(await state(), { steps: 0, saved: [], sheet: null });
  // Séquence vide : aussitôt, sans question
  await page.click('#seqNewBtn');
  assert.deepEqual(await state(), { steps: 0, saved: [], sheet: null });
  // Enregistrer : nouvelle entrée, puis séquence vide
  await dirty();
  await page.click('#seqNewBtn');
  await page.click('#seqNewSave');
  assert.deepEqual(await state(), { steps: 0, saved: ['Séq. 12'], sheet: null });
  // Chargée puis modifiée : la feuille dit que l'entrée enregistrée reste telle quelle
  await page.evaluate(() => { loadSavedSeq(seqSaved[0].id); _seq.steps = []; seqSave(); renderSeq(); });
  await page.click('#seqNewBtn');
  assert.match(await text(page, '#srSheetBody'), /« Séq\. 12 » enregistrée reste telle quelle\./);
  await page.click('#seqNewDiscard');
  assert.deepEqual(await state(), { steps: 0, saved: ['Séq. 12'], sheet: null });
  // Sous-onglet « Enregistrées » : bouton masqué
  await page.evaluate(() => setSeqView('saved'));
  assert.equal(await page.locator('#seqNewBtn').isVisible(), false);
  assert.deepEqual(errors, []);
  await close();
});

test('« + Nouvelle discussion » : fil vierge ; Enregistrer / Ne pas enregistrer ; refus si la discussion est ouverte', async () => {
  const { page, errors, close } = await remote();
  const state = () => page.evaluate(() => ({ msgs: _chat.msgs.length, name: _chat.name, actor: _chat.actor, saved: chatSaved.map((e) => e.name), sheet: _sheet && _sheet.kind }));
  const dirty = () => page.evaluate(() => { _chat.name = 'Léa'; _chat.msgs.push({ id: 'x1', from: 'contact', text: 'Salut' }); chatSave(); renderChatPanel(); });
  await page.evaluate(() => { switchTab('call'); setCallKind('discussion'); });
  assert.equal(await text(page, '#dcNewBtn'), '+ NOUVELLE DISCUSSION');
  // Fil d'exemple, inchangé : aussitôt
  await page.click('#dcNewBtn');
  await waitFor(page, () => _chat.msgs.length === 0);
  assert.deepEqual(await state(), { msgs: 0, name: '', actor: 'Julie', saved: [], sheet: null });
  await dirty();
  await page.click('#dcNewBtn');
  await waitFor(page, () => !!_sheet);
  assert.equal(await text(page, '#srSheetTitle'), 'Enregistrer « Léa ‹› Julie » avant ?');
  assert.match(await text(page, '#srSheetBody'), /La nouvelle discussion part d'un fil vide \(même comédien, même style\)\./);
  await page.click('#srSheetBody .sr-cancel');
  assert.deepEqual(await state(), { msgs: 1, name: 'Léa', actor: 'Julie', saved: [], sheet: null });
  await page.click('#dcNewBtn');
  await waitFor(page, () => !!_sheet);
  await page.click('#chatNewDiscard');
  await waitFor(page, () => !_sheet);
  assert.deepEqual(await state(), { msgs: 0, name: '', actor: 'Julie', saved: [], sheet: null });
  await dirty();
  await page.click('#dcNewBtn');
  await waitFor(page, () => !!_sheet);
  await page.click('#chatNewSave');
  await waitFor(page, () => !_sheet);
  assert.deepEqual(await state(), { msgs: 0, name: '', actor: 'Julie', saved: ['Léa ‹› Julie'], sheet: null });
  // Discussion ouverte sur les écrans : refus
  await page.evaluate(() => { _chat.open = true; });
  await page.click('#dcNewBtn');
  await waitFor(page, () => !!_sheet);
  assert.equal(await text(page, '#srSheetTitle'), 'Impossible pour l\'instant');
  assert.match(await text(page, '#srSheetBody'), /fermez-la avant d'en commencer une nouvelle/);
  await page.evaluate(() => { _chat.open = false; closeSheet(); setChatView('saved'); });
  assert.equal(await page.locator('#dcNewBtn').isVisible(), false, 'masqué sur la liste des enregistrées');
  assert.deepEqual(errors, []);
  await close();
});
