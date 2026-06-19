/**
 * Transport Bluetooth Low Energy (sans Wi-Fi ni Internet) via
 * react-native-ble-plx.
 *
 * Rôles (cf. spec) : télécommande = central, écran = périphérique.
 *
 * ⚠️ LIMITE NATIVE IMPORTANTE (à valider sur device, comme prévu par la spec)
 * react-native-ble-plx n'implémente QUE le rôle **central** (scan, connexion,
 * lecture/écriture). Il ne sait PAS faire **périphérique** (annoncer un
 * service GATT). Or l'écran projecteur doit être périphérique. Cette moitié
 * exige donc un module natif distinct (p. ex. react-native-ble-peripheral /
 * react-native-peripheral, ou un module natif maison), à choisir et valider
 * sur appareil réel. Tant que ce choix n'est pas fait, le rôle « screen »
 * remonte une erreur explicite plutôt que de feindre de fonctionner.
 *
 * Le rôle « remote » (central) est, lui, complet ci-dessous.
 *
 * Code natif : non exécutable en Expo Go ni sur web. Le build web ne
 * référence jamais ce fichier (cf. createTransport.web.ts).
 */
import { BleManager, Device } from 'react-native-ble-plx';
import type {
  RemoteTransport, MessageHandler, StatusHandler, TransportStatus,
  TransportMode, TransportRole,
} from './RemoteTransport';
import {
  BLE_SERVICE_UUID, BLE_CMD_CHARACTERISTIC_UUID, frameBleChunks,
} from './transportConfig';
import { utf8ToBase64, base64ToUtf8 } from './b64';

export class BleTransport implements RemoteTransport {
  readonly mode: TransportMode = 'bluetooth';
  private role: TransportRole;
  private clientId = '';
  private descriptor: string | null = null;

  private manager: BleManager | null = null;
  private device: Device | null = null;
  private reassembly = new Map<number, string[]>();

  private messageHandlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  constructor(role: TransportRole) {
    this.role = role;
  }

  onMessage(handler: MessageHandler) { this.messageHandlers.push(handler); }
  onStatusChange(handler: StatusHandler) { this.statusHandlers.push(handler); }
  getDescriptor() { return this.descriptor; }

  private notify(s: TransportStatus) { this.statusHandlers.forEach(h => h(s)); }

  connect(_channel: string) {
    this.disconnect();
    this.clientId = 'cl-' + Math.random().toString(36).slice(2, 8);

    if (this.role === 'screen') {
      // Rôle périphérique non couvert par react-native-ble-plx (voir en-tête).
      this.descriptor = 'BLE périphérique : module natif requis';
      this.notify('error');
      return;
    }

    this.notify('connecting');
    this.manager = new BleManager();
    this.manager.startDeviceScan([BLE_SERVICE_UUID], null, (error, device) => {
      if (error || !device) { if (error) this.notify('error'); return; }
      this.manager!.stopDeviceScan();
      this.descriptor = device.name ?? device.id;
      device.connect()
        .then(d => d.discoverAllServicesAndCharacteristics())
        .then(d => {
          this.device = d;
          d.monitorCharacteristicForService(
            BLE_SERVICE_UUID, BLE_CMD_CHARACTERISTIC_UUID,
            (err, char) => {
              if (err || !char?.value) return;
              this.onFrame(base64ToUtf8(char.value));
            },
          );
          this.notify('connected');
        })
        .catch(() => this.notify('error'));
    });
  }

  /** Réassemble les trames « i/n|data » avant de livrer le message JSON. */
  private onFrame(frame: string) {
    const sep = frame.indexOf('|');
    if (sep < 0) return;
    const [idx, total] = frame.slice(0, sep).split('/').map(Number);
    const data = frame.slice(sep + 1);
    if (!Number.isFinite(idx) || !Number.isFinite(total)) return;
    if (total === 1) { this.dispatch(data); return; }
    const parts = this.reassembly.get(total) ?? new Array(total);
    parts[idx] = data;
    this.reassembly.set(total, parts);
    if (parts.filter(Boolean).length === total) {
      this.reassembly.delete(total);
      this.dispatch(parts.join(''));
    }
  }

  private dispatch(json: string) {
    try {
      const msg = JSON.parse(json) as Record<string, unknown>;
      if (msg._id === this.clientId) return;
      this.messageHandlers.forEach(h => h(msg));
    } catch (_) {}
  }

  disconnect() {
    if (this.device) { try { this.device.cancelConnection(); } catch (_) {} this.device = null; }
    if (this.manager) { try { this.manager.stopDeviceScan(); this.manager.destroy(); } catch (_) {} this.manager = null; }
    this.reassembly.clear();
    this.notify('disconnected');
  }

  send(msg: Record<string, unknown>) {
    if (this.role !== 'remote' || !this.device) return;
    const json = JSON.stringify({ ...msg, _id: this.clientId });
    const frames = frameBleChunks(json);
    (async () => {
      for (const frame of frames) {
        try {
          await this.device!.writeCharacteristicWithoutResponseForService(
            BLE_SERVICE_UUID, BLE_CMD_CHARACTERISTIC_UUID, utf8ToBase64(frame),
          );
        } catch (_) { break; }
      }
    })();
  }
}
