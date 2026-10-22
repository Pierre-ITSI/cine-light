// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ FULLSCREEN ══════════════════════════
function requestFS() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (req) req.call(el).catch(() => {});
  screenUnlockSound();
}
// Geste sur l'écran de jeu : déverrouille l'audio (sonneries, vidéos) et rend le son
// à la vidéo affichée et censée jouer (autoplay bloqué ou repli muet) — jamais à une vidéo masquée ou en pause.
function screenUnlockSound() {
  _ac();
  const vid = document.getElementById('screen-media-video');
  if (vid && vid.style.display === 'block' && vid._wantPlay) {
    if (vid._autoMuted) { vid.muted = false; vid._autoMuted = false; }
    if (vid.paused) vid.play().catch(() => {});
  }
  const nv = screenMediaVideoEl(); // Glisser / Défiler : la vidéo qui joue
  if (nv && nv !== vid && nv._wantPlay && nv._autoMuted) { nv.muted = false; nv._autoMuted = false; if (nv.paused) nv.play().catch(() => {}); }
}
// Le navigateur n'accorde le son qu'au premier toucher : chaque toucher de l'écran de jeu le récupère
for (const t of ['pointerup', 'touchend', 'keydown']) {
  document.addEventListener(t, () => { if (mode === 'screen') screenUnlockSound(); }, { capture: true, passive: true });
}
// Quitter le plein écran si on quitte le mode écran
function exitFS() {
  const ex = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (ex && document.fullscreenElement) ex.call(document).catch(() => {});
}

// Ouverture par un lien d'appairage (#p=v1.…) ou un ancien lien (#set1234)
handleLaunchHash();

