import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONALITIES, PERSONALITY_IDS, EFFECTS, FixtureDecoder, decode, decodeStrobe, slotOf, footprint, defaultSlice,
  STROBE_FREQ_MAX, MEDIA_ITEMS, CALL_ITEMS,
} from '../personalities.js';
import { kelvinToRgb, tintWhite, rgbToHex, dmxToKelvin, dmxToTint, legacyDmxToTint, KELVIN_MIN, KELVIN_MAX } from '../color.js';
import { loadWebFunctions, readWebFile } from './helpers.js';

test('personnalités : identifiants, empreintes, tables de canaux complètes et contiguës', () => {
  assert.deepEqual(PERSONALITY_IDS, ['simple3', 'color5', 'standard8', 'extended16']);
  assert.deepEqual(PERSONALITY_IDS.map(footprint), [3, 5, 8, 16]);
  assert.equal(footprint('rgb6'), 0, 'anciennes personnalités supprimées');
  for (const p of Object.values(PERSONALITIES)) {
    assert.equal(p.channels.length, p.footprint, p.id);
    p.channels.forEach((c, i) => {
      assert.equal(c.n, i + 1, p.id + ' n');
      let next = 0;
      for (const r of c.ranges) {
        assert.equal(r.from, next, `${p.id} canal ${c.n} : plage contiguë`);
        assert.ok(r.to >= r.from && r.label.length > 0);
        next = r.to + 1;
      }
      assert.equal(next, 256, `${p.id} canal ${c.n} couvre 0–255`);
      assert.ok(c.default >= 0 && c.default <= 255);
    });
  }
  assert.deepEqual(PERSONALITIES.extended16.channels.map((c) => c.key), [
    'dimmer', 'dimmerFine', 'red', 'green', 'blue', 'cct', 'tint', 'mix', 'strobe',
    'effect', 'effectSpeed', 'media', 'playback', 'call', 'sms', 'screen',
  ]);
  assert.deepEqual(PERSONALITIES.standard8.channels.map((c) => c.key), ['dimmer', 'red', 'green', 'blue', 'cct', 'tint', 'mix', 'strobe']);
  assert.deepEqual(PERSONALITIES.color5.channels.map((c) => c.key), ['dimmer', 'red', 'green', 'blue', 'strobe']);
  assert.deepEqual(PERSONALITIES.simple3.channels.map((c) => c.key), ['red', 'green', 'blue']);
});

test('Simple 3 : R, G, B portent l’intensité', () => {
  assert.equal(decode('simple3', [255, 128, 0]).color, '#ff8000');
  assert.equal(decode('simple3', [0, 0, 0]).color, '#000000');
  const l = decode('simple3', [1, 2, 3]);
  assert.deepEqual([l.strobe.active, l.effect, l.media, l.blackout], [false, null, null, false]);
  assert.equal(decode('simple3', defaultSlice('simple3')).color, '#000000');
});

test('Couleur 5 : dimmer × RGB, strobe', () => {
  assert.equal(decode('color5', [255, 255, 0, 0, 0]).color, '#ff0000');
  assert.equal(decode('color5', [128, 255, 255, 255, 0]).color, '#808080');
  assert.equal(decode('color5', [0, 255, 255, 255, 0]).color, '#000000');
  assert.deepEqual(decode('color5', [255, 255, 255, 255, 255]).strobe, { active: true, freq: 30, dur: 17 });
  assert.equal(decode('color5', defaultSlice('color5')).color, '#000000', 'dimmer à 0 au repos');
});

test('Standard 8 : mix 0 = RGB pur, 255 = blanc CCT pur, fondu entre les deux', () => {
  const rgbOnly = decode('standard8', [255, 255, 0, 0, 0, 128, 0, 0]);
  assert.equal(rgbOnly.color, '#ff0000', 'mix 0 : CCT et tint sans effet');
  const k = dmxToKelvin(54);
  const white = kelvinToRgb(k);
  assert.equal(decode('standard8', [255, 255, 0, 0, 54, 128, 255, 0]).color, rgbToHex(white.r, white.g, white.b), 'mix 255 : RGB sans effet');
  const half = decode('standard8', [255, 255, 0, 0, 54, 128, 128, 0]).color;
  const m = 128 / 255;
  assert.equal(half, rgbToHex(255 * (1 - m) + white.r * m, white.g * m, white.b * m));
  assert.equal(decode('standard8', [128, 0, 0, 255, 0, 128, 0, 0]).color, '#000080', 'dimmer');
  assert.equal(decode('standard8', [255, 255, 255, 255, 0, 128, 0, 0]).color, '#ffffff');
});

test('CCT 1700–20000 K (plage de l’app) et tint 0 = magenta, 128 = neutre, 255 = vert', () => {
  assert.equal(dmxToKelvin(0), KELVIN_MIN);
  assert.equal(dmxToKelvin(255), KELVIN_MAX);
  assert.deepEqual([dmxToTint(0), dmxToTint(128), dmxToTint(255)], [-100, 0, 100]);
  assert.ok(dmxToTint(127) < 0 && dmxToTint(129) > 0, 'une seule valeur neutre');
  const slider = /id="kelvinSlider" min="(\d+)" max="(\d+)"/.exec(readWebFile('../index.template.html') || '');
  if (slider) assert.deepEqual([Number(slider[1]), Number(slider[2])], [KELVIN_MIN, KELVIN_MAX], 'plage du curseur de l’app');
  const at = (t) => decode('standard8', [255, 0, 0, 0, 54, t, 255, 0]).color;
  const neutral = at(128), magenta = at(0), green = at(255);
  const g = (hex) => parseInt(hex.slice(3, 5), 16), r = (hex) => parseInt(hex.slice(1, 3), 16);
  assert.ok(g(magenta) < g(neutral), 'magenta : moins de vert');
  assert.ok(r(green) < r(neutral) && g(green) === g(neutral), 'vert : moins de rouge/bleu');
});

test('portage fidèle : kelvinToRgb, tintWhite et le 3CH historique de web/js', (t) => {
  const live = loadWebFunctions({ kelvinToRgb: '40-color.js', tintWhite: '40-color.js', dmxKelvinGM: '60-sacn.js', rgbToHex: '64-qr-utils.js' });
  if (!live) { t.skip('web/js introuvable'); return; }
  for (let K = 1700; K <= 20000; K += 37) assert.deepEqual(kelvinToRgb(K), { ...live.kelvinToRgb(K) }, 'kelvinToRgb ' + K);
  for (let gm = -100; gm <= 100; gm += 7) assert.deepEqual(tintWhite({ r: 200, g: 180, b: 160 }, gm), { ...live.tintWhite({ r: 200, g: 180, b: 160 }, gm) });
  // Standard 8 avec mix = 255 reproduit l'ancien mode 3CH (Dimmer, CCT, Tint) dès que tint = 0 ou ≥ 128,
  // là où les deux échelles de tint coïncident.
  for (const dim of [0, 1, 64, 128, 200, 255]) {
    for (const cct of [0, 21, 54, 128, 200, 255]) {
      for (const tint of [0, 128, 129, 180, 255]) {
        assert.equal(legacyDmxToTint(tint), dmxToTint(tint));
        const legacy = live.dmxKelvinGM(Math.round(1700 + (cct / 255) * 18300), legacyDmxToTint(tint), dim / 255);
        assert.equal(decode('standard8', [dim, 12, 34, 56, cct, tint, 255, 0]).color, legacy, `dim ${dim} cct ${cct} tint ${tint}`);
      }
    }
  }
});

test('Étendu 16 : dimmer 16 bits', () => {
  const c = (hi, lo) => decode('extended16', [hi, lo, 255, 255, 255, 0, 128, 0]).color;
  assert.equal(c(128, 0), '#808080');
  assert.equal(c(127, 255), '#7f7f7f', 'l’octet fin compte');
  assert.equal(c(255, 255), '#ffffff');
  assert.equal(c(0, 0), '#000000');
  const d = new FixtureDecoder('extended16');
  const fx = (hi, lo) => d.decode([hi, lo, 255, 255, 255, 0, 128, 0, 0, 10, 0]).look.effect.intensity;
  assert.equal(fx(255, 255), 100);
  assert.equal(fx(127, 255), 50);
  assert.equal(fx(0, 0), 0, 'le dimmer reste le maître des effets');
});

test('strobe : 0 = arrêt, 1–255 → 0,5–30 Hz linéaire, plafond 30 Hz, flash ≥ 15 ms', () => {
  assert.deepEqual(decodeStrobe(0), { active: false, freq: 0, dur: 0 });
  assert.equal(decodeStrobe(1).freq, 0.5);
  assert.equal(decodeStrobe(128).freq, 15.25);
  assert.equal(decodeStrobe(255).freq, 30);
  for (let v = 1; v <= 255; v++) {
    const s = decodeStrobe(v);
    assert.ok(s.freq <= STROBE_FREQ_MAX && s.freq >= 0.5);
    assert.ok(s.dur >= 15 && s.dur <= 50);
    assert.ok(s.dur + 5 <= 1000 / s.freq, 'la fréquence demandée est respectée par l’écran');
    if (v > 1) assert.ok(s.freq > decodeStrobe(v - 1).freq, 'croissante');
  }
});

test('convention des emplacements : n×10…n×10+9 = élément n ; 1–9 et au-delà = pas de changement', () => {
  assert.equal(slotOf(0, 20), 0);
  for (let v = 1; v <= 9; v++) assert.equal(slotOf(v, 20), null);
  assert.deepEqual([slotOf(10, 20), slotOf(19, 20), slotOf(20, 20), slotOf(209, 20)], [1, 1, 2, 20]);
  assert.deepEqual([slotOf(210, 20), slotOf(255, 20)], [null, null]);
  assert.deepEqual([slotOf(149, EFFECTS.length), slotOf(150, EFFECTS.length)], [14, null]);
  assert.deepEqual([slotOf(250, MEDIA_ITEMS), slotOf(255, MEDIA_ITEMS)], [25, 25]);
  assert.equal(CALL_ITEMS, 20);
});

test('Étendu 16 : effet (0 = aucun, ordre de web/js, pas de changement), vitesse sur la plage de l’effet', (t) => {
  const d = new FixtureDecoder('extended16');
  const f = (sel, speed = 0) => d.decode([255, 255, 0, 0, 0, 0, 128, 0, 0, sel, speed]).look.effect;
  assert.equal(f(0), null);
  assert.equal(f(10).name, 'chaser');
  assert.equal(f(149).name, 'fire');
  assert.equal(f(5).name, 'fire', '1–9 : pas de changement');
  assert.equal(f(200).name, 'fire', 'au-delà du dernier effet : pas de changement');
  assert.equal(f(0), null);
  assert.equal(f(50, 0).speed, 20, 'pulse : 0 = min (20 BPM)');
  assert.equal(f(50, 255).speed, 240, 'pulse : 255 = max (240 BPM)');
  assert.equal(f(50, 51).speed, 64);
  const src = readWebFile('50-effects-remote.js');
  if (!src) { t.skip('web/js introuvable'); return; }
  const block = src.slice(src.indexOf('const EFFECT_CONFIG'), src.indexOf('};', src.indexOf('const EFFECT_CONFIG')));
  const live = [...block.matchAll(/^\s{2}(\w+):\s*\{[^\n]*?min:([\d.]+), max:([\d.]+)/gm)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
  assert.deepEqual(EFFECTS.map((e) => [e.name, e.min, e.max]), live, 'ordre et plages identiques à EFFECT_CONFIG');
});

test('Étendu 16 : média (0 = masqué, 1–25, pas de changement) et lecture', () => {
  const d = new FixtureDecoder('extended16');
  const m = (sel, pb = 0) => d.decode([255, 255, 0, 0, 0, 0, 128, 0, 0, 0, 0, sel, pb]).look.media;
  assert.equal(m(0), null);
  assert.deepEqual(m(10), { index: 1, playback: 'play' });
  assert.deepEqual(m(255), { index: 25, playback: 'play' });
  assert.deepEqual(m(3), { index: 25, playback: 'play' }, '1–9 : pas de changement');
  const pb = (v) => m(30, v).playback;
  assert.deepEqual([pb(0), pb(63), pb(64), pb(127), pb(128), pb(191), pb(192), pb(255)],
    ['play', 'play', 'pause', 'pause', 'loop', 'loop', 'rewind', 'rewind']);
  assert.equal(m(0), null);
});

test('Étendu 16 : Appel / SMS déclenchés sur front uniquement', () => {
  const d = new FixtureDecoder('extended16');
  const frame = (call, sms) => d.decode([255, 255, 0, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0, call, sms]).triggers;
  assert.deepEqual(frame(20, 0), [], '1re trame : armement sans déclenchement');
  assert.deepEqual(frame(20, 0), [], 'valeur stable : rien');
  assert.deepEqual(frame(35, 0), [{ kind: 'call', index: 3 }], 'entrée dans l’emplacement 3');
  assert.deepEqual(frame(39, 0), [], 'même emplacement');
  assert.deepEqual(frame(5, 0), [], '1–9 : pas de changement');
  assert.deepEqual(frame(30, 0), [], 'retour dans le même emplacement : pas de redéclenchement');
  assert.deepEqual(frame(0, 0), [{ kind: 'call', index: 0 }], '0 = raccrocher, une fois');
  assert.deepEqual(frame(0, 0), []);
  assert.deepEqual(frame(230, 0), [], 'au-delà de 209 : pas de changement');
  assert.deepEqual(frame(209, 10), [{ kind: 'call', index: 20 }, { kind: 'sms', index: 1 }]);
  assert.deepEqual(frame(209, 0), [{ kind: 'sms', index: 0 }], '0 = fermer la notification');
  d.reset();
  assert.deepEqual(frame(50, 50), [], 'après reset : réarmement');
});

test('Étendu 16 : écran 0–127 allumé, 128–255 blackout ; canaux manquants = 0', () => {
  const b = (v) => decode('extended16', [255, 255, 0, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0, v]).blackout;
  assert.deepEqual([b(0), b(127), b(128), b(255)], [false, false, true, true]);
  assert.equal(decode('extended16', [255, 255]).color, '#000000');
  assert.equal(decode('simple3', /** @type {any} */ (['x', -1, 300])).color, '#000000');
  assert.throws(() => decode('rgb6', [1]), RangeError);
});
