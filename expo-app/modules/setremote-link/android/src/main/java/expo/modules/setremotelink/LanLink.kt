package expo.modules.setremotelink

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ScheduledFuture

// ════════════════════════════════════════════════════════════════════════════
// Liaison Wi-Fi local (Android) : TCP + NSD (Bonjour / mDNS).
//
//   • Télécommande : ServerSocket sur un port éphémère, toutes interfaces ;
//     service « _setremote._tcp » publié par NsdManager avec le TXT
//     r=<roomTag hex> et v=1 (jamais le topic).
//   • Écran : NsdManager cherche le service, résout les candidats un par un
//     (une seule résolution à la fois avant l'API 34), ne garde que ceux dont
//     le TXT r correspond, et se connecte à l'un d'eux. Le socket client est
//     attaché au réseau Wi-Fi / Ethernet par Network.bindSocket() : sinon, un
//     Wi-Fi SANS Internet n'étant pas le réseau par défaut quand les données
//     mobiles sont actives, la connexion partirait sur le cellulaire.
//     (Pas bindProcessToNetwork(), qui détournerait aussi la vue web.)
//   • Par connexion : un fil de lecture (enregistrements [u32 BE][message],
//     longueur vérifiée avant toute allocation) et un fil d'écriture (file de
//     contrôle prioritaire + file de données bornée qui jette les plus
//     anciennes ; PING après 5 s de silence ; pair mort après 15 s sans rien).
//   • Appareils étrangers : 8 connexions non admises à la fois, 5 s et 256
//     octets pour réussir la poignée de main, 64 pairs admis au plus.
// Toute la gestion d'état se fait sur le worker du LinkManager.
// ════════════════════════════════════════════════════════════════════════════

internal class LanLink(private val manager: LinkManager, context: Context) : LinkTransport {
  override val mode = LinkMode.LAN
  override var config: LinkConfig? = null
    private set

  private val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
  private val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

  private var generation = 0
  private var lastError: String? = null
  private var retryTask: ScheduledFuture<*>? = null
  private val connections = LinkedHashSet<LanConnection>()
  private var tooManyReported = false

  // Télécommande
  private var server: ServerSocket? = null
  private var registration: NsdManager.RegistrationListener? = null
  private var registered = false

  // Écran
  private class Candidate(val name: String, val host: InetAddress, val port: Int) {
    var failures = 0
    var retryAt = 0L
  }

  private var discovery: NsdManager.DiscoveryListener? = null
  private var discovering = false
  private val candidates = LinkedHashMap<String, Candidate>()
  private val resolveQueue = ArrayDeque<NsdServiceInfo>()
  private var resolveToken = 0
  private var resolving = false
  private var connecting = false
  private var connectTask: ScheduledFuture<*>? = null

  // Réseau
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var networkTask: ScheduledFuture<*>? = null
  private var networkAvailable = false

  // ─────────────────────────── cycle de vie (worker) ───────────────────────────

  override fun start(config: LinkConfig) {
    if (this.config != null) return
    this.config = config
    lastError = null
    tooManyReported = false
    ensureNetworkMonitor()
    networkAvailable = chooseNetwork() != null
    bringUp()
    manager.refreshState()
  }

  override fun stop() {
    if (config == null) return
    config = null
    tearDown()
    networkCallback?.let { cb ->
      try {
        connectivity?.unregisterNetworkCallback(cb)
      } catch (e: RuntimeException) {
        // déjà désinscrit
      }
    }
    networkCallback = null
    networkTask?.cancel(false)
    lastError = null
    manager.refreshState()
  }

  override fun state(): ModeState {
    val c = config
    val active = c != null && if (c.role == LinkRole.REMOTE) server != null && registered else discovering
    val error = lastError ?: if (c != null && !networkAvailable) "no-network" else null
    return ModeState(networkAvailable || chooseNetwork() != null, active, error)
  }

  private fun bringUp() {
    val c = config ?: return
    generation++
    if (c.role == LinkRole.REMOTE) startServer(c) else startDiscovery()
  }

  /** Ferme tout sauf la configuration (arrêt, échec avant nouvel essai, changement de réseau). */
  private fun tearDown() {
    generation++
    retryTask?.cancel(false)
    retryTask = null
    connectTask?.cancel(false)
    connectTask = null
    registration?.let { l ->
      try {
        nsd?.unregisterService(l)
      } catch (e: RuntimeException) {
        // jamais enregistré ou déjà retiré
      }
    }
    registration = null
    registered = false
    try {
      server?.close()
    } catch (e: IOException) {
      // déjà fermé
    }
    server = null
    discovery?.let { l ->
      try {
        nsd?.stopServiceDiscovery(l)
      } catch (e: RuntimeException) {
        // recherche jamais démarrée
      }
    }
    discovery = null
    discovering = false
    candidates.clear()
    resolveQueue.clear()
    resolving = false
    connecting = false
    for (c in connections.toList()) {
      c.close()
      manager.remove(c)
    }
    connections.clear()
  }

  /** Erreur bloquante : publiée, tout est fermé, nouvel essai dans 10 s si la page le veut toujours. */
  private fun fail(reason: String) {
    manager.error(mode, reason)
    tearDown()
    lastError = reason
    manager.refreshState()
    val gen = generation
    retryTask = manager.schedule(RETRY_MS) {
      if (gen == generation && config != null) {
        lastError = null
        bringUp()
        manager.refreshState()
      }
    }
  }

  // ─────────────────────────── télécommande ───────────────────────────

  private fun startServer(c: LinkConfig) {
    val gen = generation
    val ss = try {
      ServerSocket().apply {
        reuseAddress = true
        bind(InetSocketAddress(0), 16) // toutes interfaces (Wi-Fi, Ethernet, point d'accès), port éphémère
      }
    } catch (e: IOException) {
      return fail("listen-failed")
    }
    server = ss
    Thread({ acceptLoop(gen, ss) }, "SetRemoteLink-accept").apply {
      isDaemon = true
      start()
    }
    register(c, ss.localPort, gen)
  }

  private fun acceptLoop(gen: Int, ss: ServerSocket) {
    while (!ss.isClosed) {
      val s = try {
        ss.accept()
      } catch (e: IOException) {
        if (!ss.isClosed) manager.post { if (gen == generation && config != null) fail("listen-failed") }
        return
      }
      manager.post { onAccepted(gen, s) }
    }
  }

  private fun onAccepted(gen: Int, s: Socket) {
    val c = config
    if (gen != generation || c == null) return closeQuietly(s)
    val pending = connections.count { !it.admitted }
    val admitted = connections.size - pending
    if (pending >= LinkLimits.MAX_LAN_PENDING) return closeQuietly(s) // déluge de connexions non authentifiées
    if (admitted >= LinkLimits.MAX_LAN_PEERS) {
      if (!tooManyReported) {
        tooManyReported = true
        manager.error(mode, "too-many-peers")
      }
      return closeQuietly(s)
    }
    open(s, c, gen, null)
  }

  private fun register(c: LinkConfig, port: Int, gen: Int) {
    val n = nsd ?: return fail("advertise-failed")
    val info = NsdServiceInfo().apply {
      // Nom d'instance aléatoire : ne révèle ni le topic ni le nom de l'appareil
      serviceName = "SetRemote-" + LinkWire.hex(LinkWire.randomBytes(3))
      serviceType = LinkWire.SERVICE_TYPE
      this.port = port
      setAttribute(LinkWire.TXT_ROOM, c.roomTagHex)
      setAttribute(LinkWire.TXT_VERSION, LinkWire.VERSION.toString())
    }
    val listener = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(serviceInfo: NsdServiceInfo) = manager.post {
        if (gen != generation) return@post
        registered = true
        lastError = null
        manager.refreshState()
      }

      override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = manager.post {
        if (gen != generation) return@post
        registration = null
        fail("advertise-failed")
      }

      override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {}
      override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
    }
    registration = listener
    try {
      n.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (e: RuntimeException) {
      registration = null
      fail("advertise-failed")
    }
  }

  // ─────────────────────────── écran ───────────────────────────

  private fun startDiscovery() {
    val n = nsd ?: return fail("browse-failed")
    val gen = generation
    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(serviceType: String) = manager.post {
        if (gen != generation) return@post
        discovering = true
        lastError = null
        manager.refreshState()
      }

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = manager.post {
        if (gen != generation) return@post
        discovery = null
        fail("browse-failed")
      }

      override fun onDiscoveryStopped(serviceType: String) {}
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}

      override fun onServiceFound(serviceInfo: NsdServiceInfo) = manager.post {
        if (gen == generation) enqueueResolve(serviceInfo)
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo) = manager.post {
        if (gen == generation) candidates.remove(serviceInfo.serviceName)
      }
    }
    discovery = listener
    try {
      n.discoverServices(LinkWire.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (e: RuntimeException) {
      discovery = null
      fail("browse-failed")
    }
  }

  private fun enqueueResolve(info: NsdServiceInfo) {
    val name = info.serviceName ?: return
    if (candidates.containsKey(name) || resolveQueue.any { it.serviceName == name }) return
    if (resolveQueue.size >= 32) return // annonces en rafale (réseau hostile) : bornées
    resolveQueue.addLast(info)
    resolveNext()
  }

  @Suppress("DEPRECATION") // resolveService : seule API avant l'API 34, toujours fonctionnelle après
  private fun resolveNext() {
    val n = nsd ?: return
    if (resolving) return
    val info = resolveQueue.removeFirstOrNull() ?: return
    resolving = true
    val gen = generation
    val token = ++resolveToken
    // Certaines versions ne rappellent jamais : on passe au suivant après 5 s.
    val guard = manager.schedule(RESOLVE_TIMEOUT_MS) {
      if (gen == generation && token == resolveToken && resolving) {
        resolving = false
        resolveNext()
      }
    }
    val listener = object : NsdManager.ResolveListener {
      override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = manager.post {
        if (gen != generation || token != resolveToken) return@post
        guard?.cancel(false)
        resolving = false
        resolveNext()
      }

      override fun onServiceResolved(serviceInfo: NsdServiceInfo) = manager.post {
        if (gen != generation || token != resolveToken) return@post
        guard?.cancel(false)
        resolving = false
        onResolved(serviceInfo)
        resolveNext()
      }
    }
    try {
      n.resolveService(info, listener)
    } catch (e: RuntimeException) {
      guard?.cancel(false)
      resolving = false
    }
  }

  @Suppress("DEPRECATION") // NsdServiceInfo.host : hostAddresses n'existe qu'à partir de l'API 34
  private fun onResolved(info: NsdServiceInfo) {
    val c = config ?: return
    val attrs = info.attributes ?: return
    val room = attrs[LinkWire.TXT_ROOM]?.let { String(it, Charsets.UTF_8) }
    val version = attrs[LinkWire.TXT_VERSION]?.let { String(it, Charsets.UTF_8) }
    if (room != c.roomTagHex || version != LinkWire.VERSION.toString()) return // autre plateau ou autre version
    val host: InetAddress = if (Build.VERSION.SDK_INT >= 34) {
      info.hostAddresses.firstOrNull { it is Inet4Address } ?: info.hostAddresses.firstOrNull()
    } else {
      info.host
    } ?: return
    if (info.port !in 1..65535) return
    val name = info.serviceName ?: return
    candidates[name] = Candidate(name, host, info.port)
    connectNext()
  }

  private fun connectNext() {
    val c = config ?: return
    if (c.role != LinkRole.SCREEN || connecting || connections.isNotEmpty()) return
    connectTask?.cancel(false)
    connectTask = null
    val now = System.currentTimeMillis()
    val candidate = candidates.values.filter { it.retryAt <= now }.minByOrNull { it.failures }
    if (candidate == null) {
      val next = candidates.values.minOfOrNull { it.retryAt } ?: return // attend une découverte
      connectTask = manager.schedule(maxOf(50L, next - now)) { connectNext() }
      return
    }
    connecting = true
    val gen = generation
    val network = chooseNetwork()?.network
    Thread({
      val s = Socket()
      try {
        network?.bindSocket(s)
        s.tcpNoDelay = true
        s.connect(InetSocketAddress(candidate.host, candidate.port), CONNECT_TIMEOUT_MS)
        manager.post { onConnected(gen, candidate, s) }
      } catch (e: Exception) {
        closeQuietly(s)
        manager.post { onConnectFailed(gen, candidate) }
      }
    }, "SetRemoteLink-connect").apply {
      isDaemon = true
      start()
    }
  }

  private fun onConnected(gen: Int, candidate: Candidate, s: Socket) {
    connecting = false
    val c = config
    if (gen != generation || c == null) return closeQuietly(s)
    open(s, c, gen, candidate.name)
  }

  private fun onConnectFailed(gen: Int, candidate: Candidate) {
    if (gen != generation) return
    connecting = false
    candidate.failures++
    // Après 4 échecs (service fantôme : télécommande tuée sans retrait de
    // l'annonce, ou coupure passagère), un essai toutes les 30 s seulement. Le
    // candidat n'est pas oublié : NSD ne le reproposerait pas tant que son
    // annonce reste en cache. Une télécommande relancée s'annonce sous un
    // nouveau nom, essayé en premier (0 échec).
    candidate.retryAt = System.currentTimeMillis() + if (candidate.failures >= 4) STALE_BACKOFF_MS else backoff(candidate.failures)
    connectNext()
  }

  // ─────────────────────────── connexions ───────────────────────────

  private fun open(s: Socket, c: LinkConfig, gen: Int, candidate: String?) {
    val conn = LanConnection(manager, this, s, c, gen, candidate)
    connections.add(conn)
    conn.start()
  }

  /** Worker : la poignée de main a réussi. */
  fun onAdmitted(conn: LanConnection) {
    if (conn.generation != generation || conn !in connections) return conn.close()
    if (!manager.admit(conn, LinkLimits.MAX_LAN_PEERS)) return conn.close()
    conn.registered = true
    conn.candidate?.let { candidates[it]?.failures = 0 }
  }

  /** Worker : la connexion est fermée (par le pair, une erreur, un délai ou nous). */
  fun onClosed(conn: LanConnection) {
    if (!connections.remove(conn)) return
    manager.remove(conn)
    if (connections.count { it.admitted } < LinkLimits.MAX_LAN_PEERS) tooManyReported = false
    val c = config ?: return
    if (c.role != LinkRole.SCREEN || conn.generation != generation) return
    val cand = conn.candidate?.let { candidates[it] }
    if (cand != null) {
      if (!conn.admitted) {
        // Poignée de main ratée : télécommande d'une autre version, ou appareil
        // qui imite l'annonce sans connaître le topic.
        cand.failures++
        cand.retryAt = System.currentTimeMillis() + if (conn.authFailed) AUTH_BACKOFF_MS else backoff(cand.failures)
      } else {
        cand.retryAt = System.currentTimeMillis() + RECONNECT_MS
      }
    }
    connectTask = manager.schedule(RECONNECT_MS) { connectNext() }
  }

  // ─────────────────────────────── réseau ───────────────────────────────

  class Target(val network: Network, val ipv4: Inet4Address)

  @Suppress("DEPRECATION") // allNetworks : seul instantané de TOUS les réseaux
  private fun chooseNetwork(): Target? {
    val cm = connectivity ?: return null
    var wifi: Target? = null
    val all = try {
      cm.allNetworks
    } catch (e: RuntimeException) {
      return null
    }
    for (n in all) {
      val caps: NetworkCapabilities
      val lp: LinkProperties
      try {
        caps = cm.getNetworkCapabilities(n) ?: continue
        lp = cm.getLinkProperties(n) ?: continue
      } catch (e: RuntimeException) {
        continue
      }
      if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
      val v4 = lp.linkAddresses.map { it.address }.filterIsInstance<Inet4Address>().firstOrNull() ?: continue
      if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return Target(n, v4)
      if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && wifi == null) wifi = Target(n, v4)
    }
    return wifi
  }

  private fun ensureNetworkMonitor() {
    if (networkCallback != null) return
    val cm = connectivity ?: return
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = scheduleNetworkCheck()
      override fun onLost(network: Network) = scheduleNetworkCheck()
      override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) = scheduleNetworkCheck()
    }
    try {
      // Wi-Fi ou Ethernet, avec ou sans Internet (routeur de voyage isolé)
      val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .build()
      cm.registerNetworkCallback(request, cb)
      networkCallback = cb
    } catch (e: RuntimeException) {
      // pas de suivi : l'état est recalculé à chaque démarrage
    }
  }

  /** Les rappels arrivent en rafale : on attend 500 ms d'accalmie. */
  private fun scheduleNetworkCheck() = manager.post {
    networkTask?.cancel(false)
    networkTask = manager.schedule(NETWORK_DEBOUNCE_MS) { networkChanged() }
  }

  private fun networkChanged() {
    val c = config ?: return
    val before = networkAvailable
    networkAvailable = chooseNetwork() != null
    val idleScreen = c.role == LinkRole.SCREEN && connections.isEmpty()
    if (networkAvailable && (!before || lastError != null || idleScreen)) {
      // Réseau (re)venu, ou écran sans télécommande : on republie / relance la
      // recherche sur le réseau actuel. Ailleurs, les connexions établies
      // survivent ; si leur réseau a disparu, leur lecture échoue (au plus
      // 15 s sans rien) et elles se ferment seules.
      tearDown()
      lastError = null
      bringUp()
    }
    manager.refreshState()
  }

  companion object {
    const val RETRY_MS = 10000L
    const val RESOLVE_TIMEOUT_MS = 5000L
    const val CONNECT_TIMEOUT_MS = 4000
    const val RECONNECT_MS = 500L
    const val AUTH_BACKOFF_MS = 30000L
    const val STALE_BACKOFF_MS = 30000L
    const val NETWORK_DEBOUNCE_MS = 500L

    fun backoff(failures: Int): Long = minOf(5000L, 500L shl minOf(failures - 1, 4).coerceAtLeast(0))

    fun closeQuietly(s: Socket) {
      try {
        s.close()
      } catch (e: IOException) {
        // déjà fermé
      }
    }
  }
}

/**
 * Une connexion TCP (un pair), dans les deux rôles. Fil de lecture : poignée
 * de main puis trames ; fil d'écriture : file de contrôle prioritaire, puis
 * file de données bornée (LAN_PEER_BACKLOG, les plus anciennes jetées).
 */
internal class LanConnection(
  private val manager: LinkManager,
  private val link: LanLink,
  private val socket: Socket,
  config: LinkConfig,
  val generation: Int,
  /** Écran : nom du service Bonjour visé ; télécommande : null. */
  val candidate: String?,
) : LinkPeer {
  override val id: String = LinkWire.newPeerId(LinkMode.LAN.prefix)
  override val mode = LinkMode.LAN

  @Volatile
  override var name: String = ""
    private set

  /** Poignée de main réussie (reste vrai après la fermeture). */
  @Volatile
  var admitted = false
    private set

  @Volatile
  var authFailed = false
    private set

  /** Inscrit au registre du coordinateur (worker). */
  var registered = false

  private val handshake = config.newHandshake()
  private val lock = Object()
  private val control = ArrayDeque<ByteArray>()
  private val data = ArrayDeque<ByteArray>()
  private var dataBytes = 0
  private var congested = false
  private var closed = false

  /** Worker. */
  fun start() {
    try {
      socket.tcpNoDelay = true
      socket.soTimeout = LinkLimits.HANDSHAKE_TIMEOUT_MS.toInt()
    } catch (e: IOException) {
      return close()
    }
    enqueueControl(handshake.hello()) // avant le démarrage des fils : pas de partage
    Thread({ readLoop() }, "SetRemoteLink-rx").apply {
      isDaemon = true
      start()
    }
    Thread({ writeLoop() }, "SetRemoteLink-tx").apply {
      isDaemon = true
      start()
    }
    // 5 s pour réussir la poignée de main, quel que soit le débit (lecture au compte-gouttes)
    manager.schedule(LinkLimits.HANDSHAKE_TIMEOUT_MS) { if (!admitted) close() }
  }

  private fun readLoop() {
    try {
      val input = DataInputStream(BufferedInputStream(socket.getInputStream(), 16 * 1024))
      var preauth = 0
      while (true) {
        val len = input.readInt()
        val max = if (admitted) LinkLimits.LAN_MAX_MESSAGE else LinkLimits.PREAUTH_MAX_MESSAGE
        if (len <= 0 || len > max) break // vérifié AVANT d'allouer
        if (!admitted) {
          preauth += LinkLimits.LAN_HEADER_BYTES + len
          if (preauth > LinkLimits.PREAUTH_MAX_BYTES) break
        }
        val message = ByteArray(len)
        input.readFully(message)
        val ev = handshake.receive(message)
        if (ev.error != null) {
          authFailed = ev.error == "auth"
          break
        }
        for (m in ev.send) enqueueControl(m)
        ev.admittedName?.let { peerName ->
          name = peerName
          admitted = true
          socket.soTimeout = LinkLimits.DEAD_AFTER_MS
          manager.post { link.onAdmitted(this) }
        }
        ev.data?.let { manager.receive(id, mode, it, len - 1) }
      }
    } catch (e: Exception) {
      // fin de flux, délai dépassé, socket fermé
    }
    close()
  }

  private fun writeLoop() {
    try {
      val out = BufferedOutputStream(socket.getOutputStream(), 16 * 1024)
      val ping = LinkWire.lanRecord(LinkWire.PING)
      while (true) {
        var record: ByteArray?
        var more: Boolean
        synchronized(lock) {
          if (control.isEmpty() && data.isEmpty() && !closed) lock.wait(LinkLimits.KEEPALIVE_MS)
          if (closed) return
          record = control.removeFirstOrNull() ?: data.removeFirstOrNull()?.also {
            dataBytes -= it.size
            if (dataBytes <= LinkLimits.LAN_PEER_BACKLOG / 2) congested = false
          }
          more = control.isNotEmpty() || data.isNotEmpty()
        }
        val r = record ?: if (admitted) ping else continue // PING après 5 s de silence
        out.write(r)
        if (!more) out.flush()
      }
    } catch (e: Exception) {
      // pair parti
    }
    close()
  }

  private fun enqueueControl(message: ByteArray) {
    synchronized(lock) {
      if (closed) return
      control.addLast(LinkWire.lanRecord(message))
      lock.notifyAll()
    }
  }

  override fun enqueueData(messages: List<ByteArray>) {
    var report = false
    synchronized(lock) {
      if (closed) return
      for (m in messages) {
        val r = LinkWire.lanRecord(m)
        data.addLast(r)
        dataBytes += r.size
      }
      // Pair lent (Wi-Fi saturé, appareil en veille) : on jette les plus anciennes
      while (dataBytes > LinkLimits.LAN_PEER_BACKLOG && data.size > 1) {
        dataBytes -= data.removeFirst().size
        if (!congested) {
          congested = true
          report = true
        }
      }
      lock.notifyAll()
    }
    if (report) manager.error(mode, "congested")
  }

  override fun close() {
    synchronized(lock) {
      if (closed) return
      closed = true
      control.clear()
      data.clear()
      dataBytes = 0
      lock.notifyAll()
    }
    LanLink.closeQuietly(socket)
    manager.post { link.onClosed(this) }
  }
}
