// ══════════════════════════ MQTT ══════════════════════════
const BROKER = 'wss://broker.hivemq.com:8884/mqtt';

function mqttTopic(ch) { return 'setremote/v1/' + ch + '/cmd'; }

function connectMQTT(ch, onConnected) {
  if (mqttClient) { mqttClient.end(true); mqttClient = null; }

  const clientId = 'cl-' + mode + '-' + Math.random().toString(36).slice(2, 8);
  const client = mqtt.connect(BROKER, {
    clientId,
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 3000,
    // mqtt.js réabonne seul les topics à la reconnexion (resubscribe, défaut) ;
    // l'abonnement explicite ci-dessous à chaque « connect » le garantit aussi.
  });
  mqttClient = client;
  // Évènements d'un client remplacé ou fermé volontairement : ignorés
  const isCurrent = () => client === mqttClient && !client.disconnecting;

  // Appelé à la 1re connexion ET à chaque reconnexion automatique : le rappel
  // renvoie l'état utile (télécommande) ou les capacités (écran), ce qui
  // déclenche la resynchronisation de l'autre côté.
  client.on('connect', () => {
    if (!isCurrent()) return;
    client.subscribe(mqttTopic(ch), { qos: 0 }, () => {
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
  // (reconnectPeriod). On le reflète avec les états d'interface EXISTANTS.
  const onLost = () => {
    if (!isCurrent()) return;
    if (mode === 'remote') setConnStatus('connecting');
    else if (mode === 'screen') setScreenStatus('Connexion à ' + ch + '…');
  };
  client.on('close', onLost);
  client.on('offline', onLost);
  client.on('reconnect', onLost);

  client.on('message', (topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      // Ignorer ses propres messages (même clientId dans le payload)
      if (msg && msg._id === clientId) return;
      // Table d'aiguillage : rôle, validation, puis traitement (22-protocol.js)
      dispatchMessage(msg);
    } catch (_) {}
  });

  // Stocker l'ID pour filtrer l'echo
  client._myId = clientId;
}

function sendMsg(obj) {
  if (!mqttClient || !mqttClient.connected) return;
  const payload = JSON.stringify({ ...obj, _id: mqttClient._myId });
  mqttClient.publish(mqttTopic(channel), payload, { qos: 0 });
  // Fallback BroadcastChannel (même device)
  if (window._bc) window._bc.postMessage(obj);
}

// BroadcastChannel fallback (même navigateur, même device)
function initBCFallback(ch) {
  // BroadcastChannel absent sur iOS < 15.4 : sans garde, l'exception
  // interrompait l'entrée en mode écran avant même la connexion MQTT.
  if (typeof BroadcastChannel === 'undefined') return;
  if (window._bc) { try { window._bc.close(); } catch (_) {} }
  const bc = new BroadcastChannel('setremote_' + ch);
  window._bc = bc;
  if (mode === 'screen') {
    // Seuls couleur et strobe transitent par ce repli, validés comme le réseau
    bc.onmessage = e => {
      const d = e.data;
      if (d && (d.type === 'color' || d.type === 'strobe')) dispatchMessage(d);
    };
  }
}
