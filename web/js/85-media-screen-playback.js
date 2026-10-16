// — Comportement de fin de lecture (reçu de la télécommande) —
let _screenVidEndMode = 'loop';
function screenSetEndMode(m) {
  _screenVidEndMode = (m === 'pause' || m === 'off') ? m : 'loop';
  const vid = document.getElementById('screen-media-video');
  if (vid) vid.loop = _screenVidEndMode === 'loop'; // s'applique aussi à la vidéo en cours
}

// — Contrôle de lecture envoyé par la télécommande —
function screenMediaCtrl(msg) {
  const vid = document.getElementById('screen-media-video');
  if (!vid || !vid.src) return;
  if (msg.action === 'play')  { playScreenVid(vid); }
  else if (msg.action === 'pause') { vid._wantPlay = false; try { vid.pause(); } catch (_) {} }
  else if (msg.action === 'seek' && isFinite(msg.time)) { try { vid.currentTime = msg.time; } catch (_) {} sendScreenState(vid); }
}

async function screenHandleOffer(sdp) {
  cleanupScreenRtc();
  _screenPendingIce = [];
  _vidParts = []; _vidMeta = null;
  const oldVid = document.getElementById('screen-media-video'); // stoppe la vidéo précédente pendant le transfert
  if (oldVid && !screenDmxLive()) { try { oldVid.pause(); } catch (_) {} }
  _screenPc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  _screenPc.onicecandidate = e => { if (e.candidate) sendMsg({ type: 'rtc-ice', from: 'screen', candidate: e.candidate }); };
  _screenPc.ondatachannel = e => setupScreenFileChannel(e.channel);
  try {
    await _screenPc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await _screenPc.createAnswer();
    await _screenPc.setLocalDescription(answer);
    sendMsg({ type: 'rtc-answer', sdp: _screenPc.localDescription });
    for (const c of _screenPendingIce) { try { await _screenPc.addIceCandidate(c); } catch (_) {} }
    _screenPendingIce = [];
  } catch (_) {}
}

function setupScreenFileChannel(ch) {
  ch.binaryType = 'arraybuffer';
  _vidParts = []; _vidMeta = null;
  ch.onmessage = ev => {
    if (typeof ev.data === 'string') {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.meta) { _vidMeta = m; _vidParts = []; }
      else if (m.done) screenAssembleVideo();
    } else {
      _vidParts.push(ev.data); // ArrayBuffer
    }
  };
}

function screenAssembleVideo() {
  if (!_vidParts.length) return;
  const blob = new Blob(_vidParts, { type: (_vidMeta && _vidMeta.mime) || 'video/mp4' });
  _vidParts = [];
  const mediaId = _vidMeta && _vidMeta.mediaId;
  const url = URL.createObjectURL(blob);
  setScreenStatus('🎬 Vidéo reçue (' + Math.round(blob.size / 1048576) + ' Mo)');
  // Mise en cache : les prochains affichages de cette vidéo seront instantanés
  if (mediaId) {
    const old = _mediaCache.get(mediaId);
    if (old && old.url && old.url !== url) { try { URL.revokeObjectURL(old.url); } catch (_) {} }
    _mediaCache.set(mediaId, { kind: 'vid', url });
    sendMsg({ type: 'media:cached', id: mediaId });
    // Console prioritaire (passerelle DMX) : mise en cache seulement
    if (screenDmxLive()) { screenDmxOnCached(mediaId); return; }
    _screenActiveId = mediaId;
  } else if (screenDmxLive()) return;
  screenPlayVideoUrl(url);
}

// Branche l'élément <video> sur une URL (transfert frais ou cache) et joue.
function screenPlayVideoUrl(url) {
  const vid = document.getElementById('screen-media-video');
  if (!vid) return;
  // Libère l'ancienne URL seulement si elle n'appartient pas au cache
  if (_screenVidUrl && _screenVidUrl !== url && !_urlIsCached(_screenVidUrl)) {
    try { URL.revokeObjectURL(_screenVidUrl); } catch (_) {}
  }
  _screenVidUrl = url;
  vid.srcObject = null;
  vid.loop = _screenVidEndMode === 'loop';
  vid.playsInline = true; vid.muted = false; vid.preload = 'auto';
  vid.onloadedmetadata = () => { sendMsg({ type: 'media-meta', dur: vid.duration }); sendScreenState(vid); };
  vid.onloadeddata = () => { showScreenMedia('video'); }; // première image visible dès que prête
  vid.ontimeupdate = () => {
    const now = Date.now();
    if (now - _screenProgTimer < 250) return;
    _screenProgTimer = now;
    sendScreenState(vid);
  };
  vid.onplay  = () => sendScreenState(vid);
  vid.onpause = () => sendScreenState(vid);
  vid.onended = () => {
    vid._wantPlay = false;
    if (screenDmxOwnsMedia()) return; // console : « lecture » s'arrête sur la dernière image
    if (_screenVidEndMode === 'off') {
      // « 1× puis off » : coupe le média, l'écran revient au fond couleur
      hideScreenMedia();
      sendMsg({ type: 'media-ended', off: true });
    } else {
      // « 1× puis pause » : reste figé sur la dernière image
      sendMsg({ type: 'media-ended' });
    }
  };
  vid.onerror = () => {
    const code = vid.error && vid.error.code;
    const reason = (code === 4) ? 'src' : (code === 3) ? 'decode' : 'load';
    setScreenStatus('⚠ Format vidéo non supporté');
    sendMsg({ type: 'media-error', reason });
  };
  vid.src = url;
  showScreenMedia('video');
  playScreenVid(vid); // démarre la lecture (muet si l'autoplay bloque le son)
}

function screenAddIce(cand) {
  if (!_screenPc || !_screenPc.remoteDescription) { _screenPendingIce.push(cand); return; }
  _screenPc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
}
function cleanupScreenRtc() {
  if (_screenPc) { try { _screenPc.close(); } catch (_) {} _screenPc = null; }
  _screenPendingIce = [];
}

