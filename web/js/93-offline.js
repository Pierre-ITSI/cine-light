// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ TOURNER SANS RÉSEAU (maquette 10) ══════════════════════════
// Vue « Tourner sans réseau » (télécommande) : choix de la liaison (Auto,
// Internet, Wi-Fi local, Bluetooth : 21-links.js) et « Préparation des
// écrans ». Accès : ligne « Liaison par défaut » des Réglages (maquette 13) et
// bouton de l'onglet QR (à côté de la passerelle DMX).
//
// Préparer = mettre en cache sur chaque écran, tant qu'une liaison à haut
// débit existe (Internet ou Wi-Fi local), tout ce qu'une commande peut
// ensuite appeler sans transfert, donc aussi en Bluetooth :
//   médias du pool (images, vidéos), sonneries et sons de notification
//   importés (choix de chaque type, appels et SMS enregistrés), photo et
//   bande son de chaque appel / SMS enregistré (ids dérivés du contenu,
//   82-call-list.js), fond de l'écran verrouillé.
// Ce qui manque à chaque écran se lit dans son état (28-screens.js : liste
// exacte de son cache annoncée par « caps », accusés media:cached). « Tout
// préparer maintenant » envoie à chaque écran joignable ce qui lui manque,
// élément par élément, en attendant son accusé ; rien ne s'affiche ni ne
// s'interrompt sur les écrans (show:false, offre WebRTC « cache »).
// L'écran garde ces médias en mémoire pour toute la session (jusqu'à la
// fermeture de l'app : politique de confidentialité, docs/OFFLINE.md § 6).
let _offOpen = false;
let _prep = null;            // préparation : { running, targets, cur: { id, sids, fracOf }, failed: Set }
let _prepItems = [];         // éléments à préparer (derniers calculés)
let _prepItemsSeq = 0;

function openOfflineView() {
  const v = document.getElementById('offline-view');
  if (!v) return;
  _offOpen = true;
  v.classList.add('open');
  v.scrollTop = 0;
  if (IN_NATIVE_APP) nativePost({ type: 'link:state?' });
  renderOfflineView();
  prepRefreshItems();
}
function closeOfflineView() {
  _offOpen = false;
  const v = document.getElementById('offline-view');
  if (v) v.classList.remove('open');
  if (typeof renderSettings === 'function' && document.getElementById('settings-view').style.display === 'flex') renderSettings();
}

// ── Ce qu'il faut préparer (même liste pour chaque écran) ──
function prepRingIds() {
  const ids = new Set();
  for (const k of RING_KINDS) if (ringLibHas(ringSettings[k].sound)) ids.add(ringSettings[k].sound);
  for (const e of [...callList.call, ...callList.sms, ...callList.notif]) if (ringLibHas(e.ringId)) ids.add(e.ringId);
  return [...ids];
}
// Ordre d'envoi : petits éléments d'abord (sons, photos), puis images, puis vidéos
async function prepItems() {
  const items = [];
  if (_lockWallData) items.push({ id: '__lockwall', cat: 'wall', data: _lockWallData });
  if (_notifWallData) items.push({ id: '__notifwall', cat: 'wall', data: _notifWallData }); // fond propre aux notifications
  for (const id of prepRingIds()) items.push({ id, cat: 'ring' });
  const seen = new Set();
  for (const e of [...callList.call, ...callList.sms, ...callList.notif]) {
    if (!e.hasPhoto && !e.hasAudio) continue;
    let ids;
    try { ids = await callEntryPrepIds(e); } catch (_) { continue; }
    if (ids.photo && !seen.has(ids.photo)) { seen.add(ids.photo); items.push({ id: ids.photo, cat: 'photo', entry: e }); }
    if (ids.audio && !seen.has(ids.audio)) { seen.add(ids.audio); items.push({ id: ids.audio, cat: 'audio', entry: e }); }
  }
  for (const m of _mediaPool) if (m.kind === 'img') items.push({ id: m.id, cat: 'media', media: m });
  for (const m of _mediaPool) if (m.kind === 'vid') items.push({ id: m.id, cat: 'media', media: m });
  return items;
}
async function prepRefreshItems() {
  const seq = ++_prepItemsSeq;
  const items = await prepItems();
  if (seq === _prepItemsSeq) { _prepItems = items; renderOfflineView(); }
  return items;
}
// L'écran a-t-il cet élément en cache (accusé) ?
function prepHas(sid, it) {
  const st = scrState(sid);
  if (!st.cached.has(it.id)) return false;
  // Fond verrouillé : un seul emplacement ; celui envoyé depuis a changé ?
  if (it.cat === 'wall') return !st.sent.has(it.id) || st.sent.get(it.id) === it.data;
  return true;
}

// ── État de chaque écran (maquette 10 : Prêt / 64 % / Non préparé) ──
const _PREP_CATS = [
  ['ring', 'sonnerie', 'sonneries'], ['wall', 'fond d\'écran', 'fonds d\'écran'],
  ['audio', 'bande son', 'bandes son'], ['photo', 'photo d\'appel', 'photos d\'appel'],
];
function _prepCount(items, sid) {
  const pool = items.filter((i) => i.cat === 'media');
  return { pool, poolHave: pool.filter((i) => prepHas(sid, i)).length };
}
function _prepCats(items, filter) {
  const out = [];
  for (const [cat, one, many] of _PREP_CATS) {
    const n = items.filter((i) => i.cat === cat && filter(i)).length;
    if (n) out.push(n > 1 ? n + ' ' + many : one);
  }
  return out;
}
function _prepMediaText(c) { return c.pool.length ? c.poolHave + '/' + c.pool.length + (c.pool.length > 1 ? ' médias' : ' média') : ''; }
function prepScreenStatus(sid, items) {
  const total = items.length;
  const have = items.filter((it) => prepHas(sid, it)).length;
  const c = _prepCount(items, sid);
  const media = _prepMediaText(c);
  const run = _prep && _prep.running;
  if (have === total) {
    const parts = (media ? [media] : []).concat(_prepCats(items, () => true));
    return { cls: 'ready', state: 'Prêt', pct: 100, detail: parts.length ? parts.join(' · ') : 'Rien à préparer pour l\'instant' };
  }
  const cur = run && _prep.cur && _prep.cur.sids.includes(sid) ? _prep.cur : null;
  const pct = Math.min(99, Math.floor(100 * (have + (cur && cur.fracOf ? cur.fracOf(sid) : 0)) / total));
  const counts = media || (have + '/' + total + ' éléments');
  if (_prep && _prep.failed.has(sid)) {
    return { cls: 'fail', state: 'Interrompu', pct, detail: 'Liaison perdue à ' + counts + ' — relancez la préparation' };
  }
  if (run && _prep.targets.includes(sid)) return { cls: 'busy', state: pct + ' %', pct, detail: counts + ' · transfert en cours' };
  const idle = have ? 'Incomplet' : 'Non préparé';
  const link = scrOnline(sid) ? scrLinkOf(sid) : 'off';
  if (link === 'off') return { cls: 'idle', state: idle, pct, detail: 'Ouvrez SetRemote sur « ' + scrName(sid) + ' » pour lancer la préparation' };
  if (link === 'ble') return { cls: 'idle', state: idle, pct, detail: 'Bluetooth seul : il faut Internet ou le Wi-Fi local pour le préparer' };
  const miss = _prepCats(items, (i) => !prepHas(sid, i));
  return { cls: 'idle', state: idle, pct, detail: [counts].concat(miss.length ? ['manque ' + miss.join(', ')] : []).join(' · ') };
}

// ── Rendu ──
const _LINK_DESC = {
  auto: 'Auto : Internet si disponible, sinon Wi-Fi local, sinon Bluetooth (commandes uniquement).',
  internet: 'Internet seul : relais chiffré de bout en bout, comme avant. Aucune liaison locale.',
  lan: 'Wi-Fi local seul : appareils sur le même routeur ou partage de connexion, sans Internet. Médias compris.',
  ble: 'Bluetooth seul : commandes uniquement. Les médias doivent être préparés avant.',
};
function _offLinkWarning(pref) {
  if (!IN_NATIVE_APP) return '';
  const wanted = pref === 'auto' ? LINK_MODES : pref === 'lan' || pref === 'ble' ? [pref] : [];
  const out = [];
  for (const m of wanted) {
    const s = linkNative[m];
    if (s.available === false) out.push(LINK_LABELS[m] + ' indisponible sur cet appareil' + (s.error ? ' : ' + s.error : ' (activez-le et autorisez SetRemote dans les réglages du système).'));
    else if (s.error) out.push(LINK_LABELS[m] + ' : ' + s.error);
  }
  return out.join(' ');
}
function renderOfflineView() {
  if (!_offOpen) return;
  const pref = linkPref();
  for (const p of LINK_PREFS) {
    const b = document.getElementById('offLink-' + p);
    if (!b) continue;
    const usable = p === 'auto' || p === 'internet' || linkModeSelectable(p);
    b.classList.toggle('active', p === pref);
    b.setAttribute('aria-checked', String(p === pref));
    b.disabled = !usable;
  }
  document.getElementById('offNeedsApp').style.display = IN_NATIVE_APP ? 'none' : 'block';
  _setHtml(document.getElementById('offLinkDesc'), escapeHtml(_LINK_DESC[pref]));
  const warn = _offLinkWarning(pref), w = document.getElementById('offLinkWarn');
  w.textContent = warn;
  w.style.display = warn ? 'block' : 'none';
  // Préparation des écrans
  const items = _prepItems, list = scrList();
  _setHtml(document.getElementById('offPrepRows'), list.length ? list.map((sid) => {
    const s = prepScreenStatus(sid, items);
    return '<div class="off-row ' + s.cls + '" data-id="' + sid + '">'
      + '<div class="off-row-head"><span class="off-name">' + escapeHtml(scrName(sid)) + '</span><span class="off-state">' + escapeHtml(s.state) + '</span></div>'
      + '<div class="off-bar"><div style="width:' + s.pct + '%"></div></div>'
      + '<div class="off-detail">' + escapeHtml(s.detail) + '</div></div>';
  }).join('') : '<div class="off-empty">Aucun écran appairé : appairez les écrans (onglet QR), puis préparez-les ici.</div>');
  const btn = document.getElementById('offPrepBtn'), note = document.getElementById('offPrepNote');
  let label = 'Tout préparer maintenant', on = false, why = '';
  const reach = list.filter((s) => scrOnline(s) && scrMediaReachable(s));
  const work = reach.some((s) => items.some((it) => !prepHas(s, it)));
  if (_prep && _prep.running) label = 'Préparation en cours…';
  else if (!list.length) why = '';
  else if (list.every((s) => items.every((it) => prepHas(s, it)))) label = 'Tout est prêt';
  else if (!mediaLinkUp()) why = IN_NATIVE_APP ? 'Pour préparer les écrans, il faut Internet ou le Wi-Fi local : le Bluetooth ne porte que les commandes.'
    : 'Pour préparer les écrans, il faut Internet.';
  else if (!work) why = 'Les écrans à préparer ne sont joignables ni par Internet ni en Wi-Fi local.';
  else on = true;
  btn.textContent = label;
  btn.disabled = !on;
  note.textContent = why;
  note.style.display = why ? 'block' : 'none';
  renderOfflineEntry();
}
// Bouton de l'onglet QR : liaison choisie quand ce n'est pas « Auto »
function renderOfflineEntry() {
  const st = document.getElementById('offEntryState');
  if (st) { const p = linkPref(); st.textContent = p === 'auto' ? '' : '· ' + linkPrefLabel(p); }
}

// ── « Tout préparer maintenant » ──
const _prepSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function prepRunAll() {
  if (mode !== 'remote' || (_prep && _prep.running)) return false;
  const items = await prepRefreshItems();
  const targets = scrList().filter((s) => scrOnline(s) && scrMediaReachable(s) && items.some((it) => !prepHas(s, it)));
  if (!targets.length || !mediaLinkUp()) { renderOfflineView(); return false; }
  _prep = { running: true, targets, cur: null, failed: new Set() };
  renderOfflineView();
  try {
    if (_mediaPool.length) sendPoolOrder({ screens: targets }); // n° des médias (console, avance au clic)
    for (const it of items) {
      if (!_prep.running) break;
      const lack = targets.filter((s) => !_prep.failed.has(s) && !prepHas(s, it));
      if (!lack.length) continue;
      // Écran qui n'est plus joignable à haut débit : interrompu pour lui seul
      for (const s of lack) if (!scrOnline(s) || !scrMediaReachable(s)) _prep.failed.add(s);
      const sids = lack.filter((s) => !_prep.failed.has(s));
      if (!sids.length) continue;
      _prep.cur = { id: it.id, sids, fracOf: null };
      renderOfflineView();
      await prepSendItem(it, sids);
      for (const s of sids) if (!prepHas(s, it) && (!scrOnline(s) || !scrMediaReachable(s))) _prep.failed.add(s);
      _prep.cur = null;
    }
  } catch (e) { console.warn('SetRemote : préparation', e); }
  finally { _prep.running = false; _prep.cur = null; renderOfflineView(); }
  return true;
}
// Attend l'accusé de chaque écran (ou la perte de sa liaison, ou le délai)
async function prepWait(it, sids, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && _prep && _prep.running) {
    if (sids.every((s) => prepHas(s, it) || !scrOnline(s) || !scrMediaReachable(s))) return;
    await _prepSleep(150);
  }
}
const _prepAckMs = (chars) => 8000 + Math.round(chars / 30); // ≈ 30 Ko/s au pire (broker public)
async function prepSendItem(it, sids) {
  if (it.cat === 'wall') {
    for (const s of sids) scrState(s).sent.delete(it.id);
    await ensureSlotImage(it.id, it.data, sids);
    return prepWait(it, sids, _prepAckMs((it.data || '').length));
  }
  if (it.cat === 'ring') {
    for (const s of sids) scrState(s).sent.delete(it.id);
    const meta = ringLib.find((t) => t.id === it.id);
    await ringSendIfMissing(it.id, sids);
    return prepWait(it, sids, _prepAckMs(meta ? meta.size * 1.4 : 1e6));
  }
  if (it.cat === 'photo' || it.cat === 'audio') {
    const data = (await callEntryAssets(it.entry))[it.cat];
    if (!data) return;
    await sendImageChunks(data, { mediaId: it.id, show: false, screens: sids });
    return prepWait(it, sids, _prepAckMs(data.length));
  }
  if (it.media.kind === 'img') {
    let data;
    try { data = await compressImageFile(it.media.file); } catch (_) { return; }
    await sendImageChunks(data, { mediaId: it.id, show: false, screens: sids });
    return prepWait(it, sids, _prepAckMs(data.length));
  }
  // Vidéo : un transfert par écran, l'un après l'autre (pair-à-pair, sinon fragments)
  for (const s of sids) {
    if (!_prep.running) return;
    await prepSendVideo(it, s);
  }
}
async function prepSendVideo(it, sid) {
  // Une diffusion lancée par la télécommande vers cet écran passe d'abord
  for (let g = 0; g < 1200 && _prep.running; g++) {
    const j = _vidJobs.get(sid);
    if (!j || j.prep || j.done || j.failed || j.closed) break;
    await _prepSleep(500);
  }
  if (!_prep.running || !scrOnline(sid) || !scrMediaReachable(sid)) return false;
  const job = _vidNewJob(sid, it.media.file, it.id, 0);
  job.prep = true; // mise en cache seulement (offre « cache », show:false)
  const st = scrState(sid);
  if (st.rtcBroken || (st.caps && st.caps.videoMode === 'b64')) _vidStartB64(job);
  else {
    _vidStartRtc(job);
    // Canal pair-à-pair jamais ouvert (réseau qui l'empêche) : envoi par fragments
    setTimeout(() => { if (_vidLive(job) && job.mode === 'rtc' && !job.chOpen && !job.failed) _vidRtcFailed(job); }, 15000);
  }
  if (_prep.cur) _prep.cur.fracOf = (s) => (s === sid ? Math.min(0.99, (job.pct || 0) / 100) : 0);
  const t0 = Date.now(), ms = 60000 + Math.round(it.media.file.size / 20);
  let lastPct = -1;
  while (Date.now() - t0 < ms) {
    if (scrState(sid).cached.has(it.id)) break;
    if (!_vidLive(job) || job.failed || !_prep.running || !scrOnline(sid) || !scrMediaReachable(sid)) break;
    if (job.pct !== lastPct) { lastPct = job.pct; renderOfflineView(); }
    await _prepSleep(200);
  }
  const ok = scrState(sid).cached.has(it.id);
  if (_vidJobs.get(sid) === job) { _vidCloseJob(job); _vidJobs.delete(sid); }
  return ok;
}
