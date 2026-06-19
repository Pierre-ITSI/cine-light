import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Platform, Switch, PanResponder,
} from 'react-native';
import { useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { ColorWheel } from '../src/components/ColorWheel';
import { computeColor, ColorSpec } from '../src/lib/color';
import { generateChannel } from '../src/lib/channel';
import { useMediaPool } from '../src/lib/useMediaPool';
import { MqttTransport } from '../src/transport/MqttTransport';
import type { TransportStatus } from '../src/transport/RemoteTransport';

const MEDIA_ENABLED = Platform.OS !== 'web';
const FLASH_ENABLED = Platform.OS !== 'web';

type Tab = 'color' | 'strobe' | 'flash' | 'media' | 'channel';

function useTransport() {
  const transport = useRef(new MqttTransport()).current;
  const [status, setStatus] = useState<TransportStatus>('idle');
  useEffect(() => {
    transport.onStatusChange(setStatus);
    return () => transport.disconnect();
  }, []);
  return { transport, status };
}

export default function RemoteScreen() {
  const router = useRouter();
  const { transport, status } = useTransport();

  const [channel, setChannel] = useState(generateChannel);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<Tab>('color');

  const [spec, setSpec] = useState<ColorSpec>({
    kelvin: 5600, tint: 0, dimmer: 100, wheelHex: '#ffffff', crossfade: 0,
  });
  const color = useMemo(() => computeColor(spec), [spec]);

  const [strobeActive, setStrobeActive] = useState(false);
  const [strobeFreq, setStrobeFreq] = useState(2);
  const [strobeDur, setStrobeDur] = useState(50);
  const [strobeRandom, setStrobeRandom] = useState(false);
  const [strobeFreqMax, setStrobeFreqMax] = useState(8);
  const [strobeDurMax, setStrobeDurMax] = useState(200);
  const [strobeVibrate, setStrobeVibrate] = useState(false);

  const [caps, setCaps] = useState({ torch: true, vibrate: true });
  const [torchState, setTorchState] = useState<'off' | 'on' | 'flash'>('off');

  const media = useMediaPool(transport, connected && MEDIA_ENABLED);
  const [screenOn, setScreenOn] = useState(true);

  // Capacités annoncées par l'écran connecté (torche/vibreur selon plateforme).
  useEffect(() => {
    transport.onMessage(msg => {
      if (msg.type === 'caps') setCaps({ torch: !!msg.torch, vibrate: !!msg.vibrate });
    });
  }, [transport]);

  const setTorch = useCallback((mode: 'off' | 'on' | 'flash', opts?: { loop?: boolean }) => {
    if (mode === 'flash') {
      transport.send(opts?.loop
        ? { type: 'torch', mode: 'flash', loop: true }
        : { type: 'torch', mode: 'flash', onMs: 150, offMs: 150, repeats: 6 });
    } else {
      transport.send({ type: 'torch', mode });
    }
    setTorchState(mode);
  }, [transport]);

  const vibrateNow = useCallback(() => {
    transport.send({ type: 'vibrate', pattern: [0, 200, 100, 200], repeat: false });
  }, [transport]);

  const toggleScreen = useCallback(() => {
    setScreenOn(on => {
      const next = !on;
      transport.send({ type: 'blackout', on: !next });
      return next;
    });
  }, [transport]);

  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleColorSend = useCallback(() => {
    if (!connected) return;
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      transport.send({ type: 'color', color });
    }, 30);
  }, [connected, transport, color]);

  useEffect(() => { scheduleColorSend(); }, [color]);

  const updateSpec = useCallback((partial: Partial<ColorSpec>) => {
    setSpec(s => ({ ...s, ...partial }));
  }, []);

  const connect = useCallback(() => {
    const ch = channel.trim().toLowerCase();
    if (!ch) return;
    transport.connect(ch);
  }, [channel, transport]);

  useEffect(() => {
    if (status === 'connected') {
      setConnected(true);
      setScreenOn(true);
      setTorchState('off');
      transport.send({ type: 'color', color });
      transport.send({ type: 'hello' });
    } else if (status === 'disconnected' || status === 'error') {
      setConnected(false);
    }
  }, [status]);

  const sendStrobe = useCallback(() => {
    transport.send({
      type: 'strobe',
      active: strobeActive,
      random: strobeRandom,
      freq: strobeFreq,
      dur: strobeDur,
      freqMin: strobeFreq,
      freqMax: strobeFreqMax,
      durMin: strobeDur,
      durMax: strobeDurMax,
      vibrate: strobeVibrate,
    });
  }, [transport, strobeActive, strobeRandom, strobeFreq, strobeDur, strobeFreqMax, strobeDurMax, strobeVibrate]);

  useEffect(() => {
    if (!connected) return;
    if (strobeActive) sendStrobe();
    else transport.send({ type: 'strobe', active: false });
  }, [strobeActive]);

  useEffect(() => {
    if (!connected || !strobeActive) return;
    sendStrobe();
  }, [strobeFreq, strobeDur, strobeRandom, strobeFreqMax, strobeDurMax, strobeVibrate]);

  const statusLabel: Record<TransportStatus, string> = {
    idle: 'Non connecté',
    connecting: 'Connexion…',
    connected: '✓ Connecté',
    error: 'Erreur broker',
    disconnected: 'Déconnecté',
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Retour</Text>
        </Pressable>
        <Text style={styles.title}>Ciné Light</Text>
        <View style={styles.headerRight}>
          <Pressable
            style={[
              styles.powerBtn,
              !connected && styles.powerBtnDisabled,
              connected && !screenOn && styles.powerBtnOff,
            ]}
            disabled={!connected}
            onPress={toggleScreen}
          >
            <Text style={[styles.powerBtnText, connected && !screenOn && styles.powerBtnTextOff]}>
              ⏻ {screenOn ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
          <View style={[styles.statusDot, connected ? styles.dotGreen : styles.dotGray]} />
        </View>
      </View>

      <View style={styles.colorPreview}>
        <View style={[styles.previewSwatch, { backgroundColor: color }]} />
        <Text style={styles.colorHex}>{color}</Text>
        <Text style={styles.statusText}>{statusLabel[status]}</Text>
      </View>

      <View style={styles.tabs}>
        {(['color', 'strobe', 'flash', 'media', 'channel'] as Tab[])
          .filter(t => (t !== 'media' || MEDIA_ENABLED) && (t !== 'flash' || FLASH_ENABLED))
          .map(t => (
            <Pressable key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
                {t === 'color' ? 'Couleur'
                  : t === 'strobe' ? 'Strobe'
                  : t === 'flash' ? 'Flash'
                  : t === 'media' ? 'Média'
                  : 'Canal'}
              </Text>
            </Pressable>
          ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {tab === 'color' && (
          <View style={styles.panel}>
            <ColorWheel size={220} onPick={hex => { updateSpec({ wheelHex: hex, crossfade: Math.max(spec.crossfade, 20) }); }} />
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Luminosité {spec.dimmer}%</Text>
              <SliderRN min={0} max={100} value={spec.dimmer} onChange={v => updateSpec({ dimmer: v })} />
            </View>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Température {spec.kelvin.toLocaleString('fr')} K</Text>
              <SliderRN min={1700} max={20000} value={spec.kelvin} onChange={v => updateSpec({ kelvin: v })} />
            </View>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Tint {spec.tint >= 0 ? '+' : ''}{spec.tint} GM</Text>
              <SliderRN min={-100} max={100} value={spec.tint} onChange={v => updateSpec({ tint: v })} />
            </View>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Couleur {spec.crossfade}%</Text>
              <SliderRN min={0} max={100} value={spec.crossfade} onChange={v => updateSpec({ crossfade: v })} />
            </View>
          </View>
        )}

        {tab === 'strobe' && (
          <View style={styles.panel}>
            <View style={styles.toggleRow}>
              <Text style={styles.sliderLabel}>Strobe actif</Text>
              <Switch
                value={strobeActive}
                onValueChange={setStrobeActive}
                trackColor={{ true: '#e8c97a' }}
              />
            </View>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Fréquence {strobeFreq.toFixed(1)} Hz</Text>
              <SliderRN min={0.5} max={20} step={0.5} value={strobeFreq} onChange={setStrobeFreq} />
            </View>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Durée flash {strobeDur} ms</Text>
              <SliderRN min={10} max={500} step={5} value={strobeDur} onChange={setStrobeDur} />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.sliderLabel}>Mode aléatoire</Text>
              <Switch
                value={strobeRandom}
                onValueChange={setStrobeRandom}
                trackColor={{ true: '#e8c97a' }}
              />
            </View>
            {strobeRandom && (
              <>
                <View style={styles.sliderRow}>
                  <Text style={styles.sliderLabel}>Fréq. max {strobeFreqMax.toFixed(1)} Hz</Text>
                  <SliderRN min={strobeFreq} max={30} step={0.5} value={strobeFreqMax} onChange={setStrobeFreqMax} />
                </View>
                <View style={styles.sliderRow}>
                  <Text style={styles.sliderLabel}>Durée max {strobeDurMax} ms</Text>
                  <SliderRN min={strobeDur} max={1000} step={10} value={strobeDurMax} onChange={setStrobeDurMax} />
                </View>
              </>
            )}
            <View style={styles.toggleRow}>
              <Text style={styles.sliderLabel}>Synchroniser le vibreur</Text>
              <Switch
                value={strobeVibrate}
                onValueChange={setStrobeVibrate}
                disabled={!caps.vibrate}
                trackColor={{ true: '#e8c97a' }}
              />
            </View>
            {!caps.vibrate && (
              <Text style={styles.flashUnavailable}>
                L'écran connecté ne prend pas en charge le vibreur.
              </Text>
            )}
          </View>
        )}

        {tab === 'flash' && (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Torche de l'écran</Text>
            <Text style={styles.mediaHint}>
              Pilote le flash matériel de l'appareil qui sert d'écran projecteur.
              Idéal comme signal lumineux ou notification sur le plateau.
            </Text>
            {!connected && (
              <Text style={styles.mediaWarn}>Connectez un canal pour piloter la torche.</Text>
            )}
            {connected && !caps.torch && (
              <Text style={styles.flashUnavailable}>
                L'écran connecté ne dispose pas d'une torche pilotable.
              </Text>
            )}
            <View style={styles.flashGrid}>
              <Pressable
                style={[
                  styles.flashBtn,
                  torchState === 'on' && styles.flashBtnActive,
                  (!connected || !caps.torch) && styles.mediaBtnDisabled,
                ]}
                disabled={!connected || !caps.torch}
                onPress={() => setTorch(torchState === 'on' ? 'off' : 'on')}
              >
                <Text style={styles.flashBtnIcon}>🔦</Text>
                <Text style={styles.flashBtnText}>{torchState === 'on' ? 'Éteindre' : 'Allumer'}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.flashBtn,
                  (!connected || !caps.torch) && styles.mediaBtnDisabled,
                ]}
                disabled={!connected || !caps.torch}
                onPress={() => setTorch('flash')}
              >
                <Text style={styles.flashBtnIcon}>✨</Text>
                <Text style={styles.flashBtnText}>Flash notif</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.flashBtn,
                  torchState === 'flash' && styles.flashBtnActive,
                  (!connected || !caps.torch) && styles.mediaBtnDisabled,
                ]}
                disabled={!connected || !caps.torch}
                onPress={() => setTorch(torchState === 'flash' ? 'off' : 'flash', { loop: true })}
              >
                <Text style={styles.flashBtnIcon}>⚡</Text>
                <Text style={styles.flashBtnText}>{torchState === 'flash' ? 'Stop' : 'Flash continu'}</Text>
              </Pressable>
            </View>

            <View style={styles.flashDivider} />

            <Text style={styles.panelLabel}>Vibreur de l'écran</Text>
            <Pressable
              style={[
                styles.mediaBtn,
                { alignSelf: 'stretch' },
                (!connected || !caps.vibrate) && styles.mediaBtnDisabled,
              ]}
              disabled={!connected || !caps.vibrate}
              onPress={vibrateNow}
            >
              <Text style={styles.mediaBtnText}>📳  Vibrer maintenant</Text>
            </Pressable>
            {connected && !caps.vibrate && (
              <Text style={styles.flashUnavailable}>
                L'écran connecté ne prend pas en charge le vibreur.
              </Text>
            )}
          </View>
        )}

        {tab === 'media' && (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Pool média</Text>
            <Text style={styles.mediaHint}>
              Transférez vos médias à l'avance : ils sont mis en cache sur l'écran
              et se déclenchent instantanément pendant la prise.
            </Text>
            {!connected && (
              <Text style={styles.mediaWarn}>Connectez un canal pour transférer des médias.</Text>
            )}
            <View style={styles.mediaActions}>
              <Pressable
                style={[styles.mediaBtn, !connected && styles.mediaBtnDisabled]}
                disabled={!connected}
                onPress={() => media.pickAndUpload('image')}
              >
                <Text style={styles.mediaBtnText}>🖼  Ajouter une image</Text>
              </Pressable>
              <Pressable
                style={[styles.mediaBtn, !connected && styles.mediaBtnDisabled]}
                disabled={!connected}
                onPress={() => media.pickAndUpload('video')}
              >
                <Text style={styles.mediaBtnText}>🎬  Ajouter une vidéo</Text>
              </Pressable>
            </View>

            {media.items.length === 0 && (
              <Text style={styles.mediaEmpty}>Aucun média transféré.</Text>
            )}

            {media.items.map(item => (
              <View key={item.id} style={styles.mediaItem}>
                <View style={styles.mediaItemHead}>
                  <Text style={styles.mediaItemName} numberOfLines={1}>
                    {item.kind === 'video' ? '🎬' : '🖼'} {item.name}
                  </Text>
                  <Text style={styles.mediaItemStatus}>
                    {item.status === 'uploading'
                      ? `Transfert ${Math.round(item.progress * 100)}%`
                      : item.status === 'ready'
                        ? '✓ En cache'
                        : '⚠ Erreur'}
                  </Text>
                </View>
                {item.status === 'uploading' && (
                  <View style={styles.mediaProgressTrack}>
                    <View style={[styles.mediaProgressFill, { width: `${item.progress * 100}%` }]} />
                  </View>
                )}
                <View style={styles.mediaItemActions}>
                  <Pressable
                    style={[
                      styles.mediaSmallBtn,
                      styles.mediaPlayBtn,
                      item.status !== 'ready' && styles.mediaBtnDisabled,
                      media.playingId === item.id && styles.mediaPlayBtnActive,
                    ]}
                    disabled={item.status !== 'ready'}
                    onPress={() => media.play(item.id)}
                  >
                    <Text style={styles.mediaSmallBtnText}>
                      {media.playingId === item.id ? '▶ En lecture' : '▶ Jouer'}
                    </Text>
                  </Pressable>
                  {media.playingId === item.id && (
                    <Pressable style={styles.mediaSmallBtn} onPress={media.stop}>
                      <Text style={styles.mediaSmallBtnText}>■ Stop</Text>
                    </Pressable>
                  )}
                  <Pressable style={styles.mediaSmallBtn} onPress={() => media.clear(item.id)}>
                    <Text style={[styles.mediaSmallBtnText, styles.mediaDanger]}>✕</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {tab === 'channel' && (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Code canal</Text>
            <View style={styles.channelRow}>
              <TextInput
                style={styles.channelInput}
                value={channel}
                onChangeText={setChannel}
                placeholder="ex : cine4271"
                placeholderTextColor="#555"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable style={styles.connectBtn} onPress={connect}>
                <Text style={styles.connectBtnText}>{connected ? 'Reconnecter' : 'Connecter'}</Text>
              </Pressable>
            </View>
            {connected && (
              <View style={styles.qrWrap}>
                <QRCode value={channel} size={180} color="#f0ede8" backgroundColor="#000000" />
                <Text style={styles.qrLabel}>Montrez ce QR à l'écran projecteur</Text>
              </View>
            )}
            {!connected && (
              <Pressable style={styles.generateBtn} onPress={() => setChannel(generateChannel())}>
                <Text style={styles.generateBtnText}>Générer un code aléatoire</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

interface SliderProps {
  min: number; max: number; value: number;
  step?: number;
  onChange: (v: number) => void;
}

function SliderRN({ min, max, value, step = 1, onChange }: SliderProps) {
  const progress = (value - min) / (max - min);
  const trackWidthRef = useRef(300);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const paramsRef = useRef({ min, max, step });
  paramsRef.current = { min, max, step };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { min: mn, max: mx, step: st } = paramsRef.current;
        const ratio = Math.min(1, Math.max(0, e.nativeEvent.locationX / trackWidthRef.current));
        let v = mn + ratio * (mx - mn);
        if (st > 0) v = Math.round(v / st) * st;
        onChangeRef.current(Number(v.toFixed(st < 1 ? 1 : 0)));
      },
      onPanResponderMove: (e) => {
        const { min: mn, max: mx, step: st } = paramsRef.current;
        const ratio = Math.min(1, Math.max(0, e.nativeEvent.locationX / trackWidthRef.current));
        let v = mn + ratio * (mx - mn);
        if (st > 0) v = Math.round(v / st) * st;
        onChangeRef.current(Number(v.toFixed(st < 1 ? 1 : 0)));
      },
    })
  ).current;

  return (
    <View
      style={styles.sliderTrack}
      onLayout={e => { trackWidthRef.current = e.nativeEvent.layout.width; }}
      {...panResponder.panHandlers}
    >
      <View style={[styles.sliderFill, { width: `${progress * 100}%` }]} />
      <View style={[styles.sliderThumb, { left: `${progress * 100}%` as any }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backBtn: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4,
  },
  backBtnText: { color: '#777', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: '#e8c97a', fontSize: 18, fontWeight: '500' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  powerBtn: {
    borderWidth: 1, borderColor: 'rgba(95,223,138,0.4)',
    backgroundColor: 'rgba(95,223,138,0.1)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4,
  },
  powerBtnDisabled: { opacity: 0.35, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'transparent' },
  powerBtnOff: { borderColor: 'rgba(255,120,120,0.5)', backgroundColor: 'rgba(255,120,120,0.12)' },
  powerBtnText: { color: '#5fdf8a', fontSize: 11, letterSpacing: 1, fontWeight: '600' },
  powerBtnTextOff: { color: '#ff8080' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotGreen: { backgroundColor: '#5fdf8a' },
  dotGray: { backgroundColor: '#444' },
  colorPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  previewSwatch: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  colorHex: { color: '#f0ede8', fontSize: 14, letterSpacing: 1, flex: 1 },
  statusText: { color: '#777', fontSize: 11 },
  tabs: {
    flexDirection: 'row',
    gap: 3,
    backgroundColor: '#1c1c1f',
    marginHorizontal: 16,
    borderRadius: 8,
    padding: 4,
  },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 5, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#252528' },
  tabBtnText: { color: '#777', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  tabBtnTextActive: { color: '#e8c97a' },
  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 80 },
  panel: {
    backgroundColor: '#1c1c1f',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: 16,
    gap: 16,
    alignItems: 'center',
  },
  panelLabel: { color: '#777', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', alignSelf: 'flex-start' },
  sliderRow: { width: '100%', gap: 8 },
  sliderLabel: { color: '#f0ede8', fontSize: 12, letterSpacing: 0.5 },
  sliderTrack: {
    height: 20,
    backgroundColor: '#252528',
    borderRadius: 10,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderFill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: '#e8c97a',
    borderRadius: 10,
  },
  sliderThumb: {
    position: 'absolute',
    width: 20, height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    marginLeft: -10,
    top: 0,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  channelRow: { flexDirection: 'row', gap: 10, width: '100%' },
  channelInput: {
    flex: 1,
    backgroundColor: '#000',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    color: '#f0ede8',
    fontSize: 16,
    padding: 14,
    borderRadius: 6,
    letterSpacing: 2,
    textAlign: 'center',
  },
  connectBtn: {
    backgroundColor: '#e8c97a',
    paddingHorizontal: 16,
    borderRadius: 6,
    justifyContent: 'center',
  },
  connectBtnText: { color: '#000', fontWeight: '600', fontSize: 12 },
  generateBtn: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20,
  },
  generateBtnText: { color: '#777', fontSize: 12 },
  qrWrap: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  qrLabel: { color: '#777', fontSize: 11, textAlign: 'center' },

  mediaHint: { color: '#777', fontSize: 11, lineHeight: 17, alignSelf: 'stretch' },
  mediaWarn: { color: '#e0a070', fontSize: 11, alignSelf: 'stretch' },
  mediaActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  mediaBtn: {
    flex: 1,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#252528',
    paddingVertical: 14, borderRadius: 8, alignItems: 'center',
  },
  mediaBtnDisabled: { opacity: 0.4 },
  mediaBtnText: { color: '#f0ede8', fontSize: 12 },
  mediaEmpty: { color: '#555', fontSize: 12, alignSelf: 'stretch', textAlign: 'center', paddingVertical: 8 },
  mediaItem: {
    alignSelf: 'stretch',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#000',
    borderRadius: 8, padding: 12, gap: 10,
  },
  mediaItemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  mediaItemName: { color: '#f0ede8', fontSize: 12, flex: 1 },
  mediaItemStatus: { color: '#777', fontSize: 10 },
  mediaProgressTrack: { height: 4, backgroundColor: '#252528', borderRadius: 2, overflow: 'hidden' },
  mediaProgressFill: { height: 4, backgroundColor: '#e8c97a' },
  mediaItemActions: { flexDirection: 'row', gap: 8 },
  mediaSmallBtn: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6,
  },
  mediaPlayBtn: { flex: 1, alignItems: 'center' },
  mediaPlayBtnActive: { borderColor: '#5fdf8a', backgroundColor: 'rgba(95,223,138,0.12)' },
  mediaSmallBtnText: { color: '#f0ede8', fontSize: 12 },
  mediaDanger: { color: '#ff8080' },

  flashUnavailable: { color: '#e0a070', fontSize: 11, alignSelf: 'stretch' },
  flashGrid: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  flashBtn: {
    flex: 1,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#252528',
    paddingVertical: 16, borderRadius: 8, alignItems: 'center', gap: 6,
  },
  flashBtnActive: { borderColor: '#e8c97a', backgroundColor: 'rgba(232,201,122,0.12)' },
  flashBtnIcon: { fontSize: 22 },
  flashBtnText: { color: '#f0ede8', fontSize: 11, textAlign: 'center' },
  flashDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', alignSelf: 'stretch' },
});
