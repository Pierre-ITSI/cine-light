// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ MQTT + CHIFFREMENT DE BOUT EN BOUT ══════════════════════════
// Tout ce qui passe par le relais est scellé (SRP.createSecureChannel) :
// commandes, fragments d'images / sons / vidéo, signalisation WebRTC (SDP,
// ICE). Topic opaque dérivé du secret ; le relais ne voit ni le contenu ni le
// type des messages. Toute trame qui ne s'ouvre pas (falsifiée, rejouée, hors
// délai, non chiffrée, hors schéma) est ignorée.
const BROKER = 'wss://broker.hivemq.com:8884/mqtt';

let _sec = null;      // canal chiffré de la session (MQTT)
let _secBc = null;    // 2e étiquette d'émetteur pour le repli BroadcastChannel
let _connectSeq = 0;  // connexion la plus récente (les plus anciennes s'abandonnent)
let _rxChain = Promise.resolve(), _txChain = Promise.resolve();
let _secRecvKey = null; // clé du sens de réception : authentifie les trames « périmées »
// Compteurs (diagnostic et tests) : trames envoyées, reçues, rejetées ;
// duplicates : trames déjà reçues (doublon arrivé par une autre liaison, ou rejeu)
const secStats = { sent: 0, received: 0, dropped: 0, refused: 0, duplicates: 0, lastError: null };
let _onSessionUp = null; // rappel de (re)connexion de la session courante

function _newClientId(prefix) { return prefix + '-' + mode + '-' + Math.random().toString(36).slice(2, 8); }

// Connexion à la session chiffrée « pairing ». onConnected est rappelé à la
// 1re connexion ET à chaque reconnexion automatique : la télécommande renvoie
// alors son état (hello → caps → resynchronisation), l'écran ses capacités.
// Transports : Internet (internetConnect, broker ou relais) et liaisons
// locales de l'app native (21-links.js), ouvertes selon le choix de liaison.
async function connectSession(pairing, onConnected) {
  if (mqttClient) { mqttClient.end(true); mqttClient = null; }
  _sec = null;
  const seq = ++_connectSeq;
  let ch, bc = null, recvKey = null;
  try {
    const opts = { pairing, role: mode };
    // Écran : ordres adressés à d'autres écrans ignorés (target, 28-screens.js)
    if (mode === 'screen') { opts.screenId = screenId(); opts.groups = _screenCfg.groups; }
    ch = await SRP.createSecureChannel(opts);
    if (mode === 'remote') bc = await SRP.createSecureChannel(opts);
    const { keys } = await SRP.deriveSession(pairing);
    recvKey = mode === 'remote' ? keys.s2r : keys.r2s;
  } catch (e) {
    console.warn('SetRemote : session chiffrée indisponible', e);
    if (mode === 'remote') setConnStatus('error');
    return;
  }
  if (seq !== _connectSeq || !mode) return; // remplacée entre-temps (retour, nouvelle session)
  _sec = ch; _secBc = bc; _secRecvKey = recvKey;
  _rxChain = Promise.resolve(); _txChain = Promise.resolve();
  _onSessionUp = onConnected;
  _rxLastSeq.clear(); _dupSeen.clear();
  resetClockSkew();
  initBCFallback(ch);
  linkSync(); // Wi-Fi local / Bluetooth : salle = topic de CETTE session (21-links.js)
  if (linkInternetWanted()) internetConnect(ch);
}

// Transport Internet de la session : broker public, ou relais privé si
// RELAY_URL est configuré (19-relay.js)
function internetConnect(ch) {
  const onConnected = _onSessionUp;
  const client = transportConnect(ch.mqttTopic, ch.relayAuth, {
    clientId: _newClientId('cl'),
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 3000,
    // mqtt.js réabonne seul les topics à la reconnexion (resubscribe, défaut) ;
    // l'abonnement explicite ci-dessous à chaque « connect » le garantit aussi.
  });
  mqttClient = client;
  // Évènements d'un client remplacé ou fermé volontairement : ignorés
  const isCurrent = () => client === mqttClient && !client.disconnecting;

  client.on('connect', () => {
    if (!isCurrent()) return;
    client.subscribe(ch.mqttTopic, { qos: 0 }, () => {
      if (isCurrent() && onConnected) onConnected();
    });
  });

  client.on('error', err => {
    if (!isCurrent()) return;
    console.warn('MQTT error', err);
    if (mode === 'remote') setConnStatus('error');
    else setScreenStatus('Erreur broker — rechargez');
  });

  // Coupure / hors-ligne / nouvelle tentative : mqtt.js se reconnecte seul
  // (reconnectPeriod). On le reflète dans l'indicateur de liaison. Écran
  // encore relié par une liaison locale : il reste en écoute (signes de vie).
  const onLost = () => {
    if (!isCurrent()) return;
    if (mode === 'remote') setConnStatus('connecting');
    else if (mode === 'screen' && !_linkPeers.size) { setScreenStatus('Connexion…'); stopScreenAlive(); }
  };
  client.on('close', onLost);
  client.on('offline', onLost);
  client.on('reconnect', onLost);

  client.on('message', (topic, payload) => {
    if (topic !== ch.mqttTopic) return;
    receiveFrame(ch, String(payload), 'mqtt');
  });
}
// Internet fermé volontairement (liaison locale seule choisie)
function internetDisconnect() {
  const c = mqttClient;
  mqttClient = null;
  if (c) { try { c.end(true); } catch (_) {} }
}

// Réception : les trames sont ouvertes UNE PAR UNE, dans l'ordre d'arrivée
// (le déchiffrement est asynchrone ; l'ordre compte : début de transfert avant
// ses fragments, dernière couleur gagnante…).
const _BC_TYPES = ['color', 'strobe']; // seuls types acceptés du repli même appareil
// Télécommande : écran (screenId) qui a émis le message en cours de traitement,
// d'après son étiquette d'émetteur authentifiée (rattachée par « caps ») ;
// null si inconnu. Lu par les gestionnaires (réponse WebRTC, accusés, lecture…).
let _rxFrom = null;
// via : 'mqtt' (Internet), 'bc' (même appareil), 'lan' / 'ble' (liaisons
// locales, 21-links.js) ; peer : pair local qui l'a portée
function receiveFrame(ch, str, via, peer) {
  _rxChain = _rxChain.then(async () => {
    if (ch !== _sec) return;
    let r;
    // Trames scellées avec une clé PAR ÉCRAN (29-revoke.js) : télécommande, la
    // clé de l'écran émetteur ; écran, la sienne (et celle d'un échange en cours)
    try { r = await ch.receive(str, { pairwise: mode === 'remote' ? remotePairwiseCandidates : screenPairwiseCandidates }); }
    catch (e) {
      secStats.dropped++; secStats.lastError = (e && e.code) || 'error';
      if (secStats.lastError === 'stale') await noteStaleFrame(ch, str);
      // Même trame déjà reçue par une autre liaison : écartée par la fenêtre
      // anti-rejeu, elle prouve tout de même que cette liaison fonctionne
      else if (secStats.lastError === 'replay') { secStats.duplicates++; await noteDuplicateFrame(ch, str, via, peer); }
      return;
    }
    if (r) noteFreshFrame(r.sender);
    if (r && r.kind === 'pairwise' && ch === _sec && via !== 'bc') {
      secStats.received++;
      if (mode === 'remote') remoteOnPairwise(r.tag, r.message);
      else screenOnPairwise(r.message, r.tag);
      return;
    }
    if (!r || r.kind !== 'message' || ch !== _sec) return; // écho, autre écran, fragment binaire
    if (via === 'bc' && !_BC_TYPES.includes(r.message.type)) return;
    if (mode === 'remote') remoteNoteScreen(r.sender, r.message, via, peer);
    // Plusieurs liaisons : une trame plus ancienne qu'une trame du même type
    // déjà appliquée (doublée par une liaison plus rapide) n'écrase pas l'état
    if (!_rxInOrder(str, r.sender, r.message.type)) { secStats.dropped++; secStats.lastError = 'order'; return; }
    secStats.received++;
    if (mode === 'remote') _rxFrom = _screenOfSender.get(r.sender) || null;
    try { dispatchMessage(r.message); } catch (e) { console.warn('SetRemote : message', r.message.type, e); }
    finally { _rxFrom = null; }
  });
  return _rxChain;
}

// ── Ordre entre liaisons ──
// Chaque liaison livre dans l'ordre ; deux liaisons peuvent se doubler (une
// trame perdue par l'une, rattrapée plus tard par l'autre). Pour les états où
// « le dernier gagne », la trame d'un numéro de séquence inférieur au dernier
// appliqué (même émetteur, même type) est ignorée.
const _RX_LATEST_WINS = new Set(['color', 'strobe', 'effect', 'blackout', 'screen:brightness', 'torch-onoff', 'torch-dim',
  'torch-effect', 'media:autoadvance', 'media:endmode', 'dmx:look', 'media-progress', 'call:state', 'chat:progress']);
const _rxLastSeq = new Map(); // 'émetteur|type' → séquence appliquée
function _rxInOrder(str, sender, type) {
  if (!_RX_LATEST_WINS.has(type)) return true;
  let seq;
  try { seq = SRP.peekFrame(str).seq; } catch (_) { return true; }
  const k = sender + '|' + type;
  const last = _rxLastSeq.get(k);
  if (last !== undefined && seq < last) return false;
  if (last === undefined && _rxLastSeq.size >= 512) _rxLastSeq.delete(_rxLastSeq.keys().next().value);
  _rxLastSeq.set(k, seq);
  return true;
}

// ── Doublons d'une autre liaison ──
// Télécommande : la liaison qui a porté le doublon est notée pour l'écran
// émetteur (liaison affichée, 21-links.js), après authentification (sans
// toucher à la fenêtre anti-rejeu), au plus toutes les 2 s par liaison.
const _dupSeen = new Map(); // 'émetteur|liaison|pair' → dernière authentification
async function noteDuplicateFrame(ch, str, via, peer) {
  if (mode !== 'remote' || !_secRecvKey || ch !== _sec || !via || via === 'bc') return;
  let h;
  try { h = SRP.peekFrame(str); } catch (_) { return; }
  if (h.kind === SRP.FRAME_KIND.PAIRWISE) return;
  const k = h.sender + '|' + via + '|' + (peer || '');
  const now = Date.now();
  if (now - (_dupSeen.get(k) || 0) < 2000) return;
  try {
    if (h.kind === SRP.FRAME_KIND.CHUNK) await SRP.openChunk(str, _secRecvKey, null);
    else await SRP.open(str, _secRecvKey, null);
  } catch (_) { return; } // non authentique : ignorée
  if (ch !== _sec) return;
  if (!_dupSeen.has(k) && _dupSeen.size >= 256) _dupSeen.delete(_dupSeen.keys().next().value);
  _dupSeen.set(k, now);
  remoteNoteVia(h.sender, via, peer);
}

// ── Horloge décalée ──
// Un appareil dont l'horloge dérive de plus de 5 min (tolérance anti-rejeu)
// ignore toutes les trames de ses pairs. Plusieurs trames AUTHENTIQUES
// d'affilée refusées comme périmées pour un même émetteur révèlent ce
// décalage (une trame forgée avec une vieille date ne compte pas : elle doit
// d'abord s'authentifier). Signalé dans la pastille de liaison.
const STALE_RUN_ALERT = 3;
const _staleRuns = new Map(); // émetteur → trames authentiques périmées d'affilée
let clockSkewed = false;
async function noteStaleFrame(ch, str) {
  if (!_secRecvKey || ch !== _sec) return;
  let h;
  try {
    h = SRP.peekFrame(str);
    if (h.kind === SRP.FRAME_KIND.CHUNK) await SRP.openChunk(str, _secRecvKey, null);
    else await SRP.open(str, _secRecvKey, null);
  } catch (_) { return; } // non authentique : ignorée
  if (ch !== _sec) return;
  if (!_staleRuns.has(h.sender) && _staleRuns.size >= 64) _staleRuns.delete(_staleRuns.keys().next().value);
  const n = (_staleRuns.get(h.sender) || 0) + 1;
  _staleRuns.set(h.sender, n);
  if (n >= STALE_RUN_ALERT) setClockSkewed(true);
}
function noteFreshFrame(sender) {
  if (!_staleRuns.delete(sender) || !clockSkewed) return;
  for (const n of _staleRuns.values()) if (n >= STALE_RUN_ALERT) return;
  setClockSkewed(false);
}
function resetClockSkew() { _staleRuns.clear(); setClockSkewed(false); }
function setClockSkewed(on) {
  if (clockSkewed === on) return;
  clockSkewed = on;
  if (mode === 'remote') renderLinkStatus();
}

// Envoi : forme « fil » (JSON), valeurs bornées aux plages du schéma, puis
// scellement et publication DANS L'ORDRE des appels.
// Télécommande : l'ordre part vers la cible courante (target, 28-screens.js)
// et l'état attendu des écrans visés est noté, même hors ligne (la
// resynchronisation le leur renverra).
function sendMsg(obj) {
  if (mode === 'remote') {
    if (_scrMute) return; // rechargement de l'affichage (changement de cible) : rien ne part
    obj = scrAddress(obj);
    if (!obj) return;     // cible vide
    scrTrack(obj);
  }
  if (!_sec || !sessionLinkUp()) return;
  let msg;
  try { msg = prepareOutgoing(obj); } catch (_) { return; }
  // Seul le Bluetooth relie encore les appareils : un média ne partirait nulle part
  if (LINK_MEDIA_TYPES.has(msg.type) && !mediaLinkUp()) return;
  const ch = _sec, client = mqttClient;
  const bc = (mode === 'remote' && window._bc && _secBc && _BC_TYPES.includes(msg.type)) ? _secBc : null;
  _txChain = _txChain.then(async () => {
    if (ch !== _sec) return;
    let frame;
    try { frame = await ch.seal(msg); }
    catch (e) {
      // Hors schéma malgré le bornage : à corriger côté émetteur, pas à avaler
      secStats.refused++; secStats.lastError = (e && e.code) || 'error';
      console.warn('SetRemote : message refusé à l\'envoi', msg.type, e && e.message);
      return;
    }
    if (_transmit(ch, client, frame, msg)) secStats.sent++;
    if (bc && window._bc) { try { window._bc.postMessage(await bc.seal(msg)); } catch (_) {} }
  });
}

// Une trame scellée part sur TOUTES les liaisons ouvertes : Internet, puis
// Wi-Fi local / Bluetooth (21-links.js). true si au moins une l'a prise.
function _transmit(ch, client, frame, msg) {
  let out = false;
  if (client && client === mqttClient && client.connected) { client.publish(ch.mqttTopic, frame, { qos: 0 }); out = true; }
  if (_linkPeers.size && linkTransmit(frame, msg && msg.type, msg && msg.target)) out = true;
  return out;
}

// Message scellé avec une clé PAR ÉCRAN (pairwise.js, 29-revoke.js), publié
// sur la session en cours dans l'ordre des envois. Résolu une fois publié.
function sendPairwise(obj, keys) {
  if (!_sec || !sessionLinkUp() || !keys) return Promise.resolve();
  const ch = _sec, client = mqttClient;
  _txChain = _txChain.then(async () => {
    if (ch !== _sec) return;
    let frame;
    try { frame = await ch.sealPairwise(JSON.parse(JSON.stringify(obj)), keys); }
    catch (e) { secStats.refused++; secStats.lastError = (e && e.code) || 'error'; console.warn('SetRemote : message refusé à l\'envoi', obj && obj.type, e && e.message); return; }
    // Adressé à un écran (sid) : ses pairs locaux s'ils sont connus
    const target = mode === 'remote' && obj && typeof obj.sid === 'string' ? { screens: [obj.sid] } : null;
    if (_transmit(ch, client, frame, { type: obj && obj.type, target })) secStats.sent++;
  });
  return _txChain;
}

// Copie JSON (toJSON des objets WebRTC, undefined retirés, NaN/Infinity → null)
// puis bornage aux plages du schéma (22-protocol.js)
function prepareOutgoing(obj) {
  const m = JSON.parse(JSON.stringify(obj));
  if (m && typeof m === 'object') delete m._id;
  clampOutgoing(m);
  return m;
}

// Repli BroadcastChannel (même navigateur, même appareil) : il transporte les
// mêmes trames chiffrées (couleur et strobe), sous une étiquette d'émetteur
// distincte pour ne pas perturber la fenêtre anti-rejeu du flux MQTT.
function initBCFallback(ch) {
  // BroadcastChannel absent sur iOS < 15.4 : sans garde, l'exception
  // interrompait l'entrée en mode écran avant même la connexion MQTT.
  if (window._bc) { try { window._bc.close(); } catch (_) {} window._bc = null; }
  if (typeof BroadcastChannel === 'undefined') return;
  const bc = new BroadcastChannel('setremote_' + ch.topic);
  window._bc = bc;
  if (mode === 'screen') bc.onmessage = e => { if (typeof e.data === 'string') receiveFrame(ch, e.data, 'bc'); };
}

// Ferme la session (client MQTT, repli, files d'attente)
function closeSession() {
  _connectSeq++;
  if (mqttClient) { try { mqttClient.end(true); } catch (_) {} mqttClient = null; }
  if (window._bc) { try { window._bc.close(); } catch (_) {} window._bc = null; }
  _sec = null; _secBc = null; _secRecvKey = null; _onSessionUp = null;
  linkStop(); // liaisons locales de la session fermées (21-links.js)
  _rxLastSeq.clear(); _dupSeen.clear();
  resetClockSkew();
}
