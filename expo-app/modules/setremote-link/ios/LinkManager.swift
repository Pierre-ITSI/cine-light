import Foundation

// ════════════════════════════════════════════════════════════════════════════
// Coordinateur des liaisons hors ligne (iOS) : configuration demandée par la
// page, registre des pairs admis, routage des envois, état publié, file de
// réception. TOUT se passe sur une file série (`queue`) : Network.framework et
// CoreBluetooth y délivrent aussi leurs rappels. Seules la file de réception
// (drain) et l'état publié (getState) sont lus depuis le thread JS, sous verrou.
// Contrat : docs/OFFLINE-NATIVE.md § 2 ; choix techniques : § 5.
// ════════════════════════════════════════════════════════════════════════════

struct ModeState {
  let available: Bool
  let active: Bool
  let error: String?

  var dictionary: [String: Any] {
    var d: [String: Any] = ["available": available, "active": active]
    if let error { d["error"] = error }
    return d
  }

  var signature: String { "\(available)|\(active)|\(error ?? "")" }
}

/// Un pair admis (poignée de main réussie), vu par le coordinateur.
protocol LinkPeer: AnyObject {
  var id: String { get }
  var mode: LinkMode { get }
  var name: String { get }
  /// Messages DATA déjà encodés ; la file du pair jette ses plus anciens au-delà de son plafond.
  func enqueueData(_ messages: [Data])
}

/// Une liaison (Wi-Fi ou Bluetooth). Méthodes appelées sur la file interne.
protocol LinkTransport: AnyObject {
  var mode: LinkMode { get }
  var config: LinkConfig? { get }
  /// Démarre avec cette configuration ; sans effet si déjà démarrée.
  func start(_ config: LinkConfig)
  /// Arrête tout et oublie la configuration ; les pairs sont retirés du registre.
  func stop()
  func state() -> ModeState
}

final class LinkManager {
  static let peersEvent = "onSetRemoteLinkPeers"
  static let stateEvent = "onSetRemoteLinkState"
  static let errorEvent = "onSetRemoteLinkError"

  let queue = DispatchQueue(label: "com.pikoo.setremote.link", qos: .userInitiated)
  let inbox = Inbox(maxFrames: LinkLimits.inboxMaxFrames, maxBytes: LinkLimits.inboxMaxBytes)
  /// Événement vers JS (nom, corps) ; appelé sur la file interne.
  var emit: ((String, [String: Any?]) -> Void)?

  // État, lu et modifié uniquement sur `queue`
  private var peers: [String: LinkPeer] = [:]
  private var peerOrder: [String] = []
  private var requested: [LinkMode] = []
  private var config: LinkConfig?
  private var suspended = false
  private lazy var transports: [LinkTransport] = [LanLink(manager: self), BleLink(manager: self)]

  private let stateLock = NSLock()
  private var snapshot: [String: Any] = [:]
  private var lastStateSignature: String?

  // MARK: API (tout thread ; le travail se fait sur `queue`, dans l'ordre des appels)

  func start(modes: [String], role: String, roomTagHex: String, authKeyHex: String, name: String) {
    queue.async { [self] in
      var wanted: [LinkMode] = []
      for m in modes {
        guard let mode = LinkMode(rawValue: m) else { return error(nil, "invalid-modes") }
        if !wanted.contains(mode) { wanted.append(mode) }
      }
      guard !wanted.isEmpty else { return error(nil, "invalid-modes") }
      guard let r = LinkRole(rawValue: role) else { return error(nil, "invalid-role") }
      guard let tag = LinkWire.parseHex(roomTagHex, bytes: LinkLimits.roomTagBytes),
            let key = LinkWire.parseHex(authKeyHex, bytes: LinkLimits.authKeyBytes)
      else { return error(nil, "invalid-room") }
      let nameBytes = LinkWire.truncateUtf8(Array(name.utf8), max: LinkLimits.maxNameBytes)
      let next = LinkConfig(role: r, roomTag: tag, authKey: key, name: LinkWire.sanitizeName(LinkWire.decodeUtf8(nameBytes)))
      if !next.same(config) { inbox.clear() }
      config = next
      requested = wanted
      for t in transports {
        guard requested.contains(t.mode) else {
          t.stop()
          continue
        }
        if !next.same(t.config) { t.stop() }
        if !suspended { t.start(next) }
      }
      refreshState()
    }
  }

  func stop(modes: [String]) {
    queue.async { [self] in
      let list = modes.isEmpty ? LinkMode.allCases : modes.compactMap { LinkMode(rawValue: $0) }
      for m in list {
        requested.removeAll { $0 == m }
        transports.first { $0.mode == m }?.stop()
      }
      if requested.isEmpty {
        config = nil
        inbox.clear()
      }
      refreshState()
    }
  }

  func send(frames: [String], to: [String]) {
    queue.async { [self] in
      if requested.isEmpty { return error(nil, "not-started") }
      guard !frames.isEmpty, frames.count <= 256, to.count <= 64 else { return error(nil, "invalid-frames") }
      var targets: [LinkPeer] = []
      if to.isEmpty {
        targets = peerOrder.compactMap { peers[$0] }
      } else {
        var seen = Set<String>()
        var unknown = false
        for id in to where seen.insert(id).inserted {
          if let p = peers[id] { targets.append(p) } else { unknown = true }
        }
        if unknown { error(nil, "unknown-peer") }
      }
      if targets.isEmpty { return }
      // Un seul encodage par trame, partagé entre les pairs
      let messages = frames.map { LinkWire.encodeData(Data($0.utf8)) }
      var tooLarge: [LinkMode] = []
      for p in targets {
        var list: [Data] = []
        for m in messages {
          if m.count - 1 > p.mode.maxFrame {
            if !tooLarge.contains(p.mode) { tooLarge.append(p.mode) }
          } else if m.count > 1 {
            list.append(m)
          }
        }
        if !list.isEmpty { p.enqueueData(list) }
      }
      for m in tooLarge { error(m, "too-large") }
    }
  }

  /// Synchrone (thread JS) : au plus maxFrames trames et maxBytes octets ; le reste attend.
  func drain(maxFrames: Int, maxBytes: Int) -> [[String: Any]] {
    let n = Swift.max(1, Swift.min(maxFrames, LinkLimits.maxBatchFrames))
    let b = Swift.max(1, Swift.min(maxBytes, LinkLimits.maxBatchBytes))
    return inbox.drain(maxCount: n, maxSize: b).map { ["peer": $0.peer, "mode": $0.mode, "data": $0.data] }
  }

  /// Synchrone (thread JS).
  func state() -> [String: Any] {
    stateLock.lock()
    let ready = lastStateSignature != nil
    let s = snapshot
    stateLock.unlock()
    if ready { return s }
    return queue.sync { () -> [String: Any] in
      self.refreshState()
      return self.currentSnapshot()
    }
  }

  /// Arrière-plan : iOS suspendrait les sockets et le Bluetooth ; on ferme tout et on garde la demande.
  func suspend() {
    queue.async { [self] in
      guard !suspended else { return }
      suspended = true
      for t in transports { t.stop() }
      refreshState()
    }
  }

  /// Premier plan : on rouvre ce que la page avait demandé.
  func resume() {
    queue.async { [self] in
      guard suspended else { return }
      suspended = false
      guard let c = config else { return }
      for t in transports where requested.contains(t.mode) { t.start(c) }
      refreshState()
    }
  }

  func shutdown() {
    queue.async { [self] in
      requested = []
      config = nil
      for t in transports { t.stop() }
      inbox.clear()
    }
  }

  // MARK: Pour les liaisons (sur `queue`)

  /// Faux si le plafond de la liaison est atteint (le pair doit être fermé).
  func admit(_ peer: LinkPeer, limit: Int) -> Bool {
    if peers.values.filter({ $0.mode == peer.mode }).count >= limit {
      error(peer.mode, "too-many-peers")
      return false
    }
    peers[peer.id] = peer
    peerOrder.append(peer.id)
    publishPeers()
    return true
  }

  /// Sans effet si le pair n'est pas (ou plus) enregistré.
  func remove(_ peer: LinkPeer) {
    guard peers.removeValue(forKey: peer.id) != nil else { return }
    peerOrder.removeAll { $0 == peer.id }
    publishPeers()
  }

  func receive(peer: String, mode: LinkMode, data: String, bytes: Int) {
    guard !data.isEmpty else { return }
    if inbox.push(InboundFrame(peer: peer, mode: mode.rawValue, data: data, bytes: bytes)) {
      error(mode, "congested")
    }
  }

  func error(_ mode: LinkMode?, _ reason: String) {
    var body: [String: Any?] = ["reason": reason]
    if let mode { body["mode"] = mode.rawValue } // absent = null côté pont
    emit?(LinkManager.errorEvent, body)
  }

  /// Recalcule l'état et le publie s'il a changé.
  func refreshState() {
    let lan = transports[0].state()
    let ble = transports[1].state()
    let s: [String: Any] = ["lan": lan.dictionary, "ble": ble.dictionary]
    let sig = lan.signature + ";" + ble.signature
    stateLock.lock()
    snapshot = s
    let changed = sig != lastStateSignature
    lastStateSignature = sig
    stateLock.unlock()
    if changed { emit?(LinkManager.stateEvent, s.mapValues { $0 as Any? }) }
  }

  private func currentSnapshot() -> [String: Any] {
    stateLock.lock()
    defer { stateLock.unlock() }
    return snapshot
  }

  private func publishPeers() {
    let list: [[String: Any]] = peerOrder.compactMap { id in
      guard let p = peers[id] else { return nil }
      var d: [String: Any] = ["peer": p.id, "mode": p.mode.rawValue]
      if !p.name.isEmpty { d["name"] = p.name }
      return d
    }
    let body: [String: Any?] = ["peers": list]
    emit?(LinkManager.peersEvent, body)
  }
}
