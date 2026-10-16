// Passerelle DMX dans l'app : une télécommande « app native » (pont simulé)
// reçoit des datagrammes sACN / Art-Net construits avec packages/dmx, les
// décode et pilote de vrais écrans de jeu par la session chiffrée (FakeBroker).
// Couvre : panneau IP / voyant, patch et auto-adressage, look ciblé, priorité
// console, perte → maintien → reprise par la télécommande, retour du signal,
// appels / SMS n° n (une fois) et raccrocher, moniteur de tous les canaux,
// Art-Net (ArtDmx, ArtPoll → ArtPollReply), repli navigateur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';
import { buildSacnDataPacket, buildArtDmx, buildArtPoll, parseArtNet, sacnMulticastAddress } from '../packages/dmx/index.js';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const CID = '5f1e7a52-3c4b-4d8e-9a10-2b3c4d5e6f70';
// Coque native simulée : pont présent dès le chargement, messages postés retenus
const NATIVE = {
  fn: () => {
    window.SETREMOTE_NATIVE = { platform: 'android', bridge: 1 };
    window.__posted = [];
    window.ReactNativeWebView = { postMessage: (m) => window.__posted.push(JSON.parse(m)) };
  },
};
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });

// Console simulée : datagrammes remis par la « coque » (window.SRNative.receive)
class FakeConsole {
  constructor(page) { this.page = page; this.seq = new Map(); }
  sacnPacket(universe, slots, o = {}) {
    const cid = o.cid || CID, k = cid + ':' + universe;
    const sequence = ((this.seq.get(k) || 0) + 1) & 0xff;
    this.seq.set(k, sequence);
    const data = buildSacnDataPacket({ cid, universe, data: slots, sequence, sourceName: o.name || 'Console Eos', priority: o.priority });
    return { src: o.src || '10.0.0.10', port: 5568, data: b64(data) };
  }
  sacn(universe, slots, o) { return this.deliver([this.sacnPacket(universe, slots, o)]); }
  artnet(portAddress, slots, o = {}) {
    const data = slots.length % 2 ? [...slots, 0] : slots; // ArtDmx : longueur paire
    return this.deliver([{ src: o.src || '10.0.0.20', port: 6454, data: b64(buildArtDmx({ portAddress, data })) }]);
  }
  deliver(packets) { return this.page.evaluate((p) => window.SRNative.receive({ type: 'dmx:packets', packets: p }), packets); }
  posted(type) { return this.page.evaluate((t) => window.__posted.filter((m) => !t || m.type === t), type || null); }
}

// Télécommande (app native, passerelle ouverte) + n écrans de jeu appairés
async function rig(n = 1, seed = 1) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true, init: NATIVE });
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
  await waitFor(rp, (k) => _screenOfSender.size === k, n);
  await rp.evaluate(() => openDmxGateway());
  const close = async () => { for (const s of screens) await s.close(); await remote.close(); };
  return { broker, remote, rp, screens, console: new FakeConsole(rp), close };
}
const color = (s) => s.page.evaluate(() => screenBaseColor);
const live = (s) => s.page.evaluate(() => screenDmxLive());
const patch = (rp, id, e) => rp.evaluate(([id, e]) => gwPatchSet(id, e), [id, e]);
const S8 = (r, g, b, dim = 255) => [dim, r, g, b, 0, 128, 0, 0];

test('navigateur seul : passerelle masquée, la vue explique qu\'il faut l\'app, aucune écoute', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => startMode('remote'));
  const st = await page.evaluate(() => ({
    native: IN_NATIVE_APP,
    entry: getComputedStyle(document.getElementById('gwEntryBtn')).display,
    receive: typeof window.SRNative.receive,
  }));
  assert.deepEqual(st, { native: false, entry: 'none', receive: 'function' });
  await page.evaluate(() => openDmxGateway());
  const v = await page.evaluate(() => ({
    running: gwRunning(),
    notice: getComputedStyle(document.getElementById('gwNeedsApp')).display,
    text: document.getElementById('gwNeedsApp').textContent,
    greyed: document.getElementById('gwViewGateway').classList.contains('gw-unavailable'),
    started: gwStart(),
    packets: window.SRNative.receive({ type: 'dmx:packets', packets: [{ src: '1.2.3.4', port: 5568, data: 'AAAA' }] }),
  }));
  assert.equal(v.running, false);
  assert.equal(v.notice, 'block');
  assert.match(v.text, /Nécessite l'app SetRemote/);
  assert.equal(v.greyed, true);
  assert.equal(v.started, false, 'pas de passerelle sans la coque native');
  assert.equal(v.packets, false, 'paquets ignorés hors passerelle');
  assert.deepEqual(errors, []);
  await close();
});

test('app native : écoute UDP, IP / masque / interface en lecture seule, voyant à chaque paquet, univers reçus', async () => {
  const { page, errors, close } = await openPage(browser, { init: NATIVE });
  await page.evaluate(() => startMode('remote'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('gwEntryBtn')).display), 'flex', 'accès visible dans l\'app');
  await page.evaluate(() => openDmxGateway());
  const fc = new FakeConsole(page);
  assert.deepEqual(await fc.posted(), [
    { type: 'dmx:listen', protocol: 'sacn', universes: [1], multicast: true },
    { type: 'net:info' },
  ]);
  assert.equal(await page.textContent('#gwSig'), 'Aucun signal');
  await page.evaluate(() => window.SRNative.receive(JSON.stringify({ type: 'net:info', interfaces: [
    { name: 'wlan0', kind: 'wifi', ip: '192.168.1.20', mask: '255.255.255.0' },
    { name: 'eth0', kind: 'ethernet', ip: '10.0.0.42', mask: '255.255.255.0' },
    { name: 'x', kind: 'ethernet', ip: 'fe80::1', mask: '' },
  ] })));
  assert.equal(await page.textContent('#gwIp'), '10.0.0.42', 'filaire prioritaire');
  assert.equal(await page.textContent('#gwIpSub'), 'Masque 255.255.255.0 · Ethernet (eth0)');
  assert.match(await page.textContent('#gwNetWarn'), /L'appareil est en 10\.0\.0\.42, masque 255\.255\.255\.0\. Saisissez bien cette IP/);
  assert.match(await page.textContent('#gwIpTip'), /10\.0\.0\.42/);
  assert.equal(await page.evaluate(() => document.getElementById('gwIp').tagName), 'SPAN', 'lecture seule');
  // Paquets : le voyant s'allume à chaque lot, le signal et l'univers apparaissent
  const blinks0 = await page.evaluate(() => gwState.ledBlinks);
  await fc.sacn(1, [10, 20, 30]);
  assert.deepEqual(await page.evaluate(() => [...document.getElementById('gwLed').classList]), ['gw-led', 'rx', 'blink']);
  await waitFor(page, () => !document.getElementById('gwLed').classList.contains('blink'));
  await waitFor(page, () => _gwLedTimer === null); // éteint au moins 80 ms entre deux éclats
  await fc.sacn(1, [10, 20, 31]);
  assert.equal(await page.evaluate(() => gwState.ledBlinks), blinks0 + 2, 'un éclat par paquet');
  await waitFor(page, () => document.getElementById('gwSig').textContent === 'Signal reçu');
  for (let i = 0; i < 9; i++) await fc.sacn(1, [10, 20, 32 + i]);
  await waitFor(page, () => /Hz/.test(document.getElementById('gwUniverses').textContent), null, { timeout: 3000 });
  const uni = await page.textContent('#gwUniverses');
  assert.match(uni, /Univers 1Console Eos · 10\.0\.0\.10 · \d+ Hz/);
  // Refus du multicast (iOS sans autorisation) : réécoute en unicast, erreur affichée
  await page.evaluate(() => window.SRNative.receive({ type: 'dmx:error', reason: 'multicast not permitted' }));
  const listens = await fc.posted('dmx:listen');
  assert.deepEqual(listens.at(-1), { type: 'dmx:listen', protocol: 'sacn', universes: [1], multicast: false });
  assert.match(await page.textContent('#gwError'), /multicast not permitted — écoute en unicast seulement/);
  // Arrêt : dmx:stop, voyant éteint
  await page.evaluate(() => gwToggleRun());
  assert.deepEqual((await fc.posted()).at(-1), { type: 'dmx:stop' });
  assert.equal(await page.textContent('#gwSig'), 'Arrêtée');
  assert.deepEqual(errors, []);
  await close();
});

test('patch : chevauchement signalé, auto-adressage consécutif, mémorisé par session', async () => {
  const { page, errors, close } = await openPage(browser, { init: NATIVE });
  await page.evaluate(() => startMode('remote'));
  const ids = ['ScreenOne0000001', 'ScreenTwo0000002', 'ScreenTri0000003'];
  await page.evaluate((ids) => ids.forEach((id, i) => remoteNoteScreen('s' + i + 'AAAAAAA', { type: 'caps', screenId: id })), ids);
  await page.evaluate(() => { openDmxGateway(); gwShowView('patch'); });
  assert.equal(await page.evaluate(() => document.querySelectorAll('#gwPatchRows .gw-prow.off').length), 3, 'trois écrans non patchés');
  assert.ok(await patch(page, ids[0], { universe: 1, address: 1, personality: 'extended16' }));
  assert.ok(await patch(page, ids[1], { universe: 1, address: 17, personality: 'extended16' }));
  assert.ok(await patch(page, ids[2], { universe: 1, address: 21, personality: 'extended16' }));
  assert.equal(await patch(page, ids[2], { address: 600 }), false, 'adresse invalide refusée');
  const rows = await page.evaluate(() => [...document.querySelectorAll('#gwPatchRows .gw-prow')].map((r) => ({ warn: r.classList.contains('warn'), text: r.innerText.replace(/\s+/g, ' ') })));
  assert.deepEqual(rows.map((r) => r.warn), [false, false, true], 'seul l\'écran qui recouvre est marqué');
  assert.match(rows[0].text, /Écran 1 1–16 · OK 1 1 Étendu 16/);
  assert.match(rows[1].text, /Écran 2 17–32 · OK 1 17 Étendu 16/);
  assert.match(rows[2].text, /Écran 3 21–36 · chevauchement 1 21 Étendu 16/);
  assert.equal(await page.textContent('#gwPatchWarn'),
    'Chevauchement : « Écran 3 » (21–36) recouvre « Écran 2 » (17–32). Utilisez l\'auto-adressage ou changez l\'adresse.');
  assert.equal((await page.textContent('#gwModes')).replace(/\s+/g, ' '),
    'Simple 3R · G · BCouleur 5Dimmer · RGB · StroboStandard 8+ CCT · Tint · MixÉtendu 16+ Effet · Média · Appel · SMS');
  // Auto-adressage : à la suite, chacun avec son mode
  await page.evaluate((id) => gwPatchSet(id, { personality: 'standard8' }), ids[1]);
  await page.evaluate(() => gwAutoAddress());
  const entries = await page.evaluate(() => gwState.patch.toJSON().screens);
  assert.deepEqual(Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, [e.universe, e.address, e.personality]])), {
    [ids[0]]: [1, 1, 'extended16'], [ids[1]]: [1, 17, 'standard8'], [ids[2]]: [1, 25, 'extended16'],
  });
  assert.equal(await page.evaluate(() => document.getElementById('gwPatchWarn').style.display), 'none');
  // Univers patchés → écoute mise à jour
  await page.evaluate((id) => gwPatchSet(id, { universe: 3 }), ids[2]);
  assert.deepEqual((await new FakeConsole(page).posted('dmx:listen')).at(-1).universes, [1, 3]);
  // Mémorisé pour CETTE session : rechargement → patch retrouvé ; nouvelle session → vide
  const sid = await page.evaluate(() => _session.channelId);
  await page.reload();
  await page.evaluate(() => { startMode('remote'); openDmxGateway(); });
  assert.equal(await page.evaluate(() => gwState.patch.size), 3);
  await page.evaluate(() => newRemoteSession());
  assert.equal(await page.evaluate(() => gwState.patch.size), 0, 'nouvelle session : patch vierge');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('setremote-dmx-v1')));
  assert.equal(Object.keys(stored.patches[sid].patch.screens).length, 3);
  assert.deepEqual(errors, []);
  await close();
});

test('look : chaque écran patché reçoit son look (ciblé, au changement seulement), l\'écran non patché rien', async () => {
  const r = await rig(3, 2);
  const [a, b, c] = r.screens;
  await patch(r.rp, a.id, { universe: 1, address: 1, personality: 'standard8' });
  await patch(r.rp, b.id, { universe: 1, address: 9, personality: 'color5' });
  const before = await color(c);
  await r.console.sacn(1, [...S8(255, 0, 0), 255, 0, 0, 255, 0]);
  await waitFor(a.page, () => screenBaseColor === '#ff0000');
  await waitFor(b.page, () => screenBaseColor === '#0000ff');
  assert.equal(await live(a), true);
  assert.equal(await live(b), true);
  // Même trame répétée : rien de plus ; changement : un look de plus pour A seulement
  for (let i = 0; i < 5; i++) await r.console.sacn(1, [...S8(255, 0, 0), 255, 0, 0, 255, 0]);
  await r.console.sacn(1, [...S8(0, 255, 0), 255, 0, 0, 255, 0]);
  await waitFor(a.page, () => screenBaseColor === '#00ff00');
  await r.broker.flush();
  const looks = await r.broker.sent(r.rp, 'dmx:look');
  const forA = looks.filter((m) => m.target.screens.includes(a.id));
  const forB = looks.filter((m) => m.target.screens.includes(b.id));
  assert.deepEqual(forA.map((m) => [m.live, m.look.color]), [[true, '#ff0000'], [true, '#00ff00']]);
  assert.deepEqual(forB.map((m) => [m.live, m.look.color]), [[true, '#0000ff']]);
  assert.ok(looks.every((m) => !m.target.screens.includes(c.id)));
  assert.equal(await color(c), before, 'écran non patché inchangé');
  assert.equal(await live(c), false);
  for (const s of [r.remote, ...r.screens]) assert.deepEqual(s.errors, []);
  await r.close();
});

test('priorité console, perte du signal → maintien → reprise par la télécommande, retour du signal', async () => {
  const r = await rig(2, 3);
  const [a, b] = r.screens;
  await patch(r.rp, a.id, { universe: 1, address: 1, personality: 'standard8' });
  await r.console.sacn(1, S8(255, 0, 0));
  await waitFor(a.page, () => screenBaseColor === '#ff0000' && screenDmxLive());
  // Ordres de look de la télécommande : ignorés sur A, appliqués sur B
  await r.rp.evaluate(() => {
    sendMsg({ type: 'color', color: '#00ff00' });
    sendMsg({ type: 'strobe', active: true, freq: 5, dur: 40 });
    sendMsg({ type: 'effect', name: 'police', active: true, params: { speed: 3 } });
    toggleBlackout();
  });
  await waitFor(b.page, () => screenBaseColor === '#00ff00' && !!screenStrobeTimer && screenBlackoutOn && _screenEffect === 'police');
  await r.broker.flush();
  await sleep(150);
  assert.deepEqual(await a.page.evaluate(() => [screenBaseColor, !!screenStrobeTimer, screenBlackoutOn, _screenEffect]), ['#ff0000', false, false, null]);
  // Appels et vibreur restent permis sous la console
  await r.rp.evaluate(() => { document.getElementById('callName').value = 'Régie'; setCallRing('silent'); triggerCall(); });
  await waitFor(a.page, () => _callState === 'ringing');
  await r.rp.evaluate(() => { sendMsg({ type: 'call:end' }); toggleBlackout(); sendMsg({ type: 'strobe', active: false }); sendMsg({ type: 'effect', active: false }); });
  // Perte du signal (sACN : 2,5 s) : un dernier look live:false, l'écran garde le rouge
  r.broker.clear();
  await waitFor(a.page, () => !screenDmxLive(), null, { timeout: 6000 });
  assert.equal(await color(a), '#ff0000', 'dernier look conservé');
  await r.broker.flush();
  const sentA = (await r.broker.sent(r.rp, 'dmx:look')).filter((m) => m.target.screens.includes(a.id));
  assert.ok(sentA.filter((m) => m.live).every((m) => m.look.color === '#ff0000'), 'maintien chaque seconde tant que live');
  assert.deepEqual(sentA.filter((m) => !m.live).map((m) => m.look.color), ['#ff0000'], 'live:false envoyé une fois');
  assert.equal(sentA.at(-1).live, false);
  // La télécommande reprend la main
  await r.rp.evaluate(() => sendMsg({ type: 'color', color: '#ffff00' }));
  await waitFor(a.page, () => screenBaseColor === '#ffff00');
  // Retour du signal : la console reprend la priorité immédiatement
  await r.console.sacn(1, S8(0, 0, 255));
  await waitFor(a.page, () => screenBaseColor === '#0000ff' && screenDmxLive());
  await r.rp.evaluate(() => sendMsg({ type: 'color', color: '#ffffff' }));
  await waitFor(b.page, () => screenBaseColor === '#ffffff');
  await sleep(150);
  assert.equal(await color(a), '#0000ff');
  // Arrêt de la passerelle = perte du signal
  await r.rp.evaluate(() => gwStop());
  await waitFor(a.page, () => !screenDmxLive());
  assert.equal(await color(a), '#0000ff');
  for (const s of [r.remote, ...r.screens]) assert.deepEqual(s.errors, []);
  await r.close();
});

test('Étendu 16 : effet, strobe, noir ; appel n déclenché une seule fois, 0 raccroche ; SMS n', async () => {
  const r = await rig(1, 4);
  const [a] = r.screens;
  // Liste enregistrée : 2 appels, 1 SMS
  await r.rp.evaluate(async () => {
    switchTab('call');
    document.getElementById('callName').value = 'Maman'; setCallRing('silent'); await saveCurrentCall();
    document.getElementById('callName').value = 'Agence immobilière'; setCallStyle('tonal'); await saveCurrentCall();
    setCallKind('sms'); document.getElementById('callName').value = 'Léa'; document.getElementById('callMsgText').value = 'Tu es où ??'; await saveCurrentCall();
  });
  await patch(r.rp, a.id, { universe: 1, address: 1, personality: 'extended16' });
  const E16 = (o = {}) => { const s = [255, 255, 255, 0, 0, 54, 128, 0, 0, 0, 128, 0, 0, 0, 0, 0]; for (const [k, v] of Object.entries(o)) s[k - 1] = v; return s; };
  await r.console.sacn(1, E16());
  await waitFor(a.page, () => screenBaseColor === '#ff0000' && screenDmxLive());
  // Effet Police (90) à mi-vitesse, puis strobe, puis écran noir
  await r.console.sacn(1, E16({ 10: 90 }));
  await waitFor(a.page, () => _screenEffect === 'police');
  await r.console.sacn(1, E16({ 10: 90, 9: 255 }));
  await waitFor(a.page, () => !!screenStrobeTimer);
  await r.console.sacn(1, E16({ 10: 90, 9: 255, 16: 200 }));
  await waitFor(a.page, () => screenBlackoutOn);
  await r.console.sacn(1, E16());
  await waitFor(a.page, () => !screenBlackoutOn && !screenStrobeTimer && _screenEffect === null);
  // Appel n° 2 (20–29) : maintenu plusieurs trames, déclenché une seule fois
  for (const v of [20, 20, 25, 29, 5, 20]) await r.console.sacn(1, E16({ 14: v }));
  await waitFor(a.page, () => _callState === 'ringing');
  assert.match(await a.page.evaluate(() => document.getElementById('screen-call').innerHTML), /Agence immobilière/);
  await r.broker.flush();
  const starts = await r.broker.sent(r.rp, 'call:start');
  assert.equal(starts.length, 1, 'un seul déclenchement');
  assert.deepEqual([starts[0].kind, starts[0].name, starts[0].style, starts[0].target], ['call', 'Agence immobilière', 'tonal', { screens: [a.id] }]);
  // 0 : raccrocher
  await r.console.sacn(1, E16({ 14: 0 }));
  await waitFor(a.page, () => _callState === 'idle');
  await r.broker.flush();
  assert.deepEqual((await r.broker.sent(r.rp, 'call:end')).map((m) => m.target), [{ screens: [a.id] }]);
  // SMS n° 1 (10–19)
  await r.console.sacn(1, E16({ 15: 12 }));
  await waitFor(a.page, () => _callState === 'notif');
  assert.match(await a.page.evaluate(() => document.getElementById('screen-call').innerHTML), /Tu es où \?\?/);
  for (const s of [r.remote, ...r.screens]) assert.deepEqual(s.errors, []);
  await r.close();
});

test('moniteur : tous les canaux de l\'empreinte, valeur et sens décodé, badge Console, 0–255 / %, Identifier, Dépatcher', async () => {
  const r = await rig(1, 5);
  const [a] = r.screens;
  await patch(r.rp, a.id, { universe: 1, address: 17, personality: 'extended16' });
  const slots = new Array(32).fill(0);
  [204, 0, 255, 180, 96, 82, 128, 40, 0, 0, 0, 30, 0, 0, 0, 0].forEach((v, i) => { slots[16 + i] = v; });
  await r.console.sacn(1, slots);
  await waitFor(a.page, () => screenDmxLive());
  await r.rp.evaluate((id) => gwOpenMonitor(id), a.id);
  await waitFor(r.rp, () => !document.getElementById('gwMonConsole').hidden);
  const rows = await r.rp.evaluate(() => [...document.querySelectorAll('#gwMonRows .gw-ch')].map((el) => [...el.children].map((c) => c.textContent)));
  assert.equal(rows.length, 16, 'les 16 canaux');
  assert.deepEqual(rows.map((x) => x[0]), Array.from({ length: 16 }, (_, i) => String(17 + i)));
  assert.ok(rows.every((x) => /^\d+$/.test(x[3])), 'une valeur pour chaque canal');
  assert.deepEqual(rows.map((x) => [x[1], x[3], x[4]]), [
    ['Dimmer', '204', '80 %'], ['Dimmer Fine', '0', '—'], ['Rouge', '255', '100 %'], ['Vert', '180', '71 %'], ['Bleu', '96', '38 %'],
    ['CCT', '82', '7 600 K'], ['Tint', '128', 'neutre'], ['Mix', '40', '16 % blanc'], ['Strobo', '0', 'arrêt'], ['Effet', '0', 'aucun'],
    ['Vitesse effet', '0', '—'], ['Média', '30', 'n°3'], ['Lecture', '0', 'lecture'], ['Appel', '0', 'raccroché'], ['SMS', '0', 'aucun'], ['Écran', '0', 'allumé'],
  ]);
  assert.equal(await r.rp.textContent('#gwMonRange'), 'Canaux 17–32');
  assert.equal(await r.rp.textContent('#gwMonName'), 'Écran 1');
  await r.rp.evaluate(() => gwSetMonitorUnit(true));
  assert.deepEqual(await r.rp.evaluate(() => [...document.querySelectorAll('#gwMonRows .gw-ch-v')].slice(0, 3).map((e) => e.textContent)), ['80', '0', '100']);
  // Identifier : l'écran clignote 3 s sans changer d'état
  const c0 = await color(a);
  await r.rp.evaluate(() => gwIdentify());
  await waitFor(a.page, () => document.getElementById('screen-identify').classList.contains('on'));
  assert.equal(await color(a), c0);
  // Modifier l'adresse depuis le moniteur, puis dépatcher : l'écran est rendu à la télécommande
  await r.rp.fill('#gwMonAddress', '999');
  await r.rp.dispatchEvent('#gwMonAddress', 'change');
  assert.equal(await r.rp.evaluate(() => document.getElementById('gwMonAddress').classList.contains('bad')), true);
  await r.rp.fill('#gwMonAddress', '1');
  await r.rp.dispatchEvent('#gwMonAddress', 'change');
  assert.equal(await r.rp.evaluate((id) => gwState.patch.get(id).address, a.id), 1);
  await r.rp.evaluate(() => gwUnpatch());
  await waitFor(a.page, () => !screenDmxLive());
  assert.equal(await r.rp.evaluate(() => _gwView), 'patch');
  for (const s of [r.remote, ...r.screens]) assert.deepEqual(s.errors, []);
  await r.close();
});

test('Art-Net : ArtDmx vers l\'écran patché, ArtPoll → ArtPollReply unicast par la coque', async () => {
  const r = await rig(1, 6);
  const [a] = r.screens;
  await r.rp.evaluate(() => window.SRNative.receive({ type: 'net:info', interfaces: [{ name: 'en1', kind: 'ethernet', ip: '2.0.0.42', mask: '255.0.0.0' }] }));
  await r.rp.evaluate(() => gwSetProtocol('artnet'));
  await patch(r.rp, a.id, { universe: 0, address: 4, personality: 'simple3' });
  assert.deepEqual((await r.console.posted('dmx:listen')).at(-1), { type: 'dmx:listen', protocol: 'artnet', universes: [0], multicast: false });
  await r.console.artnet(0, [0, 0, 0, 12, 34, 56]);
  await waitFor(a.page, () => screenBaseColor === '#0c2238' && screenDmxLive());
  // ArtPoll reçu de la console : réponse unicast vers elle, port 6454
  await r.console.deliver([{ src: '2.0.0.1', port: 6454, data: b64(buildArtPoll()) }]);
  const sends = await r.console.posted('udp:send');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].host, '2.0.0.1');
  assert.equal(sends[0].port, 6454);
  const reply = parseArtNet(Buffer.from(sends[0].data, 'base64'));
  assert.equal(reply.kind, 'pollReply');
  assert.equal(reply.ip, '2.0.0.42');
  assert.equal(reply.shortName, 'SetRemote GW');
  assert.deepEqual(reply.ports.map((p) => p.portAddress), [0]);
  assert.match(await r.rp.evaluate(() => { gwShowView('gateway'); return document.getElementById('gwUniverses').textContent; }), /Univers 0.*10\.0\.0\.20/);
  for (const s of [r.remote, ...r.screens]) assert.deepEqual(s.errors, []);
  await r.close();
});

test('sACN multicast : groupes 239.255.x.y des univers patchés demandés à la coque', async () => {
  const { page, close } = await openPage(browser, { init: NATIVE });
  await page.evaluate(() => { startMode('remote'); remoteNoteScreen('sAAAAAAAA', { type: 'caps', screenId: 'ScreenOne0000001' }); openDmxGateway(); });
  await patch(page, 'ScreenOne0000001', { universe: 300, address: 1, personality: 'simple3' });
  const l = (await new FakeConsole(page).posted('dmx:listen')).at(-1);
  assert.deepEqual(l, { type: 'dmx:listen', protocol: 'sacn', universes: [300], multicast: true });
  assert.equal(sacnMulticastAddress(l.universes[0]), '239.255.1.44', 'groupe que la coque doit rejoindre');
  await close();
});

const canvasFile = (page, color, name) => page.evaluate(([color, name]) => new Promise((res) => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 40;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 64, 40);
  c.toBlob((b) => { window.__files = window.__files || {}; window.__files[name] = new File([b], name, { type: 'image/png' }); res(true); }, 'image/png');
}), [color, name]);

test('Étendu 16 : média n° n du pool (en cache), « pas de changement », masqué à 0 ; la télécommande ne peut pas l\'arrêter sous la console', async () => {
  const r = await rig(1, 7);
  const [a] = r.screens;
  await canvasFile(r.rp, '#ff0000', 'rouge.png');
  await canvasFile(r.rp, '#00ff00', 'vert.png');
  await r.rp.evaluate(() => onAddImages([window.__files['rouge.png'], window.__files['vert.png']]));
  await waitFor(a.page, () => _mediaCache.has('m1') && _mediaCache.has('m2') && _mediaOrder.length === 2, null, { timeout: 10000 });
  await r.rp.evaluate(() => stopMediaBroadcast());
  await waitFor(a.page, () => !screenMediaVisible());
  await patch(r.rp, a.id, { universe: 1, address: 1, personality: 'extended16' });
  const E16 = (media) => [255, 255, 0, 0, 0, 54, 128, 0, 0, 0, 128, media, 0, 0, 0, 0];
  const shown = () => a.page.evaluate(() => (screenMediaVisible() ? _screenActiveId : null));
  await r.console.sacn(1, E16(20));
  await waitFor(a.page, () => screenMediaVisible() && _screenActiveId === 'm2');
  await r.rp.evaluate(() => { sendMsg({ type: 'media-stop' }); sendMsg({ type: 'media:show', id: 'm1' }); });
  await r.broker.flush();
  await sleep(200);
  assert.equal(await shown(), 'm2', 'ordres média de la télécommande ignorés');
  await r.console.sacn(1, E16(10));
  await waitFor(a.page, () => _screenActiveId === 'm1' && screenMediaVisible());
  await r.console.sacn(1, E16(5)); // 1–9 : pas de changement
  await r.console.sacn(1, E16(0));
  await waitFor(a.page, () => !screenMediaVisible());
  await r.console.sacn(1, E16(50)); // média n° 5 absent du pool : rien à afficher
  await r.console.sacn(1, E16(255)); // hors liste : pas de changement
  await r.broker.flush();
  await sleep(200);
  assert.equal(await shown(), null);
  for (const s of [r.remote, ...r.screens]) assert.deepEqual(s.errors, []);
  await r.close();
});

test('débit : au plus 30 looks par seconde et par écran, la dernière valeur arrive toujours', async () => {
  const r = await rig(1, 8);
  const [a] = r.screens;
  await patch(r.rp, a.id, { universe: 1, address: 1, personality: 'simple3' });
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) await r.console.sacn(1, [i, 0, 0]);
  const elapsed = Date.now() - t0;
  await waitFor(a.page, () => screenBaseColor === '#3b0000');
  await r.broker.flush();
  const looks = (await r.broker.sent(r.rp, 'dmx:look')).filter((m) => m.target.screens.includes(a.id));
  assert.ok(looks.length < 60, looks.length + ' looks pour 60 trames');
  assert.ok(looks.length <= Math.ceil((elapsed + 100) / 1000 * 30) + 1, looks.length + ' looks en ' + elapsed + ' ms');
  assert.equal(looks.at(-1).look.color, '#3b0000');
  await r.close();
});
