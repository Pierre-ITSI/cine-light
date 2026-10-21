// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ ÉCRAN : LOOK DE LA CONSOLE (passerelle DMX) ══════════════════════════
// La passerelle (une télécommande en mode passerelle, 86-dmx-gateway.js)
// décode le sACN / Art-Net de la console et envoie à chaque écran patché un
// « dmx:look » (packages/dmx, docs/DMX.md § 3 et § 7) :
//   { seq, live, look: { color, strobe?, effect?, media?, blackout? } }
// Règle unique de priorité :
//   • live: true  → la console a la priorité : les ordres de look de la
//     télécommande (couleur, strobe, effet, noir, affichage et lecture des
//     médias) sont ignorés sur cet écran. Appels, SMS, vibreur, torche et
//     luminosité restent permis.
//   • live: false (envoyé une fois à la perte du signal ou à l'arrêt de la
//     passerelle) → l'écran GARDE ce look ; le prochain ordre de la
//     télécommande s'applique.
//   • Sans aucun dmx:look pendant 3 s (le maintien arrive chaque seconde) :
//     même comportement qu'une perte de signal.
//   • Dès que des looks « live » reviennent, la console reprend la main.
// seq (16 bits) : un look plus ancien que le dernier appliqué est ignoré, sauf
// après 3 s de silence (passerelle redémarrée, compteur reparti de zéro).
const DMX_HOLD_MS = 3000;
// Ordres de la télécommande ignorés tant que la console a la priorité
const DMX_OVERRIDDEN = ['color', 'strobe', 'effect', 'blackout', 'media:show', 'media-stop', 'media-ctrl'];
// applied : ce que la passerelle a déjà appliqué (évite de relancer le strobe,
// l'effet ou la vidéo à chaque look identique — un look arrive jusqu'à 30 fois
// par seconde). Remis à zéro dès que la télécommande reprend la main : le look
// suivant de la console est alors réappliqué entièrement.
const _dmxScr = { live: false, lastSeq: null, lastAt: -Infinity, look: null, applied: {}, wantMedia: null };

function _dmxNow() { return Date.now(); }

// La console a-t-elle la priorité sur cet écran ?
function screenDmxLive() {
  return _dmxScr.live && _dmxNow() - _dmxScr.lastAt < DMX_HOLD_MS;
}

// Garde de dispatchMessage (22-protocol.js) : false = ordre ignoré
function screenDmxAllows(type) {
  if (!DMX_OVERRIDDEN.includes(type)) return true;
  if (screenDmxLive()) return false;
  _dmxScr.applied = {}; // la télécommande reprend la main
  return true;
}

function screenApplyDmxLook(m) {
  const now = _dmxNow();
  const silent = now - _dmxScr.lastAt >= DMX_HOLD_MS;
  if (!silent && !SRDMX.isNewerSeq(m.seq, _dmxScr.lastSeq)) return false; // ancien ou doublon
  const wasLive = screenDmxLive();
  _dmxScr.lastSeq = m.seq;
  _dmxScr.lastAt = now;
  _dmxScr.look = m.look;
  if (m.live && !wasLive) _dmxScr.applied = {}; // la console reprend la main : tout réappliquer
  _dmxScr.live = m.live;
  _dmxApplyLook(m.look);
  return true;
}

function _dmxApplyLook(look) {
  const a = _dmxScr.applied;
  // Noir total (média et effet compris)
  if (a.blackout !== look.blackout) { a.blackout = look.blackout; setBlackout(look.blackout); }
  _dmxApplyMedia(look.media, a);
  // Couleur (dimmer et mélange déjà appliqués par la passerelle). Le strobe
  // flashe screenBaseColor : la couleur de la console, jamais une ancienne.
  screenBaseColor = look.color;
  const sc = document.getElementById('screen-mode');
  if (sc && !screenStrobeTimer) { sc.style.transition = 'background-color .05s'; sc.style.backgroundColor = look.color; }
  // Effet : sa propre palette, intensité = Dimmer de la console (0 = noir)
  const fx = look.effect && look.effect.intensity > 0 ? look.effect : null;
  const fxKey = fx ? fx.name + '/' + fx.speed + '/' + fx.intensity : '';
  if (a.effect !== fxKey) {
    a.effect = fxKey;
    if (fx) receiveEffect({ active: true, name: fx.name, params: { speed: fx.speed, intensity: fx.intensity, chaos: 0, drift: 0 } });
    else if (_screenEffect) stopScreenEffect();
  }
  // Strobe : relancé seulement si sa fréquence ou sa durée change (sinon le
  // cycle redémarrerait à chaque look)
  const st = look.strobe && look.strobe.active ? look.strobe : null;
  const stKey = st ? st.freq + '/' + st.dur : '';
  if (a.strobe !== stKey) {
    a.strobe = stKey;
    if (st) receiveStrobe({ active: true, torch: false, random: false, freq: st.freq, dur: st.dur, freqMin: st.freq, freqMax: st.freq, durMin: st.dur, durMax: st.dur });
    else receiveStrobe({ active: false });
  }
}

// Média n° n = n-ième média du pool de la télécommande (ordre « media:order »).
// Seul un média déjà en cache sur l'écran s'affiche (les images du pool sont
// préchargées ; une vidéo l'est à sa première lecture) : la passerelle ne
// déclenche pas de rediffusion, qui s'afficherait aussi sur les autres écrans.
function _dmxApplyMedia(media, a) {
  const id = media ? (_mediaOrder[media.index - 1] || null) : null;
  _dmxScr.wantMedia = id;
  if (!id || !_mediaCache.has(id)) { // aucun média (ou pas encore en cache) : écran sans média
    a.media = null;
    if (screenMediaVisible()) _dmxHideMedia();
    return;
  }
  const key = id + '/' + media.playback;
  const shown = screenMediaVisible() && _screenActiveId === id;
  if (shown && a.media === key) return;
  if (!shown) screenShowCached(id);
  _dmxPlayback(media.playback);
  a.media = key;
}

// Un média attendu par la console vient d'arriver en cache (préchargement)
function screenDmxOnCached(id) {
  if (!screenDmxLive() || !id || id !== _dmxScr.wantMedia || !_dmxScr.look) return;
  _dmxScr.applied.media = null;
  _dmxApplyMedia(_dmxScr.look.media, _dmxScr.applied);
}

// La vidéo affichée est-elle pilotée par la console ? (fin de lecture : on
// reste sur la dernière image au lieu d'appliquer « 1× puis off »)
function screenDmxOwnsMedia() {
  return screenDmxLive() && !!_dmxScr.wantMedia && _dmxScr.wantMedia === _screenActiveId;
}

function _dmxPlayback(pb) {
  const vid = document.getElementById('screen-media-video');
  const c = _mediaCache.get(_screenActiveId);
  if (!vid || !vid.src || !c || c.kind !== 'vid') return; // image : pas de lecture
  vid.loop = pb === 'loop';
  if (pb === 'play' || pb === 'loop') playScreenVid(vid);
  else {
    vid._wantPlay = false;
    try { vid.pause(); } catch (_) {}
    if (pb === 'rewind') { try { vid.currentTime = 0; } catch (_) {} }
  }
}

// Masque le média sans toucher aux transferts en cours (préchargements)
function _dmxHideMedia() {
  screenNavHide();
  const img = document.getElementById('screen-media-img');
  const vid = document.getElementById('screen-media-video');
  if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
  if (vid) { vid.style.display = 'none'; vid._wantPlay = false; try { vid.pause(); } catch (_) {} }
  _screenActiveId = null;
}

// Retour à l'accueil / changement de télécommande : plus de console
function screenDmxReset() {
  _dmxScr.live = false; _dmxScr.lastSeq = null; _dmxScr.lastAt = -Infinity;
  _dmxScr.look = null; _dmxScr.applied = {}; _dmxScr.wantMedia = null;
}

// « Identifier » (moniteur de la passerelle) : l'écran clignote 3 s, à 2 Hz
// (sous le seuil de 3 Hz des stroboscopes à risque), sans changer son état.
let _identifyTimer = null;
function screenIdentify() {
  const el = document.getElementById('screen-identify');
  if (!el) return;
  el.classList.remove('on');
  void el.offsetWidth; // relance l'animation
  el.classList.add('on');
  clearTimeout(_identifyTimer);
  _identifyTimer = setTimeout(() => el.classList.remove('on'), 3000);
}
