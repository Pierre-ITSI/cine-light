// ══════════════════════════ TRANSPORT : RELAIS WEBSOCKET PRIVÉ ══════════════════════════
// RELAY_URL configuré (01-config.js) : les MÊMES trames scellées (SRP) passent
// par le relais SetRemote (relay/server.js) au lieu du broker MQTT public.
// RelayClient imite la partie de mqtt.js dont l'app se sert (connected,
// disconnecting, on(), subscribe(), publish(), end()) : 20-mqtt.js et
// 26-pairing.js ne font que choisir le transport (transportConnect), le
// scellement, la réception et la resynchronisation restent identiques.
//   topic 'setremote/v2/s/<t>'   → RELAY_URL + '/v2/s/<t>'   (une salle par connexion)
//   topic 'setremote/v2/rdv/<i>' → RELAY_URL + '/v2/rdv/<i>'
// Preuve d'appartenance (relayAuth) dans Sec-WebSocket-Protocol, jamais dans
// l'URL. Reconnexion automatique (attente exponentielle + gigue) ; chaque
// connexion rétablie émet « connect » → réabonnement et resynchronisation,
// exactement comme une reconnexion mqtt.js.
const RELAY_PROTOCOL = 'setremote.v2';
const RELAY_RETRY_MS = 1000, RELAY_RETRY_MAX_MS = 30000;
const RELAY_CONNECT_TIMEOUT_MS = 8000;
const RELAY_STABLE_MS = 10000;   // connexion tenue au moins 10 s : l'attente repart de 1 s
const RELAY_SILENCE_MS = 70000;  // rien reçu (pas même le battement du relais, 25 s) : lien mort
const RELAY_FALLBACK_AFTER = 3;  // échecs d'affilée sans jamais joindre le relais → repli (si autorisé)

// Client du transport configuré pour un topic (relayAuth : preuve facultative)
function transportConnect(topic, relayAuth, mqttOpts) {
  if (!RELAY_URL) return mqtt.connect(BROKER, mqttOpts);
  return new RelayClient(topic, relayAuth, RELAY_FALLBACK_MQTT ? () => mqtt.connect(BROKER, mqttOpts) : null);
}

class RelayClient {
  constructor(topic, relayAuth, fallback) {
    this.topic = topic;
    this.url = RELAY_URL + topic.slice(topic.indexOf('/'));
    this.protocols = relayAuth ? [RELAY_PROTOCOL, 'auth.' + relayAuth] : [RELAY_PROTOCOL];
    this.disconnecting = false;
    this._up = false; this._ws = null; this._h = {}; this._fails = 0; this._everOpen = false;
    this._timer = null; this._watch = null; this._fallback = fallback; this._inner = null;
    // Retour du réseau : nouvelle tentative sans attendre la fin de l'attente
    this._online = () => { if (this._timer) { clearTimeout(this._timer); this._open(); } };
    window.addEventListener('online', this._online);
    this._timer = setTimeout(() => this._open(), 0); // après la pose des gestionnaires, comme mqtt.connect
  }
  get connected() { return this._inner ? this._inner.connected : this._up; }
  on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
  _emit(ev, ...args) { for (const fn of (this._h[ev] || []).slice()) fn(...args); }
  subscribe(topic, opts, cb) {
    if (this._inner) return this._inner.subscribe(topic, opts, cb);
    const done = typeof opts === 'function' ? opts : cb;
    if (typeof done === 'function') setTimeout(() => done(topic === this.topic ? null : new Error('topic'), [{ topic, qos: 0 }]), 0);
    return this;
  }
  publish(topic, payload, opts) {
    if (this._inner) return this._inner.publish(topic, payload, opts);
    if (this._up && topic === this.topic) this._ws.send(String(payload));
    return this;
  }
  end() {
    if (this.disconnecting) return this;
    this.disconnecting = true;
    window.removeEventListener('online', this._online);
    clearTimeout(this._timer); clearInterval(this._watch); this._timer = null;
    if (this._inner) { this._inner.end(true); return this; }
    const ws = this._ws, was = this._up;
    this._ws = null; this._up = false;
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(1000); } catch (_) {} }
    this._emit('close');
    if (was) this._emit('offline');
    this._emit('end');
    return this;
  }
  _open() {
    this._timer = null;
    if (this.disconnecting || this._inner) return;
    let ws;
    try { ws = new WebSocket(this.url, this.protocols); } catch (_) { this._closed(false); return; }
    this._ws = ws;
    let openedAt = 0;
    const timeout = setTimeout(() => { if (!openedAt) ws.close(); }, RELAY_CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timeout);
      openedAt = this._lastRx = Date.now();
      this._up = true; this._everOpen = true;
      this._watch = setInterval(() => { if (Date.now() - this._lastRx > RELAY_SILENCE_MS) ws.close(); }, 10000);
      this._emit('connect', { sessionPresent: false });
    };
    ws.onmessage = (e) => {
      this._lastRx = Date.now();
      if (typeof e.data === 'string' && e.data) this._emit('message', this.topic, e.data); // '' = battement
    };
    ws.onerror = () => {}; // suivi de « close »
    ws.onclose = () => {
      clearTimeout(timeout); clearInterval(this._watch);
      if (this._ws !== ws) return;
      this._ws = null;
      this._closed(openedAt && Date.now() - openedAt >= RELAY_STABLE_MS);
    };
  }
  _closed(wasStable) {
    const was = this._up;
    this._up = false;
    this._fails = wasStable ? 0 : this._fails + 1;
    this._emit('close');
    if (was) this._emit('offline');
    if (this.disconnecting) return;
    if (this._fallback && !this._everOpen && this._fails >= RELAY_FALLBACK_AFTER) { this._useFallback(); return; }
    this._emit('reconnect');
    const d = Math.min(RELAY_RETRY_MAX_MS, RELAY_RETRY_MS * 2 ** Math.max(0, this._fails - 1));
    this._timer = setTimeout(() => this._open(), d / 2 + Math.random() * d / 2);
  }
  // Relais injoignable dès le départ et repli autorisé : broker public pour
  // cette connexion (jusqu'à la prochaine session ou au rechargement)
  _useFallback() {
    console.warn('SetRemote : relais injoignable, repli sur le broker public');
    window.removeEventListener('online', this._online);
    const c = this._fallback();
    this._inner = c;
    for (const ev of ['connect', 'close', 'offline', 'reconnect', 'error', 'message', 'end']) c.on(ev, (...a) => this._emit(ev, ...a));
  }
}
