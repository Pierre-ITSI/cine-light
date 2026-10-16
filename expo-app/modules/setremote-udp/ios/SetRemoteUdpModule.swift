import ExpoModulesCore

// Module Expo « SetRemoteUdp » : la passerelle DMX de la vue web (app/index.tsx).
// Le travail réseau est dans UdpGateway.swift ; ici, seulement l'interface JS.
// Noms d'événements préfixés : sur iOS, un événement est remis à tous les
// modules qui déclarent le même nom.
public class SetRemoteUdpModule: Module {
  private let gateway = UdpGateway()

  public func definition() -> ModuleDefinition {
    Name("SetRemoteUdp")

    Events("onSetRemoteUdpError", "onSetRemoteUdpNetwork")

    OnCreate {
      gateway.onError = { [weak self] reason in
        self?.sendEvent("onSetRemoteUdpError", ["reason": reason])
      }
      gateway.onNetworkChange = { [weak self] interfaces in
        self?.sendEvent("onSetRemoteUdpNetwork", ["interfaces": interfaces])
      }
    }

    OnStartObserving("onSetRemoteUdpNetwork") {
      gateway.startMonitoring()
    }

    // Démarre ou remplace l'écoute ; les erreurs arrivent par onSetRemoteUdpError.
    AsyncFunction("listen") { (protocolName: String, universes: [Int], multicast: Bool) in
      gateway.listen(protocolName: protocolName, universes: universes, multicast: multicast)
    }

    AsyncFunction("stop") {
      gateway.stop()
    }

    AsyncFunction("send") { (host: String, port: Int, data: String) in
      gateway.send(host: host, port: port, base64: data)
    }

    // Synchrone (thread JS) : vide la file, au plus `max` paquets, les plus récents.
    Function("drain") { (max: Int) -> [[String: Any]] in
      return gateway.packets.drain(limit: Swift.min(max, UdpLimits.maxBatch)).map { p -> [String: Any] in
        ["src": p.src, "port": p.port, "data": p.data]
      }
    }

    AsyncFunction("getNetworkInfo") { (promise: Promise) in
      gateway.networkInfo { interfaces in
        promise.resolve(interfaces)
      }
    }

    // iOS suspend les sockets d'une app en arrière-plan : on les ferme, puis on
    // les rouvre au retour si la page écoutait.
    OnAppEntersBackground {
      gateway.suspend()
    }

    OnAppEntersForeground {
      gateway.resume()
    }

    OnDestroy {
      gateway.shutdown()
    }
  }
}
