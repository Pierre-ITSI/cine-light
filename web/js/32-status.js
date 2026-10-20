// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ STATUS ══════════════════════════
// Télécommande : pastille de liaison dans l'en-tête et liste des écrans
// appairés (onglet d'appairage). Un écran est « hors ligne » s'il n'a rien
// envoyé depuis 40 s (il émet un signe de vie toutes les 15 s).
// Pastille : l'état de la LIAISON seulement (« Connexion… », « Reconnexion… »,
// « Horloge décalée », puis la liaison la plus faible qui relie encore un
// écran : Internet, Wi-Fi local, Bluetooth). Les écrans muets ne s'y lisent
// plus : badge de l'onglet Écrans (31-nav-status.js) et lignes de la liste.
// Avec les liaisons locales (21-links.js), chaque écran garde sa liaison.
const SCREEN_ALIVE_MS = 15000, SCREEN_OFFLINE_MS = 40000;
let _linkState = 'connecting', _linkEverConnected = false, _linkWatch = null; // _linkState : transport Internet
const _pairedScreens = new Map();   // screenId (ou étiquette d'émetteur) → { n, lastSeen, via? }
const _screenOfSender = new Map();  // étiquette d'émetteur → screenId
let _pairedSeq = 0;

function setConnStatus(s) {
  _linkState = s;
  if (s === 'connected') {
    remoteLinkGrace();
    _linkEverConnected = true;
  }
  if (!_linkWatch && mode === 'remote') _linkWatch = setInterval(renderLinkStatus, 5000);
  renderLinkStatus();
}
// Retour de la liaison : délai de grâce avant de déclarer un écran muet
function remoteLinkGrace() {
  const now = Date.now();
  for (const sc of _pairedScreens.values()) sc.lastSeen = Math.max(sc.lastSeen, now - SCREEN_OFFLINE_MS + 10000);
  if (!_linkWatch && mode === 'remote') _linkWatch = setInterval(renderLinkStatus, 5000);
}
function stopLinkWatch() { if (_linkWatch) { clearInterval(_linkWatch); _linkWatch = null; } }
// La télécommande est-elle reliée (Internet ou un pair local) ?
function remoteLinkUp() { return _linkState === 'connected' || _linkPeers.size > 0; }

function _offlineScreens(now) { return [..._pairedScreens.values()].filter((s) => now - s.lastSeen > SCREEN_OFFLINE_MS); }

// Liaison la plus faible en service : 0 Internet, 1 Wi-Fi local, 2 Bluetooth
const _LINK_RANK = { internet: 0, lan: 1, ble: 2 };
function remoteWorstLink(now) {
  const inet = _linkState === 'connected';
  let worst = inet ? 0 : (linkPeerCount('lan') ? 1 : 2);
  for (const id of _pairedScreens.keys()) {
    const l = scrLinkOf(id, now);
    if (l !== 'off') worst = Math.max(worst, _LINK_RANK[l]);
  }
  return ['online', 'lan', 'ble'][worst];
}

function renderLinkStatus() {
  const now = Date.now();
  const pill = document.getElementById('linkPill'), lbl = document.getElementById('linkPillLabel');
  if (pill && lbl) {
    let cls, text;
    if (!remoteLinkUp()) {
      cls = 'reconnecting'; text = _linkEverConnected ? 'Reconnexion…' : 'Connexion…';
    } else if (clockSkewed) {
      cls = 'skew'; text = 'Horloge décalée'; // trames authentiques mais hors des 5 min de tolérance
    } else {
      cls = remoteWorstLink(now);
      text = LINK_LABELS[cls === 'online' ? 'internet' : cls];
    }
    pill.className = 'link-pill ' + cls;
    lbl.textContent = text;
  }
  renderScreensUi(now); // liste des écrans, puce Cible, vues ouvertes (39-screens-ui.js)
  renderNavBadges(); // écrans hors ligne : badge de l'onglet Écrans
}

// Noms : ceux du registre de la session (28-screens.js, « Écran n » par défaut).
// Une ligne par écran (pastille de couleur, nom, ce qu'il montre, liaison) ;
// la toucher ouvre la feuille « Écran » (39-screens-ui.js).
function renderPairedScreens(now) {
  const box = document.getElementById('pairScreens'), list = document.getElementById('pairScreensList');
  if (!box || !list) return;
  const ids = typeof scrList === 'function' ? scrList() : [];
  document.getElementById('pairScreensCount').textContent = String(ids.length);
  const empty = document.getElementById('pairScreensEmpty');
  if (empty) empty.style.display = ids.length ? 'none' : 'block';
  const idAll = document.getElementById('identifyAllBtn');
  if (idAll) idAll.style.display = ids.length ? '' : 'none';
  _setHtml(list, ids.map((id) => {
    const l = scrLinkOf(id, now);
    const now_ = scrNowText(id) || '';
    return '<button type="button" class="pair-screen' + (l === 'off' ? ' off' : l === 'internet' ? '' : ' ' + l) + '" data-id="' + id + '" onclick="openScreenSheet(\'' + id + '\')">'
      + '<span class="ps-sw" style="' + scrSwatchCss(id) + '"></span>'
      + '<span class="ps-main"><span class="ps-name">' + escapeHtml(scrName(id)) + '</span><span class="ps-now">' + escapeHtml(now_) + '</span></span>'
      + '<span class="ps-link"><span class="ps-dot"></span>' + LINK_LABELS[l] + '</span>' + icon('chevron-right', 'ic-trail') + '</button>';
  }).join(''));
  const gb = document.getElementById('pairGroups'), t = scrTarget();
  _setHtml(gb, ids.length ? _scrReg.groups.map((g) => '<button type="button" class="sv-chip' + (t.k === 'group' && t.id === g.id ? ' on' : '')
    + '" onclick="openGroupEditor(\'' + g.id + '\')">' + escapeHtml(g.name) + ' · ' + scrGroupMembers(g.id).length + '</button>').join('')
    + (_scrReg.groups.length < SCR_GROUPS_MAX ? '<button type="button" class="sv-chip add" onclick="openGroupEditor(null)">+ Nouveau groupe</button>' : '') : '');
}

// Doublon authentifié arrivé par une autre liaison : cette liaison relie l'écran
function remoteNoteVia(sender, via, peer) {
  const id = _screenOfSender.get(sender) || sender;
  const sc = _pairedScreens.get(id);
  if (!sc) return;
  const before = scrLinkOf(id);
  linkNoteVia(sc, via, peer, id);
  if (scrLinkOf(id) !== before) renderLinkStatus();
}

// Chaque message authentifié d'un écran prouve qu'il est en ligne ; « caps »
// rattache son étiquette d'émetteur (une par lancement) à son screenId stable
// et l'inscrit au registre de la session (nom, groupes : 28-screens.js).
// via / peer : liaison qui l'a porté (21-links.js) ; absente : sans détail.
function remoteNoteScreen(sender, msg, via, peer) {
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
  const before = via ? scrLinkOf(id) : null;
  sc.lastSeen = Date.now();
  if (via) linkNoteVia(sc, via, peer, id);
  if (wasOff || (via && scrLinkOf(id) !== before)) renderLinkStatus();
}
function clearPairedScreens() { _pairedScreens.clear(); _screenOfSender.clear(); _linkPeerScreen.clear(); _pairedSeq = 0; renderLinkStatus(); }

// Toucher la pastille : détail par écran (onglet Écrans)
function openLinkDetail() {
  switchTab('screens');
  const sc = navScroller();
  if (sc) sc.scrollTop = 0;
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

