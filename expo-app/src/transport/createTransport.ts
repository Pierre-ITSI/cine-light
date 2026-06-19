/**
 * Fabrique le bon transport selon le mode et le rôle.
 *
 * Les transports Wi-Fi/Bluetooth s'appuient sur des modules natifs absents
 * d'Expo Go. Ils sont donc chargés **paresseusement** (require au moment du
 * choix), de sorte que le mode Internet — seul dépendant de modules présents
 * dans Expo Go — ne les charge jamais et ne plante pas. En Expo Go, choisir
 * Wi-Fi/Bluetooth renvoie un transport de repli qui signale « dev client
 * requis » au lieu de crasher.
 *
 * Le build web utilise createTransport.web.ts (résolu par Metro), qui
 * n'importe que MqttTransport.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type {
  RemoteTransport, TransportMode, TransportRole,
  MessageHandler, StatusHandler,
} from './RemoteTransport';
import { MqttTransport } from './MqttTransport';

/** Vrai dans Expo Go (client de l'App Store), faux en dev client / standalone. */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Transport de repli : modes natifs indisponibles (Expo Go). */
class UnavailableTransport implements RemoteTransport {
  readonly mode: TransportMode;
  private statusHandlers: StatusHandler[] = [];
  constructor(mode: TransportMode) { this.mode = mode; }
  connect() { this.statusHandlers.forEach(h => h('error')); }
  disconnect() {}
  send() {}
  onMessage(_handler: MessageHandler) {}
  onStatusChange(handler: StatusHandler) { this.statusHandlers.push(handler); }
  getDescriptor() { return 'Dev client requis (indisponible en Expo Go)'; }
}

export function createTransport(mode: TransportMode, role: TransportRole): RemoteTransport {
  if (mode === 'wifi' || mode === 'bluetooth') {
    if (isExpoGo) return new UnavailableTransport(mode);
    try {
      if (mode === 'wifi') {
        const { WifiTransport } = require('./WifiTransport') as typeof import('./WifiTransport');
        return new WifiTransport(role);
      }
      const { BleTransport } = require('./BleTransport') as typeof import('./BleTransport');
      return new BleTransport(role);
    } catch (_) {
      return new UnavailableTransport(mode);
    }
  }
  return new MqttTransport();
}
