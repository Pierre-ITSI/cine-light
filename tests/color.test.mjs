// Chaîne couleur de la télécommande : dimmer / kelvin / tint / roue / HUE / RGB,
// synchronisation des trois modes de sélection et envoi automatique.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, connectFakeClients } from './helpers/harness.mjs';

// Oracle indépendant (formules de référence de l'app)
function kelvinToRgb(K) {
  const t = K / 100; let r, g, b;
  r = t <= 66 ? 255 : Math.min(255, Math.max(0, 329.698727446 * Math.pow(t - 60, -0.1332047592)));
  g = t <= 66 ? Math.min(255, Math.max(0, 99.4708025861 * Math.log(t) - 161.1195681661)) : Math.min(255, Math.max(0, 288.1221695283 * Math.pow(t - 60, -0.0755148492)));
  b = t >= 66 ? 255 : (t <= 19 ? 0 : Math.min(255, Math.max(0, 138.5177312231 * Math.log(t - 10) - 305.0447927307)));
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}
function expected({ kelvin = 5600, tint = 0, dimmer = 100, wheel = '#ffffff', crossfade = 0 }) {
  let { r, g, b } = kelvinToRgb(kelvin);
  if (tint > 0) { r *= 1 - tint / 100 * 0.45; b *= 1 - tint / 100 * 0.45; } else if (tint < 0) g *= 1 - Math.abs(tint) / 100 * 0.65;
  const c = { r: parseInt(wheel.slice(1, 3), 16), g: parseInt(wheel.slice(3, 5), 16), b: parseInt(wheel.slice(5, 7), 16) };
  const m = crossfade / 100, f = dimmer / 100;
  const cl = (v) => Math.min(255, Math.max(0, Math.round(v)));
  return '#' + [cl((r * (1 - m) + c.r * m) * f), cl((g * (1 - m) + c.g * m) * f), cl((b * (1 - m) + c.b * m) * f)]
    .map((v) => v.toString(16).padStart(2, '0')).join('');
}

let browser, ctx;
before(async () => {
  browser = await launchBrowser();
  ctx = await openPage(browser);
  await ctx.page.evaluate(() => startMode('remote'));
});
after(async () => { await ctx?.close(); await browser?.close(); });

const setRange = (page, id, v) => page.evaluate(([id, v]) => {
  const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, v]);
const state = (page) => page.evaluate(() => ({
  color: currentColor, hex: document.getElementById('previewHex').textContent,
  meta: document.getElementById('previewMeta').textContent,
  swatch: document.getElementById('previewSwatch').style.backgroundColor,
  wheel: colorWheelHex, crossfade: colorCrossfade, dimmer: colorDimmer, kelvin: kelvinK, tint: colorTint,
}));

test('état initial : 5600 K, tint 0, 100 %', async () => {
  const s = await state(ctx.page);
  assert.equal(s.color, expected({}));
  assert.equal(s.hex, s.color.toUpperCase());
  assert.equal(s.meta, '5600K · +0GM · 100%');
});

test('dimmer, kelvin et tint recalculent la couleur', async () => {
  const { page } = ctx;
  await setRange(page, 'dimmerSlider', 50);
  let s = await state(page);
  assert.equal(s.color, expected({ dimmer: 50 }));
  assert.equal(await page.evaluate(() => document.getElementById('dimmerVal').textContent), '50%');
  await page.evaluate(() => setKelvin(3200));
  s = await state(page);
  assert.equal(s.kelvin, 3200);
  assert.equal(s.color, expected({ dimmer: 50, kelvin: 3200 }));
  assert.match(await page.evaluate(() => document.getElementById('kelvinVal').textContent), /^3\s?200 K$/u);
  await page.evaluate(() => setTint(100));
  s = await state(page);
  assert.equal(s.color, expected({ dimmer: 50, kelvin: 3200, tint: 100 }));
  assert.equal(s.meta, '3200K · +100GM · 50%');
  await page.evaluate(() => setTint(-50));
  assert.equal((await state(page)).color, expected({ dimmer: 50, kelvin: 3200, tint: -50 }));
  // Puce kelvin = même effet que le slider
  await page.click('#content-color .chip:text("9000K")');
  assert.equal((await state(page)).kelvin, 9000);
  await page.evaluate(() => { setTint(0); setKelvin(5600); });
  await setRange(page, 'dimmerSlider', 100);
  assert.equal((await state(page)).color, expected({}));
});

test('roue : un clic réel choisit une teinte et synchronise HUE + RGB', async () => {
  const { page } = ctx;
  // Centré (le haut de l'écran peut être couvert par la mini-carte sticky)
  await page.evaluate(() => document.getElementById('colorWheel').scrollIntoView({ block: 'center' }));
  const box = await page.locator('#colorWheel').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 6); // haut de la roue : rouge saturé
  const s = await state(page);
  const rgb = await page.evaluate(() => ['rgbRedSlider', 'rgbGreenSlider', 'rgbBlueSlider'].map((id) => +document.getElementById(id).value));
  const hue = await page.evaluate(() => +document.getElementById('hueSlider').value);
  assert.notEqual(s.wheel, '#ffffff');
  assert.ok(rgb[0] > 200 && rgb[1] < 80 && rgb[2] < 80, 'rouge attendu, obtenu ' + rgb);
  assert.ok(hue <= 15 || hue >= 345, 'teinte ≈ 0°, obtenue ' + hue);
  assert.equal('#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join(''), s.wheel);
  const marker = await page.evaluate(() => document.getElementById('colorWheelMarkerFill').getAttribute('fill'));
  assert.equal(marker, s.wheel);
  // Crossfade 100 % : la sortie = la couleur de la roue
  await setRange(page, 'crossfadeSlider', 100);
  const s2 = await state(page);
  assert.equal(s2.color, s.wheel);
  assert.equal(s2.meta, 'Roue · 100%');
});

test('HUE et RGB restent alignés, crossfade partagé entre les modes', async () => {
  const { page } = ctx;
  await page.click('#chip-hue');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('colorPickHue')).display), 'block');
  await setRange(page, 'hueSlider', 120);
  let s = await state(page);
  assert.equal(s.wheel, '#00ff00');
  assert.deepEqual(await page.evaluate(() => ['rgbRedSlider', 'rgbGreenSlider', 'rgbBlueSlider'].map((id) => +document.getElementById(id).value)), [0, 255, 0]);
  // Marqueur de la roue replacé à 120° (vert pur, bord de la roue)
  const [mx, my] = (await page.evaluate(() => document.getElementById('colorWheelMarker').getAttribute('transform')))
    .match(/-?[\d.]+/g).map(Number);
  assert.ok(Math.abs(mx - 223.923) < 0.01 && Math.abs(my - 180) < 0.01, `marqueur ${mx},${my}`);
  await page.click('#chip-rgb');
  await setRange(page, 'rgbRedSlider', 0);
  await setRange(page, 'rgbGreenSlider', 0);
  await setRange(page, 'rgbBlueSlider', 255);
  s = await state(page);
  assert.equal(s.wheel, '#0000ff');
  assert.equal(await page.evaluate(() => +document.getElementById('hueSlider').value), 240);
  await setRange(page, 'rgbCrossfadeSlider', 40);
  const xf = await page.evaluate(() => ['crossfadeSlider', 'hueCrossfadeSlider', 'rgbCrossfadeSlider'].map((id) => +document.getElementById(id).value));
  assert.deepEqual(xf, [40, 40, 40]);
  s = await state(page);
  assert.equal(s.color, expected({ wheel: '#0000ff', crossfade: 40 }));
  assert.equal(s.meta, 'Mix 40% · 100%');
  await setRange(page, 'hueCrossfadeSlider', 100);
  await setRange(page, 'dimmerSlider', 50);
  assert.equal((await state(page)).color, '#000080');
  await page.click('#chip-wheel');
});

test('envoi automatique de la couleur sur le canal (≤ 40 ms après le réglage)', async () => {
  const { page } = ctx;
  await page.evaluate(() => { document.getElementById('channelInput').value = 'colortest'; connectChannel(); });
  await connectFakeClients(page);
  await waitFor(page, () => document.getElementById('connLabel').textContent.includes('Connecté'));
  await page.evaluate(() => { mqttClient.published.length = 0; setKelvin(2700); });
  const sent = await waitFor(page, () => {
    const m = mqttClient.published.map((p) => JSON.parse(p.payload)).filter((m) => m.type === 'color');
    return m.length ? m : null;
  });
  const s = await state(page);
  assert.equal(sent.at(-1).color, s.color);
  assert.equal(sent.at(-1)._id, await page.evaluate(() => mqttClient._myId));
  assert.deepEqual(ctx.errors, []);
});
