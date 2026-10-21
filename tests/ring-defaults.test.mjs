// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Défauts des sons (81-ringtones.js) : appel Classique ; SMS et notification Métallophone Do ;
// discussion Envoi ; vibreur coché partout. Installations neuves et champs absents ou invalides
// seulement : les choix déjà enregistrés (setremote-ring-v1) sont gardés tels quels.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

test('nouveaux défauts : appel Classique, SMS et notification Métallophone Do, discussion Envoi, vibreur partout ; choix déjà enregistrés gardés', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => startMode('remote'));
  const settings = () => page.evaluate(() => JSON.parse(JSON.stringify(ringSettings)));
  // Installation neuve : rien d'enregistré
  await page.evaluate(() => { localStorage.removeItem(RING_SETTINGS_KEY); loadRingSettings(); });
  assert.deepEqual(await settings(), {
    call: { sound: 'classic', vol: 1, vib: true }, sms: { sound: 'metal-do', vol: 1, vib: true },
    notif: { sound: 'metal-do', vol: 1, vib: true }, discussion: { sound: 'sent', vol: 1, vib: true },
  });
  // Champs envoyés à l'écran : son par défaut et vibreur
  assert.deepEqual(await page.evaluate(() => [ringFormFields('sms'), ringFormFields('notif'), ringFormFields('call'), ringChatFields()]),
    [{ ring: 'metal-do', vib: true }, { ring: 'metal-do', vib: true }, { ring: 'classic', vib: true }, { ring: 'sent', vib: true }]);
  // Choix déjà enregistrés (même l'ancien défaut, même « vibreur non ») : conservés tels quels
  await page.evaluate(() => {
    localStorage.setItem(RING_SETTINGS_KEY, JSON.stringify({ v: 1, call: { sound: 'digital', vol: 0.7, vib: false }, sms: { sound: 'classic', vol: 1, vib: false },
      notif: { sound: 'classic', vol: 0.5, vib: true }, discussion: { sound: 'silent', vol: 1, vib: false } }));
    loadRingSettings();
  });
  assert.deepEqual(await settings(), {
    call: { sound: 'digital', vol: 0.7, vib: false }, sms: { sound: 'classic', vol: 1, vib: false },
    notif: { sound: 'classic', vol: 0.5, vib: true }, discussion: { sound: 'silent', vol: 1, vib: false },
  });
  // Valeurs absentes ou invalides : défauts du type (son) et vibreur oui
  await page.evaluate(() => {
    localStorage.setItem(RING_SETTINGS_KEY, JSON.stringify({ v: 1, call: { sound: 'metal-do' }, sms: { sound: 'nope', vol: 0.4 }, notif: {}, discussion: { sound: 'metal-sol', vib: 'x' } }));
    loadRingSettings();
  });
  assert.deepEqual(await settings(), {
    call: { sound: 'classic', vol: 1, vib: true }, sms: { sound: 'metal-do', vol: 0.4, vib: true },
    notif: { sound: 'metal-do', vol: 1, vib: true }, discussion: { sound: 'metal-sol', vol: 1, vib: true },
  });
  // Replis : entrée sans son, son invalide pour son type
  const f = await page.evaluate(() => [ringMsgFields(undefined, 1, 'sms').ring, ringMsgFields('nope', 1, 'notif').ring, ringMsgFields('metal-do', 1, 'call').ring, ringMsgFields(undefined, 1, 'discussion').ring,
    _clSanitize({ id: 'e1', kind: 'sms', ring: 'bad', ringVolume: 1 }).ring, _clSanitize({ id: 'e2', kind: 'call', ring: 'metal-do', ringVolume: 1 }).ring,
    (ringApplyEntry({ kind: 'notif' }), ringSettings.notif.sound), (ringApplyEntry({ kind: 'call' }), ringSettings.call.sound)]);
  assert.deepEqual(f, ['metal-do', 'metal-do', 'classic', 'sent', 'metal-do', 'classic', 'metal-do', 'classic']);
  // Un projet sans réglage de son prend les nouveaux défauts
  assert.deepEqual(await page.evaluate(() => _prjRingSettings(null)), {
    call: { sound: 'classic', vol: 1, vib: true }, sms: { sound: 'metal-do', vol: 1, vib: true },
    notif: { sound: 'metal-do', vol: 1, vib: true }, discussion: { sound: 'sent', vol: 1, vib: true },
  });
  // Nouvelle entrée enregistrée : son et vibreur par défaut
  await page.evaluate(() => { localStorage.removeItem(RING_SETTINGS_KEY); loadRingSettings(); switchTab('call'); });
  await page.evaluate(async () => { setCallKind('sms'); document.getElementById('callName').value = 'Léa'; await saveCurrentCall(); });
  assert.deepEqual(await page.evaluate(() => [callList.sms[0].ring, callList.sms[0].vib]), ['metal-do', true]);
  // Démos de la licence : mêmes défauts
  assert.deepEqual(await page.evaluate(() => [_demoCall(), _demoSms(), _demoNotif()].map((e) => [e.ring, e.vib])), [['classic', true], ['metal-do', true], ['metal-do', true]]);
  assert.deepEqual(errors, []);
  await close();
});
