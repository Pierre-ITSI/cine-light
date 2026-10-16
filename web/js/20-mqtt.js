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
// Compteurs (diagnostic et tests) : trames envoyées, reçues, rejetées
const secStats = { sent: 0, received: 0, dropped: 0, refused: 0, lastError: null };

function _newClientId(prefix) { return prefix + '-' + mode + '-' + Math.random().toString(36).slice(2, 8); }

// Connexion à la session chiffrée « pairing ». onConnected est rappelé à la
// 1re connexion ET à chaque reconnexion automatique : la télécommande renvoie
// alors son état (hello → caps → resynchronisation), l'écran ses capacités.
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
  resetClockSkew();
  initBCFallback(ch);

  // Broker public, ou relais privé si RELAY_URL est configuré (19-relay.js)
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
      if (isCurrent()) onConnected();
    });
  });

  client.on('error', err => {
    if (!isCurrent()) return;
    console.warn('MQTT error', err);
    if (mode === 'remote') setConnStatus('error');
    else setScreenStatus('Erreur broker — rechargez');
  });

  // Coupure / hors-ligne / nouvelle tentative : mqtt.js se reconnecte seul
  // (reconnectPeriod). On le reflète dans l'indicateur de liaison.
  const onLost = () => {
    if (!isCurrent()) return;
    if (mode === 'remote') setConnStatus('connecting');
    else if (mode === 'screen') { setScreenStatus('Connexion…'); stopScreenAlive(); }
  };
  client.on('close', onLost);
  client.on('offline', onLost);
  client.on('reconnect', onLost);

  client.on('message', (topic, payload) => {
    if (topic !== ch.mqttTopic) return;
    receiveFrame(ch, String(payload), 'mqtt');
  });
}

// Réception : les trames sont ouvertes UNE PAR UNE, dans l'ordre d'arrivée
// (le déchiffrement est asynchrone ; l'ordre compte : début de transfert avant
// ses fragments, dernière couleur gagnante…).
const _BC_TYPES = ['color', 'strobe']; // seuls types acceptés du repli même appareil
// Télécommande : écran (screenId) qui a émis le message en cours de traitement,
// d'après son étiquette d'émetteur authentifiée (rattachée par « caps ») ;
// null si inconnu. Lu par les gestionnaires (réponse WebRTC, accusés, lecture…).
let _rxFrom = null;
function receiveFrame(ch, str, via) {
  _rxChain = _rxChain.then(async () => {
    if (ch !== _sec) return;
    let r;
    // Trames scellées avec une clé PAR ÉCRAN (29-revoke.js) : télécommande, la
    // clé de l'écran émetteur ; écran, la sienne (et celle d'un échange en cours)
    try { r = await ch.receive(str, { pairwise: mode === 'remote' ? remotePairwiseCandidates : screenPairwiseCandidates }); }
    catch (e) {
      secStats.dropped++; secStats.lastError = (e && e.code) || 'error';
      if (secStats.lastError === 'stale') await noteStaleFrame(ch, str);
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
    secStats.received++;
    if (mode === 'remote') {
      remoteNoteScreen(r.sender, r.message);
      _rxFrom = _screenOfSender.get(r.sender) || null;
    }
    try { dispatchMessage(r.message); } catch (e) { console.warn('SetRemote : message', r.message.type, e); }
    finally { _rxFrom = null; }
  });
  return _rxChain;
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
  if (!mqttClient || !mqttClient.connected || !_sec) return;
  let msg;
  try { msg = prepareOutgoing(obj); } catch (_) { return; }
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
    if (client === mqttClient && client.connected) { client.publish(ch.mqttTopic, frame, { qos: 0 }); secStats.sent++; }
    if (bc && window._bc) { try { window._bc.postMessage(await bc.seal(msg)); } catch (_) {} }
  });
}

// Message scellé avec une clé PAR ÉCRAN (pairwise.js, 29-revoke.js), publié
// sur la session en cours dans l'ordre des envois. Résolu une fois publié.
function sendPairwise(obj, keys) {
  if (!mqttClient || !mqttClient.connected || !_sec || !keys) return Promise.resolve();
  const ch = _sec, client = mqttClient;
  _txChain = _txChain.then(async () => {
    if (ch !== _sec) return;
    let frame;
    try { frame = await ch.sealPairwise(JSON.parse(JSON.stringify(obj)), keys); }
    catch (e) { secStats.refused++; secStats.lastError = (e && e.code) || 'error'; console.warn('SetRemote : message refusé à l\'envoi', obj && obj.type, e && e.message); return; }
    if (client === mqttClient && client.connected) { client.publish(ch.mqttTopic, frame, { qos: 0 }); secStats.sent++; }
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
  _sec = null; _secBc = null; _secRecvKey = null;
  resetClockSkew();
}
