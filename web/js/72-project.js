// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ PROJETS : EXPORT, IMPORT ET GESTION (télécommande) ══════════════════════════
// MOTEUR SEULEMENT : aucun bouton, aucune vue. L'interface (Réglages › Projet,
// feuilles d'export, d'aperçu et de compte rendu, liste des projets) attend les
// maquettes 45 à 46c (règle : pas d'interface sans maquette validée).
// Contrat complet, inventaire du stockage et choix : docs/PROJECTS.md.
//
// Un PROJET regroupe ce que la télécommande a préparé pour une production :
//   seq       séquences enregistrées (96-sequences-saved.js), « Téléphone au
//             départ », images d'accueil et fonds d'écran (IndexedDB, empreinte)
//   chat      discussions enregistrées (89-discussions-saved.js), timings, photo
//   calls     appels, SMS, notifications enregistrés (82-call-list.js), noms,
//             photos / icônes, bandes son
//   callers   appelants enregistrés (79-callers.js), photos
//   rings     sons importés (81-ringtones.js, IndexedDB) et choix par type
//             (son, volume, vibreur : setremote-ring-v1)
//   memories  mémoires couleur et mémoires d'effet (62-memories.js)
//   media     pool média (70-media-remote.js, en mémoire) : FACULTATIF à l'export
//   work      état de travail : « Séquence en cours » et « Fil en cours » de la
//             discussion (photo du contact comprise). Toujours exporté ; à
//             l'import dans le projet courant, seulement s'il est demandé
//             (sections) ; repris par « Ouvrir comme nouveau projet » et par le
//             changement de projet. Le formulaire Tel (non enregistré) n'en
//             fait pas partie.
// JAMAIS : secret de session, appairage, clés par écran, registre des écrans,
// identité / jeton / clé de licence, identifiant de la télécommande, réglages
// du relais, patch DMX, préférences de l'appareil (langue, liaison…). Liste
// exacte : PRJ_NEVER_KEYS ; garde-fou à l'export : _prjSecretScan.
//
// ── Fichier « Nom.setremote » = ZIP (méthodes 0 « stocké » et 8 « deflate ») ──
//   project.json        manifeste { format: 'setremote-project', version: 1,
//                       app, created (ISO), name, sections, counts, files }
//   data/<section>.json une entrée par section
//   files/<sha256>.<ext> photos, sons, images, médias : dédupliqués par empreinte,
//                       désignés dans les données par { f: chemin, t: type MIME }
// Écriture et lecture du conteneur ici (aucune dépendance) ; la compression
// deflate vient de fflate (vendor/fflate-0.8.2.min.js, MIT, chargé à la
// demande comme jsQR) ; sans lui : export sans compression, lecture par
// DecompressionStream('deflate-raw') si le navigateur l'a.
//
// ── Import : validation stricte ──
// Taille du fichier, nombre d'entrées, taille de chaque entrée (selon son type)
// et total décompressé bornés (PRJ_LIMITS) ; CRC-32 de chaque entrée vérifié ;
// ZIP64, chiffrement et méthodes inconnues refusés ; noms d'entrée imposés.
// Chaque élément repasse par les validations de son module (_sqsvSanitize,
// seqSanitizeSteps, _chsvSanitize, _clSanitize + _validCallStart,
// _crSanitize, _ringSanitizeMeta, safeImageData / safeAudioData…) ; plafonds de
// l'app (SEQ_SAVED_MAX, CHAT_SAVED_MAX, CALL_LIST_MAX, CALLERS_MAX…) : le reste
// est compté « ignoré » dans le compte rendu. Erreurs : codes et textes
// français (_PRJ_TXT.err).
// Modes : « merge » (Ajouter : ids en collision renumérotés et références des
// séquences corrigées, noms en double suffixés « (2) ») ; « replace »
// (Remplacer : les sections importées sont vidées puis chargées) ; « new »
// (Ouvrir comme nouveau projet : rangé dans la liste des projets).
// Aperçu sans licence (77-licence-ui.js) : les données importées sont écrites
// dans le stockage RÉEL (elles sont à l'utilisateur), jamais dans le masque ;
// l'aperçu reste affiché et elles apparaissent avec la licence (compte rendu :
// preview).
//
// ── Projets locaux (plusieurs projets, un seul ouvert) ──
// Base IndexedDB setremote-projects : meta { id, name, created, updated, size,
// counts } et snap (instantané .setremote du projet quand il n'est pas ouvert) ;
// projet ouvert : setremote-project-v1 { v, active }. Le contenu du projet
// OUVERT est l'espace de travail (le stockage habituel des modules). Changer de
// projet : instantané de l'espace de travail (même sérialiseur que l'export)
// rangé dans le projet quitté, puis chargement du projet visé (même chemin que
// l'import « replace », sections absentes vidées). Échec : l'espace de travail
// est rétabli. Les écrans, l'appairage et les réglages restent communs à tous
// les projets ; le pool média aussi (il ne vit qu'en mémoire). Premier usage :
// les données existantes deviennent « Mon projet ».
//
// ── Fichiers : web et app native ──
// Web : projectSave télécharge par une URL blob (<a download>) ; projectPick
// ouvre un <input type=file>. App native (la vue web ne sait pas télécharger) :
// pont par morceaux de PRJ_CHUNK caractères base64 (00-native-bridge.js,
// docs/PROJECTS.md § 6) :
//   page → coque  project:save { id, name, size, i, n, data }   (feuille de partage)
//                 project:open { id }                            (sélecteur de fichier)
//   coque → page  project:saved { id, ok, reason? }
//                 project:file  { id, name, size, i, n, data } | { id, cancelled: true }
//                 project:error { id, reason }
const PRJ_FORMAT = 'setremote-project';
const PRJ_VERSION = 1;
const PRJ_EXT = '.setremote';
const PRJ_MIME = 'application/zip';
const PRJ_FFLATE_SRC = 'vendor/fflate-0.8.2.min.js';
const PRJ_SECTIONS = ['seq', 'chat', 'calls', 'callers', 'rings', 'memories', 'media'];
const PRJ_ALL = PRJ_SECTIONS.concat(['work']);
const PRJ_CHUNK = 512 * 1024;                 // caractères base64 par message du pont natif
const _PRJ_MB = 1024 * 1024;
// Plafonds (objet modifiable par les tests seulement)
const PRJ_LIMITS = {
  file: 512 * _PRJ_MB,      // fichier .setremote
  total: 512 * _PRJ_MB,     // somme des entrées décompressées
  entries: 4000,
  manifest: 64 * 1024, json: 8 * _PRJ_MB,
  image: 15 * _PRJ_MB, audio: 12 * _PRJ_MB, video: 400 * _PRJ_MB,
  memories: 200,            // par type (couleur, effet)
  media: 200, rings: 100,
  projects: 50, store: 1024 * _PRJ_MB, // projets locaux : nombre, taille totale des instantanés
  native: 256 * _PRJ_MB,    // fichier passé par le pont natif
};
// Clés JAMAIS exportées (docs/PROJECTS.md § 3) ; leurs secrets sont cherchés dans chaque export
const PRJ_NEVER_KEYS = [
  'setremote-session-v1', 'setremote-screen-session-v1', 'setremote-screen-id', 'setremote-screen-config-v1',
  'setremote-remote-id', 'setremote-screen-pairwise-v1', 'setremote-screens-v1', 'setremote-rekey-v1',
  'setremote-licence-v1', 'setremote-licence-key-v1', 'setremote-stats-v1', 'setremote-link-v1',
  'setremote-dmx-v1', 'setremote-mediabar-v1', 'setremote-strobe-warning-v1', 'setremote-lang-v1',
  'setremote-project-v1',
];
const PRJ_ACTIVE_KEY = 'setremote-project-v1';
const PRJ_DB = 'setremote-projects';
const _PRJ_COLOR_KEY = 'setremote-color-memories';
const _PRJ_FX_KEY = 'setremote-fx-memories';

// Textes, regroupés pour la traduction ({…} : valeurs)
const _PRJ_TXT = {
  defaultName: 'Projet', firstName: 'Mon projet', copy: '{nom} (copie)', untitledMem: 'Mémoire',
  sections: { seq: 'Séquences', chat: 'Discussions', calls: 'Appels et SMS', callers: 'Appelants', rings: 'Sonneries', memories: 'Mémoires', media: 'Médias', work: 'En cours' },
  err: {
    'not-zip': 'Fichier non reconnu : ce n\'est pas un projet SetRemote (.setremote).',
    'not-project': 'Ce fichier n\'est pas un projet SetRemote.',
    version: 'Ce projet vient d\'une version plus récente de SetRemote : mettez l\'app à jour pour l\'ouvrir.',
    'too-large': 'Fichier trop volumineux (plus de {max} Mo).',
    'too-many': 'Projet trop gros : trop d\'éléments.',
    corrupt: 'Fichier abîmé : le projet ne peut pas être lu.',
    invalid: 'Contenu du projet invalide.',
    empty: 'Rien à importer.',
    read: 'Lecture du fichier impossible.',
    secret: 'Export interrompu : une donnée privée allait y figurer.',
    'storage-full': 'Mémoire de l\'appareil pleine : l\'opération n\'a pas pu aller au bout.',
    busy: 'Une séquence, un appel ou une discussion est en cours sur les écrans : arrêtez-les d\'abord.',
    pending: 'Une opération sur les projets est déjà en cours.',
    active: 'Le projet ouvert ne peut pas être supprimé : ouvrez-en un autre d\'abord.',
    'not-found': 'Projet introuvable.',
    quota: 'Plus de place pour les projets : supprimez-en un.',
    cancelled: 'Annulé.',
    unavailable: 'Fonction indisponible sur cet appareil.',
    timeout: 'L\'app n\'a pas répondu.',
  },
};
const _prjTpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));
function _prjErr(code, vars) {
  const e = new Error(_prjTpl(_PRJ_TXT.err[code] || code, vars || {}));
  e.code = code;
  return e;
}
// Échec rendu par l'API : { ok: false, code, message }
function _prjFail(e) {
  const code = e && typeof e.code === 'string' && _PRJ_TXT.err[e.code] ? e.code : 'read';
  if (code === 'read' && e) console.warn('SetRemote : projet', e && e.message);
  return { ok: false, code, message: code === 'too-large' ? _prjTpl(_PRJ_TXT.err['too-large'], { max: Math.round(PRJ_LIMITS.file / _PRJ_MB) }) : (e && e.code === code ? e.message : _PRJ_TXT.err[code]) };
}
const _prjLine = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) : '');
const _prjName = (v) => _prjLine(v, 60);

// ══════════ Octets, base64, CRC-32, SHA-256 ══════════
const _prjUtf8 = (s) => new TextEncoder().encode(s);
function _prjB64ToBytes(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
function _prjBytesToB64(u) {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const _PRJ_CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
// CRC-32 (ZIP), cumulable : _prjCrc(b, _prjCrc(a)) = CRC de a puis b
function _prjCrc(u, prev = 0) {
  let c = (prev ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < u.length; i++) c = _PRJ_CRC_T[(c ^ u[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function _prjSha(u) {
  const h = new Uint8Array(await SRP.getCrypto().subtle.digest('SHA-256', u));
  let s = '';
  for (let i = 0; i < h.length; i++) s += h[i].toString(16).padStart(2, '0');
  return s;
}

// ══════════ fflate (deflate), chargé à la demande ══════════
let _prjFfLoad = null;
function _prjFflate() {
  if (window.fflate && typeof window.fflate.inflateSync === 'function') return Promise.resolve(window.fflate);
  if (!_prjFfLoad) {
    _prjFfLoad = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = PRJ_FFLATE_SRC;
      el.async = true;
      el.onload = () => (window.fflate && typeof window.fflate.inflateSync === 'function' ? resolve(window.fflate) : reject(new Error('fflate')));
      el.onerror = () => { _prjFfLoad = null; reject(new Error('fflate')); };
      document.head.appendChild(el);
    });
  }
  return _prjFfLoad;
}
async function _prjInflate(comp, size) {
  const ff = await _prjFflate().catch(() => null);
  if (ff) {
    try { return ff.inflateSync(comp, { out: new Uint8Array(size) }); } catch (_) { throw _prjErr('corrupt'); }
  }
  if (typeof DecompressionStream !== 'function') throw _prjErr('unavailable');
  try {
    const r = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const out = new Uint8Array(size);
    let n = 0;
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      if (n + value.length > size) { r.cancel(); throw _prjErr('corrupt'); }
      out.set(value, n); n += value.length;
    }
    return out.subarray(0, n);
  } catch (e) { throw e && e.code ? e : _prjErr('corrupt'); }
}

// ══════════ Conteneur ZIP (sans ZIP64) ══════════
const _PRJ_FILE_RE = /^files\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/;
const _PRJ_DATA_RE = /^data\/([a-z]+)\.json$/;
function _prjDos(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
// entries : [{ name, bytes (Uint8Array) | blob + crc, deflate }] → Blob
async function _prjZipBuild(entries, when) {
  const ff = await _prjFflate().catch(() => null);
  const { time, date } = _prjDos(when);
  const parts = [], central = [];
  let off = 0;
  for (const e of entries) {
    const name = _prjUtf8(e.name);
    let data = e.bytes || e.blob, size = e.bytes ? e.bytes.length : e.blob.size, crc = e.bytes ? _prjCrc(e.bytes) : e.crc, method = 0;
    if (e.bytes && e.deflate && ff && size > 64) {
      const c = ff.deflateSync(e.bytes, { level: 6 });
      if (c.length < size) { data = c; method = 8; }
    }
    const csize = data instanceof Uint8Array ? data.length : data.size;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, csize, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, csize, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(ch.buffer, name);
    off += 30 + name.length + csize;
  }
  const cdSize = central.reduce((n, p) => n + (p.byteLength !== undefined ? p.byteLength : p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  if (off + cdSize + 22 > 0xFFFFFFFF) throw _prjErr('too-large');
  return new Blob(parts.concat(central, [end.buffer]), { type: PRJ_MIME });
}
// Plafond d'une entrée selon son nom
function _prjEntryMax(name) {
  if (name === 'project.json') return PRJ_LIMITS.manifest;
  if (_PRJ_DATA_RE.test(name)) return PRJ_LIMITS.json;
  if (_PRJ_FILE_RE.test(name)) return Math.max(PRJ_LIMITS.image, PRJ_LIMITS.audio, PRJ_LIMITS.video);
  return PRJ_LIMITS.json; // entrée inconnue : ignorée, mais bornée
}
async function _prjSlice(blob, a, b) {
  try { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); } catch (_) { throw _prjErr('read'); }
}
// Ouvre un ZIP : répertoire central validé → { blob, entries: Map nom → entrée }
async function _prjZipOpen(blob) {
  if (!blob || typeof blob.size !== 'number' || typeof blob.slice !== 'function') throw _prjErr('read');
  const size = blob.size;
  if (size > PRJ_LIMITS.file) throw _prjErr('too-large');
  if (size < 22) throw _prjErr('not-zip');
  const tailLen = Math.min(size, 22 + 0xFFFF);
  const tail = await _prjSlice(blob, size - tailLen, size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.length);
  let i = tail.length - 22;
  while (i >= 0 && tv.getUint32(i, true) !== 0x06054b50) i--;
  if (i < 0) throw _prjErr('not-zip');
  const n = tv.getUint16(i + 10, true), cdSize = tv.getUint32(i + 12, true), cdOff = tv.getUint32(i + 16, true);
  if (tv.getUint16(i + 4, true) || tv.getUint16(i + 6, true) || tv.getUint16(i + 8, true) !== n) throw _prjErr('corrupt');
  if (n === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) throw _prjErr('too-large');
  if (n > PRJ_LIMITS.entries) throw _prjErr('too-many');
  if (cdOff + cdSize > size - tailLen + i) throw _prjErr('corrupt');
  const cd = await _prjSlice(blob, cdOff, cdOff + cdSize);
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.length);
  const dec = new TextDecoder('utf-8', { fatal: true });
  const entries = new Map();
  let p = 0, total = 0;
  for (let k = 0; k < n; k++) {
    if (p + 46 > cd.length || dv.getUint32(p, true) !== 0x02014b50) throw _prjErr('corrupt');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    if (p + 46 + nlen + xlen + clen > cd.length) throw _prjErr('corrupt');
    let name;
    try { name = dec.decode(cd.subarray(p + 46, p + 46 + nlen)); } catch (_) { throw _prjErr('corrupt'); }
    p += 46 + nlen + xlen + clen;
    if (flags & 1) throw _prjErr('corrupt');                       // chiffré
    if (method !== 0 && method !== 8) throw _prjErr('corrupt');
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || off === 0xFFFFFFFF) throw _prjErr('too-large');
    if (name.endsWith('/')) continue;                               // dossier
    if (entries.has(name)) throw _prjErr('corrupt');
    if (off + 30 + csize > cdOff) throw _prjErr('corrupt');
    if (usize > _prjEntryMax(name)) throw _prjErr('too-large');
    total += usize;
    if (total > PRJ_LIMITS.total) throw _prjErr('too-large');
    entries.set(name, { name, method, crc, csize, usize, off });
  }
  return { blob, entries };
}
// Début des données d'une entrée (après l'en-tête local)
async function _prjZipStart(z, e) {
  const lh = await _prjSlice(z.blob, e.off, e.off + 30);
  const v = new DataView(lh.buffer, lh.byteOffset, lh.length);
  if (lh.length < 30 || v.getUint32(0, true) !== 0x04034b50) throw _prjErr('corrupt');
  const start = e.off + 30 + v.getUint16(26, true) + v.getUint16(28, true);
  if (start + e.csize > z.blob.size) throw _prjErr('corrupt');
  return start;
}
// Contenu décompressé et vérifié (CRC) d'une entrée ; null si absente
async function _prjZipBytes(z, name, max) {
  const e = z.entries.get(name);
  if (!e) return null;
  if (max !== undefined && e.usize > max) throw _prjErr('too-large');
  const start = await _prjZipStart(z, e);
  const comp = await _prjSlice(z.blob, start, start + e.csize);
  let out;
  if (e.method === 0) { if (e.csize !== e.usize) throw _prjErr('corrupt'); out = comp; } else out = await _prjInflate(comp, e.usize);
  if (out.length !== e.usize || _prjCrc(out) !== e.crc) throw _prjErr('corrupt');
  return out;
}
// Grande entrée (média) : Blob découpé dans le fichier, CRC vérifié par morceaux
async function _prjZipBlob(z, name, type, max) {
  const e = z.entries.get(name);
  if (!e) return null;
  if (e.usize > max) throw _prjErr('too-large');
  if (e.method !== 0) return new Blob([await _prjZipBytes(z, name, max)], { type });
  if (e.csize !== e.usize) throw _prjErr('corrupt');
  const start = await _prjZipStart(z, e);
  let crc = 0;
  for (let a = 0; a < e.csize; a += 4 * _PRJ_MB) crc = _prjCrc(await _prjSlice(z.blob, start + a, start + Math.min(e.csize, a + 4 * _PRJ_MB)), crc);
  if (crc !== e.crc) throw _prjErr('corrupt');
  return z.blob.slice(start, start + e.csize, type);
}
async function _prjZipJson(z, name, max) {
  const b = await _prjZipBytes(z, name, max);
  if (!b) return null;
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)); } catch (_) { throw _prjErr('invalid'); }
}

// ══════════ Fichiers binaires : type MIME, extension, références ══════════
const _PRJ_EXTS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/aiff': 'aif', 'audio/x-aiff': 'aif', 'audio/x-caf': 'caf', 'audio/webm': 'weba',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v',
};
const _PRJ_MIME_RE = {
  image: /^image\/(jpeg|png|webp|gif)$/,
  audio: /^audio\/[a-z0-9.+-]{1,40}$/,
  media: /^(image\/(jpeg|png|webp|gif)|video\/[a-z0-9.+-]{1,40})$/,
};
// Ensemble des fichiers d'un export, dédupliqués par SHA-256
function _prjFileSet() {
  const map = new Map();
  const ref = (name, t) => ({ f: name, t });
  return {
    map,
    async bytes(u, mime) {
      const name = 'files/' + await _prjSha(u) + '.' + (_PRJ_EXTS[mime] || 'bin');
      if (!map.has(name)) map.set(name, { name, bytes: u });
      return ref(name, mime);
    },
    async dataUrl(d) {
      const m = /^data:([a-z0-9.+/-]+);base64,/.exec(d || '');
      if (!m) return null;
      return this.bytes(_prjB64ToBytes(d.slice(m[0].length)), m[1]);
    },
    async blob(b, mime) {
      const u = new Uint8Array(await b.arrayBuffer());
      const name = 'files/' + await _prjSha(u) + '.' + (_PRJ_EXTS[mime] || 'bin');
      if (!map.has(name)) map.set(name, { name, blob: b, crc: _prjCrc(u) });
      return ref(name, mime);
    },
  };
}
// Référence relue : chemin connu du ZIP, type MIME de la bonne famille ; sinon null
function _prjRef(z, r, fam) {
  if (!r || typeof r !== 'object' || typeof r.f !== 'string' || typeof r.t !== 'string') return null;
  if (!_PRJ_FILE_RE.test(r.f) || !_PRJ_MIME_RE[fam].test(r.t) || (z && !z.entries.has(r.f))) return null;
  return { f: r.f, t: r.t };
}
// Data-URL validée d'une référence (photo, son) ; null si absente ou invalide
async function _prjLoadData(p, r, fam, max) {
  if (!r || !p.z) return null;
  const e = p.z.entries.get(r.f);
  if (max !== undefined && e && e.usize > max) return null;
  const k = r.f + '|' + r.t;
  if (p.cache.has(k)) return p.cache.get(k);
  let d = null;
  try {
    const u = await _prjZipBytes(p.z, r.f, fam === 'image' ? PRJ_LIMITS.image : PRJ_LIMITS.audio);
    if (u) {
      const url = 'data:' + r.t + ';base64,' + _prjBytesToB64(u);
      d = fam === 'image' ? safeImageData(url) : safeAudioData(url);
    }
  } catch (e) { if (e && e.code === 'corrupt') throw e; d = null; }
  p.cache.set(k, d);
  return d;
}

// ══════════ Stockage : lecture et écriture RÉELLES (jamais le masque de l'aperçu) ══════════
function _prjLsRaw(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function _prjLsJson(k) { try { return JSON.parse(_prjLsRaw(k)); } catch (_) { return null; } }
function _prjLsWrite(k, v) {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { throw _prjErr('storage-full'); }
  // Clé masquée (aperçu) : le masque garde la démo ; sinon _lsGet relit la vraie valeur
}
async function _prjAssetGet(key) {
  if (!_assetMasked(key)) return callAssetGet(key);
  const v = await _clTx('readonly', (st) => st.get(key));
  return typeof v === 'string' ? v : null;
}
async function _prjAssetPut(key, v) {
  if (!_assetMasked(key)) return callAssetPut(key, v);
  await _clTx('readwrite', (st) => st.put(v, key));
}
function _prjAssetDel(key) {
  if (!_assetMasked(key)) return callAssetDelete(key);
  return _clTx('readwrite', (st) => st.delete(key));
}
async function _prjRingMetas() {
  const metas = await _ringTx('readonly', (m) => m.getAll());
  const all = (Array.isArray(metas) ? metas : []).concat([..._ringMem.values()].map((x) => x.meta));
  const seen = new Set();
  return all.map(_ringSanitizeMeta).filter((t) => t && !seen.has(t.id) && seen.add(t.id)).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}

// ══════════ Validation des éléments (lecture du stockage comme d'un fichier) ══════════
const _prjArr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const _PRJ_RAW_MAX = 1000; // éléments lus au plus par liste d'un fichier
function _prjSavedSeqs(list) {
  const ids = new Set();
  return _prjArr(list, _PRJ_RAW_MAX).map(_sqsvSanitize).filter((e) => e && !ids.has(e.id) && ids.add(e.id));
}
function _prjSavedChats(list) {
  const ids = new Set();
  return _prjArr(list, _PRJ_RAW_MAX).map((e) => (e && typeof e === 'object' ? _chsvSanitize(Object.assign({}, e, { hasPhoto: false })) : null))
    .filter((e) => e && !ids.has(e.id) && ids.add(e.id));
}
// Entrée de liste : types imposés comme un call:start reçu (22-protocol.js), puis _clSanitize
function _prjCallEntry(e, list) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const m = {};
  for (const k of _CALL_ENTRY_FIELDS) if (e[k] !== undefined) m[k] = e[k];
  const kind = m.kind;
  if (!['call', 'sms', 'notif', 'chat', 'whatsapp'].includes(kind)) return null;
  _validCallStart(m);
  if (!['glass', 'tonal', 'minimal'].includes(m.style)) m.style = 'glass';
  if (m.kind === 'notif') m.present = e.present === 'lock' ? 'lock' : 'banner';
  else if (m.kind === 'call') m.present = e.present === 'banner' ? 'banner' : 'full';
  else delete m.present;
  if (m.kind === 'call') m.photoMode = e.photoMode === 'full' ? 'full' : 'avatar'; else delete m.photoMode;
  if (m.kind !== 'sms') m.lock = null;
  // Champs absents de l'entrée d'origine : laissés absents (valeurs par défaut du module)
  for (const k of _CALL_ENTRY_FIELDS) if (e[k] === undefined && k !== 'kind' && k !== 'hasPhoto' && k !== 'hasAudio') delete m[k];
  if (m.ringId === null) delete m.ringId;
  if (m.appColor === null) delete m.appColor;
  m.id = e.id; m.title = e.title;
  delete m.photoId; delete m.audioId;
  const out = _clSanitize(m);
  return out && _clListOf(out.kind) === list ? out : null;
}
function _prjCallLists(o) {
  const out = {};
  for (const k of CALL_LISTS) {
    const ids = new Set();
    out[k] = _prjArr(o && o[k], _PRJ_RAW_MAX).map((e) => _prjCallEntry(e, k)).filter((e) => e && !ids.has(e.id) && ids.add(e.id));
  }
  return out;
}
function _prjCallers(list) {
  const ids = new Set();
  return _prjArr(list, _PRJ_RAW_MAX).map((e) => (e && typeof e === 'object' ? _crSanitize({ id: e.id, name: e.name, label: e.label, hasPhoto: e.hasPhoto, photoSig: e.photoSig }) : null))
    .filter((e) => e && !ids.has(e.id) && ids.add(e.id));
}
// Choix de son par type (même règle que loadRingSettings, sans toucher à l'état)
function _prjRingSettings(o) {
  const out = {};
  if (o && typeof o === 'object' && o.notif === undefined && o.chat !== undefined) o = Object.assign({}, o, { notif: o.chat });
  for (const k of RING_KINDS) {
    const s = o && typeof o === 'object' ? o[k] : null;
    const obj = !!s && typeof s === 'object';
    const ok = obj && (RING_BUILTINS.includes(s.sound) || _ringIsId(s.sound));
    out[k] = { sound: ok ? s.sound : _ringDefault(k).sound, vol: obj ? _ringVol(s.vol) : 1, vib: obj && s.vib === true };
  }
  return out;
}
const _prjNum = (v, a, b, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
function _prjColorMem(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !_SEQ_ID_RE.test(m.id)) return null;
  const s = m.spec && typeof m.spec === 'object' ? m.spec : {};
  const t = m.strobe && typeof m.strobe === 'object' ? m.strobe : null;
  return {
    id: m.id, name: _prjLine(m.name, 40) || _PRJ_TXT.untitledMem,
    spec: {
      kelvin: Math.round(_prjNum(s.kelvin, 1700, 20000, 5600)), tint: Math.round(_prjNum(s.tint, -100, 100, 0)),
      dimmer: Math.round(_prjNum(s.dimmer, 0, 100, 100)), wheelHex: safeHexColor(s.wheelHex, '#ffffff'),
      crossfade: Math.round(_prjNum(s.crossfade, 0, 100, 0)),
    },
    strobe: t ? {
      active: t.active === true, random: t.random === true, freq: _prjNum(t.freq, 0.5, 30, 2), dur: _prjNum(t.dur, 15, 500, 50),
      freqMax: _prjNum(t.freqMax, 0.5, 30, 8), durMax: _prjNum(t.durMax, 15, 500, 200), torch: t.torch === true,
    } : null,
  };
}
// Réglages d'effet : valeurs simples seulement (nombres, booléens, textes courts, listes et objets peu profonds)
function _prjPlain(v, depth) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean' || v === null) return v;
  if (typeof v === 'string') return _prjLine(v, 64);
  if (depth <= 0 || typeof v !== 'object') return undefined;
  if (Array.isArray(v)) return v.slice(0, 32).map((x) => _prjPlain(x, depth - 1)).filter((x) => x !== undefined);
  const out = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    if (n >= 40 || !/^[A-Za-z0-9_]{1,24}$/.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const x = _prjPlain(v[k], depth - 1);
    if (x !== undefined) { out[k] = x; n++; }
  }
  return out;
}
function _prjFxMem(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !_SEQ_ID_RE.test(m.id)) return null;
  if (typeof m.effect !== 'string' || !Object.prototype.hasOwnProperty.call(EFFECT_CONFIG, m.effect)) return null;
  const out = { id: m.id, name: _prjLine(m.name, 40) || EFFECT_CONFIG[m.effect].name || m.effect, effect: m.effect, params: _prjPlain(m.params && typeof m.params === 'object' ? m.params : {}, 3) };
  if (typeof m.dir === 'string' && /^[a-z-]{1,16}$/.test(m.dir)) out.dir = m.dir;
  return out;
}
function _prjMems(list, fn) {
  const ids = new Set();
  return _prjArr(list, _PRJ_RAW_MAX).map(fn).filter((e) => e && !ids.has(e.id) && ids.add(e.id));
}
// Fil en cours (83-discussion.js, chatLoad) : ce qu'un projet en garde
function _prjThread(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.msgs)) return null;
  const seen = new Set();
  const msgs = o.msgs.filter((x) => x && _chatOk(x.id) && !seen.has(x.id) && seen.add(x.id) && (x.from === 'contact' || x.from === 'actor') && typeof x.text === 'string')
    .slice(0, CHAT_MAX).map((x) => Object.assign({ id: x.id, from: x.from, text: x.text.slice(0, CHAT_TEXT_MAX) }, chatTiming(x, x.from), x.impro === true ? { impro: true } : {}));
  return {
    name: typeof o.name === 'string' ? _prjLine(o.name, 40) : '', actor: typeof o.actor === 'string' ? _prjLine(o.actor, 40) : '',
    style: _CHAT_STYLE_HINTS[o.style] ? o.style : 'minimal', typing: o.typing === true, msgs,
    savedId: typeof o.savedId === 'string' && _CHSV_ID_RE.test(o.savedId) ? o.savedId : null,
  };
}
function _prjCurSeq(o) {
  if (!o || typeof o !== 'object') return null;
  return {
    name: _seqLine(o.name, SEQ_NAME_MAX), steps: seqSanitizeSteps(o.steps), phone: phoneBarSanitize(o.phone), wall: seqWallSanitize(o.wall),
    savedId: typeof o.savedId === 'string' && _SEQ_ID_RE.test(o.savedId) ? o.savedId : null,
  };
}
const _prjSeqImgs = (steps, wall) => steps.filter((s) => s.kind === 'unlock' && s.opt.img).map((s) => s.opt.img).concat(wall ? [wall.img] : []);

// ══════════ Export : lecture de chaque section ══════════
async function _prjImages(F, images, sigs) {
  for (const sig of sigs) {
    if (images[sig] !== undefined) continue;
    const d = safeImageData(await _prjAssetGet(seqHomeKey(sig)));
    images[sig] = d ? await F.dataUrl(d) : null;
  }
}
const _PRJ_OUT = {
  async seq(F) {
    const o = _prjLsJson(SEQ_SAVED_KEY);
    const list = _prjSavedSeqs(o && o.list).slice(0, SEQ_SAVED_MAX), images = {};
    for (const e of list) await _prjImages(F, images, _prjSeqImgs(e.steps, e.wall));
    return { list, images };
  },
  async chat(F) {
    const o = _prjLsJson(CHAT_SAVED_KEY);
    const raw = o && Array.isArray(o.list) ? o.list : [];
    const list = [];
    for (const e of _prjSavedChats(raw).slice(0, CHAT_SAVED_MAX)) {
      const src = raw.find((x) => x && x.id === e.id);
      const d = src && src.hasPhoto ? safeImageData(await _prjAssetGet(_chsvPhotoKey(e.id))) : null;
      const out = Object.assign({}, e, { photo: d ? await F.dataUrl(d) : null });
      delete out.hasPhoto; delete out.photoSig;
      list.push(out);
    }
    return { list };
  },
  async calls(F) {
    const lists = _prjCallLists(_prjLsJson(CALL_LIST_KEY));
    for (const k of CALL_LISTS) {
      lists[k] = lists[k].slice(0, CALL_LIST_MAX);
      for (const e of lists[k]) {
        const photo = e.hasPhoto ? safeImageData(await _prjAssetGet(e.id + ':photo')) : null;
        const audio = e.hasAudio ? safeAudioData(await _prjAssetGet(e.id + ':audio')) : null;
        e.photo = photo ? await F.dataUrl(photo) : null;
        e.audio = audio ? await F.dataUrl(audio) : null;
        delete e.hasPhoto; delete e.hasAudio;
      }
    }
    return lists;
  },
  async callers(F) {
    const o = _prjLsJson(CALLERS_KEY);
    const list = [];
    for (const e of _prjCallers(o && o.list).slice(0, CALLERS_MAX)) {
      const d = e.hasPhoto ? safeImageData(await _prjAssetGet(_crPhotoKey(e.id))) : null;
      list.push({ id: e.id, name: e.name, label: e.label, photo: d ? await F.dataUrl(d) : null });
    }
    return { list };
  },
  async rings(F) {
    const lib = [];
    for (const m of (await _prjRingMetas()).slice(0, PRJ_LIMITS.rings)) {
      const d = await ringLibData(m.id);
      if (d) lib.push(Object.assign({}, m, { file: await F.dataUrl(d) }));
    }
    return { lib, settings: _prjRingSettings(_prjLsJson(RING_SETTINGS_KEY)) };
  },
  async memories() {
    return {
      color: _prjMems(_prjLsJson(_PRJ_COLOR_KEY), _prjColorMem).slice(0, PRJ_LIMITS.memories),
      fx: _prjMems(_prjLsJson(_PRJ_FX_KEY), _prjFxMem).slice(0, PRJ_LIMITS.memories),
    };
  },
  async media(F) {
    const list = [];
    for (const it of _mediaPool.slice(0, PRJ_LIMITS.media)) {
      if (!it.file || typeof it.file.arrayBuffer !== 'function') continue;
      const mime = String(it.file.type || '').toLowerCase();
      const t = _PRJ_MIME_RE.media.test(mime) ? mime : (it.kind === 'vid' ? 'video/mp4' : 'image/jpeg');
      list.push({ id: it.id, kind: it.kind === 'vid' ? 'vid' : 'img', name: _prjLine(it.name, 120) || 'media', file: await F.blob(it.file, t) });
    }
    return { list };
  },
  async work(F) {
    const seq = _prjCurSeq(_prjLsJson(SEQ_LS_KEY)), images = {};
    if (seq) await _prjImages(F, images, _prjSeqImgs(seq.steps, seq.wall));
    const chat = _prjThread(_prjLsJson(CHAT_LS_KEY));
    const av = safeImageData(_prjLsRaw(CHAT_AVATAR_KEY));
    return { seq, chat, avatar: av ? await F.dataUrl(av) : null, images };
  },
};
function _prjCounts(data) {
  const c = {};
  for (const s of Object.keys(data)) {
    const d = data[s];
    if (s === 'calls') c.calls = CALL_LISTS.reduce((n, k) => n + d[k].length, 0);
    else if (s === 'memories') c.memories = d.color.length + d.fx.length;
    else if (s === 'rings') c.rings = d.lib.length;
    else if (s === 'work') c.work = (d.seq && d.seq.steps.length ? 1 : 0) + (d.chat && d.chat.msgs.length ? 1 : 0);
    else c[s] = d.list.length;
  }
  return c;
}

// Secrets présents sur l'appareil (valeurs des champs sensibles des clés interdites)
const _PRJ_SECRET_FIELDS = new Set(['key', 's', 'token', 'd', 'priv', 'ch', 'channelId']);
function _prjSecrets() {
  const out = new Set();
  const walk = (v, k, depth) => {
    if (depth > 6) return;
    if (typeof v === 'string') { if (v.length >= 8 && _PRJ_SECRET_FIELDS.has(k)) out.add(v); return; }
    if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, Array.isArray(v) ? k : kk, depth + 1);
  };
  for (const k of PRJ_NEVER_KEYS) {
    const raw = _prjLsRaw(k);
    if (!raw) continue;
    let o = null;
    try { o = JSON.parse(raw); } catch (_) { o = null; }
    if (o && typeof o === 'object') walk(o, '', 0);
    else if (/^(setremote-remote-id|setremote-screen-id)$/.test(k) && raw.length >= 8) out.add(raw);
  }
  try { const id = typeof licDeviceId === 'function' ? licDeviceId() : null; if (id) out.add(id); } catch (_) {}
  return [...out];
}
function _prjSecretScan(text) {
  for (const s of _prjSecrets()) if (text.includes(s)) throw _prjErr('secret');
}

// ══════════ API : résumé, export ══════════
// Contenu actuel par section (feuille d'export) : { counts, calls, media: { count, bytes }, bytes (estimation) }
async function projectSummary() {
  const sz = (d) => (typeof d === 'string' ? Math.round(d.length * 0.75) : 0);
  let bytes = 0;
  const seqs = _prjSavedSeqs((_prjLsJson(SEQ_SAVED_KEY) || {}).list).slice(0, SEQ_SAVED_MAX);
  const imgs = new Set();
  for (const e of seqs) for (const s of _prjSeqImgs(e.steps, e.wall)) imgs.add(s);
  for (const s of imgs) bytes += sz(await _prjAssetGet(seqHomeKey(s)));
  const chats = _prjSavedChats((_prjLsJson(CHAT_SAVED_KEY) || {}).list).slice(0, CHAT_SAVED_MAX);
  for (const e of (_prjLsJson(CHAT_SAVED_KEY) || {}).list || []) if (e && e.hasPhoto && chats.some((c) => c.id === e.id)) bytes += sz(await _prjAssetGet(_chsvPhotoKey(e.id)));
  const lists = _prjCallLists(_prjLsJson(CALL_LIST_KEY));
  const calls = {};
  for (const k of CALL_LISTS) {
    calls[k] = Math.min(CALL_LIST_MAX, lists[k].length);
    for (const e of lists[k].slice(0, CALL_LIST_MAX)) {
      if (e.hasPhoto) bytes += sz(await _prjAssetGet(e.id + ':photo'));
      if (e.hasAudio) bytes += sz(await _prjAssetGet(e.id + ':audio'));
    }
  }
  const crs = _prjCallers((_prjLsJson(CALLERS_KEY) || {}).list).slice(0, CALLERS_MAX);
  for (const e of crs) if (e.hasPhoto) bytes += sz(await _prjAssetGet(_crPhotoKey(e.id)));
  const rings = (await _prjRingMetas()).slice(0, PRJ_LIMITS.rings);
  for (const m of rings) bytes += m.size || 0;
  const mem = await _PRJ_OUT.memories();
  const media = _mediaPool.slice(0, PRJ_LIMITS.media).filter((m) => m.file);
  const mediaBytes = media.reduce((n, m) => n + (m.file.size || 0), 0);
  return {
    counts: { seq: seqs.length, chat: chats.length, calls: calls.call + calls.sms + calls.notif, callers: crs.length, rings: rings.length, memories: mem.color.length + mem.fx.length, media: media.length },
    calls, memories: { color: mem.color.length, fx: mem.fx.length },
    media: { count: media.length, bytes: mediaBytes },
    bytes, // sans les médias
  };
}
// Sections demandées, dans l'ordre du format ; médias seulement avec includeMedia
function _prjExportSections(o) {
  const want = Array.isArray(o.sections) ? o.sections : PRJ_SECTIONS;
  const secs = PRJ_SECTIONS.filter((s) => s !== 'media' && want.includes(s));
  if (o.includeMedia === true && want.includes('media')) secs.push('media');
  if (o.work !== false) secs.push('work');
  return secs;
}
// → Promise<Blob> (application/zip) ; rejet : Error { code }
async function projectExport(opts = {}) {
  const name = _prjName(opts.name) || _PRJ_TXT.defaultName;
  const secs = _prjExportSections(opts);
  const F = _prjFileSet();
  const data = {};
  for (const s of secs) data[s] = await _PRJ_OUT[s](F);
  const counts = _prjCounts(data);
  const when = new Date();
  const manifest = { format: PRJ_FORMAT, version: PRJ_VERSION, app: APP_VERSION, created: when.toISOString(), name, sections: secs, counts, files: F.map.size };
  if (data.calls) manifest.calls = { call: data.calls.call.length, sms: data.calls.sms.length, notif: data.calls.notif.length };
  if (data.media) manifest.mediaBytes = data.media.list.reduce((n, m) => { const f = F.map.get(m.file.f); return n + (f ? (f.blob ? f.blob.size : f.bytes.length) : 0); }, 0);
  const jsons = [['project.json', manifest]].concat(secs.map((s) => ['data/' + s + '.json', data[s]])).map(([n, o]) => [n, JSON.stringify(o)]);
  _prjSecretScan(jsons.map((x) => x[1]).join('\n'));
  const entries = jsons.map(([n, t]) => ({ name: n, bytes: _prjUtf8(t), deflate: true })).concat([...F.map.values()]);
  const total = entries.reduce((n, e) => n + (e.bytes ? e.bytes.length : e.blob.size), 0);
  if (total > PRJ_LIMITS.total || total > PRJ_LIMITS.file) throw _prjErr('too-large', { max: Math.round(PRJ_LIMITS.file / _PRJ_MB) });
  const blob = await _prjZipBuild(entries, when);
  if (blob.size > PRJ_LIMITS.file) throw _prjErr('too-large', { max: Math.round(PRJ_LIMITS.file / _PRJ_MB) });
  return blob;
}

// ══════════ Lecture d'un projet (aperçu, import) ══════════
const _PRJ_IN = {
  seq(o, z) {
    const images = {};
    const src = o && o.images && typeof o.images === 'object' ? o.images : {};
    for (const k of Object.keys(src).slice(0, _PRJ_RAW_MAX)) { const r = _SEQ_SIG_RE.test(k) ? _prjRef(z, src[k], 'image') : null; if (r) images[k] = r; }
    return { list: _prjSavedSeqs(o && o.list), images };
  },
  chat(o, z) {
    const raw = _prjArr(o && o.list, _PRJ_RAW_MAX);
    return { list: _prjSavedChats(raw).map((e) => Object.assign(e, { photo: _prjRef(z, (raw.find((x) => x && x.id === e.id) || {}).photo, 'image') })) };
  },
  calls(o, z) {
    const out = {};
    for (const k of CALL_LISTS) {
      const raw = _prjArr(o && o[k], _PRJ_RAW_MAX);
      const ids = new Set();
      out[k] = raw.map((e) => {
        const c = _prjCallEntry(Object.assign({}, e, { hasPhoto: false, hasAudio: false }), k);
        if (!c || ids.has(c.id)) return null;
        ids.add(c.id);
        c.photo = _prjRef(z, e.photo, 'image');
        c.audio = c.kind === 'call' ? _prjRef(z, e.audio, 'audio') : null;
        return c;
      }).filter(Boolean);
    }
    return out;
  },
  callers(o, z) {
    const raw = _prjArr(o && o.list, _PRJ_RAW_MAX);
    return { list: _prjCallers(raw.map((e) => (e && typeof e === 'object' ? { id: e.id, name: e.name, label: e.label } : null))).map((e) => ({ id: e.id, name: e.name, label: e.label, photo: _prjRef(z, (raw.find((x) => x && x.id === e.id) || {}).photo, 'image') })) };
  },
  rings(o, z) {
    const seen = new Set();
    const lib = _prjArr(o && o.lib, _PRJ_RAW_MAX).map((e) => {
      const m = _ringSanitizeMeta(e), r = e && _prjRef(z, e.file, 'audio');
      if (!m || !r || seen.has(m.id)) return null;
      seen.add(m.id);
      return Object.assign(m, { file: r });
    }).filter(Boolean);
    return { lib, settings: _prjRingSettings(o && o.settings) };
  },
  memories(o) { return { color: _prjMems(o && o.color, _prjColorMem), fx: _prjMems(o && o.fx, _prjFxMem) }; },
  media(o, z) {
    const ids = new Set();
    return { list: _prjArr(o && o.list, _PRJ_RAW_MAX).map((e) => {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !_SEQ_ID_RE.test(e.id) || ids.has(e.id)) return null;
      const r = _prjRef(z, e.file, 'media');
      if (!r) return null;
      ids.add(e.id);
      const kind = r.t.startsWith('video/') ? 'vid' : 'img';
      return { id: e.id, kind, name: _prjLine(e.name, 120) || (kind === 'vid' ? 'vidéo' : 'image'), file: r };
    }).filter(Boolean) };
  },
  work(o, z) {
    const images = {};
    const src = o && o.images && typeof o.images === 'object' ? o.images : {};
    for (const k of Object.keys(src).slice(0, 200)) { const r = _SEQ_SIG_RE.test(k) ? _prjRef(z, src[k], 'image') : null; if (r) images[k] = r; }
    return { seq: _prjCurSeq(o && o.seq), chat: _prjThread(o && o.chat), avatar: _prjRef(z, o && o.avatar, 'image'), images };
  },
};
// Données vides d'une section (remplacement par « rien », projet vide)
function _prjEmpty(s) {
  switch (s) {
    case 'seq': return { list: [], images: {} };
    case 'calls': return { call: [], sms: [], notif: [] };
    case 'rings': return { lib: [], settings: _prjRingSettings(null) };
    case 'memories': return { color: [], fx: [] };
    case 'work': return { seq: _prjCurSeq({}), chat: _prjThread({ name: '', actor: '', msgs: [] }), avatar: null, images: {} };
    default: return { list: [] };
  }
}
async function _prjOpen(file) {
  const z = await _prjZipOpen(file);
  if (!z.entries.has('project.json')) throw _prjErr('not-project');
  const man = await _prjZipJson(z, 'project.json', PRJ_LIMITS.manifest);
  if (!man || typeof man !== 'object' || man.format !== PRJ_FORMAT) throw _prjErr('not-project');
  if (!Number.isInteger(man.version) || man.version < 1) throw _prjErr('invalid');
  if (man.version > PRJ_VERSION) throw _prjErr('version');
  const data = {};
  for (const s of PRJ_ALL) {
    const o = await _prjZipJson(z, 'data/' + s + '.json', PRJ_LIMITS.json);
    if (o === null) continue;
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw _prjErr('invalid');
    data[s] = _PRJ_IN[s](o, z);
  }
  const created = typeof man.created === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(man.created) ? man.created : null;
  let mediaBytes = 0;
  if (data.media) for (const m of data.media.list) mediaBytes += (z.entries.get(m.file.f) || {}).usize || 0;
  return {
    z, cache: new Map(), name: _prjName(man.name) || _PRJ_TXT.defaultName, created, app: _prjLine(typeof man.app === 'string' ? man.app : '', 20),
    version: man.version, size: file.size, sections: PRJ_ALL.filter((s) => data[s]), data, counts: _prjCounts(data), mediaBytes,
  };
}
// Aperçu d'un fichier (feuille 45c) : { ok, name, created, app, size, sections, counts, calls, mediaBytes } | { ok: false, code, message }
async function projectInspect(file) {
  try {
    const p = await _prjOpen(file);
    const d = p.data;
    return {
      ok: true, name: p.name, created: p.created, app: p.app, version: p.version, size: p.size,
      sections: p.sections.filter((s) => s !== 'work'), hasWork: !!d.work, counts: p.counts,
      calls: d.calls ? { call: d.calls.call.length, sms: d.calls.sms.length, notif: d.calls.notif.length } : null,
      memories: d.memories ? { color: d.memories.color.length, fx: d.memories.fx.length } : null,
      mediaBytes: p.mediaBytes,
    };
  } catch (e) { return _prjFail(e); }
}

// ══════════ Import ══════════
let _prjBusy = false;
function _prjUnique(name, taken, max) {
  let n = name, k = 2;
  while (taken.has(n.toLowerCase())) { const suf = ' (' + k++ + ')'; n = name.slice(0, Math.max(1, max - suf.length)) + suf; }
  taken.add(n.toLowerCase());
  return n;
}
function _prjFreshId(id, taken, gen) {
  let v = id;
  while (taken.has(v)) v = gen();
  taken.add(v);
  return v;
}
// Image d'accueil / fond d'écran : rangée sous l'empreinte de son contenu → nouvelle empreinte (null : absente)
async function _prjImg(p, sig, maps) {
  if (!sig) return null;
  if (maps.img.has(sig)) return maps.img.get(sig);
  const r = (p.data.seq && p.data.seq.images[sig]) || (p.data.work && p.data.work.images[sig]) || null;
  const d = await _prjLoadData(p, r, 'image');
  let out = null;
  if (d) { out = seqImageSig(d); await _prjAssetPut(seqHomeKey(out), d); }
  maps.img.set(sig, out);
  return out;
}
async function _prjSteps(p, steps, maps) {
  const out = [];
  for (const s0 of steps) {
    const s = JSON.parse(JSON.stringify(s0));
    const m = { color: maps.color, effect: maps.fx, call: maps.call, missed: maps.call, sms: maps.call, notif: maps.call, chat: maps.chat }[s.kind];
    if (m && typeof s.ref === 'string' && m.has(s.ref)) s.ref = m.get(s.ref);
    if (s.kind === 'media' && s.ref && maps.media.has(s.ref.id)) s.ref = Object.assign({}, s.ref, { id: maps.media.get(s.ref.id) });
    if (s.kind === 'unlock' && s.opt.img) { s.opt.img = await _prjImg(p, s.opt.img, maps); if (!s.opt.img) s.opt.imgName = ''; }
    out.push(s);
  }
  return seqSanitizeSteps(out);
}
const _prjRes = () => ({ added: 0, removed: 0, skipped: 0, renamed: 0, same: 0 });
function _prjWarn(R, section, code, name) { if (R.warnings.length < 50) R.warnings.push({ section, code, name: name || '' }); }

const _PRJ_APPLY = {
  async rings(p, d, mode, maps, R) {
    const r = _prjRes();
    let cur = await _prjRingMetas();
    if (mode === 'replace') { r.removed = cur.length; for (const m of cur) await _ringLibDelete(m.id); cur = []; }
    const have = new Set(cur.map((m) => m.id));
    let n = cur.length, i = 0;
    for (const e of d.lib) {
      // Comme un son importé à la main (ringImportFile) : 5 Mo au plus, décodable
      const data = await _prjLoadData(p, e.file, 'audio', RING_MAX_BYTES);
      let audio = null;
      if (data) { try { audio = await ringDecode(_prjB64ToBytes(data.slice(data.indexOf(',') + 1)).buffer); } catch (_) { audio = null; } }
      if (!data || !audio || !(audio.duration > 0)) { r.skipped++; _prjWarn(R, 'rings', 'file', e.name); continue; }
      const id = await _ringHashId(data);
      maps.ring.set(e.id, id);
      if (have.has(id)) { r.same++; continue; }
      if (n >= PRJ_LIMITS.rings) { r.skipped++; continue; }
      const meta = _ringSanitizeMeta({ id, name: e.name, mime: e.mime, size: e.size, dur: e.dur, at: mode === 'replace' ? e.at : Date.now() + (i++) });
      await _ringLibPut(meta, data);
      have.add(id); n++; r.added++;
    }
    if (mode === 'replace') {
      const s = {};
      for (const k of RING_KINDS) {
        const v = d.settings[k];
        const sound = _ringIsId(v.sound) ? (maps.ring.get(v.sound) || v.sound) : v.sound;
        s[k] = { sound: _ringIsId(sound) && !have.has(sound) ? 'classic' : sound, vol: v.vol, vib: v.vib };
      }
      _prjLsWrite(RING_SETTINGS_KEY, JSON.stringify(Object.assign({ v: 1 }, s)));
    }
    return r;
  },
  async memories(p, d, mode, maps) {
    const r = _prjRes();
    for (const [key, k, fn, gen] of [[_PRJ_COLOR_KEY, 'color', _prjColorMem, () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)], [_PRJ_FX_KEY, 'fx', _prjFxMem, () => 'f' + Date.now() + Math.random().toString(36).slice(2, 5)]]) {
      const cur = mode === 'replace' ? [] : _prjMems(_prjLsJson(key), fn);
      if (mode === 'replace') r.removed += _prjMems(_prjLsJson(key), fn).length;
      const ids = new Set(cur.map((e) => e.id)), names = new Set(cur.map((e) => e.name.toLowerCase()));
      for (const e0 of d[k]) {
        if (cur.length >= PRJ_LIMITS.memories) { r.skipped++; continue; }
        const e = JSON.parse(JSON.stringify(e0));
        e.id = _prjFreshId(e.id, ids, gen);
        maps[k].set(e0.id, e.id);
        const nm = _prjUnique(e.name, names, 40);
        if (nm !== e.name) { r.renamed++; e.name = nm; }
        cur.push(e); r.added++;
      }
      _prjLsWrite(key, JSON.stringify(cur));
    }
    return r;
  },
  async media(p, d, mode, maps, R) {
    const r = _prjRes();
    if (mode === 'replace') { r.removed = _mediaPool.length; for (const it of [..._mediaPool]) removeMedia(it.id); }
    for (const e of d.list) {
      if (_mediaPool.length >= PRJ_LIMITS.media) { r.skipped++; continue; }
      let blob = null;
      try { blob = await _prjZipBlob(p.z, e.file.f, e.file.t, e.kind === 'vid' ? PRJ_LIMITS.video : PRJ_LIMITS.image); } catch (x) { if (x && x.code === 'corrupt') throw x; blob = null; }
      if (!blob) { r.skipped++; _prjWarn(R, 'media', 'file', e.name); continue; }
      const file = new File([blob], e.name, { type: e.file.t });
      const item = { id: 'm' + (++_poolSeq), kind: e.kind, name: e.name, file, thumb: e.kind === 'img' ? URL.createObjectURL(file) : null };
      _mediaPool.push(item);
      if (e.kind === 'vid') makeVideoThumb(item);
      maps.media.set(e.id, item.id);
      r.added++;
    }
    return r;
  },
  async callers(p, d, mode, maps, R) {
    const r = _prjRes();
    const old = _prjCallers((_prjLsJson(CALLERS_KEY) || {}).list);
    if (mode === 'replace') { r.removed = old.length; for (const e of old) await _prjAssetDel(_crPhotoKey(e.id)); }
    const cur = mode === 'replace' ? [] : old.slice(0, CALLERS_MAX);
    const ids = new Set(cur.map((e) => e.id)), keys = new Set(cur.map((e) => _crKey(e.name, e.label)));
    for (const e0 of d.list) {
      if (keys.has(_crKey(e0.name, e0.label))) { r.same++; continue; }
      if (cur.length >= CALLERS_MAX) { r.skipped++; continue; }
      const e = { id: _prjFreshId(e0.id, ids, _crNewId), name: e0.name, label: e0.label, hasPhoto: false, photoSig: null };
      const ph = await _prjLoadData(p, e0.photo, 'image');
      if (e0.photo && !ph) _prjWarn(R, 'callers', 'file', e.name);
      if (ph) { await _prjAssetPut(_crPhotoKey(e.id), ph); e.hasPhoto = true; e.photoSig = _chsvPhotoSig(ph); }
      keys.add(_crKey(e.name, e.label));
      cur.push(e); r.added++;
    }
    _prjLsWrite(CALLERS_KEY, JSON.stringify({ v: 1, list: cur }));
    return r;
  },
  async calls(p, d, mode, maps, R) {
    const r = _prjRes();
    const old = _prjCallLists(_prjLsJson(CALL_LIST_KEY));
    if (mode === 'replace') {
      for (const k of CALL_LISTS) for (const e of old[k]) { r.removed++; await _prjAssetDel(e.id + ':photo'); await _prjAssetDel(e.id + ':audio'); }
    }
    const cur = mode === 'replace' ? { call: [], sms: [], notif: [] } : { call: old.call.slice(0, CALL_LIST_MAX), sms: old.sms.slice(0, CALL_LIST_MAX), notif: old.notif.slice(0, CALL_LIST_MAX) };
    const ids = new Set(CALL_LISTS.flatMap((k) => cur[k].map((e) => e.id)));
    for (const k of CALL_LISTS) {
      const names = new Set(cur[k].map((e) => callEntryName(e).toLowerCase()));
      for (const e0 of d[k]) {
        if (cur[k].length >= CALL_LIST_MAX) { r.skipped++; continue; }
        const e = Object.assign({}, e0);
        delete e.photo; delete e.audio;
        e.id = _prjFreshId(e0.id, ids, _clNewId);
        maps.call.set(e0.id, e.id);
        if (e.ringId && maps.ring.has(e.ringId)) e.ringId = maps.ring.get(e.ringId);
        const nm = callEntryName(e);
        const u = _prjUnique(nm, names, CALL_TITLE_MAX);
        if (u !== nm) { e.title = u; r.renamed++; }
        const ph = await _prjLoadData(p, e0.photo, 'image');
        const au = e.kind === 'call' ? await _prjLoadData(p, e0.audio, 'audio', CALL_AUDIO_MAX_BYTES) : null;
        if ((e0.photo && !ph) || (e0.audio && !au)) _prjWarn(R, 'calls', 'file', callEntryName(e));
        e.hasPhoto = !!ph; e.hasAudio = !!au;
        if (ph) await _prjAssetPut(e.id + ':photo', ph);
        if (au) await _prjAssetPut(e.id + ':audio', au);
        const c = _clSanitize(e);
        if (!c) { r.skipped++; continue; }
        cur[k].push(c); r.added++;
      }
    }
    _prjLsWrite(CALL_LIST_KEY, JSON.stringify({ v: 1, call: cur.call, sms: cur.sms, notif: cur.notif }));
    return r;
  },
  async chat(p, d, mode, maps, R) {
    const r = _prjRes();
    const old = _prjSavedChats((_prjLsJson(CHAT_SAVED_KEY) || {}).list);
    const oldRaw = (_prjLsJson(CHAT_SAVED_KEY) || {}).list || [];
    if (mode === 'replace') { r.removed = old.length; for (const e of old) await _prjAssetDel(_chsvPhotoKey(e.id)); }
    // Entrées gardées : avec leur photo (hasPhoto, photoSig d'origine)
    const cur = mode === 'replace' ? [] : old.slice(0, CHAT_SAVED_MAX).map((e) => _chsvSanitize(oldRaw.find((x) => x && x.id === e.id)) || e);
    const ids = new Set(cur.map((e) => e.id)), names = new Set(cur.map((e) => e.name.toLowerCase()));
    for (const e0 of d.list) {
      if (cur.length >= CHAT_SAVED_MAX) { r.skipped++; continue; }
      const e = Object.assign({}, e0, { msgs: e0.msgs.map((m) => Object.assign({}, m)), hasPhoto: false, photoSig: null });
      delete e.photo;
      e.id = _prjFreshId(e0.id, ids, _chsvNewId);
      maps.chat.set(e0.id, e.id);
      const nm = _prjUnique(e.name, names, CHAT_SAVED_NAME_MAX);
      if (nm !== e.name) { e.name = nm; r.renamed++; }
      const ph = await _prjLoadData(p, e0.photo, 'image');
      if (e0.photo && !ph) _prjWarn(R, 'chat', 'file', e.name);
      if (ph) { await _prjAssetPut(_chsvPhotoKey(e.id), ph); e.hasPhoto = true; e.photoSig = _chsvPhotoSig(ph); }
      cur.push(e); r.added++;
    }
    _prjLsWrite(CHAT_SAVED_KEY, JSON.stringify({ v: 2, list: cur }));
    return r;
  },
  async seq(p, d, mode, maps) {
    const r = _prjRes();
    const old = _prjSavedSeqs((_prjLsJson(SEQ_SAVED_KEY) || {}).list);
    const dropped = mode === 'replace' ? old.flatMap((e) => _prjSeqImgs(e.steps, e.wall)) : [];
    if (mode === 'replace') r.removed = old.length;
    const cur = mode === 'replace' ? [] : old.slice(0, SEQ_SAVED_MAX);
    const ids = new Set(cur.map((e) => e.id)), names = new Set(cur.map((e) => e.name.toLowerCase()));
    for (const e0 of d.list) {
      if (cur.length >= SEQ_SAVED_MAX) { r.skipped++; continue; }
      const e = { id: _prjFreshId(e0.id, ids, _sqsvNewId), name: e0.name, steps: await _prjSteps(p, e0.steps, maps), phone: e0.phone, wall: null };
      maps.seq.set(e0.id, e.id);
      if (e0.wall) { const sig = await _prjImg(p, e0.wall.img, maps); e.wall = sig ? { img: sig, name: e0.wall.name } : null; }
      const nm = _prjUnique(e.name, names, SEQ_NAME_MAX);
      if (nm !== e.name) { e.name = nm; r.renamed++; }
      const c = _sqsvSanitize(e);
      if (!c) { r.skipped++; continue; }
      cur.push(c); r.added++;
    }
    _prjLsWrite(SEQ_SAVED_KEY, JSON.stringify({ v: 1, list: cur }));
    if (dropped.length) maps.gcSeq.push(...dropped);
    return r;
  },
  // État de travail : toujours remplacé (séquence en cours, fil en cours, photo du contact)
  async work(p, d, mode, maps) {
    const r = _prjRes();
    const oldSeq = _prjCurSeq(_prjLsJson(SEQ_LS_KEY));
    if (oldSeq) maps.gcSeq.push(..._prjSeqImgs(oldSeq.steps, oldSeq.wall));
    // Absent du projet (jamais modifié) : clé retirée, le module reprend ses valeurs par défaut
    const s = d.seq;
    if (s) {
      const steps = await _prjSteps(p, s.steps, maps);
      let wall = null;
      if (s.wall) { const sig = await _prjImg(p, s.wall.img, maps); wall = sig ? { img: sig, name: s.wall.name } : null; }
      _prjLsWrite(SEQ_LS_KEY, JSON.stringify({ v: 1, name: s.name, steps, savedId: s.savedId ? (maps.seq.get(s.savedId) || s.savedId) : null, phone: s.phone, wall }));
    } else _prjLsWrite(SEQ_LS_KEY, null);
    const c = d.chat;
    if (c) _prjLsWrite(CHAT_LS_KEY, JSON.stringify({ v: 2, name: c.name, actor: c.actor, style: c.style, typing: c.typing, msgs: c.msgs, sent: [], open: false, screens: null, resumeAt: null, savedId: c.savedId ? (maps.chat.get(c.savedId) || c.savedId) : null, pend: [] }));
    else _prjLsWrite(CHAT_LS_KEY, null);
    _prjLsWrite(CHAT_AVATAR_KEY, await _prjLoadData(p, d.avatar, 'image'));
    r.added = 1;
    return r;
  },
};
const _PRJ_ORDER = ['rings', 'memories', 'media', 'callers', 'calls', 'chat', 'seq', 'work'];
const _PRJ_TEL = ['rings', 'callers', 'calls', 'chat'];
// Images de séquence que plus rien n'utilise (stockage réel : séquence en cours et enregistrées)
async function _prjGcSeqImages(dropped) {
  if (!dropped.length) return;
  const used = new Set();
  const cur = _prjCurSeq(_prjLsJson(SEQ_LS_KEY));
  if (cur) for (const s of _prjSeqImgs(cur.steps, cur.wall)) used.add(s);
  for (const e of _prjSavedSeqs((_prjLsJson(SEQ_SAVED_KEY) || {}).list)) for (const s of _prjSeqImgs(e.steps, e.wall)) used.add(s);
  if (typeof _seqEdit !== 'undefined' && _seqEdit && _seqEdit.step.kind === 'unlock' && _seqEdit.step.opt.img) used.add(_seqEdit.step.opt.img);
  for (const s of new Set(dropped)) if (!used.has(s)) await _prjAssetDel(seqHomeKey(s));
}
// Relit les modules depuis le stockage et redessine (onglets en aperçu : rien, la démo reste)
async function _prjRefresh(done) {
  const has = (s) => done.includes(s);
  const fn = (n) => typeof window[n] === 'function';
  if (_PRJ_TEL.some(has) || has('work')) {
    if (!licLocked('tel')) {
      // chatLoad garde le fil en mémoire quand la clé est absente : fil par défaut
      if (has('work') && _prjLsRaw(CHAT_LS_KEY) === null) { _chat = _chatDefault(); _chatAvatar = null; }
      if (fn('_licReloadTel')) _licReloadTel();
      _crPhotos.clear(); _clPrepIds.clear();
      if (fn('gwSyncTriggerEntries')) gwSyncTriggerEntries();
    }
  }
  if (has('rings')) await ringLibLoad();
  if ((has('seq') || has('work')) && !licLocked('seq')) {
    if (has('work')) seqLoad();
    loadSavedSeqs();
    renderSeq();
  }
  if (has('memories')) { loadColorMemories(); renderColorMemories(); loadFxMemories(); renderFxMemories(); }
  if (has('media')) { renderPool(); sendPoolOrder(); schedulePreload(); }
}
// Applique les sections want d'un projet ouvert (p) ; clearMissing : sections absentes vidées
async function _prjApply(p, want, mode, clearMissing) {
  const R = { ok: true, mode, name: p.name, sections: {}, warnings: [], preview: [] };
  const maps = { ring: new Map(), media: new Map(), call: new Map(), chat: new Map(), color: new Map(), fx: new Map(), img: new Map(), seq: new Map(), gcSeq: [] };
  const done = [];
  try {
    for (const s of _PRJ_ORDER) {
      if (!want.includes(s)) continue;
      const d = p.data[s] || (clearMissing ? _prjEmpty(s) : null);
      if (!d) continue;
      R.sections[s] = await _PRJ_APPLY[s](p, d, s === 'work' ? 'replace' : mode, maps, R);
      done.push(s);
    }
    await _prjGcSeqImages(maps.gcSeq);
  } finally {
    await _prjRefresh(done);
  }
  if (done.some((s) => _PRJ_TEL.includes(s) || s === 'work') && licLocked('tel')) R.preview.push('tel');
  if (done.some((s) => s === 'seq' || s === 'work') && licLocked('seq')) R.preview.push('seq');
  return R;
}
// Import dans le projet ouvert (ou comme nouveau projet : mode « new »)
// opts : { mode: 'merge' | 'replace' | 'new', sections } → compte rendu
//   { ok, mode, name, sections: { s: { added, removed, skipped, renamed, same } }, warnings, preview }
async function projectImport(file, opts = {}) {
  const mode = opts.mode === 'replace' ? 'replace' : opts.mode === 'new' ? 'new' : 'merge';
  if (mode === 'new') return projectImportAsNew(file, opts);
  if (_prjBusy) return _prjFail(_prjErr('pending'));
  _prjBusy = true;
  try {
    const p = await _prjOpen(file);
    const asked = Array.isArray(opts.sections) ? opts.sections : PRJ_SECTIONS;
    const want = p.sections.filter((s) => asked.includes(s));
    if (!want.length) throw _prjErr('empty');
    return await _prjApply(p, want, mode, false);
  } catch (e) {
    return _prjFail(e);
  } finally { _prjBusy = false; }
}

// ══════════ Projets locaux (IndexedDB setremote-projects) ══════════
let _prjDbP = null;
function _prjDb() {
  if (_prjDbP) return _prjDbP;
  _prjDbP = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
      const req = indexedDB.open(PRJ_DB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('meta', { keyPath: 'id' }); req.result.createObjectStore('snap'); } catch (_) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  });
  return _prjDbP;
}
// Transaction sur meta et snap ; résultat de la requête renvoyée par fn ; échec : Error storage-full / unavailable
function _prjTx(mode, fn) {
  return _prjDb().then((db) => new Promise((resolve, reject) => {
    if (!db) { reject(_prjErr('unavailable')); return; }
    try {
      const tx = db.transaction(['meta', 'snap'], mode);
      const r = fn(tx.objectStore('meta'), tx.objectStore('snap'));
      tx.oncomplete = () => resolve(r && 'result' in r ? r.result : true);
      tx.onerror = tx.onabort = () => reject(_prjErr(mode === 'readwrite' ? 'storage-full' : 'read'));
    } catch (_) { reject(_prjErr('storage-full')); }
  }));
}
const _prjMetaSan = (m) => (m && typeof m === 'object' && typeof m.id === 'string' ? m : null);
async function _prjMetas() {
  const all = await _prjTx('readonly', (m) => m.getAll());
  return (Array.isArray(all) ? all : []).map(_prjMetaSan).filter(Boolean).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
}
function projectActiveId() { const o = _prjLsJson(PRJ_ACTIVE_KEY); return o && typeof o.active === 'string' ? o.active : null; }
function _prjSetActive(id) { _prjLsWrite(PRJ_ACTIVE_KEY, JSON.stringify({ v: 1, active: id })); }
const _prjNewPid = () => 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// Premier usage : les données actuelles deviennent « Mon projet » (projet ouvert)
async function projectsInit() {
  const metas = await _prjMetas();
  const active = projectActiveId();
  if (!metas.length) {
    const now = Date.now();
    const m = { id: _prjNewPid(), name: _PRJ_TXT.firstName, created: now, updated: now, size: 0, counts: {} };
    await _prjTx('readwrite', (st) => st.put(m));
    _prjSetActive(m.id);
    return [m];
  }
  if (!metas.some((m) => m.id === active)) _prjSetActive(metas[0].id);
  return metas;
}
async function _prjRun(fn) {
  if (_prjBusy) return _prjFail(_prjErr('pending'));
  _prjBusy = true;
  try { return await fn(); } catch (e) { return _prjFail(e); } finally { _prjBusy = false; }
}
// Liste : [{ id, name, created, updated, size, counts, active }] ; projet ouvert : contenu actuel
function projectsList() {
  return _prjRun(async () => {
    const metas = await projectsInit();
    const active = projectActiveId();
    const live = await projectSummary();
    return { ok: true, active, list: metas.map((m) => Object.assign({}, m, m.id === active ? { counts: live.counts, size: live.bytes, active: true } : { active: false })) };
  });
}
function _prjQuota(metas, extra, exceptId) {
  const used = metas.filter((m) => m.id !== exceptId).reduce((n, m) => n + (m.size || 0), 0);
  if (used + extra > PRJ_LIMITS.store) throw _prjErr('quota');
}
const _prjNames = (metas) => new Set(metas.map((m) => m.name.toLowerCase()));
// Instantané de l'espace de travail (tout sauf les médias, état de travail compris)
function _prjSnapshot(name) { return projectExport({ name, includeMedia: false, work: true }); }
async function _prjSnapMeta(blob) {
  const i = await projectInspect(blob);
  return i.ok ? i.counts : {};
}
// Nouveau projet : from 'empty' (vide) ou 'current' (copie du projet ouvert) ; ne l'ouvre pas
function projectCreate(opts = {}) {
  return _prjRun(async () => {
    const metas = await projectsInit();
    if (metas.length >= PRJ_LIMITS.projects) throw _prjErr('quota');
    const cur = metas.find((m) => m.id === projectActiveId());
    const base = _prjName(opts.name) || (opts.from === 'current' && cur ? _prjTpl(_PRJ_TXT.copy, { nom: cur.name }) : _PRJ_TXT.defaultName);
    const name = _prjUnique(base, _prjNames(metas), 60);
    const snap = opts.from === 'current' ? await _prjSnapshot(name) : null;
    _prjQuota(metas, snap ? snap.size : 0);
    const now = Date.now();
    const m = { id: _prjNewPid(), name, created: now, updated: now, size: snap ? snap.size : 0, counts: snap ? await _prjSnapMeta(snap) : {} };
    await _prjTx('readwrite', (st, sn) => { st.put(m); return sn.put(snap, m.id); });
    return { ok: true, id: m.id, name };
  });
}
function projectRename(id, name) {
  return _prjRun(async () => {
    const metas = await projectsInit();
    const m = metas.find((x) => x.id === id);
    if (!m) throw _prjErr('not-found');
    const base = _prjName(name);
    if (!base) return { ok: true, id, name: m.name };
    m.name = _prjUnique(base, _prjNames(metas.filter((x) => x.id !== id)), 60);
    m.updated = Date.now();
    await _prjTx('readwrite', (st) => st.put(m));
    return { ok: true, id, name: m.name };
  });
}
function projectDuplicate(id) {
  return _prjRun(async () => {
    const metas = await projectsInit();
    const src = metas.find((x) => x.id === id);
    if (!src) throw _prjErr('not-found');
    if (metas.length >= PRJ_LIMITS.projects) throw _prjErr('quota');
    const name = _prjUnique(_prjTpl(_PRJ_TXT.copy, { nom: src.name }).slice(0, 60), _prjNames(metas), 60);
    const snap = id === projectActiveId() ? await _prjSnapshot(name) : await _prjTx('readonly', (st, sn) => sn.get(id));
    _prjQuota(metas, snap ? snap.size : 0);
    const now = Date.now();
    const m = { id: _prjNewPid(), name, created: now, updated: now, size: snap ? snap.size : 0, counts: snap ? await _prjSnapMeta(snap) : {} };
    await _prjTx('readwrite', (st, sn) => { st.put(m); return sn.put(snap || null, m.id); });
    return { ok: true, id: m.id, name };
  });
}
function projectDelete(id) {
  return _prjRun(async () => {
    const metas = await projectsInit();
    if (!metas.some((x) => x.id === id)) throw _prjErr('not-found');
    if (id === projectActiveId()) throw _prjErr('active');
    await _prjTx('readwrite', (st, sn) => { st.delete(id); return sn.delete(id); });
    return { ok: true, id };
  });
}
// Fichier .setremote d'un projet rangé (sans l'ouvrir) ; projet ouvert : export du contenu actuel
function projectExportStored(id, opts = {}) {
  return _prjRun(async () => {
    const metas = await projectsInit();
    const m = metas.find((x) => x.id === id);
    if (!m) throw _prjErr('not-found');
    if (id === projectActiveId()) return { ok: true, name: m.name, blob: await projectExport({ name: m.name, includeMedia: opts.includeMedia === true }) };
    const snap = await _prjTx('readonly', (st, sn) => sn.get(id));
    // Projet jamais rempli : fichier vide au bon nom ; sinon manifeste renommé
    return { ok: true, name: m.name, blob: await _prjRewrite(snap, m.name) };
  });
}
// Copie d'un instantané avec le nom du projet dans le manifeste (entrées reprises telles quelles)
async function _prjRewrite(snap, name) {
  const when = new Date();
  if (!snap) {
    const secs = PRJ_SECTIONS.filter((s) => s !== 'media').concat(['work']);
    const data = {};
    for (const s of secs) data[s] = _prjEmpty(s);
    const man = { format: PRJ_FORMAT, version: PRJ_VERSION, app: APP_VERSION, created: when.toISOString(), name, sections: secs, counts: _prjCounts(data), files: 0 };
    return _prjZipBuild([{ name: 'project.json', bytes: _prjUtf8(JSON.stringify(man)), deflate: true }].concat(secs.map((s) => ({ name: 'data/' + s + '.json', bytes: _prjUtf8(JSON.stringify(data[s])), deflate: true }))), when);
  }
  const z = await _prjZipOpen(snap);
  const man = await _prjZipJson(z, 'project.json', PRJ_LIMITS.manifest);
  const out = [{ name: 'project.json', bytes: _prjUtf8(JSON.stringify(Object.assign({}, man, { name }))), deflate: true }];
  for (const e of z.entries.values()) {
    if (e.name === 'project.json') continue;
    if (e.method === 0 && e.usize > _PRJ_MB) out.push({ name: e.name, blob: await _prjZipBlob(z, e.name, '', e.usize), crc: e.crc });
    else out.push({ name: e.name, bytes: await _prjZipBytes(z, e.name), deflate: e.name.endsWith('.json') });
  }
  return _prjZipBuild(out, when);
}
// Fichier .setremote rangé comme NOUVEAU projet (validé en entier d'abord) ; ne l'ouvre pas
function projectImportAsNew(file, opts = {}) {
  return _prjRun(async () => {
    const p = await _prjOpen(file);
    const metas = await projectsInit();
    if (metas.length >= PRJ_LIMITS.projects) throw _prjErr('quota');
    _prjQuota(metas, file.size);
    const name = _prjUnique(_prjName(opts.name) || p.name, _prjNames(metas), 60);
    const now = Date.now();
    const m = { id: _prjNewPid(), name, created: now, updated: now, size: file.size, counts: p.counts };
    const blob = file.slice(0, file.size, PRJ_MIME);
    await _prjTx('readwrite', (st, sn) => { st.put(m); return sn.put(blob, m.id); });
    return { ok: true, mode: 'new', id: m.id, name, counts: p.counts };
  });
}
// Quelque chose se joue sur les écrans : séquence lancée, discussion ouverte, appel en cours
function projectLiveBusy() {
  try {
    if (typeof _seqRun !== 'undefined' && (_seqRun.state === 'running' || _seqRun.state === 'stopped')) return true;
    if (typeof _chat !== 'undefined' && _chat.open) return true;
    if (typeof scrList === 'function' && scrList().some((id) => scrKnown(id) && scrState(id).call)) return true;
  } catch (_) {}
  return false;
}
const _PRJ_SWITCH = PRJ_SECTIONS.filter((s) => s !== 'media').concat(['work']);
// Ouvre un autre projet : instantané du projet ouvert rangé, puis chargement (sections absentes vidées)
function projectSwitch(id) {
  return _prjRun(async () => {
    if (projectLiveBusy()) throw _prjErr('busy');
    const metas = await projectsInit();
    const target = metas.find((x) => x.id === id);
    if (!target) throw _prjErr('not-found');
    const activeId = projectActiveId();
    if (id === activeId) return { ok: true, id, name: target.name, same: true };
    const cur = metas.find((x) => x.id === activeId);
    const snap = await _prjSnapshot(cur ? cur.name : _PRJ_TXT.firstName);
    _prjQuota(metas, snap.size, activeId);
    const counts = await _prjSnapMeta(snap);
    if (cur) {
      Object.assign(cur, { size: snap.size, counts, updated: Date.now() });
      await _prjTx('readwrite', (st, sn) => { st.put(cur); return sn.put(snap, cur.id); });
    }
    const tsnap = await _prjTx('readonly', (st, sn) => sn.get(id));
    const p = tsnap ? await _prjOpen(tsnap) : { z: null, cache: new Map(), name: target.name, data: {}, sections: [] };
    let report;
    try {
      report = await _prjApply(p, _PRJ_SWITCH, 'replace', true);
    } catch (e) {
      // Échec du chargement : l'espace de travail quitté est rétabli
      try { await _prjApply(await _prjOpen(snap), _PRJ_SWITCH, 'replace', true); } catch (_) {}
      throw e;
    }
    _prjSetActive(id);
    return { ok: true, id, name: target.name, report };
  });
}

// ══════════ Fichiers : enregistrer (télécharger / partager), choisir ══════════
function projectFileName(name) {
  const n = String(name || '').replace(/[\u0000-\u001F\u007F/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return (n || _PRJ_TXT.defaultName) + PRJ_EXT;
}
const _prjNat = { save: new Map(), open: null };
const _prjNatId = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Web : téléchargement « Nom.setremote » ; app : feuille de partage (pont par morceaux)
async function projectSave(blob, name) {
  const file = projectFileName(name);
  if (!IN_NATIVE_APP) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file; a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true, name: file };
  }
  if (blob.size > PRJ_LIMITS.native) return _prjFail(_prjErr('too-large'));
  const id = _prjNatId();
  const CH = PRJ_CHUNK / 4 * 3; // octets par morceau
  const n = Math.max(1, Math.ceil(blob.size / CH));
  const done = new Promise((resolve) => {
    const t = setTimeout(() => { _prjNat.save.delete(id); resolve(_prjFail(_prjErr('timeout'))); }, 10 * 60e3);
    _prjNat.save.set(id, (r) => { clearTimeout(t); resolve(r); });
  });
  for (let i = 0; i < n; i++) {
    const u = await _prjSlice(blob, i * CH, Math.min(blob.size, (i + 1) * CH));
    nativePost({ type: 'project:save', id, name: file, size: blob.size, i, n, data: _prjBytesToB64(u) });
  }
  return done;
}
// Choisir un fichier : web <input type=file>, app : sélecteur de la coque → File | null (annulé)
function projectPick() {
  if (IN_NATIVE_APP) {
    if (_prjNat.open) _prjNat.open.done(null);
    const id = _prjNatId();
    return new Promise((resolve, reject) => {
      _prjNat.open = { id, parts: [], n: 0, size: 0, name: '', done: (f, err) => { _prjNat.open = null; if (err) reject(err); else resolve(f); } };
      nativePost({ type: 'project:open', id });
    });
  }
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = PRJ_EXT + ',application/zip';
    let settled = false;
    const end = (f) => { if (!settled) { settled = true; resolve(f); } };
    inp.addEventListener('change', () => end(inp.files && inp.files[0] ? inp.files[0] : null));
    inp.addEventListener('cancel', () => end(null));
    inp.click();
  });
}
const _PRJ_B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const _PRJ_NAT_REASONS = { 'too-large': 'too-large', unavailable: 'unavailable', cancelled: 'cancelled', 'read-failed': 'read', 'write-failed': 'storage-full', 'share-failed': 'unavailable', 'bad-chunk': 'corrupt' };
// Messages de la coque (00-native-bridge.js) : project:saved, project:file, project:error
function projectOnNative(m) {
  if (!m || typeof m.id !== 'string') return false;
  if (m.type === 'project:saved' || (m.type === 'project:error' && _prjNat.save.has(m.id))) {
    const fn = _prjNat.save.get(m.id);
    if (!fn) return false;
    _prjNat.save.delete(m.id);
    if (m.type === 'project:saved' && m.ok !== false) fn({ ok: true, shared: m.shared === true });
    else fn(_prjFail(_prjErr(_PRJ_NAT_REASONS[m.reason] || 'unavailable')));
    return true;
  }
  const o = _prjNat.open;
  if (!o || o.id !== m.id) return false;
  if (m.type === 'project:error') { o.done(null, _prjErr(_PRJ_NAT_REASONS[m.reason] || 'read')); return true; }
  if (m.type !== 'project:file') return false;
  if (m.cancelled === true) { o.done(null); return true; }
  const maxN = Math.ceil(PRJ_LIMITS.native / (PRJ_CHUNK / 4 * 3)) + 1;
  const ok = Number.isInteger(m.i) && m.i === o.parts.length && Number.isInteger(m.n) && m.n >= 1 && m.n <= maxN && (m.i === 0 || m.n === o.n)
    && typeof m.data === 'string' && m.data.length <= PRJ_CHUNK && (m.i === m.n - 1 || m.data.length % 4 === 0) && _PRJ_B64_RE.test(m.data)
    && Number.isInteger(m.size) && m.size >= 0 && m.size <= PRJ_LIMITS.native;
  if (!ok) { o.done(null, _prjErr(m.size > PRJ_LIMITS.native ? 'too-large' : 'corrupt')); return true; }
  if (m.i === 0) { o.n = m.n; o.size = m.size; o.name = projectFileName(String(m.name || '').replace(/\.setremote$/i, '')); }
  try { o.parts.push(_prjB64ToBytes(m.data)); } catch (_) { o.done(null, _prjErr('corrupt')); return true; }
  if (o.parts.length === o.n) {
    const f = new File(o.parts, o.name, { type: PRJ_MIME });
    if (f.size !== o.size) o.done(null, _prjErr('corrupt')); else o.done(f);
  }
  return true;
}
