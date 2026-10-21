// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import AVFoundation
import UIKit

// Audio d'un appel décroché (iOS). Un seul appel à la fois ; tout s'exécute sur la file principale
// (UIDevice.isProximityMonitoringEnabled l'exige, AVAudioSession et AVAudioPlayer s'en accommodent).
//
//   • Session : catégorie .playAndRecord, mode .voiceChat. C'est ce couple qui donne accès à l'écouteur
//     (sortie « Receiver ») : une session .playback ou ambiante, celle de la vue web, ne sort que par le
//     haut-parleur. Rien n'est enregistré : aucune entrée n'est ouverte, donc aucune invite micro.
//   • Sortie : écouteur = aucun forçage (le receiver est la sortie par défaut de .playAndRecord), haut-parleur =
//     overrideOutputAudioPort(.speaker). Bascule à chaud, sans toucher au lecteur. Un casque ou un
//     Bluetooth branché garde la priorité (le système route, la page est informée par onState).
//   • Lecteur : AVAudioPlayer ; le délai avant la voix est planifié sur l'horloge de l'appareil
//     (play(atTime:)), sans dérive.
//   • Proximité : activée pendant l'appel décroché seulement, si demandée. L'écran s'éteint tout seul contre
//     l'oreille (comportement du système) ; jamais touchée sinon, l'écran reste visible.
//   • Fin : lecteur arrêté, sortie et session rendues dans leur état d'avant, capteur coupé.
final class CallAudio: NSObject, AVAudioPlayerDelegate {
  var onState: (([String: Any]) -> Void)?
  var onError: ((String) -> Void)?

  private var active = false
  private var player: AVAudioPlayer?
  private var route = "ear"
  private var lastReportedRoute: String?
  private var proximityOn = false
  private var saved: (category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)?
  private var observers: [NSObjectProtocol] = []

  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
  }

  func start(route: String, proximity: Bool) {
    onMain {
      if self.active { self.teardown() }
      let session = AVAudioSession.sharedInstance()
      self.saved = (session.category, session.mode, session.categoryOptions)
      do {
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
        try session.setActive(true)
      } catch {
        self.saved = nil
        self.onError?("session-failed")
        return
      }
      self.active = true
      self.route = route == "speaker" ? "speaker" : "ear"
      self.lastReportedRoute = self.route
      self.applyRoute()
      self.observe()
      if proximity {
        let device = UIDevice.current
        device.isProximityMonitoringEnabled = true
        // Capteur absent (iPad, simulateur) : le système laisse la valeur à false
        self.proximityOn = device.isProximityMonitoringEnabled
        self.onState?(["proximityAvailable": self.proximityOn])
      }
    }
  }

  func play(path: String, delay: Double) {
    onMain {
      guard self.active else { self.onError?("play-failed"); return }
      self.player?.stop()
      self.player = nil
      do {
        let url = path.hasPrefix("file://") ? (URL(string: path) ?? URL(fileURLWithPath: path)) : URL(fileURLWithPath: path)
        let p = try AVAudioPlayer(contentsOf: url)
        p.delegate = self
        p.numberOfLoops = 0
        p.volume = 1
        guard p.prepareToPlay() else { self.onError?("play-failed"); return }
        let ok = delay > 0 ? p.play(atTime: p.deviceCurrentTime + min(max(delay, 0), 15)) : p.play()
        if !ok { self.onError?("play-failed"); return }
        self.player = p
      } catch {
        self.onError?("play-failed")
      }
    }
  }

  func setRoute(_ r: String) {
    onMain {
      guard self.active else { return }
      self.route = r == "speaker" ? "speaker" : "ear"
      self.lastReportedRoute = self.route
      self.applyRoute()
    }
  }

  func end() {
    onMain { self.teardown() }
  }

  // MARK: - interne (file principale)

  private func applyRoute() {
    do {
      try AVAudioSession.sharedInstance().overrideOutputAudioPort(route == "speaker" ? .speaker : .none)
    } catch {
      onError?("route-failed")
    }
  }

  private func observe() {
    let nc = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] _ in
      self?.routeChanged()
    })
    observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] n in
      self?.interruption(n)
    })
    observers.append(nc.addObserver(forName: UIDevice.proximityStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self = self, self.proximityOn else { return }
      self.onState?(["proximityNear": UIDevice.current.proximityState])
    })
  }

  // Casque, Bluetooth ou retrait d'un accessoire : on ne rapporte que les sorties intégrées, et seulement
  // si elles changent (la bascule demandée par la page ne lui revient donc jamais en écho)
  private func routeChanged() {
    guard active, let out = AVAudioSession.sharedInstance().currentRoute.outputs.first else { return }
    let now: String?
    switch out.portType {
    case .builtInSpeaker: now = "speaker"
    case .builtInReceiver: now = "ear"
    default: now = nil
    }
    guard let r = now, r != lastReportedRoute else { return }
    lastReportedRoute = r
    route = r
    onState?(["route": r])
  }

  // Appel réel ou alarme pendant la voix : le système met le lecteur en pause ; au retour on reprend
  private func interruption(_ n: Notification) {
    guard active, let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
    try? AVAudioSession.sharedInstance().setActive(true)
    applyRoute()
    if let p = player, !p.isPlaying { p.play() }
  }

  private func teardown() {
    guard active else { return }
    active = false
    for o in observers { NotificationCenter.default.removeObserver(o) }
    observers.removeAll()
    player?.stop()
    player = nil
    if proximityOn { UIDevice.current.isProximityMonitoringEnabled = false }
    proximityOn = false
    let session = AVAudioSession.sharedInstance()
    try? session.overrideOutputAudioPort(.none)
    try? session.setActive(false, options: .notifyOthersOnDeactivation)
    if let s = saved { try? session.setCategory(s.category, mode: s.mode, options: s.options) }
    saved = nil
    lastReportedRoute = nil
  }

  // La voix est finie : la session reste ouverte jusqu'au raccroché (le comédien peut encore parler)
  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    onError?("play-failed")
  }
}
