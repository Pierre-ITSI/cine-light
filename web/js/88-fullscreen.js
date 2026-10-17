// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ FULLSCREEN ══════════════════════════
function requestFS() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (req) req.call(el).catch(() => {});
  _ac(); // déverrouille l'audio (sonneries du simulateur d'appel) au premier geste
  // Geste utilisateur : ne débloque QUE la vidéo affichée et censée jouer
  // (autoplay bloqué ou repli muet) — jamais une vidéo masquée ou en pause.
  const vid = document.getElementById('screen-media-video');
  if (vid && vid.style.display === 'block' && vid._wantPlay) {
    if (vid._autoMuted) { vid.muted = false; vid._autoMuted = false; }
    if (vid.paused) vid.play().catch(() => {});
  }
}
// Quitter le plein écran si on quitte le mode écran
function exitFS() {
  const ex = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (ex && document.fullscreenElement) ex.call(document).catch(() => {});
}

// Ouverture par un lien d'appairage (#p=v1.…) ou un ancien lien (#set1234)
handleLaunchHash();

