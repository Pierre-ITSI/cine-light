// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
package expo.modules.setremoteaudio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.util.concurrent.Executor

/**
 * Audio d'un appel décroché (Android). Un seul appel à la fois ; tout s'exécute sur le thread principal.
 *
 *  • Mode : AudioManager.MODE_IN_COMMUNICATION, focus audio transitoire, lecteur en USAGE_VOICE_COMMUNICATION /
 *    CONTENT_TYPE_SPEECH : c'est ce qui permet la sortie écouteur, qu'une WebView (USAGE_MEDIA) n'a pas.
 *  • Sortie : API 31+ setCommunicationDevice(écouteur ou haut-parleur intégrés, parmi availableCommunicationDevices) ;
 *    avant, isSpeakerphoneOn. Bascule à chaud, sans toucher au lecteur. Un casque ou un Bluetooth branché
 *    garde la priorité du système (la page est informée par onState, pour les sorties intégrées).
 *  • Délai avant la voix : minuteur du thread principal, compté depuis la demande de lecture (la préparation du
 *    fichier se fait pendant l'attente).
 *  • Proximité : PROXIMITY_SCREEN_OFF_WAKE_LOCK, acquis pendant l'appel décroché seulement, si demandé et pris en
 *    charge ; sinon proximityAvailable = false. Jamais touché sinon : l'écran reste visible.
 *  • Fin : lecteur arrêté, sortie, mode et focus rendus dans leur état d'avant, verrou relâché.
 */
class CallAudio(
  private val context: Context,
  private val onState: (Map<String, Any?>) -> Unit,
  private val onError: (String) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager

  private var active = false
  private var route = "ear"
  private var lastReportedRoute: String? = null
  private var previousMode = AudioManager.MODE_NORMAL
  private var previousSpeaker = false
  private var focusRequest: AudioFocusRequest? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var player: MediaPlayer? = null
  private var startTask: Runnable? = null
  private var deviceListener: AudioManager.OnCommunicationDeviceChangedListener? = null

  private val attributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

  private fun onMain(work: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) work() else main.post { work() }
  }

  fun start(route: String, proximity: Boolean) = onMain {
    if (active) teardown()
    previousMode = audio.mode
    @Suppress("DEPRECATION")
    previousSpeaker = audio.isSpeakerphoneOn
    this.route = if (route == "speaker") "speaker" else "ear"
    lastReportedRoute = this.route
    try {
      audio.mode = AudioManager.MODE_IN_COMMUNICATION
      requestFocus()
    } catch (e: Exception) {
      audio.mode = previousMode
      onError("session-failed")
      return@onMain
    }
    active = true
    applyRoute()
    observeRoute()
    if (proximity) acquireProximity()
  }

  fun play(path: String, delay: Double) = onMain {
    if (!active) { onError("play-failed"); return@onMain }
    stopPlayer()
    val asked = SystemClock.elapsedRealtime()
    val wait = (Math.min(Math.max(delay, 0.0), 15.0) * 1000).toLong()
    try {
      val mp = MediaPlayer()
      mp.setAudioAttributes(attributes)
      mp.setDataSource(context, if (path.startsWith("file://")) Uri.parse(path) else Uri.fromFile(java.io.File(path)))
      mp.setOnErrorListener { _, _, _ -> onError("play-failed"); true }
      mp.setOnPreparedListener { p ->
        val task = Runnable { startTask = null; if (player === p) try { p.start() } catch (e: Exception) { onError("play-failed") } }
        startTask = task
        val left = wait - (SystemClock.elapsedRealtime() - asked)
        if (left > 0) main.postDelayed(task, left) else task.run()
      }
      player = mp
      mp.prepareAsync()
    } catch (e: Exception) {
      stopPlayer()
      onError("play-failed")
    }
  }

  fun setRoute(r: String) = onMain {
    if (!active) return@onMain
    route = if (r == "speaker") "speaker" else "ear"
    lastReportedRoute = route
    applyRoute()
  }

  fun end() = onMain { teardown() }

  // ── interne (thread principal) ──

  private fun requestFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val r = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes).build()
      focusRequest = r
      audio.requestAudioFocus(r)
    } else {
      @Suppress("DEPRECATION")
      audio.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    }
  }

  private fun abandonFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { audio.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audio.abandonAudioFocus(null)
    }
  }

  private fun applyRoute() {
    val speaker = route == "speaker"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val wanted = if (speaker) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
      val device = audio.availableCommunicationDevices.firstOrNull { it.type == wanted }
      if (device == null || !audio.setCommunicationDevice(device)) onError("route-failed")
    } else {
      @Suppress("DEPRECATION")
      audio.isSpeakerphoneOn = speaker
    }
  }

  // Android 12+ : sortie changée par le système (casque, Bluetooth, retrait). On ne rapporte que les sorties
  // intégrées, et seulement si elles changent : la bascule demandée par la page ne lui revient jamais en écho.
  private fun observeRoute() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val listener = AudioManager.OnCommunicationDeviceChangedListener { device ->
      if (!active || device == null) return@OnCommunicationDeviceChangedListener
      val now = when (device.type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "ear"
        else -> null
      } ?: return@OnCommunicationDeviceChangedListener
      if (now == lastReportedRoute) return@OnCommunicationDeviceChangedListener
      lastReportedRoute = now
      route = now
      onState(mapOf("route" to now))
    }
    deviceListener = listener
    audio.addOnCommunicationDeviceChangedListener(Executor { main.post(it) }, listener)
  }

  private fun acquireProximity() {
    val supported = power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)
    if (supported) {
      try {
        val lock = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "SetRemote:proximity")
        lock.setReferenceCounted(false)
        lock.acquire()
        wakeLock = lock
      } catch (e: Exception) {
        wakeLock = null
      }
    }
    onState(mapOf("proximityAvailable" to (wakeLock != null)))
  }

  private fun stopPlayer() {
    startTask?.let { main.removeCallbacks(it) }
    startTask = null
    player?.let {
      try { it.stop() } catch (e: Exception) { /* pas démarré */ }
      it.release()
    }
    player = null
  }

  private fun teardown() {
    if (!active) return
    active = false
    stopPlayer()
    wakeLock?.let { try { if (it.isHeld) it.release() } catch (e: Exception) { /* déjà relâché */ } }
    wakeLock = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      deviceListener?.let { audio.removeOnCommunicationDeviceChangedListener(it) }
      audio.clearCommunicationDevice()
    } else {
      @Suppress("DEPRECATION")
      audio.isSpeakerphoneOn = previousSpeaker
    }
    deviceListener = null
    abandonFocus()
    audio.mode = previousMode
    lastReportedRoute = null
  }
}
