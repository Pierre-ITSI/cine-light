import React, { useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Vibration, Platform } from 'react-native';

const LONG_PRESS_MS = 1500;

interface Props {
  channel: string;
  onResume: () => void;
  onChangeChannel: () => void;
  onHome: () => void;
  onDisconnect: () => void;
  onClearCache?: () => void;
}

export function ExitMenu({ channel, onResume, onChangeChannel, onHome, onDisconnect, onClearCache }: Props) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef(0);

  const startPress = useCallback(() => {
    if (open) return;
    timer.current = setTimeout(() => {
      if (Platform.OS !== 'web') Vibration.vibrate(40);
      setOpen(true);
    }, LONG_PRESS_MS);
  }, [open]);

  const cancelPress = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  // Double-tap (deux contacts à moins de 300 ms) : alternative tactile rapide
  // à l'appui long, identique au hotspot du PWA.
  const handleTap = useCallback(() => {
    if (open) return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      lastTap.current = 0;
      if (Platform.OS !== 'web') Vibration.vibrate(40);
      setOpen(true);
    } else {
      lastTap.current = now;
    }
  }, [open]);

  return (
    <>
      <Pressable
        style={styles.zone}
        onPressIn={startPress}
        onPressOut={cancelPress}
        onPress={handleTap}
        delayLongPress={LONG_PRESS_MS}
      />
      {open && (
        <View style={styles.overlay}>
          <Text style={styles.info}>Canal : {channel || '—'}</Text>
          <Pressable style={styles.btn} onPress={() => setOpen(false)}>
            <Text style={styles.btnText}>Reprendre l'affichage</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => { setOpen(false); onChangeChannel(); }}>
            <Text style={styles.btnText}>Changer de code canal</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => { setOpen(false); onHome(); }}>
            <Text style={styles.btnText}>Retour à l'accueil</Text>
          </Pressable>
          {onClearCache && (
            <Pressable style={styles.btn} onPress={() => { setOpen(false); onClearCache(); }}>
              <Text style={styles.btnText}>Vider le cache média</Text>
            </Pressable>
          )}
          <Pressable style={[styles.btn, styles.btnDanger]} onPress={() => { setOpen(false); onDisconnect(); }}>
            <Text style={[styles.btnText, styles.btnTextDanger]}>Se déconnecter</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  zone: {
    position: 'absolute',
    top: 0,
    left: 0,
    // Même zone que le hotspot du PWA (45vw × 45vh) : coin haut-gauche.
    width: '45%',
    height: '45%',
    zIndex: 9999,
    backgroundColor: 'transparent',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.92)',
    zIndex: 10000,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 32,
  },
  info: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    letterSpacing: 1,
    marginBottom: 8,
  },
  btn: {
    width: '100%',
    maxWidth: 300,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: {
    color: '#F5F2EC',
    fontSize: 15,
    letterSpacing: 0.5,
  },
  btnDanger: {
    borderColor: 'rgba(255,100,100,0.3)',
  },
  btnTextDanger: {
    color: '#ff8080',
  },
});
