// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ TÉLÉPHONE AU DÉPART · BARRE D'ÉTAT (télécommande) ══════════════════════════
// Maquette validée 28b : réglages de la barre d'état du faux téléphone, avec
// leur aperçu en direct (97-phone-status.js) :
//   • Date et heure : « L'heure avance » (depuis la date et l'heure réglées,
//     au premier GO), « Figée », « Heure réelle » (celle de l'écran) ;
//   • Réseau : Pas de service / 1 à 4 barres, 3G / 4G / 5G, Mode avion ; Wi-Fi ;
//   • Batterie : niveau, en charge, pourcentage affiché.
// Deux usages, même éditeur :
//   • Séquence (« Téléphone au départ », ligne sous le nom de la séquence) :
//     réglages enregistrés avec la séquence (91-sequence.js, 96-sequences-saved.js),
//     pris au premier GO ; modifiés pendant un déroulé, ils valent au prochain
//     départ (« Recommencer »).
//   • Onglet Média (« Barre d'état du téléphone ») : bandeau haut au-dessus des
//     médias affichés seuls, hors séquence. Interrupteur par écran (la cible
//     de la télécommande, comme les autres ordres média), réglages et écrans
//     gardés sur la télécommande pour la session appairée (localStorage),
//     renvoyés à la resynchronisation (media:bar). Pendant une séquence, la
//     barre de la séquence prime sur ses écrans ; après « Recommencer », celle
//     de l'onglet Média revient.
// Les changements s'appliquent aussitôt (pas de bouton « Enregistrer » sur la maquette).
// Textes affichés, regroupés pour la traduction ({…} : valeurs)
const _PP_TXT = {
  titleSeq: 'Téléphone au départ', titleMedia: 'Barre d\'état du téléphone',
  backSeq: '← Séquence', backMedia: '← Média',
  preview: 'Aperçu de la barre d\'état du téléphone de jeu',
  labelClock: 'Date et heure', run: 'L\'heure avance', frozen: 'Figée', real: 'Heure réelle',
  dateAria: 'Date du téléphone', timeAria: 'Heure du téléphone',
  labelNet: 'Réseau', noService: 'Pas de service', plane: 'Mode avion', wifi: 'Wi-Fi', yes: 'Oui', no: 'Non',
  barsAria: '{n} barre(s) sur 4',
  labelBat: 'Batterie', charging: 'En charge', pct: 'Afficher le %', level: '{n} %', levelAria: 'Niveau de batterie',
  noteSeq: 'Affiché partout pendant la séquence : écran verrouillé, déverrouillé, SMS, discussion, appels, et en bandeau haut au-dessus des médias. Les étapes « Batterie faible », « Réseau » et « Extinction » le font évoluer.',
  noteMedia: 'Bandeau haut au-dessus des médias affichés seuls, hors séquence, sur les écrans où la barre est activée (onglet Média). Pendant une séquence, son « Téléphone au départ » prime sur ses écrans.',
  sumReal: 'Heure réelle', sumFrozen: '{heure} figée', sumPlane: 'Mode avion', sumNoService: 'Pas de service',
  mediaEdit: 'Régler ›',
};
const _ppTpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));

// Résumé d'une ligne : « 23:47 · 4G · 18 % »
function phoneParamsSummary(cfg) {
  const c = cfg.clock, n = cfg.net;
  const time = c.mode === 'real' || !c.time ? _PP_TXT.sumReal : c.mode === 'frozen' ? _ppTpl(_PP_TXT.sumFrozen, { heure: c.time }) : c.time;
  const net = n.plane ? _PP_TXT.sumPlane : n.bars === 0 ? _PP_TXT.sumNoService : n.type;
  return time + ' · ' + net + ' · ' + cfg.bat.level + ' %';
}

// ── Éditeur (vue plein écran, comme l'éditeur d'étape) ──
let _pp = null; // { ctx: 'seq' | 'media', cfg (brouillon appliqué à chaque changement) }
function openPhoneParams(ctx) {
  const media = ctx === 'media';
  if (!media && licLocked('seq')) return; // aperçu sans licence (77-licence-ui.js)
  _pp = { ctx: media ? 'media' : 'seq', cfg: JSON.parse(JSON.stringify(media ? _mbarState().cfg : seqPhoneCfg())) };
  const v = document.getElementById('phone-params-view');
  if (v) { v.style.display = 'flex'; v.scrollTop = 0; }
  renderPhoneParams();
}
function closePhoneParams() {
  _pp = null;
  const v = document.getElementById('phone-params-view');
  if (v) v.style.display = 'none';
}
function _ppCommit() {
  const e = _pp;
  if (!e) return;
  e.cfg = phoneBarSanitize(e.cfg);
  if (e.ctx === 'media') mediaBarSetCfg(e.cfg);
  else {
    _seq.phone = JSON.parse(JSON.stringify(e.cfg));
    if (!seqSave()) alert(_SEQ_TXT.storeFull);
    renderSeq();
  }
  renderPhoneParams();
}
const _ppOpt = (on, fn, label, extra) => '<button type="button" class="ss-opt' + (on ? ' on' : '') + '" onclick="' + fn + '"' + (extra || '') + '>' + label + '</button>';
// Barres de réseau dessinées (même dessin que la barre d'état)
const _ppBarsIcon = (n) => '<span class="pb-sig pp-sig" aria-hidden="true">' + [1, 2, 3, 4].map((i) => '<i class="' + (i <= n ? 'on' : '') + '"></i>').join('') + '</span>';
function renderPhoneParams() {
  const e = _pp;
  if (!e) return;
  const cfg = e.cfg, c = cfg.clock, n = cfg.net, b = cfg.bat;
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  set('ppTitle', e.ctx === 'media' ? _PP_TXT.titleMedia : _PP_TXT.titleSeq);
  set('ppBack', e.ctx === 'media' ? _PP_TXT.backMedia : _PP_TXT.backSeq);
  set('ppCap', _PP_TXT.preview);
  set('ppNote', e.ctx === 'media' ? _PP_TXT.noteMedia : _PP_TXT.noteSeq);
  // Aperçu : l'heure réglée (ou l'heure réelle)
  const pv = document.getElementById('ppPreview');
  if (pv) {
    const now = Date.now();
    const msg = phoneBarMsg(cfg, now, now);
    phoneBarRender(pv, msg, phoneBarClockAt(msg, now, now));
  }
  // Date et heure
  const real = c.mode === 'real';
  const shown = real || !c.date || !c.time ? phoneBarToday() : c;
  const ymd = shown.date.split('-');
  const dateTxt = notifShortDate(shown.date) + ' ' + ymd[0];
  const box = (cls, txt, type, val, fn, aria) => '<label class="pp-dt ' + cls + (real ? ' off' : '') + '"><span>' + escapeHtml(txt) + '</span>'
    + '<input type="' + type + '" value="' + escapeHtml(val) + '" aria-label="' + escapeHtml(aria) + '"' + (real ? ' disabled' : '') + ' onchange="' + fn + '(this.value)"></label>';
  document.getElementById('ppClock').innerHTML = '<span class="ss-label">' + escapeHtml(_PP_TXT.labelClock) + '</span>'
    + '<div class="pp-dt-row">' + box('pp-date', dateTxt, 'date', shown.date, 'ppSetDate', _PP_TXT.dateAria) + box('pp-time', shown.time, 'time', shown.time, 'ppSetTime', _PP_TXT.timeAria) + '</div>'
    + '<div class="ss-row">' + _ppOpt(c.mode === 'run', 'ppSetClock(\'run\')', escapeHtml(_PP_TXT.run)) + _ppOpt(c.mode === 'frozen', 'ppSetClock(\'frozen\')', escapeHtml(_PP_TXT.frozen))
    + _ppOpt(real, 'ppSetClock(\'real\')', escapeHtml(_PP_TXT.real)) + '</div>';
  // Réseau
  document.getElementById('ppNet').innerHTML = '<span class="ss-label">' + escapeHtml(_PP_TXT.labelNet) + '</span>'
    + '<div class="ss-row pp-bars">' + _ppOpt(n.bars === 0, 'ppSetBars(0)', escapeHtml(_PP_TXT.noService))
    + [1, 2, 3, 4].map((k) => _ppOpt(n.bars === k, 'ppSetBars(' + k + ')', _ppBarsIcon(k), ' aria-label="' + escapeHtml(_ppTpl(_PP_TXT.barsAria, { n: k })) + '"')).join('') + '</div>'
    + '<div class="ss-row">' + PB_NET_TYPES.map((t) => _ppOpt(n.type === t, 'ppSetType(\'' + t + '\')', t)).join('') + _ppOpt(n.plane, 'ppTogglePlane()', escapeHtml(_PP_TXT.plane)) + '</div>'
    + '<div class="pp-wifi"><span>' + escapeHtml(_PP_TXT.wifi) + '</span>' + _ppOpt(n.wifi, 'ppSetWifi(true)', escapeHtml(_PP_TXT.yes)) + _ppOpt(!n.wifi, 'ppSetWifi(false)', escapeHtml(_PP_TXT.no)) + '</div>';
  // Batterie
  document.getElementById('ppBat').innerHTML = '<span class="ss-label">' + escapeHtml(_PP_TXT.labelBat) + '</span>'
    + '<div class="pp-level"><input type="range" id="ppLevel" min="1" max="100" step="1" value="' + b.level + '" aria-label="' + escapeHtml(_PP_TXT.levelAria) + '" style="--v:' + b.level + '%" oninput="ppSetLevel(this.value)">'
    + '<b id="ppLevelVal">' + escapeHtml(_ppTpl(_PP_TXT.level, { n: b.level })) + '</b></div>'
    + '<div class="ss-row">' + _ppOpt(b.charging, 'ppToggleBat(\'charging\')', escapeHtml(_PP_TXT.charging)) + _ppOpt(b.pct, 'ppToggleBat(\'pct\')', escapeHtml(_PP_TXT.pct)) + '</div>';
}
function ppSetClock(m) {
  const e = _pp;
  if (!e || !['run', 'frozen', 'real'].includes(m)) return;
  const c = e.cfg.clock;
  if (m !== 'real' && (!c.date || !c.time)) Object.assign(c, phoneBarToday()); // préremplies : maintenant
  c.mode = m;
  _ppCommit();
}
function ppSetDate(v) { if (_pp && typeof v === 'string' && SRP.DATE_RE.test(v)) { _pp.cfg.clock.date = v; if (!_pp.cfg.clock.time) _pp.cfg.clock.time = phoneBarToday().time; _ppCommit(); } }
function ppSetTime(v) { if (_pp && typeof v === 'string' && SRP.TIME_RE.test(v.slice(0, 5))) { _pp.cfg.clock.time = v.slice(0, 5); if (!_pp.cfg.clock.date) _pp.cfg.clock.date = phoneBarToday().date; _ppCommit(); } }
function ppSetBars(k) { if (_pp && [0, 1, 2, 3, 4].includes(k)) { _pp.cfg.net.bars = k; _ppCommit(); } }
function ppSetType(t) { if (_pp && PB_NET_TYPES.includes(t)) { _pp.cfg.net.type = t; _pp.cfg.net.plane = false; _ppCommit(); } }
function ppTogglePlane() { if (_pp) { _pp.cfg.net.plane = !_pp.cfg.net.plane; _ppCommit(); } }
function ppSetWifi(on) { if (_pp) { _pp.cfg.net.wifi = !!on; _ppCommit(); } }
function ppToggleBat(k) { if (_pp && (k === 'charging' || k === 'pct')) { _pp.cfg.bat[k] = !_pp.cfg.bat[k]; _ppCommit(); } }
// Curseur : aperçu et valeur suivis en direct, sans redessiner le curseur en cours de glisser
let _ppLevelTimer = null;
function ppSetLevel(v) {
  const e = _pp, n = Math.round(Number(v));
  if (!e || !Number.isFinite(n)) return;
  e.cfg.bat.level = Math.min(100, Math.max(1, n));
  const r = document.getElementById('ppLevel');
  if (r) r.style.setProperty('--v', e.cfg.bat.level + '%');
  const val = document.getElementById('ppLevelVal');
  if (val) val.textContent = _ppTpl(_PP_TXT.level, { n: e.cfg.bat.level });
  const pv = document.getElementById('ppPreview');
  if (pv) { const now = Date.now(), msg = phoneBarMsg(e.cfg, now, now); phoneBarRender(pv, msg, phoneBarClockAt(msg, now, now)); }
  if (_ppLevelTimer) clearTimeout(_ppLevelTimer);
  _ppLevelTimer = setTimeout(() => { _ppLevelTimer = null; if (_pp === e) _ppCommit(); }, 250);
}

// ── Onglet Média : barre d'état au-dessus des médias, hors séquence ──
const MBAR_LS_KEY = 'setremote-mediabar-v1';
let _mbar = null; // { s (session), cfg, t0 (départ de l'horloge « run »), screens (écrans où elle est activée) }
function _mbarState() {
  const sid = typeof _session !== 'undefined' && _session ? _session.channelId : '';
  if (_mbar && _mbar.s === sid) return _mbar;
  let o = null;
  try { o = JSON.parse(_lsGet(MBAR_LS_KEY)); } catch (_) { o = null; }
  _mbar = { s: sid, cfg: phoneBarDefaults(), t0: Date.now(), screens: [] };
  if (o && typeof o === 'object' && o.s === sid) {
    _mbar.cfg = phoneBarSanitize(o.cfg);
    if (Number.isFinite(o.t0) && o.t0 > 0) _mbar.t0 = o.t0;
    _mbar.screens = Array.isArray(o.screens) ? [...new Set(o.screens.filter((x) => typeof x === 'string' && SRP.SCREEN_ID_RE.test(x)))].slice(0, 64) : [];
  }
  return _mbar;
}
function _mbarSave() {
  const st = _mbarState();
  _lsSet(MBAR_LS_KEY, JSON.stringify({ v: 1, s: st.s, cfg: st.cfg, t0: st.t0, screens: st.screens }));
}
function _mbarSend(ids) {
  if (!ids.length) return;
  const st = _mbarState();
  sendMsg({ type: 'media:bar', bar: phoneBarMsg(st.cfg, st.t0), target: { screens: ids.slice() } });
}
// Activée sur toute la cible courante ?
function mediaBarIsOn(ids) { const st = _mbarState(); return ids.length > 0 && ids.every((id) => st.screens.includes(id)); }
function setMediaBar(on) {
  const st = _mbarState(), ids = scrTargetIds();
  if (ids.length) {
    if (on) {
      if (!st.screens.length) st.t0 = Date.now(); // l'heure repart de l'heure réglée
      for (const id of ids) if (!st.screens.includes(id)) st.screens.push(id);
      _mbarSend(ids);
    } else {
      st.screens = st.screens.filter((id) => !ids.includes(id));
      sendMsg({ type: 'media:bar', bar: null, target: { screens: ids.slice() } });
    }
    _mbarSave();
  }
  renderMediaBarRow();
}
function mediaBarSetCfg(cfg) {
  const st = _mbarState();
  st.cfg = phoneBarSanitize(cfg);
  st.t0 = Date.now();
  _mbarSave();
  _mbarSend(st.screens.filter((id) => scrKnown(id)));
  renderMediaBarRow();
}
// Resynchronisation (24-resync.js) : écrans revenus où la barre est activée
function mediaBarOnScreensResync(ids) {
  const st = _mbarState();
  _mbarSend(ids.filter((id) => st.screens.includes(id)));
}
function renderMediaBarRow() {
  if (typeof mode !== 'undefined' && mode !== 'remote') return;
  const st = _mbarState();
  const t = document.getElementById('mediaBarToggle');
  if (t) t.checked = mediaBarIsOn(scrTargetIds());
  const sum = document.getElementById('mediaBarSum');
  if (sum) sum.textContent = phoneParamsSummary(st.cfg);
  const ed = document.getElementById('mediaBarEditLbl');
  if (ed) ed.textContent = _PP_TXT.mediaEdit;
}
