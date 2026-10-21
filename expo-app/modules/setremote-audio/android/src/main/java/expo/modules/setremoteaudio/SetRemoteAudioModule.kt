// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
package expo.modules.setremoteaudio

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Module Expo « SetRemoteAudio » : l'audio de l'appel décroché de l'écran de jeu (app/index.tsx, pont
// src/bridge.ts, docs/CALL-AUDIO-NATIVE.md). Le travail est dans CallAudio.kt ; ici, seulement l'interface JS.
class SetRemoteAudioModule : Module() {
  @Volatile
  private var call: CallAudio? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  /** Créé au premier usage : le contexte React n'existe pas avant. */
  @Synchronized
  private fun call(): CallAudio? {
    call?.let { return it }
    val context = appContext.reactContext?.applicationContext ?: return null
    return CallAudio(
      context,
      onState = { state -> emit(STATE_EVENT, state) },
      onError = { reason -> emit(ERROR_EVENT, mapOf("reason" to reason)) },
    ).also { call = it }
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
    Name("SetRemoteAudio")

    Events(STATE_EVENT, ERROR_EVENT)

    // Les erreurs de session, de sortie et de lecture arrivent par onSetRemoteAudioError.
    AsyncFunction("startCall") { route: String, proximity: Boolean ->
      val c = call() ?: return@AsyncFunction emit(ERROR_EVENT, mapOf("reason" to "session-failed"))
      c.start(route, proximity)
    }

    AsyncFunction("play") { uri: String, delay: Double ->
      val c = call() ?: return@AsyncFunction emit(ERROR_EVENT, mapOf("reason" to "play-failed"))
      c.play(uri, delay)
    }

    AsyncFunction("setRoute") { route: String ->
      call?.setRoute(route)
    }

    AsyncFunction("endCall") {
      call?.end()
    }

    OnDestroy {
      call?.end()
      call = null
    }
  }

  companion object {
    // Préfixés pour ne pas croiser les événements d'autres modules.
    const val STATE_EVENT = "onSetRemoteAudioState"
    const val ERROR_EVENT = "onSetRemoteAudioError"
  }
}
