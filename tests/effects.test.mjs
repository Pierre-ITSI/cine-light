// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Laboratoire d'effets : chaque effet de EFFECT_CONFIG se sélectionne, dessine
// des frames sans erreur (télécommande et écran), et les boutons −/+ des
// sliders utilisent les bornes COURANTES du slider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

// Exécuté dans la page : rend 90 frames d'un effet hors boucle rAF (le
// moteur avale les exceptions de la boucle ; ici elles remontent) et renvoie
// la proportion de pixels opaques.
function renderFrames([name, params]) {
  const c = document.createElement('canvas'); c.width = 240; c.height = 136;
  const ctx = c.getContext('2d');
  const st = {};
  for (let i = 0; i < 90; i++) {
    const t = i / 30;
    FX_LIB[name](ctx, c.width, c.height, t, _fxModulate(params, st, t), st);
  }
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let opaque = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] === 255) opaque++;
  return opaque / (c.width * c.height);
}

// Proportion de pixels opaques d'un canvas existant
function canvasCoverage(id) {
  const c = document.getElementById(id);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let opaque = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] === 255) opaque++;
  return opaque / (c.width * c.height);
}

test('chaque effet : sélection, réglages, aperçu et rendu canvas sans erreur', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('effects'); });
  const keys = await page.evaluate(() => Object.keys(EFFECT_CONFIG));
  assert.equal(keys.length, 14);
  const flashing = await page.evaluate(() => [...FLASH_RISK.effect]);
  for (const key of keys) {
    await page.click('#efxcard-' + key);
    // Effets à flashs rapides : avertissement photosensibilité, puis « Activer »
    const warned = await page.evaluate(() => getComputedStyle(document.getElementById('strobe-warn')).display === 'block');
    assert.equal(warned, flashing.includes(key), 'avertissement pour ' + key);
    if (warned) await page.click('#swOk');
    const ui = await page.evaluate((key) => {
      const cfg = EFFECT_CONFIG[key], sl = document.getElementById('effectSpeedSlider');
      return {
        active: activeScreenEffect, card: document.getElementById('efxcard-' + key).classList.contains('active'),
        panel: getComputedStyle(document.getElementById('effectSettingsPanel')).display,
        title: document.getElementById('effectSettingsTitle').textContent,
        speed: [+sl.min, +sl.max, +sl.value], cfg: [cfg.min, cfg.max, cfg.def],
        lib: typeof FX_LIB[key],
      };
    }, key);
    assert.equal(ui.active, key);
    assert.ok(ui.card, 'carte active ' + key);
    assert.equal(ui.panel, 'block');
    assert.match(ui.title, /^Réglages — /);
    assert.deepEqual(ui.speed, ui.cfg, 'bornes vitesse ' + key);
    assert.equal(ui.lib, 'function', 'FX_LIB.' + key);
    // L'aperçu (boucle rAF) a démarré et a dessiné au moins une frame
    await waitFor(page, () => getComputedStyle(document.getElementById('previewFxCanvas')).display === 'block');
    await waitFor(page, (id) => {
      const c = document.getElementById(id);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
      return false;
    }, 'previewFxCanvas');
    // Rendu direct avec les paramètres réels de l'interface
    const params = await page.evaluate(() => buildEffectParams());
    let ratio;
    try { ratio = await page.evaluate(renderFrames, [key, params]); } catch (e) { throw new Error(key + ' : ' + e.message); }
    assert.ok(ratio > 0.5, `${key} : frame dessinée (${ratio})`);
  }
  // Variantes du chaser (formes radiales, bounce, invert, wing)
  for (const v of [
    { shape: 'circle', dir: 'out' }, { shape: 'circle', dir: 'in', mode: 'bounce' },
    { shape: 'diamond', dir: 'in', invert: true }, { shape: 'band', dir: 'd', wing: 4, rot: 33, count: 12 },
  ]) {
    const p = { speed: 2, intensity: 100, chaos: 30, drift: 20, width: 20, fade: 120, lead: 120, count: 3, ...v };
    assert.ok(await page.evaluate(renderFrames, ['chaser', p]) > 0.5, 'chaser ' + JSON.stringify(v));
  }
  // Re-sélection = arrêt
  await page.click('#efxcard-fire');
  assert.equal(await page.evaluate(() => activeScreenEffect), null);
  assert.deepEqual(errors, []);
  await close();
});

test("écran : receiveEffect lance chaque effet sur le canvas plein écran", async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => screenJoinSession(SRP.createPairing()));
  const keys = await page.evaluate(() => Object.keys(EFFECT_CONFIG));
  for (const key of keys) {
    await page.evaluate((key) => receiveEffect({ type: 'effect', name: key, active: true, params: { speed: EFFECT_CONFIG[key].def, intensity: 100 } }), key);
    await waitFor(page, (key) => _screenFxR.current() === key, key);
    await sleep(60);
    const cov = await page.evaluate(canvasCoverage, 'screen-fx-canvas');
    assert.ok(cov > 0.5, `${key} : frame plein écran (${cov})`);
  }
  await page.evaluate(() => receiveEffect({ type: 'effect', name: null, active: false }));
  const off = await page.evaluate(() => ({ cur: _screenFxR.current(), fx: _screenEffect, display: document.getElementById('screen-fx-canvas').style.display }));
  assert.deepEqual(off, { cur: null, fx: null, display: 'none' });
  assert.deepEqual(errors, []);
  await close();
});

test('boutons −/+ : bornes lues en direct (Pulse BPM 60 → 61)', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('effects'); });
  await page.click('#efxcard-pulse');
  const sl = page.locator('#effectSpeedSlider');
  const plus = page.locator('#effectSpeedSlider + .slider-btn');
  const minus = page.locator('.slider-btn:has(+ #effectSpeedSlider)');
  assert.deepEqual(await sl.evaluate((s) => [s.min, s.max, s.step, s.value]), ['20', '240', '1', '60']);
  await plus.click();
  assert.equal(await sl.inputValue(), '61');
  assert.equal(await page.textContent('#effectSpeedVal'), '61');
  await minus.click(); await minus.click();
  assert.equal(await sl.inputValue(), '59');
  // Les paramètres envoyés suivent (debounce 80 ms)
  await sleep(150);
  assert.equal(await page.evaluate(() => buildEffectParams().speed), 59);
  // Changement d'effet : nouvelles bornes (Chaser 0,1–6 pas 0,1)
  await page.click('#efxcard-chaser');
  assert.equal(await sl.inputValue(), '1');
  await plus.click();
  assert.equal(await sl.inputValue(), '1.1');
  // Saturation aux bornes : dimmer à 100 reste à 100
  await page.evaluate(() => switchTab('color'));
  const dPlus = page.locator('#dimmerSlider + .slider-btn');
  await dPlus.click();
  assert.equal(await page.locator('#dimmerSlider').inputValue(), '100');
  await page.locator('.slider-btn:has(+ #dimmerSlider)').click();
  assert.equal(await page.evaluate(() => colorDimmer), 99);
  // Valeur cliquable → saisie numérique bornée
  await page.click('#dimmerVal');
  await page.fill('#dimmerVal ~ input, .slider-header input[type=number]', '250');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => colorDimmer), 100);
  assert.deepEqual(errors, []);
  await close();
});
