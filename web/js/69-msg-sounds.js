// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ SONS DE MESSAGE SYNTHÉTISÉS (écran de jeu) ══════════════════════════
// Trois sons intégrés réservés aux types MESSAGE (SMS, notification, discussion ;
// jamais à la sonnerie d'un appel) : « Métallophone Do » (C7), « Métallophone Sol »
// (G7) et « Envoi » (glissé de sinus). Aucun fichier son n'est livré : chaque son
// est calculé à la lecture dans un AudioBuffer (ctx.createBuffer, ctx.sampleRate),
// puis gardé par fréquence d'échantillonnage. Algorithmes VALIDÉS par le
// propriétaire (scripts de synthèse d'origine) : ne pas les « améliorer » ;
// les générateurs aléatoires gardent leurs graines (11 et 5) → rendu déterministe.
// Crête normalisée à 0,89 comme les WAV de référence, puis volume du type.
const MSG_SOUND_PEAK = 0.89;

// Générateur pseudo-aléatoire congruentiel (graine fixe), valeurs dans [-1 ; 1[
function _msSoundRng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1; }

// Métallophone : 4 partiels de corps (résonance longue) + 4 partiels de frappe
// (très brefs) + claquement de bruit filtré dans les 12 premières ms.
function _msSoundMetal(SR, f, dur = 2.1, k = 0.72) {
  const n = Math.floor(SR * dur), s = new Float32Array(n);
  const body = [[1, 1, 1.25 * k], [1.0025, 0.5, 1.1 * k], [2.756, 0.28, 0.45 * k], [5.404, 0.1, 0.18 * k]];
  const strike = [[8.933, 0.30, 0.020], [13.34, 0.22, 0.012], [17.65, 0.16, 0.008], [23.1, 0.10, 0.005]];
  const rnd = _msSoundRng(11); let hp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, att = Math.min(1, t / 0.0015);
    let v = 0;
    for (const [r, a, tau] of body) v += a * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * r * t);
    for (const [r, a, tau] of strike) { const fr = f * r; if (fr < SR / 2.2) v += a * Math.exp(-t / tau) * Math.sin(2 * Math.PI * fr * t); }
    const x = rnd(); hp = 0.85 * (hp + x - prev); prev = x;
    if (t < 0.012) v += hp * 0.55 * Math.exp(-t / 0.003);
    s[i] = v * att;
  }
  for (let i = n - Math.floor(SR * 0.15); i < n; i++) s[i] *= (n - i) / (SR * 0.15); // fondu de fin (0,15 s)
  return s;
}

// Envoi : sinus qui suit des points de contrôle (temps s, amplitude, fréquence Hz),
// glissé vers l'aigu, avec une pointe de 3e harmonique au sommet seulement.
const _MS_SENT_P = [[0, 0, 340], [0.05, 0.004, 340], [0.10, 0.05, 350], [0.15, 0.27, 354], [0.19, 0.62, 358], [0.21, 0.86, 374], [0.235, 1, 416], [0.255, 0.91, 432], [0.275, 0.56, 456], [0.29, 0.40, 459], [0.31, 0.32, 456], [0.33, 0.17, 456], [0.36, 0.04, 455], [0.40, 0.004, 454], [0.44, 0, 452]];
function _msSentAt(t, k) {
  const P = _MS_SENT_P;
  for (let i = 1; i < P.length; i++) {
    if (t <= P[i][0]) {
      const [t0, ...a] = P[i - 1], [t1, ...c] = P[i];
      const u = (t - t0) / (t1 - t0), s = u * u * (3 - 2 * u); // lissage (smoothstep)
      return a[k] + (c[k] - a[k]) * s;
    }
  }
  return P[P.length - 1][k + 1];
}
function _msSoundSent(SR) {
  const n = Math.floor(SR * 0.46), s = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, a = _msSentAt(t, 0), f = _msSentAt(t, 1);
    ph += 2 * Math.PI * f / SR;
    s[i] = a * (Math.sin(ph) + 0.16 * a * a * Math.sin(3 * ph));
  }
  return s;
}

// id → générateur (Do = 2093,0 Hz ; Sol = 3135,96 Hz)
const _MS_SOUND_GEN = {
  'metal-do': (SR) => _msSoundMetal(SR, 2093.0),
  'metal-sol': (SR) => _msSoundMetal(SR, 3135.96),
  'sent': (SR) => _msSoundSent(SR),
};
const _msSoundCache = new Map(); // « id@fréquence » → AudioBuffer
function msgSoundIsSynth(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(_MS_SOUND_GEN, id); }
// Échantillons normalisés (crête 0,89), sans volume
function msgSoundSamples(id, sampleRate) {
  const s = _MS_SOUND_GEN[id](sampleRate);
  let peak = 0; for (const x of s) peak = Math.max(peak, Math.abs(x));
  const g = peak > 0 ? MSG_SOUND_PEAK / peak : 1;
  for (let i = 0; i < s.length; i++) s[i] *= g;
  return s;
}
// AudioBuffer du son pour ce contexte, calculé une fois par fréquence d'échantillonnage
function msgSoundBuffer(ctx, id) {
  if (!msgSoundIsSynth(id)) return null;
  const key = id + '@' + ctx.sampleRate;
  let buf = _msSoundCache.get(key);
  if (!buf) {
    const s = msgSoundSamples(id, ctx.sampleRate);
    buf = ctx.createBuffer(1, s.length, ctx.sampleRate);
    buf.getChannelData(0).set(s);
    _msSoundCache.set(key, buf);
  }
  return buf;
}
// Joue le son une fois au volume du type (0..1) ; false si WebAudio est indisponible
function playMsgSound(id, vol) {
  const ctx = _ac();
  if (!ctx || !msgSoundIsSynth(id)) return false;
  try {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = msgSoundBuffer(ctx, id);
    g.gain.value = typeof vol === 'number' && Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 1;
    src.connect(g); g.connect(ctx.destination);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (_) {} };
    src.start();
    return true;
  } catch (_) { return false; }
}
