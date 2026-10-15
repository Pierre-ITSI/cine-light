// Appairage sécurisé entre pages réelles (faux broker MQTT) : QR (lien avec
// le secret dans le fragment), code manuel + comparaison du nombre (SAS),
// plusieurs écrans sur la même session, « Nouvelle session », liaison.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, SRP, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });

async function startRemote(broker, seed) {
  const r = await openPage(browser, { broker, seed, autoConnect: true });
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
  const remote = await startRemote(broker, 21);
  const rp = remote.page;
  const hash = await pairingHash(rp);
  assert.match(hash, /^p=v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  // Le QR encode exactement le lien d'appairage (secret dans le fragment)
  const qr = await rp.evaluate(() => {
    switchTab('qr');
    const q = qrcode(0, 'M'); q.addData(pairingLink(_session), 'Byte'); q.make();
    return { drawn: document.querySelector('#pairQr path').getAttribute('d'), expected: qrSvg(pairingLink(_session)).match(/ d="([^"]+)"/)[1], n: q.getModuleCount() };
  });
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
  const remote = await startRemote(broker, 51);
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
