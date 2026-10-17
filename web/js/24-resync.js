// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ RESYNCHRONISATION (télécommande) ══════════════════════════
// Un écran annonce ses capacités (« caps ») à chaque (re)connexion et en
// réponse au « hello » de la télécommande (envoyé à chaque (re)connexion de
// celle-ci). La télécommande renvoie alors à CET écran SON état attendu
// (28-screens.js : couleur, noir, luminosité, effet, strobe, avance au clic,
// fin de lecture, ordre du pool), adressé à lui seul (target.screens) : les
// autres écrans ne sont pas dérangés (une vidéo n'y redémarre plus). Ne part
// ensuite que ce qui lui MANQUE, d'après la liste exacte de son cache
// (caps.cached) et le média qu'il affiche (caps.active) : fond d'écran
// verrouillé, bande son, photo d'appel, sons importés utiles, média attendu.
// Plusieurs « caps » rapprochés (plusieurs écrans) : un seul envoi par état
// identique, adressé à ces écrans. Un écran sans identifiant (ancien) reçoit
// l'état « Tous », sans adresse.
let _resyncTimer = null, _resyncPending = new Map(); // screenId ('' : sans identifiant) → caps
const RESYNC_DELAY_MS = 250;

function remoteScheduleResync(caps) {
  if (mode !== 'remote') return;
  const sid = typeof caps.screenId === 'string' && scrKnown(caps.screenId) ? caps.screenId : '';
  if (sid) scrOnCaps(sid, caps);
  else if (typeof caps.blackout === 'boolean') scrAdoptBlackout(null, caps.blackout);
  _resyncPending.set(sid, caps);
  if (_resyncTimer) clearTimeout(_resyncTimer);
  _resyncTimer = setTimeout(remoteResync, RESYNC_DELAY_MS);
}

// Ce qui définit l'état « lumière et réglages » d'un écran
function _resyncSig(st) {
  return JSON.stringify([st.color, st.blackoutTouched ? st.blackout : null, st.brightness, st.effect && [st.effect.name, st.effect.params],
    st.strobe, st.autoAdvance, st.endMode]);
}
// État connu renvoyé tel quel (non suivi : rien de nouveau)
function _resyncLights(st, target) {
  const t = target ? { target } : {};
  _scrReplay = true;
  try {
    sendMsg(Object.assign({ type: 'color', color: st.color }, t));
    if (st.blackoutTouched) sendMsg(Object.assign({ type: 'blackout', on: st.blackout }, t));
    sendMsg(Object.assign({ type: 'screen:brightness', value: st.brightness / 100 }, t));
    if (st.effect) sendMsg(Object.assign({ type: 'effect', name: st.effect.name, active: true, params: st.effect.params }, t));
    if (st.strobe) sendMsg(Object.assign({}, st.strobe, t)); // après l'effet : le strobe prime
    sendMsg(Object.assign({ type: 'media:autoadvance', on: st.autoAdvance }, t));
    sendMsg(Object.assign({ type: 'media:endmode', mode: st.endMode }, t));
  } finally { _scrReplay = false; }
}

function remoteResync() {
  _resyncTimer = null;
  const pending = _resyncPending;
  _resyncPending = new Map();
  if (mode !== 'remote' || !sessionLinkUp()) return; // Internet ou liaison locale (21-links.js)
  const ids = [...pending.keys()].filter((id) => id && scrKnown(id));
  // 1) Lumière et réglages : un envoi par état identique
  const groups = new Map();
  for (const id of ids) {
    const sig = _resyncSig(scrState(id));
    if (!groups.has(sig)) groups.set(sig, { st: scrState(id), ids: [] });
    groups.get(sig).ids.push(id);
  }
  if (pending.has('')) {
    // Écran sans identifiant : impossible à adresser, il reçoit l'état « Tous »
    // (comme les écrans connus qui ont ce même état)
    _resyncLights(scrAll(), null);
    groups.delete(_resyncSig(scrAll()));
    sendPoolOrder();
  }
  for (const g of groups.values()) _resyncLights(g.st, { screens: g.ids });
  if (ids.length) sendPoolOrder({ screens: ids });
  // 2) Nom et groupes que l'écran ignore
  for (const id of ids) {
    const st = scrState(id);
    if (st.needsConfig) { st.needsConfig = false; scrPushConfig(id); }
  }
  // 3) Médias lourds manquants (d'après son cache exact)
  const lacking = (asset) => ids.filter((id) => !scrState(id).cached.has(asset));
  if (_lockWallData) { const l = lacking('__lockwall'); if (l.length) ensureLockWall(l); }
  // Photo / bande son : celles du formulaire (un appel de la liste renverra les siennes)
  const la = lacking('__callaudio');
  if (la.length) { if (_callAudioData) ensureCallAssets(null, _callAudioData, null, la); else renderCallAudioRow(); }
  const lp = lacking('__callphoto');
  if (lp.length && _callPhoto) ensureCallAssets(_callPhoto, null, null, lp);
  // Notification : icône et fond verrouillé propres (84-notification.js)
  const li = lacking('__notificon');
  if (li.length && _notifIcon) ensureCallAssets(_notifIcon, null, null, li, '__notificon');
  if (_notifWallData) { const l = lacking('__notifwall'); if (l.length) ensureSlotImage('__notifwall', _notifWallData, l); }
  // Discussion ouverte sur ces écrans : fil, messages postés et avatar renvoyés
  // (un écran rechargé retrouve la discussion où il en était, 83-discussion.js)
  if (ids.length) chatOnScreensResync(ids);
  // Sons importés absents : renvoyés s'ils servent encore (choix d'un type,
  // entrées 1 à 20 sous la passerelle), sinon simplement oubliés
  const rings = ringNeededIds();
  if (rings.length && ids.length) ensureCallAssets(null, null, rings, ids);
  // 4) Média attendu que l'écran n'affiche pas : media:show s'il l'a en cache,
  // sinon transfert complet (à lui seul)
  const toShow = new Map();
  for (const id of ids) {
    const st = scrState(id);
    if (st.reportedActive === undefined || st.media === st.reportedActive) continue; // inconnu (ancien écran) ou déjà affiché
    if (st.media) {
      if (!toShow.has(st.media)) toShow.set(st.media, []);
      toShow.get(st.media).push(id);
    } else if (st.reportedActive && _mediaPool.some((m) => m.id === st.reportedActive)) {
      st.media = st.reportedActive; // la télécommande ne lui demande rien : elle reprend ce qu'il affiche
    }
  }
  for (const [mid, sids] of toShow) {
    const it = _mediaPool.find((m) => m.id === mid);
    if (it) mediaShowOn(it, sids);
  }
  schedulePreload();
  scrChanged();
}
