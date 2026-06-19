/**
 * Détection de connectivité pour suggérer (sans imposer) le mode de transport
 * le plus fiable, conformément à la spec :
 *   Internet joignable      → Internet
 *   Wi-Fi actif sans Internet → Wi-Fi local
 *   ni l'un ni l'autre        → Bluetooth
 *
 * La suggestion reste indicative : l'utilisateur garde la main.
 */
import { Platform } from 'react-native';
import * as Network from 'expo-network';
import type { TransportMode } from '../transport/RemoteTransport';

/** Modes proposés à l'utilisateur selon la plateforme (web = Internet seul). */
export const AVAILABLE_MODES: TransportMode[] =
  Platform.OS === 'web' ? ['internet'] : ['internet', 'wifi', 'bluetooth'];

export const MODE_LABELS: Record<TransportMode, string> = {
  internet: 'Internet',
  wifi: 'Wi-Fi local',
  bluetooth: 'Bluetooth',
};

export async function suggestMode(): Promise<TransportMode> {
  if (Platform.OS === 'web') return 'internet';
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isInternetReachable) return 'internet';
    if (state.type === Network.NetworkStateType.WIFI) return 'wifi';
    return 'bluetooth';
  } catch (_) {
    return 'internet';
  }
}
