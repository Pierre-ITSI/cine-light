// ══════════════════════════ NAVIGATION ══════════════════════════
function startMode(m) {
  document.getElementById('splash').style.display = 'none';
  if (m === 'remote') {
    mode = 'remote';
    const rm = document.getElementById('remote-mode');
    rm.style.display = 'block';
    // Recalcule la mini-carte sticky maintenant que la télécommande est visible
    requestAnimationFrame(() => rm.dispatchEvent(new Event('scroll')));
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
  if (document.getElementById('content-qr').classList.contains('active')) renderPairPanel(); // nouveau QR, nouveau code
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

// ── Menu de l'écran de jeu (double-clic OU appui long, coin haut-gauche) ──
function openScreenMenu() {
  const m = document.getElementById('screen-menu');
  if (m) m.style.display = 'flex';
}

// Appui long (~600 ms) sur le hotspot : fiable sur mobile, où le double-clic
// est souvent intercepté/ignoré par le navigateur. On gère aussi un double-tap
// manuel (deux contacts rapprochés) en secours.
(function setupScreenMenuHotspot() {
  const hot = document.getElementById('screen-menu-hotspot');
  if (!hot) return;
  let pressTimer = null;
  let startX = 0, startY = 0;
  let lastTap = 0;
  const LONG_MS = 600;
  const MOVE_TOL = 14; // px de tolérance avant d'annuler l'appui long

  const cancel = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  };

  hot.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    cancel();
    pressTimer = setTimeout(() => { pressTimer = null; openScreenMenu(); }, LONG_MS);
  }, { passive: true });

  hot.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (Math.abs(t.clientX - startX) > MOVE_TOL || Math.abs(t.clientY - startY) > MOVE_TOL) cancel();
  }, { passive: true });

  hot.addEventListener('touchend', (e) => {
    e.stopPropagation();
    const wasLong = pressTimer === null; // le timer a déjà déclenché le menu
    cancel();
    if (wasLong) return;
    // Double-tap manuel en secours (deux contacts à moins de 300 ms).
    const now = Date.now();
    if (now - lastTap < 300) { lastTap = 0; openScreenMenu(); }
    else lastTap = now;
  });

  hot.addEventListener('touchcancel', cancel, { passive: true });
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

function goBack() {
  closeScreensUi(); // vue « Écrans connectés », choix de la cible (39-screens-ui.js)
  closeOfflineView(); // tourner sans réseau : préparation en cours arrêtée (93-offline.js)
  if (_prep) _prep.running = false;
  rkStopListeners(); // anciens topics : réécoutés au prochain lancement de la télécommande
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

function switchTab(t) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
  document.getElementById('content-' + t).classList.add('active');
  if (t === 'qr') renderPairPanel();
  else remoteStopPairCode(true); // le code ne reste actif que sur l'onglet d'appairage
}

