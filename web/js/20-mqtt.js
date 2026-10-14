// ══════════════════════════ MQTT ══════════════════════════
const BROKER = 'wss://broker.hivemq.com:8884/mqtt';

function mqttTopic(ch) { return 'setremote/v1/' + ch + '/cmd'; }

function connectMQTT(ch, onConnected) {
  if (mqttClient) { mqttClient.end(true); mqttClient = null; }

  const clientId = 'cl-' + mode + '-' + Math.random().toString(36).slice(2, 8);
  mqttClient = mqtt.connect(BROKER, {
    clientId,
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 3000,
  });

  mqttClient.on('connect', () => {
    mqttClient.subscribe(mqttTopic(ch), { qos: 0 }, () => {
      onConnected();
    });
  });

  mqttClient.on('error', err => {
    console.warn('MQTT error', err);
    if (mode === 'remote') setConnStatus('error');
    else setScreenStatus('Erreur broker — rechargez');
  });

  mqttClient.on('message', (topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      // Ignorer ses propres messages (même clientId dans le payload)
      if (msg._id === clientId) return;
      if (mode === 'screen') {
        if (msg.type === 'color')        receiveColor(msg.color);
        if (msg.type === 'strobe')       receiveStrobe(msg);
        if (msg.type === 'vibrate')      doVibrate(msg.pattern);
        if (msg.type === 'torch-onoff')  receiveTorchOnOff(msg.on);
        if (msg.type === 'torch-dim')    receiveTorchDim(msg.level);
        if (msg.type === 'torch-effect') receiveTorchEffect(msg.effect);
        if (msg.type === 'hello')        sendCaps();
        if (msg.type === 'effect')       receiveEffect(msg);
        if (msg.type === 'blackout')     setBlackout(msg.on);
        if (msg.type === 'screen:brightness') setScreenDim(msg.value);
        if (msg.type === 'media-img-start') mediaImgStart(msg);
        if (msg.type === 'media-img-chunk') mediaImgChunk(msg);
        if (msg.type === 'media-stop')   hideScreenMedia();
        if (msg.type === 'media:show')   screenShowCached(msg.id);
        if (msg.type === 'media:order')  _mediaOrder = msg.ids || [];
        if (msg.type === 'media:evict')  screenEvictCached(msg.id);
        if (msg.type === 'media:autoadvance') _screenAutoAdvance = !!msg.on;
        if (msg.type === 'media-ctrl')   screenMediaCtrl(msg);
        if (msg.type === 'media:endmode') screenSetEndMode(msg.mode);
        if (msg.type === 'media:upload') screenVidUploadStart(msg);
        if (msg.type === 'media:chunk')  screenVidUploadChunk(msg);
        if (msg.type === 'media:play')   screenVidUploadPlay(msg);
        if (msg.type === 'call:start')   screenCallStart(msg);
        if (msg.type === 'call:answer')  screenCallAnswer();
        if (msg.type === 'call:end')     screenCallEnd();
        if (msg.type === 'rtc-offer')    screenHandleOffer(msg.sdp);
        if (msg.type === 'rtc-ice' && msg.from === 'remote') screenAddIce(msg.candidate);
      }
      if (mode === 'remote') {
        if (msg.type === 'rtc-answer')   remoteHandleAnswer(msg.sdp);
        if (msg.type === 'rtc-ice' && msg.from === 'screen') remoteAddIce(msg.candidate);
        if (msg.type === 'media-meta')     remoteOnMeta(msg.dur);
        if (msg.type === 'media-progress') remoteOnProgress(msg.cur, msg.dur, msg.playing);
        if (msg.type === 'media-ended')    remoteOnEnded(!!msg.off);
        if (msg.type === 'media-error')    remoteOnError(msg.reason);
        if (msg.type === 'media:advance')  advancePool(typeof msg.dir === 'number' ? msg.dir : 1);
        if (msg.type === 'media:cached')   { _screenCached.add(msg.id); _preloadInflight.delete(msg.id); }
        if (msg.type === 'media:chunkack') { if (_b64Ack.id === msg.mediaId) _b64Ack.got = Math.max(_b64Ack.got, msg.got || 0); }
        if (msg.type === 'media:need-chunks') resendMissingChunks(msg);
        if (msg.type === 'call:state')     remoteOnCallState(msg);
        if (msg.type === 'media:advanced') remoteOnScreenAdvanced(msg.id);
        if (msg.type === 'media:need')     remoteOnScreenNeeds(msg.id);
        if (msg.type === 'caps')           applyReceiverCaps(msg);
      }
    } catch (_) {}
  });

  // Stocker l'ID pour filtrer l'echo
  mqttClient._myId = clientId;
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
    bc.onmessage = e => {
      if (e.data.type === 'color')  receiveColor(e.data.color);
      if (e.data.type === 'strobe') receiveStrobe(e.data);
    };
  }
}

