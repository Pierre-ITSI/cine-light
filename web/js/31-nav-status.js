// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ COQUE DE LA TÉLÉCOMMANDE : « EN COURS », BADGES, CLAVIER ══════════════════════════
// Phase 3 de la refonte. L'en-tête fixe porte, sous l'aperçu, une barre
// « en cours » avec UN seul « Tout arrêter » (stroboscope, effet, média,
// torche) ; la barre d'onglets du bas porte des pastilles :
//   · point sur Lumière  : stroboscope ou torche en marche
//   · point sur Effets   : effet en cours
//   · point sur Média    : média diffusé
//   · Écrans             : nombre d'écrans hors ligne (pastille jaune) et
//                          point orange quand un appairage attend sa
//                          vérification (rien pour un écran qui vient de se
//                          connecter).
// « Tout arrêter » ne fait QUE couper : il n'active rien, donc ne contourne
// jamais l'avertissement stroboscope (46-strobe-warning.js), qui garde la main
// sur toute (ré)activation.
// Second bandeau, #scnStrip (sous le bandeau lumière) : ce que le SCÉNARIO a
// posé sur les écrans (séquence en cours, discussion, appel, SMS, notification),
// avec son propre « Tout arrêter » (scnStopAll). Il ne touche jamais la lumière,
// et le « Tout arrêter » de la lumière ne touche jamais le Scénario.
const _NV_TXT = {
  strobe: 'Stroboscope actif',
  effect: (name) => 'Effet ' + name + ' en cours',
  media: 'Média en cours',
  torch: 'Torche allumée',
  more: (n) => ' · +' + n,
  screensLabel: 'Écrans',
  offline: (n) => ', ' + n + ' hors ligne',
  verify: ', vérification en attente',
};

// Ce qui tourne : [{ k, txt }] dans l'ordre d'importance
function navRunning() {
  const r = [];
  if (typeof strobeActive !== 'undefined' && strobeActive) {
    const hz = String(Math.round(strobeFreq * 10) / 10).replace('.', ',');
    r.push({ k: 'strobe', tab: 'light', txt: _NV_TXT.strobe + (strobeMode === 'random' ? '' : ' · ' + hz + ' Hz') });
  }
  if (typeof activeScreenEffect !== 'undefined' && activeScreenEffect) {
    const c = typeof EFFECT_CONFIG !== 'undefined' ? EFFECT_CONFIG[activeScreenEffect] : null;
    r.push({ k: 'effect', tab: 'effects', txt: _NV_TXT.effect(c ? c.name : activeScreenEffect) });
  }
  if (typeof _activeMediaId !== 'undefined' && _activeMediaId) r.push({ k: 'media', tab: 'media', txt: _NV_TXT.media });
  if (typeof remoteTorchOn !== 'undefined' && (remoteTorchOn || activeEffect)) r.push({ k: 'torch', tab: 'light', txt: _NV_TXT.torch });
  return r;
}

function renderNavStatus() {
  const strip = document.getElementById('nvStrip');
  if (!strip) return;
  const run = navRunning();
  strip.style.display = run.length ? 'flex' : 'none';
  strip.classList.toggle('on', run.length > 0);
  const txt = document.getElementById('nvStripTxt');
  if (txt) txt.textContent = run.length ? run[0].txt + (run.length > 1 ? _NV_TXT.more(run.length - 1) : '') : '';
  for (const t of ['light', 'effects', 'media']) {
    const b = document.getElementById('tab-' + t);
    if (b) b.classList.toggle('run', run.some((x) => x.tab === t));
  }
  renderScnStrip(); // le bandeau Scénario se range sous celui-ci (formats compacts)
}

// Nombre d'écrans hors ligne (liaison établie) : la pastille jaune de l'onglet Écrans
function navOfflineCount() {
  if (typeof _pairedScreens === 'undefined' || !remoteLinkUp()) return 0;
  return _offlineScreens(Date.now()).length;
}
function renderNavBadges() {
  const tab = document.getElementById('tab-screens');
  if (!tab) return;
  const n = navOfflineCount(), pend = typeof pairVerifyPending === 'function' && pairVerifyPending();
  const b = document.getElementById('screensBadge');
  if (b) { b.textContent = String(n); b.style.display = n ? '' : 'none'; }
  tab.classList.toggle('pend', pend);
  tab.setAttribute('aria-label', _NV_TXT.screensLabel + (n ? _NV_TXT.offline(n) : '') + (pend ? _NV_TXT.verify : ''));
}

// « Tout arrêter » : coupe strobe, effet, média et torche — jamais une activation
function stopEverything() {
  if (strobeActive) stopStrobe();
  if (activeScreenEffect) stopAllEffects();
  if (_activeMediaId) stopMediaBroadcast();
  if (remoteTorchOn) onRemoteTorchToggle(); // éteint aussi le motif de torche en cours
  else if (activeEffect) sendTorchEffect('stop');
  renderNavStatus();
}

// ── Bandeau Scénario (#scnStrip) ──
// Textes du bandeau (français, regroupés pour la traduction)
const _SCN_TXT = {
  seq: (n, total) => 'Séquence ' + n + ' / ' + total + ' en cours',
  call: (name, ringing) => 'Appel « ' + name + ' » · ' + (ringing ? 'sonne' : 'en ligne'),
  chat: (name) => 'Discussion « ' + name + ' » en cours',
  sms: (name) => 'SMS « ' + name + ' » affiché',
  notif: (name) => 'Notification « ' + name + ' » affichée',
  on: (ecrans) => 'sur ' + ecrans,
  next: (label) => 'prochaine : ' + label,
  noScreen: 'aucun écran',
  more: (n, kind) => '+' + n + ' ' + _SCN_MORE[kind][n > 1 ? 1 : 0] + ' ' + _SCN_MORE[kind][n > 1 ? 3 : 2],
  moreMixed: (n) => '+' + n + ' autres',
  askTitle: 'Arrêter la séquence ?',
  askText: 'La séquence s\'arrête à l\'étape {n} / {total} : elle reste en pause là où elle en est. Le SMS, l\'appel et la discussion affichés sont retirés de {ecrans} ; l\'écran redevient libre. GO reprend à l\'étape suivante.',
  askOk: 'Tout arrêter', askCancel: 'Continuer',
  undoText: 'Scénario arrêté',
  undoSub: 'Annuler rétablit la discussion, le SMS et la notification. Un appel raccroché ne se rappelle pas.',
};
// Autres affichages : nom (sing., plur.), participe (sing., plur.)
const _SCN_MORE = {
  call: ['appel', 'appels', 'affiché', 'affichés'], sms: ['SMS', 'SMS', 'affiché', 'affichés'],
  notif: ['notification', 'notifications', 'affichée', 'affichées'], chat: ['discussion', 'discussions', 'ouverte', 'ouvertes'],
};
const _SCN_ORDER = ['seq', 'chat', 'call', 'sms', 'notif']; // priorité : le premier s'affiche, les autres se comptent
// Dernier SMS ou notification envoyé à chaque écran (copie) : « Annuler » après « Tout arrêter » le renvoie
const _scnLast = new Map();
function scnNoteEntry(e, targets) {
  if (!e || (e.kind !== 'sms' && e.kind !== 'notif')) return;
  const ids = targets ? targets.flatMap((t) => (t && Array.isArray(t.screens) ? t.screens : [])) : scrTargetIds();
  for (const id of ids) _scnLast.set(id, Object.assign({}, e));
}
// Ce que le Scénario a posé sur les écrans, par priorité : [{ k, name, ids, ringing }]
function scnItems() {
  if (mode !== 'remote') return [];
  const out = [], all = scrList();
  if (typeof _seqRun !== 'undefined' && _seqRun.state === 'running') {
    out.push({ k: 'seq', name: '', ids: [...seqOwnedIds()].filter(scrKnown) });
  }
  if (_chat.open) out.push({ k: 'chat', name: _chat.name || '…', ids: _chat.screens ? _chat.screens.filter(scrKnown) : all.slice() });
  for (const id of all) {
    const sh = scrState(id).chatShown; // discussion retrouvée à la reconnexion
    if (sh && !(_chat.open && (!_chat.screens || _chat.screens.includes(id)))) out.push({ k: 'chat', name: sh.name || '…', ids: [id] });
  }
  for (const id of all) {
    const c = scrState(id).call;
    if (!c) continue;
    const k = c.kind === 'call' ? 'call' : c.kind === 'notif' ? 'notif' : 'sms', name = c.name || '…';
    const it = out.find((x) => x.k === k && x.name === name);
    if (it) it.ids.push(id);
    else out.push({ k, name, ids: [id], ringing: k === 'call' && c.state !== 'incall' });
  }
  return out.sort((a, b) => _SCN_ORDER.indexOf(a.k) - _SCN_ORDER.indexOf(b.k));
}
function _scnTitle(it) {
  switch (it.k) {
    case 'seq': return _SCN_TXT.seq(Math.max(1, seqPos() + 1), _seq.steps.length);
    case 'chat': return _SCN_TXT.chat(it.name);
    case 'call': return _SCN_TXT.call(it.name, it.ringing);
    case 'sms': return _SCN_TXT.sms(it.name);
    default: return _SCN_TXT.notif(it.name);
  }
}
// Texte d'un bandeau : titre (le premier élément), cible, autres affichages
function scnView(items, full) {
  const it = items[0], rest = items.slice(1), n = rest.length;
  const names = it.ids.length ? _tgNames(it.ids) : _SCN_TXT.noScreen;
  const kinds = [...new Set(rest.map((x) => x.k))];
  const more = !n ? '' : kinds.length === 1 ? _SCN_TXT.more(n, kinds[0]) : _SCN_TXT.moreMixed(n);
  const next = it.k === 'seq' && seqPending() ? seqStepLabel(seqPending()) : '';
  if (!full) return { title: _scnTitle(it) + ' · ' + names + (n ? ' · ' + more : ''), sub: '' };
  const sub = it.k === 'seq' ? names + (next ? ' · ' + _SCN_TXT.next(next) : '') : _SCN_TXT.on(names);
  return { title: _scnTitle(it), sub: sub + (n ? ' · ' + more : '') };
}
// Le bandeau Scénario : visible dès qu'il y a quelque chose à arrêter ; complet sur l'onglet
// Scénario, compact ailleurs et dès que le bandeau lumière est là (les deux empilés, A3)
function renderScnStrip() {
  const strip = document.getElementById('scnStrip');
  if (!strip) return;
  const items = scnItems(), light = document.getElementById('nvStrip');
  const on = items.length > 0, lightOn = !!light && light.classList.contains('on');
  const full = navCurrentTab() === 'scenario';
  strip.style.display = on ? 'flex' : 'none';
  strip.classList.toggle('cmp', on && (!full || lightOn));
  if (light) light.classList.toggle('cmp', on && lightOn);
  if (!on) return;
  const v = scnView(items, full);
  const t = document.getElementById('scnTitle'), s = document.getElementById('scnSub');
  if (t.textContent !== v.title) t.textContent = v.title;
  s.textContent = v.sub; s.style.display = v.sub ? '' : 'none';
}
// Toucher le texte : ouvre le Scénario (séquence si elle tourne, sinon Tel)
function scnOpen() { switchTab(typeof _seqRun !== 'undefined' && _seqRun.state === 'running' ? 'seq' : 'call'); }
// « Tout arrêter » du Scénario : jamais la lumière. Séquence en cours : confirmation, puis pause
// (position gardée) et écrans libérés. Sinon immédiat, avec « Annuler » (6 s) pour la discussion,
// le SMS et la notification (un appel raccroché ne se rappelle pas).
function scnStopAll() {
  if (mode !== 'remote') return;
  if (typeof _seqRun !== 'undefined' && _seqRun.state === 'running') {
    const shown = scnItems().find((x) => x.k === 'seq');
    const ecrans = shown && shown.ids.length ? _tgNames(shown.ids) : _SCN_TXT.noScreen;
    openAppConfirm({ title: _SCN_TXT.askTitle, text: _tgTpl(_SCN_TXT.askText, { n: Math.max(1, seqPos() + 1), total: _seq.steps.length, ecrans }), ok: _SCN_TXT.askOk, cancel: _SCN_TXT.askCancel }, () => scnHalt(true));
    return;
  }
  scnHalt(false);
}
// Arrêt effectif. seqWasRunning : la séquence tournait (elle reste en pause, sans « Annuler »)
function scnHalt(seqWasRunning) {
  const ids = scrList(), undo = [];
  // 1. Séquence : pause, position gardée, écrans libérés (comme « Reprendre la main »)
  if (typeof _seqRun !== 'undefined' && _seqRun.state !== 'idle') {
    if (!_seqRun.released) seqTakeOver();
    _scnClearSeqPhones();
  }
  // 2. Discussion : fermée (le fil reste enregistré), rouverte par Annuler
  if (_chat.open) {
    const chatIds = _chat.screens ? ids.filter((id) => _chat.screens.includes(id)) : ids.slice();
    const all = _chat.screens ? _chat.screens.slice() : ids.slice();
    if (chatIds.length) _tgCloseChat(chatIds, false); else closeChat();
    if (all.length) undo.push(() => openChatOnTarget(true, all));
  }
  const foreign = ids.filter((id) => scrState(id).chatShown && !(_chat.open && (!_chat.screens || _chat.screens.includes(id))));
  if (foreign.length) sendMsg({ type: 'chat:close', target: { screens: foreign } });
  // 3. Appels, SMS, notifications : retirés (call:end) ; SMS et notifications rendus par Annuler.
  // Lus avant l'ordre : l'envoi remet l'état de l'écran à vide (scrTrack).
  const live = ids.filter((id) => scrState(id).call);
  const back = new Map();
  for (const id of live) {
    const c = scrState(id).call, e = _scnLast.get(id);
    if (c.kind !== 'call' && e && e.kind === c.kind && (e.name || '') === (c.name || '')) {
      if (!back.has(e)) back.set(e, []);
      back.get(e).push(id);
    }
  }
  if (live.length) sendMsg({ type: 'call:end', target: { screens: live } });
  for (const [e, sids] of back) undo.push(() => { Promise.resolve(sendCallEntry(e, [{ screens: sids }])).catch(() => {}); });
  scrChanged();
  renderScnStrip();
  if (!seqWasRunning && undo.length) {
    undoSnack({ text: _SCN_TXT.undoText, sub: _SCN_TXT.undoSub, undo: () => undo.forEach((f) => f()) });
  }
}
// Faux téléphones de la séquence : remis à vide sur les écrans (rien d'affiché, ni SMS, ni
// notification, ni verrou). Position et réglages gardés dans le modèle : un GO les renvoie.
function _scnClearSeqPhones() {
  for (const [id, p] of _seqPhones) {
    if (!scrKnown(id)) continue;
    Object.assign(p, { mode: 'off', power: 'on', notifs: [], alert: null, sleep: null, awaitUnlock: null, chime: null, home: null, homeWall: false, offStyle: null });
    sendMsg({ type: 'phone:state', target: { screens: [id] }, mode: 'off', style: p.style, notifs: [] });
    _seqPhoneSent.delete(id);
  }
}

// Clavier (Android surtout) : un champ de texte actif masque la barre d'onglets,
// qui ne remonte pas au-dessus du clavier ni ne vole de hauteur à la saisie.
const _NV_TEXT_FIELD = 'input[type=text],input[type=search],input[type=number],input[type=tel],input[type=email],input[type=url],input[type=password],input:not([type]),textarea';
function navKeyboardSync() {
  const a = document.activeElement;
  document.body.classList.toggle('nv-kb', !!(a && a.matches && a.matches(_NV_TEXT_FIELD) && a.closest('#remote-mode')));
}
document.addEventListener('focusin', navKeyboardSync);
document.addEventListener('focusout', () => setTimeout(navKeyboardSync, 0));
