// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ DISCUSSION FICTIVE (onglet Tel) ══════════════════════════
// Maquettes validées 26 (télécommande) et 27 (écran). La télécommande prépare
// un FIL ordonné de messages des deux côtés : le contact (bulles reçues) et le
// comédien (bulles envoyées). Ajout, modification, réordonnancement (glisser),
// suppression.
//   • Messages du contact : envoyés d'ici (« Envoyer n° X »), avec en option
//     l'indicateur « … écrit » 2 s avant ; « Écrire… » envoie un message
//     improvisé (inséré dans le fil).
//   • Messages du comédien : PRÉPARÉS. Sur l'écran, chaque touche du vrai
//     clavier de l'appareil (champ caché ; sur mobile, le clavier du système)
//     fait apparaître la lettre suivante du texte prévu, l'effacement en retire
//     une ; « Envoyer » n'est actif qu'une fois le texte complet. L'envoi poste
//     la bulle et fait avancer le fil. Les touches tapées ne sont ni gardées
//     ni envoyées : seule la progression part (chat:progress, ≤ 4 par seconde).
//   • Bulles : trois styles neutres (Verre / Tonal / Épuré), aucune marque.
//   • Ciblée comme les autres commandes (cible au moment de l'ouverture),
//     sur toutes les liaisons (petits messages, Bluetooth compris ; l'avatar,
//     en fragments, attend Internet ou le Wi-Fi local). Jamais déclenchée par
//     la console DMX.
//   • Reprise : la télécommande garde le fil (localStorage) et le renvoie à
//     chaque resynchronisation d'un écran : un écran rechargé retrouve la
//     discussion où elle en était (messages postés, lettres déjà tapées).
//   • Revenir en arrière (maquette validée 26b) : « ↶ » retire le DERNIER
//     message affiché sur l'écran et le remet en attente (un message du
//     comédien se retape lettre à lettre) ; un message improvisé
//     (« Écrire… ») disparaît du fil. « Reprendre ici » (toucher un message) :
//     tout ce qui le précède s'affiche d'un coup comme historique (ni « … écrit »,
//     ni animation), la scène reprend à ce message ; repère orange dans le fil.
//     « Repartir de zéro » : plus rien d'affiché.
//   • Discussions enregistrées (maquette validée 26c) : 89-discussions-saved.js.
// Protocole (packages/protocol/schema.js) : chat:msg (texte d'un message),
// chat:open (contact, style, ordre, messages postés ; history : reprise),
// chat:rewind (« ↶ »), chat:post, chat:close ; retour chat:progress,
// chat:sent. Textes affichés par textContent.
const CHAT_LS_KEY = 'setremote-chat-v1';
const CHAT_AVATAR_KEY = 'setremote-chat-avatar-v1';
const CHAT_MAX = 40, CHAT_TEXT_MAX = 300, CHAT_TYPING_MS = 2000, CHAT_PROGRESS_MS = 250;
const _CHAT_STYLE_HINTS = {
  glass: 'Bulles translucides sur fond sombre.',
  tonal: 'Bulles tonales, surfaces douces.',
  minimal: 'Fond clair, bulles sobres et contrastées.',
};
const _tplChat = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));
// Textes affichés ajoutés avec la maquette 26b, regroupés pour la traduction ({…} : valeurs)
const _CHAT_TXT = {
  resumeBtn: 'Reprendre ici',
  resume1: 'Reprise ici · 1 affiché comme historique',
  resume2: 'Reprise ici · 1 et 2 affichés comme historique',
  resumeN: 'Reprise ici · 1 à {n} affichés comme historique',
};

// — Télécommande —
let _chatSeq = 0;
const _chatNewId = () => 'm' + Date.now().toString(36).slice(-5) + (++_chatSeq).toString(36);
function _chatDefault() {
  const m = (from, text, i) => ({ id: 'd' + i, from, text });
  return {
    name: 'Maman', actor: 'Julie', style: 'minimal', typing: false,
    msgs: [
      m('contact', 'Tu es où ?', 1), m('contact', 'Ton père t\'attend depuis une heure', 2),
      m('actor', 'je suis chez Léa, j\'arrive', 3), m('contact', 'Je t\'ai vue avec lui. On en parlera ce soir.', 4),
      m('actor', 'pardon maman', 5),
    ],
    sent: [], open: false, screens: null, progress: null,
    resumeAt: null,  // « Reprendre ici » : message où la scène a repris (repère dans le fil)
    savedId: null,   // discussion enregistrée chargée ou enregistrée en dernier (89-discussions-saved.js)
  };
}
let _chat = _chatDefault();
let _chatAvatar = null;
let _chatEditId = null;
const _chatOk = (id) => typeof id === 'string' && SRP.CHAT_ID_RE.test(id);

function chatLoad() {
  let o = null;
  try { o = JSON.parse(_lsGet(CHAT_LS_KEY)); } catch (_) { o = null; }
  if (o && typeof o === 'object' && Array.isArray(o.msgs)) {
    const d = _chatDefault();
    const seen = new Set();
    const msgs = o.msgs.filter((x) => x && _chatOk(x.id) && !seen.has(x.id) && seen.add(x.id) && (x.from === 'contact' || x.from === 'actor') && typeof x.text === 'string')
      .slice(0, CHAT_MAX).map((x) => Object.assign({ id: x.id, from: x.from, text: x.text.slice(0, CHAT_TEXT_MAX) }, x.impro === true ? { impro: true } : {}));
    const ids = new Set(msgs.map((x) => x.id));
    _chat = {
      name: typeof o.name === 'string' ? o.name.slice(0, 40) : d.name,
      actor: typeof o.actor === 'string' ? o.actor.slice(0, 40) : d.actor,
      style: _CHAT_STYLE_HINTS[o.style] ? o.style : d.style,
      typing: !!o.typing,
      msgs,
      sent: Array.isArray(o.sent) ? [...new Set(o.sent.filter((id) => ids.has(id)))] : [],
      open: !!o.open,
      screens: Array.isArray(o.screens) ? o.screens.filter((s) => typeof s === 'string' && SRP.SCREEN_ID_RE.test(s)).slice(0, 64) : null,
      progress: null,
      resumeAt: typeof o.resumeAt === 'string' && ids.has(o.resumeAt) ? o.resumeAt : null,
      savedId: typeof o.savedId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o.savedId) ? o.savedId : null,
    };
  }
  const a = _lsGet(CHAT_AVATAR_KEY);
  _chatAvatar = safeImageData(a);
}
function chatSave() {
  const c = _chat;
  _lsSet(CHAT_LS_KEY, JSON.stringify({ v: 1, name: c.name, actor: c.actor, style: c.style, typing: c.typing, msgs: c.msgs, sent: c.sent, open: c.open, screens: c.screens, resumeAt: c.resumeAt, savedId: c.savedId }));
}
function chatStyleNow() { return _chat.style; }
function chatSetStyle(s) { _chat.style = _CHAT_STYLE_HINTS[s] ? s : 'minimal'; _chatChanged(); }
function chatContactName() { return _chat.name || 'Contact'; }
function chatIsOpenOn(id) { return _chat.open && (!_chat.screens || _chat.screens.includes(id)); }

const _chatSent = (m) => _chat.sent.includes(m.id);
const _chatLen = (t) => Array.from(String(t || '')).length;
const _chatValid = (m) => String(m.text || '').trim().length > 0;
// Message du comédien en cours : le premier non posté, une fois tous ceux d'avant postés
function chatCurrentActor() {
  const m = _chat.msgs.find((x) => _chatValid(x) && !_chatSent(x));
  return m && m.from === 'actor' ? m : null;
}
// Prochain message du contact à envoyer (dans l'ordre du fil)
function chatNextContact() { return _chat.msgs.find((m) => m.from === 'contact' && _chatValid(m) && !_chatSent(m)) || null; }

// Adresse de la discussion : écrans où elle a été ouverte (null : sans adresse)
function _chatTarget(only) {
  const ids = only || _chat.screens;
  return ids && ids.length ? { target: { screens: ids.slice() } } : {};
}
// Renvoi complet (textes puis état) : synchrone, dans l'ordre des envois
function _chatSyncTexts(only, history) {
  const t = _chatTarget(only);
  const msgs = _chat.msgs.filter(_chatValid);
  for (const m of msgs) _chatDefsSent.set(m.id, m.from + '|' + m.text);
  for (const m of msgs) sendMsg(Object.assign({ type: 'chat:msg', id: m.id, from: m.from, text: m.text.slice(0, CHAT_TEXT_MAX) }, t));
  _chatSendOpen(only, history);
}
// history : reprise (« Reprendre ici », « Repartir de zéro », discussion
// chargée) — les messages postés, début exact du fil, s'affichent d'un coup
// et l'écran oublie sa frappe en cours
function _chatSendOpen(only, history) {
  const ids = _chat.msgs.filter(_chatValid).map((m) => m.id);
  const cur = chatCurrentActor();
  const p = _chat.progress;
  sendMsg(Object.assign({
    type: 'chat:open', name: _chat.name.slice(0, 40), style: _chat.style, hasAvatar: !!_chatAvatar,
    ids, sent: _chat.sent.filter((id) => ids.includes(id)),
    typed: !history && cur && p && p.id === cur.id ? Math.min(p.typed, _chatLen(cur.text)) : 0,
  }, history ? { history: true } : {}, _chatTarget(only)));
}
function _chatSendAvatar(only) {
  if (!_chatAvatar || linkBleOnly()) return Promise.resolve();
  const ids = only || _chat.screens;
  return ensureSlotImage('__chatavatar', _chatAvatar, ids && ids.length ? ids : undefined);
}
// Ouvre la discussion sur la cible courante (chip « Cible »)
function openChatOnTarget(history) {
  const ids = scrTargetIds();
  _chat.screens = ids.length ? ids : null;
  _chat.open = true;
  _chatSyncTexts(undefined, history === true);
  _chatSendAvatar().then(() => { if (_chat.open && _chatAvatar) _chatSendOpen(); });
  chatSave();
  renderChatPanel();
  if (typeof scrChanged === 'function') scrChanged();
}
function closeChat() {
  if (_chat.open) sendMsg(Object.assign({ type: 'chat:close' }, _chatTarget()));
  _chat.open = false;
  _chat.progress = null;
  chatSave();
  renderChatPanel();
  if (typeof scrChanged === 'function') scrChanged();
}
// « Repartir de zéro » : plus rien d'affiché, frappe oubliée
function restartChat() {
  _chat.sent = [];
  _chat.progress = null;
  _chat.resumeAt = null;
  if (_chat.open) { _chatFlushTexts(); _chatSendOpen(undefined, true); }
  chatSave();
  renderChatPanel();
}
// « ↶ » : retire le dernier message affiché sur l'écran, remis en attente
// (un message du comédien se retape lettre à lettre) ; un message improvisé
// (« Écrire… ») disparaît du fil. Peut se répéter.
function rewindChat() {
  const id = _chat.sent[_chat.sent.length - 1];
  if (!id) return;
  if (_chat.open) _chatFlushTexts();
  _chat.sent.pop();
  const i = _chat.msgs.findIndex((x) => x.id === id);
  const drop = i >= 0 && _chat.msgs[i].impro === true;
  if (drop) {
    _chat.msgs.splice(i, 1);
    _chatDefsSent.delete(id);
    if (_chatEditId === id) _chatEditId = null;
  }
  // Frappe en cours : gardée seulement si le message du comédien reste le même
  const cur = chatCurrentActor();
  if (_chat.progress && (!cur || cur.id !== _chat.progress.id)) _chat.progress = null;
  // Retour dans l'historique d'une reprise : le repère n'a plus lieu d'être
  if (!_chatResumeInfo()) _chat.resumeAt = null;
  if (_chat.open) sendMsg(Object.assign({ type: 'chat:rewind', id }, drop ? { drop: true } : {}, _chatTarget()));
  chatSave();
  renderChatPanel();
}
// « Reprendre ici » : les messages du fil avant celui-ci s'affichent d'un coup
// comme historique (sans « … écrit », sans animation), la scène reprend à ce
// message. Ouvre la discussion sur la cible si elle est fermée.
function resumeChatAt(id) {
  const i = _chat.msgs.findIndex((x) => x.id === id);
  if (i < 0 || !_chatValid(_chat.msgs[i])) return;
  _chat.sent = _chat.msgs.slice(0, i).filter(_chatValid).map((m) => m.id);
  _chat.progress = null;
  _chat.resumeAt = i > 0 ? id : null; // au n° 1 : comme « Repartir de zéro »
  _chatEditId = null;
  if (!_chat.open) openChatOnTarget(true);
  else { _chatFlushTexts(); _chatSendOpen(undefined, true); }
  chatSave();
  renderChatPanel();
}
// Point de reprise encore valable : son rang (historique toujours affiché)
function _chatResumeInfo() {
  const i = _chat.resumeAt ? _chat.msgs.findIndex((x) => x.id === _chat.resumeAt) : -1;
  if (i <= 0) return null;
  const hist = _chat.msgs.slice(0, i).filter(_chatValid);
  return hist.length && hist.every(_chatSent) ? { id: _chat.resumeAt, n: i } : null;
}
function _chatResumeLabel(n) {
  return n === 1 ? _CHAT_TXT.resume1 : n === 2 ? _CHAT_TXT.resume2 : _tplChat(_CHAT_TXT.resumeN, { n });
}
// « Envoyer n° X (contact) » : ouvre la discussion si besoin, puis poste
function sendNextChatMessage() {
  const m = chatNextContact();
  if (!m) return;
  if (!_chat.open) openChatOnTarget();
  else _chatFlushEdits();
  _chat.sent.push(m.id);
  sendMsg(Object.assign({ type: 'chat:post', id: m.id, typing: !!_chat.typing }, _chatTarget()));
  chatSave();
  renderChatPanel();
}
function toggleChatWrite() {
  const box = document.getElementById('dcWriteBox');
  if (!box) return;
  const on = box.style.display === 'none';
  box.style.display = on ? 'flex' : 'none';
  if (on) { const t = document.getElementById('dcWriteText'); if (t) t.focus(); }
}
// « Écrire… » : message improvisé du contact, inséré avant le premier message non posté
function sendImprovisedChat() {
  const ta = document.getElementById('dcWriteText');
  const text = ta ? ta.value.trim().slice(0, CHAT_TEXT_MAX) : '';
  if (!text || _chat.msgs.length >= CHAT_MAX) return;
  const m = { id: _chatNewId(), from: 'contact', text, impro: true }; // improvisé : « ↶ » le retire du fil
  const i = _chat.msgs.findIndex((x) => !_chatSent(x));
  _chat.msgs.splice(i < 0 ? _chat.msgs.length : i, 0, m);
  if (!_chat.open) openChatOnTarget();
  else _chatSyncTexts(); // le nouveau message et l'ordre, avant de le poster
  _chatDefsSent.set(m.id, m.from + '|' + m.text);
  _chat.sent.push(m.id);
  sendMsg(Object.assign({ type: 'chat:post', id: m.id, typing: !!_chat.typing }, _chatTarget()));
  if (ta) ta.value = '';
  toggleChatWrite();
  chatSave();
  renderChatPanel();
}
function onChatTypingToggle() {
  const el = document.getElementById('dcTypingToggle');
  _chat.typing = !!(el && el.checked);
  chatSave();
}
function onChatNames() {
  _chat.name = (document.getElementById('dcName').value || '').slice(0, 40);
  _chat.actor = (document.getElementById('dcActor').value || '').slice(0, 40);
  _chatChanged(true);
}
// Avatar du contact : carré 160 px, JPEG ; gardé sur la télécommande et en cache sur l'écran
function onChatAvatar(files) {
  const f = files && files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    const side = Math.min(img.width, img.height);
    if (!side) return;
    const c = document.createElement('canvas'); c.width = c.height = 160;
    c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 160, 160);
    const data = safeImageData(c.toDataURL('image/jpeg', 0.8));
    if (!data) return;
    _chatAvatar = data;
    _lsSet(CHAT_AVATAR_KEY, data);
    renderChatPanel();
    if (_chat.open) _chatSendAvatar().then(() => { if (_chat.open) _chatSendOpen(); });
  };
  img.onerror = () => URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(f);
}

// ── Modifications du fil : renvoyées à l'écran (seulement ce qui a changé) ──
const _chatDefsSent = new Map(); // id → « from|texte » déjà envoyé à l'écran
let _chatEditTimer = null;
function _chatChanged(soft) {
  chatSave();
  if (!soft) renderChatPanel(); else _chatRenderHead();
  if (!_chat.open) return;
  if (_chatEditTimer) clearTimeout(_chatEditTimer);
  _chatEditTimer = setTimeout(_chatFlushEdits, 400);
}
function _chatFlushEdits() {
  if (_chatFlushTexts()) _chatSendOpen();
}
// Textes modifiés seulement (false : discussion fermée)
function _chatFlushTexts() {
  if (_chatEditTimer) { clearTimeout(_chatEditTimer); _chatEditTimer = null; }
  if (!_chat.open) return false;
  const t = _chatTarget();
  for (const m of _chat.msgs.filter(_chatValid)) {
    const def = m.from + '|' + m.text;
    if (_chatDefsSent.get(m.id) === def) continue;
    _chatDefsSent.set(m.id, def);
    sendMsg(Object.assign({ type: 'chat:msg', id: m.id, from: m.from, text: m.text.slice(0, CHAT_TEXT_MAX) }, t));
  }
  return true;
}
function addChatMessage() {
  if (_chat.msgs.length >= CHAT_MAX) return;
  const last = _chat.msgs[_chat.msgs.length - 1];
  const m = { id: _chatNewId(), from: last && last.from === 'contact' ? 'actor' : 'contact', text: '' };
  _chat.msgs.push(m);
  _chatEditId = m.id;
  _chatChanged();
  const ta = document.querySelector('#dcRows .dc-edit textarea');
  if (ta) ta.focus();
}
function editChatMessage(id) {
  if (_dcSuppressClick) return;
  _chatEditId = _chatEditId === id ? null : id;
  renderChatPanel();
}
function setChatMessageSide(id, from) {
  const m = _chat.msgs.find((x) => x.id === id);
  if (!m) return;
  m.from = from === 'actor' ? 'actor' : 'contact';
  _chatChanged();
}
function onChatMessageText(id, el) {
  const m = _chat.msgs.find((x) => x.id === id);
  if (!m) return;
  m.text = String(el.value || '').slice(0, CHAT_TEXT_MAX);
  _chatChanged(true);
}
function closeChatEditor() {
  const m = _chat.msgs.find((x) => x.id === _chatEditId);
  _chatEditId = null;
  if (m && !_chatValid(m)) { deleteChatMessage(m.id); return; }
  renderChatPanel();
}
function deleteChatMessage(id) {
  const i = _chat.msgs.findIndex((x) => x.id === id);
  if (i < 0) return;
  _chat.msgs.splice(i, 1);
  _chat.sent = _chat.sent.filter((x) => x !== id);
  _chatDefsSent.delete(id);
  if (_chatEditId === id) _chatEditId = null;
  _chatChanged();
}

// ── Retours de l'écran ──
function _chatFromMine() { const s = _rxFrom; return !s || !_chat.screens || _chat.screens.includes(s); }
function remoteOnChatProgress(m) {
  if (!_chat.open || !_chatFromMine()) return;
  const cur = chatCurrentActor();
  if (!cur || cur.id !== m.id) return;
  _chat.progress = { id: m.id, typed: m.typed, total: m.total };
  _chatRenderProgress();
}
function remoteOnChatSent(m) {
  if (!_chat.open || !_chatFromMine()) return;
  const msg = _chat.msgs.find((x) => x.id === m.id);
  if (!msg || msg.from !== 'actor' || _chatSent(msg)) return;
  _chat.sent.push(msg.id);
  _chat.progress = null;
  chatSave();
  renderChatPanel();
  // Les autres écrans de la discussion suivent
  const others = (_chat.screens || []).filter((s) => s !== _rxFrom);
  if (others.length) _chatSendOpen(others);
}
// Resynchronisation (24-resync.js) : écrans de la discussion revenus
function chatOnScreensResync(ids) {
  if (!_chat.open) return;
  const l = _chat.screens ? ids.filter((s) => _chat.screens.includes(s)) : ids;
  if (!l.length) return;
  _chatSyncTexts(l);
  if (_chatAvatar) _chatSendAvatar(l).then(() => { if (_chat.open) _chatSendOpen(l); });
}

// ── Rendu (télécommande) ──
// Sous-onglets (maquette 26c) : « Fil en cours » | « Enregistrées (n) »
let _chatView = 'thread';
function chatShowForm(on) {
  const saved = on && _chatView === 'saved';
  const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none'; };
  for (const id of ['dcContactPanel', 'dcThreadPanel', 'dcActorPanel', 'dcSendPanel']) show(id, on && !saved);
  show('dcTabs', on);
  show('dcSavedPanel', saved);
  // Le style appartient au fil en cours : masqué sur la liste
  if (on) show('callStyleRow', !saved);
  for (const v of ['thread', 'saved']) {
    const b = document.getElementById('dcTab-' + v);
    if (b) b.classList.toggle('active', _chatView === v);
  }
  if (on) { renderChatPanel(); renderSavedChats(); }
}
function setChatView(v) {
  _chatView = v === 'saved' ? 'saved' : 'thread';
  chatShowForm(callKind === 'discussion');
}
function _chatScreensLabel() {
  const ids = _chat.screens || [];
  if (ids.length === 1) return _tplChat('Discussion ouverte sur « {ecran} »', { ecran: scrName(ids[0]) });
  if (ids.length > 1) return _tplChat('Discussion ouverte sur {n} écrans', { n: ids.length });
  return 'Discussion ouverte sur l\'écran';
}
function _chatRenderHead() {
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  const av = document.getElementById('dcAvatar');
  if (av) {
    av.style.backgroundImage = _chatAvatar ? 'url(' + _chatAvatar + ')' : '';
    av.textContent = _chatAvatar ? '' : (_chat.name.trim().charAt(0).toUpperCase() || '?');
  }
  const st = document.getElementById('dcState');
  if (st) { st.textContent = _chat.open ? _chatScreensLabel() : 'Discussion fermée'; st.classList.toggle('on', _chat.open); }
  set('dcPair', _tplChat('{contact} ‹› {comedien}', { contact: chatContactName(), comedien: _chat.actor || 'Comédien' }));
  set('dcActorLabel', _tplChat('Messages de {comedien}', { comedien: _chat.actor || 'Comédien' }));
  set('dcTypingLabel', _tplChat('Indicateur « … écrit » 2 s avant chaque message de {contact}', { contact: chatContactName() }));
  const wt = document.getElementById('dcWriteText');
  if (wt) wt.placeholder = _tplChat('Message improvisé de {contact}', { contact: chatContactName() });
  const go = document.getElementById('dcGo'), next = chatNextContact();
  if (go) {
    const n = next ? _chat.msgs.indexOf(next) + 1 : 0;
    go.textContent = next ? _tplChat('Envoyer n°{n} ({contact})', { n, contact: chatContactName() }) : _tplChat('Plus de message de {contact}', { contact: chatContactName() });
    go.disabled = !next;
  }
  // Noms : la saisie en cours n'est pas réécrite
  for (const [id, v] of [['dcName', _chat.name], ['dcActor', _chat.actor]]) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el && el.value !== v) el.value = v;
  }
  const tg = document.getElementById('dcTypingToggle');
  if (tg) tg.checked = !!_chat.typing;
  const cb = document.getElementById('dcCloseBtn');
  if (cb) cb.disabled = !_chat.open;
  const bk = document.getElementById('dcBackBtn');
  if (bk) bk.disabled = !_chat.sent.length;
}
function _chatProgressText(cur) {
  const p = _chat.progress && _chat.progress.id === cur.id ? _chat.progress : null;
  const total = _chatLen(cur.text), typed = p ? Math.min(p.typed, total) : 0;
  if (!_chat.open) return _tplChat('À taper sur l\'écran · {total} lettres', { total });
  return _tplChat(typed >= total ? 'Prêt à envoyer sur l\'écran · {n} / {total} lettres' : 'En frappe sur l\'écran · {n} / {total} lettres', { n: typed, total });
}
function _chatRenderProgress() {
  const el = document.getElementById('dcProgress'), cur = chatCurrentActor();
  if (el && cur) el.textContent = _chatProgressText(cur);
}
function renderChatPanel() {
  _chatRenderHead();
  _syncCallStyleChips();
  const rows = document.getElementById('dcRows');
  if (!rows) return;
  const cur = chatCurrentActor();
  const resume = _chatResumeInfo();
  rows.textContent = '';
  _chat.msgs.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'dc-row' + (_chatSent(m) ? ' sent' : '') + (cur && cur.id === m.id ? ' cur' : '') + (m.from === 'actor' ? ' actor' : '') + (_chatEditId === m.id ? ' editing' : '');
    row.dataset.id = m.id;
    row.onclick = () => editChatMessage(m.id);
    const num = document.createElement('span'); num.className = 'dc-num'; num.textContent = String(i + 1);
    const who = document.createElement('span'); who.className = 'dc-who';
    who.textContent = _tplChat('{nom} ›', { nom: m.from === 'actor' ? (_chat.actor || 'Comédien') : chatContactName() });
    const txt = document.createElement('span'); txt.className = 'dc-text';
    txt.textContent = m.text || '…';
    row.append(num, who, txt);
    rows.appendChild(row);
    if (cur && cur.id === m.id) {
      const pr = document.createElement('div'); pr.className = 'dc-progress'; pr.id = 'dcProgress';
      pr.textContent = _chatProgressText(cur);
      rows.appendChild(pr);
    }
    // Repère orange du point de reprise (maquette 26b)
    if (resume && resume.id === m.id) {
      const mk = document.createElement('div'); mk.className = 'dc-resume'; mk.id = 'dcResume';
      const line = () => { const l = document.createElement('span'); l.className = 'dc-resume-line'; return l; };
      const t = document.createElement('span'); t.textContent = _chatResumeLabel(resume.n);
      mk.append(line(), t, line());
      rows.appendChild(mk);
    }
    if (_chatEditId === m.id) rows.appendChild(_chatEditor(m));
  });
  const add = document.getElementById('dcAdd');
  if (add) add.disabled = _chat.msgs.length >= CHAT_MAX;
}
// Éditeur d'un message : côté, texte, supprimer
function _chatEditor(m) {
  const box = document.createElement('div'); box.className = 'dc-edit';
  const seg = document.createElement('div'); seg.className = 'dc-edit-seg';
  for (const [from, name] of [['contact', chatContactName()], ['actor', _chat.actor || 'Comédien']]) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'gw-seg-btn' + (m.from === from ? ' active' : '');
    b.textContent = name;
    b.onclick = () => setChatMessageSide(m.id, from);
    seg.appendChild(b);
  }
  const ta = document.createElement('textarea'); ta.className = 'text-input'; ta.maxLength = CHAT_TEXT_MAX; ta.value = m.text;
  ta.setAttribute('aria-label', 'Texte du message');
  ta.oninput = () => onChatMessageText(m.id, ta);
  const act = document.createElement('div'); act.className = 'dc-edit-actions';
  const del = document.createElement('button'); del.type = 'button'; del.className = 'cl-del'; del.textContent = 'Supprimer';
  del.onclick = () => deleteChatMessage(m.id);
  // « Reprendre ici » (maquette 26b) : ce qui précède devient l'historique affiché
  const res = document.createElement('button'); res.type = 'button'; res.className = 'dc-edit-resume'; res.textContent = _CHAT_TXT.resumeBtn;
  res.onclick = () => resumeChatAt(m.id);
  res.disabled = !_chatValid(m);
  ta.addEventListener('input', () => { res.disabled = !_chatValid(m); });
  const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'dc-edit-ok'; ok.textContent = 'OK';
  ok.onclick = () => closeChatEditor();
  act.append(res, del, ok);
  box.append(seg, ta, act);
  return box;
}

// Réordonnancement : appui maintenu sur une ligne puis glisser (comme la liste des appels)
let _dcDrag = null, _dcSuppressClick = false;
(function initChatDrag() {
  const box = document.getElementById('dcRows');
  if (!box) return;
  const HOLD = 220, TOL = 12;
  const blockScroll = (e) => e.preventDefault();
  box.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.dc-row');
    if (!row || row.classList.contains('editing') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    _dcDrag = { row, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, active: false, ghost: null };
    _dcDrag.timer = setTimeout(start, HOLD);
  });
  function start() {
    const d = _dcDrag; if (!d || d.active) return;
    d.active = true;
    const r = d.row.getBoundingClientRect();
    d.dy = d.y - r.top;
    const g = d.row.cloneNode(true);
    g.classList.add('cl-ghost'); g.style.width = r.width + 'px'; g.style.left = r.left + 'px'; g.style.top = (d.y - d.dy) + 'px';
    document.body.appendChild(g);
    d.ghost = g;
    d.row.classList.add('cl-drag-src');
    // La ligne de progression, le repère de reprise et l'éditeur suivent leur message : masqués pendant le glisser
    box.querySelectorAll('.dc-progress, .dc-resume, .dc-edit').forEach((el) => { el.style.display = 'none'; });
    document.addEventListener('touchmove', blockScroll, { passive: false });
    if (navigator.vibrate) navigator.vibrate(30);
  }
  document.addEventListener('pointermove', (e) => {
    const d = _dcDrag; if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.active) {
      if (Math.abs(d.x - d.sx) > TOL || Math.abs(d.y - d.sy) > TOL) { clearTimeout(d.timer); _dcDrag = null; }
      return;
    }
    d.ghost.style.top = (d.y - d.dy) + 'px';
    const over = document.elementFromPoint(d.sx, d.y);
    const t = over && over.closest ? over.closest('#dcRows .dc-row') : null;
    if (t && t !== d.row) {
      const rect = t.getBoundingClientRect();
      t.parentNode.insertBefore(d.row, (d.y - rect.top) < rect.height / 2 ? t : t.nextSibling);
    }
  });
  function end() {
    const d = _dcDrag; if (!d) return;
    clearTimeout(d.timer);
    _dcDrag = null;
    if (!d.active) return;
    document.removeEventListener('touchmove', blockScroll);
    if (d.ghost) d.ghost.remove();
    const order = [...box.querySelectorAll('.dc-row')].map((el) => el.dataset.id);
    chatReorder(order);
    _dcSuppressClick = true; setTimeout(() => { _dcSuppressClick = false; }, 350);
  }
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();
function chatReorder(order) {
  _chat.msgs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  _chatChanged();
}

// — Écran —
// État : contact, style, fil (ordre), textes, messages postés (ordre de
// publication), lettres tapées du message en cours. Rien n'est gardé sur
// l'écran : la télécommande le renvoie à la resynchronisation.
let _scChat = null;
const _scChatMsgs = new Map();  // id → { from, text } (reçus avant ou après chat:open)
const _SCC_KEYS_FILL = 'xx';    // contenu du champ caché : l'effacement a toujours un caractère à retirer
let _sccQueue = [], _sccTypingTimer = null, _sccTypingOn = false, _sccAnim = new Set();
let _sccProgT = 0, _sccProgTimer = null;

function screenChatMsg(m) {
  if (!_scChatMsgs.has(m.id) && _scChatMsgs.size >= CHAT_MAX * 2) {
    // Plafond : on oublie d'abord les messages absents du fil affiché
    for (const k of _scChatMsgs.keys()) if (!_scChat || !_scChat.ids.includes(k)) { _scChatMsgs.delete(k); break; }
    if (_scChatMsgs.size >= CHAT_MAX * 2) return;
  }
  _scChatMsgs.set(m.id, { from: m.from, text: String(m.text).slice(0, CHAT_TEXT_MAX) });
  if (_scChat && _scChat.ids.includes(m.id)) _sccRender();
}
function _sccCur() {
  const c = _scChat;
  if (!c) return null;
  for (const id of c.ids) {
    const m = _scChatMsgs.get(id);
    if (!m) return null;
    if (c.sent.includes(id)) continue;
    if (_sccQueue.includes(id)) return null; // message du contact en route (« … écrit ») : il passe d'abord
    return m.from === 'actor' ? Object.assign({ id }, m) : null;
  }
  return null;
}
function screenChatOpen(m) {
  const prev = _scChat;
  // Reprise (history) : historique affiché d'un coup, sans animation ; frappe locale oubliée
  const hist = m.history === true;
  _sccStopQueue();
  if (hist) _sccAnim.clear();
  for (const k of [..._scChatMsgs.keys()]) if (!m.ids.includes(k)) _scChatMsgs.delete(k);
  _scChat = {
    name: String(m.name || '').slice(0, 40), style: ['glass', 'tonal', 'minimal'].includes(m.style) ? m.style : 'minimal',
    hasAvatar: !!m.hasAvatar, ids: m.ids.slice(), sent: m.sent.filter((id) => m.ids.includes(id)), typed: 0, curId: null,
    instant: hist || !!(prev && prev.instant), // pas de fondu d'entrée (gardé : le retirer le rejouerait)
  };
  // Même message en cours sans rechargement : la frappe locale fait foi (sauf reprise)
  const cur = _sccCur();
  if (cur) {
    const total = _chatLen(cur.text);
    _scChat.curId = cur.id;
    _scChat.typed = hist ? 0 : Math.min(total, prev && prev.curId === cur.id ? prev.typed : (m.typed || 0));
    // Frappe remise à zéro : la télécommande l'apprend (après une progression peut-être encore en route)
    if (hist && prev && prev.curId === cur.id && prev.typed) _sccProgress();
  }
  _sccRender(!prev);
}
// « ↶ » : retire un message affiché (ou encore derrière « … écrit ») ; drop :
// message improvisé, retiré du fil. Un message du comédien se retape.
function screenChatRewind(m) {
  const c = _scChat;
  if (!c) return;
  let changed = false;
  const q = _sccQueue.indexOf(m.id);
  if (q >= 0) {
    _sccQueue.splice(q, 1);
    _sccQueueTyping.delete(m.id);
    if (q === 0 && _sccTypingTimer) {
      clearTimeout(_sccTypingTimer);
      _sccTypingTimer = null; _sccTypingOn = false;
      if (_sccQueue.length) _sccTypingTimer = setTimeout(_sccNextPost, 300);
    }
    changed = true;
  }
  const i = c.sent.indexOf(m.id);
  if (i >= 0) { c.sent.splice(i, 1); changed = true; }
  if (m.drop && c.ids.includes(m.id)) { c.ids = c.ids.filter((x) => x !== m.id); _scChatMsgs.delete(m.id); changed = true; }
  if (!changed) return;
  // Message du comédien en cours changé : sa frappe repart de zéro
  const cur = _sccCur();
  if (!cur || cur.id !== c.curId) { c.curId = cur ? cur.id : null; c.typed = 0; }
  _sccRender();
  if (cur) _sccProgress(); // lettres du message en cours, à jour sur la télécommande
}
function screenChatPost(m) {
  const c = _scChat;
  const msg = _scChatMsgs.get(m.id);
  if (!c || !msg || msg.from !== 'contact' || !c.ids.includes(m.id) || c.sent.includes(m.id) || _sccQueue.includes(m.id)) return;
  _sccQueue.push(m.id);
  if (!m.typing) _sccQueueTyping.add(m.id);
  if (!_sccTypingTimer) _sccNextPost();
  else _sccRender();
}
const _sccQueueTyping = new Set(); // messages postés sans indicateur
function _sccNextPost() {
  _sccTypingTimer = null;
  const c = _scChat;
  if (!c || !_sccQueue.length) { _sccTypingOn = false; _sccRender(); return; }
  const id = _sccQueue[0];
  const post = () => {
    _sccQueue.shift();
    _sccQueueTyping.delete(id);
    _sccTypingOn = false;
    if (!c.sent.includes(id)) { c.sent.push(id); _sccAnim.add(id); }
    _sccRender();
    if (_sccQueue.length) _sccTypingTimer = setTimeout(_sccNextPost, 300);
  };
  if (_sccQueueTyping.has(id)) { post(); return; }
  _sccTypingOn = true;
  _sccRender();
  _sccTypingTimer = setTimeout(post, CHAT_TYPING_MS);
}
function _sccStopQueue() {
  if (_sccTypingTimer) clearTimeout(_sccTypingTimer);
  _sccTypingTimer = null; _sccTypingOn = false; _sccQueue = []; _sccQueueTyping.clear();
}
function screenChatClose() { screenChatHide(); }
function screenChatHide() {
  _sccStopQueue();
  if (_sccProgTimer) { clearTimeout(_sccProgTimer); _sccProgTimer = null; }
  _scChat = null;
  _scChatMsgs.clear();
  const el = document.getElementById('screen-chat');
  if (!el) return;
  const k = document.getElementById('sccKeys');
  if (k) k.blur();
  el.style.display = 'none';
  el.textContent = '';
}

// Une touche : lettre suivante (+1) ou effacement (-1) du message en cours
function screenChatKey(d) {
  const c = _scChat, cur = _sccCur();
  if (!c || !cur) return;
  const total = _chatLen(cur.text);
  if (c.curId !== cur.id) { c.curId = cur.id; c.typed = 0; }
  const n = Math.max(0, Math.min(total, c.typed + d));
  if (n === c.typed) return;
  c.typed = n;
  _sccRenderCompose();
  _sccProgress();
}
function screenChatSend() {
  const c = _scChat, cur = _sccCur();
  if (!c || !cur || c.curId !== cur.id || c.typed < _chatLen(cur.text)) return;
  c.sent.push(cur.id);
  _sccAnim.add(cur.id);
  c.typed = 0; c.curId = null;
  if (_sccProgTimer) { clearTimeout(_sccProgTimer); _sccProgTimer = null; }
  sendMsg({ type: 'chat:sent', id: cur.id });
  _sccRender();
}
// Progression vers la télécommande : au plus une fois par CHAT_PROGRESS_MS (dernière valeur gardée)
function _sccProgress() {
  if (_sccProgTimer) return;
  const wait = Math.max(0, CHAT_PROGRESS_MS - (Date.now() - _sccProgT));
  _sccProgTimer = setTimeout(() => {
    _sccProgTimer = null;
    _sccProgT = Date.now();
    const c = _scChat, cur = _sccCur();
    if (!c || !cur || c.curId !== cur.id) return;
    sendMsg({ type: 'chat:progress', id: cur.id, typed: c.typed, total: _chatLen(cur.text) });
  }, wait);
}

function _sccEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function _sccAvatar() {
  const c = _scChat;
  const a = _sccEl('div', 'scc-avatar');
  const cache = c.hasAvatar ? _mediaCache.get('__chatavatar') : null;
  const img = cache && cache.kind === 'img' ? safeImageData(cache.data) : null;
  if (img) a.style.backgroundImage = 'url(' + img + ')';
  else a.textContent = c.name.trim().charAt(0).toUpperCase() || '?';
  return a;
}
function _sccRender(first) {
  const el = document.getElementById('screen-chat'), c = _scChat;
  if (!el || !c) return;
  let root = el.querySelector('.scc');
  if (!root || first) {
    el.textContent = '';
    root = _sccEl('div', 'scc');
    root.addEventListener('click', (e) => { e.stopPropagation(); _sccFocus(); });
    const head = _sccEl('div', 'scc-head');
    const list = _sccEl('div', 'scc-list');
    const comp = _sccEl('div', 'scc-compose');
    const field = _sccEl('div', 'scc-field');
    const keys = document.createElement('input');
    keys.id = 'sccKeys'; keys.className = 'scc-keys'; keys.type = 'text';
    for (const [k, v] of [['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['spellcheck', 'false'], ['enterkeyhint', 'send'], ['aria-label', 'Clavier']]) keys.setAttribute(k, v);
    keys.value = _SCC_KEYS_FILL;
    keys.addEventListener('input', _sccOnInput);
    keys.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); screenChatSend(); } });
    const send = _sccEl('button', 'scc-send');
    send.type = 'button'; send.setAttribute('aria-label', 'Envoyer');
    send.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
    send.addEventListener('click', (e) => { e.stopPropagation(); screenChatSend(); _sccFocus(); });
    field.append(_sccEl('span', 'scc-typed'), _sccEl('span', 'scc-caret'), _sccEl('span', 'scc-ph', 'Message'), keys);
    comp.append(field, send);
    root.append(head, list, comp);
    el.appendChild(root);
  }
  root.className = 'scc ' + c.style + (c.instant ? ' scc-instant' : '');
  el.style.display = 'block';
  // En-tête : avatar et nom du contact
  const head = root.querySelector('.scc-head');
  head.textContent = '';
  head.append(_sccAvatar(), _sccEl('div', 'scc-name', c.name));
  // Bulles postées, dans l'ordre de publication
  const list = root.querySelector('.scc-list');
  list.textContent = '';
  for (const id of c.sent) {
    const m = _scChatMsgs.get(id);
    if (!m) continue;
    const b = _sccEl('div', 'scc-b ' + (m.from === 'actor' ? 'out' : 'in') + (_sccAnim.has(id) ? ' scc-new' : ''), m.text);
    list.appendChild(b);
  }
  _sccAnim.clear();
  if (_sccTypingOn) {
    const t = _sccEl('div', 'scc-b in scc-typing');
    t.setAttribute('aria-label', 'écrit…');
    for (let i = 0; i < 3; i++) t.appendChild(_sccEl('span', 'scc-dot'));
    list.appendChild(t);
  }
  list.scrollTop = list.scrollHeight;
  _sccRenderCompose();
  _sccFitViewport();
  if (document.activeElement !== document.getElementById('sccKeys')) _sccFocus();
}
function _sccRenderCompose() {
  const el = document.getElementById('screen-chat'), c = _scChat;
  if (!el || !c) return;
  const cur = _sccCur();
  if (cur && c.curId !== cur.id) { c.curId = cur.id; c.typed = 0; }
  const typed = cur ? Array.from(cur.text).slice(0, c.typed).join('') : '';
  const done = !!cur && c.typed >= _chatLen(cur.text);
  const q = (s) => el.querySelector(s);
  if (!q('.scc-field')) return;
  q('.scc-typed').textContent = typed;
  q('.scc-ph').style.display = typed ? 'none' : '';
  q('.scc-field').classList.toggle('ready', !!cur);
  const send = q('.scc-send');
  send.disabled = !done;
  send.classList.toggle('on', done);
}
function _sccOnInput(e) {
  const k = e.target;
  const v = k.value;
  const del = /^delete/.test(e.inputType || '') || v.length < _SCC_KEYS_FILL.length;
  k.value = _SCC_KEYS_FILL;
  try { k.setSelectionRange(k.value.length, k.value.length); } catch (_) {}
  if (del) screenChatKey(-1);
  else if (v.length > _SCC_KEYS_FILL.length || e.inputType === 'insertText' || e.inputType === 'insertCompositionText') screenChatKey(1);
}
function _sccFocus() {
  const k = document.getElementById('sccKeys');
  if (!k) return;
  try { k.focus({ preventScroll: true }); } catch (_) { try { k.focus(); } catch (__) {} }
}
// Clavier physique sans focus sur le champ (ordinateur, clavier Bluetooth) : mêmes touches
document.addEventListener('keydown', (e) => {
  if (!_scChat || mode !== 'screen' || e.target && e.target.id === 'sccKeys') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === 'Backspace') { e.preventDefault(); screenChatKey(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); screenChatSend(); }
  else if (e.key && Array.from(e.key).length === 1) { e.preventDefault(); screenChatKey(1); }
});
// Clavier du système affiché : la discussion se cale au-dessus (zone visible)
function _sccFitViewport() {
  const el = document.getElementById('screen-chat');
  const vv = window.visualViewport;
  if (!el || !vv) return;
  el.style.height = Math.round(vv.height) + 'px';
  el.style.top = Math.round(vv.offsetTop) + 'px';
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => { if (_scChat) _sccFitViewport(); });
  window.visualViewport.addEventListener('scroll', () => { if (_scChat) _sccFitViewport(); });
}
