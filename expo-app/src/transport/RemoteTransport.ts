export type TransportStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

export type MessageHandler = (msg: Record<string, unknown>) => void;
export type StatusHandler = (status: TransportStatus) => void;

/** Mode de connexion entre la télécommande et l'écran projecteur. */
export type TransportMode = 'internet' | 'wifi' | 'bluetooth';

/** Rôle de l'appareil : la télécommande pilote, l'écran reçoit. */
export type TransportRole = 'remote' | 'screen';

export interface RemoteTransport {
  /** Mode implémenté par ce transport (introspection UI). */
  readonly mode: TransportMode;
  connect(channel: string): void;
  disconnect(): void;
  send(msg: Record<string, unknown>): void;
  onMessage(handler: MessageHandler): void;
  onStatusChange(handler: StatusHandler): void;
  /**
   * Descripteur de connexion à afficher côté hôte (ex. « 192.168.1.5:8777 »
   * en Wi-Fi local, encodé dans le QR). null tant qu'indisponible ou non
   * pertinent (Internet utilise le code canal classique).
   */
  getDescriptor?(): string | null;
}
