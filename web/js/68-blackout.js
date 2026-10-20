// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ BLACKOUT (Off écran) ══════════════════════════
let remoteBlackout = false, screenBlackoutOn = false;
// La télécommande n'impose son état OFF/ON lors d'une resynchronisation que si
// l'utilisateur l'a choisi dans cette session : une télécommande rechargée ne
// doit jamais rallumer un écran éteint en pleine prise. Tant qu'il n'y a pas
// touché, elle reprend l'état annoncé par l'écran (caps.blackout). Par écran :
// remoteBlackout / _blackoutTouched sont ceux de la cible (scrAdoptBlackout,
// 28-screens.js).
let _blackoutTouched = false;

function renderRemoteBlackout() {
  // Segmenté « Allumé | Noir » de l'en-tête (un seul segment coché à la fois)
  const on = document.getElementById('blackoutOn'), off = document.getElementById('blackoutOff');
  if (on) { on.classList.toggle('on', !remoteBlackout); on.setAttribute('aria-checked', remoteBlackout ? 'false' : 'true'); }
  if (off) { off.classList.toggle('on', remoteBlackout); off.setAttribute('aria-checked', remoteBlackout ? 'true' : 'false'); }
  updateStatusRings();
}
// Un segment impose l'état voulu (un second toucher sur le segment déjà actif ne fait rien)
function setRemoteBlackout(on) {
  if (!!on !== remoteBlackout) toggleBlackout();
}

// — Télécommande : envoie l'ordre à l'écran —
function toggleBlackout() {
  remoteBlackout = !remoteBlackout;
  _blackoutTouched = true;
  renderRemoteBlackout();
  sendMsg({ type: 'blackout', on: remoteBlackout });
}

// — Écran : applique le noir total —
// Gradation de l'écran de jeu pilotée à distance : un voile noir dont l'opacité
// vaut 1 − luminosité. value ∈ [0..1] (1 = pleine luminosité, voile invisible).
// Sur navigateur, on ne peut pas régler la luminosité matérielle : ce voile
// simule la baisse d'intensité, et fonctionne sur tout écran PWA.
function setScreenDim(value) {
  const v = Math.min(1, Math.max(0, Number(value)));
  const ov = document.getElementById('screen-dim');
  if (!ov) return;
  // Dans l'app native : vraie luminosité matérielle (rétroéclairage) au lieu
  // du voile noir, qui ne fait que simuler la baisse d'intensité.
  if (IN_NATIVE_APP && !Number.isNaN(v)) {
    ov.style.display = 'none'; ov.style.opacity = '0';
    nativePost({ type: 'brightness', value: v });
    return;
  }
  if (Number.isNaN(v) || v >= 1) { ov.style.display = 'none'; ov.style.opacity = '0'; return; }
  ov.style.display = 'block';
  ov.style.opacity = String(1 - v);
}

function setBlackout(on) {
  screenBlackoutOn = !!on;
  const ov = document.getElementById('screen-blackout');
  if (ov) ov.style.display = screenBlackoutOn ? 'block' : 'none';
  const btn = document.getElementById('screenBlackoutBtn');
  if (btn) { btn.classList.toggle('on', screenBlackoutOn); btn.textContent = screenBlackoutOn ? '◻ On' : '⚫ Off'; }
}

// — Écran : bouton local de la barre —
function toggleScreenBlackout() { setBlackout(!screenBlackoutOn); pokeScreenControls(); }

// — Auto-masquage des contrôles écran (barre + statut) après 5 s d'inactivité —
let _uiHideTimer = null, _autohideBound = false;
function pokeScreenControls() {
  const bar = document.getElementById('screen-bar');
  const st  = document.getElementById('screen-status');
  const sm  = document.getElementById('screen-mode');
  if (bar) bar.classList.remove('ui-hidden');
  if (st)  st.classList.remove('ui-hidden');
  if (sm)  sm.classList.remove('cursor-hidden');
  if (_uiHideTimer) clearTimeout(_uiHideTimer);
  _uiHideTimer = setTimeout(() => {
    if (bar) bar.classList.add('ui-hidden');
    if (st)  st.classList.add('ui-hidden');
    if (sm)  sm.classList.add('cursor-hidden');
  }, 5000);
}
function setupScreenAutohide() {
  if (!_autohideBound) {
    const el = document.getElementById('screen-mode');
    if (el) {
      ['mousemove', 'touchstart', 'click'].forEach(ev =>
        el.addEventListener(ev, pokeScreenControls, { passive: true }));
      el.addEventListener('click', onScreenAdvanceClick, { passive: true });
    }
    _autohideBound = true;
  }
  pokeScreenControls();
}

// Un média est-il affiché sur l'écran de jeu ?
function screenMediaVisible() {
  const img = document.getElementById('screen-media-img');
  const vid = document.getElementById('screen-media-video');
  return (img && img.style.display === 'block') || (vid && vid.style.display === 'block');
}
// Tap sur l'écran : si la télécommande a activé l'option, demande le média suivant.
// On ignore les clics sur la barre de contrôle (boutons), seul le plein écran avance.
function onScreenAdvanceClick(e) {
  if (mode !== 'screen' || !_screenAutoAdvance || !screenMediaVisible()) return;
  if (e && e.target && e.target.closest && e.target.closest('#screen-bar')) return;
  // Avance locale instantanée : si l'ordre du pool est connu et que le média
  // suivant est déjà en cache, on l'affiche sans aller-retour réseau.
  if (_mediaOrder.length && _screenActiveId) {
    const cur = _mediaOrder.indexOf(_screenActiveId);
    if (cur >= 0) {
      const nextId = _mediaOrder[(cur + 1) % _mediaOrder.length];
      if (_mediaCache.has(nextId)) {
        screenShowCached(nextId);
        sendMsg({ type: 'media:advanced', id: nextId }); // informe la télécommande
        return;
      }
    }
  }
  sendMsg({ type: 'media:advance', dir: 1 }); // repli : la télécommande gère
}
function cancelScreenAutohide() {
  if (_uiHideTimer) { clearTimeout(_uiHideTimer); _uiHideTimer = null; }
  const bar = document.getElementById('screen-bar');
  const st  = document.getElementById('screen-status');
  const sm  = document.getElementById('screen-mode');
  if (bar) bar.classList.remove('ui-hidden');
  if (st)  st.classList.remove('ui-hidden');
  if (sm)  sm.classList.remove('cursor-hidden');
}

