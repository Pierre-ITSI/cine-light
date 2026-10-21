// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ PROTOCOLE — validation & aiguillage ══════════════════════════
// Chaque type de message reçu est décrit par :
//   roles    : modes qui le traitent ('screen' = écran de jeu, 'remote' = télécommande)
//   validate : contrôle types et plafonds ; peut NORMALISER le message sur
//              place (bornage des nombres, champs optionnels) ; false = rejet
//   handle   : traitement (fonctions existantes de l'app)
// Message inconnu, mal formé, hors rôle ou invalide : ignoré silencieusement.
// C'est la 2e barrière : chaque message a déjà été authentifié, déchiffré et
// validé par le schéma strict du paquet protocole (20-mqtt.js) ; ici, on
// borne et on aiguille.

const _P = {
  isObj: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  // Nombre fini (type number uniquement), borné ; null si invalide
  num(v, min, max) {
    return (typeof v === 'number' && Number.isFinite(v)) ? Math.min(max, Math.max(min, v)) : null;
  },
  int(v, min, max) { return (Number.isInteger(v) && v >= min && v <= max) ? v : null; },
  // Texte affichable : chaîne (ou nombre) tronquée ; '' sinon
  text(v, max) {
    if (typeof v === 'string') return v.slice(0, max);
    if (typeof v === 'number' && Number.isFinite(v)) return String(v).slice(0, max);
    return '';
  },
  str: (v, max) => typeof v === 'string' && v.length <= max,
  oneOf: (v, list) => typeof v === 'string' && list.includes(v),
  hex: (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v),
  // Identifiant de transfert / de média : [A-Za-z0-9_-], 1 à 64 caractères
  id: (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v),
  // Son importé : « __ring_ » + 16 hex (id dérivé du contenu, schéma du paquet protocole)
  ringId: (v) => typeof v === 'string' && SRP.RING_ID_RE.test(v),
  bool: (v) => !!v,
};

// Plafonds réseau
const PROTO = {
  STROBE_FREQ_MIN: 0.1, STROBE_FREQ_MAX: 30,   // Hz (période ≥ durée + 5 ms : voir receiveStrobe)
  STROBE_DUR_MIN: 15, STROBE_DUR_MAX: 2000,    // ms
  VIB_MAX_ENTRIES: 20, VIB_MAX_MS: 2000,
  NAME_MAX: 40, MSG_MAX: 200, APP_MAX: 24, LOCK_TIME_MAX: 8, LOCK_DATE_MAX: 30,
  NOTIF_AGO_MAX: 10080,                        // « il y a n min » : 7 jours au plus
  CHAT_MSGS_MAX: 40, CHAT_TEXT_MAX: 300,       // = LIMITS du schéma (discussion)
  PHONE_NOTIFS_MAX: 8, PHONE_AGO_MAX: 604800,  // = LIMITS du schéma (faux téléphone d'une Séquence)
  PHONE_GESTURES: ['touch', 'notif', 'hangup', 'answer', 'unlock', 'home', 'dismiss'],
  PHONE_GESTURES_ALWAYS: ['unlock', 'dismiss'],          // toujours rapportés, jamais « attendus »
  PHONE_CLOCK_MAX: 604800, PHONE_SLEEP_MAX: 120,       // = LIMITS du schéma (barre d'état, veille)
  CHAT_WRITE_MAX: 60,                                  // s : « … écrit », frappe automatique (Lecture auto)
  SDP_MAX: 16000, ICE_MAX: 4096,               // = LIMITS du schéma (packages/protocol)
  ORDER_MAX: 500, MISSING_MAX: 400,
  VID_MAX_CHUNKS: 50000,                       // ≈ 600 Mo base64 en fragments de 12 000
  AUDIO_DELAY_MAX: 15,                         // s : délai avant la voix (= schéma, call:start.audio.delay)
  CALL_RINGS: ['classic', 'digital', 'soft', 'silent'],
  // + 3 sons synthétisés réservés aux messages (SMS, notification, discussion) ; un appel les ramène à « classic »
  MSG_RINGS: ['classic', 'digital', 'soft', 'silent', 'metal-do', 'metal-sol', 'sent'],
  TORCH_EFFECTS: ['stop', 'sos', 'blink-slow', 'blink-fast', 'police', 'heartbeat'],
};

function _validStrobe(m) {
  m.active = _P.bool(m.active);
  if (!m.active) return true;
  const f = (v) => _P.num(v, PROTO.STROBE_FREQ_MIN, PROTO.STROBE_FREQ_MAX);
  const d = (v) => _P.num(v, PROTO.STROBE_DUR_MIN, PROTO.STROBE_DUR_MAX);
  m.freq = f(m.freq); m.dur = d(m.dur);
  if (m.freq === null || m.dur === null) return false;
  m.torch = _P.bool(m.torch);
  m.random = _P.bool(m.random);
  // Plage aléatoire : bornée elle aussi (valeurs absentes → valeurs fixes)
  m.freqMin = f(m.freqMin) ?? m.freq; m.freqMax = f(m.freqMax) ?? m.freq;
  m.durMin = d(m.durMin) ?? m.dur;    m.durMax = d(m.durMax) ?? m.dur;
  return true;
}

function _validVibrate(m) {
  const p = m.pattern;
  if (typeof p === 'number') { m.pattern = _P.num(p, 0, PROTO.VIB_MAX_MS); return m.pattern !== null; }
  if (!Array.isArray(p) || !p.length || p.length > PROTO.VIB_MAX_ENTRIES) return false;
  const out = p.map((v) => _P.num(v, 0, PROTO.VIB_MAX_MS));
  if (out.includes(null)) return false;
  m.pattern = out;
  return true;
}

// Date / heure du faux téléphone (notification) : formats stricts, sinon absentes
const _pDate = (v) => (typeof v === 'string' && SRP.DATE_RE.test(v) ? v : undefined);
const _pTime = (v) => (typeof v === 'string' && SRP.TIME_RE.test(v) ? v : undefined);
function _validCallStart(m) {
  // Ancienne « messagerie » (chat, whatsapp) d'une télécommande non à jour : affichée comme un SMS
  if (m.kind === 'chat' || m.kind === 'whatsapp') m.kind = 'sms';
  if (!_P.oneOf(m.kind, ['call', 'sms', 'notif'])) m.kind = 'sms';
  m.name = _P.text(m.name, PROTO.NAME_MAX);
  m.label = _P.text(m.label, PROTO.NAME_MAX);
  m.msg = _P.text(m.msg, PROTO.MSG_MAX);
  m.appName = _P.text(m.appName, PROTO.APP_MAX);
  if (!_P.hex(m.appColor)) m.appColor = null;
  // La photo n'arrive plus dans ce message : préchargée en fragments (__callphoto)
  delete m.photo;
  m.hasPhoto = _P.bool(m.hasPhoto);
  // Sonnerie inconnue → classique (une clé comme « __proto__ » ne doit pas
  // fausser la cadence de répétition)
  if (!_P.oneOf(m.ring, m.kind === 'call' ? PROTO.CALL_RINGS : PROTO.MSG_RINGS)) m.ring = 'classic';
  // Son importé (__ring_…, préchargé en fragments) et volume du son
  if (!_P.ringId(m.ringId)) m.ringId = null;
  m.ringVolume = _P.num(m.ringVolume, 0, 1) ?? 1;
  m.vib = m.vib === true; // vibreur du type (maquette 36b) ; absent : ne vibre pas
  m.lock = _P.isObj(m.lock)
    ? { time: _P.text(m.lock.time, PROTO.LOCK_TIME_MAX), date: _P.text(m.lock.date, PROTO.LOCK_DATE_MAX) }
    : null;
  m.autoAnswer = _P.num(m.autoAnswer, 0, 60) ?? 0;
  m.hasAudio = _P.bool(m.hasAudio);
  // Audio de l'appel décroché : délai avant la voix, sortie du son, capteur de proximité.
  // Absent (ancienne télécommande) : null = comportement d'avant (voix immédiate, sortie du système)
  m.audio = callAudioNorm(m.audio); // 80-call-simulator.js ; null = absent (ancienne télécommande)
  // Photo / bande son PRÉPARÉES (tournage sans réseau) : ids dérivés du contenu
  if (!(typeof m.photoId === 'string' && SRP.CALL_PHOTO_ID_RE.test(m.photoId))) m.photoId = null;
  if (!(typeof m.audioId === 'string' && SRP.CALL_AUDIO_ID_RE.test(m.audioId))) m.audioId = null;
  // Notification : bandeau ou écran verrouillé, heure du téléphone, heure de réception
  if (m.kind === 'notif') {
    m.present = m.present === 'lock' ? 'lock' : 'banner';
    const ph = _P.isObj(m.phone) ? m.phone : {};
    m.phone = { date: _pDate(ph.date), time: _pTime(ph.time) };
    const r = _P.isObj(m.received) ? m.received : {};
    if (r.mode === 'ago' && _P.int(r.min, 0, PROTO.NOTIF_AGO_MAX) !== null) m.received = { mode: 'ago', min: r.min };
    else if (r.mode === 'at' && _pDate(r.date) && _pTime(r.time)) m.received = { mode: 'at', date: r.date, time: r.time };
    else m.received = { mode: 'now' };
  } else { delete m.phone; delete m.received; }
  return true;
}

// Discussion : identifiants courts, listes bornées sans doublon
const _chatId = (v) => typeof v === 'string' && SRP.CHAT_ID_RE.test(v);
const _chatIds = (a) => Array.isArray(a) && a.length <= PROTO.CHAT_MSGS_MAX && a.every(_chatId) && new Set(a).size === a.length;
function _validChatOpen(m) {
  if (!_chatIds(m.ids) || !_chatIds(m.sent) || !m.sent.every((id) => m.ids.includes(id))) return false;
  m.name = _P.text(m.name, PROTO.NAME_MAX);
  if (!_P.oneOf(m.style, ['glass', 'tonal', 'minimal'])) m.style = 'minimal';
  m.hasAvatar = _P.bool(m.hasAvatar);
  m.typed = _P.int(m.typed, 0, PROTO.CHAT_TEXT_MAX) ?? 0;
  // Reprise (« Reprendre ici », « Repartir de zéro ») : historique = début exact du fil, sans lettre tapée
  m.history = _P.bool(m.history);
  if (m.history && (m.typed || !m.sent.every((id, i) => m.ids[i] === id))) return false;
  // Non distribués (envoyés sans réseau) : parmi les postés ; frappe automatique en cours : message du fil non posté
  m.pend = Array.isArray(m.pend) ? m.pend.filter((id, i, a) => _chatId(id) && m.sent.includes(id) && a.indexOf(id) === i) : [];
  m.auto = m.history ? null : _validChatType(m.auto, true);
  if (m.auto && (!m.ids.includes(m.auto.id) || m.sent.includes(m.auto.id))) m.auto = null;
  // Son des messages du contact (absent : aucun) et vibreur (maquette 36d)
  if (m.ring !== undefined && !_P.oneOf(m.ring, PROTO.MSG_RINGS)) m.ring = 'classic';
  if (!_P.ringId(m.ringId)) m.ringId = null;
  if (m.ringId && !m.ring) m.ring = 'classic';
  m.ringVolume = _P.num(m.ringVolume, 0, 1) ?? 1;
  m.vib = m.vib === true;
  return true;
}
function _validChatMsg(m) {
  if (!_chatId(m.id) || !_P.oneOf(m.from, ['contact', 'actor'])) return false;
  m.text = _P.text(m.text, PROTO.CHAT_TEXT_MAX);
  return m.text.trim().length > 0;
}
// Lecture auto (maquette 26d) : frappe automatique d'un message du comédien
function _validChatType(t, withEl) {
  if (!_P.isObj(t) || !_chatId(t.id)) return null;
  const dur = _P.int(t.dur, 1, PROTO.CHAT_WRITE_MAX);
  const out = { id: t.id, dur, send: _P.bool(t.send) };
  if (dur === null && !out.send) return null;
  if (withEl) out.el = dur === null ? 0 : (_P.int(t.el, 0, dur * 1000) ?? 0);
  return out;
}

// Faux téléphone d'une Séquence (91-sequence.js → 94-sequence-phone.js) :
// pile bornée sans doublon, textes tronqués, gestes connus seulement
const _phoneId = (v) => typeof v === 'string' && SRP.PHONE_NOTIF_ID_RE.test(v);
// Barre d'état (maquette 28b) : horloge, réseau, batterie ; null si inutilisable
function _validPhoneBar(b) {
  if (!_P.isObj(b) || !_P.isObj(b.clock) || !_P.isObj(b.net) || !_P.isObj(b.bat)) return null;
  const c = b.clock;
  if (!_P.oneOf(c.mode, ['run', 'frozen', 'real'])) return null;
  let clock = { mode: 'real' };
  if (c.mode !== 'real') {
    if (!_pDate(c.date) || !_pTime(c.time)) return null;
    clock = { mode: c.mode, date: c.date, time: c.time };
    if (c.mode === 'run') clock.el = _P.int(c.el, 0, PROTO.PHONE_CLOCK_MAX) ?? 0;
  }
  const bars = _P.int(b.net.bars, 0, 4), level = _P.int(b.bat.level, 1, 100);
  if (bars === null || level === null || !_P.oneOf(b.net.type, SRP.PHONE_NET_TYPES)) return null;
  return {
    clock, net: { bars, type: b.net.type, plane: _P.bool(b.net.plane), wifi: _P.bool(b.net.wifi) },
    bat: Object.assign({ level, charging: _P.bool(b.bat.charging), pct: _P.bool(b.bat.pct) }, b.bat.low === true ? { low: true } : {}),
  };
}
function _validPhoneState(m) {
  if (!_P.oneOf(m.mode, ['off', 'locked', 'code', 'unlocked', 'home'])) return false;
  if (!_P.oneOf(m.style, ['glass', 'tonal', 'minimal'])) m.style = 'glass';
  if (!Array.isArray(m.notifs) || m.notifs.length > PROTO.PHONE_NOTIFS_MAX) return false;
  const seen = new Set();
  const out = [];
  for (const n of m.notifs) {
    if (!_P.isObj(n) || !_phoneId(n.id) || seen.has(n.id) || !_P.oneOf(n.kind, ['sms', 'notif', 'missed'])) return false;
    seen.add(n.id);
    out.push({
      id: n.id, kind: n.kind, app: _P.text(n.app, PROTO.APP_MAX), name: _P.text(n.name, PROTO.NAME_MAX), msg: _P.text(n.msg, PROTO.MSG_MAX),
      color: _P.hex(n.color) ? n.color : null, ago: _P.int(n.ago, 0, PROTO.PHONE_AGO_MAX) ?? 0,
      // Maquette 44 : appelant d'un appel manqué (initiales), icône / photo préparée (__ph_…)
      who: n.kind === 'missed' ? _P.text(n.who, PROTO.NAME_MAX) : '',
      img: n.kind !== 'sms' && typeof n.img === 'string' && SRP.CALL_PHOTO_ID_RE.test(n.img) ? n.img : null,
    });
  }
  m.notifs = out;
  const u = m.unlock;
  m.unlock = _P.isObj(u) && [0, 4, 6].includes(u.code) ? { code: u.code, then: u.then === 'home' ? 'home' : 'app' } : null;
  if (m.mode === 'code' && !(m.unlock && m.unlock.code)) return false;
  m.home = _P.bool(m.home);
  m.homeWall = _P.bool(m.homeWall);
  m.wall = _P.bool(m.wall);
  m.watch = Array.isArray(m.watch) ? m.watch.filter((g, i, a) => _P.oneOf(g, PROTO.PHONE_GESTURES) && !PROTO.PHONE_GESTURES_ALWAYS.includes(g) && a.indexOf(g) === i) : [];
  const c = m.chime;
  m.chime = _P.isObj(c) && seen.has(c.id) ? { id: c.id, ring: _P.oneOf(c.ring, PROTO.MSG_RINGS) ? c.ring : 'classic', ringId: _P.ringId(c.ringId) ? c.ringId : null, vol: _P.num(c.vol, 0, 1) ?? 1, vib: c.vib === true } : null;
  // Barre d'état, veille, batterie faible, extinction (maquettes 28b, 29b, 33)
  m.bar = m.bar === undefined ? null : _validPhoneBar(m.bar);
  const sl = m.sleep;
  m.sleep = _P.isObj(sl) && (m.mode === 'locked' || m.mode === 'code')
    ? { notif: _P.bool(sl.notif), touch: _P.bool(sl.touch), after: _P.int(sl.after, 1, PROTO.PHONE_SLEEP_MAX) ?? 8 } : null;
  const al = m.alert;
  // « Batterie faible » (niveau) ou « Aucun réseau » (kind net, maquette 44b)
  m.alert = !_P.isObj(al) || !_phoneId(al.id) ? null
    : al.kind === 'net' ? { id: al.id, kind: 'net' }
    : _P.int(al.level, 1, 100) !== null ? { id: al.id, kind: 'battery', level: al.level } : null;
  m.power = m.power === 'off' ? 'off' : 'on';
  // Habillage du loader d'extinction (étape Extinction, B) : seulement avec power off ; inconnu = absent
  m.offStyle = m.power === 'off' && _P.oneOf(m.offStyle, ['glass', 'tonal', 'minimal']) ? m.offStyle : null;
  if (m.power === 'off') { m.chime = null; m.watch = []; }
  return true;
}

const _validSdp = (type) => (m) => _P.isObj(m.sdp) && m.sdp.type === type && _P.str(m.sdp.sdp, PROTO.SDP_MAX);
const _validIce = (m) => _P.oneOf(m.from, ['remote', 'screen']) && _P.isObj(m.candidate)
  && _P.str(m.candidate.candidate, PROTO.ICE_MAX);

const MSG_ROUTES = {
  // ─── Télécommande → écran ───
  'color':             { roles: ['screen'], validate: (m) => _P.hex(m.color), handle: (m) => receiveColor(m.color) },
  'strobe':            { roles: ['screen'], validate: _validStrobe, handle: (m) => receiveStrobe(m) },
  'vibrate':           { roles: ['screen'], validate: _validVibrate, handle: (m) => doVibrate(m.pattern) },
  'torch-onoff':       { roles: ['screen'], validate: (m) => { m.on = _P.bool(m.on); return true; }, handle: (m) => receiveTorchOnOff(m.on) },
  'torch-dim':         { roles: ['screen'], validate: (m) => (m.level = _P.num(m.level, 0, 100)) !== null, handle: (m) => receiveTorchDim(m.level) },
  'torch-effect':      { roles: ['screen'], validate: (m) => _P.oneOf(m.effect, PROTO.TORCH_EFFECTS), handle: (m) => receiveTorchEffect(m.effect) },
  'hello':             { roles: ['screen'], validate: () => true, handle: () => sendCaps() },
  'effect': {
    roles: ['screen'],
    validate(m) {
      m.active = _P.bool(m.active);
      if (!m.active) return true;
      if (typeof m.name !== 'string' || !Object.prototype.hasOwnProperty.call(EFFECT_CONFIG, m.name)
        || typeof FX_LIB[m.name] !== 'function') return false;
      if (m.params != null && !_P.isObj(m.params)) return false;
      return true; // paramètres bornés par receiveEffect (_fxSanitizeParams)
    },
    handle: (m) => receiveEffect(m),
  },
  'blackout':          { roles: ['screen'], validate: (m) => { m.on = _P.bool(m.on); return true; }, handle: (m) => setBlackout(m.on) },
  'screen:brightness': { roles: ['screen'], validate: (m) => (m.value = _P.num(m.value, 0, 1)) !== null, handle: (m) => setScreenDim(m.value) },
  'media-img-start': {
    roles: ['screen'],
    validate: (m) => _P.str(m.id, 64) && m.id.length > 0 && _P.int(m.total, 1, IMG_MAX_CHUNKS) !== null
      && (m.mediaId == null || typeof m.mediaId === 'string'),
    handle: (m) => mediaImgStart(m),
  },
  'media-img-chunk': {
    roles: ['screen'],
    validate: (m) => _P.str(m.id, 64) && _P.int(m.i, 0, IMG_MAX_CHUNKS - 1) !== null && _P.str(m.data, IMG_CHUNK_MAX),
    handle: (m) => mediaImgChunk(m),
  },
  'media-stop':        { roles: ['screen'], validate: () => true, handle: () => hideScreenMedia() },
  'media:show':        { roles: ['screen'], validate: (m) => _P.id(m.id), handle: (m) => screenShowCached(m.id) },
  'media:order': {
    roles: ['screen'],
    validate(m) {
      if (m.ids == null) { m.ids = []; return true; }
      return Array.isArray(m.ids) && m.ids.length <= PROTO.ORDER_MAX && m.ids.every(_P.id);
    },
    handle: (m) => { _mediaOrder = m.ids; screenNavOrderChanged(); },
  },
  'media:evict':       { roles: ['screen'], validate: (m) => _P.id(m.id), handle: (m) => screenEvictCached(m.id) },
  // Ancien interrupteur « avancer au clic » : lu comme le mode Toucher tant qu'aucun media:nav n'est reçu (télécommande plus ancienne)
  'media:autoadvance': { roles: ['screen'], validate: (m) => { m.on = _P.bool(m.on); return true; }, handle: (m) => screenNavLegacy(m.on) },
  'media:nav': {
    roles: ['screen'],
    validate: (m) => _P.oneOf(m.mode, ['off', 'tap', 'swipe', 'scroll']) && _P.oneOf(m.skin, ['none', 'social']),
    handle: (m) => screenSetNav(m.mode, m.skin),
  },
  'media-ctrl': {
    roles: ['screen'],
    validate(m) {
      if (!_P.oneOf(m.action, ['play', 'pause', 'seek'])) return false;
      if (m.action === 'seek') return (m.time = _P.num(m.time, 0, 1e7)) !== null;
      return true;
    },
    handle: (m) => screenMediaCtrl(m),
  },
  'media:endmode':     { roles: ['screen'], validate: (m) => _P.oneOf(m.mode, ['loop', 'pause', 'off']), handle: (m) => screenSetEndMode(m.mode) },
  'media:upload': {
    roles: ['screen'],
    validate(m) {
      if (!_P.id(m.mediaId) || _P.int(m.totalChunks, 1, PROTO.VID_MAX_CHUNKS) === null) return false;
      if (!(typeof m.mime === 'string' && /^[a-z]+\/[a-z0-9.+-]{1,40}$/i.test(m.mime))) m.mime = undefined;
      if (!_P.id(m.poolId)) m.poolId = null;
      m.show = m.show !== false; // false : mise en cache seulement (préparation hors ligne)
      return true;
    },
    handle: (m) => screenVidUploadStart(m),
  },
  'media:chunk': {
    roles: ['screen'],
    validate: (m) => _P.id(m.mediaId) && _P.int(m.index, 0, PROTO.VID_MAX_CHUNKS - 1) !== null
      && (!_vidUp || _vidUp.id !== m.mediaId || m.index < _vidUp.total) && _P.str(m.data, IMG_CHUNK_MAX),
    handle: (m) => screenVidUploadChunk(m),
  },
  'media:play':        { roles: ['screen'], validate: (m) => _P.id(m.mediaId), handle: (m) => screenVidUploadPlay(m) },
  'call:start':        { roles: ['screen'], validate: _validCallStart, handle: (m) => screenCallStart(m) },
  'call:answer':       { roles: ['screen'], validate: () => true, handle: () => screenCallAnswer() },
  'call:end':          { roles: ['screen'], validate: () => true, handle: () => screenCallEnd() },
  // Haut-parleur de l'appel décroché, dans les deux sens (80-call-simulator.js, 73-tel-ui.js) :
  // la télécommande demande, l'écran fait foi et renvoie l'état réel (jamais de renvoi en retour)
  'call:speaker': {
    roles: ['screen', 'remote'],
    validate: (m) => { m.on = m.on === true; return true; },
    handle: (m) => (mode === 'screen' ? screenOnSpeaker(m.on) : remoteOnCallSpeaker(m.on)),
  },
  // Discussion fictive (83-discussion.js) : jamais déclenchée par la console DMX
  'chat:open':         { roles: ['screen'], validate: _validChatOpen, handle: (m) => screenChatOpen(m) },
  'chat:msg':          { roles: ['screen'], validate: _validChatMsg, handle: (m) => screenChatMsg(m) },
  'chat:post':         { roles: ['screen'], validate: (m) => { m.typing = _P.bool(m.typing); m.dur = m.typing ? _P.int(m.dur, 1, PROTO.CHAT_WRITE_MAX) : null; return _chatId(m.id); }, handle: (m) => screenChatPost(m) },
  'chat:type':         { roles: ['screen'], validate: (m) => { const t = _validChatType(m, false); if (t) Object.assign(m, t); return !!t; }, handle: (m) => screenChatType(m) },
  'chat:rewind':       { roles: ['screen'], validate: (m) => { m.drop = _P.bool(m.drop); return _chatId(m.id); }, handle: (m) => screenChatRewind(m) },
  'chat:close':        { roles: ['screen'], validate: () => true, handle: () => screenChatClose() },
  // Faux téléphone d'une Séquence (94-sequence-phone.js) : jamais déclenché par la console DMX
  'phone:state':       { roles: ['screen'], validate: _validPhoneState, handle: (m) => screenPhoneState(m) },
  // Onglet Média, hors séquence : barre d'état en bandeau au-dessus des médias (97-phone-status.js)
  'media:bar':         { roles: ['screen'], validate: (m) => { if (m.bar === null) return true; m.bar = _validPhoneBar(m.bar); return m.bar !== null; }, handle: (m) => screenMediaBar(m.bar) },
  // Passerelle DMX : look calculé depuis la console (36-dmx-screen.js, docs/DMX.md § 7)
  'dmx:look': {
    roles: ['screen'],
    validate: (m) => _P.int(m.seq, 0, 0xffff) !== null && typeof m.live === 'boolean'
      && (m.look = SRDMX.expandLook(m.look)) !== null,
    handle: (m) => screenApplyDmxLook(m),
  },
  'screen:identify':   { roles: ['screen'], validate: () => true, handle: () => screenIdentify() },
  // Clé par écran et retrait (29-revoke.js) ; le canal chiffré a déjà vérifié l'adresse (cet écran)
  'key:offer': {
    roles: ['screen'],
    validate: (m) => SRP.SCREEN_ID_RE.test(m.rid) && SRP.EXCHANGE_ID_RE.test(m.xid) && _P.isObj(m.jwk),
    handle: (m) => screenOnKeyOffer(m),
  },
  'screen:revoked':    { roles: ['screen'], validate: () => true, handle: (m) => screenOnRevoked(m) },
  // Nom et groupes de cet écran (télécommande, 28-screens.js)
  'screen:config': {
    roles: ['screen'],
    validate: (m) => (m.name === undefined || _P.str(m.name, PROTO.NAME_MAX))
      && (m.groups === undefined || (Array.isArray(m.groups) && m.groups.length <= 16 && m.groups.every((g) => typeof g === 'string' && SRP.GROUP_ID_RE.test(g)))),
    handle: (m) => screenApplyConfig(m),
  },
  // kind « cache » : préparation hors ligne, rien d'interrompu ni d'affiché
  'rtc-offer':         { roles: ['screen'], validate: _validSdp('offer'), handle: (m) => screenHandleOffer(m.sdp, m.kind) },
  // Candidats ICE dans les deux sens : chaque rôle n'accepte que ceux de l'autre
  'rtc-ice': {
    roles: ['screen', 'remote'],
    validate: _validIce,
    handle(m) {
      if (mode === 'screen' && m.from === 'remote') screenAddIce(m.candidate);
      else if (mode === 'remote' && m.from === 'screen') remoteAddIce(m.candidate);
    },
  },

  // ─── Écran → télécommande ───
  'rtc-answer':        { roles: ['remote'], validate: _validSdp('answer'), handle: (m) => remoteHandleAnswer(m.sdp) },
  'media-meta':        { roles: ['remote'], validate: (m) => { m.dur = _P.num(m.dur, 0, 1e7) ?? 0; return true; }, handle: (m) => remoteOnMeta(m.dur) },
  'media-progress': {
    roles: ['remote'],
    validate(m) {
      m.cur = _P.num(m.cur, 0, 1e7) ?? 0; m.dur = _P.num(m.dur, 0, 1e7) ?? 0;
      if (typeof m.playing !== 'boolean') m.playing = undefined;
      return true;
    },
    handle: (m) => remoteOnProgress(m.cur, m.dur, m.playing),
  },
  'media-ended':       { roles: ['remote'], validate: (m) => { m.off = _P.bool(m.off); return true; }, handle: (m) => remoteOnEnded(m.off) },
  'media-error':       { roles: ['remote'], validate: (m) => { if (!_P.str(m.reason, 16)) m.reason = 'load'; return true; }, handle: (m) => remoteOnError(m.reason) },
  'media:advance': {
    roles: ['remote'],
    validate(m) {
      const d = _P.num(m.dir, -1, 1);
      m.dir = d === null ? 1 : Math.round(d);
      return true;
    },
    handle: (m) => advancePool(m.dir),
  },
  'media:cached':      { roles: ['remote'], validate: (m) => _P.id(m.id), handle: (m) => remoteOnScreenCached(m.id) },
  'media:chunkack': {
    roles: ['remote'],
    validate: (m) => _P.id(m.mediaId) && (m.got = _P.int(m.got, 0, PROTO.VID_MAX_CHUNKS) ?? 0, true),
    handle: (m) => remoteOnChunkAck(m),
  },
  'media:need-chunks': {
    roles: ['remote'],
    validate: (m) => _P.id(m.mediaId) && Array.isArray(m.missing) && m.missing.length <= PROTO.MISSING_MAX
      && m.missing.every((i) => _P.int(i, 0, PROTO.VID_MAX_CHUNKS - 1) !== null),
    handle: (m) => resendMissingChunks(m),
  },
  'chat:progress': {
    roles: ['remote'],
    validate: (m) => _chatId(m.id) && _P.int(m.total, 1, PROTO.CHAT_TEXT_MAX) !== null && _P.int(m.typed, 0, m.total) !== null,
    handle: (m) => remoteOnChatProgress(m),
  },
  'chat:sent':         { roles: ['remote'], validate: (m) => { m.undelivered = _P.bool(m.undelivered); return _chatId(m.id); }, handle: (m) => remoteOnChatSent(m) },
  'phone:gesture': {
    roles: ['remote'],
    validate: (m) => _P.oneOf(m.g, PROTO.PHONE_GESTURES) && (m.n === undefined || (m.g === 'notif' && _phoneId(m.n))),
    handle: (m) => remoteOnPhoneGesture(m),
  },
  'call:state':        { roles: ['remote'], validate: (m) => _P.oneOf(m.state, ['ringing', 'incall', 'declined', 'ended']), handle: (m) => remoteOnCallState(m) },
  // Couche Tel affichée par l'écran (resynchronisation, 80-call-simulator.js) : normalisée, sinon écartée
  'tel:state': {
    roles: ['remote'],
    validate(m) {
      const t = m.tel;
      if (t === null) return true;
      if (!_P.isObj(t) || !_P.oneOf(t.kind, ['call', 'sms', 'notif', 'chat']) || !_P.oneOf(t.state, ['ringing', 'incall', 'notif', 'open'])) return false;
      m.tel = { kind: t.kind, state: t.state, name: _P.text(t.name, PROTO.NAME_MAX).replace(/[\u0000-\u001F\u007F]/g, ' ') };
      if (t.kind === 'call' && t.state === 'incall' && typeof t.speaker === 'boolean') m.tel.speaker = t.speaker;
      return true;
    },
    handle: (m) => remoteOnTelState(m.tel),
  },
  'media:advanced':    { roles: ['remote'], validate: (m) => _P.id(m.id), handle: (m) => remoteOnScreenAdvanced(m.id) },
  'media:view': {
    roles: ['remote'],
    validate(m) {
      const n = _P.int(m.n, 1, PROTO.ORDER_MAX), idx = _P.int(m.idx, 0, PROTO.ORDER_MAX - 1);
      if (!_P.id(m.id) || n === null || idx === null || idx >= n) return false;
      if (m.vis == null) { delete m.vis; return true; }
      return Array.isArray(m.vis) && m.vis.length <= 4 && m.vis.every(_P.id);
    },
    handle: (m) => remoteOnScreenView(m),
  },
  'media:need':        { roles: ['remote'], validate: (m) => _P.id(m.id), handle: (m) => remoteOnScreenNeeds(m.id) },
  'key:answer': {
    roles: ['remote'],
    validate: (m) => SRP.SCREEN_ID_RE.test(m.sid) && SRP.SCREEN_ID_RE.test(m.rid) && SRP.EXCHANGE_ID_RE.test(m.xid) && _P.isObj(m.jwk),
    handle: (m) => remoteOnKeyAnswer(m),
  },
  // Signe de vie : la présence de l'écran est notée à la réception (20-mqtt.js)
  'screen:alive':      { roles: ['remote'], validate: () => true, handle: () => {} },
  'caps': {
    roles: ['remote'],
    validate(m) {
      if (m.videoMode != null && !_P.str(m.videoMode, 16)) m.videoMode = undefined;
      // Champs optionnels des écrans récents (absents chez les anciens / natifs)
      if (m.cached !== undefined && !(Array.isArray(m.cached) && m.cached.length <= PROTO.ORDER_MAX && m.cached.every(_P.id))) delete m.cached;
      if (m.active !== undefined && m.active !== null && !_P.id(m.active)) delete m.active;
      if (m.blackout !== undefined && typeof m.blackout !== 'boolean') delete m.blackout;
      return true;
    },
    handle: (m) => { applyReceiverCaps(m); remoteScheduleResync(m); },
  },
};

// Point d'entrée unique des messages reçus (MQTT et repli BroadcastChannel)
function dispatchMessage(msg) {
  if (!_P.isObj(msg) || typeof msg.type !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(MSG_ROUTES, msg.type)) return false;
  const route = MSG_ROUTES[msg.type];
  if (!route.roles.includes(mode)) return false;
  if (!route.validate(msg)) return false;
  // Console prioritaire (passerelle DMX) : ordres de look de la télécommande ignorés
  if (mode === 'screen' && !screenDmxAllows(msg.type)) return false;
  route.handle(msg);
  return true;
}

// ── Émission : bornage aux plages du schéma AVANT scellement ──
// Le schéma du paquet protocole REJETTE une valeur hors plage (ex. flash de
// 5 ms) là où le récepteur la bornait : l'émetteur borne donc lui-même (flash
// ≥ 15 ms, strobe ≤ 30 Hz…). Les curseurs du strobe suivent ces plafonds ;
// ce bornage reste le filet de sécurité (anciennes mémoires, valeurs forgées).
const _OUT_EFFECT_INT = { intensity: [0, 100], chaos: [0, 100], drift: [0, 100], smooth: [0, 100],
  count: [1, 32], width: [1, 100], wing: [1, 4], rot: [0, 360], lead: [0, 1000], fade: [0, 1000] };
function clampOutgoing(m) {
  if (!_P.isObj(m)) return m;
  const clampKeys = (o, keys, min, max, round) => {
    for (const k of keys) {
      if (o[k] === undefined) continue;
      const v = _P.num(o[k], min, max);
      if (v === null) delete o[k]; else o[k] = round ? Math.round(v) : v;
    }
  };
  switch (m.type) {
    case 'strobe':
      clampKeys(m, ['freq', 'freqMin', 'freqMax'], PROTO.STROBE_FREQ_MIN, PROTO.STROBE_FREQ_MAX);
      clampKeys(m, ['dur', 'durMin', 'durMax'], PROTO.STROBE_DUR_MIN, PROTO.STROBE_DUR_MAX);
      break;
    case 'effect':
      if (_P.isObj(m.params)) {
        const p = m.params;
        clampKeys(p, ['speed'], 0.01, 240);
        for (const k of Object.keys(_OUT_EFFECT_INT)) clampKeys(p, [k], _OUT_EFFECT_INT[k][0], _OUT_EFFECT_INT[k][1], true);
        if (Array.isArray(p.blocks)) p.blocks = p.blocks.filter(_P.hex).slice(0, 8);
        for (const k of ['color1', 'color2']) if (p[k] !== undefined && !_P.hex(p[k])) delete p[k];
      }
      break;
    case 'vibrate':
      if (typeof m.pattern === 'number') m.pattern = [m.pattern];
      if (Array.isArray(m.pattern)) {
        m.pattern = m.pattern.slice(0, PROTO.VIB_MAX_ENTRIES).map((v) => _P.num(v, 0, PROTO.VIB_MAX_MS) ?? 0);
      }
      break;
    case 'torch-dim': clampKeys(m, ['level'], 0, 100); break;
    case 'screen:brightness': clampKeys(m, ['value'], 0, 1); break;
    case 'media-ctrl': clampKeys(m, ['time'], 0, 1e7); break;
    case 'media-meta': m.dur = _P.num(m.dur, 0, 1e9); break;
    case 'media-progress': m.cur = _P.num(m.cur, 0, 1e9); m.dur = _P.num(m.dur, 0, 1e9); break;
    case 'call:start': {
      // Une ligne : aucun caractère de contrôle ; message : sauts de ligne permis
      const line = (v, max) => _P.text(v, max).replace(/[\u0000-\u001F\u007F]/g, ' ');
      m.name = line(m.name, PROTO.NAME_MAX); m.label = line(m.label, PROTO.NAME_MAX);
      m.appName = line(m.appName, PROTO.APP_MAX);
      m.msg = _P.text(m.msg, PROTO.MSG_MAX).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
      if (_P.isObj(m.lock)) m.lock = { time: line(m.lock.time, PROTO.LOCK_TIME_MAX), date: line(m.lock.date, PROTO.LOCK_DATE_MAX) };
      if (_P.isObj(m.phone)) {
        const ph = {};
        if (_pDate(m.phone.date)) ph.date = m.phone.date;
        if (_pTime(m.phone.time)) ph.time = m.phone.time;
        m.phone = ph;
      }
      if (_P.isObj(m.received)) {
        const r = m.received;
        if (r.mode === 'ago') m.received = { mode: 'ago', min: Math.round(_P.num(r.min, 0, PROTO.NOTIF_AGO_MAX) ?? 0) };
        else if (r.mode === 'at' && _pDate(r.date) && _pTime(r.time)) m.received = { mode: 'at', date: r.date, time: r.time };
        else m.received = { mode: 'now' };
      }
      if (m.appColor !== undefined && !_P.hex(m.appColor)) delete m.appColor;
      clampKeys(m, ['autoAnswer'], 0, 60, true);
      clampKeys(m, ['ringVolume'], 0, 1);
      if (_P.isObj(m.audio)) {
        const a = {}, d = _P.num(m.audio.delay, 0, PROTO.AUDIO_DELAY_MAX);
        if (d !== null) a.delay = Math.round(d);
        if (m.audio.route === 'ear' || m.audio.route === 'speaker') a.route = m.audio.route;
        if (typeof m.audio.prox === 'boolean') a.prox = m.audio.prox;
        m.audio = a;
      } else delete m.audio;
      if (m.ringId !== undefined && !_P.ringId(m.ringId)) delete m.ringId;
      break;
    }
    case 'chat:open': m.name = _P.text(m.name, PROTO.NAME_MAX).replace(/[\u0000-\u001F\u007F]/g, ' '); break;
    case 'phone:state':
      if (Array.isArray(m.notifs)) {
        const line = (v, max) => _P.text(v, max).replace(/[\u0000-\u001F\u007F]/g, ' ');
        m.notifs = m.notifs.slice(0, PROTO.PHONE_NOTIFS_MAX).map((n) => Object.assign({ id: n.id, kind: n.kind, app: line(n.app, PROTO.APP_MAX), name: line(n.name, PROTO.NAME_MAX),
          ago: Math.round(_P.num(n.ago, 0, PROTO.PHONE_AGO_MAX) ?? 0) },
        n.msg ? { msg: _P.text(n.msg, PROTO.MSG_MAX).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') } : {}, _P.hex(n.color) ? { color: n.color } : {},
        // Maquette 44 : appelant d'un appel manqué, icône / photo préparée (jamais sur un SMS)
        n.kind === 'missed' && n.who ? { who: line(n.who, PROTO.NAME_MAX) } : {},
        n.kind !== 'sms' && typeof n.img === 'string' && SRP.CALL_PHOTO_ID_RE.test(n.img) ? { img: n.img } : {}));
      }
      break;
    case 'chat:msg': m.text =_P.text(m.text, PROTO.CHAT_TEXT_MAX).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); break;
  }
  return m;
}
