// Colour pipeline of the SetRemote app, ported verbatim so that a screen driven
// by DMX shows exactly what the remote app would show for the same settings.
//
// Sources (app, commit 5e0323d):
//   kelvinToRgb, tintWhite, recomputeColor  → web/js/40-color.js
//   hslToRgb (HUE mode)                       → web/js/40-color.js
//   rgbToHex, hexToRgb                        → web/js/64-qr-utils.js
//   dmxKelvinGM and the 3ch DMX scaling        → web/js/60-sacn.js (screenApplyDmx / applyDmxToOutput)
// The colour wheel is an HSV disc (centre white, edge fully saturated); the
// Expo app uses the same model in expo-app/src/lib/color.ts (hsvToHex).

/** CCT range of the app and of the legacy DMX modes. */
export const KELVIN_MIN = 1700;
export const KELVIN_MAX = 20000;

/**
 * Black-body approximation used by the app (Tanner Helland's fit), K → rounded RGB.
 * @param {number} K kelvin
 * @returns {{r: number, g: number, b: number}}
 */
export function kelvinToRgb(K) {
  const t = K / 100; let r, g, b;
  r = t <= 66 ? 255 : Math.min(255, Math.max(0, 329.698727446 * Math.pow(t - 60, -0.1332047592)));
  g = t <= 66 ? Math.min(255, Math.max(0, 99.4708025861 * Math.log(t) - 161.1195681661)) : Math.min(255, Math.max(0, 288.1221695283 * Math.pow(t - 60, -0.0755148492)));
  b = t >= 66 ? 255 : (t <= 19 ? 0 : Math.min(255, Math.max(0, 138.5177312231 * Math.log(t - 10) - 305.0447927307)));
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

/**
 * Green/magenta tint of the app. gm in −100 (magenta) … +100 (green). Not rounded.
 * @param {{r: number, g: number, b: number}} rgb
 * @param {number} gm
 */
export function tintWhite(rgb, gm) {
  let r = rgb.r, g = rgb.g, b = rgb.b;
  if (gm > 0) { r *= (1 - gm / 100 * 0.45); b *= (1 - gm / 100 * 0.45); }
  else if (gm < 0) { const t = Math.abs(gm) / 100; g *= (1 - t * 0.65); }
  return { r, g, b };
}

/** HSL → rounded RGB, exactly the app's HUE-mode conversion (s, l in %). */
export function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(255 * f(0)), g: Math.round(255 * f(8)), b: Math.round(255 * f(4)) };
}

/**
 * HSV → rounded RGB: the colour-wheel model (s = distance from the white centre).
 * At s = 1 it equals hslToRgb(h, 100, 50), i.e. the app's HUE mode.
 * @param {number} h degrees
 * @param {number} s 0–1
 * @param {number} v 0–1
 */
export function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) };
}

const clamp8 = (v) => Math.min(255, Math.max(0, Math.round(v)));
const hex2 = (v) => (v < 16 ? '0' : '') + v.toString(16);

/** '#rrggbb' from 0–255 components (rounded and clamped; identical to the app for in-range values). */
export function rgbToHex(r, g, b) {
  return '#' + hex2(clamp8(r)) + hex2(clamp8(g)) + hex2(clamp8(b));
}

/** '#rrggbb' → {r, g, b}. */
export function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

/**
 * The app's unified colour model (recomputeColor): white (kelvin + tint)
 * crossfaded with the wheel colour, then multiplied by the dimmer.
 * @param {object} p
 * @param {number} p.kelvin
 * @param {number} p.gm          −100…+100
 * @param {{r: number, g: number, b: number}} [p.wheel]  colour side of the crossfade (default white)
 * @param {number} [p.crossfade] 0 = white, 1 = wheel colour
 * @param {number} p.dimmer      0–1
 * @returns {string} '#rrggbb'
 */
export function mixColor(p) {
  const white = tintWhite(kelvinToRgb(p.kelvin), p.gm);
  const col = p.wheel || { r: 255, g: 255, b: 255 };
  const mix = p.crossfade || 0, f = p.dimmer;
  return rgbToHex(
    (white.r * (1 - mix) + col.r * mix) * f,
    (white.g * (1 - mix) + col.g * mix) * f,
    (white.b * (1 - mix) + col.b * mix) * f,
  );
}

/**
 * DMX CCT: 0–255 over the app's kelvin range (kelvinSlider 1700–20000 in
 * web/index.template.html), same scaling as the legacy 3ch mode.
 */
export function dmxToKelvin(v) {
  return Math.round(KELVIN_MIN + (v / 255) * (KELVIN_MAX - KELVIN_MIN));
}

/**
 * DMX tint → app tint (−100 magenta … +100 green): 0 → −100, 128 → 0 (the only
 * neutral value), 255 → +100.
 */
export function dmxToTint(v) {
  return v >= 128 ? ((v - 128) / 127) * 100 : ((v - 128) / 128) * 100;
}

/**
 * Legacy 3ch/9ch tint scaling (web/js/60-sacn.js): 127 AND 128 are both neutral,
 * 0 → −100, 255 → +100. Identical to dmxToTint for v ≥ 128. Kept for migration notes.
 */
export function legacyDmxToTint(v) {
  return v <= 127 ? ((v / 127) - 1) * 100 : ((v - 128) / 127) * 100;
}
