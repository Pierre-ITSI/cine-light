package expo.modules.setremotelink

import android.os.Handler
import android.os.Looper
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Module Expo « SetRemoteLink » : liaisons hors ligne de la vue web
// (app/index.tsx, contrat dans docs/OFFLINE-NATIVE.md). Le travail est dans
// LinkManager / LanLink / BleLink ; ici, seulement l'interface JS. Toutes les
// fonctions sont synchrones et ne font que poster sur le worker du
// coordinateur, dans l'ordre des appels.
class SetRemoteLinkModule : Module() {
  @Volatile
  private var manager: LinkManager? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Créé au premier usage : le contexte React n'existe pas avant. */
  @Synchronized
  private fun manager(): LinkManager? {
    manager?.let { return it }
    val context = appContext.reactContext?.applicationContext ?: return null
    return LinkManager(
      context,
      emit = { name, body -> emit(name, body) },
      requestPermissions = { perms, done -> requestPermissions(perms, done) },
    ).also { manager = it }
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

  /** Autorisations d'exécution via le gestionnaire d'Expo (sur le thread principal). */
  private fun requestPermissions(perms: Array<String>, done: (Boolean) -> Unit) {
    if (perms.isEmpty()) return done(true)
    mainHandler.post {
      val permissions = appContext.permissions
      if (permissions == null) {
        done(false)
        return@post
      }
      try {
        if (permissions.hasGrantedPermissions(*perms)) {
          done(true)
          return@post
        }
        permissions.askForPermissions({ result ->
          done(perms.all { result[it]?.status == PermissionsStatus.GRANTED })
        }, *perms)
      } catch (e: Exception) {
        done(false)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SetRemoteLink")

    Events(LinkManager.PEERS_EVENT, LinkManager.STATE_EVENT, LinkManager.ERROR_EVENT)

    // Démarre ou remplace les liaisons ; résultats par événements.
    Function("start") { modes: List<String>, role: String, roomTag: String, authKey: String, name: String ->
      val m = manager()
      if (m == null) {
        for (mode in modes) emit(LinkManager.ERROR_EVENT, mapOf("mode" to mode, "reason" to "start-failed"))
      } else {
        m.start(modes, role, roomTag, authKey, name)
      }
    }

    Function("stop") { modes: List<String> ->
      manager?.stop(modes)
    }

    Function("send") { frames: List<String>, to: List<String> ->
      val m = manager
      if (m == null) emit(LinkManager.ERROR_EVENT, mapOf("mode" to null, "reason" to "not-started"))
      else m.send(frames, to)
    }

    // Vide la file de réception : au plus maxFrames trames et maxBytes octets.
    Function("drain") { maxFrames: Int, maxBytes: Int ->
      manager?.drain(maxFrames, maxBytes) ?: emptyList()
    }

    Function("getState") {
      manager()?.state() ?: mapOf(
        "lan" to mapOf("available" to false, "active" to false),
        "ble" to mapOf("available" to false, "active" to false),
      )
    }

    // Premier plan uniquement : liaisons coupées en arrière-plan (après un
    // court délai de grâce), rouvertes au retour.
    OnActivityEntersBackground {
      manager?.suspend()
    }

    OnActivityEntersForeground {
      manager?.resume()
    }

    OnDestroy {
      manager?.shutdown()
      manager = null
    }
  }
}
