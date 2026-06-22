/**
 * Adresse IP locale (Wi-Fi/LAN) de l'appareil, rafraîchie en continu.
 *
 * L'IP peut changer (passage d'un réseau à l'autre, bail DHCP renouvelé). On
 * la réévalue à chaque changement d'état réseau (expo-network) et, en filet de
 * sécurité, par sondage périodique — car un renouvellement DHCP sur le même
 * réseau n'émet pas toujours d'évènement.
 *
 * Renvoie null sur web (non pertinent dans un navigateur) ou si indisponible.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Network from 'expo-network';

export function useLocalIp(pollMs = 4000): string | null {
  const [ip, setIp] = useState<string | null>(null);
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;

    const refresh = async () => {
      try {
        const addr = await Network.getIpAddressAsync();
        if (!active) return;
        // 0.0.0.0 ou vide ⇒ pas d'adresse exploitable (réseau absent).
        const clean = addr && addr !== '0.0.0.0' ? addr : null;
        if (clean !== lastRef.current) { lastRef.current = clean; setIp(clean); }
      } catch (_) {
        if (active && lastRef.current !== null) { lastRef.current = null; setIp(null); }
      }
    };

    refresh();
    const sub = Network.addNetworkStateListener(() => { refresh(); });
    const timer = setInterval(refresh, pollMs);

    return () => { active = false; sub.remove(); clearInterval(timer); };
  }, [pollMs]);

  return ip;
}
