// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ LES SÉQUENCES PRENNENT LE DESSUS · RETIRER DE L'ÉCRAN (lot 6) ══════════════════════════
// Télécommande. Trois règles, une seule porte (tabGate*) pour les envois des onglets
// Lumière, Effets, Média et Tel :
//   6c  Séquence prioritaire : tant qu'une séquence tient des écrans (commencée, pas
//       recommencée, pas reprise par l'utilisateur), les envois de ces onglets vers
//       ces écrans sont SUSPENDUS : bandeau « Séquence en cours » + voile, et
//       « Reprendre la main » (confirmation → Pause auto, voile levé jusqu'au
//       prochain GO). Cible partielle : l'envoi n'atteint que les écrans libres.
//       Toujours permis : Noir, arrêts (strobe, effet, torche, média), Raccrocher /
//       Retirer de l'écran, Identifier, transport média (lecture, pause, position).
//   6b  « Retirer de l'écran » : une ligne dans la barre fixe de Tel pour un SMS, une
//       notification ou une discussion affichés (l'appel garde Raccrocher).
//   6e  « Le dernier envoi gagne » : une lumière, un effet, un stroboscope ou un média
//       envoyé depuis Lumière / Effets / Média retire d'abord les couches Tel
//       (appel, SMS, notification, discussion) des écrans visés, sauf ceux qu'une
//       séquence tient. Sinon l'envoi resterait caché sous la couche, opaque.
// Les gardes sont aux POINTS D'ENTRÉE de l'interface (envois sans cible explicite,
// mediaShowOn(fromUi), Tel) : la séquence réutilise les mêmes fonctions d'envoi, avec
// une cible explicite, et n'est donc jamais bloquée. Hors périmètre : les « looks »
// de la passerelle DMX (86-dmx-gateway.js) écrasent encore une séquence.
const _TG_TXT = {
  bannerRun: 'Séquence en cours · étape {n} / {total}', bannerPause: 'Séquence en pause · étape {n} / {total}', bannerEnd: 'Séquence terminée · étape {n} / {total}',
  subFull: '{ecrans} : vos envois sont suspendus pour ne pas couvrir la séquence.',
  subPartial: '{ecrans} est tenu par la séquence. Vos envois iront seulement à {libres}.',
  subPartialN: '{ecrans} sont tenus par la séquence. Vos envois iront seulement à {libres}.',
  take: 'Reprendre la main',
  askTitle: 'Une séquence est en cours',
  askText: 'Une séquence est en cours sur {ecrans}. Reprendre la main la met en pause auto : ce que vous envoyez remplacera son affichage. Envoyer quand même ?',
  askOk: 'Envoyer quand même',
  veilAria: 'Envois suspendus : une séquence est en cours. Toucher pour reprendre la main.',
  cutTitle: 'Lancer la séquence ?', cutText: 'Les autres envois seront coupés sur {ecrans} :\n{liste}', cutOk: 'Couper et lancer',
  cutLight: 'lumière {couleur}', cutEffect: 'effet « {nom} »', cutStrobe: 'stroboscope', cutMedia: 'média « {nom} »', cutMediaUnknown: 'média affiché',
  cutCall: 'appel « {nom} »', cutSms: 'SMS « {nom} »', cutNotif: 'notification « {nom} »', cutChat: 'discussion « {nom} » ouverte',
  andJoin: ' et ', more: '{n} autres écrans',
  onCall: 'Appel', onSms: 'SMS', onNotif: 'Notification', onChat: 'Discussion',
  onAt: 'affiché sur {ecrans}', onRemove: 'Retirer de l\'écran', onRemoveAria: 'Retirer {type} de l\'écran',
  chatRemoved: 'Discussion « {nom} » retirée de l\'écran', chatRemovedSub: 'Le dernier envoi (lumière, effet ou média) la remplace.',
};
const _tgTpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));

// ── Écrans tenus par la séquence ──
// Union des écrans de ses étapes, tant qu'elle est commencée (en cours, en pause auto,
// terminée) et que l'utilisateur n'a pas repris la main ; levée par Recommencer.
function seqOwnedIds() {
  if (typeof _seqRun === 'undefined' || _seqRun.state === 'idle' || _seqRun.released) return new Set();
  const out = new Set();
  for (const s of _seq.steps) for (const id of seqStepIds(s)) out.add(id);
  return out;
}
// Écrans libres / tenus parmi ids
function tabSplit(ids) {
  const owned = seqOwnedIds();
  const held = [], free = [];
  for (const id of ids) (owned.has(id) ? held : free).push(id);
  return { free, held };
}
// État de l'interface pour la cible courante : none · full (tout est tenu) · partial
function tabHoldState() {
  const ids = scrTargetIds();
  const { free, held } = tabSplit(ids);
  if (!held.length) return { mode: 'none', held, free };
  return { mode: free.length ? 'partial' : 'full', held, free };
}
function _tgNames(ids) {
  const n = ids.map(scrName);
  if (n.length <= 2) return n.join(' + ');
  return n.slice(0, 2).join(' + ') + ' + ' + _tgTpl(_TG_TXT.more, { n: n.length - 2 });
}

// ── Qualification d'un ordre sortant ──
// light : lumière, effet, stroboscope ; torch ; media : affichage d'un média ; tel : appel, SMS, notification.
// Les arrêts (active:false, media-stop, torche éteinte), Noir, Identifier et le transport média : null (toujours permis).
function _tgKind(m) {
  switch (m && m.type) {
    case 'color': return 'light';
    case 'effect': case 'strobe': return m.active === false ? null : 'light';
    case 'torch-onoff': return m.on ? 'torch' : null;
    case 'torch-dim': return 'torch';
    case 'torch-effect': return m.effect === 'stop' ? null : 'torch';
    case 'media:show': return 'media';
    case 'media-img-start': return m.show === false || String(m.mediaId || '').startsWith('__') ? null : 'media';
    case 'call:start': return 'tel';
  }
  return null;
}
// Porte de scrAddress (28-screens.js) pour les ordres SANS cible explicite : ceux de
// l'interface. Les envois de la séquence portent toujours une cible explicite.
// Renvoie l'ordre (restreint aux écrans libres si la cible est partielle) ou null (suspendu).
function tabGateMsg(m) {
  const kind = _tgKind(m);
  if (!kind || (m.target !== undefined && m.target !== null)) return m;
  const ids = scrTargetIds();
  if (!ids.length) return m;
  const { free, held } = tabSplit(ids);
  if (held.length) {
    if (!free.length) { tabAskTakeOver(); return null; }
    m = Object.assign({}, m, { target: { screens: free } });
  }
  if (kind === 'light' || kind === 'media') tabSendClear(free);
  return m;
}
// Garde des points d'entrée à cible explicite (média, Tel) : renvoie les écrans à servir, ou
// null (tout est tenu : la confirmation s'ouvre). Lumière et média retirent d'abord les couches Tel.
function tabSendIds(kind, ids, retry) {
  ids = ids || scrTargetIds();
  const { free, held } = tabSplit(ids);
  if (held.length && !free.length) { tabAskTakeOver(retry); return null; }
  if (kind === 'light' || kind === 'media') tabSendClear(free);
  return free;
}

// ── « Le dernier envoi gagne » : retrait des couches Tel avant une lumière ou un média ──
// Retire l'appel / SMS / notification (call:end) et la discussion (chat:close) des écrans ids
// d'après ce que la télécommande sait (scrState().call, _chat) : aucun envoi quand rien n'est
// affiché, donc un seul retrait par rafale (le curseur de couleur émet toutes les 40 ms).
// Renvoie vrai si un retrait a eu lieu.
function tabSendClear(ids, opts) {
  opts = opts || {};
  if (!ids.length || mode !== 'remote') return false;
  const chatIds = _chat.open ? (_chat.screens ? ids.filter((id) => _chat.screens.includes(id)) : ids.slice()) : [];
  const live = ids.filter((id) => scrState(id).call);
  if (live.length) sendMsg({ type: 'call:end', target: { screens: live } });
  if (chatIds.length) _tgCloseChat(chatIds, opts.undo !== false);
  const foreign = _tgForeignChat(ids, chatIds);
  if (foreign.length) sendMsg({ type: 'chat:close', target: { screens: foreign } });
  return live.length > 0 || chatIds.length > 0 || foreign.length > 0;
}
// Écrans de ids dont la discussion affichée n'est pas celle de cette télécommande (retrouvée à
// la reconnexion : tel:state, st.chatShown) : fermée par un simple chat:close, le fil local n'est pas touché.
function _tgForeignChat(ids, except) {
  return ids.filter((id) => scrState(id).chatShown && !(except || []).includes(id));
}
// Ferme la discussion sur ces écrans (tout le fil s'ils sont tous ceux de la discussion).
// undo : bandeau « Annuler » qui la rouvre.
function _tgCloseChat(chatIds, undo) {
  const all = _chat.screens ? _chat.screens.slice() : scrList();
  const rest = all.filter((id) => !chatIds.includes(id));
  const name = _chat.name;
  if (!rest.length) closeChat();
  else {
    sendMsg({ type: 'chat:close', target: { screens: chatIds.slice() } });
    _chat.screens = rest;
    chatSave(); renderChatPanel(); scrChanged();
  }
  if (undo) {
    undoSnack({
      text: _tgTpl(_TG_TXT.chatRemoved, { nom: name }), sub: _TG_TXT.chatRemovedSub,
      undo: () => { openChatOnTarget(true, all); },
    });
  }
}
// « Retirer de l'écran » (barre de Tel) : tout ce que Tel affiche sur la cible, ou un type
function telRemoveFromScreen(kind) {
  const ids = scrTargetIds();
  if (kind === 'chat') {
    const chatIds = _chat.open ? (_chat.screens ? ids.filter((id) => _chat.screens.includes(id)) : ids.slice()) : [];
    if (chatIds.length) _tgCloseChat(chatIds, false);
    const foreign = _tgForeignChat(ids, chatIds);
    if (foreign.length) sendMsg({ type: 'chat:close', target: { screens: foreign } });
  } else {
    const withCall = ids.filter((id) => scrState(id).call && (!kind || scrState(id).call.kind === kind));
    if (withCall.length) sendMsg({ type: 'call:end', target: { screens: withCall } });
  }
  renderTelOn();
}
// Ce que Tel affiche sur la cible : lignes { kind, nom, ids }
function telOnScreenItems() {
  const ids = scrTargetIds(), out = [];
  const add = (kind, nom, id) => {
    const it = out.find((x) => x.kind === kind && x.nom === nom);
    if (it) it.ids.push(id); else out.push({ kind, nom, ids: [id] });
  };
  for (const id of ids) {
    const c = scrState(id).call;
    if (c) add(c.kind === 'call' ? 'call' : c.kind === 'notif' ? 'notif' : 'sms', c.name || '…', id);
  }
  for (const id of ids) {
    if (_chat.open && (!_chat.screens || _chat.screens.includes(id))) add('chat', _chat.name || '…', id);
    else if (scrState(id).chatShown) add('chat', scrState(id).chatShown.name || '…', id); // discussion retrouvée à la reconnexion
  }
  return out;
}
function renderTelOn() {
  const el = document.getElementById('telOn');
  if (!el || mode !== 'remote') return;
  const items = telOnScreenItems();
  const T = _TG_TXT, lbl = { call: T.onCall, sms: T.onSms, notif: T.onNotif, chat: T.onChat };
  const key = JSON.stringify(items.map((i) => [i.kind, i.nom, i.ids.map(scrName)]));
  el.style.display = items.length ? '' : 'none';
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.innerHTML = items.map((i) => '<div class="on-row"><i class="nb-dot acc" aria-hidden="true"></i><span class="on-t"><b>' + escapeHtml(lbl[i.kind] + ' « ' + i.nom + ' »') + '</b>'
    + '<span>' + escapeHtml(_tgTpl(T.onAt, { ecrans: _tgNames(i.ids) })) + '</span></span>'
    + (i.kind === 'call' ? '' : '<button type="button" class="on-x" data-kind="' + i.kind + '" aria-label="' + escapeHtml(_tgTpl(T.onRemoveAria, { type: lbl[i.kind].toLowerCase() })) + '"><svg class="ic" aria-hidden="true"><use href="#i-x"></use></svg>' + escapeHtml(T.onRemove) + '</button>')
    + '</div>').join('');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#telOn .on-x');
  if (b) telRemoveFromScreen(b.dataset.kind);
});

// ── Reprendre la main ──
let _tgAskAt = -Infinity;
// Confirmation unique (jamais une par envoi : le curseur de couleur émet toutes les 40 ms)
function tabAskTakeOver(retry) {
  if (appConfirmShown() || Date.now() - _tgAskAt < 1200) return;
  const { held } = tabHoldState();
  const ecrans = held.length ? _tgNames(held) : _tgNames([...seqOwnedIds()].filter(scrKnown));
  openAppConfirm({ title: _TG_TXT.askTitle, text: _tgTpl(_TG_TXT.askText, { ecrans }), ok: _TG_TXT.askOk }, () => {
    _tgAskAt = Date.now();
    seqTakeOver();
    if (retry) retry();
  });
  _tgAskAt = Date.now();
}

// ── Bandeau + voile (6c) ──
const _TG_VEILED = ['content-light', 'content-effects', 'content-media', 'content-call'];
function _tgTabConcerned() {
  const t = navCurrentTab();
  return t === 'light' || t === 'effects' || t === 'media' || (t === 'scenario' && navCurrentSub() === 'call');
}
function renderTabHold() {
  if (mode !== 'remote') return;
  const sc = document.getElementById('nv-scroll');
  if (!sc) return;
  const st = _tgTabConcerned() ? tabHoldState() : { mode: 'none' };
  let b = document.getElementById('tabHold');
  if (st.mode === 'none') {
    if (b) b.remove();
  } else {
    const T = _TG_TXT, pos = seqPos() + 1, total = _seq.steps.length;
    const title = _tgTpl(_seqRun.state === 'running' ? T.bannerRun : _seqRun.state === 'ended' ? T.bannerEnd : T.bannerPause, { n: Math.max(1, pos), total });
    const sub = st.mode === 'full' ? _tgTpl(T.subFull, { ecrans: _tgNames(st.held) })
      : _tgTpl(st.held.length > 1 ? T.subPartialN : T.subPartial, { ecrans: _tgNames(st.held), libres: _tgNames(st.free) });
    const html = '<i class="nb-dot acc" aria-hidden="true"></i><span class="th-t"><b>' + escapeHtml(title) + '</b><span>' + escapeHtml(sub) + '</span></span>'
      + (st.mode === 'full' ? '<button type="button" class="th-b" id="tabHoldTake">' + escapeHtml(T.take) + '</button>' : '');
    if (!b) { b = document.createElement('div'); b.id = 'tabHold'; b.setAttribute('role', 'status'); sc.prepend(b); }
    b.className = 'tab-hold' + (st.mode === 'partial' ? ' soft' : '');
    if (b.dataset.key !== html) { b.dataset.key = html; b.innerHTML = html; }
  }
  // Voile : sur le contenu de l'onglet, seulement si tout est tenu ; le transport média et les arrêts restent atteignables
  for (const id of _TG_VEILED) {
    const c = document.getElementById(id);
    if (!c) continue;
    const on = st.mode === 'full' && _navContentId() === id;
    c.classList.toggle('tg-held', on);
    let v = c.querySelector(':scope > .tg-veil');
    if (on && !v) { v = document.createElement('div'); v.className = 'tg-veil'; v.setAttribute('role', 'button'); v.tabIndex = 0; v.setAttribute('aria-label', _TG_TXT.veilAria); c.prepend(v); }
    else if (!on && v) v.remove();
  }
}
function _navContentId() {
  const t = navCurrentTab();
  return t === 'scenario' ? 'content-call' : 'content-' + t;
}
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('#tabHoldTake')) tabAskTakeOver();
  else if (e.target.closest && e.target.closest('.tg-veil')) tabAskTakeOver();
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('tg-veil')) { e.preventDefault(); tabAskTakeOver(); }
});
