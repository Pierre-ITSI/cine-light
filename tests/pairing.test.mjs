// Appairage sécurisé entre pages réelles (faux broker MQTT) : QR (lien avec
// le secret dans le fragment), code manuel + comparaison du nombre (SAS),
// plusieurs écrans sur la même session, « Nouvelle session », liaison.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, SRP, pairingHash, nativeShell, ROOT } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });

const PUBLIC_URL = 'https://pierre-itsi.github.io/cine-light/';
async function startRemote(broker, seed, init = null) {
  const r = await openPage(browser, { broker, seed, autoConnect: true, init });
  await r.page.evaluate(() => startMode('remote'));
  await connected(r.page);
  return r;
}
async function screenFromLink(broker, remotePage, seed) {
  const s = await openPage(browser, { broker, seed, autoConnect: true, hash: await pairingHash(remotePage) });
  await connected(s.page);
  return s;
}
// Code affiché par la télécommande, prêt (client de rendez-vous abonné)
async function remoteCode(page) {
  await page.evaluate(() => switchTab('qr'));
  await waitFor(page, () => _rdv && _rdv.client && _rdv.client.connected && _rdv.client.subscriptions.length > 0);
  return page.evaluate(() => document.getElementById('pairCode').textContent);
}
const verifyShown = (page) => waitFor(page, () => document.getElementById('pair-verify').style.display === 'block', null, { timeout: 8000 });
const sasOf = (page) => page.evaluate(() => document.getElementById('pvSas').textContent);

test('QR : deux écrans rejoignent la même session par le lien et reçoivent les mêmes commandes', async () => {
  const broker = new FakeBroker();
  // Télécommande dans l'app native (file://) : l'adresse publique vient de la coque
  const remote = await startRemote(broker, 21, nativeShell(PUBLIC_URL, true));
  const rp = remote.page;
  const hash = await pairingHash(rp);
  assert.match(hash, /^p=v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  // Le QR encode exactement le lien d'appairage (secret dans le fragment)
  const qr = await rp.evaluate(() => {
    switchTab('qr');
    const link = pairingLink(_session);
    const q = qrcode(0, 'M'); q.addData(link, 'Byte'); q.make();
    return { link, drawn: document.querySelector('#pairQr path').getAttribute('d'), expected: qrSvg(link).match(/ d="([^"]+)"/)[1], n: q.getModuleCount() };
  });
  assert.equal(qr.link, PUBLIC_URL + '#' + hash, 'adresse publique de la coque, jamais file://');
  assert.equal(qr.drawn, qr.expected);
  assert.ok(qr.n >= 21);
  const A = await screenFromLink(broker, rp, 22);
  const B = await screenFromLink(broker, rp, 23);
  for (const s of [A, B]) {
    assert.deepEqual(await s.page.evaluate(() => [location.hash, mode]), ['', 'screen'], 'fragment effacé, écran actif');
    assert.deepEqual(await s.page.evaluate(() => _session), await rp.evaluate(() => _session));
  }
  // La télécommande voit les deux écrans (identifiants distincts)
  await waitFor(rp, () => _pairedScreens.size === 2);
  assert.equal(await rp.evaluate(() => document.getElementById('pairScreensCount').textContent), '2');
  assert.equal(await rp.evaluate(() => document.getElementById('linkPillLabel').textContent), 'Internet · chiffré');
  const ids = await Promise.all([A, B].map((s) => s.page.evaluate(() => localStorage.getItem('setremote-screen-id'))));
  assert.notEqual(ids[0], ids[1]);
  // Même commande, mêmes effets sur les deux écrans
  await rp.evaluate(() => { setKelvin(2700); toggleBlackout(); });
  const color = await rp.evaluate(() => currentColor);
  for (const s of [A, B]) {
    await waitFor(s.page, (c) => screenBaseColor === c && screenBlackoutOn === true, color);
  }
  await rp.evaluate(() => toggleBlackout());
  for (const s of [A, B]) await waitFor(s.page, () => screenBlackoutOn === false);
  for (const p of [remote, A, B]) assert.deepEqual(p.errors, []);
  await A.close(); await B.close(); await remote.close();
});

test('code manuel : ECDH + engagement, même nombre (SAS) sur les deux appareils, puis session commune', async () => {
  const broker = new FakeBroker();
  const remote = await startRemote(broker, 31);
  const rp = remote.page;
  const viaQr = await screenFromLink(broker, rp, 32); // un écran déjà appairé par QR
  const code = await remoteCode(rp);
  assert.match(code, /^[A-HJKMNP-Z2-9]{3}·[A-HJKMNP-Z2-9]{3}$/);
  const screen = await openPage(browser, { broker, seed: 33, autoConnect: true });
  const sp = screen.page;
  await sp.evaluate(() => startMode('screen'));
  assert.equal(await sp.evaluate(() => getComputedStyle(document.getElementById('screen-connect')).display), 'flex');
  // Saisie souple : minuscules et tiret acceptés
  await sp.fill('#pairCodeInput', code.replace('·', '-').toLowerCase());
  await sp.click('#screen-connect .screen-go-btn');
  await verifyShown(sp);
  await verifyShown(rp);
  const [sasR, sasS] = [await sasOf(rp), await sasOf(sp)];
  assert.match(sasR, /^\d{3} \d{3}$/);
  assert.equal(sasS, sasR, 'les deux appareils affichent le même nombre');
  assert.match(await rp.evaluate(() => document.getElementById('pvText').textContent), /L'écran de jeu affiche/);
  assert.match(await sp.evaluate(() => document.getElementById('pvText').textContent), /La télécommande affiche/);
  // L'écran confirme d'abord : il attend la remise du secret
  await sp.click('#pvOk');
  assert.deepEqual(await sp.evaluate(() => [document.getElementById('pvOk').disabled, document.getElementById('pvOk').textContent]), [true, 'En attente…']);
  assert.equal(await sp.evaluate(() => mode), null);
  // Puis la télécommande : l'écran reçoit la session COMMUNE (pas un secret à part)
  await rp.click('#pvOk');
  await connected(sp);
  const remoteSession = await rp.evaluate(() => _session);
  assert.deepEqual(await sp.evaluate(() => _session), remoteSession);
  assert.deepEqual(await sp.evaluate(() => JSON.parse(localStorage.getItem('setremote-screen-session-v1'))), remoteSession);
  assert.equal(await sp.evaluate(() => document.getElementById('pair-verify').style.display), 'none');
  // Un nouveau code est proposé pour l'écran suivant
  await waitFor(rp, (c) => document.getElementById('pairCode').textContent !== c, code);
  // Le rendez-vous en clair ne contient jamais le secret de session
  const plain = [...broker.plain(rp), ...broker.plain(sp)];
  assert.deepEqual([...new Set(plain.map((m) => m.type))].sort(), ['pair:commit', 'pair:key', 'pair:reveal', 'pair:session']);
  for (const m of plain) {
    assert.ok(SRP.validateRendezvousMessage(m), m.type);
    const raw = JSON.stringify(m);
    assert.ok(!raw.includes(remoteSession.key) && !raw.includes(remoteSession.channelId), 'secret absent du rendez-vous : ' + m.type);
  }
  // Les deux écrans (QR et code) jouent ensemble
  await waitFor(rp, () => _pairedScreens.size === 2);
  await rp.evaluate(() => setKelvin(3200));
  const color = await rp.evaluate(() => currentColor);
  await waitFor(sp, (c) => screenBaseColor === c, color);
  await waitFor(viaQr.page, (c) => screenBaseColor === c, color);
  for (const p of [remote, screen, viaQr]) assert.deepEqual(p.errors, []);
  await screen.close(); await viaQr.close(); await remote.close();
});

test('code manuel : annulation sur la télécommande, code incomplet', async () => {
  const broker = new FakeBroker();
  const remote = await startRemote(broker, 41);
  const rp = remote.page;
  const code = await remoteCode(rp);
  const screen = await openPage(browser, { broker, seed: 42, autoConnect: true });
  const sp = screen.page;
  await sp.evaluate(() => startMode('screen'));
  await sp.fill('#pairCodeInput', 'AB');
  await sp.click('#screen-connect .screen-go-btn');
  assert.match(await sp.textContent('#pairCodeHelp'), /Code incomplet/);
  assert.equal(await sp.evaluate(() => _rdv), null);
  await sp.fill('#pairCodeInput', code.replace('·', ''));
  await sp.click('#screen-connect .screen-go-btn');
  await verifyShown(sp);
  await verifyShown(rp);
  // « Annuler » sur la télécommande (nombres différents) : l'écran est prévenu
  await rp.click('.pv-cancel');
  await waitFor(sp, () => document.getElementById('pair-verify').style.display === 'none');
  assert.match(await sp.textContent('#pairCodeHelp'), /annulé/);
  assert.deepEqual(await sp.evaluate(() => [mode, localStorage.getItem('setremote-screen-session-v1'), _rdv]), [null, null, null]);
  assert.notEqual(await rp.evaluate(() => document.getElementById('pairCode').textContent), code, 'nouveau code');
  assert.ok(broker.plain(rp, 'pair:abort').length >= 1);
  assert.equal(broker.plain(rp, 'pair:session').length, 0, 'aucun secret remis');
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('« Nouvelle session » : les écrans appairés sont révoqués', async () => {
  const broker = new FakeBroker();
  const remote = await startRemote(broker, 51, nativeShell(PUBLIC_URL));
  const rp = remote.page;
  const screen = await screenFromLink(broker, rp, 52);
  await rp.evaluate(() => setKelvin(2700));
  const c1 = await rp.evaluate(() => currentColor);
  await waitFor(screen.page, (c) => screenBaseColor === c, c1);
  const [oldLink, oldTopic] = await rp.evaluate(() => [pairingLink(_session), _sec.mqttTopic]);
  await rp.evaluate(() => { window.confirm = () => true; switchTab('qr'); confirmNewSession(); });
  await waitFor(rp, (t) => _sec && _sec.mqttTopic !== t && mqttClient.connected, oldTopic);
  assert.notEqual(await rp.evaluate(() => pairingLink(_session)), oldLink);
  assert.equal(await rp.evaluate(() => _pairedScreens.size), 0);
  await rp.evaluate(() => setKelvin(9000));
  await sleep(400); await broker.flush();
  assert.equal(await screen.page.evaluate(() => screenBaseColor), c1, 'l\'ancien écran ne reçoit plus rien');
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('liaison : écran muet depuis 40 s → « Hors ligne · 1 écran », signe de vie → « Internet · chiffré »', async () => {
  const broker = new FakeBroker();
  const remote = await startRemote(broker, 61);
  const rp = remote.page;
  const screen = await screenFromLink(broker, rp, 62);
  await waitFor(rp, () => _pairedScreens.size === 1);
  assert.ok(await screen.page.evaluate(() => _screenAliveTimer !== null), 'signe de vie programmé côté écran');
  // Écran muet : on vieillit sa dernière trame
  await rp.evaluate(() => { for (const s of _pairedScreens.values()) s.lastSeen -= SCREEN_OFFLINE_MS + 1000; renderLinkStatus(); });
  assert.deepEqual(await rp.evaluate(() => [document.getElementById('linkPill').className, document.getElementById('linkPillLabel').textContent]),
    ['link-pill offline', 'Hors ligne · 1 écran']);
  assert.match(await rp.evaluate(() => document.getElementById('pairScreensList').textContent), /Écran 1Hors ligne/);
  // Toucher la pastille ouvre le détail (onglet d'appairage)
  await rp.click('#linkPill');
  assert.equal(await rp.evaluate(() => document.getElementById('content-qr').classList.contains('active')), true);
  // Signe de vie de l'écran : de retour en ligne
  await screen.page.evaluate(() => sendMsg({ type: 'screen:alive' }));
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Internet · chiffré');
  assert.match(await rp.evaluate(() => document.getElementById('pairScreensList').textContent), /Écran 1Internet/);
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('lien d\'appairage : adresse publique de la coque native, http(s) = origin + chemin, jamais file://', async () => {
  const pairing = SRP.createPairing();
  const linkOf = (page) => page.evaluate((p) => ({ base: pairingBaseUrl(), link: pairingLink(p), proto: location.protocol }), pairing);
  // App native (interface embarquée en file://) : adresse fournie par la coque
  const app = await openPage(browser, { init: nativeShell(PUBLIC_URL, true) });
  const a = await linkOf(app.page);
  assert.equal(a.proto, 'file:');
  assert.equal(a.link, SRP.pairingUrl(PUBLIC_URL, pairing));
  await app.close();
  // Injection Android tardive : la coque est reconnue sans adresse publique →
  // pas de lien (donc pas de QR), jamais une URL file://
  const late = await openPage(browser, { init: nativeShell('', true) });
  await late.page.evaluate(() => { delete window.SETREMOTE_NATIVE.publicUrl; startMode('remote'); switchTab('qr'); });
  const l = await linkOf(late.page);
  assert.deepEqual([l.base, l.link], [null, null]);
  assert.equal(await late.page.evaluate(() => document.getElementById('pairQr').innerHTML), '', 'pas de QR');
  assert.match(await late.page.evaluate(() => document.getElementById('pairCode').textContent), /·/, 'le code reste proposé');
  await late.close();
  // Adresse publique invalide (non http(s)) : ignorée
  const bad = await openPage(browser, { init: nativeShell('file:///android_asset/web/index.html') });
  assert.equal((await linkOf(bad.page)).link, null);
  await bad.close();
  // PWA servie en https : origin + chemin (sans requête ni fragment)
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== 'https://setremote.test') return route.abort();
    const rel = u.pathname.replace(/^\/app\//, '') || 'index.html';
    try {
      const body = readFileSync(path.join(ROOT, rel));
      const type = rel.endsWith('.html') ? 'text/html' : rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
      return route.fulfill({ body, contentType: type });
    } catch (_) { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage();
  await page.goto('https://setremote.test/app/?source=pwa#p=old');
  const h = await linkOf(page);
  assert.equal(h.proto, 'https:');
  assert.equal(h.base, 'https://setremote.test/app/');
  assert.equal(h.link, SRP.pairingUrl('https://setremote.test/app/', pairing));
  await context.close();
});

test('lien d\'appairage : PUBLIC_URL (01-config.js) remplace location, la coque native reste prioritaire', async () => {
  const pairing = SRP.createPairing();
  const NEW = 'https://set-remote.itsi-app.com/';
  const cfg = (c, native) => ({
    fn: ([c, n]) => { window.SETREMOTE_CONFIG = c; if (n) window.SETREMOTE_NATIVE = { platform: 'ios', bridge: 1, publicUrl: n }; },
    arg: [c, native],
  });
  const linkOf = async (init) => {
    const p = await openPage(browser, { init });
    const r = await p.page.evaluate((x) => ({ cfg: PUBLIC_URL, base: pairingBaseUrl(), link: pairingLink(x) }), pairing);
    assert.deepEqual(p.errors, []);
    await p.close();
    return r;
  };
  // Défaut : vide (comportement historique ; ici file:// → pas de lien)
  assert.equal(defaultPublicUrl(), '', 'PUBLIC_URL vide par défaut dans 01-config.js');
  assert.deepEqual(await linkOf(null), { cfg: '', base: null, link: null });
  // Renseignée : base des liens même hors http(s)
  const set = await linkOf(cfg({ PUBLIC_URL: NEW }));
  assert.deepEqual([set.cfg, set.base, set.link], [NEW, NEW, SRP.pairingUrl(NEW, pairing)]);
  // Coque native : son adresse l'emporte
  const nat = await linkOf(cfg({ PUBLIC_URL: NEW }, PUBLIC_URL));
  assert.equal(nat.base, PUBLIC_URL);
  // Valeurs invalides ignorées (http, fragment, requête, identifiants, non-chaîne)
  for (const bad of ['http://set-remote.itsi-app.com/', NEW + '#p=x', NEW + '?a=1', 'https://u@h.fr/', 'https://', 42]) {
    assert.equal((await linkOf(cfg({ PUBLIC_URL: bad }))).cfg, '', String(bad));
  }
});

function defaultPublicUrl() {
  return /PUBLIC_URL:\s*'([^']*)'/.exec(readFileSync(path.join(ROOT, 'web/js/01-config.js'), 'utf8'))[1];
}

// Caméra simulée : flux vidéo d'un canvas où l'on dessine une image
async function fakeCamera(page, link) {
  await page.evaluate((link) => {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 360;
    const g = c.getContext('2d');
    const draw = (text) => {
      g.fillStyle = '#4a4f57'; g.fillRect(0, 0, c.width, c.height); // décor autour du QR
      if (!text) return;
      const q = qrcode(0, 'M'); q.addData(text, 'Byte'); q.make();
      const n = q.getModuleCount(), cell = Math.floor(300 / (n + 8)), size = (n + 8) * cell;
      const x0 = (c.width - size) / 2, y0 = (c.height - size) / 2;
      g.fillStyle = '#ffffff'; g.fillRect(x0, y0, size, size);
      g.fillStyle = '#000000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(x0 + (k + 4) * cell, y0 + (r + 4) * cell, cell, cell);
    };
    window.__camText = link;
    // Image rafraîchie en continu : le flux du canvas produit des images
    setInterval(() => draw(window.__camText), 100);
    draw(link);
    const stream = c.captureStream(10);
    window.__camRequests = 0;
    const md = navigator.mediaDevices || {};
    md.getUserMedia = async (constraints) => { window.__camRequests++; window.__camConstraints = constraints; return stream; };
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true });
  }, link);
}

test('scan dans l\'app sans BarcodeDetector (iPhone) : caméra + jsQR chargé à la demande', async () => {
  const broker = new FakeBroker();
  const remote = await startRemote(broker, 101, nativeShell(PUBLIC_URL));
  const link = await remote.page.evaluate(() => pairingLink(_session));
  const screen = await openPage(browser, { broker, seed: 102, autoConnect: true });
  const sp = screen.page;
  const requests = [];
  screen.context.on('request', (r) => requests.push(r.url()));
  assert.equal(await sp.evaluate(() => 'BarcodeDetector' in window), false, 'navigateur sans BarcodeDetector');
  // Un QR quelconque d'abord (pas un lien d'appairage) : ignoré
  await fakeCamera(sp, 'https://exemple.test/autre-chose');
  assert.equal(await sp.evaluate(() => typeof window.jsQR), 'undefined', 'décodeur non chargé avant la caméra');
  await sp.evaluate(() => startMode('screen'));
  await waitFor(sp, () => document.getElementById('pairScanBox').classList.contains('live'), null, { timeout: 8000 });
  assert.equal(await sp.evaluate(() => typeof window.jsQR), 'function', 'jsQR chargé à l\'ouverture de la caméra');
  assert.ok(requests.some((u) => u.endsWith('/vendor/jsqr-1.4.0.js')));
  assert.deepEqual(await sp.evaluate(() => ({
    label: document.getElementById('pairScanLabel').textContent,
    line: getComputedStyle(document.querySelector('.pj-scanline')).display,
    video: getComputedStyle(document.getElementById('pairScanVideo')).display,
    facing: window.__camConstraints.video.facingMode,
  })), { label: 'Caméra active — visez le QR', line: 'block', video: 'block', facing: 'environment' });
  await sleep(600);
  assert.equal(await sp.evaluate(() => mode), null, 'QR étranger ignoré');
  // Le QR de la télécommande entre dans le champ : appairage
  await sp.evaluate((l) => { window.__camText = l; }, link);
  await connected(sp);
  assert.deepEqual(await sp.evaluate(() => _session), await remote.page.evaluate(() => _session));
  assert.equal(await sp.evaluate(() => _scan), null, 'caméra libérée');
  assert.equal(await sp.evaluate(() => getComputedStyle(document.getElementById('screen-connect')).display), 'none');
  await waitFor(remote.page, () => _pairedScreens.size === 1);
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('scan : BarcodeDetector utilisé quand il existe ; caméra refusée → invitation à l\'appareil photo', async () => {
  const pairing = SRP.createPairing();
  const link = SRP.pairingUrl(PUBLIC_URL, pairing);
  const screen = await openPage(browser, { autoConnect: true });
  const sp = screen.page;
  await fakeCamera(sp, null);
  await sp.evaluate((link) => {
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code', 'ean_13']; }
      constructor(o) { window.__bdFormats = o.formats; }
      async detect() { return [{ rawValue: link }]; }
    };
    startMode('screen');
  }, link);
  await connected(sp);
  assert.deepEqual(await sp.evaluate(() => [_session, window.__bdFormats, typeof window.jsQR]), [pairing, ['qr_code'], 'undefined']);
  await screen.close();
  // Caméra refusée : repli sur l'appareil photo du téléphone, mise en page inchangée
  const denied = await openPage(browser);
  await denied.page.evaluate(() => {
    const md = navigator.mediaDevices || {};
    md.getUserMedia = async () => { throw new DOMException('refus', 'NotAllowedError'); };
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true });
    startMode('screen');
  });
  await sleep(200);
  assert.deepEqual(await denied.page.evaluate(() => [
    document.getElementById('pairScanLabel').textContent, document.getElementById('pairScanBox').classList.contains('live'), mode,
  ]), ['Visez le QR avec l\'appareil photo', false, null]);
  assert.deepEqual(denied.errors, []);
  await denied.close();
});
