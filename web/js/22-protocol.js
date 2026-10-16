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
  bool: (v) => !!v,
};

// Plafonds réseau
const PROTO = {
  STROBE_FREQ_MIN: 0.1, STROBE_FREQ_MAX: 30,   // Hz (période ≥ durée + 5 ms : voir receiveStrobe)
  STROBE_DUR_MIN: 15, STROBE_DUR_MAX: 2000,    // ms
  VIB_MAX_ENTRIES: 20, VIB_MAX_MS: 2000,
  NAME_MAX: 40, MSG_MAX: 200, APP_MAX: 24, LOCK_TIME_MAX: 8, LOCK_DATE_MAX: 30,
  SDP_MAX: 16000, ICE_MAX: 4096,               // = LIMITS du schéma (packages/protocol)
  ORDER_MAX: 500, MISSING_MAX: 400,
  VID_MAX_CHUNKS: 50000,                       // ≈ 600 Mo base64 en fragments de 12 000
  CALL_RINGS: ['classic', 'digital', 'soft', 'silent'],
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

function _validCallStart(m) {
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
  if (!_P.oneOf(m.ring, PROTO.CALL_RINGS)) m.ring = 'classic';
  m.lock = _P.isObj(m.lock)
    ? { time: _P.text(m.lock.time, PROTO.LOCK_TIME_MAX), date: _P.text(m.lock.date, PROTO.LOCK_DATE_MAX) }
    : null;
  m.autoAnswer = _P.num(m.autoAnswer, 0, 60) ?? 0;
  m.hasAudio = _P.bool(m.hasAudio);
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
    handle: (m) => { _mediaOrder = m.ids; },
  },
  'media:evict':       { roles: ['screen'], validate: (m) => _P.id(m.id), handle: (m) => screenEvictCached(m.id) },
  'media:autoadvance': { roles: ['screen'], validate: (m) => { m.on = _P.bool(m.on); return true; }, handle: (m) => { _screenAutoAdvance = m.on; } },
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
  // Passerelle DMX : look calculé depuis la console (36-dmx-screen.js, docs/DMX.md § 7)
  'dmx:look': {
    roles: ['screen'],
    validate: (m) => _P.int(m.seq, 0, 0xffff) !== null && typeof m.live === 'boolean'
      && (m.look = SRDMX.expandLook(m.look)) !== null,
    handle: (m) => screenApplyDmxLook(m),
  },
  'screen:identify':   { roles: ['screen'], validate: () => true, handle: () => screenIdentify() },
  'rtc-offer':         { roles: ['screen'], validate: _validSdp('offer'), handle: (m) => screenHandleOffer(m.sdp) },
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
  'media:cached':      { roles: ['remote'], validate: (m) => _P.id(m.id), handle: (m) => { _screenCached.add(m.id); _preloadInflight.delete(m.id); } },
  'media:chunkack': {
    roles: ['remote'],
    validate: (m) => _P.id(m.mediaId) && (m.got = _P.int(m.got, 0, PROTO.VID_MAX_CHUNKS) ?? 0, true),
    handle: (m) => { if (_b64Ack.id === m.mediaId) _b64Ack.got = Math.max(_b64Ack.got, m.got); },
  },
  'media:need-chunks': {
    roles: ['remote'],
    validate: (m) => _P.id(m.mediaId) && Array.isArray(m.missing) && m.missing.length <= PROTO.MISSING_MAX
      && m.missing.every((i) => _P.int(i, 0, PROTO.VID_MAX_CHUNKS - 1) !== null),
    handle: (m) => resendMissingChunks(m),
  },
  'call:state':        { roles: ['remote'], validate: (m) => _P.oneOf(m.state, ['ringing', 'incall', 'declined', 'ended']), handle: (m) => remoteOnCallState(m) },
  'media:advanced':    { roles: ['remote'], validate: (m) => _P.id(m.id), handle: (m) => remoteOnScreenAdvanced(m.id) },
  'media:need':        { roles: ['remote'], validate: (m) => _P.id(m.id), handle: (m) => remoteOnScreenNeeds(m.id) },
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
// 5 ms) là où le récepteur la bornait : l'émetteur borne donc lui-même, sans
// toucher aux curseurs de l'interface (flash ≥ 15 ms, strobe ≤ 30 Hz…).
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
      if (m.appColor !== undefined && !_P.hex(m.appColor)) delete m.appColor;
      clampKeys(m, ['autoAnswer'], 0, 60, true);
      break;
    }
  }
  return m;
}
