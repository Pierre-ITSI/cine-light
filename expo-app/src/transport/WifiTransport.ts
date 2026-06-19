/**
 * Transport Wi-Fi local (sans Internet) via react-native-tcp-socket.
 *
 * Rôles fixes (cf. spec) :
 *  - télécommande = serveur TCP (héberge), expose son IP locale + port
 *    dans le descripteur, à encoder dans le QR existant ;
 *  - écran projecteur = client TCP, se connecte à « ip:port ».
 *
 * Un message JSON par trame, séparées par un saut de ligne. Filtrage d'écho
 * par `_id` comme le transport MQTT, pour garder la même sémantique.
 *
 * ⚠️ Code natif : non exécutable en Expo Go ni sur web. Le build web ne
 * référence jamais ce fichier (cf. createTransport.web.ts).
 */
import TcpSocket from 'react-native-tcp-socket';
import * as Network from 'expo-network';
import type {
  RemoteTransport, MessageHandler, StatusHandler, TransportStatus,
  TransportMode, TransportRole,
} from './RemoteTransport';
import { WIFI_PORT, WIFI_FRAME_DELIMITER } from './transportConfig';

type Socket = ReturnType<typeof TcpSocket.createConnection>;
type Server = ReturnType<typeof TcpSocket.createServer>;

export class WifiTransport implements RemoteTransport {
  readonly mode: TransportMode = 'wifi';
  private role: TransportRole;
  private clientId = '';
  private descriptor: string | null = null;

  private server: Server | null = null;
  private clients = new Set<Socket>();
  private client: Socket | null = null;
  private buffers = new WeakMap<object, string>();

  private messageHandlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  constructor(role: TransportRole) {
    this.role = role;
  }

  onMessage(handler: MessageHandler) { this.messageHandlers.push(handler); }
  onStatusChange(handler: StatusHandler) { this.statusHandlers.push(handler); }
  getDescriptor() { return this.descriptor; }

  private notify(s: TransportStatus) { this.statusHandlers.forEach(h => h(s)); }
  private deliver(text: string, from: object) {
    // Réassemble les trames délimitées par '\n' (TCP est un flux continu).
    const prev = this.buffers.get(from) ?? '';
    const combined = prev + text;
    const parts = combined.split(WIFI_FRAME_DELIMITER);
    this.buffers.set(from, parts.pop() ?? '');
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;
        if (msg._id === this.clientId) continue;
        this.messageHandlers.forEach(h => h(msg));
        // Côté hôte : relaie aux autres clients pour synchroniser plusieurs écrans.
        if (this.role === 'remote') this.broadcast(trimmed, from as Socket);
      } catch (_) {}
    }
  }

  connect(channel: string) {
    this.disconnect();
    this.clientId = 'cl-' + Math.random().toString(36).slice(2, 8);
    this.notify('connecting');
    if (this.role === 'remote') this.startServer();
    else this.startClient(channel);
  }

  private startServer() {
    this.server = TcpSocket.createServer((socket) => {
      this.clients.add(socket);
      socket.on('data', (data) => this.deliver(data.toString(), socket));
      socket.on('error', () => { this.clients.delete(socket); });
      socket.on('close', () => { this.clients.delete(socket); this.buffers.delete(socket); });
    });
    this.server.on('error', () => this.notify('error'));
    this.server.listen({ port: WIFI_PORT, host: '0.0.0.0' }, async () => {
      try {
        const ip = await Network.getIpAddressAsync();
        this.descriptor = `${ip}:${WIFI_PORT}`;
      } catch (_) {
        this.descriptor = `?:${WIFI_PORT}`;
      }
      this.notify('connected');
    });
  }

  private startClient(channel: string) {
    const [host, portStr] = channel.split(':');
    const port = Number(portStr) || WIFI_PORT;
    if (!host) { this.notify('error'); return; }
    this.descriptor = `${host}:${port}`;
    this.client = TcpSocket.createConnection({ host, port }, () => this.notify('connected'));
    this.client.on('data', (data) => this.deliver(data.toString(), this.client as object));
    this.client.on('error', () => this.notify('error'));
    this.client.on('close', () => this.notify('disconnected'));
  }

  private broadcast(line: string, except?: Socket) {
    for (const s of this.clients) {
      if (s === except) continue;
      try { s.write(line + WIFI_FRAME_DELIMITER); } catch (_) {}
    }
  }

  disconnect() {
    if (this.client) { try { this.client.destroy(); } catch (_) {} this.client = null; }
    for (const s of this.clients) { try { s.destroy(); } catch (_) {} }
    this.clients.clear();
    if (this.server) { try { this.server.close(); } catch (_) {} this.server = null; }
    this.notify('disconnected');
  }

  send(msg: Record<string, unknown>) {
    const line = JSON.stringify({ ...msg, _id: this.clientId }) + WIFI_FRAME_DELIMITER;
    if (this.role === 'remote') {
      this.broadcast(line);
    } else if (this.client) {
      try { this.client.write(line); } catch (_) {}
    }
  }
}
