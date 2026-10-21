// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Audio de l'appel décroché : réglages de la vue « Au décroché » (délai avant la voix, sortie du son,
// écran noir), leur persistance (entrées enregistrées, projets), délai de la voix (horloge simulée),
// bouton « Haut-parleur » synchronisé dans les deux sens (télécommande ↔ écran), et pont natif
// (audio:* émis seulement dans l'app, jamais dans le navigateur).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const remote = async (opts = {}) => {
  const p = await openPage(browser, opts);
  await p.page.evaluate(() => { startMode('remote'); switchTab('call'); });
  return p;
};
const val = (page, id) => page.evaluate((id) => document.getElementById(id).value, id);
const setSlider = (page, id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
const shown = (page, id) => page.evaluate((id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; }, id);

// ───────────────────────────── Vue « Au décroché » ─────────────────────────────

test('vue « Au décroché » : délai, sortie du son et écran noir, jamais désactivés sur la télécommande ; titres en minuscules', async () => {
  const { page, errors, close } = await remote();
  await page.click('#callAnswerBlock');
  assert.equal(await page.textContent('#tdTitle'), 'Au décroché');
  // Valeurs d'origine : voix tout de suite, à l'oreille, écran noir
  assert.equal(await val(page, 'callVoiceDelay'), '0');
  assert.equal(await page.textContent('#callVoiceDelayVal'), '0 s');
  assert.equal(await page.getAttribute('#callroute-ear', 'aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.getElementById('callProxToggle').checked), true);
  assert.deepEqual(await page.evaluate(() => [document.getElementById('callVoiceDelay').min, document.getElementById('callVoiceDelay').max]), ['0', '15']);
  // Cartes visibles, rien de désactivé (navigateur compris : c'est l'écran de jeu qui décide)
  for (const id of ['tdAnswer', 'tdAnswerRoute', 'tdAnswerProx', 'tdAnswerNote']) assert.equal(await shown(page, id), true, id);
  assert.equal(await page.evaluate(() => ['callroute-ear', 'callroute-speaker', 'callProxToggle', 'callVoiceDelay'].some((id) => document.getElementById(id).disabled)), false);
  assert.equal(await page.textContent('#tdAnswerNote'), 'Son à l\'oreille et écran noir : uniquement sur les écrans de jeu avec l\'app native');
  // Titres de section : minuscules comme le reste de l'app (ni capitales ni lettres espacées)
  assert.deepEqual(await page.evaluate(() => ['#tdAnswer .panel-label', '#tdAnswerRoute .panel-label', '#tdAnswerProx .panel-label', '#tdAnswer .slider-header label']
    .map((q) => { const c = getComputedStyle(document.querySelector(q)); return [c.textTransform, c.letterSpacing]; })), Array(4).fill(['none', 'normal']));
  assert.deepEqual(await page.$$eval('#tdAnswerRoute .panel-label, #tdAnswerProx .panel-label', (l) => l.map((x) => x.textContent)), ['Sortie du son', 'Capteur de proximité']);
  // Réglages
  await setSlider(page, 'callVoiceDelay', 4);
  assert.equal(await page.textContent('#callVoiceDelayVal'), '4 s');
  await page.click('#callroute-speaker');
  assert.equal(await page.getAttribute('#callroute-speaker', 'aria-pressed'), 'true');
  assert.equal(await page.getAttribute('#callroute-ear', 'aria-pressed'), 'false');
  await page.click('#tdAnswerProx .toggle-switch');
  assert.deepEqual(await page.evaluate(() => callAudioFields()), { delay: 4, route: 'speaker', prox: false });
  assert.deepEqual(await page.evaluate(() => callFormFields().audio), { delay: 4, route: 'speaker', prox: false });
  // Les autres types n'ont pas de champ audio
  assert.equal(await page.evaluate(() => { setCallKind('sms'); const a = callFormFields().audio; setCallKind('call'); return a; }), undefined);
  // Fermer, rouvrir une autre rubrique : les cartes de « Au décroché » disparaissent
  await page.click('#tdBack');
  await page.evaluate(() => openTelDetail('who'));
  assert.equal(await page.evaluate(() => ['tdAnswer', 'tdAnswerRoute', 'tdAnswerProx', 'tdAnswerNote'].map((id) => getComputedStyle(document.getElementById(id)).display)).then((d) => d.every((x) => x === 'none')), true);
  assert.deepEqual(errors, []);
  await close();
});

test('rangée « Au décroché » sur deux lignes : voix · auto, puis délai · sortie · écran noir', async () => {
  const { page, errors, close } = await remote();
  const row = () => page.evaluate(() => [document.getElementById('telAnswerVal').textContent, document.getElementById('telAnswerSub').textContent]);
  assert.deepEqual(await row(), ['Silence · manuel', 'à l\'oreille · écran noir à l\'oreille']);
  await page.evaluate(() => { _callAudioData = 'data:audio/wav;base64,AAAA'; _callAudioName = 'Voix Maman.m4a'; document.getElementById('callAutoSlider').value = '8'; onCallAutoChange(); });
  await setSlider(page, 'callVoiceDelay', 2);
  assert.deepEqual(await row(), ['Voix Maman · auto 8 s', 'Voix après 2 s · à l\'oreille · écran noir à l\'oreille']);
  await page.evaluate(() => { setCallRoute('speaker'); document.getElementById('callProxToggle').checked = false; onCallAudioChange(); });
  assert.deepEqual(await row(), ['Voix Maman · auto 8 s', 'Voix après 2 s · haut-parleur']);
  // Deux lignes : la seconde passe sous le libellé, dans la rangée
  const g = await page.evaluate(() => { const r = document.getElementById('callAnswerBlock').getBoundingClientRect(), s = document.getElementById('telAnswerSub').getBoundingClientRect(), b = document.querySelector('#callAnswerBlock b').getBoundingClientRect(); return { below: s.top >= b.bottom - 1, inside: s.bottom <= r.bottom + 1, left: Math.abs(s.left + parseFloat(getComputedStyle(document.getElementById('telAnswerSub')).paddingLeft) - b.left) < 2 }; });
  assert.deepEqual(g, { below: true, inside: true, left: true });
  assert.deepEqual(errors, []);
  await close();
});

// ───────────────────────────── Persistance ─────────────────────────────

test('réglages audio : entrée enregistrée, rechargement, chargement dans le formulaire, mise à jour, entrées d\'avant et valeurs forgées', async () => {
  const { page, errors, close } = await remote();
  await page.evaluate(() => { setCallRing('silent'); document.getElementById('callName').value = 'Maman'; });
  await setSlider(page, 'callVoiceDelay', 3);
  await page.evaluate(() => { setCallRoute('speaker'); document.getElementById('callProxToggle').checked = false; onCallAudioChange(); });
  const id = await page.evaluate(() => saveCurrentCall('Avec audio'));
  assert.deepEqual(await page.evaluate((id) => callList.call.find((e) => e.id === id).audio, id), { delay: 3, route: 'speaker', prox: false });
  // Stockage → rechargement des listes
  assert.deepEqual(await page.evaluate((id) => { loadCallList(); return callList.call.find((e) => e.id === id).audio; }, id), { delay: 3, route: 'speaker', prox: false });
  assert.deepEqual(await page.evaluate((id) => JSON.parse(localStorage.getItem(CALL_LIST_KEY)).call.find((e) => e.id === id).audio, id), { delay: 3, route: 'speaker', prox: false });
  // Le message d'appel d'une entrée (▶, console DMX, Séquence) porte l'audio
  assert.deepEqual(await page.evaluate((id) => callEntryMessage(callList.call.find((e) => e.id === id), {}).audio, id), { delay: 3, route: 'speaker', prox: false });
  // Autres réglages dans le formulaire, puis recharger l'entrée : ses réglages reviennent
  await setSlider(page, 'callVoiceDelay', 9);
  await page.evaluate(() => { setCallRoute('ear'); document.getElementById('callProxToggle').checked = true; onCallAudioChange(); });
  await page.evaluate((id) => selectCallEntry(id), id);
  await waitFor(page, () => document.getElementById('callVoiceDelay').value === '3');
  assert.deepEqual(await page.evaluate(() => callAudioFields()), { delay: 3, route: 'speaker', prox: false });
  assert.equal(await page.textContent('#callVoiceDelayVal'), '3 s');
  assert.equal(await page.getAttribute('#callroute-speaker', 'aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.getElementById('callProxToggle').checked), false);
  // Mise à jour : les nouveaux réglages remplacent les anciens, même entrée
  await setSlider(page, 'callVoiceDelay', 15);
  await page.evaluate(() => { document.getElementById('callProxToggle').checked = true; onCallAudioChange(); });
  await page.click('#clMemUpdate');
  assert.deepEqual(await page.evaluate((id) => callList.call.find((e) => e.id === id).audio, id), { delay: 15, route: 'speaker', prox: true });
  // Entrée d'avant (sans audio) : ancien comportement (aucun champ), formulaire aux valeurs d'origine
  const old = await page.evaluate(() => {
    const e = Object.assign({}, callList.call[0], { id: 'eOld', title: 'Ancienne' }); delete e.audio;
    callList.call.push(e); persistCallList(); loadCallList();
    return { audio: callList.call.find((x) => x.id === 'eOld').audio, msg: callEntryMessage(callList.call.find((x) => x.id === 'eOld'), {}).audio };
  });
  assert.deepEqual(old, { audio: undefined, msg: undefined });
  await page.evaluate(() => selectCallEntry('eOld'));
  await waitFor(page, () => document.getElementById('callVoiceDelay').value === '0');
  assert.deepEqual(await page.evaluate(() => callAudioFields()), { delay: 0, route: 'ear', prox: true });
  // Valeurs forgées dans le stockage : bornées ; un SMS n'a jamais d'audio
  const bad = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem(CALL_LIST_KEY));
    raw.call[0].audio = { delay: 99, route: 'bluetooth', prox: 'oui' };
    raw.call[1].audio = 'x';
    raw.sms = [{ id: 'eS', kind: 'sms', style: 'glass', name: 'Léa', msg: 'Coucou', audio: { delay: 5, route: 'speaker', prox: true } }];
    localStorage.setItem(CALL_LIST_KEY, JSON.stringify(raw)); loadCallList();
    return [callList.call[0].audio, callList.call[1].audio, callList.sms[0].audio];
  });
  assert.deepEqual(bad, [{ delay: 15, route: 'ear', prox: false }, undefined, undefined]);
  assert.deepEqual(errors, []);
  await close();
});

test('réglages audio : projet exporté puis importé, Séquence qui joue l\'entrée', async () => {
  const A = await remote();
  await A.page.evaluate(() => { document.getElementById('callName').value = 'Maman'; });
  await setSlider(A.page, 'callVoiceDelay', 6);
  await A.page.evaluate(() => { setCallRoute('speaker'); document.getElementById('callProxToggle').checked = false; onCallAudioChange(); });
  const id = await A.page.evaluate(() => saveCurrentCall('Projet'));
  const b64 = await A.page.evaluate(async () => _prjBytesToB64(new Uint8Array(await (await projectExport({ name: 'Audio' })).arrayBuffer())));
  const B = await remote();
  await B.page.evaluate((b64) => { window.__f = new File([_prjB64ToBytes(b64)], 'audio.rem', { type: 'application/zip' }); }, b64);
  const r = await B.page.evaluate(() => projectImport(window.__f, { mode: 'replace' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(await B.page.evaluate((id) => callList.call.find((e) => e.id === id).audio, id), { delay: 6, route: 'speaker', prox: false });
  // Séquence : une étape Appel qui référence l'entrée envoie call:start avec l'audio de l'entrée
  const sent = await B.page.evaluate(async (id) => {
    const out = []; const o = sendMsg; sendMsg = (m) => { out.push(m); };
    await sendCallEntry(callList.call.find((e) => e.id === id));
    sendMsg = o;
    return out.filter((m) => m.type === 'call:start').map((m) => m.audio);
  }, id);
  assert.deepEqual(sent, [{ delay: 6, route: 'speaker', prox: false }]);
  assert.deepEqual([...A.errors, ...B.errors], []);
  await A.close(); await B.close();
});

// ───────────────────────────── Protocole côté app ─────────────────────────────

test('call:start.audio : normalisé à la réception (délai 0 à 15, sortie, proximité), borné à l\'émission, absent = ancien comportement', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => screenJoinSession(SRP.createPairing()));
  const rx = (audio) => page.evaluate((audio) => { screenCallHide(); const m = { type: 'call:start', kind: 'call', name: 'M', ring: 'silent' }; if (audio !== undefined) m.audio = audio; const ok = dispatchMessage(m); return [ok, _callCfg && _callCfg.audio]; }, audio);
  assert.deepEqual(await rx({ delay: 2, route: 'speaker', prox: true }), [true, { delay: 2, route: 'speaker', prox: true }]);
  assert.deepEqual(await rx({ delay: 99, route: 'bluetooth', prox: 'oui' }), [true, { delay: 15, route: 'ear', prox: false }]);
  assert.deepEqual(await rx({ delay: -4 }), [true, { delay: 0, route: 'ear', prox: false }]);
  assert.deepEqual(await rx({}), [true, { delay: 0, route: 'ear', prox: false }]);
  assert.deepEqual(await rx(undefined), [true, null], 'ancienne télécommande');
  assert.deepEqual(await rx('x'), [true, null]);
  assert.deepEqual(await rx([1]), [true, null]);
  const out = await page.evaluate(() => clampOutgoing({ type: 'call:start', kind: 'call', audio: { delay: 99.4, route: 'bad', prox: 1, extra: true } }).audio);
  assert.deepEqual(out, { delay: 15 }, 'seuls les champs valides partent');
  assert.deepEqual(await page.evaluate(() => clampOutgoing({ type: 'call:start', kind: 'call', audio: 3 }).audio), undefined);
  // call:speaker : routé dans les deux rôles, booléen strict
  assert.deepEqual(await page.evaluate(() => { const m = { type: 'call:speaker', on: 'oui', from: 'remote' }; return [MSG_ROUTES['call:speaker'].roles.join(), MSG_ROUTES['call:speaker'].validate(m), m.on]; }), ['screen,remote', true, false]);
  assert.deepEqual(errors, []);
  await close();
});

// ───────────────────────────── Délai de la voix (horloge simulée) ─────────────────────────────

const SESSION = { channelId: 'A'.repeat(22), key: 'A'.repeat(43) };
async function screenRig(init) {
  const p = await openPage(browser, { clock: true, init });
  await p.page.evaluate((s) => screenJoinSession(s), SESSION);
  await p.page.evaluate(() => {
    window.__plays = 0;
    _playCallAudio = async () => { window.__plays++; }; // la lecture réelle (WebAudio) n'est pas l'objet : seul son instant compte
    _mediaCache.set('__callaudio', { kind: 'audio', data: 'data:audio/wav;base64,AAAA' });
  });
  return p;
}
const startCall = (page, extra) => page.evaluate((extra) => screenCallStart(Object.assign({ kind: 'call', style: 'glass', name: 'Maman', ring: 'silent', hasAudio: true }, extra)), extra);
const plays = (page) => page.evaluate(() => window.__plays);

test('délai avant la voix (navigateur) : voix à t + délai après le décroché, annulée si on raccroche avant, immédiate sans audio', async () => {
  const { page, errors, close } = await screenRig();
  // 2 s
  await startCall(page, { audio: { delay: 2, route: 'ear', prox: true } });
  await page.evaluate(() => screenCallAnswer());
  await page.clock.runFor(1900);
  assert.equal(await plays(page), 0, 'pas encore');
  await page.clock.runFor(200);
  assert.equal(await plays(page), 1, 'à 2 s');
  await page.clock.runFor(5000);
  assert.equal(await plays(page), 1, 'une seule fois');
  await page.evaluate(() => screenCallEnd());
  // Délai 0 : tout de suite
  await startCall(page, { audio: { delay: 0, route: 'ear', prox: false } });
  await page.evaluate(() => screenCallAnswer());
  assert.equal(await plays(page), 2);
  await page.evaluate(() => screenCallEnd());
  // Raccroché avant la fin du délai : la voix ne part jamais
  await startCall(page, { audio: { delay: 15, route: 'ear', prox: true } });
  await page.evaluate(() => screenCallAnswer());
  await page.clock.runFor(14000);
  await page.evaluate(() => screenCallEnd());
  await page.clock.runFor(5000);
  assert.equal(await plays(page), 2, 'annulée');
  // Un nouvel appel pendant le délai de l'ancien : l'ancienne voix ne part pas
  await startCall(page, { audio: { delay: 5, route: 'ear', prox: true } });
  await page.evaluate(() => screenCallAnswer());
  await page.clock.runFor(2000);
  await startCall(page, { audio: { delay: 1, route: 'ear', prox: true } });
  await page.clock.runFor(10000);
  assert.equal(await plays(page), 2, 'le second n\'est pas décroché');
  // Ancienne télécommande (sans audio) : immédiat, comme avant
  await startCall(page, {});
  await page.evaluate(() => screenCallAnswer());
  assert.equal(await plays(page), 3);
  // Décroché automatique + délai : le délai court depuis le décroché
  await page.evaluate(() => screenCallEnd());
  await startCall(page, { autoAnswer: 3, audio: { delay: 2, route: 'ear', prox: true } });
  await page.clock.runFor(3100);
  assert.equal(await page.evaluate(() => _callState), 'incall');
  assert.equal(await plays(page), 3);
  await page.clock.runFor(2000);
  assert.equal(await plays(page), 4);
  assert.deepEqual(errors, []);
  await close();
});

// ───────────────────────────── Haut-parleur : télécommande ↔ écran ─────────────────────────────

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
async function rig(seed) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('call'); SEQ_GO_GUARD_MS = 0; setCallRing('silent'); });
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
const sentTypes = (page) => page.evaluate(() => { window.__tx = []; const o = sendMsg; sendMsg = (m) => { window.__tx.push(m.type + (m.type === 'call:speaker' ? ':' + m.on + ':' + m.from : '')); return o(m); }; });
const tx = (page) => page.evaluate(() => window.__tx);

test('haut-parleur : bouton de la barre (appel en ligne) et de l\'écran synchronisés dans les deux sens, sans boucle', async () => {
  const r = await rig(81);
  const { rp, sp } = r;
  // Hors appel et pendant la sonnerie : pas de bouton Haut-parleur
  assert.equal(await shown(rp, 'callSpeakerBtn'), false);
  await rp.evaluate(() => setCallRoute('ear'));
  await rp.click('#callTriggerBtn');
  await waitFor(sp, () => _callState === 'ringing');
  await waitFor(rp, () => _telCall.phase === 'ringing');
  assert.equal(await shown(rp, 'callSpeakerBtn'), false, 'la voix ne joue qu\'après le décroché');
  // Décroché depuis la télécommande : le bouton apparaît, éteint
  await sentTypes(rp); await sentTypes(sp);
  await rp.click('#callAnswerBtn');
  await waitFor(sp, () => _callState === 'incall');
  await waitFor(rp, () => _telCall.phase === 'incall');
  await waitFor(rp, () => !!document.getElementById('callSpeakerBtn') && getComputedStyle(document.getElementById('callSpeakerBtn')).display !== 'none');
  const btn = () => rp.evaluate(() => { const b = document.getElementById('callSpeakerBtn'); return [b.getAttribute('aria-pressed'), b.classList.contains('on'), b.textContent.trim(), document.getElementById('callStatus').textContent]; });
  const scr = () => sp.evaluate(() => { const b = document.querySelector('#screen-call [data-act="speaker"]'); return [_callSpeaker, b.getAttribute('aria-pressed'), b.classList.contains('on'), b.parentElement.classList.contains('on')]; });
  assert.deepEqual((await btn()).slice(0, 3), ['false', false, 'Haut-parleur']);
  assert.deepEqual(await scr(), [false, 'false', false, false]);
  // 1. La télécommande bascule : l'écran applique (état visuel), puis la télécommande suit SON retour
  await rp.click('#callSpeakerBtn');
  await waitFor(sp, () => _callSpeaker === true);
  await waitFor(rp, () => _telCall.speaker === true);
  assert.deepEqual(await scr(), [true, 'true', true, true]);
  const b1 = await btn();
  assert.deepEqual(b1.slice(0, 3), ['true', true, 'Haut-parleur']);
  assert.match(b1[3], /^En ligne · \d+:\d\d · haut-parleur$/);
  // 2. Le comédien touche le bouton de l'écran : la télécommande suit
  await sp.click('#screen-call [data-act="speaker"]');
  await waitFor(sp, () => _callSpeaker === false);
  await waitFor(rp, () => _telCall.speaker === false);
  assert.deepEqual(await scr(), [false, 'false', false, false]);
  assert.deepEqual((await btn()).slice(0, 3), ['false', false, 'Haut-parleur']);
  await sp.click('#screen-call [data-act="speaker"]');
  await waitFor(rp, () => _telCall.speaker === true);
  // Pas de boucle : une demande (remote → écran) = un retour (écran → remote) ; un toucher = un seul message de l'écran, aucun de la télécommande
  await sleep(300);
  assert.deepEqual((await tx(rp)).filter((t) => t.startsWith('call:speaker')), ['call:speaker:true:remote'], 'la télécommande n\'a envoyé que sa demande');
  assert.deepEqual((await tx(sp)).filter((t) => t.startsWith('call:speaker')), ['call:speaker:false:screen', 'call:speaker:true:screen', 'call:speaker:false:screen', 'call:speaker:true:screen'],
    'état de départ au décroché, retour de la demande, puis un message par toucher');
  // 3. Télécommande rechargée en cours d'appel : l'état du bouton est retrouvé (tel:state.speaker)
  await rp.reload();
  await rp.evaluate(() => { startMode('remote'); switchTab('call'); });
  await connected(rp);
  await waitFor(rp, (id) => scrKnown(id) && scrState(id).caps !== null, r.sid, { timeout: 8000 });
  await rp.evaluate((id) => scrSetTarget({ k: 'screen', id }), r.sid);
  await waitFor(rp, () => _telCall.phase === 'incall' && _telCall.speaker === true);
  assert.deepEqual((await btn()).slice(0, 3), ['true', true, 'Haut-parleur']);
  // Raccrocher : la barre revient au repos, l'état part avec l'appel ; l'appel suivant repart éteint
  await rp.click('#callHangBtn');
  await waitFor(sp, () => _callState === 'idle');
  assert.equal(await rp.evaluate(() => _telCall.speaker), false);
  assert.equal(await shown(rp, 'callSpeakerBtn'), false);
  for (const e of r.errs) assert.deepEqual(e, []);
  await r.close();
});

test('haut-parleur : la sortie choisie dans « Au décroché » pré-positionne l\'écran et le bouton ; un ordre hors appel est ignoré', async () => {
  const r = await rig(83);
  const { rp, sp } = r;
  await rp.evaluate(() => setCallRoute('speaker'));
  await rp.click('#callTriggerBtn');
  await waitFor(sp, () => _callState === 'ringing');
  await rp.click('#callAnswerBtn');
  await waitFor(rp, () => _telCall.phase === 'incall');
  assert.equal(await sp.evaluate(() => _callSpeaker), true);
  assert.equal(await sp.evaluate(() => document.querySelector('#screen-call [data-act="speaker"]').classList.contains('on')), true, 'dessiné allumé dès le décroché');
  await waitFor(rp, () => document.getElementById('callSpeakerBtn').classList.contains('on'));
  await rp.click('#callHangBtn');
  await waitFor(sp, () => _callState === 'idle');
  // Hors appel : l'écran n'applique rien et ne répond rien
  await sentTypes(sp);
  await rp.evaluate(() => sendMsg({ type: 'call:speaker', on: true, from: 'remote' }));
  await sleep(300);
  assert.equal(await sp.evaluate(() => _callSpeaker), false);
  assert.deepEqual(await tx(sp), []);
  for (const e of r.errs) assert.deepEqual(e, []);
  await r.close();
});

// ───────────────────────────── Pont natif ─────────────────────────────

const nativeInit = (caps) => ({ fn: (caps) => {
  window.SETREMOTE_NATIVE = Object.assign({ platform: 'ios', bridge: caps ? 2 : 1 }, caps ? { caps } : {});
  window.__posted = []; window.ReactNativeWebView = { postMessage: (m) => window.__posted.push(JSON.parse(m)) };
}, arg: caps });
const posted = (page) => page.evaluate(() => window.__posted.filter((m) => /^audio:/.test(m.type)).map((m) => (m.type === 'audio:load' ? { type: m.type, id: m.id, mime: m.mime, i: m.i, n: m.n, len: m.data.length, size: m.size } : m)));
const clearPosted = (page) => page.evaluate(() => { window.__posted.length = 0; });

test('pont natif : audio:load pendant la sonnerie, audio:call-start / audio:play au décroché, audio:route, audio:call-end ; jamais en navigateur', async () => {
  const { page, errors, close } = await screenRig(nativeInit({ audioRoute: true }));
  const b64 = 'QUJD'.repeat(2000); // 8 000 caractères
  await page.evaluate((b64) => { _mediaCache.set('__callaudio', { kind: 'audio', data: 'data:audio/mpeg;base64,' + b64 }); }, b64);
  assert.equal(await page.evaluate(() => nativeAudioAvailable()), true);
  await startCall(page, { audio: { delay: 2, route: 'ear', prox: true } });
  let p = await posted(page);
  assert.equal(p.length, 1, 'bande son transmise pendant que ça sonne');
  assert.equal(p[0].type, 'audio:load');
  assert.deepEqual([p[0].mime, p[0].i, p[0].n, p[0].len, p[0].size], ['audio/mpeg', 0, 1, 8000, 8000]);
  assert.match(p[0].id, /^a[0-9a-f]{8}-[0-9a-z]+$/);
  const id = p[0].id;
  // Décroché : session audio (écouteur, proximité), puis la voix confiée au module avec son délai
  await clearPosted(page);
  await page.evaluate(() => screenCallAnswer());
  assert.deepEqual(await posted(page), [{ type: 'audio:call-start', route: 'ear', proximity: true }, { type: 'audio:play', id, delay: 2 }]);
  assert.equal(await plays(page), 0, 'pas de lecture WebAudio : la voix est jouée par le module');
  // Bascule : toucher du comédien, puis ordre de la télécommande
  await clearPosted(page);
  await page.evaluate(() => screenTapSpeaker());
  await page.evaluate(() => screenOnSpeaker(false));
  assert.deepEqual(await posted(page), [{ type: 'audio:route', route: 'speaker' }, { type: 'audio:route', route: 'ear' }]);
  // Le module rapporte une autre sortie (casque branché…) : l'écran suit et le dit à la télécommande
  await page.evaluate(() => { window.__sp = []; const o = sendMsg; sendMsg = (m) => { window.__sp.push(m); return o(m); }; });
  await clearPosted(page);
  await page.evaluate(() => SRNative.receive({ type: 'audio:state', route: 'speaker' }));
  assert.equal(await page.evaluate(() => _callSpeaker), true);
  assert.equal(await page.evaluate(() => document.querySelector('#screen-call [data-act="speaker"]').classList.contains('on')), true);
  assert.deepEqual(await page.evaluate(() => window.__sp.filter((m) => m.type === 'call:speaker')), [{ type: 'call:speaker', on: true, from: 'screen' }]);
  assert.deepEqual(await posted(page), [], 'un état venu du module ne lui est pas renvoyé');
  // Raccroché : fin de session (une seule fois)
  await page.evaluate(() => screenCallEnd());
  await page.evaluate(() => screenCallHide());
  assert.deepEqual(await posted(page), [{ type: 'audio:call-end' }]);
  // Même bande son au deuxième appel : pas de retransmission ; haut-parleur demandé d'emblée
  await clearPosted(page);
  await startCall(page, { audio: { delay: 0, route: 'speaker', prox: false } });
  await page.evaluate(() => screenCallAnswer());
  assert.deepEqual(await posted(page), [{ type: 'audio:call-start', route: 'speaker', proximity: false }, { type: 'audio:play', id, delay: 0 }]);
  await page.evaluate(() => screenCallDecline());
  await page.evaluate(() => screenCallHide());
  assert.deepEqual(errors, []);
  await close();
});

test('pont natif : gros fichier en morceaux de 512 Ko de caractères (multiples de 4), appel sans bande son, erreur du module → repli WebAudio', async () => {
  const { page, errors, close } = await screenRig(nativeInit({ audioRoute: true }));
  const len = 512 * 1024 * 2 + 4000;
  await page.evaluate((len) => { _mediaCache.set('__callaudio', { kind: 'audio', data: 'data:audio/wav;base64,' + 'A'.repeat(len) }); }, len);
  await startCall(page, { audio: { delay: 0, route: 'ear', prox: true } });
  const p = await posted(page);
  assert.deepEqual(p.map((m) => [m.i, m.n, m.len]), [[0, 3, 524288], [1, 3, 524288], [2, 3, 4000]]);
  assert.ok(p.every((m) => m.len % 4 === 0 && m.size === len));
  await page.evaluate(() => screenCallAnswer());
  // Erreur de lecture du module : la voix part quand même, en WebAudio
  assert.equal(await plays(page), 0);
  await page.evaluate(() => SRNative.receive({ type: 'audio:error', reason: 'play-failed' }));
  assert.equal(await plays(page), 1);
  await page.evaluate(() => screenCallEnd());
  // Sans bande son : session ouverte (écouteur, écran noir), aucune lecture
  await clearPosted(page);
  await startCall(page, { hasAudio: false, audio: { delay: 0, route: 'ear', prox: true } });
  await page.evaluate(() => screenCallAnswer());
  assert.deepEqual(await posted(page), [{ type: 'audio:call-start', route: 'ear', proximity: true }]);
  await page.evaluate(() => screenCallEnd());
  assert.deepEqual((await posted(page)).slice(-1), [{ type: 'audio:call-end' }]);
  assert.deepEqual(errors, []);
  await close();
});

test('pont natif : coque sans le module, navigateur ou ancienne télécommande → aucun message audio, voix en WebAudio', async () => {
  // Coque d'avant (bridge 1, pas de caps)
  let r = await screenRig(nativeInit(null));
  await startCall(r.page, { audio: { delay: 0, route: 'ear', prox: true } });
  await r.page.evaluate(() => screenCallAnswer());
  assert.equal(await r.page.evaluate(() => nativeAudioAvailable()), false);
  assert.deepEqual(await posted(r.page), []);
  assert.equal(await plays(r.page), 1);
  // Le bouton Haut-parleur de l'écran fonctionne quand même (état visuel), sans rien poster
  await r.page.evaluate(() => screenTapSpeaker());
  assert.equal(await r.page.evaluate(() => document.querySelector('#screen-call [data-act="speaker"]').classList.contains('on')), true);
  assert.deepEqual(await posted(r.page), []);
  assert.deepEqual(r.errors, []);
  await r.close();
  // Navigateur : pas de pont du tout
  r = await screenRig();
  await startCall(r.page, { audio: { delay: 0, route: 'speaker', prox: true } });
  await r.page.evaluate(() => screenCallAnswer());
  assert.equal(await r.page.evaluate(() => [IN_NATIVE_APP, nativeAudioAvailable(), _callSpeaker]).then((a) => a.join()), 'false,false,true');
  assert.equal(await plays(r.page), 1);
  assert.deepEqual(r.errors, []);
  await r.close();
  // Coque à jour, mais appel d'une ancienne télécommande (sans audio) : comportement d'avant
  r = await screenRig(nativeInit({ audioRoute: true }));
  await startCall(r.page, {});
  await r.page.evaluate(() => screenCallAnswer());
  assert.deepEqual(await posted(r.page), []);
  assert.equal(await plays(r.page), 1);
  assert.deepEqual(r.errors, []);
  await r.close();
});

test('pont natif : audio:state ou audio:error hors appel sont ignorés', async () => {
  const { page, errors, close } = await screenRig(nativeInit({ audioRoute: true }));
  assert.deepEqual(await page.evaluate(() => [SRNative.receive({ type: 'audio:state', route: 'speaker' }), SRNative.receive({ type: 'audio:error', reason: 'x' }), SRNative.receive({ type: 'audio:loaded', id: 'a1' })]), [false, false, true]);
  assert.equal(await page.evaluate(() => _callSpeaker), false);
  assert.deepEqual(errors, []);
  await close();
});
