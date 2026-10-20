// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ TEL « COMPOSER PUIS ENVOYER » (télécommande) ══════════════════════════
// Phase 4 de la refonte (maquettes 4a à 4e3). L'onglet Tel est un seul squelette
// pour les quatre types : sélecteur de type, carte « À jouer » (rangées-résumé
// qui ouvrent leur vue de réglage, mêmes champs et mêmes identifiants qu'avant),
// liste enregistrée du type (82-call-list.js), et UNE barre d'action fixe
// au-dessus des onglets (#tel-bar) :
//   Appel         [signet] FAIRE SONNER · pendant la sonnerie : ligne d'état +
//                 progression, Raccrocher / Décrocher ; en ligne : Raccrocher
//   SMS           [signet] ENVOYER LE SMS
//   Notification  [signet] ENVOYER LA NOTIFICATION
//   Discussion    [signet] OUVRIR SUR L'ÉCRAN ; ouverte : ↶ · Lecture auto /
//                 Pause · ENVOYER N°n, avec l'état de la lecture auto au-dessus
// Le signet enregistre (feuille « Enregistrer » ; entrée chargée : mettre à
// jour ou enregistrer comme nouveau). Aperçu sans licence : signet et rangées
// de réglage verrouillés, ▶ des lignes et barre d'envoi actifs (77-licence-ui.js).
// Textes affichés, regroupés pour la traduction ({…} : valeurs)
const _TU_TXT = {
  on: 'sur {cible}', noScreen: 'aucun écran appairé',
  call: 'FAIRE SONNER', sms: 'ENVOYER LE SMS', notif: 'ENVOYER LA NOTIFICATION',
  sent: 'Sonnerie envoyée…', ringing: 'Ça sonne depuis {n} s', autoIn: ' · décroché auto dans {n} s', inCall: 'En ligne · {t}',
  hungup: 'Appel terminé',
  goN: 'ENVOYER N°{n}', goNone: 'Plus de message', goSub: '{qui} : « {texte} »',
  unknown: 'Inconnu', labelNone: '—', photo: 'photo',
  lockOn: 'Arrive sur un faux écran verrouillé · {heure}', lockOff: 'Le SMS arrive en bandeau', lockScreenTime: 'heure de l\'écran',
  answerNone: 'Silence · manuel', answerManual: 'manuel', answerAuto: 'décroché auto {n} s', answerAudio: 'bande son',
  showBanner: 'Bandeau', showLock: 'Écran verrouillé', recvNow: 'reçue maintenant', recvAgo: 'reçue il y a {n} min', recvAt: 'reçue à une date précise',
  detailWho: 'Appelant', detailContact: 'Contact', detailApp: 'Application', detailLock: 'Écran verrouillé', detailShow: 'Affichage', detailAnswer: 'Au décroché',
  vibOn: 'vibreur',
};
const _tuTpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));
const _tuShow = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
const _tuText = (id, t) => { const el = document.getElementById(id); if (el && el.textContent !== t) el.textContent = t; };

// ── État de l'appel de la barre : idle · sent (envoyé) · ringing · incall ──
const _telCall = { phase: 'idle', t0: 0, auto: 0, text: '' };
let _telTick = null;
function _telSecs() { return Math.max(0, Math.floor((Date.now() - _telCall.t0) / 1000)); }
// Appel envoyé (formulaire, ligne ▶) : Raccrocher / Décrocher dès l'envoi
function telCallSent(kind, auto, text) {
  if (kind !== 'call') return;
  _telCall.phase = 'sent'; _telCall.t0 = Date.now(); _telCall.auto = Math.max(0, Number(auto) || 0); _telCall.text = text || _TU_TXT.sent;
  _telStartTick();
  renderTelBar();
}
// Retour de l'écran (call:state) : sonne, en ligne, ou retour au repos avec son message
function telCallPhase(p, status) {
  if (p === 'idle') {
    _telCall.phase = 'idle';
    if (_telTick) { clearInterval(_telTick); _telTick = null; }
    _setCallStatusUI(status || '');
    return;
  }
  // Sonnerie lancée ailleurs (écran, autre appareil) : l'horloge part de maintenant
  if (p === 'incall' || _telCall.phase === 'idle') { _telCall.t0 = Date.now(); if (_telCall.phase === 'idle') _telCall.auto = 0; }
  _telCall.phase = p;
  _telStartTick();
  _telLiveRefresh();
}
function _telStartTick() { if (!_telTick) _telTick = setInterval(_telLiveRefresh, 500); _telLiveRefresh(); }
function _telLiveRefresh() {
  const c = _telCall;
  if (c.phase === 'idle') { if (_telTick) { clearInterval(_telTick); _telTick = null; } return; }
  const s = _telSecs();
  let t = '';
  if (c.phase === 'sent') t = c.text || _TU_TXT.sent;
  else if (c.phase === 'ringing') t = _tuTpl(_TU_TXT.ringing, { n: s }) + (c.auto > 0 ? _tuTpl(_TU_TXT.autoIn, { n: Math.max(0, c.auto - s) }) : '');
  else t = _tuTpl(_TU_TXT.inCall, { t: fmtTime(s) });
  const el = document.getElementById('callStatus');
  if (el && el.textContent !== t) _setCallStatusUI(t, true); else renderTelBar();
  const f = document.getElementById('telProgFill');
  if (f) f.style.width = (c.phase !== 'incall' && c.auto > 0 ? Math.min(100, s / c.auto * 100) : 0) + '%';
}
// Raccrocher : l'appel est coupé sur les écrans, la barre revient au repos sans attendre leur réponse
function telHangup() {
  sendMsg({ type: 'call:end' });
  telCallPhase('idle', _TU_TXT.hungup);
}

// ── Barre d'action ──
function renderTelBar() {
  const bar = document.getElementById('tel-bar');
  if (!bar) return;
  const k = callKind, disc = k === 'discussion', ph = _telCall.phase;
  const inCall = k === 'call' && ph !== 'idle';
  const tg = scrTargetText(), nScr = scrList().length;
  const sub = nScr ? _tuTpl(_TU_TXT.on, { cible: tg.name + tg.count }) : _TU_TXT.noScreen;
  const status = (document.getElementById('callStatus') || {}).textContent || '';
  renderTelOn(); // « Retirer de l'écran » (27-tab-gate.js)
  _tuShow('telSaveBtn', !inCall);
  _tuShow('callTriggerBtn', !disc && !inCall);
  _tuShow('callHangBtn', !disc && inCall);
  _tuShow('callAnswerBtn', !disc && inCall && ph !== 'incall');
  _tuShow('telLive', !disc && !!status);
  _tuShow('telProg', !disc && inCall && ph !== 'incall' && _telCall.auto > 0);
  const live = document.getElementById('telDot');
  if (live) live.className = 'nb-dot' + (inCall ? (ph === 'incall' ? ' ok' : ' acc') : ' ok');
  if (!disc) {
    _tuText('callTriggerLbl', _TU_TXT[k] || _TU_TXT.call);
    _tuText('callTriggerSub', sub);
    const use = document.querySelector('#callTriggerIc use');
    const href = '#i-' + (k === 'call' ? 'phone' : k === 'sms' ? 'send' : 'bell');
    if (use && use.getAttribute('href') !== href) use.setAttribute('href', href);
  }
  // Discussion : ouvrir, puis ↶ · lecture auto · envoyer
  const open = disc && _chat.open;
  _tuShow('dcOpenBtn', disc && !_chat.open);
  _tuShow('dcBackBtn', open);
  _tuShow('dcAutoPlay', open);
  _tuShow('dcGo', open);
  _tuShow('dcLive', open);
  _tuShow('dcProg', open);
  if (disc) {
    _tuText('dcOpenSub', sub);
    const next = chatNextContact();
    const n = next ? _chat.msgs.indexOf(next) + 1 : 0;
    _tuText('dcGoLbl', next ? _tuTpl(_TU_TXT.goN, { n }) : _TU_TXT.goNone);
    const snip = next ? Array.from(next.text).slice(0, 26).join('') + (Array.from(next.text).length > 26 ? '…' : '') : '';
    _tuText('dcGoSub', next ? _tuTpl(_TU_TXT.goSub, { qui: chatContactName(), texte: snip }) : '');
    const go = document.getElementById('dcGo');
    if (go) go.disabled = !next;
    const bk = document.getElementById('dcBackBtn');
    if (bk) bk.disabled = !_chat.sent.length;
  }
  const sv = document.getElementById('telSaveBtn');
  if (sv) sv.setAttribute('aria-label', disc ? 'Enregistrer le fil dans la liste' : k === 'call' ? 'Enregistrer l\'appel dans la liste' : k === 'sms' ? 'Enregistrer le SMS dans la liste' : 'Enregistrer la notification dans la liste');
}
// Signet : enregistrer l'appel / le SMS / la notification, ou le fil de la discussion
function telBarSave() {
  if (callKind === 'discussion') openSaveChatSheet(); else openSaveCallSheet();
}

// ── Rangées-résumé de la carte « À jouer » ──
function renderTelRows() {
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const T = _TU_TXT, k = callKind;
  const name = val('callName').trim() || T.unknown, label = val('callLabel').trim();
  const av = document.getElementById('telWhoAv');
  if (av) {
    av.style.backgroundImage = _callPhoto ? 'url(' + _callPhoto + ')' : '';
    const ini = name.charAt(0).toUpperCase() || '?';
    if (av.textContent !== (_callPhoto ? '' : ini)) av.textContent = _callPhoto ? '' : ini;
  }
  _tuText('telWhoName', name);
  _tuText('telWhoSub', (label || T.labelNone) + (_callPhoto ? ' · ' + T.photo : ''));
  // SMS : application, écran verrouillé
  const app = document.getElementById('telAppVal');
  if (app) {
    const h = '<i class="tl-dot" style="background:' + escapeHtml(val('callAppColor') || '#2f8cf0') + '"></i>' + escapeHtml(val('callAppName') || 'SMS');
    if (app.innerHTML !== h) app.innerHTML = h;
  }
  const lock = document.getElementById('lockToggle');
  _tuText('telLockSub', lock && lock.checked ? _tuTpl(T.lockOn, { heure: val('lockTime').trim() || T.lockScreenTime }) : T.lockOff);
  // Notification : application, affichage
  const nm = val('ntAppName').trim();
  _tuText('telNtName', nm || '?');
  const nav = document.getElementById('telNtAv');
  if (nav) {
    nav.style.backgroundImage = _notifIcon ? 'url(' + _notifIcon + ')' : '';
    const ini = _notifIcon ? '' : (nm.charAt(0).toUpperCase() || '?');
    if (nav.textContent !== ini) nav.textContent = ini;
  }
  let recv = T.recvNow;
  if (notifReceived === 'ago') recv = _tuTpl(T.recvAgo, { n: _ntReceived().min });
  else if (notifReceived === 'at') recv = T.recvAt;
  _tuText('telNtShowVal', (notifPresent === 'lock' ? T.showLock : T.showBanner) + ' · ' + recv);
  // Appel : au décroché
  const slider = document.getElementById('callAutoSlider');
  const auto = slider ? parseInt(slider.value) || 0 : 0;
  const parts = [];
  parts.push(_callAudioData ? (_callAudioName ? _callAudioName.replace(/\.[a-z0-9]{2,4}$/i, '') : T.answerAudio) : null);
  if (!parts[0]) parts[0] = 'Silence';
  parts.push(auto > 0 ? _tuTpl(T.answerAuto, { n: auto }) : T.answerManual);
  _tuText('telAnswerVal', parts.join(' · '));
  void k;
}

// ── Vues de réglage des rangées (même chrome que « Style et sonnerie ») ──
const _TD_SECS = { who: 'tdWho', app: 'tdApp', lock: 'tdLock', ntapp: 'tdNtApp', ntshow: 'tdNtShow', answer: 'tdAnswer' };
let _tdSec = null;
function openTelDetail(sec) {
  if (licLocked('tel') || !_TD_SECS[sec]) return; // aperçu sans licence : réglages verrouillés
  const v = document.getElementById('tel-detail-view');
  if (!v) return;
  _tdSec = sec;
  for (const [s, id] of Object.entries(_TD_SECS)) { const el = document.getElementById(id); if (el) el.style.display = s === sec ? 'flex' : 'none'; }
  const T = _TU_TXT;
  _tuText('tdTitle', sec === 'who' ? (callKind === 'call' ? T.detailWho : T.detailContact) : sec === 'app' || sec === 'ntapp' ? T.detailApp : sec === 'lock' ? T.detailLock : sec === 'ntshow' ? T.detailShow : T.detailAnswer);
  v.classList.toggle('over-sheet', !!_sheet); // ouverte depuis une feuille (création sur place) : passe devant
  v.style.display = 'flex';
  v.scrollTop = 0;
  renderCallerState();
  if (sec === 'ntshow' || sec === 'ntapp') renderNotifForm();
}
function closeTelDetail() {
  _tdSec = null;
  const v = document.getElementById('tel-detail-view');
  if (v) { v.style.display = 'none'; v.classList.remove('over-sheet'); }
  renderTelRows();
  if (_sheet && _sheet.kind === 'seqNewEntry') renderSheet(); // création sur place : valeurs des rangées à jour
}
function telDetailIsOpen() { return _tdSec !== null; }
// Échap : ferme la vue (une feuille ouverte passe d'abord)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _tdSec !== null && !_sheet && !appConfirmShown()) closeTelDetail();
}, true);
