// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Couche Tel retrouvée par une télécommande rechargée (tel:state) : après le rechargement de la
// télécommande, « Retirer de l'écran » / Raccrocher réapparaissent pour ce que l'écran affiche
// (discussion ouverte, SMS sur écran verrouillé, appel qui sonne), et une couleur envoyée ensuite
// retire la couche (le dernier envoi gagne). Écran ancien (sans tel:state) : comme avant.
// + « Écrire… » refusé par la garde d'une séquence : rien n'est ajouté au fil.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
async function rig(seed) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('call'); SEQ_GO_GUARD_MS = 0; });
  await connected(rp);
  const s = await openPage(browser, { broker, seed: seed * 10, autoConnect: true, hash: await pairingHash(rp) });
  await connected(s.page);
  const sid = await s.page.evaluate(() => screenId());
  await waitFor(rp, () => _screenOfSender.size === 1 && scrList().length === 1);
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(200);
  await broker.flush();
  await rp.evaluate((id) => scrSetTarget({ k: 'screen', id }), sid);
  return { broker, rp, sp: s.page, sid, errs: [remote.errors, s.errors], close: async () => { await s.close(); await remote.close(); } };
}
// Télécommande rechargée : même session, mêmes écrans appairés ; l'écran répond à son « hello »
async function reloadRemote(r) {
  await r.rp.reload();
  await r.rp.evaluate(() => { startMode('remote'); switchTab('call'); SEQ_GO_GUARD_MS = 0; });
  await connected(r.rp);
  await waitFor(r.rp, (id) => scrKnown(id) && scrState(id).caps !== null, r.sid, { timeout: 8000 });
  await r.rp.evaluate((id) => scrSetTarget({ k: 'screen', id }), r.sid);
}
const topLayer = (page) => page.evaluate(() => {
  const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  return el ? (el.closest('#screen-chat') ? 'chat' : el.closest('#screen-call') ? 'call' : el.closest('#screen-phone') ? 'phone' : 'autre') : null;
});
const telOnText = (rp) => rp.evaluate(() => {
  const e = document.getElementById('telOn');
  if (!e || e.style.display === 'none') return null;
  return [...e.querySelectorAll('.on-row')].map((r) => r.querySelector('b').textContent + ' · ' + r.querySelector('.on-t span').textContent + (r.querySelector('.on-x') ? ' · ' + r.querySelector('.on-x').textContent : '')).join(' | ');
});
const noErrors = (r) => { for (const e of r.errs) assert.deepEqual(e, []); };

test('discussion ouverte, télécommande rechargée qui a perdu son fil ouvert : ligne « Retirer de l\'écran », fil local intact, la couleur se voit', async () => {
  const r = await rig(91);
  const { rp, sp } = r;
  await rp.evaluate(() => { setCallKind('discussion'); openChatOnTarget(); sendNextChatMessage(); });
  await waitFor(sp, () => !!document.querySelector('#screen-chat .pt-b'));
  // La télécommande revient sans savoir que la discussion est ouverte (mémoire perdue) et avec un autre nom de fil
  await rp.evaluate(() => { const o = JSON.parse(localStorage.getItem('setremote-chat-v1')); o.open = false; o.screens = null; o.name = 'Papa'; localStorage.setItem('setremote-chat-v1', JSON.stringify(o)); });
  await reloadRemote(r);
  await waitFor(rp, (id) => !!scrState(id).chatShown, r.sid);
  assert.equal(await rp.evaluate(() => _chat.open), false);
  assert.equal(await topLayer(sp), 'chat');
  await waitFor(rp, () => document.getElementById('telOn').style.display !== 'none');
  assert.equal(await telOnText(rp), 'Discussion « Maman » · affiché sur Écran 1 · Retirer de l\'écran', 'nom annoncé par l\'écran, pas celui du fil local');
  const thread = await rp.evaluate(() => JSON.stringify([_chat.name, _chat.msgs, _chat.sent]));
  // Retirer de l'écran : chat:close, le fil de la télécommande n'est pas touché
  await rp.click('#telOn .on-x');
  await waitFor(sp, () => document.getElementById('screen-chat').style.display === 'none');
  await waitFor(rp, () => document.getElementById('telOn').style.display === 'none');
  assert.equal(await rp.evaluate(() => JSON.stringify([_chat.name, _chat.msgs, _chat.sent])), thread);
  assert.equal(await rp.evaluate((id) => scrState(id).chatShown, r.sid), null);
  // Le dernier envoi gagne : rouvrir (depuis l'écran) puis une couleur
  await rp.evaluate(() => { openChatOnTarget(); sendNextChatMessage(); });
  await waitFor(sp, () => document.getElementById('screen-chat').style.display !== 'none');
  await reloadRemote(r);
  await rp.evaluate(() => { const o = JSON.parse(localStorage.getItem('setremote-chat-v1')); o.open = false; localStorage.setItem('setremote-chat-v1', JSON.stringify(o)); });
  await rp.evaluate(() => { _chat.open = false; });
  await sp.evaluate(() => screenSendTel());
  await waitFor(rp, (id) => !!scrState(id).chatShown, r.sid);
  await rp.evaluate(() => sendMsg({ type: 'color', color: '#E02020' }));
  await waitFor(sp, () => screenBaseColor.toLowerCase() === '#e02020' && document.getElementById('screen-chat').style.display === 'none');
  assert.equal(await topLayer(sp), 'autre');
  noErrors(r);
  await r.close();
});

test('discussion ouverte, rechargement ordinaire (fil gardé) : la ligne reste, la couleur retire la discussion', async () => {
  const r = await rig(92);
  const { rp, sp } = r;
  await rp.evaluate(() => { setCallKind('discussion'); openChatOnTarget(); sendNextChatMessage(); });
  await waitFor(sp, () => !!document.querySelector('#screen-chat .pt-b'));
  await reloadRemote(r);
  await waitFor(rp, () => _chat.open);
  assert.match(await telOnText(rp), /^Discussion « Maman » · affiché sur Écran 1 · Retirer de l'écran$/);
  await rp.evaluate(() => sendMsg({ type: 'color', color: '#20E020' }));
  await waitFor(sp, () => screenBaseColor.toLowerCase() === '#20e020' && document.getElementById('screen-chat').style.display === 'none');
  assert.equal(await topLayer(sp), 'autre');
  noErrors(r);
  await r.close();
});

test('SMS sur écran verrouillé, télécommande rechargée : « SMS » retrouvé, Retirer de l\'écran, la couleur se voit', async () => {
  const r = await rig(93);
  const { rp, sp } = r;
  await rp.evaluate(() => sendMsg({ type: 'call:start', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ?', appName: 'SMS', ring: 'silent', lock: { time: '', date: '' } }));
  await waitFor(sp, () => _callState === 'notif');
  await reloadRemote(r);
  await waitFor(rp, (id) => !!scrState(id).call, r.sid);
  assert.deepEqual(await rp.evaluate((id) => { const c = scrState(id).call; return [c.kind, c.name]; }, r.sid), ['sms', 'Maman']);
  await waitFor(rp, () => document.getElementById('telOn').style.display !== 'none');
  assert.equal(await telOnText(rp), 'SMS « Maman » · affiché sur Écran 1 · Retirer de l\'écran');
  assert.equal(await rp.evaluate((id) => scrState(id).chatShown, r.sid), null);
  // Retirer de l'écran
  await rp.click('#telOn .on-x');
  await waitFor(sp, () => _callState === 'idle');
  await waitFor(rp, () => document.getElementById('telOn').style.display === 'none');
  // Même chose avec le dernier envoi : SMS de nouveau, rechargement, couleur
  await rp.evaluate(() => sendMsg({ type: 'call:start', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ?', appName: 'SMS', ring: 'silent', lock: { time: '', date: '' } }));
  await waitFor(sp, () => _callState === 'notif');
  await reloadRemote(r);
  await waitFor(rp, (id) => !!scrState(id).call, r.sid);
  await rp.evaluate(() => sendMsg({ type: 'color', color: '#2020E0' }));
  await waitFor(sp, () => _callState === 'idle' && screenBaseColor.toLowerCase() === '#2020e0');
  await sleep(500); // sortie animée du faux écran verrouillé
  assert.equal(await topLayer(sp), 'autre');
  noErrors(r);
  await r.close();
});

test('appel qui sonne, télécommande rechargée : la barre propose Raccrocher / Décrocher, la couleur coupe la sonnerie', async () => {
  const r = await rig(94);
  const { rp, sp } = r;
  await rp.evaluate(() => sendMsg({ type: 'call:start', kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent' }));
  await waitFor(sp, () => _callState === 'ringing');
  await reloadRemote(r);
  await waitFor(rp, (id) => !!scrState(id).call, r.sid);
  await rp.evaluate(() => setCallKind('call'));
  await waitFor(rp, () => _telCall.phase === 'ringing');
  const vis = (id) => rp.evaluate((id) => getComputedStyle(document.getElementById(id)).display !== 'none', id);
  assert.equal(await vis('callHangBtn'), true, 'Raccrocher');
  assert.equal(await vis('callAnswerBtn'), true, 'Décrocher');
  assert.equal(await vis('callTriggerBtn'), false);
  assert.match(await telOnText(rp), /^Appel « Maman » · affiché sur Écran 1$/);
  // L'écran décroche : « En ligne » (call:state) puis, rechargée en ligne, Raccrocher seul
  await sp.evaluate(() => screenCallAnswer());
  await waitFor(rp, () => _telCall.phase === 'incall');
  await reloadRemote(r);
  await waitFor(rp, () => _telCall.phase === 'incall');
  assert.equal(await vis('callHangBtn'), true);
  assert.equal(await vis('callAnswerBtn'), false);
  // Une couleur raccroche (le dernier envoi gagne) et se voit
  await rp.evaluate(() => sendMsg({ type: 'color', color: '#E0E020' }));
  await waitFor(sp, () => _callState === 'idle' && screenBaseColor.toLowerCase() === '#e0e020');
  await sleep(500);
  assert.equal(await topLayer(sp), 'autre');
  noErrors(r);
  await r.close();
});

test('écran sans couche : tel null oublie une couche supposée (reconnexion) ; sans tel:state (ancien écran), rien ne change', async () => {
  const r = await rig(95);
  const { rp, sp, sid } = r;
  await rp.evaluate((id) => { scrState(id).call = { kind: 'sms', name: 'Fantôme', state: null }; scrChanged(); }, sid);
  await sp.evaluate(() => screenSendTel());
  await waitFor(rp, (id) => scrState(id).call === null, sid);
  // Ancien écran : aucun tel:state n'arrive, ce que la télécommande sait reste
  await rp.evaluate((id) => { scrState(id).call = { kind: 'sms', name: 'Connu', state: null }; }, sid);
  await sp.evaluate(() => { window.screenSendTel = () => {}; }); // l'ancien écran n'a pas cette fonction
  await sp.evaluate(() => sendCaps());
  await sleep(400);
  assert.equal(await rp.evaluate((id) => scrState(id).call && scrState(id).call.name, sid), 'Connu');
  noErrors(r);
  await r.close();
});

test('« Écrire… » refusé par la séquence : rien n\'est ajouté au fil ; accepté après « Envoyer quand même »', async () => {
  const r = await rig(96);
  const { rp, sp, sid } = r;
  await rp.evaluate((id) => {
    callList.sms = [{ id: 's1', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ?', appName: 'SMS', appColor: '#2f8cf0', ring: 'silent', ringVolume: 1, lock: { time: '', date: '' }, hasPhoto: false, hasAudio: false }];
    persistCallList();
    _seq.steps = seqSanitizeSteps([{ id: 'a1', kind: 'sms', ref: 's1', trig: { k: 'go' }, target: { k: 'screen', id }, opt: {} }]);
    seqSave(); switchTab('seq'); setSeqMode('play');
  }, sid);
  await rp.click('#seqGoBtn');
  await waitFor(rp, () => seqOwnedIds().size === 1);
  await rp.evaluate(() => { switchTab('call'); setCallKind('discussion'); });
  const n = await rp.evaluate(() => _chat.msgs.length);
  await rp.evaluate(() => { toggleChatWrite(); document.getElementById('dcWriteText').value = 'Rentre vite'; sendImprovisedChat(); });
  assert.equal(await rp.evaluate(() => appConfirmShown()), true, 'la confirmation « Reprendre la main » s\'ouvre');
  assert.equal(await rp.evaluate(() => _chat.msgs.length), n, 'rien d\'ajouté au fil');
  assert.equal(await rp.evaluate(() => _chat.msgs.some((m) => m.text === 'Rentre vite')), false);
  assert.equal(await rp.evaluate(() => _chat.open), false);
  // Envoyer quand même : la main est reprise, le message est ajouté et posté
  await rp.click('#acOk');
  await waitFor(rp, () => _chat.msgs.some((m) => m.text === 'Rentre vite'));
  assert.equal(await rp.evaluate(() => _chat.msgs.length), n + 1);
  await waitFor(sp, () => [...document.querySelectorAll('#screen-chat .pt-b')].some((b) => /Rentre vite/.test(b.textContent)));
  noErrors(r);
  await r.close();
});
