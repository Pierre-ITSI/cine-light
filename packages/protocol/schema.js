// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
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
 *  - canal : la plupart des messages voyagent dans la SESSION (clé commune) ;
 *    ceux marqués `chan: 'pairwise'` (clés par écran : key:confirm, key:ok,
 *    session:rekey, rekey:ok) ne sont valides QUE scellés avec la clé de
 *    l'écran (pairwise.js), et inversement. explainInvalid(msg, { channel })
 *    l'impose ('session' par défaut) : une session:rekey forgée avec la clé
 *    de session est refusée.
 *
 * Sens : 'r2s' télécommande → écran, 's2r' écran → télécommande, 'both'.
 * Sources : 'web' = index.html (PWA), 'native' = expo-app.
 *
 * Hors périmètre MQTT (non listés ici, ne transitent pas par le relais) :
 *  - 'brightness', 'brightness-restore' : pont WebView → shell natif (expo-app/app/index.tsx) ;
 *  - 'vibrate' { pattern } (même forme que le message relayé) et 'vibrate:stop' :
 *    vibreur de l'écran de jeu par la coque (Vibration de React Native) ;
 *  - 'dmx:listen', 'dmx:stop', 'udp:send', 'net:info' (PWA → coque) et
 *    'dmx:packets', 'net:info', 'dmx:error' (coque → PWA, window.SRNative.receive) :
 *    réception UDP de la passerelle DMX (docs/DMX-NATIVE.md, contrat du pont) ;
 *  - 'pdf:preview' (PWA → coque) et 'pdf:error' (coque → PWA) : aperçu PDF de
 *    la table des canaux DMX (expo-print, expo-app/src/lib/pdfPreview.ts) ;
 *  - 'link:start', 'link:stop', 'link:send', 'link:state?' (PWA → coque) et
 *    'link:frames', 'link:peers', 'link:state', 'link:error' (coque → PWA) :
 *    liaisons locales Wi-Fi / Bluetooth (docs/OFFLINE.md). Elles portent les
 *    MÊMES trames scellées que le relais : seule l'enveloppe est hors schéma ;
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
 *   chan?: 'session' | 'pairwise',
 * }} Spec
 * @typedef {{ direction?: 'r2s' | 's2r', channel?: 'session' | 'pairwise' }} ValidateOptions
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
/** Son importé (sonnerie / notification) : id dérivé du contenu, « __ring_ » + 16 hex (SHA-256 tronqué). */
export const RING_ID_RE = /^__ring_[0-9a-f]{16}$/;
/**
 * Photo / bande son d'un appel enregistré, PRÉPARÉE sur l'écran (tournage sans
 * réseau, docs/OFFLINE.md) : id dérivé du contenu, « __ph_ » / « __au_ » + 40 hex
 * (SHA-256 tronqué). 45 caractères exprès : un écran d'une version antérieure
 * n'accepte en cache que des ids de 40 caractères au plus, il ne l'accuse donc
 * jamais et la télécommande ne lui envoie jamais photoId / audioId.
 */
export const CALL_PHOTO_ID_RE = /^__ph_[0-9a-f]{40}$/;
export const CALL_AUDIO_ID_RE = /^__au_[0-9a-f]{40}$/;
/** Message d’une discussion fictive (chat:*) : identifiant court tiré par la télécommande. */
export const CHAT_ID_RE = /^[A-Za-z0-9_-]{1,12}$/;
/** Notification empilée sur le faux téléphone d’une Séquence (phone:*) : identifiant court tiré par la télécommande. */
export const PHONE_NOTIF_ID_RE = /^[A-Za-z0-9_-]{1,12}$/;
/**
 * Gestes du comédien rapportés par l’écran (phone:gesture) ; « unlock » : code complet ou glissement ;
 * « dismiss » : alerte « Batterie faible » fermée. Ces deux-là partent toujours (jamais « attendus »).
 */
export const PHONE_GESTURES = Object.freeze(['touch', 'notif', 'hangup', 'answer', 'unlock', 'home', 'dismiss']);
/** Gestes toujours rapportés (hors phone:state.watch). */
export const PHONE_GESTURES_ALWAYS = Object.freeze(['unlock', 'dismiss']);
/** Réseau mobile affiché dans la barre d’état du faux téléphone. */
export const PHONE_NET_TYPES = Object.freeze(['3G', '4G', '5G']);
/** Date et heure du faux téléphone (notification) : AAAA-MM-JJ et HH:MM (24 h). */
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Fragment de data-URL (images/sons) : aucun guillemet, parenthèse ni chevron possible. */
const DATAURL_SLICE_RE = /^[A-Za-z0-9+/=:;,.-]*$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MIME_RE = /^[a-z]+\/[a-z0-9.+-]{1,40}$/i;
const PRINTABLE_RE = /^[\x20-\x7E\r\n]*$/;

const B64U = (/** @type {number} */ n) => str(n, new RegExp(`^[A-Za-z0-9_-]{${n}}$`));
/** Clé publique ECDH P-256 (JWK réduit, comme pair:key) */
const JWK = object({
  kty: req(oneOf('EC'), 'EC'), crv: req(oneOf('P-256'), 'P-256'),
  x: req(B64U(43), 'abscisse base64url'), y: req(B64U(43), 'ordonnée base64url'),
});
const HEX = str(7, HEX_COLOR_RE);
const MEDIA_ID = str(64, MEDIA_ID_RE);
const SCREEN_ID = str(32, SCREEN_ID_RE);
const GROUP_ID = str(32, GROUP_ID_RE);
const LEGACY_ID = str(64, /^[A-Za-z0-9_-]{1,64}$/);
const CHAT_ID = str(12, CHAT_ID_RE);
const DATE = str(10, DATE_RE);
const TIME = str(5, TIME_RE);
const STYLE3 = oneOf('glass', 'tonal', 'minimal');
const PHONE_ID = str(12, PHONE_NOTIF_ID_RE);
const RINGS = oneOf('classic', 'digital', 'soft', 'silent');
/** Tableau sans doublon */
const unique = (/** @type {unknown[]} */ a) => new Set(a).size === a.length;

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
  sdpChars: 16_000,
  iceCandidateChars: 4096,
  targetScreens: 64,
  screenGroups: 16,
  screenNameChars: 40,
  dmxMediaSlots: 25,
  keyIdChars: 11,
  exchangeIdChars: 16,
  notifAgoMinutes: 10_080,
  chatMessages: 40,
  chatTextChars: 300,
  chatNameChars: 40,
  phoneNotifs: 8,
  phoneAgoSeconds: 604_800,
  phoneClockSeconds: 604_800,
  phoneSleepSeconds: [1, 120],
  chatPauseSeconds: 60,
  chatWriteSeconds: [1, 60],
});
const KID = B64U(11);
const XID = B64U(16);
/** Un seul écran visé (échange de clés, retrait) */
const ONE_SCREEN = (/** @type {any} */ m, /** @type {string} */ type) => (!m.target || !Array.isArray(m.target.screens) || m.target.screens.length !== 1
  ? `${type} doit cibler UN écran (target.screens)` : null);

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

/** Look calculé par la passerelle DMX (packages/dmx) : champs par défaut omis. */
const DMX_LOOK = object({
  color: req(HEX, 'couleur #rrggbb, dimmer et mélange couleur/blanc déjà appliqués'),
  strobe: opt(object({
    freq: req(STROBE_FREQ, 'fréquence Hz (la passerelle émet 0,5–30)'),
    dur: req(STROBE_DUR, 'durée du flash ms'),
  }), 'stroboscope actif (absent = pas de strobe)'),
  effect: opt(object({
    name: req(oneOf(...EFFECT_NAMES), 'effet'),
    speed: req(num(0.01, 240), 'vitesse dans l’unité de l’effet'),
    intensity: req(int(0, 100), 'intensité % (= dimmer de la console)'),
  }), 'effet en cours (absent = aucun)'),
  media: opt(object({
    index: req(int(1, LIMITS.dmxMediaSlots), 'n° du média dans le pool (1–25)'),
    playback: req(oneOf('play', 'pause', 'loop', 'rewind'), 'lecture, pause, boucle, retour au début et pause'),
  }), 'média affiché (absent = média masqué)'),
  blackout: opt(oneOf(true), 'noir total (absent = écran allumé)'),
});

/**
 * Barre d’état du faux téléphone (paramètres « Téléphone au départ » d’une Séquence, ou bandeau au-dessus des
 * médias réglé dans l’onglet Média). Horloge : run = l’heure avance depuis date/time (el = secondes écoulées à
 * l’envoi ; l’écran ajoute le temps passé depuis la réception, avec sa propre horloge), frozen = figée sur
 * date/time, real = heure réelle de l’écran (ni date, ni heure, ni el).
 */
const PHONE_BAR_SHAPE = object({
  clock: req(object({
    mode: req(oneOf('run', 'frozen', 'real'), 'l’heure avance / figée / heure réelle'),
    date: opt(DATE, 'date du faux téléphone AAAA-MM-JJ (run, frozen)'),
    time: opt(TIME, 'heure du faux téléphone HH:MM (run, frozen)'),
    el: opt(int(0, LIMITS.phoneClockSeconds), 'secondes écoulées depuis le départ, au moment de l’envoi (run)'),
  }), 'date et heure'),
  net: req(object({
    bars: req(int(0, 4), 'barres de réseau (0 = « Pas de service »)'),
    type: req(oneOf(...PHONE_NET_TYPES), 'réseau mobile'),
    plane: req(bool, 'mode avion'),
    wifi: req(bool, 'Wi-Fi'),
  }), 'réseau'),
  bat: req(object({
    level: req(int(1, 100), 'niveau %'),
    charging: req(bool, 'en charge'),
    pct: req(bool, 'pourcentage affiché'),
    low: opt(bool, 'batterie faible (étape « Batterie faible ») : icône rouge'),
  }), 'batterie'),
});
const PHONE_BAR = (/** @type {any} */ v) => {
  if (!PHONE_BAR_SHAPE(v)) return false;
  const c = v.clock;
  if (c.mode === 'real') return c.date === undefined && c.time === undefined && c.el === undefined;
  if (c.date === undefined || c.time === undefined) return false;
  return c.mode === 'run' || c.el === undefined;
};
/** Frappe automatique d’un message du comédien (Lecture auto) : seul ou dans chat:open (reprise). */
const CHAT_TYPE_FIELDS = {
  id: req(CHAT_ID, 'message du comédien'),
  dur: opt(int(...LIMITS.chatWriteSeconds), 'le texte s’écrit tout seul, lettre à lettre, en dur s (absent : le comédien tape)'),
  send: req(bool, 'envoi automatique une fois le texte complet (sinon : au bouton du comédien)'),
};
const CHAT_TYPE_REFINE = (/** @type {any} */ t) => (t.dur === undefined && !t.send ? 'frappe automatique sans effet' : null);

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
    dir: 'r2s', src: ['web'],
    doc: 'Multi-écran : renomme un écran et/ou fixe ses groupes (name vide = nom par défaut ; groups remplace la liste). '
      + 'Doit cibler target.screens. La PWA l’envoie à chaque changement et à la resynchronisation si caps.name / caps.groups diffèrent.',
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
  'screen:identify': {
    dir: 'r2s', src: ['web'],
    doc: 'Fait clignoter l’écran ciblé 3 s (2 Hz) pour le reconnaître sur le décor (« Identifier » de la passerelle DMX) ; '
      + 'son état (couleur, média, appel…) n’est pas modifié. Doit cibler target.screens.',
    fields: {},
    refine: m => (!m.target || !m.target.screens ? 'screen:identify doit cibler target.screens' : null),
  },
  'screen:revoked': {
    dir: 'r2s', src: ['web'],
    doc: 'Retrait d’un écran (maquette 5c) : envoyé sur l’ANCIENNE session à l’écran retiré, qui efface sa session et ses clés et '
      + 'affiche « Écran retiré ». reason « renewed » : session renouvelée sans pouvoir lui remettre la nouvelle (pas de clé pairwise).',
    fields: { reason: opt(oneOf('revoked', 'renewed'), 'retiré par l’utilisateur (défaut) ou session renouvelée sans lui') },
    refine: m => ONE_SCREEN(m, 'screen:revoked'),
  },

  // ═══ Clés par écran (pairwise.js) : échange dans la session ═══
  'key:offer': {
    dir: 'r2s', src: ['web'],
    doc: 'Début d’échange de clé pairwise : clé publique ECDH P-256 éphémère de la télécommande. Adressé à UN écran.',
    fields: {
      rid: req(SCREEN_ID, 'identifiant stable de la télécommande'),
      xid: req(XID, 'identifiant de l’échange'),
      jwk: req(JWK, 'clé publique éphémère de la télécommande'),
    },
    refine: m => ONE_SCREEN(m, 'key:offer'),
  },
  'key:answer': {
    dir: 's2r', src: ['web'],
    doc: 'Réponse de l’écran à key:offer : sa clé publique ECDH P-256 éphémère.',
    fields: {
      sid: req(SCREEN_ID, 'screenId de l’écran'),
      rid: req(SCREEN_ID, 'télécommande de l’offre'),
      xid: req(XID, 'échange auquel il répond'),
      jwk: req(JWK, 'clé publique éphémère de l’écran'),
    },
  },
  // ═══ Clés par écran : messages scellés avec la clé pairwise (trame 0x03) ═══
  'key:confirm': {
    dir: 'r2s', src: ['web'], chan: 'pairwise',
    doc: 'Fin d’échange côté télécommande, scellé avec la NOUVELLE clé pairwise : l’ouvrir prouve que les deux côtés ont la même clé.',
    fields: { sid: req(SCREEN_ID, 'écran'), rid: req(SCREEN_ID, 'télécommande'), xid: req(XID, 'échange') },
  },
  'key:ok': {
    dir: 's2r', src: ['web'], chan: 'pairwise',
    doc: 'Accusé de l’écran : clé pairwise adoptée (scellé avec elle).',
    fields: { sid: req(SCREEN_ID, 'écran'), xid: req(XID, 'échange') },
  },
  'session:rekey': {
    dir: 'r2s', src: ['web'], chan: 'pairwise',
    doc: 'Nouvelle session après le retrait d’un autre écran, remise à CET écran (clé pairwise) sur l’ancien topic ; '
      + 'il y passe et garde nom, groupes, cache et affichage.',
    fields: {
      sid: req(SCREEN_ID, 'écran destinataire (vérifié par l’écran)'),
      rid: req(SCREEN_ID, 'télécommande'),
      channelId: req(B64U(22), 'nouvelle session : channelId'),
      key: req(B64U(43), 'nouvelle session : clé'),
      name: opt(line(LIMITS.screenNameChars), 'nom de l’écran'),
      groups: opt(arrayOf(GROUP_ID, LIMITS.screenGroups), 'groupes de l’écran'),
    },
  },
  'rekey:ok': {
    dir: 's2r', src: ['web'], chan: 'pairwise',
    doc: 'Accusé de session:rekey (scellé pairwise, sur l’ancien topic) juste avant que l’écran passe sur le nouveau.',
    fields: { sid: req(SCREEN_ID, 'écran'), channelId: req(B64U(22), 'session adoptée') },
  },

  // ═══ Télécommande → écran : médias ═══
  'media-img-start': {
    dir: 'r2s', src: ['web', 'native'],
    doc: 'Début de transfert d’une image/son en data-URL fragmentée (fragments media-img-chunk).',
    fields: {
      id: req(MEDIA_ID, 'identifiant du transfert'),
      total: req(int(1, LIMITS.imgChunks), 'nombre de fragments'),
      mediaId: opt(nullable(MEDIA_ID), 'id du média en cache (__lockwall, __callaudio, __callphoto, __ring_…, __ph_… / __au_… préparés, m12…)'),
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
  'media:bar': {
    dir: 'r2s', src: ['web'],
    doc: 'Onglet Média, hors séquence : barre d’état du faux téléphone (mêmes réglages que « Téléphone au départ ») en bandeau haut '
      + 'au-dessus des médias affichés seuls. null : retirée. Ciblée comme les autres ordres média, renvoyée à la resynchronisation. '
      + 'Pendant une Séquence, la barre de la séquence (phone:state.bar) prime sur ses écrans.',
    fields: { bar: req(nullable(PHONE_BAR), 'réglages de la barre (null : aucune)') },
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
      show: opt(bool, 'false = mise en cache seulement (préparation hors ligne) : rien n’est affiché ni interrompu ; absent = lire'),
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
    doc: 'Faux appel entrant, SMS ou notification d’application affiché par l’écran. La photo n’y voyage plus : '
      + 'elle est envoyée avant, en fragments media-img-* sous l’id __callphoto (comme __lockwall) ; l’icône d’une notification '
      + 'de même, sous __notificon. Un son importé (sonnerie d’appel, son de notification) voyage de même, sous un id dérivé '
      + 'de son contenu (ringId, __ring_…) ; absent du cache de l’écran, celui-ci joue le son intégré `ring` et le redemande '
      + '(media:need). kind « chat » / « whatsapp » (ancienne messagerie, retirée) : accepté des anciennes télécommandes, '
      + 'affiché comme un SMS. Notification (kind « notif ») : name = titre, msg = contenu, appName = application fictive, '
      + 'present « banner » (bandeau, écran déverrouillé) ou « lock » (carte sur le faux écran verrouillé, fond __notifwall), '
      + 'phone = date et heure du faux téléphone (absentes : celles de l’écran), received = heure de réception affichée.',
    fields: {
      kind: req(oneOf('call', 'sms', 'notif', 'chat', 'whatsapp'), 'appel / sms / notification d’application (chat, whatsapp = ancienne messagerie, affichée en SMS)'),
      style: opt(oneOf('glass', 'tonal', 'minimal', 'ios', 'android', 'generic'), 'style visuel (ios/android/generic = anciens noms)'),
      name: opt(line(40), 'nom de l’appelant / de l’expéditeur ; titre de la notification'),
      label: opt(line(40), 'sous-titre'),
      msg: opt(text(200), 'texte du message ; contenu de la notification'),
      appName: opt(line(24), 'nom de l’application fictive'),
      appColor: opt(HEX, 'couleur de l’application fictive'),
      hasPhoto: opt(bool, 'photo de l’appelant préchargée en fragments (media-img-*, mediaId __callphoto) ; notification : icône de '
        + 'l’application (__notificon) ; plus jamais en ligne'),
      ring: opt(oneOf('classic', 'digital', 'soft', 'silent'), 'son intégré : sonnerie (appel, en boucle) ou son de notification '
        + '(SMS / notification, une fois) ; repli quand le son importé ringId manque à l’écran'),
      ringId: opt(str(23, RING_ID_RE), 'son importé préchargé en fragments (media-img-*, mediaId = cet id) ; absent = son intégré'),
      ringVolume: opt(num(0, 1), 'volume du son 0..1 (absent = 1)'),
      vib: opt(bool, 'vibreur du type (maquette 36b) : appel = motif répété tant que ça sonne ; SMS / notification = motif court '
        + 'à l’arrivée ; absent = ne vibre pas'),
      present: opt(oneOf('full', 'banner', 'lock'), 'appel : plein écran ou bandeau ; notification : bandeau ou écran verrouillé'),
      photoMode: opt(oneOf('avatar', 'full'), 'photo en avatar ou plein écran'),
      hasAudio: opt(bool, 'bande son préchargée (__callaudio) à jouer au décroché'),
      photoId: opt(str(45, CALL_PHOTO_ID_RE), 'photo (notification : icône) PRÉPARÉE de l’entrée enregistrée (__ph_…, déjà en cache sur l’écran) '
        + 'à la place de __callphoto / __notificon ; absente du cache : pas de photo (jamais celle d’un autre appel)'),
      audioId: opt(str(45, CALL_AUDIO_ID_RE), 'bande son PRÉPARÉE de l’appel enregistré (__au_…) à la place de __callaudio ; '
        + 'absente du cache : décroché silencieux'),
      autoAnswer: opt(int(0, 60), 'décroché automatique après n s (0 = non)'),
      lock: opt(nullable(object({
        time: req(line(8), 'heure affichée'),
        date: req(line(30), 'date affichée'),
      })), 'faux écran verrouillé (SMS)'),
      phone: opt(object({
        date: opt(DATE, 'date du faux téléphone AAAA-MM-JJ (absente : celle de l’écran)'),
        time: opt(TIME, 'heure du faux téléphone HH:MM (absente : celle de l’écran)'),
      }), 'notification : date et heure du faux téléphone (écran verrouillé, calcul de « Reçue »)'),
      received: opt(object({
        mode: req(oneOf('now', 'ago', 'at'), 'maintenant / il y a n min / date et heure'),
        min: opt(int(0, LIMITS.notifAgoMinutes), 'minutes écoulées (mode ago)'),
        date: opt(DATE, 'date de réception (mode at)'),
        time: opt(TIME, 'heure de réception (mode at)'),
      }), 'notification : heure de réception, affichée comme un téléphone (« maintenant », « il y a 15 min », « 14:17 », « hier »…)'),
    },
    refine: m => {
      const notif = m.kind === 'notif';
      if (!notif && (m.phone !== undefined || m.received !== undefined)) return 'phone / received : notification seulement';
      if (m.present === 'lock' && !notif) return 'present « lock » : notification seulement';
      if (notif && m.present === 'full') return 'notification : present « banner » ou « lock »';
      const r = m.received;
      if (r) {
        if (r.mode === 'ago' && r.min === undefined) return 'received ago sans min';
        if (r.mode === 'at' && (r.date === undefined || r.time === undefined)) return 'received at sans date et heure';
        if (r.mode !== 'ago' && r.min !== undefined) return 'received : min hors mode ago';
        if (r.mode !== 'at' && (r.date !== undefined || r.time !== undefined)) return 'received : date/heure hors mode at';
      }
      return null;
    },
  },
  'call:answer': { dir: 'r2s', src: ['web'], doc: 'Décroche le faux appel.', fields: {} },
  'call:end': { dir: 'r2s', src: ['web'], doc: 'Termine le faux appel / la notification.', fields: {} },

  // ═══ Télécommande ↔ écran : discussion fictive (fil préparé) ═══
  // Petits messages (≤ 2,8 Ko en JSON) : passent aussi par le Bluetooth. Jamais déclenchée par la console DMX.
  'chat:open': {
    dir: 'r2s', src: ['web'],
    doc: 'Ouvre (ou resynchronise) la discussion sur l’écran : contact, style, ordre du fil et messages déjà postés. '
      + 'Le texte de chaque message voyage à part (chat:msg, envoyés avant). Envoyé à l’ouverture, après une modification du fil '
      + 'et à la resynchronisation de l’écran (rechargé : il retrouve le fil où il en était). Avatar : fragments media-img-* sous __chatavatar.',
    fields: {
      name: req(line(LIMITS.chatNameChars), 'nom du contact'),
      style: req(STYLE3, 'style des bulles (Verre / Tonal / Épuré)'),
      hasAvatar: opt(bool, 'avatar du contact préchargé (__chatavatar)'),
      ids: req(arrayOf(CHAT_ID, LIMITS.chatMessages), 'messages du fil, dans l’ordre préparé'),
      sent: req(arrayOf(CHAT_ID, LIMITS.chatMessages), 'messages déjà postés, dans l’ordre où ils l’ont été'),
      typed: opt(int(0, LIMITS.chatTextChars), 'lettres déjà tapées du message du comédien en cours (reprise)'),
      history: opt(bool, '« Reprendre ici » / « Repartir de zéro » : sent = les messages du fil AVANT le point de reprise (début exact de ids), '
        + 'affichés d’un coup comme historique (ni « … écrit », ni animation, ni son) ; frappe locale et file d’attente de l’écran remises à zéro'),
      pend: opt(arrayOf(CHAT_ID, LIMITS.chatMessages), 'messages du comédien postés sans réseau : « Non distribué » (point rouge) jusqu’au retour du réseau'),
      ring: opt(RINGS, 'son des messages du contact (maquette 36d), joué à l’arrivée de chacun (jamais pour l’historique) ; '
        + 'absent = aucun son ; repli quand le son importé ringId manque à l’écran'),
      ringId: opt(str(23, RING_ID_RE), 'son des messages importé, préchargé en fragments (__ring_…, comme les sonneries)'),
      ringVolume: opt(num(0, 1), 'volume du son des messages 0..1 (absent = 1)'),
      vib: opt(bool, 'vibreur : motif court à l’arrivée de chaque message du contact (absent = non)'),
      auto: opt(object({
        ...CHAT_TYPE_FIELDS,
        el: opt(int(0, LIMITS.chatWriteSeconds[1] * 1000), 'ms déjà écoulées de la frappe automatique (reprise)'),
      }), 'Lecture auto : frappe automatique en cours (reprise après rechargement)'),
    },
    refine: m => {
      if (!unique(m.ids) || !unique(m.sent)) return 'chat:open : identifiant en double';
      if (!m.sent.every((/** @type {string} */ id) => m.ids.includes(id))) return 'chat:open : message posté absent du fil';
      if (m.history) {
        if (!m.sent.every((/** @type {string} */ id, /** @type {number} */ i) => m.ids[i] === id)) return 'chat:open : historique hors de l’ordre du fil';
        if (m.typed) return 'chat:open : historique avec lettres tapées';
        if (m.auto) return 'chat:open : historique avec frappe automatique';
      }
      if (m.pend && (!unique(m.pend) || !m.pend.every((/** @type {string} */ id) => m.sent.includes(id)))) return 'chat:open : message non distribué hors des messages postés';
      const t = m.auto;
      if (t) {
        if (!m.ids.includes(t.id) || m.sent.includes(t.id)) return 'chat:open : frappe automatique d’un message absent ou déjà posté';
        if (t.el !== undefined && (t.dur === undefined || t.el > t.dur * 1000)) return 'chat:open : avancée de frappe hors durée';
        const r = CHAT_TYPE_REFINE(t);
        if (r) return 'chat:open : ' + r;
      }
      return null;
    },
  },
  'chat:type': {
    dir: 'r2s', src: ['web'],
    doc: 'Lecture auto (maquette 26d) : message du comédien en cours. dur : le texte s’écrit tout seul, lettre à lettre, en dur s ; '
      + 'absent : le comédien tape (comme sans lecture auto). send : il part tout seul une fois complet (sinon au bouton « Envoyer »). '
      + 'L’envoi revient par chat:sent, comme une frappe du comédien.',
    fields: { ...CHAT_TYPE_FIELDS },
    refine: m => CHAT_TYPE_REFINE(m),
  },
  'chat:rewind': {
    dir: 'r2s', src: ['web'],
    doc: '« ↶ » : retire de l’écran le dernier message affiché (ou encore en attente derrière « … écrit »), remis en attente dans le fil : '
      + 'un message du comédien se retape lettre à lettre. drop : message improvisé (« Écrire… »), retiré aussi du fil. '
      + 'Sans effet si le message n’est pas affiché. L’état complet repart à la resynchronisation (chat:open).',
    fields: {
      id: req(CHAT_ID, 'message retiré de l’écran'),
      drop: opt(bool, 'message improvisé : retiré du fil'),
    },
  },
  'chat:msg': {
    dir: 'r2s', src: ['web'],
    doc: 'Texte d’un message du fil : du contact (reçu) ou du comédien (préparé, révélé lettre à lettre à chaque touche du clavier de l’écran). '
      + 'Affiché en texte brut (textContent).',
    fields: {
      id: req(CHAT_ID, 'identifiant du message'),
      from: req(oneOf('contact', 'actor'), 'contact (bulle reçue) ou comédien (bulle envoyée)'),
      text: req(text(LIMITS.chatTextChars), 'texte (1 à 300 caractères, sauts de ligne permis)'),
    },
    refine: m => (m.text.trim() ? null : 'chat:msg : texte vide'),
  },
  'chat:post': {
    dir: 'r2s', src: ['web'],
    doc: 'Poste un message du contact (déjà décrit par chat:msg) ; typing : indicateur « … écrit » avant la bulle, pendant dur s '
      + '(durée d’écriture du message, Lecture auto) ou 2 s (dur absent).',
    fields: {
      id: req(CHAT_ID, 'message du contact à poster'),
      typing: opt(bool, 'indicateur « … écrit » avant la bulle'),
      dur: opt(int(...LIMITS.chatWriteSeconds), 'durée de l’indicateur « … écrit » en s (absent : 2 s)'),
    },
    refine: m => (m.dur !== undefined && m.typing !== true ? 'chat:post : durée sans indicateur' : null),
  },
  'chat:close': { dir: 'r2s', src: ['web'], doc: 'Ferme la discussion sur l’écran.', fields: {} },
  'chat:progress': {
    dir: 's2r', src: ['web'],
    doc: 'Frappe du comédien sur l’écran : lettres révélées du message en cours (au plus 4 par seconde).',
    fields: {
      id: req(CHAT_ID, 'message en cours'),
      typed: req(int(0, LIMITS.chatTextChars), 'lettres révélées'),
      total: req(int(1, LIMITS.chatTextChars), 'lettres du message'),
    },
    refine: m => (m.typed > m.total ? 'chat:progress : typed > total' : null),
  },
  'chat:sent': {
    dir: 's2r', src: ['web'],
    doc: 'Le comédien a envoyé son message (texte complet) : la bulle est postée sur l’écran. undelivered : envoyé sans réseau '
      + '(barre d’état « Pas de service ») : la bulle reste « Non distribué » jusqu’au retour du réseau (chat:open.pend).',
    fields: {
      id: req(CHAT_ID, 'message envoyé'),
      undelivered: opt(bool, 'envoyé sans réseau : non distribué'),
    },
  },

  // ═══ Télécommande ↔ écran : faux téléphone d’une Séquence (onglet Séquence) ═══
  // Petits messages : passent aussi par le Bluetooth (sauf une pile très chargée). Jamais déclenchés par la console DMX.
  'phone:state': {
    dir: 'r2s', src: ['web'],
    doc: 'État COMPLET du faux téléphone d’une Séquence sur l’écran visé, renvoyé à chaque changement et à la resynchronisation '
      + '(un écran rechargé retrouve son écran verrouillé, ses notifications empilées, le déverrouillage, l’écran d’accueil). '
      + 'mode : off (rien d’affiché), locked (écran verrouillé, notifications empilées, la plus récente en haut), code (pavé du code), '
      + 'unlocked (déverrouillé : l’app visée, la discussion, s’ouvre par-dessus), home (image d’écran d’accueil, préchargée en '
      + 'fragments media-img-* sous __seqhome). notifs : dans l’ordre d’arrivée ; ago = secondes écoulées à l’envoi (l’écran calcule '
      + 'l’heure relative avec sa propre horloge). unlock : déverrouillage attendu (code 4 ou 6 chiffres, 0 = glisser seul ; '
      + 'aucun code n’est transmis : chaque touche remplit le point suivant). watch : gestes que la télécommande attend de cet écran '
      + '(seuls ceux-là sont rapportés, avec « unlock » toujours). chime : son de la notification qui vient d’arriver (jamais à la '
      + 'resynchronisation). Trois styles neutres, aucune marque. Textes affichés en texte brut. '
      + 'bar : barre d’état (maquette 28b, heure / réseau / batterie) affichée partout sur cet écran pendant la séquence (écran '
      + 'verrouillé, déverrouillé, appels, bandeaux, discussion, bandeau haut au-dessus des médias) ; elle prime sur media:bar ; '
      + 'absente : plus de barre de la séquence. sleep : étape « Veille » (maquette 29b), écran noir verrouillé qui se rallume aux '
      + 'notifications / appels et/ou au toucher et se rendort après `after` s ; le déverrouillage le réveille pour de bon. alert : '
      + '« Batterie faible » (maquette 33) à fermer (geste dismiss). power off : « Extinction » (fondu, logo neutre, écran noir ; '
      + 'le téléphone ne répond plus) jusqu’au rallumage (étape « Veille » ou ↶).',
    fields: {
      mode: req(oneOf('off', 'locked', 'code', 'unlocked', 'home'), 'état du faux téléphone'),
      style: req(STYLE3, 'style (Verre / Tonal / Épuré)'),
      notifs: req(arrayOf(object({
        id: req(PHONE_ID, 'identifiant de la notification empilée'),
        kind: req(oneOf('sms', 'notif', 'missed'), 'SMS, notification d’application, appel manqué'),
        app: req(line(24), 'application affichée en tête (« SMS », « Téléphone », nom fictif)'),
        name: req(line(40), 'expéditeur, titre, « Appel manqué »'),
        msg: opt(text(200), 'texte, contenu, nom de l’appelant'),
        color: opt(HEX, 'couleur de l’icône'),
        ago: req(int(0, LIMITS.phoneAgoSeconds), 'secondes écoulées depuis l’arrivée, au moment de l’envoi'),
      }), LIMITS.phoneNotifs), 'notifications empilées, dans l’ordre d’arrivée'),
      unlock: opt(object({
        code: req(oneOf(0, 4, 6), 'chiffres du code (0 = glisser seul)'),
        then: req(oneOf('app', 'home'), 'ensuite : l’app visée ou l’écran d’accueil (image)'),
      }), 'déverrouillage attendu : toucher l’écran verrouillé demande le code'),
      home: opt(bool, 'image d’écran d’accueil préchargée (__seqhome)'),
      watch: opt(arrayOf(oneOf(...PHONE_GESTURES.filter((g) => !PHONE_GESTURES_ALWAYS.includes(g))), PHONE_GESTURES.length), 'gestes attendus de cet écran'),
      chime: opt(object({
        id: req(PHONE_ID, 'notification qui vient d’arriver'),
        ring: req(RINGS, 'son intégré (repli)'),
        ringId: opt(str(23, RING_ID_RE), 'son importé préchargé (__ring_…)'),
        vol: opt(num(0, 1), 'volume 0..1'),
        vib: opt(bool, 'vibreur de l’entrée (motif court ; absent = non)'),
      }), 'son de la notification arrivée (une fois)'),
      bar: opt(PHONE_BAR, 'barre d’état de la séquence (absente : aucune ; l’écran revient à media:bar)'),
      sleep: opt(object({
        notif: req(bool, 'se rallume à chaque notification / appel'),
        touch: req(bool, 'se rallume au toucher'),
        after: req(int(...LIMITS.phoneSleepSeconds), 'se rendort après n s'),
      }), 'étape « Veille » : écran noir verrouillé'),
      alert: opt(object({
        id: req(PHONE_ID, 'identifiant de l’alerte (fermée : geste dismiss)'),
        level: req(int(1, 100), 'pourcentage annoncé'),
      }), 'alerte « Batterie faible »'),
      power: opt(oneOf('on', 'off'), 'off : téléphone éteint (absent : allumé)'),
    },
    refine: m => {
      if (!unique(m.notifs.map((/** @type {any} */ n) => n.id))) return 'phone:state : notification en double';
      if (m.watch && !unique(m.watch)) return 'phone:state : geste en double';
      if (m.mode === 'code' && !(m.unlock && m.unlock.code > 0)) return 'phone:state : pavé du code sans code attendu';
      if (m.chime && !m.notifs.some((/** @type {any} */ n) => n.id === m.chime.id)) return 'phone:state : son d’une notification absente';
      if (m.sleep && m.mode !== 'locked' && m.mode !== 'code') return 'phone:state : veille hors écran verrouillé';
      if (m.power === 'off' && (m.chime || m.watch)) return 'phone:state : téléphone éteint, ni son ni geste attendu';
      return null;
    },
  },
  'phone:gesture': {
    dir: 's2r', src: ['web'],
    doc: 'Geste du comédien sur le faux téléphone d’une Séquence (au plus un par geste toutes les 400 ms, 5 par seconde) : touche '
      + 'l’écran, touche une notification (n), refuse ou raccroche, décroche, déverrouille (code complet ou glissement), touche '
      + 'l’image d’accueil, ferme l’alerte « Batterie faible » (dismiss). Seuls les gestes attendus (phone:state.watch) partent, '
      + '« unlock » et « dismiss » toujours. Jamais le contenu des touches : le code n’existe pas, seule sa complétion est '
      + 'rapportée. La réponse dans la discussion passe par chat:sent.',
    fields: {
      g: req(oneOf(...PHONE_GESTURES), 'geste'),
      n: opt(PHONE_ID, 'notification touchée (geste notif)'),
    },
    refine: m => (m.n !== undefined && m.g !== 'notif' ? 'phone:gesture : n hors geste notif' : null),
  },

  // ═══ Passerelle DMX → écran ═══
  'dmx:look': {
    dir: 'r2s', src: ['web'],
    doc: 'Passerelle DMX (packages/dmx, voir docs/DMX.md ; PWA : web/js/86-dmx-gateway.js → 36-dmx-screen.js) : état de l’écran calculé depuis la console '
      + '(sACN / Art-Net). live:true = signal console présent, la console a la priorité et l’écran ignore les '
      + 'commandes de look de la télécommande ; live:false (envoyé une fois à la perte du signal) = l’écran garde '
      + 'ce look et la télécommande peut reprendre la main. Envoyé au changement (≤ 30/s par écran) et toutes les '
      + 'secondes tant que live. Les déclenchements Appel/SMS passent par call:start / call:end.',
    fields: {
      seq: req(int(0, 0xffff), 'compteur 16 bits de la passerelle (rebouclage 65535 → 0)'),
      live: req(bool, 'signal console présent (priorité console)'),
      look: req(DMX_LOOK, 'look à afficher'),
    },
  },

  // ═══ Signalisation WebRTC (transfert vidéo pair-à-pair) ═══
  'rtc-offer': {
    dir: 'r2s', src: ['web'],
    doc: 'Offre WebRTC (canal de données « file »). En multi-écran : cibler UN écran (target.screens). '
      + 'kind « cache » : préparation hors ligne, le fichier est mis en cache sans interrompre ni remplacer ce que l’écran affiche.',
    fields: {
      sdp: req(SDP('offer'), 'RTCSessionDescription'),
      kind: opt(oneOf('file', 'cache'), 'usage : diffusion (file) ou mise en cache seulement (cache)'),
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
      kx: opt(oneOf(1), 'échange de clés pairwise pris en charge (version)'),
      kid: opt(KID, 'kid de la clé pairwise que l’écran détient avec cette télécommande (absent : aucune)'),
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
  'screen:alive': {
    dir: 's2r', src: ['web'],
    doc: 'Signe de vie d’un écran connecté (toutes les 15 s) : la télécommande signale un écran muet depuis 40 s.',
    fields: {},
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
    const chan = opts.channel === undefined ? 'session' : opts.channel;
    if (chan !== 'session' && chan !== 'pairwise') return 'canal invalide';
    if ((spec.chan || 'session') !== chan) {
      return chan === 'pairwise' ? `${type} n’est pas accepté scellé avec une clé pairwise` : `${type} n’est accepté que scellé avec une clé pairwise`;
    }
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
        if (spec.chan === 'pairwise') return 'target interdit sur un message pairwise (adressé par sa clé)';
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
 * @param {ValidateOptions} [opts]  direction : 'r2s' | 's2r' pour vérifier aussi le sens ;
 *   channel : 'session' (défaut) | 'pairwise' (trame scellée avec une clé par écran)
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
 *   channel: 'session' | 'pairwise',
 *   sources: readonly string[],
 *   description: string,
 *   fields: Readonly<Record<string, Readonly<{ required: boolean, description: string }>>>
 * }>>>}
 */
export const MESSAGE_TYPES = Object.freeze(Object.fromEntries(
  Object.entries(SPECS).map(([type, s]) => [type, Object.freeze({
    direction: s.dir,
    channel: s.chan || 'session',
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
