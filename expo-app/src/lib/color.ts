export interface Rgb { r: number; g: number; b: number }

export interface ColorSpec {
  kelvin: number;
  tint: number;
  dimmer: number;
  wheelHex: string;
  crossfade: number;
}

export function kelvinToRgb(K: number): Rgb {
  const t = K / 100;
  let r: number, g: number, b: number;
  r = t <= 66 ? 255 : Math.min(255, Math.max(0, 329.698727446 * Math.pow(t - 60, -0.1332047592)));
  g = t <= 66
    ? Math.min(255, Math.max(0, 99.4708025861 * Math.log(t) - 161.1195681661))
    : Math.min(255, Math.max(0, 288.1221695283 * Math.pow(t - 60, -0.0755148492)));
  b = t >= 66 ? 255 : t <= 19 ? 0 : Math.min(255, Math.max(0, 138.5177312231 * Math.log(t - 10) - 305.0447927307));
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

export function tintWhite(rgb: Rgb, gm: number): Rgb {
  let { r, g, b } = rgb;
  if (gm > 0) { r *= (1 - gm / 100 * 0.45); b *= (1 - gm / 100 * 0.45); }
  else if (gm < 0) { const t = Math.abs(gm) / 100; g *= (1 - t * 0.65); }
  return { r, g, b };
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

export function computeColor(spec: ColorSpec): string {
  const white = tintWhite(kelvinToRgb(spec.kelvin), spec.tint);
  const col = hexToRgb(spec.wheelHex);
  const mix = spec.crossfade / 100;
  const f = spec.dimmer / 100;
  return rgbToHex(
    (white.r * (1 - mix) + col.r * mix) * f,
    (white.g * (1 - mix) + col.g * mix) * f,
    (white.b * (1 - mix) + col.b * mix) * f,
  );
}

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255);
}

export function polarToHex(px: number, py: number, cx: number, cy: number, radius: number): string {
  const dx = px - cx, dy = py - cy;
  const dist = Math.hypot(dx, dy);
  const sat = Math.min(1, dist / radius);
  const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
  return hsvToHex(hue, sat, 1);
}
