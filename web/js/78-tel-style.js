// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ STYLE ET SONNERIE (onglet Tel, télécommande) ══════════════════════════
// Maquettes validées 36 (appel), 36b (vue), 36c (SMS), 36d (discussion) et
// 36f (notification). Les réglages d'apparence et de son ne s'affichent plus
// dans l'onglet : une rangée résumé (comme la barre d'état de l'onglet Média),
// « Verre · Plein écran · Avatar / Sonnerie Classique · 100 % · Vibreur oui
// · Régler › », ouvre une vue plein écran (présentation de « Téléphone au
// départ », #phone-params-view) :
//   • aperçu simplifié de l'écran de jeu (style, appelant, « 〰 vibreur ») ;
//   • Style : style (Verre / Tonal / Épuré), et pour un appel présentation et
//     photo de l'appelant ; notification : son style et son fond d'écran
//     verrouillé (84-notification.js) ;
//   • Son : sonnerie, son de notification ou son des messages (81-ringtones.js) ;
//   • Vibreur : propre à chaque type (ringSettings[type].vib), envoyé à
//     l'écran (vib) qui vibre s'il le peut (80-call-simulator.js).
// Titre : « Style et sonnerie » (appel), « Style et son » (SMS, notification,
// discussion). Les réglages s'appliquent aussitôt (pas de bouton « Enregistrer »).
// Les éléments du style et du son vivent dans la vue (#tel-style-view) : leurs
// fonctions (setCallStyle, setCallRing…) restent celles d'avant.
// Textes affichés, regroupés pour la traduction ({…} : valeurs)
const _TS_TXT = {
  titleCall: 'Style et sonnerie', titleOther: 'Style et son', back: '← Tel',
  capCall: 'Aperçu de l\'appel sur l\'écran de jeu', capSms: 'Aperçu du SMS sur l\'écran de jeu',
  capNotif: 'Aperçu de la notification sur l\'écran de jeu', capChat: 'Aperçu de la discussion sur l\'écran de jeu',
  vibNote: 'Vibre avec la sonnerie, même en Silencieux. Écran de jeu Android ou app SetRemote : iPhone dans Safari ne sait pas vibrer.',
  vibBadge: '〰 vibreur',
  presFull: 'Plein écran', presBanner: 'Bandeau haut', photoAvatar: 'Avatar', photoFull: 'Photo plein écran',
  ring: 'Sonnerie {son}', sound: 'Son {son}', chatSound: 'Son des messages {son}', vol: '{n} %',
  vibYes: 'Vibreur oui', vibNo: 'Vibreur non', wall: 'Fond {fond}', wallPhoto: 'Photo', wallGradient: 'Dégradé',
  sep: ' · ', unknown: 'Inconnu', label: 'mobile', smsMsg: 'Tu es où ??', chatIn: 'Tu es où ?', chatOut: 'j\'arrive',
};
const _TS_SOUNDS = { classic: 'Classique', digital: 'Digitale', soft: 'Douce', silent: 'Silencieux' };
const _tsTpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));

// Nom du son choisi : son intégré, ou nom du son importé
function telSoundName(sound) { return _TS_SOUNDS[sound] || ringName(sound) || _TS_SOUNDS.classic; }
// Style affiché du type (la discussion a le sien, la notification aussi)
function _tsStyle(k) { return k === 'discussion' ? chatStyleNow() : k === 'notif' ? notifStyle : callStyle; }

// Résumé de la rangée, en lignes (maquettes 36, 36c, 36d, 36f)
function telStyleSummary(k) {
  const r = ringSettings[_ringKind(k)], T = _TS_TXT;
  const style = _CALL_STYLE_NAMES[_tsStyle(k)] || _CALL_STYLE_NAMES.glass;
  const son = telSoundName(r.sound), vol = _tsTpl(T.vol, { n: Math.round(r.vol * 100) }), vib = r.vib ? T.vibYes : T.vibNo;
  const j = (a) => a.join(T.sep);
  if (k === 'call') {
    const first = [style, callPresent === 'banner' ? T.presBanner : T.presFull];
    if (callStyle !== 'minimal') first.push(callPhotoMode === 'full' ? T.photoFull : T.photoAvatar);
    return [j(first), j([_tsTpl(T.ring, { son }), vol, vib])];
  }
  if (k === 'notif') return [j([style, _tsTpl(T.wall, { fond: _notifWallData ? T.wallPhoto : T.wallGradient })]), j([_tsTpl(T.sound, { son }), vol, vib])];
  if (k === 'discussion') return [j([style, _tsTpl(T.chatSound, { son }), vib])];
  return [j([style, _tsTpl(T.sound, { son }), vol, vib])];
}

let _tsOpen = false;
function openTelStyle() {
  if (licLocked('tel')) return; // aperçu sans licence (77-licence-ui.js)
  const v = document.getElementById('tel-style-view');
  if (!v) return;
  _tsOpen = true;
  v.style.display = 'flex';
  v.scrollTop = 0;
  renderTelStyle();
}
function closeTelStyle() {
  _tsOpen = false;
  const v = document.getElementById('tel-style-view');
  if (v) v.style.display = 'none';
  if (_ringPrev) { _ringPrevStop(); renderRingPanel(); } // écoute d'un son importé en cours
}
function telStyleIsOpen() { return _tsOpen; }

// Rangées résumé (onglet) et, ouverte, la vue
function renderTelStyle() {
  const k = callKind, T = _TS_TXT;
  const set = (id, t) => { setIconText(document.getElementById(id), t); };
  const title = k === 'call' ? T.titleCall : T.titleOther;
  set('telStyleLabel', title);
  const sum = telStyleSummary(k).map(escapeHtml).join('<br>');
  const el = document.getElementById(k === 'notif' ? 'ntStyleSum' : 'telStyleSum');
  if (el && el.innerHTML !== sum) el.innerHTML = sum;
  if (!_tsOpen) return;
  set('tsTitle', title);
  set('tsBack', T.back);
  set('tsCap', k === 'call' ? T.capCall : k === 'notif' ? T.capNotif : k === 'discussion' ? T.capChat : T.capSms);
  set('tsVibNote', T.vibNote);
  const tg = document.getElementById('telVibToggle');
  if (tg) tg.checked = !!ringSettings[_ringKind(k)].vib;
  _tsRenderPreview();
}

// ── Aperçu (maquette 36b) : simple maquette de l'écran de jeu ──
// Textes échappés ; images : data-URL déjà validées (safeImageData)
const _tsImg = (data) => (data ? ' style="background-image:url(' + data + ')"' : '');
const _tsInitial = (name) => escapeHtml(String(name || '?').trim().charAt(0).toUpperCase() || '?');
function _tsAvatar(name, photo, cls) {
  return '<span class="tp-av' + (cls ? ' ' + cls : '') + '"' + _tsImg(photo) + '>' + (photo ? '' : _tsInitial(name)) + '</span>';
}
function _tsPreviewHtml(k) {
  const T = _TS_TXT, val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const style = _tsStyle(k);
  const vib = ringSettings[_ringKind(k)].vib ? '<span class="tp-vib">' + escapeHtml(T.vibBadge) + '</span>' : '';
  if (k === 'discussion') {
    const first = (from, def) => { const m = _chat.msgs.find((x) => x.from === from && _chatValid(x)); return m ? m.text : def; };
    return { cls: style + ' chat', html: vib + '<span class="tp-head">' + _tsAvatar(chatContactName(), _chatAvatar) + escapeHtml(chatContactName()) + '</span>'
      + '<span class="tp-b">' + escapeHtml(first('contact', T.chatIn)) + '</span><span class="tp-b out">' + escapeHtml(first('actor', T.chatOut)) + '</span>' };
  }
  if (k === 'notif') {
    const app = val('ntAppName');
    const icon = '<span class="tp-ic"' + _tsImg(_notifIcon) + '>' + (_notifIcon ? '' : _tsInitial(app)) + '</span>';
    const wall = notifPresent === 'lock' ? _notifWallData : null;
    return { cls: style + ' banner' + (wall ? ' photo' : ''), bg: wall, html: vib + '<span class="tp-card">' + icon
      + '<span class="tp-txt"><b>' + escapeHtml(val('ntTitle')) + '</b><span>' + escapeHtml(val('ntBody')) + '</span></span></span>' };
  }
  const name = val('callName') || T.unknown, label = val('callLabel') || T.label;
  if (k === 'sms') {
    return { cls: style + ' banner', html: vib + '<span class="tp-card">' + _tsAvatar(name, style === 'minimal' ? null : _callPhoto)
      + '<span class="tp-txt"><b>' + escapeHtml(name) + '</b><span>' + escapeHtml(val('callMsgText') || T.smsMsg) + '</span></span></span>' };
  }
  if (callPresent === 'banner') {
    return { cls: style + ' banner', html: vib + '<span class="tp-card">' + _tsAvatar(name, _callPhoto)
      + '<span class="tp-txt"><b>' + escapeHtml(name) + '</b><span>' + escapeHtml(label) + '</span></span><span class="tp-cardbt"><span></span><span></span></span></span>' };
  }
  // Appel plein écran : photo plein écran (Verre, Tonal) ou avatar
  const full = !!_callPhoto && style !== 'minimal' && callPhotoMode === 'full';
  return { cls: style + (full ? ' photo' : ''), bg: full ? _callPhoto : null, html: vib + (full ? '' : _tsAvatar(name, _callPhoto))
    + '<span class="tp-nm">' + escapeHtml(name) + '</span><span class="tp-lb">' + escapeHtml(label) + '</span><span class="tp-bt"><span></span><span></span></span>' };
}
function _tsRenderPreview() {
  const pv = document.getElementById('tsPreview');
  if (!pv) return;
  const p = _tsPreviewHtml(callKind);
  pv.className = 'ts-prev ' + p.cls;
  pv.style.backgroundImage = p.bg ? 'url(' + p.bg + ')' : '';
  if (pv.innerHTML !== p.html) pv.innerHTML = p.html;
}

// Échap : ferme la vue (une feuille ouverte passe d'abord, 39-screens-ui.js :
// écouté en capture, avant que la feuille ne se ferme)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _tsOpen && !_sheet) closeTelStyle();
}, true);
