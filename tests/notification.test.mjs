// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Notification d'application (onglet Tel, maquettes 24 et 25) : bandeau ou
// écran verrouillé, heure du téléphone, « Reçue » (maintenant / il y a n min /
// date et heure) rendue comme un téléphone, icône en fragments chiffrés mise
// en cache, style / fond / son propres (indépendants des SMS), entrées
// enregistrées ; migration de l'ancienne « messagerie » vers les SMS.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash, fakePeer, deliverFrame, connectFakeClients } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const NOTIF = { kind: 'notif', name: 'Virement reçu', appName: 'Banque Atlas', msg: 'Vous avez reçu 2 400,00 €.', ring: 'silent' };
const overlay = (page) => page.evaluate(() => ({ html: document.getElementById('screen-call').innerHTML, notif: document.getElementById('screen-call').classList.contains('notif'), state: _callState }));
const reset = async (page) => { await page.evaluate(() => screenCallHide()); await sleep(450); };

test('« Reçue » : libellés comme un téléphone (relatif, heure, hier, jour, date)', async () => {
  const { page, errors, close } = await openPage(browser);
  const r = await page.evaluate(() => {
    const now = new Date(2025, 9, 17, 14, 32); // ven. 17 oct. 2025, 14:32
    const L = (rec) => notifReceivedLabel(rec, now);
    return {
      now: L({ mode: 'now' }), none: L(null), ago0: L({ mode: 'ago', min: 0 }), ago15: L({ mode: 'ago', min: 15 }), ago59: L({ mode: 'ago', min: 59 }),
      ago120: L({ mode: 'ago', min: 120 }), ago420: L({ mode: 'ago', min: 420 }), ago1day: L({ mode: 'ago', min: 1440 }),
      atSoon: L({ mode: 'at', date: '2025-10-17', time: '14:20' }), atMorning: L({ mode: 'at', date: '2025-10-17', time: '07:05' }),
      atYesterday: L({ mode: 'at', date: '2025-10-16', time: '23:50' }), atTuesday: L({ mode: 'at', date: '2025-10-14', time: '09:00' }),
      atOld: L({ mode: 'at', date: '2025-03-02', time: '09:00' }), atLastYear: L({ mode: 'at', date: '2024-12-31', time: '09:00' }),
      atFuture: L({ mode: 'at', date: '2025-10-17', time: '18:45' }),
      phone: notifPhoneNow({ date: '2025-10-17', time: '14:32' }, new Date(2026, 0, 1, 9, 0)).toString().slice(0, 21),
      phoneTime: (() => { const d = notifPhoneNow({ time: '06:07' }, new Date(2026, 0, 1, 9, 0)); return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]; })(),
      long: notifLongDate(new Date(2025, 9, 17)), short: notifShortDate('2025-10-17'),
      parse: ['14:32', '1432', '9h05', '', '24:00', 'abc'].map(notifParseTime),
    };
  });
  assert.deepEqual([r.now, r.none, r.ago0, r.ago15, r.ago59], ['maintenant', 'maintenant', 'maintenant', 'il y a 15 min', 'il y a 59 min']);
  assert.deepEqual([r.ago120, r.ago420, r.ago1day], ['il y a 2 h', '07:32', 'hier']);
  assert.deepEqual([r.atSoon, r.atMorning, r.atYesterday, r.atTuesday, r.atOld, r.atLastYear, r.atFuture],
    ['il y a 12 min', '07:05', 'hier', 'mardi', '2 mars', '31/12/2024', '18:45']);
  assert.equal(r.phone, 'Fri Oct 17 2025 14:32');
  assert.deepEqual(r.phoneTime, [2026, 0, 1, 6, 7], 'heure imposée, date réelle');
  assert.deepEqual([r.long, r.short], ['vendredi 17 octobre', 'ven. 17 oct.']);
  assert.deepEqual(r.parse, ['14:32', '14:32', '09:05', '', null, null]);
  assert.deepEqual(errors, []);
  await close();
});

test('écran : bandeau ou écran verrouillé, 3 styles, heure du téléphone, textes jamais interprétés', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => screenJoinSession(SRP.createPairing()));
  for (const style of ['glass', 'tonal', 'minimal']) {
    // Bandeau (écran déverrouillé), reçue maintenant
    await reset(page);
    await page.evaluate((m) => screenCallStart(m), { ...NOTIF, style, present: 'banner', received: { mode: 'now' } });
    let o = await overlay(page);
    assert.equal(o.state, 'notif');
    assert.ok(o.notif, 'bandeau en haut, le reste de l\'écran reste visible');
    assert.match(o.html, new RegExp(`class="sc-notif nt-card ${style}"`));
    assert.doesNotMatch(o.html, /sc-lock/);
    for (const t of ['Banque Atlas', 'Virement reçu', 'Vous avez reçu 2 400,00 €.', 'maintenant']) assert.ok(o.html.includes(t), style + ' : ' + t);
    // Écran verrouillé : heure du téléphone imposée, reçue il y a 15 min
    await reset(page);
    await page.evaluate((m) => screenCallStart(m), { ...NOTIF, style, present: 'lock', phone: { date: '2025-10-17', time: '14:32' }, received: { mode: 'ago', min: 15 } });
    o = await overlay(page);
    assert.ok(!o.notif);
    assert.match(o.html, new RegExp(`class="sc-lock ${style}"`));
    assert.match(o.html, new RegExp(`sc-notif nt-card ${style} in-lock`));
    assert.match(o.html, /sc-lock-date">vendredi 17 octobre</);
    assert.match(o.html, style === 'tonal' ? /sc-lock-time">14<br>32</ : /sc-lock-time">14:32</);
    assert.ok(o.html.includes('il y a 15 min'));
  }
  // Heure du téléphone vide : celle de l'écran ; date et heure de réception → « hier »
  await reset(page);
  await page.evaluate((m) => screenCallStart(m), { ...NOTIF, style: 'glass', present: 'lock', received: { mode: 'at', date: '2000-01-01', time: '10:00' } });
  const real = await page.evaluate(() => { const d = new Date(); return [notifLongDate(d), String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')]; });
  let o = await overlay(page);
  assert.ok(o.html.includes('sc-lock-date">' + real[0] + '<'), 'date réelle');
  assert.ok(o.html.includes('sc-lock-time">' + real[1] + '<'), 'heure réelle');
  assert.ok(o.html.includes('01/01/2000'));
  // L'écran verrouillé se rendort seul ; toucher le bandeau le ferme
  await reset(page);
  await page.evaluate((m) => screenCallStart(m), { ...NOTIF, style: 'minimal', present: 'banner' });
  await page.locator('#screen-call .sc-notif').click();
  assert.equal((await overlay(page)).state, 'idle');
  // Textes forgés : affichés tels quels
  await reset(page);
  await page.evaluate(() => screenCallStart({ kind: 'notif', style: 'glass', present: 'lock', ring: 'silent', name: '<img src=x onerror=window.__p=1>', appName: '<b>x</b>', msg: '<script>window.__p=2</script>' }));
  o = await overlay(page);
  assert.equal(await page.evaluate(() => [window.__p, document.querySelectorAll('#screen-call img, #screen-call b, #screen-call script').length].join()), ',0');
  assert.ok(o.html.includes('&lt;img src=x'));
  assert.deepEqual(errors, []);
  await close();
});

test('réseau : réception validée, ancienne messagerie affichée en SMS, champs forgés rejetés', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => screenJoinSession(SRP.createPairing()));
  await connectFakeClients(page);
  await waitFor(page, () => mqttClient.connected);
  const remote = await fakePeer(await page.evaluate(() => _session), 'remote');
  // Ancienne télécommande : kind « chat » → SMS (nom et couleur d'application gardés)
  await deliverFrame(page, await remote.seal({ type: 'call:start', kind: 'chat', style: 'tonal', name: 'Régie', msg: 'Moteur', appName: 'Chatly', appColor: '#22aa66', ring: 'silent', lock: null }));
  await waitFor(page, () => _callState === 'notif');
  assert.deepEqual(await page.evaluate(() => [_callCfg.kind, _callCfg.appName]), ['sms', 'Chatly']);
  assert.match((await overlay(page)).html, /class="sc-notif tonal"/);
  await reset(page);
  // Notification complète par le réseau
  await deliverFrame(page, await remote.seal({ type: 'call:start', ...NOTIF, style: 'minimal', present: 'lock', phone: { date: '2025-10-17', time: '14:32' }, received: { mode: 'ago', min: 15 } }));
  await waitFor(page, () => _callState === 'notif');
  assert.deepEqual(await page.evaluate(() => [_callCfg.kind, _callCfg.present, _callCfg.phone, _callCfg.received]),
    ['notif', 'lock', { date: '2025-10-17', time: '14:32' }, { mode: 'ago', min: 15 }]);
  await reset(page);
  // Forgés (authentiques mais hors schéma) : rejetés
  for (const bad of [
    { type: 'call:start', ...NOTIF, phone: { time: '99:99' } },
    { type: 'call:start', ...NOTIF, received: { mode: 'ago', min: 1e9 } },
    { type: 'call:start', ...NOTIF, icon: 'data:image/png;base64,AAAA' },
    { type: 'call:start', kind: 'call', received: { mode: 'now' } },
  ]) {
    await deliverFrame(page, await remote.forge(bad));
    assert.equal(await page.evaluate(() => [_callState, secStats.lastError].join()), 'idle,invalid-message', JSON.stringify(bad));
  }
  assert.deepEqual(errors, []);
  await close();
});

test('migration : entrées « messagerie » → SMS, son de la messagerie → notification', async () => {
  const { page, errors, close } = await openPage(browser, { init: { fn: () => {
    if (sessionStorage.getItem('migr')) return;
    sessionStorage.setItem('migr', '1');
    localStorage.setItem('setremote-call-list-v1', JSON.stringify({ v: 1, call: [{ id: 'c1', kind: 'call', name: 'Maman', style: 'glass' }],
      sms: [{ id: 's1', kind: 'sms', name: 'Léa', msg: 'A', style: 'glass', ringVolume: 1 }, { id: 'w1', kind: 'chat', name: 'Tom', msg: 'Moteur', appName: 'Chatly', appColor: '#7a5af8', style: 'minimal', ring: 'digital', ringVolume: 0.4, lock: { time: '07:42', date: '' } }, { id: 'w2', kind: 'whatsapp', name: 'Ancien', style: 'ios' }] }));
    localStorage.setItem('setremote-ring-v1', JSON.stringify({ v: 1, call: { sound: 'classic', vol: 1 }, sms: { sound: 'soft', vol: 0.5 }, chat: { sound: 'digital', vol: 0.3 } }));
  } } });
  await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallListKind('sms'); });
  const st = await page.evaluate(() => ({ sms: callList.sms.map((e) => [e.id, e.kind, e.appName || '', e.ring || '']), notif: callList.notif.length, ring: ringSettings }));
  assert.deepEqual(st.sms, [['s1', 'sms', '', ''], ['w1', 'sms', 'Chatly', 'digital'], ['w2', 'sms', '', 'classic']]);
  assert.equal(st.notif, 0, 'aucune notification inventée');
  assert.deepEqual(st.ring, { call: { sound: 'classic', vol: 1 }, sms: { sound: 'soft', vol: 0.5 }, notif: { sound: 'digital', vol: 0.3 } });
  // L'entrée migrée se recharge et part comme un SMS
  await page.locator('#callListRows .cl-row').nth(1).click();
  await waitFor(page, () => document.getElementById('callName').value === 'Tom');
  assert.deepEqual(await page.evaluate(() => [callKind, document.getElementById('callAppName').value, callFormFields().kind]), ['sms', 'Chatly', 'sms']);
  // Persisté sans « chat » ; l'ancien type n'existe plus dans l'interface
  await page.evaluate(() => { persistCallList(); persistRingSettings(); });
  const ls = await page.evaluate(() => [localStorage.getItem('setremote-call-list-v1'), localStorage.getItem('setremote-ring-v1')]);
  assert.doesNotMatch(ls[0], /"kind":"(chat|whatsapp)"/);
  assert.doesNotMatch(ls[1], /"chat"/);
  assert.equal(await page.evaluate(() => !!document.getElementById('callkind-chat')), false);
  assert.equal(await page.evaluate(() => (setCallKind('chat'), callKind)), 'sms', 'ancien nom de type → SMS');
  assert.equal(await page.textContent('#tab-call'), '📞 Tel');
  assert.deepEqual(errors, []);
  await close();
});

// Image PNG réelle (canvas) pour le champ fichier
async function pngFile(page, name, color) {
  const b64 = await page.evaluate((c) => { const k = document.createElement('canvas'); k.width = 300; k.height = 200; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 300, 200); return k.toDataURL('image/png').split(',')[1]; }, color);
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

describe('télécommande et écran reliés', () => {
  let broker, remote, screen, rp, sp;
  before(async () => {
    broker = new FakeBroker();
    remote = await openPage(browser, { broker, seed: 61, autoConnect: true });
    rp = remote.page;
    await rp.evaluate(() => { startMode('remote'); switchTab('call'); });
    await connected(rp);
    screen = await openPage(browser, { broker, seed: 62, autoConnect: true, hash: await pairingHash(rp) });
    sp = screen.page;
    await connected(sp);
    await waitFor(rp, () => _pairedScreens.size === 1);
    await waitFor(rp, () => _resyncTimer === null);
    await sleep(150);
    await broker.flush();
  });
  after(async () => {
    assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
    await screen?.close(); await remote?.close();
  });
  const imgStarts = async (id) => (await broker.sent(rp, 'media-img-start')).filter((m) => m.mediaId === id);

  test('formulaire : icône en fragments chiffrés, en cache sur l\'écran, renvoyée seulement si elle manque', async () => {
    await rp.evaluate(() => setCallKind('notif'));
    for (const id of ['ntAppPanel', 'ntShowPanel', 'ntSendPanel']) assert.equal(await rp.evaluate((id) => getComputedStyle(document.getElementById(id)).display !== 'none', id), true, id);
    for (const id of ['callWhoPanel', 'callMsgPanel', 'callLockPanel', 'callStyleRow', 'callTriggerBtn']) assert.equal(await rp.evaluate((id) => getComputedStyle(document.getElementById(id)).display, id), 'none', id);
    assert.equal(await rp.textContent('#ntIconPreview'), 'B', 'sans icône : initiale de l\'application');
    broker.clear();
    await rp.setInputFiles('#ntIconInput', await pngFile(rp, 'banque.png', '#2a7ad5'));
    await waitFor(rp, () => !!_notifIcon);
    const icon = await rp.evaluate(() => _notifIcon);
    assert.match(icon, /^data:image\/png;base64,/);
    assert.equal(await rp.evaluate(() => { const i = new Image(); i.src = _notifIcon; return i.decode().then(() => [i.width, i.height]); }).then((x) => x.join()), '160,160', 'recadrée au carré');
    await waitFor(sp, () => { const c = _mediaCache.get('__notificon'); return !!c && c.kind === 'img'; });
    assert.equal(await sp.evaluate(() => _mediaCache.get('__notificon').data), icon);
    await broker.flush();
    assert.equal((await imgStarts('__notificon')).length, 1);
    assert.ok(broker.log.every((e) => !e.payload.includes('iVBORw0KGgo')), 'aucune image en clair sur le relais');
    // Envoi : écran verrouillé, heure du téléphone, il y a 15 min
    await rp.evaluate(() => {
      setNotifPresent('lock');
      document.getElementById('ntPhoneDate').value = '2025-10-17'; document.getElementById('ntPhoneTime').value = '1432';
      setNotifReceived('ago'); document.getElementById('ntAgoMin').value = '15'; renderNotifForm();
    });
    assert.equal(await rp.textContent('#ntPhoneDateText'), 'ven. 17 oct.');
    broker.clear();
    await rp.click('#ntSendBtn');
    await waitFor(sp, () => _callState === 'notif');
    await broker.flush();
    const [start] = await broker.sent(rp, 'call:start');
    assert.deepEqual([start.kind, start.present, start.phone, start.received, start.hasPhoto, start.name, start.appName],
      ['notif', 'lock', { date: '2025-10-17', time: '14:32' }, { mode: 'ago', min: 15 }, true, 'Virement reçu', 'Banque Atlas']);
    assert.deepEqual(await imgStarts('__notificon'), [], 'déjà en cache : rien à renvoyer');
    const html = await sp.evaluate(() => document.getElementById('screen-call').innerHTML);
    assert.match(html, /nt-img" style="background-image:url\(data:image\/png;base64,/);
    assert.match(html, /il y a 15 min/);
    assert.match(html, /sc-lock-date">vendredi 17 octobre</);
    await sp.evaluate(() => screenCallEnd());
    await sleep(450);
    // Écran rechargé (cache perdu) : l'icône est renvoyée à la resynchronisation
    broker.clear();
    await sp.evaluate(() => { _mediaCache.delete('__notificon'); sendCaps(); });
    await waitFor(sp, () => _mediaCache.has('__notificon'));
    await broker.flush();
    assert.equal((await imgStarts('__notificon')).length, 1);
    // « Date et heure » : sa propre ligne de saisie
    await rp.evaluate(() => setNotifReceived('at'));
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('ntAtRow')).display), 'flex');
    await rp.evaluate(() => { document.getElementById('ntAtDate').value = '2025-10-16'; document.getElementById('ntAtTime').value = '18:05'; });
    assert.deepEqual(await rp.evaluate(() => callFormFields().received), { mode: 'at', date: '2025-10-16', time: '18:05' });
    await rp.evaluate(() => { document.getElementById('ntAtTime').value = '25:61'; renderNotifForm(); });
    assert.deepEqual(await rp.evaluate(() => [callFormFields().received, document.getElementById('ntAtTime').classList.contains('nt-bad')]), [{ mode: 'now' }, true], 'heure invalide signalée, repli « maintenant »');
    await rp.evaluate(() => setNotifReceived('ago'));
  });

  test('style, fond verrouillé et son propres, indépendants des SMS', async () => {
    // SMS : Tonal, son Douce, fond d'écran SMS ; notification : Épuré, Digitale, son propre fond
    await rp.evaluate(() => { setCallKind('sms'); setCallStyle('tonal'); setCallRing('soft'); });
    await rp.setInputFiles('#lockWallInput', await pngFile(rp, 'sms.png', '#aa0000'));
    await waitFor(sp, () => _mediaCache.has('__lockwall'));
    await rp.evaluate(() => { setCallKind('notif'); toggleNotifDetail('style'); });
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('ntDetail-style')).display), 'block');
    await rp.click('#ntstyle-minimal');
    await rp.evaluate(() => toggleNotifDetail('sound'));
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('ntDetail-style')).display), 'none', 'un détail à la fois');
    assert.equal(await rp.evaluate(() => document.getElementById('callRingPanel').parentNode.id), 'ntSoundSlot');
    await rp.click('#callring-digital');
    assert.equal(await rp.textContent('#ntTileSound'), 'Digitale ›');
    assert.equal(await rp.textContent('#ntTileStyle'), 'Épuré ›');
    assert.equal(await rp.textContent('#ntTileWall'), 'Dégradé ›');
    await rp.evaluate(() => toggleNotifDetail('wall'));
    await rp.setInputFiles('#ntWallInput', await pngFile(rp, 'notif.png', '#00aa00'));
    await waitFor(sp, () => _mediaCache.has('__notifwall'));
    assert.equal(await rp.textContent('#ntTileWall'), 'Photo ›');
    const f = await rp.evaluate(() => { const n = callFormFields(); setCallKind('sms'); const s = callFormFields(); setCallKind('notif'); return { n: [n.style, n.ring], s: [s.style, s.ring] }; });
    assert.deepEqual(f, { n: ['minimal', 'digital'], s: ['tonal', 'soft'] });
    assert.equal(await rp.evaluate(() => document.getElementById('callRingPanel').parentNode.id), 'ntSoundSlot', 'revenu sous la tuile');
    await rp.evaluate(() => setCallKind('sms'));
    assert.equal(await rp.evaluate(() => document.getElementById('callRingPanel').nextElementSibling.id), 'callTriggerPanel', 'panneau du son rendu aux SMS');
    // Sur l'écran : chaque type a son fond
    const walls = await sp.evaluate(() => [_mediaCache.get('__lockwall').data, _mediaCache.get('__notifwall').data]);
    assert.notEqual(walls[0], walls[1]);
    await rp.evaluate(() => { setCallKind('notif'); });
    await rp.click('#ntSendBtn');
    await waitFor(sp, () => _callState === 'notif');
    let html = await sp.evaluate(() => document.querySelector('#screen-call .sc-lock').getAttribute('style'));
    assert.ok(html.includes(walls[1].slice(0, 60)), 'fond des notifications');
    assert.equal(await sp.evaluate(() => _callCfg.style), 'minimal');
    await sp.evaluate(() => screenCallEnd());
    await sleep(450);
    await rp.evaluate(() => { setCallKind('sms'); document.getElementById('lockToggle').checked = true; });
    await rp.click('#callTriggerBtn');
    await waitFor(sp, () => _callState === 'notif');
    html = await sp.evaluate(() => document.querySelector('#screen-call .sc-lock').getAttribute('style'));
    assert.ok(html.includes(walls[0].slice(0, 60)), 'fond des SMS');
    assert.equal(await sp.evaluate(() => _callCfg.style), 'tonal');
    await sp.evaluate(() => screenCallEnd());
    await rp.evaluate(() => { document.getElementById('lockToggle').checked = false; });
    await sleep(450);
  });

  test('liste « Notifs » : enregistrée avec son icône, rechargée, envoyée ; pas de plage DMX', async () => {
    await rp.evaluate(() => { setCallKind('notif'); document.getElementById('ntTitle').value = 'Rappel'; });
    await rp.evaluate(() => saveCurrentCall());
    assert.equal(await rp.textContent('#clKind-notif'), 'Notifs (1)');
    assert.equal(await rp.textContent('#callListWho'), 'Titre');
    const row = await rp.evaluate(() => { const r = document.querySelector('#callListRows .cl-row'); return [r.querySelector('.cl-name').textContent, r.querySelector('.cl-meta').textContent, r.querySelector('.cl-dmx').textContent]; });
    assert.deepEqual(row, ['Rappel', 'Épuré · Banque Atlas · icône · écran verrouillé', '—']);
    assert.match(await rp.textContent('#callListNote'), /ne se déclenchent pas depuis la console/);
    assert.equal(await rp.textContent('#callListGo'), 'Envoyer la notification n°1');
    // Formulaire changé puis entrée rechargée
    await rp.evaluate(() => { document.getElementById('ntTitle').value = 'Autre'; clearNotifIcon(); setNotifPresent('banner'); });
    await rp.locator('#callListRows .cl-row').first().click();
    await waitFor(rp, () => document.getElementById('ntTitle').value === 'Rappel' && !!_notifIcon);
    assert.equal(await rp.evaluate(() => notifPresent), 'lock');
    broker.clear();
    await rp.click('#callListGo');
    await waitFor(sp, () => _callState === 'notif');
    await broker.flush();
    const [m] = await broker.sent(rp, 'call:start');
    assert.deepEqual([m.kind, m.name, m.hasPhoto, m.lock], ['notif', 'Rappel', true, undefined]);
    assert.match(await sp.evaluate(() => document.getElementById('screen-call').innerHTML), /Rappel/);
    await sp.evaluate(() => screenCallEnd());
    await sleep(450);
  });
});
