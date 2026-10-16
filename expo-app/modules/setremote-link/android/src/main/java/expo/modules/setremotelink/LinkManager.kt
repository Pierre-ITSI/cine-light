package expo.modules.setremotelink

import android.content.Context
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

// ════════════════════════════════════════════════════════════════════════════
// Coordinateur des liaisons hors ligne (Android) : configuration demandée par
// la page, registre des pairs admis, routage des envois, état publié, file de
// réception. Toute la gestion d'état se fait sur UN thread (`worker`) ; les
// fils de lecture TCP ne touchent qu'à la file de réception (synchronisée).
// Contrat : docs/OFFLINE-NATIVE.md § 2 ; choix techniques : § 5.
// ════════════════════════════════════════════════════════════════════════════

internal enum class LinkMode(val id: String, val prefix: String, val maxFrame: Int) {
  LAN("lan", "l", LinkLimits.LAN_MAX_FRAME),
  BLE("ble", "b", LinkLimits.BLE_MAX_FRAME);

  companion object {
    fun from(id: String): LinkMode? = values().firstOrNull { it.id == id }
  }
}

internal enum class LinkRole(val id: String, val wire: Int) {
  REMOTE("remote", LinkWire.ROLE_REMOTE),
  SCREEN("screen", LinkWire.ROLE_SCREEN);

  companion object {
    fun from(id: String): LinkRole? = values().firstOrNull { it.id == id }
  }
}

/** Ce que la page a demandé ; immuable. */
internal class LinkConfig(val role: LinkRole, val roomTag: ByteArray, val authKey: ByteArray, val name: String) {
  val roomTagHex: String = LinkWire.hex(roomTag)

  fun sameAs(o: LinkConfig?): Boolean =
    o != null && o.role == role && o.roomTag.contentEquals(roomTag) && o.authKey.contentEquals(authKey) && o.name == name

  fun newHandshake(): Handshake = Handshake(role.wire, roomTag, authKey, LinkWire.randomBytes(LinkLimits.NONCE_BYTES), name)
}

internal class ModeState(val available: Boolean, val active: Boolean, val error: String?) {
  fun toMap(): Map<String, Any> {
    val m = LinkedHashMap<String, Any>()
    m["available"] = available
    m["active"] = active
    if (error != null) m["error"] = error
    return m
  }

  val signature: String get() = "$available|$active|${error ?: ""}"
}

/** Un pair admis (poignée de main réussie), vu par le coordinateur. */
internal interface LinkPeer {
  val id: String
  val mode: LinkMode
  val name: String

  /** Messages DATA déjà encodés ; la file du pair jette ses plus anciens au-delà de son plafond. */
  fun enqueueData(messages: List<ByteArray>)

  fun close()
}

/** Une liaison (Wi-Fi ou Bluetooth). Méthodes appelées sur le worker. */
internal interface LinkTransport {
  val mode: LinkMode
  val config: LinkConfig?

  /** Démarre avec cette configuration ; sans effet si déjà démarrée. */
  fun start(config: LinkConfig)

  /** Arrête tout et oublie la configuration ; les pairs sont retirés du registre. */
  fun stop()

  fun state(): ModeState

  /** Nouveau link:start explicite de la page (oublie un refus d'autorisation, etc.). */
  fun onExplicitStart() {}
}

internal class LinkManager(
  context: Context,
  /** Événement vers JS (nom, corps) ; appelé sur le worker. */
  private val emit: (String, Map<String, Any?>) -> Unit,
  /** Demande d'autorisations d'exécution ; `done` peut être appelé sur n'importe quel thread. */
  val requestPermissions: (Array<String>, (Boolean) -> Unit) -> Unit,
) {
  val worker: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
    Thread(r, "SetRemoteLink").apply { isDaemon = true }
  }
  val inbox = Inbox(LinkLimits.INBOX_MAX_FRAMES, LinkLimits.INBOX_MAX_BYTES)

  // État, lu et modifié uniquement sur `worker`
  private val peers = LinkedHashMap<String, LinkPeer>()
  private val requested = LinkedHashSet<LinkMode>()
  private var config: LinkConfig? = null
  private var suspended = false
  private var pendingSuspend: ScheduledFuture<*>? = null
  @Volatile
  private var lastStateSignature: String? = null
  private val transports: List<LinkTransport> = listOf(LanLink(this, context), BleLink(this, context))

  /** Dernier état publié, lu par getState() sur le thread JS. */
  @Volatile
  private var snapshot: Map<String, Any> = emptyState()

  // ─────────────────────────── API (tout thread) ───────────────────────────

  fun start(modes: List<String>, role: String, roomTagHex: String, authKeyHex: String, name: String) = post {
    val wanted = modes.mapNotNull { LinkMode.from(it) }.distinct()
    if (wanted.isEmpty() || wanted.size != modes.distinct().size) return@post error(null, "invalid-modes")
    val r = LinkRole.from(role) ?: return@post error(null, "invalid-role")
    val tag = LinkWire.parseHex(roomTagHex, LinkLimits.ROOM_TAG_BYTES) ?: return@post error(null, "invalid-room")
    val key = LinkWire.parseHex(authKeyHex, LinkLimits.AUTH_KEY_BYTES) ?: return@post error(null, "invalid-room")
    val nameBytes = LinkWire.truncateUtf8(name.toByteArray(Charsets.UTF_8), LinkLimits.MAX_NAME_BYTES)
    val next = LinkConfig(r, tag, key, LinkWire.sanitizeName(LinkWire.decodeUtf8(nameBytes, 0, nameBytes.size)))
    if (!next.sameAs(config)) inbox.clear()
    config = next
    requested.clear()
    requested.addAll(wanted)
    for (t in transports) {
      if (t.mode !in requested) {
        t.stop()
        continue
      }
      t.onExplicitStart()
      if (!next.sameAs(t.config)) t.stop()
      if (!suspended) t.start(next)
    }
    refreshState()
  }

  fun stop(modes: List<String>) = post {
    val list = if (modes.isEmpty()) LinkMode.values().toList() else modes.mapNotNull { LinkMode.from(it) }
    for (m in list) {
      requested.remove(m)
      transports.first { it.mode == m }.stop()
    }
    if (requested.isEmpty()) {
      config = null
      inbox.clear()
    }
    refreshState()
  }

  fun send(frames: List<String>, to: List<String>) = post {
    if (requested.isEmpty()) return@post error(null, "not-started")
    if (frames.isEmpty() || frames.size > 256 || to.size > 64) return@post error(null, "invalid-frames")
    val targets: Collection<LinkPeer>
    if (to.isEmpty()) {
      targets = peers.values.toList()
    } else {
      val ids = to.distinct()
      targets = ids.mapNotNull { peers[it] }
      if (targets.size < ids.size) error(null, "unknown-peer")
    }
    if (targets.isEmpty()) return@post
    // Un seul encodage par trame, partagé entre les pairs
    val messages = frames.map { LinkWire.encodeData(it.toByteArray(Charsets.UTF_8)) }
    val tooLarge = LinkedHashSet<LinkMode>()
    for (p in targets) {
      val list = ArrayList<ByteArray>(messages.size)
      for (m in messages) {
        if (m.size - 1 > p.mode.maxFrame) tooLarge.add(p.mode)
        else if (m.size > 1) list.add(m)
      }
      if (list.isNotEmpty()) p.enqueueData(list)
    }
    for (m in tooLarge) error(m, "too-large")
  }

  /** Synchrone (thread JS) : au plus maxFrames trames et maxBytes octets ; le reste attend. */
  fun drain(maxFrames: Int, maxBytes: Int): List<Map<String, Any>> =
    inbox.drain(maxFrames.coerceIn(1, LinkLimits.MAX_BATCH_FRAMES), maxBytes.coerceIn(1, LinkLimits.MAX_BATCH_BYTES))
      .map { mapOf("peer" to it.peer, "mode" to it.mode, "data" to it.data) }

  /** Synchrone (thread JS). Au tout premier appel, attend (≤ 500 ms) que le worker ait calculé l'état. */
  fun state(): Map<String, Any> {
    if (lastStateSignature != null) return snapshot
    return try {
      worker.submit(Callable { refreshState(); snapshot }).get(500, TimeUnit.MILLISECONDS)
    } catch (e: Exception) {
      snapshot
    }
  }

  /**
   * Activité en pause. Délai de grâce : une boîte de dialogue système
   * (autorisation Bluetooth) met aussi l'activité en pause ; on ne coupe les
   * liaisons que si la pause dure.
   */
  fun suspend() = post {
    if (suspended || pendingSuspend != null) return@post
    pendingSuspend = schedule(SUSPEND_GRACE_MS) {
      pendingSuspend = null
      suspended = true
      for (t in transports) t.stop()
      refreshState()
    }
  }

  /** Retour au premier plan : on rouvre ce que la page avait demandé. */
  fun resume() = post {
    pendingSuspend?.cancel(false)
    pendingSuspend = null
    if (!suspended) return@post
    suspended = false
    val c = config ?: return@post
    for (t in transports) if (t.mode in requested) t.start(c)
    refreshState()
  }

  fun shutdown() {
    post {
      requested.clear()
      config = null
      for (t in transports) t.stop()
      inbox.clear()
    }
    worker.shutdown()
  }

  // ─────────────────────────── pour les liaisons ───────────────────────────

  fun post(block: () -> Unit) {
    try {
      worker.execute {
        try {
          block()
        } catch (e: Exception) {
          // Jamais de plantage de l'app sur une erreur réseau ou Bluetooth inattendue
        }
      }
    } catch (e: RejectedExecutionException) {
      // module détruit
    }
  }

  fun schedule(delayMs: Long, block: () -> Unit): ScheduledFuture<*>? = try {
    worker.schedule(Runnable {
      try {
        block()
      } catch (e: Exception) {
        // idem
      }
    }, delayMs, TimeUnit.MILLISECONDS)
  } catch (e: RejectedExecutionException) {
    null
  }

  /** Worker. Faux si le plafond de la liaison est atteint (le pair doit être fermé). */
  fun admit(peer: LinkPeer, limit: Int): Boolean {
    if (peers.values.count { it.mode == peer.mode } >= limit) {
      error(peer.mode, "too-many-peers")
      return false
    }
    peers[peer.id] = peer
    publishPeers()
    return true
  }

  /** Worker. Sans effet si le pair n'est pas (ou plus) enregistré. */
  fun remove(peer: LinkPeer) {
    if (peers.remove(peer.id) != null) publishPeers()
  }

  /** Tout thread : trame reçue d'un pair admis. */
  fun receive(peerId: String, mode: LinkMode, data: String, bytes: Int) {
    if (data.isEmpty()) return
    if (inbox.push(InboundFrame(peerId, mode.id, data, bytes))) post { error(mode, "congested") }
  }

  /** Worker (ou tout thread : l'émission est postée sur le thread principal par le module). */
  fun error(mode: LinkMode?, reason: String) {
    emit(ERROR_EVENT, mapOf("mode" to mode?.id, "reason" to reason))
  }

  /** Worker : recalcule l'état et le publie s'il a changé. */
  fun refreshState() {
    val lan = transports[0].state()
    val ble = transports[1].state()
    snapshot = mapOf("lan" to lan.toMap(), "ble" to ble.toMap())
    val sig = lan.signature + ";" + ble.signature
    if (sig == lastStateSignature) return
    lastStateSignature = sig
    emit(STATE_EVENT, snapshot)
  }

  private fun publishPeers() {
    val list = peers.values.map { p ->
      val m = LinkedHashMap<String, Any>()
      m["peer"] = p.id
      m["mode"] = p.mode.id
      if (p.name.isNotEmpty()) m["name"] = p.name
      m
    }
    emit(PEERS_EVENT, mapOf("peers" to list))
  }

  private fun emptyState(): Map<String, Any> {
    val off = ModeState(false, false, null).toMap()
    return mapOf("lan" to off, "ble" to off)
  }

  companion object {
    const val PEERS_EVENT = "onSetRemoteLinkPeers"
    const val STATE_EVENT = "onSetRemoteLinkState"
    const val ERROR_EVENT = "onSetRemoteLinkError"
    const val SUSPEND_GRACE_MS = 2000L
  }
}
