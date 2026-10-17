// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// Config plugin du module setremote-link (liaisons hors ligne Wi-Fi / Bluetooth).
//
// iOS (Info.plist) :
//   • NSBonjourServices : ajoute « _setremote._tcp » (sans lui, iOS 14+ refuse
//     de publier ou de chercher le service : NWBrowser reste en attente
//     « PolicyDenied ») ;
//   • NSLocalNetworkUsageDescription : conservée si l'app la déclare déjà
//     (app.json), sinon texte par défaut ;
//   • NSBluetoothAlwaysUsageDescription : option `bluetoothPermission`, sinon
//     valeur existante, sinon texte par défaut. Aucun mode d'arrière-plan
//     Bluetooth : les liaisons ne vivent qu'au premier plan.
//
// Android (AndroidManifest.xml ; aussi dans le manifeste du module, fusionné à
// la compilation, mais écrites ici pour être visibles après prebuild) :
//   • Wi-Fi local : INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE ;
//   • API 31+ : BLUETOOTH_SCAN (neverForLocation), BLUETOOTH_CONNECT,
//     BLUETOOTH_ADVERTISE, demandées à l'exécution au démarrage du Bluetooth ;
//   • API ≤ 30 seulement (maxSdkVersion="30") : BLUETOOTH, BLUETOOTH_ADMIN,
//     ACCESS_FINE_LOCATION (exigée par le système pour scanner jusqu'à
//     Android 11 ; aucune position n'est lue) ;
//   • uses-feature bluetooth_le non requise : l'app s'installe sans BLE.
// Une entrée existante (ancien prebuild sans --clean) reçoit les mêmes attributs.
// ════════════════════════════════════════════════════════════════════════════
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const SERVICE_TYPE = '_setremote._tcp';
const DEFAULT_BLUETOOTH =
  "SetRemote utilise le Bluetooth pour relier la télécommande et l'écran sans Wi-Fi ni Internet.";
const DEFAULT_LOCAL_NETWORK =
  'SetRemote utilise le réseau local (Wi-Fi ou filaire) pour relier la télécommande et les écrans sans passer par Internet.';
const TOOLS_NS = 'http://schemas.android.com/tools';

/** Permissions Android et leurs attributs exacts (null : attribut absent). */
const ANDROID_PERMISSIONS = [
  { name: 'android.permission.INTERNET' },
  { name: 'android.permission.ACCESS_NETWORK_STATE' },
  { name: 'android.permission.ACCESS_WIFI_STATE' },
  { name: 'android.permission.BLUETOOTH', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_ADMIN', maxSdkVersion: '30' },
  { name: 'android.permission.ACCESS_FINE_LOCATION', maxSdkVersion: '30' },
  { name: 'android.permission.BLUETOOTH_SCAN', usesPermissionFlags: 'neverForLocation', targetApi: 's' },
  { name: 'android.permission.BLUETOOTH_CONNECT' },
  { name: 'android.permission.BLUETOOTH_ADVERTISE' },
];

/** Info.plist : service Bonjour et textes d'autorisation. Modifie et renvoie `plist`. */
function applyInfoPlist(plist, props = {}) {
  const services = Array.isArray(plist.NSBonjourServices) ? plist.NSBonjourServices.slice() : [];
  if (!services.includes(SERVICE_TYPE)) services.push(SERVICE_TYPE);
  plist.NSBonjourServices = services;
  if (typeof plist.NSLocalNetworkUsageDescription !== 'string' || plist.NSLocalNetworkUsageDescription.trim() === '') {
    plist.NSLocalNetworkUsageDescription = props.localNetworkPermission || DEFAULT_LOCAL_NETWORK;
  }
  plist.NSBluetoothAlwaysUsageDescription =
    props.bluetoothPermission || plist.NSBluetoothAlwaysUsageDescription || DEFAULT_BLUETOOTH;
  return plist;
}

function setAttr(attrs, key, value) {
  if (value == null) delete attrs[key];
  else attrs[key] = value;
}

/** AndroidManifest (objet xml2js d'Expo) : permissions et uses-feature. Modifie et renvoie `manifest`. */
function applyAndroidManifest(manifest) {
  const root = manifest.manifest;
  root.$ = root.$ || {};
  root.$['xmlns:tools'] = root.$['xmlns:tools'] || TOOLS_NS;
  const list = (root['uses-permission'] = root['uses-permission'] || []);
  for (const p of ANDROID_PERMISSIONS) {
    let entry = list.find((e) => e && e.$ && e.$['android:name'] === p.name);
    if (!entry) {
      entry = { $: { 'android:name': p.name } };
      list.push(entry);
    }
    setAttr(entry.$, 'android:maxSdkVersion', p.maxSdkVersion);
    setAttr(entry.$, 'android:usesPermissionFlags', p.usesPermissionFlags);
    setAttr(entry.$, 'tools:targetApi', p.targetApi);
  }
  const features = (root['uses-feature'] = root['uses-feature'] || []);
  let ble = features.find((f) => f && f.$ && f.$['android:name'] === 'android.hardware.bluetooth_le');
  if (!ble) {
    ble = { $: { 'android:name': 'android.hardware.bluetooth_le' } };
    features.push(ble);
  }
  ble.$['android:required'] = 'false';
  return manifest;
}

const withSetRemoteLink = (config, props = {}) => {
  config = withInfoPlist(config, (c) => {
    applyInfoPlist(c.modResults, props);
    return c;
  });
  config = withAndroidManifest(config, (c) => {
    applyAndroidManifest(c.modResults);
    return c;
  });
  return config;
};

module.exports = withSetRemoteLink;
module.exports.applyInfoPlist = applyInfoPlist;
module.exports.applyAndroidManifest = applyAndroidManifest;
module.exports.ANDROID_PERMISSIONS = ANDROID_PERMISSIONS;
module.exports.SERVICE_TYPE = SERVICE_TYPE;
