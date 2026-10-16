import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Brightness from 'expo-brightness';
import { Paths } from 'expo-file-system';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewNavigationEvent } from 'react-native-webview/lib/WebViewTypes';
import SetRemoteUdp, { createDmxBridge, type DmxBridge } from '../modules/setremote-udp';
import { createPdfPreviewer, type PdfPrintFn } from '../src/lib/pdfPreview';

// Coque native de SetRemote : la PWA (fonctionnalités de référence) tourne dans
// une vue web plein écran ; le natif apporte ce que le web ne sait pas faire :
// barre d'état masquée en permanence, écran toujours allumé, vraie luminosité
// matérielle, et réception UDP pour la passerelle DMX (sACN, Art-Net ; module
// local modules/setremote-udp, contrat du pont dans docs/DMX-NATIVE.md § 9),
// aperçu PDF in-app de la table des canaux DMX (expo-print, src/lib/pdfPreview.ts).
// Les anciens écrans 100 % natifs (/native, /remote, /screen) et leurs
// transports en clair ont été retirés : la vue web est la seule interface.
//
// ── D'où vient l'interface ──
// Par défaut elle est EMBARQUÉE dans le binaire (plugins/with-embedded-web.js,
// scripts/embed-web.mjs) et chargée en file:// : rien n'est téléchargé au
// démarrage, l'app s'ouvre hors ligne, et aucun serveur tiers ne sert son
// interface (App Review 2.5.2 / 4.2, confidentialité).
//   iOS     : SetRemote.app/web/index.html, lecture limitée au dossier web/
//   Android : file:///android_asset/web/index.html
// file:// est un contexte sécurisé dans WKWebView et dans la WebView Android
// (getUserMedia, WebRTC, crypto.subtle) ; localStorage y est persistant.
//
// Option de DÉVELOPPEMENT uniquement : EXPO_PUBLIC_WEB_URL (par exemple l'URL
// GitHub Pages, ou http://<IP du poste>:8080/ servi depuis la racine du dépôt)
// fait charger cette URL à la place, sans rebuild natif. Ignorée hors __DEV__ :
// un build preview ou production charge toujours l'interface embarquée.
const DEV_WEB_URL = __DEV__ ? (process.env.EXPO_PUBLIC_WEB_URL ?? '').trim() : '';
const LOCAL = DEV_WEB_URL === '';
const DEV_ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(DEV_WEB_URL)?.[0] ?? '';

// Adresse publique de la PWA, à destination des AUTRES appareils (QR code et
// lien d'appairage ouverts dans un navigateur) : l'app ne la charge jamais.
// L'interface embarquée ayant une URL file://, elle ne peut pas la déduire de
// location ; elle la lit dans window.SETREMOTE_NATIVE.publicUrl.
const PUBLIC_WEB_URL = 'https://pierre-itsi.github.io/cine-light/';

function embeddedWeb(): { uri: string; readAccess?: string } {
  if (Platform.OS === 'android') return { uri: 'file:///android_asset/web/index.html' };
  // iOS : dossier du bundle .app, normalisé en URL file:// terminée par « / »
  let base = Paths.bundle.uri;
  if (!base.startsWith('file://')) base = 'file://' + encodeURI(base);
  if (!base.endsWith('/')) base += '/';
  return { uri: base + 'web/index.html', readAccess: base + 'web/' };
}
const WEB = LOCAL ? embeddedWeb() : { uri: DEV_WEB_URL, readAccess: undefined };
const SOURCE = { uri: WEB.uri };
// Tout ce qui sort de cette liste est ouvert hors de l'app ; le reste passe
// par onShouldStart, qui n'admet que l'interface elle-même.
const ORIGIN_WHITELIST = ['file://*', 'http://*', 'https://*', 'about:*', 'blob:*', 'data:*'];

// Exécuté avant le chargement de la page : la PWA sait qu'elle tourne dans
// l'app (masque l'installation PWA, délègue la luminosité au natif).
const INJECT_BEFORE = `
  window.SETREMOTE_NATIVE = { platform: '${Platform.OS}', bridge: 1, publicUrl: '${PUBLIC_WEB_URL}' };
  true;
`;

export default function AppShell() {
  useKeepAwake(); // l'écran de jeu comme la télécommande ne doivent jamais se mettre en veille
  const webRef = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Luminosité d'origine, restaurée quand l'app passe en arrière-plan
  // (sur iOS, la luminosité réglée par une app reste appliquée au système).
  const originalBrightness = useRef<number | null>(null);

  const restoreBrightness = useCallback(async () => {
    if (originalBrightness.current == null) return;
    const v = originalBrightness.current;
    originalBrightness.current = null;
    try {
      if (Platform.OS === 'android') await Brightness.restoreSystemBrightnessAsync();
      else await Brightness.setBrightnessAsync(v);
    } catch { /* indisponible : sans effet */ }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') restoreBrightness();
    });
    return () => { sub.remove(); restoreBrightness(); };
  }, [restoreBrightness]);

  // Passerelle DMX : dmx:listen / dmx:stop / udp:send / net:info venant de la
  // page ; datagrammes reçus remis par lots toutes les 20 ms via
  // window.SRNative.receive(). Le natif ferme les sockets en arrière-plan et
  // les rouvre au retour.
  const dmx = useRef<DmxBridge | null>(null);
  useEffect(() => {
    const bridge = createDmxBridge({
      native: SetRemoteUdp,
      inject: (script) => webRef.current?.injectJavaScript(script),
    });
    dmx.current = bridge;
    return () => { bridge.dispose(); dmx.current = null; };
  }, []);

  // L'écoute appartient au document qui l'a demandée : un nouveau document
  // (navigation, rechargement) l'arrête ; un changement d'ancre (#) non.
  const currentDoc = useRef<string | null>(null);
  const onLoadStart = useCallback((e: WebViewNavigationEvent) => {
    const doc = e.nativeEvent.url.split('#')[0];
    if (doc !== currentDoc.current || e.nativeEvent.navigationType === 'reload') dmx.current?.reset();
    currentDoc.current = doc;
  }, []);
  const reloadWeb = useCallback(() => {
    dmx.current?.reset();
    webRef.current?.reload();
  }, []);

  // Aperçu PDF (table des canaux DMX) : { type: 'pdf:preview', html, title }
  // venant de la page → feuille système d'impression / d'aperçu d'expo-print
  // (partage et « Enregistrer en PDF » compris). Échec → { type: 'pdf:error' }
  // via window.SRNative.receive ; fermer la feuille n'est pas un échec.
  // expo-print est chargé à la demande : un binaire de développement construit
  // sans lui répond « unavailable » au lieu de planter au lancement.
  const pdf = useMemo(() => createPdfPreviewer({
    platform: Platform.OS,
    loadPrint: () => {
      const Print = require('expo-print') as typeof import('expo-print');
      const print: PdfPrintFn = (options) => Print.printAsync(options);
      return print;
    },
    inject: (script) => webRef.current?.injectJavaScript(script),
  }), []);

  // Messages de la PWA → fonctions natives
  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: { type?: string; value?: unknown };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (dmx.current?.handle(msg)) return;
    if (pdf.handle(msg)) return;
    if (msg.type === 'brightness-restore') { restoreBrightness(); return; }
    if (msg.type === 'brightness' && typeof msg.value === 'number' && isFinite(msg.value)) {
      const v = Math.min(1, Math.max(0, msg.value));
      try {
        if (originalBrightness.current == null) {
          originalBrightness.current = await Brightness.getBrightnessAsync();
        }
        await Brightness.setBrightnessAsync(v);
      } catch { /* indisponible : sans effet */ }
    }
  }, [restoreBrightness, pdf]);

  // Les liens externes s'ouvrent dans le navigateur, pas dans la coque.
  // En local, toute page file:// est admise (index.html…) : la
  // WebView ne peut lire que le dossier web/ (iOS : allowingReadAccessToURL)
  // ou les assets de l'app (Android : allowFileAccess reste à false).
  const onShouldStart = useCallback((req: ShouldStartLoadRequest) => {
    const u = req.url;
    const isApp = LOCAL ? u.startsWith('file:') : (u === DEV_ORIGIN || u.startsWith(DEV_ORIGIN + '/'));
    if (isApp || u.startsWith('about:') || u.startsWith('blob:') || u.startsWith('data:')) {
      return true;
    }
    Linking.openURL(req.url).catch(() => {});
    return false;
  }, []);

  const retry = useCallback(() => { dmx.current?.reset(); setFailed(false); setReloadKey(k => k + 1); }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {/* Écran d'erreur inchangé (toute modification visible attend une
          maquette validée). Avec l'interface embarquée, il ne peut apparaître
          que si le paquet web/ manque au binaire, ce que le prebuild empêche. */}
      {failed ? (
        <View style={styles.error}>
          <Text style={styles.errorTitle}>Connexion impossible</Text>
          <Text style={styles.errorText}>
            SetRemote a besoin d'une connexion Internet pour démarrer.{'\n'}Vérifiez le Wi-Fi ou les données mobiles.
          </Text>
          <Pressable style={styles.retry} onPress={retry}>
            <Text style={styles.retryText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          key={reloadKey}
          ref={webRef}
          source={SOURCE}
          style={styles.web}
          containerStyle={styles.root}
          originWhitelist={ORIGIN_WHITELIST}
          // Interface embarquée (iOS) : lecture autorisée sur tout le dossier
          // web/ (sinon seul index.html serait lisible : ni mqtt.js ni polices)
          allowingReadAccessToURL={WEB.readAccess}
          // Pages file:// entre elles (polices chargées en mode CORS, blob:)
          // comme une même origine. allowUniversalAccessFromFileURLs reste
          // à false : aucune lecture http(s) hors CORS.
          allowFileAccessFromFileURLs={LOCAL}
          injectedJavaScriptBeforeContentLoaded={INJECT_BEFORE}
          onMessage={onMessage}
          onLoadStart={onLoadStart}
          onShouldStartLoadWithRequest={onShouldStart}
          onError={() => setFailed(true)}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
          // Le système iOS peut tuer le moteur web (mémoire) : on recharge
          onContentProcessDidTerminate={reloadWeb}
          onRenderProcessGone={reloadWeb}
          // Médias : lecture en ligne, sans geste requis (sonneries, vidéos, bande son)
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          // Caméra (torche) : l'autorisation système iOS / Android reste
          // demandée. En file://, l'hôte est vide : « grantIfSameHost… »
          // ajouterait une invite WebKit absente jusqu'ici ; l'interface
          // embarquée étant la nôtre, on accorde comme pour l'ancienne origine.
          mediaCapturePermissionGrantType={LOCAL ? 'grant' : 'grantIfSameHostElsePrompt'}
          // Rendu plein écran : la page gère elle-même les zones sûres (env(safe-area-inset-*))
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          bounces={false}
          overScrollMode="never"
          pullToRefreshEnabled={false}
          allowsBackForwardNavigationGestures={false}
          allowsLinkPreview={false}
          setSupportMultipleWindows={false}
          dataDetectorTypes="none"
          textInteractionEnabled={false}
          webviewDebuggingEnabled={__DEV__}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#0a0a0f' },
  errorTitle: { color: '#F5F2EC', fontSize: 22, fontWeight: '600', marginBottom: 12 },
  errorText: { color: '#8a8a8a', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  retry: { backgroundColor: '#FF6B2C', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 8 },
  retryText: { color: '#000000', fontSize: 16, fontWeight: '600' },
});
