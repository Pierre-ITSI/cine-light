// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import Foundation
import Network

// ════════════════════════════════════════════════════════════════════════════
// Liaison Wi-Fi local (iOS) : Network.framework.
//
//   • Télécommande : NWListener TCP sur un port éphémère, publié en Bonjour
//     « _setremote._tcp » avec le TXT r=<roomTag hex>, v=1 (jamais le topic) ;
//     nom d'instance aléatoire.
//   • Écran : NWBrowser (.bonjourWithTXTRecord) ne garde que les services
//     dont le TXT r correspond, et ouvre une NWConnection vers l'un d'eux.
//   • Cellulaire interdit (prohibitedInterfaceTypes) : un Wi-Fi sans Internet
//     reste utilisé pour le réseau local même si les données mobiles sont là.
//   • Par connexion : lecture d'enregistrements [u32 BE][message], longueur
//     vérifiée avant de lire le corps ; envoi avec au plus 256 Kio confiés à
//     TCP et file de données bornée (les plus anciennes jetées) ; PING après
//     5 s de silence, pair mort après 15 s sans rien.
//   • Appareils étrangers : 8 connexions non admises à la fois, 5 s et 256
//     octets pour réussir la poignée de main, 64 pairs admis au plus.
//   • Invite « réseau local » : déclenchée par le listener ou le browser ;
//     refus → NWError.dns(kDNSServiceErr_PolicyDenied) → « local-network-denied ».
// Tout se passe sur la file du LinkManager.
// ════════════════════════════════════════════════════════════════════════════

final class LanLink: LinkTransport {
  let mode = LinkMode.lan
  private(set) var config: LinkConfig?
  private unowned let manager: LinkManager

  private var generation = 0
  private var lastError: String?
  private var connections: [LanConnection] = []
  private var tooManyReported = false
  private var retryWork: DispatchWorkItem?

  // Télécommande
  private var listener: NWListener?
  private var listening = false
  private var registered = false

  // Écran
  private final class Candidate {
    let key: String
    var endpoint: NWEndpoint
    var failures = 0
    var retryAt = Date.distantPast
    init(key: String, endpoint: NWEndpoint) {
      self.key = key
      self.endpoint = endpoint
    }
  }

  private var browser: NWBrowser?
  private var browsing = false
  private var candidates: [String: Candidate] = [:]
  private var connecting = false
  private var connectWork: DispatchWorkItem?

  // Réseau
  private var monitor: NWPathMonitor?
  private var networkAvailable = false

  /// dns_sd.h : kDNSServiceErr_PolicyDenied (accès au réseau local refusé).
  private static let policyDenied: Int32 = -65570

  /// Créé sur la file du LinkManager. Le moniteur de chemin vit aussi longtemps
  /// que le lien (sans autorisation, sans trafic) : `available` est connu avant
  /// tout démarrage.
  init(manager: LinkManager) {
    self.manager = manager
    ensureMonitor()
  }

  // MARK: Cycle de vie (sur la file)

  func start(_ config: LinkConfig) {
    guard self.config == nil else { return }
    self.config = config
    lastError = nil
    tooManyReported = false
    bringUp()
    manager.refreshState()
  }

  func stop() {
    guard config != nil else { return }
    config = nil
    tearDown()
    lastError = nil
    manager.refreshState()
  }

  /// Wi-Fi ou Ethernet présent (avec ou sans Internet). Un iPhone qui sert lui-même
  /// de point d'accès n'en a pas : « no-network » alors que la liaison peut marcher.
  func state() -> ModeState {
    var active = false
    if let c = config { active = c.role == .remote ? (listening && registered) : browsing }
    let error = lastError ?? ((config != nil && !networkAvailable) ? "no-network" : nil)
    return ModeState(available: networkAvailable, active: active, error: error)
  }

  static func parameters() -> NWParameters {
    let tcp = NWProtocolTCP.Options()
    tcp.noDelay = true // petites trames de commande : pas d'attente de Nagle
    tcp.enableKeepalive = true
    tcp.keepaliveIdle = 10
    let p = NWParameters(tls: nil, tcp: tcp)
    p.includePeerToPeer = false // pas d'AWDL : réseau d'infrastructure (routeur) ou filaire
    p.prohibitedInterfaceTypes = [.cellular]
    return p
  }

  private func bringUp() {
    guard let c = config else { return }
    generation += 1
    if c.role == .remote { startListener(c) } else { startBrowser(c) }
  }

  private func tearDown() {
    generation += 1
    retryWork?.cancel()
    retryWork = nil
    connectWork?.cancel()
    connectWork = nil
    listener?.cancel()
    listener = nil
    listening = false
    registered = false
    browser?.cancel()
    browser = nil
    browsing = false
    candidates.removeAll()
    connecting = false
    for conn in connections {
      conn.close()
      manager.remove(conn)
    }
    connections.removeAll()
  }

  /// Erreur bloquante : publiée, tout est fermé, nouvel essai dans 10 s si la page le veut toujours.
  private func fail(_ reason: String) {
    manager.error(mode, reason)
    tearDown()
    lastError = reason
    manager.refreshState()
    let gen = generation
    let work = DispatchWorkItem { [weak self] in
      guard let self, gen == self.generation, self.config != nil else { return }
      self.lastError = nil
      self.bringUp()
      self.manager.refreshState()
    }
    retryWork = work
    manager.queue.asyncAfter(deadline: .now() + 10, execute: work)
  }

  private static func isPolicyDenied(_ error: NWError) -> Bool {
    if case let .dns(code) = error { return code == policyDenied }
    return false
  }

  /// Attente sur refus d'accès au réseau local : signalé une fois, l'objet reste
  /// en attente et repart seul si l'utilisateur l'autorise dans Réglages.
  private func waiting(_ error: NWError) {
    guard LanLink.isPolicyDenied(error), lastError != "local-network-denied" else { return }
    lastError = "local-network-denied"
    manager.error(mode, "local-network-denied")
    manager.refreshState()
  }

  // MARK: Télécommande

  /// TXT DNS-SD : suite de [longueur]["clé=valeur"].
  static func txtRecord(_ entries: [(String, String)]) -> Data {
    var d = Data()
    for (k, v) in entries {
      let e = Data("\(k)=\(v)".utf8)
      d.append(UInt8(e.count))
      d.append(e)
    }
    return d
  }

  private func startListener(_ c: LinkConfig) {
    let gen = generation
    let l: NWListener
    do {
      l = try NWListener(using: LanLink.parameters())
    } catch {
      return fail("listen-failed")
    }
    l.service = NWListener.Service(
      name: "SetRemote-" + LinkWire.hex(LinkWire.randomBytes(3)), // ne révèle ni le topic ni l'appareil
      type: LinkWire.serviceType,
      domain: nil,
      txtRecord: LanLink.txtRecord([(LinkWire.txtRoom, c.roomTagHex), (LinkWire.txtVersion, String(LinkWire.version))])
    )
    l.stateUpdateHandler = { [weak self] st in
      guard let self, gen == self.generation else { return }
      switch st {
      case .ready:
        self.listening = true
        if self.lastError == "local-network-denied" { self.lastError = nil }
        self.manager.refreshState()
      case let .waiting(error):
        self.waiting(error)
      case let .failed(error):
        self.fail(LanLink.isPolicyDenied(error) ? "local-network-denied" : "listen-failed")
      default:
        break
      }
    }
    l.serviceRegistrationUpdateHandler = { [weak self] change in
      guard let self, gen == self.generation else { return }
      switch change {
      case .add:
        self.registered = true
      case .remove:
        self.registered = false
      @unknown default:
        break
      }
      self.manager.refreshState()
    }
    l.newConnectionHandler = { [weak self] conn in
      guard let self, gen == self.generation else { return conn.cancel() }
      self.accept(conn)
    }
    listener = l
    l.start(queue: manager.queue)
  }

  private func accept(_ conn: NWConnection) {
    guard let c = config else { return conn.cancel() }
    let pending = connections.filter { !$0.admitted }.count
    let admitted = connections.count - pending
    if pending >= LinkLimits.maxLanPending { return conn.cancel() } // déluge non authentifié
    if admitted >= LinkLimits.maxLanPeers {
      if !tooManyReported {
        tooManyReported = true
        manager.error(mode, "too-many-peers")
      }
      return conn.cancel()
    }
    open(conn, c, candidate: nil)
  }

  // MARK: Écran

  private func startBrowser(_ c: LinkConfig) {
    let gen = generation
    let b = NWBrowser(for: .bonjourWithTXTRecord(type: LinkWire.serviceType, domain: nil), using: LanLink.parameters())
    b.stateUpdateHandler = { [weak self] st in
      guard let self, gen == self.generation else { return }
      switch st {
      case .ready:
        self.browsing = true
        if self.lastError == "local-network-denied" { self.lastError = nil }
        self.manager.refreshState()
      case let .waiting(error):
        self.waiting(error)
      case let .failed(error):
        self.fail(LanLink.isPolicyDenied(error) ? "local-network-denied" : "browse-failed")
      default:
        break
      }
    }
    b.browseResultsChangedHandler = { [weak self] results, _ in
      guard let self, gen == self.generation else { return }
      self.onResults(results, c)
    }
    browser = b
    b.start(queue: manager.queue)
  }

  private func onResults(_ results: Set<NWBrowser.Result>, _ c: LinkConfig) {
    var seen = Set<String>()
    for r in results {
      guard case let .bonjour(txt) = r.metadata else { continue }
      let entries = txt.dictionary
      // Autre plateau ou autre version : ignoré
      guard entries[LinkWire.txtRoom] == c.roomTagHex, entries[LinkWire.txtVersion] == String(LinkWire.version) else { continue }
      let key = "\(r.endpoint)"
      seen.insert(key)
      if let existing = candidates[key] {
        existing.endpoint = r.endpoint
      } else if candidates.count < 32 { // annonces en rafale (réseau hostile) : bornées
        candidates[key] = Candidate(key: key, endpoint: r.endpoint)
      }
    }
    for k in candidates.keys where !seen.contains(k) { candidates[k] = nil }
    connectNext()
  }

  private func connectNext() {
    guard let c = config, c.role == .screen, !connecting, connections.isEmpty else { return }
    connectWork?.cancel()
    connectWork = nil
    let now = Date()
    guard let candidate = candidates.values.filter({ $0.retryAt <= now }).min(by: { $0.failures < $1.failures }) else {
      guard let next = candidates.values.map(\.retryAt).min() else { return } // attend une découverte
      let work = DispatchWorkItem { [weak self] in self?.connectNext() }
      connectWork = work
      manager.queue.asyncAfter(deadline: .now() + Swift.max(0.05, next.timeIntervalSince(now)), execute: work)
      return
    }
    connecting = true
    open(NWConnection(to: candidate.endpoint, using: LanLink.parameters()), c, candidate: candidate.key)
  }

  // MARK: Connexions

  private func open(_ conn: NWConnection, _ c: LinkConfig, candidate: String?) {
    let lc = LanConnection(manager: manager, link: self, connection: conn, config: c, generation: generation, candidate: candidate)
    connections.append(lc)
    lc.start()
  }

  func onReady(_ conn: LanConnection) {
    if conn.candidate != nil { connecting = false }
  }

  func onAdmitted(_ conn: LanConnection) {
    guard conn.generation == generation, connections.contains(where: { $0 === conn }) else { return conn.close() }
    guard manager.admit(conn, limit: LinkLimits.maxLanPeers) else { return conn.close() }
    conn.registered = true
    if let key = conn.candidate { candidates[key]?.failures = 0 }
  }

  func onClosed(_ conn: LanConnection) {
    guard let i = connections.firstIndex(where: { $0 === conn }) else { return }
    connections.remove(at: i)
    manager.remove(conn)
    if connections.filter({ $0.admitted }).count < LinkLimits.maxLanPeers { tooManyReported = false }
    guard let c = config, c.role == .screen, conn.generation == generation else { return }
    if conn.candidate != nil { connecting = false }
    if let key = conn.candidate, let cand = candidates[key] {
      if !conn.admitted {
        // Connexion refusée ou poignée de main ratée (autre version, imitation de l'annonce)
        // Après 4 échecs (service fantôme, coupure passagère) : un essai toutes
        // les 30 s. Le candidat n'est pas oublié : le browser ne le
        // reproposerait pas tant que l'annonce reste valide.
        cand.failures += 1
        let delay = (conn.authFailed || cand.failures >= 4) ? 30 : LanLink.backoff(cand.failures)
        cand.retryAt = Date().addingTimeInterval(delay)
      } else {
        cand.retryAt = Date().addingTimeInterval(0.5)
      }
    }
    let work = DispatchWorkItem { [weak self] in self?.connectNext() }
    connectWork = work
    manager.queue.asyncAfter(deadline: .now() + 0.5, execute: work)
  }

  static func backoff(_ failures: Int) -> TimeInterval {
    Swift.min(5, 0.5 * pow(2, Double(Swift.max(0, Swift.min(failures - 1, 4)))))
  }

  // MARK: Réseau

  private func ensureMonitor() {
    guard monitor == nil else { return }
    let m = NWPathMonitor()
    m.pathUpdateHandler = { [weak self] path in self?.pathChanged(path) }
    monitor = m
    m.start(queue: manager.queue)
  }

  private func pathChanged(_ path: NWPath) {
    let before = networkAvailable
    networkAvailable = path.availableInterfaces.contains { $0.type == .wifi || $0.type == .wiredEthernet }
    guard let c = config else { return }
    if networkAvailable && !before && lastError != nil && lastError != "local-network-denied" {
      // Réseau revenu après un échec : on relance sans attendre l'essai programmé.
      tearDown()
      lastError = nil
      bringUp()
    } else if c.role == .screen && connections.isEmpty {
      connectNext()
    }
    manager.refreshState()
  }
}

/// Une connexion TCP (un pair), dans les deux rôles.
final class LanConnection: LinkPeer {
  let id = LinkWire.newPeerId(LinkMode.lan.prefix)
  let mode = LinkMode.lan
  private(set) var name = ""
  let generation: Int
  /// Écran : clé du service Bonjour visé ; télécommande : nil.
  let candidate: String?
  /// Poignée de main réussie (reste vrai après la fermeture).
  private(set) var admitted = false
  private(set) var authFailed = false
  var registered = false

  private unowned let manager: LinkManager
  private weak var link: LanLink?
  private let connection: NWConnection
  private let handshake: Handshake
  private var closed = false
  private var started = false
  private var preauthBytes = 0
  private var control: [Data] = []
  private var data: [Data] = []
  private var dataHead = 0
  private var dataBytes = 0
  private var inFlight = 0
  private var congested = false
  private var lastSent = Date()
  private var lastReceived = Date()
  private var timer: DispatchSourceTimer?

  init(manager: LinkManager, link: LanLink, connection: NWConnection, config: LinkConfig, generation: Int, candidate: String?) {
    self.manager = manager
    self.link = link
    self.connection = connection
    self.handshake = config.newHandshake()
    self.generation = generation
    self.candidate = candidate
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] st in self?.onState(st) }
    connection.start(queue: manager.queue)
    // 5 s pour réussir la poignée de main, quel que soit le débit
    manager.queue.asyncAfter(deadline: .now() + LinkLimits.handshakeTimeout) { [weak self] in
      guard let self, !self.admitted else { return }
      self.close()
    }
  }

  private func onState(_ st: NWConnection.State) {
    switch st {
    case .ready:
      guard !started else { return }
      started = true
      lastReceived = Date()
      link?.onReady(self)
      sendControl(handshake.hello())
      readHeader()
      startTimer()
    case .waiting, .failed, .cancelled:
      // waiting : pas de route ou connexion refusée ; on laisse le lien réessayer ailleurs
      close()
    default:
      break
    }
  }

  private func readHeader() {
    connection.receive(minimumIncompleteLength: LinkLimits.lanHeaderBytes, maximumLength: LinkLimits.lanHeaderBytes) {
      [weak self] content, _, _, error in
      guard let self, !self.closed else { return }
      guard error == nil, let content, content.count == LinkLimits.lanHeaderBytes else { return self.close() }
      let h = [UInt8](content)
      let len = Int(h[0]) << 24 | Int(h[1]) << 16 | Int(h[2]) << 8 | Int(h[3])
      let max = self.admitted ? LinkLimits.lanMaxMessage : LinkLimits.preauthMaxMessage
      guard len > 0, len <= max else { return self.close() } // vérifié AVANT de lire le corps
      if !self.admitted {
        self.preauthBytes += LinkLimits.lanHeaderBytes + len
        guard self.preauthBytes <= LinkLimits.preauthMaxBytes else { return self.close() }
      }
      self.readBody(len)
    }
  }

  private func readBody(_ len: Int) {
    connection.receive(minimumIncompleteLength: len, maximumLength: len) { [weak self] content, _, _, error in
      guard let self, !self.closed else { return }
      guard error == nil, let content, content.count == len else { return self.close() }
      self.handle(content)
      if !self.closed { self.readHeader() }
    }
  }

  private func handle(_ message: Data) {
    lastReceived = Date()
    let ev = handshake.receive(message)
    if let error = ev.error {
      authFailed = error == "auth"
      return close()
    }
    for m in ev.send { sendControl(m) }
    if let peerName = ev.admittedName {
      name = peerName
      admitted = true
      link?.onAdmitted(self)
    }
    if let d = ev.data { manager.receive(peer: id, mode: mode, data: d, bytes: message.count - 1) }
  }

  // MARK: Envoi

  private func sendControl(_ message: Data) {
    guard !closed else { return }
    control.append(LinkWire.lanRecord(message))
    pump()
  }

  func enqueueData(_ messages: [Data]) {
    guard !closed else { return }
    for m in messages {
      let r = LinkWire.lanRecord(m)
      data.append(r)
      dataBytes += r.count
    }
    // Pair lent : on jette les plus anciennes
    var dropped = false
    while dataBytes > LinkLimits.lanPeerBacklog && data.count - dataHead > 1 {
      dataBytes -= data[dataHead].count
      dataHead += 1
      dropped = true
    }
    if dropped && !congested {
      congested = true
      manager.error(mode, "congested")
    }
    pump()
  }

  private func nextRecord() -> Data? {
    if !control.isEmpty { return control.removeFirst() }
    guard dataHead < data.count else { return nil }
    let r = data[dataHead]
    dataHead += 1
    dataBytes -= r.count
    if dataHead == data.count {
      data.removeAll(keepingCapacity: true)
      dataHead = 0
    } else if dataHead > 256 && dataHead * 2 > data.count {
      data.removeFirst(dataHead)
      dataHead = 0
    }
    if dataBytes <= LinkLimits.lanPeerBacklog / 2 { congested = false }
    return r
  }

  private func pump() {
    guard started, !closed else { return }
    while inFlight < LinkLimits.lanInFlight, let r = nextRecord() {
      inFlight += r.count
      lastSent = Date()
      let size = r.count
      connection.send(content: r, completion: .contentProcessed { [weak self] error in
        guard let self else { return }
        self.inFlight -= size
        if error != nil { return self.close() }
        self.pump()
      })
    }
  }

  private func startTimer() {
    let t = DispatchSource.makeTimerSource(queue: manager.queue)
    t.schedule(deadline: .now() + 2.5, repeating: 2.5)
    t.setEventHandler { [weak self] in self?.tick() }
    timer = t
    t.resume()
  }

  private func tick() {
    guard admitted, !closed else { return }
    let now = Date()
    if now.timeIntervalSince(lastReceived) > LinkLimits.deadAfter { return close() }
    if now.timeIntervalSince(lastSent) > LinkLimits.keepalive && control.isEmpty && dataHead >= data.count {
      sendControl(LinkWire.ping)
    }
  }

  func close() {
    guard !closed else { return }
    closed = true
    timer?.cancel()
    timer = nil
    control.removeAll()
    data.removeAll()
    dataHead = 0
    dataBytes = 0
    connection.cancel()
    let link = self.link
    manager.queue.async { [self] in link?.onClosed(self) }
  }
}
