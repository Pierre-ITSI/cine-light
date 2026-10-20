// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ LICENCE : APERÇU TEL / SÉQUENCE ET RÉGLAGES (télécommande) ══════════════════════════
// Version officielle seulement (LIC_ON, 14-licence.js) ; sinon rien de ce
// fichier ne s'affiche ni ne change quoi que ce soit.
// Maquettes validées 39 (Tel en aperçu), 39b (Séquence en aperçu), 37 et 37b
// (Réglages › Licence), SANS compteur du jour : l'aperçu n'a pas de quota.
//
// Aperçu (onglet sans sa fonctionnalité, licenceHas) :
//   • bandeau « Aperçu · Tel / Séquence », texte, identifiant de l'appareil
//     (toucher : copier) et « Obtenir une licence › » (version web seulement,
//     LICENCE_BUY_URL ; jamais dans l'app native, règles des stores) ;
//   • contenu de démonstration (76-demos.js) servi par le MASQUE du stockage
//     (12-session.js) : les modules de l'onglet relisent leurs clés et
//     trouvent la démo ; ce qu'ils écrivent reste en mémoire. Les données de
//     l'utilisateur ne sont jamais lues ni écrites pendant l'aperçu et
//     reviennent telles quelles avec la licence (même onglet, sans recharger) ;
//   • réglages, enregistrements, ajouts et renommages verrouillés (inert,
//     estompés) ; envoyer, déclencher, GO / ↶ / STOP marchent sans limite.
// Tel : le formulaire (champs, style, photo, bande son, fonds) est gardé en
// mémoire à l'entrée de l'aperçu et rendu à la sortie.
// Fonctionnalités séparées (licence Tel sans Séquence, ou l'inverse) :
//   • Séquence en aperçu, Tel sous licence : l'onglet Tel montre les éléments
//     de l'utilisateur ; la démo Séquence joue ses propres SMS et discussion
//     (licDemoRef). Son étape Discussion prend le « Fil en cours » comme toute
//     séquence : le fil de l'utilisateur est alors mis de côté (masqué) et
//     rendu à « Recommencer » ou à l'arrivée de la licence Séquence.
//   • Tel en aperçu, Séquence sous licence : les étapes Appel / SMS /
//     Notification / Discussion de l'utilisateur pointent vers ses éléments
//     Tel, masqués : elles s'affichent « élément introuvable » et sont sautées
//     jusqu'à la licence Tel (rien n'est perdu).
// Textes affichés, regroupés pour la traduction ({…} : valeurs)
const _LIC_TXT = {
  tagTel: 'Aperçu · Tel', tagSeq: 'Aperçu · Séquence',
  textTel: 'Exemples prêts à jouer sur l\'écran, non modifiables. La licence débloque vos propres appels, SMS et discussions.',
  textSeq: 'Exemples prêts à jouer sur l\'écran, non modifiables. La licence débloque vos propres séquences.',
  idChip: 'ID', idNone: '····-····', copyAria: 'Copier l\'identifiant de cet appareil',
  buy: 'OBTENIR UNE LICENCE ›', example: ' · exemple 🔒',
  none: 'Aucune licence', active: 'Active', until: 'jusqu\'au {date}', soon: 'expire dans {n} j',
  holder: 'Titulaire', devices: 'Appareils', devicesVal: '{n} sur {max}', includes: 'Comprend', checked: 'Vérifiée',
  offline: 'Hors ligne', offlineVal: 'valable jusqu\'au {date}', feat: { tel: 'Tel', seq: 'Séquence' }, nothing: '—',
  checkNow: 'VÉRIFIER MAINTENANT', checking: 'VÉRIFICATION…',
  copy: 'COPIER', share: 'PARTAGER', copied: 'COPIÉ ✓',
  buyNote: 'Transmettez cet identifiant lors de l\'achat sur {site} : la licence s\'active toute seule, sans rien saisir.',
  agoNow: 'à l\'instant', agoMin: 'il y a {n} min', agoH: 'il y a {n} h', agoD: 'il y a {n} j',
  err: {
    offline: 'Hors ligne : vérification impossible pour l\'instant.',
    server: 'Service de licence injoignable : réessayez plus tard.',
    invalid: 'Réponse du service de licence invalide.',
  },
  shareText: 'Identifiant SetRemote : {id}',
  months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  monthsShort: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
};
const _licTpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));
const LIC_BUY = LIC_ON && !IN_NATIVE_APP && !!LICENCE_BUY_URL;

// Onglets en aperçu (false partout sans LIC_ON)
const _licPreview = { tel: false, seq: false };
function licLocked(f) { return _licPreview[f] === true; }

// Éléments verrouillés : estompés (dim) ou seulement figés (ro, lisibles)
const _LIC_LOCKS = {
  tel: {
    dim: ['telStyleBtn', 'ntStyleBtn', 'callWhoSaved', 'callName', 'callLabel', 'callPhotoBtn', 'callerSaveBtn',
      'callMsgText', 'callAppName', 'callAppColor', 'callLockPanel', 'ntAppPanel', 'ntShowPanel', 'callAnswerBlock',
      'callListSave', 'callListUpd', 'callListDel', 'dcTab-saved', 'dcNewBtn', 'dcContactPanel', 'dcAdd', 'dcWriteBtn'],
    ro: ['dcRows', 'dcTimingPanel'],
    ex: ['callWhoLabel'],
    banner: 'licPvTel',
  },
  seq: { dim: ['seqAddBtn', 'seqPhoneBtn', 'seqTab-saved', 'seqNewBtn'], ro: ['seqRows'], ex: [], banner: 'licPvSeq' },
};
function _licLockUi(f, on) {
  const L = _LIC_LOCKS[f];
  for (const id of L.dim.concat(L.ro)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.inert = on;
    el.classList.toggle(L.ro.includes(id) ? 'lic-ro' : 'lic-lk', on);
  }
  for (const id of L.ex) {
    const el = document.getElementById(id);
    if (el) { el.dataset.licEx = _LIC_TXT.example; el.classList.toggle('lic-ex', on); }
  }
  const b = document.getElementById(L.banner);
  if (b) b.style.display = on ? '' : 'none';
}

// ── Masque du stockage (12-session.js) ──
let _licChatAside = false; // fil de l'utilisateur mis de côté par la démo Séquence (Tel sous licence)
function _licMask(f, on) {
  for (const [k, v] of licDemoStore(f)) { if (on) _lsMask.set(k, v); else _lsMask.delete(k); }
  _assetMask[f] = on;
}
// Démo Séquence, étape Discussion (91-sequence.js, _seqOpenChat) : si Tel est
// sous licence, le fil de l'utilisateur est masqué tel quel avant d'être remplacé
function licSeqDemoChat() {
  if (!licLocked('seq') || licLocked('tel') || _licChatAside) return;
  for (const k of [CHAT_LS_KEY, CHAT_AVATAR_KEY]) _lsMask.set(k, _lsGet(k));
  _licChatAside = true;
}
// « Recommencer » (91-sequence.js) ou licence Séquence : le fil revient
function licSeqRestarted() {
  if (!_licChatAside) return;
  _licChatAside = false;
  if (licLocked('tel')) return; // le masque Tel (démo) prime
  _lsMask.delete(CHAT_LS_KEY); _lsMask.delete(CHAT_AVATAR_KEY);
  chatLoad();
  renderChatPanel();
  renderTelStyle();
}

// ── Rechargement des onglets depuis le stockage (masqué ou réel) ──
function _licReloadTel() {
  closeTelStyle();
  if (_sheet) closeSheet();
  loadRingSettings();
  renderRingPanel();
  loadCallList();
  for (const k of CALL_LISTS) _callListSel[k] = null;
  _clLoadedId = null; // plus d'entrée chargée (82-call-list.js)
  chatLoad();
  loadSavedChats();
  callersInit();
  setChatView('thread');
  renderCallList();
  renderNotifForm();
  renderChatPanel();
  renderSavedChats();
  renderCallerState();
  renderTelStyle();
}
function _licReloadSeq() {
  if (_seqEdit) closeSeqStep();
  if (_pp && _pp.ctx === 'seq') closePhoneParams();
  if (_sheet) closeSheet();
  seqLoad();
  loadSavedSeqs();
  setSeqView('cur');
}

// ── Formulaire Tel : gardé à l'entrée de l'aperçu, rendu à la sortie ──
let _licTelBak = null, _licTelGen = 0;
function _licTelBackup() {
  const inputs = {};
  document.querySelectorAll('#content-call input, #content-call textarea').forEach((el) => {
    if (el.id && el.type !== 'file') inputs[el.id] = { v: el.value, c: el.checked, t: el.dataset.touched };
  });
  _licTelBak = {
    inputs, kind: callKind, callStyle, callPresent, callPhotoMode, photo: _callPhoto,
    audio: [_callAudioData, _callAudioName, _callAudioDur], lockWall: _lockWallData,
    notifStyle, notifPresent, notifReceived, notifIcon: _notifIcon, notifWall: _notifWallData,
  };
}
function _licBg(id, data) { const el = document.getElementById(id); if (el) el.style.backgroundImage = data ? 'url(' + data + ')' : ''; }
async function _licTelDemoForm() {
  const gen = ++_licTelGen, kind = callKind;
  _callAudioSeq++; _callAudioData = null; _callAudioName = ''; _callAudioDur = 0;
  _lockWallData = null; _notifWallData = null;
  _licBg('lockWallPreview', null);
  for (const e of licDemoEntries()) {
    await loadCallEntryIntoForm(e);
    if (gen !== _licTelGen) return; // licence arrivée entre-temps
  }
  setCallKind(kind);
  _callListSel.call = DEMO_IDS.call; _callListSel.sms = DEMO_IDS.sms; _callListSel.notif = DEMO_IDS.notif;
  renderCallList();
  renderCallAudioRow();
}
function _licTelRestore() {
  const b = _licTelBak;
  _licTelGen++;
  _clLoadSeq++; // chargement d'une entrée de démo encore en cours : abandonné
  if (!b) return;
  for (const [id, s] of Object.entries(b.inputs)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = s.v; el.checked = s.c;
    if (s.t) el.dataset.touched = s.t; else delete el.dataset.touched;
  }
  callStyle = b.callStyle; _callPhoto = b.photo;
  [_callAudioData, _callAudioName, _callAudioDur] = b.audio; _callAudioSeq++;
  _lockWallData = b.lockWall;
  notifStyle = b.notifStyle; notifPresent = b.notifPresent; notifReceived = b.notifReceived;
  _notifIcon = b.notifIcon; _notifWallData = b.notifWall;
  _licBg('callPhotoPreview', _callPhoto); _licBg('lockWallPreview', _lockWallData);
  setCallPresent(b.callPresent);
  setCallPhotoMode(b.callPhotoMode);
  setCallKind(b.kind);
  onCallAutoChange();
  renderNotifForm();
  renderCallAudioRow();
  renderTelStyle();
}

// ── Passage aperçu ↔ licence ──
function _licSwitch(f, on) {
  _licPreview[f] = on;
  if (f === 'tel') {
    if (on) _licTelBackup();
    _licChatAside = false;
    _licMask('tel', on);
    _licReloadTel();
    if (on) _licTelDemoForm(); else _licTelRestore();
    _licLockUi('tel', on);
  } else {
    if (_seqRun.state !== 'idle') seqRestart(); // démo ou séquence en cours : remise à zéro
    _licMask('seq', on);
    if (!on) licSeqRestarted();
    _licReloadSeq();
    _licLockUi('seq', on);
  }
}
function licApply() {
  if (!LIC_ON) return;
  for (const f of ['tel', 'seq']) {
    const want = !licenceHas(f);
    if (want !== _licPreview[f]) _licSwitch(f, want);
  }
  licRender();
}
// Démarrage (99-init.js) : masque posé AVANT le chargement des onglets…
function licBootMask() {
  if (!LIC_ON) return;
  _licPreview.tel = true; _licPreview.seq = true;
  _licMask('tel', true); _licMask('seq', true);
}
// … puis formulaire de démo, verrous, bandeaux, vérification
function licBootUi() {
  if (!LIC_ON) return;
  _licTelBackup();
  _licTelDemoForm();
  _licLockUi('tel', true); _licLockUi('seq', true);
  for (const id of ['stLicCard', 'stLicIdCard']) { const el = document.getElementById(id); if (el) el.style.display = ''; }
  licOnChange(licApply);
  licRender();
  licStart();
}

// ── Affichage : bandeaux et Réglages › Licence (maquettes 37, 37b) ──
function _licDate(t, short) {
  const d = new Date(t);
  return d.getDate() + ' ' + (short ? _LIC_TXT.monthsShort : _LIC_TXT.months)[d.getMonth()] + (short ? '' : ' ' + d.getFullYear());
}
function _licAgo(t) {
  const m = Math.max(0, Math.floor((Date.now() - t) / 60e3));
  if (m < 1) return _LIC_TXT.agoNow;
  if (m < 60) return _licTpl(_LIC_TXT.agoMin, { n: m });
  if (m < 48 * 60) return _licTpl(_LIC_TXT.agoH, { n: Math.floor(m / 60) });
  return _licTpl(_LIC_TXT.agoD, { n: Math.floor(m / 1440) });
}
function licRender() {
  if (!LIC_ON) return;
  const id = licDeviceId() || _LIC_TXT.idNone;
  document.querySelectorAll('.lic-id-txt').forEach((el) => { el.textContent = id; });
  document.querySelectorAll('.lic-pv-buy').forEach((el) => { el.style.display = LIC_BUY ? '' : 'none'; });
  renderLicenceSettings();
}
function renderLicenceSettings() {
  const card = document.getElementById('stLicCard');
  if (!LIC_ON || !card) return;
  const st = licStatus(), p = st.payload, T = _LIC_TXT;
  const set = (k, t) => { const el = document.getElementById(k); if (el) el.textContent = t; };
  set('stLicState', st.active ? T.active : T.none);
  document.getElementById('stLicDot').classList.toggle('on', st.active);
  const until = document.getElementById('stLicUntil');
  const end = p && (p.end || p.exp);
  const left = end ? Math.ceil((end - Date.now()) / 86400e3) : 0;
  until.textContent = st.active ? (left <= 7 ? _licTpl(T.soon, { n: Math.max(0, left) }) : _licTpl(T.until, { date: _licDate(end) })) : '';
  until.classList.toggle('soon', st.active && left <= 7);
  const rows = [];
  if (st.active) {
    if (p.holder) rows.push([T.holder, p.holder]);
    if (p.devices) rows.push([T.devices, _licTpl(T.devicesVal, { n: p.devices.n, max: p.devices.max })]);
    rows.push([T.includes, p.features.map((f) => T.feat[f]).join(', ') || T.nothing]);
  }
  if (st.checked) rows.push([T.checked, _licAgo(st.checked)]);
  if (st.active) rows.push([T.offline, _licTpl(T.offlineVal, { date: _licDate(p.exp, true) })]);
  const box = document.getElementById('stLicRows');
  box.textContent = '';
  for (const [k, v] of rows) {
    const r = document.createElement('div'); r.className = 'st-lic-kv';
    const a = document.createElement('span'); a.textContent = k;
    const b = document.createElement('span'); b.textContent = v;
    r.append(a, b); box.appendChild(r);
  }
  set('stLicMsg', _licManual && !st.busy && st.error ? T.err[st.error] || T.err.server : '');
  const btn = document.getElementById('stLicCheck');
  btn.disabled = st.busy; btn.textContent = st.busy ? T.checking : T.checkNow;
  // Version web sans licence : où l'acheter
  const buy = LIC_BUY && !st.active;
  const note = document.getElementById('stLicBuyNote');
  note.style.display = buy ? '' : 'none';
  if (buy) {
    note.textContent = '';
    const [a, b] = T.buyNote.split('{site}');
    const host = document.createElement('b'); host.textContent = new URL(LICENCE_BUY_URL).host;
    note.append(a, host, b);
  }
  document.getElementById('stLicBuy').style.display = buy ? '' : 'none';
}
// « Vérifier maintenant » : seul un échec demandé s'affiche (les vérifications
// de fond échouées restent discrètes, le dernier jeton valide tient)
let _licManual = false;
function licCheckNow() { _licManual = true; licCheck(); }

// ── Identifiant : copier, partager, acheter ──
function _licFlash(btn, text) {
  if (!btn) return;
  const old = btn.dataset.licOld || btn.innerHTML;
  btn.dataset.licOld = old;
  btn.classList.add('lic-done');
  if (text) btn.textContent = text;
  clearTimeout(btn._licT);
  btn._licT = setTimeout(() => { btn.innerHTML = old; delete btn.dataset.licOld; btn.classList.remove('lic-done'); }, 1500);
}
async function _licCopy(text) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) { return false; }
}
// btn : bouton touché (retour « Copié »), text : texte affiché (null : garde le libellé, pastille du bandeau)
async function licCopyId(btn, text) {
  const id = licDeviceId();
  if (!id) return false;
  const ok = await _licCopy(id);
  if (ok) _licFlash(btn, text === undefined ? _LIC_TXT.copied : text);
  return ok;
}
async function licShareId(btn) {
  const id = licDeviceId();
  if (!id) return;
  if (navigator.share) {
    try { await navigator.share({ text: _licTpl(_LIC_TXT.shareText, { id }) }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  licCopyId(btn);
}
function licOpenBuy() {
  if (!LIC_BUY) return;
  const id = licDeviceId();
  window.open(LICENCE_BUY_URL + (id ? '?id=' + encodeURIComponent(id) : ''), '_blank', 'noopener');
}
