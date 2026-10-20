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
  if (el) el.style.display = on ? (disp || '') : 'none';
}
function setCallKind(k) {
  if (k === 'chat' || k === 'whatsapp') k = 'sms'; // ancienne messagerie
  if (!CALL_KINDS.includes(k)) k = 'call';
  callKind = k;
  CALL_KINDS.forEach(x => {
    const b = document.getElementById('callkind-' + x);
    if (b) { b.classList.toggle('active', x === k); b.setAttribute('aria-checked', x === k ? 'true' : 'false'); }
  });
  // Nom/couleur d'app : on applique le défaut du type tant que l'utilisateur
  // ne les a pas personnalisés
  const def = _CALL_APP_DEFAULTS[k];
  const an = document.getElementById('callAppName'), ac = document.getElementById('callAppColor');
  if (def && an && !an.dataset.touched) an.value = def.name;
  if (def && ac && !ac.dataset.touched) ac.value = def.color;
  const call = k === 'call', sms = k === 'sms', notif = k === 'notif', disc = k === 'discussion';
  // Carte « À jouer » (maquettes 4a à 4d) : un seul squelette, les rangées du type
  // choisi. Vue « Style et sonnerie » : style commun (appel, SMS, discussion) ou
  // style et fond propres à la notification
  _callShow('callWhoPanel', call || sms);
  _callShow('callMsgPanel', sms);
  _callShow('telAppBtn', sms);
  _callShow('callLockPanel', sms);
  _callShow('telCallRows', call);
  _callShow('telStyleRow', sms || disc);
  _callShow('ntStyleBtn', notif);
  _callShow('callStyleRow', !notif);
  _callShow('ntDetail-style', notif);
  _callShow('ntDetail-wall', notif);
  _callShow('callPresentRow', call);
  _callShow('callListPanel', !disc);
  const who = document.getElementById('callWhoLabel');
  if (who) who.textContent = call ? 'Appelant' : 'Contact';
  setIconText(document.getElementById('telPlayTitle'), 'À jouer');
  notifShowForm(notif);       // 84-notification.js
  chatShowForm(disc);         // 83-discussion.js
  _syncCallStyleChips();
  renderRingPanel(); // « Sonnerie », « Son de notification » ou « Son des messages » : choix propre au type
  _syncCallPhotoRow();
  renderTelStyle();           // 78-tel-style.js : rangées résumé, vue ouverte
  renderCallerState();        // 79-callers.js : « Changer », appelant enregistré ? (et rangées : renderTelRows)
  // Liste enregistrée : elle suit le type choisi (Appels, SMS, Notifications)
  if (CALL_LISTS.includes(k) && callListKind !== k) setCallListKind(k);
  renderCallList();           // 82-call-list.js : titre, lignes, barre d'action
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

// Présentation de l'appel entrant : plein écran, téléphone verrouillé (Verre : piste « faire
// glisser pour répondre ») ou bandeau haut. « Verrouillé » part sur le fil en present:'full'
// + lock (champ existant de call:start), et seul le style Verre le dessine.
function callLockedNow() { return callKind === 'call' && callPresent === 'lock' && callStyle === 'glass'; }
let callPresent = 'full', callPhotoMode = 'avatar';
function setCallPresent(v) {
  callPresent = v;
  ['full','lock','banner'].forEach(x => {
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
  renderTelRows(); // rangée « Au décroché »
}
function onCallAutoChange() {
  const v = parseInt(document.getElementById('callAutoSlider').value) || 0;
  document.getElementById('callAutoVal').textContent = v > 0 ? v + ' s' : 'Off';
  renderTelRows();
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
  const callLock = callLockedNow();
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
    present: callPresent === 'banner' ? 'banner' : 'full',
    photoMode: (callStyle !== 'minimal') ? callPhotoMode : 'avatar',
    hasAudio: !!_callAudioData,
    autoAnswer: parseInt(document.getElementById('callAutoSlider').value) || 0,
    lock: lockOn ? {
      time: (document.getElementById('lockTime').value || '').slice(0, 8),
      date: (document.getElementById('lockDate').value || '').slice(0, 30),
    } : callLock ? { time: '', date: '' } : null,
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
  if (!tabSendIds('tel')) return; // écrans tenus par une séquence : confirmation 27-tab-gate.js
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
  _setCallStatusUI(fields.kind === 'call' ? 'Sonnerie envoyée…' : notif ? 'Notification envoyée' : 'SMS envoyé');
  telCallSent(fields.kind, fields.kind === 'call' ? fields.autoAnswer : 0);
}
// Ligne d'état de la barre Tel (au-dessus des boutons, vide au repos) ; un envoi de
// SMS ou de notification s'efface seul après quelques secondes
let _callStatusTimer = null;
function _setCallStatusUI(t, keep) {
  if (_callStatusTimer) { clearTimeout(_callStatusTimer); _callStatusTimer = null; }
  const el = document.getElementById('callStatus');
  setIconText(el, t);
  if (t && !keep) _callStatusTimer = setTimeout(() => { _callStatusTimer = null; if (_telCall.phase === 'idle') _setCallStatusUI(''); }, 4000);
  renderTelBar();
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
  // Barre Tel : sonne (Raccrocher / Décrocher), en ligne (Raccrocher), puis retour au repos
  if (m.state === 'ringing') telCallPhase('ringing');
  else if (m.state === 'incall') telCallPhase('incall');
  else if (m.state === 'declined') telCallPhase('idle', 'Refusé sur l\'écran');
  else if (m.state === 'ended') telCallPhase('idle', 'Terminé');
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
      _scRenderLock(!!el.querySelector('.ph-lock:not(.ph-out)'));
      // Comme un vrai téléphone : l'écran se rendort tout seul après ~10 s
      _callAutoTimer = setTimeout(() => { if (_callState === 'notif') screenCallEnd(); }, 10000);
    } else {
      el.classList.add('notif');
      _scRenderNotifBar();
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
  return { name: m.appName || 'SMS', color: m.appColor || '#2f8cf0' };
}
// Notification (SMS ou application) → données de la carte partagée (PhoneUI.notification,
// 71-phone-ui.js), la même que celle de l'écran verrouillé de la Séquence
function _scNotifData(m) {
  if (m.kind === 'notif') return { id: 'n0', kind: 'app', app: m.appName, name: m.name, msg: m.msg, when: notifReceivedLabel(m.received, notifPhoneNow(m.phone)), img: m.photo };
  const app = _scApp(m);
  return { id: 'n0', kind: 'sms', app: app.name, name: m.name, msg: m.msg, when: 'maintenant', color: app.color };
}
// Calque du faux téléphone dans #screen-call, au style de l'appel
function _scHtml(cls, body, attrs) {
  return PhoneUI.root({ style: _callCfg.style, cls, body, attrs });
}

// — Faux écran verrouillé : fond choisi, date + horloge, notification,
// lampe et appareil photo, déclinés selon le style (PhoneUI.lock). —
function _scRenderLock(again) {
  const m = _callCfg, el = document.getElementById('screen-call');
  // Notification : son propre fond (__notifwall), date et heure du faux téléphone
  const notif = m.kind === 'notif';
  const wall = _mediaCache.get(notif ? '__notifwall' : '__lockwall');
  const wallUrl = wall && wall.kind === 'img' ? safeImageData(wall.data) : null;
  const now = notif ? notifPhoneNow(m.phone) : phoneClockNow();
  const clock = { time: m.lock.time || PhoneUI.hm(now), date: m.lock.date || PhoneUI.longDate(now) };
  el.innerHTML = _scHtml('ph-lock' + (again ? '' : ' ph-enter'), PhoneUI.lock({ style: m.style, clock, notifs: [_scNotifData(m)], max: 1, newIds: new Set(['n0']) }), ' data-act="end"');
  PhoneUI.paintWall(el.firstChild, wallUrl);
}

function _scRenderIncoming() {
  const el = document.getElementById('screen-call');
  el.innerHTML = _scHtml('ph-call', PhoneUI.incoming(_callCfg));
}

function _scRenderInCall() {
  const el = document.getElementById('screen-call');
  el.innerHTML = _scHtml('ph-call', PhoneUI.inCall(Object.assign({}, _callCfg, { timer: '00:00' })));
}

// Bandeau d'appel entrant en haut (téléphone en cours d'utilisation)
function _scRenderCallBar() {
  const el = document.getElementById('screen-call');
  el.innerHTML = _scHtml('ph-overlay', PhoneUI.callBanner(_callCfg));
}
// Bandeau de SMS ou de notification d'application
function _scRenderNotifBar() {
  const el = document.getElementById('screen-call');
  el.innerHTML = _scHtml('ph-overlay', PhoneUI.notifBanner(_scNotifData(_callCfg)));
}
// Gestes du comédien sur le faux appel / la notification (attributs data-act de PhoneUI),
// rapportés à une Séquence qui les attend (94-sequence-phone.js)
(function initCallTouch() {
  const el = document.getElementById('screen-call');
  if (!el) return;
  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    e.stopPropagation();
    switch (t.dataset.act) {
      case 'decline': screenTapDecline(); break;
      case 'answer': screenTapAnswer(); break;
      case 'hangup': screenTapHangup(); break;
      case 'notif': screenNotifTap(); break;
      case 'end': screenCallEnd(); break;
    }
  });
  initCallSlider(el);
})();
// Piste « faire glisser pour répondre » de l'appel Verre verrouillé (PhoneUI.incomingLocked) :
// glisser le rond vert jusqu'à CALL_SLIDE_OK de la course = geste « répondre » (rapporté à la
// Séquence par screenTapAnswer) ; relâché avant, il revient. Le rond reste un bouton :
// toucher, Entrée et Espace répondent aussi (repli accessible, via l'écouteur de clic).
const CALL_SLIDE_OK = 0.85;
function initCallSlider(el) {
  let d = null, justDragged = false;
  el.addEventListener('pointerdown', (e) => {
    const h = e.target.closest && e.target.closest('.pc-slide-h');
    if (!h) return;
    const tr = h.parentElement;
    d = { h, tr, x0: e.clientX, max: Math.max(1, tr.clientWidth - h.offsetWidth - 8), dx: 0, moved: false };
    try { h.setPointerCapture(e.pointerId); } catch (_) {}
    h.classList.add('drag');
  });
  el.addEventListener('pointermove', (e) => {
    if (!d) return;
    d.dx = Math.max(0, Math.min(d.max, e.clientX - d.x0));
    if (d.dx > 6) d.moved = true;
    d.h.style.transform = 'translateX(' + d.dx + 'px)';
    d.tr.style.setProperty('--p', (d.dx / d.max).toFixed(3));
  });
  const end = (e) => {
    if (!d) return;
    const { h, tr, max, dx, moved } = d; d = null;
    h.classList.remove('drag');
    if (moved) { justDragged = true; setTimeout(() => { justDragged = false; }, 60); }
    if (e.type !== 'pointercancel' && dx >= max * CALL_SLIDE_OK) {
      h.style.transform = 'translateX(' + max + 'px)'; tr.style.setProperty('--p', 1);
      screenTapAnswer();
    } else { h.style.transform = ''; tr.style.setProperty('--p', 0); }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // Le clic qui suit un glissement (réussi ou raté) ne vaut pas « toucher »
  el.addEventListener('click', (e) => {
    if (justDragged && e.target.closest && e.target.closest('.pc-slide-h')) { e.stopImmediatePropagation(); e.stopPropagation(); }
  }, true);
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
  const lock = el.querySelector('.ph-lock');
  const notif = lock ? null : el.querySelector('.pb-wrap');
  // Jeton : un nouvel appel déclenché pendant l'animation ne doit pas être effacé
  const tok = ++_callHideSeq;
  const done = () => {
    if (tok !== _callHideSeq) return;
    el.style.display = 'none'; el.innerHTML = ''; el.classList.remove('notif');
  };
  if (lock) { lock.classList.add('ph-out'); setTimeout(done, 400); }
  else if (notif) { notif.classList.add('pb-out'); setTimeout(done, 340); }
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

