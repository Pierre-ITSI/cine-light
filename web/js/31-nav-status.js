// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ COQUE DE LA TÉLÉCOMMANDE : « EN COURS », BADGES, CLAVIER ══════════════════════════
// Phase 3 de la refonte. L'en-tête fixe porte, sous l'aperçu, une barre
// « en cours » avec UN seul « Tout arrêter » (stroboscope, effet, média,
// torche) ; la barre d'onglets du bas porte des pastilles :
//   · point sur Lumière  : stroboscope ou torche en marche
//   · point sur Effets   : effet en cours
//   · point sur Média    : média diffusé
//   · Écrans             : nombre d'écrans hors ligne (pastille jaune) et
//                          point orange quand un appairage attend sa
//                          vérification (rien pour un écran qui vient de se
//                          connecter).
// « Tout arrêter » ne fait QUE couper : il n'active rien, donc ne contourne
// jamais l'avertissement stroboscope (46-strobe-warning.js), qui garde la main
// sur toute (ré)activation.
const _NV_TXT = {
  strobe: 'Stroboscope actif',
  effect: (name) => 'Effet ' + name + ' en cours',
  media: 'Média en cours',
  torch: 'Torche allumée',
  more: (n) => ' · +' + n,
  screensLabel: 'Écrans',
  offline: (n) => ', ' + n + ' hors ligne',
  verify: ', vérification en attente',
};

// Ce qui tourne : [{ k, txt }] dans l'ordre d'importance
function navRunning() {
  const r = [];
  if (typeof strobeActive !== 'undefined' && strobeActive) {
    const hz = String(Math.round(strobeFreq * 10) / 10).replace('.', ',');
    r.push({ k: 'strobe', tab: 'light', txt: _NV_TXT.strobe + (strobeMode === 'random' ? '' : ' · ' + hz + ' Hz') });
  }
  if (typeof activeScreenEffect !== 'undefined' && activeScreenEffect) {
    const c = typeof EFFECT_CONFIG !== 'undefined' ? EFFECT_CONFIG[activeScreenEffect] : null;
    r.push({ k: 'effect', tab: 'effects', txt: _NV_TXT.effect(c ? c.name : activeScreenEffect) });
  }
  if (typeof _activeMediaId !== 'undefined' && _activeMediaId) r.push({ k: 'media', tab: 'media', txt: _NV_TXT.media });
  if (typeof remoteTorchOn !== 'undefined' && (remoteTorchOn || activeEffect)) r.push({ k: 'torch', tab: 'light', txt: _NV_TXT.torch });
  return r;
}

function renderNavStatus() {
  const strip = document.getElementById('nvStrip');
  if (!strip) return;
  const run = navRunning();
  strip.style.display = run.length ? 'flex' : 'none';
  strip.classList.toggle('on', run.length > 0);
  const txt = document.getElementById('nvStripTxt');
  if (txt) txt.textContent = run.length ? run[0].txt + (run.length > 1 ? _NV_TXT.more(run.length - 1) : '') : '';
  for (const t of ['light', 'effects', 'media']) {
    const b = document.getElementById('tab-' + t);
    if (b) b.classList.toggle('run', run.some((x) => x.tab === t));
  }
}

// Nombre d'écrans hors ligne (liaison établie) : la pastille jaune de l'onglet Écrans
function navOfflineCount() {
  if (typeof _pairedScreens === 'undefined' || !remoteLinkUp()) return 0;
  return _offlineScreens(Date.now()).length;
}
function renderNavBadges() {
  const tab = document.getElementById('tab-screens');
  if (!tab) return;
  const n = navOfflineCount(), pend = typeof pairVerifyPending === 'function' && pairVerifyPending();
  const b = document.getElementById('screensBadge');
  if (b) { b.textContent = String(n); b.style.display = n ? '' : 'none'; }
  tab.classList.toggle('pend', pend);
  tab.setAttribute('aria-label', _NV_TXT.screensLabel + (n ? _NV_TXT.offline(n) : '') + (pend ? _NV_TXT.verify : ''));
}

// « Tout arrêter » : coupe strobe, effet, média et torche — jamais une activation
function stopEverything() {
  if (strobeActive) stopStrobe();
  if (activeScreenEffect) stopAllEffects();
  if (_activeMediaId) stopMediaBroadcast();
  if (remoteTorchOn) onRemoteTorchToggle(); // éteint aussi le motif de torche en cours
  else if (activeEffect) sendTorchEffect('stop');
  renderNavStatus();
}

// Clavier (Android surtout) : un champ de texte actif masque la barre d'onglets,
// qui ne remonte pas au-dessus du clavier ni ne vole de hauteur à la saisie.
const _NV_TEXT_FIELD = 'input[type=text],input[type=search],input[type=number],input[type=tel],input[type=email],input[type=url],input[type=password],input:not([type]),textarea';
function navKeyboardSync() {
  const a = document.activeElement;
  document.body.classList.toggle('nv-kb', !!(a && a.matches && a.matches(_NV_TEXT_FIELD) && a.closest('#remote-mode')));
}
document.addEventListener('focusin', navKeyboardSync);
document.addEventListener('focusout', () => setTimeout(navKeyboardSync, 0));
