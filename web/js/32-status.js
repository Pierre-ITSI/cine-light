// ══════════════════════════ STATUS ══════════════════════════
function setConnStatus(s) {
  const dot = document.getElementById('connDot'), lbl = document.getElementById('connLabel');
  dot.className = 'dot';
  if (s === 'connected')   { dot.classList.add('connected');  lbl.textContent = '✓ Connecté — canal : ' + channel; }
  else if (s === 'connecting') { dot.classList.add('connecting'); lbl.textContent = 'Connexion…'; }
  else if (s === 'error')      { dot.classList.add('error');      lbl.textContent = 'Erreur — réessayez'; }
  else { lbl.textContent = 'Non connecté'; }
}
function setScreenStatus(msg) {
  const el = document.getElementById('screen-status');
  if (el) el.textContent = msg;
}

// Affiche une confirmation temporaire sur l'écran de jeu (fondu après ~5 s)
let _screenNoticeTimer = null;
function flashScreenNotice(msg, ms) {
  const el = document.getElementById('screen-notice');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  if (_screenNoticeTimer) clearTimeout(_screenNoticeTimer);
  _screenNoticeTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 500);
  }, ms || 5000);
}

// ══════════════════════════ AUTO-SEND ══════════════════════════
function scheduleAutoSend() {
  if (autoSendTimer) clearTimeout(autoSendTimer);
  autoSendTimer = setTimeout(() => {
    sendMsg({ type: 'color', color: currentColor });
    const el = document.getElementById('autosendBadge');
    if (el) { el.classList.add('visible'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('visible'), 600); }
  }, 40);
}

