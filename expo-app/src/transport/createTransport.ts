/**
 * Fabrique le bon transport selon le mode et le rôle.
 *
 * Version native (iOS/Android) : connaît les trois transports. Le build web
 * utilise createTransport.web.ts à la place (résolu par Metro), qui n'importe
 * QUE MqttTransport — ainsi react-native-tcp-socket / react-native-ble-plx ne
 * sont jamais inclus dans le bundle web (ils n'ont pas d'implémentation web).
 */
import type { RemoteTransport, TransportMode, TransportRole } from './RemoteTransport';
import { MqttTransport } from './MqttTransport';
import { WifiTransport } from './WifiTransport';
import { BleTransport } from './BleTransport';

export function createTransport(mode: TransportMode, role: TransportRole): RemoteTransport {
  switch (mode) {
    case 'wifi': return new WifiTransport(role);
    case 'bluetooth': return new BleTransport(role);
    case 'internet':
    default: return new MqttTransport();
  }
}
