// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ FAUX TÉLÉPHONE : COMPOSANTS PARTAGÉS (écran de jeu) ══════════════════════════
// Phase 5 (maquettes 5a à 5m) : UN SEUL rendu pour le faux téléphone de l'onglet
// Tel (80-call-simulator.js, 84-notification.js) et de la Séquence
// (94-sequence-phone.js, 83-discussion.js, 97-phone-status.js). Chaque fonction
// renvoie du HTML (chaîne) ; tout texte reçu passe par escapeHtml, jamais
// interprété. Styles : web/styles/79-phone-ui.css (trois habillages par jetons,
// .ph-glass « Verre », .ph-tonal « Tonal », .ph-minimal « Épuré »).
//   • statusBar     : la barre d'état (heure, réseau, Wi-Fi, batterie), unique
//   • notification  : la carte de notification (SMS, appel manqué, application)
//   • lock          : l'écran verrouillé (date, heure, cartes, lampe, appareil photo)
//   • incoming / inCall / callBanner / notifBanner : appels et bandeaux
//   • code / home / alertBox / power : pavé du code, accueil générique, alertes, logo
//   • root / paintWall : calque d'un écran, fond d'écran et voile (fond clair détecté)
// Aucune marque : icônes Lucide (ISC), libellés français courants.
// Les gestes passent par des attributs data-act, lus par les écouteurs de
// 80-call-simulator.js et 94-sequence-phone.js (aucun onclick en ligne).
const _PH_ICONS = {
  "message-square": "<path d=\"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z\" />",
  "phone": "<path d=\"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384\" />",
  "phone-off": "<path d=\"M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272\" /> <path d=\"M22 2 2 22\" /> <path d=\"M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473\" />",
  "phone-missed": "<path d=\"m16 2 6 6\" /> <path d=\"m22 2-6 6\" /> <path d=\"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384\" />",
  "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /> <circle cx=\"9\" cy=\"9\" r=\"2\" /> <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />",
  "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 6v6l4 2\" />",
  "cloud-sun": "<path d=\"M12 2v2\" /> <path d=\"m4.93 4.93 1.41 1.41\" /> <path d=\"M20 12h2\" /> <path d=\"m19.07 4.93-1.41 1.41\" /> <path d=\"M15.947 12.65a4 4 0 0 0-5.925-4.128\" /> <path d=\"M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z\" />",
  "camera": "<path d=\"M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z\" /> <circle cx=\"12\" cy=\"13\" r=\"3\" />",
  "flashlight": "<path d=\"M12 13v1\" /> <path d=\"M17 2a1 1 0 0 1 1 1v4a3 3 0 0 1-.6 1.8l-.6.8A4 4 0 0 0 16 12v8a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-8a4 4 0 0 0-.8-2.4l-.6-.8A3 3 0 0 1 6 7V3a1 1 0 0 1 1-1z\" /> <path d=\"M6 6h12\" />",
  "calendar": "<path d=\"M8 2v3\" /> <path d=\"M16 2v3\" /> <rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" /> <path d=\"M3 9h18\" />",
  "calculator": "<rect width=\"16\" height=\"20\" x=\"4\" y=\"2\" rx=\"2\" /> <line x1=\"8\" x2=\"16\" y1=\"6\" y2=\"6\" /> <line x1=\"16\" x2=\"16\" y1=\"14\" y2=\"18\" /> <path d=\"M16 10h.01\" /> <path d=\"M12 10h.01\" /> <path d=\"M8 10h.01\" /> <path d=\"M12 14h.01\" /> <path d=\"M8 14h.01\" /> <path d=\"M12 18h.01\" /> <path d=\"M8 18h.01\" />",
  "map": "<path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\" /> <path d=\"M15 5.764v15\" /> <path d=\"M9 3.236v15\" />",
  "music": "<path d=\"M9 18V5l12-2v13\" /> <circle cx=\"6\" cy=\"18\" r=\"3\" /> <circle cx=\"18\" cy=\"16\" r=\"3\" />",
  "mic-off": "<path d=\"M12 19v3\" /> <path d=\"M15 9.34V5a3 3 0 0 0-5.68-1.33\" /> <path d=\"M16.95 16.95A7 7 0 0 1 5 12v-2\" /> <path d=\"M18.89 13.23A7 7 0 0 0 19 12v-2\" /> <path d=\"m2 2 20 20\" /> <path d=\"M9 9v3a3 3 0 0 0 5.12 2.12\" />",
  "grid-3x3": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" /> <path d=\"M3 9h18\" /> <path d=\"M3 15h18\" /> <path d=\"M9 3v18\" /> <path d=\"M15 3v18\" />",
  "volume-2": "<path d=\"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z\" /> <path d=\"M16 9a5 5 0 0 1 0 6\" /> <path d=\"M19.364 18.364a9 9 0 0 0 0-12.728\" />",
  "video": "<path d=\"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5\" /> <rect x=\"2\" y=\"6\" width=\"14\" height=\"12\" rx=\"2\" />",
  "user-plus": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /> <circle cx=\"9\" cy=\"7\" r=\"4\" /> <line x1=\"19\" x2=\"19\" y1=\"8\" y2=\"14\" /> <line x1=\"22\" x2=\"16\" y1=\"11\" y2=\"11\" />",
  "pause": "<rect x=\"14\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" /> <rect x=\"5\" y=\"3\" width=\"5\" height=\"18\" rx=\"1\" />",
  "battery-low": "<path d=\"M22 14v-4\" /> <path d=\"M6 14v-4\" /> <rect x=\"2\" y=\"6\" width=\"16\" height=\"12\" rx=\"2\" />",
  "signal-zero": "<path d=\"M2 20h.01\" />",
  "wifi": "<path d=\"M12 20h.01\" /> <path d=\"M2 8.82a15 15 0 0 1 20 0\" /> <path d=\"M5 12.859a10 10 0 0 1 14 0\" /> <path d=\"M8.5 16.429a5 5 0 0 1 7 0\" />",
  "plane": "<path d=\"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z\" />",
  "lock": "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />",
  "lock-keyhole": "<circle cx=\"12\" cy=\"16\" r=\"1\" /> <rect x=\"3\" y=\"10\" width=\"18\" height=\"12\" rx=\"2\" /> <path d=\"M7 10V7a5 5 0 0 1 10 0v3\" />",
  "chevron-left": "<path d=\"m15 18-6-6 6-6\" />",
  "send": "<path d=\"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z\" /> <path d=\"m21.854 2.147-10.94 10.939\" />",
  "plus": "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />",
  "mic": "<path d=\"M12 19v3\" /> <path d=\"M19 10v2a7 7 0 0 1-14 0v-2\" /> <rect x=\"9\" y=\"2\" width=\"6\" height=\"13\" rx=\"3\" />",
  "power": "<path d=\"M12 2v10\" /> <path d=\"M18.4 6.6a9 9 0 1 1-12.77.04\" />",
  "mail": "<path d=\"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7\" /> <rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\" />",
  "folder": "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\" />",
  "user-round": "<circle cx=\"12\" cy=\"8\" r=\"5\" /> <path d=\"M20 21a8 8 0 0 0-16 0\" />",
  "delete": "<path d=\"M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z\" /> <path d=\"m12 9 6 6\" /> <path d=\"m18 9-6 6\" />",
  "battery-charging": "<path d=\"m11 7-3 5h4l-3 5\" /> <path d=\"M14.856 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.935\" /> <path d=\"M22 14v-4\" /> <path d=\"M5.14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.936\" />",
  "signal": "<path d=\"M2 20h.01\" /> <path d=\"M7 20v-4\" /> <path d=\"M12 20v-8\" /> <path d=\"M17 20V8\" /> <path d=\"M22 4v16\" />",
  "bell": "<path d=\"M10.268 21a2 2 0 0 0 3.464 0\" /> <path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\" />",
  "search": "<path d=\"m21 21-4.34-4.34\" /> <circle cx=\"11\" cy=\"11\" r=\"8\" />",
  "chevron-up": "<path d=\"m18 15-6-6-6 6\" />",
  "clapperboard": "<path d=\"m12.296 3.464 3.02 3.956\" /> <path d=\"M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z\" /> <path d=\"M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\" /> <path d=\"m6.18 5.276 3.1 3.899\" />",
  "notebook-pen": "<path d=\"M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4\" /> <path d=\"M2 6h4\" /> <path d=\"M2 10h4\" /> <path d=\"M2 14h4\" /> <path d=\"M2 18h4\" /> <path d=\"M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z\" />",
  "signal-off": "<path d=\"M2 20h.01\" /> <path d=\"M7 20v-4\" /> <path d=\"M12 20v-8\" /> <path d=\"M17 20V8\" /> <path d=\"M22 4v16\" /><path d=\"m3 3 18 18\"/>",
};
const _PH_TXT = {
  incoming: 'Appel entrant', mobile: 'mobile', unknown: 'Inconnu', remind: 'Me le rappeler', message: 'Message',
  slide: 'faire glisser pour répondre', slideGroup: 'Répondre à l\'appel', slideAria: 'Répondre : faire glisser vers la droite, ou toucher',
  decline: 'Refuser', answer: 'Répondre', accept: 'Accepter', hangup: 'Raccrocher',
  mute: 'Muet', keypad: 'Clavier', speaker: 'Haut-parleur', add: 'Ajouter', video: 'Vidéo', contacts: 'Contacts', hold: 'Attente',
  torch: 'Lampe torche', camera: 'Appareil photo', more: '+ {n} notifications', now: 'maintenant',
  codeTitle: 'Saisir le code', cancel: 'Annuler', codeKeys: 'Clavier du code',
  search: 'Rechercher', clock: 'Horloge', weather: 'Météo', sunny: 'Éclaircies',
  batteryTitle: 'Batterie faible', batteryMsg: 'Il reste {n} % de batterie.', batteryClose: 'Fermer',
  netTitle: 'Aucun réseau', netMsg: 'Le réseau mobile n\'est plus disponible. Les appels et les SMS ne fonctionneront pas.', netClose: 'OK',
  today: 'Aujourd’hui', powerOff: 'Extinction',
};
const _PH_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const _PH_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
// Fond d'écran « clair » : luminance moyenne au-dessus de ce seuil → voile renforcé et cartes denses
const PH_LIGHT_WALL = 0.55;

const PhoneUI = (() => {
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const ic = (name) => '<svg class="li" viewBox="0 0 24 24" aria-hidden="true">' + (_PH_ICONS[name] || '') + '</svg>';
  const pad = (n) => String(n).padStart(2, '0');
  const tpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));
  // UN SEUL format de date, partout : « vendredi 17 juillet »
  const longDate = (d) => _PH_DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + _PH_MONTHS[d.getMonth()];
  const hm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  // Initiales d'un nom (« Maman » → M, « Paul Martin » → PM) ; '' sans lettre (numéro seul)
  function initials(name) {
    const w = String(name || '').trim().split(/\s+/).filter((x) => /^\p{L}/u.test(x));
    if (!w.length) return '';
    const f = (x) => Array.from(x)[0].toUpperCase();
    return w.length > 1 ? f(w[0]) + f(w[w.length - 1]) : f(w[0]);
  };
  const bgImg = (u) => (u ? ' style="background-image:url(' + u + ')"' : '');
  const act = (a) => ' data-act="' + a + '"';

  // ── PhoneStatusBar ── bar = { net:{bars,type,wifi,plane}, bat:{level,charging,pct,low} }
  // Contenu de la barre (heure à gauche ; réseau, Wi-Fi, pourcentage, batterie à droite)
  function statusBarInner(bar, time, hideTime) {
    const n = bar.net, b = bar.bat;
    let r = '';
    if (n.plane) r += '<span class="psb-ic" role="img" aria-label="' + esc(_PB_TXT.plane) + '">' + ic('plane') + '</span>';
    else if (n.bars === 0) r += '<span class="psb-nosvc">' + esc(_PB_TXT.noService) + '</span>';
    else r += '<span class="psb-sig" role="img" aria-label="' + n.bars + ' / 4">' + [1, 2, 3, 4].map((i) => '<i' + (i <= n.bars ? ' class="on"' : '') + '></i>').join('') + '</span><span class="psb-net">' + esc(n.type) + '</span>';
    if (n.wifi) r += '<span class="psb-ic psb-wifi" role="img" aria-label="' + esc(_PB_TXT.wifi) + '">' + ic('wifi') + '</span>';
    if (b.pct) r += '<span class="psb-pct">' + b.level + ' %</span>';
    const low = !b.charging && (b.low || b.level <= PB_LOW_BATTERY);
    r += '<span class="psb-bat' + (b.charging ? ' chg' : low ? ' low' : '') + '" role="img" aria-label="' + esc(_PB_TXT.battery.replace('{n}', b.level) + (b.charging ? ' · ' + _PB_TXT.charging : '')) + '"><i style="width:' + Math.max(4, b.level) + '%"></i></span>';
    if (b.charging) r += '<span class="psb-ic psb-bolt" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z"/></svg></span>';
    return '<span class="psb-time">' + (hideTime ? '' : esc(time)) + '</span><span class="psb-r">' + r + '</span>';
  }
  function statusBar(bar, time, o) {
    o = o || {};
    return '<div class="psb' + (o.band ? ' band' : '') + '" data-tone="' + (o.tone === 'dark' ? 'dark' : 'light') + '">' + statusBarInner(bar, time, o.hideTime) + '</div>';
  }

  // ── PhoneNotification ── n = { id, kind:'sms'|'missed'|'app', app, name, msg, when, color, img, who }
  function iconHtml(n) {
    if (n.kind === 'missed') {
      if (!n.who) return '<div class="pn-icon missed">' + ic('phone-missed') + '</div>';
      const t = initials(n.who);
      return '<div class="pn-icon av"' + bgImg(n.img) + '>' + (n.img ? '' : (t ? esc(t) : ic('user-round'))) + '<span class="pn-badge">' + ic('phone-missed') + '</span></div>';
    }
    if (n.kind === 'sms') return '<div class="pn-icon sms"' + (n.color ? ' style="background:' + esc(n.color) + '"' : '') + '>' + ic('message-square') + '</div>';
    if (n.img) return '<div class="pn-icon img"' + bgImg(n.img) + '></div>';
    return '<div class="pn-icon app"' + (n.color ? ' style="background:' + esc(n.color) + '"' : '') + '>' + esc((Array.from(String(n.app || '?').trim())[0] || '?').toUpperCase()) + '</div>';
  }
  function notification(n, extra) {
    return '<article class="pn pn-k-' + esc(n.kind) + (extra ? ' ' + extra : '') + '"' + (n.id ? ' data-n="' + esc(n.id) + '"' : '') + '>' + iconHtml(n)
      + '<div class="pn-body"><div class="pn-head"><span class="pn-app">' + esc(n.app) + '</span><span class="pn-when">' + esc(n.when || _PH_TXT.now) + '</span></div>'
      + '<div class="pn-title">' + esc(n.name) + '</div>' + (n.msg ? '<div class="pn-text">' + esc(n.msg) + '</div>' : '') + '</div></article>';
  }

  // ── PhoneLock ── o = { style, clock:{time,date}, notifs:[…], hint, max, newIds:Set }
  // Heure : Tonal l'empile (HH / MM) ; en paysage le « : » reparaît (CSS)
  function clockHtml(style, time) {
    const t = esc(time);
    return style === 'tonal' ? t.replace(':', '<br class="pl-br"><span class="pl-colon">:</span>') : t;
  }
  function lock(o) {
    const max = o.max || 3;
    const more = o.notifs.length > max ? '<div class="pn-more">' + esc(tpl(_PH_TXT.more, { n: o.notifs.length - max })) + '</div>' : '';
    return '<div class="pl"><div class="pl-head"><div class="pl-lock">' + ic('lock') + '</div><div class="pl-date">' + esc(o.clock.date) + '</div><div class="pl-time">' + clockHtml(o.style, o.clock.time) + '</div></div>'
      + '<div class="pn-stack">' + o.notifs.slice(0, max).map((n) => notification(n, o.newIds && o.newIds.has(n.id) ? 'pn-new' : '')).join('') + more + '</div></div>'
      + '<div class="pl-bottom"><button type="button" class="pl-circle" aria-label="' + esc(_PH_TXT.torch) + '"' + act('noop') + '>' + ic('flashlight') + '</button>'
      + '<span class="pl-hint">' + esc(o.hint || '') + '</span>'
      + '<button type="button" class="pl-circle" aria-label="' + esc(_PH_TXT.camera) + '"' + act('noop') + '>' + ic('camera') + '</button></div>'
      + '<div class="ph-home-ind"></div>';
  }

  // ── PhoneCall ── m = { style, name, label, photo, photoMode, timer }
  const initial = (m) => esc((String(m.name || '?').trim().charAt(0) || '?').toUpperCase());
  const avatar = (m, cls) => '<div class="' + (cls || 'pc-avatar') + '"' + bgImg(m.photo) + '>' + (m.photo ? '' : initial(m)) + '</div>';
  // Photo en fond : floutée (Verre) ou plein écran nette sous un voile (mode « photo plein écran », Verre et Tonal)
  function callBg(m) {
    if (!m.photo || m.style === 'minimal') return '';
    if (m.photoMode === 'full') return '<div class="pc-photo full" style="--photo:url(' + m.photo + ')"></div><div class="pc-shade"></div>';
    return m.style === 'glass' ? '<div class="pc-photo" style="--photo:url(' + m.photo + ')"></div>' : '';
  }
  // Avatar masqué quand la photo occupe déjà tout l'écran
  const callAvatar = (m) => (m.photoMode === 'full' && m.photo && m.style !== 'minimal' ? '' : avatar(m));
  const callBtn = (cls, icon, a, label) => '<div class="pc-col"><button type="button" class="pc-btn ' + cls + '" aria-label="' + esc(label) + '"' + act(a) + '>' + ic(icon) + '</button>' + esc(label) + '</div>';
  // Appel Verre sur téléphone VERROUILLÉ (lock non nul) : nom en haut, trois mini ronds
  // (Me le rappeler / Refuser / Message) et la piste « faire glisser pour répondre ».
  // Le rond vert est un vrai bouton (toucher, Entrée, Espace = repli accessible) ;
  // le glissement est géré par 80-call-simulator.js (initCallSlider).
  function incomingLocked(m) {
    const T = _PH_TXT;
    const mini = (cls, icon, a, l) => '<div class="pc-col"><button type="button" class="pc-btn mini ' + cls + '" aria-label="' + esc(l) + '"' + act(a) + '>' + ic(icon) + '</button>' + esc(l) + '</div>';
    const head = '<div class="pc-info"><div class="pc-name">' + esc(m.name || T.unknown) + '</div><div class="pc-sub">' + esc(m.label || T.mobile) + '</div></div>';
    const bot = '<div class="pc-bottom"><div class="pc-row pc-extra">' + mini('', 'clock', 'noop', T.remind) + mini('no', 'phone', 'decline', T.decline) + mini('', 'message-square', 'noop', T.message) + '</div>'
      + '<div class="pc-slide" role="group" aria-label="' + esc(T.slideGroup) + '"><span class="pc-slide-label">' + esc(T.slide) + '</span>'
      + '<button type="button" class="pc-slide-h" aria-label="' + esc(T.slideAria) + '"' + act('answer') + '>' + ic('phone') + '</button></div></div>';
    return callBg(m) + '<div class="pc pc-locked">' + head + bot + '</div><div class="ph-home-ind"></div>';
  }
  function incoming(m) {
    const st = m.style, T = _PH_TXT;
    if (st === 'glass' && m.lock) return incomingLocked(m);
    const head = '<div class="pc-info">' + (st === 'tonal' ? '<div class="pc-kicker">' + T.incoming + '</div>' : '') + callAvatar(m) + '<div class="pc-name">' + esc(m.name || T.unknown) + '</div><div class="pc-sub">' + esc(m.label || (st === 'minimal' ? T.incoming : T.mobile)) + '</div></div>';
    let bot;
    if (st === 'tonal') {
      bot = '<div class="pc-bottom"><div class="pc-row pc-pills"><button type="button" class="pc-pill no"' + act('decline') + '>' + ic('phone') + T.decline + '</button><button type="button" class="pc-pill ok"' + act('answer') + '>' + ic('phone') + T.answer + '</button></div></div>';
    } else {
      bot = '<div class="pc-bottom">' + (st === 'glass' ? '<div class="pc-row pc-extra"><div class="pc-col"><button type="button" class="pc-btn mini" aria-label="' + T.remind + '"' + act('noop') + '>' + ic('clock') + '</button>' + T.remind + '</div><div class="pc-col"><button type="button" class="pc-btn mini" aria-label="' + T.message + '"' + act('noop') + '>' + ic('message-square') + '</button>' + T.message + '</div></div>' : '')
        + '<div class="pc-row pc-main">' + callBtn('no', 'phone', 'decline', T.decline) + callBtn('ok', 'phone', 'answer', st === 'glass' ? T.accept : T.answer) + '</div></div>';
    }
    return callBg(m) + '<div class="pc">' + head + bot + '</div>';
  }
  function inCall(m) {
    const st = m.style, T = _PH_TXT;
    const g = (i, l) => '<div class="pc-g"><button type="button" class="pc-gb" aria-label="' + l + '"' + act('noop') + '>' + ic(i) + '</button>' + l + '</div>';
    const grid = '<div class="pc-grid">' + g('mic-off', T.mute) + g('grid-3x3', T.keypad) + g('volume-2', T.speaker) + g('plus', T.add) + g('video', T.video) + (st === 'tonal' ? g('pause', T.hold) : g('user-round', T.contacts)) + '</div>';
    const head = '<div class="pc-info">' + (st === 'glass' ? '' : callAvatar(m)) + '<div class="pc-name' + (st === 'glass' ? ' pc-name-s' : '') + '">' + esc(m.name || T.unknown) + '</div><div class="pc-timer" id="scCallTimer">' + esc(m.timer || '00:00') + '</div></div>';
    if (st === 'minimal') return '<div class="pc">' + head + '<div class="pc-bottom solo">' + callBtn('no', 'phone', 'hangup', T.hangup) + '</div></div>';
    return callBg(m) + '<div class="pc">' + head + grid + '<div class="pc-bottom pc-end"><button type="button" class="pc-hang" aria-label="' + T.hangup + '"' + act('hangup') + '>' + ic('phone') + '</button></div></div>';
  }
  // Bandeau d'appel entrant (téléphone en cours d'utilisation)
  function callBanner(m) {
    const T = _PH_TXT;
    const info = '<div class="pbc-info"><div class="pbc-n">' + esc(m.name || T.unknown) + '</div><div class="pbc-s">' + esc(m.label || T.incoming) + '</div></div>';
    const wrap = (h) => '<div class="pb-wrap"><div class="pbc">' + h + '</div></div>';
    if (m.style === 'tonal') return wrap(avatar(m) + info + '<div class="pbc-acts"><button type="button" class="pc-pill no"' + act('decline') + '>' + T.decline + '</button><button type="button" class="pc-pill ok"' + act('answer') + '>' + T.answer + '</button></div>');
    return wrap(avatar(m) + info + '<button type="button" class="pbc-b no" aria-label="' + T.decline + '"' + act('decline') + '>' + ic('phone') + '</button><button type="button" class="pbc-b ok" aria-label="' + T.answer + '"' + act('answer') + '>' + ic('phone') + '</button>');
  }
  // Bandeau de notification (SMS, application) : toucher = geste « notif »
  const notifBanner = (n) => '<div class="pb-wrap"' + act('notif') + '>' + notification(n) + '</div>';

  // ── PhoneCode ──
  const LET = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ' };
  const dots = (len, typed) => Array.from({ length: len }, (_, i) => '<span class="pk-dot' + (i < typed ? ' on' : '') + '"></span>').join('');
  function code(o) {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', ''].map((d) => d ? '<button type="button" class="pk-key" data-key="' + d + '">' + d + '<small aria-hidden="true">' + (LET[d] || '') + '</small></button>' : '<span class="pk-key gap"></span>').join('');
    return '<div class="pk"><div class="pk-top"><div class="pk-ic">' + ic('lock-keyhole') + '</div><div class="pk-title">' + esc(_PH_TXT.codeTitle) + '</div><div class="pk-dots">' + dots(o.len, o.typed) + '</div></div>'
      + '<div class="pk-keys" aria-label="' + esc(_PH_TXT.codeKeys) + '">' + keys + '</div><span class="pk-cancel">' + esc(_PH_TXT.cancel) + '</span></div><div class="ph-home-ind"></div>';
  }

  // ── PhoneHome ── icônes génériques : mots courants et glyphes neutres, aucune marque ni logo
  const APPS = {
    photos: ['Photos', 'image', 'linear-gradient(135deg,#ff9f43,#ee5a8a)'], agenda: ['Agenda', 'calendar', 'linear-gradient(135deg,#ef5350,#c62828)'],
    horloge: ['Horloge', 'clock', 'linear-gradient(135deg,#3a3f4a,#16181d)'], meteo: ['Météo', 'cloud-sun', 'linear-gradient(135deg,#4aa3ff,#2a62d9)'],
    notes: ['Notes', 'notebook-pen', 'linear-gradient(135deg,#f6c445,#d99a12)'], calc: ['Calculatrice', 'calculator', 'linear-gradient(135deg,#ff9f43,#e0701a)'],
    cartes: ['Cartes', 'map', 'linear-gradient(135deg,#34c3a0,#1b8f74)'], musique: ['Musique', 'music', 'linear-gradient(135deg,#ff5f7e,#d42b5e)'],
    courrier: ['Courrier', 'mail', 'linear-gradient(135deg,#4aa3ff,#1f6fe0)'], dossiers: ['Dossiers', 'folder', 'linear-gradient(135deg,#5b8def,#3a58c8)'],
    reglages: ['Réglages', 'settings', 'linear-gradient(135deg,#9aa1ad,#5d6470)'], video: ['Vidéo', 'clapperboard', 'linear-gradient(135deg,#8b6cf0,#5b3fc4)'],
    tel: ['Téléphone', 'phone', 'linear-gradient(135deg,#3ccf6a,#1f9d4c)'], msg: ['Messages', 'message-square', 'linear-gradient(135deg,#3ccf6a,#1f9d4c)'],
    camera: ['Caméra', 'camera', 'linear-gradient(135deg,#6b7280,#2f343c)'], contacts: ['Contacts', 'user-round', 'linear-gradient(135deg,#9aa1ad,#5d6470)'],
  };
  const HOME_GRID = ['photos', 'agenda', 'horloge', 'meteo', 'notes', 'calc', 'cartes', 'musique', 'courrier', 'dossiers', 'reglages', 'video'];
  const HOME_DOCK = ['tel', 'msg', 'camera', 'contacts'];
  const appIcon = (k) => { const a = APPS[k]; return '<div class="pha-i"><div class="pha-ic pha-' + k + '" style="--g:' + a[2] + '">' + ic(a[1]) + '</div>' + a[0] + '</div>'; };
  // o = { clock:{time,date} } : widgets Horloge et Météo (valeurs fictives fixes), grille, dock
  function home(o) {
    const T = _PH_TXT;
    const widgets = '<div class="phw"><div class="phw-c"><div class="phw-t">' + ic('clock') + T.clock + '</div><div class="phw-big">' + esc(o.clock.time) + '</div><div class="phw-s">' + esc(o.clock.date) + '</div></div>'
      + '<div class="phw-c"><div class="phw-t">' + ic('cloud-sun') + T.weather + '</div><div class="phw-big">21°</div><div class="phw-s">' + T.sunny + '</div></div></div>';
    return '<div class="ph-home">' + widgets + '<div class="pha">' + HOME_GRID.map(appIcon).join('') + '</div>'
      + '<div class="dots"><i></i><i></i><i></i></div><div class="psearch">' + ic('search') + T.search + '</div>'
      + '<div class="pdock">' + HOME_DOCK.map(appIcon).join('') + '</div></div><div class="ph-home-ind"></div>';
  }
  // Image d'accueil de l'utilisateur, seule et plein écran (souvent une capture complète)
  const homeImage = (url) => '<div class="ph-img" style="--img:url(' + url + ')"></div><div class="ph-topshade"></div>';

  // ── PhoneAlert ── o = { kind:'battery'|'net', level }
  function alertBox(o) {
    const T = _PH_TXT, net = o.kind === 'net';
    return '<div class="pal"><div class="pal-c" role="alertdialog" aria-label="' + esc(net ? T.netTitle : T.batteryTitle) + '"><div class="pal-ic' + (net ? ' net' : '') + '">' + ic(net ? 'signal-off' : 'battery-low') + '</div>'
      + '<div class="pal-t">' + esc(net ? T.netTitle : T.batteryTitle) + '</div><div class="pal-m">' + esc(net ? T.netMsg : tpl(T.batteryMsg, { n: o.level })) + '</div>'
      + '<button type="button" class="pal-b"' + act('alert-close') + '>' + esc(net ? T.netClose : T.batteryClose) + '</button></div></div>';
  }
  // Logo neutre de l'extinction et du rallumage
  const power = () => '<svg class="li pp-logo" viewBox="0 0 24 24" aria-hidden="true">' + _PH_ICONS.power + '</svg>';
  // Loader d'extinction : batterie vide (liseré rouge qui clignote) + indicateur dessous, selon l'habillage
  // (Verre : halo + anneau ; Tonal : pastille + barre fine ; Épuré : à plat + trois points)
  const powerOff = (style) => '<div class="pp-off ph-' + esc(['glass', 'tonal', 'minimal'].includes(style) ? style : 'glass') + '" role="img" aria-label="' + esc(_PH_TXT.powerOff) + '">'
    + '<svg class="pp-offbat" viewBox="0 0 64 32" aria-hidden="true"><rect x="1.5" y="2" width="55" height="28" rx="7" stroke="currentColor" stroke-width="3"/>'
    + '<rect x="60" y="11" width="4" height="10" rx="2" fill="currentColor" opacity=".7"/><rect class="sliver" x="6.5" y="7" width="5" height="18" rx="2.5"/></svg>'
    + '<div class="pp-spin"><i></i></div></div>';

  // ── Calque d'un écran ── fond d'écran + voile (affichés seulement avec .has-wall), puis le contenu
  function root(o) {
    return '<div class="ph ph-' + esc(o.style) + (o.cls ? ' ' + o.cls : '') + '" data-wall="dark"' + (o.attrs || '') + '><div class="ph-wall"></div><div class="ph-scrim"></div>' + (o.body || '') + '</div>';
  }
  // Luminance moyenne d'une image (échantillon 16 × 16), gardée par image ; cb(luma) tout de suite si connue
  const _lumaCache = new Map();
  let _lumaPending = 0;
  const lumaKey = (u) => u.length + ':' + u.slice(-48);
  function wallLuma(url, cb) {
    const k = lumaKey(url);
    if (_lumaCache.has(k)) { cb(_lumaCache.get(k)); return; }
    _lumaPending++;
    const im = new Image();
    const done = (v) => { _lumaCache.set(k, v); _lumaPending--; cb(v); };
    im.onload = () => {
      let v = 0;
      try {
        const c = document.createElement('canvas'); c.width = c.height = 16;
        const g = c.getContext('2d'); g.drawImage(im, 0, 0, 16, 16);
        const d = g.getImageData(0, 0, 16, 16).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        v = s / 256;
      } catch (_) { v = 0; }
      done(v);
    };
    im.onerror = () => done(0);
    im.src = url;
  }
  // Pose (ou retire) le fond d'écran d'un calque ; fond clair → data-wall="light" (voile renforcé)
  function paintWall(el, url) {
    if (!el) return;
    el.classList.toggle('has-wall', !!url);
    if (url) el.style.setProperty('--wall', 'url(' + url + ')'); else el.style.removeProperty('--wall');
    if (!url) { el.dataset.wall = 'dark'; return; }
    wallLuma(url, (v) => { el.dataset.wall = v > PH_LIGHT_WALL ? 'light' : 'dark'; });
  }

  return { esc, ic, longDate, hm, initials, statusBar, statusBarInner, notification, lock, clockHtml, incoming, inCall, callBanner, notifBanner, code, dots, home, homeImage, alertBox, power, powerOff, root, paintWall, wallLuma, pending: () => _lumaPending, APPS };
})();
