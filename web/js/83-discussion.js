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
//   • Timings et lecture automatique (maquette validée 26d). Chaque message a :
//     « Pause avant » (s), « Écriture » (contact : durée de « … écrit » ;
//     comédien : « Le comédien tape » ou « Automatique », le texte s'écrit
//     tout seul lettre à lettre pendant la durée), « Envoi » (Automatique /
//     Au bouton). Pastilles « pause · écriture » dans le fil. « ▶ Lecture
//     auto » enchaîne les messages selon leurs timings ; elle s'arrête sur un
//     message « Au bouton » (contact : « Envoyer n° X » ; comédien : son
//     bouton Envoyer) ou tapé par le comédien, puis repart d'elle-même.
//     « ⏸ Pause » fige le déroulé (GO de la lecture : reprise au message en
//     cours) ; « ↶ » met en pause et retire le dernier message affiché.
//     Sans lecture auto (et pour les anciens fils : pause 0 s, envoi au
//     bouton), tout se passe comme avant.
//   • Pas de réseau (maquette 34) : le message du comédien envoyé quand la
//     barre d'état de la séquence dit « Pas de service » reste « Non
//     distribué » (point rouge) ; le retour du réseau le distribue (91-sequence.js).
//   • Son des messages et vibreur (maquettes validées 36b et 36d, vue « Style
//     et son », 78-tel-style.js) : réglages du type Discussion
//     (ringSettings.discussion, 81-ringtones.js), portés par chat:open ;
//     l'écran les joue à l'arrivée de chaque message du contact (jamais pour
//     l'historique d'une reprise). Son importé : en cache sur l'écran comme
//     les sonneries. Contact : « Enregistrés (n) › » (79-callers.js).
// Protocole (packages/protocol/schema.js) : chat:msg (texte d'un message),
// chat:open (contact, style, ordre, messages postés ; history : reprise ;
// pend : non distribués ; auto : frappe automatique en cours ; ring, ringId,
// ringVolume, vib : son des messages et vibreur), chat:rewind
// (« ↶ »), chat:post (dur : « … écrit » de la lecture auto), chat:type
// (lecture auto, message du comédien), chat:close ; retour chat:progress,
// chat:sent (undelivered : sans réseau). Textes affichés par textContent.
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
  // Timings et lecture automatique (maquette 26d)
  pill: '{p} s · {w} s', pillAuto: '{p} s · auto {w} s', pillActor: '{p} s · tape',
  timingHead: 'Message {n} · {nom}',
  pause: 'Pause avant', writeLabel: 'Écriture', writeDur: 'Durée d\'écriture',
  writeActor: 'Le comédien tape', writeAuto: 'Automatique',
  sendLabel: 'Envoi', sendAuto: 'Automatique', sendButton: 'Au bouton',
  timingNote: 'Contact : « … écrit » pendant la durée d\'écriture. Comédien : le texte s\'écrit tout seul lettre par lettre.',
  seconds: '{n} s',
  autoLabel: 'Lecture automatique',
  autoRun: '● en cours · {n} / {total}', autoPaused: '⏸ en pause · {n} / {total}', autoReady: 'prête · {n} / {total}',
  autoActor: '● attend {comedien} · {n} / {total}', autoButton: '● attend « Envoyer » · {n} / {total}', autoDone: 'terminée · {n} / {total}',
  autoPlay: 'Auto', autoPlayAria: 'Lecture automatique', autoPause: 'Pause', autoPauseAria: 'Mettre la lecture automatique en pause', autoBack: '↶', autoBackAria: 'Pause et revenir d\'un message',
  threadTitle1: 'Fil · 1 message', threadTitleN: 'Fil · {n} messages', threadTitle0: 'Fil · aucun message',
  moveUp: 'Monter le message', moveDown: 'Descendre le message',
  menuTitle: 'Fil de la discussion', menuNew: 'Nouvelle discussion', menuSave: 'Enregistrer le fil', menuRestart: 'Repartir de zéro', menuClose: 'Fermer sur l\'écran',
  undelivered: 'Non distribué',
};
// Timings d'un message (maquette 26d) ; valeurs par défaut = comportement d'avant
// (pause 0 s, envoi au bouton, le comédien tape) : anciens fils et discussions inchangés
const CHAT_PAUSE_MAX = 60, CHAT_WRITE_MAX = 60;
function chatTimingDefaults(from) { return { pause: 0, write: from === 'actor' ? 3 : 2, auto: false, send: 'button' }; }
function chatTiming(x, from) {
  const d = chatTimingDefaults(from), int = (v, min, max, def) => (Number.isInteger(v) && v >= min && v <= max ? v : def);
  const t = x && typeof x === 'object' ? x : {};
  return { pause: int(t.pause, 0, CHAT_PAUSE_MAX, d.pause), write: int(t.write, 0, CHAT_WRITE_MAX, d.write), auto: from === 'actor' && t.auto === true, send: t.send === 'auto' ? 'auto' : 'button' };
}
// Copie d'un message (fil, discussion enregistrée) : texte et timings
function chatMsgCopy(m) { return Object.assign({ id: m.id, from: m.from, text: m.text }, chatTiming(m, m.from)); }

// — Télécommande —
let _chatSeq = 0;
const _chatNewId = () => 'm' + Date.now().toString(36).slice(-5) + (++_chatSeq).toString(36);
function _chatDefault() {
  const m = (from, text, i) => Object.assign({ id: 'd' + i, from, text }, chatTimingDefaults(from));
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
    pend: [],        // messages du comédien envoyés sans réseau : « Non distribué » (maquette 34)
  };
}
let _chat = _chatDefault();
let _chatAvatar = null;
let _chatEditId = null;
let _chatTimingId = null; // message dont les timings sont affichés (dernier touché, maquette 26d)
const _chatOk = (id) => typeof id === 'string' && SRP.CHAT_ID_RE.test(id);

function chatLoad() {
  let o = null;
  try { o = JSON.parse(_lsGet(CHAT_LS_KEY)); } catch (_) { o = null; }
  if (o && typeof o === 'object' && Array.isArray(o.msgs)) {
    const d = _chatDefault();
    const seen = new Set();
    const msgs = o.msgs.filter((x) => x && _chatOk(x.id) && !seen.has(x.id) && seen.add(x.id) && (x.from === 'contact' || x.from === 'actor') && typeof x.text === 'string')
      .slice(0, CHAT_MAX).map((x) => Object.assign({ id: x.id, from: x.from, text: x.text.slice(0, CHAT_TEXT_MAX) }, chatTiming(x, x.from), x.impro === true ? { impro: true } : {}));
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
      pend: [],
    };
    const sent = new Set(_chat.sent);
    _chat.pend = Array.isArray(o.pend) ? [...new Set(o.pend.filter((id) => sent.has(id)))] : [];
  }
  const a = _lsGet(CHAT_AVATAR_KEY);
  _chatAvatar = safeImageData(a);
}
function chatSave() {
  const c = _chat;
  _lsSet(CHAT_LS_KEY, JSON.stringify({ v: 2, name: c.name, actor: c.actor, style: c.style, typing: c.typing, msgs: c.msgs, sent: c.sent, open: c.open, screens: c.screens, resumeAt: c.resumeAt, savedId: c.savedId, pend: c.pend }));
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
  const sent = _chat.sent.filter((id) => ids.includes(id));
  const pend = _chat.pend.filter((id) => sent.includes(id));
  // Frappe automatique en cours (lecture auto) : l'écran la reprend où elle en est
  const ta = _chatAuto.type;
  const auto = !history && ta && cur && cur.id === ta.id
    ? Object.assign({ id: ta.id, send: ta.send }, ta.dur ? { dur: ta.dur, el: Math.max(0, Math.min(ta.dur * 1000, Date.now() - ta.t0)) } : {}) : null;
  sendMsg(Object.assign({
    type: 'chat:open', name: _chat.name.slice(0, 40), style: _chat.style, hasAvatar: !!_chatAvatar,
    ids, sent,
    typed: !history && cur && p && p.id === cur.id ? Math.min(p.typed, _chatLen(cur.text)) : 0,
  }, history ? { history: true } : {}, pend.length ? { pend } : {}, auto ? { auto } : {}, ringChatFields(), _chatTarget(only)));
}
// Son des messages importé : envoyé aux écrans de la discussion qui ne l'ont pas
function _chatSendRing() {
  const f = ringChatFields();
  if (f.ringId && _chat.screens && _chat.screens.length) ensureCallAssets(null, null, [f.ringId], _chat.screens);
  else if (f.ringId) ensureCallAssets(null, null, [f.ringId]);
}
// Son des messages ou vibreur changés (81-ringtones.js) : renvoyés à l'écran
// (le curseur du volume n'envoie qu'une fois arrêté)
let _chatSoundTimer = null;
function chatOnSoundChange() {
  if (_chatSoundTimer) clearTimeout(_chatSoundTimer);
  _chatSoundTimer = setTimeout(() => {
    _chatSoundTimer = null;
    if (!_chat.open) return;
    _chatSendRing();
    _chatFlushTexts();
    _chatSendOpen();
  }, 300);
}
function _chatSendAvatar(only) {
  if (!_chatAvatar || linkBleOnly()) return Promise.resolve();
  const ids = only || _chat.screens;
  return ensureSlotImage('__chatavatar', _chatAvatar, ids && ids.length ? ids : undefined);
}
// Ouvre la discussion sur la cible courante (chip « Cible »), ou sur les écrans donnés.
// Cible tenue par une séquence : suspendu (confirmation), renvoie faux ; cible partielle :
// écrans libres seulement (27-tab-gate.js)
function openChatOnTarget(history, only) {
  let ids = only || scrTargetIds();
  if (!only || only !== _chat.screens) {
    ids = tabSendIds('tel', ids, () => openChatOnTarget(history));
    if (!ids) return false;
  }
  _chat.screens = ids.length ? ids : null;
  _chat.open = true;
  _chatSendRing();
  _chatSyncTexts(undefined, history === true);
  _chatSendAvatar().then(() => { if (_chat.open && _chatAvatar) _chatSendOpen(); });
  chatSave();
  renderChatPanel();
  if (typeof scrChanged === 'function') scrChanged();
  return true;
}
function closeChat() {
  if (_chat.open) sendMsg(Object.assign({ type: 'chat:close' }, _chatTarget()));
  chatAutoStop();
  _chat.open = false;
  _chat.progress = null;
  chatSave();
  renderChatPanel();
  if (typeof scrChanged === 'function') scrChanged();
}
// « Repartir de zéro » : plus rien d'affiché, frappe oubliée
function restartChat() {
  chatAutoStop();
  _chat.sent = [];
  _chat.pend = [];
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
  chatAutoPause(); // la lecture auto ne repart qu'au ▶
  _chatAuto.type = null; _chatAuto.phase = null; _chatAuto.done = false;
  if (_chat.open) _chatFlushTexts();
  _chat.sent.pop();
  _chat.pend = _chat.pend.filter((x) => x !== id);
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
  chatAutoStop();
  _chat.sent = _chat.msgs.slice(0, i).filter(_chatValid).map((m) => m.id);
  _chat.pend = _chat.pend.filter((x) => _chat.sent.includes(x));
  _chat.progress = null;
  _chat.resumeAt = i > 0 ? id : null; // au n° 1 : comme « Repartir de zéro »
  _chatEditId = null;
  if (!_chat.open) { if (openChatOnTarget(true) === false) return; }
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
  if (!_chat.open) { if (openChatOnTarget() === false) return; }
  else _chatFlushEdits();
  // Lecture auto : « … écrit » pendant la durée d'écriture du message, puis la lecture continue
  const auto = _chatAuto.on;
  _chatPost(m, auto ? (m.write > 0 ? m.write : -1) : (_chat.typing ? 0 : -1));
  if (auto) _chatAutoAfterPost(m);
  chatSave();
  renderChatPanel();
}
// Poste un message du contact ; dur : « … écrit » en s (0 : 2 s ; -1 : sans indicateur)
function _chatPost(m, dur) {
  _chat.sent.push(m.id);
  const typing = dur >= 0;
  sendMsg(Object.assign({ type: 'chat:post', id: m.id, typing }, typing && dur > 0 ? { dur: Math.min(CHAT_WRITE_MAX, dur) } : {}, _chatTarget()));
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
  Object.assign(m, chatTimingDefaults('contact'));
  const i = _chat.msgs.findIndex((x) => !_chatSent(x));
  _chat.msgs.splice(i < 0 ? _chat.msgs.length : i, 0, m);
  if (!_chat.open) { if (openChatOnTarget() === false) return; }
  else _chatSyncTexts(); // le nouveau message et l'ordre, avant de le poster
  _chatDefsSent.set(m.id, m.from + '|' + m.text);
  Object.assign(m, chatTimingDefaults('contact'));
  _chatPost(m, _chat.typing ? 0 : -1);
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
  if (licLocked('tel')) return; // aperçu sans licence (77-licence-ui.js)
  if (_chat.msgs.length >= CHAT_MAX) return;
  const last = _chat.msgs[_chat.msgs.length - 1];
  const from = last && last.from === 'contact' ? 'actor' : 'contact';
  const m = Object.assign({ id: _chatNewId(), from, text: '' }, chatTimingDefaults(from));
  _chat.msgs.push(m);
  _chatEditId = m.id; _chatTimingId = m.id;
  _chatChanged();
  const ta = document.querySelector('#dcRows .dc-edit textarea');
  if (ta) ta.focus();
}
function editChatMessage(id) {
  if (_dcSuppressClick) return;
  _chatEditId = _chatEditId === id ? null : id;
  _chatTimingId = id;
  renderChatPanel();
}
// Monter / descendre un message d'un rang (bouton, en plus du glisser)
function moveChatMessage(id, d) {
  if (licLocked('tel')) return false;
  const i = _chat.msgs.findIndex((x) => x.id === id), j = i + (d < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= _chat.msgs.length) return false;
  [_chat.msgs[i], _chat.msgs[j]] = [_chat.msgs[j], _chat.msgs[i]];
  _chatChanged();
  return true;
}
function setChatMessageSide(id, from) {
  const m = _chat.msgs.find((x) => x.id === id);
  if (!m) return;
  m.from = from === 'actor' ? 'actor' : 'contact';
  Object.assign(m, chatTiming(m, m.from));
  _chatChanged();
}
// Timings d'un message (maquette 26d) : pause, écriture, envoi
function setChatTiming(id, k, v) {
  const m = _chat.msgs.find((x) => x.id === id);
  if (!m) return;
  const t = chatTiming(m, m.from);
  if (k === 'pause') t.pause = Math.max(0, Math.min(CHAT_PAUSE_MAX, t.pause + v));
  else if (k === 'write') t.write = Math.max(m.from === 'actor' ? 1 : 0, Math.min(CHAT_WRITE_MAX, t.write + v));
  else if (k === 'auto') t.auto = m.from === 'actor' && !!v;
  else if (k === 'send') t.send = v === 'auto' ? 'auto' : 'button';
  else return;
  Object.assign(m, t);
  _chatChanged();
}
function onChatMessageText(id, el) {
  const m = _chat.msgs.find((x) => x.id === id);
  if (!m) return;
  m.text = String(el.value || '').slice(0, CHAT_TEXT_MAX);
  _chatChanged(true);
}
// ⋯ du titre « Fil » : nouvelle discussion, enregistrer le fil, repartir de zéro, fermer (89-discussions-saved.js)
function openChatThreadMenu() { _sheet = { kind: 'chatThread' }; renderSheet(); }
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
  if (_chatTimingId === id) _chatTimingId = null;
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
  if (_chatAuto.type && _chatAuto.type.id === msg.id) _chatAuto.type = null;
  // Envoyé sans réseau (maquette 34) : « Non distribué » jusqu'au retour du réseau
  if (m.undelivered && !_chat.pend.includes(msg.id)) _chat.pend.push(msg.id);
  chatSave();
  renderChatPanel();
  // Les autres écrans de la discussion suivent
  const others = (_chat.screens || []).filter((s) => s !== _rxFrom);
  if (others.length) _chatSendOpen(others);
  if (m.undelivered) seqOnChatUndelivered(_rxFrom, msg); // « Message non envoyé » (91-sequence.js)
  seqOnChatSent(_rxFrom); // réponse attendue par une Séquence (91-sequence.js)
  if (_chatAuto.on) _chatAutoNext(); // lecture auto : le comédien a envoyé, elle reprend
}
// Réseau revenu (91-sequence.js) : messages « Non distribué » distribués
function chatDeliverPending() {
  if (!_chat.pend.length) return;
  _chat.pend = [];
  chatSave();
  if (_chat.open) _chatSendOpen();
  renderChatPanel();
}

// ── Lecture automatique (maquette 26d) ──
// phase : { id, k: 'pause' | 'write' (contact) | 'type' (texte automatique) | 'actor' (le comédien tape) | 'button' (« Envoyer n° X ») }
// type : frappe automatique envoyée à l'écran (chat:type), pour la reprise après rechargement
const _chatAuto = { on: false, done: false, timer: null, tick: null, phase: null, t0: 0, dur: 0, type: null, seq: false, full: false };
const _chatNextMsg = () => _chat.msgs.find((x) => _chatValid(x) && !_chatSent(x)) || null;
// fromSeq : lancée par une étape de Séquence → les messages du contact suivent
// leurs durées enregistrées, même réglés « au bouton » (seul le comédien est attendu)
// full (étape « Auto · tout automatique », maquette 41) : les réponses du comédien
// s'écrivent aussi toutes seules (durée d'écriture enregistrée, 1 s au moins) et
// partent une fois complètes : personne n'est attendu
function chatAutoStart(fromSeq, full) {
  if (_chatAuto.on || !_chatNextMsg()) return;
  _chatAuto.seq = fromSeq === true;
  _chatAuto.full = _chatAuto.seq && full === true;
  if (!_chat.open) openChatOnTarget();
  _chatAuto.on = true; _chatAuto.done = false;
  if (!_chatAuto.tick) _chatAuto.tick = setInterval(_chatRenderAuto, 500);
  _chatAutoNext(true);
}
function chatAutoPause() {
  if (!_chatAuto.on) return;
  _chatAuto.on = false;
  if (_chatAuto.timer) { clearTimeout(_chatAuto.timer); _chatAuto.timer = null; }
  if (_chatAuto.tick) { clearInterval(_chatAuto.tick); _chatAuto.tick = null; }
  renderChatPanel();
}
function chatAutoStop() {
  chatAutoPause();
  _chatAuto.phase = null; _chatAuto.type = null; _chatAuto.done = false; _chatAuto.seq = false; _chatAuto.full = false;
}
// « ↶ » de la lecture : pause, puis le dernier message affiché est retiré
function chatAutoBack() { chatAutoPause(); rewindChat(); }
// Un seul bouton dans la barre : « Lecture auto », puis « Pause » tant qu'elle tourne
function chatAutoToggle() { if (_chatAuto.on) chatAutoPause(); else chatAutoStart(); }
function _chatAutoPhase(id, k, dur) { _chatAuto.phase = { id, k }; _chatAuto.t0 = Date.now(); _chatAuto.dur = dur || 0; }
// Message suivant : pause avant, puis écriture et envoi
function _chatAutoNext(resume) {
  if (_chatAuto.timer) { clearTimeout(_chatAuto.timer); _chatAuto.timer = null; }
  if (!_chatAuto.on) return;
  if (!_chat.open) { chatAutoStop(); renderChatPanel(); return; }
  const m = _chatNextMsg();
  if (!m) { chatAutoPause(); _chatAuto.phase = null; _chatAuto.done = true; renderChatPanel(); return; }
  // Repris au ▶ sur un message déjà en cours d'écriture par le comédien : on attend son envoi
  if (resume && _chatAuto.type && _chatAuto.type.id === m.id) { _chatAutoPhase(m.id, _chatAuto.type.dur ? 'type' : 'actor', _chatAuto.type.dur); renderChatPanel(); return; }
  if (m.from === 'contact' && m.send === 'button' && !_chatAuto.seq) { _chatAutoPhase(m.id, 'button'); renderChatPanel(); return; }
  if (m.from === 'actor' && !m.auto && m.send === 'button' && !_chatAuto.full) { _chatAutoPhase(m.id, 'actor'); renderChatPanel(); return; }
  if (m.pause > 0) {
    _chatAutoPhase(m.id, 'pause', m.pause);
    _chatAuto.timer = setTimeout(() => { _chatAuto.timer = null; _chatAutoWrite(m.id); }, m.pause * 1000);
    renderChatPanel();
    return;
  }
  _chatAutoWrite(m.id);
}
function _chatAutoWrite(id) {
  if (!_chatAuto.on || !_chat.open) return;
  const m = _chat.msgs.find((x) => x.id === id);
  if (!m || _chatSent(m) || _chatNextMsg() !== m) { _chatAutoNext(); return; }
  _chatFlushEdits();
  if (m.from === 'contact') {
    _chatPost(m, m.write > 0 ? m.write : -1);
    _chatAutoAfterPost(m);
    chatSave();
  } else {
    // Comédien : le texte s'écrit tout seul (dur) et/ou part tout seul une fois complet (send) ;
    // lecture « tout automatique » d'une Séquence : les deux, quels que soient ses réglages
    const full = _chatAuto.full;
    const dur = m.auto || full ? Math.max(1, m.write) : null, send = m.send === 'auto' || full;
    _chatAuto.type = { id: m.id, dur, send, t0: Date.now() };
    sendMsg(Object.assign({ type: 'chat:type', id: m.id, send }, dur ? { dur } : {}, _chatTarget()));
    _chatAutoPhase(m.id, dur ? 'type' : 'actor', dur || 0);
  }
  renderChatPanel();
}
// Contact posté : la bulle arrive après « … écrit » ; le message suivant attend jusque-là
function _chatAutoAfterPost(m) {
  const w = m.write > 0 ? m.write : 0;
  _chatAutoPhase(m.id, 'write', w);
  if (_chatAuto.timer) clearTimeout(_chatAuto.timer);
  _chatAuto.timer = setTimeout(() => { _chatAuto.timer = null; _chatAutoNext(); }, w * 1000 + 50);
}
// État et avancée affichés (« en cours · 3 / 4 », barre)
function _chatAutoInfo() {
  const valid = _chat.msgs.filter(_chatValid), total = valid.length;
  const a = _chatAuto, ph = a.phase;
  // « … écrit » en cours : le message posté n'est pas encore affiché, il reste le message en cours
  const writing = !!ph && ph.k === 'write' && _chat.sent.includes(ph.id) && a.on;
  const sent = valid.filter(_chatSent).length - (writing ? 1 : 0);
  let frac = 0;
  if (a.on && ph && a.dur > 0 && (ph.k === 'pause' || ph.k === 'type' || ph.k === 'write')) frac = Math.min(1, (Date.now() - a.t0) / (a.dur * 1000)) * (ph.k === 'pause' ? 0.3 : 1);
  const n = a.done || sent >= total ? total : (a.on || ph ? sent + 1 : sent);
  const v = { n: Math.min(n, total), total, comedien: _chat.actor || 'Comédien' };
  let text;
  if (a.done || (total && sent >= total)) text = _tplChat(_CHAT_TXT.autoDone, v);
  else if (!a.on) text = _tplChat(ph ? _CHAT_TXT.autoPaused : _CHAT_TXT.autoReady, v);
  else if (ph && ph.k === 'actor') text = _tplChat(_CHAT_TXT.autoActor, v);
  else if (ph && ph.k === 'button') text = _tplChat(_CHAT_TXT.autoButton, v);
  else text = _tplChat(_CHAT_TXT.autoRun, v);
  const pct = total ? Math.round(Math.min(1, (sent + frac) / total) * 1000) / 10 : 0;
  return { text, pct, live: a.on };
}
function _chatRenderAuto() {
  const st = document.getElementById('dcAutoState'), fill = document.getElementById('dcAutoFill');
  const info = _chatAutoInfo();
  if (st) { setIconText(st, info.text); st.classList.toggle('on', info.live); }
  if (fill) fill.style.width = info.pct + '%';
  if (typeof seqRenderChatStatus === 'function') seqRenderChatStatus(); // 91-sequence.js : état sous l'étape en cours
  const play = document.getElementById('dcAutoPlay');
  if (play) {
    const on = _chatAuto.on, key = on ? 'on' : 'off';
    if (play.dataset.st !== key) {
      play.dataset.st = key;
      play.innerHTML = icon(on ? 'pause' : 'play') + '<b>' + escapeHtml(on ? _CHAT_TXT.autoPause : _CHAT_TXT.autoPlay) + '</b>';
      play.classList.toggle('on', on);
      play.setAttribute('aria-pressed', on ? 'true' : 'false');
      play.setAttribute('aria-label', on ? _CHAT_TXT.autoPauseAria : _CHAT_TXT.autoPlayAria); // le libellé visible est court (« Auto »)
    }
    play.disabled = !on && !_chatNextMsg(); // en cours : « Pause » reste actif
  }
  const back = document.getElementById('dcBackBtn');
  if (back) back.disabled = !_chat.sent.length;
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
// Phase 4 : plus de sous-onglets « Fil en cours | Enregistrées » ; le fil à jouer, puis la liste
// « Discussions enregistrées » dessous (▶ charge une discussion dans le fil)
let _chatView = 'thread';
function chatShowForm(on) {
  const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none'; };
  for (const id of ['dcContactPanel', 'dcActorRow', 'dcThreadPanel', 'dcActorPanel', 'dcSavedPanel']) show(id, on);
  if (!on) show('dcTimingPanel', false);
  // Le style appartient au fil en cours : rangée « Style et son » (commune aux SMS)
  if (on) show('telStyleRow', true);
  if (on) { renderChatPanel(); renderSavedChats(); }
  renderTelBar();
}
function setChatView(v) {
  _chatView = 'thread';
  chatShowForm(callKind === 'discussion');
}
function _chatScreensLabel() {
  const ids = _chat.screens || [];
  if (ids.length === 1) return _tplChat('Discussion ouverte sur « {ecran} »', { ecran: scrName(ids[0]) });
  if (ids.length > 1) return _tplChat('Discussion ouverte sur {n} écrans', { n: ids.length });
  return 'Discussion ouverte sur l\'écran';
}
function _chatRenderHead() {
  const set = (id, t) => { setIconText(document.getElementById(id), t); };
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
  // Noms : la saisie en cours n'est pas réécrite
  for (const [id, v] of [['dcName', _chat.name], ['dcActor', _chat.actor]]) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el && el.value !== v) el.value = v;
  }
  const tg = document.getElementById('dcTypingToggle');
  if (tg) tg.checked = !!_chat.typing;
  _chatRenderAuto();
  renderTelBar(); // barre d'action : Ouvrir sur l'écran / ↶ · Lecture auto · Envoyer n°n
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
  const nextMsg = _chatNextMsg();
  _chat.msgs.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'dc-row' + (_chatSent(m) ? ' sent' : '') + (cur && cur.id === m.id ? ' cur' : '') + (nextMsg && nextMsg.id === m.id ? ' next' : '') + (m.from === 'actor' ? ' actor' : '') + (_chatEditId === m.id ? ' editing' : '') + (_chatTimingId === m.id ? ' sel' : '');
    row.dataset.id = m.id;
    row.onclick = () => editChatMessage(m.id);
    const st = document.createElement('span'); st.className = 'dc-st';
    st.innerHTML = icon(_chatSent(m) ? 'circle-check' : nextMsg && nextMsg.id === m.id ? 'play' : 'circle');
    const num = document.createElement('span'); num.className = 'dc-num'; num.textContent = String(i + 1);
    const tx = document.createElement('span'); tx.className = 'dc-tx';
    const who = document.createElement('small'); who.className = 'dc-who';
    who.textContent = _tplChat('{nom} ›', { nom: m.from === 'actor' ? (_chat.actor || 'Comédien') : chatContactName() });
    const txt = document.createElement('span'); txt.className = 'dc-text';
    txt.textContent = m.text || '…';
    tx.append(who, txt);
    // Pastille des timings (maquette 26d) : pause · écriture
    const pill = document.createElement('span'); pill.className = 'dc-pill';
    pill.textContent = _tplChat(m.from === 'actor' ? (m.auto ? _CHAT_TXT.pillAuto : _CHAT_TXT.pillActor) : _CHAT_TXT.pill, { p: m.pause, w: m.write });
    row.append(st, num, tx, pill);
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
  const n = _chat.msgs.length;
  _tuText('dcThreadTitle', n === 0 ? _CHAT_TXT.threadTitle0 : n === 1 ? _CHAT_TXT.threadTitle1 : _tplChat(_CHAT_TXT.threadTitleN, { n }));
  const add = document.getElementById('dcAdd');
  if (add) add.disabled = _chat.msgs.length >= CHAT_MAX;
  _chatRenderTiming();
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
  // Monter / descendre : au bouton, en plus du glisser (accessibilité)
  const i = _chat.msgs.indexOf(m);
  const mv = (d, ico, label) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'dc-edit-mv'; b.innerHTML = icon(ico);
    b.setAttribute('aria-label', label); b.title = label;
    b.disabled = d < 0 ? i <= 0 : i >= _chat.msgs.length - 1;
    b.onclick = () => moveChatMessage(m.id, d);
    return b;
  };
  const del = document.createElement('button'); del.type = 'button'; del.className = 'cl-del'; del.textContent = 'Supprimer';
  del.onclick = () => deleteChatMessage(m.id);
  // « Reprendre ici » (maquette 26b) : ce qui précède devient l'historique affiché
  const res = document.createElement('button'); res.type = 'button'; res.className = 'dc-edit-resume'; res.textContent = _CHAT_TXT.resumeBtn;
  res.onclick = () => resumeChatAt(m.id);
  res.disabled = !_chatValid(m);
  ta.addEventListener('input', () => { res.disabled = !_chatValid(m); });
  const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'dc-edit-ok'; ok.textContent = 'OK';
  ok.onclick = () => closeChatEditor();
  act.append(mv(-1, 'arrow-up', _CHAT_TXT.moveUp), mv(1, 'arrow-down', _CHAT_TXT.moveDown), res, del, ok);
  box.append(seg, ta, act);
  return box;
}
// Carte des timings du message touché (maquette 26d), sous le fil
function _chatRenderTiming() {
  const panel = document.getElementById('dcTimingPanel');
  if (!panel) return;
  const m = _chat.msgs.find((x) => x.id === _chatTimingId);
  panel.textContent = '';
  panel.style.display = m && callKind === 'discussion' && _chatView === 'thread' ? '' : 'none';
  if (m) panel.appendChild(_chatTimingEditor(m));
}
// Timings du message (maquette 26d) : pause avant, écriture, envoi
function _chatTimingEditor(m) {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const box = el('div', 'dc-timing');
  const i = _chat.msgs.indexOf(m) + 1;
  const head = el('div', 'dc-timing-head');
  head.append(el('span', 'dc-tlabel', _tplChat(_CHAT_TXT.timingHead, { n: i, nom: m.from === 'actor' ? (_chat.actor || 'Comédien') : chatContactName() })),
    el('span', 'dc-timing-quote', '« ' + (m.text || '…') + ' »'));
  const stepper = (label, val, k) => {
    const r = el('div', 'dc-tstep');
    const minus = el('button', 'dc-tbtn'), plus = el('button', 'dc-tbtn');
    minus.innerHTML = icon('minus', 'ic-sm'); plus.innerHTML = icon('plus', 'ic-sm');
    minus.type = plus.type = 'button'; minus.setAttribute('aria-label', label + ' −'); plus.setAttribute('aria-label', label + ' +');
    minus.onclick = () => setChatTiming(m.id, k, -1); plus.onclick = () => setChatTiming(m.id, k, 1);
    r.append(el('span', '', label), minus, el('b', 'dc-tval', _tplChat(_CHAT_TXT.seconds, { n: val })), plus);
    return r;
  };
  const opts = (items) => {
    const r = el('div', 'ss-row');
    for (const [on, label, fn] of items) { const b = el('button', 'ss-opt' + (on ? ' on' : ''), label); b.type = 'button'; b.onclick = fn; r.appendChild(b); }
    return r;
  };
  box.append(head, stepper(_CHAT_TXT.pause, m.pause, 'pause'), el('span', 'dc-tlabel', _CHAT_TXT.writeLabel));
  if (m.from === 'actor') box.appendChild(opts([[!m.auto, _CHAT_TXT.writeActor, () => setChatTiming(m.id, 'auto', false)], [m.auto, _CHAT_TXT.writeAuto, () => setChatTiming(m.id, 'auto', true)]]));
  if (m.from === 'contact' || m.auto) box.appendChild(stepper(_CHAT_TXT.writeDur, m.write, 'write'));
  box.append(el('span', 'dc-tlabel', _CHAT_TXT.sendLabel),
    opts([[m.send === 'auto', _CHAT_TXT.sendAuto, () => setChatTiming(m.id, 'send', 'auto')], [m.send !== 'auto', _CHAT_TXT.sendButton, () => setChatTiming(m.id, 'send', 'button')]]),
    el('div', 'dc-timing-note', _CHAT_TXT.timingNote));
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
  _sccAutoStop();
  _scChat = {
    name: String(m.name || '').slice(0, 40), style: ['glass', 'tonal', 'minimal'].includes(m.style) ? m.style : 'minimal',
    hasAvatar: !!m.hasAvatar, ids: m.ids.slice(), sent: m.sent.filter((id) => m.ids.includes(id)), typed: 0, curId: null,
    instant: hist || !!(prev && prev.instant), // pas de fondu d'entrée (gardé : le retirer le rejouerait)
    pend: Array.isArray(m.pend) ? m.pend.filter((id) => m.sent.includes(id)) : [], // « Non distribué » (maquette 34)
    auto: null,                                                                      // lecture auto : { id, dur, send, t0 }
    // Son des messages du contact (absent : aucun) et vibreur (maquette 36d)
    sound: m.ring ? { kind: 'discussion', ring: m.ring, ringId: m.ringId || null, ringVolume: typeof m.ringVolume === 'number' ? m.ringVolume : 1 } : null,
    vib: m.vib === true,
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
  // Frappe automatique en cours (lecture auto, reprise) : repart où elle en était
  if (m.auto && cur && cur.id === m.auto.id) screenChatType(m.auto, m.auto.el || 0);
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
  if (i >= 0) { c.sent.splice(i, 1); c.pend = c.pend.filter((x) => x !== m.id); changed = true; }
  if (changed) _sccAutoStop();
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
  else if (m.dur) _sccQueueDur.set(m.id, m.dur * 1000); // lecture auto : durée d'écriture du message
  if (!_sccTypingTimer) _sccNextPost();
  else _sccRender();
}
const _sccQueueTyping = new Set(); // messages postés sans indicateur
const _sccQueueDur = new Map();    // durée de « … écrit » propre au message (lecture auto)
function _sccNextPost() {
  _sccTypingTimer = null;
  const c = _scChat;
  if (!c || !_sccQueue.length) { _sccTypingOn = false; _sccRender(); return; }
  const id = _sccQueue[0];
  const post = () => {
    _sccQueue.shift();
    _sccQueueTyping.delete(id);
    _sccQueueDur.delete(id);
    _sccTypingOn = false;
    if (!c.sent.includes(id)) { c.sent.push(id); _sccAnim.add(id); _sccChime(c); }
    _sccRender();
    if (_sccQueue.length) _sccTypingTimer = setTimeout(_sccNextPost, 300);
  };
  if (_sccQueueTyping.has(id)) { post(); return; }
  _sccTypingOn = true;
  _sccRender();
  _sccTypingTimer = setTimeout(post, _sccQueueDur.get(id) || CHAT_TYPING_MS);
}
// Message du contact arrivé : son des messages et vibreur de la discussion
function _sccChime(c) {
  if (c.sound) _playNotifSound(c.sound); // 80-call-simulator.js : son importé (cache) ou intégré
  if (c.vib) screenVibrate(SCREEN_VIB_SHORT);
}
function _sccStopQueue() {
  if (_sccTypingTimer) clearTimeout(_sccTypingTimer);
  _sccTypingTimer = null; _sccTypingOn = false; _sccQueue = []; _sccQueueTyping.clear(); _sccQueueDur.clear();
}
// Lecture auto (chat:type) : le texte du comédien s'écrit tout seul en dur s
// (sinon il le tape), puis part tout seul une fois complet si send
let _sccAutoTimer = null;
function screenChatType(m, el) {
  const c = _scChat, cur = _sccCur();
  if (!c || !cur || cur.id !== m.id) return;
  _sccAutoStop();
  c.auto = { id: m.id, dur: m.dur ? m.dur * 1000 : 0, send: !!m.send, t0: Date.now() - (el || 0) };
  if (c.curId !== cur.id) { c.curId = cur.id; c.typed = 0; }
  if (c.auto.dur) _sccAutoTimer = setInterval(_sccAutoTick, 60);
  _sccAutoTick();
}
function _sccAutoTick() {
  const c = _scChat, a = c && c.auto, cur = _sccCur();
  if (!a || !cur || cur.id !== a.id) { _sccAutoStop(); return; }
  const total = _chatLen(cur.text);
  if (a.dur) {
    const n = Math.min(total, Math.floor(total * Math.min(1, (Date.now() - a.t0) / a.dur)));
    if (n > c.typed) { c.typed = n; _sccRenderCompose(); _sccProgress(); }
  }
  if (c.typed >= total) {
    if (_sccAutoTimer) { clearInterval(_sccAutoTimer); _sccAutoTimer = null; }
    if (a.send) { c.auto = null; screenChatSend(); }
  }
}
function _sccAutoStop() {
  if (_sccAutoTimer) { clearInterval(_sccAutoTimer); _sccAutoTimer = null; }
  if (_scChat) _scChat.auto = null;
}
function screenChatClose() { screenChatHide(); }
function screenChatHide() {
  _sccAutoStop();
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
  // Lecture auto, « Envoi automatique » : complet, il part tout seul
  if (c.auto && c.auto.id === cur.id && !c.auto.dur) _sccAutoTick();
}
function screenChatSend() {
  const c = _scChat, cur = _sccCur();
  if (!c || !cur || c.curId !== cur.id || c.typed < _chatLen(cur.text)) return;
  c.sent.push(cur.id);
  _sccAnim.add(cur.id);
  c.typed = 0; c.curId = null;
  _sccAutoStop();
  if (_sccProgTimer) { clearTimeout(_sccProgTimer); _sccProgTimer = null; }
  // Sans réseau (barre d'état de la séquence, 97-phone-status.js) : non distribué
  const und = screenPhoneNoNetwork();
  if (und) c.pend.push(cur.id);
  sendMsg(Object.assign({ type: 'chat:sent', id: cur.id }, und ? { undelivered: true } : {}));
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
  const a = _sccEl('div', 'pt-av');
  const cache = c.hasAvatar ? _mediaCache.get('__chatavatar') : null;
  const img = cache && cache.kind === 'img' ? safeImageData(cache.data) : null;
  if (img) a.style.backgroundImage = 'url(' + img + ')';
  else a.textContent = c.name.trim().charAt(0).toUpperCase() || '?';
  return a;
}
// Discussion de l'écran : composant PhoneChat de la maquette 5g (71-phone-ui.js pour les icônes et
// l'habillage .ph-glass / .ph-tonal / .ph-minimal, 79-phone-ui.css) ; fil ancré en bas.
function _sccRender(first) {
  const el = document.getElementById('screen-chat'), c = _scChat;
  if (!el || !c) return;
  let root = el.querySelector('.pt');
  if (!root || first) {
    el.textContent = '';
    root = _sccEl('div', 'pt');
    root.addEventListener('click', (e) => { e.stopPropagation(); _sccFocus(); });
    const head = _sccEl('div', 'pt-head');
    const list = _sccEl('div', 'pt-list');
    const comp = _sccEl('div', 'pt-comp');
    const plus = _sccEl('span', 'pt-plus');
    plus.innerHTML = PhoneUI.ic('plus');
    const field = _sccEl('div', 'pt-field');
    const keys = document.createElement('input');
    keys.id = 'sccKeys'; keys.className = 'pt-keys'; keys.type = 'text';
    for (const [k, v] of [['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'], ['spellcheck', 'false'], ['enterkeyhint', 'send'], ['aria-label', 'Clavier']]) keys.setAttribute(k, v);
    keys.value = _SCC_KEYS_FILL;
    keys.addEventListener('input', _sccOnInput);
    keys.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); screenChatSend(); } });
    const send = _sccEl('button', 'pt-send');
    send.type = 'button'; send.setAttribute('aria-label', 'Envoyer');
    send.innerHTML = PhoneUI.ic('send');
    send.addEventListener('click', (e) => { e.stopPropagation(); screenChatSend(); _sccFocus(); });
    field.append(_sccEl('span', 'pt-typed'), _sccEl('span', 'pt-caret'), _sccEl('span', 'pt-ph', 'Message'), keys);
    comp.append(plus, field, send);
    root.append(head, list, comp);
    el.appendChild(root);
  }
  root.className = 'ph ph-' + c.style + ' pt' + (c.instant ? ' pt-instant' : '');
  el.style.display = 'block';
  // En-tête : retour, avatar et nom du contact
  const head = root.querySelector('.pt-head');
  head.textContent = '';
  const back = _sccEl('span', 'pt-back');
  back.innerHTML = PhoneUI.ic('chevron-left');
  head.append(back, _sccAvatar(), _sccEl('div', 'pt-name', c.name));
  // Bulles postées, dans l'ordre de publication, sous l'heure du jour
  const list = root.querySelector('.pt-list');
  list.textContent = '';
  list.appendChild(_sccEl('div', 'pt-day', 'Aujourd’hui ' + PhoneUI.hm(phoneClockNow())));
  for (const id of c.sent) {
    const m = _scChatMsgs.get(id);
    if (!m) continue;
    const b = _sccEl('div', 'pt-b ' + (m.from === 'actor' ? 'out' : 'in') + (_sccAnim.has(id) ? ' pt-new' : ''), m.text);
    list.appendChild(b);
    if (c.pend.includes(id)) list.appendChild(_sccEl('div', 'pt-und', _CHAT_TXT.undelivered)); // point rouge (maquette 34)
  }
  _sccAnim.clear();
  if (_sccTypingOn) {
    const t = _sccEl('div', 'pt-b in pt-typing');
    t.setAttribute('aria-label', 'écrit…');
    for (let i = 0; i < 3; i++) t.appendChild(_sccEl('span', 'pt-dot'));
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
  if (!q('.pt-field')) return;
  q('.pt-typed').textContent = typed;
  q('.pt-ph').style.display = typed ? 'none' : '';
  q('.pt-field').classList.toggle('ready', !!cur);
  const send = q('.pt-send');
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
