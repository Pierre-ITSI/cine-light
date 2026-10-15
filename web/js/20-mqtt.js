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
  let ch, bc = null;
  try {
    const opts = { pairing, role: mode };
    if (mode === 'screen') opts.screenId = screenId();
    ch = await SRP.createSecureChannel(opts);
    if (mode === 'remote') bc = await SRP.createSecureChannel(opts);
  } catch (e) {
    console.warn('SetRemote : session chiffrée indisponible', e);
    if (mode === 'remote') setConnStatus('error');
    return;
  }
  if (seq !== _connectSeq || !mode) return; // remplacée entre-temps (retour, nouvelle session)
  _sec = ch; _secBc = bc;
  _rxChain = Promise.resolve(); _txChain = Promise.resolve();
  initBCFallback(ch);

  const client = mqtt.connect(BROKER, {
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
function receiveFrame(ch, str, via) {
  _rxChain = _rxChain.then(async () => {
    if (ch !== _sec) return;
    let r;
    try { r = await ch.receive(str); }
    catch (e) { secStats.dropped++; secStats.lastError = (e && e.code) || 'error'; return; }
    if (!r || r.kind !== 'message' || ch !== _sec) return; // écho, autre écran, fragment binaire
    if (via === 'bc' && !_BC_TYPES.includes(r.message.type)) return;
    secStats.received++;
    if (mode === 'remote') remoteNoteScreen(r.sender, r.message);
    try { dispatchMessage(r.message); } catch (e) { console.warn('SetRemote : message', r.message.type, e); }
  });
  return _rxChain;
}

// Envoi : forme « fil » (JSON), valeurs bornées aux plages du schéma, puis
// scellement et publication DANS L'ORDRE des appels.
function sendMsg(obj) {
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
  _sec = null; _secBc = null;
}
