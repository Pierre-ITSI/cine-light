// ══════════════════════════ CONFIGURATION (transport, WebRTC) ══════════════════════════
// Relais privé auto-hébergé (relay/, docs/BROKER.md §5) : DÉSACTIVÉ par défaut,
// le comportement reste celui d'aujourd'hui tant que RELAY_URL est vide.
//   RELAY_URL            '' = broker MQTT public (historique) ;
//                        'wss://relais.exemple.fr' = relais SetRemote (19-relay.js).
//   RELAY_FALLBACK_MQTT  true = relais injoignable dès le départ → repli sur le
//                        broker public (trames toujours chiffrées). Non par défaut.
//   STUN_URLS            serveurs STUN du pair-à-pair WebRTC (transfert vidéo),
//                        ex. ['stun:relais.exemple.fr:3478'] (coturn de relay/deploy).
// Pour activer : modifier ces valeurs puis « npm run build ». Une coque native
// ou un test peut aussi fournir window.SETREMOTE_CONFIG (mêmes clés) AVANT le
// script de l'app ; toute valeur invalide est ignorée (valeur par défaut).
const SETREMOTE_DEFAULTS = Object.freeze({
  RELAY_URL: '',
  RELAY_FALLBACK_MQTT: false,
  STUN_URLS: Object.freeze(['stun:stun.l.google.com:19302']),
});
const _cfgIn = (window.SETREMOTE_CONFIG && typeof window.SETREMOTE_CONFIG === 'object') ? window.SETREMOTE_CONFIG : {};
const _cfgPick = (k, ok) => (k in _cfgIn && ok(_cfgIn[k]) ? _cfgIn[k] : SETREMOTE_DEFAULTS[k]);
// wss:// (TLS) obligatoire, sauf ws:// sur la machine locale (développement, tests)
const _cfgRelayOk = (u) => u === '' || (typeof u === 'string'
  && /^(wss:\/\/[^\s/?#]+|ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)(\/[^\s?#]*)?$/.test(u));
const _cfgRelay = _cfgPick('RELAY_URL', _cfgRelayOk);
if (!_cfgRelayOk(_cfgRelay)) console.warn('SetRemote : RELAY_URL invalide (wss:// attendu), broker public utilisé');
const RELAY_URL = _cfgRelayOk(_cfgRelay) ? _cfgRelay.replace(/\/+$/, '') : '';
const RELAY_FALLBACK_MQTT = _cfgPick('RELAY_FALLBACK_MQTT', (v) => typeof v === 'boolean');
const STUN_URLS = Object.freeze([..._cfgPick('STUN_URLS',
  (v) => Array.isArray(v) && v.length > 0 && v.length <= 4 && v.every((u) => typeof u === 'string' && /^stuns?:[^\s/?#]+$/.test(u)))]);
