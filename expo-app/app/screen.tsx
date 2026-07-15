import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, Vibration } from 'react-native';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import * as Brightness from 'expo-brightness';
import { ExitMenu } from '../src/components/ExitMenu';
import { MediaOverlay } from '../src/components/MediaOverlay';
import { TorchController, type TorchCommand } from '../src/components/TorchController';
import { createTransport } from '../src/transport/createTransport';
import type { RemoteTransport, TransportStatus, TransportMode } from '../src/transport/RemoteTransport';
import { AVAILABLE_MODES, MODE_LABELS, suggestMode } from '../src/lib/connectivity';
import {
  beginUpload, addChunk, getMedia, clearMedia, isMediaCacheAvailable,
  type CachedMedia,
} from '../src/lib/mediaCache';

type ScreenState = 'connect' | 'active' | 'disconnected';

interface StrobeMsg {
  active: boolean;
  random?: boolean;
  freq?: number;
  dur?: number;
  freqMin?: number;
  freqMax?: number;
  durMin?: number;
  durMax?: number;
  vibrate?: boolean;
}

export default function ScreenMode() {
  const router = useRouter();
  useKeepAwake();

  const transportRef = useRef<RemoteTransport | null>(null);
  const [transportStatus, setTransportStatus] = useState<TransportStatus>('idle');

  const [mode, setMode] = useState<TransportMode>('internet');
  const [suggested, setSuggested] = useState<TransportMode | null>(null);
  const [state, setState] = useState<ScreenState>('connect');
  const [channel, setChannel] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [bgColor, setBgColor] = useState('#000000');
  const [statusText, setStatusText] = useState('');
  const [playingMedia, setPlayingMedia] = useState<CachedMedia | null>(null);
  const playingMediaId = useRef<string | null>(null);
  // Réassemblage des images diffusées par la télécommande web (PWA index.html).
  const pwaImg = useRef<{ id: string; total: number; chunks: string[]; received: number } | null>(null);
  // « Avancer au clic sur l'écran » : piloté par la télécommande (media:autoadvance).
  const autoAdvance = useRef(false);
  const [blackout, setBlackout] = useState(false);
  const [torchCmd, setTorchCmd] = useState<TorchCommand | null>(null);
  // Luminosité matérielle de l'écran (0..1), pilotée par la télécommande. 1 = max.
  const [screenBrightness, setScreenBrightness] = useState(1);

  const strobeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strobeActive = useRef(false);

  const stopStrobe = useCallback(() => {
    strobeActive.current = false;
    if (strobeTimer.current) { clearTimeout(strobeTimer.current); strobeTimer.current = null; }
    if (Platform.OS !== 'web') Vibration.cancel();
  }, []);

  const runStrobe = useCallback((msg: StrobeMsg, baseColor: string) => {
    stopStrobe();
    if (!msg.active) return;
    strobeActive.current = true;
    function cycle() {
      if (!strobeActive.current) return;
      let freq = msg.freq ?? 2;
      let dur = msg.dur ?? 50;
      if (msg.random) {
        freq = (msg.freqMin ?? freq) + Math.random() * ((msg.freqMax ?? freq) - (msg.freqMin ?? freq));
        dur = (msg.durMin ?? dur) + Math.random() * ((msg.durMax ?? dur) - (msg.durMin ?? dur));
      }
      const interval = Math.max(dur + 5, 1000 / freq);
      setBgColor('#ffffff');
      // Vibration synchronisée : un buzz court à chaque flash (pattern dérivé du timing).
      if (msg.vibrate && Platform.OS !== 'web') {
        Vibration.vibrate(Math.min(Math.round(dur), 100));
      }
      strobeTimer.current = setTimeout(() => {
        setBgColor('#000000');
        if (strobeActive.current) strobeTimer.current = setTimeout(cycle, interval - dur);
      }, dur);
    }
    cycle();
  }, [stopStrobe]);

  const sendCaps = useCallback(() => {
    transportRef.current?.send({
      type: 'caps',
      // Natif : torche via expo-camera + vibration disponibles (iOS et Android).
      torch: Platform.OS !== 'web',
      vibrate: Platform.OS !== 'web',
      media: isMediaCacheAvailable,
      // Protocole vidéo accepté : l'écran natif lit la vidéo en base64 chunké
      // (media:upload/chunk/play), pas en WebRTC. La PWA s'y adapte.
      videoMode: isMediaCacheAvailable ? 'b64' : 'none',
    });
  }, []);

  // Crée (ou recrée) le transport pour le mode choisi et y rattache les
  // handlers de messages. Le reste de l'écran ignore le transport sous-jacent.
  const setupTransport = useCallback((m: TransportMode): RemoteTransport => {
    transportRef.current?.disconnect();
    const t = createTransport(m, 'screen');
    t.onStatusChange(setTransportStatus);
    t.onMessage(msg => {
      if (msg.type === 'color' && typeof msg.color === 'string') {
        stopStrobe();
        if (playingMediaId.current) { playingMediaId.current = null; setPlayingMedia(null); }
        setBgColor(msg.color);
      }
      if (msg.type === 'strobe') runStrobe(msg as unknown as StrobeMsg, '#000000');
      if (msg.type === 'vibrate' && Platform.OS !== 'web') {
        const pattern = msg.pattern;
        if (Array.isArray(pattern)) Vibration.vibrate(pattern as number[]);
      }
      if (msg.type === 'hello') sendCaps();

      // ── Écran ON/OFF (état conservé : l'overlay masque sans démonter) ──
      if (msg.type === 'blackout') setBlackout(!!msg.on);

      // ── Luminosité de l'écran pilotée à distance (0..1) ──
      if (msg.type === 'screen:brightness') {
        const v = Number(msg.value);
        if (!Number.isNaN(v)) setScreenBrightness(Math.min(1, Math.max(0, v)));
      }

      // ── Torche / Flash (expo-camera) ──
      if (msg.type === 'torch' && Platform.OS !== 'web') {
        const tmode = msg.mode === 'on' || msg.mode === 'flash' ? msg.mode : 'off';
        setTorchCmd({
          mode: tmode,
          onMs: typeof msg.onMs === 'number' ? msg.onMs : undefined,
          offMs: typeof msg.offMs === 'number' ? msg.offMs : undefined,
          repeats: typeof msg.repeats === 'number' ? msg.repeats : undefined,
          loop: msg.loop === true,
          nonce: Date.now(),
        });
      }

      // ── Pool Média ──
      if (msg.type === 'media:upload') {
        const already = beginUpload(
          String(msg.mediaId),
          msg.kind === 'video' ? 'video' : 'image',
          String(msg.mime || ''),
          Number(msg.totalChunks) || 0,
        );
        if (already) transportRef.current?.send({ type: 'media:ready', mediaId: msg.mediaId });
      }
      if (msg.type === 'media:chunk') {
        const entry = addChunk(String(msg.mediaId), Number(msg.index), String(msg.data));
        if (entry) transportRef.current?.send({ type: 'media:ready', mediaId: entry.mediaId });
      }
      if (msg.type === 'media:play') {
        const md = getMedia(String(msg.mediaId));
        if (md) { playingMediaId.current = md.mediaId; setPlayingMedia(md); }
      }
      if (msg.type === 'media:stop') {
        playingMediaId.current = null;
        setPlayingMedia(null);
      }
      if (msg.type === 'media:clear') {
        const id = String(msg.mediaId);
        clearMedia(id);
        if (id === 'all' || id === playingMediaId.current) {
          playingMediaId.current = null;
          setPlayingMedia(null);
        }
      }
      if (msg.type === 'media:autoadvance') {
        autoAdvance.current = !!msg.on;
      }

      // ── Compatibilité télécommande web (PWA index.html) ──
      // La PWA emploie un vocabulaire différent pour la torche et les images ;
      // on le traduit ici pour que l'écran natif réponde aux deux protocoles.

      // Torche : torch-onoff / torch-dim / torch-effect.
      if (msg.type === 'torch-onoff' && Platform.OS !== 'web') {
        setTorchCmd({ mode: msg.on ? 'on' : 'off', nonce: Date.now() });
      }
      if (msg.type === 'torch-dim' && Platform.OS !== 'web') {
        // La torche native est binaire (pas de gradation matérielle) : >0 ⇒ allumée.
        const level = typeof msg.level === 'number' ? msg.level : 0;
        setTorchCmd({ mode: level > 0 ? 'on' : 'off', nonce: Date.now() });
      }
      if (msg.type === 'torch-effect' && Platform.OS !== 'web') {
        const eff = String(msg.effect || '');
        if (eff === 'stop') {
          setTorchCmd({ mode: 'off', nonce: Date.now() });
        } else {
          const presets: Record<string, { onMs: number; offMs: number }> = {
            'blink-slow': { onMs: 600, offMs: 400 },
            'blink-fast': { onMs: 80, offMs: 80 },
            'police': { onMs: 60, offMs: 60 },
            'heartbeat': { onMs: 90, offMs: 200 },
            'sos': { onMs: 200, offMs: 200 },
          };
          const p = presets[eff] ?? { onMs: 120, offMs: 120 };
          setTorchCmd({ mode: 'flash', onMs: p.onMs, offMs: p.offMs, loop: true, nonce: Date.now() });
        }
      }

      // Images : media-img-start / media-img-chunk / media-stop. Les morceaux
      // reconstituent une data-URL JPEG affichable directement (expo-image).
      if (msg.type === 'media-img-start') {
        pwaImg.current = { id: String(msg.id), total: Number(msg.total) || 0, chunks: [], received: 0 };
      }
      if (msg.type === 'media-img-chunk' && pwaImg.current && String(msg.id) === pwaImg.current.id) {
        const buf = pwaImg.current;
        const i = Number(msg.i);
        if (buf.chunks[i] === undefined) { buf.chunks[i] = String(msg.data); buf.received++; }
        if (buf.total > 0 && buf.received >= buf.total) {
          const dataUrl = buf.chunks.join('');
          pwaImg.current = null;
          stopStrobe();
          playingMediaId.current = 'pwa-img';
          setPlayingMedia({ mediaId: 'pwa-img', kind: 'image', mime: 'image/jpeg', uri: dataUrl, date: Date.now() });
        }
      }
      if (msg.type === 'media-stop') {
        pwaImg.current = null;
        playingMediaId.current = null;
        setPlayingMedia(null);
      }
    });
    transportRef.current = t;
    return t;
  }, [runStrobe, stopStrobe, sendCaps]);

  // Suggestion indicative + nettoyage au démontage.
  useEffect(() => { suggestMode().then(setSuggested).catch(() => {}); }, []);
  useEffect(() => () => { transportRef.current?.disconnect(); stopStrobe(); }, [stopStrobe]);

  // Plein écran immersif : masquer la barre de navigation Android en mode actif.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (state === 'active') {
      NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    } else {
      NavigationBar.setVisibilityAsync('visible').catch(() => {});
    }
    return () => { NavigationBar.setVisibilityAsync('visible').catch(() => {}); };
  }, [state]);

  // Forçage de la luminosité tant que l'écran est connecté à un canal (quel que
  // soit le mode : code canal / Wi-Fi / Bluetooth). Par défaut au maximum (1),
  // ajustable à distance via la télécommande (message screen:brightness). On
  // restaure la luminosité système en quittant l'état actif ou au démontage.
  // La non-mise-en-veille est, elle, déjà garantie par useKeepAwake() ci-dessus.
  useEffect(() => {
    if (Platform.OS === 'web' || state !== 'active') return;
    let cancelled = false;
    (async () => {
      try {
        if (await Brightness.isAvailableAsync() && !cancelled) {
          await Brightness.setBrightnessAsync(screenBrightness);
        }
      } catch (_) { /* indisponible : on garde la luminosité courante */ }
    })();
    return () => {
      cancelled = true;
      // restoreSystemBrightnessAsync est Android-only ; sur iOS la luminosité
      // revient d'elle-même au verrouillage. On ignore les erreurs éventuelles.
      Brightness.restoreSystemBrightnessAsync().catch(() => {});
    };
  }, [state, screenBrightness]);

  useEffect(() => {
    if (transportStatus === 'connected') {
      setState('active');
      setStatusText('✓ En écoute — canal : ' + channel);
      sendCaps();
    } else if (transportStatus === 'connecting') {
      setStatusText('Connexion…');
    } else if (transportStatus === 'error') {
      setStatusText('Erreur broker — rechargez');
    }
  }, [transportStatus]);

  const connect = useCallback(() => {
    let ch = channelInput.trim();
    if (mode === 'internet') ch = ch.toLowerCase();
    // Bluetooth : pas de saisie (scan/annonce direct). Wi-Fi : « ip:port ».
    if (mode !== 'bluetooth' && !ch) return;
    setChannel(ch || MODE_LABELS[mode]);
    setStatusText('Connexion…');
    const t = setupTransport(mode);
    t.connect(ch);
  }, [channelInput, mode, setupTransport]);

  const handleDisconnect = useCallback(() => {
    transportRef.current?.disconnect();
    stopStrobe();
    setBgColor('#000000');
    setBlackout(false);
    setStatusText('Déconnecté');
    setState('disconnected');
  }, [stopStrobe]);

  const handleChangeChannel = useCallback(() => {
    transportRef.current?.disconnect();
    stopStrobe();
    setBgColor('#000000');
    setBlackout(false);
    setChannelInput('');
    setState('connect');
  }, [stopStrobe]);

  const handleHome = useCallback(() => {
    transportRef.current?.disconnect();
    stopStrobe();
    router.replace('/');
  }, [stopStrobe, router]);

  // Tap sur l'écran : si la télécommande a activé l'option, demande le média
  // suivant (la télécommande détient l'ordre du pool et diffuse le M+1).
  const handleScreenTap = useCallback(() => {
    if (autoAdvance.current && playingMediaId.current) {
      transportRef.current?.send({ type: 'media:advance', dir: 1 });
    }
  }, []);

  if (state === 'connect') {
    return (
      <View style={styles.connect}>
        <StatusBar style="light" />
        <Text style={styles.connectTitle}>Écran projecteur</Text>

        {AVAILABLE_MODES.length > 1 && (
          <View style={styles.modeRow}>
            {AVAILABLE_MODES.map(m => (
              <Pressable
                key={m}
                style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>
                  {MODE_LABELS[m]}
                </Text>
                {suggested === m && <Text style={styles.modeBadge}>recommandé</Text>}
              </Pressable>
            ))}
          </View>
        )}

        {mode !== 'bluetooth' && (
          <>
            <Text style={styles.connectSub}>
              {mode === 'wifi'
                ? 'Adresse de la télécommande (ip:port)'
                : 'Entrez le code canal de la télécommande'}
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={channelInput}
                onChangeText={setChannelInput}
                placeholder={mode === 'wifi' ? 'ex : 192.168.1.5:8777' : 'ex : cine4271'}
                placeholderTextColor="#555"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={mode === 'wifi' ? 'numbers-and-punctuation' : 'default'}
                onSubmitEditing={connect}
              />
              <Pressable style={styles.goBtn} onPress={connect}>
                <Text style={styles.goBtnText}>OK</Text>
              </Pressable>
            </View>
          </>
        )}

        {mode === 'bluetooth' && (
          <>
            <Text style={styles.connectSub}>Liaison Bluetooth directe</Text>
            <Text style={styles.bleNote}>
              ⚠️ Le mode périphérique BLE (écran annonçant le service) nécessite
              un module natif dédié, non encore intégré. À finaliser et valider
              sur appareil. La télécommande (rôle central) est, elle, prête.
            </Text>
            <Pressable style={styles.goBtnWide} onPress={connect}>
              <Text style={styles.goBtnText}>Démarrer l’annonce</Text>
            </Pressable>
          </>
        )}

        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Retour</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: bgColor }]}>
      <StatusBar style="light" hidden />
      {playingMedia && <MediaOverlay media={playingMedia} />}
      <Pressable style={styles.tapLayer} onPress={handleScreenTap} />
      {blackout && <View style={styles.blackout} pointerEvents="none" />}
      {Platform.OS !== 'web' && <TorchController command={torchCmd} />}
      {state === 'disconnected' && (
        <View style={styles.disconnectedWrap}>
          <Text style={styles.disconnectedText}>Déconnecté</Text>
          <Pressable style={styles.reconnectBtn} onPress={() => setState('connect')}>
            <Text style={styles.reconnectBtnText}>Reconnecter</Text>
          </Pressable>
        </View>
      )}
      <ExitMenu
        channel={channel}
        onResume={() => {}}
        onChangeChannel={handleChangeChannel}
        onHome={handleHome}
        onDisconnect={handleDisconnect}
        onClearCache={isMediaCacheAvailable ? () => {
          clearMedia('all');
          playingMediaId.current = null;
          setPlayingMedia(null);
        } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  connect: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 32,
  },
  connectTitle: {
    color: '#FF6B2C',
    fontSize: 24,
    fontWeight: '500',
    textAlign: 'center',
  },
  connectSub: {
    color: '#777',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  inputRow: { flexDirection: 'row', gap: 10, width: '100%', maxWidth: 340 },
  input: {
    flex: 1,
    backgroundColor: '#1c1c1f',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    color: '#F5F2EC',
    fontSize: 18,
    padding: 14,
    borderRadius: 6,
    letterSpacing: 2,
    textAlign: 'center',
  },
  goBtn: {
    backgroundColor: '#FF6B2C',
    paddingHorizontal: 20,
    borderRadius: 6,
    justifyContent: 'center',
  },
  goBtnText: { color: '#000', fontWeight: '600', fontSize: 14 },
  goBtnWide: {
    backgroundColor: '#FF6B2C',
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: 6,
    alignItems: 'center', alignSelf: 'stretch', maxWidth: 340,
  },
  modeRow: { flexDirection: 'row', gap: 8, width: '100%', maxWidth: 340 },
  modeBtn: {
    flex: 1,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#1c1c1f',
    paddingVertical: 10, borderRadius: 8, alignItems: 'center', gap: 3,
  },
  modeBtnActive: { borderColor: '#FF6B2C', backgroundColor: 'rgba(255,107,44,0.12)' },
  modeBtnText: { color: '#F5F2EC', fontSize: 11 },
  modeBtnTextActive: { color: '#FF6B2C' },
  modeBadge: { color: '#FF6B2C', fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  bleNote: {
    color: '#FF6B2C', fontSize: 11, lineHeight: 17,
    textAlign: 'center', maxWidth: 340,
  },
  backBtn: { marginTop: 8 },
  backBtnText: { color: '#555', fontSize: 12 },
  screen: {
    flex: 1,
    position: 'relative',
  },
  tapLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 200,
  },
  blackout: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000000',
    zIndex: 500,
  },
  pill: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 24,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    zIndex: 100,
  },
  disconnectedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  disconnectedText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    letterSpacing: 1,
  },
  reconnectBtn: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 6,
  },
  reconnectBtnText: { color: '#F5F2EC', fontSize: 13 },
});
