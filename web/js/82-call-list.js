// ══════════════════════════ APPELS ET SMS ENREGISTRÉS (télécommande) ══════════════════════════
// Onglet Appel (maquette 18) : deux listes numérotées, « Appels » et « SMS »
// (SMS et messagerie). « + Enregistrer l'appel actuel » ajoute le formulaire
// (type, style, textes, sonnerie, photo, bande son…) à la liste de son type ;
// toucher une entrée la recharge dans le formulaire ; « Appeler n° X » la
// déclenche sur tous les écrans. Glisser-déposer pour changer l'ordre.
// Les 20 premières entrées de chaque liste sont les cibles des canaux Appel et
// SMS de la passerelle DMX : valeur n × 10 … n × 10 + 9 = entrée n (docs/DMX.md).
//
// Stockage : réglages en localStorage ; photos et bandes son (trop lourdes pour
// localStorage) dans IndexedDB, à défaut en mémoire le temps de la session.
// Son de l'entrée : choix du type au moment de l'enregistrement (son intégré
// ring, ou son importé ringId de la bibliothèque commune 81-ringtones.js) et
// son volume ringVolume ; un son importé supprimé depuis → son Classique.
const CALL_LIST_KEY = 'setremote-call-list-v1';
const CALL_LIST_MAX = 99;           // par liste
const CALL_LIST_DMX_ITEMS = 20;     // entrées accessibles depuis la console
const CALL_ASSETS_DB = 'setremote-call-assets';
let callList = { call: [], sms: [] };
let callListKind = 'call';
const _callListSel = { call: null, sms: null };

const _CALL_STYLE_NAMES = { glass: 'Verre', tonal: 'Tonal', minimal: 'Épuré' };
const _CALL_ENTRY_FIELDS = ['kind', 'style', 'name', 'label', 'msg', 'appName', 'appColor', 'ring', 'ringId', 'ringVolume', 'present', 'photoMode', 'autoAnswer', 'lock', 'hasPhoto', 'hasAudio'];

// ── Persistance ──
function _clListOf(kind) { return kind === 'call' ? 'call' : 'sms'; }
function _clSanitize(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(e.id)) return null;
  if (!['call', 'sms', 'chat'].includes(e.kind)) return null;
  const out = { id: e.id };
  for (const k of _CALL_ENTRY_FIELDS) if (e[k] !== undefined) out[k] = e[k];
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
  return out;
}
function loadCallList() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(CALL_LIST_KEY)); } catch (_) { o = null; }
  const pick = (arr, list) => (Array.isArray(arr) ? arr : []).map(_clSanitize).filter((e) => e && _clListOf(e.kind) === list).slice(0, CALL_LIST_MAX);
  callList = { call: pick(o && o.call, 'call'), sms: pick(o && o.sms, 'sms') };
}
function persistCallList() {
  try { localStorage.setItem(CALL_LIST_KEY, JSON.stringify({ v: 1, call: callList.call, sms: callList.sms })); } catch (_) {}
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
  if (m.kind !== 'call' && m.lock === undefined) m.lock = null;
  return m;
}

// Déclenche une entrée : photo / bande son / son importé d'abord (s'ils ne
// sont pas déjà en cache sur les écrans), puis l'appel. target : écrans visés
// (console), absent = tous les écrans (bouton « Appeler n° X »).
async function sendCallEntry(e, targets) {
  const assets = await callEntryAssets(e);
  const base = callEntryMessage(e, assets);
  // Photo, bande son, son importé : vers les écrans de l'appel (console : écrans
  // patchés concernés ; bouton : cible de la télécommande)
  const screens = targets ? [...new Set(targets.flatMap((t) => (t && Array.isArray(t.screens) ? t.screens : [])))] : undefined;
  await ensureCallAssets(assets.photo, assets.audio, base.ringId ? [base.ringId] : null, screens);
  if (!targets) { sendMsg(base); return; }
  for (const t of targets) sendMsg(Object.assign({}, base, { target: t }));
}

// ── Plage DMX d'une entrée (index 0 = n° 1) ──
function callEntryDmxRange(i) {
  return i < CALL_LIST_DMX_ITEMS ? ((i + 1) * 10) + '–' + ((i + 1) * 10 + 9) : '—';
}

function _clMeta(e) {
  const parts = [_CALL_STYLE_NAMES[e.style] || 'Verre'];
  if (e.kind === 'chat') parts.push('messagerie');
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
  const cb = document.getElementById('clKind-call'), sb = document.getElementById('clKind-sms');
  if (cb) { cb.textContent = 'Appels (' + callList.call.length + ')'; cb.classList.toggle('active', kind === 'call'); }
  if (sb) { sb.textContent = 'SMS (' + callList.sms.length + ')'; sb.classList.toggle('active', kind === 'sms'); }
  const who = document.getElementById('callListWho');
  if (who) who.textContent = kind === 'call' ? 'Appelant' : 'Expéditeur';
  const sel = _clSelected(kind);
  const rows = document.getElementById('callListRows');
  if (rows) {
    rows.innerHTML = list.map((e, i) => '<div class="cl-row' + (sel && e.id === sel.id ? ' selected' : '') + '" data-id="' + e.id + '" onclick="selectCallEntry(\'' + e.id + '\')">'
      + '<span class="cl-num">' + (i + 1) + '</span>'
      + '<span class="cl-main"><span class="cl-name">' + escapeHtml(e.name || 'Inconnu') + '</span><span class="cl-meta">' + escapeHtml(_clMeta(e)) + '</span></span>'
      + '<span class="cl-dmx">' + callEntryDmxRange(i) + '</span>'
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
    go.textContent = kind === 'call' ? 'Appeler n°' + n : 'Envoyer le SMS n°' + n;
  }
  renderCallListSaveLabel();
}
function renderCallListSaveLabel() {
  const b = document.getElementById('callListSave');
  if (b) b.textContent = '+ Enregistrer ' + (callKind === 'call' ? 'l\'appel actuel' : callKind === 'sms' ? 'le SMS actuel' : 'le message actuel');
}

function setCallListKind(k) {
  callListKind = k === 'sms' ? 'sms' : 'call';
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
  else { e.autoAnswer = 0; e.hasAudio = false; delete e.present; delete e.photoMode; }
  const photo = _callPhoto, audio = e.hasAudio ? _callAudioData : null;
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
  const kind = callList.call.some((e) => e.id === id) ? 'call' : 'sms';
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
  setCallStyle(_CALL_STYLE_NAMES[e.style] ? e.style : 'glass');
  setCallPresent(e.present === 'banner' ? 'banner' : 'full');
  setCallPhotoMode(e.photoMode === 'full' ? 'full' : 'avatar');
  ringApplyEntry(e); // son et volume de l'entrée pour son type
  val('callName', e.name || ''); val('callLabel', e.label || ''); val('callMsgText', e.msg || '');
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
}

// « Appeler n° X » / « Envoyer le SMS n° X »
async function triggerSelectedCallEntry() {
  const e = _clSelected(callListKind);
  if (!e) return;
  const n = callList[callListKind].indexOf(e) + 1;
  _setCallStatusUI(e.kind === 'call' ? '📞 Appel n°' + n + ' envoyé…' : '💬 SMS n°' + n + ' envoyé');
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
