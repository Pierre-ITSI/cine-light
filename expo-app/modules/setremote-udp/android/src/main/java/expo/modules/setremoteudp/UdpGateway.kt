package expo.modules.setremoteudp

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.util.Base64
import java.io.IOException
import java.net.DatagramPacket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.SocketAddress
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

// ════════════════════════════════════════════════════════════════════════════
// Passerelle DMX, côté Android : réception UDP sACN (5568) ou Art-Net (6454).
//
//   • Un MulticastSocket lié à 0.0.0.0:<port> (SO_REUSEADDR, SO_BROADCAST),
//     lu par un thread dédié ; il reçoit l'unicast, le broadcast (ArtPoll) et,
//     en sACN, les groupes 239.255.hi.lo rejoints sur l'interface choisie.
//   • Réseau : Ethernet s'il existe (adaptateur USB-C), sinon Wi-Fi. Les
//     sockets DMX y sont attachés par Network.bindSocket() — PAS
//     bindProcessToNetwork(), qui ferait aussi passer la vue web (relais MQTT,
//     WebRTC) par un réseau lumière souvent sans Internet.
//   • WifiManager.MulticastLock tenu seulement pendant une écoute multicast :
//     sans lui, le Wi-Fi filtre multicast et broadcast (ArtPoll).
//   • Linux limite les adhésions IGMP à 20 par socket (igmp_max_memberships) :
//     au-delà, des sockets auxiliaires sur un port éphémère rejoignent les
//     groupes suivants ; le socket principal les reçoit (IP_MULTICAST_ALL,
//     actif par défaut sous Linux).
//   • Toute la gestion d'état se fait sur un seul thread (`worker`).
//
// Aucune trace du contenu des paquets : seules des raisons d'erreur remontent.
// ════════════════════════════════════════════════════════════════════════════

internal object UdpLimits {
  const val MAX_UNIVERSES = 64
  const val MAX_DATAGRAM = 1500
  /** File native : ≈ 1,5 s à 8 univers × 44 Hz. Pleine, elle jette les plus anciens. */
  const val QUEUE_CAPACITY = 512
  /** Lot maximal remis à JS par drain(). */
  const val MAX_BATCH = 256
  const val SACN_DISCOVERY_UNIVERSE = 64214
  const val GROUPS_PER_SOCKET = 20
  const val NETWORK_DEBOUNCE_MS = 300L
}

internal enum class DmxProtocol(val id: String, val port: Int) {
  SACN("sacn", 5568),
  ARTNET("artnet", 6454);

  fun accepts(universe: Int): Boolean = when (this) {
    SACN -> universe in 1..63999 || universe == UdpLimits.SACN_DISCOVERY_UNIVERSE
    ARTNET -> universe in 0..32767
  }

  companion object {
    fun from(id: String): DmxProtocol? = values().firstOrNull { it.id == id }
  }
}

internal data class ListenConfig(val proto: DmxProtocol, val universes: List<Int>, val multicast: Boolean)

/** Datagramme reçu : émetteur et contenu déjà en base64 (calculé ici, hors du thread JS). */
internal class ReceivedPacket(val src: String, val port: Int, val data: String)

/** File bornée ; producteur : thread de réception ; consommateur : drain() sur le thread JS. */
internal class PacketQueue(private val capacity: Int) {
  private val items = ArrayDeque<ReceivedPacket>(capacity)

  @Synchronized
  fun push(packet: ReceivedPacket) {
    if (items.size >= capacity) items.removeFirst() // JS en retard : on jette le plus ancien
    items.addLast(packet)
  }

  /** Au plus `limit` paquets, les plus récents, dans l'ordre d'arrivée ; les plus anciens au-delà sont jetés. */
  @Synchronized
  fun drain(limit: Int): List<ReceivedPacket> {
    val keep = minOf(items.size, maxOf(1, limit))
    while (items.size > keep) items.removeFirst()
    val out = ArrayList<ReceivedPacket>(items.size)
    while (items.isNotEmpty()) out.add(items.removeFirst())
    return out
  }

  @Synchronized
  fun clear() {
    items.clear()
  }
}

internal class UdpGateway(
  context: Context,
  /** Appelés sur le thread `worker`. */
  private val onError: (String) -> Unit,
  private val onNetworkChange: (List<Map<String, String>>) -> Unit,
) {
  val packets = PacketQueue(UdpLimits.QUEUE_CAPACITY)

  private val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
  private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
  private val worker: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
    Thread(r, "SetRemoteUdp").apply { isDaemon = true }
  }

  /** Réseau retenu pour les sockets DMX. */
  private class Target(val network: Network, val interfaceName: String?, val ipv4: Inet4Address, val kind: String) {
    val signature: String get() = "$network|$interfaceName|${ipv4.hostAddress}"
  }

  private class Session(
    val generation: Int,
    val socket: MulticastSocket,
    val helpers: List<MulticastSocket>,
    val networkSignature: String?,
  )

  // État, lu et modifié uniquement sur `worker`
  private var config: ListenConfig? = null // écoute demandée par la page (conservée en arrière-plan)
  private var suspended = false
  private var session: Session? = null
  private var generation = 0
  private var multicastLock: WifiManager.MulticastLock? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var pendingPublish: ScheduledFuture<*>? = null
  private var lastSignature: String? = null

  // ─────────────────────────── API (tout thread) ───────────────────────────

  fun listen(protocol: String, universes: List<Int>, multicast: Boolean) = post {
    val proto = DmxProtocol.from(protocol) ?: return@post onError("invalid-protocol")
    if (universes.size > UdpLimits.MAX_UNIVERSES || universes.any { !proto.accepts(it) }) {
      return@post onError("invalid-universes")
    }
    ensureMonitor()
    config = ListenConfig(proto, universes.distinct(), multicast)
    packets.clear()
    if (!suspended) openSockets()
  }

  fun stop() = post {
    config = null
    closeSockets()
    packets.clear()
  }

  /** Activité en pause (arrière-plan) : on ferme et on garde la demande. */
  fun suspend() = post {
    suspended = true
    closeSockets()
    packets.clear()
  }

  /** Retour au premier plan : on rouvre si la page écoutait, et on republie le réseau. */
  fun resume() = post {
    if (!suspended) return@post
    suspended = false
    if (config != null) openSockets()
    if (networkCallback != null) publish(force = true)
  }

  fun send(host: String, port: Int, base64: String) = post {
    val address = parseIPv4(host) ?: return@post onError("invalid-host")
    if (port !in 1..65535) return@post onError("invalid-port")
    val bytes = try {
      Base64.decode(base64, Base64.NO_WRAP)
    } catch (e: IllegalArgumentException) {
      null
    }
    if (bytes == null || bytes.isEmpty() || bytes.size > UdpLimits.MAX_DATAGRAM) return@post onError("invalid-data")
    val s = session ?: return@post onError("not-listening")
    try {
      s.socket.send(DatagramPacket(bytes, bytes.size, address, port)) // depuis le port d'écoute
    } catch (e: Exception) {
      onError("send-failed")
    }
  }

  fun networkInfo(done: (List<Map<String, String>>) -> Unit) = post {
    ensureMonitor()
    done(interfaces())
  }

  fun startMonitoring() = post { ensureMonitor() }

  fun shutdown() {
    post {
      config = null
      closeSockets()
      packets.clear()
      pendingPublish?.cancel(false)
      networkCallback?.let { cb ->
        try {
          connectivity?.unregisterNetworkCallback(cb)
        } catch (e: RuntimeException) {
          // déjà désinscrit
        }
      }
      networkCallback = null
    }
    worker.shutdown()
  }

  // ─────────────────────────── interne (worker) ───────────────────────────

  private fun post(block: () -> Unit) {
    try {
      worker.execute { block() }
    } catch (e: RejectedExecutionException) {
      // module détruit
    }
  }

  private fun openSockets() {
    closeSockets()
    val c = config ?: return
    val target = chooseNetwork()
    val socket = try {
      // MulticastSocket(SocketAddress) active SO_REUSEADDR avant bind().
      MulticastSocket(null as SocketAddress?)
    } catch (e: IOException) {
      config = null
      return onError("bind-failed")
    }
    try {
      socket.broadcast = true
      socket.receiveBufferSize = 1 shl 20 // absorbe les rafales (plusieurs univers à 44 Hz)
      bindToNetwork(socket, target)
      socket.bind(InetSocketAddress(c.proto.port))
    } catch (e: Exception) {
      socket.close()
      config = null
      return onError("bind-failed")
    }
    val helpers = ArrayList<MulticastSocket>()
    if (c.multicast) {
      acquireMulticastLock()
      if (c.proto == DmxProtocol.SACN && c.universes.isNotEmpty()) joinGroups(c.universes, socket, helpers, target)
    }
    val gen = ++generation
    session = Session(gen, socket, helpers, target?.signature)
    Thread({ receiveLoop(gen, socket) }, "SetRemoteUdp-rx").apply {
      isDaemon = true
      start()
    }
  }

  private fun closeSockets() {
    generation++
    session?.let { s ->
      s.socket.close() // débloque receive() : le thread de réception s'arrête
      s.helpers.forEach { it.close() }
    }
    session = null
    releaseMulticastLock()
  }

  private fun socketFailed(gen: Int) {
    if (session?.generation != gen || config == null) return
    config = null
    closeSockets()
    onError("socket-failed")
  }

  private fun receiveLoop(gen: Int, socket: MulticastSocket) {
    val buffer = ByteArray(2048)
    val packet = DatagramPacket(buffer, buffer.size)
    while (!socket.isClosed) {
      try {
        packet.length = buffer.size
        socket.receive(packet)
      } catch (e: IOException) {
        if (!socket.isClosed) post { socketFailed(gen) }
        return
      }
      val n = packet.length
      // Datagramme vide ou trop grand pour du DMX (sACN ≤ 638, Art-Net ≤ 530) : ignoré.
      if (n <= 0 || n > UdpLimits.MAX_DATAGRAM) continue
      val sender = packet.address as? Inet4Address ?: continue
      val src = sender.hostAddress ?: continue
      packets.push(ReceivedPacket(src, packet.port, Base64.encodeToString(buffer, packet.offset, n, Base64.NO_WRAP)))
    }
  }

  /** 239.255.(u >> 8).(u & 255), au plus GROUPS_PER_SOCKET groupes par socket. */
  private fun joinGroups(universes: List<Int>, main: MulticastSocket, helpers: MutableList<MulticastSocket>, target: Target?) {
    val nif = target?.let { networkInterfaceOf(it) }
    var failed = 0
    universes.chunked(UdpLimits.GROUPS_PER_SOCKET).forEachIndexed { index, chunk ->
      val s = if (index == 0) main else helperSocket(target)?.also { helpers.add(it) }
      if (s == null) {
        failed += chunk.size
        return@forEachIndexed
      }
      for (u in chunk) {
        val group = InetAddress.getByAddress(
          byteArrayOf(239.toByte(), 255.toByte(), ((u shr 8) and 0xff).toByte(), (u and 0xff).toByte())
        )
        try {
          s.joinGroup(InetSocketAddress(group, 0), nif)
        } catch (e: Exception) {
          failed++
        }
      }
    }
    if (failed > 0) onError("multicast-failed")
  }

  /** Socket auxiliaire : port éphémère, ne reçoit rien, porte seulement des adhésions. */
  private fun helperSocket(target: Target?): MulticastSocket? {
    val s = try {
      MulticastSocket(null as SocketAddress?)
    } catch (e: IOException) {
      return null
    }
    return try {
      bindToNetwork(s, target)
      s.bind(InetSocketAddress(0))
      s
    } catch (e: Exception) {
      s.close()
      null
    }
  }

  private fun bindToNetwork(socket: MulticastSocket, target: Target?) {
    if (target == null) return
    try {
      target.network.bindSocket(socket)
    } catch (e: Exception) {
      // réseau disparu entre-temps : le socket reste sur le réseau par défaut
    }
  }

  private fun networkInterfaceOf(target: Target): NetworkInterface? = try {
    target.interfaceName?.let { NetworkInterface.getByName(it) } ?: NetworkInterface.getByInetAddress(target.ipv4)
  } catch (e: Exception) {
    null
  }

  private fun acquireMulticastLock() {
    val w = wifi ?: return
    try {
      val lock = multicastLock ?: w.createMulticastLock("SetRemoteUdp").also {
        it.setReferenceCounted(false)
        multicastLock = it
      }
      if (!lock.isHeld) lock.acquire()
    } catch (e: RuntimeException) {
      // permission CHANGE_WIFI_MULTICAST_STATE absente : le Wi-Fi peut filtrer le multicast
    }
  }

  private fun releaseMulticastLock() {
    try {
      multicastLock?.let { if (it.isHeld) it.release() }
    } catch (e: RuntimeException) {
      // déjà relâché
    }
  }

  // ─────────────────────────────── réseau ───────────────────────────────

  private fun kindOf(caps: NetworkCapabilities): String = when {
    caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "other"
    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
    else -> "other"
  }

  @Suppress("DEPRECATION") // allNetworks : seul instantané de TOUS les réseaux, pas seulement celui par défaut
  private fun networks(): Array<Network> = try {
    connectivity?.allNetworks ?: emptyArray()
  } catch (e: RuntimeException) {
    emptyArray()
  }

  /** Ethernet s'il existe, sinon Wi-Fi ; avec une IPv4. */
  private fun chooseNetwork(): Target? {
    val cm = connectivity ?: return null
    var wifiTarget: Target? = null
    for (n in networks()) {
      val (caps, lp) = try {
        Pair(cm.getNetworkCapabilities(n) ?: continue, cm.getLinkProperties(n) ?: continue)
      } catch (e: RuntimeException) {
        continue
      }
      val kind = kindOf(caps)
      if (kind == "other") continue
      val v4 = lp.linkAddresses.map { it.address }.filterIsInstance<Inet4Address>().firstOrNull() ?: continue
      val t = Target(n, lp.interfaceName, v4, kind)
      if (kind == "ethernet") return t
      if (wifiTarget == null) wifiTarget = t
    }
    return wifiTarget
  }

  /** Interfaces IPv4 : LinkProperties de chaque réseau, type d'après NetworkCapabilities. */
  private fun interfaces(): List<Map<String, String>> {
    val cm = connectivity ?: return emptyList()
    val out = ArrayList<Map<String, String>>()
    val seen = HashSet<String>()
    for (n in networks()) {
      val (caps, lp) = try {
        Pair(cm.getNetworkCapabilities(n) ?: continue, cm.getLinkProperties(n) ?: continue)
      } catch (e: RuntimeException) {
        continue
      }
      val name = lp.interfaceName ?: continue
      val kind = kindOf(caps)
      for (la in lp.linkAddresses) {
        val a = la.address as? Inet4Address ?: continue
        if (a.isLoopbackAddress) continue
        val ip = a.hostAddress ?: continue
        if (!seen.add("$name/$ip")) continue
        out.add(mapOf("name" to name, "kind" to kind, "ip" to ip, "mask" to prefixToMask(la.prefixLength)))
      }
    }
    return out
  }

  private fun ensureMonitor() {
    if (networkCallback != null) return
    val cm = connectivity ?: return
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = schedulePublish()
      override fun onLost(network: Network) = schedulePublish()
      override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) = schedulePublish()
      override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) = schedulePublish()
    }
    try {
      // Wi-Fi ou Ethernet, avec ou sans Internet (réseau lumière isolé)
      val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .build()
      cm.registerNetworkCallback(request, cb)
      networkCallback = cb
    } catch (e: RuntimeException) {
      // SecurityException (ACCESS_NETWORK_STATE) ou trop de callbacks : net:info reste disponible sur demande
    }
  }

  /** Les callbacks arrivent en rafale : on attend NETWORK_DEBOUNCE_MS d'accalmie. */
  private fun schedulePublish() = post {
    pendingPublish?.cancel(false)
    pendingPublish = try {
      worker.schedule(Runnable { networkChanged() }, UdpLimits.NETWORK_DEBOUNCE_MS, TimeUnit.MILLISECONDS)
    } catch (e: RejectedExecutionException) {
      null
    }
  }

  private fun networkChanged() {
    publish(force = false)
    // Réseau choisi différent (Ethernet branché, Wi-Fi perdu…) : on rouvre les
    // sockets pour les rattacher au bon réseau et rejoindre les groupes dessus.
    val s = session ?: return
    if (config != null && !suspended && chooseNetwork()?.signature != s.networkSignature) openSockets()
  }

  private fun publish(force: Boolean) {
    val list = interfaces()
    val signature = list.joinToString(";") { "${it["name"]}|${it["kind"]}|${it["ip"]}|${it["mask"]}" }
    val first = lastSignature == null // premier relevé (callbacks initiaux) : état initial, pas un changement
    if (!force && (first || signature == lastSignature)) {
      lastSignature = signature
      return
    }
    lastSignature = signature
    onNetworkChange(list)
  }

  companion object {
    /** IPv4 littérale a.b.c.d uniquement : jamais de résolution DNS. */
    internal fun parseIPv4(s: String): InetAddress? {
      val parts = s.split('.')
      if (parts.size != 4) return null
      val bytes = ByteArray(4)
      for (i in 0..3) {
        val p = parts[i]
        if (p.isEmpty() || p.length > 3 || !p.all { it in '0'..'9' }) return null
        val v = p.toInt()
        if (v > 255) return null
        bytes[i] = v.toByte()
      }
      if (bytes.all { it == 0.toByte() }) return null
      return InetAddress.getByAddress(bytes)
    }

    internal fun prefixToMask(prefix: Int): String {
      val p = prefix.coerceIn(0, 32)
      val m = if (p == 0) 0L else (0xffffffffL shl (32 - p)) and 0xffffffffL
      return "${(m shr 24) and 0xff}.${(m shr 16) and 0xff}.${(m shr 8) and 0xff}.${m and 0xff}"
    }
  }
}
