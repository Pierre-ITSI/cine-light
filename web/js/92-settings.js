// ══════════════════════════ RÉGLAGES (maquette 13) ══════════════════════════
// Vue plein écran ouverte par l'engrenage de l'en-tête de la télécommande
// (maquette 1), à la place de l'ancien bouton « ← Retour » : le retour à
// l'accueil passe désormais par « RETOUR À L'ACCUEIL », en bas des réglages.
//
// Lignes de la maquette reprises parce que la fonction existe :
//   Chiffrement de bout en bout   toujours actif (packages/protocol)
//   Avertissement stroboscope     Activé / Désactivé (46-strobe-warning.js) ;
//                                 la ligne bascule l'état pour la session
//   Fréquence max du strobo       plafond du protocole (PROTO.STROBE_FREQ_MAX)
// Laissées de côté tant que la fonction n'existe pas (pas de valeur inventée) :
//   Relais (« Europe · eu-west »)  en production, broker MQTT public ; le relais
//                                 auto-hébergé reste désactivé (RELAY_URL vide)
//   Liaison par défaut (« Auto »)  seule la liaison Internet existe
//   Purger les médias des écrans   les médias ne vivent qu'en mémoire sur
//                                 l'écran de jeu, le temps de la session
//
// Langue : choix mémorisé (setremote-lang-v1). La traduction anglaise viendra
// plus tard (catalogue i18n/) : en attendant, une note le dit et la politique
// de confidentialité s'ouvre en anglais (privacy.html).
const APP_VERSION = '1.0.0'; // = « expo.version » de expo-app/app.json (vérifié par tests/settings.test.mjs)
const APP_LANG_KEY = 'setremote-lang-v1';
const APP_LANGS = ['fr', 'en'];

function appLanguage() {
  const l = _lsGet(APP_LANG_KEY);
  return APP_LANGS.includes(l) ? l : 'fr';
}
function setAppLanguage(l) {
  if (!APP_LANGS.includes(l)) return;
  _lsSet(APP_LANG_KEY, l);
  renderSettings();
}

function openSettings() {
  renderSettings();
  const v = document.getElementById('settings-view');
  v.style.display = 'flex';
  v.scrollTop = 0;
}
function closeSettings() {
  closePrivacyPolicy();
  document.getElementById('settings-view').style.display = 'none';
}

function renderSettings() {
  const lang = appLanguage();
  for (const l of APP_LANGS) {
    const b = document.getElementById('stLang-' + l);
    b.classList.toggle('active', l === lang);
    b.setAttribute('aria-pressed', String(l === lang));
  }
  document.getElementById('stLangNote').style.display = lang === 'en' ? 'block' : 'none';
  const warn = !flashWarningSkipped();
  document.getElementById('stStrobeWarn').setAttribute('aria-checked', String(warn));
  const val = document.getElementById('stStrobeWarnVal');
  val.textContent = warn ? 'Activé' : 'Désactivé';
  val.classList.toggle('on', warn);
  val.classList.toggle('off', !warn);
  document.getElementById('stStrobeMax').textContent = PROTO.STROBE_FREQ_MAX + ' Hz';
  document.getElementById('stVersion').textContent = 'SetRemote ' + APP_VERSION + ' · by Pikoo';
}

// « Avertissement stroboscope » : désactivé = « Ne plus demander » de la boîte
function toggleFlashWarningSetting() {
  setFlashWarningSkipped(!flashWarningSkipped());
  renderSettings();
}

// Même effet que « Nouvelle session » (onglet QR) : nouveau secret, tous les
// écrans révoqués ; on revient sur le nouveau QR pour les réappairer.
function settingsForgetScreens() {
  if (!confirm('Oublier tous les écrans appairés : ils seront déconnectés et devront scanner le nouveau QR. Continuer ?')) return;
  newRemoteSession();
  closeSettings();
  switchTab('qr');
  document.getElementById('remote-mode').scrollTop = 0;
}

function settingsGoHome() {
  closeSettings();
  goBack();
}

// Politique de confidentialité : page statique embarquée (confidentialite.html,
// privacy.html), affichée dans l'app sans quitter la télécommande. Rechargée
// à chaque ouverture : en haut de page, dans la langue choisie.
function openPrivacyPolicy() {
  document.getElementById('policyFrame').setAttribute('src', appLanguage() === 'en' ? 'privacy.html' : 'confidentialite.html');
  document.getElementById('policy-view').style.display = 'flex';
}
function closePrivacyPolicy() {
  document.getElementById('policy-view').style.display = 'none';
}
