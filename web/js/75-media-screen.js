// ══════════════════════════ MÉDIA — ÉCRAN (récepteur) ══════════════════════════
let _screenPc = null, _screenPendingIce = [];
let _vidParts = [], _vidMeta = null, _screenVidUrl = null, _screenProgTimer = 0;
// Cache des médias reçus : mediaId → {kind:'img',data} | {kind:'vid',url}.
// Permet d'afficher un média déjà transféré sans nouveau transfert.
const _mediaCache = new Map();
let _mediaOrder = [];       // ordre du pool (ids), envoyé par la télécommande
let _screenActiveId = null; // media affiché actuellement (si connu)

function _urlIsCached(u) {
  let found = false;
  _mediaCache.forEach(c => { if (c.url === u) found = true; });
  return found;
}

// Affiche un média depuis le cache (instantané). Si absent : demande le
// transfert complet à la télécommande (repli).
function screenShowCached(id) {
  const c = _mediaCache.get(id);
  if (!c) { sendMsg({ type: 'media:need', id }); return; }
  _screenActiveId = id;
  if (c.kind === 'img') {
    const im = document.getElementById('screen-media-img');
    if (im) { im.src = c.data; showScreenMedia('img'); }
  } else if (c.kind === 'vid' && c.url) {
    screenPlayVideoUrl(c.url);
  }
}

function screenEvictCached(id) {
  const c = _mediaCache.get(id);
  if (c && c.url && c.url !== _screenVidUrl) { try { URL.revokeObjectURL(c.url); } catch (_) {} }
  _mediaCache.delete(id);
  screenRingForget(id);
}

function showScreenMedia(kind) {
  const img = document.getElementById('screen-media-img');
  const vid = document.getElementById('screen-media-video');
  if (img) img.style.display = kind === 'img' ? 'block' : 'none';
  if (vid) {
    vid.style.display = kind === 'video' ? 'block' : 'none';
    if (kind !== 'video') { vid._wantPlay = false; try { vid.pause(); } catch (_) {} } // coupe le son si une image prend le relais
  }
}

function hideScreenMedia() {
  const img = document.getElementById('screen-media-img');
  const vid = document.getElementById('screen-media-video');
  if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
  if (vid) {
    vid.style.display = 'none';
    vid._wantPlay = false;
    try { vid.pause(); } catch (_) {}
    if (vid.srcObject) vid.srcObject = null;
    vid.removeAttribute('src'); vid.load && vid.load();
  }
  // Ne révoque l'URL que si elle n'est pas conservée dans le cache média
  if (_screenVidUrl) {
    if (!_urlIsCached(_screenVidUrl)) { try { URL.revokeObjectURL(_screenVidUrl); } catch (_) {} }
    _screenVidUrl = null;
  }
  // Les transferts en cours continuent (préchargement) mais ne s'afficheront pas
  _imgBufs.forEach(b => { b.show = false; });
  _vidParts = []; _vidMeta = null;
  cleanupScreenRtc();
}

// Réception d'images/sons en fragments : UN tampon PAR transfert (avant, un
// seul tampon global → un préchargement écrasait l'image demandée), avec des
// plafonds pour qu'un message forgé ne puisse pas saturer la mémoire.
const _imgBufs = new Map();
const IMG_MAX_CHUNKS = 2000, IMG_MAX_PARALLEL = 4, IMG_CHUNK_MAX = 20000;
const _RE_MEDIA_ID = /^[A-Za-z0-9_-]{1,40}$/;
function mediaImgStart(msg) {
  const total = Number(msg.total);
  if (typeof msg.id !== 'string' || !Number.isInteger(total) || total < 1 || total > IMG_MAX_CHUNKS) return;
  const mediaId = (typeof msg.mediaId === 'string' && _RE_MEDIA_ID.test(msg.mediaId)) ? msg.mediaId : null;
  if (_imgBufs.size >= IMG_MAX_PARALLEL) _imgBufs.delete(_imgBufs.keys().next().value); // le plus ancien
  // Console prioritaire (passerelle DMX) : l'image est mise en cache sans s'afficher
  _imgBufs.set(msg.id, { total, parts: new Array(total), got: 0, mediaId, show: msg.show !== false && !screenDmxLive() });
}
function mediaImgChunk(msg) {
  const b = _imgBufs.get(msg.id);
  if (!b) return;
  const i = Number(msg.i);
  if (!Number.isInteger(i) || i < 0 || i >= b.total) return;
  if (typeof msg.data !== 'string' || msg.data.length > IMG_CHUNK_MAX) return;
  if (b.parts[i] === undefined) { b.parts[i] = msg.data; b.got++; }
  if (b.got !== b.total) return;
  _imgBufs.delete(msg.id);
  const raw = b.parts.join('');
  // La bande son du décroché et les sons importés (sonneries, notifications :
  // __ring_…) passent par ce même canal : on valide selon le type attendu
  const isRing = b.mediaId !== null && SRP.RING_ID_RE.test(b.mediaId);
  const isAudio = b.mediaId === '__callaudio' || isRing;
  const dataUrl = isAudio ? safeAudioData(raw) : safeImageData(raw);
  if (!dataUrl) return; // contenu non conforme : ignoré
  // Mise en cache pour affichage instantané ultérieur + accusé de réception
  if (b.mediaId) {
    // Même contenu renvoyé (resynchronisation) : l'entrée et son décodage sont gardés
    const prev = _mediaCache.get(b.mediaId);
    if (!prev || prev.data !== dataUrl) _mediaCache.set(b.mediaId, { kind: isAudio ? 'audio' : 'img', data: dataUrl });
    sendMsg({ type: 'media:cached', id: b.mediaId });
    screenDmxOnCached(b.mediaId);
    // Décodé dès réception : la sonnerie part sans délai au prochain appel
    if (isRing) screenRingWarm(b.mediaId);
  }
  if (b.show && !isAudio) {
    const im = document.getElementById('screen-media-img');
    if (im) { im.src = dataUrl; showScreenMedia('img'); }
    _screenActiveId = b.mediaId || null;
    cleanupScreenRtc(); // une image remplace la vidéo : libère la connexion de transfert
  }
}

// — Lecture robuste : tente avec son, repli en muet si l'autoplay est bloqué —
// _wantPlay : la vidéo DOIT jouer (sert à reprendre après un autoplay bloqué,
// sans relancer une vidéo masquée ou mise en pause depuis la télécommande).
function playScreenVid(vid) {
  vid._wantPlay = true;
  const p = vid.play();
  if (p && p.catch) p.catch(() => {
    if (!vid._wantPlay) return; // mise en pause entre-temps (télécommande, console)
    vid.muted = true; vid._autoMuted = true;
    const p2 = vid.play(); if (p2 && p2.catch) p2.catch(() => {});
  });
}
// — État courant renvoyé à la télécommande (source de vérité) —
function sendScreenState(vid) {
  sendMsg({ type: 'media-progress', cur: vid.currentTime || 0, dur: vid.duration || 0, playing: !vid.paused });
}
// — Réception vidéo via MQTT (repli quand WebRTC est bloqué par le réseau) —
let _vidUp = null; // { id, mime, total, parts, got, poolId, retried }
function screenVidUploadStart(msg) {
  _vidUp = { id: msg.mediaId, mime: msg.mime || 'video/mp4', total: msg.totalChunks,
             parts: new Array(msg.totalChunks), got: 0, poolId: msg.poolId || null, retried: false };
  setScreenStatus('📥 Réception vidéo… 0 %');
}
function screenVidUploadChunk(msg) {
  if (!_vidUp || _vidUp.id !== msg.mediaId) return;
  if (_vidUp.parts[msg.index] === undefined) { _vidUp.parts[msg.index] = msg.data; _vidUp.got++; }
  // Accusé de réception cumulatif : la télécommande régule son débit dessus
  if (_vidUp.got % 16 === 0 || _vidUp.got === _vidUp.total) {
    sendMsg({ type: 'media:chunkack', mediaId: _vidUp.id, got: _vidUp.got });
  }
  if (_vidUp.got % 40 === 0) setScreenStatus('📥 Réception vidéo… ' + Math.round(_vidUp.got / _vidUp.total * 100) + ' %');
}
function screenVidUploadPlay(msg) {
  if (!_vidUp || _vidUp.id !== msg.mediaId) return;
  // Des chunks peuvent encore être en transit : on laisse une seconde chance
  if (_vidUp.got !== _vidUp.total && !_vidUp.retried) {
    _vidUp.retried = true;
    setTimeout(() => screenVidUploadPlay(msg), 2000);
    return;
  }
  if (_vidUp.got !== _vidUp.total) {
    // Fragments perdus : on les redemande à la télécommande au lieu d'abandonner
    _vidUp.retried = false; // nouvelle période de grâce au prochain media:play
    const missing = [];
    for (let i = 0; i < _vidUp.total && missing.length < 400; i++) {
      if (_vidUp.parts[i] === undefined) missing.push(i);
    }
    setScreenStatus('📥 Fragments manquants : ' + (_vidUp.total - _vidUp.got));
    sendMsg({ type: 'media:need-chunks', mediaId: _vidUp.id, missing });
    return;
  }
  const up = _vidUp; _vidUp = null;
  try {
    const bin = atob(up.parts.join(''));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: up.mime });
    const url = URL.createObjectURL(blob);
    setScreenStatus('🎬 Vidéo reçue (' + Math.round(blob.size / 1048576) + ' Mo)');
    if (up.poolId) {
      const old = _mediaCache.get(up.poolId);
      if (old && old.url && old.url !== url) { try { URL.revokeObjectURL(old.url); } catch (_) {} }
      _mediaCache.set(up.poolId, { kind: 'vid', url });
      sendMsg({ type: 'media:cached', id: up.poolId });
      // Console prioritaire (passerelle DMX) : mise en cache seulement
      if (screenDmxLive()) { screenDmxOnCached(up.poolId); return; }
      _screenActiveId = up.poolId;
    } else if (screenDmxLive()) return;
    screenPlayVideoUrl(url);
  } catch (_) { setScreenStatus('⚠ Vidéo illisible'); }
}

