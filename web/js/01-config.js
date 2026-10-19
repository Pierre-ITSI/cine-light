// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ CONFIGURATION (transport, WebRTC) ══════════════════════════
// Relais privé auto-hébergé (relay/, docs/BROKER.md §5) : DÉSACTIVÉ par défaut,
// le comportement reste celui d'aujourd'hui tant que RELAY_URL est vide.
//   RELAY_URL            '' = broker MQTT public (historique) ;
//                        'wss://relais.exemple.fr' = relais SetRemote (19-relay.js).
//   RELAY_FALLBACK_MQTT  true = relais injoignable dès le départ → repli sur le
//                        broker public (trames toujours chiffrées). Non par défaut.
//   STUN_URLS            serveurs STUN du pair-à-pair WebRTC (transfert vidéo),
//                        ex. ['stun:relais.exemple.fr:3478'] (coturn de relay/deploy).
//   PUBLIC_URL           adresse publique de la PWA, base des liens et QR d'appairage
//                        ouverts par les AUTRES appareils. '' = adresse de la page
//                        elle-même (origin + chemin, comportement historique) ;
//                        ex. 'https://set-remote.itsi-app.com/' (docs/HOSTING.md).
//                        https:// seulement, sans « ? » ni « # ». L'app native
//                        fournit la sienne (window.SETREMOTE_NATIVE.publicUrl,
//                        expo-app/src/config.ts), prioritaire.
// Pour activer : modifier ces valeurs puis « npm run build ». Une coque native
// ou un test peut aussi fournir window.SETREMOTE_CONFIG (mêmes clés) AVANT le
// script de l'app ; toute valeur invalide est ignorée (valeur par défaut).
const SETREMOTE_DEFAULTS = Object.freeze({
  RELAY_URL: '',
  RELAY_FALLBACK_MQTT: false,
  STUN_URLS: Object.freeze(['stun:stun.l.google.com:19302']),
  PUBLIC_URL: '',
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
// Adresse publique : https://hôte[:port][/chemin], caractères sûrs seulement (ni
// requête, ni fragment, ni identifiants) ; '' = location
const PUBLIC_URL = _cfgPick('PUBLIC_URL',
  (u) => u === '' || (typeof u === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w.~%-]*)*$/i.test(u)));
// Licence Tel + Séquence de la version officielle (docs/LICENSING.md,
// contrat client : docs/LICENCE-API.md, code : 14-licence.js, 77-licence-ui.js) :
//   LICENSING        'off' = aucune vérification, aucune requête, toutes les
//                    fonctions : version libre et auto-hébergée (valeur par
//                    défaut, à garder dans ce dépôt). 'on' = onglets Tel et
//                    Séquence en aperçu sans licence (build officiel d'ITSI APP).
//   LICENCE_PUBKEY   clé publique ECDSA P-256 du service de licence (SPKI,
//                    base64url) qui signe les jetons ; vide = licence inactive.
//   LICENCE_API      base du service (https://hôte) ; '' = hôte de RELAY_URL
//                    (wss://hub… → https://hub…) ; relais vide = inactive.
//   LICENCE_BUY_URL  page d'achat (version web seulement, jamais dans l'app
//                    native) ; '' = aucun lien d'achat.
// Valeurs de BUILD (LICENCE_BUILD). window.SETREMOTE_CONFIG ne peut que
// RESTREINDRE : passer LICENSING à 'on', et fournir une clé, un service ou
// une page d'achat seulement si le build n'en fixe pas. Un build officiel
// (LICENSING 'on', clé fixée) ne peut donc être ni désactivé ni détourné vers
// une autre clé de signature.
const LICENCE_BUILD = Object.freeze({ LICENSING: 'off', LICENCE_PUBKEY: '', LICENCE_API: '', LICENCE_BUY_URL: '' });
const _licPick = (k, ok) => (LICENCE_BUILD[k] === '' && k in _cfgIn && ok(_cfgIn[k]) ? _cfgIn[k] : LICENCE_BUILD[k]);
const LICENSING = LICENCE_BUILD.LICENSING === 'on' || _cfgIn.LICENSING === 'on' ? 'on' : 'off';
const LICENCE_PUBKEY = _licPick('LICENCE_PUBKEY', (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{80,200}$/.test(v));
// https://hôte[:port] (http:// seulement sur la machine locale : développement, tests)
const _cfgApiOk = (u) => typeof u === 'string' && /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1))(:\d+)?$/i.test(u);
const LICENCE_API = (() => {
  const v = _licPick('LICENCE_API', _cfgApiOk);
  if (v) return v;
  const m = /^(wss?):\/\/([^/?#]+)/.exec(RELAY_URL);
  return m ? (m[1] === 'wss' ? 'https://' : 'http://') + m[2] : '';
})();
const LICENCE_BUY_URL = _licPick('LICENCE_BUY_URL',
  (u) => typeof u === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w.~%-]*)*$/i.test(u));
