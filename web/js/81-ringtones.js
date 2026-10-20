// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ SONNERIES ET SONS DE NOTIFICATION (télécommande) ══════════════════════════
// Onglet Tel, carte « Sonnerie » (appel) / « Son de notification » (SMS,
// notification d'application) / « Son des messages » (discussion) de la vue
// « Style et sonnerie » (78-tel-style.js, maquettes validées 12 et 36b) : sons
// intégrés (Classique, Digitale, Douce, Silencieux) ou sons importés par
// l'utilisateur (MP3, M4A, WAV… ≤ 5 Mo, vérifiés par WebAudio). Chaque type
// garde son choix, son volume et son vibreur (vib, maquette 36b) ; la
// bibliothèque « Vos sonneries » est commune aux quatre types. Par défaut :
// Classique à 100 %, c.-à-d. les sons d'avant (sonnerie classique, son SMS ;
// pour la notification, l'ancien son de la messagerie) ; discussion :
// Silencieux (elle n'avait pas de son) ; vibreur : non, pour tous les types.
// Migration : le choix enregistré pour l'ancienne « messagerie » (clé chat)
// passe à la notification, qui la remplace (même son, même volume).
//
// Stockage : bibliothèque en IndexedDB (base setremote-ringtones : « meta »
// = nom, durée… ; « data » = data-URL du son), à défaut en mémoire le temps
// de la session ; choix par type en localStorage (setremote-ring-v1).
//
// Écrans : chaque son importé a un id dérivé de son contenu (« __ring_ » + 16
// hex de SHA-256). Il part en fragments chiffrés (media-img-*) et reste en
// cache sur l'écran ; call:start n'en porte que l'id (ringId) et le volume
// (ringVolume) : il sonne même si le réseau flanche ensuite. Envoyé au choix
// du son, avant un appel qui l'utilise, à la resynchronisation s'il manque à
// l'écran (24-resync.js), sur demande de l'écran (media:need) et, passerelle
// DMX en marche, pour les entrées 1 à 20 des listes (déclenchement instantané
// depuis la console).
const RING_KINDS = ['call', 'sms', 'notif', 'discussion'];
const RING_BUILTINS = ['classic', 'digital', 'soft', 'silent'];
const RING_MAX_BYTES = 5 * 1024 * 1024;
const RING_SETTINGS_KEY = 'setremote-ring-v1';
const RING_DB = 'setremote-ringtones';
const RING_NAME_MAX = 80;

// ── Choix par type : { sound: son intégré ou id importé, vol: 0..1, vib: vibreur } ──
const _ringDefault = (k) => ({ sound: k === 'discussion' ? 'silent' : 'classic', vol: 1, vib: false });
const ringSettings = { call: _ringDefault('call'), sms: _ringDefault('sms'), notif: _ringDefault('notif'), discussion: _ringDefault('discussion') };
function _ringKind(k) { return k === 'chat' || k === 'whatsapp' ? 'sms' : (RING_KINDS.includes(k) ? k : 'call'); }
function _ringIsId(s) { return typeof s === 'string' && SRP.RING_ID_RE.test(s); }
function _ringVol(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? Math.min(1, Math.max(0, Math.round(v * 100) / 100)) : 1;
}
function loadRingSettings() {
  let o = null;
  try { o = JSON.parse(_lsGet(RING_SETTINGS_KEY)); } catch (_) { o = null; }
  // Ancienne messagerie → notification (si la notification n'a pas encore de choix)
  if (o && typeof o === 'object' && o.notif === undefined && o.chat !== undefined) o.notif = o.chat;
  for (const k of RING_KINDS) {
    const s = o && typeof o === 'object' ? o[k] : null;
    const obj = !!s && typeof s === 'object';
    const ok = obj && (RING_BUILTINS.includes(s.sound) || _ringIsId(s.sound));
    ringSettings[k] = { sound: ok ? s.sound : _ringDefault(k).sound, vol: obj ? _ringVol(s.vol) : 1, vib: obj && s.vib === true };
  }
}
function persistRingSettings() {
  _lsSet(RING_SETTINGS_KEY, JSON.stringify({ v: 1, call: ringSettings.call, sms: ringSettings.sms, notif: ringSettings.notif, discussion: ringSettings.discussion }));
}

// Champs « son » d'un call:start pour un choix { sound, vol } :
//   ring       son intégré (et repli de l'écran si le son importé lui manque)
//   ringId     son importé (absent : son intégré seul)
//   ringVolume volume 0..1 (absent : 100 %, comme les versions précédentes)
function ringMsgFields(sound, vol) {
  const out = {};
  if (_ringIsId(sound) && ringLibHas(sound)) { out.ring = 'classic'; out.ringId = sound; }
  else out.ring = RING_BUILTINS.includes(sound) ? sound : 'classic';
  const v = _ringVol(vol);
  if (v < 1) out.ringVolume = v;
  return out;
}
// Son du type et son vibreur (vib : présent seulement s'il est activé)
function ringFormFields(kind) {
  const s = ringSettings[_ringKind(kind)];
  return Object.assign(ringMsgFields(s.sound, s.vol), s.vib ? { vib: true } : {});
}
// Discussion (chat:open) : son des messages du contact, absent quand il est
// silencieux (rien à jouer), et vibreur
function ringChatFields() {
  const s = ringSettings.discussion;
  return Object.assign(s.sound === 'silent' ? {} : ringMsgFields(s.sound, s.vol), s.vib ? { vib: true } : {});
}

// ── Bibliothèque : IndexedDB, repli en mémoire ──
let ringLib = [];                // [{ id, name, mime, size, dur, at }] par ordre d'import (sans les données)
let _ringLibLoaded = false;
const _ringMem = new Map();      // sans IndexedDB : id → { meta, data }
let _ringDbP = null;
function _ringDb() {
  if (_ringDbP) return _ringDbP;
  _ringDbP = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
      const req = indexedDB.open(RING_DB, 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore('meta', { keyPath: 'id' }); req.result.createObjectStore('data'); } catch (_) {}
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  });
  return _ringDbP;
}
// Transaction sur les deux magasins ; résultat de la requête renvoyée par fn, null en cas d'échec
function _ringTx(mode, fn) {
  return _ringDb().then((db) => new Promise((resolve) => {
    if (!db) { resolve(null); return; }
    try {
      const tx = db.transaction(['meta', 'data'], mode);
      const r = fn(tx.objectStore('meta'), tx.objectStore('data'));
      tx.oncomplete = () => resolve(r && 'result' in r ? (r.result === undefined ? null : r.result) : true);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch (_) { resolve(null); }
  }));
}
function _ringSanitizeMeta(o) {
  if (!o || typeof o !== 'object' || !_ringIsId(o.id)) return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name ? o.name.slice(0, RING_NAME_MAX) : 'son',
    mime: typeof o.mime === 'string' ? o.mime.slice(0, 60) : '',
    size: n(o.size), dur: n(o.dur), at: n(o.at),
  };
}
function ringLibHas(id) { return _ringIsId(id) && ringLib.some((t) => t.id === id); }
function ringName(id) { const t = ringLib.find((x) => x.id === id); return t ? t.name : null; }

async function ringLibLoad() {
  const metas = await _ringTx('readonly', (m) => m.getAll());
  const all = (Array.isArray(metas) ? metas : []).concat([..._ringMem.values()].map((x) => x.meta));
  const seen = new Set();
  ringLib = all.map(_ringSanitizeMeta).filter((t) => t && !seen.has(t.id) && seen.add(t.id))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  _ringLibLoaded = true;
  // Un choix vers un son disparu revient au son par défaut du type
  let changed = false;
  for (const k of RING_KINDS) {
    if (_ringIsId(ringSettings[k].sound) && !ringLibHas(ringSettings[k].sound)) { ringSettings[k].sound = 'classic'; changed = true; }
  }
  if (changed) persistRingSettings();
  renderRingPanel();
  if (typeof renderCallList === 'function') renderCallList();
  if (typeof renderTelStyle === 'function') renderTelStyle(); // noms des sons importés dans les résumés
}
async function ringLibData(id) {
  if (_ringMem.has(id)) return _ringMem.get(id).data;
  return safeAudioData(await _ringTx('readonly', (m, d) => d.get(id)));
}
// true : conservé (IndexedDB) ; false : en mémoire pour cette session seulement
async function _ringLibPut(meta, data) {
  const ok = await _ringTx('readwrite', (m, d) => { m.put(meta); return d.put(data, meta.id); });
  if (ok) return true;
  _ringMem.set(meta.id, { meta, data });
  return false;
}
function _ringLibDelete(id) {
  _ringMem.delete(id);
  return _ringTx('readwrite', (m, d) => { m.delete(id); return d.delete(id); });
}

// ── Import : type, taille, décodage réel ──
const _RING_EXT_MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', wave: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff',
  caf: 'audio/x-caf', webm: 'audio/webm',
};
// Type MIME audio d'un fichier (type annoncé, sinon extension) ; null si ce n'est pas un son
function ringFileMime(f) {
  const t = String((f && f.type) || '').toLowerCase();
  const ext = ((/\.([a-z0-9]{2,5})$/i.exec((f && f.name) || '') || [])[1] || '').toLowerCase();
  if (/^audio\/[a-z0-9.+-]{1,40}$/.test(t)) return t;
  if (!t || t === 'application/octet-stream' || (t === 'video/mp4' && ext === 'm4a')) return _RING_EXT_MIME[ext] || null;
  return null;
}
function ringFileDataUrl(f, mime) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('lecture'));
    r.readAsDataURL(new Blob([f], { type: mime }));
  });
}
// Décodage WebAudio hors lecture (OfflineAudioContext : aucun son, aucun geste requis)
function ringDecode(arrayBuffer) {
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  let ctx = null;
  try { ctx = Off ? new Off(1, 1, 44100) : _ac(); } catch (_) { ctx = null; }
  return ctx ? _decodeAudio(ctx, arrayBuffer) : Promise.reject(new Error('webaudio'));
}
function ringFmtDur(d) { return fmtTime(Math.max(1, Math.round(d || 0))); }
// Id dérivé du contenu envoyé : même son = même id (pas de doublon, cache partagé)
async function _ringHashId(data) {
  const h = new Uint8Array(await SRP.getCrypto().subtle.digest('SHA-256', new TextEncoder().encode(data)));
  let s = '';
  for (let i = 0; i < 8; i++) s += h[i].toString(16).padStart(2, '0');
  return '__ring_' + s;
}
let _ringLastAt = 0;
// Ajoute un fichier à la bibliothèque → { id, name, dup?, persisted? } ou { error, name }
async function ringImportFile(f) {
  const name = String((f && f.name) || 'son').slice(0, RING_NAME_MAX);
  if (!f) return { error: 'none', name };
  if (f.size > RING_MAX_BYTES) return { error: 'big', name };
  const mime = ringFileMime(f);
  if (!mime) return { error: 'type', name };
  let buf, audio;
  try { buf = await f.arrayBuffer(); } catch (_) { return { error: 'read', name }; }
  try { audio = await ringDecode(buf); } catch (_) { return { error: 'decode', name }; }
  if (!audio || !(audio.duration > 0)) return { error: 'decode', name };
  let data;
  try { data = await ringFileDataUrl(f, mime); } catch (_) { return { error: 'read', name }; }
  if (!safeAudioData(data)) return { error: 'type', name };
  const id = await _ringHashId(data);
  const known = ringLib.find((t) => t.id === id);
  if (known) return { id, name: known.name, dup: true };
  _ringLastAt = Math.max(Date.now(), _ringLastAt + 1);
  const meta = { id, name, mime, size: f.size, dur: Math.round(audio.duration * 100) / 100, at: _ringLastAt };
  const persisted = await _ringLibPut(meta, data);
  ringLib.push(meta);
  return { id, name, persisted };
}
const _RING_ERRORS = {
  big: (n) => '⚠ « ' + n + ' » dépasse 5 Mo — coupez un extrait plus court.',
  type: (n) => '⚠ « ' + n + ' » n\'est pas un fichier son (MP3, M4A, WAV…).',
  decode: (n) => '⚠ « ' + n + ' » est illisible : ce n\'est pas un son valide.',
  read: () => '⚠ Lecture du fichier impossible.',
  none: () => '',
};
async function onRingImport(files) {
  const f = files && files[0];
  if (!f) return null;
  _ringSetStatus('⏳ Vérification de « ' + String(f.name || 'son').slice(0, RING_NAME_MAX) + ' »…');
  const r = await ringImportFile(f);
  if (r.error) { _ringSetStatus((_RING_ERRORS[r.error] || _RING_ERRORS.read)(r.name), 'warn'); return r; }
  _ringSelect(r.id);
  const what = r.dup ? '« ' + r.name + ' » est déjà dans vos sonneries'
    : '✓ « ' + r.name + ' » importée' + (r.persisted ? '' : ' (pour cette session : stockage indisponible)');
  _ringStatusSending(r.id, what);
  return r;
}

// ── Choix du son du type affiché ──
// Après un changement : rangée résumé et vue « Style et sonnerie »
// (78-tel-style.js) ; discussion ouverte : son renvoyé à l'écran (83-discussion.js)
function _ringChanged() {
  if (typeof renderTelStyle === 'function') renderTelStyle();
  if (_ringKind(callKind) === 'discussion' && typeof chatOnSoundChange === 'function') chatOnSoundChange();
}
function setCallRing(r) {
  ringSettings[_ringKind(callKind)].sound = RING_BUILTINS.includes(r) ? r : 'classic';
  persistRingSettings();
  _ringSetStatus('');
  renderRingPanel();
  _ringChanged();
}
// Vibreur du type affiché (maquette 36b)
function setTelVib(on) {
  ringSettings[_ringKind(callKind)].vib = !!on;
  persistRingSettings();
  _ringChanged();
}
function selectRingTone(id) {
  if (!ringLibHas(id)) return;
  _ringSelect(id);
  _ringStatusSending(id, '« ' + ringName(id) + ' »');
}
function _ringSelect(id) {
  ringSettings[_ringKind(callKind)].sound = id;
  persistRingSettings();
  renderRingPanel();
  ensureCallAssets(null, null, [id]); // envoyé dès le choix, comme la photo
  _ringChanged();
}
function onRingVolume() {
  const sl = document.getElementById('ringVolSlider');
  if (!sl) return;
  const v = _ringVol((parseInt(sl.value, 10) || 0) / 100);
  ringSettings[_ringKind(callKind)].vol = v;
  persistRingSettings();
  _ringRenderVol();
  _ringChanged();
  if (_ringPrev && _ringPrev.gain) { try { _ringPrev.gain.gain.value = v; } catch (_) {} }
}
// Entrée de la liste rechargée dans le formulaire : son, volume et vibreur
// enregistrés (entrée d'avant le vibreur : non)
function ringApplyEntry(e) {
  const k = _ringKind(e && e.kind);
  const sound = e && ringLibHas(e.ringId) ? e.ringId : (e && RING_BUILTINS.includes(e.ring) ? e.ring : 'classic');
  ringSettings[k] = { sound, vol: e && e.ringVolume !== undefined ? _ringVol(e.ringVolume) : 1, vib: !!(e && e.vib === true) };
  persistRingSettings();
  _ringSetStatus('');
  renderRingPanel();
  if (typeof renderTelStyle === 'function') renderTelStyle();
  if (ringLibHas(sound)) ensureCallAssets(null, null, [sound]);
}

async function deleteRingTone(id) {
  const t = ringLib.find((x) => x.id === id);
  if (!t) return false;
  if (!confirm('Supprimer « ' + t.name + ' » ? Les appels, SMS, notifications et discussions qui l\'utilisent reviennent au son Classique.')) return false;
  if (_ringPrev && _ringPrev.id === id) _ringPrevStop();
  ringLib = ringLib.filter((x) => x.id !== id);
  const chatHad = ringSettings.discussion.sound === id;
  for (const k of RING_KINDS) if (ringSettings[k].sound === id) ringSettings[k].sound = 'classic';
  persistRingSettings();
  _screenCached.delete(id);
  sendMsg({ type: 'media:evict', id }); // tous les écrans (oublié de leur état : 28-screens.js)
  _ringSetStatus('« ' + t.name + ' » supprimée.');
  renderRingPanel();
  if (typeof renderCallList === 'function') renderCallList();
  if (typeof renderTelStyle === 'function') renderTelStyle();
  if (chatHad && typeof chatOnSoundChange === 'function') chatOnSoundChange();
  await _ringLibDelete(id);
  return true;
}

// ── Écoute sur la télécommande (bouton ▶ de la ligne) ──
let _ringPrev = null, _ringPrevSeq = 0; // { id, src, gain }
function _ringPrevStop() {
  _ringPrevSeq++;
  const p = _ringPrev;
  _ringPrev = null;
  if (p && p.src) { try { p.src.stop(); } catch (_) {} }
}
async function previewRingTone(id) {
  if (_ringPrev && _ringPrev.id === id) { _ringPrevStop(); renderRingPanel(); return; }
  _ringPrevStop();
  const seq = _ringPrevSeq;
  const ctx = _ac();
  if (!ctx || !ringLibHas(id)) return;
  _ringPrev = { id, src: null, gain: null };
  renderRingPanel();
  try {
    const data = await ringLibData(id);
    if (!data) throw new Error('absent');
    const buf = await _decodeAudio(ctx, _dataUrlBytes(data).buffer);
    if (seq !== _ringPrevSeq) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    g.gain.value = ringSettings[_ringKind(callKind)].vol;
    src.connect(g); g.connect(ctx.destination);
    src.onended = () => { if (_ringPrev && _ringPrev.src === src) { _ringPrev = null; renderRingPanel(); } };
    _ringPrev.src = src; _ringPrev.gain = g;
    src.start();
  } catch (_) {
    if (seq !== _ringPrevSeq) return;
    _ringPrev = null;
    _ringSetStatus('⚠ Écoute impossible sur ce téléphone.', 'warn');
    renderRingPanel();
  }
}

// ── Envoi aux écrans ──
// Chaque écran a ses sons (scrState(id).sent / .cached, 28-screens.js) : un
// son part vers les seuls écrans visés qui ne l'ont pas.
const _ringSentAt = new Map();
const _ringOn = (id, s) => scrState(s).sent.has(id) || scrState(s).cached.has(id);
// Son présent (envoyé ou accusé) sur tous les écrans en ligne
const _ringOnScreens = {
  has(id) { const ids = scrList().filter(scrOnline); return ids.length > 0 && ids.every((s) => _ringOn(id, s)); },
};
// Appelé dans la file des envois (ensureCallAssets) : fragments du son vers
// les écrans donnés (défaut : la cible) qui ne l'ont pas déjà
async function ringSendIfMissing(id, screens) {
  if (!ringLibHas(id)) return;
  if (!mediaLinkUp()) return; // renvoyé à la resynchronisation (jamais en Bluetooth seul)
  const lack = () => (screens || scrTargetIds()).filter((s) => scrKnown(s) && !_ringOn(id, s));
  if (!lack().length) return;
  const data = await ringLibData(id);
  const ids = lack();
  if (!data || !ids.length) return;
  for (const s of ids) scrState(s).sent.set(id, true);
  _ringSentAt.set(id, Date.now());
  _screenCached.delete(id);
  await sendImageChunks(data, { mediaId: id, show: false, screens: ids });
}
// Sons qui doivent être sur les écrans : ceux choisis pour chaque type et,
// passerelle en marche, ceux des entrées 1 à 20 des listes
function ringNeededIds() {
  const ids = new Set();
  for (const k of RING_KINDS) if (ringLibHas(ringSettings[k].sound)) ids.add(ringSettings[k].sound);
  if (typeof gwRunning === 'function' && gwRunning()) for (const id of ringGatewayIds()) ids.add(id);
  return [...ids];
}
function ringGatewayIds() {
  const ids = new Set();
  for (const list of [callList.call, callList.sms]) {
    for (const e of list.slice(0, CALL_LIST_DMX_ITEMS)) if (ringLibHas(e.ringId)) ids.add(e.ringId);
  }
  return [...ids];
}
// Passerelle DMX : sons des entrées 1 à 20 envoyés d'avance (au démarrage, à chaque modification de liste)
function ringPreloadGatewayEntries() {
  const ids = ringGatewayIds();
  if (ids.length) ensureCallAssets(null, null, ids, scrList()); // tous les écrans : la console peut viser chacun
}
// Un écran a reçu un appel avec un son qu'il n'a pas (rechargé, transfert perdu) :
// renvoyé à lui seul (sid inconnu : aux écrans de la cible)
function ringOnScreenNeeds(id, sid) {
  _screenCached.delete(id);
  if (!ringLibHas(id)) return;
  if (Date.now() - (_ringSentAt.get(id) || 0) < 3000) return; // envoi tout récent : déjà en route
  const ids = sid ? [sid] : scrTargetIds();
  for (const s of ids) { scrState(s).sent.delete(id); scrState(s).cached.delete(id); }
  ensureCallAssets(null, null, [id], ids);
}
// Accusé « en cache » d'un écran : bande son du décroché, son importé
function remoteOnCallAssetCached(id) {
  if (id === '__callaudio') renderCallAudioRow();
  else if (_ringIsId(id) && id === _ringStatusWait) _ringSetStatus('✓ « ' + (ringName(id) || 'son') + ' » sur l\'écran', 'live');
}

// ── Rendu du panneau ──
let _ringStatusWait = null; // son dont le message attend l'accusé de l'écran
function _ringSetStatus(text, tone, waitId) {
  _ringStatusWait = waitId || null;
  const st = document.getElementById('ringStatus');
  if (!st) return;
  setIconText(st, text || '');
  st.style.display = text ? 'block' : 'none';
  st.classList.toggle('live', tone === 'live');
  st.classList.toggle('rt-warn', tone === 'warn');
}
function _ringStatusSending(id, what) {
  if (_screenCached.has(id)) _ringSetStatus(what + ' · sur l\'écran ✓', 'live');
  else _ringSetStatus(what + ' · envoi à l\'écran…', null, id);
}
function _ringRenderVol() {
  const v = ringSettings[_ringKind(callKind)].vol;
  const sl = document.getElementById('ringVolSlider');
  if (sl && String(sl.value) !== String(Math.round(v * 100))) sl.value = String(Math.round(v * 100));
  const lb = document.getElementById('ringVolVal');
  if (lb) lb.innerHTML = Math.round(v * 100) + '<span> %</span>';
}
const _RING_ICON = {
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>',
  stop: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  del: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
// Libellés de la carte du son selon le type (regroupés pour la traduction)
const _RING_TXT = {
  call: { label: 'Sonnerie', vol: 'Volume de la sonnerie' },
  sms: { label: 'Son de notification', vol: 'Volume de la notification' },
  notif: { label: 'Son de notification', vol: 'Volume de la notification' },
  discussion: { label: 'Son des messages', vol: 'Volume des messages' },
};
let _ringRenderedKind = null;
function renderRingPanel() {
  const k = _ringKind(callKind), s = ringSettings[k], isCall = k === 'call';
  // Autre type affiché : le message du type précédent n'a plus de sens
  if (_ringRenderedKind !== null && _ringRenderedKind !== k) _ringSetStatus('');
  _ringRenderedKind = k;
  const set = (id, t) => { setIconText(document.getElementById(id), t); };
  set('ringPanelLabel', _RING_TXT[k].label);
  set('ringVolLabel', _RING_TXT[k].vol);
  RING_BUILTINS.forEach((x) => {
    const b = document.getElementById('callring-' + x);
    if (b) b.classList.toggle('active', s.sound === x);
  });
  const lbl = document.getElementById('ringLibLabel');
  if (lbl) lbl.style.display = ringLib.length ? 'block' : 'none';
  const rows = document.getElementById('ringLibRows');
  if (rows) {
    rows.innerHTML = ringLib.map((t) => {
      const sel = t.id === s.sound, playing = !!(_ringPrev && _ringPrev.id === t.id);
      return '<div class="rt-row' + (sel ? ' selected' : '') + '" data-id="' + t.id + '" onclick="selectRingTone(\'' + t.id + '\')">'
        + '<button type="button" class="rt-play' + (playing ? ' playing' : '') + '" aria-label="' + (playing ? 'Arrêter' : 'Écouter') + '"'
        + ' onclick="event.stopPropagation();previewRingTone(\'' + t.id + '\')">' + (playing ? _RING_ICON.stop : _RING_ICON.play) + '</button>'
        + '<span class="rt-main"><span class="rt-name">' + escapeHtml(t.name) + '</span>'
        + '<span class="rt-meta">' + ringFmtDur(t.dur) + (sel ? ' · sélectionnée' : '') + '</span></span>'
        + '<button type="button" class="rt-del" aria-label="Supprimer" onclick="event.stopPropagation();deleteRingTone(\'' + t.id + '\')">' + _RING_ICON.del + '</button>'
        + '</div>';
    }).join('');
  }
  _ringRenderVol();
  // Panneau « Au décroché » (bande son, décroché automatique) : appel seulement
  const ans = document.getElementById('callAnswerBlock');
  if (ans) ans.style.display = isCall ? 'block' : 'none';
}

function ringInit() {
  loadRingSettings();
  renderRingPanel();
  renderCallAudioRow();
  return ringLibLoad();
}
