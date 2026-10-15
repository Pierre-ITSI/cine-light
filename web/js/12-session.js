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

// Écran : dernière session rejointe (QR ou code)
function screenStoredSession() { return _readPairing(_LS_KEYS.screen); }
function screenSaveSession(p) { _writePairing(_LS_KEYS.screen, p); }

// Écran : identifiant stable, annoncé dans « caps »
function screenId() {
  let id = _lsGet(_LS_KEYS.screenId);
  if (!(typeof id === 'string' && SRP.SCREEN_ID_RE.test(id))) { id = SRP.createScreenId(); _lsSet(_LS_KEYS.screenId, id); }
  return id;
}

// Adresse de l'app sans fragment (base du lien d'appairage)
function pairingBaseUrl() { return location.href.split('#')[0]; }
function pairingLink(p) { return SRP.pairingUrl(pairingBaseUrl(), p); }

// Efface le fragment de la barre d'adresse (et de l'historique courant)
function clearLocationHash() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}
