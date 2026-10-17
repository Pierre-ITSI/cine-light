// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import Darwin
import Foundation
import Network

// ════════════════════════════════════════════════════════════════════════════
// Passerelle DMX, côté iOS : réception UDP sACN (5568) ou Art-Net (6454).
//
// Choix des API (docs/DMX-NATIVE.md § 9) :
//   • Unicast et broadcast : UN socket BSD par écoute, lié à 0.0.0.0:<port>,
//     lu par une DispatchSource sur une file série. Network.framework ne gère
//     pas le broadcast (TN3151 : « use BSD Sockets ») ; un NWListener UDP crée
//     une NWConnection par émetteur, sans adresse de destination, et ne sait
//     pas envoyer depuis son port vers un hôte quelconque. Avec un socket
//     BSD : recvfrom() donne l'émetteur, sendto() répond depuis le même port
//     (ArtPollReply depuis 6454). Recevoir de l'unicast n'exige ni
//     l'entitlement multicast ni l'accès au réseau local (TN3179).
//   • Multicast sACN : NWConnectionGroup + NWMulticastGroup (méthode d'Apple),
//     sur l'interface préférée (filaire, sinon Wi-Fi) ; exige l'entitlement
//     com.apple.developer.networking.multicast.
//
// Aucune trace du contenu des paquets : seules des raisons d'erreur remontent.
// ════════════════════════════════════════════════════════════════════════════

enum UdpLimits {
  static let maxUniverses = 64
  static let maxDatagram = 1500
  /// File native : ≈ 1,5 s à 8 univers × 44 Hz. Pleine, elle jette les plus anciens.
  static let queueCapacity = 512
  /// Lot maximal remis à JS par drain().
  static let maxBatch = 256
  static let sacnDiscoveryUniverse = 64214
  /// Clé Info.plist posée par app.plugin.js : vraie quand le binaire est signé
  /// avec l'entitlement multicast (variable SETREMOTE_MULTICAST_ENTITLEMENT).
  static let entitlementInfoKey = "SetRemoteMulticastEntitlement"
}

enum DmxProtocol: String {
  case sacn
  case artnet

  var port: UInt16 { self == .sacn ? 5568 : 6454 }

  func accepts(universe u: Int) -> Bool {
    switch self {
    case .sacn: return (1...63999).contains(u) || u == UdpLimits.sacnDiscoveryUniverse
    case .artnet: return (0...32767).contains(u)
    }
  }
}

struct ListenConfig {
  let proto: DmxProtocol
  let universes: [Int]
  let multicast: Bool
}

/// Datagramme reçu : émetteur et contenu déjà en base64 (calculé ici, hors du thread JS).
struct ReceivedPacket {
  let src: String
  let port: Int
  let data: String
}

// MARK: - File bornée (producteurs : sockets ; consommateur : drain() sur le thread JS)

final class PacketQueue {
  private let lock = NSLock()
  private var ring: [ReceivedPacket?]
  private var head = 0
  private var count = 0
  private let capacity: Int

  init(capacity: Int) {
    self.capacity = capacity
    ring = Array(repeating: nil, count: capacity)
  }

  func push(_ packet: ReceivedPacket) {
    lock.lock()
    defer { lock.unlock() }
    if count == capacity { // pleine : JS est en retard, on jette le plus ancien
      ring[head] = nil
      head = (head + 1) % capacity
      count -= 1
    }
    ring[(head + count) % capacity] = packet
    count += 1
  }

  /// Au plus `limit` paquets, les plus récents, dans l'ordre d'arrivée ; ceux
  /// qui attendaient au-delà sont jetés (les plus anciens).
  func drain(limit: Int) -> [ReceivedPacket] {
    lock.lock()
    defer { lock.unlock() }
    let keep = Swift.min(count, Swift.max(1, limit))
    while count > keep {
      ring[head] = nil
      head = (head + 1) % capacity
      count -= 1
    }
    var out: [ReceivedPacket] = []
    out.reserveCapacity(count)
    while count > 0 {
      if let p = ring[head] { out.append(p) }
      ring[head] = nil
      head = (head + 1) % capacity
      count -= 1
    }
    head = 0
    return out
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    while count > 0 {
      ring[head] = nil
      head = (head + 1) % capacity
      count -= 1
    }
    head = 0
  }
}

// MARK: - IPv4

struct IPv4Interface {
  let name: String
  let ip: UInt32 // ordre hôte
  let mask: UInt32
  let broadcastCapable: Bool
}

enum IPv4 {
  static func string(_ v: UInt32) -> String {
    return "\(v >> 24).\((v >> 16) & 0xff).\((v >> 8) & 0xff).\(v & 0xff)"
  }

  /// Adresse littérale a.b.c.d uniquement (inet_pton ne fait jamais de DNS).
  static func parse(_ s: String) -> UInt32? {
    var a = in_addr()
    guard inet_pton(AF_INET, s, &a) == 1 else { return nil }
    return UInt32(bigEndian: a.s_addr)
  }

  static func socketAddress(_ ip: UInt32, _ port: UInt16) -> sockaddr_in {
    var a = sockaddr_in()
    a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    a.sin_family = sa_family_t(AF_INET)
    a.sin_port = port.bigEndian
    a.sin_addr = in_addr(s_addr: ip.bigEndian)
    return a
  }

  /// Lit l'adresse d'une sockaddr AF_INET octet par octet : les masques
  /// renvoyés par getifaddrs ont parfois un sa_len tronqué.
  static func read(_ sa: UnsafeMutablePointer<sockaddr>) -> UInt32 {
    let len = Int(sa.pointee.sa_len)
    let raw = UnsafeRawPointer(sa)
    var v: UInt32 = 0
    for i in 0..<4 {
      let byte: UInt8 = (4 + i < len) ? raw.load(fromByteOffset: 4 + i, as: UInt8.self) : 0
      v = (v << 8) | UInt32(byte)
    }
    return v
  }

  /// Interfaces IPv4 actives (getifaddrs), hors boucle locale.
  static func interfaces() -> [IPv4Interface] {
    var head: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&head) == 0, let first = head else { return [] }
    defer { freeifaddrs(head) }
    var out: [IPv4Interface] = []
    for ifa in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let flags = ifa.pointee.ifa_flags
      guard (flags & UInt32(bitPattern: IFF_UP)) != 0,
            (flags & UInt32(bitPattern: IFF_RUNNING)) != 0,
            (flags & UInt32(bitPattern: IFF_LOOPBACK)) == 0,
            let addr = ifa.pointee.ifa_addr,
            addr.pointee.sa_family == sa_family_t(AF_INET)
      else { continue }
      let mask: UInt32 = ifa.pointee.ifa_netmask.map { IPv4.read($0) } ?? 0xffff_ffff
      out.append(IPv4Interface(
        name: String(cString: ifa.pointee.ifa_name),
        ip: IPv4.read(addr),
        mask: mask,
        broadcastCapable: (flags & UInt32(bitPattern: IFF_BROADCAST)) != 0
      ))
    }
    return out
  }
}

// MARK: - Socket BSD (unicast + broadcast)

final class UdpSocket {
  let fd: Int32
  private let source: DispatchSourceRead
  private let onPacket: (ReceivedPacket) -> Void
  private let onFailure: (Int32) -> Void
  private var buffer = [UInt8](repeating: 0, count: 2048)

  /// Ouvre un socket UDP IPv4 lié à 0.0.0.0:port, non bloquant, lu sur `queue`.
  /// Renvoie l'errno en cas d'échec (EADDRINUSE : port déjà pris sans partage).
  static func open(
    port: UInt16,
    queue: DispatchQueue,
    onPacket: @escaping (ReceivedPacket) -> Void,
    onFailure: @escaping (Int32) -> Void
  ) -> (UdpSocket?, Int32) {
    let fd = Darwin.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
    if fd < 0 { return (nil, errno) }
    var one: Int32 = 1
    let size = socklen_t(MemoryLayout<Int32>.size)
    // Partage du port avec le groupe multicast (même port 5568) et redémarrage immédiat.
    _ = Darwin.setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, size)
    _ = Darwin.setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &one, size)
    // Broadcast : réception de l'ArtPoll et envoi éventuel (avec l'entitlement).
    _ = Darwin.setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &one, size)
    var rcvbuf: Int32 = 1 << 20 // absorbe les rafales (plusieurs univers à 44 Hz)
    _ = Darwin.setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &rcvbuf, size)
    let flags = Darwin.fcntl(fd, F_GETFL, 0)
    _ = Darwin.fcntl(fd, F_SETFL, flags | O_NONBLOCK)
    let addr = IPv4.socketAddress(0, port) // 0.0.0.0 : toutes les interfaces
    let rc = withUnsafePointer(to: addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    if rc != 0 {
      let e = errno
      Darwin.close(fd)
      return (nil, e)
    }
    return (UdpSocket(fd: fd, queue: queue, onPacket: onPacket, onFailure: onFailure), 0)
  }

  private init(
    fd: Int32,
    queue: DispatchQueue,
    onPacket: @escaping (ReceivedPacket) -> Void,
    onFailure: @escaping (Int32) -> Void
  ) {
    self.fd = fd
    self.onPacket = onPacket
    self.onFailure = onFailure
    source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
    source.setEventHandler { [weak self] in self?.readAvailable() }
    // Le descripteur n'est fermé qu'une fois la source annulée (règle Dispatch).
    source.setCancelHandler { Darwin.close(fd) }
    source.resume()
  }

  deinit {
    source.cancel()
  }

  func cancel() {
    source.cancel()
  }

  private func readAvailable() {
    let fd = self.fd
    for _ in 0..<64 { // la source se redéclenche s'il en reste
      var from = sockaddr_in()
      var len = socklen_t(MemoryLayout<sockaddr_in>.size)
      let n: Int = buffer.withUnsafeMutableBytes { raw in
        withUnsafeMutablePointer(to: &from) {
          $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.recvfrom(fd, raw.baseAddress, raw.count, 0, $0, &len)
          }
        }
      }
      if n < 0 {
        let e = errno
        if e == EAGAIN || e == EWOULDBLOCK || e == EINTR { return }
        source.cancel()
        onFailure(e)
        return
      }
      // Datagramme vide ou trop grand pour du DMX (sACN ≤ 638, Art-Net ≤ 530) : ignoré.
      guard n > 0, n <= UdpLimits.maxDatagram else { continue }
      onPacket(ReceivedPacket(
        src: IPv4.string(UInt32(bigEndian: from.sin_addr.s_addr)),
        port: Int(UInt16(bigEndian: from.sin_port)),
        data: Data(buffer[0..<n]).base64EncodedString()
      ))
    }
  }

  /// Repli multicast : IP_ADD_MEMBERSHIP sur ce socket (l'entitlement vaut
  /// aussi pour les sockets BSD). Renvoie le nombre de groupes rejoints.
  func join(groups: [UInt32], interface: UInt32) -> Int {
    var joined = 0
    for g in groups {
      var mreq = ip_mreq(
        imr_multiaddr: in_addr(s_addr: g.bigEndian),
        imr_interface: in_addr(s_addr: interface.bigEndian)
      )
      let rc = Darwin.setsockopt(fd, IPPROTO_IP, IP_ADD_MEMBERSHIP, &mreq, socklen_t(MemoryLayout<ip_mreq>.size))
      if rc == 0 || errno == EADDRINUSE { joined += 1 } // EADDRINUSE : déjà membre
    }
    return joined
  }

  /// Envoie depuis ce socket, donc depuis son port. Renvoie 0 ou l'errno.
  func send(_ data: Data, to ip: UInt32, port: UInt16) -> Int32 {
    let fd = self.fd
    let addr = IPv4.socketAddress(ip, port)
    let n: Int = data.withUnsafeBytes { raw in
      withUnsafePointer(to: addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          Darwin.sendto(fd, raw.baseAddress, raw.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
    }
    return n < 0 ? errno : 0
  }
}

// MARK: - Passerelle

final class UdpGateway {
  let packets = PacketQueue(capacity: UdpLimits.queueCapacity)
  /// Appelés sur la file interne.
  var onError: ((String) -> Void)?
  var onNetworkChange: (([[String: String]]) -> Void)?

  private let queue = DispatchQueue(label: "com.pikoo.setremote.udp", qos: .userInitiated)
  private var config: ListenConfig? // écoute demandée par la page (conservée en arrière-plan)
  private var suspended = false
  private var socket: UdpSocket?
  private var socketGeneration = 0
  private var group: NWConnectionGroup?
  private var groupGeneration = 0
  /// Interface demandée au dernier groupe ("" : aucune) ; nil : pas de groupe tenté.
  private var groupInterface: String?
  private var monitor: NWPathMonitor?
  private var path: NWPath?
  private var lastSignature: String?
  private var localNetworkAlertTriggered = false

  /// Vrai si le binaire porte l'entitlement multicast. Le simulateur n'en a pas besoin.
  static let multicastEntitled: Bool = {
    #if targetEnvironment(simulator)
      return true
    #else
      return (Bundle.main.object(forInfoDictionaryKey: UdpLimits.entitlementInfoKey) as? Bool) ?? false
    #endif
  }()

  // MARK: API (tout thread ; le travail se fait sur `queue`)

  func listen(protocolName: String, universes: [Int], multicast: Bool) {
    queue.async { [self] in
      guard let proto = DmxProtocol(rawValue: protocolName) else { return fail("invalid-protocol") }
      guard universes.count <= UdpLimits.maxUniverses,
            universes.allSatisfy({ proto.accepts(universe: $0) })
      else { return fail("invalid-universes") }
      var unique: [Int] = []
      for u in universes where !unique.contains(u) { unique.append(u) }
      ensureMonitor()
      config = ListenConfig(proto: proto, universes: unique, multicast: multicast)
      packets.clear()
      if !suspended { openSockets() }
    }
  }

  func stop() {
    queue.async { [self] in
      config = nil
      closeSockets()
      packets.clear()
    }
  }

  /// Arrière-plan : iOS suspend l'app ; on ferme proprement et on garde la demande.
  func suspend() {
    queue.async { [self] in
      suspended = true
      closeSockets()
      packets.clear()
    }
  }

  /// Premier plan : on rouvre si la page écoutait, et on republie le réseau.
  func resume() {
    queue.async { [self] in
      guard suspended else { return }
      suspended = false
      if config != nil { openSockets() }
      if monitor != nil { publishNetwork(force: true) }
    }
  }

  func send(host: String, port: Int, base64: String) {
    queue.async { [self] in
      guard let ip = IPv4.parse(host), ip != 0 else { return fail("invalid-host") }
      guard (1...65535).contains(port) else { return fail("invalid-port") }
      guard let data = Data(base64Encoded: base64), !data.isEmpty, data.count <= UdpLimits.maxDatagram
      else { return fail("invalid-data") }
      guard let socket else { return fail("not-listening") }
      let toGroup = isGroupAddress(ip)
      if toGroup && !UdpGateway.multicastEntitled { return fail("multicast-not-permitted") }
      let err = socket.send(data, to: ip, port: UInt16(port))
      if err == 0 { return }
      // Sans accès au réseau local (refusé par l'utilisateur), iOS renvoie en général EHOSTUNREACH.
      fail(toGroup && (err == EPERM || err == EACCES || err == EHOSTUNREACH) ? "multicast-not-permitted" : "send-failed")
    }
  }

  func networkInfo(_ done: @escaping ([[String: String]]) -> Void) {
    queue.async { [self] in
      ensureMonitor()
      done(interfaceList())
    }
  }

  func startMonitoring() {
    queue.async { [self] in ensureMonitor() }
  }

  func shutdown() {
    queue.async { [self] in
      config = nil
      closeSockets()
      packets.clear()
      monitor?.cancel()
      monitor = nil
    }
  }

  // MARK: Interne (sur `queue`)

  private func fail(_ reason: String) {
    onError?(reason)
  }

  private func openSockets() {
    closeSockets()
    guard let c = config else { return }
    socketGeneration += 1
    let gen = socketGeneration
    let (opened, _) = UdpSocket.open(
      port: c.proto.port,
      queue: queue,
      onPacket: { [weak self] p in self?.packets.push(p) },
      onFailure: { [weak self] _ in self?.socketFailed(gen) }
    )
    guard let opened else {
      config = nil
      return fail("bind-failed")
    }
    socket = opened
    triggerLocalNetworkAlertOnce()
    guard c.multicast else { return }
    switch c.proto {
    case .sacn:
      startGroup(c)
    case .artnet:
      // Art-Net : pas de multicast, mais l'ArtPoll arrive en broadcast.
      if !UdpGateway.multicastEntitled { fail("multicast-not-permitted") }
    }
  }

  private func socketFailed(_ gen: Int) {
    guard gen == socketGeneration, config != nil else { return }
    config = nil
    closeSockets()
    fail("socket-failed")
  }

  private func closeSockets() {
    socketGeneration += 1
    socket?.cancel()
    socket = nil
    stopGroup()
  }

  private func stopGroup() {
    groupGeneration += 1
    group?.cancel()
    group = nil
    groupInterface = nil
  }

  /// Rejoint 239.255.(u >> 8).(u & 255):5568 pour chaque univers.
  private func startGroup(_ c: ListenConfig) {
    stopGroup()
    guard let port = NWEndpoint.Port(rawValue: c.proto.port) else { return }
    let endpoints: [NWEndpoint] = c.universes.compactMap { (u: Int) -> NWEndpoint? in
      guard let host = IPv4Address("239.255.\((u >> 8) & 0xff).\(u & 0xff)") else { return nil }
      return NWEndpoint.hostPort(host: .ipv4(host), port: port)
    }
    guard !endpoints.isEmpty else { return }
    let iface = preferredInterface()
    groupInterface = iface?.name ?? ""
    // Sans l'entitlement, l'appareil ne recevrait rien (ou le groupe échouerait) :
    // on le dit tout de suite ; l'unicast continue sur le socket BSD.
    guard UdpGateway.multicastEntitled else { return fail("multicast-not-permitted") }
    let descriptor: NWMulticastGroup
    do {
      descriptor = try NWMulticastGroup(for: endpoints)
    } catch {
      return fail("multicast-failed")
    }
    let params = NWParameters.udp
    params.allowLocalEndpointReuse = true // partage du port 5568 avec le socket BSD
    if let iface { params.requiredInterface = iface }
    groupGeneration += 1
    let gen = groupGeneration
    let g = NWConnectionGroup(with: descriptor, using: params)
    g.setReceiveHandler(maximumMessageSize: UdpLimits.maxDatagram, rejectOversizedMessages: true) {
      [weak self] message, content, _ in
      guard let self, let content, !content.isEmpty else { return }
      let (src, srcPort) = UdpGateway.sender(message.remoteEndpoint)
      self.packets.push(ReceivedPacket(src: src, port: srcPort, data: content.base64EncodedString()))
    }
    // Pour le repli BSD : groupes 239.255.hi.lo et adresse de l'interface choisie.
    let groupAddresses = c.universes.map { UInt32(0xefff_0000) | UInt32(truncatingIfNeeded: $0 & 0xffff) }
    let ifaceAddress = IPv4.interfaces().first(where: { $0.name == iface?.name })?.ip ?? 0
    g.stateUpdateHandler = { [weak self] state in
      guard let self, gen == self.groupGeneration else { return }
      switch state {
      case let .failed(error):
        self.group?.cancel()
        self.group = nil
        if UdpGateway.isPermissionError(error) { return self.fail("multicast-not-permitted") }
        // Ex. EADDRINUSE si Network.framework refuse de partager le port 5568 avec
        // le socket BSD : celui-ci rejoint alors les groupes lui-même.
        if let socket = self.socket, socket.join(groups: groupAddresses, interface: ifaceAddress) > 0 { return }
        self.fail("multicast-failed")
      case let .waiting(error):
        if UdpGateway.isPermissionError(error) {
          self.group?.cancel()
          self.group = nil
          self.fail("multicast-not-permitted")
        }
      default:
        break
      }
    }
    group = g
    g.start(queue: queue)
  }

  private func ensureMonitor() {
    guard monitor == nil else { return }
    let m = NWPathMonitor()
    m.pathUpdateHandler = { [weak self] p in self?.pathChanged(p) }
    monitor = m
    m.start(queue: queue)
  }

  private func pathChanged(_ p: NWPath) {
    path = p
    publishNetwork(force: false)
    // Le groupe multicast est lié à une interface : on le recrée quand
    // l'interface préférée change (adaptateur Ethernet branché, Wi-Fi perdu…).
    // Le socket BSD, lié à 0.0.0.0, survit aux changements d'interface.
    if let c = config, c.multicast, c.proto == .sacn, !suspended, socket != nil,
       groupInterface != (preferredInterface()?.name ?? "") {
      startGroup(c)
    }
  }

  private func publishNetwork(force: Bool) {
    let list = interfaceList()
    let signature = list
      .map { "\($0["name"] ?? "")|\($0["kind"] ?? "")|\($0["ip"] ?? "")|\($0["mask"] ?? "")" }
      .joined(separator: ";")
    let first = lastSignature == nil // premier relevé du moniteur : état initial, pas un changement
    if !force && (first || signature == lastSignature) {
      lastSignature = signature
      return
    }
    lastSignature = signature
    onNetworkChange?(list)
  }

  /// Filaire d'abord, sinon Wi-Fi, parmi les interfaces qui ont une IPv4.
  private func preferredInterface() -> NWInterface? {
    guard let p = path else { return nil }
    let withIPv4 = Set(IPv4.interfaces().map { $0.name })
    let usable = p.availableInterfaces.filter { withIPv4.contains($0.name) }
    return usable.first(where: { $0.type == .wiredEthernet }) ?? usable.first(where: { $0.type == .wifi })
  }

  /// IPv4 uniquement. Type d'interface : celui de NWPathMonitor quand il la
  /// connaît, sinon en0 = Wi-Fi, autres enN = Ethernet (heuristique : les noms
  /// BSD ne sont pas une API, TN3179).
  private func interfaceList() -> [[String: String]] {
    var types: [String: NWInterface.InterfaceType] = [:]
    for i in path?.availableInterfaces ?? [] { types[i.name] = i.type }
    var seen = Set<String>()
    var out: [[String: String]] = []
    for i in IPv4.interfaces() {
      let ip = IPv4.string(i.ip)
      guard seen.insert(i.name + "/" + ip).inserted else { continue }
      out.append([
        "name": i.name,
        "kind": UdpGateway.kind(i.name, types[i.name]),
        "ip": ip,
        "mask": IPv4.string(i.mask),
      ])
    }
    return out
  }

  /// Multicast, broadcast général ou broadcast dirigé d'un sous-réseau local.
  private func isGroupAddress(_ ip: UInt32) -> Bool {
    if ip == 0xffff_ffff || (ip >> 28) == 0xe { return true }
    return IPv4.interfaces().contains { $0.mask != 0xffff_ffff && ($0.ip | ~$0.mask) == ip }
  }

  /// Fait apparaître l'invite « réseau local » au démarrage de la passerelle
  /// plutôt qu'au premier ArtPollReply (qui serait refusé en attendant la
  /// réponse) : connecter un socket UDP à une adresse locale ne transmet rien
  /// (TN3179). L'unicast reçu n'en dépend pas.
  private func triggerLocalNetworkAlertOnce() {
    guard !localNetworkAlertTriggered else { return }
    localNetworkAlertTriggered = true
    for i in IPv4.interfaces() where i.broadcastCapable && i.mask != 0 && (~i.mask) > 1 {
      let net = i.ip & i.mask
      let target = (net | 1) == i.ip ? (net | 2) : (net | 1)
      let fd = Darwin.socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
      guard fd >= 0 else { continue }
      let addr = IPv4.socketAddress(target, 9) // port 9 : discard
      _ = withUnsafePointer(to: addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
      Darwin.close(fd)
    }
  }

  static func kind(_ name: String, _ type: NWInterface.InterfaceType?) -> String {
    if let type {
      switch type {
      case .wiredEthernet: return "ethernet"
      case .wifi: return "wifi"
      default: return "other"
      }
    }
    if name == "en0" { return "wifi" }
    if name.hasPrefix("en"), Int(name.dropFirst(2)) != nil { return "ethernet" }
    return "other"
  }

  static func sender(_ endpoint: NWEndpoint?) -> (String, Int) {
    guard case let .hostPort(host, port)? = endpoint else { return ("", 0) }
    if case let .ipv4(address) = host {
      let b = [UInt8](address.rawValue)
      if b.count == 4 { return ("\(b[0]).\(b[1]).\(b[2]).\(b[3])", Int(port.rawValue)) }
    }
    return ("\(host)", Int(port.rawValue))
  }

  static func isPermissionError(_ error: NWError) -> Bool {
    if case let .posix(code) = error { return code == .EPERM || code == .EACCES }
    return false
  }
}
