// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ PWA — installation & hors-ligne ══════════════════════════
let _deferredInstall = null;
let _swUpdatePending = false, _swReloaded = false;
// Recharge pour appliquer une nouvelle version, uniquement hors session
function applyPendingUpdate() {
  if (!_swUpdatePending || _swReloaded) return;
  if (mode === 'screen' || mode === 'remote') return;
  _swReloaded = true;
  window.location.reload();
}

// Enregistrement du service worker + rechargement auto sur mise à jour.
// Quand une nouvelle version du SW prend le contrôle (skipWaiting + clients.claim),
// l'évènement `controllerchange` se déclenche : on recharge la page une seule fois
// pour servir le nouvel index.html, sans que l'utilisateur ait à réinstaller la PWA.
if ('serviceWorker' in navigator) {
  // Vrai seulement s'il existait déjà un SW au chargement (donc : mise à jour, pas
  // première installation) → évite un rechargement inutile au tout premier lancement.
  const _hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!_hadController) return;
    // Jamais de rechargement pendant une session (écran de jeu ou télécommande
    // en tournage) : la mise à jour s'applique au prochain retour à l'accueil.
    _swUpdatePending = true;
    applyPendingUpdate();
  });
  window.addEventListener('load', () => {
    updateCrossfadeGradient();
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Vérifie une mise à jour à chaque ouverture et au retour au premier plan.
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}

function _isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Android / Chrome / Edge : prompt natif
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstall = e;
  const btn = document.getElementById('installBtn');
  if (btn && !_isStandalone() && !IN_NATIVE_APP) btn.style.display = 'inline-block';
});

window.addEventListener('appinstalled', () => {
  _deferredInstall = null;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'none';
  const hint = document.getElementById('iosInstallHint');
  if (hint) hint.style.display = 'none';
});

async function installPWA() {
  if (!_deferredInstall) return;
  _deferredInstall.prompt();
  await _deferredInstall.userChoice;
  _deferredInstall = null;
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = 'none';
}

// iOS Safari : pas de prompt natif → on affiche les instructions « Sur l'écran d'accueil »
(function () {
  if (_isStandalone() || IN_NATIVE_APP) return; // déjà installée / dans l'app native
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
  if (isIOS && isSafari) {
    const hint = document.getElementById('iosInstallHint');
    if (hint) hint.style.display = 'block';
  }
})();

