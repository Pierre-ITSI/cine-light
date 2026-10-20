// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ NAVIGATION ══════════════════════════
function startMode(m) {
  document.getElementById('splash').style.display = 'none';
  licStatsPing(m === 'remote' ? 'remote' : 'screen'); // statistiques anonymes, version officielle seulement (14-licence.js)
  if (m === 'remote') {
    mode = 'remote';
    const rm = document.getElementById('remote-mode');
    rm.style.display = 'flex'; // coque : en-tête fixe, contenu défilant, barre d'onglets (04-nav.css)
    initWheel();
    loadColorMemories(); renderColorMemories();
    recomputeColor();
    // Session chiffrée persistée : connexion immédiate, sans code à saisir
    connectRemote(remoteSession());
  } else {
    // Écran : rejoint la dernière session (QR déjà scanné), sinon appairage
    const p = screenStoredSession();
    if (p) screenJoinSession(p);
    else showScreenPairing();
  }
}

// ── Écran : vue « rejoindre la télécommande » (scan du QR ou code) ──
function showScreenPairing() {
  document.getElementById('splash').style.display = 'none';
  document.getElementById('screen-connect').style.display = 'flex';
  startPairScan();
}
function hideScreenPairing() {
  stopPairScan();
  screenStopPairCode();
  document.getElementById('screen-connect').style.display = 'none';
}

// Lien d'appairage à l'ouverture (#p=v1.…) : le secret est lu puis effacé de
// la barre d'adresse. Les anciens liens (#set1234) mènent à l'appairage.
function handleLaunchHash() {
  if (!location.hash) return;
  const p = SRP.parsePairingUrl(location.hash);
  clearLocationHash();
  if (p) screenJoinSession(p);
  else showScreenPairing();
}

// Écran : rejoint (et retient) une session — QR scanné, lien ou code + SAS
function screenJoinSession(p) {
  if (!SRP.isValidPairing(p)) return;
  screenPwOnJoin(p); // clé par écran d'une autre session : effacée (29-revoke.js)
  screenSaveSession(p);
  hideScreenPairing();
  enterScreenSession(p);
}

let _screenAliveTimer = null;
function stopScreenAlive() { if (_screenAliveTimer) { clearInterval(_screenAliveTimer); _screenAliveTimer = null; } }

function enterScreenSession(p) {
  if (mode === 'screen' && _session && _session.channelId === p.channelId && _session.key === p.key && mqttClient) return; // déjà connecté
  document.getElementById('splash').style.display = 'none';
  mode = 'screen'; _session = { channelId: p.channelId, key: p.key };
  screenLoadConfig(_session); // nom et groupes donnés par la télécommande (28-screens.js)
  const el = document.getElementById('screen-mode');
  el.style.display = 'flex';
  el.style.backgroundColor = '#1a1a1a';
  setScreenStatus('Connexion…');
  requestFS();
  acquireWakeLock();
  setupScreenAutohide();
  if (!navigator.vibrate) { const b=document.getElementById('vibrateBtn'); if(b){b.classList.add('unavail');b.textContent='📳 Indispo (iPhone)';b.classList.remove('on');} vibrateEnabled=false; }
  _screenFirstConnect = true;
  // Clé par écran chargée AVANT la connexion (une offre de clé n'est acceptée
  // qu'en son absence, 29-revoke.js)
  const s = _session;
  screenPwLoad().catch(() => {}).then(() => { if (mode === 'screen' && _session === s) connectSession(s, screenOnSessionConnected); });
}
// (Re)connexion de l'écran, aussi après une nouvelle session remise par la télécommande (session:rekey)
let _screenFirstConnect = false;
function screenOnSessionConnected() {
  setScreenStatus(_screenCfg.name ? '✓ ' + _screenCfg.name + ' — liaison chiffrée' : '✓ En écoute — liaison chiffrée');
  // Confirmation visible uniquement à la 1re connexion : les reconnexions
  // automatiques ne doivent rien afficher (l'écran est peut-être dans le champ)
  if (_screenFirstConnect && !screenBlackoutOn) flashScreenNotice('Relié à la télécommande');
  _screenFirstConnect = false;
  sendCaps();
  // Signe de vie : la télécommande signale un écran muet depuis 40 s
  stopScreenAlive();
  _screenAliveTimer = setInterval(() => sendMsg({ type: 'screen:alive' }), SCREEN_ALIVE_MS);
}

// Télécommande : connexion à sa session (au démarrage et après « Nouvelle session »).
// keep : nouvelle session après le retrait d'un écran (29-revoke.js) : registre,
// état de chaque écran, patch DMX et liaison affichée sont gardés tels quels.
function connectRemote(p, o = {}) {
  _session = { channelId: p.channelId, key: p.key };
  if (!o.keep) {
    _linkEverConnected = false;
    setConnStatus('connecting');
    // État « Tous les écrans » = réglages affichés ; noms, groupes et cible de
    // cette session (28-screens.js) ; une cible retenue (groupe, écran) montre
    // son propre état
    _scrAllState = null; scrInitAll();
    scrLoad();
    if (scrTarget().k !== 'all') scrLoadView();
  }
  if (document.getElementById('content-screens').classList.contains('active')) renderPairPanel(); // nouveau QR, nouveau code
  if (!o.keep) {
    gwOnSessionChanged(); // passerelle DMX : patch de cette session
    rkStartListeners();   // anciens topics encore écoutés après un retrait
  }
  connectSession(_session, () => {
    setConnStatus('connected');
    // Demander aux écrans leurs capacités (torche / vibreur / cache). Chaque
    // « caps » déclenche la resynchronisation de CET écran avec SON état
    // (24-resync.js) : plus d'envoi global de la couleur ni des réglages à la
    // (re)connexion, qui écraserait l'état propre de chaque écran ciblé.
    sendMsg({ type: 'hello' });
  });
}

// « Nouvelle session » : nouveau secret, tous les écrans appairés sont révoqués
function confirmNewSession() {
  if (!confirm('Nouvelle session : tous les écrans appairés seront déconnectés et devront scanner le nouveau QR. Continuer ?')) return;
  newRemoteSession();
}
function newRemoteSession() {
  remoteStopAllPairing();
  rkClearAll();       // tous les écrans révoqués : plus rien à remettre sur les anciens topics
  _vidStopJobs(null); // transferts vidéo vers les écrans révoqués
  clearPairedScreens();
  connectRemote(renewRemoteSession());
}

function suspendScreen() {
  exitFS();
  cancelScreenAutohide();
  hideScreenMedia();
  stopScreenEffect();
  screenCallHide();
  screenChatHide();
  screenPhoneHide();
  setBlackout(false);
  screenDmxReset();
  stopScreenAlive();
  // Déconnecter (la session reste mémorisée : « Écran projecteur » la rejoint)
  closeSession();
  // Cacher l'écran et revenir à l'appairage (autre télécommande, nouveau QR)
  const el = document.getElementById('screen-mode');
  if (el) el.style.display = 'none';
  showScreenPairing();
}

// ── Menu de l'écran de jeu ──
function openScreenMenu() {
  const m = document.getElementById('screen-menu');
  if (m) m.style.display = 'flex';
}

// Geste d'ouverture du menu, SANS calque au-dessus de la scène : il est lu sur
// le document, en phase de capture, sans preventDefault ni stopPropagation.
// Chaque toucher atteint donc aussi ce qui est dessous (faux téléphone,
// discussion, appel) : le comédien peut toucher toute la scène.
//  · Écran simple (lumière, couleur, média) : appui long (600 ms) ou double
//    toucher / double-clic dans le quart haut-gauche (45 vw × 45 vh).
//  · Scène du faux téléphone affichée (écran verrouillé, appel, notification,
//    discussion, alerte, extinction) : seul un appui long de 1,5 s tout au
//    bord, dans un carré de 72 px au coin haut-gauche, ouvre le menu.
const SCREEN_MENU_LONG_MS = 600;        // écran simple
const SCREEN_MENU_SCENE_LONG_MS = 1500; // scène du faux téléphone
const SCREEN_MENU_CORNER = 72;          // px : coin réservé pendant une scène
const SCREEN_MENU_DOUBLE_MS = 300;
const SCREEN_MENU_MOVE_TOL = 14;        // px de tolérance avant d'annuler l'appui long
const _SCREEN_SCENE_LAYERS = ['screen-phone', 'screen-chat', 'screen-call', 'screen-palert', 'screen-ppower'];
function screenSceneShown() {
  return _SCREEN_SCENE_LAYERS.some((id) => {
    const el = document.getElementById(id);
    return !!el && getComputedStyle(el).display !== 'none';
  });
}
function _screenMenuZone(x, y, scene) {
  if (scene) return x <= SCREEN_MENU_CORNER && y <= SCREEN_MENU_CORNER;
  return x <= window.innerWidth * 0.45 && y <= window.innerHeight * 0.45;
}
(function setupScreenMenuGesture() {
  let timer = null, pid = null, sx = 0, sy = 0, scene = false, lastTap = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } pid = null; };
  const armed = () => {
    if (mode !== 'screen') return false;
    const sm = document.getElementById('screen-mode'), m = document.getElementById('screen-menu');
    return !!sm && getComputedStyle(sm).display !== 'none' && !(m && m.style.display === 'flex');
  };
  document.addEventListener('pointerdown', (e) => {
    cancel();
    if (!e.isPrimary || !armed()) { lastTap = 0; return; } // second doigt : pas un geste du menu
    scene = screenSceneShown();
    if (!_screenMenuZone(e.clientX, e.clientY, scene)) { lastTap = 0; return; }
    pid = e.pointerId; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { timer = null; pid = null; lastTap = 0; openScreenMenu(); }, scene ? SCREEN_MENU_SCENE_LONG_MS : SCREEN_MENU_LONG_MS);
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    if (Math.abs(e.clientX - sx) > SCREEN_MENU_MOVE_TOL || Math.abs(e.clientY - sy) > SCREEN_MENU_MOVE_TOL) { cancel(); lastTap = 0; }
  }, true);
  document.addEventListener('pointerup', (e) => {
    if (e.pointerId !== pid) return;
    const pending = !!timer; // sinon : l'appui long a déjà ouvert le menu
    cancel();
    if (!pending || scene) return; // pendant une scène : appui long seulement
    const now = Date.now();
    if (now - lastTap < SCREEN_MENU_DOUBLE_MS) { lastTap = 0; openScreenMenu(); }
    else lastTap = now;
  }, true);
  document.addEventListener('pointercancel', (e) => { if (e.pointerId === pid) { cancel(); lastTap = 0; } }, true);
})();
function closeScreenMenu() {
  const m = document.getElementById('screen-menu');
  if (m) m.style.display = 'none';
}
function screenDisconnect() {
  closeScreenMenu();
  closeSession();
  goBackToSplash();
}

function goBackToSplash() {
  exitFS();
  cancelScreenAutohide();
  closeScreenMenu();
  hideScreenMedia();
  stopScreenEffect();
  screenCallHide();
  screenChatHide();
  screenPhoneHide();
  setBlackout(false);
  screenDmxReset();
  // Fermer réellement la session écran : sinon le téléphone continue de
  // recevoir (et de sonner sur un appel simulé) derrière l'écran d'accueil.
  if (mode === 'screen') {
    if (screenStrobeTimer) { clearTimeout(screenStrobeTimer); screenStrobeTimer = null; }
    stopTorchDimLoop(); stopTorchEffectLoop(); releaseTorch();
    stopScreenAlive();
    closeSession();
    mode = null;
  }
  releaseWakeLock();
  nativePost({ type: 'brightness-restore' }); // l'app native rend la luminosité d'origine
  const sm = document.getElementById('screen-mode');
  if (sm) sm.style.display = 'none';
  clearLocationHash();
  hideScreenPairing();
  document.getElementById('splash').style.display = 'flex';
  applyPendingUpdate();
}

// ── Boîte de confirmation de l'app (#app-confirm, même boîte que « Retirer cet écran ? ») ──
let _appConfirmOk = null;
function openAppConfirm(o, onOk) {
  document.getElementById('acTitle').textContent = o.title;
  document.getElementById('acText').textContent = o.text;
  document.getElementById('acCancel').textContent = o.cancel || 'Annuler';
  document.getElementById('acOk').textContent = o.ok;
  _appConfirmOk = onOk;
  document.getElementById('app-confirm').classList.add('open');
}
function appConfirmShown() { const d = document.getElementById('app-confirm'); return !!d && d.classList.contains('open'); }
function closeAppConfirm() {
  _appConfirmOk = null;
  const d = document.getElementById('app-confirm');
  if (d) d.classList.remove('open');
}
function appConfirmOk() {
  const f = _appConfirmOk;
  closeAppConfirm();
  if (f) f();
}
// Échap : ferme la confirmation seule (pas la vue qui est dessous)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && appConfirmShown()) { e.stopImmediatePropagation(); closeAppConfirm(); }
}, true);

// Bouton Accueil (en-tête) et « Retour à l'accueil » (Réglages) : toujours
// confirmés — un doigt qui glisse pendant une prise couperait tous les écrans.
// Pas d'exception « rien en cours » : la boîte reste la même, prévisible.
const _HOME_CONFIRM = {
  title: 'Revenir à l\'accueil ?',
  text: 'Les écrans restent appairés ; ce qui est en cours (stroboscope, média, passerelle DMX, séquence) s\'arrête.',
  ok: 'Revenir à l\'accueil',
};
function askGoBack(then) {
  openAppConfirm(_HOME_CONFIRM, () => { if (then) then(); goBack(); });
}

function goBack() {
  closeAppConfirm();
  closeScreensUi(); // vue « Écrans connectés », choix de la cible (39-screens-ui.js)
  closeOfflineView(); // tourner sans réseau : préparation en cours arrêtée (93-offline.js)
  if (_prep) _prep.running = false;
  rkStopListeners(); // anciens topics : réécoutés au prochain lancement de la télécommande
  seqHalt(); // Séquence : minuteries arrêtées (91-sequence.js)
  stopStrobe();
  stopMediaBroadcast(true, true);
  gwStop(); // passerelle DMX : les écrans gardent leur look et sont rendus à la télécommande
  closeDmxGateway();
  remoteStopAllPairing();
  closeSession();
  stopLinkWatch();
  document.getElementById('remote-mode').style.display = 'none';
  document.getElementById('splash').style.display = 'flex';
  mode = null;
  applyPendingUpdate(); // une mise à jour en attente peut s'appliquer maintenant
}

// ══════════ Onglets de la télécommande (phase 3) ══════════
// Cinq onglets en bas (Lumière, Effets, Média, Scénario, Écrans). Lumière et
// Scénario ont un segmenté interne (Couleur | Flash, Tel | Séquence). Les
// anciens identifiants restent des alias : switchTab('color' | 'flash' |
// 'call' | 'seq' | 'qr') ouvre le bon onglet ET la bonne vue.
const NAV_TABS = ['light', 'effects', 'media', 'scenario', 'screens'];
const _NAV_ALIAS = { color: ['light', 'color'], flash: ['light', 'flash'], call: ['scenario', 'call'], seq: ['scenario', 'seq'], qr: ['screens', null] };
const _NAV_CONTENT = { light: 'content-light', effects: 'content-effects', media: 'content-media', scenario: 'content-scn', screens: 'content-screens' };
const _NAV_SEG = { light: ['color', 'flash'], scenario: ['call', 'seq'] };
const _navSub = { light: 'color', scenario: 'call' }; // dernière vue de chaque onglet à segmenté
const _navScroll = {};                                // position de défilement retenue par onglet / vue
let _navKey = 'light/color'; // vue affichée au démarrage
let _navTab = 'light';
function navScroller() { return document.getElementById('nv-scroll'); }
function navCurrentTab() { return _navTab; }
function navCurrentSub() { return _navSub[_navTab] || null; }
// Fait défiler le contenu pour amener un élément sous l'en-tête collant (off px de marge)
function navScrollTo(el, off) {
  const sc = navScroller();
  if (!sc || !el) return;
  sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - (off == null ? 72 : off);
}
// Barre d'action fixe (phase 4) : celle de Tel ou de Séquence selon la vue du Scénario, aucune ailleurs.
// Plateau : l'en-tête perd ses outils de préparation (bascule Tel | Séquence, pastille couleur) et la
// pastille de liaison rejoint la barre de mode (91-sequence.js, seqPlaceLinkPill).
function navBarUpdate() {
  const nm = document.getElementById('nv-main');
  if (!nm) return;
  const onScn = _navTab === 'scenario', seq = onScn && _navSub.scenario === 'seq';
  nm.dataset.bar = !onScn ? '' : seq ? (typeof _seqView !== 'undefined' && _seqView === 'saved' ? '' : 'seq') : 'tel';
  const plateau = seq && typeof _seqMode !== 'undefined' && _seqMode === 'play' && _seqView !== 'saved';
  document.body.classList.toggle('nv-plateau', plateau);
  if (typeof seqPlaceLinkPill === 'function') seqPlaceLinkPill(plateau);
}
function switchTab(t) {
  let tab = t, sub = null;
  if (_NAV_ALIAS[t]) [tab, sub] = _NAV_ALIAS[t];
  if (!NAV_TABS.includes(tab)) return;
  const segs = _NAV_SEG[tab];
  if (segs) { if (sub) _navSub[tab] = sub; sub = _navSub[tab]; } else sub = null;
  const key = tab + (sub ? '/' + sub : '');
  const sc = navScroller();
  if (sc && _navKey && key !== _navKey) _navScroll[_navKey] = sc.scrollTop;
  document.querySelectorAll('#nv-tabs [role=tab]').forEach((b) => {
    const on = b.id === 'tab-' + tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
  document.getElementById(_NAV_CONTENT[tab]).classList.add('active');
  if (segs) {
    document.getElementById('content-' + sub).classList.add('active');
    for (const k of segs) {
      const b = document.getElementById((tab === 'light' ? 'lightSeg-' : 'scnSeg-') + k);
      if (b) { b.classList.toggle('active', k === sub); b.setAttribute('aria-selected', k === sub ? 'true' : 'false'); }
    }
  }
  _navTab = tab;
  if (key !== _navKey) { _navKey = key; if (sc) sc.scrollTop = _navScroll[key] || 0; }
  navBarUpdate();
  if (sub === 'seq') renderSeq(); // éléments supprimés entre-temps : « élément introuvable »
  if (sub === 'call') renderTelBar();
  if (tab === 'media') renderMediaBarRow(); // barre d'état au-dessus des médias (98-phone-params.js)
  if (tab === 'screens') renderPairPanel();
  else remoteStopPairCode(true); // le code ne reste actif que sur l'onglet d'appairage
}
