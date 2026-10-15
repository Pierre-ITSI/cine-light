// ══════════════════════════ NAVIGATION ══════════════════════════
function startMode(m) {
  document.getElementById('splash').style.display = 'none';
  if (m === 'screen-sacn') {
    const cfgDiv = document.getElementById('screen-sacn-config');
    if (cfgDiv) cfgDiv.style.display = 'flex';
    const hasNative = (typeof IS_NATIVE !== 'undefined' && IS_NATIVE)
                      && !!(window.Capacitor?.Plugins?.SACN);
    const bridgeSec = document.getElementById('screenSacnBridgeSection');
    const nativeBadge = document.getElementById('screenSacnNativeBadge');
    if (bridgeSec) bridgeSec.style.display = hasNative ? 'none' : 'flex';
    if (nativeBadge) nativeBadge.style.display = hasNative ? 'block' : 'none';
    if (hasNative) selectScreenSacnMode('9ch');
    return;
  }
  if (m === 'remote') {
    mode = 'remote';
    const rm = document.getElementById('remote-mode');
    rm.style.display = 'block';
    // Recalcule la mini-carte sticky maintenant que la télécommande est visible
    requestAnimationFrame(() => rm.dispatchEvent(new Event('scroll')));
    initWheel();
    loadColorMemories(); renderColorMemories();
    recomputeColor();
    document.getElementById('channelInput').value = 'set' + Math.floor(Math.random()*9000+1000);
  } else {
    const hash = location.hash.replace('#','');
    if (hash) { enterScreenMode(hash); }
    else {
      document.getElementById('screen-connect').style.display = 'flex';
      setTimeout(() => document.getElementById('screenChannelInput').focus(), 100);
    }
  }
}

function screenConnect() {
  const ch = cleanChannel(document.getElementById('screenChannelInput').value);
  if (!ch) return;
  document.getElementById('screen-connect').style.display = 'none';
  enterScreenMode(ch);
}

// Code canal : lettres/chiffres uniquement (un « + » ou « # » deviendrait un
// joker MQTT et abonnerait l'écran à tous les canaux)
function cleanChannel(s) {
  return String(s || '').trim().toLowerCase().replace(/\W/g, '').slice(0, 40);
}

function enterScreenMode(ch) {
  ch = cleanChannel(ch);
  if (!ch) return;
  if (mode === 'screen' && channel === ch && mqttClient) return; // déjà connecté
  document.getElementById('splash').style.display = 'none';
  mode = 'screen'; channel = ch;
  const el = document.getElementById('screen-mode');
  el.style.display = 'flex';
  el.style.backgroundColor = '#1a1a1a';
  setScreenStatus('Connexion à ' + ch + '…');
  requestFS();
  acquireWakeLock();
  setupScreenAutohide();
  if (!navigator.vibrate) { const b=document.getElementById('vibrateBtn'); if(b){b.classList.add('unavail');b.textContent='📳 Indispo (iPhone)';b.classList.remove('on');} vibrateEnabled=false; }
  initBCFallback(ch);
  let firstConnect = true;
  connectMQTT(ch, () => {
    setScreenStatus('✓ En écoute — canal : ' + ch);
    // Confirmation visible uniquement à la 1re connexion : les reconnexions
    // automatiques ne doivent rien afficher (l'écran est peut-être dans le champ)
    if (firstConnect && !screenBlackoutOn) flashScreenNotice('En écoute du canal « ' + ch + ' »');
    firstConnect = false;
    sendCaps();
  });
}

function connectChannel() {
  const ch = cleanChannel(document.getElementById('channelInput').value);
  if (!ch) return;
  channel = ch;
  setConnStatus('connecting');
  initBCFallback(ch);
  connectMQTT(ch, () => {
    setConnStatus('connected');
    // Envoyer la couleur courante dès la connexion
    sendMsg({ type: 'color', color: currentColor });
    // Demander au récepteur ses capacités (torche / vibreur)
    sendMsg({ type: 'hello' });
    // Resynchroniser l'option « avancer au clic » côté écran de jeu
    sendMsg({ type: 'media:autoadvance', on: _autoAdvance });
    // Resynchroniser la luminosité de l'écran de jeu
    sendMsg({ type: 'screen:brightness', value: screenBrightnessPct / 100 });
    // Resynchroniser le comportement de fin de lecture vidéo
    sendMsg({ type: 'media:endmode', mode: _videoEndMode });
    // Fond d'écran verrouillé + bande son : plus de renvoi systématique à
    // chaque (re)connexion — la réponse « caps » au hello déclenche une
    // resynchronisation complète qui ne les renvoie que si l'écran ne les a
    // pas (24-resync.js).
    // Synchroniser l'ordre du pool et précharger les médias sur l'écran
    sendPoolOrder();
    schedulePreload();
  });
  setTimeout(renderQR, 300);
}

function suspendScreen() {
  exitFS();
  cancelScreenAutohide();
  hideScreenMedia();
  stopScreenEffect();
  screenCallHide();
  setBlackout(false);
  // Déconnecter MQTT mais garder le canal en mémoire
  if (mqttClient) { mqttClient.end(true); mqttClient = null; }
  // Cacher l'écran et revenir à la saisie de canal
  const el = document.getElementById('screen-mode');
  if (el) el.style.display = 'none';
  // Pré-remplir le champ avec le canal actuel
  const inp = document.getElementById('screenChannelInput');
  if (inp && channel) inp.value = channel;
  document.getElementById('screen-connect').style.display = 'flex';
  setTimeout(() => { if (inp) inp.focus(); }, 100);
}

// ── Menu de l'écran de jeu (double-clic OU appui long, coin haut-gauche) ──
function openScreenMenu() {
  const m = document.getElementById('screen-menu');
  const c = document.getElementById('screenMenuChannel');
  if (c) c.textContent = 'Canal : ' + (channel || '—');
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
  if (mqttClient) { try { mqttClient.end(true); } catch (_) {} mqttClient = null; }
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
  // Fermer réellement la session écran : sinon le téléphone continue de
  // recevoir (et de sonner sur un appel simulé) derrière l'écran d'accueil.
  if (mode === 'screen') {
    if (screenStrobeTimer) { clearTimeout(screenStrobeTimer); screenStrobeTimer = null; }
    stopTorchDimLoop(); stopTorchEffectLoop(); releaseTorch();
    if (mqttClient) { try { mqttClient.end(true); } catch (_) {} mqttClient = null; }
    if (window._bc) { try { window._bc.close(); } catch (_) {} window._bc = null; }
    mode = null;
  }
  releaseWakeLock();
  nativePost({ type: 'brightness-restore' }); // l'app native rend la luminosité d'origine
  const sm = document.getElementById('screen-mode');
  if (sm) sm.style.display = 'none';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const cfgDiv = document.getElementById('screen-sacn-config');
  if (cfgDiv) cfgDiv.style.display = 'none';
  stopScreenSACN();
  document.getElementById('screen-connect').style.display = 'none';
  document.getElementById('splash').style.display = 'flex';
  applyPendingUpdate();
}

function goBack() {
  stopStrobe();
  stopMediaBroadcast(true);
  if (mqttClient) { mqttClient.end(true); mqttClient = null; }
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
  if (t === 'qr') renderQR();
}

