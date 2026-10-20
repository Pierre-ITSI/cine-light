// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ TORCH & VIBRATE (receiver) ══════════════════════════
let torchEnabled = false, torchTrack = null, vibrateEnabled = true;

async function toggleScreenTorch() {
  const btn = document.getElementById('torchBtn');
  if (torchEnabled) {
    torchEnabled = false;
    if (torchTrack) { try { await torchTrack.applyConstraints({ advanced:[{torch:false}] }); } catch(_){} torchTrack.stop(); torchTrack = null; }
    btn.classList.remove('on'); btn.textContent = '🔦 Torche';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } });
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (!caps.torch) { stream.getTracks().forEach(t=>t.stop()); btn.classList.add('unavail'); btn.textContent = '🔦 Indispo (iPhone)'; return; }
    torchTrack = track; torchEnabled = true;
    btn.classList.add('on'); btn.textContent = '🔦 Torche ON';
  } catch(e) { btn.classList.add('unavail'); btn.textContent = '🔦 Refusé'; }
}

// Ouvre (une seule fois) la caméra arrière pour piloter sa LED. Avant ce
// correctif, torchTrack n'était jamais renseigné : la torche ne s'allumait pas.
let _torchAcquire = null;
function _acquireTorchTrack() {
  if (torchTrack) return Promise.resolve(torchTrack);
  if (_torchAcquire) return _torchAcquire;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(null);
  _torchAcquire = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      const track = stream.getVideoTracks()[0];
      const caps = track && track.getCapabilities ? track.getCapabilities() : {};
      if (!caps.torch) { stream.getTracks().forEach(t => t.stop()); return null; }
      torchTrack = track; torchEnabled = true;
      return track;
    })
    .catch(() => null)
    .finally(() => { _torchAcquire = null; });
  return _torchAcquire;
}

async function setTorch(on) {
  if (!torchTrack) {
    if (!on) return;                 // inutile d'ouvrir la caméra pour éteindre
    await _acquireTorchTrack();
    if (!torchTrack) return;
  }
  try { await torchTrack.applyConstraints({ advanced:[{torch:on}] }); } catch(_){}
}

// Libère la caméra (fin de session écran)
function releaseTorch() {
  if (torchTrack) { try { torchTrack.stop(); } catch (_) {} torchTrack = null; }
  torchEnabled = false;
}

function toggleScreenVibrate() {
  vibrateEnabled = !vibrateEnabled;
  const btn = document.getElementById('vibrateBtn');
  btn.classList.toggle('on', vibrateEnabled);
  btn.textContent = vibrateEnabled ? '📳 Vibreur' : '📳 Muet';
  if (!navigator.vibrate) { btn.classList.add('unavail'); btn.textContent = '📳 N/A'; vibrateEnabled = false; }
}

function doVibrate(pattern) {
  if (vibrateEnabled && navigator.vibrate) navigator.vibrate(pattern);
}

// Remote: send vibration command to receiver
function sendVibrate(pattern) {
  sendMsg({ type:'vibrate', pattern });
}

// ══════════════════════════ CAPACITÉS APPAREIL (torche / vibreur) ══════════════════════════
// iOS/WebKit n'expose ni la torche LED ni l'API Vibration → indisponible sur iPhone/iPad.
function _isIOSDevice() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Récepteur : annonce ses capacités à la télécommande
function sendCaps() {
  const ios = _isIOSDevice();
  // L'écran PWA reçoit la vidéo via WebRTC (DataChannel).
  // Champs optionnels (ignorés par les anciennes télécommandes) pour la
  // resynchronisation : médias présents dans le cache de l'écran et média
  // actuellement affiché — la télécommande ne renvoie que ce qui manque.
  const cached = [];
  _mediaCache.forEach((c, id) => { if (cached.length < 500 && /^[A-Za-z0-9_-]{1,64}$/.test(id)) cached.push(id); });
  // screenId : identifiant stable de cet écran (liste des écrans appairés) ;
  // name / groups : ceux donnés par la télécommande (screen:config), qu'elle
  // complète s'ils ont changé pendant que l'écran était absent
  const caps = { type: 'caps', torch: !ios, vibrate: !ios && !!navigator.vibrate, videoMode: 'rtc',
            cached, active: screenMediaVisible() ? (_screenActiveId || null) : null,
            blackout: screenBlackoutOn, screenId: screenId() };
  if (_screenCfg.name) caps.name = _screenCfg.name;
  if (_screenCfg.groups.length) caps.groups = _screenCfg.groups.slice();
  // Clé par écran (29-revoke.js) : échange pris en charge, et kid de la clé détenue
  caps.kx = 1;
  if (_pw) caps.kid = _pw.kid;
  // Bluetooth seul (4 Kio par trame) : une longue liste du cache ne tiendrait
  // pas ; sans elle, la télécommande garde celle de la dernière annonce
  if (linkBleOnly() && JSON.stringify(caps).length > LINK_CAPS_BLE_MAX) delete caps.cached;
  sendMsg(caps);
}

// Télécommande : applique les capacités reçues à la vue Flash de Lumière (transport
// vidéo de chaque écran : scrState(id).caps, 28-screens.js)
function applyReceiverCaps(caps) {
  const flash = document.getElementById('content-flash');
  const notice = document.getElementById('flashUnavailNotice');
  const unavailable = caps && caps.torch === false;
  if (flash) flash.classList.toggle('torch-unavailable', unavailable);
  if (notice) notice.style.display = unavailable ? 'block' : 'none';
}

// ══════════════════════════ FLASH TAB — TÉLÉCOMMANDE ══════════════════════════
let remoteTorchOn = false, activeEffect = null;

function onRemoteTorchToggle() {
  remoteTorchOn = !remoteTorchOn;
  const btn = document.getElementById('remoteTorchBtn');
  btn.classList.toggle('on', remoteTorchOn);
  document.getElementById('remoteTorchLabel').textContent = remoteTorchOn ? 'Torche allumée' : 'Allumer la torche';
  document.getElementById('remoteTorchIcon').innerHTML = icon(remoteTorchOn ? 'lightbulb' : 'flashlight');
  document.getElementById('torchDimSection').classList.toggle('torch-dim-disabled', !remoteTorchOn);
  if (!remoteTorchOn) stopActiveEffect();
  sendMsg({ type:'torch-onoff', on: remoteTorchOn });
  renderNavStatus();
}

function onTorchDimChange() {
  const level = parseInt(document.getElementById('torchDimSlider').value);
  document.getElementById('torchDimVal').innerHTML = level + '<span>%</span>';
  document.getElementById('torchLevelFill').style.width = level + '%';
  sendMsg({ type:'torch-dim', level });
}

function sendTorchEffect(effect, acked) {
  // Clignotement rapide de la torche : avertissement photosensibilité d'abord (46-strobe-warning.js)
  if (!acked && needsFlashWarning('torch', effect)) { openFlashWarning(() => sendTorchEffect(effect, true)); return; }
  stopActiveEffect();
  if (effect === 'stop') { sendMsg({ type:'torch-effect', effect:'stop' }); renderNavStatus(); return; }
  activeEffect = effect;
  document.querySelectorAll('.effect-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('efx-' + effect);
  if (btn) btn.classList.add('active');
  if (!remoteTorchOn) {
    remoteTorchOn = true;
    document.getElementById('remoteTorchBtn').classList.add('on');
    document.getElementById('remoteTorchLabel').textContent = 'Torche allumée';
    document.getElementById('remoteTorchIcon').innerHTML = icon('lightbulb');
  }
  sendMsg({ type:'torch-effect', effect });
  renderNavStatus();
}

function stopActiveEffect() {
  activeEffect = null;
  document.querySelectorAll('.effect-btn').forEach(b => b.classList.remove('active'));
}

// ══════════════════════════ FLASH TAB — RÉCEPTEUR (web) ══════════════════════════
let _torchDimTimer = null, _torchEffectTimer = null;
let _torchDimLevel = 100;

function receiveTorchOnOff(on) {
  stopTorchDimLoop(); stopTorchEffectLoop();
  setTorch(on);
}

function receiveTorchDim(level) {
  stopTorchEffectLoop();
  _torchDimLevel = level;
  if (level <= 0)   { stopTorchDimLoop(); setTorch(false); return; }
  if (level >= 100) { stopTorchDimLoop(); setTorch(true); return; }
  // Met à jour le niveau sans redémarrer la boucle si déjà active
  if (_torchDimTimer) return;
  _startWebTorchDimLoop();
}

function _startWebTorchDimLoop() {
  const period = 50; // 20Hz
  function cycle() {
    if (_torchDimLevel >= 100) { setTorch(true); _torchDimTimer = null; return; }
    const onTime = Math.max(3, Math.round(period * _torchDimLevel / 100));
    setTorch(true);
    _torchDimTimer = setTimeout(() => {
      setTorch(false);
      _torchDimTimer = setTimeout(cycle, period - onTime);
    }, onTime);
  }
  cycle();
}

function receiveTorchEffect(effect) {
  stopTorchDimLoop(); stopTorchEffectLoop();
  if (effect === 'stop') { setTorch(false); return; }
  const patterns = {
    'sos':        [200,100,200,100,200,400,500,100,500,100,500,400,200,100,200,100,200,1200],
    'blink-slow': [600,400],
    'blink-fast': [80,80],
    'police':     [60,40,60,40,60,200,60,40,60,40,60,500],
    'heartbeat':  [80,80,160,600],
  };
  const p = patterns[effect]; if (!p) return;
  let idx = 0, state = true;
  function step() {
    setTorch(state); state = !state;
    _torchEffectTimer = setTimeout(() => { idx = (idx + 1) % p.length; step(); }, p[idx]);
    idx = (idx + 1) % p.length;
  }
  step();
}

function stopTorchDimLoop() { if (_torchDimTimer) { clearTimeout(_torchDimTimer); _torchDimTimer = null; } }
function stopTorchEffectLoop() { if (_torchEffectTimer) { clearTimeout(_torchEffectTimer); _torchEffectTimer = null; } }

