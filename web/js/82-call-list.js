// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ APPELS, SMS ET NOTIFICATIONS ENREGISTRÉS (télécommande) ══════════════════════════
// Onglet Tel (maquette 18) : trois listes numérotées, « Appels », « SMS » et
// « Notifs » (notifications d'application, 84-notification.js : icône
// enregistrée comme la photo d'une entrée). Migration : une entrée de
// l'ancienne « messagerie » (kind chat / whatsapp) devient un SMS (mêmes
// textes, nom et couleur d'application). « + Enregistrer l'appel actuel » ajoute le formulaire
// (type, style, textes, sonnerie, photo, bande son…) à la liste de son type ;
// toucher une entrée la recharge dans le formulaire ; « Appeler n° X » la
// déclenche sur tous les écrans. Glisser-déposer pour changer l'ordre.
// Les 20 premières entrées des listes Appels et SMS sont les cibles des canaux
// Appel et SMS de la passerelle DMX : valeur n × 10 … n × 10 + 9 = entrée n
// (docs/DMX.md). Les notifications n'ont pas de canal : pas de déclenchement
// depuis la console (le canal SMS ne déclenche que les SMS).
//
// Stockage : réglages en localStorage ; photos et bandes son (trop lourdes pour
// localStorage) dans IndexedDB, à défaut en mémoire le temps de la session.
// Son de l'entrée : choix du type au moment de l'enregistrement (son intégré
// ring, ou son importé ringId de la bibliothèque commune 81-ringtones.js) et
// son volume ringVolume ; un son importé supprimé depuis → son Classique.
// Vibreur du type (vib, maquette 36b) : true seulement ; entrée d'avant le
// vibreur : ne vibre pas.
const CALL_LIST_KEY = 'setremote-call-list-v1';
const CALL_LIST_MAX = 99;           // par liste
const CALL_LIST_DMX_ITEMS = 20;     // entrées accessibles depuis la console
const CALL_ASSETS_DB = 'setremote-call-assets';
const CALL_LISTS = ['call', 'sms', 'notif'];
let callList = { call: [], sms: [], notif: [] };
let callListKind = 'call';
const _callListSel = { call: null, sms: null, notif: null };

const _CALL_STYLE_NAMES = { glass: 'Verre', tonal: 'Tonal', minimal: 'Épuré' };
const _CALL_ENTRY_FIELDS = ['kind', 'style', 'name', 'label', 'msg', 'appName', 'appColor', 'ring', 'ringId', 'ringVolume', 'vib', 'present', 'photoMode', 'autoAnswer', 'lock', 'hasPhoto', 'hasAudio', 'phone', 'received'];

// ── Persistance ──
function _clListOf(kind) { return kind === 'call' || kind === 'notif' ? kind : 'sms'; }
function _clSanitize(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(e.id)) return null;
  if (!['call', 'sms', 'notif', 'chat', 'whatsapp'].includes(e.kind)) return null;
  const out = { id: e.id };
  for (const k of _CALL_ENTRY_FIELDS) if (e[k] !== undefined) out[k] = e[k];
  if (out.kind === 'chat' || out.kind === 'whatsapp') out.kind = 'sms'; // ancienne messagerie → SMS
  if (out.kind !== 'notif') { delete out.phone; delete out.received; }
  // Son : valeurs reconnues seulement. Un SMS enregistré avant les sons par
  // type (sans ringVolume) portait la sonnerie de l'appel, que l'écran
  // ignorait : il garde son son d'origine (Classique).
  if (out.kind !== 'call' && out.ringVolume === undefined) out.ring = 'classic';
  if (out.ring !== undefined && !RING_BUILTINS.includes(out.ring)) out.ring = 'classic';
  if (out.ringId !== undefined && !(typeof out.ringId === 'string' && SRP.RING_ID_RE.test(out.ringId))) delete out.ringId;
  if (out.ringVolume !== undefined) {
    if (typeof out.ringVolume === 'number' && Number.isFinite(out.ringVolume)) out.ringVolume = Math.min(1, Math.max(0, out.ringVolume));
    else delete out.ringVolume;
  }
  if (out.vib !== true) delete out.vib;
  return out;
}
function loadCallList() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(CALL_LIST_KEY)); } catch (_) { o = null; }
  const pick = (arr, list) => (Array.isArray(arr) ? arr : []).map(_clSanitize).filter((e) => e && _clListOf(e.kind) === list).slice(0, CALL_LIST_MAX);
  callList = { call: pick(o && o.call, 'call'), sms: pick(o && o.sms, 'sms'), notif: pick(o && o.notif, 'notif') };
}
function persistCallList() {
  try { localStorage.setItem(CALL_LIST_KEY, JSON.stringify({ v: 1, call: callList.call, sms: callList.sms, notif: callList.notif })); } catch (_) {}
  if (typeof gwSyncTriggerEntries === 'function') gwSyncTriggerEntries();
}

// ── Photos et bandes son : IndexedDB (clé « id:photo » / « id:audio ») ──
const _clAssetMem = new Map(); // cache (photos) et repli sans IndexedDB
let _clDbP = null;
function _clDb() {
  if (_clDbP) return _clDbP;
  _clDbP = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
      const req = indexedDB.open(CALL_ASSETS_DB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('assets'); } catch (_) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  });
  return _clDbP;
}
function _clTx(mode, fn) {
  return _clDb().then((db) => new Promise((resolve) => {
    if (!db) { resolve(null); return; }
    try {
      const tx = db.transaction('assets', mode);
      const r = fn(tx.objectStore('assets'));
      tx.oncomplete = () => resolve(r && 'result' in r ? r.result : true);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch (_) { resolve(null); }
  }));
}
async function callAssetPut(key, value) {
  _clAssetMem.set(key, value);
  const ok = await _clTx('readwrite', (st) => st.put(value, key));
  if (ok && /:audio$/.test(key)) _clAssetMem.delete(key); // sons : relus à la demande
}
async function callAssetGet(key) {
  if (_clAssetMem.has(key)) return _clAssetMem.get(key);
  const v = await _clTx('readonly', (st) => st.get(key));
  if (typeof v !== 'string') return null;
  if (/:photo$/.test(key)) _clAssetMem.set(key, v);
  return v;
}
function callAssetDelete(key) {
  _clAssetMem.delete(key);
  return _clTx('readwrite', (st) => st.delete(key));
}

// Photo et bande son d'une entrée
async function callEntryAssets(e) {
  const [photo, audio] = await Promise.all([
    e && e.hasPhoto ? callAssetGet(e.id + ':photo') : null,
    e && e.hasAudio ? callAssetGet(e.id + ':audio') : null,
  ]);
  return { photo: safeImageData(photo), audio: safeAudioData(audio) };
}

// Message call:start d'une entrée (mêmes champs que le formulaire)
function callEntryMessage(e, assets) {
  const m = { type: 'call:start' };
  for (const k of _CALL_ENTRY_FIELDS) if (e[k] !== undefined && k !== 'ring' && k !== 'ringId' && k !== 'ringVolume') m[k] = e[k];
  // Son enregistré (un son importé supprimé depuis → son Classique)
  Object.assign(m, ringMsgFields(e.ringId || e.ring, e.ringVolume));
  m.hasPhoto = !!(assets && assets.photo);
  m.hasAudio = !!(assets && assets.audio);
  if (m.kind === 'sms' && m.lock === undefined) m.lock = null;
  if (m.kind === 'notif') { delete m.lock; m.hasAudio = false; }
  return m;
}

// ── Photo et bande son PRÉPARÉES (tournage sans réseau, 93-offline.js) ──
// Chaque entrée a, pour sa photo et sa bande son, un id dérivé du contenu
// (« __ph_ » / « __au_ » + 40 hex de SHA-256) : la préparation les met en cache
// sur chaque écran, où elles restent côte à côte (au lieu de l'emplacement
// unique __callphoto / __callaudio). Un appel ainsi préparé ne transporte plus
// que leurs ids : il part même en Bluetooth.
const _clPrepIds = new Map(); // entrée → { photo, audio } (ids, null si absents)
async function _clContentId(prefix, data) {
  const h = new Uint8Array(await SRP.getCrypto().subtle.digest('SHA-256', new TextEncoder().encode(data)));
  let s = '';
  for (let i = 0; i < 20; i++) s += h[i].toString(16).padStart(2, '0');
  return prefix + s;
}
async function callEntryPrepIds(e, assets) {
  const memo = _clPrepIds.get(e.id);
  if (memo) return memo;
  const a = assets || await callEntryAssets(e);
  const r = { photo: a.photo ? await _clContentId('__ph_', a.photo) : null, audio: a.audio ? await _clContentId('__au_', a.audio) : null };
  // Retenu seulement si tout ce que l'entrée annonce a été lu (stockage disponible)
  if ((!e.hasPhoto || r.photo) && (!e.hasAudio || r.audio)) {
    if (_clPrepIds.size >= 2 * CALL_LIST_MAX) _clPrepIds.delete(_clPrepIds.keys().next().value);
    _clPrepIds.set(e.id, r);
  }
  return r;
}

// Déclenche une entrée : photo / bande son / son importé d'abord (s'ils ne
// sont pas déjà en cache sur les écrans), puis l'appel. target : écrans visés
// (console), absent = tous les écrans (bouton « Appeler n° X »).
// Écrans qui ont déjà la photo et la bande son PRÉPARÉES de l'entrée : l'appel
// les désigne (photoId, audioId), rien n'est renvoyé. Bluetooth seul : rien
// n'est envoyé non plus ; un écran non préparé sonne sans photo ni bande son
// (jamais celles d'un autre appel restées en cache).
async function sendCallEntry(e, targets) {
  const assets = await callEntryAssets(e);
  const base = callEntryMessage(e, assets);
  const rings = base.ringId ? [base.ringId] : null;
  const prep = assets.photo || assets.audio ? await callEntryPrepIds(e, assets) : null;
  const groups = targets ? targets.map((t) => ({ t, ids: t && Array.isArray(t.screens) ? t.screens : [] })) : [{ t: null, ids: scrTargetIds() }];
  const ready = (s) => !!prep && scrKnown(s) && (!prep.photo || scrState(s).cached.has(prep.photo)) && (!prep.audio || scrState(s).cached.has(prep.audio));
  const bleOnly = linkBleOnly();
  const pk = e.kind === 'notif' ? '__notificon' : '__callphoto'; // icône d'une notification
  if (!bleOnly && !groups.some((g) => g.ids.some(ready))) {
    // Comme avant : photo, bande son, son importé vers les écrans de l'appel
    // (console : écrans patchés concernés ; bouton : cible de la télécommande)
    const screens = targets ? [...new Set(groups.flatMap((g) => g.ids))] : undefined;
    await ensureCallAssets(assets.photo, assets.audio, rings, screens, pk);
    if (!targets) { sendMsg(base); return; }
    for (const t of targets) sendMsg(Object.assign({}, base, { target: t }));
    return;
  }
  const withPrep = Object.assign({}, base, prep && prep.photo ? { photoId: prep.photo } : {}, prep && prep.audio ? { audioId: prep.audio } : {});
  const plain = bleOnly ? Object.assign({}, base, { hasPhoto: false, hasAudio: false }) : base;
  const all = [...new Set(groups.flatMap((g) => g.ids))];
  const lacking = all.filter((s) => !ready(s));
  if (!bleOnly && lacking.length) await ensureCallAssets(assets.photo, assets.audio, null, lacking, pk);
  if (rings) await ensureCallAssets(null, null, rings, targets ? all : undefined); // sons importés manquants (pas en Bluetooth seul)
  for (const g of groups) {
    if (!g.ids.length) { sendMsg(g.t ? Object.assign({}, plain, { target: g.t }) : plain); continue; }
    const r = g.ids.filter(ready), l = g.ids.filter((s) => !ready(s));
    if (!g.t && !l.length) { sendMsg(withPrep); continue; } // toute la cible courante
    if (r.length) sendMsg(Object.assign({}, withPrep, { target: { screens: r } }));
    if (l.length) sendMsg(Object.assign({}, plain, { target: { screens: l } }));
  }
}

// ── Plage DMX d'une entrée (index 0 = n° 1) ──
function callEntryDmxRange(i, kind) {
  return i < CALL_LIST_DMX_ITEMS && kind !== 'notif' ? ((i + 1) * 10) + '–' + ((i + 1) * 10 + 9) : '—';
}

function _clMeta(e) {
  const parts = [_CALL_STYLE_NAMES[e.style] || 'Verre'];
  if (e.kind === 'notif') {
    if (e.appName) parts.push(e.appName);
    if (e.hasPhoto) parts.push('icône');
    parts.push(e.present === 'lock' ? 'écran verrouillé' : 'bandeau');
    const tone = e.ringId ? ringName(e.ringId) : null;
    if (tone) parts.push('♪ ' + tone);
    return parts.join(' · ');
  }
  if (e.hasPhoto) parts.push('photo');
  if (e.hasAudio) parts.push('bande son');
  const tone = e.ringId ? ringName(e.ringId) : null; // son importé (s'il est encore dans la bibliothèque)
  if (tone) parts.push('♪ ' + tone);
  if (e.kind === 'call' && e.autoAnswer > 0) parts.push('décroché auto ' + e.autoAnswer + ' s');
  if (e.lock) parts.push('écran verrouillé');
  if (e.kind === 'call' && e.present === 'banner') parts.push('bandeau');
  return parts.join(' · ');
}

function _clSelected(kind) {
  const list = callList[kind];
  const id = _callListSel[kind];
  return list.find((e) => e.id === id) || list[0] || null;
}

// ── Rendu ──
function renderCallList() {
  const kind = callListKind, list = callList[kind];
  const cb = document.getElementById('clKind-call'), sb = document.getElementById('clKind-sms'), nb = document.getElementById('clKind-notif');
  if (cb) { cb.textContent = 'Appels (' + callList.call.length + ')'; cb.classList.toggle('active', kind === 'call'); }
  if (sb) { sb.textContent = 'SMS (' + callList.sms.length + ')'; sb.classList.toggle('active', kind === 'sms'); }
  if (nb) { nb.textContent = 'Notifs (' + callList.notif.length + ')'; nb.classList.toggle('active', kind === 'notif'); }
  const who = document.getElementById('callListWho');
  if (who) who.textContent = kind === 'call' ? 'Appelant' : kind === 'notif' ? 'Titre' : 'Expéditeur';
  const note = document.getElementById('callListNote');
  if (note) note.textContent = kind === 'notif'
    ? 'Les notifications ne se déclenchent pas depuis la console : seulement d\'ici. Glissez pour changer l\'ordre.'
    : 'Les 20 premiers appels et SMS se déclenchent depuis la console (mode Étendu 16). Valeur 0 : raccrocher. Glissez pour changer l\'ordre.';
  const sel = _clSelected(kind);
  const rows = document.getElementById('callListRows');
  if (rows) {
    rows.innerHTML = list.map((e, i) => '<div class="cl-row' + (sel && e.id === sel.id ? ' selected' : '') + '" data-id="' + e.id + '" onclick="selectCallEntry(\'' + e.id + '\')">'
      + '<span class="cl-num">' + (i + 1) + '</span>'
      + '<span class="cl-main"><span class="cl-name">' + escapeHtml(e.name || 'Inconnu') + '</span><span class="cl-meta">' + escapeHtml(_clMeta(e)) + '</span></span>'
      + '<span class="cl-dmx">' + callEntryDmxRange(i, kind) + '</span>'
      + '<span class="cl-grip" aria-label="Déplacer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 9h14M5 15h14"/></svg></span>'
      + '</div>').join('');
  }
  const empty = document.getElementById('callListEmpty');
  if (empty) empty.style.display = list.length ? 'none' : 'block';
  const actions = document.getElementById('callListActions');
  if (actions) actions.style.display = list.length ? 'flex' : 'none';
  const go = document.getElementById('callListGo');
  if (go && sel) {
    const n = list.indexOf(sel) + 1;
    go.textContent = (kind === 'call' ? 'Appeler n°{n}' : kind === 'notif' ? 'Envoyer la notification n°{n}' : 'Envoyer le SMS n°{n}').replace('{n}', n);
  }
  renderCallListSaveLabel();
}
function renderCallListSaveLabel() {
  const b = document.getElementById('callListSave');
  if (b) b.textContent = callKind === 'call' ? '+ Enregistrer l\'appel actuel' : callKind === 'notif' ? '+ Enregistrer la notification actuelle' : '+ Enregistrer le SMS actuel';
}

function setCallListKind(k) {
  callListKind = CALL_LISTS.includes(k) ? k : 'call';
  renderCallList();
}

// ── Actions ──
async function saveCurrentCall() {
  const fields = callFormFields();
  const list = _clListOf(fields.kind);
  if (callList[list].length >= CALL_LIST_MAX) return null;
  const e = Object.assign({ id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }, fields);
  // Son du type au moment de l'enregistrement : volume toujours noté (100 % compris)
  e.ringVolume = ringSettings[_ringKind(e.kind)].vol;
  // Réglages masqués pour ce type : non enregistrés (bande son et décroché
  // n'existent que pour un appel, l'écran verrouillé que pour un message)
  if (e.kind === 'call') delete e.lock;
  else if (e.kind === 'notif') { delete e.lock; delete e.label; e.autoAnswer = 0; e.hasAudio = false; delete e.photoMode; }
  else { e.autoAnswer = 0; e.hasAudio = false; delete e.present; delete e.photoMode; }
  // Notification : l'icône est rangée comme la photo de l'entrée
  const photo = e.kind === 'notif' ? _notifIcon : _callPhoto, audio = e.hasAudio ? _callAudioData : null;
  callList[list].push(e);
  _callListSel[list] = e.id;
  callListKind = list;
  persistCallList();
  renderCallList();
  await Promise.all([
    photo ? callAssetPut(e.id + ':photo', photo) : null,
    audio ? callAssetPut(e.id + ':audio', audio) : null,
  ]);
  return e.id;
}

// Toucher une entrée : la sélectionne et la recharge dans le formulaire
let _clLoadSeq = 0;
async function selectCallEntry(id) {
  if (_clSuppressClick) return; // clic résiduel après un glisser-déposer
  const kind = CALL_LISTS.find((k) => callList[k].some((e) => e.id === id)) || 'call';
  const e = callList[kind].find((x) => x.id === id);
  if (!e) return;
  _callListSel[kind] = id;
  callListKind = kind;
  renderCallList();
  await loadCallEntryIntoForm(e);
}

async function loadCallEntryIntoForm(e) {
  const seq = ++_clLoadSeq;
  const val = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setCallKind(e.kind);
  if (e.kind === 'notif') {
    ringApplyEntry(e);
    renderCallListSaveLabel();
    const assets = await callEntryAssets(e);
    if (seq !== _clLoadSeq) return;
    notifApplyEntry(e, assets.photo); // 84-notification.js
    return;
  }
  setCallStyle(_CALL_STYLE_NAMES[e.style] ? e.style : 'glass');
  setCallPresent(e.present === 'banner' ? 'banner' : 'full');
  setCallPhotoMode(e.photoMode === 'full' ? 'full' : 'avatar');
  ringApplyEntry(e); // son et volume de l'entrée pour son type
  val('callName', e.name || ''); val('callLabel', e.label || ''); val('callMsgText', e.msg || '');
  renderCallerState();
  if (e.kind !== 'call') {
    val('callAppName', e.appName || ''); val('callAppColor', safeHexColor(e.appColor, '#2f8cf0'));
    for (const id of ['callAppName', 'callAppColor']) { const el = document.getElementById(id); if (el) el.dataset.touched = '1'; }
  }
  const lt = document.getElementById('lockToggle'); if (lt) lt.checked = !!e.lock;
  val('lockTime', e.lock ? e.lock.time || '' : ''); val('lockDate', e.lock ? e.lock.date || '' : '');
  val('callAutoSlider', String(e.autoAnswer || 0)); onCallAutoChange();
  renderCallListSaveLabel();
  const assets = await callEntryAssets(e);
  if (seq !== _clLoadSeq) return; // une autre entrée a été touchée entre-temps
  _callPhoto = assets.photo;
  const pv = document.getElementById('callPhotoPreview');
  if (pv) pv.style.backgroundImage = _callPhoto ? 'url(' + _callPhoto + ')' : '';
  _callPhotoSending = _callPhoto ? ensureCallAssets(_callPhoto, null) : null;
  // Bande son : nom et durée gardés si c'est déjà celle du formulaire
  const sameAudio = !!assets.audio && assets.audio === _callAudioData;
  if (!sameAudio) {
    _callAudioSeq++;
    _callAudioData = assets.audio;
    _callAudioName = _callAudioData ? 'Bande son de l\'entrée' : ''; _callAudioDur = 0;
    if (_callAudioData) _measureCallAudio(_callAudioSeq);
  }
  renderCallAudioRow();
  if (_callAudioData) ensureCallAssets(null, _callAudioData);
  renderCallerState(); // 79-callers.js : appelant enregistré ?
  renderTelStyle();
}

// « Appeler n° X » / « Envoyer le SMS n° X »
async function triggerSelectedCallEntry() {
  const e = _clSelected(callListKind);
  if (!e) return;
  const n = callList[callListKind].indexOf(e) + 1;
  _setCallStatusUI((e.kind === 'call' ? '📞 Appel n°{n} envoyé…' : e.kind === 'notif' ? '🔔 Notification n°{n} envoyée' : '💬 SMS n°{n} envoyé').replace('{n}', n));
  await sendCallEntry(e);
}

function deleteSelectedCallEntry() {
  const kind = callListKind, e = _clSelected(kind);
  if (!e) return;
  const i = callList[kind].indexOf(e);
  if (!confirm('Supprimer « ' + (e.name || 'Inconnu') + ' » (n°' + (i + 1) + ') ? Les numéros suivants avancent d\'un rang.')) return;
  callList[kind].splice(i, 1);
  _callListSel[kind] = (callList[kind][Math.min(i, callList[kind].length - 1)] || {}).id || null;
  callAssetDelete(e.id + ':photo'); callAssetDelete(e.id + ':audio');
  persistCallList();
  renderCallList();
}

// ── Réordonnancement par glisser-déposer (poignée, ou appui maintenu sur la ligne) ──
let _clDrag = null, _clSuppressClick = false;
(function initCallListDrag() {
  const box = document.getElementById('callListRows');
  if (!box) return;
  const HOLD = 200, TOL = 12;
  const blockScroll = (e) => e.preventDefault();
  box.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.cl-row');
    if (!row || (e.pointerType === 'mouse' && e.button !== 0)) return;
    _clDrag = { row, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, active: false, ghost: null };
    if (e.target.closest('.cl-grip')) { e.preventDefault(); startDrag(); }
    else _clDrag.timer = setTimeout(startDrag, HOLD);
  });
  function startDrag() {
    const d = _clDrag; if (!d || d.active) return;
    d.active = true;
    const r = d.row.getBoundingClientRect();
    d.dx = d.x - r.left; d.dy = d.y - r.top;
    const g = d.row.cloneNode(true);
    g.classList.add('cl-ghost'); g.classList.remove('selected');
    g.style.width = r.width + 'px'; g.style.left = r.left + 'px'; g.style.top = (d.y - d.dy) + 'px';
    document.body.appendChild(g);
    d.ghost = g;
    d.row.classList.add('cl-drag-src');
    document.addEventListener('touchmove', blockScroll, { passive: false });
    if (navigator.vibrate) navigator.vibrate(30);
  }
  document.addEventListener('pointermove', (e) => {
    const d = _clDrag; if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.active) {
      if (Math.abs(d.x - d.sx) > TOL || Math.abs(d.y - d.sy) > TOL) { clearTimeout(d.timer); _clDrag = null; }
      return;
    }
    d.ghost.style.top = (d.y - d.dy) + 'px';
    const over = document.elementFromPoint(d.sx, d.y);
    const t = over && over.closest ? over.closest('#callListRows .cl-row') : null;
    if (t && t !== d.row) {
      const rect = t.getBoundingClientRect();
      t.parentNode.insertBefore(d.row, (d.y - rect.top) < rect.height / 2 ? t : t.nextSibling);
    }
  });
  function endDrag() {
    const d = _clDrag; if (!d) return;
    clearTimeout(d.timer);
    _clDrag = null;
    if (!d.active) return;
    document.removeEventListener('touchmove', blockScroll);
    if (d.ghost) d.ghost.remove();
    d.row.classList.remove('cl-drag-src');
    const order = [...document.querySelectorAll('#callListRows .cl-row')].map((el) => el.dataset.id);
    callList[callListKind].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    _clSuppressClick = true; setTimeout(() => { _clSuppressClick = false; }, 350);
    persistCallList();
    renderCallList();
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
})();
