// ══════════════════════════ APP NATIVE (coque iOS/Android) ══════════════════════════
// La coque native injecte window.SETREMOTE_NATIVE avant le chargement et
// expose window.ReactNativeWebView.postMessage pour les fonctions natives.
const IN_NATIVE_APP = !!(window.SETREMOTE_NATIVE && window.ReactNativeWebView);
function nativePost(msg) {
  if (!IN_NATIVE_APP) return;
  try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (_) {}
}
if (IN_NATIVE_APP) document.documentElement.classList.add('in-app');

