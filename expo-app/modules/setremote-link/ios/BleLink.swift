import CoreBluetooth
import Foundation

// ════════════════════════════════════════════════════════════════════════════
// Liaison Bluetooth LE (iOS) : CoreBluetooth.
//
//   • Écran = PÉRIPHÉRIQUE (CBPeripheralManager) : service SetRemote avec RX
//     (write / write without response, télécommande → écran) et TX (notify,
//     écran → télécommande) ; annonce de l'UUID du service et du nom local
//     « SR » + roomTag hexadécimal (iOS n'annonce ni données de service ni
//     données fabricant ; au premier plan, le nom part dans la réponse au scan).
//   • Télécommande = CENTRAL (CBCentralManager) : scan filtré sur l'UUID,
//     roomTag reconnu par le nom local (écrans iOS) OU les données de service
//     (écrans Android), 8 écrans au plus, 4 connexions en cours ; abonnement à
//     TX ; MTU négocié par iOS (maximumWriteValueLength).
//   • Messages découpés selon le MTU ([id][index][count] + morceau). Écriture
//     sans réponse au rythme de canSendWriteWithoutResponse /
//     peripheralIsReady ; notifications au rythme de updateValue /
//     peripheralManagerIsReady. File de données bornée par pair.
//   • PING toutes les 5 s de silence, pair muet coupé après 15 s. iOS ne
//     permet pas à un périphérique de déconnecter un central : un central
//     étranger ou muet est simplement ignoré (60 s après un échec d'AUTH).
//   • Autorisation : l'invite Bluetooth apparaît à la création du premier
//     gestionnaire, donc au premier link:start avec 'ble', jamais avant.
//     Premier plan uniquement (pas de mode d'arrière-plan Bluetooth).
// Tout se passe sur la file du LinkManager (donnée aux gestionnaires).
// ════════════════════════════════════════════════════════════════════════════

final class BleLink: NSObject, LinkTransport {
  let mode = LinkMode.ble
  private(set) var config: LinkConfig?
  unowned let manager: LinkManager

  private var generation = 0
  private var lastError: String?
  private var retryWork: DispatchWorkItem?
  private var timer: DispatchSourceTimer?

  // Central (télécommande)
  private var central: CBCentralManager?
  private var scanning = false
  private var links: [UUID: CentralLink] = [:]
  private var backoffUntil: [UUID: Date] = [:]
  private var tooManyReported = false

  // Périphérique (écran)
  private(set) var peripheralManager: CBPeripheralManager?
  private(set) var txCharacteristic: CBMutableCharacteristic?
  private var serviceAdded = false
  private var addingService = false
  private var advertising = false
  private var sessions: [UUID: PeripheralSession] = [:]
  private var ignoredUntil: [UUID: Date] = [:]

  init(manager: LinkManager) {
    self.manager = manager
    super.init()
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
    // Gestionnaires libérés : plus aucune activité radio pour SetRemote.
    central?.delegate = nil
    central = nil
    peripheralManager?.delegate = nil
    peripheralManager = nil
    lastError = nil
    manager.refreshState()
  }

  func state() -> ModeState {
    let auth = CBManager.authorization
    let authorized = auth != .denied && auth != .restricted
    var poweredOn: Bool?
    if let cm = central { poweredOn = cm.state == .poweredOn } else if let pm = peripheralManager { poweredOn = pm.state == .poweredOn }
    let available = authorized && (poweredOn ?? true) && lastError != "unsupported"
    let active = config != nil && (scanning || advertising)
    var error = lastError
    if error == nil, config != nil {
      if !authorized { error = "unauthorized" } else if poweredOn == false, central?.state == .poweredOff || peripheralManager?.state == .poweredOff { error = "powered-off" }
    }
    return ModeState(available: available, active: active, error: error)
  }

  private func bringUp() {
    guard let c = config else { return }
    generation += 1
    switch CBManager.authorization {
    case .denied, .restricted:
      return fail("unauthorized", retry: false)
    default:
      break
    }
    // La création du gestionnaire fait apparaître l'invite Bluetooth (première fois).
    if c.role == .remote {
      if let cm = central {
        centralStateChanged(cm)
      } else {
        central = CBCentralManager(delegate: self, queue: manager.queue, options: [CBCentralManagerOptionShowPowerAlertKey: false])
      }
    } else {
      if let pm = peripheralManager {
        peripheralStateChanged(pm)
      } else {
        peripheralManager = CBPeripheralManager(delegate: self, queue: manager.queue, options: [CBPeripheralManagerOptionShowPowerAlertKey: false])
      }
    }
  }

  private func tearDown() {
    generation += 1
    retryWork?.cancel()
    retryWork = nil
    timer?.cancel()
    timer = nil
    if let cm = central, cm.state == .poweredOn {
      if scanning { cm.stopScan() }
      for l in links.values { cm.cancelPeripheralConnection(l.peripheral) }
    }
    scanning = false
    if let pm = peripheralManager, pm.state == .poweredOn {
      if advertising { pm.stopAdvertising() }
      pm.removeAllServices()
    }
    advertising = false
    serviceAdded = false
    addingService = false
    txCharacteristic = nil
    dropAllSessions()
  }

  /// Retire tous les pairs sans appel radio (Bluetooth éteint ou arrêt).
  private func dropAllSessions() {
    for l in links.values {
      l.shutdown()
      manager.remove(l)
    }
    links.removeAll()
    for s in sessions.values {
      s.shutdown()
      manager.remove(s)
    }
    sessions.removeAll()
  }

  private func fail(_ reason: String, retry: Bool) {
    manager.error(mode, reason)
    tearDown()
    lastError = reason
    manager.refreshState()
    guard retry else { return }
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

  private func poweredOff() {
    dropAllSessions()
    scanning = false
    advertising = false
    serviceAdded = false
    addingService = false
    if lastError != "powered-off" {
      lastError = "powered-off"
      manager.error(mode, "powered-off")
    }
  }

  /// Toutes les 2,5 s : PING, pairs muets, fragments périmés, envoi en attente.
  private func startTimer() {
    guard timer == nil else { return }
    let t = DispatchSource.makeTimerSource(queue: manager.queue)
    t.schedule(deadline: .now() + 2.5, repeating: 2.5)
    t.setEventHandler { [weak self] in
      guard let self else { return }
      let now = Date()
      for l in Array(self.links.values) { l.tick(now) }
      for s in Array(self.sessions.values) { s.tick(now) }
    }
    timer = t
    t.resume()
  }

  // MARK: Pour les sessions

  func admitted(_ s: BleSession) {
    let limit = s is CentralLink ? LinkLimits.maxBlePeers : LinkLimits.maxBleCentrals
    guard manager.admit(s, limit: limit) else { return drop(s, reason: "too-many-peers") }
    s.registered = true
  }

  func drop(_ s: BleSession, reason: String) {
    let auth = ["auth", "room", "role", "hello"].contains(reason)
    if let l = s as? CentralLink {
      dropLink(l, backoff: auth ? 60 : 5, cancel: true)
    } else if let p = s as? PeripheralSession {
      dropSession(p, ignoreFor: auth ? 60 : nil)
    }
  }

  // MARK: Central (télécommande)

  private func centralStateChanged(_ cm: CBCentralManager) {
    guard let c = config, c.role == .remote else { return }
    switch cm.state {
    case .poweredOn:
      if lastError == "powered-off" { lastError = nil }
      if !scanning {
        cm.scanForPeripherals(withServices: [LinkWire.serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        scanning = true
        startTimer()
      }
    case .poweredOff:
      poweredOff()
    case .resetting:
      dropAllSessions()
      scanning = false
    case .unauthorized:
      fail("unauthorized", retry: false)
    case .unsupported:
      fail("unsupported", retry: false)
    default:
      break // .unknown : on attend
    }
    manager.refreshState()
  }

  static func matches(_ ad: [String: Any], _ c: LinkConfig) -> Bool {
    if let sd = ad[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data], let d = sd[LinkWire.serviceUUID],
       LinkWire.equal(d, LinkWire.serviceData(c.roomTag)) {
      return true
    }
    return (ad[CBAdvertisementDataLocalNameKey] as? String) == LinkWire.localName(c.roomTag)
  }

  private func dropLink(_ l: CentralLink, backoff: TimeInterval, cancel: Bool) {
    guard !l.closed else { return }
    l.shutdown()
    let id = l.peripheral.identifier
    links[id] = nil
    let now = Date()
    if backoffUntil.count > 128 { backoffUntil = backoffUntil.filter { $0.value > now } } // bornée
    if backoffUntil.count <= 256 { backoffUntil[id] = now.addingTimeInterval(backoff) }
    if cancel, let cm = central, cm.state == .poweredOn { cm.cancelPeripheralConnection(l.peripheral) }
    manager.remove(l)
    if links.values.filter({ $0.registered }).count < LinkLimits.maxBlePeers { tooManyReported = false }
  }

  // MARK: Périphérique (écran)

  private func peripheralStateChanged(_ pm: CBPeripheralManager) {
    guard let c = config, c.role == .screen else { return }
    switch pm.state {
    case .poweredOn:
      if lastError == "powered-off" { lastError = nil }
      if !serviceAdded && !addingService { addService(pm) } else if serviceAdded && !advertising { startAdvertising(pm, c) }
    case .poweredOff:
      poweredOff()
    case .resetting:
      dropAllSessions()
      advertising = false
      serviceAdded = false
      addingService = false
    case .unauthorized:
      fail("unauthorized", retry: false)
    case .unsupported:
      fail("unsupported", retry: false)
    default:
      break
    }
    manager.refreshState()
  }

  private func addService(_ pm: CBPeripheralManager) {
    let rx = CBMutableCharacteristic(
      type: LinkWire.rxUUID,
      properties: [.write, .writeWithoutResponse],
      value: nil,
      permissions: [.writeable]
    )
    let tx = CBMutableCharacteristic(type: LinkWire.txUUID, properties: [.notify], value: nil, permissions: [.readable])
    let service = CBMutableService(type: LinkWire.serviceUUID, primary: true)
    service.characteristics = [rx, tx]
    txCharacteristic = tx
    addingService = true
    pm.add(service) // suite dans didAdd
  }

  private func startAdvertising(_ pm: CBPeripheralManager, _ c: LinkConfig) {
    pm.startAdvertising([
      CBAdvertisementDataServiceUUIDsKey: [LinkWire.serviceUUID],
      CBAdvertisementDataLocalNameKey: LinkWire.localName(c.roomTag),
    ])
  }

  private func dropSession(_ s: PeripheralSession, ignoreFor: TimeInterval?) {
    guard !s.closed else { return }
    s.shutdown()
    let id = s.central.identifier
    sessions[id] = nil
    manager.remove(s)
    if let t = ignoreFor {
      let now = Date()
      if ignoredUntil.count > 64 { ignoredUntil = ignoredUntil.filter { $0.value > now } }
      if ignoredUntil.count <= 128 { ignoredUntil[id] = now.addingTimeInterval(t) }
    }
  }
}

// MARK: - CBCentralManagerDelegate, CBPeripheralDelegate

extension BleLink: CBCentralManagerDelegate, CBPeripheralDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central === self.central else { return }
    centralStateChanged(central)
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard central === self.central, let c = config else { return }
    let id = peripheral.identifier
    if links[id] != nil { return }
    if let until = backoffUntil[id], until > Date() { return }
    guard BleLink.matches(advertisementData, c) else { return }
    let admitted = links.values.filter { $0.registered }.count
    if admitted >= LinkLimits.maxBlePeers {
      if !tooManyReported {
        tooManyReported = true
        manager.error(mode, "too-many-peers")
      }
      return
    }
    if links.count - admitted >= LinkLimits.maxBlePending { return }
    let l = CentralLink(link: self, peripheral: peripheral, config: c)
    links[id] = l
    peripheral.delegate = self
    central.connect(peripheral, options: nil)
    let work = DispatchWorkItem { [weak self, weak l] in
      guard let self, let l, !l.closed, !l.handshake.admitted else { return }
      self.dropLink(l, backoff: 5, cancel: true)
    }
    l.setupWork = work
    manager.queue.asyncAfter(deadline: .now() + LinkLimits.bleSetupTimeout, execute: work)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard links[peripheral.identifier] != nil else { return central.cancelPeripheralConnection(peripheral) }
    peripheral.discoverServices([LinkWire.serviceUUID])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    if let l = links[peripheral.identifier] { dropLink(l, backoff: 5, cancel: false) }
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    if let l = links[peripheral.identifier] { dropLink(l, backoff: l.handshake.admitted ? 1 : 5, cancel: false) }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let l = links[peripheral.identifier] else { return }
    guard error == nil, let s = peripheral.services?.first(where: { $0.uuid == LinkWire.serviceUUID }) else {
      return dropLink(l, backoff: 60, cancel: true) // pas un écran SetRemote
    }
    peripheral.discoverCharacteristics([LinkWire.rxUUID, LinkWire.txUUID], for: s)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let l = links[peripheral.identifier] else { return }
    let chars = service.characteristics ?? []
    guard error == nil,
          let rx = chars.first(where: { $0.uuid == LinkWire.rxUUID }),
          let tx = chars.first(where: { $0.uuid == LinkWire.txUUID })
    else { return dropLink(l, backoff: 60, cancel: true) }
    l.rx = rx
    l.maxValue = Swift.max(20, Swift.min(peripheral.maximumWriteValueLength(for: .withoutResponse), LinkLimits.maxAttValue))
    peripheral.setNotifyValue(true, for: tx) // suite dans didUpdateNotificationState
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    guard let l = links[peripheral.identifier], characteristic.uuid == LinkWire.txUUID else { return }
    guard error == nil, characteristic.isNotifying else { return dropLink(l, backoff: 5, cancel: true) }
    l.sendMessage(l.handshake.hello()) // abonné : le canal est prêt
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard error == nil, characteristic.uuid == LinkWire.txUUID, let v = characteristic.value,
          let l = links[peripheral.identifier]
    else { return }
    l.onValue(v)
  }

  func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
    links[peripheral.identifier]?.pump()
  }

  func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
    // L'écran a retiré son service (arrêt, arrière-plan) : la liaison ne sert plus.
    guard invalidatedServices.contains(where: { $0.uuid == LinkWire.serviceUUID }), let l = links[peripheral.identifier] else { return }
    dropLink(l, backoff: 1, cancel: true)
  }
}

// MARK: - CBPeripheralManagerDelegate

extension BleLink: CBPeripheralManagerDelegate {
  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard peripheral === peripheralManager else { return }
    peripheralStateChanged(peripheral)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard peripheral === peripheralManager, let c = config else { return }
    addingService = false
    if error != nil { return fail("gatt-failed", retry: true) }
    serviceAdded = true
    startAdvertising(peripheral, c)
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    guard peripheral === peripheralManager, config != nil else { return }
    if error != nil { return fail("advertise-failed", retry: true) }
    advertising = true
    startTimer()
    manager.refreshState()
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
    guard peripheral === peripheralManager, characteristic.uuid == LinkWire.txUUID, let c = config else { return }
    let id = central.identifier
    if let until = ignoredUntil[id], until > Date() { return }
    if sessions[id] != nil || sessions.count >= LinkLimits.maxBleCentrals { return } // au-delà : ignoré
    let s = PeripheralSession(link: self, central: central, config: c)
    s.maxValue = Swift.max(20, Swift.min(central.maximumUpdateValueLength, LinkLimits.maxAttValue))
    sessions[id] = s
    let work = DispatchWorkItem { [weak self, weak s] in
      guard let self, let s, !s.closed, !s.handshake.admitted else { return }
      self.dropSession(s, ignoreFor: 30)
    }
    s.setupWork = work
    manager.queue.asyncAfter(deadline: .now() + LinkLimits.bleSetupTimeout, execute: work)
    s.sendMessage(s.handshake.hello()) // abonné : le canal est prêt
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
    guard characteristic.uuid == LinkWire.txUUID, let s = sessions[central.identifier] else { return }
    dropSession(s, ignoreFor: nil)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    var ok = true
    for r in requests {
      // Écritures longues (offset ≠ 0) refusées : la fragmentation est la nôtre.
      guard r.characteristic.uuid == LinkWire.rxUUID, r.offset == 0, let v = r.value,
            let s = sessions[r.central.identifier]
      else {
        ok = false
        continue
      }
      s.onValue(v)
    }
    // Une seule réponse par appel (sans effet pour une écriture sans réponse).
    if let first = requests.first { peripheral.respond(to: first, withResult: ok ? .success : .writeNotPermitted) }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    peripheral.respond(to: request, withResult: .readNotPermitted)
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    for s in Array(sessions.values) { s.pump() }
  }
}

// MARK: - Sessions

/// Un pair Bluetooth : poignée de main, réassemblage, file d'envoi fragmentée.
/// Sous-classée par CentralLink (écriture) et PeripheralSession (notification).
class BleSession: LinkPeer {
  let id = LinkWire.newPeerId(LinkMode.ble.prefix)
  let mode = LinkMode.ble
  var name = ""
  let handshake: Handshake
  let reassembler = Reassembler(maxMessage: LinkLimits.preauthMaxMessage)
  weak var link: BleLink?
  /// Taille maximale d'une valeur ATT (MTU − 3), ≤ 512.
  var maxValue = 20
  var registered = false
  private(set) var closed = false
  var setupWork: DispatchWorkItem?

  private var control: [Data] = []
  private var data: [Data] = []
  private var dataBytes = 0
  private var fragments: [Data] = []
  private var frameId = 0
  private var congested = false
  private var lastReceived = Date()
  private var lastSent = Date()

  init(link: BleLink, config: LinkConfig) {
    self.link = link
    self.handshake = config.newHandshake()
  }

  /// Écriture (central) ou notification (périphérique) ; faux si la file radio est pleine.
  func writeNow(_ value: Data) -> Bool { false }

  func sendMessage(_ m: Data) {
    guard !closed else { return }
    control.append(m)
    pump()
  }

  func enqueueData(_ messages: [Data]) {
    guard !closed else { return }
    for m in messages {
      data.append(m)
      dataBytes += m.count
    }
    var dropped = false
    while dataBytes > LinkLimits.blePeerBacklog && data.count > 1 {
      dataBytes -= data.removeFirst().count
      dropped = true
    }
    if dropped && !congested {
      congested = true
      link?.manager.error(.ble, "congested")
    }
    pump()
  }

  private func nextMessage() -> Data? {
    if !control.isEmpty { return control.removeFirst() }
    guard !data.isEmpty else { return nil }
    let m = data.removeFirst()
    dataBytes -= m.count
    if dataBytes <= LinkLimits.blePeerBacklog / 2 { congested = false }
    return m
  }

  /// Envoie tant que la radio accepte ; reprend sur le rappel « prêt » (ou au tic suivant).
  func pump() {
    guard !closed else { return }
    var budget = 64
    while budget > 0 {
      if fragments.isEmpty {
        guard let next = nextMessage() else { return }
        // Découpé au dernier moment : le MTU a pu changer depuis la mise en file.
        fragments = LinkWire.fragment(next, frameId: frameId, maxValue: maxValue)
        frameId = (frameId + 1) & 0xff
        continue
      }
      guard writeNow(fragments[0]) else { return }
      fragments.removeFirst()
      lastSent = Date()
      budget -= 1
    }
    // Laisser passer les autres événements de la file avant de continuer
    link?.manager.queue.async { [weak self] in self?.pump() }
  }

  func onValue(_ value: Data) {
    guard !closed else { return }
    let now = Date()
    lastReceived = now
    guard let m = reassembler.push(value, now: now.timeIntervalSinceReferenceDate) else { return }
    let ev = handshake.receive(m)
    if let error = ev.error {
      link?.drop(self, reason: error)
      return
    }
    for s in ev.send { sendMessage(s) }
    if let peerName = ev.admittedName {
      name = peerName
      reassembler.maxMessage = LinkLimits.bleMaxMessage
      setupWork?.cancel()
      link?.admitted(self)
    }
    if let d = ev.data { link?.manager.receive(peer: id, mode: .ble, data: d, bytes: m.count - 1) }
  }

  func tick(_ now: Date) {
    guard !closed else { return }
    reassembler.sweep(now.timeIntervalSinceReferenceDate)
    pump() // filet de sécurité si un rappel « prêt » s'est perdu
    guard handshake.admitted else { return }
    if now.timeIntervalSince(lastReceived) > LinkLimits.deadAfter {
      link?.drop(self, reason: "timeout")
      return
    }
    if now.timeIntervalSince(lastSent) > LinkLimits.keepalive && control.isEmpty && data.isEmpty && fragments.isEmpty {
      sendMessage(LinkWire.ping)
    }
  }

  func shutdown() {
    closed = true
    setupWork?.cancel()
    control.removeAll()
    data.removeAll()
    fragments.removeAll()
    reassembler.clear()
  }
}

/// Télécommande → un écran (CBPeripheral).
final class CentralLink: BleSession {
  let peripheral: CBPeripheral
  var rx: CBCharacteristic?

  init(link: BleLink, peripheral: CBPeripheral, config: LinkConfig) {
    self.peripheral = peripheral
    super.init(link: link, config: config)
  }

  override func writeNow(_ value: Data) -> Bool {
    guard let rx, peripheral.state == .connected, peripheral.canSendWriteWithoutResponse else { return false }
    peripheral.writeValue(value, for: rx, type: .withoutResponse)
    return true
  }
}

/// Écran → la télécommande abonnée (CBCentral).
final class PeripheralSession: BleSession {
  let central: CBCentral

  init(link: BleLink, central: CBCentral, config: LinkConfig) {
    self.central = central
    super.init(link: link, config: config)
  }

  override func writeNow(_ value: Data) -> Bool {
    guard let pm = link?.peripheralManager, let tx = link?.txCharacteristic else { return false }
    return pm.updateValue(value, for: tx, onSubscribedCentrals: [central])
  }
}
