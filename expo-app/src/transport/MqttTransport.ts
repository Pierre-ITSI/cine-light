import mqtt, { MqttClient } from 'mqtt';
import type { RemoteTransport, MessageHandler, StatusHandler, TransportStatus, TransportMode } from './RemoteTransport';

const BROKER = 'wss://broker.hivemq.com:8884/mqtt';

function topic(channel: string) {
  return 'cinelight/v1/' + channel + '/cmd';
}

export class MqttTransport implements RemoteTransport {
  readonly mode: TransportMode = 'internet';
  private client: MqttClient | null = null;
  private clientId = '';
  private channel = '';
  private messageHandlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  onMessage(handler: MessageHandler) { this.messageHandlers.push(handler); }
  onStatusChange(handler: StatusHandler) { this.statusHandlers.push(handler); }

  private notify(s: TransportStatus) {
    this.statusHandlers.forEach(h => h(s));
  }

  connect(channel: string) {
    this.disconnect();
    this.channel = channel;
    this.clientId = 'cl-' + Math.random().toString(36).slice(2, 8);
    this.notify('connecting');

    this.client = mqtt.connect(BROKER, {
      clientId: this.clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
    });

    this.client.on('connect', () => {
      this.client!.subscribe(topic(channel), { qos: 0 }, () => {
        this.notify('connected');
      });
    });

    this.client.on('error', () => { this.notify('error'); });

    this.client.on('message', (_, payload) => {
      try {
        const msg = JSON.parse(payload.toString()) as Record<string, unknown>;
        if (msg._id === this.clientId) return;
        this.messageHandlers.forEach(h => h(msg));
      } catch (_) {}
    });
  }

  disconnect() {
    if (this.client) { this.client.end(true); this.client = null; }
    this.notify('disconnected');
  }

  send(msg: Record<string, unknown>) {
    if (!this.client?.connected) return;
    const payload = JSON.stringify({ ...msg, _id: this.clientId });
    this.client.publish(topic(this.channel), payload, { qos: 0 });
  }
}
