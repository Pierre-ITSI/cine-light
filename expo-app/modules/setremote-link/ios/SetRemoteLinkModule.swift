// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import ExpoModulesCore

// Module Expo « SetRemoteLink » : liaisons hors ligne de la vue web
// (app/index.tsx, contrat dans docs/OFFLINE-NATIVE.md). Le travail est dans
// LinkManager / LanLink / BleLink ; ici, seulement l'interface JS. Toutes les
// fonctions sont synchrones et ne font que poster sur la file série du
// coordinateur, dans l'ordre des appels. Noms d'événements préfixés : sur iOS,
// un événement est remis à tous les modules qui déclarent le même nom.
public class SetRemoteLinkModule: Module {
  private let manager = LinkManager()

  public func definition() -> ModuleDefinition {
    Name("SetRemoteLink")

    Events(LinkManager.peersEvent, LinkManager.stateEvent, LinkManager.errorEvent)

    OnCreate {
      manager.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    // Démarre ou remplace les liaisons ; résultats par événements.
    Function("start") { (modes: [String], role: String, roomTag: String, authKey: String, name: String) in
      manager.start(modes: modes, role: role, roomTagHex: roomTag, authKeyHex: authKey, name: name)
    }

    Function("stop") { (modes: [String]) in
      manager.stop(modes: modes)
    }

    Function("send") { (frames: [String], to: [String]) in
      manager.send(frames: frames, to: to)
    }

    // Vide la file de réception : au plus maxFrames trames et maxBytes octets.
    Function("drain") { (maxFrames: Int, maxBytes: Int) -> [[String: Any]] in
      return manager.drain(maxFrames: maxFrames, maxBytes: maxBytes)
    }

    Function("getState") { () -> [String: Any] in
      return manager.state()
    }

    // Premier plan uniquement : iOS suspendrait sockets et Bluetooth ; on ferme
    // tout en arrière-plan et on rouvre au retour.
    OnAppEntersBackground {
      manager.suspend()
    }

    OnAppEntersForeground {
      manager.resume()
    }

    OnDestroy {
      manager.shutdown()
    }
  }
}
