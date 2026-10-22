// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ MÉDIA — NAVIGATION DE L'ACTEUR (écran) ══════════════════════════
// Mode reçu de la télécommande (media:nav) :
//   off     Fixe     l'acteur ne navigue pas (la télécommande et les séquences changent de média)
//   tap     Toucher  un toucher passe au média suivant, en boucle (onScreenAdvanceClick, 68-blackout.js)
//   swipe   Glisser  carrousel horizontal : trois éléments (précédent, courant, suivant) sur une piste
//                    déplacée par transform ; le geste suit le doigt, puis la piste s'accroche (seuil de
//                    25 % de la largeur ou vitesse) ; en boucle du dernier au premier, comme Toucher
//   scroll  Défiler  fil vertical de tous les médias du pool à leur aspect naturel, défilement natif
//                    (inertie du navigateur, sans accrochage), habillage « fil social » facultatif
// Les médias viennent du cache écran (_mediaCache) dans l'ordre du pool (_mediaOrder) : aucun transfert
// de plus. Le média dominant et les médias visibles sont rapportés à la télécommande (media:view).
// Les éléments historiques #screen-media-img / #screen-media-video restent « affichés » (display) mais
// invisibles tant que la navigation est active : barre d'état, console DMX et reprise en dépendent.

// Textes de l'écran (tableau propre au fichier). Fil social : tout est générique et fictif, aucune
// marque, aucun logo, aucune police de marque.
const _NAV_TXT = {
  missing: 'Média en cours de réception…',
  social: {
    title: 'Publications', likes: 'J\'aime',
    names: ['lea.exemple', 'studio.photo', 'nina_voyage', 'atelier.lumiere', 'paul.cinema', 'clap_et_cie', 'sofia.plateau', 'marc.reflets'],
    ago: ['Il y a 2 h', 'Il y a 5 h', 'Hier', 'Il y a 3 j', 'Il y a 1 h', 'Il y a 12 h', 'Avant-hier', 'Il y a 4 h'],
    caps: ['Fin de journée.', 'Premier plan du matin.', 'Retour au calme.', 'Lumière du soir.', 'Repérage terminé.', 'Une prise de plus.', 'Silence, on tourne.', 'Derniers réglages.'],
    likesN: [128, 2304, 57, 842, 19, 5120, 310, 76],
  },
};
const NAV_GAP_PX = 12;          // noir entre deux médias du carrousel
const NAV_SNAP_FRAC = 0.25;     // part de la largeur au-delà de laquelle le geste change de média
const NAV_FLICK_VEL = 0.35;     // px/ms : vitesse d'un coup de doigt
const NAV_FLICK_MIN = 30;       // px : déplacement minimal d'un coup de doigt
const NAV_ANIM_MS = 260;        // accrochage
const NAV_REPORT_MS = 250;      // media:view : 4 messages par seconde au plus
const NAV_PLAY_RATIO = 0.5;     // une vidéo du fil joue, avec le son, au-delà de 50 % de l'écran (ou d'elle-même si plus petite)
const NAV_SOCIAL_TOP = 80;      // px réservés en haut par le titre du fil social (barre d'état comprise)
const NAV_VIS_MAX = 4;          // médias visibles rapportés

let _screenNav = 'off', _screenSkin = 'none';
let _screenNavSeen = false;     // un media:nav est arrivé : media:autoadvance (ancien) ne compte plus
let _navVid = null;             // vidéo de la navigation qui reçoit Lecture / Pause / Seek (la dominante)
const _nav = {
  on: false, mode: null, skin: null, ids: [], idx: 0, track: null, slides: [], scroller: null,
  drag: null, anim: null, vis: new Map(), dom: null, lastSig: '', timer: 0, prog: false, progTimer: 0,
  io: null, ioLazy: null, touched: false, clickBlockUntil: 0, measuring: false,
};

// ── Réglage reçu ──
// Ancien interrupteur : activé = Toucher, désactivé = Fixe (tant qu'aucun media:nav n'est arrivé)
function screenNavLegacy(on) {
  _screenAutoAdvance = !!on;
  if (!_screenNavSeen) { _screenNav = on ? 'tap' : 'off'; screenNavApply(); }
}
function screenSetNav(mode, skin) {
  _screenNavSeen = true;
  _screenNav = mode; _screenSkin = skin;
  _screenAutoAdvance = mode === 'tap';
  screenNavApply();
}
// Glisser / Défiler en cours pour ce média ? (jamais sous la console DMX, qui pilote un seul média)
function screenNavActive(id) {
  return (_screenNav === 'swipe' || _screenNav === 'scroll') && !!id && !screenDmxLive()
    && !!_mediaCache.get(id) && _mediaCache.get(id).kind !== 'audio';
}
// Vidéo qui reçoit les commandes de la télécommande : celle de la navigation, sinon l'élément historique
function screenMediaVideoEl() {
  if (_nav.on && _navVid && _navVid.isConnected) return _navVid;
  return document.getElementById('screen-media-video');
}
const _navLayer = () => document.getElementById('screen-media-nav');
const _navW = () => { const l = _navLayer(); return (l && l.clientWidth) || window.innerWidth || 390; };
const _navH = () => { const l = _navLayer(); return (l && l.clientHeight) || window.innerHeight || 844; };

// Médias de la navigation : l'ordre du pool, ou le seul média affiché si son ordre est inconnu
function _navIds(id) {
  const base = _mediaOrder.filter((i) => { const c = _mediaCache.get(i); return !c || c.kind !== 'audio'; });
  return base.includes(id) ? base : [id];
}

// Changement de mode (ou d'habillage) : l'écran change de présentation sans changer de média
function screenNavApply() {
  if (mode !== 'screen') return;
  const id = _screenActiveId;
  if (screenNavActive(id) && (screenMediaVisible() || _nav.on)) {
    const cur = _nav.on && _nav.dom ? _nav.dom : id;
    _navRender(_nav.on && _nav.ids.includes(cur) ? cur : id);
  } else if (_nav.on) {
    // Retour à Fixe / Toucher : le média courant reprend l'affichage historique
    screenNavHide();
    if (id && _mediaCache.has(id)) screenShowCached(id);
  }
}
// Nouvel ordre du pool, ou média retiré du cache
function screenNavOrderChanged() {
  if (!_nav.on) return;
  const id = _nav.mode === 'swipe' ? _nav.ids[_nav.idx] : (_nav.dom || _screenActiveId);
  if (screenNavActive(id)) _navRender(id); else screenNavHide();
}
// Un média vient d'arriver en cache : il remplace son cadre vide
function screenNavOnCached(id) {
  if (!_nav.on || !_nav.ids.includes(id)) return;
  if (_nav.mode === 'scroll') {
    const it = _nav.scroller.querySelector('.mn-item[data-id="' + id + '"]');
    if (it) _navFillMedia(it, id);
  } else {
    for (const s of _nav.slides) if (s.id === id) { s.el.textContent = ''; s.el.appendChild(_navMediaEl(id, s.o === 0)); }
  }
}
// Affiche ce média dans la navigation : même présentation = on y va (animé), sinon on la construit
function screenNavShow(id) {
  if (!screenNavActive(id)) return;
  const sameView = _nav.on && _nav.mode === _screenNav && _nav.skin === (_screenNav === 'scroll' ? _screenSkin : 'none')
    && _nav.ids.includes(id) && _navIds(id).join() === _nav.ids.join();
  if (!sameView) { _navRender(id); return; }
  if (_nav.mode === 'swipe') _navGoSwipe(id);
  else _navGoScroll(id, true);
}
function screenNavHide() {
  const layer = _navLayer();
  if (!layer || (!_nav.on && layer.style.display !== 'block')) return;
  _navTeardown();
  layer.style.display = 'none'; layer.textContent = ''; layer.className = '';
  const sm = document.getElementById('screen-mode');
  if (sm) sm.classList.remove('nav-on');
}
function _navTeardown() {
  if (_nav.io) { _nav.io.disconnect(); _nav.io = null; }
  if (_nav.ioLazy) { _nav.ioLazy.disconnect(); _nav.ioLazy = null; }
  if (_nav.timer) { clearTimeout(_nav.timer); _nav.timer = 0; }
  if (_nav.progTimer) { clearTimeout(_nav.progTimer); _nav.progTimer = 0; }
  if (_nav.anim) { try { _nav.anim.cancel(); } catch (_) {} _nav.anim = null; }
  const layer = _navLayer();
  if (layer) for (const v of layer.querySelectorAll('video')) { v._wantPlay = false; try { v.pause(); } catch (_) {} v.removeAttribute('src'); try { v.load(); } catch (_) {} }
  _navVid = null;
  Object.assign(_nav, { on: false, mode: null, skin: null, ids: [], idx: 0, track: null, slides: [], scroller: null, drag: null, dom: null, lastSig: '', prog: false, touched: false });
  _nav.vis.clear();
}

// Construit la présentation du mode courant, centrée sur ce média
function _navRender(id) {
  const layer = _navLayer();
  if (!layer) return;
  _navTeardown();
  const skin = _screenNav === 'scroll' ? _screenSkin : 'none';
  Object.assign(_nav, { on: true, mode: _screenNav, skin, ids: _navIds(id), touched: false });
  _nav.idx = Math.max(0, _nav.ids.indexOf(id));
  layer.textContent = '';
  layer.className = 'mn-' + _screenNav + (skin === 'social' ? ' mn-social' : '');
  layer.style.display = 'block';
  // L'élément historique reste « affiché » (barre d'état, DMX) mais invisible ; le média précédent est coupé
  const img = document.getElementById('screen-media-img');
  if (img) img.removeAttribute('src');
  showScreenMedia('img');
  const sm = document.getElementById('screen-mode');
  if (sm) sm.classList.add('nav-on');
  if (_screenNav === 'swipe') _navBuildSwipe(); else _navBuildScroll();
}

// ── Média d'un cadre ──
function _navMediaEl(id, current) {
  const c = _mediaCache.get(id);
  if (c && c.kind === 'img' && c.data) {
    const im = document.createElement('img');
    im.alt = ''; im.draggable = false; im.decoding = 'async'; im.src = c.data;
    return im;
  }
  if (c && c.kind === 'vid' && c.url) {
    const v = document.createElement('video');
    v.setAttribute('playsinline', ''); v.playsInline = true; v.preload = 'metadata'; v.draggable = false;
    v.loop = _screenVidEndMode === 'loop';
    v.muted = !current;
    v.src = c.url;
    return v;
  }
  const ph = document.createElement('div');
  ph.className = 'mn-ph'; ph.textContent = _NAV_TXT.missing;
  return ph;
}
// Le lecteur d'une vidéo de la navigation : mêmes retours que l'élément historique, pour la dominante seulement
function _navBindVideo(v) {
  v.onloadedmetadata = () => { _navNoteAspect(v); if (v === _navVid) { sendMsg({ type: 'media-meta', dur: v.duration }); sendScreenState(v); } };
  v.ontimeupdate = () => {
    if (v !== _navVid) return;
    const now = Date.now();
    if (now - _screenProgTimer < 250) return;
    _screenProgTimer = now;
    sendScreenState(v);
  };
  v.onplay = v.onpause = () => { if (v === _navVid) sendScreenState(v); };
  v.onended = () => {
    v._wantPlay = false;
    if (v !== _navVid) return;
    // Glisser : « 1× puis off » éteint le média comme avant ; dans le fil, la vidéo reste sur sa dernière image
    if (_screenVidEndMode === 'off' && _nav.mode === 'swipe') { hideScreenMedia(); sendMsg({ type: 'media-ended', off: true }); }
    else sendMsg({ type: 'media-ended' });
  };
  v.onerror = () => {
    const code = v.error && v.error.code;
    sendMsg({ type: 'media-error', reason: code === 4 ? 'src' : code === 3 ? 'decode' : 'load' });
  };
}
// Vidéo qui reçoit les commandes : lecture si elle doit jouer (muette dans le fil)
function _navSetVideo(v, play, muted) {
  if (_navVid && _navVid !== v) { _navVid._wantPlay = false; try { _navVid.pause(); } catch (_) {} }
  _navVid = v;
  if (!v) return;
  _navBindVideo(v);
  v.loop = _screenVidEndMode === 'loop';
  v.muted = !!muted;
  if (v.readyState >= 1) { sendMsg({ type: 'media-meta', dur: v.duration }); sendScreenState(v); }
  if (play) {
    if (muted) { v._wantPlay = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    else playScreenVid(v); // avec le son si l'autoplay le permet
  }
}
// Aspect naturel d'une vidéo (connu aux métadonnées) mémorisé pour le fil
function _navNoteAspect(v) {
  const it = v.closest && v.closest('.mn-item');
  if (!it || !v.videoWidth || !v.videoHeight) return;
  const c = _mediaCache.get(it.dataset.id);
  if (c && !c.ar) { c.ar = v.videoWidth / v.videoHeight; _navApplyAspect(it.dataset.id); }
}
function _navApplyAspect(id) {
  const c = _mediaCache.get(id);
  if (!c || !c.ar || !_nav.scroller || _nav.skin !== 'social') return;
  const it = _nav.scroller.querySelector('.mn-item[data-id="' + id + '"] .mn-media');
  if (it) it.style.aspectRatio = String(c.ar);
}

// ══════════════════════════ Glisser : carrousel ══════════════════════════
function _navBuildSwipe() {
  const layer = _navLayer();
  const track = document.createElement('div');
  track.className = 'mn-track';
  layer.appendChild(track);
  _nav.track = track;
  _navFillSlides();
  if (!layer._navBound) {
    layer._navBound = true;
    layer.addEventListener('pointerdown', _navDown);
    layer.addEventListener('pointermove', _navMove);
    layer.addEventListener('pointerup', (e) => _navUp(e, false));
    layer.addEventListener('pointercancel', (e) => _navUp(e, true)); // geste annulé par le système : retour au média courant
    // Clic qui suit un glissé : ni avance ni réveil des commandes (les autres calques ne le voient pas)
    layer.addEventListener('click', (e) => { if (Date.now() < _nav.clickBlockUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
    layer.addEventListener('wheel', () => {}, { passive: true });
  }
  _navSettleVideo();
}
// Piste : précédent, courant, suivant (un seul si le pool n'a qu'un média)
function _navFillSlides() {
  const track = _nav.track, n = _nav.ids.length;
  track.style.transition = 'none'; track.style.transform = 'translate3d(0,0,0)';
  track.textContent = '';
  _nav.slides = [];
  for (const o of (n > 1 ? [-1, 0, 1] : [0])) _navAddSlide(o);
}
function _navAddSlide(o) {
  const n = _nav.ids.length;
  const id = _nav.ids[(((_nav.idx + o) % n) + n) % n];
  const el = document.createElement('div');
  el.className = 'mn-slide'; el.dataset.id = id;
  _navPlaceSlide(el, o);
  el.appendChild(_navMediaEl(id, o === 0));
  _nav.track.appendChild(el);
  _nav.slides.push({ el, id, o });
}
function _navPlaceSlide(el, o) { el.style.left = 'calc(' + (o * 100) + '% + ' + (o * NAV_GAP_PX) + 'px)'; }
// La vidéo du média courant joue (avec le son si possible) ; les voisines restent immobiles
function _navSettleVideo() {
  const cur = _nav.slides.find((s) => s.o === 0);
  const v = cur && cur.el.querySelector('video');
  if (v) _navSetVideo(v, true, false); else { if (_navVid) { _navVid._wantPlay = false; try { _navVid.pause(); } catch (_) {} } _navVid = null; }
}

function _navDown(e) {
  if (_nav.mode !== 'swipe' || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (_nav.anim) _nav.anim.finish();           // geste repris pendant l'accrochage : on termine d'abord
  if (_nav.ids.length < 2) return;
  _nav.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, moved: false, s: [{ x: e.clientX, t: e.timeStamp }] };
  _nav.track.style.transition = 'none';
  try { _navLayer().setPointerCapture(e.pointerId); } catch (_) {}
}
function _navMove(e) {
  const d = _nav.drag;
  if (!d || e.pointerId !== d.id) return;
  d.dx = e.clientX - d.x0;
  if (Math.abs(d.dx) > 6 || Math.abs(e.clientY - d.y0) > 6) d.moved = true;
  d.s.push({ x: e.clientX, t: e.timeStamp });
  while (d.s.length > 2 && e.timeStamp - d.s[0].t > 100) d.s.shift();
  _nav.track.style.transform = 'translate3d(' + d.dx + 'px,0,0)'; // le média suit le doigt : transform seulement
}
function _navUp(e, cancelled) {
  const d = _nav.drag;
  if (!d || e.pointerId !== d.id) return;
  _nav.drag = null;
  try { _navLayer().releasePointerCapture(e.pointerId); } catch (_) {}
  if (d.moved) _nav.clickBlockUntil = Date.now() + 350;
  const W = _navW();
  const first = d.s[0], last = d.s[d.s.length - 1];
  const v = (last.x - first.x) / Math.max(40, last.t - first.t); // px/ms, plancher de 40 ms (événements groupés)
  let dir = 0;
  if (!cancelled) {
    if (Math.abs(d.dx) > W * NAV_SNAP_FRAC || (Math.abs(d.dx) >= NAV_FLICK_MIN && Math.abs(v) > NAV_FLICK_VEL && Math.sign(v) === Math.sign(d.dx))) dir = d.dx < 0 ? 1 : -1;
  }
  if (!dir && !d.dx) return;
  _navAnimate(dir, true);
}
// Accroche la piste : dir = +1 média suivant, −1 précédent, 0 retour au média courant
function _navAnimate(dir, byUser) {
  const track = _nav.track;
  if (!track) return;
  if (_nav.anim) _nav.anim.finish();
  const target = -dir * (_navW() + NAV_GAP_PX);
  let done = false, timer = 0;
  const finish = () => {
    if (done) return;
    done = true; clearTimeout(timer); track.removeEventListener('transitionend', onEnd);
    _nav.anim = null;
    if (!_nav.on || _nav.track !== track) return;
    if (dir) _navShift(dir, byUser); else { track.style.transition = 'none'; track.style.transform = 'translate3d(0,0,0)'; }
  };
  const onEnd = (e) => { if (e.target === track) finish(); };
  _nav.anim = { finish, cancel: () => { done = true; clearTimeout(timer); track.removeEventListener('transitionend', onEnd); _nav.anim = null; } };
  track.addEventListener('transitionend', onEnd);
  timer = setTimeout(finish, NAV_ANIM_MS + 120);
  track.style.transition = 'transform ' + NAV_ANIM_MS + 'ms cubic-bezier(.2,.8,.2,1)';
  track.style.transform = 'translate3d(' + target + 'px,0,0)';
}
// Fin d'accrochage : la piste est recentrée sur le nouveau média (éléments réutilisés, pas de scintillement)
function _navShift(dir, byUser) {
  const n = _nav.ids.length;
  _nav.idx = (((_nav.idx + dir) % n) + n) % n;
  const keep = [], drop = [];
  for (const s of _nav.slides) { s.o -= dir; (Math.abs(s.o) > 1 ? drop : keep).push(s); }
  for (const s of drop) { const v = s.el.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); } s.el.remove(); }
  _nav.slides = keep;
  for (const s of keep) _navPlaceSlide(s.el, s.o);
  _nav.track.style.transition = 'none'; _nav.track.style.transform = 'translate3d(0,0,0)';
  if (n > 1) for (const o of [-1, 0, 1]) if (!_nav.slides.some((s) => s.o === o)) _navAddSlide(o);
  const curId = _nav.ids[_nav.idx];
  _screenActiveId = curId;
  _navSettleVideo();
  if (byUser) _navSendView(true);
}
// Aller à un média : voisin = glissement animé, sinon saut direct
function _navGoSwipe(id) {
  const n = _nav.ids.length, i = _nav.ids.indexOf(id);
  if (i < 0 || i === _nav.idx) return;
  if (_nav.anim) _nav.anim.finish();
  const d = (((i - _nav.idx) % n) + n) % n;
  if (d === 1) _navAnimate(1, false);
  else if (d === n - 1) _navAnimate(-1, false);
  else {
    _nav.idx = i; _navFillSlides(); _navSettleVideo();
  }
  _screenActiveId = id;
}

// ══════════════════════════ Défiler : fil vertical ══════════════════════════
function _navBuildScroll() {
  const layer = _navLayer();
  const social = _nav.skin === 'social';
  const sc = document.createElement('div');
  sc.className = social ? 'mn-scroller' : 'mn-scroller mn-pages'; // sans habillage : un média par écran, calé comme Glisser
  const feed = document.createElement('div');
  feed.className = 'mn-feed';
  _nav.ids.forEach((id, i) => feed.appendChild(_navItemEl(id, i, social)));
  sc.appendChild(feed);
  layer.appendChild(sc);
  if (social) {
    const top = document.createElement('div');
    top.className = 'mn-top'; top.textContent = _NAV_TXT.social.title;
    layer.appendChild(top);
  }
  _nav.scroller = sc;
  // L'acteur a pris la main : plus de recalage automatique (mesures tardives)
  const touch = () => { _nav.touched = true; };
  sc.addEventListener('pointerdown', touch, { passive: true });
  sc.addEventListener('wheel', touch, { passive: true });
  sc.addEventListener('touchstart', touch, { passive: true });
  sc.addEventListener('scrollend', () => _navProgDone());
  // Visibilité : dominant, visibles, lecture des vidéos (plus de 50 %), rapport à la télécommande
  const top = social ? NAV_SOCIAL_TOP : 0;
  _nav.io = new IntersectionObserver(_navOnVisibility, { root: sc, rootMargin: '-' + top + 'px 0px 0px 0px', threshold: [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1] });
  // Décodage paresseux : un écran de marge autour de la zone visible
  _nav.ioLazy = new IntersectionObserver(_navOnNear, { root: sc, rootMargin: '100% 0px 100% 0px', threshold: [0] });
  for (const m of feed.querySelectorAll('.mn-media')) { _nav.io.observe(m); _nav.ioLazy.observe(m); }
  _navGoScroll(_nav.ids[_nav.idx], false);
  _navMeasureAll();
}
function _navItemEl(id, i, social) {
  const it = document.createElement('div');
  it.className = 'mn-item'; it.dataset.id = id;
  const c = _mediaCache.get(id);
  const ar = c && c.ar ? c.ar : 0;
  const pages = !social; // sans habillage, le cadre fait tout l'écran : pas d'aspect imposé
  if (social) it.insertAdjacentHTML('beforeend', _navSocialHead(i));
  const wrap = document.createElement('div');
  wrap.className = 'mn-media';
  if (ar && !pages) wrap.style.aspectRatio = String(ar);
  it.appendChild(wrap);
  if (social) it.insertAdjacentHTML('beforeend', _navSocialFoot(i));
  return it;
}
// Contenu (image décodée à l'approche, vidéo muette) : seulement près de la zone visible
function _navFillMedia(it, id) {
  const wrap = it.querySelector('.mn-media');
  if (!wrap) return;
  wrap.textContent = '';
  const c = _mediaCache.get(id);
  if (!c || c.kind === 'audio' || (!c.data && !c.url)) { wrap.appendChild(_navMediaEl(id, false)); return; }
  const near = wrap._near === true;
  if (!near) return;
  const el = _navMediaEl(id, false);
  if (el.tagName === 'VIDEO') { el.muted = true; _navBindVideo(el); }
  wrap.appendChild(el);
}
function _navOnNear(entries) {
  setTimeout(_navUpdatePlayback, 0); // une vidéo qui vient d'être posée dans le cadre dominant démarre aussitôt
  for (const en of entries) {
    const wrap = en.target, it = wrap.closest('.mn-item');
    wrap._near = en.isIntersecting;
    if (en.isIntersecting) { if (!wrap.firstChild || wrap.firstChild.className === 'mn-ph') _navFillMedia(it, it.dataset.id); }
    else if (wrap.firstChild && wrap.firstChild.className !== 'mn-ph') {
      const v = wrap.firstChild.tagName === 'VIDEO' ? wrap.firstChild : null;
      if (v) { if (v === _navVid) continue; v.pause(); v.removeAttribute('src'); }
      wrap.textContent = ''; // image lointaine : cadre vide de la bonne hauteur
    }
  }
}
function _navOnVisibility(entries) {
  for (const en of entries) {
    const id = en.target.closest('.mn-item').dataset.id;
    if (en.isIntersecting && en.intersectionRect.height > 0) _nav.vis.set(id, { h: en.intersectionRect.height, r: en.intersectionRatio });
    else _nav.vis.delete(id);
  }
  _navPickDominant();
  _navUpdatePlayback();
  _navScheduleReport();
}
// Dominant : le premier média entièrement visible en partant du haut, sinon celui qui couvre le plus de hauteur
function _navPickDominant() {
  if (_nav.prog) return; // défilement commandé : le média visé est déjà noté
  let best = null, bh = 0;
  for (const id of _nav.ids) {
    const v = _nav.vis.get(id);
    if (!v) continue;
    if (v.r >= 0.98) { best = id; break; }
    if (v.h > bh + 0.5) { best = id; bh = v.h; }
  }
  if (best) { _nav.dom = best; _screenActiveId = best; }
}
// Une seule vidéo joue, avec le son, quand elle est dominante et occupe plus de 50 % de l'écran
// (une vidéo plus petite que la moitié de l'écran : plus de 50 % d'elle-même) ; les autres sont en pause et muettes
function _navUpdatePlayback() {
  const sc = _nav.scroller;
  if (!sc) return;
  const H = _navH();
  let dominantVid = null;
  for (const v of sc.querySelectorAll('video')) {
    const id = v.closest('.mn-item').dataset.id, vis = _nav.vis.get(id);
    const want = id === _nav.dom && !!vis && (vis.h > NAV_PLAY_RATIO * H || vis.r > NAV_PLAY_RATIO);
    if (want) {
      dominantVid = v;
      if (v.paused || (v.muted && !v._autoMuted)) { v.muted = false; v._autoMuted = false; playScreenVid(v); } // repli muet si l'autoplay est bloqué
    } else {
      v._wantPlay = false; v._autoMuted = false; v.muted = true;
      if (!v.paused) { try { v.pause(); } catch (_) {} }
    }
  }
  const dom = _nav.dom && sc.querySelector('.mn-item[data-id="' + _nav.dom + '"] video');
  if (dom && dom !== _navVid) _navSetVideo(dom, false, dom.muted);
  else if (!dom && _navVid) _navVid = null;
  return dominantVid;
}
// Mesure l'aspect naturel des images pas encore connues (une fois, dans le cache) : la mise en page ne saute plus
function _navMeasureAll() {
  if (_nav.measuring) return;
  const todo = _nav.ids.filter((id) => { const c = _mediaCache.get(id); return c && c.kind === 'img' && c.data && !c.ar; });
  if (!todo.length) return;
  _nav.measuring = true;
  const next = () => {
    const id = todo.shift();
    if (!id || !_nav.on) { _nav.measuring = false; return; }
    const c = _mediaCache.get(id);
    const im = new Image();
    const step = () => { if (c && !c.ar && im.naturalWidth && im.naturalHeight) { c.ar = im.naturalWidth / im.naturalHeight; _navApplyAspect(id); } setTimeout(next, 0); };
    im.onload = step; im.onerror = () => setTimeout(next, 0);
    im.src = c.data;
  };
  next();
}
// Va à un média du fil : en haut de la zone visible (sous le titre du fil social)
function _navGoScroll(id, smooth) {
  const sc = _nav.scroller;
  if (!sc) return;
  const it = sc.querySelector('.mn-item[data-id="' + id + '"]');
  if (!it) return;
  const top = Math.max(0, it.offsetTop - (_nav.skin === 'social' ? NAV_SOCIAL_TOP : 0));
  _screenActiveId = id;
  if (!smooth || Math.abs(sc.scrollTop - top) < 1) { sc.scrollTop = top; if (!smooth) _nav.dom = id; return; }
  _nav.prog = true;                                  // aucun rapport pendant le défilement commandé
  if (_nav.progTimer) clearTimeout(_nav.progTimer);
  _nav.progTimer = setTimeout(_navProgDone, 900);    // repli si « scrollend » n'existe pas
  sc.scrollTo({ top, behavior: 'smooth' });
}
function _navProgDone() {
  if (!_nav.prog) return;
  _nav.prog = false;
  if (_nav.progTimer) { clearTimeout(_nav.progTimer); _nav.progTimer = 0; }
  _navPickDominant(); _navUpdatePlayback(); _navScheduleReport();
}
// Après un recalage tardif (aspects mesurés) : le média courant reste en haut tant que l'acteur n'a rien touché
function _navRealign() {
  if (_nav.mode === 'scroll' && !_nav.touched && _nav.dom) _navGoScroll(_nav.dom, false);
}

// ── Habillage « fil social » : statique, sans filtre ni ombre (appareils modestes) ──
const _NAV_HEART = 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5'; // Lucide « heart » (ISC)
const _navEsc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function _navSocialHead(i) {
  const S = _NAV_TXT.social, k = i % S.names.length;
  return '<div class="mn-ph-head"><span class="mn-av"><i>' + _navEsc(S.names[k].charAt(0).toUpperCase()) + '</i></span>'
    + '<span class="mn-name">' + _navEsc(S.names[k]) + '<small>' + _navEsc(S.ago[k]) + '</small></span><span class="mn-dots">•••</span></div>';
}
function _navSocialFoot(i) {
  const S = _NAV_TXT.social, k = i % S.names.length;
  // Cœur « aimé » : tracé en ligne (le remplissage ne traverse pas le <symbol> du sprite)
  const heart = k % 3 === 0 ? '<svg class="mn-ic liked" viewBox="0 0 24 24" aria-hidden="true"><path d="' + _NAV_HEART + '"/></svg>' : icon('heart', 'mn-ic');
  return '<div class="mn-ph-acts">' + heart + icon('message-circle', 'mn-ic') + icon('send', 'mn-ic')
    + '<span class="mn-sp"></span>' + icon('bookmark', 'mn-ic') + '</div>'
    + '<div class="mn-ph-txt"><b>' + _navEsc(S.likesN[k].toLocaleString('fr-FR') + ' ' + S.likes) + '</b><br><b>' + _navEsc(S.names[k]) + '</b> ' + _navEsc(S.caps[k]) + '</div>';
}

// ── Rapport à la télécommande : média dominant et visibles, 4 messages par seconde au plus ──
function _navScheduleReport() {
  if (_nav.mode !== 'scroll' || _nav.prog || _nav.timer) return;
  _nav.timer = setTimeout(() => { _nav.timer = 0; _navSendView(false); }, NAV_REPORT_MS);
}
function _navVisibleIds() {
  const H = _navH();
  const ids = _nav.ids.filter((id) => { const v = _nav.vis.get(id); return v && (v.h >= 0.12 * H || v.r >= 0.4); });
  if (_nav.dom && !ids.includes(_nav.dom)) ids.push(_nav.dom);
  return ids.slice(0, NAV_VIS_MAX);
}
function _navSendView(force) {
  if (!_nav.on) return;
  const id = _nav.mode === 'swipe' ? _nav.ids[_nav.idx] : _nav.dom;
  if (!id) return;
  const msg = { type: 'media:view', id, idx: Math.max(0, _nav.ids.indexOf(id)), n: _nav.ids.length };
  if (_nav.mode === 'scroll') msg.vis = _navVisibleIds();
  const sig = JSON.stringify(msg);
  if (!force && sig === _nav.lastSig) return;
  _nav.lastSig = sig;
  sendMsg(msg);
}
