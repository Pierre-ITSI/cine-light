import CoreBluetooth
import CryptoKit
import Foundation

// ════════════════════════════════════════════════════════════════════════════
// Format sur le fil des liaisons hors ligne, version 1 — même spécification que
// la référence TypeScript src/wire.ts (testée sous Node) et que
// android/…/LinkWire.kt (compilé et vérifié sur JVM). docs/OFFLINE-NATIVE.md § 4.
//
//   message   [kind u8][corps]              HELLO, AUTH, DATA, PING
//   Wi-Fi     [longueur u32 BE][message]
//   Bluetooth [frameId u8][index u16 BE][count u16 BE][morceau]
//
// Les Data reçues sont recopiées en [UInt8] avant lecture : une tranche de
// Data garde les indices de l'original (m[0] y planterait).
// Aucune trace du contenu : ni trame, ni nom, ni clé n'est journalisé.
// ════════════════════════════════════════════════════════════════════════════

enum LinkLimits {
  static let lanMaxFrame = 65536
  static let bleMaxFrame = 4096
  static let lanMaxMessage = 1 + lanMaxFrame
  static let bleMaxMessage = 1 + bleMaxFrame
  static let maxNameBytes = 128
  static let maxNameChars = 64
  static let roomTagBytes = 8
  static let authKeyBytes = 32
  static let nonceBytes = 16
  static let macBytes = 32
  static let helloFixedBytes = 28
  static let helloMaxBytes = helloFixedBytes + maxNameBytes
  static let authBytes = 1 + macBytes
  static let preauthMaxMessage = 160
  static let preauthMaxBytes = 256
  static let lanHeaderBytes = 4
  static let fragHeaderBytes = 5
  static let maxAttValue = 512
  static let maxFragments = 512
  static let maxPartials = 4
  static let reassemblyTimeout: TimeInterval = 5
  static let handshakeTimeout: TimeInterval = 5
  /// Bluetooth : connexion, découverte GATT, abonnement et poignée de main.
  static let bleSetupTimeout: TimeInterval = 10
  static let keepalive: TimeInterval = 5
  static let deadAfter: TimeInterval = 15
  static let maxLanPeers = 64
  static let maxLanPending = 8
  /// Télécommande (central) : écrans Bluetooth connectés à la fois.
  static let maxBlePeers = 8
  static let maxBlePending = 4
  /// Écran (périphérique) : centraux abonnés à la fois.
  static let maxBleCentrals = 4
  static let lanPeerBacklog = 1 << 20
  static let blePeerBacklog = 64 * 1024
  /// Octets confiés à TCP et pas encore acquittés par la pile, par pair.
  static let lanInFlight = 256 * 1024
  static let inboxMaxFrames = 1024
  static let inboxMaxBytes = 8 << 20
  static let maxBatchFrames = 256
  static let maxBatchBytes = 1 << 20
}

enum LinkMode: String, CaseIterable {
  case lan
  case ble

  /// Début des identifiants de pair (« lan-… », « ble-… ») : un même appareil
  /// joint par les deux liaisons a toujours deux identifiants distincts.
  var prefix: String { rawValue }
  var maxFrame: Int { self == .lan ? LinkLimits.lanMaxFrame : LinkLimits.bleMaxFrame }
}

enum LinkRole: String {
  case remote
  case screen

  var wire: UInt8 { self == .remote ? LinkWire.roleRemote : LinkWire.roleScreen }
}

/// Ce que la page a demandé ; immuable.
struct LinkConfig {
  let role: LinkRole
  let roomTag: Data
  let authKey: Data
  let name: String

  var roomTagHex: String { LinkWire.hex(roomTag) }

  func same(_ o: LinkConfig?) -> Bool {
    guard let o else { return false }
    return o.role == role && o.roomTag == roomTag && o.authKey == authKey && o.name == name
  }

  func newHandshake() -> Handshake {
    Handshake(role: role.wire, roomTag: roomTag, authKey: authKey, nonce: LinkWire.randomBytes(LinkLimits.nonceBytes), name: name)
  }
}

enum LinkWire {
  static let version: UInt8 = 1
  static let serviceType = "_setremote._tcp"
  static let txtRoom = "r"
  static let txtVersion = "v"
  static let serviceUUID = CBUUID(string: "CA098D33-DCA0-45ED-8875-D0DA84EF2400")
  /// Écrite par la télécommande (central → écran).
  static let rxUUID = CBUUID(string: "CA098D33-DCA0-45ED-8875-D0DA84EF2401")
  /// Notifiée par l'écran (écran → central).
  static let txUUID = CBUUID(string: "CA098D33-DCA0-45ED-8875-D0DA84EF2402")
  static let namePrefix = "SR"

  static let kindHello: UInt8 = 0x01
  static let kindAuth: UInt8 = 0x02
  static let kindData: UInt8 = 0x03
  static let kindPing: UInt8 = 0x04
  static let roleRemote: UInt8 = 0x52
  static let roleScreen: UInt8 = 0x53
  static let macContext = "SRL1"
  static let ping = Data([kindPing])

  /// Aléa système (SystemRandomNumberGenerator : cryptographique sur les plateformes Apple).
  static func randomBytes(_ n: Int) -> Data {
    var g = SystemRandomNumberGenerator()
    return Data((0..<n).map { _ in UInt8.random(in: 0...255, using: &g) })
  }

  /// Identifiant de pair opaque : lettre de la liaison + 12 chiffres hexadécimaux aléatoires.
  static func newPeerId(_ prefix: String) -> String { prefix + "-" + hex(randomBytes(6)) }

  static func hex(_ d: Data) -> String {
    let digits = Array("0123456789abcdef")
    var s = ""
    s.reserveCapacity(d.count * 2)
    for b in d {
      s.append(digits[Int(b >> 4)])
      s.append(digits[Int(b & 15)])
    }
    return s
  }

  /// Hexadécimal minuscule de longueur exacte `bytes * 2`, sinon nil.
  static func parseHex(_ s: String, bytes: Int) -> Data? {
    let chars = Array(s.utf8)
    guard chars.count == bytes * 2 else { return nil }
    func nibble(_ c: UInt8) -> UInt8? {
      switch c {
      case 0x30...0x39: return c - 0x30
      case 0x61...0x66: return c - 0x61 + 10
      default: return nil
      }
    }
    var out = [UInt8](repeating: 0, count: bytes)
    for i in 0..<bytes {
      guard let hi = nibble(chars[2 * i]), let lo = nibble(chars[2 * i + 1]) else { return nil }
      out[i] = (hi << 4) | lo
    }
    return Data(out)
  }

  /// Comparaison en temps constant.
  static func equal(_ a: Data, _ b: Data) -> Bool {
    let x = [UInt8](a), y = [UInt8](b)
    guard x.count == y.count else { return false }
    var d: UInt8 = 0
    for i in 0..<x.count { d |= x[i] ^ y[i] }
    return d == 0
  }

  /// Tronque un UTF-8 à `max` octets sans couper un caractère.
  static func truncateUtf8(_ d: [UInt8], max: Int) -> [UInt8] {
    guard d.count > max else { return d }
    var end = max
    while end > 0 && (d[end] & 0xc0) == 0x80 { end -= 1 }
    return Array(d[0..<end])
  }

  /// UTF-8 tolérant (U+FFFD pour une séquence invalide).
  static func decodeUtf8<C: Collection>(_ bytes: C) -> String where C.Element == UInt8 {
    String(decoding: bytes, as: UTF8.self)
  }

  /// Nom reçu d'un pair : sans caractère de contrôle, 64 points de code au plus.
  static func sanitizeName(_ raw: String) -> String {
    var scalars = String.UnicodeScalarView()
    for u in raw.unicodeScalars {
      let v = u.value
      if v < 0x20 || (0x7f...0x9f).contains(v) || v == 0x2028 || v == 0x2029 { continue }
      scalars.append(u)
    }
    let trimmed = String(scalars).trimmingCharacters(in: .whitespacesAndNewlines)
    var out = String.UnicodeScalarView()
    for u in trimmed.unicodeScalars.prefix(LinkLimits.maxNameChars) { out.append(u) }
    return String(out)
  }

  static func encodeHello(role: UInt8, roomTag: Data, nonce: Data, name: String) -> Data {
    let n = truncateUtf8(Array(name.utf8), max: LinkLimits.maxNameBytes)
    var out: [UInt8] = [kindHello, version, role]
    out += [UInt8](roomTag)
    out += [UInt8](nonce)
    out.append(UInt8(n.count))
    out += n
    return Data(out)
  }

  struct Hello {
    let role: UInt8
    let roomTag: Data
    let nonce: Data
    let name: String
  }

  /// HELLO strict : longueur exacte, version 1, rôle connu. Sinon nil.
  static func decodeHello(_ m: [UInt8]) -> Hello? {
    guard m.count >= LinkLimits.helloFixedBytes, m.count <= LinkLimits.helloMaxBytes,
          m[0] == kindHello, m[1] == version,
          m[2] == roleRemote || m[2] == roleScreen
    else { return nil }
    let nameLen = Int(m[LinkLimits.helloFixedBytes - 1])
    guard nameLen <= LinkLimits.maxNameBytes, m.count == LinkLimits.helloFixedBytes + nameLen else { return nil }
    let tagEnd = 3 + LinkLimits.roomTagBytes
    return Hello(
      role: m[2],
      roomTag: Data(m[3..<tagEnd]),
      nonce: Data(m[tagEnd..<(tagEnd + LinkLimits.nonceBytes)]),
      name: sanitizeName(decodeUtf8(m[LinkLimits.helloFixedBytes...]))
    )
  }

  /// HMAC-SHA256(authKey, "SRL1" ‖ rôle émetteur ‖ nonce destinataire ‖ nonce émetteur).
  static func authMac(key: Data, senderRole: UInt8, receiverNonce: Data, senderNonce: Data) -> Data {
    var h = HMAC<SHA256>(key: SymmetricKey(data: key))
    h.update(data: Data(macContext.utf8))
    h.update(data: Data([senderRole]))
    h.update(data: receiverNonce)
    h.update(data: senderNonce)
    return Data(h.finalize())
  }

  static func encodeAuth(_ mac: Data) -> Data { Data([kindAuth]) + mac }

  /// Message DATA : [3] + octets UTF-8 de la trame.
  static func encodeData(_ frame: Data) -> Data { Data([kindData]) + frame }

  static func lanRecord(_ message: Data) -> Data {
    let n = UInt32(message.count)
    return Data([UInt8(n >> 24), UInt8((n >> 16) & 0xff), UInt8((n >> 8) & 0xff), UInt8(n & 0xff)]) + message
  }

  /// Découpe un message en valeurs GATT d'au plus `maxValue` octets (plafonné à 512).
  /// Tableau vide si c'est impossible (message vide, trop de fragments).
  static func fragment(_ message: Data, frameId: Int, maxValue: Int) -> [Data] {
    let m = [UInt8](message)
    let chunk = Swift.min(maxValue, LinkLimits.maxAttValue) - LinkLimits.fragHeaderBytes
    guard !m.isEmpty, chunk >= 1 else { return [] }
    let count = (m.count + chunk - 1) / chunk
    guard count <= LinkLimits.maxFragments else { return [] }
    var out: [Data] = []
    out.reserveCapacity(count)
    for i in 0..<count {
      let start = i * chunk
      let end = Swift.min(m.count, start + chunk)
      var p: [UInt8] = [UInt8(frameId & 0xff), UInt8(i >> 8), UInt8(i & 0xff), UInt8(count >> 8), UInt8(count & 0xff)]
      p += m[start..<end]
      out.append(Data(p))
    }
    return out
  }

  /// Données de service annoncées par un écran Android : [version][roomTag].
  static func serviceData(_ roomTag: Data) -> Data { Data([version]) + roomTag }

  /// Nom local annoncé par un écran iOS : « SR » + roomTag hexadécimal (18 caractères).
  static func localName(_ roomTag: Data) -> String { namePrefix + hex(roomTag) }
}

// MARK: - Poignée de main

/// Résultat du traitement d'un message reçu.
struct HandshakeEvent {
  var send: [Data] = []
  /// Non nil : le pair vient d'être admis (nom éventuellement vide).
  var admittedName: String?
  var data: String?
  /// Non nil : violation, fermer la connexion.
  var error: String?
}

/// Machine d'état d'une connexion (un pair) ; utilisée sur la file interne seulement.
/// Même comportement que la classe Handshake de src/wire.ts.
final class Handshake {
  private let role: UInt8
  private let roomTag: Data
  private let authKey: Data
  private let nonce: Data
  private let name: String
  private var state = 0 // 0 attente HELLO, 1 attente AUTH, 2 ouvert, 3 fermé
  private var helloSent = false
  private var peerNonce = Data()
  private var peerName = ""

  init(role: UInt8, roomTag: Data, authKey: Data, nonce: Data, name: String) {
    self.role = role
    self.roomTag = roomTag
    self.authKey = authKey
    self.nonce = nonce
    self.name = name
  }

  var admitted: Bool { state == 2 }

  func hello() -> Data {
    helloSent = true
    return LinkWire.encodeHello(role: role, roomTag: roomTag, nonce: nonce, name: name)
  }

  /// HELLO à envoyer quand le canal devient prêt, sauf s'il est déjà parti : en
  /// Bluetooth, le HELLO du pair (et donc notre HELLO paresseux) peut être
  /// traité avant le rappel « abonné ». Un second HELLO ferait échouer le pair.
  func helloIfNeeded() -> Data? {
    helloSent ? nil : hello()
  }

  private func fail(_ reason: String) -> HandshakeEvent {
    state = 3
    return HandshakeEvent(error: reason)
  }

  func receive(_ message: Data) -> HandshakeEvent {
    let m = [UInt8](message)
    if state == 3 { return HandshakeEvent(error: "protocol") }
    guard let kind = m.first else { return fail("empty") }
    if kind == LinkWire.kindPing { return HandshakeEvent() }
    switch state {
    case 0:
      guard kind == LinkWire.kindHello else { return fail(kind == LinkWire.kindData ? "unauthenticated" : "hello") }
      guard let h = LinkWire.decodeHello(m) else { return fail("hello") }
      if h.role == role { return fail("role") }
      if !LinkWire.equal(h.roomTag, roomTag) { return fail("room") }
      peerNonce = h.nonce
      peerName = h.name
      state = 1
      let auth = LinkWire.encodeAuth(LinkWire.authMac(key: authKey, senderRole: role, receiverNonce: h.nonce, senderNonce: nonce))
      // Le pair attend notre HELLO avant notre AUTH.
      return HandshakeEvent(send: helloSent ? [auth] : [hello(), auth])
    case 1:
      guard kind == LinkWire.kindAuth, m.count == LinkLimits.authBytes else {
        return fail(kind == LinkWire.kindData ? "unauthenticated" : "auth")
      }
      let peerRole = role == LinkWire.roleRemote ? LinkWire.roleScreen : LinkWire.roleRemote
      let expected = LinkWire.authMac(key: authKey, senderRole: peerRole, receiverNonce: nonce, senderNonce: peerNonce)
      guard LinkWire.equal(Data(m[1...]), expected) else { return fail("auth") }
      state = 2
      return HandshakeEvent(admittedName: peerName)
    default:
      if kind == LinkWire.kindData {
        guard m.count >= 2 else { return HandshakeEvent() }
        return HandshakeEvent(data: LinkWire.decodeUtf8(m[1...]))
      }
      if kind == LinkWire.kindHello || kind == LinkWire.kindAuth { return fail("protocol") }
      return HandshakeEvent() // type inconnu après admission : ignoré
    }
  }
}

// MARK: - Réassemblage

/// Réassemblage par pair ; même comportement que Reassembler (src/wire.ts).
final class Reassembler {
  private struct Partial {
    let count: Int
    let startedAt: TimeInterval
    var parts: [Data?]
    var received = 0
    var bytes = 0
  }

  private var partials: [UInt8: Partial] = [:]
  var maxMessage: Int
  private let timeout: TimeInterval
  private(set) var dropped = 0

  init(maxMessage: Int, timeout: TimeInterval = LinkLimits.reassemblyTimeout) {
    self.maxMessage = maxMessage
    self.timeout = timeout
  }

  var pending: Int { partials.count }

  func sweep(_ now: TimeInterval) {
    for (id, p) in partials where now - p.startedAt > timeout {
      partials[id] = nil
      dropped += 1
    }
  }

  func clear() { partials.removeAll() }

  /// Message complet, ou nil (fragment invalide, doublon, message incomplet).
  func push(_ packet: Data, now: TimeInterval) -> Data? {
    let b = [UInt8](packet)
    guard b.count > LinkLimits.fragHeaderBytes else { return nil }
    let id = b[0]
    let index = Int(b[1]) << 8 | Int(b[2])
    let count = Int(b[3]) << 8 | Int(b[4])
    guard count > 0, count <= LinkLimits.maxFragments, index < count else { return nil }
    let chunk = Data(b[LinkLimits.fragHeaderBytes...])
    sweep(now)
    if count == 1 {
      partials[id] = nil
      return chunk.count <= maxMessage ? chunk : nil
    }
    if let p = partials[id], p.count != count {
      partials[id] = nil
      dropped += 1
    }
    if partials[id] == nil {
      if partials.count >= LinkLimits.maxPartials, let oldest = partials.min(by: { $0.value.startedAt < $1.value.startedAt })?.key {
        partials[oldest] = nil
        dropped += 1
      }
      partials[id] = Partial(count: count, startedAt: now, parts: Array(repeating: nil, count: count))
    }
    guard var p = partials[id], p.parts[index] == nil else { return nil } // doublon
    p.bytes += chunk.count
    if p.bytes > maxMessage {
      partials[id] = nil
      dropped += 1
      return nil
    }
    p.parts[index] = chunk
    p.received += 1
    if p.received < count {
      partials[id] = p
      return nil
    }
    partials[id] = nil
    var out = Data(capacity: p.bytes)
    for part in p.parts { out += part ?? Data() }
    return out
  }
}

// MARK: - File de réception

struct InboundFrame {
  let peer: String
  let mode: String
  let data: String
  let bytes: Int
}

/// File bornée des trames reçues ; producteur : file interne ; consommateur :
/// drain() sur le thread JS. Pleine (en nombre ou en octets), elle jette les
/// plus anciennes.
final class Inbox {
  private let lock = NSLock()
  private var items: [InboundFrame] = []
  private var head = 0
  private var bytes = 0
  private var overflowed = false
  private let maxFrames: Int
  private let maxBytes: Int

  init(maxFrames: Int, maxBytes: Int) {
    self.maxFrames = maxFrames
    self.maxBytes = maxBytes
  }

  private var count: Int { items.count - head }

  private func compact() {
    if head > 512 && head * 2 > items.count {
      items.removeFirst(head)
      head = 0
    }
  }

  /// Vrai si des trames anciennes viennent d'être jetées (premier signalement depuis la dernière vidange).
  func push(_ f: InboundFrame) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    items.append(f)
    bytes += f.bytes
    var dropped = false
    while count > maxFrames || (bytes > maxBytes && count > 1) {
      bytes -= items[head].bytes
      head += 1
      dropped = true
    }
    compact()
    guard dropped, !overflowed else { return false }
    overflowed = true
    return true
  }

  /// Au plus maxCount trames et maxSize octets (au moins une), dans l'ordre ; le reste attend.
  func drain(maxCount: Int, maxSize: Int) -> [InboundFrame] {
    lock.lock()
    defer { lock.unlock() }
    var out: [InboundFrame] = []
    var size = 0
    while count > 0 && out.count < maxCount {
      let next = items[head]
      if !out.isEmpty && size + next.bytes > maxSize { break }
      out.append(next)
      size += next.bytes
      head += 1
    }
    bytes -= size
    if count == 0 {
      items.removeAll(keepingCapacity: true)
      head = 0
      overflowed = false
    } else {
      compact()
    }
    return out
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    items.removeAll()
    head = 0
    bytes = 0
    overflowed = false
  }
}
