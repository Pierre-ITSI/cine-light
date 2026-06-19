/**
 * Variante web de la fabrique de transport (résolue par Metro pour la cible
 * web). Le web ne supporte ni serveur TCP local ni BLE dans une architecture
 * raisonnable (cf. spec §6) : seul le mode Internet existe. Ce fichier
 * n'importe donc aucun module natif, gardant le bundle web propre.
 */
import type { RemoteTransport, TransportMode, TransportRole } from './RemoteTransport';
import { MqttTransport } from './MqttTransport';

export function createTransport(_mode: TransportMode, _role: TransportRole): RemoteTransport {
  return new MqttTransport();
}
