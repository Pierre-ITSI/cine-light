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
//
// Noms et mise à jour (maquettes validées 43, 43b, 43c) :
//   • Chaque entrée peut avoir un nom (title, 40 caractères) ; sans nom (ancienne
//     entrée, champ vidé) : « nom · sous-titre » (notification : titre, sinon
//     application). Ce nom sert partout où les entrées sont listées : la liste,
//     les étapes de la Séquence et leurs choix (callEntryName).
//   • Rangée « + Enregistrer / ↻ Mettre à jour » au-dessus de la liste (même
//     composant que les Effets). « + Enregistrer » ouvre la feuille « Nom de
//     l'enregistrement » (proposition préremplie ; laissée telle quelle ou vidée :
//     pas de nom propre) et crée TOUJOURS une nouvelle entrée.
//   • Entrée CHARGÉE (touchée dans la liste, ou « Charger dans l'onglet ») :
//     « ↻ Mettre à jour » (grisé tant qu'aucune n'est chargée) y range les réglages
//     actuels du formulaire, sans feuille (même id, même numéro donc même plage
//     DMX, même nom), puis bandeau « « nom » mis à jour · Annuler » qui restitue
//     l'ancienne entrée, sa photo et sa bande son. L'état « chargée » prend fin
//     quand le type du formulaire change, quand on change d'onglet de liste,
//     quand l'entrée est supprimée, après « + Enregistrer » et au rechargement
//     des listes (licence).
//   • « ⋯ » d'une ligne (la poignée reste) : charger, renommer, mettre à jour
//     avec les réglages actuels (formulaire du même type), dupliquer (en fin de
//     liste, photo et bande son copiées), supprimer (confirmation).
// Aperçu sans licence (77-licence-ui.js) : enregistrer, renommer, mettre à
// jour, dupliquer et supprimer sont verrouillés ; charger et déclencher restent.
const CALL_LIST_KEY = 'setremote-call-list-v1';
const CALL_LIST_MAX = 99;           // par liste
const CALL_LIST_DMX_ITEMS = 20;     // entrées accessibles depuis la console
const CALL_ASSETS_DB = 'setremote-call-assets';
const CALL_LISTS = ['call', 'sms', 'notif'];
let callList = { call: [], sms: [], notif: [] };
let callListKind = 'call';
const _callListSel = { call: null, sms: null, notif: null };

const CALL_TITLE_MAX = 40;
const _CALL_STYLE_NAMES = { glass: 'Verre', tonal: 'Tonal', minimal: 'Épuré' };
// Textes affichés (maquettes 43 à 43c), regroupés pour la traduction ({…} : valeurs)
const _CL_TXT = {
  unknown: 'Inconnu', notifDefault: 'Notification',
  sheetCall: 'Enregistrer l\'appel', sheetSms: 'Enregistrer le SMS', sheetNotif: 'Enregistrer la notification',
  sheetRename: 'Renommer l\'enregistrement',
  nameLabel: 'Nom de l\'enregistrement',
  nameNote: 'Vide : « {defaut} ». Le nom sert dans la liste, la Séquence et la console (n° {n}, DMX {plage}).',
  nameNoteNoDmx: 'Vide : « {defaut} ». Le nom sert dans la liste et la Séquence (n° {n}).',
  cancel: 'Annuler', ok: 'Enregistrer', close: 'Fermer',
  updated: '« {nom} » mis à jour',
  menuLoad: 'Charger dans l\'onglet', menuRename: 'Renommer', menuUpdate: 'Mettre à jour avec les réglages actuels',
  menuDuplicate: 'Dupliquer', menuDelete: 'Supprimer', menuAria: 'Charger, renommer, mettre à jour, dupliquer, supprimer',
  menuTitle: '« {nom} »', copy: '{nom} (copie)',
  menuUp: 'Monter d\'un rang', menuDown: 'Descendre d\'un rang',
  menuConsole: 'Console : {genre} n° {n}', menuNoConsole: 'Hors console (au-delà du n° 20)', menuNoChannel: 'Pas de canal console',
  deleted: '« {nom} » supprimé', deletedSub: 'Les n° suivants ont avancé d\'un rang', deletedSubDmx: 'Les n° suivants ont avancé d\'un rang · DMX inclus',
  // Liste enregistrée de l'onglet Tel (phase 4)
  titleCall: 'Appels enregistrés', titleSms: 'SMS enregistrés', titleNotif: 'Notifications enregistrées',
  playAria: 'Lancer « {nom} »', moveUp: 'Monter « {nom} »', moveDown: 'Descendre « {nom} »', loaded: 'chargé',
  allTitle: 'Tout voir', allCall: 'Appels ({n})', allSms: 'SMS ({n})', allNotif: 'Notifications ({n})',
  dmxTitle: 'Console DMX', dmxRow: 'n° {n} · {nom}',
  dmxNote: 'Les 20 premiers appels et SMS se déclenchent depuis la console (mode Étendu 16) : valeur n × 10 … n × 10 + 9 = entrée n. Valeur 0 : raccrocher. Glissez ou utilisez Trier / ⋯ pour changer l\'ordre.',
  dmxNoteNotif: 'Les notifications ne se déclenchent pas depuis la console : seulement d\'ici.',
  dmxEmpty: 'Aucune entrée dans cette liste.',
  sentCall: 'Appel n°{n} envoyé…', sentSms: 'SMS n°{n} envoyé', sentNotif: 'Notification n°{n} envoyée',
  genreCall: 'appel', genreSms: 'SMS', genreNotif: 'notification',
};
const _clTpl = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));
const _clLine = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, CALL_TITLE_MAX).trim() : '');
// Nom par défaut d'une entrée (ou du formulaire) : « nom · sous-titre » ; notification : titre, sinon application
function callEntryDefaultName(e) {
  if (e.kind === 'notif') return String(e.name || e.appName || _CL_TXT.notifDefault);
  const n = e.name || _CL_TXT.unknown;
  return e.label ? n + ' · ' + e.label : n;
}
// Nom affiché d'une entrée : son nom propre, sinon le nom par défaut
function callEntryName(e) { return (e && e.title) || callEntryDefaultName(e || {}); }
const _CALL_ENTRY_FIELDS = ['kind', 'style', 'name', 'label', 'msg', 'appName', 'appColor', 'ring', 'ringId', 'ringVolume', 'vib', 'present', 'photoMode', 'autoAnswer', 'audio', 'lock', 'hasPhoto', 'hasAudio', 'phone', 'received'];

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
  if (out.ring !== undefined && !ringBuiltinOk(out.kind, out.ring)) out.ring = 'classic'; // sons de message : pas pour un appel
  if (out.ringId !== undefined && !(typeof out.ringId === 'string' && SRP.RING_ID_RE.test(out.ringId))) delete out.ringId;
  if (out.ringVolume !== undefined) {
    if (typeof out.ringVolume === 'number' && Number.isFinite(out.ringVolume)) out.ringVolume = Math.min(1, Math.max(0, out.ringVolume));
    else delete out.ringVolume;
  }
  if (out.vib !== true) delete out.vib;
  // Audio de l'appel décroché (délai, sortie du son, proximité) : appels seulement ; entrée d'avant : absent
  // = ancien comportement (voix tout de suite, sortie du système)
  if (out.kind === 'call') {
    const au = callAudioNorm(out.audio);
    if (au) out.audio = au; else delete out.audio;
  } else delete out.audio;
  // Nom de l'enregistrement (maquette 43b) : facultatif (ancienne entrée : aucun)
  const title = _clLine(e.title);
  if (title) out.title = title;
  return out;
}
function loadCallList() {
  let o = null;
  try { o = JSON.parse(_lsGet(CALL_LIST_KEY)); } catch (_) { o = null; }
  const pick = (arr, list) => (Array.isArray(arr) ? arr : []).map(_clSanitize).filter((e) => e && _clListOf(e.kind) === list).slice(0, CALL_LIST_MAX);
  callList = { call: pick(o && o.call, 'call'), sms: pick(o && o.sms, 'sms'), notif: pick(o && o.notif, 'notif') };
}
function persistCallList() {
  _lsPut(CALL_LIST_KEY, JSON.stringify({ v: 1, call: callList.call, sms: callList.sms, notif: callList.notif }));
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
  if (_assetMasked(key)) return; // aperçu sans licence : en mémoire seulement (12-session.js)
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
  if (_assetMasked(key)) return Promise.resolve(true);
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
  Object.assign(m, ringMsgFields(e.ringId || e.ring, e.ringVolume, e.kind));
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
  if (e.lock) parts.push(e.kind === 'call' ? 'verrouillé' : 'écran verrouillé');
  if (e.kind === 'call' && e.present === 'banner') parts.push('bandeau');
  return parts.join(' · ');
}

function _clSelected(kind) {
  const list = callList[kind];
  const id = _callListSel[kind];
  return list.find((e) => e.id === id) || list[0] || null;
}

// ── Rendu ──
// Mode « Trier » (↑ ↓ sur chaque ligne, en plus du glisser) : accessibilité
let _clSort = false;
function toggleCallListSort() { _clSort = !_clSort; renderCallList(); }
function _clTitleOf(kind) { return kind === 'call' ? _CL_TXT.titleCall : kind === 'notif' ? _CL_TXT.titleNotif : _CL_TXT.titleSms; }
function renderCallList() {
  const kind = callListKind, list = callList[kind];
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  set('callListTitle', _clTitleOf(kind) + ' · ' + list.length);
  const loaded = callListLoadedEntry();
  const rows = document.getElementById('callListRows');
  if (rows) {
    rows.classList.toggle('sorting', _clSort);
    const mv = (cls, label, fn, id, off, ico) => '<button type="button" class="cl-mv ' + cls + '" aria-label="' + escapeHtml(label) + '"' + (off ? ' disabled' : '') + ' onclick="event.stopPropagation();' + fn + '(\'' + id + '\')">' + icon(ico) + '</button>';
    rows.innerHTML = list.map((e, i) => {
      const nom = callEntryName(e);
      return '<div class="cl-row' + (loaded && e.id === loaded.id ? ' selected' : '') + '" data-id="' + e.id + '" onclick="selectCallEntry(\'' + e.id + '\')">'
        + '<span class="cl-num">' + (i + 1) + '</span>'
        + '<span class="cl-main"><span class="cl-name">' + escapeHtml(nom) + '</span><span class="cl-meta">'
        + (loaded && e.id === loaded.id ? '<span class="cl-chip">' + escapeHtml(_CL_TXT.loaded) + '</span>' : '') + escapeHtml(_clMeta(e)) + '</span></span>'
        + (_clSort ? mv('up', _clTpl(_CL_TXT.moveUp, { nom }), 'moveCallEntryUp', e.id, i === 0, 'arrow-up') + mv('down', _clTpl(_CL_TXT.moveDown, { nom }), 'moveCallEntryDown', e.id, i === list.length - 1, 'arrow-down') : '')
        + '<button type="button" class="cl-play" aria-label="' + escapeHtml(_clTpl(_CL_TXT.playAria, { nom })) + '" onclick="event.stopPropagation();playCallEntry(\'' + e.id + '\')">' + icon('play') + '</button>'
        + '<button type="button" class="cl-more" aria-label="' + escapeHtml(_CL_TXT.menuAria) + '" onclick="event.stopPropagation();openCallEntryMenu(\'' + e.id + '\')">' + icon('ellipsis', 'ic-lg') + '</button>'
        + '</div>';
    }).join('');
  }
  const sort = document.getElementById('callListSort');
  if (sort) { sort.setAttribute('aria-pressed', _clSort ? 'true' : 'false'); sort.classList.toggle('on', _clSort); sort.style.display = list.length > 1 ? '' : 'none'; }
  // « + Enregistrer » / « ↻ Mettre à jour » : la mise à jour n'a de sens que pour une entrée chargée
  const sv = document.getElementById('clMemSave'), up = document.getElementById('clMemUpdate');
  if (sv) sv.disabled = list.length >= CALL_LIST_MAX;
  if (up) up.disabled = !loaded;
  const empty = document.getElementById('callListEmpty');
  if (empty) {
    empty.style.display = list.length ? 'none' : 'block';
    empty.textContent = 'Réglez ' + (kind === 'call' ? 'l\'appel' : kind === 'notif' ? 'la notification' : 'le SMS') + ' ci-dessus puis enregistrez-' + (kind === 'notif' ? 'la' : 'le') + ' : ' + (kind === 'notif' ? 'elle' : 'il') + ' prend le numéro suivant.';
  }
  const dmx = document.getElementById('callListDmx');
  if (dmx) dmx.style.display = kind === 'notif' ? 'none' : '';
  renderTelBar();
}
// Compat : l'état « chargé » est dessiné par renderCallList (puce sur la ligne)
function renderCallListSaveLabel() { renderCallList(); }

function setCallListKind(k) {
  callListKind = CALL_LISTS.includes(k) ? k : 'call';
  renderCallList(); // autre onglet de liste : l'entrée chargée ne l'est plus (callListLoadedEntry)
}

// ── Entrée chargée dans le formulaire (maquette 43) ──
let _clLoadedId = null;
// L'entrée chargée, tant que le formulaire et l'onglet de liste lui correspondent
// (même type) ; sinon l'état prend fin pour de bon
function callListLoadedEntry() {
  if (!_clLoadedId) return null;
  const kind = CALL_LISTS.find((k) => callList[k].some((e) => e.id === _clLoadedId));
  const e = kind ? callList[kind].find((x) => x.id === _clLoadedId) : null;
  if (!e || e.kind !== callKind || kind !== callListKind) { _clLoadedId = null; return null; }
  return e;
}

// ── Actions ──
const _clNewId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const _clKindOf = (id) => CALL_LISTS.find((k) => callList[k].some((x) => x.id === id)) || null;
// Réglages actuels du formulaire sous la forme d'une entrée (sans id ni nom),
// avec la photo (icône d'une notification) et la bande son qui l'accompagnent
function _clFormEntry() {
  const e = callFormFields();
  // Son du type au moment de l'enregistrement : volume toujours noté (100 % compris)
  e.ringVolume = ringSettings[_ringKind(e.kind)].vol;
  // Réglages masqués pour ce type : non enregistrés (bande son et décroché
  // n'existent que pour un appel, l'écran verrouillé que pour un message)
  if (e.kind === 'call') { if (!e.lock) delete e.lock; } // appel : lock = « verrouillé » (Verre)
  else if (e.kind === 'notif') { delete e.lock; delete e.label; e.autoAnswer = 0; e.hasAudio = false; delete e.photoMode; }
  else { e.autoAnswer = 0; e.hasAudio = false; delete e.present; delete e.photoMode; }
  // Notification : l'icône est rangée comme la photo de l'entrée
  const photo = e.kind === 'notif' ? _notifIcon : _callPhoto, audio = e.hasAudio ? _callAudioData : null;
  return { e, photo, audio };
}
// Nom saisi : gardé seulement s'il diffère du nom par défaut (sinon le nom suit l'entrée)
function _clTitleFor(e, value) {
  const t = _clLine(value);
  return t && t !== callEntryDefaultName(e) ? t : '';
}
// « Enregistrer » (après la feuille du nom, maquette 43b) ; title : nom de l'enregistrement (facultatif).
// over : champs qui remplacent ceux du formulaire (création sur place depuis l'éditeur d'étape :
// nom, sous-titre, message, titre…). La photo du formulaire ne suit que si le nom ne change pas.
async function saveCurrentCall(title, over) {
  if (licLocked('tel')) return; // aperçu sans licence (77-licence-ui.js)
  let { e: fields, photo, audio } = _clFormEntry();
  if (over) {
    if (fields.kind !== 'notif' && over.name !== undefined && String(over.name) !== String(fields.name)) { photo = null; fields.hasPhoto = false; }
    Object.assign(fields, over);
  }
  const list = _clListOf(fields.kind);
  if (callList[list].length >= CALL_LIST_MAX) return null;
  const e = Object.assign({ id: _clNewId() }, fields);
  const t = _clTitleFor(e, title);
  if (t) e.title = t;
  callList[list].push(e);
  _callListSel[list] = e.id;
  callListKind = list;
  _clLoadedId = null; // enregistrée comme nouvelle : plus d'entrée chargée
  persistCallList();
  renderCallList();
  await Promise.all([
    photo ? callAssetPut(e.id + ':photo', photo) : null,
    audio ? callAssetPut(e.id + ':audio', audio) : null,
  ]);
  return e.id;
}
// « ↻ Mettre à jour » : réglages actuels du formulaire dans l'entrée (même id,
// même place donc même numéro et même plage DMX, même nom). Photo et bande son
// réécrites sous les clés de l'entrée, ou effacées si elle n'en a plus (rien
// d'ancien ne reste) ; ids préparés oubliés (contenu changé). Le formulaire doit
// être du même type de liste ; false : impossible.
async function updateCallEntry(id, applied) {
  if (licLocked('tel')) return false; // aperçu sans licence (77-licence-ui.js)
  const kind = _clKindOf(id);
  if (!kind) return false;
  const { e: fields, photo, audio } = _clFormEntry();
  if (_clListOf(fields.kind) !== kind || callKind === 'discussion') return false;
  const list = callList[kind], i = list.findIndex((x) => x.id === id);
  const e = Object.assign({ id }, fields);
  if (list[i].title) e.title = list[i].title;
  list[i] = e;
  _callListSel[kind] = id;
  _clPrepIds.delete(id);
  persistCallList();
  renderCallList();
  if (typeof applied === 'function') applied(); // partie immédiate faite (bandeau « mis à jour »)
  await Promise.all([
    photo ? callAssetPut(id + ':photo', photo) : callAssetDelete(id + ':photo'),
    audio ? callAssetPut(id + ':audio', audio) : callAssetDelete(id + ':audio'),
  ]);
  return true;
}
function updateLoadedCallEntry() { const e = callListLoadedEntry(); return e ? updateCallEntry(e.id) : Promise.resolve(false); }
// « ↻ Mettre à jour » de la rangée : sans feuille, avec bandeau « mis à jour · Annuler » (6 s) qui
// restitue l'entrée d'avant, sa photo et sa bande son (relues avant l'écrasement)
async function updateLoadedCallEntryUndo() {
  const e = callListLoadedEntry();
  if (!e || licLocked('tel')) return false;
  const id = e.id, kind = _clKindOf(id);
  const prev = JSON.parse(JSON.stringify(e));
  const [photo, audio] = await Promise.all([prev.hasPhoto ? callAssetGet(id + ':photo') : null, prev.hasAudio ? callAssetGet(id + ':audio') : null]);
  return updateCallEntry(id, () => undoSnack({
    text: _clTpl(_CL_TXT.updated, { nom: callEntryName(prev) }),
    undo: async () => {
      const list = callList[kind], i = list.findIndex((x) => x.id === id);
      if (i < 0) return; // supprimée depuis
      list[i] = prev;
      _clPrepIds.delete(id);
      persistCallList();
      renderCallList();
      await Promise.all([
        photo ? callAssetPut(id + ':photo', photo) : callAssetDelete(id + ':photo'),
        audio ? callAssetPut(id + ':audio', audio) : callAssetDelete(id + ':audio'),
      ]);
    },
  }));
}
// Renommer : vide (ou le nom par défaut) → plus de nom propre
function renameCallEntry(id, value) {
  if (licLocked('tel')) return;
  const kind = _clKindOf(id);
  const e = kind && callList[kind].find((x) => x.id === id);
  if (!e) return;
  const t = _clTitleFor(e, value);
  if (t) e.title = t; else delete e.title;
  persistCallList();
  renderCallList();
}
// Copie en fin de liste, nommée « … (copie) » (photo et bande son copiées sous ses propres clés)
async function duplicateCallEntry(id) {
  if (licLocked('tel')) return null;
  const kind = _clKindOf(id);
  if (!kind || callList[kind].length >= CALL_LIST_MAX) return null;
  const src = callList[kind].find((x) => x.id === id);
  const e = Object.assign(JSON.parse(JSON.stringify(src)), { id: _clNewId(), title: _clLine(_clTpl(_CL_TXT.copy, { nom: callEntryName(src) })) });
  const [photo, audio] = await Promise.all([src.hasPhoto ? callAssetGet(src.id + ':photo') : null, src.hasAudio ? callAssetGet(src.id + ':audio') : null]);
  if (callList[kind].length >= CALL_LIST_MAX) return null; // la liste a pu se remplir pendant la lecture
  e.hasPhoto = !!photo; e.hasAudio = !!audio;
  await Promise.all([photo ? callAssetPut(e.id + ':photo', photo) : null, audio ? callAssetPut(e.id + ':audio', audio) : null]);
  callList[kind].push(e);
  persistCallList();
  renderCallList();
  return e.id;
}
// Monter / descendre d'un rang (bouton, en plus du glisser) : le numéro, donc la
// plage DMX, suit le rang
function moveCallEntry(id, d) {
  if (licLocked('tel')) return false; // aperçu sans licence : ordre figé
  const kind = _clKindOf(id);
  if (!kind) return false;
  const list = callList[kind], i = list.findIndex((x) => x.id === id), j = i + (d < 0 ? -1 : 1);
  if (j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  persistCallList();
  renderCallList();
  return true;
}
function moveCallEntryUp(id) { return moveCallEntry(id, -1); }
function moveCallEntryDown(id) { return moveCallEntry(id, 1); }
// Supprimer : la ligne disparaît aussitôt, bandeau « Annuler » 6 s (33-snackbar.js) qui
// remet l'entrée à son rang exact (donc à sa plage DMX) ; photo et bande son effacées à l'échéance
function deleteCallEntry(id) {
  if (licLocked('tel')) return false; // aperçu sans licence (77-licence-ui.js)
  const kind = _clKindOf(id);
  if (!kind) return false;
  const i = callList[kind].findIndex((x) => x.id === id), e = callList[kind][i];
  const prevSel = _callListSel[kind], wasLoaded = _clLoadedId === id;
  callList[kind].splice(i, 1);
  if (_callListSel[kind] === id || !callList[kind].some((x) => x.id === _callListSel[kind])) _callListSel[kind] = (callList[kind][Math.min(i, callList[kind].length - 1)] || {}).id || null;
  if (wasLoaded) _clLoadedId = null;
  _clPrepIds.delete(e.id);
  persistCallList();
  renderCallList();
  undoSnack({
    text: _clTpl(_CL_TXT.deleted, { nom: callEntryName(e) }),
    sub: kind === 'notif' ? _CL_TXT.deletedSub : _CL_TXT.deletedSubDmx,
    undo: () => {
      const list = callList[kind];
      if (list.length >= CALL_LIST_MAX || list.some((x) => x.id === e.id)) return;
      list.splice(Math.min(i, list.length), 0, e);
      if (prevSel && list.some((x) => x.id === prevSel)) _callListSel[kind] = prevSel;
      if (wasLoaded && callKind === e.kind && callListKind === kind) _clLoadedId = e.id;
      persistCallList();
      renderCallList();
    },
    commit: () => { callAssetDelete(e.id + ':photo'); callAssetDelete(e.id + ':audio'); },
  });
  return true;
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
  const done = loadCallEntryIntoForm(e); // partie immédiate : type du formulaire = celui de l'entrée
  _clLoadedId = id; // chargée : « Mettre à jour » / « Enregistrer comme nouveau »
  renderCallListSaveLabel();
  await done;
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
  setCallPresent(e.present === 'banner' ? 'banner' : e.kind === 'call' && e.lock ? 'lock' : 'full');
  setCallPhotoMode(e.photoMode === 'full' ? 'full' : 'avatar');
  ringApplyEntry(e); // son et volume de l'entrée pour son type
  val('callName', e.name || ''); val('callLabel', e.label || ''); val('callMsgText', e.msg || '');
  renderCallerState();
  if (e.kind !== 'call') {
    val('callAppName', e.appName || ''); val('callAppColor', safeHexColor(e.appColor, '#2f8cf0'));
    for (const id of ['callAppName', 'callAppColor']) { const el = document.getElementById(id); if (el) el.dataset.touched = '1'; }
  }
  const lt = document.getElementById('lockToggle'); if (lt) lt.checked = e.kind === 'sms' && !!e.lock;
  val('lockTime', e.lock ? e.lock.time || '' : ''); val('lockDate', e.lock ? e.lock.date || '' : '');
  val('callAutoSlider', String(e.autoAnswer || 0)); onCallAutoChange();
  callAudioApply(e.kind === 'call' ? e.audio : null); // délai, sortie du son, proximité (entrée d'avant : valeurs d'origine)
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

// ▶ d'une ligne : déclenche cette entrée sur la cible, sans la charger dans le formulaire
async function playCallEntry(id) {
  const kind = _clKindOf(id);
  if (!kind) return;
  const free = tabSendIds('tel'); // écrans tenus par une séquence : suspendu ; cible partielle : écrans libres
  if (!free) return;
  const e = callList[kind].find((x) => x.id === id);
  const n = callList[kind].indexOf(e) + 1;
  const text = _clTpl(e.kind === 'call' ? _CL_TXT.sentCall : e.kind === 'notif' ? _CL_TXT.sentNotif : _CL_TXT.sentSms, { n });
  _setCallStatusUI(text);
  telCallSent(e.kind, e.kind === 'call' ? (e.autoAnswer || 0) : 0, text, e.audio);
  const held = scrTargetIds().length - free.length;
  await sendCallEntry(e, held > 0 ? [{ screens: free }] : undefined);
}
async function triggerSelectedCallEntry() {
  const e = _clSelected(callListKind);
  if (e) await playCallEntry(e.id);
}

// ── Feuilles (39-screens-ui.js : _sheet, renderSheet, closeSheet) : nom (43b), menu « ⋯ » (43c) ──
function openSaveCallSheet() {
  if (licLocked('tel')) return; // aperçu sans licence (77-licence-ui.js)
  if (callKind === 'discussion' || callList[_clListOf(callKind)].length >= CALL_LIST_MAX) return;
  _sheet = { kind: 'callName', id: null }; renderSheet(true);
}
function openCallEntryMenu(id) {
  if (!_clKindOf(id)) return;
  _sheet = { kind: 'callMenu', id }; renderSheet();
}
function callMenuLoad(id) { closeSheet(); selectCallEntry(id); }
function callMenuRename(id) { if (!licLocked('tel') && _clKindOf(id)) { _sheet = { kind: 'callName', id }; renderSheet(true); } }
function callMenuUpdate(id) { closeSheet(); updateCallEntry(id); }
function callMenuDuplicate(id) { closeSheet(); duplicateCallEntry(id); }
function callMenuDelete(id) { closeSheet(); deleteCallEntry(id); }
// Monter / descendre : la feuille reste ouverte (le menu se redessine avec le nouveau rang)
function callMenuUp(id) { moveCallEntry(id, -1); renderSheet(); }
function callMenuDown(id) { moveCallEntry(id, 1); renderSheet(); }
// « Tout voir » : les trois listes et leur nombre ; en choisir une change le type affiché
function openCallListAll() { _sheet = { kind: 'callAll' }; renderSheet(); }
function callAllPick(k) { closeSheet(); setCallKind(k); }
// « Console DMX · n° 1 à 20 déclenchables » : n° et plages des entrées de la liste affichée
function openCallDmxInfo() { _sheet = { kind: 'callDmx' }; renderSheet(); }
// Contenu d'une feuille : { title, html, form } ; null : entrée disparue
function callListSheetContent(s) {
  const close = '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">' + escapeHtml(_CL_TXT.close) + '</button></div>';
  if (s.kind === 'callAll') {
    const b = (k, label) => '<button type="button" class="dc-menu-btn' + (callListKind === k ? ' on' : '') + '" id="callAll-' + k + '" onclick="callAllPick(\'' + k + '\')">' + escapeHtml(label) + '</button>';
    return {
      title: _CL_TXT.allTitle, form: false,
      html: b('call', _clTpl(_CL_TXT.allCall, { n: callList.call.length })) + b('sms', _clTpl(_CL_TXT.allSms, { n: callList.sms.length })) + b('notif', _clTpl(_CL_TXT.allNotif, { n: callList.notif.length })) + close,
    };
  }
  if (s.kind === 'callDmx') {
    const kind = callListKind, list = callList[kind];
    const rows = kind === 'notif' ? '' : list.slice(0, CALL_LIST_DMX_ITEMS).map((e, i) => '<div class="sr-dmx-row"><span>' + escapeHtml(_clTpl(_CL_TXT.dmxRow, { n: i + 1, nom: callEntryName(e) })) + '</span><b>DMX ' + callEntryDmxRange(i, kind) + '</b></div>').join('');
    return {
      title: _CL_TXT.dmxTitle, form: false,
      html: '<p class="sr-sheet-note">' + escapeHtml(kind === 'notif' ? _CL_TXT.dmxNoteNotif : _CL_TXT.dmxNote) + '</p>'
        + (kind === 'notif' ? '' : (rows || '<p class="sr-sheet-note">' + escapeHtml(_CL_TXT.dmxEmpty) + '</p>')) + close,
    };
  }
  const kind = s.id ? _clKindOf(s.id) : null;
  const e = kind ? callList[kind].find((x) => x.id === s.id) : null;
  if (s.id && !e) return null;
  if (s.kind === 'callMenu') {
    const b = (cls, fn, label, ico) => '<button type="button" class="dc-menu-btn' + cls + '" onclick="' + fn + '(\'' + e.id + '\')">' + (ico ? icon(ico) : '') + escapeHtml(label) + '</button>';
    // Aperçu sans licence : charger seulement ; « Mettre à jour » : formulaire du même type de liste
    const edit = !licLocked('tel'), canUpdate = callKind !== 'discussion' && _clListOf(callKind) === kind;
    const i = callList[kind].indexOf(e);
    // Jargon DMX : ici seulement (plus sur les lignes)
    const genre = kind === 'call' ? _CL_TXT.genreCall : kind === 'notif' ? _CL_TXT.genreNotif : _CL_TXT.genreSms;
    const dmx = callEntryDmxRange(i, kind);
    const meta = kind === 'notif' ? '<span>' + escapeHtml(_CL_TXT.menuNoChannel) + '</span><b>—</b>'
      : dmx === '—' ? '<span>' + escapeHtml(_CL_TXT.menuNoConsole) + '</span><b>—</b>'
      : '<span>' + escapeHtml(_clTpl(_CL_TXT.menuConsole, { genre, n: i + 1 })) + '</span><b>DMX ' + dmx + '</b>';
    return {
      title: _clTpl(_CL_TXT.menuTitle, { nom: callEntryName(e) }), form: false,
      html: b('', 'callMenuLoad', _CL_TXT.menuLoad, 'download')
        + (edit ? b('', 'callMenuRename', _CL_TXT.menuRename, 'pencil')
          + (canUpdate ? b('', 'callMenuUpdate', _CL_TXT.menuUpdate, 'refresh-cw') : '')
          + (callList[kind].length < CALL_LIST_MAX ? b('', 'callMenuDuplicate', _CL_TXT.menuDuplicate, 'copy') : '')
          + (i > 0 ? b('', 'callMenuUp', _CL_TXT.menuUp, 'arrow-up') : '')
          + (i < callList[kind].length - 1 ? b('', 'callMenuDown', _CL_TXT.menuDown, 'arrow-down') : '') : '')
        + '<div class="dc-menu-meta">' + meta + '</div>'
        + (edit ? b(' danger', 'callMenuDelete', _CL_TXT.menuDelete, 'trash-2') : '')
        + close,
    };
  }
  // Nom : de l'enregistrement à venir (proposition préremplie) ou de l'entrée à renommer
  let def, val, n, list, title;
  if (e) {
    def = callEntryDefaultName(e); val = e.title || def; list = kind; n = callList[kind].indexOf(e) + 1; title = _CL_TXT.sheetRename;
  } else {
    const f = _clFormEntry().e;
    def = callEntryDefaultName(f); val = def; list = _clListOf(f.kind); n = callList[list].length + 1;
    title = f.kind === 'call' ? _CL_TXT.sheetCall : f.kind === 'notif' ? _CL_TXT.sheetNotif : _CL_TXT.sheetSms;
  }
  const dmx = callEntryDmxRange(n - 1, list);
  const note = _clTpl(dmx === '—' ? _CL_TXT.nameNoteNoDmx : _CL_TXT.nameNote, { defaut: def, n, plage: dmx });
  return {
    title, form: true,
    html: '<form class="sr-form" onsubmit="event.preventDefault();sheetSave()">'
      + '<label class="sr-sublabel" for="srName">' + escapeHtml(_CL_TXT.nameLabel) + '</label>'
      + '<input type="text" id="srName" class="text-input sr-input" maxlength="' + CALL_TITLE_MAX + '" autocomplete="off" placeholder="' + escapeHtml(def) + '" value="' + escapeHtml(val.slice(0, CALL_TITLE_MAX)) + '">'
      + '<p class="sr-sheet-note">' + escapeHtml(note) + '</p>'
      + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">' + escapeHtml(_CL_TXT.cancel) + '</button>'
      + '<button type="submit" class="sr-ok" id="callSaveNew">' + escapeHtml(_CL_TXT.ok) + '</button></div></form>',
  };
}
function callListSheetSave(s, value) {
  closeSheet();
  if (s.id) renameCallEntry(s.id, value);
  else saveCurrentCall(value);
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
    if (!row || (e.pointerType === 'mouse' && e.button !== 0) || licLocked('tel')) return; // aperçu : ordre figé
    if (e.target.closest('.cl-more, .cl-play, .cl-mv')) return; // ⋯, ▶, ↑ ↓ : leur action, pas de glisser
    _clDrag ={ row, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, active: false, ghost: null };
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
