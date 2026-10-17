// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// Config plugin du module setremote-udp (passerelle DMX).
//
// iOS — autorisation « multicast networking » d'Apple :
//   com.apple.developer.networking.multicast n'est ajoutée que si la variable
//   d'environnement SETREMOTE_MULTICAST_ENTITLEMENT vaut 1 / true / yes / on
//   au moment du prebuild ET de la résolution de la config par EAS (signature).
//   DÉSACTIVÉE par défaut : tant qu'Apple ne l'a pas accordée à l'App ID, un
//   binaire qui la déclare ne peut pas être signé. La clé Info.plist
//   SetRemoteMulticastEntitlement (booléen) reflète ce choix : le module natif
//   sait ainsi, sans essai réseau, si le multicast et le broadcast sont permis
//   (sinon : dmx:error « multicast-not-permitted », l'unicast continue).
//
// Android — permissions des sockets DMX (déjà dans le manifeste du module,
// fusionné à la compilation ; ajoutées ici pour être visibles après prebuild).
// ════════════════════════════════════════════════════════════════════════════
const { AndroidConfig, withAndroidManifest, withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const ENV_FLAG = 'SETREMOTE_MULTICAST_ENTITLEMENT';
const ENTITLEMENT = 'com.apple.developer.networking.multicast';
const INFO_KEY = 'SetRemoteMulticastEntitlement';
const ANDROID_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_WIFI_MULTICAST_STATE',
];

function multicastEnabled(props, env = process.env) {
  if (props && typeof props.multicastEntitlement === 'boolean') return props.multicastEntitlement;
  return /^(1|true|yes|on)$/i.test(String(env[ENV_FLAG] ?? '').trim());
}

const withSetRemoteUdp = (config, props = {}) => {
  const enabled = multicastEnabled(props);

  config = withEntitlementsPlist(config, (c) => {
    if (enabled) c.modResults[ENTITLEMENT] = true;
    else delete c.modResults[ENTITLEMENT]; // prebuild sans --clean : retirer une ancienne valeur
    return c;
  });

  config = withInfoPlist(config, (c) => {
    c.modResults[INFO_KEY] = enabled;
    return c;
  });

  config = withAndroidManifest(config, (c) => {
    AndroidConfig.Permissions.ensurePermissions(c.modResults, ANDROID_PERMISSIONS);
    return c;
  });

  return config;
};

module.exports = withSetRemoteUdp;
module.exports.multicastEnabled = multicastEnabled;
module.exports.ENV_FLAG = ENV_FLAG;
