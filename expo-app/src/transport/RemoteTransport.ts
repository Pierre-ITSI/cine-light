export type TransportStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

export type MessageHandler = (msg: Record<string, unknown>) => void;
export type StatusHandler = (status: TransportStatus) => void;

export interface RemoteTransport {
  connect(channel: string): void;
  disconnect(): void;
  send(msg: Record<string, unknown>): void;
  onMessage(handler: MessageHandler): void;
  onStatusChange(handler: StatusHandler): void;
}
