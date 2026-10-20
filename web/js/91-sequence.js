// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ SÉQUENCE (télécommande) ══════════════════════════
// Onglet « Séquence » : maquettes validées 28 (liste des étapes, GO / ↶ /
// STOP) et 29 (éditer une étape). Une séquence enchaîne des ÉTATS ENREGISTRÉS
// des autres onglets et des étapes du faux téléphone :
//   Couleur (mémoire de couleur), Effet (mémoire d'effet), Média (pool, avec
//   la fin de lecture), Appel / SMS / Notification (liste enregistrée de
//   l'onglet Tel), Appel manqué (notification empilée sur l'écran verrouillé,
//   pour un appel enregistré), Déverrouillage (code 4 ou 6 chiffres, ou
//   glisser seul ; ensuite l'app visée ou une image d'écran d'accueil),
//   Discussion (discussion enregistrée ; lecture manuelle, « Auto · le comédien
//   tape » ou « Auto · tout automatique », maquette 41, 83-discussion.js),
//   Veille (maquette 29b : écran noir verrouillé qui se rallume aux
//   notifications / appels et/ou au toucher, se rendort après N s),
//   Batterie faible et Extinction (maquette 33), Réseau perdu / rétabli (34).
// « Téléphone au départ » (maquette 28b, 98-phone-params.js) : barre d'état
// propre à la séquence (heure qui avance / figée / réelle, réseau, Wi-Fi,
// batterie), enregistrée avec elle, affichée partout sur les écrans visés du
// premier GO à « Recommencer » (STOP compris : rien ne s'éteint) ; elle prime
// sur la barre de l'onglet Média. Les étapes Batterie faible / Réseau /
// Extinction la font évoluer ; ↶ rend les valeurs d'avant. Avec elle, un fond
// d'écran facultatif (maquette 42) : écran verrouillé et pavé du code, pendant
// toute la séquence (sans fond : le dégradé sombre).
// Sans réseau : un appel devient « Appel impossible », un message du comédien
// reste « Non distribué » (notification « Message non envoyé ») jusqu'au
// retour du réseau, qui le distribue. Téléphone éteint : il ne reçoit plus
// d'appel ni de son ; une étape « Veille » plus loin (ou ↶) le rallume.
// Réseau perdu (maquette 44b) : alerte « Aucun réseau » une fois par perte
// (pas en mode avion : choisi au départ, il n'est pas une perte), fermée par
// « OK », retirée au retour du réseau.
// Écran verrouillé (maquette 44) : une notification garde l'icône importée de
// son entrée, un appel manqué la photo de son appel (préparées __ph_…,
// envoyées à chaque écran qui ne les a pas, renvoyées à la resynchronisation) ;
// un SMS prend la couleur de son app, un appel manqué les initiales de
// l'appelant.
// Chaque étape RÉFÉRENCE l'élément enregistré (son id), jamais une copie :
// modifié dans son onglet, il est joué tel quel ; supprimé, l'étape affiche
// « élément introuvable » et elle est sautée avec un avertissement.
// Chaque étape a sa cible (tous, un groupe, un écran) et son départ :
//   « Au GO », « Après N s » (compté depuis le départ de l'étape précédente),
//   « Geste du comédien » (rapporté par l'écran, phone:gesture ; la réponse
//   dans la discussion arrive par chat:sent), avec un délai de secours
//   facultatif (« refuse / 12 s »).
// GO lance toujours l'étape suivante, quel que soit son départ ; ↶ revient
// d'une étape en la défaisant (notification retirée, appel raccroché,
// téléphone reverrouillé, discussion fermée, couleur / effet / média d'avant) ;
// STOP arrête les minuteries et l'écoute des gestes sans rien éteindre.
// Le faux téléphone (écran verrouillé, notifications empilées, pavé du code,
// image d'accueil) est tenu ICI, écran par écran, et renvoyé en entier
// (phone:state) à chaque changement et à la resynchronisation d'un écran.
// Avertissement stroboscope (46-strobe-warning.js) : au premier GO d'une
// séquence qui allume le strobe ou un effet à flashs rapides.
// La console DMX ne pilote pas la Séquence. Séquences enregistrées :
// 96-sequences-saved.js. Stockage : séquence en cours en localStorage, images
// d'accueil et fonds d'écran dans IndexedDB (callAssetPut, clé
// « seqhome-<empreinte>:photo », partagée par empreinte).

// Textes affichés, regroupés pour la traduction ({…} : valeurs)
const _SEQ_TXT = {
  untitled: 'Nouvelle séquence',
  target: 'Cible : {cible}',
  allScreens: 'Tous les écrans',
  all: 'Tous',
  missing: 'élément introuvable',
  noScreen: 'aucun écran',
  empty: 'Aucune étape. « + Étape » ajoute la première : couleur, effet, média, appel, SMS, notification, veille, déverrouillage, discussion, batterie, réseau.',
  kind: {
    color: 'Couleur', effect: 'Effet', media: 'Média', call: 'Appel', sms: 'SMS', notif: 'Notif',
    missed: 'Manqué', unlock: 'Déverrouil.', chat: 'Discussion',
    sleep: 'Veille', battery: 'Batterie', off: 'Extinction', net: 'Réseau',
  },
  kindLong: {
    color: 'Couleur', effect: 'Effet', media: 'Média', call: 'Appel entrant', sms: 'SMS', notif: 'Notification',
    missed: 'Appel manqué', unlock: 'Déverrouillage', chat: 'Discussion',
    sleep: 'Veille', battery: 'Batterie faible', off: 'Extinction', net: 'Réseau',
  },
  rowColor: 'Couleur {spec} ({nom})',
  rowEffect: 'Effet {nom}',
  rowMedia: 'Média : {nom}',
  rowCall: 'Appel entrant « {nom} »',
  rowSmsLock: 'Notif SMS « {nom} » (verrouillé)',
  rowSms: 'SMS « {texte} »',
  rowNotifLock: 'Notif « {nom} » (verrouillé)',
  rowNotif: 'Notif « {nom} »',
  rowMissed: 'Notif « Appel manqué »',
  rowUnlock4: 'Déverrouillage code 4 chiffres',
  rowUnlock6: 'Déverrouillage code 6 chiffres',
  rowUnlock0: 'Déverrouillage par glissement',
  rowChat: 'Discussion « {nom} »',
  rowChatReply: 'Discussion « {nom} » → réponse',
  rowChatActor: ' · auto (comédien tape)',
  rowChatFull: ' · auto complète',
  chatNext: 'Prochain : {qui} « {texte} »',
  rowSleep: 'Veille (écran noir)',
  rowBattery: 'Batterie faible {n} %',
  rowOff: 'Extinction du téléphone',
  rowNetLost: 'Réseau perdu (pas de service)',
  rowNetBack: 'Réseau rétabli ({barres} {type})',
  phoneRow: 'Téléphone au départ',
  rowTargetSuffix: ' ({cible})',
  trigGo: 'GO',
  trigAfter: 'après {n} s',
  trigFallback: '{geste} / {n} s',
  gestureShort: { touch: 'touche l\'écran', notif: 'touche la notif', hangup: 'refuse', answer: 'décroche', unlock: 'déverrouillé', chat: 'répond', home: 'touche l\'accueil' },
  gestureChip: { touch: 'touche l\'écran', notif: 'touche la notif', hangup: 'raccroche', answer: 'décroche', unlock: 'déverrouille', chat: 'envoie un message', home: 'touche l\'accueil' },
  gestureVerb: { touch: 'touche l\'écran', notif: 'touche la notif', hangup: 'refuse', answer: 'décroche', unlock: 'déverrouille', chat: 'répond', home: 'touche l\'accueil' },
  legendGo: '● GO', legendAuto: '● automatique', legendActor: '● geste du comédien',
  nowLabel: 'En cours : ',
  nowSince: ' — depuis {n} s',
  nowRinging: ' — sonne depuis {n} s',
  nowInCall: ' — en ligne depuis {n} s',
  next: 'Suivant : {n} · {nom} ({quand})',
  whenGo: 'au GO',
  whenAfter: 'après {n} s',
  whenGesture: 'si le comédien {geste}',
  whenGestureFallback: 'si le comédien {geste}, ou après {n} s',
  ready: 'Prêt : GO lance l\'étape 1 · {nom}',
  ended: 'Séquence terminée',
  stopped: 'Arrêtée — GO reprend.',
  restart: '↺ Recommencer',
  noneNext: 'Plus d\'étape après celle-ci.',
  skipped: 'Étape {n} sautée : {raison}.',
  // Éditeur d'étape (maquette 29)
  back: '← Séquence',
  stepTitle: 'Étape {n}',
  stepNew: 'Nouvelle étape',
  labelType: 'Type',
  labelStart: 'Démarre',
  labelTarget: 'Cible',
  labelUnlock: 'Déverrouillage',
  labelThen: 'Ensuite',
  labelColor: 'Mémoire de couleur',
  labelEffect: 'Mémoire d\'effet',
  labelMedia: 'Média du pool',
  labelEnd: 'Fin de lecture',
  labelCall: 'Appel enregistré',
  labelSms: 'SMS enregistré',
  labelNotif: 'Notification enregistrée',
  labelChat: 'Discussion enregistrée',
  code4: 'Code 4 chiffres', code6: 'Code 6 chiffres', swipe: 'Glisser seul',
  thenApp: 'Ouvrir l\'app visée', thenHome: 'Écran d\'accueil (image)',
  homeChange: 'Changer l\'image', homePick: 'Choisir l\'image', homeNote: 'toucher l\'image ouvre l\'étape suivante',
  homeNone: 'Aucune image : fond dégradé',
  homeBad: '⚠ Image illisible',
  startGo: 'Au GO', startAfter: 'Après N s', startGesture: 'Geste du comédien',
  afterLabel: 'Après', fallbackLabel: 'Sinon après', never: 'jamais', seconds: '{n} s',
  endLoop: '🔁 Boucle', endPause: '⏯ 1× puis pause', endOff: '⏹ 1× puis off',
  none: {
    color: 'Aucune mémoire de couleur : enregistrez-en une dans l\'onglet Couleur.',
    effect: 'Aucune mémoire d\'effet : enregistrez-en une dans l\'onglet Effets.',
    media: 'Pool média vide : ajoutez des images ou des vidéos dans l\'onglet Média.',
    call: 'Aucun appel enregistré : enregistrez-en un dans l\'onglet Tel.',
    sms: 'Aucun SMS enregistré : enregistrez-en un dans l\'onglet Tel.',
    notif: 'Aucune notification enregistrée : enregistrez-en une dans l\'onglet Tel.',
    chat: 'Aucune discussion enregistrée : enregistrez-en une dans l\'onglet Tel (Discussion).',
  },
  refMissing: 'L\'élément de cette étape a été supprimé : choisissez-en un autre.',
  needRef: 'Choisissez l\'élément à jouer.',
  del: 'Supprimer', cancel: 'Annuler', save: 'Enregistrer',
  confirmDel: 'Supprimer l\'étape {n} ?',
  leaveTitle: 'Abandonner les modifications ?', leaveNewTitle: 'Abandonner cette étape ?',
  leaveText: 'Les réglages de l\'étape n\'ont pas été enregistrés.',
  leaveOk: 'Abandonner', leaveCancel: 'Continuer',
  full: 'Séquence pleine ({max} étapes).',
  storeFull: 'Enregistrement impossible : la mémoire de l\'appareil est pleine.',
  missedApp: 'Téléphone', missedTitle: 'Appel manqué', smsApp: 'SMS',
  // Pas de réseau (maquette 34)
  noCallTitle: 'Appel impossible', noCallMsg: 'Aucun réseau disponible.',
  unsentTitle: 'Message non envoyé', unsentMsg: '« {texte} » — Toucher pour réessayer',
  // Éditeur : veille (maquette 29b), batterie faible, extinction, réseau, lecture auto
  labelSleep: 'Téléphone en veille',
  sleepText: 'Écran noir, verrouillé. Rien ne s\'affiche tant que rien n\'arrive.',
  labelWake: 'Se rallume', wakeNotif: 'à chaque notif / appel', wakeTouch: 'au toucher',
  labelResleep: 'Se rendort après',
  sleepNote: 'Allumage et extinction en fondu, comme un vrai téléphone. Le déverrouillage le réveille définitivement.',
  labelBattery: 'Batterie faible',
  batteryText: 'Alerte « Batterie faible » à fermer, icône de batterie rouge ; la batterie affichée descend à ce niveau.',
  labelLevel: 'Niveau', percent: '{n} %',
  labelOff: 'Extinction',
  offText: 'Fondu, logo neutre, écran noir : le téléphone ne répond plus à rien (ni appel, ni son, ni toucher).',
  offNote: 'Rallumer : une étape « Veille » plus loin (logo, puis écran verrouillé endormi) ou ↶.',
  labelNet: 'Réseau', netLost: 'Perdu', netBack: 'Rétabli',
  labelBars: 'Barres', labelNetType: 'Réseau mobile', labelWifi: 'Wi-Fi', yes: 'Oui', no: 'Non',
  netLostNote: '« Pas de service » dans la barre d\'état et alerte « Aucun réseau » (une fois, pas en mode avion) : un appel devient « Appel impossible », un message du comédien reste « Non distribué ».',
  netBackNote: 'Les messages restés « Non distribué » partent.',
  // Lecture de l'étape Discussion (maquette 41)
  labelPlay: 'Lecture', playManual: 'Manuelle', playActor: '▶ Auto · le comédien tape', playFull: '▶ Auto · tout automatique',
  playNote: 'Tout automatique : les réponses de {comedien} s\'écrivent aussi toutes seules, avec leurs durées enregistrées. « Le comédien tape » : le fil attend que {comedien} tape sur l\'écran.',
  actorDefault: 'le comédien',
};
const _seqTpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));

const SEQ_LS_KEY = 'setremote-seq-v1';
const SEQ_STEPS_MAX = 60;
const SEQ_NAME_MAX = 40;
const SEQ_DELAY_MAX = 600;  // s
const SEQ_KINDS = ['color', 'effect', 'media', 'call', 'sms', 'notif', 'missed', 'unlock', 'chat', 'sleep', 'battery', 'off', 'net'];
const SEQ_PHONE_KINDS = new Set(['call', 'sms', 'notif', 'missed', 'unlock', 'chat', 'sleep', 'battery', 'off', 'net']);
// Étapes sans élément enregistré : leurs réglages sont dans l'étape (opt)
const SEQ_OPT_KINDS = new Set(['unlock', 'sleep', 'battery', 'off', 'net']);
// Grille des types (maquette 29b) : 3, 3, 4 puis les étapes du téléphone
const SEQ_KIND_ROWS = [['color', 'effect', 'media'], ['call', 'sms', 'notif'], ['sleep', 'missed', 'unlock', 'chat'], ['battery', 'off', 'net']];
const SEQ_SLEEP_DEF = 8, SEQ_BATTERY_DEF = 5;
const SEQ_GESTURES = ['touch', 'notif', 'hangup', 'answer', 'unlock', 'chat', 'home'];
const SEQ_ICONS = { color: '🎨', effect: '✨', media: '🎞', call: '📞', sms: '✉️', notif: '🔔', missed: '📵', unlock: '🔓', chat: '💬', sleep: '😴', battery: '🔋', off: '📴', net: '📶' };
const _SEQ_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const _SEQ_SIG_RE = /^[0-9a-f]{8}-\d{1,9}$/;

// ── Modèle ──
// Étape : { id, kind, ref (id de l'élément ; média : { id, name, kind }),
//   target ({ k: 'all' } | { k: 'group', id } | { k: 'screen', id }),
//   trig ({ k: 'go' } | { k: 'after', s } | { k: 'gesture', g, t (secours, 0 = aucun) }),
//   opt (média : { end } ; déverrouillage : { code: 4 | 6 | 0, then: 'app' | 'home', img, imgName } ;
//        discussion : { auto, full } (lecture : manuelle, auto le comédien tape, auto complète :
//        auto ET full ; ancienne étape { auto: true } : le comédien tape) ; veille : { notif, touch, after } ; batterie : { level } ;
//        réseau : { lost, bars, type, wifi }) }
// Séquence : { name, steps, savedId, phone (« Téléphone au départ », 97-phone-status.js),
//   wall (fond d'écran du téléphone, maquette 42 : { img (empreinte), name } ou null) }
let _seq = _seqEmpty();
function _seqEmpty() { return { name: '', steps: [], savedId: null, phone: phoneBarDefaults(), wall: null }; }
// Fond d'écran relu (stockage, séquence enregistrée) ; null : aucun (ancienne séquence comprise)
function seqWallSanitize(w) {
  return w && typeof w === 'object' && typeof w.img === 'string' && _SEQ_SIG_RE.test(w.img) ? { img: w.img, name: _seqLine(w.name, 60) } : null;
}
// Réglages « Téléphone au départ » (complétés si la séquence n'en a pas)
function seqPhoneCfg() { if (!_seq.phone) _seq.phone = phoneBarDefaults(); return _seq.phone; }
let _seqIdN = 0;
const _seqNewId = () => 's' + Date.now().toString(36).slice(-6) + (++_seqIdN).toString(36);
const _seqLine = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, max) : '');
const _seqClampS = (v, min) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(SEQ_DELAY_MAX, Math.max(min, n)) : min; };

function _seqSanTarget(t) {
  if (t && typeof t === 'object') {
    if (t.k === 'group' && typeof t.id === 'string' && SRP.GROUP_ID_RE.test(t.id)) return { k: 'group', id: t.id };
    if (t.k === 'screen' && typeof t.id === 'string' && SRP.SCREEN_ID_RE.test(t.id)) return { k: 'screen', id: t.id };
  }
  return { k: 'all' };
}
function _seqSanTrig(t, kind) {
  const k = t && typeof t === 'object' ? t.k : 'go';
  if (k === 'after') return { k: 'after', s: _seqClampS(t.s, 0) };
  if (k === 'gesture' && SEQ_GESTURES.includes(t.g)) return { k: 'gesture', g: t.g, t: _seqClampS(t.t, 0) };
  return { k: 'go' };
}
// Étape relue (stockage, séquence enregistrée) : champs connus, bornés ; null si inutilisable
function seqSanitizeStep(s) {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !_SEQ_ID_RE.test(s.id) || !SEQ_KINDS.includes(s.kind)) return null;
  const out = { id: s.id, kind: s.kind, ref: null, target: _seqSanTarget(s.target), trig: _seqSanTrig(s.trig, s.kind), opt: {} };
  if (s.kind === 'media') {
    const r = s.ref;
    if (r && typeof r === 'object' && typeof r.id === 'string' && _SEQ_ID_RE.test(r.id)) out.ref = { id: r.id, name: _seqLine(r.name, 120), kind: r.kind === 'vid' ? 'vid' : 'img' };
    const end = s.opt && s.opt.end;
    out.opt = { end: ['loop', 'pause', 'off'].includes(end) ? end : 'loop' };
  } else if (s.kind === 'unlock') {
    const o = s.opt || {};
    out.opt = {
      code: [0, 4, 6].includes(o.code) ? o.code : 4, then: o.then === 'home' ? 'home' : 'app',
      img: typeof o.img === 'string' && _SEQ_SIG_RE.test(o.img) ? o.img : null, imgName: _seqLine(o.imgName, 60),
    };
  } else if (s.kind === 'sleep') {
    const o = s.opt || {};
    out.opt = { notif: o.notif !== false, touch: o.touch !== false, after: _seqClampInt(o.after, 1, PROTO.PHONE_SLEEP_MAX, SEQ_SLEEP_DEF) };
  } else if (s.kind === 'battery') {
    out.opt = { level: _seqClampInt((s.opt || {}).level, 1, 100, SEQ_BATTERY_DEF) };
  } else if (s.kind === 'net') {
    const o = s.opt || {};
    out.opt = { lost: o.lost !== false, bars: _seqClampInt(o.bars, 1, 4, 4), type: PB_NET_TYPES.includes(o.type) ? o.type : PB_NET_TYPES[1], wifi: o.wifi !== false };
  } else if (s.kind !== 'off' && typeof s.ref === 'string' && _SEQ_ID_RE.test(s.ref)) out.ref = s.ref;
  if (s.kind === 'chat') {
    const auto = !!(s.opt && s.opt.auto === true);
    out.opt = { auto, full: auto && s.opt.full === true };
  }
  return out;
}
function _seqClampInt(v, min, max, def) { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== undefined ? Math.min(max, Math.max(min, n)) : def; }
function seqSanitizeSteps(list) {
  const ids = new Set();
  return (Array.isArray(list) ? list : []).map(seqSanitizeStep).filter((s) => s && !ids.has(s.id) && ids.add(s.id)).slice(0, SEQ_STEPS_MAX);
}
function seqLoad() {
  let o = null;
  try { o = JSON.parse(_lsGet(SEQ_LS_KEY)); } catch (_) { o = null; }
  _seq = _seqEmpty();
  if (o && typeof o === 'object') {
    _seq.name = _seqLine(o.name, SEQ_NAME_MAX);
    _seq.steps = seqSanitizeSteps(o.steps);
    _seq.savedId = typeof o.savedId === 'string' && _SEQ_ID_RE.test(o.savedId) ? o.savedId : null;
    _seq.phone = phoneBarSanitize(o.phone);
    _seq.wall = seqWallSanitize(o.wall);
  }
}
function seqSave() {
  return _lsPut(SEQ_LS_KEY, JSON.stringify({ v: 1, name: _seq.name, steps: _seq.steps, savedId: _seq.savedId, phone: seqPhoneCfg(), wall: _seq.wall || null }));
}

// ── Éléments référencés ──
function _seqMediaItem(r) {
  if (!r) return null;
  return _mediaPool.find((m) => m.id === r.id && m.name === r.name) || _mediaPool.find((m) => m.name === r.name && m.kind === r.kind) || null;
}
// Élément enregistré de l'étape (null : introuvable ; déverrouillage : l'étape elle-même)
function seqRefItem(s) {
  switch (s.kind) {
    case 'color': return colorMemories.find((m) => m.id === s.ref) || null;
    case 'effect': return fxMemories.find((m) => m.id === s.ref && EFFECT_CONFIG[m.effect]) || null;
    case 'media': return _seqMediaItem(s.ref);
    // Démo de l'aperçu sans licence (76-demos.js) : ses éléments, même si Tel est sous licence
    case 'call': case 'missed': return callList.call.find((e) => e.id === s.ref) || licDemoRef(s.kind, s.ref);
    case 'sms': return callList.sms.find((e) => e.id === s.ref) || licDemoRef(s.kind, s.ref);
    case 'notif': return callList.notif.find((e) => e.id === s.ref) || licDemoRef(s.kind, s.ref);
    case 'chat': return chatSaved.find((e) => e.id === s.ref) || licDemoRef(s.kind, s.ref);
    case 'unlock': case 'sleep': case 'battery': case 'off': case 'net': return s.opt;
  }
  return null;
}
const _seqSmsLock = (e) => !!e.lock;
const _seqNotifLock = (e) => e.present === 'lock';
function _seqColorSpecText(spec) {
  if (!spec) return '';
  if (spec.crossfade < 5) return spec.kelvin + ' K · ' + spec.dimmer + ' %';
  if (spec.crossfade > 95) return 'Roue · ' + spec.dimmer + ' %';
  return 'Mix ' + spec.crossfade + ' % · ' + spec.dimmer + ' %';
}
// Libellé d'une ligne (maquette 28)
function seqStepLabel(s) {
  const it = seqRefItem(s);
  if (!it) return _SEQ_TXT.kindLong[s.kind] + ' — ' + _SEQ_TXT.missing;
  let t;
  switch (s.kind) {
    case 'color': t = _seqTpl(_SEQ_TXT.rowColor, { spec: _seqColorSpecText(it.spec), nom: it.name }); break;
    case 'effect': t = _seqTpl(_SEQ_TXT.rowEffect, { nom: it.name }); break;
    case 'media': t = _seqTpl(_SEQ_TXT.rowMedia, { nom: it.name }); break;
    // Appels, SMS, notifications : nom de l'enregistrement (maquette 43, callEntryName) ;
    // SMS non verrouillé sans nom propre : son texte
    case 'call': t = _seqTpl(_SEQ_TXT.rowCall, { nom: callEntryName(it) }); break;
    case 'sms': t = _seqSmsLock(it) ? _seqTpl(_SEQ_TXT.rowSmsLock, { nom: callEntryName(it) }) : _seqTpl(_SEQ_TXT.rowSms, { texte: it.title || it.msg || it.name || '' }); break;
    case 'notif': t = _seqTpl(_seqNotifLock(it) ? _SEQ_TXT.rowNotifLock : _SEQ_TXT.rowNotif, { nom: callEntryName(it) }); break;
    case 'missed': t = _SEQ_TXT.rowMissed; break;
    case 'unlock': t = _SEQ_TXT['rowUnlock' + it.code]; break;
    case 'chat': t = _seqTpl(it.msgs.some((m) => m.from === 'actor') ? _SEQ_TXT.rowChatReply : _SEQ_TXT.rowChat, { nom: it.contact || it.name }) + (s.opt.full ? _SEQ_TXT.rowChatFull : s.opt.auto ? _SEQ_TXT.rowChatActor : ''); break;
    case 'sleep': t = _SEQ_TXT.rowSleep; break;
    case 'battery': t = _seqTpl(_SEQ_TXT.rowBattery, { n: it.level }); break;
    case 'off': t = _SEQ_TXT.rowOff; break;
    case 'net': t = it.lost ? _SEQ_TXT.rowNetLost : _seqTpl(_SEQ_TXT.rowNetBack, { barres: '▂▄▆█'.slice(0, it.bars), type: it.type }); break;
  }
  const main = seqMainTarget();
  if (main && !_seqSameTarget(main, s.target)) t += _seqTpl(_SEQ_TXT.rowTargetSuffix, { cible: seqTargetName(s.target) });
  return t;
}
function seqTrigBadge(s) {
  const tr = s.trig;
  if (tr.k === 'after') return { cls: 'auto', text: _seqTpl(_SEQ_TXT.trigAfter, { n: tr.s }) };
  if (tr.k === 'gesture') {
    const g = _SEQ_TXT.gestureShort[tr.g];
    return { cls: 'actor', text: tr.t ? _seqTpl(_SEQ_TXT.trigFallback, { geste: g, n: tr.t }) : g };
  }
  return { cls: 'go', text: _SEQ_TXT.trigGo };
}
function _seqWhenText(s) {
  const tr = s.trig;
  if (tr.k === 'after') return _seqTpl(_SEQ_TXT.whenAfter, { n: tr.s });
  if (tr.k === 'gesture') return _seqTpl(tr.t ? _SEQ_TXT.whenGestureFallback : _SEQ_TXT.whenGesture, { geste: _SEQ_TXT.gestureVerb[tr.g], n: tr.t });
  return _SEQ_TXT.whenGo;
}

// ── Cibles ──
const _seqSameTarget = (a, b) => a.k === b.k && (a.k === 'all' || a.id === b.id);
function seqTargetName(t) {
  if (t.k === 'group') { const g = scrGroup(t.id); return g ? g.name : _SEQ_TXT.noScreen; }
  if (t.k === 'screen') return scrKnown(t.id) ? scrName(t.id) : _SEQ_TXT.noScreen;
  return _SEQ_TXT.allScreens;
}
// Écrans d'une étape (aucun repli : une cible disparue ne vise personne)
function seqStepIds(s) {
  const t = s.target;
  if (t.k === 'screen') return scrKnown(t.id) ? [t.id] : [];
  if (t.k === 'group') return scrGroup(t.id) ? scrGroupMembers(t.id) : [];
  return scrList();
}
// Cible principale : celle de la première étape du téléphone, sinon de la première étape
function seqMainTarget() {
  const s = _seq.steps.find((x) => SEQ_PHONE_KINDS.has(x.kind)) || _seq.steps[0];
  return s ? s.target : null;
}
// Écrans dont on attend le geste : ceux de l'étape si elle est du téléphone,
// sinon ceux de la dernière étape du téléphone avant elle (le téléphone que tient le comédien)
function seqGestureIds(i) {
  const s = _seq.steps[i];
  if (!s) return [];
  if (!SEQ_PHONE_KINDS.has(s.kind)) {
    for (let j = i - 1; j >= 0; j--) if (SEQ_PHONE_KINDS.has(_seq.steps[j].kind)) return seqStepIds(_seq.steps[j]);
  }
  return seqStepIds(s);
}

// ── Déroulé ──
// state : idle (pas commencé) · running · stopped · ended (plus d'étape)
// noAuto : après ↶, pas de minuterie (GO ou le geste attendu repartent)
// clockT0 : départ de l'horloge du téléphone (premier GO), pour « L'heure avance »
const _seqRun = { state: 'idle', curId: null, started: new Map(), undo: new Map(), timer: null, tick: null, warn: '', noAuto: false, clockT0: null };
let _seqChain = Promise.resolve();
function seqPos() { return _seqRun.curId ? _seq.steps.findIndex((s) => s.id === _seqRun.curId) : -1; }
function seqPending() { return _seq.steps[seqPos() + 1] || null; }
function _seqQueue(fn) { _seqChain = _seqChain.then(fn).catch((e) => console.warn('SetRemote : séquence', e && e.message)); return _seqChain; }

// Étapes qui allument le strobe ou un effet à flashs rapides
function seqFlashRisk() {
  for (const s of _seq.steps) {
    const it = seqRefItem(s);
    if (!it) continue;
    if (s.kind === 'color' && it.strobe && it.strobe.active && needsFlashWarning('strobe')) return true;
    if (s.kind === 'effect' && needsFlashWarning('effect', it.effect)) return true;
  }
  return false;
}
// GO : lance l'étape suivante, quel que soit son départ (premier GO : avertissement stroboscope)
function seqGo(acked) {
  if (_seqRun.state === 'ended' || !seqPending()) return;
  if (_seqRun.state === 'idle' && !acked && seqFlashRisk()) { openFlashWarning(() => seqGo(true)); return; }
  if (_seqRun.state === 'idle') _seqRun.clockT0 = Date.now(); // l'horloge du téléphone part au premier GO
  _seqRun.state = 'running';
  _seqStartNext();
}
// GO touché sur la télécommande : un second GO dans les 600 ms qui suivent un
// départ d'étape est ignoré (un double toucher ne saute pas d'étape), et une
// vibration courte confirme le départ. Les autres déclencheurs (minuterie,
// geste, console) appellent seqGo directement.
let SEQ_GO_GUARD_MS = 600;
let _seqGoAt = -Infinity;
function seqGoTap() {
  const now = Date.now();
  if (now - _seqGoAt < SEQ_GO_GUARD_MS) return;
  const before = _seqRun.curId;
  seqGo();
  if (_seqRun.curId !== before) { _seqGoAt = now; screenVibrate([20]); } // 80-call-simulator.js : navigator.vibrate ou pont natif
}
function _seqClearTimer() { if (_seqRun.timer) { clearTimeout(_seqRun.timer); _seqRun.timer = null; } }
// Démarre l'étape suivante (GO, minuterie, geste)
function _seqStartNext() {
  _seqClearTimer();
  const i = seqPos() + 1, s = _seq.steps[i];
  if (!s) return;
  _seqRun.curId = s.id;
  _seqRun.noAuto = false;
  _seqRun.started.set(s.id, Date.now());
  if (i === _seq.steps.length - 1) _seqRun.state = 'ended';
  const it = seqRefItem(s), ids = seqStepIds(s);
  if (!it || !ids.length) {
    _seqRun.warn = _seqTpl(_SEQ_TXT.skipped, { n: i + 1, raison: it ? _SEQ_TXT.noScreen : _SEQ_TXT.missing });
    _seqRun.undo.delete(s.id);
  } else _seqRun.warn = '';
  _seqArm();
  renderSeq();
  _seqQueue(async () => {
    if (it && ids.length) await _seqExec(s, it, ids);
    await _seqPushPhones();
  });
}
// Minuterie de l'étape suivante : « Après N s » ou délai de secours d'un geste,
// comptés depuis le départ de l'étape qui vient de démarrer
function _seqArm() {
  _seqClearTimer();
  if (_seqRun.state !== 'running' || _seqRun.noAuto) return;
  const next = seqPending(), cur = _seqRun.curId;
  if (!next) return;
  const sec = next.trig.k === 'after' ? next.trig.s : next.trig.k === 'gesture' ? next.trig.t : 0;
  if (next.trig.k === 'go' || (next.trig.k === 'gesture' && !sec)) return;
  const t0 = (cur && _seqRun.started.get(cur)) || Date.now();
  _seqRun.timer = setTimeout(() => { _seqRun.timer = null; if (_seqRun.state === 'running' && seqPending() === next) _seqStartNext(); }, Math.max(0, sec * 1000 - (Date.now() - t0)));
}
// Geste rapporté par un écran (phone:gesture, chat:sent)
function seqOnGesture(g, sid) {
  if (_seqRun.state !== 'running') return;
  let i = seqPos() + 1;
  let s = _seq.steps[i];
  if (!s) return;
  const from = (j) => !sid || seqGestureIds(j).includes(sid);
  // Le comédien a déverrouillé avant le départ de l'étape « Déverrouillage » : elle est faite
  if (g === 'unlock' && s.kind === 'unlock' && from(i)) {
    _seqStartNext();
    i++; s = _seq.steps[i];
    if (!s || _seqRun.state !== 'running') return;
  }
  if (s.trig.k !== 'gesture' || !from(i)) return;
  const ok = s.trig.g === g || (s.trig.g === 'touch' && (g === 'notif' || g === 'home'));
  if (ok) _seqStartNext();
}
function remoteOnPhoneGesture(m) {
  const sid = _rxFrom && scrKnown(_rxFrom) ? _rxFrom : null;
  if (m.g === 'unlock' && sid) {
    // L'écran s'est déverrouillé lui-même (code complet, glissement) : état tenu à jour
    const p = _seqPhones.get(sid);
    const cfg = _seqUnlockFor(sid);
    if (p && (p.mode === 'locked' || p.mode === 'code')) {
      p.mode = cfg && cfg.then === 'home' ? 'home' : 'unlocked';
      if (p.mode === 'home') p.home = cfg.img || null;
      p.awaitUnlock = null;
      p.sleep = null; // déverrouillé : réveillé pour de bon (maquette 29b)
    }
  }
  // Alerte « Batterie faible » ou « Aucun réseau » fermée sur l'écran : elle ne revient pas
  if (m.g === 'dismiss') {
    const p = sid && _seqPhones.get(sid);
    if (p) p.alert = null;
    _seqQueue(() => _seqPushPhones());
    return;
  }
  seqOnGesture(m.g, sid);
  _seqQueue(() => _seqPushPhones());
  renderSeq();
}
// ↶ : défait l'étape en cours et revient d'une étape (sans minuterie : GO ou le geste attendu repartent)
function seqBack() {
  const i = seqPos();
  if (i < 0) return;
  const s = _seq.steps[i];
  _seqClearTimer();
  _seqRun.curId = i > 0 ? _seq.steps[i - 1].id : null;
  _seqRun.noAuto = true;
  if (_seqRun.state === 'ended') _seqRun.state = 'running';
  if (i === 0) _seqRun.state = 'idle';
  const u = _seqRun.undo.get(s.id);
  _seqRun.undo.delete(s.id);
  _seqRun.started.delete(s.id);
  _seqRun.warn = '';
  renderSeq();
  _seqQueue(async () => {
    if (u) await _seqUndo(s, u);
    await _seqPushPhones();
  });
}
// STOP : minuteries et écoute des gestes arrêtées ; rien n'est éteint
function seqStop() {
  _seqClearTimer();
  if (_seqRun.state === 'running') _seqRun.state = 'stopped';
  renderSeq();
  _seqQueue(() => _seqPushPhones());
}
// Recommencer : téléphone remis à zéro (rien d'affiché), appel et discussion
// de la séquence fermés, retour avant l'étape 1 (couleurs et médias laissés tels quels)
function seqRestart() {
  _seqClearTimer();
  const calls = new Set(), chat = [..._seqRun.undo.values()].some((u) => u.chat);
  for (const u of _seqRun.undo.values()) for (const id of u.callIds || []) calls.add(id);
  _seqRun.state = 'idle'; _seqRun.curId = null; _seqRun.started.clear(); _seqRun.undo.clear(); _seqRun.warn = ''; _seqRun.clockT0 = null;
  for (const p of _seqPhones.values()) Object.assign(p, _seqPhoneBlank(p.style));
  renderSeq();
  _seqQueue(async () => {
    const live = [...calls].filter((id) => scrKnown(id) && scrState(id).call);
    if (live.length) sendMsg({ type: 'call:end', target: { screens: live } });
    if (chat && _chat.open) closeChat();
    licSeqRestarted(); // fil de l'utilisateur rendu (aperçu Séquence, 77-licence-ui.js)
    await _seqPushPhones();
    _seqPhones.clear();
    renderSeq();
  });
}
// Halte quand la télécommande quitte la session (30-navigation.js)
function seqHalt() { _seqClearTimer(); if (_seqRun.state === 'running') _seqRun.state = 'stopped'; }

// ── Exécution des étapes (file : les envois restent dans l'ordre) ──
const _seqTarget = (ids) => ({ screens: ids.slice() });
function _seqSnapLooks(ids) {
  const m = new Map();
  for (const id of ids) {
    const st = scrState(id);
    m.set(id, { color: st.color, colorSpec: _scrClone(st.colorSpec), strobe: _scrClone(st.strobe), effect: _scrClone(st.effect), media: st.media, endMode: st.endMode });
  }
  return m;
}
function _seqSnapPhones(ids) {
  const m = new Map();
  for (const id of ids) m.set(id, _seqPhones.has(id) ? JSON.parse(JSON.stringify(_seqPhones.get(id))) : null);
  return m;
}
function _seqStrobeMsg(st) {
  if (!st || !st.active) return { type: 'strobe', active: false };
  return { type: 'strobe', active: true, torch: !!st.torch, random: !!st.random, freq: st.freq, dur: st.dur, freqMin: st.freq, freqMax: st.freqMax, durMin: st.dur, durMax: st.durMax };
}
// L'interface montre la cible : rechargée si l'étape l'a touchée
function _seqRefreshView(ids) { if (ids.some(scrInTarget)) scrLoadView(); }

async function _seqExec(s, it, ids) {
  const t = _seqTarget(ids);
  const u = { looks: null, phones: _seqSnapPhones(ids), callIds: null, banner: null, chat: false };
  _seqRun.undo.set(s.id, u);
  // Écrans de l'étape : la barre d'état de la séquence s'y affiche désormais
  for (const id of ids) _seqPhone(id);
  const on = (id) => _seqPhones.get(id).power !== 'off';
  switch (s.kind) {
    case 'color': {
      u.looks = _seqSnapLooks(ids);
      sendMsg({ type: 'color', color: memorySwatch(it.spec), target: t });
      for (const id of ids) scrState(id).colorSpec = _scrClone(it.spec);
      if (it.strobe) sendMsg(Object.assign(_seqStrobeMsg(it.strobe), { target: t }));
      _seqRefreshView(ids);
      break;
    }
    case 'effect':
      u.looks = _seqSnapLooks(ids);
      sendMsg({ type: 'effect', name: it.effect, active: true, params: _scrClone(it.params || {}), target: t });
      _seqRefreshView(ids);
      break;
    case 'media':
      u.looks = _seqSnapLooks(ids);
      if (it.kind === 'vid') sendMsg({ type: 'media:endmode', mode: s.opt.end, target: t });
      _vidStopJobs(ids);
      mediaShowOn(it, ids);
      _seqRefreshView(ids);
      break;
    case 'call': {
      // Téléphone éteint : l'appel n'arrive pas ; sans réseau : « Appel impossible » (maquette 34)
      const ring = [], fail = [], failBanner = [];
      for (const id of ids) {
        const p = _seqPhones.get(id);
        if (!on(id)) continue;
        if (phoneBarNoNetwork(p.bar)) (p.mode === 'unlocked' || p.mode === 'home' ? failBanner : fail).push(id);
        else ring.push(id);
      }
      if (fail.length) _seqStack(fail, { kind: 'missed', app: _SEQ_TXT.missedApp, name: _SEQ_TXT.noCallTitle, msg: _SEQ_TXT.noCallMsg, color: null, style: it.style }, null);
      if (failBanner.length) {
        u.banner = failBanner;
        sendMsg({ type: 'call:start', kind: 'notif', style: _CALL_STYLE_HINTS[it.style] ? it.style : 'glass', appName: _SEQ_TXT.missedApp, name: _SEQ_TXT.noCallTitle, msg: _SEQ_TXT.noCallMsg,
          ring: 'silent', present: 'banner', received: { mode: 'now' }, target: _seqTarget(failBanner) });
      }
      if (ring.length) { u.callIds = ring; await sendCallEntry(it, [_seqTarget(ring)]); }
      break;
    }
    case 'sms': case 'notif': {
      const stack = [], banner = [], silent = [];
      const lockEntry = s.kind === 'sms' ? _seqSmsLock(it) : _seqNotifLock(it);
      for (const id of ids) {
        const p = _seqPhones.get(id);
        const mode = p ? p.mode : 'off';
        if (!on(id)) silent.push(id); // éteint : gardée pour le rallumage, sans son
        else if (mode === 'locked' || mode === 'code' || (mode === 'off' && lockEntry)) stack.push(id); else banner.push(id);
      }
      // Maquette 44 : SMS sur la couleur de son app (pastille de l'onglet Tel), notification avec son icône importée
      const card = Object.assign({
        kind: s.kind, app: _seqLine(it.appName, 24) || (s.kind === 'sms' ? _SEQ_TXT.smsApp : ''), name: _seqLine(it.name, 40), msg: String(it.msg || '').slice(0, 200),
        color: s.kind === 'sms' ? safeHexColor(it.appColor, SEQ_SMS_COLOR) : null, style: it.style,
      }, s.kind === 'notif' ? await _seqEntryImg(it) : null);
      if (silent.length) _seqStack(silent, card, null);
      if (stack.length) {
        const f = ringMsgFields(it.ringId || it.ring, it.ringVolume);
        if (f.ringId) await ensureCallAssets(null, null, [f.ringId], stack);
        _seqStack(stack, card, { ring: f.ring, ringId: f.ringId || null, vol: f.ringVolume === undefined ? 1 : f.ringVolume, vib: it.vib === true });
      }
      if (banner.length) {
        u.banner = banner;
        const e = Object.assign({}, it, s.kind === 'sms' ? { lock: null } : { present: 'banner' });
        await sendCallEntry(e, [_seqTarget(banner)]);
      }
      break;
    }
    case 'missed': {
      // Appel encore en cours sur ces écrans (étape « Appel » restée sans réponse) : il cesse de sonner
      const live = ids.filter((id) => scrState(id).call);
      if (live.length) sendMsg({ type: 'call:end', target: _seqTarget(live) });
      // Maquette 44 : avatar aux initiales de l'appelant, ou la photo de l'appel
      const who = _seqLine(it.name || 'Inconnu', 40);
      const card = Object.assign({ kind: 'missed', app: _SEQ_TXT.missedApp, name: _SEQ_TXT.missedTitle, msg: who, who, color: null, style: it.style }, await _seqEntryImg(it));
      const off = ids.filter((id) => !on(id));
      if (off.length) _seqStack(off, card, null);
      const lit = ids.filter(on);
      if (lit.length) _seqStack(lit, card, { ring: 'classic', ringId: null, vol: 1, vib: it.vib === true }); // vibreur de l'appel manqué
      break;
    }
    case 'unlock':
      for (const id of ids) {
        const p = _seqPhone(id, 'glass');
        if (p.mode === 'off') p.mode = 'locked';
        if (p.mode === 'locked' || p.mode === 'code') { p.awaitUnlock = s.id; if (it.code) p.mode = 'code'; }
      }
      break;
    case 'chat':
      u.chat = true;
      for (const id of ids) {
        const p = _seqPhones.get(id);
        if (p && p.mode !== 'off') { p.mode = 'unlocked'; p.awaitUnlock = null; p.sleep = null; }
      }
      await _seqOpenChat(it, ids);
      // Lecture auto (maquettes 26d, 41) : durées enregistrées, sans attendre « Envoyer » ;
      // tout automatique : les réponses du comédien s'écrivent et partent toutes seules
      if (s.opt.auto && _chat.open) chatAutoStart(true, s.opt.full);
      break;
    case 'sleep':
      // Veille (maquette 29b) : verrouillé, écran noir ; rallume un téléphone éteint
      for (const id of ids) {
        const p = _seqPhones.get(id);
        p.power = 'on';
        if (p.mode !== 'code') p.mode = 'locked';
        if (p.mode === 'locked' && p.home && !p.awaitUnlock) p.home = null;
        p.sleep = { notif: it.notif, touch: it.touch, after: it.after };
      }
      break;
    case 'battery':
      // Batterie faible (maquette 33) : alerte, niveau affiché, icône rouge
      for (const id of ids) {
        const p = _seqPhones.get(id);
        p.bar.bat.level = it.level; p.bar.bat.charging = false; p.bar.bat.low = true;
        if (!on(id)) continue;
        if (p.mode === 'off') p.mode = 'locked';
        p.alert = { id: _seqAlertId(), level: it.level };
      }
      break;
    case 'off': {
      // Extinction (maquette 33) : appel en cours coupé, alerte oubliée, plus rien ne répond
      const live = ids.filter((id) => scrState(id).call);
      if (live.length) sendMsg({ type: 'call:end', target: _seqTarget(live) });
      for (const id of ids) { const p = _seqPhones.get(id); p.power = 'off'; p.alert = null; }
      break;
    }
    case 'net':
      // Réseau (maquette 34) : perdu (« Pas de service », ni Wi-Fi) ou rétabli.
      // Perdu alors qu'il y en avait (maquette 44b) : alerte « Aucun réseau », une
      // fois ; en mode avion (choisi au départ), pas d'alerte. Rétabli : retirée.
      for (const id of ids) {
        const p = _seqPhones.get(id), n = p.bar.net;
        const had = !phoneBarNoNetwork(p.bar);
        if (it.lost) { n.bars = 0; n.wifi = false; } else { n.bars = it.bars; n.type = it.type; n.wifi = it.wifi; n.plane = false; }
        if (it.lost && had && !n.plane && on(id)) {
          if (p.mode === 'off') p.mode = 'locked';
          p.alert = { id: _seqAlertId(), kind: 'net' };
        } else if (!it.lost && p.alert && p.alert.kind === 'net') p.alert = null;
      }
      break;
  }
}
// Téléphone neuf (aucune étape jouée) : la barre part des réglages « Téléphone au départ »
function _seqPhoneBlank(style) {
  return { mode: 'off', style: _CALL_STYLE_HINTS[style] ? style : 'glass', notifs: [], home: null, awaitUnlock: null,
    bar: JSON.parse(JSON.stringify(seqPhoneCfg())), sleep: null, alert: null, power: 'on' };
}
function _seqPhone(id, style) {
  let p = _seqPhones.get(id);
  if (!p) { p = _seqPhoneBlank(style); _seqPhones.set(id, p); }
  return p;
}
let _seqNotifN = 0;
const _seqAlertId = () => 'a' + Date.now().toString(36).slice(-5) + (++_seqNotifN).toString(36);
// Couleur des SMS sans pastille réglée (comme l'onglet Tel, 80-call-simulator.js)
const SEQ_SMS_COLOR = '#2f8cf0';
// Icône importée d'une notification / photo d'un appel enregistré : id préparé
// (__ph_…, dérivé du contenu, 82-call-list.js) et clé IndexedDB ; {} sans image
async function _seqEntryImg(e) {
  if (!e || !e.hasPhoto || !e.id) return {};
  try {
    const a = await callEntryAssets(e);
    if (!a.photo) return {};
    const ids = await callEntryPrepIds(e, a);
    return ids.photo ? { img: ids.photo, imgKey: e.id + ':photo' } : {};
  } catch (_) { return {}; }
}
// Images des notifications empilées vers cet écran s'il ne les a pas (chacune à
// sa place en cache) ; rend celles qu'il a ou vient de recevoir
async function _seqEnsureNotifImgs(sid, p) {
  const ok = new Set();
  for (const n of p.notifs.slice(-PROTO.PHONE_NOTIFS_MAX)) {
    if (!n.img || ok.has(n.img)) continue;
    if (scrState(sid).cached.has(n.img)) { ok.add(n.img); continue; } // contenu identique à l'id près
    const data = safeImageData(await callAssetGet(n.imgKey));
    if (!data) continue; // entrée supprimée depuis : la lettre / les initiales
    await ensureSlotImage(n.img, data, [sid]);
    ok.add(n.img);
  }
  return ok;
}
// Notification empilée sur l'écran verrouillé de ces écrans (la plus récente en haut)
function _seqStack(ids, n, chime) {
  const id = 'n' + Date.now().toString(36).slice(-5) + (++_seqNotifN).toString(36);
  for (const sid of ids) {
    const p = _seqPhone(sid, n.style);
    if (!p.notifs.length && p.mode === 'off') p.style = _CALL_STYLE_HINTS[n.style] ? n.style : 'glass'; // style du premier écran verrouillé
    if (p.mode === 'off') p.mode = 'locked'; // déjà déverrouillé : rangée dans la pile, visible au reverrouillage
    p.notifs.push(Object.assign({ id, kind: n.kind, app: n.app, name: n.name, msg: n.msg, color: n.color, at: Date.now() }, n.unsent ? { unsent: n.unsent } : {},
      n.who ? { who: n.who } : {}, n.img ? { img: n.img, imgKey: n.imgKey } : {}));
    if (p.notifs.length > PROTO.PHONE_NOTIFS_MAX) p.notifs.shift();
    if (chime) p.chime = Object.assign({ id }, chime); else delete p.chime;
  }
}
// Discussion enregistrée chargée dans « Fil en cours » (83 / 89) et ouverte sur ces écrans.
// Les messages du contact qui précèdent la première réponse du comédien sont
// déjà reçus (affichés comme historique) : le comédien n'a plus qu'à répondre.
async function _seqOpenChat(e, ids) {
  licSeqDemoChat(); // aperçu Séquence, Tel sous licence : fil de l'utilisateur mis de côté (77-licence-ui.js)
  const photo = e.hasPhoto ? safeImageData(await callAssetGet(_chsvPhotoKey(e.id))) : null;
  if (_chat.open) closeChat();
  _chat.name = e.contact; _chat.actor = e.actor; _chat.style = e.style;
  _chat.msgs = e.msgs.map((m) => chatMsgCopy(m));
  const first = _chat.msgs.findIndex((m) => m.from === 'actor');
  _chat.sent = (first < 0 ? [] : _chat.msgs.slice(0, first)).filter(_chatValid).map((m) => m.id);
  _chat.progress = null; _chat.resumeAt = null; _chat.savedId = e.id; _chat.pend = [];
  _chatEditId = null;
  _chatAvatar = photo;
  _lsSet(CHAT_AVATAR_KEY, photo);
  _chatDefsSent.clear();
  _chat.screens = ids.slice();
  _chat.open = true;
  _chatSendRing(); // son des messages importé (83-discussion.js)
  _chatSyncTexts(undefined, true);
  chatSave();
  if (callKind === 'discussion') chatShowForm(true);
  scrChanged();
  if (_chatAvatar) { await _chatSendAvatar(); if (_chat.open) _chatSendOpen(); }
}
// Réponse du comédien dans la discussion (83-discussion.js)
function seqOnChatSent(sid) { seqOnGesture('chat', sid); renderSeq(); }

async function _seqUndo(s, u) {
  // Téléphone d'avant l'étape
  for (const [id, p] of u.phones) {
    if (p) _seqPhones.set(id, p); else if (_seqPhones.has(id)) Object.assign(_seqPhones.get(id), _seqPhoneBlank(_seqPhones.get(id).style));
  }
  if (u.looks) {
    for (const [id, l] of u.looks) {
      const t = { screens: [id] };
      if (s.kind === 'color') {
        sendMsg({ type: 'color', color: l.color, target: t });
        scrState(id).colorSpec = l.colorSpec;
        sendMsg(Object.assign({}, l.strobe ? l.strobe : { type: 'strobe', active: false }, { target: t }));
      } else if (s.kind === 'effect') {
        sendMsg(l.effect ? { type: 'effect', name: l.effect.name, active: true, params: l.effect.params, target: t } : { type: 'effect', name: null, active: false, target: t });
      } else if (s.kind === 'media') {
        const it = l.media ? _mediaPool.find((m) => m.id === l.media) : null;
        if (it) { sendMsg({ type: 'media:endmode', mode: l.endMode, target: t }); mediaShowOn(it, [id]); }
        else sendMsg({ type: 'media-stop', target: t });
      }
    }
    _seqRefreshView([...u.looks.keys()]);
  }
  const ends = [...(u.callIds || []), ...(u.banner || [])].filter((id) => scrKnown(id) && scrState(id).call);
  if (ends.length) sendMsg({ type: 'call:end', target: { screens: ends } });
  if (u.chat && _chat.open) closeChat();
}

// ── Faux téléphone : état par écran, envoyé en entier (phone:state) ──
const _seqPhones = new Map();    // screenId → { mode, style, notifs, home (empreinte), awaitUnlock, chime? }
const _seqPhoneSent = new Map(); // screenId → signature du dernier état envoyé
function _seqStepById(id) { return _seq.steps.find((s) => s.id === id) || null; }
// Déverrouillage attendu sur cet écran : celui en cours, sinon l'étape suivante si c'en est un
function _seqUnlockFor(sid) {
  const p = _seqPhones.get(sid);
  if (p && p.awaitUnlock) { const s = _seqStepById(p.awaitUnlock); if (s) return s.opt; }
  if (_seqRun.state !== 'running') return null;
  const n = seqPending();
  return n && n.kind === 'unlock' && seqStepIds(n).includes(sid) ? n.opt : null;
}
function _seqWatchFor(sid) {
  if (_seqRun.state !== 'running') return [];
  const ph = _seqPhones.get(sid);
  if (ph && ph.power === 'off') return []; // éteint : plus aucun geste
  const i = seqPos() + 1, n = _seq.steps[i];
  if (!n || n.trig.k !== 'gesture' || n.trig.g === 'chat' || n.trig.g === 'unlock') return [];
  return seqGestureIds(i).includes(sid) ? [n.trig.g] : [];
}
async function _seqHomeData(sig) {
  return sig ? safeImageData(await callAssetGet(seqHomeKey(sig))) : null;
}
// Image d'accueil vers cet écran s'il ne l'a pas (emplacement unique __seqhome)
async function _seqEnsureHome(sid, sig) {
  const data = await _seqHomeData(sig);
  if (data) await ensureSlotImage('__seqhome', data, [sid]);
  return !!data;
}
// Fond d'écran de la séquence (maquette 42) vers cet écran s'il ne l'a pas (emplacement unique __seqwall)
async function _seqEnsureWall(sid, sig) {
  const data = await _seqHomeData(sig);
  if (data) await ensureSlotImage('__seqwall', data, [sid]);
  return !!data;
}
function _seqPhoneMsg(sid, homeOk, wallOk, imgOk) {
  const p = _seqPhones.get(sid) || { mode: 'off', style: 'glass', notifs: [] };
  const u = _seqUnlockFor(sid);
  const now = Date.now();
  const m = {
    type: 'phone:state', target: { screens: [sid] },
    mode: p.mode === 'code' && !(u && u.code) ? 'locked' : p.mode, style: p.style,
    notifs: p.notifs.slice(-PROTO.PHONE_NOTIFS_MAX).map((n) => Object.assign({ id: n.id, kind: n.kind, app: n.app, name: n.name, ago: Math.max(0, Math.min(PROTO.PHONE_AGO_MAX, Math.round((now - n.at) / 1000))) },
      n.msg ? { msg: n.msg } : {}, n.color ? { color: n.color } : {}, n.who ? { who: n.who } : {}, n.img && imgOk && imgOk.has(n.img) ? { img: n.img } : {})),
  };
  if (u) m.unlock = { code: u.code, then: u.then };
  if (homeOk) m.home = true;
  if (wallOk) m.wall = true;
  const w = _seqWatchFor(sid);
  if (w.length) m.watch = w;
  // Barre d'état, veille, batterie, extinction : de la séquence commencée seulement
  if (_seqRun.state !== 'idle' && p.bar) {
    m.bar = phoneBarMsg(p.bar, _seqRun.clockT0 || now, now);
    if (p.power === 'off') m.power = 'off';
    if (p.sleep && (m.mode === 'locked' || m.mode === 'code')) m.sleep = Object.assign({}, p.sleep);
    if (p.alert && p.power !== 'off') m.alert = Object.assign({}, p.alert);
  }
  return m;
}
// Envoie l'état des écrans dont il a changé (force : tous ceux qu'il concerne, resynchronisation)
async function _seqPushPhones(only, force) {
  _seqDeliverPending();
  const sids = new Set([..._seqPhones.keys(), ..._seqPhoneSent.keys()]);
  const i = seqPos() + 1;
  if (_seqRun.state === 'running' && _seq.steps[i]) for (const id of seqGestureIds(i)) sids.add(id);
  for (const sid of sids) {
    if (only && !only.includes(sid)) continue;
    if (!scrKnown(sid)) continue;
    const p = _seqPhones.get(sid);
    const u = _seqUnlockFor(sid);
    const homeSig = p && p.mode === 'home' ? p.home : u && u.then === 'home' ? u.img : null;
    const homeOk = homeSig ? await _seqEnsureHome(sid, homeSig) : false;
    const wallSig = p && _seq.wall ? _seq.wall.img : null;
    const wallOk = wallSig ? await _seqEnsureWall(sid, wallSig) : false;
    const imgOk = p ? await _seqEnsureNotifImgs(sid, p) : null;
    const m = _seqPhoneMsg(sid, homeOk, wallOk, imgOk);
    const chime = p && p.chime && m.notifs.some((n) => n.id === p.chime.id) ? p.chime : null;
    if (p) delete p.chime;
    const b = m.bar;
    const sig = JSON.stringify([m.mode, m.style, m.notifs.map((n) => n.id + (n.img ? '/' + n.img : '')), m.unlock, m.home, m.wall, m.watch,
      b ? [b.clock.mode, b.clock.date, b.clock.time, b.net, b.bat] : null, m.sleep, m.alert, m.power]);
    if (!force && !chime && _seqPhoneSent.get(sid) === sig) continue;
    if (!p && !m.watch && !_seqPhoneSent.has(sid)) continue; // rien à dire à cet écran
    _seqPhoneSent.set(sid, sig);
    if (chime && !force && m.power !== 'off') m.chime = Object.assign({ id: chime.id, ring: chime.ring }, chime.ringId ? { ringId: chime.ringId } : {}, chime.vol < 1 ? { vol: chime.vol } : {}, chime.vib ? { vib: true } : {});
    sendMsg(m);
    if (m.mode === 'off' && !m.watch && !m.bar) _seqPhoneSent.delete(sid);
  }
}
// Messages du comédien restés « Non distribué » : partent dès que les écrans de
// la discussion ont du réseau (étape « Réseau » rétabli, ↶, séquence finie)
function _seqDeliverPending() {
  if (!_chat.pend || !_chat.pend.length) return;
  const scr = _chat.screens || scrList();
  const down = _seqRun.state !== 'idle' && scr.some((id) => { const p = _seqPhones.get(id); return !!p && phoneBarNoNetwork(p.bar); });
  if (down) return;
  for (const p of _seqPhones.values()) p.notifs = p.notifs.filter((n) => !n.unsent);
  chatDeliverPending(); // 83-discussion.js
}
// Message du comédien envoyé sans réseau (83-discussion.js) : « Message non envoyé »
// empilé sur le faux téléphone de cet écran (visible sur l'écran verrouillé)
function seqOnChatUndelivered(sid, msg) {
  const p = sid && _seqPhones.get(sid);
  if (!p || _seqRun.state === 'idle') return;
  const text = _seqLine(msg.text, 160);
  _seqStack([sid], { kind: 'sms', app: _SEQ_TXT.smsApp, name: _SEQ_TXT.unsentTitle, msg: _seqTpl(_SEQ_TXT.unsentMsg, { texte: text }).slice(0, 200), color: null, style: p.style, unsent: msg.id }, null);
  _seqQueue(() => _seqPushPhones());
}
// Resynchronisation (24-resync.js) : écrans revenus, rechargés
function seqOnScreensResync(ids) {
  const l = ids.filter((id) => _seqPhones.has(id) || _seqPhoneSent.has(id) || _seqWatchFor(id).length);
  if (l.length) _seqQueue(() => _seqPushPhones(l, true));
}

// ── Images d'accueil et fonds d'écran : IndexedDB, clé dérivée du contenu (partagée entre séquences) ──
function seqHomeKey(sig) { return 'seqhome-' + sig + ':photo'; }
function seqImageSig(data) { return _chsvPhotoSig(data); }
// Images encore utilisées (séquence en cours et enregistrées) : les autres sont effacées
function seqGcImages(dropped) {
  const used = new Set();
  const scan = (steps, wall) => { for (const s of steps) if (s.kind === 'unlock' && s.opt.img) used.add(s.opt.img); if (wall) used.add(wall.img); };
  scan(_seq.steps, _seq.wall);
  if (typeof seqSaved !== 'undefined') for (const e of seqSaved) scan(e.steps, e.wall);
  if (_seqEdit && _seqEdit.step.kind === 'unlock' && _seqEdit.step.opt.img) used.add(_seqEdit.step.opt.img);
  for (const sig of dropped) if (sig && !used.has(sig)) callAssetDelete(seqHomeKey(sig));
}

// ── Rendu de la liste (maquette 28) ──
let _seqView = 'cur';
function _seqSet(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function renderSeq() {
  if (mode !== 'remote') return;
  const rows = document.getElementById('seqRows');
  if (!rows) return;
  const pos = seqPos();
  rows.textContent = '';
  _seq.steps.forEach((s, i) => {
    const row = document.createElement('div');
    const missing = !seqRefItem(s);
    row.className = 'sq-row' + (i < pos ? ' done' : '') + (i === pos ? ' cur' : '') + (i === pos + 1 && _seqRun.state !== 'ended' ? ' next' : '') + (missing ? ' missing' : '');
    row.dataset.id = s.id;
    row.onclick = () => openSeqStep(s.id);
    const b = seqTrigBadge(s);
    const num = document.createElement('span'); num.className = 'sq-num'; num.textContent = String(i + 1);
    const ic = document.createElement('span'); ic.className = 'sq-ic'; ic.textContent = SEQ_ICONS[s.kind];
    const lb = document.createElement('span'); lb.className = 'sq-label'; lb.textContent = seqStepLabel(s);
    const bd = document.createElement('span'); bd.className = 'sq-badge ' + b.cls; bd.textContent = b.text;
    row.append(num, ic, lb, bd);
    rows.appendChild(row);
    // Discussion en cours (maquette 40) : où en est le fil, sous son étape
    if (i === pos && s.kind === 'chat' && (_seqRun.state === 'running' || _seqRun.state === 'ended')) {
      const st = document.createElement('div'); st.className = 'sq-chat'; st.id = 'seqChatStatus';
      rows.appendChild(st);
    }
  });
  seqRenderChatStatus();
  const empty = document.getElementById('seqEmpty');
  if (empty) empty.style.display = _seq.steps.length ? 'none' : '';
  rows.style.display = _seq.steps.length ? '' : 'none';
  _seqSet('seqName', _seq.name || _SEQ_TXT.untitled);
  _seqSet('seqPhoneSum', phoneParamsSummary(seqPhoneCfg())); // 98-phone-params.js
  const main = seqMainTarget();
  _seqSet('seqTarget', main ? _seqTpl(_SEQ_TXT.target, { cible: seqTargetName(main) }) : '');
  const add = document.getElementById('seqAddBtn');
  if (add) add.disabled = _seq.steps.length >= SEQ_STEPS_MAX;
  _seqRenderNow();
  const go = document.getElementById('seqGoBtn'), back = document.getElementById('seqBackBtn'), stop = document.getElementById('seqStopBtn');
  if (go) go.disabled = !seqPending() || _seqRun.state === 'ended';
  if (back) back.disabled = pos < 0;
  if (stop) stop.disabled = _seqRun.state !== 'running';
  const w = document.getElementById('seqWarn');
  if (w) { w.textContent = _seqRun.warn; w.style.display = _seqRun.warn ? '' : 'none'; }
  if (typeof renderSavedSeqs === 'function') renderSavedSeqs();
  // Durée affichée « depuis N s » : rafraîchie chaque seconde pendant le déroulé
  const live = pos >= 0 && (_seqRun.state === 'running' || _seqRun.state === 'ended');
  if (live && !_seqRun.tick) _seqRun.tick = setInterval(_seqRenderNow, 1000);
  if (!live && _seqRun.tick) { clearInterval(_seqRun.tick); _seqRun.tick = null; }
}
function seqRenderChatStatus() {
  const box = document.getElementById('seqChatStatus');
  if (!box) return;
  box.textContent = '';
  if (!_chat.open) return;
  const info = _chatAutoInfo(), m = _chatNextMsg(); // 83-discussion.js
  const add = (cls, text) => { const d = document.createElement('div'); d.className = cls; if (text) d.textContent = text; box.appendChild(d); return d; };
  add('sq-chat-st' + (info.live ? ' on' : ''), info.text);
  if (m) add('sq-chat-next', _seqTpl(_SEQ_TXT.chatNext, { qui: m.from === 'actor' ? (_chat.actor || 'Comédien') : (_chat.name || 'Contact'), texte: m.text }));
  const bar = add('sq-chat-bar'), fill = document.createElement('i');
  fill.style.width = info.pct + '%';
  bar.appendChild(fill);
}
function _seqRenderNow() {
  const box = document.getElementById('seqNow');
  if (!box) return;
  box.textContent = '';
  const pos = seqPos(), cur = _seq.steps[pos], next = seqPending();
  const line = (cls) => { const d = document.createElement('div'); if (cls) d.className = cls; box.appendChild(d); return d; };
  if (!_seq.steps.length) { box.style.display = 'none'; return; }
  box.style.display = '';
  if (!cur) {
    line().textContent = _seqTpl(_SEQ_TXT.ready, { nom: _SEQ_TXT.kindLong[_seq.steps[0].kind] });
  } else {
    const l1 = line();
    l1.append(_SEQ_TXT.nowLabel);
    const b = document.createElement('b'); b.textContent = (pos + 1) + ' · ' + _SEQ_TXT.kindLong[cur.kind]; l1.appendChild(b);
    const t0 = _seqRun.started.get(cur.id);
    if (t0 && _seqRun.state !== 'stopped') {
      const n = Math.max(0, Math.floor((Date.now() - t0) / 1000));
      let tpl = _SEQ_TXT.nowSince;
      if (cur.kind === 'call') {
        const st = seqStepIds(cur).map((id) => scrState(id).call).find(Boolean);
        tpl = st && st.state === 'incall' ? _SEQ_TXT.nowInCall : st ? _SEQ_TXT.nowRinging : _SEQ_TXT.nowSince;
      }
      l1.append(_seqTpl(tpl, { n }));
    }
    const l2 = line('sq-now-next');
    if (_seqRun.state === 'stopped') l2.textContent = _SEQ_TXT.stopped;
    else if (next) l2.textContent = _seqTpl(_SEQ_TXT.next, { n: pos + 2, nom: _SEQ_TXT.kindLong[next.kind], quand: _seqWhenText(next) });
    else l2.textContent = _SEQ_TXT.ended;
  }
  if (cur && _seqRun.state !== 'running') {
    const r = document.createElement('button');
    r.type = 'button'; r.className = 'sq-restart'; r.id = 'seqRestartBtn'; r.textContent = _SEQ_TXT.restart;
    r.onclick = seqRestart;
    box.appendChild(r);
  }
}
function setSeqView(v) {
  _seqView = v === 'saved' ? 'saved' : 'cur';
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('seqCurView', _seqView === 'cur');
  show('seqSavedView', _seqView === 'saved');
  for (const k of ['cur', 'saved']) { const b = document.getElementById('seqTab-' + k); if (b) b.classList.toggle('active', _seqView === k); }
  renderSeq();
}

// ── Éditeur d'étape (maquette 29) ──
let _seqEdit = null; // { id (null : nouvelle), step (brouillon), err }
function openSeqStep(id) {
  if (licLocked('seq')) return; // aperçu sans licence (77-licence-ui.js)
  if (_seqSuppressClick) return;
  const s = id ? _seq.steps.find((x) => x.id === id) : null;
  if (id && !s) return;
  if (!s && _seq.steps.length >= SEQ_STEPS_MAX) return;
  const last = _seq.steps[_seq.steps.length - 1];
  const draft = s ? JSON.parse(JSON.stringify(s)) : { id: _seqNewId(), kind: 'color', ref: null, target: last ? Object.assign({}, last.target) : _seqSanTarget(scrTarget()), trig: { k: 'go' }, opt: {} };
  if (s) Object.assign(draft, seqSanitizeStep(draft) || {}); // réglages complétés (anciennes étapes)
  _seqEdit = { id: s ? s.id : null, step: draft, err: '' };
  if (!s) _seqEditDefaults(draft);
  const v = document.getElementById('seq-step-view');
  if (v) { v.style.display = 'flex'; v.scrollTop = 0; }
  renderSeqStep();
  _seqEdit.orig = JSON.stringify(_seqEdit.step); // brouillon de départ : « modifié ? » à la sortie
}
function seqStepDirty() { return !!_seqEdit && JSON.stringify(_seqEdit.step) !== _seqEdit.orig; }
// « ← Séquence » et ANNULER (nouvelle étape) : le brouillon modifié n'est
// abandonné qu'après confirmation
function seqStepLeave() {
  if (!_seqEdit) return;
  if (!seqStepDirty()) { closeSeqStep(); return; }
  openAppConfirm({ title: _seqEdit.id ? _SEQ_TXT.leaveTitle : _SEQ_TXT.leaveNewTitle, text: _SEQ_TXT.leaveText, ok: _SEQ_TXT.leaveOk, cancel: _SEQ_TXT.leaveCancel }, closeSeqStep);
}
function closeSeqStep() {
  const e = _seqEdit;
  _seqEdit = null;
  const v = document.getElementById('seq-step-view');
  if (v) v.style.display = 'none';
  // Image choisie pour un brouillon abandonné : effacée si rien ne s'en sert
  if (e && e.step.kind === 'unlock' && e.step.opt.img) seqGcImages([e.step.opt.img]);
}
// Valeurs par défaut d'un type : premier élément de la liste, réglages propres
function _seqEditDefaults(s) {
  s.ref = null;
  if (s.kind === 'media') { const it = _mediaPool[0]; s.ref = it ? { id: it.id, name: it.name, kind: it.kind } : null; s.opt = { end: 'loop' }; }
  else if (s.kind === 'unlock') s.opt = { code: 4, then: 'app', img: null, imgName: '' };
  else if (SEQ_OPT_KINDS.has(s.kind)) s.opt = seqSanitizeStep({ id: s.id, kind: s.kind, opt: {} }).opt;
  else {
    s.opt = {};
    const list = _seqRefList(s.kind);
    s.ref = list.length ? list[0].id : null;
    if (s.kind === 'chat') s.opt = { auto: false, full: false };
  }
}
// Éléments proposés pour un type : [{ id, label, sw (couleur d'aperçu) }]
function _seqRefList(kind) {
  switch (kind) {
    case 'color': return colorMemories.map((m) => ({ id: m.id, label: m.name, sw: memorySwatch(m.spec) }));
    case 'effect': return fxMemories.filter((m) => EFFECT_CONFIG[m.effect]).map((m) => ({ id: m.id, label: (EFFECT_CONFIG[m.effect].icon || '') + ' ' + m.name }));
    case 'media': return _mediaPool.map((m) => ({ id: m.id, label: (m.kind === 'vid' ? '🎬 ' : '🖼 ') + m.name }));
    case 'call': case 'missed': case 'sms': case 'notif':
      return callList[kind === 'missed' ? 'call' : kind].map((e, i) => ({ id: e.id, label: (i + 1) + ' · ' + callEntryName(e) })); // nom de l'enregistrement (maquette 43)
    case 'chat': return chatSaved.map((e) => ({ id: e.id, label: e.name }));
  }
  return [];
}
const _seqRefLabels = { color: 'labelColor', effect: 'labelEffect', media: 'labelMedia', call: 'labelCall', missed: 'labelCall', sms: 'labelSms', notif: 'labelNotif', chat: 'labelChat' };
function _seqOpt(on, fn, label, extra) {
  return '<button type="button" class="ss-opt' + (on ? ' on' : '') + (extra || '') + '" onclick="' + fn + '">' + escapeHtml(label) + '</button>';
}
const _seqArg = (v) => '\'' + String(v).replace(/[^A-Za-z0-9_-]/g, '') + '\'';
function renderSeqStep() {
  const e = _seqEdit;
  const v = document.getElementById('seq-step-view');
  if (!e || !v) return;
  const s = e.step;
  const idx = e.id ? _seq.steps.findIndex((x) => x.id === e.id) : -1;
  _seqSet('ssTitle', idx >= 0 ? _seqTpl(_SEQ_TXT.stepTitle, { n: idx + 1 }) : _SEQ_TXT.stepNew);
  // Type (maquette 29b : 3, 3, 4, puis les étapes du téléphone)
  document.getElementById('ssKinds').innerHTML = SEQ_KIND_ROWS.map((r) => '<div class="ss-row">'
    + r.map((k) => _seqOpt(s.kind === k, 'seqEditKind(' + _seqArg(k) + ')', SEQ_ICONS[k] + ' ' + _SEQ_TXT.kind[k])).join('') + '</div>').join('');
  // Élément enregistré, ou réglages du déverrouillage
  let h = '';
  if (s.kind === 'sleep' || s.kind === 'battery' || s.kind === 'off' || s.kind === 'net') {
    h += _seqPhoneStepCard(s);
  } else if (s.kind === 'unlock') {
    const o = s.opt;
    h += '<span class="ss-label">' + escapeHtml(_SEQ_TXT.labelUnlock) + '</span><div class="ss-row">'
      + _seqOpt(o.code === 4, 'seqEditCode(4)', _SEQ_TXT.code4) + _seqOpt(o.code === 6, 'seqEditCode(6)', _SEQ_TXT.code6) + _seqOpt(o.code === 0, 'seqEditCode(0)', _SEQ_TXT.swipe) + '</div>'
      + '<span class="ss-label ss-sub">' + escapeHtml(_SEQ_TXT.labelThen) + '</span><div class="ss-row">'
      + _seqOpt(o.then === 'app', 'seqEditThen(\'app\')', _SEQ_TXT.thenApp) + _seqOpt(o.then === 'home', 'seqEditThen(\'home\')', _SEQ_TXT.thenHome) + '</div>';
    if (o.then === 'home') {
      h += '<div class="ss-home"><button type="button" class="ss-home-thumb" id="ssHomeThumb" aria-label="' + escapeHtml(o.img ? _SEQ_TXT.homeChange : _SEQ_TXT.homePick) + '" onclick="document.getElementById(\'seqHomeInput\').click()"></button>'
        + '<span class="ss-home-txt">' + escapeHtml(o.img ? (o.imgName || 'image') : _SEQ_TXT.homeNone) + '<br>'
        + '<button type="button" class="ss-link" onclick="document.getElementById(\'seqHomeInput\').click()">' + escapeHtml(o.img ? _SEQ_TXT.homeChange : _SEQ_TXT.homePick) + '</button> · ' + escapeHtml(_SEQ_TXT.homeNote) + '</span></div>';
    }
  } else {
    const list = _seqRefList(s.kind);
    const sel = s.kind === 'media' ? (_seqMediaItem(s.ref) || {}).id : s.ref;
    h += '<span class="ss-label">' + escapeHtml(_SEQ_TXT[_seqRefLabels[s.kind]]) + '</span>';
    if (!list.length) h += '<div class="ss-note">' + escapeHtml(_SEQ_TXT.none[s.kind === 'missed' ? 'call' : s.kind]) + '</div>';
    else {
      h += '<div class="ss-grid">' + list.map((r) => _seqOpt(r.id === sel, 'seqEditRef(' + _seqArg(r.id) + ')',
        r.label, r.sw ? '" style="--sw:' + r.sw : '')).join('') + '</div>';
      if (s.ref && !seqRefItem(s)) h += '<div class="ss-note ss-warn">' + escapeHtml(_SEQ_TXT.refMissing) + '</div>';
    }
    if (s.kind === 'media') {
      const it = _seqMediaItem(s.ref);
      if (it && it.kind === 'vid') {
        h += '<span class="ss-label ss-sub">' + escapeHtml(_SEQ_TXT.labelEnd) + '</span><div class="ss-row">'
          + _seqOpt(s.opt.end === 'loop', 'seqEditEnd(\'loop\')', _SEQ_TXT.endLoop) + _seqOpt(s.opt.end === 'pause', 'seqEditEnd(\'pause\')', _SEQ_TXT.endPause)
          + _seqOpt(s.opt.end === 'off', 'seqEditEnd(\'off\')', _SEQ_TXT.endOff) + '</div>';
      }
    }
    // Discussion : lecture manuelle, auto (le comédien tape) ou tout automatique (maquette 41)
    if (s.kind === 'chat') {
      const o = s.opt, it = seqRefItem(s);
      h += '<span class="ss-label ss-sub">' + escapeHtml(_SEQ_TXT.labelPlay) + '</span><div class="ss-row ss-play">'
        + _seqOpt(!o.auto, 'seqEditPlay(\'manual\')', _SEQ_TXT.playManual) + _seqOpt(o.auto && !o.full, 'seqEditPlay(\'actor\')', _SEQ_TXT.playActor)
        + _seqOpt(!!o.full, 'seqEditPlay(\'full\')', _SEQ_TXT.playFull) + '</div>'
        + '<div class="ss-note ss-play-note">' + escapeHtml(_seqTpl(_SEQ_TXT.playNote, { comedien: (it && it.actor) || _SEQ_TXT.actorDefault })) + '</div>';
    }
  }
  document.getElementById('ssRefCard').innerHTML = h;
  if (s.kind === 'unlock' && s.opt.then === 'home') _seqPaintHomeThumb(s.opt.img);
  // Démarre : au GO, après N s, geste du comédien (+ délai de secours)
  const tr = s.trig;
  let t = '<span class="ss-label">' + escapeHtml(_SEQ_TXT.labelStart) + '</span><div class="ss-row">'
    + _seqOpt(tr.k === 'go', 'seqEditTrig(\'go\')', _SEQ_TXT.startGo) + _seqOpt(tr.k === 'after', 'seqEditTrig(\'after\')', _SEQ_TXT.startAfter)
    + _seqOpt(tr.k === 'gesture', 'seqEditTrig(\'gesture\')', _SEQ_TXT.startGesture) + '</div>';
  if (tr.k === 'after') t += _seqStepper(_SEQ_TXT.afterLabel, tr.s, 'seqEditDelay', false);
  if (tr.k === 'gesture') {
    t += '<div class="ss-grid">' + SEQ_GESTURES.map((g) => _seqOpt(tr.g === g, 'seqEditGesture(' + _seqArg(g) + ')', _SEQ_TXT.gestureChip[g])).join('') + '</div>';
    t += _seqStepper(_SEQ_TXT.fallbackLabel, tr.t, 'seqEditDelay', true);
  }
  // Cible : tous, chaque groupe, chaque écran
  const tg = s.target;
  const opts = [{ t: { k: 'all' }, label: _SEQ_TXT.all }].concat(_scrReg.groups.map((g) => ({ t: { k: 'group', id: g.id }, label: g.name })), scrList().map((id) => ({ t: { k: 'screen', id }, label: scrName(id) })));
  if (!opts.some((o) => _seqSameTarget(o.t, tg))) opts.push({ t: tg, label: seqTargetName(tg) });
  t += '<span class="ss-label ss-sub">' + escapeHtml(_SEQ_TXT.labelTarget) + '</span><div class="ss-grid" id="ssTargets">'
    + opts.map((o) => _seqOpt(_seqSameTarget(o.t, tg), 'seqEditTarget(' + _seqArg(o.t.k) + (o.t.id ? ',' + _seqArg(o.t.id) : '') + ')', o.label)).join('') + '</div>';
  document.getElementById('ssTrigCard').innerHTML = t;
  const err = document.getElementById('ssErr');
  if (err) { err.textContent = e.err; err.style.display = e.err ? '' : 'none'; }
  const del = document.getElementById('ssDel');
  if (del) { del.textContent = e.id ? _SEQ_TXT.del : _SEQ_TXT.cancel; del.classList.toggle('ss-cancel', !e.id); }
}
function _seqStepper(label, n, fn, zeroNever) {
  const val = zeroNever && !n ? _SEQ_TXT.never : _seqTpl(_SEQ_TXT.seconds, { n });
  return '<div class="ss-stepper"><span>' + escapeHtml(label) + '</span>'
    + '<button type="button" class="ss-step-btn" aria-label="−" onclick="' + fn + '(-1)">−</button>'
    + '<b class="ss-step-val" id="ssDelayVal">' + escapeHtml(val) + '</b>'
    + '<button type="button" class="ss-step-btn" aria-label="+" onclick="' + fn + '(1)">+</button></div>';
}
// Réglages des étapes du téléphone : veille (maquette 29b), batterie faible, extinction, réseau
function _seqWideStepper(label, val, fn) {
  return '<span class="ss-label ss-sub">' + escapeHtml(label) + '</span><div class="ss-stepper ss-wide">'
    + '<button type="button" class="ss-step-btn" aria-label="−" onclick="' + fn + '(-1)">−</button>'
    + '<b class="ss-step-val" id="ssOptVal">' + escapeHtml(val) + '</b>'
    + '<button type="button" class="ss-step-btn" aria-label="+" onclick="' + fn + '(1)">+</button></div>';
}
function _seqPhoneStepCard(s) {
  const o = s.opt, lbl = (k) => '<span class="ss-label">' + escapeHtml(_SEQ_TXT[k]) + '</span>';
  const txt = (t) => '<div class="ss-text">' + escapeHtml(t) + '</div>', note = (t) => '<div class="ss-note">' + escapeHtml(t) + '</div>';
  const row = (items) => '<div class="ss-row">' + items.join('') + '</div>';
  const set = (k, v) => 'seqEditOpt(' + _seqArg(k) + ',' + (typeof v === 'string' ? _seqArg(v) : String(v)) + ')';
  switch (s.kind) {
    case 'sleep':
      return lbl('labelSleep') + txt(_SEQ_TXT.sleepText)
        + '<span class="ss-label ss-sub">' + escapeHtml(_SEQ_TXT.labelWake) + '</span>'
        + row([_seqOpt(o.notif, set('notif', !o.notif), _SEQ_TXT.wakeNotif), _seqOpt(o.touch, set('touch', !o.touch), _SEQ_TXT.wakeTouch)])
        + _seqWideStepper(_SEQ_TXT.labelResleep, _seqTpl(_SEQ_TXT.seconds, { n: o.after }), 'seqEditSleepDelay') + note(_SEQ_TXT.sleepNote);
    case 'battery':
      return lbl('labelBattery') + txt(_SEQ_TXT.batteryText) + _seqWideStepper(_SEQ_TXT.labelLevel, _seqTpl(_SEQ_TXT.percent, { n: o.level }), 'seqEditLevel');
    case 'off':
      return lbl('labelOff') + txt(_SEQ_TXT.offText) + note(_SEQ_TXT.offNote);
    case 'net': {
      let h = lbl('labelNet') + row([_seqOpt(o.lost, set('lost', true), _SEQ_TXT.netLost), _seqOpt(!o.lost, set('lost', false), _SEQ_TXT.netBack)]);
      if (!o.lost) {
        h += '<span class="ss-label ss-sub">' + escapeHtml(_SEQ_TXT.labelBars) + '</span>'
          + row([1, 2, 3, 4].map((n) => _seqOpt(o.bars === n, set('bars', n), '▂▄▆█'.slice(0, n), '" aria-label="' + n + ' / 4')))
          + '<span class="ss-label ss-sub">' + escapeHtml(_SEQ_TXT.labelNetType) + '</span>'
          + row(PB_NET_TYPES.map((t) => _seqOpt(o.type === t, set('type', t), t)))
          + '<div class="ss-stepper"><span>' + escapeHtml(_SEQ_TXT.labelWifi) + '</span>'
          + _seqOpt(o.wifi, set('wifi', true), _SEQ_TXT.yes) + _seqOpt(!o.wifi, set('wifi', false), _SEQ_TXT.no) + '</div>';
      }
      return h + note(o.lost ? _SEQ_TXT.netLostNote : _SEQ_TXT.netBackNote);
    }
  }
  return '';
}
function seqEditOpt(k, v) {
  const e = _seqEdit;
  if (!e) return;
  const o = Object.assign({}, e.step.opt, { [k]: v });
  const c = seqSanitizeStep(Object.assign({}, e.step, { opt: o }));
  if (c) e.step.opt = c.opt;
  renderSeqStep();
}
// Lecture de l'étape Discussion : 'manual' | 'actor' (le comédien tape) | 'full' (tout automatique)
function seqEditPlay(v) {
  const e = _seqEdit;
  if (!e || e.step.kind !== 'chat') return;
  e.step.opt = { auto: v === 'actor' || v === 'full', full: v === 'full' };
  renderSeqStep();
}
function seqEditSleepDelay(d) { const e = _seqEdit; if (e && e.step.kind === 'sleep') seqEditOpt('after', e.step.opt.after + d); }
function seqEditLevel(d) { const e = _seqEdit; if (e && e.step.kind === 'battery') seqEditOpt('level', e.step.opt.level + d); }
function seqEditKind(k) {
  const e = _seqEdit;
  if (!e || !SEQ_KINDS.includes(k) || e.step.kind === k) return;
  const old = e.step.kind === 'unlock' ? e.step.opt.img : null;
  e.step.kind = k; e.err = '';
  _seqEditDefaults(e.step);
  if (old) seqGcImages([old]);
  renderSeqStep();
}
function seqEditRef(id) {
  const e = _seqEdit;
  if (!e) return;
  if (e.step.kind === 'media') { const it = _mediaPool.find((m) => m.id === id); if (it) e.step.ref = { id: it.id, name: it.name, kind: it.kind }; }
  else e.step.ref = id;
  e.err = '';
  renderSeqStep();
}
function seqEditEnd(v) { if (_seqEdit) { _seqEdit.step.opt.end = v; renderSeqStep(); } }
function seqEditCode(n) { if (_seqEdit) { _seqEdit.step.opt.code = [0, 4, 6].includes(n) ? n : 4; renderSeqStep(); } }
function seqEditThen(v) { if (_seqEdit) { _seqEdit.step.opt.then = v === 'home' ? 'home' : 'app'; renderSeqStep(); } }
function seqEditTrig(k) {
  const e = _seqEdit;
  if (!e) return;
  const tr = e.step.trig;
  if (k === 'after') e.step.trig = { k: 'after', s: tr.k === 'after' ? tr.s : 4 };
  else if (k === 'gesture') e.step.trig = { k: 'gesture', g: tr.g || 'touch', t: tr.t || 0 };
  else e.step.trig = { k: 'go' };
  renderSeqStep();
}
function seqEditGesture(g) { const e = _seqEdit; if (e && SEQ_GESTURES.includes(g)) { e.step.trig.g = g; renderSeqStep(); } }
function seqEditDelay(d) {
  const e = _seqEdit;
  if (!e) return;
  const tr = e.step.trig;
  if (tr.k === 'after') tr.s = _seqClampS(tr.s + d, 0);
  else if (tr.k === 'gesture') tr.t = _seqClampS(tr.t + d, 0);
  renderSeqStep();
}
function seqEditTarget(k, id) {
  const e = _seqEdit;
  if (!e) return;
  e.step.target = _seqSanTarget(k === 'all' ? { k } : { k, id });
  renderSeqStep();
}
function _seqPaintHomeThumb(sig) {
  return _seqHomeData(sig).then((d) => {
    const th = document.getElementById('ssHomeThumb');
    if (th && _seqEdit && _seqEdit.step.opt.img === sig) th.style.backgroundImage = d ? 'url(' + d + ')' : '';
  });
}
// Image importée (écran d'accueil, fond d'écran) : redimensionnée (1280 px),
// vérifiée (safeImageData), gardée sur l'appareil par empreinte ; done(sig) ou done(null) : illisible
function seqImportImage(f, done) {
  const img = new Image();
  img.onload = async () => {
    URL.revokeObjectURL(img.src);
    const s = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const data = safeImageData(c.toDataURL('image/jpeg', 0.8));
    if (!data) { done(null); return; }
    const sig = seqImageSig(data);
    await callAssetPut(seqHomeKey(sig), data);
    done(sig);
  };
  img.onerror = () => { URL.revokeObjectURL(img.src); done(null); };
  img.src = URL.createObjectURL(f);
}
function onSeqHomeImage(files) {
  const f = files && files[0];
  const e = _seqEdit;
  if (!f || !e || e.step.kind !== 'unlock') return;
  seqImportImage(f, (sig) => {
    if (_seqEdit !== e) { if (sig) seqGcImages([sig]); return; }
    if (!sig) { e.err = _SEQ_TXT.homeBad; renderSeqStep(); return; }
    const old = e.step.opt.img;
    e.step.opt.img = sig;
    e.step.opt.imgName = _seqLine(f.name || 'image', 60);
    e.err = '';
    renderSeqStep();
    if (old && old !== sig) seqGcImages([old]);
  });
}
function seqStepSave() {
  const e = _seqEdit;
  if (!e) return false;
  const s = seqSanitizeStep(e.step);
  if (!s) return false;
  if (!SEQ_OPT_KINDS.has(s.kind) && !seqRefItem(s)) { e.err = _SEQ_TXT.needRef; renderSeqStep(); return false; }
  const i = e.id ? _seq.steps.findIndex((x) => x.id === e.id) : -1;
  const prevImg = i >= 0 && _seq.steps[i].kind === 'unlock' ? _seq.steps[i].opt.img : null;
  if (i >= 0) _seq.steps[i] = s;
  else { if (_seq.steps.length >= SEQ_STEPS_MAX) return false; _seq.steps.push(s); }
  if (!seqSave()) alert(_SEQ_TXT.storeFull);
  _seqEdit = null;
  closeSeqStep();
  if (prevImg) seqGcImages([prevImg]);
  _seqArm();
  renderSeq();
  _seqQueue(() => _seqPushPhones());
  return true;
}
function seqStepDelete() {
  const e = _seqEdit;
  if (!e) return;
  if (!e.id) { seqStepLeave(); return; } // nouvelle étape : ANNULER
  const i = _seq.steps.findIndex((x) => x.id === e.id);
  if (i < 0) { closeSeqStep(); return; }
  if (!confirm(_seqTpl(_SEQ_TXT.confirmDel, { n: i + 1 }))) return;
  const s = _seq.steps[i];
  // Étape en cours supprimée : le déroulé se place sur la précédente
  if (_seqRun.curId === s.id) _seqRun.curId = i > 0 ? _seq.steps[i - 1].id : null;
  _seq.steps.splice(i, 1);
  _seqRun.undo.delete(s.id);
  seqSave();
  closeSeqStep();
  if (s.kind === 'unlock' && s.opt.img) seqGcImages([s.opt.img]);
  renderSeq();
  _seqQueue(() => _seqPushPhones());
}

// ── Réordonnancement : appui maintenu sur une ligne puis glisser (comme la liste des appels) ──
let _seqDrag = null, _seqSuppressClick = false;
(function initSeqDrag() {
  const box = document.getElementById('seqRows');
  if (!box) return;
  const HOLD = 220, TOL = 12;
  const blockScroll = (e) => e.preventDefault();
  box.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.sq-row');
    if (!row || (e.pointerType === 'mouse' && e.button !== 0)) return;
    _seqDrag = { row, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, active: false, ghost: null };
    _seqDrag.timer = setTimeout(start, HOLD);
  });
  function start() {
    const d = _seqDrag; if (!d || d.active) return;
    d.active = true;
    const r = d.row.getBoundingClientRect();
    d.dy = d.y - r.top;
    const g = d.row.cloneNode(true);
    g.classList.add('cl-ghost'); g.style.width = r.width + 'px'; g.style.left = r.left + 'px'; g.style.top = (d.y - d.dy) + 'px';
    document.body.appendChild(g);
    d.ghost = g;
    d.row.classList.add('cl-drag-src');
    document.addEventListener('touchmove', blockScroll, { passive: false });
    if (navigator.vibrate) navigator.vibrate(30);
  }
  document.addEventListener('pointermove', (e) => {
    const d = _seqDrag; if (!d) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.active) {
      if (Math.abs(d.x - d.sx) > TOL || Math.abs(d.y - d.sy) > TOL) { clearTimeout(d.timer); _seqDrag = null; }
      return;
    }
    d.ghost.style.top = (d.y - d.dy) + 'px';
    const over = document.elementFromPoint(d.sx, d.y);
    const t = over && over.closest ? over.closest('#seqRows .sq-row') : null;
    if (t && t !== d.row) {
      const rect = t.getBoundingClientRect();
      t.parentNode.insertBefore(d.row, (d.y - rect.top) < rect.height / 2 ? t : t.nextSibling);
    }
  });
  function end() {
    const d = _seqDrag; if (!d) return;
    clearTimeout(d.timer);
    _seqDrag = null;
    if (!d.active) return;
    document.removeEventListener('touchmove', blockScroll);
    if (d.ghost) d.ghost.remove();
    const order = [...box.querySelectorAll('.sq-row')].map((el) => el.dataset.id);
    seqReorder(order);
    _seqSuppressClick = true; setTimeout(() => { _seqSuppressClick = false; }, 350);
  }
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();
function seqReorder(order) {
  _seq.steps.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  seqSave();
  _seqArm();
  renderSeq();
  _seqQueue(() => _seqPushPhones());
}
