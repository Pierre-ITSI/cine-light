/**
 * Schéma EXHAUSTIF des messages SetRemote (protocole applicatif).
 *
 * Construit en lisant le gestionnaire de messages de la PWA (aujourd'hui
 * MSG_ROUTES / dispatchMessage dans web/js/22-protocol.js, index.html étant
 * généré), tous les appels sendMsg({ type: … }) de web/js/, ainsi que
 * expo-app/app/{remote,screen}.tsx et expo-app/src/lib/useMediaPool.ts.
 *
 * Différence assumée avec MSG_ROUTES : l'app BORNE les valeurs hors plage
 * (ex. flash de 5 ms ramené à 15 ms) ; ce schéma les REJETTE. Les bornes sont
 * alignées sur PROTO (22-protocol.js) ; l'émetteur doit donc borner avant
 * d'envoyer (curseurs flashDur*Slider : min 5 → 15).
 *
 * Règles générales :
 *  - liste blanche STRICTE : type inconnu, champ inconnu, mauvais type,
 *    nombre non fini ou hors bornes ⇒ rejet ;
 *  - chaque chaîne / tableau a un plafond ;
 *  - `_id` (identifiant d'écho de l'ancien protocole en clair) est toléré ;
 *  - `target` (adressage multi-écran) est accepté sur tout message
 *    télécommande → écran : absent = tous les écrans, { screens: [...] } =
 *    écrans listés, { group: 'id' } = membres du groupe. Voir isAddressedTo().
 *
 * Sens : 'r2s' télécommande → écran, 's2r' écran → télécommande, 'both'.
 * Sources : 'web' = index.html (PWA), 'native' = expo-app.
 *
 * Hors périmètre MQTT (non listés ici, ne transitent pas par le relais) :
 *  - 'brightness', 'brightness-restore' : pont WebView → shell natif (expo-app/app/index.tsx) ;
 *  - 'setUniverse', 'dmx' : pont sACN WebSocket local (index.html, screen.html) ;
 *  - 'code_changed', 'error' : pont WebSocket de screen.html ;
 *  - messages du canal de données WebRTC ({ meta } / { done }).
 */

// ─────────────────────────── Briques de validation ───────────────────────────

/** @typedef {(v: unknown) => boolean} Check */
/** @typedef {{ check: Check, doc: string, optional: boolean }} Field */
/**
 * @typedef {{
 *   dir: 'r2s' | 's2r' | 'both',
 *   src: string[],
 *   doc: string,
 *   fields: Record<string, Field>,
 *   refine?: (m: any, opts: ValidateOptions) => string | null,
 * }} Spec
 * @typedef {{ direction?: 'r2s' | 's2r' }} ValidateOptions
 */

const hasOwn = (/** @type {object} */ o, /** @type {string} */ k) => Object.prototype.hasOwnProperty.call(o, k);

/** @param {unknown} v */
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/** @param {Check} check @param {string} doc @returns {Field} */
const req = (check, doc) => ({ check, doc, optional: false });
/** @param {Check} check @param {string} doc @returns {Field} */
const opt = (check, doc) => ({ check, doc, optional: true });

const bool = (/** @type {unknown} */ v) => typeof v === 'boolean';
/** @param {number} min @param {number} max @returns {Check} */
const num = (min, max) => v => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
/** @param {number} min @param {number} max @returns {Check} */
const int = (min, max) => v => Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max;
/** @param {...unknown} values @returns {Check} */
const oneOf = (...values) => v => values.includes(v);
/** @param {Check} c @returns {Check} */
const nullable = c => v => v === null || c(v);
/** @param {number} max @param {RegExp} [re] @returns {Check} */
const str = (max, re) => v => typeof v === 'string' && v.length <= max && (!re || re.test(v));
/** @param {Check} item @param {number} maxLen @param {number} [minLen] @returns {Check} */
const arrayOf = (item, maxLen, minLen = 0) => v => Array.isArray(v) && v.length >= minLen && v.length <= maxLen && v.every(x => item(x));
/**
 * Objet strict : champs connus uniquement.
 * @param {Record<string, Field>} fields
 * @returns {Check}
 */
const object = fields => v => {
  if (!isPlainObject(v)) return false;
  const o = /** @type {Record<string, unknown>} */ (v);
  for (const k of Object.keys(o)) {
    if (o[k] === undefined) continue;
    if (!hasOwn(fields, k) || !fields[k].check(o[k])) return false;
  }
  for (const [k, f] of Object.entries(fields)) if (!f.optional && o[k] === undefined) return false;
  return true;
};

// Chaînes : pas de caractères de contrôle (une ligne), ou texte multiligne.
const CTRL_ALL = /[\u0000-\u001F\u007F]/;
const CTRL_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
/** @param {number} max @returns {Check} */
const line = max => v => typeof v === 'string' && v.length <= max && !CTRL_ALL.test(v);
/** @param {number} max @returns {Check} */
const text = max => v => typeof v === 'string' && v.length <= max && !CTRL_TEXT.test(v);

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const MEDIA_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SCREEN_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
export const GROUP_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
/** Fragment de data-URL (images/sons) : aucun guillemet, parenthèse ni chevron possible. */
const DATAURL_SLICE_RE = /^[A-Za-z0-9+/=:;,.-]*$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const IMG_DATAURL_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const MIME_RE = /^[a-z]+\/[a-z0-9.+-]{1,40}$/i;
const PRINTABLE_RE = /^[\x20-\x7E\r\n]*$/;

const HEX = str(7, HEX_COLOR_RE);
const MEDIA_ID = str(64, MEDIA_ID_RE);
const SCREEN_ID = str(32, SCREEN_ID_RE);
const GROUP_ID = str(32, GROUP_ID_RE);
const LEGACY_ID = str(64, /^[A-Za-z0-9_-]{1,64}$/);

/** Plafonds exportés (documentation + tests). */
export const LIMITS = Object.freeze({
  strobeFreqHz: [0.1, 30],
  strobeFlashMs: [15, 2000],
  vibratePatternLength: 20,
  vibrateStepMs: 2000,
  effectCount: [1, 32],
  effectBlocks: 8,
  imgChunks: 2000,
  imgChunkChars: 20_000,
  uploadChunks: 50_000,
  uploadChunkChars: 20_000,
  poolSize: 500,
  missingChunks: 400,
  callPhotoChars: 600_000,
  sdpChars: 200_000,
  iceCandidateChars: 4096,
  targetScreens: 64,
  screenGroups: 16,
  screenNameChars: 40,
});

const TARGET = (/** @type {unknown} */ v) => {
  if (!isPlainObject(v)) return false;
  const t = /** @type {Record<string, unknown>} */ (v);
  const keys = Object.keys(t);
  if (keys.length !== 1) return false;
  if (keys[0] === 'screens') return arrayOf(SCREEN_ID, LIMITS.targetScreens, 1)(t.screens);
  if (keys[0] === 'group') return GROUP_ID(t.group);
  return false;
};

const EFFECT_NAMES = [
  'chaser', 'noise', 'aurora', 'water',
  'pulse', 'traffic', 'weld', 'neon', 'police', 'lightning', 'paparazzi',
  'tv', 'candle', 'fire',
];

const EFFECT_PARAMS = object({
  speed: opt(num(0.01, 240), 'vitesse / BPM selon l’effet'),
  intensity: opt(int(0, 100), 'intensité %'),
  chaos: opt(int(0, 100), 'chaos %'),
  drift: opt(int(0, 100), 'dérive %'),
  count: opt(int(...LIMITS.effectCount), 'bandes / grain / flashes par rafale'),
  dir: opt(oneOf('h', 'v', 'd', 'out', 'in'), 'direction (bande) ou sens radial'),
  shape: opt(oneOf('band', 'circle', 'diamond'), 'forme du chaser'),
  mode: opt(oneOf('loop', 'bounce'), 'course du chaser'),
  invert: opt(bool, 'inversion du sens'),
  width: opt(int(1, 100), 'largeur de bande %'),
  wing: opt(int(1, 4), 'wing'),
  rot: opt(int(0, 360), 'rotation °'),
  lead: opt(int(0, 1000), 'fondu avant ms'),
  smooth: opt(int(0, 100), 'lissage %'),
  fade: opt(int(0, 1000), 'traîne / fondu ms'),
  color1: opt(HEX, 'couleur 1'),
  color2: opt(HEX, 'couleur 2'),
  blocks: opt(arrayOf(HEX, LIMITS.effectBlocks, 1), 'blocs couleur (TV)'),
});

const SDP = (/** @type {'offer'|'answer'} */ kind) => object({
  type: req(oneOf(kind), kind),
  sdp: req(str(LIMITS.sdpChars, PRINTABLE_RE), 'SDP'),
});

const ICE = object({
  candidate: req(str(LIMITS.iceCandidateChars, PRINTABLE_RE), 'ligne candidate'),
  sdpMid: opt(nullable(line(64)), 'sdpMid'),
  sdpMLineIndex: opt(nullable(int(0, 255)), 'sdpMLineIndex'),
  usernameFragment: opt(nullable(line(256)), 'ufrag'),
});

const STROBE_FREQ = num(...LIMITS.strobeFreqHz);
const STROBE_DUR = num(...LIMITS.strobeFlashMs);

// ─────────────────────────── Table des messages ───────────────────────────

/** @type {Record<string, Spec>} */
const SPECS = {
  // ═══ Télécommande → écran : lumière ═══
  'color': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Couleur de fond de l’écran (envoi continu pendant le réglage, ~25 Hz max).',
    fields: { color: req(HEX, 'couleur #rrggbb') },
  },
  'strobe': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Stroboscope. active:false l’arrête (seul champ alors envoyé). Plafonds : 0,1–30 Hz, flash 15–2000 ms '
      + '(mêmes bornes que PROTO dans web/js/22-protocol.js ; le schéma REJETTE au lieu de borner).',
    fields: {
      active: req(bool, 'marche/arrêt'),
      torch: opt(bool, 'flash LED synchronisé (web)'),
      vibrate: opt(bool, 'vibration synchronisée (natif)'),
      random: opt(bool, 'mode aléatoire entre min et max'),
      freq: opt(STROBE_FREQ, 'fréquence Hz'),
      dur: opt(STROBE_DUR, 'durée du flash ms'),
      freqMin: opt(STROBE_FREQ, 'fréquence min Hz (aléatoire)'),
      freqMax: opt(STROBE_FREQ, 'fréquence max Hz (aléatoire)'),
      durMin: opt(STROBE_DUR, 'flash min ms (aléatoire)'),
      durMax: opt(STROBE_DUR, 'flash max ms (aléatoire)'),
    },
    refine: m => {
      if (!m.active) return null;
      if (m.freq === undefined || m.dur === undefined) return 'strobe actif sans freq/dur';
      if (m.random && [m.freqMin, m.freqMax, m.durMin, m.durMax].some(x => x === undefined)) return 'strobe aléatoire incomplet';
      return null;
    },
  },
  'effect': {
    dir: 'r2s', src: ['web'],
    doc: 'Effet animé plein écran (moteur canvas). active:false arrête l’effet.',
    fields: {
      name: req(nullable(oneOf(...EFFECT_NAMES)), 'nom de l’effet (null à l’arrêt)'),
      active: req(bool, 'marche/arrêt'),
      params: opt(EFFECT_PARAMS, 'paramètres (liste fermée, bornés)'),
    },
    refine: m => (m.active && m.name === null ? 'effet actif sans nom' : null),
  },
  'blackout': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Voile noir total (écran « OFF »).',
    fields: { on: req(bool, 'noir actif') },
  },
  'screen:brightness': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Luminosité de l’écran de jeu (voile ou rétroéclairage natif).',
    fields: { value: req(num(0, 1), '0..1') },
  },
  'vibrate': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Motif de vibration (ms alternés vibre/pause) : ≤ 20 valeurs de 0 à 2000 ms.',
    fields: {
      pattern: req(arrayOf(num(0, LIMITS.vibrateStepMs), LIMITS.vibratePatternLength, 1), 'durées ms'),
      repeat: opt(bool, 'répétition (natif, toujours false aujourd’hui)'),
    },
  },
  'torch-onoff': {
    dir: 'r2s', src: ['web'],
    doc: 'Torche LED allumée/éteinte.',
    fields: { on: req(bool, 'allumée') },
  },
  'torch-dim': {
    dir: 'r2s', src: ['web'],
    doc: 'Gradation de la torche (PWM logiciel côté web, binaire en natif).',
    fields: { level: req(num(0, 100), 'niveau %') },
  },
  'torch-effect': {
    dir: 'r2s', src: ['web'],
    doc: 'Motif prédéfini de la torche.',
    fields: { effect: req(oneOf('sos', 'blink-slow', 'blink-fast', 'police', 'heartbeat', 'stop'), 'motif') },
  },
  'torch': {
    dir: 'r2s', src: ['native'],
    doc: 'Commande torche de la télécommande native.',
    fields: {
      mode: req(oneOf('off', 'on', 'flash'), 'mode'),
      onMs: opt(int(10, 10_000), 'durée allumée ms'),
      offMs: opt(int(10, 10_000), 'durée éteinte ms'),
      repeats: opt(int(1, 1000), 'répétitions'),
      loop: opt(bool, 'en boucle'),
    },
  },

  // ═══ Télécommande → écran : session / écrans ═══
  'hello': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Demande aux écrans d’annoncer leurs capacités (réponse : caps).',
    fields: {},
  },
  'screen:config': {
    dir: 'r2s', src: [],
    doc: 'Nouveau (multi-écran) : renomme un écran et/ou fixe ses groupes. Doit cibler target.screens.',
    fields: {
      name: opt(line(LIMITS.screenNameChars), 'nom affiché de l’écran'),
      groups: opt(arrayOf(GROUP_ID, LIMITS.screenGroups), 'groupes dont l’écran est membre (remplace la liste)'),
    },
    refine: m => {
      if (!m.target || !m.target.screens) return 'screen:config doit cibler target.screens';
      if (m.name === undefined && m.groups === undefined) return 'screen:config vide';
      return null;
    },
  },

  // ═══ Télécommande → écran : médias ═══
  'media-img-start': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Début de transfert d’une image/son en data-URL fragmentée (fragments media-img-chunk).',
    fields: {
      id: req(MEDIA_ID, 'identifiant du transfert'),
      total: req(int(1, LIMITS.imgChunks), 'nombre de fragments'),
      mediaId: opt(nullable(MEDIA_ID), 'id du média en cache (__lockwall, __callaudio, m12…)'),
      show: opt(bool, 'afficher à réception (false = préchargement)'),
    },
  },
  'media-img-chunk': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Fragment de data-URL (12 000 caractères en pratique).',
    fields: {
      id: req(MEDIA_ID, 'identifiant du transfert'),
      i: req(int(0, LIMITS.imgChunks - 1), 'index'),
      data: req(str(LIMITS.imgChunkChars, DATAURL_SLICE_RE), 'tranche de data-URL'),
    },
  },
  'media-stop': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Masque le média affiché (retour à la couleur).',
    fields: {},
  },
  'media:stop': {
    dir: 'r2s', src: ['native'],
    doc: 'Équivalent natif de media-stop.',
    fields: {},
  },
  'media:show': {
    dir: 'r2s', src: ['web'],
    doc: 'Affiche un média déjà en cache sur l’écran (sinon l’écran répond media:need).',
    fields: { id: req(MEDIA_ID, 'id du média') },
  },
  'media:order': {
    dir: 'r2s', src: ['web'],
    doc: 'Ordre du pool, pour l’avance locale au tap.',
    fields: { ids: req(arrayOf(MEDIA_ID, LIMITS.poolSize), 'ids dans l’ordre') },
  },
  'media:evict': {
    dir: 'r2s', src: ['web'],
    doc: 'Retire un média du cache écran.',
    fields: { id: req(MEDIA_ID, 'id du média') },
  },
  'media:clear': {
    dir: 'r2s', src: ['native'],
    doc: 'Équivalent natif de media:evict (mediaId « all » = tout vider).',
    fields: { mediaId: req(MEDIA_ID, 'id du média ou « all »') },
  },
  'media:autoadvance': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Option « tap sur l’écran = média suivant ».',
    fields: { on: req(bool, 'activée') },
  },
  'media-ctrl': {
    dir: 'r2s', src: ['web'],
    doc: 'Lecture / pause / recherche de la vidéo affichée.',
    fields: {
      action: req(oneOf('play', 'pause', 'seek'), 'action'),
      time: opt(num(0, 1e7), 'position s (seek)'),
    },
    refine: m => (m.action === 'seek' && m.time === undefined ? 'seek sans time' : null),
  },
  'media:endmode': {
    dir: 'r2s', src: ['web'],
    doc: 'Fin de vidéo : boucle, pause sur la dernière image, ou extinction.',
    fields: { mode: req(oneOf('loop', 'pause', 'off'), 'mode') },
  },
  'media:upload': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Début d’envoi d’un fichier en base64 fragmenté (repli sans WebRTC / écran natif).',
    fields: {
      mediaId: req(MEDIA_ID, 'id du transfert'),
      kind: req(oneOf('video', 'image'), 'type'),
      mime: req(str(80, MIME_RE), 'type MIME'),
      totalChunks: req(int(1, LIMITS.uploadChunks), 'nombre de fragments'),
      poolId: opt(nullable(MEDIA_ID), 'id du média dans le pool (cache)'),
    },
  },
  'media:chunk': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Fragment base64 (12 000 caractères en pratique).',
    fields: {
      mediaId: req(MEDIA_ID, 'id du transfert'),
      index: req(int(0, LIMITS.uploadChunks - 1), 'index'),
      data: req(str(LIMITS.uploadChunkChars, BASE64_RE), 'base64'),
    },
  },
  'media:play': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Fin d’envoi : assembler et lire (web) ; lire depuis le cache (natif).',
    fields: { mediaId: req(MEDIA_ID, 'id du transfert') },
  },

  // ═══ Télécommande → écran : faux appel / notification ═══
  'call:start': {
    dir: 'r2s', src: ['web'],
    doc: 'Faux appel entrant ou notification (SMS / messagerie) affiché par l’écran.',
    fields: {
      kind: req(oneOf('call', 'sms', 'chat', 'whatsapp'), 'appel / sms / messagerie (whatsapp = ancien nom)'),
      style: opt(oneOf('glass', 'tonal', 'minimal', 'ios', 'android', 'generic'), 'style visuel (ios/android/generic = anciens noms)'),
      name: opt(line(40), 'nom de l’appelant'),
      label: opt(line(40), 'sous-titre'),
      msg: opt(text(200), 'texte du message'),
      appName: opt(line(24), 'nom de l’application fictive'),
      appColor: opt(HEX, 'couleur de l’application fictive'),
      photo: opt(nullable(str(LIMITS.callPhotoChars, IMG_DATAURL_RE)), 'photo data:image/…;base64 (pas d’URL)'),
      ring: opt(oneOf('classic', 'digital', 'soft', 'silent'), 'sonnerie'),
      present: opt(oneOf('full', 'banner'), 'plein écran ou bandeau'),
      photoMode: opt(oneOf('avatar', 'full'), 'photo en avatar ou plein écran'),
      hasAudio: opt(bool, 'bande son préchargée (__callaudio) à jouer au décroché'),
      autoAnswer: opt(int(0, 60), 'décroché automatique après n s (0 = non)'),
      lock: opt(nullable(object({
        time: req(line(8), 'heure affichée'),
        date: req(line(30), 'date affichée'),
      })), 'faux écran verrouillé'),
    },
  },
  'call:answer': { dir: 'r2s', src: ['web'], doc: 'Décroche le faux appel.', fields: {} },
  'call:end': { dir: 'r2s', src: ['web'], doc: 'Termine le faux appel / la notification.', fields: {} },

  // ═══ Signalisation WebRTC (transfert vidéo pair-à-pair) ═══
  'rtc-offer': {
    dir: 'r2s', src: ['web'],
    doc: 'Offre WebRTC (canal de données « file »). En multi-écran : cibler UN écran (target.screens).',
    fields: {
      sdp: req(SDP('offer'), 'RTCSessionDescription'),
      kind: opt(oneOf('file'), 'usage'),
    },
  },
  'rtc-answer': {
    dir: 's2r', src: ['web'],
    doc: 'Réponse WebRTC de l’écran.',
    fields: { sdp: req(SDP('answer'), 'RTCSessionDescription') },
  },
  'rtc-ice': {
    dir: 'both', src: ['web'],
    doc: 'Candidat ICE ; `from` doit correspondre au sens réel.',
    fields: {
      from: req(oneOf('remote', 'screen'), 'émetteur'),
      candidate: req(ICE, 'RTCIceCandidate.toJSON()'),
    },
    refine: (m, o) => {
      if (o.direction === 'r2s' && m.from !== 'remote') return 'rtc-ice r2s doit avoir from=remote';
      if (o.direction === 's2r' && m.from !== 'screen') return 'rtc-ice s2r doit avoir from=screen';
      if (m.from === 'screen' && m.target !== undefined) return 'target interdit depuis un écran';
      return null;
    },
  },

  // ═══ Écran → télécommande ═══
  'caps': {
    dir: 's2r', src: ['web', 'native'],
    doc: 'Capacités et identité de l’écran (au démarrage et en réponse à hello).',
    fields: {
      torch: req(bool, 'torche disponible'),
      vibrate: req(bool, 'vibreur disponible'),
      videoMode: opt(oneOf('rtc', 'b64', 'none'), 'transport vidéo accepté'),
      media: opt(bool, 'cache média natif disponible'),
      cached: opt(arrayOf(MEDIA_ID, LIMITS.poolSize), 'ids présents dans le cache de l’écran (resynchronisation)'),
      active: opt(nullable(MEDIA_ID), 'média affiché (null = aucun ; absent = inconnu)'),
      blackout: opt(bool, 'écran actuellement en noir'),
      screenId: opt(SCREEN_ID, 'nouveau : identifiant stable de l’écran (tiré au 1er lancement)'),
      name: opt(line(LIMITS.screenNameChars), 'nouveau : nom affiché de l’écran'),
      groups: opt(arrayOf(GROUP_ID, LIMITS.screenGroups), 'nouveau : groupes de l’écran'),
    },
  },
  'media-meta': {
    dir: 's2r', src: ['web'],
    doc: 'Durée de la vidéo chargée (null si infinie/inconnue).',
    fields: { dur: req(nullable(num(0, 1e9)), 'durée s') },
  },
  'media-progress': {
    dir: 's2r', src: ['web'],
    doc: 'Position de lecture (≈ 4 Hz).',
    fields: {
      cur: req(nullable(num(0, 1e9)), 'position s'),
      dur: req(nullable(num(0, 1e9)), 'durée s'),
      playing: req(bool, 'en lecture'),
    },
  },
  'media-ended': {
    dir: 's2r', src: ['web'],
    doc: 'Fin de lecture ; off:true si l’écran a coupé le média (mode « off »).',
    fields: { off: opt(bool, 'média coupé') },
  },
  'media-error': {
    dir: 's2r', src: ['web'],
    doc: 'Vidéo illisible sur l’écran.',
    fields: { reason: req(oneOf('src', 'decode', 'load'), 'cause') },
  },
  'media:advance': {
    dir: 's2r', src: ['web', 'native'],
    doc: 'Tap sur l’écran : demande le média suivant/précédent à la télécommande.',
    fields: { dir: req(oneOf(-1, 1), '+1 / -1') },
  },
  'media:advanced': {
    dir: 's2r', src: ['web'],
    doc: 'L’écran a avancé seul (média suivant déjà en cache).',
    fields: { id: req(MEDIA_ID, 'id affiché') },
  },
  'media:cached': {
    dir: 's2r', src: ['web'],
    doc: 'Accusé : média en cache sur l’écran.',
    fields: { id: req(MEDIA_ID, 'id du média') },
  },
  'media:need': {
    dir: 's2r', src: ['web'],
    doc: 'media:show pour un média absent du cache : demande l’envoi complet.',
    fields: { id: req(MEDIA_ID, 'id du média') },
  },
  'media:chunkack': {
    dir: 's2r', src: ['web'],
    doc: 'Accusé cumulatif de fragments media:chunk reçus (régulation du débit).',
    fields: {
      mediaId: req(MEDIA_ID, 'id du transfert'),
      got: req(int(0, LIMITS.uploadChunks), 'fragments reçus'),
    },
  },
  'media:need-chunks': {
    dir: 's2r', src: ['web'],
    doc: 'Fragments manquants à renvoyer.',
    fields: {
      mediaId: req(MEDIA_ID, 'id du transfert'),
      missing: req(arrayOf(int(0, LIMITS.uploadChunks - 1), LIMITS.missingChunks), 'indices'),
    },
  },
  'media:ready': {
    dir: 's2r', src: ['native'],
    doc: 'Accusé natif : média complet en cache.',
    fields: { mediaId: req(MEDIA_ID, 'id du média') },
  },
  'call:state': {
    dir: 's2r', src: ['web'],
    doc: 'État du faux appel côté écran.',
    fields: { state: req(oneOf('ringing', 'incall', 'declined', 'ended'), 'état') },
  },
};

// ─────────────────────────── API ───────────────────────────

/**
 * Explique pourquoi un message est rejeté ; null s'il est valide.
 * @param {unknown} msg
 * @param {ValidateOptions} [opts]
 * @returns {string | null}
 */
export function explainInvalid(msg, opts = {}) {
  try {
    if (!isPlainObject(msg)) return 'objet attendu';
    const m = /** @type {Record<string, any>} */ (msg);
    const type = m.type;
    if (typeof type !== 'string' || !hasOwn(SPECS, type)) return `type inconnu : ${String(type).slice(0, 40)}`;
    const spec = SPECS[type];
    const dir = opts.direction;
    if (dir !== undefined) {
      if (dir !== 'r2s' && dir !== 's2r') return 'direction invalide';
      if (spec.dir !== 'both' && spec.dir !== dir) return `${type} n’est pas autorisé dans le sens ${dir}`;
    }
    for (const k of Object.keys(m)) {
      if (k === 'type') continue;
      const v = m[k];
      if (v === undefined) continue;
      if (k === '_id') {
        if (!LEGACY_ID(v)) return '_id invalide';
        continue;
      }
      if (k === 'target') {
        if (spec.dir === 's2r') return 'target interdit sur un message écran → télécommande';
        if (!TARGET(v)) return 'target invalide';
        continue;
      }
      if (!hasOwn(spec.fields, k)) return `champ inconnu : ${k.slice(0, 40)}`;
      if (!spec.fields[k].check(v)) return `champ invalide : ${k}`;
    }
    for (const [k, f] of Object.entries(spec.fields)) {
      if (!f.optional && m[k] === undefined) return `champ manquant : ${k}`;
    }
    return spec.refine ? spec.refine(m, opts) : null;
  } catch (_) {
    return 'exception pendant la validation';
  }
}

/**
 * Valide un message applicatif (avant envoi ET après réception).
 * @param {unknown} msg
 * @param {ValidateOptions} [opts]  direction : 'r2s' | 's2r' pour vérifier aussi le sens
 * @returns {boolean}
 */
export function validate(msg, opts = {}) {
  return explainInvalid(msg, opts) === null;
}

/**
 * Le message concerne-t-il cet écran ? (absence de target = tous les écrans)
 * À appeler côté écran sur chaque message reçu, après validate().
 *
 * @param {{ target?: { screens?: string[], group?: string } }} msg
 * @param {{ screenId: string, groups?: string[] }} me
 * @returns {boolean}
 */
export function isAddressedTo(msg, me) {
  const t = msg && msg.target;
  if (t === undefined || t === null) return true;
  if (Array.isArray(t.screens)) return t.screens.includes(me.screenId);
  if (typeof t.group === 'string') return Array.isArray(me.groups) && me.groups.includes(t.group);
  return false;
}

/**
 * Documentation lisible de chaque type : sens, sources, description, champs.
 * @type {Readonly<Record<string, Readonly<{
 *   direction: 'r2s' | 's2r' | 'both',
 *   sources: readonly string[],
 *   description: string,
 *   fields: Readonly<Record<string, Readonly<{ required: boolean, description: string }>>>
 * }>>>}
 */
export const MESSAGE_TYPES = Object.freeze(Object.fromEntries(
  Object.entries(SPECS).map(([type, s]) => [type, Object.freeze({
    direction: s.dir,
    sources: Object.freeze([...s.src]),
    description: s.doc,
    fields: Object.freeze(Object.fromEntries(
      Object.entries(s.fields).map(([k, f]) => [k, Object.freeze({ required: !f.optional, description: f.doc })]),
    )),
  })]),
));

/** Champs communs acceptés en plus des champs propres à chaque type. */
export const COMMON_FIELDS = Object.freeze({
  _id: 'identifiant d’écho de l’ancien protocole en clair (toléré, inutile en v2)',
  target: "adressage (r2s uniquement) : { screens: [screenId…] } ou { group: 'id' } ; absent = tous",
});
