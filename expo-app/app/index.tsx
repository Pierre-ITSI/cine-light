// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Brightness from 'expo-brightness';
import { Directory, File, Paths } from 'expo-file-system';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest, WebViewNavigationEvent } from 'react-native-webview/lib/WebViewTypes';
import SetRemoteLink, { createLinkBridge, type LinkBridge } from '../modules/setremote-link';
import SetRemoteUdp, { createDmxBridge, type DmxBridge } from '../modules/setremote-udp';
import SetRemoteAudio, { createAudioBridge, type AudioBridge, type AudioTempFile } from '../modules/setremote-audio';
import { createPdfPreviewer, type PdfPrintFn } from '../src/lib/pdfPreview';
import { createProjectBridge, PROJECT_PICK_TYPES, type PickedFile, type TempFile } from '../src/lib/projectFiles';
import { nativeBootstrapScript } from '../src/config';

// Coque native de SetRemote : la PWA (fonctionnalités de référence) tourne dans
// une vue web plein écran ; le natif apporte ce que le web ne sait pas faire :
// barre d'état masquée en permanence, écran toujours allumé, vraie luminosité
// matérielle, réception UDP pour la passerelle DMX (sACN, Art-Net ; module
// local modules/setremote-udp, contrat du pont dans docs/DMX-NATIVE.md § 9),
// liaisons hors ligne télécommande ↔ écrans en Wi-Fi local et en Bluetooth LE
// (module local modules/setremote-link, contrat dans docs/OFFLINE-NATIVE.md),
// aperçu PDF in-app de la table des canaux DMX (expo-print, src/lib/pdfPreview.ts),
// vibreur de l'écran de jeu (Vibration de React Native, la vue web n'en a pas),
// fichiers projet .rem (feuille de partage, sélecteur de fichier :
// src/lib/projectFiles.ts, docs/PROJECTS.md § 6),
// audio de l'appel décroché de l'écran de jeu : voix jouée par le natif, écouteur ou
// haut-parleur, écran noir contre l'oreille (module local modules/setremote-audio,
// contrat du pont dans docs/CALL-AUDIO-NATIVE.md).
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
// l'app et connaît son adresse publique (PUBLIC_WEB_URL, src/config.ts).
// caps.audioRoute : la page n'envoie audio:* que si le binaire embarque le module (sinon : voix en WebAudio).
const INJECT_BEFORE = nativeBootstrapScript(Platform.OS, undefined, { audioRoute: SetRemoteAudio != null });

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

  // Liaisons hors ligne télécommande ↔ écrans (Wi-Fi local, Bluetooth LE) :
  // link:start / link:stop / link:send / link:state? venant de la page ;
  // trames reçues remises par lots toutes les 20 ms, pairs, état et erreurs
  // via window.SRNative.receive(). Trames opaques (chiffrées par la page) ;
  // le natif coupe les liaisons en arrière-plan et les rouvre au retour.
  const link = useRef<LinkBridge | null>(null);
  useEffect(() => {
    const bridge = createLinkBridge({
      native: SetRemoteLink,
      inject: (script) => webRef.current?.injectJavaScript(script),
    });
    link.current = bridge;
    return () => { bridge.dispose(); link.current = null; };
  }, []);

  // Audio de l'appel décroché : audio:load (bande son en morceaux → fichier temporaire du cache),
  // audio:call-start / audio:play / audio:route / audio:call-end venant de la page ; état du
  // module (sortie, proximité) et erreurs remis via window.SRNative.receive(). Un nouveau document
  // (rechargement) met fin à l'appel et efface les fichiers temporaires.
  const audio = useRef<AudioBridge | null>(null);
  useEffect(() => {
    const bridge = createAudioBridge({
      native: SetRemoteAudio,
      createTemp: (name) => {
        const dir = new Directory(Paths.cache, 'appels-audio');
        if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
        const f = new File(dir, name);
        if (f.exists) f.delete();
        f.create();
        const t: AudioTempFile = {
          write: (b64, append) => f.write(b64, { encoding: 'base64', append }),
          get uri() { return f.uri; },
          delete: () => { try { f.delete(); } catch { /* déjà supprimé */ } },
        };
        return t;
      },
      inject: (script) => webRef.current?.injectJavaScript(script),
    });
    audio.current = bridge;
    return () => { bridge.dispose(); audio.current = null; };
  }, []);

  // Écoute DMX et liaisons appartiennent au document qui les a demandées : un
  // nouveau document (navigation, rechargement) les arrête ; un changement
  // d'ancre (#) non.
  const resetBridges = useCallback(() => {
    dmx.current?.reset();
    link.current?.reset();
    audio.current?.reset();
  }, []);
  const currentDoc = useRef<string | null>(null);
  const onLoadStart = useCallback((e: WebViewNavigationEvent) => {
    const doc = e.nativeEvent.url.split('#')[0];
    if (doc !== currentDoc.current || e.nativeEvent.navigationType === 'reload') resetBridges();
    currentDoc.current = doc;
  }, [resetBridges]);
  const reloadWeb = useCallback(() => {
    resetBridges();
    webRef.current?.reload();
  }, [resetBridges]);

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

  // Fichiers projet .rem : project:save (morceaux base64 → fichier
  // temporaire du cache → feuille de partage d'expo-sharing) et project:open
  // (sélecteur de fichier d'expo-file-system → morceaux renvoyés par
  // window.SRNative.receive). expo-sharing est chargé à la demande : un
  // binaire de développement sans lui répond « unavailable ».
  const project = useMemo(() => createProjectBridge({
    createTemp: (name) => {
      const dir = new Directory(Paths.cache, 'projets');
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const f = new File(dir, name);
      if (f.exists) f.delete();
      f.create();
      const t: TempFile = {
        write: (b64, append) => f.write(b64, { encoding: 'base64', append }),
        get uri() { return f.uri; },
        get size() { return f.size ?? 0; },
        delete: () => { try { f.delete(); } catch { /* déjà supprimé */ } },
      };
      return t;
    },
    loadShare: () => {
      const Sharing = require('expo-sharing') as typeof import('expo-sharing');
      return (uri, o) => Sharing.shareAsync(uri, o);
    },
    pick: async () => {
      const r = await File.pickFileAsync({ mimeTypes: PROJECT_PICK_TYPES });
      if (r.canceled || !r.result) return null;
      const f = r.result;
      const h = f.open();
      const p: PickedFile = {
        name: f.name,
        size: f.size ?? 0,
        read: (n) => h.readBytes(n),
        close: () => h.close(),
      };
      return p;
    },
    inject: (script) => webRef.current?.injectJavaScript(script),
  }), []);

  // Messages de la PWA → fonctions natives
  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: { type?: string; value?: unknown };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (link.current?.handle(msg)) return;
    if (dmx.current?.handle(msg)) return;
    if (audio.current?.handle(msg)) return;
    if (pdf.handle(msg)) return;
    if (project.handle(msg)) return;
    if (msg.type === 'brightness-restore') { restoreBrightness(); return; }
    // Vibreur de l'écran de jeu (maquette 36b) : la vue web Android ne sait pas
    // vibrer (navigator.vibrate sans effet), iOS non plus. pattern = durées en
    // ms (vibre, pause, vibre…), bornées ; la page répète elle-même le motif
    // d'un appel qui sonne. Indisponible : sans effet.
    if (msg.type === 'vibrate') {
      const p = (msg as { pattern?: unknown }).pattern;
      const list = Array.isArray(p) ? p : [p];
      const ms = list.slice(0, 20).map((v) => (typeof v === 'number' && isFinite(v) ? Math.min(2000, Math.max(0, Math.round(v))) : 0));
      try {
        if (ms.length === 1) Vibration.vibrate(ms[0]);
        else if (ms.length > 1) Vibration.vibrate([0, ...ms]); // Android : le motif commence par une attente
      } catch { /* indisponible : sans effet */ }
      return;
    }
    if (msg.type === 'vibrate:stop') { try { Vibration.cancel(); } catch { /* sans effet */ } return; }
    if (msg.type === 'brightness' && typeof msg.value === 'number' && isFinite(msg.value)) {
      const v = Math.min(1, Math.max(0, msg.value));
      try {
        if (originalBrightness.current == null) {
          originalBrightness.current = await Brightness.getBrightnessAsync();
        }
        await Brightness.setBrightnessAsync(v);
      } catch { /* indisponible : sans effet */ }
    }
  }, [restoreBrightness, pdf, project]);

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

  const retry = useCallback(() => { resetBridges(); setFailed(false); setReloadKey(k => k + 1); }, [resetBridges]);

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
  // Fond natif noir : visible sous le clavier (Android adjustResize) et au rebond iOS. La page web
  // colore html/body (83-discussion.js) mais pas cette vue ; pour un fond identique à la discussion,
  // relayer la couleur via un message pont (ex. {type:'bg', color}) et l'appliquer ici (état React).
  root: { flex: 1, backgroundColor: '#000000' },
  web: { flex: 1, backgroundColor: '#000000' },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#0a0a0f' },
  errorTitle: { color: '#F5F2EC', fontSize: 22, fontWeight: '600', marginBottom: 12 },
  errorText: { color: '#8a8a8a', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  retry: { backgroundColor: '#FF6B2C', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 8 },
  retryText: { color: '#000000', fontSize: 16, fontWeight: '600' },
});
