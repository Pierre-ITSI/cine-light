// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ NOTIFICATION D'APPLICATION (onglet Tel) ══════════════════════════
// Maquettes validées 24 (télécommande) et 25 (écran). Remplace l'ancienne
// « messagerie » : une application fictive (icône importée, nom), un titre et
// un contenu, affichés en bandeau sur un écran allumé ou en carte sur le faux
// écran verrouillé. Style (Verre / Tonal / Épuré), fond d'écran verrouillé
// (__notifwall), son et vibreur (ringSettings.notif) PROPRES, indépendants des
// SMS, réglés dans la vue « Style et son » (rangée sous « Envoyer la
// notification », maquette validée 36f, 78-tel-style.js).
//
// « Heure du téléphone » : date et heure du faux téléphone (écran verrouillé,
// calcul de « Reçue ») ; vides : celles de l'écran. « Reçue » : maintenant,
// il y a n min, ou une date et une heure, affichée comme un téléphone
// (« maintenant », « il y a 15 min », « il y a 2 h », « 14:17 », « hier »,
// « mardi », « 12 oct. », « 12/10/2025 »).
//
// Icône : image choisie par l'utilisateur, recadrée au carré (160 px),
// vérifiée (safeImageData) puis envoyée en fragments chiffrés sous
// __notificon et gardée en cache sur l'écran (comme la photo d'un appel).
// Message : call:start kind « notif » (name = titre, msg = contenu).
// Textes affichés échappés (escapeHtml), jamais interprétés.

// — Télécommande —
let notifStyle = 'glass', notifPresent = 'banner', notifReceived = 'now';
let _notifIcon = null, _notifWallData = null;
const NOTIF_ICON_PX = 160;

const _NT_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const _NT_DAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const _NT_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const _NT_MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const _pad2 = (n) => String(n).padStart(2, '0');

// « 14:32 », « 1432 », « 9h05 » → « 14:32 » / « 09:05 » ; '' si vide ; null si invalide
function notifParseTime(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  const r = /^(\d{1,2})\s*[:hH.]?\s*(\d{2})$/.exec(t);
  if (!r) return null;
  const h = +r[1], m = +r[2];
  return h < 24 && m < 60 ? _pad2(h) + ':' + _pad2(m) : null;
}
const _ntDateOk = (v) => typeof v === 'string' && SRP.DATE_RE.test(v);
function _ntDate(ymd) { const [y, mo, d] = ymd.split('-').map(Number); return new Date(y, mo - 1, d); }
// « ven. 17 oct. » (télécommande) et « vendredi 17 octobre » (écran verrouillé)
function notifShortDate(ymd) { const d = _ntDate(ymd); return _NT_DAYS_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + _NT_MONTHS_SHORT[d.getMonth()]; }
function notifLongDate(d) { return _NT_DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + _NT_MONTHS[d.getMonth()]; }

// Maintenant sur le faux téléphone : date et/ou heure imposées, le reste réel
function notifPhoneNow(phone, real) {
  const d = new Date((real || new Date()).getTime());
  if (phone && _ntDateOk(phone.date)) { const [y, mo, da] = phone.date.split('-').map(Number); d.setFullYear(y, mo - 1, da); }
  if (phone && typeof phone.time === 'string' && SRP.TIME_RE.test(phone.time)) {
    const [h, mi] = phone.time.split(':').map(Number); d.setHours(h, mi, 0, 0);
  }
  return d;
}
// Libellé « Reçue » à l'heure now du faux téléphone, comme un téléphone
function notifReceivedLabel(received, now) {
  const r = received || { mode: 'now' };
  let at;
  if (r.mode === 'ago') at = new Date(now.getTime() - (Number(r.min) || 0) * 60000);
  else if (r.mode === 'at' && _ntDateOk(r.date) && SRP.TIME_RE.test(r.time || '')) {
    at = _ntDate(r.date); const [h, mi] = r.time.split(':').map(Number); at.setHours(h, mi, 0, 0);
  } else return 'maintenant';
  const mins = Math.floor((now.getTime() - at.getTime()) / 60000);
  const hhmm = _pad2(at.getHours()) + ':' + _pad2(at.getMinutes());
  if (mins < 0) return hhmm;                      // dans le futur : l'heure, simplement
  if (mins < 1) return 'maintenant';
  if (mins < 60) return 'il y a {n} min'.replace('{n}', mins);
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86400000);
  if (days === 0) return mins < 360 ? 'il y a {n} h'.replace('{n}', Math.floor(mins / 60)) : hhmm;
  if (days === 1) return 'hier';
  if (days < 7) return _NT_DAYS[at.getDay()];
  if (at.getFullYear() === now.getFullYear()) return at.getDate() + ' ' + _NT_MONTHS_SHORT[at.getMonth()];
  return _pad2(at.getDate()) + '/' + _pad2(at.getMonth() + 1) + '/' + at.getFullYear();
}

const _ntVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
function _ntPhone() {
  const out = {};
  const d = _ntVal('ntPhoneDate'), t = notifParseTime(_ntVal('ntPhoneTime'));
  if (_ntDateOk(d)) out.date = d;
  if (t) out.time = t;
  return out;
}
function _ntReceived() {
  if (notifReceived === 'ago') {
    const n = parseInt(_ntVal('ntAgoMin'), 10);
    return { mode: 'ago', min: Number.isFinite(n) ? Math.min(PROTO.NOTIF_AGO_MAX, Math.max(0, n)) : 0 };
  }
  if (notifReceived === 'at') {
    const d = _ntVal('ntAtDate'), t = notifParseTime(_ntVal('ntAtTime'));
    if (_ntDateOk(d) && t) return { mode: 'at', date: d, time: t };
  }
  return { mode: 'now' };
}
// Champs de call:start d'une notification (et d'une entrée enregistrée)
function notifFormFields() {
  return Object.assign({
    kind: 'notif',
    style: notifStyle,
    name: _ntVal('ntTitle').slice(0, 40),
    label: '',
    msg: _ntVal('ntBody').slice(0, 200),
    appName: _ntVal('ntAppName').slice(0, 24),
    hasPhoto: !!_notifIcon,
  }, ringFormFields('notif'), {
    present: notifPresent,
    phone: _ntPhone(),
    received: _ntReceived(),
  });
}

// Formulaire affiché (type Notification)
function notifShowForm(on) {
  for (const id of ['ntAppPanel', 'telNtTitleField', 'telNtBodyField', 'ntShowPanel']) {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? '' : 'none';
  }
  if (on) renderNotifForm();
}
function setNotifPresent(v) { notifPresent = v === 'lock' ? 'lock' : 'banner'; renderNotifForm(); }
function setNotifReceived(v) {
  notifReceived = ['now', 'ago', 'at'].includes(v) ? v : 'now';
  if (notifReceived === 'at' && !_ntVal('ntAtDate')) {
    // Proposition : la date du téléphone (ou celle du jour)
    const d = notifPhoneNow(_ntPhone());
    const el = document.getElementById('ntAtDate');
    if (el) el.value = d.getFullYear() + '-' + _pad2(d.getMonth() + 1) + '-' + _pad2(d.getDate());
  }
  renderNotifForm();
}
function setNotifStyle(s) { notifStyle = _CALL_STYLE_HINTS[s] ? s : 'glass'; renderNotifForm(); }
// Ouvre le sélecteur de date du système (champ date transparent par-dessus le libellé)
function ntOpenPicker(ev, id) {
  const el = document.getElementById(id);
  if (!el || ev.target === el) return;
  try { if (el.showPicker) el.showPicker(); else el.focus(); } catch (_) { el.focus(); }
}

function renderNotifForm() {
  const set = (id, t) => { setIconText(document.getElementById(id), t); };
  const act = (pre, list, v) => list.forEach((x) => { const b = document.getElementById(pre + x); if (b) b.classList.toggle('active', x === v); });
  // Icône : image choisie, sinon initiale du nom de l'application
  const ic = document.getElementById('ntIconPreview');
  if (ic) {
    ic.style.backgroundImage = _notifIcon ? 'url(' + _notifIcon + ')' : '';
    ic.classList.toggle('has-img', !!_notifIcon);
    ic.textContent = _notifIcon ? '' : (_ntVal('ntAppName').trim().charAt(0).toUpperCase() || '?');
  }
  const clr = document.getElementById('ntIconClear');
  if (clr) clr.style.display = _notifIcon ? 'inline' : 'none';
  act('ntpres-', ['banner', 'lock'], notifPresent);
  act('ntrecv-', ['now', 'ago', 'at'], notifReceived);
  // Dates : libellé « ven. 17 oct. » par-dessus le champ date du système
  for (const [inp, txt, empty] of [['ntPhoneDate', 'ntPhoneDateText', 'Date réelle'], ['ntAtDate', 'ntAtDateText', 'Date']]) {
    const v = _ntVal(inp), el = document.getElementById(txt);
    if (!el) continue;
    el.textContent = _ntDateOk(v) ? notifShortDate(v) : empty;
    el.classList.toggle('nt-placeholder', !_ntDateOk(v));
  }
  for (const id of ['ntPhoneTime', 'ntAtTime']) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('nt-bad', notifParseTime(el.value) === null);
  }
  const at = document.getElementById('ntAtRow');
  if (at) at.style.display = notifReceived === 'at' ? 'flex' : 'none';
  // Style et fond (vue « Style et son ») ; résumé de la rangée
  act('ntstyle-', ['glass', 'tonal', 'minimal'], notifStyle);
  set('ntStyleHint', _CALL_STYLE_HINTS[notifStyle] || '');
  const wp = document.getElementById('ntWallPreview');
  if (wp) wp.style.backgroundImage = _notifWallData ? 'url(' + _notifWallData + ')' : '';
  if (typeof renderTelStyle === 'function') renderTelStyle();
}
function _ntIconStatus(t) {
  const el = document.getElementById('ntIconStatus');
  if (!el) return;
  setIconText(el, t || '');
  el.style.display = t ? 'block' : 'none';
  el.classList.toggle('rt-warn', !!t);
}
// Icône : recadrée au carré, PNG si l'image peut être transparente, sinon JPEG
function onNotifIcon(files) {
  const f = files && files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    const side = Math.min(img.width, img.height);
    if (!side) { _ntIconStatus('⚠ Image illisible'); return; }
    const c = document.createElement('canvas'); c.width = c.height = NOTIF_ICON_PX;
    c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, NOTIF_ICON_PX, NOTIF_ICON_PX);
    const png = /png|webp|gif/i.test(f.type || '');
    const data = safeImageData(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85));
    if (!data) { _ntIconStatus('⚠ Image illisible'); return; }
    _notifIcon = data;
    _ntIconStatus('');
    renderNotifForm();
    ensureCallAssets(_notifIcon, null, null, undefined, '__notificon');
  };
  img.onerror = () => { URL.revokeObjectURL(img.src); _ntIconStatus('⚠ Image illisible'); };
  img.src = URL.createObjectURL(f);
}
function clearNotifIcon() { _notifIcon = null; renderNotifForm(); }
// Fond du faux écran verrouillé des notifications (propre, __notifwall)
function onNotifWall(files) {
  if (!files || !files[0]) return;
  const img = new Image();
  img.onload = async () => {
    const maxD = 1280;
    const s = Math.min(1, maxD / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
    const data = safeImageData(c.toDataURL('image/jpeg', 0.7));
    if (!data) return;
    _notifWallData = data;
    renderNotifForm();
    const st = document.getElementById('ntWallStatus');
    if (st) setIconText(st, "📤 Envoi du fond d'écran…");
    await ensureSlotImage('__notifwall', _notifWallData);
    if (st) setIconText(st, "✓ Fond d'écran prêt sur l'écran");
  };
  img.onerror = () => URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(files[0]);
}
// Entrée enregistrée rechargée dans le formulaire (82-call-list.js)
function notifApplyEntry(e, icon) {
  const val = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  notifStyle = _CALL_STYLE_HINTS[e.style] ? e.style : 'glass';
  notifPresent = e.present === 'lock' ? 'lock' : 'banner';
  val('ntAppName', e.appName || ''); val('ntTitle', e.name || ''); val('ntBody', e.msg || '');
  const ph = e.phone || {};
  val('ntPhoneDate', _ntDateOk(ph.date) ? ph.date : ''); val('ntPhoneTime', ph.time || '');
  const r = e.received || { mode: 'now' };
  notifReceived = ['ago', 'at'].includes(r.mode) ? r.mode : 'now';
  if (r.mode === 'ago') val('ntAgoMin', String(r.min || 0));
  if (r.mode === 'at') { val('ntAtDate', r.date || ''); val('ntAtTime', r.time || ''); }
  _notifIcon = icon || null;
  renderNotifForm();
  if (_notifIcon) ensureCallAssets(_notifIcon, null, null, undefined, '__notificon');
}

// — Écran —
// Réglages reçus (déjà bornés par _validCallStart) → configuration d'affichage
function notifScreenCfg(m) {
  const ph = m.phone || {};
  const phone = { date: _ntDateOk(ph.date) ? ph.date : null, time: typeof ph.time === 'string' && SRP.TIME_RE.test(ph.time) ? ph.time : null };
  return {
    present: m.present === 'lock' ? 'lock' : 'banner',
    lock: m.present === 'lock' ? { time: '', date: '' } : null,
    phone,
    received: m.received || { mode: 'now' },
  };
}
// Icône : image en cache validée, sinon initiale du nom de l'application
function _ntIconHtml(m, cls) {
  const ini = escapeHtml(String(m.appName || '?').trim().charAt(0).toUpperCase() || '?');
  return m.photo
    ? '<div class="' + cls + ' nt-img" style="background-image:url(' + m.photo + ')"></div>'
    : '<div class="' + cls + ' nt-ini">' + ini + '</div>';
}
// Carte de notification d'application (bandeau ou écran verrouillé), selon le style
function notifCardHtml(m, extraCls) {
  const cls = 'sc-notif nt-card ' + m.style + (extraCls ? ' ' + extraCls : '');
  const click = extraCls ? '' : ' onclick="event.stopPropagation();screenNotifTap()"';
  const when = escapeHtml(notifReceivedLabel(m.received, notifPhoneNow(m.phone)));
  const app = escapeHtml(m.appName || ''), title = escapeHtml(m.name || ''), body = escapeHtml(m.msg || '');
  if (m.style === 'tonal') {
    return '<div class="' + cls + '"' + click + '><div class="sc-notif-body">'
      + '<div class="n-head">' + _ntIconHtml(m, 'n-dot') + '<span class="nt-app">' + app + '</span> · ' + when + '</div>'
      + '<div class="sc-notif-name">' + title + '</div>'
      + '<div class="sc-notif-msg">' + body + '</div>'
      + '</div></div>';
  }
  if (m.style === 'minimal') {
    return '<div class="' + cls + '"' + click + '>' + _ntIconHtml(m, 'sc-notif-icon')
      + '<div class="sc-notif-body">'
      + '<div class="n-title"><span class="sc-notif-name">' + title + '</span><span class="n-time">' + when + '</span></div>'
      + '<div class="sc-notif-msg">' + body + '</div>'
      + '<div class="n-app">' + app + '</div>'
      + '</div></div>';
  }
  // Verre (maquette 25) : application et heure en tête, titre, contenu
  return '<div class="' + cls + '"' + click + '>' + _ntIconHtml(m, 'sc-notif-icon')
    + '<div class="sc-notif-body">'
    + '<div class="nt-head"><span class="nt-app">' + app + '</span><span class="n-time">' + when + '</span></div>'
    + '<div class="sc-notif-name">' + title + '</div>'
    + '<div class="sc-notif-msg">' + body + '</div>'
    + '</div></div>';
}
