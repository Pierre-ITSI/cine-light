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
function nativePost(msg) {
  if (!IN_NATIVE_APP) return;
  try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (_) {}
}
if (IN_NATIVE_APP) document.documentElement.classList.add('in-app');

