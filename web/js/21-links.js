// ══════════════════════════ LIAISONS LOCALES : WI-FI LOCAL ET BLUETOOTH ══════════════════════════
// Maquettes validées 4 (indicateur de liaison), 5 (liaison de chaque écran),
// 10 (tourner sans réseau) et 13 (« Liaison par défaut »). Contrat du pont
// avec la coque native et choix de conception : docs/OFFLINE.md.
//
// Les trames restent celles de la session chiffrée de bout en bout
// (packages/protocol) : la coque ne fait que les porter entre appareils
// proches. Chaque trame part sur TOUTES les liaisons ouvertes (Internet :
// broker MQTT ou relais, 20-mqtt.js / 19-relay.js ; Wi-Fi local ; Bluetooth) ;
// la fenêtre anti-rejeu du canal écarte les doublons à la réception, et les
// trames de toutes les liaisons passent par le même receiveFrame (20-mqtt.js).
//   PWA → coque  link:start { modes, role, room }   ouvre / remplace les liaisons locales
//                link:stop { modes? }               ferme (toutes, ou celles citées)
//                link:send { frames, to? }          trames vers des pairs (to : identifiants de link:peers)
//                link:state?                        demande l'état des liaisons
//   coque → PWA  link:frames { frames: [{ peer, mode, data }] }
//                link:peers { peers: [{ peer, mode, name? }] }   à chaque changement
//                link:state { lan: { available, active, error? }, ble: { … } }
//                link:error { mode, reason }
// Plafonds par trame : 64 Kio en Wi-Fi local, 4 Kio en Bluetooth. Le
// Bluetooth ne porte que des COMMANDES : jamais de média (fragments, envoi
// base64, signalisation WebRTC) ni de trame trop grande, refusées ici avant
// tout envoi (to restreint aux pairs Wi-Fi local, ou rien).
//
// Choix de la liaison (télécommande, mémorisé : setremote-link-v1) :
//   auto      Internet ET liaisons locales disponibles, EN PARALLÈLE (une
//             coupure du Wi-Fi du lieu ou de la 4G passe inaperçue)
//   internet  Internet seul (comportement d'avant)
//   lan, ble  cette liaison locale seule, sans Internet
// Un écran ouvre toujours Internet et toutes les liaisons locales de l'app :
// il suit la télécommande, quel que soit son choix. Hors de l'app native
// (navigateur), aucune liaison locale : tout passe par Internet, comme avant.
const LINK_PREF_KEY = 'setremote-link-v1';
const LINK_PREFS = ['auto', 'internet', 'lan', 'ble'];
const LINK_MODES = ['lan', 'ble'];
const LINK_FRAME_MAX = Object.freeze({ lan: 64 * 1024, ble: 4 * 1024 });
const LINK_RX_BATCH_MAX = 512;   // trames traitées au plus par link:frames
const LINK_PEERS_MAX = 128; // 64 en Wi-Fi local + 8 en Bluetooth au plus, avec de la marge
const LINK_CAPS_BLE_MAX = 2800; // caractères JSON : une annonce « caps » plus longue dépasserait 4 Kio une fois scellée
const LINK_LABELS = Object.freeze({ internet: 'Internet', lan: 'Wi-Fi local', ble: 'Bluetooth', off: 'Hors ligne' });
// Médias et leur signalisation : Internet ou Wi-Fi local seulement
const LINK_MEDIA_TYPES = new Set(['media-img-start', 'media-img-chunk', 'media:upload', 'media:chunk', 'media:play',
  'media:chunkack', 'media:need-chunks', 'rtc-offer', 'rtc-answer', 'rtc-ice']);

// État annoncé par la coque (link:state) ; available null = encore inconnu
const linkNative = { lan: { available: null, active: false, error: null }, ble: { available: null, active: false, error: null } };
const _linkPeers = new Map();      // 'mode:peer' → { key, peer, mode, name }
const _linkPeerScreen = new Map(); // télécommande : 'mode:peer' → screenId (appris des trames authentifiées)
let _linkStarted = null;           // dernier link:start : { key, modes, role, room } (null : liaisons fermées)
let _linkStateAsked = false;

// ── Choix de la liaison ──
function linkPref() {
  let p = null;
  try { const o = JSON.parse(_lsGet(LINK_PREF_KEY)); p = o && o.mode; } catch (_) {}
  return LINK_PREFS.includes(p) ? p : 'auto';
}
// Liaison locale utilisable : app native, et pas déclarée indisponible par la coque
function linkModeUsable(m) { return IN_NATIVE_APP && LINK_MODES.includes(m) && linkNative[m].available !== false; }
// Choisissable seule : la coque l'a déclarée disponible (une coque sans
// liaisons locales ne répond jamais : le choix reste impossible)
function linkModeSelectable(m) { return IN_NATIVE_APP && LINK_MODES.includes(m) && linkNative[m].available === true; }
function setLinkPref(p) {
  if (!LINK_PREFS.includes(p)) return false;
  if ((p === 'lan' || p === 'ble') && !linkModeSelectable(p)) return false; // navigateur, ou liaison indisponible
  _lsSet(LINK_PREF_KEY, JSON.stringify({ v: 1, mode: p }));
  linkApplyPref();
  return true;
}
// Libellé du choix (Réglages, vue « Tourner sans réseau »)
function linkPrefLabel(p) { return p === 'auto' ? 'Auto' : LINK_LABELS[p === 'internet' ? 'internet' : p]; }

// Liaisons locales voulues dans le rôle courant
function linkModesWanted() {
  if (!IN_NATIVE_APP || (mode !== 'remote' && mode !== 'screen')) return [];
  const usable = LINK_MODES.filter(linkModeUsable);
  if (mode === 'screen') return usable;
  const p = linkPref();
  if (p === 'internet') return [];
  if (p === 'lan' || p === 'ble') return usable.includes(p) ? [p] : [];
  return usable;
}
// Internet (broker / relais) voulu ? Toujours, sauf télécommande réglée sur une
// liaison locale seule QUE LA COQUE A DÉCLARÉE DISPONIBLE : tant qu'elle ne l'a
// pas fait (coque d'avant ces liaisons, Bluetooth coupé…), Internet reste
// ouvert, plutôt qu'une télécommande reliée à rien
function linkInternetWanted() {
  if (mode !== 'remote' || !IN_NATIVE_APP) return true;
  const p = linkPref();
  return !((p === 'lan' || p === 'ble') && linkNative[p].available === true);
}

// ── Pairs ──
function linkPeerCount(m) {
  if (!m) return _linkPeers.size;
  let n = 0;
  for (const p of _linkPeers.values()) if (p.mode === m) n++;
  return n;
}
// Session joignable par au moins une liaison (Internet ou un pair local)
function sessionLinkUp() { return !!(mqttClient && mqttClient.connected) || _linkPeers.size > 0; }
// Liaison capable de porter un média : Internet ou Wi-Fi local
function mediaLinkUp() { return !!(mqttClient && mqttClient.connected) || linkPeerCount('lan') > 0; }
// Seul le Bluetooth relie encore les appareils : commandes seulement
function linkBleOnly() { return linkPeerCount('ble') > 0 && !mediaLinkUp(); }

// (Re)démarre ou arrête les liaisons locales de la session courante.
// La salle (room) est le topic opaque de la session (22 caractères, dérivé du
// secret) : après un retrait d'écran (29-revoke.js), la nouvelle session est
// annoncée à la coque par un nouveau link:start.
function linkSync() {
  if (!IN_NATIVE_APP) return;
  if (!_linkStateAsked) { _linkStateAsked = true; nativePost({ type: 'link:state?' }); }
  const want = _sec ? linkModesWanted() : [];
  if (!want.length) { linkStop(); return; }
  const room = _sec.topic;
  const key = JSON.stringify([want, mode, room]);
  if (_linkStarted && _linkStarted.key === key) return;
  if (_linkStarted && _linkStarted.room !== room) linkClearPeers(); // nouvelle salle : pairs à redécouvrir
  else for (const [k, p] of [..._linkPeers]) if (!want.includes(p.mode)) _linkPeers.delete(k);
  _linkStarted = { key, modes: want.slice(), role: mode, room };
  nativePost({ type: 'link:start', modes: want.slice(), role: mode, room });
}
function linkStop() {
  if (_linkStarted) { _linkStarted = null; nativePost({ type: 'link:stop' }); }
  linkClearPeers();
}
function linkClearPeers() { _linkPeers.clear(); _linkPeerScreen.clear(); }

// Choix changé : liaisons locales et Internet ajustés sans quitter la session
function linkApplyPref() {
  if (_sec && (mode === 'remote' || mode === 'screen')) {
    const want = linkInternetWanted();
    if (want && !mqttClient) internetConnect(_sec);
    else if (!want && mqttClient) { internetDisconnect(); if (mode === 'remote') setConnStatus('connecting'); }
    linkSync();
    if (mode === 'remote') renderLinkStatus();
  }
  linkChanged();
}

// ── Coque → PWA ──
function linkOnState(m) {
  if (!m || typeof m !== 'object') return false;
  for (const k of LINK_MODES) {
    const s = m[k];
    if (!s || typeof s !== 'object') continue;
    linkNative[k] = {
      available: typeof s.available === 'boolean' ? s.available : linkNative[k].available,
      active: s.active === true,
      error: typeof s.error === 'string' && s.error ? s.error.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 120) : null,
    };
  }
  linkApplyPref(); // disponibilités connues : liaisons locales et Internet ajustés
  return true;
}
function linkOnError(m, reason) {
  if (!LINK_MODES.includes(m)) return false;
  linkNative[m].error = typeof reason === 'string' && reason ? reason.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 120) : 'erreur';
  linkChanged();
  return true;
}
const _LINK_PEER_RE = /^[\x21-\x7E]{1,128}$/;
function linkOnPeers(list) {
  if (!Array.isArray(list)) return false;
  const wasUp = sessionLinkUp();
  const before = new Set(_linkPeers.keys());
  _linkPeers.clear();
  if (_linkStarted) {
    for (const p of list.slice(0, LINK_PEERS_MAX)) {
      if (!p || typeof p !== 'object' || typeof p.peer !== 'string' || !_LINK_PEER_RE.test(p.peer)) continue;
      if (!LINK_MODES.includes(p.mode) || !_linkStarted.modes.includes(p.mode)) continue;
      const key = p.mode + ':' + p.peer;
      _linkPeers.set(key, { key, peer: p.peer, mode: p.mode, name: typeof p.name === 'string' ? p.name.slice(0, 40) : '' });
    }
  }
  for (const k of [..._linkPeerScreen.keys()]) if (!_linkPeers.has(k)) _linkPeerScreen.delete(k);
  const added = [..._linkPeers.keys()].filter((k) => !before.has(k));
  linkPeersChanged(added, wasUp);
  return true;
}
function linkOnFrames(frames) {
  if (!Array.isArray(frames)) return false;
  for (const f of frames.slice(0, LINK_RX_BATCH_MAX)) {
    if (!f || typeof f !== 'object' || !LINK_MODES.includes(f.mode) || typeof f.data !== 'string') continue;
    if (!f.data || f.data.length > LINK_FRAME_MAX[f.mode]) continue; // au-delà du plafond de la liaison : ignorée
    const peer = typeof f.peer === 'string' && _LINK_PEER_RE.test(f.peer) ? f.peer : null;
    if (_sec) receiveFrame(_sec, f.data, f.mode, peer);
  }
  return true;
}

// Pairs apparus ou disparus : comme une (re)connexion du transport Internet
function linkPeersChanged(added, wasUp) {
  const up = sessionLinkUp();
  if (_sec && mode === 'remote') {
    if (added.length) {
      if (!wasUp) remoteLinkGrace(); // retour de la liaison : délai de grâce des écrans
      _linkEverConnected = true;
      // Les écrans joints s'annoncent (caps) : resynchronisation de chacun
      linkSendLocal({ type: 'hello' }, added);
    }
    renderLinkStatus();
  } else if (_sec && mode === 'screen') {
    if (up && !wasUp) screenOnSessionConnected();
    else if (!up && wasUp) { setScreenStatus('Connexion…'); stopScreenAlive(); }
  }
  linkChanged();
}

// ── Envoi ──
// Pairs locaux d'écrans (télécommande) ; null si l'un d'eux n'a pas encore de pair connu
function linkPeersOfScreens(ids) {
  const out = [];
  for (const id of ids) {
    let found = false;
    for (const [k, sid] of _linkPeerScreen) if (sid === id && _linkPeers.has(k)) { out.push(_linkPeers.get(k)); found = true; }
    if (!found) return null;
  }
  return out;
}
// Trame scellée vers les liaisons locales. type : type du message (médias :
// jamais en Bluetooth) ; target : adresse de l'ordre (télécommande : pairs des
// écrans visés) ; only : clés de pairs imposées. true si la coque l'a reçue.
function linkTransmit(frame, type, target, only) {
  if (!_linkPeers.size || typeof frame !== 'string') return false;
  const bleOk = !LINK_MEDIA_TYPES.has(type) && frame.length <= LINK_FRAME_MAX.ble;
  const lanOk = frame.length <= LINK_FRAME_MAX.lan;
  let peers = [..._linkPeers.values()];
  if (only) peers = peers.filter((p) => only.includes(p.key));
  else if (mode === 'remote' && target && Array.isArray(target.screens)) {
    const sel = linkPeersOfScreens(target.screens);
    if (sel) peers = sel;
  }
  // Un même identifiant annoncé sur deux liaisons serait ambigu pour la coque :
  // jamais de trame interdite au Bluetooth vers lui (contrat : identifiants
  // distincts par liaison, docs/OFFLINE.md)
  const bleIds = new Set([..._linkPeers.values()].filter((p) => p.mode === 'ble').map((p) => p.peer));
  peers = peers.filter((p) => (p.mode === 'ble' ? bleOk : lanOk && (bleOk || !bleIds.has(p.peer))));
  if (!peers.length) return false;
  const to = [...new Set(peers.map((p) => p.peer))];
  // Sans « to », la coque enverrait aussi aux pairs apparus entre-temps :
  // seulement pour une trame que toutes les liaisons acceptent, vers tous les pairs
  const all = !only && bleOk && lanOk && peers.length === _linkPeers.size;
  nativePost(all ? { type: 'link:send', frames: [frame] } : { type: 'link:send', frames: [frame], to });
  return true;
}
// Message scellé envoyé aux seuls pairs locaux donnés (hello à un écran qui apparaît)
function linkSendLocal(obj, keys) {
  if (!_sec || !keys || !keys.length) return;
  let msg;
  try { msg = prepareOutgoing(obj); } catch (_) { return; }
  const ch = _sec;
  _txChain = _txChain.then(async () => {
    if (ch !== _sec) return;
    let frame;
    try { frame = await ch.seal(msg); } catch (_) { return; }
    if (linkTransmit(frame, msg.type, null, keys)) secStats.sent++;
  });
}

// ── Télécommande : liaison de chaque écran (maquettes 4 et 5) ──
// Chaque trame authentifiée d'un écran note la liaison qui l'a portée (y
// compris un doublon arrivé par une autre liaison) ; un écran émet un signe de
// vie toutes les 15 s sur toutes ses liaisons. Liaison affichée : Internet si
// elle le relie, sinon Wi-Fi local, sinon Bluetooth.
function linkNoteVia(sc, via, peer, id) {
  const k = via === 'bc' || !via ? 'mqtt' : via;
  if (!sc.via) sc.via = {};
  sc.via[k] = Date.now();
  if (peer && LINK_MODES.includes(via) && SRP.SCREEN_ID_RE.test(id)) {
    const key = via + ':' + peer;
    if (_linkPeerScreen.has(key) || _linkPeerScreen.size < LINK_PEERS_MAX * 2) _linkPeerScreen.set(key, id);
  }
}
function linkForgetScreen(id) { for (const [k, s] of [..._linkPeerScreen]) if (s === id) _linkPeerScreen.delete(k); }
// 'internet' | 'lan' | 'ble' | 'off'
function scrLinkOf(id, now = Date.now()) {
  const sc = _pairedScreens.get(id);
  if (!sc) return 'off';
  if (remoteLinkUp() && now - sc.lastSeen > SCREEN_OFFLINE_MS) return 'off';
  const v = sc.via;
  if (!v) return 'internet'; // noté sans détail de transport
  const fresh = (k) => now - (v[k] || 0) <= SCREEN_OFFLINE_MS;
  if (fresh('mqtt') && _linkState === 'connected') return 'internet';
  if (fresh('lan') && linkPeerCount('lan')) return 'lan';
  if (fresh('ble') && linkPeerCount('ble')) return 'ble';
  return fresh('lan') ? 'lan' : fresh('ble') ? 'ble' : 'internet';
}
// Un écran peut-il recevoir un média (préparation) ?
function scrMediaReachable(id) { const l = scrLinkOf(id); return l === 'internet' || l === 'lan'; }

// Rafraîchit ce qui montre les liaisons (vue « Tourner sans réseau », Réglages)
function linkChanged() {
  if (typeof renderOfflineView === 'function') renderOfflineView();
  if (typeof renderSettingsLink === 'function') renderSettingsLink();
}
