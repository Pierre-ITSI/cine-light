import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Platform, Switch, PanResponder,
} from 'react-native';
import { useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { ColorWheel } from '../src/components/ColorWheel';
import { MediaPoolList } from '../src/components/MediaPoolList';
import { computeColor, ColorSpec } from '../src/lib/color';
import { generateChannel } from '../src/lib/channel';
import { useLocalIp } from '../src/lib/useLocalIp';
import { WIFI_PORT } from '../src/transport/transportConfig';
import { useMediaPool } from '../src/lib/useMediaPool';
import { loadPresets, savePresets, newPresetId, type ColorPreset } from '../src/lib/colorPresets';
import { createTransport } from '../src/transport/createTransport';
import type { RemoteTransport, TransportStatus, TransportMode } from '../src/transport/RemoteTransport';
import { AVAILABLE_MODES, MODE_LABELS, suggestMode } from '../src/lib/connectivity';

const MEDIA_ENABLED = Platform.OS !== 'web';
const FLASH_ENABLED = Platform.OS !== 'web';

type Tab = 'color' | 'strobe' | 'flash' | 'media' | 'channel';

function useTransport() {
  const [mode, setMode] = useState<TransportMode>('internet');
  const transportRef = useRef<RemoteTransport>(createTransport('internet', 'remote'));
  const [status, setStatus] = useState<TransportStatus>('idle');
  const [, force] = useState(0);

  useEffect(() => {
    transportRef.current.onStatusChange(setStatus);
    return () => transportRef.current.disconnect();
  }, []);

  const changeMode = useCallback((m: TransportMode) => {
    if (m === mode) return;
    transportRef.current.disconnect();
    const t = createTransport(m, 'remote');
    t.onStatusChange(setStatus);
    transportRef.current = t;
    setMode(m);
    setStatus('idle');
    force(x => x + 1);
  }, [mode]);

  return { transport: transportRef.current, status, mode, changeMode };
}

export default function RemoteScreen() {
  const router = useRouter();
  const { transport, status, mode, changeMode } = useTransport();

  const [channel, setChannel] = useState(generateChannel);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<Tab>('color');
  const [descriptor, setDescriptor] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<TransportMode | null>(null);

  // Suggestion indicative du mode le plus fiable selon la connectivité.
  useEffect(() => { suggestMode().then(setSuggested).catch(() => {}); }, []);

  const [spec, setSpec] = useState<ColorSpec>({
    kelvin: 5600, tint: 0, dimmer: 100, wheelHex: '#ffffff', crossfade: 0,
  });
  const color = useMemo(() => computeColor(spec), [spec]);
  // Libellé descriptif de la couleur, à l'identique de la PWA (recomputeColor).
  const colorMeta = useMemo(() => {
    const sign = spec.tint >= 0 ? '+' : '';
    if (spec.crossfade < 5) return `${spec.kelvin}K · ${sign}${spec.tint}GM · ${spec.dimmer}%`;
    if (spec.crossfade > 95) return `Roue · ${spec.dimmer}%`;
    return `Mix ${spec.crossfade}% · ${spec.dimmer}%`;
  }, [spec]);

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

  // Luminosité de l'écran de jeu, pilotée à distance (0..100). 100 = max.
  const [screenBrightness, setScreenBrightness] = useState(100);
  const setScreenBrightnessRemote = useCallback((v: number) => {
    setScreenBrightness(v);
    transport.send({ type: 'screen:brightness', value: v / 100 });
  }, [transport]);

  // Mémoires de couleur (presets) : état complet enregistré et rappelable.
  const [presets, setPresets] = useState<ColorPreset[]>(() => loadPresets());
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const persistPresets = useCallback((list: ColorPreset[]) => {
    setPresets(list);
    savePresets(list);
  }, []);
  const saveNewPreset = useCallback(() => {
    const preset: ColorPreset = {
      id: newPresetId(),
      name: 'Mémoire ' + (presets.length + 1),
      spec: { ...spec },
    };
    persistPresets([...presets, preset]);
    setSelectedPresetId(preset.id);
  }, [presets, spec, persistPresets]);
  const updateSelectedPreset = useCallback(() => {
    if (!selectedPresetId) return;
    persistPresets(presets.map(p => (p.id === selectedPresetId ? { ...p, spec: { ...spec } } : p)));
  }, [selectedPresetId, presets, spec, persistPresets]);
  const applyPreset = useCallback((p: ColorPreset) => {
    setSpec({ ...p.spec });
    setSelectedPresetId(p.id);
  }, []);
  const deletePreset = useCallback((id: string) => {
    persistPresets(presets.filter(p => p.id !== id));
    setSelectedPresetId(cur => (cur === id ? null : cur));
  }, [presets, persistPresets]);

  // Adresse IP locale de cet appareil (rafraîchie en continu) pour le Wi-Fi local.
  const localIp = useLocalIp();

  // Fige le défilement pendant un cliquer-glisser du pool média.
  const [scrollEnabled, setScrollEnabled] = useState(true);

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
    // En Wi-Fi/Bluetooth, le code canal n'est pas requis (hôte / scan direct).
    if (mode === 'internet' && !ch) return;
    transport.connect(ch);
  }, [channel, transport, mode]);

  useEffect(() => {
    if (status === 'connected') {
      setConnected(true);
      setScreenOn(true);
      setTorchState('off');
      setDescriptor(transport.getDescriptor?.() ?? null);
      transport.send({ type: 'color', color });
      transport.send({ type: 'screen:brightness', value: screenBrightness / 100 });
      transport.send({ type: 'hello' });
    } else {
      setConnected(false);
      if (status !== 'connecting') setDescriptor(null);
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

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'color' && (
          <View style={styles.colorTab}>
            {/* Dimmer */}
            <View style={styles.panel}>
              <Text style={styles.panelLabel}>Dimmer</Text>
              <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>Dimmer {spec.dimmer}%</Text>
                <SliderRN min={0} max={100} value={spec.dimmer} onChange={v => updateSpec({ dimmer: v })} />
              </View>
            </View>

            {/* Roue chromatique + encart de la couleur sélectionnée + crossfade */}
            <View style={styles.panel}>
              <Text style={styles.panelLabel}>Roue chromatique</Text>
              <View style={styles.wheelWrap}>
                <ColorWheel
                  size={240}
                  selectedHex={spec.wheelHex}
                  onPick={hex => updateSpec({ wheelHex: hex })}
                  onInteract={active => setScrollEnabled(!active)}
                />
              </View>
              <View style={styles.swatchRow}>
                <View style={[styles.swatch, { backgroundColor: color }]} />
                <View style={styles.swatchInfo}>
                  <Text style={styles.swatchHex}>{color.toUpperCase()}</Text>
                  <Text style={styles.swatchMeta}>{colorMeta}</Text>
                </View>
              </View>
              <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>Color crossfade · Blanc ↔ Couleur {spec.crossfade}%</Text>
                <SliderRN min={0} max={100} value={spec.crossfade} onChange={v => updateSpec({ crossfade: v })} />
              </View>
            </View>

            {/* Température de couleur */}
            <View style={styles.panel}>
              <Text style={styles.panelLabel}>Température de couleur</Text>
              <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>Température {spec.kelvin.toLocaleString('fr')} K</Text>
                <SliderRN min={1700} max={20000} value={spec.kelvin} onChange={v => updateSpec({ kelvin: v })} />
              </View>
              <View style={styles.chipsWrap}>
                {[1700, 2700, 3200, 4300, 5600, 6500, 9000, 20000].map(k => (
                  <Pressable
                    key={k}
                    style={[styles.chip, spec.kelvin === k && styles.chipActive]}
                    onPress={() => updateSpec({ kelvin: k })}
                  >
                    <Text style={[styles.chipText, spec.kelvin === k && styles.chipTextActive]}>{k}K</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Tint · Magenta ↔ Vert */}
            <View style={styles.panel}>
              <Text style={styles.panelLabel}>Tint · Magenta ↔ Vert</Text>
              <View style={styles.tintLabels}>
                <Text style={styles.tintLabel}>−100 Magenta</Text>
                <Text style={styles.tintLabel}>0 Neutre</Text>
                <Text style={styles.tintLabel}>+100 Vert</Text>
              </View>
              <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>Green / Magenta {spec.tint >= 0 ? '+' : ''}{spec.tint} GM</Text>
                <SliderRN min={-100} max={100} value={spec.tint} onChange={v => updateSpec({ tint: v })} />
              </View>
            </View>

            {/* Mémoires de couleur : sauvegarde de l'état complet + mise à jour */}
            <View style={styles.panel}>
              <Text style={styles.panelLabel}>Mémoires de couleur</Text>
              <View style={styles.presetActions}>
                <Pressable style={styles.presetSaveBtn} onPress={saveNewPreset}>
                  <Text style={styles.presetSaveText}>＋ Enregistrer</Text>
                </Pressable>
                <Pressable
                  style={[styles.presetUpdateBtn, !selectedPresetId && styles.mediaBtnDisabled]}
                  disabled={!selectedPresetId}
                  onPress={updateSelectedPreset}
                >
                  <Text style={styles.presetUpdateText}>⟳ Mettre à jour</Text>
                </Pressable>
              </View>
              {presets.length === 0 ? (
                <Text style={styles.mediaEmpty}>
                  Réglez une couleur puis « Enregistrer » pour créer une mémoire.
                </Text>
              ) : (
                <View style={styles.presetGrid}>
                  {presets.map(p => {
                    const sel = p.id === selectedPresetId;
                    return (
                      <Pressable
                        key={p.id}
                        style={[styles.presetItem, sel && styles.presetItemActive]}
                        onPress={() => applyPreset(p)}
                        onLongPress={() => deletePreset(p.id)}
                      >
                        <View style={[styles.presetSwatch, { backgroundColor: computeColor(p.spec) }]} />
                        <Text style={[styles.presetName, sel && styles.presetNameActive]} numberOfLines={1}>
                          {p.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {presets.length > 0 && (
                <Text style={styles.presetHint}>Touchez pour rappeler · appui long pour supprimer.</Text>
              )}
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
          <View style={styles.colorTab}>
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>Luminosité de l'écran de jeu</Text>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Luminosité écran {screenBrightness}%</Text>
              <SliderRN
                min={0}
                max={100}
                value={screenBrightness}
                onChange={setScreenBrightnessRemote}
              />
            </View>
            {!connected && (
              <Text style={styles.mediaWarn}>Connectez un canal pour régler l'écran à distance.</Text>
            )}
          </View>
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

            <View style={styles.toggleRow}>
              <Text style={styles.sliderLabel}>Avancer au clic sur l'écran de jeu</Text>
              <Switch
                value={media.autoAdvance}
                onValueChange={media.setAutoAdvance}
                disabled={!connected}
                trackColor={{ true: '#e8c97a' }}
              />
            </View>

            {media.items.length > 0 && (
              <View style={styles.mediaNavRow}>
                <Pressable
                  style={[styles.mediaNavBtn, !connected && styles.mediaBtnDisabled]}
                  disabled={!connected}
                  onPress={media.prev}
                >
                  <Text style={styles.mediaNavText}>◀ Précédent</Text>
                </Pressable>
                <Pressable
                  style={[styles.mediaNavBtn, !connected && styles.mediaBtnDisabled]}
                  disabled={!connected}
                  onPress={media.next}
                >
                  <Text style={styles.mediaNavText}>Suivant ▶</Text>
                </Pressable>
              </View>
            )}

            {media.items.length === 0 && (
              <Text style={styles.mediaEmpty}>Aucun média transféré.</Text>
            )}

            {media.items.length > 0 && (
              <>
                <Text style={styles.mediaReorderHint}>Glissez la poignée ≡ pour réordonner.</Text>
                <MediaPoolList
                  items={media.items}
                  playingId={media.playingId}
                  onPlay={media.play}
                  onStop={media.stop}
                  onClear={media.clear}
                  onMove={media.moveItem}
                  onDragChange={active => setScrollEnabled(!active)}
                />
              </>
            )}
          </View>
          </View>
        )}

        {tab === 'channel' && (
          <View style={styles.panel}>
            {AVAILABLE_MODES.length > 1 && (
              <>
                <Text style={styles.panelLabel}>Mode de connexion</Text>
                <View style={styles.modeRow}>
                  {AVAILABLE_MODES.map(m => (
                    <Pressable
                      key={m}
                      style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
                      onPress={() => { changeMode(m); }}
                    >
                      <Text style={[styles.modeBtnText, mode === m && styles.modeBtnTextActive]}>
                        {MODE_LABELS[m]}
                      </Text>
                      {suggested === m && (
                        <Text style={styles.modeBadge}>recommandé</Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {mode === 'internet' && (
              <>
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
                <View style={styles.ipBox}>
                  <Text style={styles.ipLabel}>Adresse locale de cet appareil (Wi-Fi)</Text>
                  <Text style={styles.ipValue}>{localIp ? `${localIp}:${WIFI_PORT}` : 'Recherche…'}</Text>
                  <Text style={styles.ipHint}>Mise à jour automatique à chaque changement de réseau.</Text>
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
              </>
            )}

            {mode === 'wifi' && (
              <>
                <Text style={styles.mediaHint}>
                  La télécommande héberge le serveur local. Aucun Internet requis :
                  l'écran doit être sur le même réseau Wi-Fi.
                </Text>
                <View style={styles.ipBox}>
                  <Text style={styles.ipLabel}>Adresse locale de cet appareil</Text>
                  <Text style={styles.ipValue}>{localIp ? `${localIp}:${WIFI_PORT}` : 'Recherche…'}</Text>
                  <Text style={styles.ipHint}>
                    L'écran saisit cette adresse. Mise à jour automatique à chaque
                    changement de réseau.
                  </Text>
                </View>
                <Pressable style={[styles.connectBtn, styles.connectBtnWide]} onPress={connect}>
                  <Text style={styles.connectBtnText}>{connected ? 'Redémarrer l’hôte' : 'Démarrer l’hôte'}</Text>
                </Pressable>
                {connected && descriptor && (
                  <View style={styles.qrWrap}>
                    <QRCode value={descriptor} size={180} color="#f0ede8" backgroundColor="#000000" />
                    <Text style={styles.qrLabel}>{descriptor}</Text>
                    <Text style={styles.qrLabel}>L'écran scanne ce QR ou saisit cette adresse</Text>
                  </View>
                )}
                {connected && !descriptor && (
                  <Text style={styles.mediaWarn}>Recherche de l'adresse locale…</Text>
                )}
              </>
            )}

            {mode === 'bluetooth' && (
              <>
                <Text style={styles.mediaHint}>
                  Liaison directe sans Wi-Fi ni Internet. La télécommande recherche
                  l'écran projecteur à proximité et s'y connecte.
                </Text>
                <Pressable style={[styles.connectBtn, styles.connectBtnWide]} onPress={connect}>
                  <Text style={styles.connectBtnText}>{connected ? 'Reconnecter' : 'Rechercher l’écran'}</Text>
                </Pressable>
                {connected && descriptor && (
                  <Text style={styles.qrLabel}>Connecté à {descriptor}</Text>
                )}
              </>
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
  const progress = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const trackRef = useRef<View>(null);
  // Géométrie absolue de la piste (coord. fenêtre), pour calculer le ratio à
  // partir de pageX. On évite locationX, relatif à la sous-vue sous le doigt
  // (le pouce/le remplissage), qui rendait la jauge erratique.
  const geomRef = useRef({ x: 0, width: 1 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const paramsRef = useRef({ min, max, step });
  paramsRef.current = { min, max, step };

  const measure = useCallback(() => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      if (width > 0) geomRef.current = { x, width };
    });
  }, []);

  const emit = useCallback((pageX: number) => {
    const { x, width } = geomRef.current;
    const { min: mn, max: mx, step: st } = paramsRef.current;
    const ratio = Math.min(1, Math.max(0, (pageX - x) / (width || 1)));
    let v = mn + ratio * (mx - mn);
    if (st > 0) v = Math.round(v / st) * st;
    onChangeRef.current(Number(v.toFixed(st < 1 ? 1 : 0)));
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Empêche le ScrollView parent de « voler » le geste en cours de glissement.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      // g.x0 / g.moveX sont des coordonnées écran (pageX), indépendantes de la
      // sous-vue touchée → calcul du ratio fiable.
      onPanResponderGrant: (_e, g) => { measure(); emit(g.x0); },
      onPanResponderMove: (_e, g) => emit(g.moveX),
    })
  ).current;

  return (
    <View
      ref={trackRef}
      style={styles.sliderTrack}
      hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
      onLayout={measure}
      {...panResponder.panHandlers}
    >
      <View pointerEvents="none" style={[styles.sliderFill, { width: `${progress * 100}%` }]} />
      <View pointerEvents="none" style={[styles.sliderThumb, { left: `${progress * 100}%` as any }]} />
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
  colorTab: { gap: 16 },
  wheelWrap: { alignItems: 'center', alignSelf: 'center' },
  swatchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, width: '100%',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 8,
    padding: 12, backgroundColor: '#000',
  },
  swatch: {
    width: 56, height: 56, borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  swatchInfo: { flex: 1, gap: 4 },
  swatchHex: { color: '#f0ede8', fontSize: 18, fontWeight: '700', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  swatchMeta: { color: '#999', fontSize: 12 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, width: '100%' },
  chip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16,
  },
  chipActive: { borderColor: '#e8c97a', backgroundColor: 'rgba(232,201,122,0.15)' },
  chipText: { color: '#bbb', fontSize: 12 },
  chipTextActive: { color: '#e8c97a', fontWeight: '700' },
  tintLabels: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  tintLabel: { color: '#777', fontSize: 10 },
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
  connectBtnWide: { alignSelf: 'stretch', paddingVertical: 14, alignItems: 'center' },
  modeRow: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  modeBtn: {
    flex: 1,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#252528',
    paddingVertical: 10, borderRadius: 8, alignItems: 'center', gap: 3,
  },
  modeBtnActive: { borderColor: '#e8c97a', backgroundColor: 'rgba(232,201,122,0.12)' },
  modeBtnText: { color: '#f0ede8', fontSize: 11 },
  modeBtnTextActive: { color: '#e8c97a' },
  modeBadge: { color: '#5fdf8a', fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  generateBtn: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20,
  },
  generateBtnText: { color: '#777', fontSize: 12 },
  qrWrap: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  qrLabel: { color: '#777', fontSize: 11, textAlign: 'center' },

  ipBox: {
    alignSelf: 'stretch',
    borderWidth: 1, borderColor: 'rgba(232,201,122,0.25)',
    backgroundColor: 'rgba(232,201,122,0.06)',
    borderRadius: 8, padding: 12, gap: 4,
  },
  ipLabel: { color: '#777', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  ipValue: { color: '#e8c97a', fontSize: 18, letterSpacing: 1, fontVariant: ['tabular-nums'] },
  ipHint: { color: '#777', fontSize: 10, lineHeight: 15 },

  mediaHint: { color: '#777', fontSize: 11, lineHeight: 17, alignSelf: 'stretch' },
  mediaWarn: { color: '#e0a070', fontSize: 11, alignSelf: 'stretch' },

  // Mémoires de couleur
  presetActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginBottom: 4 },
  presetSaveBtn: {
    flex: 1,
    borderWidth: 1, borderColor: 'rgba(95,223,138,0.4)',
    backgroundColor: 'rgba(95,223,138,0.1)',
    paddingVertical: 12, borderRadius: 8, alignItems: 'center',
  },
  presetSaveText: { color: '#5fdf8a', fontSize: 12, fontWeight: '600' },
  presetUpdateBtn: {
    flex: 1,
    borderWidth: 1, borderColor: 'rgba(232,201,122,0.4)',
    backgroundColor: 'rgba(232,201,122,0.08)',
    paddingVertical: 12, borderRadius: 8, alignItems: 'center',
  },
  presetUpdateText: { color: '#e8c97a', fontSize: 12, fontWeight: '600' },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignSelf: 'stretch' },
  presetItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#252528',
    paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8,
    minWidth: '47%', flexGrow: 1,
  },
  presetItemActive: { borderColor: '#e8c97a', backgroundColor: 'rgba(232,201,122,0.15)' },
  presetSwatch: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  presetName: { color: '#cfcfcf', fontSize: 12, flexShrink: 1 },
  presetNameActive: { color: '#e8c97a', fontWeight: '600' },
  presetHint: { color: '#777', fontSize: 10, alignSelf: 'stretch' },
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
  mediaReorderHint: { color: '#777', fontSize: 10, alignSelf: 'stretch' },
  mediaNavRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  mediaNavBtn: {
    flex: 1,
    borderWidth: 1, borderColor: 'rgba(232,201,122,0.4)',
    backgroundColor: 'rgba(232,201,122,0.08)',
    paddingVertical: 12, borderRadius: 8, alignItems: 'center',
  },
  mediaNavText: { color: '#e8c97a', fontSize: 13, fontWeight: '600' },
  mediaReorder: { flexDirection: 'row', gap: 4 },
  mediaReorderBtn: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    width: 26, height: 26, borderRadius: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  mediaReorderText: { color: '#f0ede8', fontSize: 11 },
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
