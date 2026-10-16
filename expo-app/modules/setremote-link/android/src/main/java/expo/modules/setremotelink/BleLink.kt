package expo.modules.setremotelink

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanRecord
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.ParcelUuid
import android.os.SystemClock
import android.provider.Settings
import java.util.concurrent.ScheduledFuture

// ════════════════════════════════════════════════════════════════════════════
// Liaison Bluetooth LE (Android).
//
//   • Écran = PÉRIPHÉRIQUE : BluetoothGattServer avec le service SetRemote
//     (RX : write / write without response, télécommande → écran ; TX :
//     notify, écran → télécommande) ; BluetoothLeAdvertiser annonce l'UUID du
//     service et, en réponse au scan, les données de service [1][roomTag]
//     (Android ne permet pas de choisir le nom local sans renommer l'appareil).
//   • Télécommande = CENTRAL : BluetoothLeScanner filtré sur l'UUID, garde les
//     annonces dont les données de service OU le nom local (« SR » + roomTag,
//     écrans iOS) correspondent, se connecte (8 écrans au plus, 4 connexions
//     en cours), MTU 517 demandé, priorité de connexion haute, abonnement à TX.
//   • Messages découpés selon le MTU ([id][index][count] + morceau) ; écriture
//     sans réponse et notifications au rythme des rappels (une opération en
//     vol par pair) ; file de données bornée (BLE_PEER_BACKLOG) par pair.
//   • PING toutes les 5 s de silence, pair mort après 15 s sans rien : un
//     périphérique iOS ne peut pas couper un central, et une liaison peut
//     survivre à l'arrêt du serveur GATT d'en face.
//   • Autorisations demandées au démarrage du Bluetooth seulement (API 31+ :
//     SCAN + CONNECT ou ADVERTISE + CONNECT ; API ≤ 30, télécommande :
//     localisation). Premier plan uniquement (le coordinateur arrête tout
//     quand l'activité passe en arrière-plan).
// Toute la gestion d'état se fait sur le worker du LinkManager.
// ════════════════════════════════════════════════════════════════════════════

@SuppressLint("MissingPermission") // vérifiées par granted() avant tout appel ; SecurityException rattrapées
internal class BleLink(private val manager: LinkManager, private val context: Context) : LinkTransport {
  override val mode = LinkMode.BLE
  override var config: LinkConfig? = null
    private set

  private val btManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
  private val adapter: BluetoothAdapter? get() = btManager?.adapter
  private val hasBle = context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)

  private var generation = 0
  private var lastError: String? = null
  private var retryTask: ScheduledFuture<*>? = null
  private var ticker: ScheduledFuture<*>? = null
  private var stateReceiver: BroadcastReceiver? = null

  // Autorisations : survivent à stop(), car la boîte de dialogue met l'activité en pause.
  private var permissionInFlight = false
  private var permissionDenied = false

  // Central (télécommande)
  private var scanner: BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null
  private var scanning = false
  private val links = LinkedHashMap<String, CentralLink>()
  private val backoffUntil = HashMap<String, Long>()
  private var tooManyReported = false

  // Périphérique (écran)
  private var gattServer: BluetoothGattServer? = null
  private var txCharacteristic: BluetoothGattCharacteristic? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var advertising = false
  private val sessions = LinkedHashMap<String, PeripheralSession>()
  private val mtus = HashMap<String, Int>()

  // ─────────────────────────── cycle de vie (worker) ───────────────────────────

  override fun start(config: LinkConfig) {
    if (this.config != null) return
    this.config = config
    lastError = null
    tooManyReported = false
    registerStateReceiver()
    bringUp()
    manager.refreshState()
  }

  override fun stop() {
    if (config == null) return
    config = null
    tearDown()
    stateReceiver?.let { r ->
      try {
        context.unregisterReceiver(r)
      } catch (e: RuntimeException) {
        // déjà désinscrit
      }
    }
    stateReceiver = null
    lastError = null
    manager.refreshState()
  }

  override fun onExplicitStart() {
    permissionDenied = false // la page redemande : on peut reposer la question
  }

  override fun state(): ModeState {
    val a = adapter
    val enabled = isEnabled(a)
    val available = hasBle && a != null && enabled && !permissionDenied
    val active = config != null && (scanning || advertising)
    val error = lastError ?: when {
      config == null -> null
      !hasBle || a == null -> "unsupported"
      !enabled -> "powered-off"
      else -> null
    }
    return ModeState(available, active, error)
  }

  private fun isEnabled(a: BluetoothAdapter?): Boolean = try {
    a?.isEnabled == true
  } catch (e: RuntimeException) {
    false
  }

  private fun requiredPermissions(role: LinkRole): Array<String> = when {
    Build.VERSION.SDK_INT >= 31 && role == LinkRole.REMOTE ->
      arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    Build.VERSION.SDK_INT >= 31 ->
      arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
    role == LinkRole.REMOTE -> arrayOf(Manifest.permission.ACCESS_FINE_LOCATION) // scan jusqu'à Android 11
    else -> emptyArray()
  }

  private fun granted(perms: Array<String>): Boolean =
    perms.all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

  private fun bringUp() {
    val c = config ?: return
    generation++
    val a = adapter
    if (!hasBle || a == null) return fail("unsupported", retry = false)
    val perms = requiredPermissions(c.role)
    if (!granted(perms)) {
      if (permissionDenied) return fail("unauthorized", retry = false)
      if (permissionInFlight) return
      permissionInFlight = true
      manager.requestPermissions(perms) { ok ->
        manager.post {
          permissionInFlight = false
          if (!ok) permissionDenied = true
          if (config == null) return@post // arrêtée ou en veille : resume() relancera
          if (ok) bringUp() else fail("unauthorized", retry = false)
        }
      }
      return
    }
    if (!isEnabled(a)) {
      // Le récepteur ACTION_STATE_CHANGED relancera quand le Bluetooth sera rallumé.
      if (lastError != "powered-off") manager.error(mode, "powered-off")
      lastError = "powered-off"
      manager.refreshState()
      return
    }
    lastError = null
    if (c.role == LinkRole.REMOTE) startCentral(a, c) else startPeripheral(a, c)
    if (config != null && lastError == null) startTicker()
    manager.refreshState()
  }

  private fun tearDown() {
    generation++
    retryTask?.cancel(false)
    retryTask = null
    ticker?.cancel(false)
    ticker = null
    scanCallback?.let { cb ->
      try {
        scanner?.stopScan(cb)
      } catch (e: RuntimeException) {
        // Bluetooth éteint entre-temps
      }
    }
    scanCallback = null
    scanner = null
    scanning = false
    for (l in links.values.toList()) {
      l.shutdown()
      manager.remove(l)
    }
    links.clear()
    advertiseCallback?.let { cb ->
      try {
        advertiser?.stopAdvertising(cb)
      } catch (e: RuntimeException) {
        // idem
      }
    }
    advertiseCallback = null
    advertiser = null
    advertising = false
    for (s in sessions.values.toList()) {
      s.shutdown()
      manager.remove(s)
    }
    sessions.clear()
    mtus.clear()
    try {
      gattServer?.close()
    } catch (e: RuntimeException) {
      // idem
    }
    gattServer = null
    txCharacteristic = null
  }

  private fun fail(reason: String, retry: Boolean) {
    manager.error(mode, reason)
    tearDown()
    lastError = reason
    manager.refreshState()
    if (!retry) return
    val gen = generation
    retryTask = manager.schedule(RETRY_MS) {
      if (gen == generation && config != null) {
        lastError = null
        bringUp()
      }
    }
  }

  private fun registerStateReceiver() {
    if (stateReceiver != null) return
    val r = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        val s = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
        manager.post { onAdapterState(s) }
      }
    }
    val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
    try {
      // Diffusion système : reçue même non exportée.
      if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
      else context.registerReceiver(r, filter)
      stateReceiver = r
    } catch (e: RuntimeException) {
      // sans suivi : l'état est relu au prochain démarrage
    }
  }

  private fun onAdapterState(s: Int) {
    if (config == null) return
    when (s) {
      BluetoothAdapter.STATE_TURNING_OFF, BluetoothAdapter.STATE_OFF -> {
        if (lastError == "powered-off") return
        tearDown()
        lastError = "powered-off"
        manager.error(mode, "powered-off")
        manager.refreshState()
      }
      BluetoothAdapter.STATE_ON -> {
        if (scanning || advertising || gattServer != null) return
        lastError = null
        bringUp()
      }
    }
  }

  private fun now(): Long = SystemClock.elapsedRealtime()

  /** Toutes les 2,5 s : PING, pairs muets, fragments périmés, opérations sans rappel. */
  private fun startTicker() {
    ticker?.cancel(false)
    val gen = generation
    ticker = manager.schedule(TICK_MS) {
      if (gen != generation || config == null) return@schedule
      val t = now()
      for (l in links.values.toList()) l.tick(t)
      for (s in sessions.values.toList()) s.tick(t)
      startTicker()
    }
  }

  // ─────────────────────────── commun aux deux rôles ───────────────────────────

  /** Un pair Bluetooth : poignée de main, réassemblage, file d'envoi fragmentée. */
  private abstract inner class Session(config: LinkConfig) : LinkPeer {
    override val id: String = LinkWire.newPeerId(LinkMode.BLE.prefix)
    override val mode = LinkMode.BLE
    override var name: String = ""
    val handshake = config.newHandshake()
    val reassembler = Reassembler(LinkLimits.PREAUTH_MAX_MESSAGE)
    private val control = ArrayDeque<ByteArray>()
    private val data = ArrayDeque<ByteArray>()
    private var dataBytes = 0
    private val fragments = ArrayDeque<ByteArray>()
    private var frameId = 0
    /** Taille maximale d'une valeur ATT : MTU − 3 (20 tant que le MTU n'est pas négocié), ≤ 512. */
    var maxValue = 20
    private var inFlight = false
    private var inFlightSince = 0L
    private var retryPump: ScheduledFuture<*>? = null
    var registered = false
    var closed = false
    private var congested = false
    private var lastReceived = now()
    private var lastSent = now()
    var setupTimer: ScheduledFuture<*>? = null

    /** Lance une écriture (central) ou une notification (périphérique) ; faux si la pile est occupée. */
    abstract fun writeNow(value: ByteArray): Boolean

    abstract fun onAdmitted()

    /** Violation, délai ou pair muet : fermer. */
    abstract fun drop(reason: String)

    override fun close() = drop("closed")

    fun sendMessage(m: ByteArray) {
      if (closed) return
      control.addLast(m)
      pump()
    }

    override fun enqueueData(messages: List<ByteArray>) {
      if (closed) return
      for (m in messages) {
        data.addLast(m)
        dataBytes += m.size
      }
      var dropped = false
      while (dataBytes > LinkLimits.BLE_PEER_BACKLOG && data.size > 1) {
        dataBytes -= data.removeFirst().size
        dropped = true
      }
      if (dropped && !congested) {
        congested = true
        manager.error(mode, "congested")
      }
      pump()
    }

    fun pump() {
      if (closed || inFlight) return
      if (fragments.isEmpty()) {
        val next = control.removeFirstOrNull() ?: data.removeFirstOrNull()?.also {
          dataBytes -= it.size
          if (dataBytes <= LinkLimits.BLE_PEER_BACKLOG / 2) congested = false
        } ?: return
        // Découpé au dernier moment : le MTU a pu changer depuis la mise en file.
        fragments.addAll(LinkWire.fragment(next, frameId, maxValue))
        frameId = (frameId + 1) and 0xff
      }
      if (writeNow(fragments.first())) {
        fragments.removeFirst()
        inFlight = true
        inFlightSince = now()
        lastSent = inFlightSince
      } else if (retryPump == null) {
        retryPump = manager.schedule(BUSY_RETRY_MS) {
          retryPump = null
          pump()
        }
      }
    }

    fun onWriteDone() {
      inFlight = false
      pump()
    }

    fun onValue(value: ByteArray) {
      if (closed) return
      val t = now()
      lastReceived = t
      val r = reassembler.push(value, t)
      val m = r.message ?: return // fragment invalide ou message incomplet : ignoré
      val ev = handshake.receive(m)
      if (ev.error != null) return drop(ev.error)
      for (s in ev.send) sendMessage(s)
      ev.admittedName?.let {
        name = it
        reassembler.maxMessage = LinkLimits.BLE_MAX_MESSAGE
        setupTimer?.cancel(false)
        onAdmitted()
      }
      ev.data?.let { manager.receive(id, mode, it, m.size - 1) }
    }

    fun tick(t: Long) {
      if (closed) return
      if (inFlight && t - inFlightSince > LOST_CALLBACK_MS) onWriteDone() // rappel perdu (pile Bluetooth)
      reassembler.sweep(t)
      if (!handshake.admitted) return
      if (t - lastReceived > LinkLimits.DEAD_AFTER_MS) return drop("timeout")
      if (t - lastSent > LinkLimits.KEEPALIVE_MS && control.isEmpty() && data.isEmpty() && fragments.isEmpty()) {
        sendMessage(LinkWire.PING)
      }
    }

    open fun shutdown() {
      closed = true
      setupTimer?.cancel(false)
      retryPump?.cancel(false)
      control.clear()
      data.clear()
      fragments.clear()
      reassembler.clear()
    }
  }

  // ─────────────────────────── central (télécommande) ───────────────────────────

  private fun startCentral(a: BluetoothAdapter, c: LinkConfig) {
    val sc = a.bluetoothLeScanner ?: return fail("unsupported", retry = false)
    if (Build.VERSION.SDK_INT <= 30 && !locationEnabled()) manager.error(mode, "location-off")
    val gen = generation
    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) = manager.post {
        if (gen == generation) onScan(result)
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        val copy = results.toList()
        manager.post { if (gen == generation) copy.forEach { onScan(it) } }
      }

      override fun onScanFailed(errorCode: Int) = manager.post {
        if (gen != generation || errorCode == SCAN_FAILED_ALREADY_STARTED) return@post
        scanCallback = null
        scanning = false
        fail("scan-failed", retry = true)
      }
    }
    val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(LinkWire.SERVICE_UUID)).build())
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    try {
      sc.startScan(filters, settings, cb)
    } catch (e: RuntimeException) {
      return fail("scan-failed", retry = true)
    }
    scanner = sc
    scanCallback = cb
    scanning = true
  }

  @Suppress("DEPRECATION")
  private fun locationEnabled(): Boolean = try {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    when {
      lm == null -> true
      Build.VERSION.SDK_INT >= 28 -> lm.isLocationEnabled
      else -> Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, 0) != Settings.Secure.LOCATION_MODE_OFF
    }
  } catch (e: RuntimeException) {
    true
  }

  private fun matches(record: ScanRecord, c: LinkConfig): Boolean {
    val sd = record.getServiceData(ParcelUuid(LinkWire.SERVICE_UUID))
    if (sd != null && sd.size == 1 + LinkLimits.ROOM_TAG_BYTES && sd[0].toInt() == LinkWire.VERSION &&
      LinkWire.equal(sd.copyOfRange(1, sd.size), c.roomTag)
    ) {
      return true
    }
    return record.deviceName == LinkWire.localName(c.roomTag)
  }

  private fun onScan(result: ScanResult) {
    val c = config ?: return
    val device = result.device ?: return
    val address = device.address ?: return
    if (links.containsKey(address)) return
    val t = now()
    if ((backoffUntil[address] ?: 0L) > t) return
    val record = result.scanRecord ?: return
    if (!matches(record, c)) return
    val admitted = links.values.count { it.registered }
    if (admitted >= LinkLimits.MAX_BLE_PEERS) {
      if (!tooManyReported) {
        tooManyReported = true
        manager.error(mode, "too-many-peers")
      }
      return
    }
    if (links.size - admitted >= LinkLimits.MAX_BLE_PENDING) return
    connect(device, c)
  }

  private fun connect(device: BluetoothDevice, c: LinkConfig) {
    val link = CentralLink(device, c)
    links[device.address] = link
    val gatt = try {
      device.connectGatt(context, false, link.callback, BluetoothDevice.TRANSPORT_LE)
    } catch (e: RuntimeException) {
      null
    }
    if (gatt == null) return dropLink(link, FAIL_BACKOFF_MS)
    link.gatt = gatt
    link.setupTimer = manager.schedule(LinkLimits.BLE_SETUP_TIMEOUT_MS) {
      if (!link.closed && !link.handshake.admitted) dropLink(link, FAIL_BACKOFF_MS)
    }
  }

  private fun dropLink(link: CentralLink, backoffMs: Long) {
    if (link.closed) return
    link.shutdown()
    links.remove(link.address)
    val t = now()
    if (backoffUntil.size > 128) backoffUntil.entries.removeAll { it.value <= t } // adresses aléatoires : bornée
    if (backoffUntil.size <= 256) backoffUntil[link.address] = t + backoffMs
    manager.remove(link)
    if (links.values.count { it.registered } < LinkLimits.MAX_BLE_PEERS) tooManyReported = false
  }

  private inner class CentralLink(val device: BluetoothDevice, config: LinkConfig) : Session(config) {
    val address: String = device.address
    var gatt: BluetoothGatt? = null
    private var rx: BluetoothGattCharacteristic? = null
    private var discovering = false

    val callback = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) = manager.post {
        onConnectionState(status, newState)
      }

      override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) = manager.post {
        if (closed) return@post
        if (status == BluetoothGatt.GATT_SUCCESS) maxValue = (mtu - 3).coerceIn(20, LinkLimits.MAX_ATT_VALUE)
        discover()
      }

      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) = manager.post { onServices(status) }

      override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) = manager.post {
        if (closed) return@post
        if (status != BluetoothGatt.GATT_SUCCESS) return@post dropLink(this@CentralLink, FAIL_BACKOFF_MS)
        sendMessage(handshake.hello()) // abonné : le canal est prêt
      }

      override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) =
        manager.post { if (!closed) onWriteDone() }

      // API 33+ : la valeur est passée en argument.
      override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
        if (characteristic.uuid != LinkWire.TX_UUID) return
        val copy = value.copyOf()
        manager.post { onValue(copy) }
      }

      // Avant l'API 33 : la valeur est dans la caractéristique, copiée tout de suite.
      @Deprecated("Remplacée à l'API 33 par la variante avec valeur")
      @Suppress("DEPRECATION")
      override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
        if (characteristic.uuid != LinkWire.TX_UUID) return
        val copy = characteristic.value?.copyOf() ?: return
        manager.post { onValue(copy) }
      }
    }

    private fun onConnectionState(status: Int, newState: Int) {
      if (closed) return
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
        val g = gatt ?: return
        try {
          g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
        } catch (e: RuntimeException) {
          // facultatif
        }
        val asked = try {
          g.requestMtu(REQUESTED_MTU)
        } catch (e: RuntimeException) {
          false
        }
        if (!asked) discover()
      } else {
        // Déconnecté (ou échec, souvent 133) : on reviendra au prochain scan
        dropLink(this, if (handshake.admitted) RECONNECT_BACKOFF_MS else FAIL_BACKOFF_MS)
      }
    }

    private fun discover() {
      if (discovering || closed) return
      discovering = true
      val ok = try {
        gatt?.discoverServices() == true
      } catch (e: RuntimeException) {
        false
      }
      if (!ok) dropLink(this, FAIL_BACKOFF_MS)
    }

    @Suppress("DEPRECATION")
    private fun onServices(status: Int) {
      if (closed) return
      val g = gatt ?: return
      val service = if (status == BluetoothGatt.GATT_SUCCESS) g.getService(LinkWire.SERVICE_UUID) else null
      val rxChar = service?.getCharacteristic(LinkWire.RX_UUID)
      val txChar = service?.getCharacteristic(LinkWire.TX_UUID)
      val cccd = txChar?.getDescriptor(LinkWire.CCCD_UUID)
      if (rxChar == null || txChar == null || cccd == null) return dropLink(this, AUTH_BACKOFF_MS) // pas un écran SetRemote
      rx = rxChar
      val ok = try {
        g.setCharacteristicNotification(txChar, true) && if (Build.VERSION.SDK_INT >= 33) {
          g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothStatusCodes.SUCCESS
        } else {
          cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          g.writeDescriptor(cccd)
        }
      } catch (e: RuntimeException) {
        false
      }
      if (!ok) dropLink(this, FAIL_BACKOFF_MS)
    }

    @Suppress("DEPRECATION")
    override fun writeNow(value: ByteArray): Boolean {
      val g = gatt ?: return false
      val ch = rx ?: return false
      return try {
        if (Build.VERSION.SDK_INT >= 33) {
          g.writeCharacteristic(ch, value, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) == BluetoothStatusCodes.SUCCESS
        } else {
          ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
          ch.value = value
          g.writeCharacteristic(ch)
        }
      } catch (e: RuntimeException) {
        false
      }
    }

    override fun onAdmitted() {
      if (!manager.admit(this, LinkLimits.MAX_BLE_PEERS)) return dropLink(this, AUTH_BACKOFF_MS)
      registered = true
    }

    override fun drop(reason: String) {
      val auth = reason == "auth" || reason == "room" || reason == "role" || reason == "hello"
      dropLink(this, if (auth) AUTH_BACKOFF_MS else FAIL_BACKOFF_MS)
    }

    override fun shutdown() {
      super.shutdown()
      val g = gatt ?: return
      gatt = null
      try {
        g.disconnect()
        g.close()
      } catch (e: RuntimeException) {
        // déjà fermé
      }
    }
  }

  // ─────────────────────────── périphérique (écran) ───────────────────────────

  private fun startPeripheral(a: BluetoothAdapter, c: LinkConfig) {
    val adv = a.bluetoothLeAdvertiser
    if (adv == null || !a.isMultipleAdvertisementSupported) return fail("unsupported", retry = false)
    val gen = generation
    val server = try {
      btManager?.openGattServer(context, ServerCallback(gen))
    } catch (e: RuntimeException) {
      null
    } ?: return fail("gatt-failed", retry = true)
    val service = BluetoothGattService(LinkWire.SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    val rx = BluetoothGattCharacteristic(
      LinkWire.RX_UUID,
      BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
      BluetoothGattCharacteristic.PERMISSION_WRITE,
    )
    val tx = BluetoothGattCharacteristic(LinkWire.TX_UUID, BluetoothGattCharacteristic.PROPERTY_NOTIFY, 0)
    tx.addDescriptor(
      BluetoothGattDescriptor(LinkWire.CCCD_UUID, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE),
    )
    service.addCharacteristic(rx)
    service.addCharacteristic(tx)
    gattServer = server
    txCharacteristic = tx
    advertiser = adv
    val added = try {
      server.addService(service) // suite dans onServiceAdded
    } catch (e: RuntimeException) {
      false
    }
    if (!added) fail("gatt-failed", retry = true)
  }

  private fun startAdvertising() {
    val adv = advertiser ?: return
    val c = config ?: return
    val gen = generation
    val cb = object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings) = manager.post {
        if (gen != generation) return@post
        advertising = true
        lastError = null
        manager.refreshState()
      }

      override fun onStartFailure(errorCode: Int) = manager.post {
        if (gen != generation) return@post
        if (errorCode == ADVERTISE_FAILED_ALREADY_STARTED) {
          advertising = true
          manager.refreshState()
          return@post
        }
        advertiseCallback = null
        if (errorCode == ADVERTISE_FAILED_FEATURE_UNSUPPORTED) fail("unsupported", retry = false)
        else fail("advertise-failed", retry = true)
      }
    }
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .setTimeout(0)
      .build()
    // Paquet d'annonce : drapeaux (3) + UUID 128 bits (18) = 21 octets sur 31.
    val data = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(LinkWire.SERVICE_UUID))
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .build()
    // Réponse au scan : données de service [1][roomTag] sur l'UUID 128 bits = 27 octets sur 31.
    val scanResponse = AdvertiseData.Builder()
      .addServiceData(ParcelUuid(LinkWire.SERVICE_UUID), LinkWire.serviceData(c.roomTag))
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .build()
    try {
      adv.startAdvertising(settings, data, scanResponse, cb)
      advertiseCallback = cb
    } catch (e: RuntimeException) {
      fail("advertise-failed", retry = true)
    }
  }

  private fun respond(device: BluetoothDevice, requestId: Int, status: Int, offset: Int, value: ByteArray?) {
    try {
      gattServer?.sendResponse(device, requestId, status, offset, value)
    } catch (e: RuntimeException) {
      // central parti
    }
  }

  private fun dropSession(s: PeripheralSession, disconnect: Boolean) {
    if (s.closed) return
    s.shutdown()
    sessions.remove(s.address)
    manager.remove(s)
    if (disconnect) {
      try {
        gattServer?.cancelConnection(s.device)
      } catch (e: RuntimeException) {
        // déjà déconnecté
      }
    }
  }

  /** Rappels du serveur GATT (fils Binder) : tout est reposté sur le worker. */
  private inner class ServerCallback(private val gen: Int) : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService) = manager.post {
      if (gen != generation) return@post
      if (status == BluetoothGatt.GATT_SUCCESS) startAdvertising() else fail("gatt-failed", retry = true)
    }

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) = manager.post {
      if (gen != generation || newState != BluetoothProfile.STATE_DISCONNECTED) return@post
      // On ne touche JAMAIS aux connexions d'autres appareils (montre, écouteurs…) :
      // seules celles qui se sont abonnées à notre service ont une session.
      mtus.remove(device.address)
      sessions[device.address]?.let { dropSession(it, disconnect = false) }
    }

    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) = manager.post {
      if (gen != generation) return@post
      val v = (mtu - 3).coerceIn(20, LinkLimits.MAX_ATT_VALUE)
      if (mtus.size < 64 || mtus.containsKey(device.address)) mtus[device.address] = mtu
      sessions[device.address]?.maxValue = v
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?,
    ) {
      val copy = value?.copyOf()
      manager.post {
        if (gen != generation) return@post respond(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null)
        onSubscribe(device, requestId, descriptor, responseNeeded, offset, copy)
      }
    }

    override fun onDescriptorReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, descriptor: BluetoothGattDescriptor) =
      manager.post {
        val on = sessions.containsKey(device.address)
        val v = if (on) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
        respond(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, v)
      }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice,
      requestId: Int,
      characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean,
      responseNeeded: Boolean,
      offset: Int,
      value: ByteArray?,
    ) {
      val copy = value?.copyOf()
      manager.post {
        val s = if (gen == generation) sessions[device.address] else null
        // Écritures longues (préparées) refusées : la fragmentation est la nôtre.
        val ok = s != null && characteristic.uuid == LinkWire.RX_UUID && !preparedWrite && offset == 0 && copy != null
        if (responseNeeded) {
          respond(device, requestId, if (ok) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_WRITE_NOT_PERMITTED, 0, null)
        }
        if (ok) s!!.onValue(copy!!)
      }
    }

    override fun onCharacteristicReadRequest(
      device: BluetoothDevice,
      requestId: Int,
      offset: Int,
      characteristic: BluetoothGattCharacteristic,
    ) = manager.post { respond(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, 0, null) }

    override fun onExecuteWrite(device: BluetoothDevice, requestId: Int, execute: Boolean) = manager.post {
      respond(device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null)
    }

    override fun onNotificationSent(device: BluetoothDevice, status: Int) = manager.post {
      if (gen == generation) sessions[device.address]?.onWriteDone()
    }
  }

  private fun onSubscribe(
    device: BluetoothDevice,
    requestId: Int,
    descriptor: BluetoothGattDescriptor,
    responseNeeded: Boolean,
    offset: Int,
    value: ByteArray?,
  ) {
    val c = config
    val ours = descriptor.uuid == LinkWire.CCCD_UUID && descriptor.characteristic?.uuid == LinkWire.TX_UUID
    if (c == null || !ours) {
      if (responseNeeded) respond(device, requestId, BluetoothGatt.GATT_WRITE_NOT_PERMITTED, offset, null)
      return
    }
    val enable = value != null && value.isNotEmpty() && (value[0].toInt() and 0x01) != 0
    val address = device.address
    var created: PeripheralSession? = null
    var status = BluetoothGatt.GATT_SUCCESS
    if (enable && !sessions.containsKey(address)) {
      if (sessions.size >= LinkLimits.MAX_BLE_CENTRALS) {
        status = BluetoothGatt.GATT_WRITE_NOT_PERMITTED // plafond : abonnement refusé
      } else {
        val s = PeripheralSession(device, c)
        mtus[address]?.let { s.maxValue = (it - 3).coerceIn(20, LinkLimits.MAX_ATT_VALUE) }
        sessions[address] = s
        s.setupTimer = manager.schedule(LinkLimits.BLE_SETUP_TIMEOUT_MS) {
          if (!s.closed && !s.handshake.admitted) dropSession(s, disconnect = true)
        }
        created = s
      }
    } else if (!enable) {
      sessions[address]?.let { dropSession(it, disconnect = false) }
    }
    if (responseNeeded) respond(device, requestId, status, offset, value)
    // Abonné : le canal est prêt, notre HELLO part (après la réponse à l'abonnement).
    created?.sendMessage(created.handshake.hello())
  }

  private inner class PeripheralSession(val device: BluetoothDevice, config: LinkConfig) : Session(config) {
    val address: String = device.address

    @Suppress("DEPRECATION")
    override fun writeNow(value: ByteArray): Boolean {
      val server = gattServer ?: return false
      val tx = txCharacteristic ?: return false
      return try {
        if (Build.VERSION.SDK_INT >= 33) {
          server.notifyCharacteristicChanged(device, tx, false, value) == BluetoothStatusCodes.SUCCESS
        } else {
          tx.value = value
          server.notifyCharacteristicChanged(device, tx, false)
        }
      } catch (e: RuntimeException) {
        false
      }
    }

    override fun onAdmitted() {
      if (!manager.admit(this, LinkLimits.MAX_BLE_CENTRALS)) return dropSession(this, disconnect = true)
      registered = true
    }

    override fun drop(reason: String) = dropSession(this, disconnect = true)
  }

  companion object {
    const val RETRY_MS = 10000L
    const val TICK_MS = 2500L
    const val BUSY_RETRY_MS = 15L
    const val LOST_CALLBACK_MS = 1000L
    const val REQUESTED_MTU = 517
    const val FAIL_BACKOFF_MS = 5000L
    const val RECONNECT_BACKOFF_MS = 1000L
    const val AUTH_BACKOFF_MS = 60000L
  }
}
