// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import ExpoModulesCore

// Module Expo « SetRemoteAudio » : l'audio de l'appel décroché de l'écran de jeu (app/index.tsx,
// pont src/bridge.ts, docs/CALL-AUDIO-NATIVE.md). Le travail est dans CallAudio.swift ; ici, seulement
// l'interface JS. Noms d'événements préfixés : sur iOS, un événement est remis à tous les modules
// qui déclarent le même nom.
public class SetRemoteAudioModule: Module {
  private let call = CallAudio()

  public func definition() -> ModuleDefinition {
    Name("SetRemoteAudio")

    Events("onSetRemoteAudioState", "onSetRemoteAudioError")

    OnCreate {
      call.onState = { [weak self] state in
        self?.sendEvent("onSetRemoteAudioState", state)
      }
      call.onError = { [weak self] reason in
        self?.sendEvent("onSetRemoteAudioError", ["reason": reason])
      }
    }

    // Les erreurs de session, de sortie et de lecture arrivent aussi par onSetRemoteAudioError.
    AsyncFunction("startCall") { (route: String, proximity: Bool) in
      call.start(route: route, proximity: proximity)
    }

    AsyncFunction("play") { (uri: String, delay: Double) in
      call.play(path: uri, delay: delay)
    }

    AsyncFunction("setRoute") { (route: String) in
      call.setRoute(route)
    }

    AsyncFunction("endCall") {
      call.end()
    }

    OnDestroy {
      call.end()
    }
  }
}
