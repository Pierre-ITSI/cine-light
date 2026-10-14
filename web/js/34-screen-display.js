// ══════════════════════════ SCREEN DISPLAY ══════════════════════════
let screenStrobeTimer = null, screenBaseColor = '#1a1a1a';
function receiveColor(color) {
  screenBaseColor = color;
  if (!screenStrobeTimer) {
    const sc = document.getElementById('screen-mode');
    sc.style.transition = 'background-color 0.15s ease';
    sc.style.backgroundColor = color;
  }
}

// ── Maintien de l'écran allumé (Screen Wake Lock) ──
// Demandé une fois à l'entrée en mode écran, puis renouvelé à chaque retour
// au premier plan (le navigateur le libère quand la page est masquée).
let _wakeLock = null, _wakeWanted = false;
async function acquireWakeLock() {
  _wakeWanted = true;
  if (!('wakeLock' in navigator) || _wakeLock) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (_) { _wakeLock = null; }
}
function releaseWakeLock() {
  _wakeWanted = false;
  if (_wakeLock) { try { _wakeLock.release(); } catch (_) {} _wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _wakeWanted) acquireWakeLock();
});
function receiveStrobe(msg) {
  if (screenStrobeTimer) { clearTimeout(screenStrobeTimer); screenStrobeTimer = null; }
  suspendScreenFx(!!msg.active); // le strobe prime sur le canvas d'effet
  const sc = document.getElementById('screen-mode');
  if (!msg.active) { sc.style.transition = 'background-color 0.3s'; sc.style.backgroundColor = screenBaseColor; setTorch(false); return; }
  sc.style.transition = 'none';
  const useTorch = msg.torch;
  function flash() {
    let freq = msg.freq, dur = msg.dur;
    if (msg.random) { freq = msg.freqMin+Math.random()*(msg.freqMax-msg.freqMin); dur = msg.durMin+Math.random()*(msg.durMax-msg.durMin); }
    const interval = Math.max(dur+5, 1000/freq);
    sc.style.backgroundColor = screenBaseColor;
    if (useTorch) setTorch(true);
    screenStrobeTimer = setTimeout(() => {
      sc.style.backgroundColor='#000';
      if (useTorch) setTorch(false);
      screenStrobeTimer=setTimeout(flash,interval-dur);
    }, dur);
  }
  flash();
}
function toggleHex() {}

