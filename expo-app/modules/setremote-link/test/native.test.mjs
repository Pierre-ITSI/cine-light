// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Cohérence du module setremote-link : TypeScript (référence), Swift, Kotlin,
// config plugin, branchement dans la coque et retrait des anciens transports.
// Le Swift n'est pas compilable ici : ces tests en vérifient les constantes et
// les noms ; le Kotlin est en plus compilé et rejoué sur JVM (OFFLINE-NATIVE § 7).
//
//   cd expo-app && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as wire from '../src/wire.ts';
import { MAX_FRAME_BYTES, MAX_NAME_BYTES, MAX_NAME_CHARS, MAX_BATCH_FRAMES, MAX_BATCH_BYTES } from '../src/bridge.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.join(here, '..');
const appDir = path.join(moduleDir, '..', '..');
const read = (p) => readFileSync(path.join(moduleDir, p), 'utf8');
const KT = 'android/src/main/java/expo/modules/setremotelink/';
const swift = {
  module: read('ios/SetRemoteLinkModule.swift'),
  wire: read('ios/LinkWire.swift'),
  manager: read('ios/LinkManager.swift'),
  lan: read('ios/LanLink.swift'),
  ble: read('ios/BleLink.swift'),
};
const kotlin = {
  module: read(KT + 'SetRemoteLinkModule.kt'),
  wire: read(KT + 'LinkWire.kt'),
  manager: read(KT + 'LinkManager.kt'),
  lan: read(KT + 'LanLink.kt'),
  ble: read(KT + 'BleLink.kt'),
};
const num = (src, re) => {
  const m = re.exec(src);
  assert.ok(m, `introuvable : ${re}`);
  return m[1];
};

test('autolinking et noms : SetRemoteLink, fonctions synchrones, événements préfixés', () => {
  const config = JSON.parse(read('expo-module.config.json'));
  assert.deepEqual(config.platforms, ['apple', 'android']);
  assert.deepEqual(config.apple.modules, ['SetRemoteLinkModule']);
  assert.deepEqual(config.android.modules, ['expo.modules.setremotelink.SetRemoteLinkModule']);
  assert.match(swift.module, /public class SetRemoteLinkModule: Module/);
  assert.match(kotlin.module, /^package expo\.modules\.setremotelink$/m);
  assert.match(kotlin.module, /class SetRemoteLinkModule : Module\(\)/);
  for (const src of [swift.module, kotlin.module]) assert.match(src, /Name\("SetRemoteLink"\)/);
  assert.match(read('src/SetRemoteLinkModule.ts'), /requireOptionalNativeModule<SetRemoteLinkModule>\('SetRemoteLink'\)/);
  for (const fn of ['start', 'stop', 'send', 'drain', 'getState']) {
    assert.match(swift.module, new RegExp(`\\bFunction\\("${fn}"\\)`), `Swift ${fn}`);
    assert.match(kotlin.module, new RegExp(`\\bFunction\\("${fn}"\\)`), `Kotlin ${fn}`);
    assert.doesNotMatch(swift.module + kotlin.module, new RegExp(`AsyncFunction\\("${fn}"\\)`), 'synchrones : ordre des appels garanti');
  }
  for (const ev of ['onSetRemoteLinkPeers', 'onSetRemoteLinkState', 'onSetRemoteLinkError']) {
    assert.ok(swift.manager.includes(`"${ev}"`), `Swift ${ev}`);
    assert.ok(kotlin.manager.includes(`"${ev}"`), `Kotlin ${ev}`);
  }
  // Premier plan uniquement
  assert.match(swift.module, /OnAppEntersBackground \{\s*manager\.suspend\(\)/);
  assert.match(swift.module, /OnAppEntersForeground \{\s*manager\.resume\(\)/);
  assert.match(kotlin.module, /OnActivityEntersBackground \{\s*manager\?\.suspend\(\)/);
  assert.match(kotlin.module, /OnActivityEntersForeground \{\s*manager\?\.resume\(\)/);
});

test('constantes du format identiques en TypeScript, Swift et Kotlin', () => {
  const pairs = [
    // [valeur TS, Swift, Kotlin]
    [MAX_FRAME_BYTES.lan, /lanMaxFrame = (\d+)/, /LAN_MAX_FRAME = (\d+)/],
    [MAX_FRAME_BYTES.ble, /bleMaxFrame = (\d+)/, /BLE_MAX_FRAME = (\d+)/],
    [MAX_NAME_BYTES, /maxNameBytes = (\d+)/, /MAX_NAME_BYTES = (\d+)/],
    [MAX_NAME_CHARS, /maxNameChars = (\d+)/, /MAX_NAME_CHARS = (\d+)/],
    [wire.HELLO_FIXED_BYTES, /helloFixedBytes = (\d+)/, /HELLO_FIXED_BYTES = (\d+)/],
    [wire.PREAUTH_MAX_MESSAGE, /preauthMaxMessage = (\d+)/, /PREAUTH_MAX_MESSAGE = (\d+)/],
    [wire.PREAUTH_MAX_BYTES, /preauthMaxBytes = (\d+)/, /PREAUTH_MAX_BYTES = (\d+)/],
    [wire.FRAG_HEADER_BYTES, /fragHeaderBytes = (\d+)/, /FRAG_HEADER_BYTES = (\d+)/],
    [wire.MAX_ATT_VALUE, /maxAttValue = (\d+)/, /MAX_ATT_VALUE = (\d+)/],
    [wire.MAX_FRAGMENTS, /maxFragments = (\d+)/, /MAX_FRAGMENTS = (\d+)/],
    [wire.MAX_PARTIALS, /maxPartials = (\d+)/, /MAX_PARTIALS = (\d+)/],
    [MAX_BATCH_FRAMES, /maxBatchFrames = (\d+)/, /MAX_BATCH_FRAMES = (\d+)/],
  ];
  for (const [ts, sw, kt] of pairs) {
    assert.equal(Number(num(swift.wire, sw)), ts, `Swift ${sw}`);
    assert.equal(Number(num(kotlin.wire, kt)), ts, `Kotlin ${kt}`);
  }
  assert.equal(MAX_BATCH_BYTES, 1 << 20);
  assert.match(swift.wire, /maxBatchBytes = 1 << 20/);
  assert.match(kotlin.wire, /MAX_BATCH_BYTES = 1 shl 20/);
  // Temps (secondes en Swift, millisecondes en Kotlin)
  for (const [ts, sw, kt] of [
    [wire.REASSEMBLY_TIMEOUT_MS, /reassemblyTimeout: TimeInterval = (\d+)/, /REASSEMBLY_TIMEOUT_MS = (\d+)L/],
    [wire.HANDSHAKE_TIMEOUT_MS, /handshakeTimeout: TimeInterval = (\d+)/, /HANDSHAKE_TIMEOUT_MS = (\d+)L/],
    [wire.KEEPALIVE_MS, /keepalive: TimeInterval = (\d+)/, /KEEPALIVE_MS = (\d+)L/],
    [wire.DEAD_AFTER_MS, /deadAfter: TimeInterval = (\d+)/, /DEAD_AFTER_MS = (\d+)/],
  ]) {
    assert.equal(Number(num(swift.wire, sw)) * 1000, ts, `Swift ${sw}`);
    assert.equal(Number(num(kotlin.wire, kt)), ts, `Kotlin ${kt}`);
  }
  // Types de message, rôles, contexte du MAC, version
  for (const [name, v] of [['kindHello', 1], ['kindAuth', 2], ['kindData', 3], ['kindPing', 4], ['roleRemote', 0x52], ['roleScreen', 0x53]]) {
    assert.equal(Number(num(swift.wire, new RegExp(`${name}: UInt8 = (0x[0-9a-f]+)`))), v, `Swift ${name}`);
    const kt = name.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase();
    assert.equal(Number(num(kotlin.wire, new RegExp(`${kt} = (0x[0-9a-f]+)`))), v, `Kotlin ${kt}`);
  }
  for (const src of [swift.wire, kotlin.wire]) {
    assert.ok(src.includes('"SRL1"'), 'contexte du MAC');
    assert.ok(src.includes('"_setremote._tcp"'), 'type de service');
    assert.ok(src.includes('"SR"'), 'préfixe du nom local');
  }
  // Plafonds de pairs et files
  for (const [sw, kt, v] of [
    ['maxLanPeers', 'MAX_LAN_PEERS', 64], ['maxLanPending', 'MAX_LAN_PENDING', 8], ['maxBlePeers', 'MAX_BLE_PEERS', 8],
    ['maxBlePending', 'MAX_BLE_PENDING', 4], ['maxBleCentrals', 'MAX_BLE_CENTRALS', 4], ['inboxMaxFrames', 'INBOX_MAX_FRAMES', 1024],
  ]) {
    assert.equal(Number(num(swift.wire, new RegExp(`${sw} = (\\d+)`))), v, sw);
    assert.equal(Number(num(kotlin.wire, new RegExp(`${kt} = (\\d+)`))), v, kt);
  }
});

test('UUID Bluetooth identiques (service, RX écrit par la télécommande, TX notifié par l\'écran)', () => {
  for (const [name, uuid] of [['service', wire.BLE_SERVICE_UUID], ['rx', wire.BLE_RX_UUID], ['tx', wire.BLE_TX_UUID]]) {
    assert.ok(swift.wire.includes(`"${uuid.toUpperCase()}"`), `Swift ${name}`);
    assert.ok(kotlin.wire.includes(`"${uuid}"`), `Kotlin ${name}`);
  }
  assert.ok(kotlin.wire.includes('"00002902-0000-1000-8000-00805f9b34fb"'), 'CCCD (Android le déclare lui-même)');
});

test('attentes de la page (docs/OFFLINE.md § 2.2) : pairs distincts par liaison, `to` dans les deux rôles, link:peers après link:start', () => {
  // 1. Identifiants préfixés par la liaison : « lan-… » / « ble-… »
  assert.match(kotlin.manager, /LAN\("lan", "lan", /);
  assert.match(kotlin.manager, /BLE\("ble", "ble", /);
  assert.match(swift.wire, /var prefix: String \{ rawValue \}/);
  assert.match(swift.wire, /case lan\b/);
  assert.match(swift.wire, /case ble\b/);
  for (const src of [kotlin.lan, swift.lan]) assert.match(src, /newPeerId\(LinkMode\.lan\.prefix\)|newPeerId\(LinkMode\.LAN\.prefix\)/);
  for (const src of [kotlin.ble, swift.ble]) assert.match(src, /newPeerId\(LinkMode\.ble\.prefix\)|newPeerId\(LinkMode\.BLE\.prefix\)/);
  // 2. Routage commun aux deux rôles : la fonction ne connaît pas le rôle
  const ktRoute = /internal fun routeFrames[\s\S]*?\n\}\n/.exec(kotlin.manager)[0];
  const swRoute = /func routeFrames[\s\S]*?\n\}\n/.exec(swift.manager)[0];
  for (const r of [ktRoute, swRoute]) assert.doesNotMatch(r, /role|REMOTE|SCREEN|remote|screen/i);
  assert.match(kotlin.manager, /val r = routeFrames\(messages, to, peers\)/);
  assert.match(swift.manager, /let r = routeFrames\(messages, to: to, peers: peers, order: peerOrder\)/);
  // 3. link:peers après chaque link:start, link:state en réponse à link:start et link:stop
  const ktStart = /fun start\(modes[\s\S]*?\n {2}\}\n/.exec(kotlin.manager)[0];
  const swStart = /func start\(modes[\s\S]*?\n {2}\}\n/.exec(swift.manager)[0];
  assert.match(ktStart, /publishPeers\(\)\s*\n\s*refreshState\(force = true\)/);
  assert.match(swStart, /publishPeers\(\)\s*\n\s*refreshState\(force: true\)/);
  assert.match(/fun stop\(modes[\s\S]*?\n {2}\}\n/.exec(kotlin.manager)[0], /refreshState\(force = true\)/);
  assert.match(/func stop\(modes[\s\S]*?\n {2}\}\n/.exec(swift.manager)[0], /refreshState\(force: true\)/);
  // Topologie en étoile : un écran n'admet que des télécommandes (rôle opposé exigé)
  for (const src of [kotlin.wire, swift.wire]) assert.match(src, /fail\("role"\)/);
});

test('natif : aucune trace du contenu (ni trame, ni nom, ni clé)', () => {
  for (const [name, src] of Object.entries({ ...swift, ...Object.fromEntries(Object.entries(kotlin).map(([k, v]) => ['kt-' + k, v])) })) {
    assert.doesNotMatch(src, /\b(print|NSLog|os_log|debugPrint|Log\.[dviwe]|println|Logger)\(/, name);
  }
});

test('Android : sockets clients attachés au réseau Wi-Fi/Ethernet, jamais bindProcessToNetwork', () => {
  assert.match(kotlin.lan, /network\?\.bindSocket\(s\)/);
  const code = kotlin.lan.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /bindProcessToNetwork\(/);
  assert.match(kotlin.lan, /removeCapability\(NetworkCapabilities\.NET_CAPABILITY_INTERNET\)/, 'Wi-Fi sans Internet suivi');
});

test('Android : autorisations Bluetooth demandées au démarrage, selon le rôle et l\'API', () => {
  assert.match(kotlin.ble, /BLUETOOTH_SCAN, Manifest\.permission\.BLUETOOTH_CONNECT/);
  assert.match(kotlin.ble, /BLUETOOTH_ADVERTISE, Manifest\.permission\.BLUETOOTH_CONNECT/);
  assert.match(kotlin.ble, /ACCESS_FINE_LOCATION/);
  assert.match(kotlin.ble, /SDK_INT >= 31/);
  // Jamais de déconnexion d'un appareil sans session SetRemote (montre, écouteurs…)
  assert.match(kotlin.ble, /On ne touche JAMAIS aux connexions d'autres appareils/);
});

test('iOS : cellulaire interdit, refus du réseau local reconnu, invite Bluetooth au démarrage seulement', () => {
  assert.match(swift.lan, /prohibitedInterfaceTypes = \[\.cellular\]/);
  assert.match(swift.lan, /-65570/);
  assert.match(swift.ble, /CBManager\.authorization/);
  assert.match(swift.ble, /CBCentralManagerOptionShowPowerAlertKey: false/);
  assert.match(swift.ble, /CBPeripheralManagerOptionShowPowerAlertKey: false/);
  // Les gestionnaires CoreBluetooth ne sont créés que dans bringUp (link:start avec 'ble')
  assert.equal((swift.ble.match(/= CBCentralManager\(/g) ?? []).length, 1);
  assert.equal((swift.ble.match(/= CBPeripheralManager\(/g) ?? []).length, 1);
});

// ───────────────────────────── config plugin ─────────────────────────────

const require = createRequire(import.meta.url);
const plugin = require('../app.plugin.js');

test('config plugin iOS : NSBonjourServices, textes d\'autorisation conservés ou par défaut', () => {
  const p = plugin.applyInfoPlist({ NSBonjourServices: ['_other._tcp', '_setremote._tcp'] }, {});
  assert.deepEqual(p.NSBonjourServices, ['_other._tcp', '_setremote._tcp'], 'sans doublon');
  assert.match(p.NSLocalNetworkUsageDescription, /réseau local/);
  assert.match(p.NSBluetoothAlwaysUsageDescription, /Bluetooth/);
  const kept = plugin.applyInfoPlist({ NSLocalNetworkUsageDescription: 'Texte existant' }, { bluetoothPermission: 'BT' });
  assert.deepEqual(kept.NSBonjourServices, ['_setremote._tcp']);
  assert.equal(kept.NSLocalNetworkUsageDescription, 'Texte existant');
  assert.equal(kept.NSBluetoothAlwaysUsageDescription, 'BT');
  assert.equal(kept.UIBackgroundModes, undefined, 'aucun mode d\'arrière-plan Bluetooth');
});

test('config plugin Android : permissions Bluetooth bornées, localisation jusqu\'à l\'API 30 seulement', () => {
  const stale = { manifest: { $: {}, 'uses-permission': [
    { $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' } }, // ancien prebuild sans borne
    { $: { 'android:name': 'android.permission.BLUETOOTH_SCAN', 'android:maxSdkVersion': '33' } },
  ] } };
  const m = plugin.applyAndroidManifest(stale).manifest;
  const perm = (n) => m['uses-permission'].filter((e) => e.$['android:name'] === `android.permission.${n}`);
  for (const n of ['BLUETOOTH', 'BLUETOOTH_ADMIN', 'ACCESS_FINE_LOCATION']) {
    assert.equal(perm(n).length, 1, n);
    assert.equal(perm(n)[0].$['android:maxSdkVersion'], '30', n);
  }
  assert.equal(perm('BLUETOOTH_SCAN')[0].$['android:usesPermissionFlags'], 'neverForLocation');
  assert.equal(perm('BLUETOOTH_SCAN')[0].$['android:maxSdkVersion'], undefined, 'borne périmée retirée');
  for (const n of ['BLUETOOTH_CONNECT', 'BLUETOOTH_ADVERTISE', 'INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE']) {
    assert.equal(perm(n).length, 1, n);
    assert.equal(perm(n)[0].$['android:maxSdkVersion'], undefined, n);
  }
  assert.equal(perm('ACCESS_COARSE_LOCATION').length, 0);
  assert.equal(perm('ACCESS_BACKGROUND_LOCATION').length, 0);
  assert.equal(m.$['xmlns:tools'], 'http://schemas.android.com/tools');
  assert.deepEqual(m['uses-feature'], [{ $: { 'android:name': 'android.hardware.bluetooth_le', 'android:required': 'false' } }]);
  // Le manifeste du module déclare exactement les mêmes attributs
  const manifest = read('android/src/main/AndroidManifest.xml');
  for (const p of plugin.ANDROID_PERMISSIONS) {
    const tag = new RegExp(`<uses-permission android:name="${p.name.replace(/\./g, '\\.')}"([^>]*)/>`).exec(manifest);
    assert.ok(tag, p.name);
    assert.equal(/maxSdkVersion="(\d+)"/.exec(tag[1])?.[1], p.maxSdkVersion, p.name);
    assert.equal(/usesPermissionFlags="([a-zA-Z]+)"/.exec(tag[1])?.[1], p.usesPermissionFlags, p.name);
  }
});

// ───────────────────────────── coque et dépendances ─────────────────────────────

test('app.json : plugin déclaré, ancien plugin BLE retiré ; package.json sans les anciens transports', () => {
  const app = JSON.parse(readFileSync(path.join(appDir, 'app.json'), 'utf8')).expo;
  const entry = app.plugins.find((p) => Array.isArray(p) && p[0] === './modules/setremote-link/app.plugin.js');
  assert.ok(entry, 'plugin setremote-link');
  assert.match(entry[1].bluetoothPermission, /Bluetooth/);
  const flat = JSON.stringify(app.plugins);
  for (const gone of ['react-native-ble-plx', 'expo-video']) assert.ok(!flat.includes(gone), gone);
  const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  for (const gone of ['react-native-ble-plx', 'react-native-tcp-socket', 'mqtt', 'react-native-qrcode-svg', 'react-native-svg', 'expo-network', 'expo-image', 'expo-video']) {
    assert.equal(pkg.dependencies[gone], undefined, gone);
  }
  for (const f of ['app/native.tsx', 'app/remote.tsx', 'app/screen.tsx', 'src/transport', 'src/components', 'CONNECTIVITY.md']) {
    assert.equal(existsSync(path.join(appDir, f)), false, f);
  }
});

test('coque : link:* routés vers le pont, liaisons arrêtées à chaque nouveau document', () => {
  const shell = readFileSync(path.join(appDir, 'app/index.tsx'), 'utf8');
  assert.match(shell, /import SetRemoteLink, \{ createLinkBridge, type LinkBridge \} from '\.\.\/modules\/setremote-link'/);
  assert.match(shell, /createLinkBridge\(\{\s*native: SetRemoteLink,/);
  assert.match(shell, /if \(link\.current\?\.handle\(msg\)\) return;/);
  assert.match(shell, /link\.current\?\.reset\(\)/);
  assert.match(shell, /bridge\.dispose\(\); link\.current = null;/);
  // reset appelé au nouveau document, au rechargement forcé et au « Réessayer »
  assert.equal((shell.match(/resetBridges\(\)/g) ?? []).length, 3);
  // index.ts n'exporte pas la référence du format (pas de code mort dans le bundle)
  assert.doesNotMatch(read('index.ts'), /from '\.\/src\/wire'/);
});
