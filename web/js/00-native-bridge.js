// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ APP NATIVE (coque iOS/Android) ══════════════════════════
// La coque native injecte window.SETREMOTE_NATIVE avant le chargement et
// expose window.ReactNativeWebView.postMessage pour les fonctions natives.
// Interface embarquée (file://) : sur Android, cette injection passe par
// evaluateJavascript au démarrage de la page et peut arriver APRÈS ce script,
// une page locale se chargeant sans attendre le réseau ; le pont
// ReactNativeWebView, lui, existe dès le début. Une page file:// dotée de ce
// pont ne peut être que la coque : on la reconnaît sans attendre l'injection.
if (!window.SETREMOTE_NATIVE && location.protocol === 'file:' && window.ReactNativeWebView) {
  window.SETREMOTE_NATIVE = { platform: /Android/i.test(navigator.userAgent) ? 'android' : 'ios', bridge: 1 };
}
const IN_NATIVE_APP = !!(window.SETREMOTE_NATIVE && window.ReactNativeWebView);
// PWA → coque : nativePost(msg) (sans effet hors de l'app). Messages :
//   brightness { value 0..1 } / brightness-restore      luminosité matérielle (68-blackout.js, 30-navigation.js)
//   vibrate { pattern: [ms vibre, ms pause, …] }         vibreur de l'écran de jeu (appel qui sonne, répété
//                                                       par la page ; SMS, notification, message de
//                                                       discussion), maquette 36b, 80-call-simulator.js
//   vibrate:stop                                        arrête la vibration (décroché, refus, fin d'appel)
//   dmx:listen, dmx:stop, udp:send, net:info, pdf:preview : docs/DMX-NATIVE.md
//   link:start, link:stop, link:send, link:state?     : docs/OFFLINE-NATIVE.md
//   project:save { id, name, size, i, n, data }        fichier .rem par morceaux (data : base64,
//                                                       PRJ_CHUNK = 512 Kio de caractères, multiple de 4
//                                                       sauf le dernier) ; au dernier (i = n − 1), la coque
//                                                       l'écrit puis ouvre la feuille de partage
//   project:open { id }                                 sélecteur de fichier de la coque (projet à importer)
//                                                       docs/PROJECTS.md § 6, 72-project.js
function nativePost(msg) {
  if (!IN_NATIVE_APP) return;
  try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (_) {}
}
if (IN_NATIVE_APP) document.documentElement.classList.add('in-app');

// Coque → PWA : la coque appelle window.SRNative.receive(msg) (objet, ou
// chaîne JSON). Contrats du pont : docs/DMX-NATIVE.md (passerelle DMX, PDF) et
// docs/OFFLINE.md (liaisons locales). Messages :
//   dmx:packets { packets: [{ src, port, data (base64) }] }  datagrammes UDP reçus
//   net:info    { interfaces: [{ name, kind, ip, mask }] }    interfaces réseau
//   dmx:error   { reason }                                    échec d'écoute UDP
//   pdf:error   { reason }                                    échec de l'aperçu PDF (table des canaux)
//   link:frames { frames: [{ peer, mode, data }] }            trames reçues en Wi-Fi local / Bluetooth
//   link:peers  { peers: [{ peer, mode, name? }] }            pairs locaux (à chaque changement)
//   link:state  { lan: { available, active, error? }, ble }   état des liaisons locales
//   link:error  { mode, reason }                              erreur d'une liaison locale
//   project:saved { id, ok, shared? }                         fichier écrit, feuille de partage fermée
//   project:file  { id, name, size, i, n, data }              fichier choisi, par morceaux base64 (mêmes
//                                                             règles que project:save) ; { id, cancelled: true }
//   project:error { id, reason }                              too-large, unavailable, read-failed,
//                                                             write-failed, share-failed, bad-chunk
// Tout le reste est ignoré ; une erreur de traitement ne remonte jamais à la coque.
window.SRNative = window.SRNative || {};
window.SRNative.receive = function (msg) {
  let m = msg;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { return false; } }
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return false;
  try {
    if (m.type === 'dmx:packets') return gwOnNativePackets(m.packets);
    if (m.type === 'net:info') return gwOnNetInfo(m.interfaces);
    if (m.type === 'dmx:error') return gwOnNativeError(m.reason);
    if (m.type === 'pdf:error') return gwOnPdfError(m.reason);
    if (m.type === 'link:frames') return linkOnFrames(m.frames);
    if (m.type === 'link:peers') return linkOnPeers(m.peers);
    if (m.type === 'link:state') return linkOnState(m);
    if (m.type === 'link:error') return linkOnError(m.mode, m.reason);
    if (m.type === 'project:saved' || m.type === 'project:file' || m.type === 'project:error') return projectOnNative(m);
  } catch (e) { console.warn('SetRemote : message natif', m.type, e); }
  return false;
};

