// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ BARRE D'ÉTAT DU FAUX TÉLÉPHONE ══════════════════════════
// Maquette validée 28b (« Téléphone au départ ») : heure, réseau, Wi-Fi,
// batterie. Partagé par la télécommande (aperçu de l'éditeur, 98-phone-params.js)
// et l'écran de jeu (barre affichée).
//   • Réglages (modèle gardé par la télécommande) :
//       clock { mode: 'run' (l'heure avance depuis date/heure) | 'frozen' (figée)
//               | 'real' (heure réelle), date AAAA-MM-JJ, time HH:MM }
//       net { bars 0..4 (0 : « Pas de service »), type 3G/4G/5G, plane, wifi }
//       bat { level 1..100, charging, pct (pourcentage affiché) }
//   • Sur le réseau (phone:state.bar, media:bar) : horloge « run » avec el =
//     secondes écoulées depuis le départ au moment de l'envoi ; l'écran ajoute le
//     temps écoulé depuis la réception avec sa propre horloge (aucun écart
//     d'horloge entre appareils ne compte).
//   • Écran : barre de la Séquence (phone:state.bar) partout sur l'écran visé
//     pendant la séquence (écran verrouillé, déverrouillé, appel, bandeaux,
//     discussion, bandeau haut au-dessus des médias) ; sinon barre de l'onglet
//     Média (media:bar), seulement en bandeau au-dessus d'un média affiché seul.
//     La barre de la séquence prime toujours. Rien d'affiché sur une couleur ou
//     un effet seuls, ni sous le noir total (sauf appel), ni téléphone éteint.
//   • Heures relatives (« il y a 2 min ») et horloge de l'écran verrouillé
//     suivent l'horloge de la séquence (94-sequence-phone.js : phoneClockAt).
//   • Trois styles neutres (Verre / Tonal / Épuré), aucune marque.
// Textes affichés regroupés pour la traduction.
const _PB_TXT = {
  noService: 'Pas de service',
  plane: 'Mode avion',
  wifi: 'Wi-Fi',
  battery: 'Batterie {n} %',
  charging: 'en charge',
  label: 'Barre d\'état du téléphone',
};
const PB_NET_TYPES = ['3G', '4G', '5G'];
const PB_LOW_BATTERY = 10; // % : icône rouge (hors charge) ; aussi après une étape « Batterie faible » (bat.low)

const _pbPad = (n) => String(n).padStart(2, '0');
// Valeurs par défaut (séquence ou onglet Média sans réglage) : déclaration de
// fonction, utilisable dès le chargement des autres fragments
function phoneBarDefaults() {
  const net = '4G';
  return { clock: { mode: 'real', date: '', time: '' }, net: { bars: 4, type: net, plane: false, wifi: true }, bat: { level: 80, charging: false, pct: false } };
}
// Réglages relus (stockage) : champs connus, bornés
function phoneBarSanitize(o) {
  const d = phoneBarDefaults();
  if (!o || typeof o !== 'object') return d;
  const c = o.clock && typeof o.clock === 'object' ? o.clock : {}, n = o.net && typeof o.net === 'object' ? o.net : {}, b = o.bat && typeof o.bat === 'object' ? o.bat : {};
  const int = (v, min, max, def) => (Number.isInteger(v) && v >= min && v <= max ? v : def);
  return {
    clock: {
      mode: ['run', 'frozen', 'real'].includes(c.mode) ? c.mode : d.clock.mode,
      date: typeof c.date === 'string' && SRP.DATE_RE.test(c.date) ? c.date : '',
      time: typeof c.time === 'string' && SRP.TIME_RE.test(c.time) ? c.time : '',
    },
    net: { bars: int(n.bars, 0, 4, d.net.bars), type: PB_NET_TYPES.includes(n.type) ? n.type : d.net.type, plane: n.plane === true, wifi: n.wifi === undefined ? d.net.wifi : n.wifi === true },
    bat: { level: int(b.level, 1, 100, d.bat.level), charging: b.charging === true, pct: b.pct === true },
  };
  // (bat.low : posé par une étape « Batterie faible » pendant le déroulé, jamais enregistré)
}
// Date et heure locales d'aujourd'hui (préremplissage quand on quitte « Heure réelle »)
function phoneBarToday(ms) {
  const d = new Date(ms === undefined ? Date.now() : ms);
  return { date: d.getFullYear() + '-' + _pbPad(d.getMonth() + 1) + '-' + _pbPad(d.getDate()), time: _pbPad(d.getHours()) + ':' + _pbPad(d.getMinutes()) };
}
// Réglages → message (phone:state.bar, media:bar). t0 : départ de l'horloge « run » (ms, horloge locale)
function phoneBarMsg(cfg, t0, now) {
  const c = cfg.clock;
  let clock = { mode: 'real' };
  if (c.mode !== 'real') {
    const td = c.date && c.time ? c : Object.assign({}, c, phoneBarToday(t0));
    clock = { mode: c.mode, date: td.date, time: td.time };
    if (c.mode === 'run') clock.el = Math.max(0, Math.min(SRP.LIMITS.phoneClockSeconds, Math.floor(((now === undefined ? Date.now() : now) - (t0 || 0)) / 1000)));
  }
  const bat = { level: cfg.bat.level, charging: !!cfg.bat.charging, pct: !!cfg.bat.pct };
  if (cfg.bat.low === true) bat.low = true;
  return { clock, net: { bars: cfg.net.bars, type: cfg.net.type, plane: !!cfg.net.plane, wifi: !!cfg.net.wifi }, bat };
}
// Téléphone sans réseau (ni mobile ni Wi-Fi) : appels impossibles, messages non distribués
function phoneBarNoNetwork(bar) { return !!bar && (bar.net.plane || bar.net.bars === 0) && !bar.net.wifi; }

// Heure du téléphone (ms) à l'instant local `ms`, d'après une barre reçue à `recvAt`
function phoneBarClockAt(bar, recvAt, ms) {
  const c = bar && bar.clock;
  if (!c || c.mode === 'real') return ms;
  const [y, mo, d] = c.date.split('-').map(Number), [h, mi] = c.time.split(':').map(Number);
  const base = new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
  if (c.mode === 'frozen') return base;
  return base + (c.el || 0) * 1000 + (ms - recvAt);
}

// ── Rendu (télécommande : aperçu ; écran : barre) ──
const _PB_SVG = {
  wifi: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 18.6l2.3-2.6a3.3 3.3 0 0 0-4.6 0z"/><path d="M5.9 12.2l1.5 1.7a6.8 6.8 0 0 1 9.2 0l1.5-1.7a9 9 0 0 0-12.2 0z" opacity=".95"/><path d="M2.5 8.4L4 10.1a11.8 11.8 0 0 1 16 0l1.5-1.7a14 14 0 0 0-19 0z" opacity=".95"/></svg>',
  plane: '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M21 15.5v-1.8l-7.5-4.6V4.2a1.5 1.5 0 0 0-3 0v4.9L3 13.7v1.8l7.5-2.3v4.6l-2 1.5V21l3.5-1 3.5 1v-1.7l-2-1.5v-4.6z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/></svg>',
};
function _pbEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
// Remplit `root` avec la barre : heure à gauche ; réseau, Wi-Fi, pourcentage et batterie à droite
function phoneBarRender(root, bar, timeMs) {
  root.textContent = '';
  const d = new Date(timeMs);
  root.appendChild(_pbEl('span', 'pb-time', _pbPad(d.getHours()) + ':' + _pbPad(d.getMinutes())));
  const right = _pbEl('span', 'pb-right');
  const n = bar.net;
  if (n.plane) {
    const p = _pbEl('span', 'pb-ic pb-plane'); p.innerHTML = _PB_SVG.plane; p.setAttribute('aria-label', _PB_TXT.plane); right.appendChild(p);
  } else if (n.bars === 0) {
    right.appendChild(_pbEl('span', 'pb-nosvc', _PB_TXT.noService));
  } else {
    const sig = _pbEl('span', 'pb-sig');
    sig.setAttribute('aria-label', n.bars + ' / 4');
    for (let i = 1; i <= 4; i++) sig.appendChild(_pbEl('i', i <= n.bars ? 'on' : ''));
    right.append(sig, _pbEl('span', 'pb-net', n.type));
  }
  if (n.wifi) { const w = _pbEl('span', 'pb-ic pb-wifi'); w.innerHTML = _PB_SVG.wifi; w.setAttribute('aria-label', _PB_TXT.wifi); right.appendChild(w); }
  const b = bar.bat;
  if (b.pct) right.appendChild(_pbEl('span', 'pb-pct', b.level + ' %'));
  const bat = _pbEl('span', 'pb-bat' + (b.charging ? ' chg' : b.low || b.level <= PB_LOW_BATTERY ? ' low' : ''));
  bat.setAttribute('aria-label', _PB_TXT.battery.replace('{n}', b.level) + (b.charging ? ' · ' + _PB_TXT.charging : ''));
  const fill = _pbEl('i'); fill.style.width = Math.max(4, b.level) + '%';
  bat.appendChild(fill);
  right.appendChild(bat);
  if (b.charging) { const z = _pbEl('span', 'pb-ic pb-bolt'); z.innerHTML = _PB_SVG.bolt; right.appendChild(z); }
  root.appendChild(right);
}

// ── Écran de jeu : barre affichée ──
// seq : barre de la séquence (phone:state.bar) ; media : barre de l'onglet Média (media:bar).
// Rendue par PhoneUI.statusBar (71-phone-ui.js), la MÊME barre sur toutes les vues du faux
// téléphone (écran verrouillé, accueil, appel, en cours d'appel, bandeaux, discussion, pavé du
// code, alertes) quand la séquence ou l'onglet Média la demande ; jamais forcée ailleurs.
const _sb = { seq: null, seqAt: 0, media: null, mediaAt: 0, timer: null, obs: null };
function screenSeqBar(bar) {
  const was = _sb.seq;
  _sb.seq = bar || null;
  _sb.seqAt = Date.now();
  if (was || bar) _sbRefresh();
}
function screenMediaBar(bar) {
  _sb.media = bar || null;
  _sb.mediaAt = Date.now();
  _sbRefresh();
}
function screenBarsHide() { _sb.seq = null; _sb.media = null; _sbRefresh(); }
// Heure du faux téléphone (séquence) à l'instant local `ms` (heure réelle hors séquence)
function phoneClockAt(ms) { return _sb.seq ? phoneBarClockAt(_sb.seq, _sb.seqAt, ms) : ms; }
function phoneClockNow() { return new Date(phoneClockAt(Date.now())); }
function screenPhoneNoNetwork() { return phoneBarNoNetwork(_sb.seq); }

const _sbShown = (id) => { const e = document.getElementById(id); return !!e && e.style.display !== 'none' && e.style.display !== '' ; };
// Ce qui est visible sous la barre (du haut vers le bas)
function _sbSurfaces() {
  const call = document.getElementById('screen-call');
  const callOn = !!call && call.style.display === 'block';
  const chat = document.getElementById('screen-chat');
  const chatRoot = chat && chat.style.display === 'block' ? chat.querySelector('.pt') : null;
  const phone = document.getElementById('screen-phone');
  const phoneOn = !!phone && phone.style.display === 'block';
  const media = _sbShown('screen-media-img') || _sbShown('screen-media-video');
  const callFull = callOn && !call.classList.contains('notif');
  // Écran verrouillé en vue : l'heure y est déjà en grand, comme sur un vrai téléphone (pas dans la barre)
  const lock = callOn ? !!call.querySelector('.ph-lock') : chatRoot ? false : phoneOn && typeof _scPhone !== 'undefined' && !!_scPhone && _scPhone.mode === 'locked';
  const style = callOn && typeof _callCfg !== 'undefined' && _callCfg ? _callCfg.style
    : chatRoot && typeof _scChat !== 'undefined' && _scChat ? _scChat.style
      : (typeof _scPhone !== 'undefined' && _scPhone && _scPhone.style) || 'glass';
  return { callOn, callFull, chatOn: !!chatRoot, chatLight: !!chatRoot && chatRoot.classList.contains('ph-minimal'), phoneOn, media, lock, style };
}
function _sbRefresh() {
  const el = document.getElementById('screen-sbar');
  const sm = document.getElementById('screen-mode');
  if (!el) return;
  const s = _sbSurfaces();
  const off = typeof _scPhone !== 'undefined' && _scPhone && _scPhone.power === 'off';
  const blackout = typeof screenBlackoutOn !== 'undefined' && screenBlackoutOn;
  let bar = null, at = 0, band = false;
  if (_sb.seq) {
    if ((s.callOn || s.chatOn || s.phoneOn || s.media) && !off && !(blackout && !s.callOn)) {
      bar = _sb.seq; at = _sb.seqAt; band = s.media && !s.callFull && !s.chatOn && !s.phoneOn;
    }
  } else if (_sb.media && s.media && !s.callOn && !s.chatOn && !s.phoneOn && !blackout) {
    bar = _sb.media; at = _sb.mediaAt; band = true;
  }
  if (!bar) {
    el.style.display = 'none'; el.textContent = '';
    if (sm) sm.classList.remove('sb-on');
    if (_sb.timer) { clearInterval(_sb.timer); _sb.timer = null; }
    return;
  }
  el.className = 'ph-' + (band ? 'glass' : s.style);
  el.style.display = 'flex';
  const dark = s.chatLight && !s.callFull && !band;
  el.innerHTML = PhoneUI.statusBar(bar, PhoneUI.hm(new Date(phoneBarClockAt(bar, at, Date.now()))), { band, tone: dark ? 'dark' : 'light', hideTime: s.lock && !band });
  if (sm) sm.classList.add('sb-on');
  if (!_sb.timer) _sb.timer = setInterval(_sbTick, 1000);
}
// Heure à jour (au changement de minute)
function _sbTick() {
  const el = document.getElementById('screen-sbar');
  const bar = _sb.seq || _sb.media;
  if (!el || !bar || el.style.display === 'none') return;
  const t = el.querySelector('.psb-time');
  if (!t || !t.textContent) return; // écran verrouillé : pas d'heure dans la barre
  const txt = PhoneUI.hm(new Date(phoneBarClockAt(bar, _sb.seq ? _sb.seqAt : _sb.mediaAt, Date.now())));
  if (t.textContent !== txt) t.textContent = txt;
}
// Surfaces affichées ou masquées (appel, discussion, téléphone, média, noir) : barre recalculée
(function initScreenBarWatch() {
  if (typeof MutationObserver === 'undefined') return;
  const ids = ['screen-call', 'screen-chat', 'screen-phone', 'screen-media-img', 'screen-media-video', 'screen-blackout'];
  const obs = new MutationObserver(() => {
    if (typeof screenPhoneSurfacesChanged === 'function') screenPhoneSurfacesChanged(); // veille : un appel rallume (94)
    if (_sb.seq || _sb.media) _sbRefresh();
  });
  for (const id of ids) { const e = document.getElementById(id); if (e) obs.observe(e, { attributes: true, attributeFilter: ['style', 'class'] }); }
  const chat = document.getElementById('screen-chat');
  if (chat) obs.observe(chat, { childList: true });
  _sb.obs = obs;
})();
