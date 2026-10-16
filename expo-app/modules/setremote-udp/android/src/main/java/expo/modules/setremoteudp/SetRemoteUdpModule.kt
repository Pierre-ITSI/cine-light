package expo.modules.setremoteudp

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Module Expo « SetRemoteUdp » : la passerelle DMX de la vue web (app/index.tsx).
// Le travail réseau est dans UdpGateway.kt ; ici, seulement l'interface JS.
class SetRemoteUdpModule : Module() {
  @Volatile
  private var gateway: UdpGateway? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Créée au premier usage : le contexte React n'existe pas avant. */
  @Synchronized
  private fun gateway(): UdpGateway? {
    gateway?.let { return it }
    val context = appContext.reactContext?.applicationContext ?: return null
    return UdpGateway(
      context,
      onError = { reason -> emit(ERROR_EVENT, mapOf("reason" to reason)) },
      onNetworkChange = { interfaces -> emit(NETWORK_EVENT, mapOf("interfaces" to interfaces)) },
    ).also { gateway = it }
  }

  private fun emit(name: String, body: Map<String, Any?>) {
    mainHandler.post {
      try {
        sendEvent(name, body)
      } catch (e: Exception) {
        // contexte React détruit entre-temps
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SetRemoteUdp")

    Events(ERROR_EVENT, NETWORK_EVENT)

    OnStartObserving(NETWORK_EVENT) {
      gateway()?.startMonitoring()
    }

    // Démarre ou remplace l'écoute ; les erreurs arrivent par onSetRemoteUdpError.
    AsyncFunction("listen") { protocol: String, universes: List<Int>, multicast: Boolean ->
      val g = gateway() ?: return@AsyncFunction emit(ERROR_EVENT, mapOf("reason" to "listen-failed"))
      g.listen(protocol, universes, multicast)
    }

    AsyncFunction("stop") {
      gateway?.stop()
    }

    AsyncFunction("send") { host: String, port: Int, data: String ->
      val g = gateway() ?: return@AsyncFunction emit(ERROR_EVENT, mapOf("reason" to "not-listening"))
      g.send(host, port, data)
    }

    // Synchrone (thread JS) : vide la file, au plus `max` paquets, les plus récents.
    Function("drain") { max: Int ->
      val batch = gateway?.packets?.drain(minOf(max, UdpLimits.MAX_BATCH)) ?: emptyList()
      batch.map { mapOf("src" to it.src, "port" to it.port, "data" to it.data) }
    }

    AsyncFunction("getNetworkInfo") { promise: Promise ->
      val g = gateway() ?: return@AsyncFunction promise.resolve(emptyList<Map<String, String>>())
      g.networkInfo { interfaces -> promise.resolve(interfaces) }
    }

    // Même règle que sur iOS : sockets fermés en arrière-plan (et MulticastLock
    // relâché), rouverts au retour si la page écoutait.
    OnActivityEntersBackground {
      gateway?.suspend()
    }

    OnActivityEntersForeground {
      gateway?.resume()
    }

    OnDestroy {
      gateway?.shutdown()
      gateway = null
    }
  }

  companion object {
    // Préfixés pour ne pas croiser les événements d'autres modules.
    const val ERROR_EVENT = "onSetRemoteUdpError"
    const val NETWORK_EVENT = "onSetRemoteUdpNetwork"
  }
}
