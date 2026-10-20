// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ SÉQUENCE : FAUX TÉLÉPHONE (écran de jeu) ══════════════════════════
// Maquettes validées 30 (écran verrouillé, notifications empilées), 31 (pavé
// du code) et 32 (image d'écran d'accueil). L'état vient TOUT ENTIER de la
// télécommande (phone:state, 91-sequence.js) : rien n'est gardé ici, un écran
// rechargé le retrouve à la resynchronisation.
//   • Écran verrouillé : date et heure de l'écran, notifications empilées (la
//     plus récente en haut), heures relatives calculées avec l'horloge de
//     l'écran (« maintenant », « il y a 2 min ») et rafraîchies.
//   • Toucher l'écran verrouillé (ou une notification) quand un déverrouillage
//     par code est attendu : pavé du code. Chaque touche remplit le point
//     suivant (comme la frappe lettre à lettre de la discussion) ; au dernier
//     chiffre le téléphone se déverrouille, sans aller-retour. Glisser seul :
//     toucher déverrouille. Aucun code n'existe ni ne part : seule la
//     complétion est rapportée (phone:gesture « unlock »).
//   • Déverrouillé : l'app visée (la discussion, 83-discussion.js, s'ouvre
//     par-dessus) ou l'image d'écran d'accueil (__seqhome, plein écran) ;
//     toucher l'image rapporte le geste « home ».
//   • Gestes rapportés à la télécommande (phone:gesture) : seulement ceux
//     qu'elle attend (watch), « unlock » toujours ; au plus un par geste
//     toutes les 400 ms et 5 par seconde. Refuser, raccrocher, décrocher : les
//     boutons du faux appel (80-call-simulator.js) passent par screenTap*().
//   • Trois styles neutres (Verre / Tonal / Épuré), aucune marque.
//   • Barre d'état (maquette 28b, 97-phone-status.js) : reçue avec l'état ;
//     l'horloge de l'écran verrouillé et les heures relatives suivent
//     l'horloge de la séquence (l'heure avance, figée, heure réelle).
//   • Veille (maquette 29b) : écran noir en fondu sur l'écran verrouillé ; il
//     se rallume à chaque notification / appel / alerte et/ou au toucher
//     (le toucher qui le rallume ne fait rien d'autre, sauf rapporter « touche
//     l'écran » s'il est attendu), puis se rendort après N s sans toucher ; le
//     déverrouillage le réveille pour de bon.
//   • Batterie faible (maquette 33) : alerte à fermer (« Fermer » rapporte le
//     geste dismiss, l'alerte ne revient pas à la resynchronisation).
//   • Extinction (maquette 33) : fondu au noir, logo neutre, écran noir ; le
//     téléphone ne répond plus à rien. Rallumé (étape « Veille » ou ↶) : logo
//     neutre puis l'écran verrouillé (endormi après une « Veille »).
//   • Fond d'écran de la séquence (maquette 42, wall) : image préchargée sous
//     __seqwall, couvrante sous un voile, sur l'écran verrouillé et le pavé du
//     code ; absente ou pas encore arrivée : le dégradé sombre.
//   • Icônes des notifications (maquette 44) : notification d'application,
//     son icône importée (img, préparée __ph_…, carré arrondi), sinon la
//     première lettre de l'app ; SMS : la bulle sur la couleur de son app ;
//     appel manqué : avatar rond gris aux initiales de l'appelant (who) ou sa
//     photo (img), petite pastille rouge au combiné en bas à droite. Image
//     arrivée après l'état : posée sans redessiner l'écran.
//   • Aucun réseau (maquette 44b) : même alerte que « Batterie faible »,
//     « OK » la ferme (geste dismiss) ; la télécommande ne l'envoie qu'une fois
//     par perte du réseau.
// Textes affichés regroupés pour la traduction ; contenus reçus en textContent.
const _SP_TXT = {
  unlockHint: 'Touchez pour déverrouiller',
  now: 'maintenant',
  agoMin: 'il y a {n} min',
  agoH: 'il y a {n} h',
};
const SP_POWER_FADE_MS = 600, SP_LOGO_MS = 1500, SP_BOOT_MS = 1200;
const SP_GESTURE_GAP_MS = 400, SP_GESTURE_BURST = 5, SP_RELOCK_GUARD_MS = 1500, SP_REFRESH_MS = 15000;

let _scPhone = null;          // état reçu : { mode, style, notifs, unlock, home, wall, watch: Set, sleep, alert, power }
let _spSleep = null;          // veille : { cfg, awake, timer, callOn }
let _spAlertClosed = null;    // alerte fermée ici (id), pas encore confirmée par la télécommande
let _spPowerSeq = 0;          // jeton des animations d'extinction / rallumage
let _spTyped = 0;             // points du code remplis (local, jamais envoyés)
let _spUnlockedAt = 0;        // déverrouillé ici, pas encore confirmé par la télécommande
let _spRefreshTimer = null;
// Dernier rendu : le fondu ne joue qu'à l'apparition d'un écran (mode changé),
// seules les nouvelles notifications glissent (sinon flash de la couleur de fond)
const _spShown = { mode: null, ids: new Set() };
const _spGestureAt = new Map(); // geste → dernier envoi
let _spBurst = [];

function _spTpl(s, v) { return s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : '')); }

// ── Réception (phone:state, déjà validé et borné par _validPhoneState) ──
function screenPhoneState(m) {
  const now = Date.now();
  const prev = _scPhone;
  const notifs = m.notifs.map((n) => Object.assign({}, n, { at: now - n.ago * 1000 }));
  // Heure d'arrivée déjà connue : gardée (pas de saut d'une minute entre deux envois)
  if (prev) for (const n of notifs) { const o = prev.notifs.find((x) => x.id === n.id); if (o && Math.abs(o.at - n.at) < 5000) n.at = o.at; }
  let mode = m.mode;
  const local = prev ? prev.mode : 'off';
  // Pavé ouvert ici et toujours attendu : la saisie en cours n'est pas interrompue
  if (local === 'code' && mode === 'locked' && m.unlock && m.unlock.code) mode = 'code';
  // Déverrouillé ici à l'instant : un état parti avant que la télécommande l'apprenne ne le reverrouille pas
  if (m.mode === 'unlocked' || m.mode === 'home') _spUnlockedAt = 0; // elle le sait
  if ((local === 'unlocked' || local === 'home') && (mode === 'locked' || mode === 'code') && _spUnlockedAt && now - _spUnlockedAt < SP_RELOCK_GUARD_MS) mode = local;
  if (mode !== 'code' || local !== 'code') _spTyped = 0;
  const wasOff = prev ? prev.power === 'off' : null; // null : premier état (écran rechargé)
  const fresh = !!prev && notifs.some((n) => !prev.notifs.some((o) => o.id === n.id));
  const alertNew = !!m.alert && !(prev && prev.alert && prev.alert.id === m.alert.id);
  if (!m.alert || (_spAlertClosed && m.alert.id !== _spAlertClosed)) _spAlertClosed = null;
  _scPhone = { mode, style: m.style, notifs, unlock: m.unlock, home: !!m.home, homeWall: m.homeWall === true, wall: !!m.wall, watch: new Set(m.watch), sleep: m.sleep || null, alert: m.alert || null, power: m.power === 'off' ? 'off' : 'on' };
  screenSeqBar(m.bar); // 97-phone-status.js
  _spRender();
  _spRenderAlert();
  _spApplySleep(fresh || (alertNew && !!prev) || !!m.chime);
  _spApplyPower(wasOff);
  if (m.chime) {
    const n = notifs.find((x) => x.id === m.chime.id);
    _playNotifSound({ kind: n && n.kind === 'notif' ? 'notif' : 'sms', ring: m.chime.ring, ringId: m.chime.ringId, ringVolume: m.chime.vol });
    if (m.chime.vib) screenVibrate(SCREEN_VIB_SHORT); // vibreur de l'entrée (maquette 36b, 80-call-simulator.js)
  }
}
function screenPhoneHide() {
  _scPhone = null; _spTyped = 0; _spUnlockedAt = 0; _spAlertClosed = null;
  _spShown.mode = null; _spShown.ids.clear();
  if (_spRefreshTimer) { clearInterval(_spRefreshTimer); _spRefreshTimer = null; }
  const el = document.getElementById('screen-phone');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
  if (_spSleep && _spSleep.timer) clearTimeout(_spSleep.timer);
  _spSleep = null;
  _spRenderAlert();
  _spPowerSeq++;
  const pw = document.getElementById('screen-ppower');
  if (pw) { pw.style.display = 'none'; pw.className = ''; pw.textContent = ''; }
  screenBarsHide(); // 97-phone-status.js
}
// Image d'accueil arrivée en cache après l'état (75-media-screen.js)
function screenPhoneOnHomeCached() { if (_scPhone && _scPhone.mode === 'home') _spRender(); }
// Fond d'écran arrivé (ou remplacé) en cache après l'état : posé sans redessiner l'écran
function screenPhoneOnWallCached() { _spPaintWall(); }
function _spPaintWall() {
  const p = _scPhone;
  const root = document.querySelector('#screen-phone .ph-lock, #screen-phone .ph-code');
  if (!root) return;
  const c = p && p.wall ? _mediaCache.get('__seqwall') : null;
  PhoneUI.paintWall(root, c && c.kind === 'img' ? safeImageData(c.data) : null);
}

// ── Gestes ──
function phoneGesture(g, n) {
  if (mode !== 'screen' || !_scPhone) return false;
  if (_scPhone.power === 'off') return false; // éteint : ne répond plus
  const always = PROTO.PHONE_GESTURES_ALWAYS.includes(g);
  if (!always && !_scPhone.watch.has(g) && !(_scPhone.watch.has('touch') && (g === 'notif' || g === 'home'))) return false;
  const now = Date.now();
  if (now - (_spGestureAt.get(g) || 0) < SP_GESTURE_GAP_MS && !always) return false;
  _spBurst = _spBurst.filter((t) => now - t < 1000);
  if (_spBurst.length >= SP_GESTURE_BURST && !always) return false;
  _spGestureAt.set(g, now);
  _spBurst.push(now);
  sendMsg(Object.assign({ type: 'phone:gesture', g }, g === 'notif' && n ? { n } : {}));
  return true;
}
// Boutons du faux appel (80-call-simulator.js) : le geste n'est rapporté que s'il a eu lieu
function screenTapDecline() { const was = _callState; screenCallDecline(); if (was === 'ringing') phoneGesture('hangup'); }
function screenTapAnswer() { const was = _callState; screenCallAnswer(); if (was === 'ringing') phoneGesture('answer'); }
function screenTapHangup() { const was = _callState; screenCallEnd(); if (was === 'incall' || was === 'ringing') phoneGesture('hangup'); }
// Bandeau de notification touché (SMS, notification d'application)
function screenNotifTap() { screenCallEnd(); phoneGesture('notif'); }

// Toucher l'écran verrouillé (ou une de ses notifications)
function _spLockTouch(nid) {
  const p = _scPhone;
  if (!p || p.mode !== 'locked' || _spDark()) return;
  _spPoke();
  if (nid) phoneGesture('notif', nid); else phoneGesture('touch');
  const u = p.unlock;
  if (!u) return;
  if (u.code) { p.mode = 'code'; _spTyped = 0; _spRender(); }
  else _spUnlock();
}
// Une touche du pavé : point suivant ; au dernier, déverrouillé
function _spKey() {
  const p = _scPhone;
  if (!p || p.mode !== 'code' || !p.unlock || !p.unlock.code || _spDark()) return;
  _spPoke();
  _spTyped = Math.min(p.unlock.code, _spTyped + 1);
  if (_spTyped >= p.unlock.code) { _spUnlock(); return; }
  _spRenderDots();
}
function _spUnlock() {
  const p = _scPhone;
  if (!p || !p.unlock) return;
  p.mode = p.unlock.then === 'home' ? 'home' : 'unlocked';
  _spTyped = 0;
  _spUnlockedAt = Date.now();
  p.sleep = null; // déverrouillé : réveillé pour de bon
  _spApplySleep(false);
  _spRender();
  phoneGesture('unlock');
}

// ── Rendu ──
function _spWhen(at) {
  // Horloge de la séquence : figée, l'heure n'avance pas (« maintenant »)
  const s = Math.max(0, Math.floor((phoneClockAt(Date.now()) - phoneClockAt(at)) / 1000));
  if (s < 60) return _SP_TXT.now;
  if (s < 3600) return _spTpl(_SP_TXT.agoMin, { n: Math.floor(s / 60) });
  return _spTpl(_SP_TXT.agoH, { n: Math.floor(s / 3600) });
}
// Image préparée (icône, photo de l'appelant) déjà en cache, sinon null
function _spImg(id) {
  const c = id ? _mediaCache.get(id) : null;
  return c && c.kind === 'img' ? safeImageData(c.data) : null;
}
// Notification de la pile → données de la carte partagée (PhoneUI.notification, 73-phone-ui.js)
function _spData(n) {
  return { id: n.id, kind: n.kind, app: n.app, name: n.name, msg: n.msg, when: _spWhen(n.at), color: n.color, who: n.who, img: n.kind === 'sms' ? null : _spImg(n.img) };
}
// Icône ou photo arrivée en cache après l'état (75-media-screen.js) : posée sans redessiner l'écran
function screenPhoneOnImgCached(id) {
  const p = _scPhone;
  if (!p || p.mode !== 'locked') return;
  for (const n of p.notifs) {
    if (n.img !== id) continue;
    const c = document.querySelector('#screen-phone .pn[data-n="' + n.id + '"]'); // id : [A-Za-z0-9_-] (validé)
    const old = c && c.querySelector('.pn-icon');
    if (!old) continue;
    const t = document.createElement('div');
    t.innerHTML = PhoneUI.notification(_spData(n));
    const fresh = t.querySelector('.pn-icon');
    if (fresh) old.replaceWith(fresh);
  }
}
function _spClock() {
  const d = phoneClockNow(); // 97-phone-status.js
  return { time: PhoneUI.hm(d), date: PhoneUI.longDate(d) };
}
// Portrait : au plus 4 cartes sur l'écran verrouillé (« + N notifications » au-delà), la plus récente en haut ;
// paysage (téléphone couché) : toute la pile, qui défile
const SP_LOCK_MAX = 4;
const _spLandscape = () => typeof matchMedia === 'function' && matchMedia('(orientation:landscape) and (max-height:500px)').matches;
function _spRender() {
  const el = document.getElementById('screen-phone');
  const p = _scPhone;
  if (!el) return;
  const home = p && p.mode === 'home';
  const live = !!p && (p.mode === 'locked' || (home && !_spHomeImg(p)) || (home && p.homeWall));
  if (_spRefreshTimer && !live) { clearInterval(_spRefreshTimer); _spRefreshTimer = null; }
  if (!p || p.mode === 'off') { el.style.display = 'none'; el.textContent = ''; _spShown.mode = null; _spShown.ids.clear(); return; }
  const enter = _spShown.mode !== p.mode || el.style.display !== 'block';
  const seen = enter ? new Set() : _spShown.ids;
  _spShown.mode = p.mode;
  _spShown.ids = new Set(p.mode === 'locked' ? p.notifs.map((n) => n.id) : []);
  el.className = '';
  el.style.display = 'block';
  const k = _spClock(), ent = enter ? ' ph-enter' : '';
  if (p.mode === 'locked') {
    const notifs = p.notifs.slice().reverse().map(_spData); // la plus récente en haut
    const newIds = new Set(notifs.filter((n) => !seen.has(n.id)).map((n) => n.id));
    el.innerHTML = PhoneUI.root({ style: p.style, cls: 'ph-lock' + ent, body: PhoneUI.lock({ style: p.style, clock: k, notifs, hint: _SP_TXT.unlockHint, max: _spLandscape() ? 99 : SP_LOCK_MAX, newIds }) });
    _spPaintWall();
  } else if (p.mode === 'code') {
    el.innerHTML = PhoneUI.root({ style: p.style, cls: 'ph-code' + ent, body: PhoneUI.code({ len: p.unlock.code, typed: _spTyped }) });
    _spPaintWall();
  } else if (p.mode === 'home') {
    // Image de l'utilisateur : seule et plein écran (souvent une capture complète) ; en option, fond d'écran
    // sous les icônes génériques. Sans image : accueil générique sur le dégradé du style.
    const img = _spHomeImg(p);
    if (img && !p.homeWall) el.innerHTML = PhoneUI.root({ style: p.style, cls: 'ph-homeimg' + ent, body: PhoneUI.homeImage(img) });
    else {
      el.innerHTML = PhoneUI.root({ style: p.style, cls: 'ph-homewall' + (img ? '' : ' ph-homegen') + ent, body: PhoneUI.home({ clock: k }) });
      PhoneUI.paintWall(el.firstChild, img);
    }
  } else {
    el.innerHTML = PhoneUI.root({ style: p.style, cls: 'ph-unlocked' + ent });
  }
  if (live && !_spRefreshTimer) _spRefreshTimer = setInterval(_spRefresh, SP_REFRESH_MS);
}
// Image d'accueil de l'utilisateur en cache (__seqhome), sinon null
function _spHomeImg(p) {
  const c = p.home ? _mediaCache.get('__seqhome') : null;
  return c && c.kind === 'img' ? safeImageData(c.data) : null;
}
function _spRenderDots() {
  const box = document.querySelector('#screen-phone .pk-dots');
  const p = _scPhone;
  if (!box || !p || !p.unlock) return;
  box.innerHTML = PhoneUI.dots(p.unlock.code, _spTyped);
}
// Heures relatives et horloge à jour
function _spRefresh() {
  const p = _scPhone;
  if (!p || (p.mode !== 'locked' && p.mode !== 'home')) return;
  const k = _spClock(), q = (s) => document.querySelector('#screen-phone ' + s);
  const t = q('.pl-time'), d = q('.pl-date');
  if (t) t.innerHTML = PhoneUI.clockHtml(p.style, k.time);
  if (d) d.textContent = k.date;
  const wt = q('.phw-big'), wd = q('.phw-s');
  if (wt) wt.textContent = k.time;
  if (wd) wd.textContent = k.date;
  document.querySelectorAll('#screen-phone .pn').forEach((c) => {
    const n = p.notifs.find((x) => x.id === c.dataset.n);
    const w = c.querySelector('.pn-when');
    if (n && w) w.textContent = _spWhen(n.at);
  });
}

// ── Toucher (délégation) ──
(function initPhoneTouch() {
  const el = document.getElementById('screen-phone');
  if (!el) return;
  let down = null, swipedAt = 0;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const p = _scPhone;
    if (!p || Date.now() - swipedAt < 400) return;
    if (e.target.closest('[data-act="noop"]')) return; // lampe, appareil photo : décor
    if (p.mode === 'locked') { const c = e.target.closest('.pn'); _spLockTouch(c ? c.dataset.n : null); }
    else if (p.mode === 'code') { if (e.target.closest('.pk-key[data-key]')) _spKey(); }
    else if (p.mode === 'home') phoneGesture('home');
    else phoneGesture('touch');
  });
  // Glisser vers le haut sur l'écran verrouillé : comme un toucher
  el.addEventListener('pointerdown', (e) => { down = { y: e.clientY, t: Date.now() }; });
  el.addEventListener('pointerup', (e) => {
    const d = down; down = null;
    if (!d || !_scPhone || _scPhone.mode !== 'locked' || _spDark()) return;
    if (d.y - e.clientY > 60 && Date.now() - d.t < 1200) { swipedAt = Date.now(); _spLockTouch(null); }
  });
})();
// Toucher l'écran de jeu hors du faux téléphone (couleur, média) : geste « touche l'écran » s'il est attendu
(function initScreenTouch() {
  const sm = document.getElementById('screen-mode');
  if (sm) sm.addEventListener('click', () => { if (mode === 'screen' && _scPhone) phoneGesture('touch'); });
})();
// Clavier physique sur le pavé du code : chaque touche remplit le point suivant
document.addEventListener('keydown', (e) => {
  if (mode !== 'screen' || !_scPhone || _scPhone.mode !== 'code' || _scChat || _spDark()) return;
  if (e.ctrlKey || e.metaKey || e.altKey || !e.key || Array.from(e.key).length !== 1) return;
  e.preventDefault();
  _spKey();
});

// ── Veille (maquette 29b) ──
// Écran noir : téléphone éteint, ou en veille sans appel visible qui le rallume
function _spDark() {
  const p = _scPhone;
  if (!p) return false;
  if (p.power === 'off') return true;
  const s = _spSleep;
  return !!s && !s.awake && !(s.cfg.notif && s.callOn);
}
function _spApplySleep(wake) {
  const p = _scPhone;
  const cfg = p && p.power !== 'off' && (p.mode === 'locked' || p.mode === 'code') ? p.sleep : null;
  if (!cfg) {
    if (_spSleep && _spSleep.timer) clearTimeout(_spSleep.timer);
    _spSleep = null;
  } else if (!_spSleep) {
    _spSleep = { cfg, awake: false, timer: null, callOn: _spCallOn() };
  } else _spSleep.cfg = cfg;
  if (_spSleep && wake && _spSleep.cfg.notif) _spWake();
  else _spPaint();
}
function _spWake() {
  const s = _spSleep;
  if (!s) return;
  s.awake = true;
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => { s.timer = null; if (_spSleep === s) { s.awake = false; _spPaint(); } }, s.cfg.after * 1000);
  _spPaint();
}
// Toucher pendant l'éveil : le délai avant la mise en veille repart
function _spPoke() { if (_spSleep && _spSleep.awake) _spWake(); }
const _spCallOn = () => { const c = document.getElementById('screen-call'); return !!c && c.style.display === 'block'; };
// Surfaces changées (97-phone-status.js) : un appel rallume, sa fin relance le délai
function screenPhoneSurfacesChanged() {
  const s = _spSleep;
  if (!s) return;
  const on = _spCallOn();
  if (on === s.callOn) return;
  s.callOn = on;
  if (!on && s.cfg.notif) _spWake(); else _spPaint();
}

// ── Extinction et rallumage (maquette 33) ──
function _spApplyPower(wasOff) {
  const off = !!_scPhone && _scPhone.power === 'off';
  const pw = document.getElementById('screen-ppower');
  if (!pw) return;
  if (off && wasOff !== true) {
    const tok = ++_spPowerSeq;
    pw.innerHTML = PhoneUI.power();
    pw.style.display = 'flex';
    if (wasOff === null) { pw.className = 'on instant'; _sbRefresh(); return; } // écran rechargé : déjà éteint
    // Fondu au noir, logo neutre, puis noir
    if (!pw.classList.contains('on')) { pw.className = ''; void pw.offsetWidth; }
    pw.className = 'on';
    _sbRefresh();
    setTimeout(() => {
      if (tok !== _spPowerSeq) return;
      pw.className = 'on logo';
      setTimeout(() => { if (tok === _spPowerSeq) pw.className = 'on'; }, SP_LOGO_MS);
    }, SP_POWER_FADE_MS);
  } else if (!off && wasOff === true) {
    // Rallumage : logo neutre sur fond noir, puis le téléphone (endormi s'il est en veille)
    const tok = ++_spPowerSeq;
    pw.innerHTML = PhoneUI.power();
    pw.className = 'on logo'; pw.style.display = 'flex';
    setTimeout(() => { if (tok !== _spPowerSeq) return; pw.className = 'on'; _spPaint(); }, SP_BOOT_MS);
  }
}
// Écran noir de la veille affiché / retiré en fondu (pas pendant l'extinction ni le rallumage)
function _spPaint() {
  const pw = document.getElementById('screen-ppower');
  if (!pw || !_scPhone || _scPhone.power === 'off' || pw.classList.contains('logo')) { _sbRefresh(); return; }
  const dark = _spDark();
  const tok = ++_spPowerSeq;
  if (dark) {
    if (pw.style.display !== 'flex') { pw.textContent = ''; pw.className = ''; pw.style.display = 'flex'; void pw.offsetWidth; }
    pw.classList.add('on');
  } else if (pw.style.display === 'flex') {
    pw.classList.remove('on', 'instant');
    setTimeout(() => { if (tok === _spPowerSeq && !_spDark()) { pw.style.display = 'none'; pw.textContent = ''; } }, SP_POWER_FADE_MS);
  }
  _sbRefresh();
}
(function initPowerTouch() {
  const pw = document.getElementById('screen-ppower');
  if (!pw) return;
  pw.addEventListener('click', (e) => {
    e.stopPropagation();
    const p = _scPhone, s = _spSleep;
    if (!p || p.power === 'off' || !s || s.awake || !s.cfg.touch) return; // éteint, ou veille sans réveil au toucher
    _spWake();
    phoneGesture('touch'); // rapporté seulement s'il est attendu
  });
})();

// ── Batterie faible (maquette 33), aucun réseau (maquette 44b) ──
function _spRenderAlert() {
  const el = document.getElementById('screen-palert');
  if (!el) return;
  const p = _scPhone, a = p && p.alert;
  if (!a || p.power === 'off' || _spAlertClosed === a.id) { el.style.display = 'none'; el.textContent = ''; delete el.dataset.id; return; }
  const net = a.kind === 'net'; // « Aucun réseau » (maquette 44b)
  const lv = net ? 'net' : String(a.level);
  if (el.dataset.id === a.id && el.style.display === 'flex' && el.dataset.level === lv) return;
  el.className = '';
  el.dataset.id = a.id; el.dataset.level = lv;
  el.innerHTML = PhoneUI.root({ style: p.style, cls: 'ph-overlay', body: PhoneUI.alertBox({ kind: net ? 'net' : 'battery', level: a.level }) });
  el.style.display = 'flex';
}
// Toucher : « Fermer » / « OK » rapporte le geste dismiss ; rien ne traverse l'alerte
(function initAlertTouch() {
  const el = document.getElementById('screen-palert');
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-act="alert-close"]')) _spAlertClose();
  });
})();
function _spAlertClose() {
  const p = _scPhone;
  if (!p || !p.alert) return;
  _spAlertClosed = p.alert.id;
  _spRenderAlert();
  _spPoke();
  phoneGesture('dismiss');
}
// Téléphone tourné : la pile de l'écran verrouillé est redessinée (toutes les cartes en paysage, 3 en portrait)
window.addEventListener('resize', () => { if (_scPhone && _scPhone.mode === 'locked') _spRender(); });
