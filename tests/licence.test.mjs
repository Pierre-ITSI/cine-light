// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Licence Tel + Séquence (14-licence.js, 76-demos.js, 77-licence-ui.js ;
// contrat : docs/LICENCE-API.md) avec un faux service de licence
// (tests/helpers/licence.mjs) qui applique le contrat et signe ses jetons :
//   • version libre (défaut) : rien ne change, aucune requête, aucune clé ;
//   • configuration : SETREMOTE_CONFIG ne peut que restreindre ;
//   • identifiant d'appareil (clé non extractible, IndexedDB, stable) ;
//   • aperçu Tel / Séquence : démos jouables, verrous, données de
//     l'utilisateur intactes puis rendues à l'arrivée de la licence ;
//   • vérification signée, jeton vérifié, hors ligne, révocation, échéance ;
//   • statistiques anonymes une fois par jour et par mode ;
//   • Réglages › Licence, achat seulement hors de l'app native.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { launchBrowser, openPage, waitFor, fileUrl, INDEX_PATH, ROOT } from './helpers/harness.mjs';
import { FakeLicenceServer, licenceInit, payloadFor, signToken, deriveId, DEVICE_ID, API } from './helpers/licence.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const DAY = 86400e3;
// Page télécommande, service attaché AVANT le chargement
async function openLic(opts = {}) {
  const { server = new FakeLicenceServer(), init = licenceInit(opts.lic), preload = null, remote = true } = opts;
  const p = await openPage(browser, { waitLoad: false, init });
  if (preload) await p.context.addInitScript(preload.fn, preload.arg);
  await server.attach(p.page);
  const requests = [];
  p.context.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
  await p.page.goto(fileUrl(INDEX_PATH));
  if (remote) await p.page.evaluate(() => startMode('remote'));
  return { ...p, server, requests };
}
const sentSpy = (page) => page.evaluate(() => {
  window.__sent = [];
  const orig = window.sendMsg;
  window.sendMsg = (m) => { window.__sent.push(JSON.parse(JSON.stringify(m))); return orig(m); };
});
const idReady = (page) => waitFor(page, () => !!licDeviceId());
// Première vérification terminée (jeton reçu, ou échec)
const checked = (page) => waitFor(page, () => !!licDeviceId() && !_lic.busy && (_lic.checked > 0 || !!_lic.error));
const lsKeys = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));

// Données de l'utilisateur déjà là (version précédente) : un appel, une séquence
const USER_DATA = {
  fn: () => {
    if (localStorage.getItem('setremote-call-list-v1')) return;
    localStorage.setItem('setremote-call-list-v1', JSON.stringify({ v: 1, call: [{ id: 'eUser1', kind: 'call', style: 'tonal', name: 'Agent Martin', label: 'Bureau', ringVolume: 1 }], sms: [], notif: [] }));
    localStorage.setItem('setremote-seq-v1', JSON.stringify({ v: 1, name: 'Ma scène', steps: [{ id: 'sU1', kind: 'call', ref: 'eUser1', target: { k: 'all' }, trig: { k: 'go' }, opt: {} }], savedId: null }));
    localStorage.setItem('setremote-chat-v1', JSON.stringify({ v: 2, name: 'Léa', actor: 'Tom', style: 'glass', msgs: [{ id: 'u1', from: 'contact', text: 'Salut' }], sent: [] }));
  },
};

test('version libre (défaut) : aucune licence, aucune requête, aucune clé, interface inchangée', async () => {
  const p = await openPage(browser, { waitLoad: false });
  const requests = [];
  p.context.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
  await p.page.goto(fileUrl(INDEX_PATH));
  await p.page.evaluate(() => { startMode('remote'); switchTab('call'); openSettings(); });
  await new Promise((r) => setTimeout(r, 300));
  const st = await p.page.evaluate(async () => ({
    on: LIC_ON, licensing: LICENSING, tel: licenceHas('tel'), seq: licenceHas('seq'), id: licDeviceId(),
    locked: licLocked('tel') || licLocked('seq'), masked: _lsMask.size,
    banners: [...document.querySelectorAll('.lic-pv')].map((e) => e.style.display),
    cards: ['stLicCard', 'stLicIdCard'].map((id) => document.getElementById(id).style.display),
    inert: document.querySelectorAll('[inert]').length,
    dbs: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
    stats: localStorage.getItem('setremote-stats-v1'),
    seqName: _seq.name, calls: callList.call.length,
  }));
  assert.deepEqual(p.errors, []);
  assert.deepEqual(requests, [], 'aucune requête');
  assert.deepEqual([st.on, st.licensing, st.tel, st.seq, st.id, st.locked, st.masked], [false, 'off', true, true, null, false, 0]);
  assert.deepEqual(st.banners, ['none', 'none']);
  assert.deepEqual(st.cards, ['none', 'none'], 'Réglages : pas de section Licence');
  assert.equal(st.inert, 0);
  assert.ok(!st.dbs.includes('setremote-licence'), 'aucune clé d\'appareil créée');
  assert.equal(st.stats, null);
  assert.deepEqual([st.seqName, st.calls], ['', 0], 'contenu de l\'utilisateur (vide), pas de démo');
  await p.close();
});

test('configuration : SETREMOTE_CONFIG ne peut que restreindre (build officiel ni désactivable ni détournable)', () => {
  const src = readFileSync(path.join(ROOT, 'web/js/01-config.js'), 'utf8');
  const run = (cfg, build) => {
    const code = (build ? src.replace(/const LICENCE_BUILD = Object\.freeze\(\{[^}]*\}\);/, `const LICENCE_BUILD = Object.freeze(${JSON.stringify(build)});`) : src)
      + '\n;({ LICENSING, LICENCE_PUBKEY, LICENCE_API, LICENCE_BUY_URL })';
    return JSON.parse(JSON.stringify(vm.runInNewContext(code, { window: { SETREMOTE_CONFIG: cfg }, console })));
  };
  const KEY = 'A'.repeat(122), KEY2 = 'B'.repeat(122);
  assert.deepEqual(run({}), { LICENSING: 'off', LICENCE_PUBKEY: '', LICENCE_API: '', LICENCE_BUY_URL: '' }, 'défaut du dépôt');
  assert.match(src, /^const LICENCE_BUILD = Object\.freeze\(\{ LICENSING: 'off', LICENCE_PUBKEY: '', LICENCE_API: '', LICENCE_BUY_URL: '' \}\);$/m);
  // Service déduit du relais
  assert.equal(run({ RELAY_URL: 'wss://hub.itsi-app.com' }).LICENCE_API, 'https://hub.itsi-app.com');
  assert.equal(run({ RELAY_URL: 'ws://127.0.0.1:8080' }).LICENCE_API, 'http://127.0.0.1:8080');
  // Restreindre : permis
  assert.deepEqual(run({ LICENSING: 'on', LICENCE_PUBKEY: KEY, LICENCE_API: 'https://lic.test', LICENCE_BUY_URL: 'https://lic.test/licence' }),
    { LICENSING: 'on', LICENCE_PUBKEY: KEY, LICENCE_API: 'https://lic.test', LICENCE_BUY_URL: 'https://lic.test/licence' });
  // Valeurs invalides ignorées
  assert.deepEqual(run({ LICENSING: 'yes', LICENCE_PUBKEY: 'court', LICENCE_API: 'http://lic.test', LICENCE_BUY_URL: 'javascript:alert(1)' }),
    { LICENSING: 'off', LICENCE_PUBKEY: '', LICENCE_API: '', LICENCE_BUY_URL: '' });
  // Build officiel : ni désactivé, ni autre clé, ni autre service
  const official = { LICENSING: 'on', LICENCE_PUBKEY: KEY, LICENCE_API: 'https://hub.itsi-app.com', LICENCE_BUY_URL: 'https://hub.itsi-app.com/licence' };
  assert.deepEqual(run({ LICENSING: 'off', LICENCE_PUBKEY: KEY2, LICENCE_API: 'https://evil.test', LICENCE_BUY_URL: 'https://evil.test/' }, official), official);
});

test('identifiant d\'appareil : dérivé de la clé publique, clé privée non extractible, stable, normalisation', async () => {
  const p = await openLic();
  await idReady(p.page);
  const r = await p.page.evaluate(async () => {
    const db = await _licDb();
    const rec = await _licDbDo(db, 'readonly', (st) => st.get('device'));
    let exported = 'oui';
    try { await crypto.subtle.exportKey('jwk', rec.priv); } catch (_) { exported = 'non'; }
    return {
      id: licDeviceId(), pub: _lic.pub, extractable: rec.priv.extractable, exported, ls: localStorage.getItem('setremote-licence-key-v1'),
      norm: ['k7q2 9xmb', 'K7Q2-9XMB', 'k7q29xmb', 'K7Q2-OILB', 'K7Q2-9XMU', 'K7Q2-9XM', ''].map(licNormalizeId),
    };
  });
  assert.match(r.id, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(r.id, deriveId(Buffer.from(r.pub, 'base64url')), 'id = Crockford(SHA-256(SPKI))[0..40 bits]');
  assert.equal(Buffer.from(r.pub, 'base64url').length, 91, 'SPKI DER P-256');
  assert.equal(r.extractable, false);
  assert.equal(r.exported, 'non');
  assert.equal(r.ls, null, 'IndexedDB disponible : pas de repli localStorage');
  assert.deepEqual(r.norm, ['K7Q2-9XMB', 'K7Q2-9XMB', 'K7Q2-9XMB', 'K7Q2-011B', null, null, null]);
  // Même appareil (même stockage) : même identifiant
  await p.page.reload();
  await idReady(p.page);
  assert.equal(await p.page.evaluate(() => licDeviceId()), r.id);
  await p.close();
});

test('aperçu sans licence : bandeaux, démos jouables, verrous, données de l\'utilisateur intactes', async () => {
  const p = await openLic({ preload: USER_DATA });
  const before = await p.page.evaluate(() => ['setremote-call-list-v1', 'setremote-seq-v1', 'setremote-chat-v1'].map((k) => localStorage.getItem(k)));
  await checked(p.page);
  await sentSpy(p.page);
  await p.page.evaluate(() => switchTab('call'));
  const tel = await p.page.evaluate(() => ({
    locked: [licLocked('tel'), licLocked('seq')], banner: document.getElementById('licPvTel').style.display,
    id: document.querySelector('#licPvTel .lic-id-txt').textContent, buy: document.querySelector('#licPvTel .lic-pv-buy').style.display,
    text: document.querySelector('#licPvTel p').textContent,
    name: document.getElementById('callName').value, label: document.getElementById('callLabel').value,
    lists: [callList.call.map((e) => e.name), callList.sms.map((e) => e.msg), callList.notif.map((e) => e.appName)],
    chat: [_chat.name, _chat.msgs.length], saved: chatSaved.map((e) => e.contact), callers: callers.map((e) => e.name),
    inert: ['telStyleBtn', 'callName', 'callerSaveBtn', 'callListSave', 'callListDel', 'dcAdd', 'dcContactPanel', 'callWhoSaved', 'dcNewBtn'].map((id) => document.getElementById(id).inert),
    free: ['callTriggerBtn', 'callListGo', 'dcGo', 'callkind-sms'].map((id) => document.getElementById(id).inert),
    ex: getComputedStyle(document.getElementById('callWhoLabel'), '::after').content,
  }));
  assert.deepEqual(tel.locked, [true, true]);
  assert.equal(tel.banner, '');
  assert.equal(tel.id, await p.page.evaluate(() => licDeviceId()));
  assert.equal(tel.buy, '', 'version web : « Obtenir une licence »');
  assert.match(tel.text, /vos propres appels, SMS et discussions\.$/);
  assert.deepEqual([tel.name, tel.label], ['Maman', 'mobile']);
  assert.deepEqual(tel.lists, [['Maman'], ['Tu es où ?'], ['Chatly']], 'un appel, un SMS, une notification');
  assert.deepEqual(tel.chat, ['Maman', 5]);
  assert.deepEqual([tel.saved, tel.callers], [['Maman'], ['Maman']]);
  assert.ok(tel.inert.every(Boolean), 'réglages et enregistrements verrouillés');
  assert.ok(tel.free.every((v) => !v), 'envois libres');
  assert.equal(tel.ex, '" · exemple"');
  // Jouer les démos, sans limite ; les verrous tiennent aussi par le code
  const played = await p.page.evaluate(async () => {
    for (let i = 0; i < 8; i++) await triggerCall();
    await triggerSelectedCallEntry();
    openTelStyle(); openCallersSheet(); addChatMessage(); await saveCurrentCall(); openSaveCallSheet();
    // Liste (maquettes 43, 43c) : entrée chargée (boutons verrouillés), menu « ⋯ » réduit à « Charger » ;
    // mettre à jour, renommer, dupliquer, supprimer : sans effet
    const id = callList.call[0].id;
    await selectCallEntry(id);
    const upd = [getComputedStyle(document.getElementById('callListUpd')).display !== 'none', document.getElementById('callListUpd').inert];
    openCallEntryMenu(id);
    const menu = [...document.querySelectorAll('#srSheetBody button')].map((b) => b.textContent);
    closeSheet();
    const r = [await updateCallEntry(id), renameCallEntry(id, 'X'), await duplicateCallEntry(id), deleteCallEntry(id)];
    return { starts: __sent.filter((m) => m.type === 'call:start').map((m) => m.name), style: telStyleIsOpen(), sheet: !!_sheet, msgs: _chat.msgs.length, calls: callList.call.length,
      upd, menu, r, title: callList.call[0].title };
  });
  assert.equal(played.starts.length, 9);
  assert.ok(played.starts.every((n) => n === 'Maman'));
  assert.deepEqual([played.style, played.sheet, played.msgs, played.calls], [false, false, 5, 1]);
  assert.deepEqual(played.upd, [true, true], '« Mettre à jour » affiché mais verrouillé');
  assert.deepEqual(played.menu, ['Charger dans l\'onglet', 'Fermer']);
  assert.deepEqual([...played.r, played.title], [false, undefined, null, false, undefined]);
  // Séquence : démo « Batterie à plat », GO joue le SMS de Maman
  await p.page.evaluate(() => switchTab('seq'));
  const seq = await p.page.evaluate(async () => {
    setConnStatus('connected');
    remoteNoteScreen('s0SCRAAAAA', { type: 'caps', screenId: 'JulieScreen00001' });
    seqGo();
    await _seqChain;
    openSeqStep(_seq.steps[0].id); openPhoneParams('seq'); openSaveSeqSheet(); ppRemoveWall(); ppPickWall();
    return {
      name: _seq.name, kinds: _seq.steps.map((s) => s.kind), trig: _seq.steps.map((s) => s.trig.k + (s.trig.g ? ':' + s.trig.g : '')),
      missing: _seq.steps.filter((s) => !seqRefItem(s)).length, banner: document.getElementById('licPvSeq').style.display,
      text: document.querySelector('#licPvSeq p').textContent,
      sms: __sent.filter((m) => m.type === 'call:start' && m.kind === 'sms').map((m) => m.msg),
      editor: !!_seqEdit, pp: !!_pp, sheet: !!_sheet, saved: seqSaved.length, chatOpt: _seq.steps[2].opt, label: seqStepLabel(_seq.steps[2]),
      inert: ['seqAddBtn', 'seqPhoneBtn', 'seqTab-saved', 'seqRows', 'seqNewBtn'].map((id) => document.getElementById(id).inert),
      ctl: ['seqGoBtn', 'seqBackBtn', 'seqStopBtn'].map((id) => document.getElementById(id).inert),
      prj: ['stPrjOpen', 'stPrjExport', 'stPrjImport', 'project-view'].map((id) => document.getElementById(id).inert || !!document.getElementById(id).closest('[inert]')),
    };
  });
  assert.equal(seq.name, 'Démo — « Batterie à plat »');
  assert.deepEqual(seq.kinds, ['sms', 'unlock', 'chat', 'battery', 'off']);
  assert.deepEqual(seq.trig, ['go', 'gesture:touch', 'gesture:unlock', 'after', 'after']);
  assert.equal(seq.missing, 0);
  assert.equal(seq.banner, '');
  assert.match(seq.text, /vos propres séquences\.$/);
  assert.deepEqual(seq.sms, ['Tu es où ?'], 'GO : SMS de Maman sur l\'écran');
  assert.deepEqual([seq.editor, seq.pp, seq.sheet, seq.saved], [false, false, false, 0]);
  assert.deepEqual(seq.chatOpt, { auto: true, full: true }, 'démo : discussion tout automatique (maquette 41), jouée sans personne');
  assert.equal(seq.label, 'Discussion « Maman » → réponse · auto complète');
  assert.ok(seq.inert.every(Boolean));
  assert.ok(seq.ctl.every((v) => !v), 'GO / ↶ / STOP libres');
  assert.deepEqual(seq.prj, [false, false, false, false], 'projets : export, import, liste disponibles en aperçu');
  // Rien n'a touché les données de l'utilisateur
  const after = await p.page.evaluate(() => ['setremote-call-list-v1', 'setremote-seq-v1', 'setremote-chat-v1'].map((k) => localStorage.getItem(k)));
  assert.deepEqual(after, before);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('licence attribuée : vérification signée, contenu de l\'utilisateur rendu sans recharger, puis révocation', async () => {
  const server = new FakeLicenceServer();
  const p = await openLic({ server, preload: USER_DATA });
  await checked(p.page);
  const id = await p.page.evaluate(() => licDeviceId());
  // Requête conforme au contrat (le faux service la vérifie)
  assert.equal(server.checks.length, 1);
  assert.deepEqual(server.errors, []);
  const c = server.checks[0];
  assert.deepEqual(Object.keys(c).sort(), ['app', 'id', 'nonce', 'pub', 'sig', 'ts', 'v']);
  assert.equal(c.id, id);
  assert.equal(Buffer.from(c.nonce, 'base64url').length, 16);
  assert.equal(Buffer.from(c.sig, 'base64url').length, 64, 'signature P1363 (r||s)');
  assert.deepEqual(Object.keys(c.app).sort(), ['inst', 'os', 'ver']);
  assert.equal(c.app.inst, 'browser');
  assert.equal(c.app.ver, JSON.parse(readFileSync(path.join(ROOT, 'expo-app/app.json'), 'utf8')).expo.version);
  assert.deepEqual(await p.page.evaluate(() => [licenceHas('tel'), licenceHas('seq'), _lic.payload && _lic.payload.features.length]), [false, false, 0], 'aucune licence : jeton signé sans fonctionnalité');
  // Le propriétaire attache l'appareil : « Vérifier maintenant »
  server.licences.set(id, { features: ['tel', 'seq'], holder: 'Prod Nord', end: Date.now() + 180 * DAY, devices: { n: 3, max: 5 } });
  await p.page.evaluate(() => { switchTab('call'); openSettings(); licCheckNow(); });
  await waitFor(p.page, () => licenceHas('tel') && licenceHas('seq') && !licLocked('tel') && !licLocked('seq'));
  const st = await p.page.evaluate(() => ({
    calls: callList.call.map((e) => e.name), seq: _seq.name, chat: _chat.name, form: document.getElementById('callName').value,
    banners: [...document.querySelectorAll('.lic-pv')].map((e) => e.style.display), inert: document.querySelectorAll('#content-call [inert], #content-seq [inert]').length,
    state: document.getElementById('stLicState').textContent, rows: [...document.querySelectorAll('.st-lic-kv')].map((r) => r.textContent),
    buy: document.getElementById('stLicBuy').style.display, stored: JSON.parse(localStorage.getItem('setremote-licence-v1')),
  }));
  assert.deepEqual([st.calls, st.seq, st.chat, st.form], [['Agent Martin'], 'Ma scène', 'Léa', 'Maman']);
  assert.deepEqual(st.banners, ['none', 'none']);
  assert.equal(st.inert, 0);
  assert.equal(st.state, 'Active');
  assert.deepEqual(st.rows.slice(0, 4), ['TitulaireProd Nord', 'Appareils3 sur 5', 'ComprendTel, Séquence', 'Vérifiéeà l\'instant']);
  assert.match(st.rows[4], /^Hors lignevalable jusqu'au \d+ /);
  assert.equal(st.buy, 'none', 'sous licence : pas de lien d\'achat');
  assert.equal(typeof st.stored.token, 'string');
  // Hors ligne : le dernier jeton valide tient
  server.down = true;
  await p.page.evaluate(() => licCheckNow());
  await waitFor(p.page, () => !_lic.busy && licenceHas('tel') && _lic.error === 'offline');
  assert.equal(await p.page.evaluate(() => document.getElementById('stLicMsg').textContent), 'Hors ligne : vérification impossible pour l\'instant.');
  assert.equal(await p.page.evaluate(() => licLocked('tel')), false);
  // Révocation : jeton valide sans fonctionnalité → aperçu
  server.down = false;
  server.licences.delete(id);
  await p.page.evaluate(() => licCheckNow());
  await waitFor(p.page, () => !licenceHas('tel') && licLocked('tel') && licLocked('seq'));
  assert.deepEqual(await p.page.evaluate(() => [callList.call[0].name, _seq.name]), ['Maman', 'Démo — « Batterie à plat »']);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('jeton : signature d\'une autre clé, autre appareil ou échu → refusé ; Tel sans Séquence', async () => {
  const server = new FakeLicenceServer();
  server.badSig = true;
  const p = await openLic({ server });
  await waitFor(p.page, () => !_lic.busy && _lic.error === 'invalid');
  assert.equal(await p.page.evaluate(() => licenceHas('tel')), false);
  const id = await p.page.evaluate(() => licDeviceId());
  // Jetons forgés côté Node avec la vraie clé du service
  const now = Date.now();
  const lic = { features: ['tel'], holder: 'Solo', end: now + 30 * DAY, devices: { n: 1, max: 1 } };
  const verdict = await p.page.evaluate(async (t) => {
    const out = [];
    for (const x of t) out.push(!!(await licVerifyToken(x)));
    return out;
  }, [await signToken(payloadFor(id, lic, now)), (await signToken(payloadFor(id, lic, now))).replace(/\.(.)/, (_, c) => '.' + (c === 'A' ? 'B' : 'A')), await signToken(payloadFor('ZZZZ-ZZZZ', lic, now))]);
  assert.deepEqual(verdict, [true, false, true], 'signature vérifiée ; l\'id est contrôlé à l\'acceptation');
  const has = await p.page.evaluate(async (t) => {
    const r = [];
    for (const x of t) { _lic.payload = null; await _licAccept(x, Date.now()); _licEmit(); r.push([licenceHas('tel'), licenceHas('seq')]); }
    return r;
  }, [await signToken({ ...payloadFor(id, lic, now), exp: now - 11 * 60e3 }), await signToken({ ...payloadFor(id, lic, now), exp: now - 5 * 60e3 }),
    await signToken(payloadFor('ZZZZ-ZZZZ', lic, now)), await signToken(payloadFor(id, lic, now))]);
  assert.deepEqual(has, [[false, false], [true, false], [false, false], [true, false]], 'échu (marge 10 min), autre appareil, Tel seul');
  // Tel sous licence, Séquence en aperçu : la démo Séquence trouve ses éléments
  await waitFor(p.page, () => !licLocked('tel') && licLocked('seq'));
  const mixed = await p.page.evaluate(() => ({ calls: callList.sms.length, missing: _seq.steps.filter((s) => !seqRefItem(s)).length }));
  assert.deepEqual(mixed, { calls: 0, missing: 0 });
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('statistiques anonymes : une fois par jour et par mode, rien d\'autre que os, ver, mode, inst', async () => {
  const server = new FakeLicenceServer();
  const p = await openLic({ server, remote: false });
  await p.page.evaluate(() => startMode('remote'));
  await waitFor(p.page, () => !!localStorage.getItem('setremote-stats-v1'));
  await p.page.evaluate(async () => { await licStatsPing('remote'); await licStatsPing('remote'); await licStatsPing('screen'); await licStatsPing('screen'); });
  assert.equal(server.stats.length, 2);
  for (const s of server.stats) assert.deepEqual(Object.keys(s).sort(), ['inst', 'mode', 'os', 'v', 'ver']);
  assert.deepEqual(server.stats.map((s) => s.mode), ['remote', 'screen']);
  const stored = JSON.parse(await p.page.evaluate(() => localStorage.getItem('setremote-stats-v1')));
  assert.deepEqual(Object.keys(stored).sort(), ['remote', 'screen']);
  assert.match(stored.remote, /^\d{4}-\d{2}-\d{2}$/, 'la date seulement');
  assert.ok(!JSON.stringify(server.stats).includes(await p.page.evaluate(() => licDeviceId())), 'aucun identifiant');
  await p.close();
});

test('app native : identifiant seul, aucune mention d\'achat ; partage = copie sans Web Share', async () => {
  const p = await openLic({ lic: { native: true } });
  await checked(p.page);
  await p.page.evaluate(() => { switchTab('call'); openSettings(); });
  const st = await p.page.evaluate(() => ({
    native: IN_NATIVE_APP, buy: [...document.querySelectorAll('.lic-pv-buy, #stLicBuy')].map((e) => e.style.display),
    note: document.getElementById('stLicBuyNote').style.display, id: document.getElementById('stLicId').textContent,
    inst: licAppInfo(),
  }));
  assert.equal(st.native, true);
  assert.deepEqual(st.buy, ['none', 'none', 'none']);
  assert.equal(st.note, 'none');
  assert.equal(st.id, await p.page.evaluate(() => licDeviceId()));
  assert.deepEqual([st.inst.os, st.inst.inst], ['ios', 'native']);
  await p.close();
});

test('captures : identifiant d\'appareil imposé = celui attendu', async () => {
  const p = await openLic({ lic: { fixedDevice: true } });
  await idReady(p.page);
  assert.equal(await p.page.evaluate(() => licDeviceId()), DEVICE_ID);
  await p.close();
});
