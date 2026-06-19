import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

/**
 * Pilote la torche (flash matériel) de l'écran projecteur via expo-camera.
 *
 * La torche n'est accessible que via une session caméra : un CameraView
 * minimal et invisible reste monté. Latence et fréquence max bien plus
 * basses que le strobe écran → le mode « flash » vise un effet notification
 * (quelques clignotements/seconde), pas un strobe rapide.
 *
 * Reçoit une commande { mode, onMs, offMs, repeats, loop, nonce } ; le nonce
 * garantit le re-déclenchement même si deux commandes identiques se suivent.
 */
export interface TorchCommand {
  mode: 'on' | 'off' | 'flash';
  onMs?: number;
  offMs?: number;
  repeats?: number;
  loop?: boolean;
  nonce: number;
}

interface Props {
  command: TorchCommand | null;
}

export function TorchController({ command }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopFlash = () => {
    if (flashTimer.current) { clearTimeout(flashTimer.current); flashTimer.current = null; }
  };

  useEffect(() => {
    if (!command) return;
    let cancelled = false;

    (async () => {
      // Permission caméra requise même sans capture (accès au flash matériel).
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted || cancelled) return;
      }
      if (cancelled) return;

      stopFlash();

      if (command.mode === 'off') { setTorchOn(false); return; }
      if (command.mode === 'on') { setTorchOn(true); return; }

      // mode === 'flash'
      const onMs = Math.max(40, command.onMs ?? 150);
      const offMs = Math.max(40, command.offMs ?? 150);
      const loop = command.loop || command.repeats === -1;
      const totalCycles = loop ? Infinity : Math.max(1, command.repeats ?? 6);
      let cycle = 0;

      const tick = () => {
        if (cancelled) return;
        setTorchOn(true);
        flashTimer.current = setTimeout(() => {
          if (cancelled) return;
          setTorchOn(false);
          cycle++;
          if (cycle < totalCycles) {
            flashTimer.current = setTimeout(tick, offMs);
          }
        }, onMs);
      };
      tick();
    })();

    return () => { cancelled = true; };
  }, [command]);

  useEffect(() => () => stopFlash(), []);

  if (!permission?.granted) return null;

  return (
    <CameraView
      style={styles.hidden}
      enableTorch={torchOn}
      facing="back"
      animateShutter={false}
    />
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    top: 0,
    left: 0,
  },
});
