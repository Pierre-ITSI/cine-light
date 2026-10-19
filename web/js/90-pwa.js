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

// Installer l'application (maquettes 35) : bouton toujours visible dans un
// navigateur. Chrome / Edge / Samsung Internet → fenêtre native du navigateur ;
// ailleurs → feuille du bas avec la marche à suivre du navigateur détecté.
const _PWA_TXT = {
  title: 'Installer SetRemote',
  sub: 'Gratuit, sans passer par un store.',
  why: ['Plein écran', 'Fonctionne hors ligne', 'Icône sur l\'accueil'],
  ok: 'J\'ai compris',
  share: 'Partager',
  browsers: {
    'ios-safari': { label: 'iPhone · Safari', steps: [
      'Touchez {share} <b>Partager</b> en bas de l\'écran',
      'Faites défiler et choisissez <b>« Sur l\'écran d\'accueil »</b> {add}',
      'Touchez <b>Ajouter</b>, puis ouvrez SetRemote depuis son icône'] },
    'ios-other': { label: 'iPhone · Chrome ou Firefox', steps: [
      'Touchez {share} <b>Partager</b> dans la barre d\'adresse',
      'Choisissez <b>« Sur l\'écran d\'accueil »</b>',
      'Touchez <b>Ajouter</b>'],
      warn: 'Nécessite iOS 16.4 ou plus récent. Sinon, ouvrez cette page dans Safari.' },
    'android-firefox': { label: 'Android · Firefox', steps: [
      'Touchez le menu {menu} en haut à droite',
      'Choisissez <b>« Installer »</b> ou <b>« Ajouter à l\'écran d\'accueil »</b>',
      'Confirmez, puis ouvrez SetRemote depuis son icône'] },
    'mac-safari': { label: 'Mac · Safari', steps: [
      'Menu <b>Fichier</b> dans la barre du haut',
      'Choisissez <b>« Ajouter au Dock »</b>',
      'Touchez <b>Ajouter</b>'],
      warn: 'Nécessite macOS Sonoma ou plus récent.' },
    'desktop-firefox': { label: 'Ordinateur · Firefox', steps: [],
      warn: 'Firefox sur ordinateur ne sait pas installer d\'application web. Ouvrez <b>SetRemote</b> dans <b>Chrome</b> ou <b>Edge</b> : le bouton installera l\'app en un clic.' },
    other: { label: 'Votre navigateur', steps: [
      'Ouvrez le menu du navigateur {menu}',
      'Choisissez <b>« Installer l\'application »</b> ou <b>« Ajouter à l\'écran d\'accueil »</b>',
      'Confirmez, puis ouvrez SetRemote depuis son icône'] },
  },
};
const _PWA_ICONS = {
  share: '<span class="pwa-ico" aria-label="' + _PWA_TXT.share + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6fb4ff" stroke-width="2" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v9h14v-9"/></svg></span>',
  add: '<span class="pwa-ico" aria-hidden="true">⊞</span>',
  menu: '<span class="pwa-ico" aria-hidden="true">⋮</span>',
};

function pwaBrowser(ua, touch) {
  ua = ua == null ? navigator.userAgent : ua;
  touch = touch == null ? navigator.maxTouchPoints || 0 : touch;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/.test(ua)) return /Firefox\//.test(ua) ? 'android-firefox' : 'other';
  if (/Firefox\//.test(ua)) return 'desktop-firefox';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'mac-safari';
  return 'other';
}

function pwaSheetContent() {
  const b = _PWA_TXT.browsers[pwaBrowser()];
  const fill = (s) => s.replace(/\{(share|add|menu)\}/g, (_, k) => _PWA_ICONS[k]);
  return {
    title: _PWA_TXT.title,
    html: '<p class="pwa-sub">' + _PWA_TXT.sub + '</p>'
      + '<div class="pwa-why">' + _PWA_TXT.why.map((w) => '<span>' + w + '</span>').join('') + '</div>'
      + '<div class="sr-sublabel">' + b.label + '</div>'
      + (b.steps.length ? '<ol class="pwa-steps">' + b.steps.map((s, i) => '<li><span class="pwa-n">' + (i + 1) + '</span><span>' + fill(s) + '</span></li>').join('') + '</ol>' : '')
      + (b.warn ? '<div class="pwa-warn">' + b.warn + '</div>' : '')
      + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">' + _PWA_TXT.ok + '</button></div>',
  };
}

function _pwaButton(show) {
  const btn = document.getElementById('installBtn');
  if (btn) btn.style.display = show ? 'inline-block' : 'none';
}
if (!_isStandalone() && !IN_NATIVE_APP) _pwaButton(true);

// Android / Chrome / Edge : prompt natif
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstall = e;
});

window.addEventListener('appinstalled', () => {
  _deferredInstall = null;
  _pwaButton(false);
  if (_sheet && _sheet.kind === 'install') closeSheet();
});

async function installPWA() {
  if (_deferredInstall) {
    const e = _deferredInstall;
    _deferredInstall = null;
    e.prompt();
    try { if ((await e.userChoice).outcome === 'accepted') _pwaButton(false); } catch (_) {}
    return;
  }
  _sheet = { kind: 'install' };
  renderSheet();
}
