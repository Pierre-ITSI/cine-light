// ══════════════════════════ MÉDIA — TÉLÉCOMMANDE ══════════════════════════
// Vidéo : transfert du FICHIER vers l'écran via DataChannel WebRTC.
// L'ordinateur lit la vidéo localement (vraie timeline/seek/play-pause natifs),
// piloté depuis le téléphone par messages MQTT « media-ctrl ».
let _rtcPc = null, _remotePendingIce = [];
let _remotePlaying = false, _remoteDur = 0, _remoteCur = 0, _mediaIsVideo = false;

function setMediaStatus(txt, live) {
  const el = document.getElementById('mediaStatus');
  if (el) { el.textContent = txt; el.classList.toggle('live', !!live); }
}
function showMediaStop(show) {
  const b = document.getElementById('mediaStopBtn');
  if (b) b.style.display = show ? 'flex' : 'none';
}
function showMediaPlay(show) {
  const b = document.getElementById('mediaPlayBtn');
  if (b) b.style.display = show ? 'flex' : 'none';
  const r = document.getElementById('videoModeRow');
  if (r) r.style.display = show ? 'block' : 'none';
}

// ── Fin de lecture vidéo : boucle / 1× puis pause / 1× puis off ──
let _videoEndMode = 'loop';
function setVideoEndMode(m) {
  _videoEndMode = (m === 'pause' || m === 'off') ? m : 'loop';
  ['loop','pause','off'].forEach(k => {
    const b = document.getElementById('vmode-' + k);
    if (b) b.classList.toggle('active', k === _videoEndMode);
  });
  sendMsg({ type: 'media:endmode', mode: _videoEndMode });
}
function setPlayBtn(playing) {
  const ic = document.getElementById('mediaPlayIcon');
  const lb = document.getElementById('mediaPlayLabel');
  if (ic) ic.textContent = playing ? '⏸' : '▶';
  if (lb) lb.textContent = playing ? 'Pause' : 'Lecture';
}
function toggleVideoPlayback() {
  if (!_mediaIsVideo) return;
  _remotePlaying = !_remotePlaying;
  setPlayBtn(_remotePlaying);
  sendMsg({ type: 'media-ctrl', action: _remotePlaying ? 'play' : 'pause' });
}

// — Timeline / scrubber (pilotage distant) —
let _mediaSeeking = false;
function showMediaTimeline(show) {
  const t = document.getElementById('mediaTimeline');
  if (t) t.style.display = show ? 'block' : 'none';
  if (!show) {
    const s = document.getElementById('mediaSeek'); if (s) { s.value = 0; paintSeek(0); }
    const c = document.getElementById('mediaCurTime'); if (c) c.textContent = '0:00';
    const d = document.getElementById('mediaDurTime'); if (d) d.textContent = '0:00';
  }
}
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
function paintSeek(pct) {
  const s = document.getElementById('mediaSeek');
  if (s) s.style.background = `linear-gradient(to right,var(--accent) ${pct}%,#333 ${pct}%)`;
}
// Reçoit la durée depuis l'écran (métadonnées de la vidéo lue localement par l'écran)
function remoteOnMeta(dur) {
  // L'écran confirme la lecture : le transfert est bien arrivé
  if (_b64VerifyTimer) { clearTimeout(_b64VerifyTimer); _b64VerifyTimer = null; }
  _remoteDur = dur || 0;
  const s = document.getElementById('mediaSeek');
  if (s && isFinite(_remoteDur)) s.max = _remoteDur;
  const d = document.getElementById('mediaDurTime');
  if (d) d.textContent = fmtTime(_remoteDur);
  showMediaPlay(true); setPlayBtn(_remotePlaying); showMediaTimeline(true);
  setMediaStatus('🎬 Vidéo en diffusion', true);
}
// Reçoit la position de lecture depuis l'écran (source de vérité = l'écran)
function remoteOnProgress(cur, dur, playing) {
  if (dur) { _remoteDur = dur; const d = document.getElementById('mediaDurTime'); if (d) d.textContent = fmtTime(dur); const s = document.getElementById('mediaSeek'); if (s && isFinite(dur)) s.max = dur; }
  if (typeof playing === 'boolean') { _remotePlaying = playing; setPlayBtn(playing); }
  if (playing) setMediaStatus('🎬 Vidéo en diffusion', true);
  _remoteCur = cur || 0;
  if (_mediaSeeking) return;
  const s = document.getElementById('mediaSeek');
  if (s) s.value = _remoteCur;
  const c = document.getElementById('mediaCurTime');
  if (c) c.textContent = fmtTime(_remoteCur);
  paintSeek(_remoteDur ? (_remoteCur / _remoteDur) * 100 : 0);
}
function remoteOnEnded(off) {
  _remotePlaying = false; setPlayBtn(false);
  if (off) {
    // Mode « 1× puis off » : l'écran a coupé le média à la fin de la lecture
    teardownBroadcast();
    _activeMediaId = null;
    renderPool();
    showMediaStop(false);
    setMediaStatus('Lecture terminée — écran libéré');
  }
}
// L'écran n'a pas pu lire la vidéo (codec non supporté, etc.)
function remoteOnError(reason) {
  _remotePlaying = false; setPlayBtn(false);
  if (reason === 'decode' || reason === 'src')
    setMediaStatus('⚠ Format non lisible sur l\'écran (essayez un MP4/H.264)');
  else
    setMediaStatus('⚠ Lecture impossible sur l\'écran');
}
let _seekSendTimer = null;
function onSeekInput() {
  _mediaSeeking = true;
  const s = document.getElementById('mediaSeek');
  if (!s) return;
  const cur = parseFloat(s.value);
  const c = document.getElementById('mediaCurTime');
  if (c) c.textContent = fmtTime(cur);
  paintSeek(_remoteDur ? (cur / _remoteDur) * 100 : 0);
  // seek live throttlé → se répercute sur l'écran
  if (!_seekSendTimer) {
    _seekSendTimer = setTimeout(() => {
      _seekSendTimer = null;
      sendMsg({ type: 'media-ctrl', action: 'seek', time: parseFloat(s.value) });
    }, 120);
  }
}
function onSeekEnd() {
  const s = document.getElementById('mediaSeek');
  if (s) sendMsg({ type: 'media-ctrl', action: 'seek', time: parseFloat(s.value) });
  _mediaSeeking = false;
}
// ══════════════════════════ POOL MÉDIA ══════════════════════════
let _mediaPool = [];        // { id, kind:'img'|'vid', name, file, thumb }
let _activeMediaId = null;
let _poolSeq = 0;
let _autoAdvance = false;          // télécommande : « avancer au clic sur l'écran »
let _screenAutoAdvance = false;    // écran : option reçue de la télécommande
let screenBrightnessPct = 100;     // télécommande : luminosité de l'écran de jeu (%)

// Règle à distance la luminosité de l'écran de jeu (slider de l'onglet Média).
function onScreenBrightnessChange() {
  screenBrightnessPct = parseInt(document.getElementById('screenBrightnessSlider').value);
  const l = document.getElementById('screenBrightnessVal');
  if (l) l.innerHTML = screenBrightnessPct + '<span>%</span>';
  sendMsg({ type: 'screen:brightness', value: screenBrightnessPct / 100 });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── Validation des données reçues du réseau ──
// Une chaîne reçue n'est utilisée comme image/son que si c'est une vraie
// data-URL base64 (aucun guillemet ni parenthèse possible → pas d'injection
// dans style="url(...)", et pas de chargement d'URL externe/traçante).
const _RE_IMG_DATA = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const _RE_AUDIO_DATA = /^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/;
function safeImageData(s) { return (typeof s === 'string' && _RE_IMG_DATA.test(s)) ? s : null; }
function safeAudioData(s) { return (typeof s === 'string' && _RE_AUDIO_DATA.test(s)) ? s : null; }
function safeHexColor(s, fallback) { return (typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)) ? s : fallback; }

function onAddImages(files) {
  if (!files || !files.length) return;
  const wasEmpty = _mediaPool.length === 0;
  let first = null;
  for (const f of files) {
    const item = { id: 'm' + (++_poolSeq), kind: 'img', name: f.name || 'image', file: f, thumb: URL.createObjectURL(f) };
    _mediaPool.push(item); if (!first) first = item;
  }
  renderPool();
  sendPoolOrder();
  schedulePreload();
  if (wasEmpty && first) selectMedia(first.id);
}
function onAddVideos(files) {
  if (!files || !files.length) return;
  const wasEmpty = _mediaPool.length === 0;
  let first = null;
  for (const f of files) {
    const item = { id: 'm' + (++_poolSeq), kind: 'vid', name: f.name || 'vidéo', file: f, thumb: null };
    _mediaPool.push(item); makeVideoThumb(item); if (!first) first = item;
  }
  renderPool();
  sendPoolOrder();
  schedulePreload();
  if (wasEmpty && first) selectMedia(first.id);
}

// Génère une vignette à partir de la première image de la vidéo
function makeVideoThumb(item) {
  try {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.src = URL.createObjectURL(item.file);
    const cleanup = () => { try { URL.revokeObjectURL(v.src); } catch (_) {} };
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) * 0.1); } catch (_) {} };
    v.onseeked = () => {
      try {
        const w = 160, ratio = (v.videoWidth && v.videoHeight) ? v.videoHeight / v.videoWidth : 1;
        const c = document.createElement('canvas'); c.width = w; c.height = Math.max(1, Math.round(w * ratio));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        item.thumb = c.toDataURL('image/jpeg', 0.6);
        renderPool();
      } catch (_) {}
      cleanup();
    };
    v.onerror = cleanup;
  } catch (_) {}
}

function renderPool() {
  const grid = document.getElementById('mediaPool');
  const empty = document.getElementById('mediaPoolEmpty');
  if (empty) empty.style.display = _mediaPool.length ? 'none' : 'block';
  const nav = document.getElementById('mediaNav');
  const advRow = document.getElementById('mediaAutoAdvRow');
  const hasItems = _mediaPool.length > 0;
  if (nav) nav.style.display = hasItems ? 'flex' : 'none';
  // Le toggle « avancer au clic sur l'écran » est toujours visible (comme le natif).
  if (advRow) advRow.style.display = 'flex';
  if (!grid) return;
  grid.innerHTML = _mediaPool.map((it, idx) => {
    const active = it.id === _activeMediaId;
    const thumb = it.thumb
      ? `<img src="${it.thumb}" alt="">`
      : `<div class="pool-fallback">${it.kind === 'vid' ? '🎬' : '🖼'}</div>`;
    return `<div class="pool-tile${active ? ' active live-dot' : ''}" data-id="${it.id}" onclick="selectMedia('${it.id}')">`
      + thumb
      + `<span class="pool-num">${idx + 1}</span>`
      + `<span class="pool-kind">${it.kind === 'vid' ? '🎬' : '🖼'}</span>`
      + `<button class="pool-del" onclick="event.stopPropagation();removeMedia('${it.id}')">×</button>`
      + `<span class="pool-name">${escapeHtml(it.name)}</span></div>`;
  }).join('');
  _pvUpdateMedia(); // l'aperçu affiche la vignette du média diffusé
  updateStatusRings();
}

// ── Réordonnancement du pool par glisser-déposer (tactile + souris) ──
// Appui maintenu (~200 ms) sur une tuile → elle se « soulève » (fantôme sous
// le doigt) et se réordonne en direct en survolant les autres tuiles.
let _poolDrag = null, _poolSuppressClick = false;
(function initPoolDrag() {
  const grid = document.getElementById('mediaPool');
  if (!grid) return;
  const HOLD = 200, TOL = 12;
  const blockScroll = e => e.preventDefault();

  grid.addEventListener('pointerdown', e => {
    const tile = e.target.closest('.pool-tile');
    if (!tile || e.target.closest('.pool-del')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    _poolDrag = { tile, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, active: false, ghost: null };
    _poolDrag.timer = setTimeout(startDrag, HOLD);
  });

  function startDrag() {
    const d = _poolDrag; if (!d) return;
    d.active = true;
    const r = d.tile.getBoundingClientRect();
    d.dx = d.x - r.left; d.dy = d.y - r.top;
    const g = d.tile.cloneNode(true);
    g.classList.add('pool-ghost');
    g.classList.remove('active', 'live-dot');
    g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
    g.style.left = (d.x - d.dx) + 'px'; g.style.top = (d.y - d.dy) + 'px';
    document.body.appendChild(g);
    d.ghost = g;
    d.tile.classList.add('pool-drag-src');
    document.addEventListener('touchmove', blockScroll, { passive: false }); // fige le scroll pendant le drag
    if (navigator.vibrate) navigator.vibrate(30);
  }

  document.addEventListener('pointermove', e => {
    const d = _poolDrag; if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.active) {
      // Le doigt bouge avant la fin de l'appui : c'est un scroll, pas un drag.
      if (Math.abs(d.x - d.sx) > TOL || Math.abs(d.y - d.sy) > TOL) { clearTimeout(d.timer); _poolDrag = null; }
      return;
    }
    d.ghost.style.left = (d.x - d.dx) + 'px';
    d.ghost.style.top = (d.y - d.dy) + 'px';
    // Réordonne le DOM en direct selon la tuile survolée
    const over = document.elementFromPoint(d.x, d.y);
    const t = over && over.closest ? over.closest('#mediaPool .pool-tile') : null;
    if (t && t !== d.tile) {
      const rect = t.getBoundingClientRect();
      const before = (d.x - rect.left) < rect.width / 2;
      t.parentNode.insertBefore(d.tile, before ? t : t.nextSibling);
    }
  });

  function endDrag() {
    const d = _poolDrag; if (!d) return;
    clearTimeout(d.timer);
    if (d.active) {
      document.removeEventListener('touchmove', blockScroll);
      if (d.ghost) d.ghost.remove();
      d.tile.classList.remove('pool-drag-src');
      // Reconstruit l'ordre du pool depuis l'ordre du DOM
      const order = [...document.querySelectorAll('#mediaPool .pool-tile')].map(el => el.dataset.id);
      _mediaPool.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      _poolSuppressClick = true; setTimeout(() => { _poolSuppressClick = false; }, 350);
      renderPool();
      sendPoolOrder(); // l'écran suit le nouvel ordre pour l'avance locale
    }
    _poolDrag = null;
  }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
})();

// Diffuse le média suivant (+1) ou précédent (−1) selon l'ordre du pool, en boucle.
// Déclenché par les flèches de la télécommande ET par le tap sur l'écran de jeu.
function advancePool(dir) {
  if (!_mediaPool.length) return;
  const cur = _mediaPool.findIndex(m => m.id === _activeMediaId);
  const base = cur < 0 ? (dir > 0 ? -1 : 0) : cur;
  const next = (((base + dir) % _mediaPool.length) + _mediaPool.length) % _mediaPool.length;
  selectMedia(_mediaPool[next].id);
}

// Active/désactive « l'écran de jeu passe au média suivant d'un clic ».
function setAutoAdvance(on) {
  _autoAdvance = !!on;
  const t = document.getElementById('mediaAutoAdvToggle');
  if (t) t.checked = _autoAdvance;
  sendMsg({ type: 'media:autoadvance', on: _autoAdvance });
}

function selectMedia(id) {
  if (_poolSuppressClick) return; // ignore le clic résiduel après un glisser-déposer
  const it = _mediaPool.find(m => m.id === id);
  if (!it) return;
  teardownBroadcast();
  _activeMediaId = id;
  renderPool();
  // Chemin rapide : déjà en cache sur l'écran → simple message, affichage instantané
  if (_screenCached.has(id)) {
    sendMsg({ type: 'media:show', id });
    showMediaStop(true);
    if (it.kind === 'vid') {
      _mediaIsVideo = true; _remotePlaying = true;
      showMediaPlay(true); setPlayBtn(true); showMediaTimeline(true);
      sendMsg({ type: 'media:endmode', mode: _videoEndMode });
      setMediaStatus('🎬 Lecture instantanée (cache écran)', true);
    } else {
      setMediaStatus('🖼 Affichage instantané (cache écran)', true);
    }
    return;
  }
  if (it.kind === 'img') broadcastImage(it.file, it.id);
  else broadcastVideo(it.file, it.id);
}

// L'écran a avancé tout seul (avance locale) : on aligne l'interface
function remoteOnScreenAdvanced(id) {
  const it = _mediaPool.find(m => m.id === id);
  if (!it) return;
  teardownBroadcast();
  _activeMediaId = id;
  renderPool();
  showMediaStop(true);
  if (it.kind === 'vid') {
    _mediaIsVideo = true; _remotePlaying = true;
    showMediaPlay(true); setPlayBtn(true); showMediaTimeline(true);
  }
  setMediaStatus((it.kind === 'vid' ? '🎬 ' : '🖼 ') + it.name + ' (avance écran)', true);
}

// L'écran ne possède pas ce média en cache : repli sur le transfert complet
// (son importé d'un appel : renvoyé par 81-ringtones.js)
function remoteOnScreenNeeds(id) {
  if (SRP.RING_ID_RE.test(id)) { ringOnScreenNeeds(id); return; }
  _screenCached.delete(id);
  const it = _mediaPool.find(m => m.id === id);
  if (!it) return;
  if (it.kind === 'img') broadcastImage(it.file, it.id);
  else broadcastVideo(it.file, it.id);
}

function removeMedia(id) {
  const idx = _mediaPool.findIndex(m => m.id === id);
  if (idx < 0) return;
  const it = _mediaPool[idx];
  if (it.thumb && it.thumb.indexOf('blob:') === 0) { try { URL.revokeObjectURL(it.thumb); } catch (_) {} }
  const wasActive = (_activeMediaId === id);
  _mediaPool.splice(idx, 1);
  _screenCached.delete(id);
  sendMsg({ type: 'media:evict', id });
  sendPoolOrder();
  if (wasActive) stopMediaBroadcast(true); else renderPool();
}

// ── Cache écran : suivi des médias déjà transférés + préchargement ──
// L'écran met en cache chaque média reçu (par id) et accuse réception
// (media:cached). Les affichages suivants ne coûtent qu'un mini message
// media:show au lieu d'un re-transfert complet → quasi instantané.
const _screenCached = new Set();    // ids confirmés en cache sur l'écran
const _preloadInflight = new Set(); // préchargements en cours
let _preloadRunning = false;

function sendPoolOrder() {
  if (_mediaPool.length) sendMsg({ type: 'media:order', ids: _mediaPool.map(m => m.id) });
}

function schedulePreload() { setTimeout(preloadPoolToScreen, 300); }

// Précharge en arrière-plan les images du pool vers l'écran (séquentiel).
// Les vidéos sont mises en cache par l'écran à leur première lecture.
async function preloadPoolToScreen() {
  if (_preloadRunning || mode !== 'remote') return;
  if (!mqttClient || !mqttClient.connected) return;
  _preloadRunning = true;
  try {
    for (const it of [..._mediaPool]) {
      if (it.kind !== 'img') continue;
      if (_screenCached.has(it.id) || _preloadInflight.has(it.id)) continue;
      // PRIORITÉ au transfert vidéo WebRTC : le préchargement se met en pause
      // pour ne pas noyer la signalisation (offre/réponse/ICE) sur le broker.
      for (let g = 0; g < 150 && _rtcPc && !_rtcTransferDone; g++) {
        await new Promise(r => setTimeout(r, 400));
      }
      if (!mqttClient || !mqttClient.connected) return;
      _preloadInflight.add(it.id);
      try {
        const dataUrl = await compressImageFile(it.file);
        await sendImageChunks(dataUrl, { mediaId: it.id, show: false });
        await _waitForCached(it.id, 5000);
      } catch (_) {}
      _preloadInflight.delete(it.id);
      await new Promise(r => setTimeout(r, 150)); // souffle pour le broker
    }
  } finally { _preloadRunning = false; }
}

function _waitForCached(id, ms) {
  return new Promise(res => {
    const t0 = Date.now();
    (function poll() {
      if (_screenCached.has(id) || Date.now() - t0 > ms) return res();
      setTimeout(poll, 150);
    })();
  });
}

// — Image : compression (réutilisée par diffusion et préchargement) —
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1280;
      let w = img.width, h = img.height;
      if (w > max || h > max) { const s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('image illisible')); };
    img.src = URL.createObjectURL(file);
  });
}

async function broadcastImage(file, mediaId) {
  let dataUrl;
  try { dataUrl = await compressImageFile(file); }
  catch (_) { setMediaStatus('⚠ Image illisible'); return; }
  sendImageChunks(dataUrl, { mediaId: mediaId || null, show: true });
  showMediaStop(true);
  setMediaStatus('🖼 Image diffusée (' + Math.round(dataUrl.length / 1024) + ' Ko)', true);
}

async function sendImageChunks(dataUrl, opts) {
  const o = opts || {};
  const id = Math.random().toString(36).slice(2, 8);
  const CHUNK = 12000;
  const total = Math.ceil(dataUrl.length / CHUNK);
  sendMsg({ type: 'media-img-start', id, total, mediaId: o.mediaId || null, show: o.show !== false });
  for (let i = 0; i < total; i++) {
    sendMsg({ type: 'media-img-chunk', id, i, data: dataUrl.slice(i * CHUNK, (i + 1) * CHUNK) });
    if (i % 16 === 15) await new Promise(r => setTimeout(r, 8)); // laisse respirer le broker
  }
}

// — Vidéo : transfert du fichier vers l'écran via DataChannel —
let _fileChannel = null;
function broadcastVideo(file, mediaId) {
  _mediaIsVideo = true;
  _remotePlaying = false; _remoteDur = 0; _remoteCur = 0;
  showMediaStop(true);
  sendMsg({ type: 'media:endmode', mode: _videoEndMode }); // synchronise la fin de lecture
  // Envoi via MQTT si : écran natif (pas de WebRTC), ou pair-à-pair déjà
  // constaté bloqué sur ce réseau (repli mémorisé pour la session).
  if (_rtcBroken || (_recvCaps && _recvCaps.videoMode === 'b64')) { broadcastVideoBase64(file, mediaId); return; }
  setMediaStatus('🎬 Préparation du transfert…');
  startFileTransfer(file, mediaId);
}

// Lit un fichier en base64 pur (sans le préfixe data:…;base64,).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Diffusion vidéo en base64 chunké via MQTT : écrans natifs (pas de WebRTC)
// et repli universel quand le pair-à-pair est bloqué par le réseau.
// Transfert FIABILISÉ : fenêtre d'envoi régulée par les accusés de réception
// de l'écran (media:chunkack) + renvoi des fragments manquants
// (media:need-chunks). Le statut « en diffusion » n'est affiché que quand
// l'écran confirme réellement la lecture (media-meta).
const _sleepMs = ms => new Promise(r => setTimeout(r, ms));
let _b64Send = null;               // { id, chunks, poolId, rounds }
let _b64Ack = { id: null, got: 0, noAck: false };
let _b64VerifyTimer = null;

async function broadcastVideoBase64(file, poolId) {
  setMediaStatus('🎬 Préparation de l\'envoi…');
  let b64;
  try { b64 = await fileToBase64(file); }
  catch (_) { setMediaStatus('⚠ Lecture du fichier impossible'); return; }
  const id = Math.random().toString(36).slice(2, 8);
  const mime = file.type || 'video/mp4';
  const CHUNK = 12000;
  const total = Math.ceil(b64.length / CHUNK);
  const chunks = [];
  for (let i = 0; i < total; i++) chunks.push(b64.slice(i * CHUNK, (i + 1) * CHUNK));
  _b64Send = { id, chunks, poolId: poolId || null, rounds: 0 };
  _b64Ack = { id, got: 0, noAck: false };
  sendMsg({ type: 'media:upload', mediaId: id, kind: 'video', mime, totalChunks: total, poolId: poolId || null });
  setMediaStatus('📤 Transfert… 0 %');
  const WINDOW = 48; // fragments en vol au maximum (si l'écran accuse réception)
  for (let i = 0; i < total; i++) {
    if (!_b64Send || _b64Send.id !== id) return; // remplacé par un autre envoi
    let waited = 0;
    while (!_b64Ack.noAck && i - _b64Ack.got > WINDOW) {
      await _sleepMs(120); waited += 120;
      // Récepteur sans accusés (ancien écran / natif) : on n'attend plus
      if (waited >= 4000 && _b64Ack.got === 0) { _b64Ack.noAck = true; break; }
      if (waited >= 20000) break; // sécurité anti-blocage
    }
    sendMsg({ type: 'media:chunk', mediaId: id, index: i, data: chunks[i] });
    if (i % 12 === 11) {
      await _sleepMs(10);
      setMediaStatus('📤 Transfert… ' + Math.round(((i + 1) / total) * 100) + ' %');
    }
  }
  sendMsg({ type: 'media:play', mediaId: id });
  setMediaStatus('⏳ Vérification de la réception…');
  _armB64VerifyTimer();
}

// Sans confirmation de lecture (media-meta) ni demande de renvoi : alerter
function _armB64VerifyTimer() {
  if (_b64VerifyTimer) clearTimeout(_b64VerifyTimer);
  _b64VerifyTimer = setTimeout(() => {
    setMediaStatus('⚠ Pas de confirmation de l\'écran — vérifiez sa connexion');
  }, 12000);
}

// L'écran signale des fragments perdus : on ne renvoie que ceux-là
async function resendMissingChunks(msg) {
  if (!_b64Send || _b64Send.id !== msg.mediaId) return;
  if (_b64VerifyTimer) { clearTimeout(_b64VerifyTimer); _b64VerifyTimer = null; }
  const miss = Array.isArray(msg.missing) ? msg.missing : [];
  if (!miss.length || _b64Send.rounds >= 3) {
    setMediaStatus('⚠ Transfert incomplet — réessayez');
    return;
  }
  _b64Send.rounds++;
  setMediaStatus('📤 Renvoi de ' + miss.length + ' fragments… (' + _b64Send.rounds + '/3)');
  for (let j = 0; j < miss.length; j++) {
    const i = miss[j];
    if (_b64Send.chunks[i] == null) continue;
    sendMsg({ type: 'media:chunk', mediaId: _b64Send.id, index: i, data: _b64Send.chunks[i] });
    if (j % 12 === 11) await _sleepMs(12);
  }
  sendMsg({ type: 'media:play', mediaId: _b64Send.id });
  setMediaStatus('⏳ Vérification de la réception…');
  _armB64VerifyTimer();
}

let _rtcTransferDone = false;
let _rtcBroken = false; // pair-à-pair constaté bloqué sur ce réseau (session)
async function startFileTransfer(file, mediaId) {
  _remotePendingIce = [];
  _rtcTransferDone = false;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] });
  _rtcPc = pc;
  pc.onicecandidate = e => { if (e.candidate) sendMsg({ type: 'rtc-ice', from: 'remote', candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (pc !== _rtcPc) return;          // ancienne connexion remplacée : ignorer
    if (_rtcTransferDone) return;        // transfert terminé : les aléas sont sans effet
    const st = pc.connectionState;
    if (st === 'failed') {
      // Pair-à-pair bloqué (isolation Wi-Fi, réseaux différents…) :
      // bascule IMMÉDIATE sur l'envoi via le canal MQTT, sans re-tentative.
      _rtcBroken = true;
      setMediaStatus('🌐 Connexion directe impossible — envoi via le canal…');
      try { pc.close(); } catch (_) {}
      if (pc === _rtcPc) _rtcPc = null;
      broadcastVideoBase64(file, mediaId);
    }
    // 'disconnected' est souvent transitoire en WebRTC : on laisse la
    // connexion se rétablir d'elle-même au lieu d'afficher une erreur.
  };
  _fileChannel = pc.createDataChannel('file', { ordered: true });
  _fileChannel.binaryType = 'arraybuffer';
  _fileChannel.onopen = () => sendFileOverChannel(_fileChannel, file, mediaId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendMsg({ type: 'rtc-offer', sdp: pc.localDescription, kind: 'file' });
  setMediaStatus('🎬 Connexion à l\'écran…');
}

async function sendFileOverChannel(ch, file, mediaId) {
  const CHUNK = 16 * 1024;
  const HIGH = 4 * 1024 * 1024; // backpressure à 4 Mo
  ch.bufferedAmountLowThreshold = 1 * 1024 * 1024;
  ch.send(JSON.stringify({ meta: true, name: file.name, size: file.size, mime: file.type || 'video/mp4', mediaId: mediaId || null }));
  let offset = 0;
  setMediaStatus('📤 Transfert… 0 %');
  try {
    while (offset < file.size) {
      if (ch.readyState !== 'open') return;
      const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
      ch.send(buf);
      offset += buf.byteLength;
      if (ch.bufferedAmount > HIGH) {
        await new Promise(res => { ch.onbufferedamountlow = () => { ch.onbufferedamountlow = null; res(); }; });
      }
      const pct = Math.round((offset / file.size) * 100);
      if (pct % 5 === 0) setMediaStatus('📤 Transfert… ' + pct + ' %');
    }
    ch.send(JSON.stringify({ done: true }));
    _rtcTransferDone = true; // les changements d'état RTC ultérieurs sont ignorés
    setMediaStatus('🎬 Lecture sur l\'écran', true);
    showMediaPlay(true); setPlayBtn(false); showMediaTimeline(true);
  } catch (e) { setMediaStatus('⚠ Échec du transfert'); }
}

async function remoteHandleAnswer(sdp) {
  if (!_rtcPc) return;
  try {
    await _rtcPc.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const c of _remotePendingIce) { try { await _rtcPc.addIceCandidate(c); } catch (_) {} }
    _remotePendingIce = [];
  } catch (_) {}
}
function remoteAddIce(cand) {
  if (!_rtcPc || !_rtcPc.remoteDescription) { _remotePendingIce.push(cand); return; }
  _rtcPc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
}

// Ferme le transfert/diffusion en cours sans toucher au pool ni notifier l'écran
function teardownBroadcast() {
  if (_fileChannel) { try { _fileChannel.close(); } catch (_) {} _fileChannel = null; }
  if (_rtcPc) { try { _rtcPc.close(); } catch (_) {} _rtcPc = null; }
  _remotePendingIce = [];
  _mediaIsVideo = false; _remotePlaying = false; _remoteDur = 0; _remoteCur = 0;
  if (_seekSendTimer) { clearTimeout(_seekSendTimer); _seekSendTimer = null; }
  showMediaPlay(false); showMediaTimeline(false);
  _mediaSeeking = false;
}

// Arrêt complet (bouton « Arrêter la diffusion ») : vide la sélection + éteint l'écran
function stopMediaBroadcast(notify = true) {
  teardownBroadcast();
  _activeMediaId = null;
  renderPool();
  showMediaStop(false);
  setMediaStatus('Aucun média diffusé');
  if (notify) sendMsg({ type: 'media-stop' });
}

