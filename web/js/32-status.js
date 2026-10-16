// ══════════════════════════ STATUS ══════════════════════════
// Télécommande : pastille de liaison dans l'en-tête et liste des écrans
// appairés (onglet d'appairage). Un écran est « hors ligne » s'il n'a rien
// envoyé depuis 40 s (il émet un signe de vie toutes les 15 s).
const SCREEN_ALIVE_MS = 15000, SCREEN_OFFLINE_MS = 40000;
let _linkState = 'connecting', _linkEverConnected = false, _linkWatch = null;
const _pairedScreens = new Map();   // screenId (ou étiquette d'émetteur) → { n, lastSeen }
const _screenOfSender = new Map();  // étiquette d'émetteur → screenId
let _pairedSeq = 0;

function setConnStatus(s) {
  _linkState = s;
  if (s === 'connected') {
    // Retour de la liaison : délai de grâce avant de déclarer un écran muet
    const now = Date.now();
    for (const sc of _pairedScreens.values()) sc.lastSeen = Math.max(sc.lastSeen, now - SCREEN_OFFLINE_MS + 10000);
    _linkEverConnected = true;
  }
  if (!_linkWatch && mode === 'remote') _linkWatch = setInterval(renderLinkStatus, 5000);
  renderLinkStatus();
}
function stopLinkWatch() { if (_linkWatch) { clearInterval(_linkWatch); _linkWatch = null; } }

function _offlineScreens(now) { return [..._pairedScreens.values()].filter((s) => now - s.lastSeen > SCREEN_OFFLINE_MS); }

function renderLinkStatus() {
  const now = Date.now();
  const pill = document.getElementById('linkPill'), lbl = document.getElementById('linkPillLabel');
  if (pill && lbl) {
    let cls, text;
    if (_linkState !== 'connected') {
      cls = 'reconnecting'; text = _linkEverConnected ? 'Reconnexion…' : 'Connexion…';
    } else if (clockSkewed) {
      cls = 'skew'; text = 'Horloge décalée'; // trames authentiques mais hors des 5 min de tolérance
    } else {
      const off = _offlineScreens(now).length;
      if (off) { cls = 'offline'; text = 'Hors ligne · ' + off + (off > 1 ? ' écrans' : ' écran'); }
      else { cls = 'online'; text = 'Internet · chiffré'; }
    }
    pill.className = 'link-pill ' + cls;
    lbl.textContent = text;
  }
  renderPairedScreens(now);
}

// Noms : ceux du registre de la session (28-screens.js, « Écran n » par défaut)
function renderPairedScreens(now) {
  const box = document.getElementById('pairScreens'), list = document.getElementById('pairScreensList');
  if (!box || !list) return;
  box.style.display = _pairedScreens.size ? 'flex' : 'none';
  document.getElementById('pairScreensCount').textContent = String(_pairedScreens.size);
  const order = (id, s) => { const e = _scrReg.screens.get(id); return e ? e.n : 1e6 + s.n; };
  list.innerHTML = [..._pairedScreens.entries()].sort((a, b) => order(...a) - order(...b)).map(([id, s]) => {
    const off = _linkState === 'connected' && now - s.lastSeen > SCREEN_OFFLINE_MS;
    return '<div class="pair-screen' + (off ? ' off' : '') + '"><span class="ps-dot"></span>'
      + '<span class="ps-name">' + escapeHtml(scrName(id)) + '</span><span class="ps-link">' + (off ? 'Hors ligne' : 'Internet') + '</span></div>';
  }).join('');
  if (typeof renderScreensUi === 'function') renderScreensUi(); // liaison de chaque écran (maquette 5)
}

// Chaque message authentifié d'un écran prouve qu'il est en ligne ; « caps »
// rattache son étiquette d'émetteur (une par lancement) à son screenId stable
// et l'inscrit au registre de la session (nom, groupes : 28-screens.js).
function remoteNoteScreen(sender, msg) {
  if (msg.type === 'caps' && typeof msg.screenId === 'string' && SRP.SCREEN_ID_RE.test(msg.screenId)) {
    for (const [snd, id] of _screenOfSender) if (id === msg.screenId && snd !== sender) _screenOfSender.delete(snd);
    _screenOfSender.set(sender, msg.screenId);
    // Trames reçues avant son « caps » : comptées sous son étiquette, désormais sous son identifiant
    if (_pairedScreens.has(sender) && !_pairedScreens.has(msg.screenId)) {
      _pairedScreens.set(msg.screenId, _pairedScreens.get(sender));
    }
    _pairedScreens.delete(sender);
    scrRegister(msg.screenId);
  }
  const id = _screenOfSender.get(sender) || sender;
  let sc = _pairedScreens.get(id);
  if (!sc) {
    if (_pairedScreens.size >= 64) return; // borne mémoire (au-delà : ignoré)
    sc = { n: ++_pairedSeq, lastSeen: 0 };
    _pairedScreens.set(id, sc);
  }
  const wasOff = Date.now() - sc.lastSeen > SCREEN_OFFLINE_MS;
  sc.lastSeen = Date.now();
  if (wasOff) renderLinkStatus();
}
function clearPairedScreens() { _pairedScreens.clear(); _screenOfSender.clear(); _pairedSeq = 0; renderLinkStatus(); }

// Toucher la pastille : détail par écran (onglet d'appairage)
function openLinkDetail() {
  switchTab('qr');
  const el = document.getElementById(_pairedScreens.size ? 'pairScreens' : 'content-qr');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function setScreenStatus(msg) {
  const el = document.getElementById('screen-status');
  if (el) el.textContent = msg;
}

// Affiche une confirmation temporaire sur l'écran de jeu (fondu après ~5 s)
let _screenNoticeTimer = null;
function flashScreenNotice(msg, ms) {
  const el = document.getElementById('screen-notice');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  if (_screenNoticeTimer) clearTimeout(_screenNoticeTimer);
  _screenNoticeTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 500);
  }, ms || 5000);
}

// ══════════════════════════ AUTO-SEND ══════════════════════════
function scheduleAutoSend() {
  if (autoSendTimer) clearTimeout(autoSendTimer);
  autoSendTimer = setTimeout(() => {
    sendMsg({ type: 'color', color: currentColor });
    const el = document.getElementById('autosendBadge');
    if (el) { el.classList.add('visible'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('visible'), 600); }
  }, 40);
}

