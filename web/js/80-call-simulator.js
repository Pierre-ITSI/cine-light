// ══════════════════════════ SIMULATEUR D'APPEL ══════════════════════════
// Télécommande : configure et déclenche. Écran : affiche l'overlay (appel
// générique/iOS/Android, SMS, WhatsApp), sonne (WebAudio, sans fichiers),
// vibre (Android) et renvoie son état (ringing/incall/declined/ended).

// — Télécommande —
let callKind = 'call', callStyle = 'glass', callRing = 'classic', _callPhoto = null;
let _callUiTimer = null, _callUiT0 = 0;

// Application fictive par défaut selon le type de message (modifiable)
const _CALL_APP_DEFAULTS = { sms: { name: 'SMS', color: '#2f8cf0' }, chat: { name: 'Messagerie', color: '#7a5af8' } };
const _CALL_STYLE_HINTS = {
  glass: 'Translucide et flouté, boutons ronds.',
  tonal: 'Surfaces tonales, gros avatar, boutons pilule.',
  minimal: 'Sobre et contrasté, sans effet.',
};

function setCallKind(k) {
  callKind = k;
  ['call','sms','chat'].forEach(x => {
    const b = document.getElementById('callkind-' + x);
    if (b) b.classList.toggle('active', x === k);
  });
  // Nom/couleur d'app : on applique le défaut du type tant que l'utilisateur
  // ne les a pas personnalisés
  const def = _CALL_APP_DEFAULTS[k];
  const an = document.getElementById('callAppName'), ac = document.getElementById('callAppColor');
  if (def && an && !an.dataset.touched) an.value = def.name;
  if (def && ac && !ac.dataset.touched) ac.value = def.color;
  document.getElementById('callPresentRow').style.display = k === 'call' ? 'block' : 'none';
  document.getElementById('callMsgPanel').style.display = k === 'call' ? 'none' : 'block';
  document.getElementById('callLockPanel').style.display = k === 'call' ? 'none' : 'block';
  document.getElementById('callRingPanel').style.display = k === 'call' ? 'block' : 'none';
  _syncCallPhotoRow();
  const btn = document.getElementById('callTriggerBtn');
  if (btn) btn.innerHTML = k === 'call'
    ? '<span class="media-icon">📞</span> Faire sonner'
    : '<span class="media-icon">💬</span> Envoyer la notification';
}
function setCallStyle(s) {
  callStyle = s;
  ['glass','tonal','minimal'].forEach(x => {
    const b = document.getElementById('callstyle-' + x);
    if (b) b.classList.toggle('active', x === s);
  });
  const h = document.getElementById('callStyleHint');
  if (h) h.textContent = _CALL_STYLE_HINTS[s] || '';
  _syncCallPhotoRow();
}

// Présentation de l'appel entrant : plein écran ou bandeau haut
let callPresent = 'full', callPhotoMode = 'avatar';
function setCallPresent(v) {
  callPresent = v;
  ['full','banner'].forEach(x => {
    const b = document.getElementById('callpres-' + x);
    if (b) b.classList.toggle('active', x === v);
  });
}
function setCallPhotoMode(v) {
  callPhotoMode = v;
  ['avatar','full'].forEach(x => {
    const b = document.getElementById('callphoto-' + x);
    if (b) b.classList.toggle('active', x === v);
  });
}
function _syncCallPhotoRow() {
  const r = document.getElementById('callPhotoModeRow');
  // Photo plein écran disponible pour Verre et Tonal (Épuré reste sobre)
  if (r) r.style.display = (callKind === 'call' && callStyle !== 'minimal') ? 'block' : 'none';
}

// Bande son jouée par l'écran quand le comédien décroche (voix du correspondant).
// Envoyée en fragments fiables et mise en cache sur l'écran sous '__callaudio'.
let _callAudioData = null;
function onCallAudio(files) {
  if (!files || !files[0]) return;
  const f = files[0];
  const st = document.getElementById('callAudioStatus');
  if (f.size > 8 * 1024 * 1024) {
    if (st) st.textContent = '⚠ Fichier trop lourd (max ~8 Mo) — coupez un extrait plus court.';
    return;
  }
  const r = new FileReader();
  r.onload = async () => {
    _callAudioData = String(r.result);
    if (st) st.textContent = '📤 Envoi de la bande son…';
    await sendImageChunks(_callAudioData, { mediaId: '__callaudio', show: false });
    if (st) st.textContent = '✓ « ' + (f.name || 'audio') + ' » prête — jouée au décroché.';
    const c = document.getElementById('callAudioClear');
    if (c) c.style.display = 'inline-block';
  };
  r.onerror = () => { if (st) st.textContent = '⚠ Lecture du fichier impossible'; };
  r.readAsDataURL(f);
}
function clearCallAudio() {
  _callAudioData = null;
  const st = document.getElementById('callAudioStatus');
  if (st) st.textContent = 'Aucune bande son — le décroché reste silencieux.';
  const c = document.getElementById('callAudioClear');
  if (c) c.style.display = 'none';
  sendMsg({ type: 'media:evict', id: '__callaudio' });
}
function setCallRing(r) {
  callRing = r;
  ['classic','digital','soft','silent'].forEach(x => {
    const b = document.getElementById('callring-' + x);
    if (b) b.classList.toggle('active', x === r);
  });
}
function onCallAutoChange() {
  const v = parseInt(document.getElementById('callAutoSlider').value) || 0;
  document.getElementById('callAutoVal').textContent = v > 0 ? v + ' s' : 'Off';
}
function onCallPhoto(files) {
  if (!files || !files[0]) return;
  const img = new Image();
  img.onload = () => {
    // On conserve le ratio (cap 640 px sur le grand côté) : bon rendu à la
    // fois en avatar rond (cover) et en photo plein écran. Compressé pour
    // rester sous la limite de taille d'un message MQTT.
    const maxD = 640;
    let w = img.width, h = img.height;
    const s = Math.min(1, maxD / Math.max(w, h));
    w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    _callPhoto = c.toDataURL('image/jpeg', 0.7);
    URL.revokeObjectURL(img.src);
    const pv = document.getElementById('callPhotoPreview');
    if (pv) pv.style.backgroundImage = 'url(' + _callPhoto + ')';
  };
  img.onerror = () => URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(files[0]);
}
// Fond d'écran du faux écran verrouillé : compressé puis envoyé à l'écran
// via le protocole de chunks images, mis en cache sous l'id '__lockwall'.
let _lockWallData = null;
function onLockWall(files) {
  if (!files || !files[0]) return;
  const img = new Image();
  img.onload = async () => {
    const maxD = 1280;
    let w = img.width, h = img.height;
    const s = Math.min(1, maxD / Math.max(w, h));
    w = Math.round(w * s); h = Math.round(h * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    _lockWallData = c.toDataURL('image/jpeg', 0.7);
    URL.revokeObjectURL(img.src);
    const pv = document.getElementById('lockWallPreview');
    if (pv) pv.style.backgroundImage = 'url(' + _lockWallData + ')';
    const st = document.getElementById('lockWallStatus');
    if (st) st.textContent = "📤 Envoi du fond d'écran…";
    await sendImageChunks(_lockWallData, { mediaId: '__lockwall', show: false });
    if (st) st.textContent = "✓ Fond d'écran prêt sur l'écran";
  };
  img.onerror = () => URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(files[0]);
}
function triggerCall() {
  const lockOn = callKind !== 'call' && document.getElementById('lockToggle').checked;
  sendMsg({
    type: 'call:start',
    kind: callKind,
    style: callStyle,
    name: (document.getElementById('callName').value || 'Inconnu').slice(0, 40),
    label: (document.getElementById('callLabel').value || '').slice(0, 40),
    msg: (document.getElementById('callMsgText').value || '').slice(0, 200),
    appName: (document.getElementById('callAppName').value || '').slice(0, 24),
    appColor: document.getElementById('callAppColor').value,
    photo: _callPhoto,
    ring: callRing,
    present: callPresent,
    photoMode: (callStyle !== 'minimal') ? callPhotoMode : 'avatar',
    hasAudio: !!_callAudioData,
    autoAnswer: parseInt(document.getElementById('callAutoSlider').value) || 0,
    lock: lockOn ? {
      time: (document.getElementById('lockTime').value || '').slice(0, 8),
      date: (document.getElementById('lockDate').value || '').slice(0, 30),
    } : null,
  });
  _setCallStatusUI(callKind === 'call' ? '📞 Sonnerie envoyée…' : '💬 Notification envoyée');
}
function _setCallStatusUI(t) {
  const el = document.getElementById('callStatus');
  if (el) el.textContent = t;
}
function remoteOnCallState(m) {
  if (_callUiTimer) { clearInterval(_callUiTimer); _callUiTimer = null; }
  if (m.state === 'ringing') _setCallStatusUI("📞 Ça sonne sur l'écran…");
  else if (m.state === 'incall') {
    _callUiT0 = Date.now();
    _callUiTimer = setInterval(() => {
      const s = Math.floor((Date.now() - _callUiT0) / 1000);
      _setCallStatusUI('🟢 En ligne · ' + fmtTime(s));
    }, 500);
    _setCallStatusUI('🟢 En ligne');
  }
  else if (m.state === 'declined') _setCallStatusUI('🔴 Refusé sur l\'écran');
  else if (m.state === 'ended') _setCallStatusUI('⏹ Terminé');
}

// — Écran : sons synthétisés (WebAudio, aucun fichier) —
let _audioCtx = null, _callRingTimer = null, _callVibTimer = null;
let _callClockTimer = null, _callAutoTimer = null, _callT0Scr = 0;
let _callState = 'idle', _callCfg = null;

function _ac() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
    return _audioCtx;
  } catch (_) { return null; }
}
function _tone(freq, t0, dur, vol, type) {
  const ctx = _ac(); if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + t0);
  g.gain.linearRampToValueAtTime(vol, ctx.currentTime + t0 + 0.02);
  g.gain.setTargetAtTime(0, ctx.currentTime + t0 + dur, 0.05);
  o.connect(g); g.connect(ctx.destination);
  o.start(ctx.currentTime + t0);
  o.stop(ctx.currentTime + t0 + dur + 0.3);
}
function _ringBurst(kind) {
  if (kind === 'digital') { for (let i = 0; i < 4; i++) _tone(950, i * 0.18, 0.12, 0.14, 'square'); }
  else if (kind === 'soft') { [523, 659, 784, 1047].forEach((f, i) => _tone(f, i * 0.16, 0.3, 0.14, 'sine')); }
  else { _tone(440, 0, 1.2, 0.12, 'sine'); _tone(480, 0, 1.2, 0.12, 'sine'); } // classique
}
function _startRinging(kind) {
  if (kind === 'silent') return;
  _ringBurst(kind);
  const IV = { digital: 1600, soft: 2300 };
  _callRingTimer = setInterval(() => _ringBurst(kind), IV[kind] || 3000);
}
function _playNotifSound(kind) {
  if (kind === 'chat') { _tone(880, 0, 0.09, 0.16, 'sine'); _tone(1174, 0.12, 0.12, 0.16, 'sine'); }
  else { [1318, 1046, 784].forEach((f, i) => _tone(f, i * 0.13, 0.18, 0.15, 'sine')); }
}

// — Écran : overlay —
// Trois styles neutres, inspirés des usages mobiles mais sans aucune marque,
// logo ou libellé d'application tierce (exigence App Store / Google Play) :
//   glass   « Verre »  : translucidité, flou, boutons ronds
//   tonal   « Tonal »  : surfaces tonales, boutons pilule avec libellé
//   minimal « Épuré »  : sobre, contrasté
const _SC_STYLES = ['glass', 'tonal', 'minimal'];
// Compatibilité avec les anciennes valeurs envoyées par une télécommande non à jour
function _scStyle(s) {
  const legacy = { ios: 'glass', android: 'tonal', generic: 'minimal' };
  s = legacy[s] || s;
  return _SC_STYLES.includes(s) ? s : 'glass';
}
function _scInitial(m) {
  return escapeHtml(String(m.name || '?').trim().charAt(0).toUpperCase() || '?');
}
function _scAvatarHtml(m, cls) {
  return m.photo
    ? '<div class="' + (cls || 'sc-avatar') + '" style="background-image:url(' + m.photo + ')"></div>'
    : '<div class="' + (cls || 'sc-avatar') + '">' + _scInitial(m) + '</div>';
}
// Fond : photo floutée (mode avatar) ou photo plein écran nette + voile
function _scBg(m) {
  if (!m.photo || m.style === 'minimal') return '';
  if (m.photoMode === 'full') {
    return '<div class="sc-bg full" style="background-image:url(' + m.photo + ')"></div>'
      + '<div class="sc-fullshade"></div>';
  }
  return m.style === 'glass' ? '<div class="sc-bg" style="background-image:url(' + m.photo + ')"></div>' : '';
}
// Avatar masqué quand la photo occupe déjà tout l'écran
function _scHeadAvatar(m) {
  return (m.photoMode === 'full' && m.photo && m.style !== 'minimal') ? '' : _scAvatarHtml(m);
}

function screenCallStart(m) {
  screenCallStopTimers();
  _stopCallAudio();
  _callHideSeq++; // annule une éventuelle fermeture animée encore en attente
  // Tout ce qui vient du réseau est normalisé/validé avant d'être affiché
  m = m || {};
  _callCfg = {
    kind: m.kind === 'call' ? 'call' : (m.kind === 'sms' ? 'sms' : 'chat'), // 'whatsapp' (ancien) → 'chat'
    style: _scStyle(m.style),
    name: String(m.name || '').slice(0, 40),
    label: String(m.label || '').slice(0, 40),
    msg: String(m.msg || '').slice(0, 200),
    appName: String(m.appName || '').slice(0, 24),
    appColor: safeHexColor(m.appColor, null),
    photo: safeImageData(m.photo),
    photoMode: m.photoMode === 'full' ? 'full' : 'avatar',
    present: m.present === 'banner' ? 'banner' : 'full',
    ring: m.ring,
    hasAudio: !!m.hasAudio,
    autoAnswer: Math.max(0, Math.min(60, Number(m.autoAnswer) || 0)),
    lock: m.lock ? { time: String(m.lock.time || '').slice(0, 8), date: String(m.lock.date || '').slice(0, 30) } : null,
  };
  const el = document.getElementById('screen-call'); if (!el) return;
  el.style.display = 'block';
  if (_callCfg.kind === 'call') {
    _callState = 'ringing';
    // Présentation « bandeau haut » (téléphone en cours d'utilisation) ou plein écran
    if (_callCfg.present === 'banner') { el.classList.add('notif'); _scRenderCallBar(); }
    else { el.classList.remove('notif'); _scRenderIncoming(); }
    _startRinging(_callCfg.ring || 'classic');
    if (navigator.vibrate) {
      navigator.vibrate([700, 300, 700]);
      _callVibTimer = setInterval(() => navigator.vibrate([700, 300, 700]), 2200);
    }
    if (_callCfg.autoAnswer > 0) _callAutoTimer = setTimeout(screenCallAnswer, _callCfg.autoAnswer * 1000);
    sendMsg({ type: 'call:state', state: 'ringing' });
  } else {
    _callState = 'notif';
    if (_callCfg.lock) {
      // Notification sur faux écran verrouillé (plein écran)
      el.classList.remove('notif');
      _scRenderLock();
      // Comme un vrai téléphone : l'écran se rendort tout seul après ~10 s
      _callAutoTimer = setTimeout(() => { if (_callState === 'notif') screenCallEnd(); }, 10000);
    } else {
      el.classList.add('notif');
      el.innerHTML = _scNotifCard(_callCfg, '');
    }
    _playNotifSound(_callCfg.kind);
    if (navigator.vibrate) navigator.vibrate([200, 120, 200]);
  }
}

// Application fictive affichée sur les notifications (nom + couleur réglables)
function _scApp(m) {
  const sms = m.kind === 'sms';
  return {
    name: m.appName || (sms ? 'SMS' : 'Messagerie'),
    color: m.appColor || (sms ? '#2f8cf0' : '#7a5af8'),
    icon: sms ? _SCI.bubble : _SCI.chat,
  };
}
// Carte de notification (bannière ou écran verrouillé), selon le style
function _scNotifCard(m, extraCls) {
  const app = _scApp(m);
  const cls = 'sc-notif ' + m.style + (extraCls ? ' ' + extraCls : '');
  const click = extraCls ? '' : ' onclick="event.stopPropagation();screenCallEnd()"';
  const name = escapeHtml(m.name || ''), msg = escapeHtml(m.msg || ''), appName = escapeHtml(app.name);
  if (m.style === 'tonal') {
    // En-tête discret (pastille + nom d'app), avatar de l'expéditeur à droite
    return '<div class="' + cls + '"' + click + '>'
      + '<div class="sc-notif-body">'
      + '<div class="n-head"><span class="n-dot" style="background:' + app.color + '">' + app.icon + '</span>'
      + appName + ' · maintenant</div>'
      + '<div class="sc-notif-name">' + name + '</div>'
      + '<div class="sc-notif-msg">' + msg + '</div>'
      + '</div>'
      + _scAvatarHtml(m, 'n-avatar')
      + '</div>';
  }
  return '<div class="' + cls + '"' + click + '>'
    + '<div class="sc-notif-icon" style="background:' + app.color + '">' + app.icon + '</div>'
    + '<div class="sc-notif-body">'
    + '<div class="n-title"><span class="sc-notif-name">' + name + '</span><span class="n-time">maintenant</span></div>'
    + '<div class="sc-notif-msg">' + msg + '</div>'
    + (m.style === 'minimal' ? '<div class="n-app">' + appName + '</div>' : '')
    + '</div></div>';
}

// — Faux écran verrouillé : fond choisi, date + horloge, notification,
// raccourcis et barre de navigation, déclinés selon le style. —
function _scLockDate(d) {
  const j = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
  const mo = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return j[d.getDay()] + ' ' + d.getDate() + ' ' + mo[d.getMonth()];
}
function _scRenderLock() {
  const m = _callCfg, el = document.getElementById('screen-call');
  const wall = _mediaCache.get('__lockwall');
  const wallUrl = wall && wall.kind === 'img' ? wall.data : null;
  const now = new Date();
  const time = m.lock.time || (String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
  const date = m.lock.date || _scLockDate(now);
  // Tonal : heures et minutes empilées
  const clock = m.style === 'tonal'
    ? escapeHtml(time).replace(':', '<br>')
    : escapeHtml(time);
  const shortcuts = m.style === 'minimal' ? '' :
    '<div class="sc-lock-bottom">'
    + '<button class="sc-lock-circle" onclick="event.stopPropagation()">' + (m.style === 'tonal' ? _SCI.handset : _SCI.flash) + '</button>'
    + '<button class="sc-lock-circle" onclick="event.stopPropagation()">' + _SCI.camera + '</button>'
    + '</div>';
  el.innerHTML = '<div class="sc-lock ' + m.style + '"' + (wallUrl ? ' style="background-image:url(' + wallUrl + ')"' : '')
    + ' onclick="event.stopPropagation();screenCallEnd()">'
    + '<div class="sc-lock-shade"></div>'
    + '<div class="sc-lock-date">' + escapeHtml(date) + '</div>'
    + '<div class="sc-lock-time">' + clock + '</div>'
    + _scNotifCard(m, 'in-lock')
    + shortcuts
    + '<div class="sc-lock-home"></div>'
    + '</div>';
}

// Icônes SVG génériques (aucun logo d'application tierce)
const _HANDSET_PATH = 'M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';
const _SCI = {
  handset: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="' + _HANDSET_PATH + '"/></svg>',
  handsetDown: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><g transform="rotate(135 12 12)"><path d="' + _HANDSET_PATH + '"/></g></svg>',
  micSlash: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="4.5" y1="3.5" x2="19.5" y2="20.5"/></svg>',
  keypad: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">' + [4.5, 9, 13.5, 18].map(y => [7, 12, 17].map(x => '<circle cx="' + x + '" cy="' + y + '" r="1.7"/>').join('')).join('') + '</svg>',
  speaker: '<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M3 9v6h4l5 4.5v-15L7 9H3z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a9 9 0 0 1 0 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="4.5" x2="12" y2="19.5"/><line x1="4.5" y1="12" x2="19.5" y2="12"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><rect x="2" y="6.5" width="13.5" height="11" rx="3.2"/><path d="M17 10.6l4.3-2.8c.3-.2.7 0 .7.4v7.6c0 .4-.4.6-.7.4L17 13.4v-2.8z"/></svg>',
  contacts: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5v.5H3V19z"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.6 14.3c2.8.3 5.4 2.1 5.4 4.7v.5h-4.2c0-2-.4-3.8-1.2-5.2z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>',
  bubble: '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.8 1.5 5.3 3.9 6.9-.1 1-.5 2.3-1.6 3.4 1.9-.2 3.4-1 4.4-1.7 1 .2 2.1.4 3.3.4 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="#fff" d="M5 3.5h14a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5H10l-4.6 3.6c-.4.3-.9 0-.9-.5v-3.1A2.5 2.5 0 0 1 2.5 15V6A2.5 2.5 0 0 1 5 3.5z"/><g fill="rgba(0,0,0,.35)"><circle cx="8" cy="10.5" r="1.3"/><circle cx="12" cy="10.5" r="1.3"/><circle cx="16" cy="10.5" r="1.3"/></g></svg>',
  flash: '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M8.5 2h7v3.2L13.6 8.6v10.9a1.6 1.6 0 0 1-3.2 0V8.6L8.5 5.2V2z"/><rect x="8.5" y="3.4" width="7" height="1.3" fill="#000" fill-opacity=".25"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M4.5 7h2.6l1.5-2h6.8l1.5 2h2.6A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-9A1.5 1.5 0 0 1 4.5 7z"/><circle cx="12" cy="12.8" r="3.6" fill="#3a3a42"/><circle cx="12" cy="12.8" r="2.2" fill="#fff"/></svg>',
};

// Boutons d'action (même handler pour les 3 styles)
const _SC_DECLINE = 'event.stopPropagation();screenCallDecline()';
const _SC_ANSWER = 'event.stopPropagation();screenCallAnswer()';
const _SC_HANGUP = 'event.stopPropagation();screenCallEnd()';

function _scRenderIncoming() {
  const m = _callCfg, el = document.getElementById('screen-call');
  const name = escapeHtml(m.name || 'Inconnu');
  let html;
  if (m.style === 'glass') {
    html = _scBg(m)
      + '<div class="sc-head">' + _scHeadAvatar(m)
      + '<div class="sc-name">' + name + '</div>'
      + '<div class="sc-sub">' + escapeHtml(m.label || 'mobile') + '</div></div>'
      + '<div class="sc-bottom">'
      + '<div class="sc-row" style="padding:0 16px">'
      + '<div class="sc-col"><button class="sc-btn sc-mini">' + _SCI.clock + '</button><span>Me le rappeler</span></div>'
      + '<div class="sc-col"><button class="sc-btn sc-mini">' + _SCI.bubble + '</button><span>Message</span></div>'
      + '</div>'
      + '<div class="sc-row" style="padding:0 8px">'
      + '<div class="sc-col"><button class="sc-btn sc-round sc-no" onclick="' + _SC_DECLINE + '">' + _SCI.handsetDown + '</button><span>Refuser</span></div>'
      + '<div class="sc-col"><button class="sc-btn sc-round sc-ok" onclick="' + _SC_ANSWER + '">' + _SCI.handset + '</button><span>Accepter</span></div>'
      + '</div></div>';
  } else if (m.style === 'tonal') {
    html = _scBg(m)
      + '<div class="sc-kicker">Appel entrant</div>'
      + '<div class="sc-head">' + _scHeadAvatar(m)
      + '<div class="sc-name">' + name + '</div>'
      + '<div class="sc-sub">' + escapeHtml(m.label || 'Mobile') + '</div></div>'
      + '<div class="sc-bottom"><div class="sc-row" style="gap:16px;justify-content:center">'
      + '<button class="sc-btn sc-pill sc-no" onclick="' + _SC_DECLINE + '">' + _SCI.handsetDown + 'Refuser</button>'
      + '<button class="sc-btn sc-pill sc-ok" onclick="' + _SC_ANSWER + '">' + _SCI.handset + 'Répondre</button>'
      + '</div></div>';
  } else {
    html = _scAvatarHtml(m)
      + '<div class="sc-name">' + name + '</div>'
      + '<div class="sc-sub" style="margin-top:6px">' + escapeHtml(m.label || 'Appel entrant') + '</div>'
      + '<div class="sc-bottom"><div class="sc-row">'
      + '<div class="sc-col"><button class="sc-btn sc-round sc-no" onclick="' + _SC_DECLINE + '">' + _SCI.handsetDown + '</button><span>Refuser</span></div>'
      + '<div class="sc-col"><button class="sc-btn sc-round sc-ok" onclick="' + _SC_ANSWER + '">' + _SCI.handset + '</button><span>Répondre</span></div>'
      + '</div></div>';
  }
  el.innerHTML = '<div class="sc-call ' + m.style + '">' + html + '</div>';
}

function _scRenderInCall() {
  const m = _callCfg, el = document.getElementById('screen-call');
  const name = escapeHtml(m.name || 'Inconnu');
  const g = (icon, lbl) => '<div class="sc-col"><button class="sc-btn sc-gbtn">' + icon + '</button><span>' + lbl + '</span></div>';
  let html;
  if (m.style === 'minimal') {
    html = _scAvatarHtml(m)
      + '<div class="sc-name">' + name + '</div>'
      + '<div class="sc-timer" id="scCallTimer">00:00</div>'
      + '<div class="sc-bottom" style="align-items:center">'
      + '<div class="sc-col"><button class="sc-btn sc-round sc-no" onclick="' + _SC_HANGUP + '">' + _SCI.handsetDown + '</button><span>Raccrocher</span></div>'
      + '</div>';
  } else {
    const tonal = m.style === 'tonal';
    html = _scBg(m)
      + '<div class="sc-head">'
      + (tonal ? _scHeadAvatar(m) : '')
      + '<div class="sc-name" style="font-size:1.7rem">' + name + '</div>'
      + '<div class="sc-timer" id="scCallTimer">00:00</div></div>'
      + '<div class="sc-grid">'
      + g(_SCI.micSlash, tonal ? 'Muet' : 'muet') + g(_SCI.keypad, tonal ? 'Clavier' : 'clavier') + g(_SCI.speaker, tonal ? 'Haut-parleur' : 'haut-parleur')
      + g(_SCI.plus, tonal ? 'Ajouter' : 'ajouter') + g(_SCI.video, tonal ? 'Vidéo' : 'vidéo') + (tonal ? g(_SCI.pause, 'Attente') : g(_SCI.contacts, 'contacts'))
      + '</div>'
      + '<div class="sc-bottom" style="align-items:center">'
      + (tonal
        ? '<button class="sc-btn sc-hangup sc-no" onclick="' + _SC_HANGUP + '">' + _SCI.handsetDown + '</button>'
        : '<button class="sc-btn sc-round sc-no" onclick="' + _SC_HANGUP + '">' + _SCI.handsetDown + '</button>')
      + '</div>';
  }
  el.innerHTML = '<div class="sc-call ' + m.style + '">' + html + '</div>';
}

// Bandeau d'appel entrant en haut (téléphone en cours d'utilisation)
function _scRenderCallBar() {
  const m = _callCfg, el = document.getElementById('screen-call');
  const info = '<div class="cb-info"><div class="cb-name">' + escapeHtml(m.name || 'Inconnu') + '</div>'
    + '<div class="cb-sub">' + escapeHtml(m.label || 'Appel entrant') + '</div></div>';
  let html;
  if (m.style === 'tonal') {
    // Tonal : boutons pilule libellés sous l'identité de l'appelant
    html = _scAvatarHtml(m, 'cb-avatar') + info
      + '<div class="cb-actions">'
      + '<button class="sc-btn sc-pill sc-no" onclick="' + _SC_DECLINE + '">Refuser</button>'
      + '<button class="sc-btn sc-pill sc-ok" onclick="' + _SC_ANSWER + '">Répondre</button>'
      + '</div>';
  } else {
    html = _scAvatarHtml(m, 'cb-avatar') + info
      + '<button class="sc-btn cb-btn sc-no" onclick="' + _SC_DECLINE + '">' + _SCI.handsetDown + '</button>'
      + '<button class="sc-btn cb-btn sc-ok" onclick="' + _SC_ANSWER + '">' + _SCI.handset + '</button>';
  }
  el.innerHTML = '<div class="sc-callbar ' + m.style + '">' + html + '</div>';
}
function _scTickInCall() {
  const el = document.getElementById('scCallTimer'); if (!el) return;
  const s = Math.floor((Date.now() - _callT0Scr) / 1000);
  el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
// Bande son du décroché : jouée sur l'écran (voix du correspondant)
let _callAudioEl = null;
// Lecture via le contexte WebAudio déjà déverrouillé au premier toucher de
// l'écran : un élément <audio> serait bloqué par iOS quand le décroché vient
// de la télécommande ou du décroché automatique (aucun geste en cours).
let _callAudioSrc = null;
async function _playCallAudio() {
  _stopCallAudio();
  const c = _mediaCache.get('__callaudio');
  if (!c || !c.data) return;
  const ctx = _ac();
  try {
    if (ctx) {
      if (!c._buf) {
        const b64 = c.data.slice(c.data.indexOf(',') + 1);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        c._buf = await ctx.decodeAudioData(bytes.buffer);
      }
      if (_callState !== 'incall') return; // raccroché pendant le décodage
      const src = ctx.createBufferSource();
      src.buffer = c._buf;
      src.connect(ctx.destination);
      src.start();
      _callAudioSrc = src;
      return;
    }
  } catch (_) { /* format non décodable : repli sur <audio> */ }
  try {
    const a = new Audio(c.data);
    a.play().catch(() => {});
    _callAudioEl = a;
  } catch (_) {}
}
function _stopCallAudio() {
  if (_callAudioSrc) { try { _callAudioSrc.stop(); } catch (_) {} _callAudioSrc = null; }
  if (_callAudioEl) { try { _callAudioEl.pause(); } catch (_) {} _callAudioEl = null; }
}
function screenCallAnswer() {
  if (_callState !== 'ringing') return;
  _callState = 'incall';
  _scStopRing();
  _callT0Scr = Date.now();
  // Décroché depuis un bandeau : bascule en plein écran d'appel en cours
  const el = document.getElementById('screen-call');
  if (el) el.classList.remove('notif');
  _scRenderInCall();
  _callClockTimer = setInterval(_scTickInCall, 1000);
  if (_callCfg && _callCfg.hasAudio) _playCallAudio();
  sendMsg({ type: 'call:state', state: 'incall' });
}
function screenCallDecline() {
  if (_callState !== 'ringing') return;
  screenCallHide();
  sendMsg({ type: 'call:state', state: 'declined' });
}
function screenCallEnd() {
  if (_callState === 'idle') return;
  screenCallHide();
  sendMsg({ type: 'call:state', state: 'ended' });
}
function screenCallHide() {
  screenCallStopTimers();
  _stopCallAudio();
  _callState = 'idle';
  const el = document.getElementById('screen-call');
  if (!el) return;
  // Sortie animée : bannières/bandeaux remontent vers le haut, écran verrouillé
  // en fondu ; sinon disparition immédiate.
  // (l'écran verrouillé contient lui-même une carte .sc-notif : on le teste en premier)
  const lock = el.querySelector('.sc-lock');
  const notif = lock ? null : el.querySelector('.sc-notif, .sc-callbar');
  // Jeton : un nouvel appel déclenché pendant l'animation ne doit pas être effacé
  const tok = ++_callHideSeq;
  const done = () => {
    if (tok !== _callHideSeq) return;
    el.style.display = 'none'; el.innerHTML = ''; el.classList.remove('notif');
  };
  if (lock) { lock.classList.add('sc-lockout'); setTimeout(done, 400); }
  else if (notif) { notif.classList.add('sc-out'); setTimeout(done, 340); }
  else done();
}
let _callHideSeq = 0;
function _scStopRing() {
  if (_callRingTimer) { clearInterval(_callRingTimer); _callRingTimer = null; }
  if (_callVibTimer) { clearInterval(_callVibTimer); _callVibTimer = null; }
  if (_callAutoTimer) { clearTimeout(_callAutoTimer); _callAutoTimer = null; }
  if (navigator.vibrate) navigator.vibrate(0);
}
function screenCallStopTimers() {
  _scStopRing();
  if (_callClockTimer) { clearInterval(_callClockTimer); _callClockTimer = null; }
}

