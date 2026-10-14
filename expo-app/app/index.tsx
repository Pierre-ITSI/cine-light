import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import * as Brightness from 'expo-brightness';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

// Coque native de SetRemote : la PWA (fonctionnalités de référence) tourne dans
// une vue web plein écran ; le natif apporte ce que le web ne sait pas faire :
// barre d'état masquée en permanence, écran toujours allumé, vraie luminosité
// matérielle. Les anciens écrans 100 % natifs restent accessibles sur /native.
const APP_URL = 'https://pierre-itsi.github.io/cine-light/';
const APP_ORIGIN = 'https://pierre-itsi.github.io';

// Exécuté avant le chargement de la page : la PWA sait qu'elle tourne dans
// l'app (masque l'installation PWA, délègue la luminosité au natif).
const INJECT_BEFORE = `
  window.SETREMOTE_NATIVE = { platform: '${Platform.OS}', bridge: 1 };
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

  // Messages de la PWA → fonctions natives
  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: { type?: string; value?: unknown };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
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
  }, [restoreBrightness]);

  // Les liens externes s'ouvrent dans le navigateur, pas dans la coque
  const onShouldStart = useCallback((req: ShouldStartLoadRequest) => {
    if (req.url.startsWith(APP_ORIGIN) || req.url.startsWith('about:') || req.url.startsWith('blob:') || req.url.startsWith('data:')) {
      return true;
    }
    Linking.openURL(req.url).catch(() => {});
    return false;
  }, []);

  const retry = useCallback(() => { setFailed(false); setReloadKey(k => k + 1); }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
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
          source={{ uri: APP_URL }}
          style={styles.web}
          containerStyle={styles.root}
          originWhitelist={['https://*', 'about:*', 'blob:*', 'data:*']}
          injectedJavaScriptBeforeContentLoaded={INJECT_BEFORE}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStart}
          onError={() => setFailed(true)}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
          // Le système iOS peut tuer le moteur web (mémoire) : on recharge
          onContentProcessDidTerminate={() => webRef.current?.reload()}
          onRenderProcessGone={() => webRef.current?.reload()}
          // Médias : lecture en ligne, sans geste requis (sonneries, vidéos, bande son)
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
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
