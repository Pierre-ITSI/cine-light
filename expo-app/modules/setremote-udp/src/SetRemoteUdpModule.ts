import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { DmxProtocol, NetInterface, SetRemoteUdpEvents, UdpNativeModule, UdpPacket } from './bridge';

// Module natif local (ios/SetRemoteUdpModule.swift, android/…/SetRemoteUdpModule.kt),
// lié par l'autolinking d'Expo depuis expo-app/modules/. Une seule session
// d'écoute à la fois : sACN sur UDP 5568 ou Art-Net sur UDP 6454.
declare class SetRemoteUdpModule extends NativeModule<SetRemoteUdpEvents> implements UdpNativeModule {
  /** Démarre ou remplace l'écoute (port 5568 pour 'sacn', 6454 pour 'artnet'). */
  listen(protocol: DmxProtocol, universes: number[], multicast: boolean): Promise<void>;
  stop(): Promise<void>;
  /** Envoie un datagramme (base64) depuis le port d'écoute. */
  send(host: string, port: number, data: string): Promise<void>;
  /** Vide la file native de datagrammes reçus (au plus `max`, les plus récents). */
  drain(max: number): UdpPacket[];
  getNetworkInfo(): Promise<NetInterface[]>;
}

// null dans Expo Go, sur le web, ou avec un binaire antérieur au module.
export default requireOptionalNativeModule<SetRemoteUdpModule>('SetRemoteUdp');
