// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ APPELANTS ENREGISTRÉS (onglet Tel, télécommande) ══════════════════════════
// Maquettes validées 36, 36c, 36d et 36e. Un appelant enregistré (nom,
// sous-titre, photo) sert aux appels, SMS et discussions :
//   • « Enregistrés (n) › » en tête du panneau Appelant / Contact (appel, SMS)
//     et du contact de la discussion ouvre la feuille « Appelants enregistrés » :
//     toucher une ligne applique nom, sous-titre et photo au type affiché
//     (discussion : nom et photo du contact) ; « ⋯ » : renommer, supprimer ;
//     « + Enregistrer « Nom » (actuel) ». L'appelant du formulaire est en orange.
//   • Sous la photo (appel, SMS) : « ☆ Enregistrer comme appelant », ou
//     « ✓ Appelant enregistré » quand nom, sous-titre et photo du formulaire
//     sont ceux d'un appelant enregistré.
// Même nom et même sous-titre (sans tenir compte des majuscules) : un seul
// appelant ; l'enregistrer à nouveau remplace sa photo.
// Stockage (comme la liste des appels, 82-call-list.js) : textes en
// localStorage (setremote-callers-v1), photos dans IndexedDB (callAssetPut /
// Get / Delete, clé « caller-<id>:photo »), à défaut en mémoire le temps de la
// session. Au plus CALLERS_MAX appelants, revalidés au chargement.
// Migration : au premier chargement (clé absente), les appelants des appels
// et SMS enregistrés (setremote-call-list-v1) et les contacts des discussions
// enregistrées sont repris, sans doublon (nom + sous-titre), photos comprises.
// Les listes d'origine ne changent pas.
const CALLERS_KEY = 'setremote-callers-v1';
const CALLERS_MAX = 50;
const _CR_NAME_MAX = 40;
const _CR_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
// Textes affichés (maquettes 36, 36e), regroupés pour la traduction ({…} : valeurs)
const _CR_TXT = {
  title: 'Appelants enregistrés',
  link: 'Enregistrés ({n}) ›',
  photo: 'photo', noLabel: '—', sep: ' · ',
  add: '+ Enregistrer « {nom} » (actuel)', added: '✓ « {nom} » enregistré', full: 'Liste pleine ({max} appelants)',
  note: 'Un appelant enregistré sert aux appels, SMS et discussions : nom, sous-titre et photo. « ⋯ » : renommer, supprimer.',
  empty: 'Aucun appelant enregistré pour l\'instant.',
  close: 'Fermer', cancel: 'Annuler', ok: 'Enregistrer',
  rename: 'Renommer', remove: 'Supprimer', more: 'Renommer, supprimer',
  sheetRename: 'Renommer l\'appelant', nameLabel: 'Nom affiché',
  confirmDelete: 'Supprimer l\'appelant « {nom} » ? Les appels, SMS et discussions déjà réglés ne changent pas.',
  saveBtn: '☆ Enregistrer comme appelant', savedNote: '✓ Appelant enregistré',
  storeFull: 'Enregistrement impossible : la mémoire de l\'appareil est pleine.',
};
const _crTpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));
// Pastilles sans photo : couleur stable dérivée du nom
const _CR_COLORS = ['#8a6a5a', '#3d5a80', '#5a7a5a', '#7a5a8a', '#80603d', '#4a6a7a'];

let callers = [];                 // [{ id, name, label, hasPhoto, photoSig }] dans l'ordre d'enregistrement
const _crPhotos = new Map();      // id → photo (data-URL) ou null, lue à la demande
const _crPhotoKey = (id) => 'caller-' + id + ':photo';
const _crLine = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, _CR_NAME_MAX) : '');
const _crKey = (name, label) => (_crLine(name) + '\u0000' + _crLine(label)).toLowerCase();
let _crIdN = 0;
const _crNewId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (++_crIdN).toString(36);

// ── Persistance ──
function _crSanitize(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !_CR_ID_RE.test(e.id)) return null;
  const name = _crLine(e.name);
  if (!name) return null;
  const photoSig = e.hasPhoto === true && typeof e.photoSig === 'string' && _CHSV_SIG_RE.test(e.photoSig) ? e.photoSig : null;
  return { id: e.id, name, label: _crLine(e.label), hasPhoto: !!photoSig, photoSig };
}
// false : mémoire pleine (rien n'est changé dans le stockage)
function _crPersist() {
  try { localStorage.setItem(CALLERS_KEY, JSON.stringify({ v: 1, list: callers })); return true; } catch (_) { return false; }
}
// Chargement ; première fois : reprise des appels, SMS et discussions enregistrés
// (après loadCallList et loadSavedChats). Promesse résolue une fois les photos reprises.
function callersInit() {
  const raw = _lsGet(CALLERS_KEY);
  if (raw === null) return _crMigrate();
  let o = null;
  try { o = JSON.parse(raw); } catch (_) { o = null; }
  const ids = new Set(), keys = new Set();
  callers = (o && Array.isArray(o.list) ? o.list : []).map(_crSanitize)
    .filter((e) => e && !ids.has(e.id) && ids.add(e.id) && !keys.has(_crKey(e.name, e.label)) && keys.add(_crKey(e.name, e.label)))
    .slice(0, CALLERS_MAX);
  renderCallerState();
  return Promise.resolve();
}
function _crMigrate() {
  const keys = new Set(), copies = [];
  callers = [];
  const add = (name, label, photoKey) => {
    const e = _crSanitize({ id: _crNewId(), name, label });
    if (!e || callers.length >= CALLERS_MAX || keys.has(_crKey(e.name, e.label))) return;
    keys.add(_crKey(e.name, e.label));
    callers.push(e);
    if (photoKey) copies.push([e, photoKey]);
  };
  for (const e of callList.call.concat(callList.sms)) add(e.name, e.label, e.hasPhoto ? e.id + ':photo' : null);
  for (const c of chatSaved) add(c.contact, '', c.hasPhoto ? _chsvPhotoKey(c.id) : null);
  _crPersist();
  renderCallerState();
  // Photos copiées (IndexedDB) ; absente ou illisible : sans photo
  return Promise.all(copies.map(async ([e, key]) => {
    const data = safeImageData(await callAssetGet(key));
    if (!data || !callers.includes(e)) return;
    await callAssetPut(_crPhotoKey(e.id), data);
    if (!callers.includes(e)) { callAssetDelete(_crPhotoKey(e.id)); return; }
    e.hasPhoto = true; e.photoSig = _chsvPhotoSig(data);
    _crPhotos.set(e.id, data);
  })).then(() => { _crPersist(); renderCallerState(); });
}
// Photo d'un appelant (null : aucune, ou illisible)
async function callerPhoto(e) {
  if (!e || !e.hasPhoto) return null;
  if (_crPhotos.has(e.id)) return _crPhotos.get(e.id);
  const data = safeImageData(await callAssetGet(_crPhotoKey(e.id)));
  _crPhotos.set(e.id, data);
  return data;
}

// ── Formulaire du type affiché ↔ appelant ──
// Empreinte de la dernière photo calculée (le formulaire la redemande à chaque frappe)
let _crSigMemo = { data: null, sig: null };
function _crSig(data) {
  if (!data) return null;
  if (_crSigMemo.data !== data) _crSigMemo = { data, sig: _chsvPhotoSig(data) };
  return _crSigMemo.sig;
}
// Nom, sous-titre et photo du formulaire (discussion : le contact, sans sous-titre)
function _crCurrent() {
  if (callKind === 'discussion') return { name: _crLine(_chat.name), label: '', photo: _chatAvatar, chat: true };
  const v = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  return { name: _crLine(v('callName')), label: _crLine(v('callLabel')), photo: _callPhoto, chat: false };
}
// Appelant du formulaire : même nom et sous-titre (discussion : même nom)
function _crMatch(cur) {
  if (!cur.name) return null;
  if (cur.chat) {
    const n = cur.name.toLowerCase();
    const same = callers.filter((e) => e.name.toLowerCase() === n);
    return same.find((e) => (e.photoSig || null) === _crSig(cur.photo)) || same[0] || null;
  }
  const k = _crKey(cur.name, cur.label);
  return callers.find((e) => _crKey(e.name, e.label) === k) || null;
}
// Enregistré tel quel (photo comprise) ?
function callerIsSaved() {
  const cur = _crCurrent(), e = _crMatch(cur);
  return !!e && (e.photoSig || null) === _crSig(cur.photo);
}

// « ☆ Enregistrer comme appelant » / « + Enregistrer « Nom » (actuel) »
async function saveCurrentCaller() {
  const cur = _crCurrent();
  if (!cur.name) return null;
  const sig = _crSig(cur.photo);
  let e = _crMatch(cur);
  if (e && (e.photoSig || null) === sig) return e.id;
  const prev = e ? { hasPhoto: e.hasPhoto, photoSig: e.photoSig } : null;
  if (!e) {
    if (callers.length >= CALLERS_MAX) return null;
    e = { id: _crNewId(), name: cur.name, label: cur.label, hasPhoto: false, photoSig: null };
    callers.push(e);
  }
  e.hasPhoto = !!sig; e.photoSig = sig;
  if (!_crPersist()) {
    if (prev) Object.assign(e, prev); else callers.splice(callers.indexOf(e), 1);
    alert(_CR_TXT.storeFull);
    return null;
  }
  _crPhotos.set(e.id, cur.photo || null);
  renderCallerState();
  if (cur.photo) await callAssetPut(_crPhotoKey(e.id), cur.photo);
  else callAssetDelete(_crPhotoKey(e.id));
  return e.id;
}

// Toucher une ligne : nom, sous-titre et photo appliqués au type affiché
let _crApplySeq = 0;
async function applyCaller(id) {
  const e = callers.find((x) => x.id === id);
  if (!e) return false;
  const seq = ++_crApplySeq;
  const photo = await callerPhoto(e);
  if (seq !== _crApplySeq || !callers.includes(e)) return false;
  closeSheet();
  if (callKind === 'discussion') {
    // Discussion : nom et photo du contact ; ouverte, l'écran suit
    _chat.name = e.name;
    _chatAvatar = photo;
    _lsSet(CHAT_AVATAR_KEY, photo);
    _chatChanged();
    if (_chat.open && _chatAvatar) _chatSendAvatar().then(() => { if (_chat.open) _chatSendOpen(); });
  } else {
    const set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v; };
    set('callName', e.name); set('callLabel', e.label);
    _callPhoto = photo;
    const pv = document.getElementById('callPhotoPreview');
    if (pv) pv.style.backgroundImage = photo ? 'url(' + photo + ')' : '';
    _callPhotoSending = photo ? ensureCallAssets(photo, null) : null; // envoyée dès le choix, comme une photo importée
  }
  renderCallerState();
  renderTelStyle();
  return true;
}

function renameCaller(id, name) {
  const e = callers.find((x) => x.id === id);
  const n = _crLine(name);
  if (!e || !n) return false;
  // Nom déjà pris (même sous-titre) : refusé, il n'y aurait plus qu'un appelant
  if (callers.some((x) => x !== e && _crKey(x.name, x.label) === _crKey(n, e.label))) return false;
  const prev = e.name;
  e.name = n;
  if (!_crPersist()) { e.name = prev; alert(_CR_TXT.storeFull); return false; }
  renderCallerState();
  return true;
}
function deleteCaller(id) {
  const i = callers.findIndex((x) => x.id === id);
  if (i < 0) return false;
  if (!confirm(_crTpl(_CR_TXT.confirmDelete, { nom: callers[i].name }))) return false;
  callers.splice(i, 1);
  _crPersist();
  _crPhotos.delete(id);
  callAssetDelete(_crPhotoKey(id));
  renderCallerState();
  return true;
}

// ── Rendu dans l'onglet ──
function renderCallerState() {
  const link = _crTpl(_CR_TXT.link, { n: callers.length });
  for (const id of ['callWhoSaved', 'dcCallersLink']) { const el = document.getElementById(id); if (el) el.textContent = link; }
  const saved = callerIsSaved(), named = !!_crCurrent().name;
  const btn = document.getElementById('callerSaveBtn'), note = document.getElementById('callerSavedNote');
  if (btn) {
    btn.textContent = _CR_TXT.saveBtn;
    btn.style.display = saved ? 'none' : '';
    btn.disabled = !named || (!_crMatch(_crCurrent()) && callers.length >= CALLERS_MAX);
  }
  if (note) { note.textContent = _CR_TXT.savedNote; note.style.display = saved ? '' : 'none'; }
  if (_sheet && _sheet.kind === 'callers') renderSheet();
}

// ── Feuilles (39-screens-ui.js : _sheet, renderSheet, closeSheet) ──
function openCallersSheet() {
  _sheet = { kind: 'callers' };
  renderSheet();
  // Photos lues en arrière-plan, puis la liste se redessine
  Promise.all(callers.filter((e) => e.hasPhoto && !_crPhotos.has(e.id)).map(callerPhoto)).then(() => {
    if (_sheet && _sheet.kind === 'callers') renderSheet();
  });
}
function openCallerMenu(id) {
  if (!callers.some((x) => x.id === id)) return;
  _sheet = { kind: 'callerMenu', id }; renderSheet();
}
function callerMenuRename(id) { if (callers.some((x) => x.id === id)) { _sheet = { kind: 'callerName', id }; renderSheet(true); } }
function callerMenuDelete(id) { deleteCaller(id); openCallersSheet(); }
async function callersSheetAdd() { await saveCurrentCaller(); if (_sheet && _sheet.kind === 'callers') renderSheet(); }
function callerSheetSave(s, value) { renameCaller(s.id, value); openCallersSheet(); }

function _crAvatarHtml(e) {
  const photo = e.hasPhoto ? _crPhotos.get(e.id) : null;
  if (photo) return '<span class="cr-av" style="background-image:url(' + photo + ')"></span>';
  let h = 0;
  for (const c of e.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return '<span class="cr-av" style="background-color:' + _CR_COLORS[h % _CR_COLORS.length] + '">' + escapeHtml(e.name.charAt(0).toUpperCase() || '?') + '</span>';
}
function _crMeta(e) { return (e.label || _CR_TXT.noLabel) + (e.hasPhoto ? _CR_TXT.sep + _CR_TXT.photo : ''); }
// Contenu d'une feuille d'appelants : { title, html, form } ; null : appelant disparu
function callersSheetContent(s) {
  const T = _CR_TXT, esc = escapeHtml;
  const cancel = (fn, label) => '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="' + fn + '">' + esc(label) + '</button></div>';
  if (s.kind === 'callers') {
    const cur = _crCurrent(), on = _crMatch(cur), saved = callerIsSaved();
    const rows = callers.map((e) => '<div class="cr-row' + (on === e ? ' on' : '') + '" data-id="' + e.id + '" onclick="applyCaller(\'' + e.id + '\')">'
      + _crAvatarHtml(e) + '<span class="cr-main"><span class="cr-name">' + esc(e.name) + '</span><span class="cr-meta">' + esc(_crMeta(e)) + '</span></span>'
      + '<button type="button" class="cr-more" aria-label="' + esc(T.more) + '" onclick="event.stopPropagation();openCallerMenu(\'' + e.id + '\')">⋯</button></div>').join('');
    const full = !on && callers.length >= CALLERS_MAX;
    const add = !cur.name ? '' : '<button type="button" class="sr-add" id="crAdd" onclick="callersSheetAdd()"' + (saved || full ? ' disabled' : '') + '>'
      + esc(saved ? _crTpl(T.added, { nom: cur.name }) : full ? _crTpl(T.full, { max: CALLERS_MAX }) : _crTpl(T.add, { nom: cur.name })) + '</button>';
    return {
      title: T.title, form: false,
      html: (rows || '<div class="cr-empty">' + esc(T.empty) + '</div>') + add + '<p class="sr-sheet-note">' + esc(T.note) + '</p>' + cancel('closeSheet()', T.close),
    };
  }
  const e = callers.find((x) => x.id === s.id);
  if (!e) return null;
  if (s.kind === 'callerMenu') {
    const b = (cls, fn, label) => '<button type="button" class="dc-menu-btn' + cls + '" onclick="' + fn + '(\'' + e.id + '\')">' + esc(label) + '</button>';
    return { title: e.name, form: false, html: b('', 'callerMenuRename', T.rename) + b(' danger', 'callerMenuDelete', T.remove) + cancel('openCallersSheet()', T.cancel) };
  }
  return {
    title: T.sheetRename, form: true,
    html: '<form class="sr-form" onsubmit="event.preventDefault();sheetSave()">'
      + '<label class="sr-sublabel" for="srName">' + esc(T.nameLabel) + '</label>'
      + '<input type="text" id="srName" class="text-input sr-input" maxlength="' + _CR_NAME_MAX + '" autocomplete="off" placeholder="' + esc(e.name) + '" value="' + esc(e.name) + '">'
      + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="openCallersSheet()">' + esc(T.cancel) + '</button>'
      + '<button type="submit" class="sr-ok">' + esc(T.ok) + '</button></div></form>',
  };
}
