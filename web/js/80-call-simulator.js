// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ SIMULATEUR D'APPEL ══════════════════════════
// Télécommande (onglet Tel) : configure et déclenche. Écran : affiche l'overlay
// (appel, SMS, notification d'application — 84-notification.js ; styles
// Verre / Tonal / Épuré), sonne (WebAudio : sons intégrés synthétisés, ou son
// importé mis en cache — 81-ringtones.js), vibre si le vibreur du type est
// activé (vib, maquette 36b : Android, ou la coque native) et renvoie son état
// (ringing/incall/declined/ended). La discussion (fil de messages) est à part :
// 83-discussion.js. L'ancienne « messagerie » (kind chat) est devenue SMS.
// Style, présentation, photo, son et vibreur se règlent dans la vue « Style et
// sonnerie » (78-tel-style.js) ; appelants enregistrés : 79-callers.js.

// — Télécommande —
// callKind : 'call' | 'sms' | 'notif' | 'discussion'
let callKind = 'call', callStyle = 'glass', _callPhoto = null;
let _callUiTimer = null, _callUiT0 = 0;
const CALL_KINDS = ['call', 'sms', 'notif', 'discussion'];

// Application fictive par défaut d'un SMS (modifiable)
const _CALL_APP_DEFAULTS = { sms: { name: 'SMS', color: '#2f8cf0' } };
const _CALL_STYLE_HINTS = {
  glass: 'Translucide et flouté, boutons ronds.',
  tonal: 'Surfaces tonales, gros avatar, boutons pilule.',
  minimal: 'Sobre et contrasté, sans effet.',
};

function _callShow(id, on, disp) {
  const el = document.getElementById(id);
  if (el) el.style.display = on ? (disp || 'block') : 'none';
}
function setCallKind(k) {
  if (k === 'chat' || k === 'whatsapp') k = 'sms'; // ancienne messagerie
  if (!CALL_KINDS.includes(k)) k = 'call';
  callKind = k;
  CALL_KINDS.forEach(x => {
    const b = document.getElementById('callkind-' + x);
    if (b) b.classList.toggle('active', x === k);
  });
  // Nom/couleur d'app : on applique le défaut du type tant que l'utilisateur
  // ne les a pas personnalisés
  const def = _CALL_APP_DEFAULTS[k];
  const an = document.getElementById('callAppName'), ac = document.getElementById('callAppColor');
  if (def && an && !an.dataset.touched) an.value = def.name;
  if (def && ac && !ac.dataset.touched) ac.value = def.color;
  const call = k === 'call', sms = k === 'sms', notif = k === 'notif', disc = k === 'discussion';
  // Vue « Style et sonnerie » : style commun (appel, SMS, discussion) ou
  // style et fond propres à la notification
  _callShow('telStyleRow', !notif); // notification : sa rangée est sous « Envoyer la notification »
  _callShow('callStyleRow', !notif);
  _callShow('ntDetail-style', notif);
  _callShow('ntDetail-wall', notif);
  _callShow('callPresentRow', call);
  _callShow('callWhoPanel', call || sms);
  _callShow('callMsgPanel', sms);
  _callShow('callLockPanel', sms);
  _callShow('callTriggerPanel', !disc);
  _callShow('callTriggerBtn', !notif, 'flex');
  _callShow('callAnswerBtn', call, 'flex'); // « Décrocher » : appel seulement (pas de sens pour un SMS)
  _callShow('callListPanel', !disc, 'flex');
  const who = document.getElementById('callWhoLabel');
  if (who) who.textContent = call ? 'Appelant' : 'Contact';
  notifShowForm(notif);       // 84-notification.js
  chatShowForm(disc);         // 83-discussion.js
  _syncCallStyleChips();
  renderRingPanel(); // « Sonnerie », « Son de notification » ou « Son des messages » : choix propre au type
  _syncCallPhotoRow();
  renderTelStyle();           // 78-tel-style.js : rangée résumé, vue ouverte
  renderCallerState();        // 79-callers.js : « Enregistrés (n) », appelant enregistré ?
  const btn = document.getElementById('callTriggerBtn');
  if (btn) btn.innerHTML = call
    ? '<span class="media-icon">' + icon('phone') + '</span> Faire sonner'
    : '<span class="media-icon">' + icon('message-circle') + '</span> Envoyer la notification';
  // Liste enregistrée : l'onglet suit le type choisi (Appels, SMS, Notifs)
  if (CALL_LISTS.includes(k) && callListKind !== k) setCallListKind(k);
  renderCallListSaveLabel(); // « + Enregistrer l'appel / le SMS / la notification actuel(le) »
}
// Style : commun à l'appel et au SMS ; la discussion a le sien (83-discussion.js),
// la notification aussi (84-notification.js)
function setCallStyle(s) {
  if (!_CALL_STYLE_HINTS[s]) s = 'glass';
  if (callKind === 'discussion') chatSetStyle(s);
  else callStyle = s;
  _syncCallStyleChips();
  _syncCallPhotoRow();
  renderTelStyle();
}
function _syncCallStyleChips() {
  const s = callKind === 'discussion' ? chatStyleNow() : callStyle;
  ['glass','tonal','minimal'].forEach(x => {
    const b = document.getElementById('callstyle-' + x);
    if (b) b.classList.toggle('active', x === s);
  });
  const h = document.getElementById('callStyleHint');
  if (h) h.textContent = callKind === 'discussion' ? (_CHAT_STYLE_HINTS[s] || '') : (_CALL_STYLE_HINTS[s] || '');
}

// Présentation de l'appel entrant : plein écran ou bandeau haut
let callPresent = 'full', callPhotoMode = 'avatar';
function setCallPresent(v) {
  callPresent = v;
  ['full','banner'].forEach(x => {
    const b = document.getElementById('callpres-' + x);
    if (b) b.classList.toggle('active', x === v);
  });
  renderTelStyle();
}
function setCallPhotoMode(v) {
  callPhotoMode = v;
  ['avatar','full'].forEach(x => {
    const b = document.getElementById('callphoto-' + x);
    if (b) b.classList.toggle('active', x === v);
  });
  renderTelStyle();
}
function _syncCallPhotoRow() {
  const r = document.getElementById('callPhotoModeRow');
  // Photo plein écran disponible pour Verre et Tonal (Épuré reste sobre)
  if (r) r.style.display = (callKind === 'call' && callStyle !== 'minimal') ? 'block' : 'none';
}

// Bande son jouée par l'écran quand le comédien décroche (voix du correspondant).
// Envoyée en fragments fiables et mise en cache sur l'écran sous '__callaudio'.
// Bloc « Bande son au décroché » (maquette 12) : nom, durée, « sur l'écran ✓ »
// dès que l'écran a accusé réception (media:cached).
let _callAudioData = null, _callAudioName = '', _callAudioDur = 0, _callAudioSeq = 0;
const CALL_AUDIO_MAX_BYTES = 8 * 1024 * 1024;
const _CALL_AUDIO_NONE = 'Aucune bande son — le décroché reste silencieux.';
async function onCallAudio(files) {
  if (!files || !files[0]) return;
  const f = files[0];
  if (f.size > CALL_AUDIO_MAX_BYTES) {
    renderCallAudioRow('⚠ Fichier trop lourd (max ~8 Mo) — coupez un extrait plus court.');
    return;
  }
  const mime = ringFileMime(f);
  if (!mime) { renderCallAudioRow('⚠ « ' + (f.name || 'fichier') + ' » n\'est pas un fichier son.'); return; }
  let data;
  try { data = await ringFileDataUrl(f, mime); } catch (_) { data = null; }
  if (!safeAudioData(data)) { renderCallAudioRow('⚠ Lecture du fichier impossible'); return; }
  const seq = ++_callAudioSeq;
  _callAudioData = data;
  _callAudioName = String(f.name || 'bande son').slice(0, 80);
  _callAudioDur = 0;
  renderCallAudioRow();
  _measureCallAudio(seq);
  await ensureCallAssets(null, _callAudioData);
}
// Durée affichée (WebAudio) ; un fichier que ce téléphone ne sait pas décoder
// part quand même : l'écran le lit avec son propre décodeur.
async function _measureCallAudio(seq) {
  const data = _callAudioData;
  if (!data) return;
  try {
    const buf = await ringDecode(_dataUrlBytes(data).buffer);
    if (seq === _callAudioSeq && data === _callAudioData) { _callAudioDur = buf.duration; renderCallAudioRow(); }
  } catch (_) {}
}
function clearCallAudio() {
  _callAudioSeq++;
  _callAudioData = null; _callAudioName = ''; _callAudioDur = 0;
  _screenCached.delete('__callaudio');
  renderCallAudioRow();
  sendMsg({ type: 'media:evict', id: '__callaudio' }); // tous les écrans (oublié de leur état : 28-screens.js)
}
// Fichier choisi → ligne « nom · durée · sur l'écran ✓ » ; sinon bouton de choix
function renderCallAudioRow(message) {
  const has = !!_callAudioData;
  const row = document.getElementById('callAudioRow');
  if (row) row.style.display = has ? 'flex' : 'none';
  const pick = document.getElementById('callAudioPick');
  if (pick) pick.style.display = has ? 'none' : 'block';
  const name = document.getElementById('callAudioName');
  if (name) name.textContent = _callAudioName || 'Bande son';
  const dur = document.getElementById('callAudioDur');
  if (dur) dur.textContent = _callAudioDur > 0 ? ' · ' + ringFmtDur(_callAudioDur) : '';
  const state = document.getElementById('callAudioState');
  if (state) {
    const on = has && _screenCached.has('__callaudio');
    state.textContent = on ? 'sur l\'écran ✓' : 'en attente de l\'écran';
    state.classList.toggle('on', on);
  }
  const st = document.getElementById('callAudioStatus');
  if (st) {
    const t = message || (has ? '' : _CALL_AUDIO_NONE);
    setIconText(st, t);
    st.style.display = t ? 'block' : 'none';
    st.classList.toggle('rt-warn', !!message);
  }
}
function onCallAutoChange() {
  const v = parseInt(document.getElementById('callAutoSlider').value) || 0;
  document.getElementById('callAutoVal').textContent = v > 0 ? v + ' s' : 'Off';
}
// Photo de l'appelant : envoyée DÈS le choix, en fragments chiffrés mis en
// cache sur l'écran sous '__callphoto' (comme le fond d'écran verrouillé) ;
// call:start annonce seulement hasPhoto.
let _callPhotoSending = null;
function onCallPhoto(files) {
  if (!files || !files[0]) return;
  const img = new Image();
  img.onload = () => {
    // On conserve le ratio (cap 640 px sur le grand côté) : bon rendu à la
    // fois en avatar rond (cover) et en photo plein écran.
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
    _callPhotoSending = ensureCallAssets(_callPhoto, null);
    renderCallerState();
    renderTelStyle();
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
    if (st) setIconText(st, "📤 Envoi du fond d'écran…");
    await ensureLockWall();
    if (st) setIconText(st, "✓ Fond d'écran prêt sur l'écran");
  };
  img.onerror = () => URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(files[0]);
}
// Fond d'écran verrouillé vers les écrans donnés (défaut : la cible) qui ne
// l'ont pas encore (un seul exemplaire en cache, __lockwall)
function ensureLockWall(screens) { return ensureSlotImage('__lockwall', _lockWallData, screens); }
// Image à emplacement unique en cache sur l'écran (fond verrouillé des SMS
// __lockwall, des notifications __notifwall, avatar de la discussion
// __chatavatar) vers les écrans donnés (défaut : la cible) qui ne l'ont pas
function ensureSlotImage(key, data, screens) {
  if (!data) return Promise.resolve();
  const ids = screens || scrTargetIds();
  if (!ids.length) return sendImageChunks(data, { mediaId: key, show: false }); // aucun écran connu : comme avant
  const lack = ids.filter((s) => scrState(s).sent.get(key) !== data);
  for (const s of lack) scrState(s).sent.set(key, data);
  return sendImageChunks(data, { mediaId: key, show: false, screens: lack });
}
// Réglages de l'appel du formulaire (champs de call:start, sans photo ni son :
// hasPhoto / hasAudio disent s'ils accompagnent l'appel ; ringId désigne un son
// importé préchargé). Aussi la forme d'une entrée de la liste enregistrée
// (82-call-list.js).
function callFormFields() {
  if (callKind === 'notif') return notifFormFields(); // 84-notification.js
  const lockOn = callKind === 'sms' && document.getElementById('lockToggle').checked;
  return Object.assign({
    kind: callKind,
    style: callStyle,
    name: (document.getElementById('callName').value || 'Inconnu').slice(0, 40),
    label: (document.getElementById('callLabel').value || '').slice(0, 40),
    msg: (document.getElementById('callMsgText').value || '').slice(0, 200),
    appName: (document.getElementById('callAppName').value || '').slice(0, 24),
    appColor: document.getElementById('callAppColor').value,
    hasPhoto: !!_callPhoto,
  }, ringFormFields(callKind), {
    present: callPresent,
    photoMode: (callStyle !== 'minimal') ? callPhotoMode : 'avatar',
    hasAudio: !!_callAudioData,
    autoAnswer: parseInt(document.getElementById('callAutoSlider').value) || 0,
    lock: lockOn ? {
      time: (document.getElementById('lockTime').value || '').slice(0, 8),
      date: (document.getElementById('lockDate').value || '').slice(0, 30),
    } : null,
  });
}

// Photo et bande son d'un appel : un seul exemplaire en cache sur chaque écran
// (__callphoto, __callaudio). Avant chaque appel, on (re)envoie ceux de cet
// appel aux écrans visés dont l'exemplaire diffère (appel du formulaire,
// entrée de la liste, déclenchement par la console) : chaque écran a le sien
// (scrState(id).sent, 28-screens.js). Sons importés (rings : ids __ring_…) :
// chacun garde sa place en cache, envoyé une fois puis seulement s'il manque
// (81-ringtones.js). Envois et appels restent dans l'ordre.
// screens : écrans destinataires (défaut : la cible au moment de l'appel).
// photoKey : emplacement de la photo (__callphoto ; icône d'une notification : __notificon).
let _callAssetChain = Promise.resolve();
function ensureCallAssets(photo, audio, rings, screens, photoKey) {
  const pk = photoKey || '__callphoto';
  const ids = screens || scrTargetIds();
  _callAssetChain = _callAssetChain.then(async () => {
    const lacking = (key, data) => {
      const l = ids.filter((s) => scrKnown(s) && scrState(s).sent.get(key) !== data);
      for (const s of l) scrState(s).sent.set(key, data);
      return l;
    };
    if (photo) {
      const l = lacking(pk, photo);
      if (l.length) await sendImageChunks(photo, { mediaId: pk, show: false, screens: l });
    }
    if (audio) {
      const l = lacking('__callaudio', audio);
      if (l.length) {
        for (const s of l) scrState(s).cached.delete('__callaudio'); // « sur l'écran ✓ » au prochain accusé
        _screenCached.delete('__callaudio');
        scrRefreshCachedView();
        renderCallAudioRow();
        await sendImageChunks(audio, { mediaId: '__callaudio', show: false, screens: l });
      }
    }
    for (const id of rings || []) await ringSendIfMissing(id, ids);
  }).catch(() => {});
  return _callAssetChain;
}

async function triggerCall() {
  const fields = callFormFields();
  const notif = fields.kind === 'notif';
  const photo = notif ? _notifIcon : _callPhoto, pk = notif ? '__notificon' : '__callphoto';
  if (linkBleOnly()) {
    // Bluetooth seul (commandes uniquement) : photo et bande son ne partent pas ;
    // annoncées seulement si chaque écran visé a déjà celles du formulaire
    const ids = scrTargetIds();
    const on = (key, data) => !!data && ids.length > 0 && ids.every((s) => scrState(s).cached.has(key) && scrState(s).sent.get(key) === data);
    fields.hasPhoto = on(pk, photo);
    fields.hasAudio = on('__callaudio', _callAudioData);
  } else {
    // La photo (icône), la bande son et le son importé (fragments) partent avant l'appel qui les utilise
    await ensureCallAssets(photo, notif ? null : _callAudioData, fields.ringId ? [fields.ringId] : null, undefined, pk);
    if (notif && fields.present === 'lock') await ensureSlotImage('__notifwall', _notifWallData);
  }
  sendMsg(Object.assign({ type: 'call:start' }, fields));
  _setCallStatusUI(fields.kind === 'call' ? '📞 Sonnerie envoyée…' : notif ? '🔔 Notification envoyée' : '💬 SMS envoyé');
}
function _setCallStatusUI(t) {
  const el = document.getElementById('callStatus');
  setIconText(el, t);
}
function remoteOnCallState(m) {
  // État de l'appel de cet écran (liste « Écrans connectés »)
  const sid = _rxFrom && scrKnown(_rxFrom) ? _rxFrom : null;
  if (sid) {
    const st = scrState(sid);
    if (m.state === 'declined' || m.state === 'ended') st.call = null;
    else if (st.call) st.call.state = m.state;
    scrChanged();
    if (!scrInTarget(sid)) return; // l'interface suit les écrans de la cible
  }
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

// — Écran : sons (WebAudio) —
// Sons intégrés synthétisés (aucun fichier), ou son importé reçu en fragments
// et gardé en cache (__ring_…) : en boucle pour un appel qui sonne, une fois
// pour une notification. Volume = ringVolume (1 = niveau des sons intégrés
// d'origine). Son importé absent du cache ou illisible : son intégré « ring »,
// et l'écran le redemande à la télécommande (media:need).
let _audioCtx = null, _callRingTimer = null, _callVibTimer = null, _callVibOn = false;
let _callClockTimer = null, _callAutoTimer = null, _callT0Scr = 0;
let _callState = 'idle', _callCfg = null;

function _ac() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
    return _audioCtx;
  } catch (_) { return null; }
}
// data-URL base64 → octets
function _dataUrlBytes(data) {
  const bin = atob(String(data).slice(String(data).indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
// decodeAudioData en promesse (les anciens Safari n'ont que les rappels)
function _decodeAudio(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) { reject(e); }
  });
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
function _ringBurst(kind, vol) {
  const v = typeof vol === 'number' ? vol : 1;
  if (kind === 'digital') { for (let i = 0; i < 4; i++) _tone(950, i * 0.18, 0.12, 0.14 * v, 'square'); }
  else if (kind === 'soft') { [523, 659, 784, 1047].forEach((f, i) => _tone(f, i * 0.16, 0.3, 0.14 * v, 'sine')); }
  else { _tone(440, 0, 1.2, 0.12 * v, 'sine'); _tone(480, 0, 1.2, 0.12 * v, 'sine'); } // classique
}
function _startBuiltinRing(kind, vol) {
  if (kind === 'silent') return;
  _ringBurst(kind, vol);
  const IV = { digital: 1600, soft: 2300 };
  _callRingTimer = setInterval(() => _ringBurst(kind, vol), IV[kind] || 3000);
}
// Appel qui sonne : son importé en boucle, sinon son intégré répété
function _startRinging(cfg) {
  const vol = cfg.ringVolume;
  if (cfg.ringId) {
    const ok = _ringPlayImported(cfg.ringId, true, vol, () => {
      if (_callState === 'ringing' && !_callRingTimer) _startBuiltinRing(cfg.ring, vol);
    });
    if (ok) return;
    sendMsg({ type: 'media:need', id: cfg.ringId });
  }
  _startBuiltinRing(cfg.ring, vol);
}
// Notification (SMS / notification d'application, bannière ou écran verrouillé) : une fois
function _playNotifSound(cfg) {
  const vol = cfg.ringVolume;
  if (cfg.ringId) {
    if (_ringPlayImported(cfg.ringId, false, vol, () => _notifBuiltin(cfg.kind, cfg.ring, vol))) return;
    sendMsg({ type: 'media:need', id: cfg.ringId });
  }
  _notifBuiltin(cfg.kind, cfg.ring, vol);
}
// Sons de notification intégrés : « Classique » = son d'origine du type
function _notifBuiltin(kind, ring, vol) {
  const v = typeof vol === 'number' ? vol : 1;
  if (ring === 'silent') return;
  if (ring === 'digital') { _tone(1250, 0, 0.07, 0.13 * v, 'square'); _tone(1250, 0.13, 0.07, 0.13 * v, 'square'); }
  else if (ring === 'soft') { [659, 988].forEach((f, i) => _tone(f, i * 0.2, 0.4, 0.13 * v, 'sine')); }
  else if (kind === 'notif') { _tone(880, 0, 0.09, 0.16 * v, 'sine'); _tone(1174, 0.12, 0.12, 0.16 * v, 'sine'); } // son de l'ancienne messagerie
  else { [1318, 1046, 784].forEach((f, i) => _tone(f, i * 0.13, 0.18, 0.15 * v, 'sine')); }
}

// Sons importés en cache : AudioBuffer décodé à la réception (screenRingWarm)
// et gardé pour les derniers utilisés (un son long décodé pèse lourd).
const _RING_DECODED_MAX = 4;
const _ringDecoded = [];         // ids dont l'AudioBuffer est gardé (le plus récent en dernier)
let _ringPlayer = null;          // son importé en cours : { id, src, gain, loop }
let _ringPlaySeq = 0;            // jeton : un arrêt annule une lecture encore en décodage
function _ringBuffer(id) {
  const c = _mediaCache.get(id);
  if (!c || c.kind !== 'audio' || !c.data) return Promise.reject(new Error('absent'));
  if (c._buf) { _ringKeep(id); return Promise.resolve(c._buf); }
  if (!c._decoding) {
    const ctx = _ac();
    if (!ctx) return Promise.reject(new Error('webaudio'));
    c._decoding = _decodeAudio(ctx, _dataUrlBytes(c.data).buffer).then((buf) => {
      c._decoding = null;
      if (_mediaCache.get(id) === c) { c._buf = buf; _ringKeep(id); }
      return buf;
    }, (e) => { c._decoding = null; throw e; });
  }
  return c._decoding;
}
function _ringKeep(id) {
  const i = _ringDecoded.indexOf(id);
  if (i >= 0) _ringDecoded.splice(i, 1);
  _ringDecoded.push(id);
  while (_ringDecoded.length > _RING_DECODED_MAX) {
    const old = _ringDecoded.shift(), c = _mediaCache.get(old);
    if (c && !(_ringPlayer && _ringPlayer.id === old)) delete c._buf;
  }
}
function screenRingWarm(id) { _ringBuffer(id).catch(() => {}); }
function screenRingForget(id) {
  const i = _ringDecoded.indexOf(id);
  if (i >= 0) _ringDecoded.splice(i, 1);
  if (_ringPlayer && _ringPlayer.id === id) _ringStopImported();
}
// Joue un son importé (boucle ou une fois) ; false s'il n'est pas en cache.
// onFail : son illisible sur cet appareil → l'appelant joue le son intégré.
function _ringPlayImported(id, loop, vol, onFail) {
  const c = _mediaCache.get(id);
  if (!c || c.kind !== 'audio') return false;
  _ringStopImported();
  const seq = _ringPlaySeq;
  _ringBuffer(id).then((buf) => {
    if (seq !== _ringPlaySeq) return; // arrêté (décroché, refus, fin) pendant le décodage
    const ctx = _ac();
    if (!ctx) throw new Error('webaudio');
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.loop = !!loop;
    g.gain.value = typeof vol === 'number' ? vol : 1;
    src.connect(g); g.connect(ctx.destination);
    src.onended = () => { if (_ringPlayer && _ringPlayer.src === src) _ringPlayer = null; };
    _ringPlayer = { id, src, gain: g, loop: !!loop };
    src.start();
  }).catch(() => { if (seq === _ringPlaySeq) { _ringPlayer = null; onFail(); } });
  return true;
}
function _ringStopImported() {
  _ringPlaySeq++;
  const p = _ringPlayer;
  _ringPlayer = null;
  if (!p) return;
  try { p.src.stop(); } catch (_) {}
  try { p.src.disconnect(); p.gain.disconnect(); } catch (_) {}
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

// Photo de l'appel : celle préparée pour cet appel enregistré (photoId), sinon
// __callphoto. Photo préparée absente : aucune (jamais celle d'un autre appel).
function _cachedCallPhoto(photoId, slot) {
  const c = _mediaCache.get(photoId || slot || '__callphoto');
  return c && c.kind === 'img' ? safeImageData(c.data) : null;
}
function screenCallStart(m) {
  screenCallStopTimers();
  _stopCallAudio();
  _callHideSeq++; // annule une éventuelle fermeture animée encore en attente
  // Tout ce qui vient du réseau est normalisé/validé avant d'être affiché
  m = m || {};
  // Ancienne messagerie (chat, whatsapp) : affichée comme un SMS
  const kind = m.kind === 'call' || m.kind === 'notif' ? m.kind : 'sms';
  _callCfg = {
    kind,
    style: _scStyle(m.style),
    name: String(m.name || '').slice(0, 40),
    label: String(m.label || '').slice(0, 40),
    msg: String(m.msg || '').slice(0, 200),
    appName: String(m.appName || '').slice(0, 24),
    appColor: safeHexColor(m.appColor, null),
    // Photo préchargée en fragments (__callphoto), validée à la réception
    // Notification : icône de l'application (__notificon)
    photo: m.hasPhoto ? _cachedCallPhoto(m.photoId, kind === 'notif' ? '__notificon' : null) : null,
    photoMode: m.photoMode === 'full' ? 'full' : 'avatar',
    present: m.present === 'banner' ? 'banner' : 'full',
    ring: m.ring,
    // Son importé (cache __ring_…) et volume du son (1 = niveau d'origine)
    ringId: (typeof m.ringId === 'string' && SRP.RING_ID_RE.test(m.ringId)) ? m.ringId : null,
    ringVolume: (typeof m.ringVolume === 'number' && Number.isFinite(m.ringVolume)) ? Math.min(1, Math.max(0, m.ringVolume)) : 1,
    hasAudio: !!m.hasAudio,
    // Bande son préparée de l'appel enregistré (__au_…) ; absente : __callaudio
    audioId: typeof m.audioId === 'string' && SRP.CALL_AUDIO_ID_RE.test(m.audioId) ? m.audioId : null,
    autoAnswer: Math.max(0, Math.min(60, Number(m.autoAnswer) || 0)),
    lock: m.lock ? { time: String(m.lock.time || '').slice(0, 8), date: String(m.lock.date || '').slice(0, 30) } : null,
    vib: m.vib === true, // vibreur du type (maquette 36b) ; absent : ne vibre pas
  };
  if (kind === 'notif') Object.assign(_callCfg, notifScreenCfg(m)); // 84-notification.js : lock, phone, received
  const el = document.getElementById('screen-call'); if (!el) return;
  el.style.display = 'block';
  if (_callCfg.kind === 'call') {
    _callState = 'ringing';
    // Présentation « bandeau haut » (téléphone en cours d'utilisation) ou plein écran
    if (_callCfg.present === 'banner') { el.classList.add('notif'); _scRenderCallBar(); }
    else { el.classList.remove('notif'); _scRenderIncoming(); }
    _startRinging(_callCfg);
    // Vibreur : motif répété tant que ça sonne (arrêté au décroché, au refus, à la fin)
    if (_callCfg.vib) {
      _callVibOn = true;
      screenVibrate(SCREEN_VIB_RING);
      _callVibTimer = setInterval(() => screenVibrate(SCREEN_VIB_RING), SCREEN_VIB_RING_EVERY);
    }
    if (_callCfg.autoAnswer > 0) _callAutoTimer = setTimeout(screenCallAnswer, _callCfg.autoAnswer * 1000);
    sendMsg({ type: 'call:state', state: 'ringing' });
  } else {
    _callState = 'notif';
    if (_callCfg.lock) {
      // Notification sur faux écran verrouillé (plein écran)
      el.classList.remove('notif');
      // Écran verrouillé déjà affiché : pas de nouveau fondu (flash de la couleur de fond), seule la notification glisse
      const again = !!el.querySelector('.sc-lock:not(.sc-lockout)');
      _scRenderLock();
      if (again) el.querySelector('.sc-lock').classList.add('sc-still');
      // Comme un vrai téléphone : l'écran se rendort tout seul après ~10 s
      _callAutoTimer = setTimeout(() => { if (_callState === 'notif') screenCallEnd(); }, 10000);
    } else {
      el.classList.add('notif');
      el.innerHTML = _scNotifCard(_callCfg, '');
    }
    _playNotifSound(_callCfg);
    if (_callCfg.vib) screenVibrate(SCREEN_VIB_SHORT);
  }
}

// Vibreur de l'écran de jeu (maquette 36b) : navigator.vibrate (Android) ou,
// dans l'app SetRemote, la coque native (pont « vibrate » / « vibrate:stop »,
// 00-native-bridge.js) ; iPhone dans Safari ne sait pas vibrer : sans effet.
// Ne lève jamais d'erreur.
const SCREEN_VIB_RING = [700, 300, 700], SCREEN_VIB_RING_EVERY = 2200; // appel qui sonne (répété)
const SCREEN_VIB_SHORT = [200, 120, 200];                             // SMS, notification, message de discussion
function screenVibrate(pattern) {
  try {
    if (IN_NATIVE_APP) nativePost({ type: 'vibrate', pattern });
    else if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (_) {}
}
function screenVibrateStop() {
  try {
    if (IN_NATIVE_APP) nativePost({ type: 'vibrate:stop' });
    else if (navigator.vibrate) navigator.vibrate(0);
  } catch (_) {}
}

// Application fictive affichée sur les notifications (nom + couleur réglables)
function _scApp(m) {
  return { name: m.appName || 'SMS', color: m.appColor || '#2f8cf0', icon: _SCI.bubble };
}
// Carte de notification (bannière ou écran verrouillé), selon le style
function _scNotifCard(m, extraCls) {
  if (m.kind === 'notif') return notifCardHtml(m, extraCls); // 84-notification.js
  const app = _scApp(m);
  const cls = 'sc-notif ' + m.style + (extraCls ? ' ' + extraCls : '');
  const click = extraCls ? '' : ' onclick="event.stopPropagation();screenNotifTap()"';
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
  // Notification : son propre fond (__notifwall), date longue du faux téléphone
  const notif = m.kind === 'notif';
  const wall = _mediaCache.get(notif ? '__notifwall' : '__lockwall');
  const wallUrl = wall && wall.kind === 'img' ? safeImageData(wall.data) : null;
  const now = notif ? notifPhoneNow(m.phone) : new Date();
  const time = m.lock.time || (String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
  const date = m.lock.date || (notif ? notifLongDate(now) : _scLockDate(now));
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

// Boutons d'action (même handler pour les 3 styles) : gestes du comédien,
// rapportés à une Séquence qui les attend (94-sequence-phone.js)
const _SC_DECLINE = 'event.stopPropagation();screenTapDecline()';
const _SC_ANSWER = 'event.stopPropagation();screenTapAnswer()';
const _SC_HANGUP = 'event.stopPropagation();screenTapHangup()';

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
  const c = _mediaCache.get((_callCfg && _callCfg.audioId) || '__callaudio');
  if (!c || !c.data) return;
  const ctx = _ac();
  try {
    if (ctx) {
      if (!c._buf) c._buf = await _decodeAudio(ctx, _dataUrlBytes(c.data).buffer);
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
// Arrêt de la sonnerie (décroché, refus, fin, fermeture, nouvel appel) ; coupe
// aussi un son de notification importé encore en cours
function _scStopRing() {
  _ringStopImported();
  if (_callRingTimer) { clearInterval(_callRingTimer); _callRingTimer = null; }
  if (_callVibTimer) { clearInterval(_callVibTimer); _callVibTimer = null; }
  if (_callAutoTimer) { clearTimeout(_callAutoTimer); _callAutoTimer = null; }
  if (_callVibOn) { _callVibOn = false; screenVibrateStop(); }
}
function screenCallStopTimers() {
  _scStopRing();
  if (_callClockTimer) { clearInterval(_callClockTimer); _callClockTimer = null; }
}

