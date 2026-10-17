// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ MÉDIA — TÉLÉCOMMANDE ══════════════════════════
// Vidéo : transfert du FICHIER vers chaque écran visé via DataChannel WebRTC
// (une connexion pair-à-pair PAR écran, voir « Vidéo » plus bas). L'écran lit
// la vidéo localement (vraie timeline/seek/play-pause natifs), piloté depuis
// le téléphone par messages « media-ctrl » adressés à la cible.
// Multi-écran (28-screens.js) : chaque écran a son cache (accusés
// media:cached, caps.cached) ; un média n'est transféré qu'aux écrans visés
// qui ne l'ont pas, les autres reçoivent media:show. Les retours d'un écran
// (durée, position, fin, erreur) ne s'affichent que s'il fait partie de la
// cible (_rxFrom : écran émetteur, 20-mqtt.js).
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
// Message en cours venu d'un écran de la cible (ou d'un écran inconnu : ancien comportement)
function _mediaFromTarget() { const sid = _rxFrom; return !sid || !scrKnown(sid) || scrInTarget(sid); }
// Lecture vue par un écran (position, durée) : gardée dans son état
function _mediaProgressOf(sid) {
  if (!sid || !scrKnown(sid)) return null;
  const st = scrState(sid);
  return st.progress || (st.progress = { playing: false, cur: 0, dur: 0 });
}
// Reçoit la durée depuis l'écran (métadonnées de la vidéo lue localement par l'écran)
function remoteOnMeta(dur) {
  // L'écran confirme la lecture : le transfert est bien arrivé
  const job = _rxFrom ? _vidJobs.get(_rxFrom) : null;
  if (job) {
    if (job.b64 && job.b64.verifyTimer) { clearTimeout(job.b64.verifyTimer); job.b64.verifyTimer = null; }
    if (job.done) job.status = '🎬 Vidéo en diffusion';
  }
  const p = _mediaProgressOf(_rxFrom);
  if (p) p.dur = dur || 0;
  if (!_mediaFromTarget()) return;
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
  const p = _mediaProgressOf(_rxFrom);
  if (p) { p.cur = cur || 0; if (dur) p.dur = dur; if (typeof playing === 'boolean') p.playing = playing; }
  if (!_mediaFromTarget()) return;
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
  const sid = _rxFrom;
  if (off && sid && scrKnown(sid)) {
    // Mode « 1× puis off » : cet écran a coupé le média à la fin de la lecture
    const st = scrState(sid);
    st.media = null; st.progress = null;
    _vidStopJobs([sid]);
    scrChanged();
  }
  if (!_mediaFromTarget()) return;
  _remotePlaying = false; setPlayBtn(false);
  if (off) {
    if (scrTarget().k === 'all') scrAll().media = null;
    _mediaViewReset();
    _activeMediaId = null;
    renderPool();
    showMediaStop(false);
    setMediaStatus('Lecture terminée — écran libéré');
  }
}
// L'écran n'a pas pu lire la vidéo (codec non supporté, etc.)
function remoteOnError(reason) {
  if (!_mediaFromTarget()) return;
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
// Déclenché par les flèches de la télécommande (pour la cible) ET par le tap
// sur un écran de jeu (media:advance) : pour la cible s'il en fait partie,
// sinon pour lui seul.
function _poolNext(cur, dir) {
  const n = _mediaPool.length;
  const i = _mediaPool.findIndex(m => m.id === cur);
  const base = i < 0 ? (dir > 0 ? -1 : 0) : i;
  return (((base + dir) % n) + n) % n;
}
function advancePool(dir) {
  if (!_mediaPool.length) return;
  const sid = _rxFrom;
  if (sid && scrKnown(sid) && !scrInTarget(sid)) {
    const it = _mediaPool[_poolNext(scrState(sid).media, dir)];
    _vidStopJobs([sid]);
    mediaShowOn(it, [sid]);
    scrChanged();
    return;
  }
  selectMedia(_mediaPool[_poolNext(_activeMediaId, dir)].id);
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
  const ids = scrTargetIds();
  _vidStopJobs(ids); // transferts en cours vers ces écrans : remplacés
  _mediaViewReset();
  _activeMediaId = id;
  if (scrTarget().k === 'all') scrAll().media = id;
  renderPool();
  showMediaStop(true);
  if (it.kind === 'vid') _mediaIsVideo = true;
  if (!ids.length) {
    // Aucun écran annoncé : il recevra ce média à sa connexion (24-resync.js)
    setMediaStatus('⏳ En attente d\'un écran…');
    return;
  }
  mediaShowOn(it, ids, true);
}

// Affiche un média du pool sur ces écrans : media:show (instantané) à ceux
// qui l'ont en cache, transfert complet aux autres seulement. fromUi : choix
// de la télécommande (réglage de fin de lecture de la cible joint).
function mediaShowOn(it, ids, fromUi) {
  ids = ids.filter(scrKnown);
  if (!ids.length) return;
  for (const s of ids) scrState(s).media = it.id;
  const have = ids.filter((s) => scrState(s).cached.has(it.id));
  // Transfert : écrans en ligne seulement (un écran absent le recevra à sa
  // resynchronisation, son état attendu étant noté ci-dessus)
  const lack = ids.filter((s) => !scrState(s).cached.has(it.id) && scrOnline(s));
  if (have.length) {
    sendMsg({ type: 'media:show', id: it.id, target: { screens: have } });
    if (fromUi && it.kind === 'vid') sendMsg({ type: 'media:endmode', mode: _videoEndMode, target: { screens: have } });
  }
  // Bluetooth seul (commandes uniquement) : le média manquant n'est pas envoyé ;
  // son état attendu est noté, il partira dès le retour d'Internet ou du Wi-Fi local
  if (lack.length && linkBleOnly()) {
    scrChanged();
    if (ids.some(scrInTarget)) setMediaStatus('⚠ Bluetooth : « ' + it.name + ' » n\'est pas préparé sur ' + (lack.length > 1 ? lack.length + ' écrans' : 'l\'écran') + ' — il faut Internet ou le Wi-Fi local');
    return;
  }
  if (lack.length) {
    if (it.kind === 'img') broadcastImage(it.file, it.id, lack);
    else broadcastVideo(it.file, it.id, lack);
  }
  scrChanged();
  if (lack.length || !ids.some(scrInTarget)) return;
  if (!have.length) { setMediaStatus('⏳ En attente d\'un écran…'); return; } // écrans visés hors ligne
  // Chemin rapide : déjà en cache sur les écrans → affichage instantané
  if (it.kind === 'vid') {
    _mediaIsVideo = true; _remotePlaying = true;
    showMediaPlay(true); setPlayBtn(true); showMediaTimeline(true);
    setMediaStatus('🎬 Lecture instantanée (cache écran)', true);
  } else {
    setMediaStatus('🖼 Affichage instantané (cache écran)', true);
  }
}

// L'écran a avancé tout seul (avance locale) : son état, et l'interface s'il est dans la cible
function remoteOnScreenAdvanced(id) {
  const it = _mediaPool.find(m => m.id === id);
  if (!it) return;
  const sid = _rxFrom;
  if (sid && scrKnown(sid)) { scrState(sid).media = id; _vidStopJobs([sid]); scrChanged(); }
  if (!_mediaFromTarget()) return;
  if (scrTarget().k === 'all') scrAll().media = id;
  _mediaViewReset();
  _activeMediaId = id;
  renderPool();
  showMediaStop(true);
  if (it.kind === 'vid') {
    _mediaIsVideo = true; _remotePlaying = true;
    showMediaPlay(true); setPlayBtn(true); showMediaTimeline(true);
  }
  setMediaStatus((it.kind === 'vid' ? '🎬 ' : '🖼 ') + it.name + ' (avance écran)', true);
}

// Un écran ne possède pas ce média en cache : transfert complet, à lui seul
// (son importé d'un appel : renvoyé par 81-ringtones.js)
function remoteOnScreenNeeds(id) {
  if (linkBleOnly()) return; // Bluetooth seul : aucun média ne peut partir (l'écran redemandera)
  const sid = _rxFrom && scrKnown(_rxFrom) ? _rxFrom : null;
  if (SRP.RING_ID_RE.test(id)) { ringOnScreenNeeds(id, sid); return; }
  const ids = sid ? [sid] : scrTargetIds();
  for (const s of ids) scrState(s).cached.delete(id);
  _screenCached.delete(id);
  scrRefreshCachedView();
  const it = _mediaPool.find(m => m.id === id);
  if (!it) return;
  if (it.kind === 'img') broadcastImage(it.file, it.id, sid ? ids : undefined);
  else broadcastVideo(it.file, it.id, ids);
}

function removeMedia(id) {
  const idx = _mediaPool.findIndex(m => m.id === id);
  if (idx < 0) return;
  const it = _mediaPool[idx];
  if (it.thumb && it.thumb.indexOf('blob:') === 0) { try { URL.revokeObjectURL(it.thumb); } catch (_) {} }
  const wasActive = (_activeMediaId === id);
  _mediaPool.splice(idx, 1);
  for (const [sid, job] of [..._vidJobs]) if (job.mediaId === id) _vidStopJobs([sid]);
  _screenCached.delete(id);
  sendMsg({ type: 'media:evict', id }); // tous les écrans (pool commun)
  sendPoolOrder();
  if (wasActive) stopMediaBroadcast(true); else renderPool();
}

// ── Cache des écrans : suivi des médias déjà transférés + préchargement ──
// Chaque écran met en cache chaque média reçu (par id) et accuse réception
// (media:cached) : noté dans SON état (28-screens.js). Les affichages
// suivants ne coûtent qu'un mini message media:show au lieu d'un re-transfert
// complet → quasi instantané.
const _screenCached = new Set();    // médias en cache sur tous les écrans (en ligne) de la cible (scrRefreshCachedView)
const _preloadInflight = new Map(); // média → écrans en cours de préchargement
let _preloadRunning = false;

// Accusé « en cache » d'un écran
function remoteOnScreenCached(id) {
  const sid = _rxFrom;
  if (sid && scrKnown(sid)) {
    scrState(sid).cached.add(id);
    // Vidéo préparée : l'accusé de mise en cache vaut confirmation (aucune lecture n'en suivra)
    const job = _vidJobs.get(sid);
    if (job && job.prep && job.mediaId === id && job.b64 && job.b64.verifyTimer) { clearTimeout(job.b64.verifyTimer); job.b64.verifyTimer = null; }
    const inf = _preloadInflight.get(id);
    if (inf) inf.delete(sid);
    scrRefreshCachedView();
    scrChanged();
  } else {
    _screenCached.add(id); // écran sans identifiant (ancien)
    _preloadInflight.delete(id);
  }
  remoteOnCallAssetCached(id);
}

// Ordre du pool : tous les écrans (avance locale, n° de média de la console),
// ou ceux d'une resynchronisation
function sendPoolOrder(target) {
  if (_mediaPool.length) sendMsg(Object.assign({ type: 'media:order', ids: _mediaPool.map(m => m.id) }, target ? { target } : {}));
}

function schedulePreload() { setTimeout(preloadPoolToScreen, 300); }

// Précharge en arrière-plan les images du pool vers les écrans en ligne qui
// ne les ont pas (séquentiel, une image à la fois, adressée à ces écrans).
// Les vidéos sont mises en cache par l'écran à leur première lecture.
async function preloadPoolToScreen() {
  if (_preloadRunning || mode !== 'remote') return;
  if (!mediaLinkUp()) return; // Internet ou Wi-Fi local : jamais en Bluetooth (21-links.js)
  _preloadRunning = true;
  try {
    for (const it of [..._mediaPool]) {
      if (it.kind !== 'img') continue;
      const lack = () => scrList().filter((s) => scrOnline(s) && !scrState(s).cached.has(it.id)
        && !(_preloadInflight.has(it.id) && _preloadInflight.get(it.id).has(s)));
      if (!lack().length) continue;
      // PRIORITÉ au transfert vidéo WebRTC : le préchargement se met en pause
      // pour ne pas noyer la signalisation (offre/réponse/ICE) sur le broker.
      for (let g = 0; g < 150 && _vidJobsBusy(); g++) {
        await new Promise(r => setTimeout(r, 400));
      }
      if (!mediaLinkUp()) return;
      const ids = lack();
      if (!ids.length || !_mediaPool.includes(it)) continue;
      if (!_preloadInflight.has(it.id)) _preloadInflight.set(it.id, new Set());
      const inf = _preloadInflight.get(it.id);
      for (const s of ids) inf.add(s);
      try {
        const dataUrl = await compressImageFile(it.file);
        await sendImageChunks(dataUrl, { mediaId: it.id, show: false, screens: ids });
        await _waitForCached(it.id, 5000, ids);
      } catch (_) {}
      for (const s of ids) inf.delete(s);
      if (!inf.size) _preloadInflight.delete(it.id);
      await new Promise(r => setTimeout(r, 150)); // souffle pour le broker
    }
  } finally { _preloadRunning = false; }
}

// Attend l'accusé des écrans donnés (ou, sans liste, la vue _screenCached)
function _waitForCached(id, ms, ids) {
  return new Promise(res => {
    const t0 = Date.now();
    (function poll() {
      const done = ids ? ids.every((s) => !scrKnown(s) || scrState(s).cached.has(id)) : _screenCached.has(id);
      if (done || Date.now() - t0 > ms) return res();
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

// Image affichée sur les écrans donnés (défaut : la cible ; aucun écran
// connu : sans adresse, comme avant)
async function broadcastImage(file, mediaId, screens) {
  let dataUrl;
  try { dataUrl = await compressImageFile(file); }
  catch (_) { setMediaStatus('⚠ Image illisible'); return; }
  const ids = screens || scrTargetIds();
  sendImageChunks(dataUrl, { mediaId: mediaId || null, show: true, screens: ids.length ? ids : undefined });
  if (ids.length && !ids.some(scrInTarget)) return;
  showMediaStop(true);
  setMediaStatus('🖼 Image diffusée (' + Math.round(dataUrl.length / 1024) + ' Ko)', true);
}

// Data-URL en fragments (images, photo d'appel, bande son, sons importés).
// opts.screens : écrans destinataires (target.screens) ; absent : cible courante.
async function sendImageChunks(dataUrl, opts) {
  const o = opts || {};
  let t = {};
  if (Array.isArray(o.screens)) {
    if (!o.screens.length) return;
    t = { target: { screens: o.screens.slice() } };
  }
  const id = Math.random().toString(36).slice(2, 8);
  const CHUNK = 12000;
  const total = Math.ceil(dataUrl.length / CHUNK);
  sendMsg(Object.assign({ type: 'media-img-start', id, total, mediaId: o.mediaId || null, show: o.show !== false }, t));
  for (let i = 0; i < total; i++) {
    sendMsg(Object.assign({ type: 'media-img-chunk', id, i, data: dataUrl.slice(i * CHUNK, (i + 1) * CHUNK) }, t));
    if (i % 16 === 15) await new Promise(r => setTimeout(r, 8)); // laisse respirer le broker
  }
}

// ══════════ Vidéo : un transfert par écran ══════════
// Choix retenu : UNE connexion pair-à-pair (RTCPeerConnection + canal de
// données « file », chiffré DTLS) PAR écran visé, et repli base64 PAR écran.
//   • Offre, candidats ICE : adressés à cet écran seul (target.screens) ; sa
//     réponse et ses candidats lui sont rattachés par son étiquette
//     d'émetteur authentifiée (_rxFrom). Avant : une offre à tous, « la
//     première réponse gagne », les autres écrans ne recevaient rien.
//   • Chaque écran reçoit le fichier à son rythme, en parallèle ; un écran lent
//     ou injoignable ne bloque pas les autres ; un pair-à-pair qui échoue
//     (isolation Wi-Fi, réseaux différents) ne bascule QUE cet écran sur le
//     relais (fragments media:chunk adressés à lui, régulés par SES accusés,
//     fragments manquants renvoyés à lui seul).
//   • Le relais ne transporte que la signalisation : un envoi groupé en
//     base64 à tous les écrans ferait passer N fois moins d'octets par le
//     relais, mais le plus lent dicterait le débit de tous et une perte
//     obligerait à tout renvoyer. Le repli base64 reste l'exception.
const _vidJobs = new Map(); // screenId → transfert en cours (ou terminé, jusqu'au suivant)
let _vidBatch = 0;          // n° de la dernière diffusion (progression affichée)
let _rtcTransferDone = false; // tous les transferts pair-à-pair de la dernière diffusion sont terminés
let _rtcBroken = false;       // pair-à-pair constaté bloqué vers au moins un écran (session)

function broadcastVideo(file, mediaId, screens) {
  // Écrans connus et en ligne (un pair-à-pair vers un absent ne s'établirait jamais)
  const ids = (screens || scrTargetIds()).filter((s) => scrKnown(s) && scrOnline(s));
  const ui = !ids.length || ids.some(scrInTarget);
  if (ui) {
    _mediaIsVideo = true;
    _remotePlaying = false; _remoteDur = 0; _remoteCur = 0;
    showMediaStop(true);
  }
  if (!ids.length) { if (ui) setMediaStatus('⏳ En attente d\'un écran…'); return; }
  // Fin de lecture de chaque écran, avant le fichier
  const modes = new Map();
  for (const s of ids) { const m = scrState(s).endMode; if (!modes.has(m)) modes.set(m, []); modes.get(m).push(s); }
  for (const [m, s] of modes) sendMsg({ type: 'media:endmode', mode: m, target: { screens: s } });
  const batch = ++_vidBatch;
  _rtcTransferDone = false;
  for (const sid of ids) {
    const st = scrState(sid);
    if (mediaId) st.media = mediaId;
    const job = _vidNewJob(sid, file, mediaId, batch);
    // Écran natif (pas de WebRTC) ou pair-à-pair déjà constaté bloqué vers lui
    if (st.rtcBroken || (st.caps && st.caps.videoMode === 'b64')) _vidStartB64(job);
    else _vidStartRtc(job);
  }
  scrChanged();
  _vidRenderStatus();
}

function _vidNewJob(sid, file, mediaId, batch) {
  _vidStopJobs([sid]);
  const job = { sid, file, mediaId: mediaId || null, batch, mode: null, pc: null, ch: null, pendingIce: [],
    done: false, failed: false, closed: false, pct: 0, status: '🎬 Préparation du transfert…', b64: null };
  _vidJobs.set(sid, job);
  return job;
}
const _vidLive = (job) => !job.closed && _vidJobs.get(job.sid) === job;
function _vidCloseJob(job) {
  job.closed = true;
  if (job.ch) { try { job.ch.close(); } catch (_) {} job.ch = null; }
  if (job.pc) { try { job.pc.close(); } catch (_) {} job.pc = null; }
  if (job.b64 && job.b64.verifyTimer) { clearTimeout(job.b64.verifyTimer); job.b64.verifyTimer = null; }
}
// Arrête les transferts vers ces écrans (null : tous)
function _vidStopJobs(ids) {
  for (const [sid, job] of [..._vidJobs]) {
    if (ids && !ids.includes(sid)) continue;
    _vidCloseJob(job);
    _vidJobs.delete(sid);
  }
}
// Un transfert pair-à-pair est-il en cours ? (le préchargement d'images attend)
function _vidJobsBusy() {
  for (const j of _vidJobs.values()) if (j.mode === 'rtc' && !j.done && !j.failed && !j.closed) return true;
  return false;
}
// Progression affichée : transferts de la dernière diffusion vers la cible
function _vidRenderStatus() {
  const jobs = [..._vidJobs.values()].filter((j) => !j.prep && j.batch === _vidBatch && scrInTarget(j.sid));
  if (!jobs.length) return;
  if (jobs.length === 1) { setMediaStatus(jobs[0].status, jobs[0].done && !jobs[0].failed && !/^⚠|^⏳/.test(jobs[0].status)); return; }
  const live = jobs.filter((j) => !j.done && !j.failed);
  if (live.length) {
    const pct = Math.round(live.reduce((a, j) => a + j.pct, 0) / live.length);
    setMediaStatus('📤 Transfert vers ' + live.length + ' écrans… ' + pct + ' %');
    return;
  }
  const failed = jobs.filter((j) => j.failed || /^⚠/.test(j.status)).length;
  if (failed) setMediaStatus('⚠ Transfert incomplet vers ' + failed + (failed > 1 ? ' écrans' : ' écran'));
  else setMediaStatus('🎬 Lecture sur ' + jobs.length + ' écrans', true);
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
// Conversion partagée par les écrans qui reçoivent le même fichier
let _b64Of = { file: null, p: null };
function _vidFileB64(file) {
  if (_b64Of.file !== file) _b64Of = { file, p: fileToBase64(file) };
  return _b64Of.p;
}

// — Pair-à-pair vers un écran —
async function _vidStartRtc(job) {
  job.mode = 'rtc';
  job.status = '🎬 Connexion à l\'écran…';
  const target = { screens: [job.sid] };
  let pc;
  try { pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] }); }
  catch (_) { _vidRtcFailed(job); return; }
  job.pc = pc;
  pc.onicecandidate = e => { if (e.candidate && _vidLive(job)) sendMsg({ type: 'rtc-ice', from: 'remote', candidate: e.candidate, target }); };
  pc.onconnectionstatechange = () => {
    if (!_vidLive(job) || job.pc !== pc) return; // connexion remplacée : ignorer
    if (job.done) return;                         // transfert terminé : les aléas sont sans effet
    // 'disconnected' est souvent transitoire en WebRTC : on laisse la
    // connexion se rétablir d'elle-même au lieu d'afficher une erreur.
    if (pc.connectionState === 'failed') _vidRtcFailed(job);
  };
  const ch = pc.createDataChannel('file', { ordered: true });
  ch.binaryType = 'arraybuffer';
  job.ch = ch;
  ch.onopen = () => { if (_vidLive(job) && job.ch === ch) { job.chOpen = true; sendFileOverChannel(job); } };
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
  } catch (_) { if (_vidLive(job)) _vidRtcFailed(job); return; }
  if (!_vidLive(job)) return;
  // Préparation hors ligne : « cache », l'écran ne coupe ni n'affiche rien
  sendMsg({ type: 'rtc-offer', sdp: pc.localDescription, kind: job.prep ? 'cache' : 'file', target });
  _vidRenderStatus();
}
// Pair-à-pair bloqué vers cet écran : bascule IMMÉDIATE sur l'envoi par le
// relais, pour lui seul (mémorisé pour la session)
function _vidRtcFailed(job) {
  scrState(job.sid).rtcBroken = true;
  _rtcBroken = true;
  if (job.ch) { try { job.ch.close(); } catch (_) {} job.ch = null; }
  if (job.pc) { try { job.pc.close(); } catch (_) {} job.pc = null; }
  job.status = '🌐 Connexion directe impossible — envoi via le canal…';
  _vidRenderStatus();
  _vidStartB64(job);
}

async function sendFileOverChannel(job) {
  const ch = job.ch, file = job.file;
  const CHUNK = 16 * 1024;
  const HIGH = 4 * 1024 * 1024; // backpressure à 4 Mo
  ch.bufferedAmountLowThreshold = 1 * 1024 * 1024;
  const meta = { meta: true, name: file.name, size: file.size, mime: file.type || 'video/mp4', mediaId: job.mediaId };
  if (job.prep) meta.show = false; // préparation : mise en cache seulement
  ch.send(JSON.stringify(meta));
  let offset = 0;
  job.status = '📤 Transfert… 0 %';
  _vidRenderStatus();
  try {
    while (offset < file.size) {
      if (ch.readyState !== 'open' || !_vidLive(job)) return;
      const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
      ch.send(buf);
      offset += buf.byteLength;
      if (ch.bufferedAmount > HIGH) {
        await new Promise(res => { ch.onbufferedamountlow = () => { ch.onbufferedamountlow = null; res(); }; });
      }
      const pct = Math.round((offset / file.size) * 100);
      if (pct !== job.pct && pct % 5 === 0) { job.pct = pct; job.status = '📤 Transfert… ' + pct + ' %'; _vidRenderStatus(); }
    }
    ch.send(JSON.stringify({ done: true }));
    job.done = true; job.pct = 100; // les changements d'état RTC ultérieurs sont ignorés
    job.status = '🎬 Lecture sur l\'écran';
    _rtcTransferDone = ![..._vidJobs.values()].some((j) => j.batch === job.batch && j.mode === 'rtc' && !j.done && !j.failed && !j.closed);
    if (!job.prep && scrInTarget(job.sid)) { showMediaPlay(true); setPlayBtn(false); showMediaTimeline(true); }
    _vidRenderStatus();
  } catch (e) {
    if (!_vidLive(job)) return;
    job.failed = true; job.status = '⚠ Échec du transfert';
    _vidRenderStatus();
  }
}

// Réponse / candidats de l'écran émetteur, appliqués à SA connexion
function _vidRtcJobOf(sid) {
  if (sid) { const j = _vidJobs.get(sid); return j && j.mode === 'rtc' && j.pc ? j : null; }
  // Écran sans identifiant : seule connexion en attente de réponse
  const waiting = [..._vidJobs.values()].filter((j) => j.mode === 'rtc' && j.pc && !j.pc.remoteDescription);
  return waiting.length === 1 ? waiting[0] : null;
}
async function remoteHandleAnswer(sdp) {
  const job = _vidRtcJobOf(_rxFrom);
  if (!job || job.pc.signalingState !== 'have-local-offer') return;
  const pc = job.pc;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const c of job.pendingIce.splice(0)) { try { await pc.addIceCandidate(c); } catch (_) {} }
  } catch (_) {}
}
function remoteAddIce(cand) {
  const job = _vidRtcJobOf(_rxFrom);
  if (!job) return;
  if (!job.pc.remoteDescription) { job.pendingIce.push(cand); return; }
  job.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
}

// — Repli base64 par le relais, pour un écran —
// Écrans natifs (pas de WebRTC) et pair-à-pair bloqué par le réseau.
// Transfert FIABILISÉ : fenêtre d'envoi régulée par les accusés de réception
// de CET écran (media:chunkack) + renvoi des fragments manquants
// (media:need-chunks). Le statut « en diffusion » n'est affiché que quand
// l'écran confirme réellement la lecture (media-meta).
const _sleepMs = ms => new Promise(r => setTimeout(r, ms));
async function _vidStartB64(job) {
  job.mode = 'b64';
  if (!/^🌐/.test(job.status)) job.status = '🎬 Préparation de l\'envoi…';
  _vidRenderStatus();
  let b64;
  try { b64 = await _vidFileB64(job.file); }
  catch (_) { job.failed = true; job.status = '⚠ Lecture du fichier impossible'; _vidRenderStatus(); return; }
  if (!_vidLive(job)) return;
  const id = Math.random().toString(36).slice(2, 8);
  const mime = job.file.type || 'video/mp4';
  const CHUNK = 12000;
  const total = Math.ceil(b64.length / CHUNK);
  const chunks = [];
  for (let i = 0; i < total; i++) chunks.push(b64.slice(i * CHUNK, (i + 1) * CHUNK));
  const target = { screens: [job.sid] };
  job.b64 = { id, chunks, rounds: 0, got: 0, noAck: false, verifyTimer: null, target };
  sendMsg(Object.assign({ type: 'media:upload', mediaId: id, kind: 'video', mime, totalChunks: total, poolId: job.mediaId, target },
    job.prep ? { show: false } : {})); // préparation : mise en cache seulement
  job.status = '📤 Transfert… 0 %';
  _vidRenderStatus();
  const WINDOW = 48; // fragments en vol au maximum (si l'écran accuse réception)
  for (let i = 0; i < total; i++) {
    if (!_vidLive(job)) return; // remplacé par un autre envoi
    let waited = 0;
    while (!job.b64.noAck && i - job.b64.got > WINDOW) {
      await _sleepMs(120); waited += 120;
      if (!_vidLive(job)) return;
      // Récepteur sans accusés (ancien écran / natif) : on n'attend plus
      if (waited >= 4000 && job.b64.got === 0) { job.b64.noAck = true; break; }
      if (waited >= 20000) break; // sécurité anti-blocage
    }
    sendMsg({ type: 'media:chunk', mediaId: id, index: i, data: chunks[i], target });
    if (i % 12 === 11) {
      await _sleepMs(10);
      job.pct = Math.round(((i + 1) / total) * 100);
      job.status = '📤 Transfert… ' + job.pct + ' %';
      _vidRenderStatus();
    }
  }
  if (!_vidLive(job)) return;
  sendMsg({ type: 'media:play', mediaId: id, target });
  job.done = true; job.pct = 100;
  job.status = '⏳ Vérification de la réception…';
  _vidRenderStatus();
  _armB64VerifyTimer(job);
}

// Sans confirmation de lecture (media-meta) ni demande de renvoi : alerter
function _armB64VerifyTimer(job) {
  if (job.b64.verifyTimer) clearTimeout(job.b64.verifyTimer);
  job.b64.verifyTimer = setTimeout(() => {
    job.b64.verifyTimer = null;
    if (!_vidLive(job)) return;
    job.status = '⚠ Pas de confirmation de l\'écran — vérifiez sa connexion';
    _vidRenderStatus();
  }, 12000);
}

// Transfert base64 auquel répond l'écran émetteur
function _vidB64JobOf(sid, mediaId) {
  const j = sid ? _vidJobs.get(sid) : [..._vidJobs.values()].find((x) => x.b64 && x.b64.id === mediaId);
  return j && j.b64 && j.b64.id === mediaId && _vidLive(j) ? j : null;
}
function remoteOnChunkAck(m) {
  const job = _vidB64JobOf(_rxFrom, m.mediaId);
  if (job) job.b64.got = Math.max(job.b64.got, m.got);
}

// L'écran signale des fragments perdus : on ne renvoie que ceux-là, à lui seul
async function resendMissingChunks(msg) {
  const job = _vidB64JobOf(_rxFrom, msg.mediaId);
  if (!job) return;
  const b = job.b64;
  if (b.verifyTimer) { clearTimeout(b.verifyTimer); b.verifyTimer = null; }
  const miss = Array.isArray(msg.missing) ? msg.missing : [];
  if (!miss.length || b.rounds >= 3) {
    job.status = '⚠ Transfert incomplet — réessayez';
    _vidRenderStatus();
    return;
  }
  b.rounds++;
  job.status = '📤 Renvoi de ' + miss.length + ' fragments… (' + b.rounds + '/3)';
  _vidRenderStatus();
  for (let j = 0; j < miss.length; j++) {
    const i = miss[j];
    if (b.chunks[i] == null) continue;
    if (!_vidLive(job)) return;
    sendMsg({ type: 'media:chunk', mediaId: b.id, index: i, data: b.chunks[i], target: b.target });
    if (j % 12 === 11) await _sleepMs(12);
  }
  sendMsg({ type: 'media:play', mediaId: b.id, target: b.target });
  job.status = '⏳ Vérification de la réception…';
  _vidRenderStatus();
  _armB64VerifyTimer(job);
}

// Remet à zéro les contrôles de lecture vidéo de l'interface (sans toucher aux transferts)
function _mediaViewReset() {
  _mediaIsVideo = false; _remotePlaying = false; _remoteDur = 0; _remoteCur = 0;
  if (_seekSendTimer) { clearTimeout(_seekSendTimer); _seekSendTimer = null; }
  showMediaPlay(false); showMediaTimeline(false);
  _mediaSeeking = false;
}
// Arrêt complet (bouton « Arrêter la diffusion ») : vide la sélection + éteint
// les écrans de la cible. everywhere : tous les transferts (retour à l'accueil)
function stopMediaBroadcast(notify = true, everywhere = false) {
  _vidStopJobs(everywhere ? null : scrTargetIds());
  _mediaViewReset();
  _activeMediaId = null;
  if (scrTarget().k === 'all') scrAll().media = null;
  renderPool();
  showMediaStop(false);
  setMediaStatus('Aucun média diffusé');
  if (notify) sendMsg({ type: 'media-stop' });
}
