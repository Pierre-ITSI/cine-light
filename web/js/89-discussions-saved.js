// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ DISCUSSIONS ENREGISTRÉES (onglet Tel, télécommande) ══════════════════════════
// Maquette validée 26c. Deux sous-onglets dans « Discussion » : « Fil en
// cours » (83-discussion.js) et « Enregistrées (n) ». Une discussion
// enregistrée garde son nom, le contact (nom, photo), le comédien, le style
// et tous les messages avec leurs timings (maquette 26d : pause avant,
// écriture, envoi) ; PAS le point de reprise (ni ce qui est posté).
// Migration : une discussion enregistrée avant les timings les reçoit par
// défaut (pause 0 s, le comédien tape, envoi au bouton) : rien ne change.
//   • « + Enregistrer le fil en cours » : demande un nom, ajoute en fin de liste.
//   • Toucher une ligne : la charge dans « Fil en cours » (confirmation si le
//     fil en cours a des modifications non enregistrées). Ouverte sur un
//     écran, la discussion y repart de zéro avec le nouveau fil.
//   • « ⋯ » : renommer, dupliquer, supprimer (avec confirmation).
// Stockage (comme la liste des appels, 82-call-list.js) : textes en
// localStorage, photos dans IndexedDB (callAssetPut / Get / Delete, clé
// « chat-<id>:photo »), à défaut en mémoire le temps de la session. Au plus
// CHAT_SAVED_MAX entrées, toutes revalidées au chargement. Jamais déclenchées
// par la console DMX (aucun canal).
const CHAT_SAVED_KEY = 'setremote-chat-saved-v1';
const CHAT_SAVED_MAX = 100;
const CHAT_SAVED_NAME_MAX = 40;
const _CHSV_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const _CHSV_SIG_RE = /^[0-9a-f]{8}-\d{1,9}$/;
// Textes affichés (maquette 26c), regroupés pour la traduction ({…} : valeurs)
const _CHSV_TXT = {
  tab: 'Enregistrées ({n})',
  meta: '{contact} ‹› {comedien} · {n} · {style}',
  msgs1: '1 message',
  msgsN: '{n} messages',
  save: '+ Enregistrer le fil en cours',
  full: 'Liste pleine ({max} discussions)',
  sheetSave: 'Enregistrer le fil en cours',
  sheetRename: 'Renommer la discussion',
  nameLabel: 'Nom de la discussion',
  nameNote: 'Vide : « {defaut} ».',
  cancel: 'Annuler',
  ok: 'Enregistrer',
  rename: 'Renommer',
  duplicate: 'Dupliquer',
  remove: 'Supprimer',
  copy: '{nom} (copie)',
  confirmLoad: 'Le fil en cours a des modifications non enregistrées. Charger « {nom} » à la place ?',
  confirmDelete: 'Supprimer la discussion « {nom} » ?',
  storeFull: 'Enregistrement impossible : la mémoire de l\'appareil est pleine.',
  untitled: 'Discussion',
  // « + Nouvelle discussion » (maquette 47b)
  newBtn: '+ Nouvelle discussion',
  newAsk: 'Enregistrer « {nom} » avant ?',
  newAskText: 'Le fil en cours a des modifications non enregistrées. La nouvelle discussion part d\'un fil vide (même comédien, même style).',
  newDiscard: 'Ne pas enregistrer',
  newFull: 'Liste pleine ({max} discussions) : enregistrement impossible.',
  liveTitle: 'Impossible pour l\'instant',
  live: 'La discussion est ouverte sur les écrans : fermez-la avant d\'en commencer une nouvelle.',
  okBtn: 'OK',
};

let chatSaved = [];

// Empreinte courte d'une photo (FNV-1a 32 bits + longueur) : comparer sans relire IndexedDB
function _chsvPhotoSig(data) {
  if (!data) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + '-' + data.length;
}
const _chsvLine = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, max) : '');
const _chsvPhotoKey = (id) => 'chat-' + id + ':photo';
const _chsvStyleName = (s) => ({ glass: 'Verre', tonal: 'Tonal', minimal: 'Épuré' })[s] || 'Épuré';

// ── Validation (chargement) ──
function _chsvSanitize(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !_CHSV_ID_RE.test(e.id) || !Array.isArray(e.msgs)) return null;
  const seen = new Set();
  const msgs = e.msgs.filter((x) => x && typeof x.id === 'string' && SRP.CHAT_ID_RE.test(x.id) && !seen.has(x.id) && seen.add(x.id)
    && (x.from === 'contact' || x.from === 'actor') && typeof x.text === 'string' && x.text.trim())
    .slice(0, CHAT_MAX).map((x) => Object.assign({ id: x.id, from: x.from, text: x.text.slice(0, CHAT_TEXT_MAX) }, chatTiming(x, x.from)));
  const photoSig = e.hasPhoto === true && typeof e.photoSig === 'string' && _CHSV_SIG_RE.test(e.photoSig) ? e.photoSig : null;
  return {
    id: e.id,
    name: _chsvLine(e.name, CHAT_SAVED_NAME_MAX) || _CHSV_TXT.untitled,
    contact: _chsvLine(e.contact, 40),
    actor: _chsvLine(e.actor, 40),
    style: _CHAT_STYLE_HINTS[e.style] ? e.style : 'minimal',
    msgs,
    hasPhoto: !!photoSig,
    photoSig,
  };
}
function loadSavedChats() {
  let o = null;
  try { o = JSON.parse(_lsGet(CHAT_SAVED_KEY)); } catch (_) { o = null; }
  const ids = new Set();
  chatSaved = (o && Array.isArray(o.list) ? o.list : []).map(_chsvSanitize)
    .filter((e) => e && !ids.has(e.id) && ids.add(e.id)).slice(0, CHAT_SAVED_MAX);
  if (_chat.savedId && !ids.has(_chat.savedId)) _chat.savedId = null;
}
// false : mémoire pleine (rien n'est changé dans le stockage)
function _chsvPersist() {
  return _lsPut(CHAT_SAVED_KEY, JSON.stringify({ v: 2, list: chatSaved }));
}
const _chsvNewId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── Fil en cours ↔ entrée ──
// Ce qu'une entrée garde du fil (ni le point de reprise ni les messages postés)
function _chsvSnapshot() {
  return {
    contact: _chat.name.slice(0, 40), actor: _chat.actor.slice(0, 40), style: _chat.style,
    msgs: _chat.msgs.filter(_chatValid).slice(0, CHAT_MAX).map((m) => Object.assign(chatMsgCopy(m), { text: m.text.slice(0, CHAT_TEXT_MAX) })),
    hasPhoto: !!_chatAvatar, photoSig: _chsvPhotoSig(_chatAvatar),
  };
}
const _chsvSig = (e) => JSON.stringify([e.contact, e.actor, e.style, e.msgs.map((m) => { const t = chatTiming(m, m.from); return [m.from, m.text, t.pause, t.write, t.auto, t.send]; }), e.photoSig || null]);
// Modifications non enregistrées : différent de l'entrée d'origine ; sans
// entrée, tout fil non vide différent du fil d'exemple
function chatHasUnsavedChanges() {
  const cur = _chsvSig(_chsvSnapshot());
  const e = chatSaved.find((x) => x.id === _chat.savedId);
  if (e) return cur !== _chsvSig(e);
  if (!_chat.msgs.some(_chatValid)) return false;
  const d = _chatDefault();
  return cur !== _chsvSig({ contact: d.name, actor: d.actor, style: d.style, msgs: d.msgs, photoSig: null });
}
function _chsvDefaultName() {
  return _tplChat('{contact} ‹› {comedien}', { contact: chatContactName(), comedien: _chat.actor || 'Comédien' }).slice(0, CHAT_SAVED_NAME_MAX);
}

// « + Enregistrer le fil en cours »
async function saveCurrentChat(name) {
  if (chatSaved.length >= CHAT_SAVED_MAX) return null;
  const e = Object.assign({ id: _chsvNewId(), name: _chsvLine(String(name || '').trim(), CHAT_SAVED_NAME_MAX) || _chsvDefaultName() || _CHSV_TXT.untitled }, _chsvSnapshot());
  chatSaved.push(e);
  if (!_chsvPersist()) { chatSaved.pop(); alert(_CHSV_TXT.storeFull); return null; }
  _chat.savedId = e.id;
  chatSave();
  renderSavedChats();
  if (_chatAvatar) await callAssetPut(_chsvPhotoKey(e.id), _chatAvatar);
  return e.id;
}

// Toucher une ligne : charge l'entrée dans « Fil en cours »
let _chsvLoadSeq = 0;
async function loadSavedChat(id) {
  const e = chatSaved.find((x) => x.id === id);
  if (!e) return false;
  const dirty = chatHasUnsavedChanges();
  // Déjà chargée, sans modification : simple retour au fil (la scène en cours est gardée)
  if (e.id === _chat.savedId && !dirty) { setChatView('thread'); return true; }
  if (dirty && !confirm(_tplChat(_CHSV_TXT.confirmLoad, { nom: e.name }))) return false;
  const seq = ++_chsvLoadSeq;
  const photo = e.hasPhoto ? safeImageData(await callAssetGet(_chsvPhotoKey(e.id))) : null;
  if (seq !== _chsvLoadSeq) return false; // une autre entrée touchée entre-temps
  _chat.name = e.contact; _chat.actor = e.actor; _chat.style = e.style;
  chatAutoStop();
  _chat.msgs = e.msgs.map((m) => chatMsgCopy(m));
  _chat.sent = []; _chat.pend = []; _chat.progress = null; _chat.resumeAt = null;
  _chat.savedId = e.id;
  _chatEditId = null;
  _chatAvatar = photo;
  _lsSet(CHAT_AVATAR_KEY, photo);
  _chatDefsSent.clear();
  chatSave();
  // Discussion ouverte : l'écran repart de zéro avec ce fil (et cette photo)
  if (_chat.open) {
    _chatSyncTexts(undefined, true);
    if (_chatAvatar) _chatSendAvatar().then(() => { if (_chat.open && seq === _chsvLoadSeq) _chatSendOpen(); });
  }
  _chatView = 'thread';
  chatShowForm(callKind === 'discussion');
  if (typeof scrChanged === 'function') scrChanged();
  return true;
}

function renameSavedChat(id, name) {
  const e = chatSaved.find((x) => x.id === id);
  if (!e) return;
  const prev = e.name;
  e.name = _chsvLine(String(name || '').trim(), CHAT_SAVED_NAME_MAX) || prev;
  if (!_chsvPersist()) { e.name = prev; alert(_CHSV_TXT.storeFull); }
  renderSavedChats();
}
// Copie placée juste après l'original (photo comprise)
async function duplicateSavedChat(id) {
  const i = chatSaved.findIndex((x) => x.id === id);
  if (i < 0 || chatSaved.length >= CHAT_SAVED_MAX) return null;
  const src = chatSaved[i];
  const e = Object.assign({}, src, { id: _chsvNewId(), name: _tplChat(_CHSV_TXT.copy, { nom: src.name }).slice(0, CHAT_SAVED_NAME_MAX), msgs: src.msgs.map((m) => chatMsgCopy(m)) });
  const photo = src.hasPhoto ? await callAssetGet(_chsvPhotoKey(src.id)) : null;
  if (photo) await callAssetPut(_chsvPhotoKey(e.id), photo);
  else { e.hasPhoto = false; e.photoSig = null; }
  const j = chatSaved.indexOf(src); // la liste a pu changer pendant la lecture
  if (chatSaved.length >= CHAT_SAVED_MAX) { callAssetDelete(_chsvPhotoKey(e.id)); return null; }
  chatSaved.splice(j < 0 ? chatSaved.length : j + 1, 0, e);
  if (!_chsvPersist()) { chatSaved.splice(chatSaved.indexOf(e), 1); callAssetDelete(_chsvPhotoKey(e.id)); alert(_CHSV_TXT.storeFull); return null; }
  renderSavedChats();
  return e.id;
}
function deleteSavedChat(id) {
  const i = chatSaved.findIndex((x) => x.id === id);
  if (i < 0) return false;
  if (!confirm(_tplChat(_CHSV_TXT.confirmDelete, { nom: chatSaved[i].name }))) return false;
  chatSaved.splice(i, 1);
  _chsvPersist();
  callAssetDelete(_chsvPhotoKey(id));
  if (_chat.savedId === id) { _chat.savedId = null; chatSave(); }
  renderSavedChats();
  return true;
}

// ── Rendu ──
function _chsvMeta(e) {
  const n = e.msgs.length;
  return _tplChat(_CHSV_TXT.meta, {
    contact: e.contact || 'Contact', comedien: e.actor || 'Comédien',
    n: n === 1 ? _CHSV_TXT.msgs1 : _tplChat(_CHSV_TXT.msgsN, { n }), style: _chsvStyleName(e.style),
  });
}
function renderSavedChats() {
  const tab = document.getElementById('dcTab-saved');
  if (tab) tab.textContent = _tplChat(_CHSV_TXT.tab, { n: chatSaved.length });
  const nb = document.getElementById('dcNewBtn');
  if (nb) nb.textContent = _CHSV_TXT.newBtn;
  const rows = document.getElementById('dcSavedRows');
  if (!rows) return;
  rows.textContent = '';
  for (const e of chatSaved) {
    const row = document.createElement('div');
    row.className = 'dc-saved-row' + (e.id === _chat.savedId ? ' selected' : '');
    row.dataset.id = e.id;
    row.onclick = () => loadSavedChat(e.id);
    const main = document.createElement('span'); main.className = 'dc-saved-main';
    const nm = document.createElement('span'); nm.className = 'dc-saved-name'; nm.textContent = e.name;
    const meta = document.createElement('span'); meta.className = 'dc-saved-meta'; meta.textContent = _chsvMeta(e);
    main.append(nm, meta);
    const more = document.createElement('button'); more.type = 'button'; more.className = 'dc-saved-more'; more.innerHTML = icon('ellipsis', 'ic-lg');
    more.setAttribute('aria-label', _CHSV_TXT.rename + ', ' + _CHSV_TXT.duplicate.toLowerCase() + ', ' + _CHSV_TXT.remove.toLowerCase());
    more.onclick = (ev) => { ev.stopPropagation(); openSavedChatMenu(e.id); };
    row.append(main, more);
    rows.appendChild(row);
  }
  const empty = document.getElementById('dcSavedEmpty');
  if (empty) empty.style.display = chatSaved.length ? 'none' : '';
  const hint = document.getElementById('dcSavedHint');
  if (hint) hint.style.display = chatSaved.length ? '' : 'none';
  const btn = document.getElementById('dcSaveBtn');
  if (btn) {
    const full = chatSaved.length >= CHAT_SAVED_MAX;
    btn.disabled = full;
    btn.textContent = full ? _tplChat(_CHSV_TXT.full, { max: CHAT_SAVED_MAX }) : _CHSV_TXT.save;
  }
}

// ── Feuilles (39-screens-ui.js : _sheet, renderSheet, closeSheet) ──
function openSaveChatSheet() {
  if (licLocked('tel')) return; // aperçu sans licence (77-licence-ui.js)
  if (chatSaved.length >= CHAT_SAVED_MAX) return;
  _sheet = { kind: 'chatName', id: null }; renderSheet(true);
}
function openSavedChatMenu(id) {
  if (!chatSaved.some((x) => x.id === id)) return;
  _sheet = { kind: 'chatMenu', id }; renderSheet();
}
function openRenameSavedChat(id) {
  if (!chatSaved.some((x) => x.id === id)) return;
  _sheet = { kind: 'chatName', id }; renderSheet(true);
}
// Contenu d'une feuille de discussion : { title, html, form } ; null : entrée disparue
function chatSheetContent(s) {
  if (s.kind === 'chatNew') {
    const note = (t) => '<p class="sr-sheet-note prj-sheet-text">' + escapeHtml(t) + '</p>';
    if (s.live) {
      return { title: _CHSV_TXT.liveTitle, form: false, html: note(_CHSV_TXT.live) + '<div class="sr-actions"><button type="button" class="sr-ok" onclick="closeSheet()">' + escapeHtml(_CHSV_TXT.okBtn) + '</button></div>' };
    }
    return {
      title: _tplChat(_CHSV_TXT.newAsk, { nom: s.name }), form: false,
      html: note(_CHSV_TXT.newAskText)
        + (s.msg ? '<p class="sr-sheet-note prj-sheet-err" role="alert">' + escapeHtml(s.msg) + '</p>' : '')
        + '<button type="button" class="dc-menu-btn danger" id="chatNewDiscard" onclick="chatNewAnswer(\'discard\')">' + escapeHtml(_CHSV_TXT.newDiscard) + '</button>'
        + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">' + escapeHtml(_CHSV_TXT.cancel) + '</button>'
        + '<button type="button" class="sr-ok" id="chatNewSave" onclick="chatNewAnswer(\'save\')">' + escapeHtml(_CHSV_TXT.ok) + '</button></div>',
    };
  }
  const e = s.id ? chatSaved.find((x) => x.id === s.id) : null;
  if (s.id && !e) return null;
  if (s.kind === 'chatMenu') {
    const b = (cls, fn, label) => '<button type="button" class="dc-menu-btn' + cls + '" onclick="' + fn + '(\'' + e.id + '\')">' + escapeHtml(label) + '</button>';
    return {
      title: e.name, form: false,
      html: b('', 'chatMenuRename', _CHSV_TXT.rename) + (chatSaved.length < CHAT_SAVED_MAX ? b('', 'chatMenuDuplicate', _CHSV_TXT.duplicate) : '')
        + b(' danger', 'chatMenuDelete', _CHSV_TXT.remove)
        + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">' + escapeHtml(_CHSV_TXT.cancel) + '</button></div>',
    };
  }
  const def = _chsvDefaultName() || _CHSV_TXT.untitled;
  return {
    title: e ? _CHSV_TXT.sheetRename : _CHSV_TXT.sheetSave, form: true,
    html: '<form class="sr-form" onsubmit="event.preventDefault();sheetSave()">'
      + '<label class="sr-sublabel" for="srName">' + escapeHtml(_CHSV_TXT.nameLabel) + '</label>'
      + '<input type="text" id="srName" class="text-input sr-input" maxlength="' + CHAT_SAVED_NAME_MAX + '" autocomplete="off" placeholder="' + escapeHtml(e ? e.name : def) + '" value="' + escapeHtml(e ? e.name : '') + '">'
      + (e ? '' : '<p class="sr-sheet-note">' + escapeHtml(_tplChat(_CHSV_TXT.nameNote, { defaut: def })) + '</p>')
      + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">' + escapeHtml(_CHSV_TXT.cancel) + '</button>'
      + '<button type="submit" class="sr-ok">' + escapeHtml(_CHSV_TXT.ok) + '</button></div></form>',
  };
}
function chatSheetSave(s, value) {
  closeSheet();
  if (s.id) renameSavedChat(s.id, value);
  else saveCurrentChat(value);
}
function chatMenuRename(id) { openRenameSavedChat(id); }
function chatMenuDuplicate(id) { closeSheet(); duplicateSavedChat(id); }
function chatMenuDelete(id) { closeSheet(); deleteSavedChat(id); }

// ── Nouvelle discussion (maquette 47b) : bouton « + NOUVELLE DISCUSSION » sous les sous-onglets ──
// Sans modification en cours : aussitôt. Sinon feuille « Enregistrer « … » avant ? » :
// Enregistrer (nouvelle entrée, nom par défaut) / Ne pas enregistrer / Annuler.
// Discussion ouverte sur les écrans : refus (feuille).
async function chatNewAsk() {
  if (licLocked('tel')) return; // aperçu sans licence (77-licence-ui.js)
  const r = await chatNew();
  if (r.ok) return;
  if (r.code === 'dirty') { _sheet = { kind: 'chatNew', name: r.name }; renderSheet(); } else if (r.code === 'live') { _sheet = { kind: 'chatNew', live: true }; renderSheet(); }
}
async function chatNewAnswer(choice) {
  const s = _sheet;
  if (!s || s.kind !== 'chatNew' || s.live) return;
  const r = await chatNew(choice === 'save' ? { save: '' } : { discard: true });
  if (_sheet !== s) return;
  if (r.ok) { closeSheet(); return; }
  if (r.code === 'live') { s.live = true; renderSheet(); return; }
  s.msg = r.code === 'full' ? _tplChat(_CHSV_TXT.newFull, { max: CHAT_SAVED_MAX }) : _CHSV_TXT.storeFull;
  renderSheet();
}
// Moteur :
// Fil vierge (aucun message, contact sans nom ni photo ; comédien et style
// gardés), sans toucher aux discussions enregistrées. Modifications non
// enregistrées (chatHasUnsavedChanges) : refus { ok: false, code: 'dirty', name }
// tant que l'appelant n'a pas choisi opts.save (nom ; enregistrée d'abord comme
// NOUVELLE entrée) ou opts.discard. Le nouveau fil n'est lié à aucune entrée
// (savedId null) : l'enregistrer crée une nouvelle entrée. Discussion ouverte
// sur les écrans : refus 'live' (la fermer d'abord). Aperçu sans licence : 'locked'.
async function chatNew(opts = {}) {
  if (licLocked('tel')) return { ok: false, code: 'locked' };
  if (_chat.open) return { ok: false, code: 'live' };
  if (chatHasUnsavedChanges()) {
    if (typeof opts.save === 'string') {
      if (chatSaved.length >= CHAT_SAVED_MAX) return { ok: false, code: 'full' };
      if (!(await saveCurrentChat(opts.save))) return { ok: false, code: 'storage-full' };
    } else if (opts.discard !== true) return { ok: false, code: 'dirty', name: _chsvDefaultName() };
  }
  ++_chsvLoadSeq; // chargement d'une entrée encore en cours : abandonné
  chatAutoStop();
  _chat = Object.assign(_chatDefault(), { name: '', actor: _chat.actor, style: _chat.style, msgs: [] });
  _chatEditId = null; _chatTimingId = null;
  _chatAvatar = null;
  _lsSet(CHAT_AVATAR_KEY, null);
  _chatDefsSent.clear();
  chatSave();
  _chatView = 'thread';
  chatShowForm(callKind === 'discussion');
  if (typeof renderCallerState === 'function') renderCallerState();
  return { ok: true };
}
