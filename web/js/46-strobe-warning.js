// ══════════════════════════ AVERTISSEMENT STROBOSCOPE (maquette 11) ══════════════════════════
// Avertissement photosensibilité affiché AVANT d'activer, depuis la
// télécommande, le stroboscope ou un effet à flashs rapides : « Annuler »
// n'envoie rien, « Activer » lance l'action demandée. Points d'entrée :
// interrupteur Stroboscope (45-strobe.js), cartes d'effets (50-effects-remote.js),
// mémoires de couleur avec strobe et mémoires d'effets (62-memories.js),
// effets de la torche (66-torch-flash.js).
//
// Effets concernés : ceux dont le rendu (55-effects-engine.js) enchaîne, dès
// leurs réglages par défaut, des flashs d'ensemble à plus de 3 par seconde
// (seuil « trois flashs » des WCAG 2.3.1 et de la recommandation UIT-R BT.1702) :
//   police     moitiés d'écran alternant rouge saturé / bleu, 2 × vitesse
//              changements par seconde (6/s par défaut, jusqu'à 16/s)
//   lightning  « Éclair » : pendant chaque coup, scintillement ≈ 10 Hz
//              (sin 60 t) et tirage à chaque image, blanc sur quasi-noir
//   paparazzi  rafales de 1 à 10 flashs blancs de 30 à 80 ms espacés de
//              90 à 220 ms (≈ 5 à 8 flashs/s dans la rafale)
//   weld       « Soudure » : arc allumé ou éteint au hasard à chaque image
//              pendant 0,3 à 1,5 s (jusqu'à la moitié de la cadence d'image)
//   neon       « Néon HS » : bégaiement ≈ 9 Hz (sin 55 t), extinctions brusques
// Non concernés : variations lentes ou fondues (Bougie, Feu, Aurora,
// Caustiques, Phares), motifs locaux sans flash d'ensemble (Chaser, Noise),
// TV (palette et lissage choisis par l'opérateur ; par défaut deux teintes de
// luminance voisine, fondues), Pulse BPM (sinusoïde, 1 Hz par défaut ; plus de
// 3 cycles/s seulement au-delà de 180 BPM : limite connue, non bloquante).
// Torche LED de l'écran de jeu (onglet Flash) : « Clignotement rapide »
// (80/80 ms ≈ 6 flashs/s) et « Police » (rafales à 10 Hz) ; SOS, lent et
// battement restent à 3 flashs/s au plus.
//
// Passerelle DMX : JAMAIS d'avertissement. La console pilote les écrans par
// dmx:look sans passer par ces fonctions ; le pupitreur en est responsable
// (docs/DMX.md § 3).
//
// « Ne plus demander pour ce projet » : les projets n'existent pas encore. Le
// choix vaut pour la SESSION APPAIRÉE de la télécommande (son channelId) :
// « Nouvelle session » ou « Oublier tous les écrans appairés » le remet à
// zéro ; il deviendra un réglage du projet. Réglages › « Avertissement
// stroboscope » le montre et le réactive. Coché puis « Annuler » : sans effet.
const FLASH_RISK = Object.freeze({
  effect: Object.freeze(['police', 'lightning', 'paparazzi', 'weld', 'neon']),
  torch: Object.freeze(['blink-fast', 'police']),
});
const FLASH_WARN_KEY = 'setremote-strobe-warning-v1'; // { skip: channelId de la session }
let _flashWarn = null; // { ok, cancel } tant que la boîte est affichée

function _flashWarnSessionId() { return mode === 'remote' && _session ? _session.channelId : null; }
// « Ne plus demander » coché pour la session appairée en cours ?
function flashWarningSkipped() {
  const id = _flashWarnSessionId();
  if (!id) return false;
  try { const o = JSON.parse(_lsGet(FLASH_WARN_KEY)); return !!o && o.skip === id; } catch (_) { return false; }
}
function setFlashWarningSkipped(on) {
  const id = _flashWarnSessionId();
  _lsSet(FLASH_WARN_KEY, on && id ? JSON.stringify({ skip: id }) : null);
}
// L'action doit-elle passer par l'avertissement ?
//   'strobe' · 'effect', nom (EFFECT_CONFIG) · 'torch', effet de torche
function needsFlashWarning(kind, name) {
  if (kind !== 'strobe' && !(FLASH_RISK[kind] || []).includes(name)) return false;
  return !flashWarningSkipped();
}
function openFlashWarning(onOk, onCancel) {
  _flashWarn = { ok: onOk, cancel: onCancel || null };
  document.getElementById('swSkip').checked = false;
  document.getElementById('strobe-warn').style.display = 'block';
}
function flashWarningAnswer(ok) {
  const w = _flashWarn;
  _flashWarn = null;
  const skip = document.getElementById('swSkip').checked;
  document.getElementById('strobe-warn').style.display = 'none';
  if (!w) return;
  if (!ok) { if (w.cancel) w.cancel(); return; }
  if (skip) setFlashWarningSkipped(true);
  w.ok();
}
