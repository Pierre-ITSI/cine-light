// ══════════════════════════ SESSION CHIFFRÉE ══════════════════════════
// Une télécommande possède UN secret de session { channelId (128 bits),
// key (256 bits) } partagé par tous ses écrans (packages/protocol, globale
// SRP). Il est conservé (localStorage) jusqu'à « Nouvelle session », qui
// révoque tous les écrans. Chaque écran conserve la dernière session rejointe
// et un identifiant stable (screenId) tiré à son premier lancement.
// Le secret n'apparaît que dans le FRAGMENT de l'URL d'appairage
// (#p=v1.<channelId>.<key>) : jamais envoyé au serveur, effacé de la barre
// d'adresse dès sa lecture.
const _LS_KEYS = {
  remote: 'setremote-session-v1',        // secret de la télécommande
  screen: 'setremote-screen-session-v1', // dernière session rejointe par cet écran
  screenId: 'setremote-screen-id',
  screenConfig: 'setremote-screen-config-v1', // nom et groupes de cet écran (screen:config), par session
  remoteId: 'setremote-remote-id',            // identifiant stable de la télécommande (clés par écran)
  screenPairwise: 'setremote-screen-pairwise-v1', // écran : sa clé par écran avec la télécommande (29-revoke.js)
};
let _session = null; // secret de la session active (télécommande ou écran)

function _lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function _lsSet(k, v) {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {}
}
function _readPairing(k) {
  try {
    const p = JSON.parse(_lsGet(k));
    return SRP.isValidPairing(p) ? { channelId: p.channelId, key: p.key } : null;
  } catch (_) { return null; }
}
function _writePairing(k, p) { _lsSet(k, p ? JSON.stringify({ channelId: p.channelId, key: p.key }) : null); }

// Télécommande : la session persistée, ou une nouvelle au premier lancement
function remoteSession() {
  let p = _readPairing(_LS_KEYS.remote);
  if (!p) { p = SRP.createPairing(); _writePairing(_LS_KEYS.remote, p); }
  return p;
}
// « Nouvelle session » : nouveau secret, tous les écrans devront rescanner
function renewRemoteSession() {
  const p = SRP.createPairing();
  _writePairing(_LS_KEYS.remote, p);
  return p;
}
// Retrait d'un écran : la nouvelle session (déjà remise aux autres écrans) devient celle de la télécommande
function saveRemoteSession(p) { _writePairing(_LS_KEYS.remote, p); }

// Télécommande : identifiant stable (lié aux clés par écran, pairwise.js)
function remoteId() {
  let id = _lsGet(_LS_KEYS.remoteId);
  if (!(typeof id === 'string' && SRP.SCREEN_ID_RE.test(id))) { id = SRP.createRemoteId(); _lsSet(_LS_KEYS.remoteId, id); }
  return id;
}

// Écran : clé par écran avec la télécommande { rid, s (secret), kid, ch (session) }.
// Valable pour la lignée de sessions où elle a été établie (suivie au fil des
// session:rekey) ; rejoindre une AUTRE session (QR, code) l'efface.
function screenStoredPairwise() {
  try {
    const o = JSON.parse(_lsGet(_LS_KEYS.screenPairwise));
    if (!o || typeof o !== 'object' || !SRP.SCREEN_ID_RE.test(o.rid) || !SRP.PAIRWISE_SECRET_RE.test(o.s)
      || !SRP.KEY_ID_RE.test(o.kid) || typeof o.ch !== 'string') return null;
    return { rid: o.rid, s: o.s, kid: o.kid, ch: o.ch };
  } catch (_) { return null; }
}
function screenSavePairwise(r) {
  _lsSet(_LS_KEYS.screenPairwise, r ? JSON.stringify({ rid: r.rid, s: r.s, kid: r.kid, ch: r.ch }) : null);
}

// Écran : dernière session rejointe (QR ou code)
function screenStoredSession() { return _readPairing(_LS_KEYS.screen); }
function screenSaveSession(p) { _writePairing(_LS_KEYS.screen, p); }

// Écran : nom et groupes donnés par la télécommande (screen:config), gardés
// pour la session rejointe (une autre session repart sans nom ni groupe)
function screenStoredConfig(p) {
  try {
    const o = JSON.parse(_lsGet(_LS_KEYS.screenConfig));
    if (!o || typeof o !== 'object' || !p || o.channelId !== p.channelId) return { name: '', groups: [] };
    return {
      name: typeof o.name === 'string' ? o.name.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 40) : '',
      groups: Array.isArray(o.groups) ? o.groups.filter((g, i, a) => typeof g === 'string' && SRP.GROUP_ID_RE.test(g) && a.indexOf(g) === i).slice(0, 16) : [],
    };
  } catch (_) { return { name: '', groups: [] }; }
}
function screenSaveConfig(p, cfg) {
  _lsSet(_LS_KEYS.screenConfig, JSON.stringify({ channelId: p.channelId, name: cfg.name, groups: cfg.groups }));
}

// Écran : identifiant stable, annoncé dans « caps »
function screenId() {
  let id = _lsGet(_LS_KEYS.screenId);
  if (!(typeof id === 'string' && SRP.SCREEN_ID_RE.test(id))) { id = SRP.createScreenId(); _lsSet(_LS_KEYS.screenId, id); }
  return id;
}

// Adresse PUBLIQUE de l'app, base du lien d'appairage ouvert par les AUTRES
// appareils. Dans l'app native, la page tourne en file:// : l'adresse vient
// de la coque (window.SETREMOTE_NATIVE.publicUrl), jamais de location. Hors de
// l'app, location n'est utilisable qu'en http(s). Sinon : null (pas de QR ;
// l'appairage par code reste possible).
function pairingBaseUrl() {
  const n = window.SETREMOTE_NATIVE;
  const pub = n && typeof n.publicUrl === 'string' ? n.publicUrl.trim() : '';
  if (/^https?:\/\/[^\s#]+$/i.test(pub)) return pub;
  if (location.protocol === 'https:' || location.protocol === 'http:') return location.origin + location.pathname;
  return null;
}
function pairingLink(p) {
  const base = pairingBaseUrl();
  return base ? SRP.pairingUrl(base, p) : null;
}

// Efface le fragment de la barre d'adresse (et de l'historique courant)
function clearLocationHash() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}
