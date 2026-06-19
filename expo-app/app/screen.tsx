import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, Vibration } from 'react-native';
import { useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { ExitMenu } from '../src/components/ExitMenu';
import { MqttTransport } from '../src/transport/MqttTransport';
import type { TransportStatus } from '../src/transport/RemoteTransport';

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
}

export default function ScreenMode() {
  const router = useRouter();
  useKeepAwake();

  const transport = useRef(new MqttTransport()).current;
  const [transportStatus, setTransportStatus] = useState<TransportStatus>('idle');

  const [state, setState] = useState<ScreenState>('connect');
  const [channel, setChannel] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [bgColor, setBgColor] = useState('#000000');
  const [statusText, setStatusText] = useState('');

  const strobeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strobeActive = useRef(false);

  const stopStrobe = useCallback(() => {
    strobeActive.current = false;
    if (strobeTimer.current) { clearTimeout(strobeTimer.current); strobeTimer.current = null; }
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
      strobeTimer.current = setTimeout(() => {
        setBgColor('#000000');
        if (strobeActive.current) strobeTimer.current = setTimeout(cycle, interval - dur);
      }, dur);
    }
    cycle();
  }, [stopStrobe]);

  useEffect(() => {
    transport.onStatusChange(setTransportStatus);
    transport.onMessage(msg => {
      if (msg.type === 'color' && typeof msg.color === 'string') {
        stopStrobe();
        setBgColor(msg.color);
      }
      if (msg.type === 'strobe') runStrobe(msg as unknown as StrobeMsg, bgColor);
      if (msg.type === 'vibrate' && Platform.OS !== 'web') {
        const pattern = msg.pattern;
        if (Array.isArray(pattern)) Vibration.vibrate(pattern as number[]);
      }
      if (msg.type === 'hello') sendCaps();
    });
    return () => { transport.disconnect(); stopStrobe(); };
  }, []);

  function sendCaps() {
    transport.send({
      type: 'caps',
      torch: false,
      vibrate: Platform.OS !== 'web' && Platform.OS !== 'ios',
    });
  }

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
    const ch = channelInput.trim().toLowerCase();
    if (!ch) return;
    setChannel(ch);
    setStatusText('Connexion…');
    transport.connect(ch);
  }, [channelInput, transport]);

  const handleDisconnect = useCallback(() => {
    transport.disconnect();
    stopStrobe();
    setBgColor('#000000');
    setStatusText('Déconnecté');
    setState('disconnected');
  }, [transport, stopStrobe]);

  const handleChangeChannel = useCallback(() => {
    transport.disconnect();
    stopStrobe();
    setBgColor('#000000');
    setChannelInput('');
    setState('connect');
  }, [transport, stopStrobe]);

  const handleHome = useCallback(() => {
    transport.disconnect();
    stopStrobe();
    router.replace('/');
  }, [transport, stopStrobe, router]);

  if (state === 'connect') {
    return (
      <View style={styles.connect}>
        <StatusBar style="light" />
        <Text style={styles.connectTitle}>Écran projecteur</Text>
        <Text style={styles.connectSub}>Entrez le code canal de la télécommande</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={channelInput}
            onChangeText={setChannelInput}
            placeholder="ex : cine4271"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={connect}
          />
          <Pressable style={styles.goBtn} onPress={connect}>
            <Text style={styles.goBtnText}>OK</Text>
          </Pressable>
        </View>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Retour</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: bgColor }]}>
      <StatusBar style="light" hidden />
      {state === 'active' && (
        <Text style={styles.pill} numberOfLines={1}>{statusText}</Text>
      )}
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
    color: '#e8c97a',
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
    color: '#f0ede8',
    fontSize: 18,
    padding: 14,
    borderRadius: 6,
    letterSpacing: 2,
    textAlign: 'center',
  },
  goBtn: {
    backgroundColor: '#e8c97a',
    paddingHorizontal: 20,
    borderRadius: 6,
    justifyContent: 'center',
  },
  goBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
  backBtn: { marginTop: 8 },
  backBtnText: { color: '#555', fontSize: 12 },
  screen: {
    flex: 1,
    position: 'relative',
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
  reconnectBtnText: { color: '#f0ede8', fontSize: 13 },
});
