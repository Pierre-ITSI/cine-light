package expo.modules.setremotelink

import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

// ════════════════════════════════════════════════════════════════════════════
// Format sur le fil des liaisons hors ligne, version 1 — même spécification que
// la référence TypeScript src/wire.ts (testée sous Node) et que
// ios/LinkWire.swift. Détail : docs/OFFLINE-NATIVE.md § 4.
//
//   message   [kind u8][corps]              HELLO, AUTH, DATA, PING
//   Wi-Fi     [longueur u32 BE][message]
//   Bluetooth [frameId u8][index u16 BE][count u16 BE][morceau]
//
// Aucune trace du contenu : ni trame, ni nom, ni clé n'est journalisé.
// ════════════════════════════════════════════════════════════════════════════

internal object LinkLimits {
  const val LAN_MAX_FRAME = 65536
  const val BLE_MAX_FRAME = 4096
  const val LAN_MAX_MESSAGE = 1 + LAN_MAX_FRAME
  const val BLE_MAX_MESSAGE = 1 + BLE_MAX_FRAME
  const val MAX_NAME_BYTES = 128
  const val MAX_NAME_CHARS = 64
  const val ROOM_TAG_BYTES = 8
  const val AUTH_KEY_BYTES = 32
  const val NONCE_BYTES = 16
  const val MAC_BYTES = 32
  const val HELLO_FIXED_BYTES = 28
  const val HELLO_MAX_BYTES = HELLO_FIXED_BYTES + MAX_NAME_BYTES
  const val AUTH_BYTES = 1 + MAC_BYTES
  const val PREAUTH_MAX_MESSAGE = 160
  const val PREAUTH_MAX_BYTES = 256
  const val LAN_HEADER_BYTES = 4
  const val FRAG_HEADER_BYTES = 5
  const val MAX_ATT_VALUE = 512
  const val MAX_FRAGMENTS = 512
  const val MAX_PARTIALS = 4
  const val REASSEMBLY_TIMEOUT_MS = 5000L
  const val HANDSHAKE_TIMEOUT_MS = 5000L
  /** Bluetooth : connexion, MTU, découverte GATT et poignée de main. */
  const val BLE_SETUP_TIMEOUT_MS = 10000L
  const val KEEPALIVE_MS = 5000L
  const val DEAD_AFTER_MS = 15000
  const val MAX_LAN_PEERS = 64
  const val MAX_LAN_PENDING = 8
  /** Télécommande (central) : écrans Bluetooth connectés à la fois. */
  const val MAX_BLE_PEERS = 8
  const val MAX_BLE_PENDING = 4
  /** Écran (périphérique) : centraux abonnés à la fois. */
  const val MAX_BLE_CENTRALS = 4
  const val LAN_PEER_BACKLOG = 1 shl 20
  const val BLE_PEER_BACKLOG = 64 * 1024
  const val INBOX_MAX_FRAMES = 1024
  const val INBOX_MAX_BYTES = 8 shl 20
  const val MAX_BATCH_FRAMES = 256
  const val MAX_BATCH_BYTES = 1 shl 20
}

internal object LinkWire {
  const val VERSION = 1
  const val SERVICE_TYPE = "_setremote._tcp"
  const val TXT_ROOM = "r"
  const val TXT_VERSION = "v"
  val SERVICE_UUID: UUID = UUID.fromString("ca098d33-dca0-45ed-8875-d0da84ef2400")
  /** Écrite par la télécommande (central → écran). */
  val RX_UUID: UUID = UUID.fromString("ca098d33-dca0-45ed-8875-d0da84ef2401")
  /** Notifiée par l'écran (écran → central). */
  val TX_UUID: UUID = UUID.fromString("ca098d33-dca0-45ed-8875-d0da84ef2402")
  /** Client Characteristic Configuration Descriptor (Bluetooth SIG). */
  val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  const val NAME_PREFIX = "SR"

  const val KIND_HELLO = 0x01
  const val KIND_AUTH = 0x02
  const val KIND_DATA = 0x03
  const val KIND_PING = 0x04
  const val ROLE_REMOTE = 0x52
  const val ROLE_SCREEN = 0x53
  const val MAC_CONTEXT = "SRL1"

  val PING: ByteArray = byteArrayOf(KIND_PING.toByte())

  private val random = SecureRandom()

  fun randomBytes(n: Int): ByteArray = ByteArray(n).also { random.nextBytes(it) }

  /** Identifiant de pair opaque : lettre de la liaison + 12 chiffres hexadécimaux aléatoires. */
  fun newPeerId(prefix: String): String = prefix + "-" + hex(randomBytes(6))

  fun hex(bytes: ByteArray): String {
    val sb = StringBuilder(bytes.size * 2)
    for (b in bytes) {
      val v = b.toInt() and 0xff
      sb.append("0123456789abcdef"[v shr 4]).append("0123456789abcdef"[v and 15])
    }
    return sb.toString()
  }

  /** Hexadécimal minuscule de longueur exacte `bytes * 2`, sinon null. */
  fun parseHex(s: String, bytes: Int): ByteArray? {
    if (s.length != bytes * 2) return null
    val out = ByteArray(bytes)
    for (i in 0 until bytes) {
      val hi = "0123456789abcdef".indexOf(s[2 * i])
      val lo = "0123456789abcdef".indexOf(s[2 * i + 1])
      if (hi < 0 || lo < 0) return null
      out[i] = ((hi shl 4) or lo).toByte()
    }
    return out
  }

  /** Comparaison en temps constant. */
  fun equal(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

  /** Tronque un UTF-8 à `max` octets sans couper un caractère. */
  fun truncateUtf8(bytes: ByteArray, max: Int): ByteArray {
    if (bytes.size <= max) return bytes
    var end = max
    while (end > 0 && (bytes[end].toInt() and 0xc0) == 0x80) end--
    return bytes.copyOf(end)
  }

  /** UTF-8 tolérant (U+FFFD pour une séquence invalide). */
  fun decodeUtf8(bytes: ByteArray, offset: Int, length: Int): String {
    val decoder = Charsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPLACE)
      .onUnmappableCharacter(CodingErrorAction.REPLACE)
    return decoder.decode(java.nio.ByteBuffer.wrap(bytes, offset, length)).toString()
  }

  /** Nom reçu d'un pair : sans caractère de contrôle, 64 caractères au plus. */
  fun sanitizeName(raw: String): String {
    val sb = StringBuilder()
    for (ch in raw) {
      val c = ch.code
      if (c < 0x20 || c in 0x7f..0x9f || c == 0x2028 || c == 0x2029) continue
      sb.append(ch)
    }
    val trimmed = sb.toString().trim()
    val cps = trimmed.codePointCount(0, trimmed.length)
    if (cps <= LinkLimits.MAX_NAME_CHARS) return trimmed
    return trimmed.substring(0, trimmed.offsetByCodePoints(0, LinkLimits.MAX_NAME_CHARS))
  }

  fun encodeHello(role: Int, roomTag: ByteArray, nonce: ByteArray, name: String): ByteArray {
    val n = truncateUtf8(name.toByteArray(Charsets.UTF_8), LinkLimits.MAX_NAME_BYTES)
    val out = ByteArray(LinkLimits.HELLO_FIXED_BYTES + n.size)
    out[0] = KIND_HELLO.toByte()
    out[1] = VERSION.toByte()
    out[2] = role.toByte()
    System.arraycopy(roomTag, 0, out, 3, LinkLimits.ROOM_TAG_BYTES)
    System.arraycopy(nonce, 0, out, 3 + LinkLimits.ROOM_TAG_BYTES, LinkLimits.NONCE_BYTES)
    out[LinkLimits.HELLO_FIXED_BYTES - 1] = n.size.toByte()
    System.arraycopy(n, 0, out, LinkLimits.HELLO_FIXED_BYTES, n.size)
    return out
  }

  class Hello(val role: Int, val roomTag: ByteArray, val nonce: ByteArray, val name: String)

  /** HELLO strict : longueur exacte, version 1, rôle connu. Sinon null. */
  fun decodeHello(m: ByteArray): Hello? {
    if (m.size < LinkLimits.HELLO_FIXED_BYTES || m.size > LinkLimits.HELLO_MAX_BYTES) return null
    if (m[0].toInt() != KIND_HELLO || m[1].toInt() != VERSION) return null
    val role = m[2].toInt() and 0xff
    if (role != ROLE_REMOTE && role != ROLE_SCREEN) return null
    val nameLen = m[LinkLimits.HELLO_FIXED_BYTES - 1].toInt() and 0xff
    if (nameLen > LinkLimits.MAX_NAME_BYTES || m.size != LinkLimits.HELLO_FIXED_BYTES + nameLen) return null
    val tag = m.copyOfRange(3, 3 + LinkLimits.ROOM_TAG_BYTES)
    val nonce = m.copyOfRange(3 + LinkLimits.ROOM_TAG_BYTES, 3 + LinkLimits.ROOM_TAG_BYTES + LinkLimits.NONCE_BYTES)
    val name = sanitizeName(decodeUtf8(m, LinkLimits.HELLO_FIXED_BYTES, nameLen))
    return Hello(role, tag, nonce, name)
  }

  /** HMAC-SHA256(authKey, "SRL1" ‖ rôle émetteur ‖ nonce destinataire ‖ nonce émetteur). */
  fun authMac(key: ByteArray, senderRole: Int, receiverNonce: ByteArray, senderNonce: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    mac.update(MAC_CONTEXT.toByteArray(Charsets.US_ASCII))
    mac.update(senderRole.toByte())
    mac.update(receiverNonce)
    mac.update(senderNonce)
    return mac.doFinal()
  }

  fun encodeAuth(mac: ByteArray): ByteArray = byteArrayOf(KIND_AUTH.toByte()) + mac

  /** Message DATA : [3] + octets UTF-8 de la trame. */
  fun encodeData(frame: ByteArray): ByteArray {
    val out = ByteArray(1 + frame.size)
    out[0] = KIND_DATA.toByte()
    System.arraycopy(frame, 0, out, 1, frame.size)
    return out
  }

  fun lanRecord(message: ByteArray): ByteArray {
    val n = message.size
    val out = ByteArray(LinkLimits.LAN_HEADER_BYTES + n)
    out[0] = (n ushr 24).toByte()
    out[1] = (n ushr 16).toByte()
    out[2] = (n ushr 8).toByte()
    out[3] = n.toByte()
    System.arraycopy(message, 0, out, LinkLimits.LAN_HEADER_BYTES, n)
    return out
  }

  /** Découpe un message en valeurs GATT d'au plus `maxValue` octets (plafonné à 512). */
  fun fragment(message: ByteArray, frameId: Int, maxValue: Int): List<ByteArray> {
    val chunk = minOf(maxValue, LinkLimits.MAX_ATT_VALUE) - LinkLimits.FRAG_HEADER_BYTES
    require(message.isNotEmpty() && chunk >= 1) { "fragmentation impossible" }
    val count = (message.size + chunk - 1) / chunk
    require(count <= LinkLimits.MAX_FRAGMENTS) { "trop de fragments" }
    val out = ArrayList<ByteArray>(count)
    for (i in 0 until count) {
      val start = i * chunk
      val len = minOf(chunk, message.size - start)
      val p = ByteArray(LinkLimits.FRAG_HEADER_BYTES + len)
      p[0] = frameId.toByte()
      p[1] = (i shr 8).toByte()
      p[2] = i.toByte()
      p[3] = (count shr 8).toByte()
      p[4] = count.toByte()
      System.arraycopy(message, start, p, LinkLimits.FRAG_HEADER_BYTES, len)
      out.add(p)
    }
    return out
  }

  /** Données de service annoncées par un écran Android (réponse au scan) : [version][roomTag]. */
  fun serviceData(roomTag: ByteArray): ByteArray = byteArrayOf(VERSION.toByte()) + roomTag

  /** Nom local annoncé par un écran iOS : « SR » + roomTag hexadécimal. */
  fun localName(roomTag: ByteArray): String = NAME_PREFIX + hex(roomTag)
}

// ─────────────────────────────── poignée de main ───────────────────────────────

/** Résultat du traitement d'un message reçu. */
internal class HandshakeEvent(
  val send: List<ByteArray> = emptyList(),
  /** Non null : le pair vient d'être admis (nom éventuellement vide). */
  val admittedName: String? = null,
  val data: String? = null,
  /** Non null : violation, fermer la connexion. */
  val error: String? = null,
)

/**
 * Machine d'état d'une connexion (un pair) ; non partagée entre threads.
 * Même comportement que la classe Handshake de src/wire.ts.
 */
internal class Handshake(
  private val role: Int,
  private val roomTag: ByteArray,
  private val authKey: ByteArray,
  private val nonce: ByteArray,
  private val name: String,
) {
  private var state = 0 // 0 attente HELLO, 1 attente AUTH, 2 ouvert, 3 fermé
  private var helloSent = false
  private var peerNonce: ByteArray? = null
  private var peerName = ""

  val admitted: Boolean get() = state == 2

  fun hello(): ByteArray {
    helloSent = true
    return LinkWire.encodeHello(role, roomTag, nonce, name)
  }

  private fun fail(reason: String): HandshakeEvent {
    state = 3
    return HandshakeEvent(error = reason)
  }

  fun receive(m: ByteArray): HandshakeEvent {
    if (state == 3) return HandshakeEvent(error = "protocol")
    if (m.isEmpty()) return fail("empty")
    val kind = m[0].toInt() and 0xff
    if (kind == LinkWire.KIND_PING) return HandshakeEvent()
    when (state) {
      0 -> {
        if (kind != LinkWire.KIND_HELLO) return fail(if (kind == LinkWire.KIND_DATA) "unauthenticated" else "hello")
        val h = LinkWire.decodeHello(m) ?: return fail("hello")
        if (h.role == role) return fail("role")
        if (!LinkWire.equal(h.roomTag, roomTag)) return fail("room")
        peerNonce = h.nonce
        peerName = h.name
        state = 1
        val auth = LinkWire.encodeAuth(LinkWire.authMac(authKey, role, h.nonce, nonce))
        return HandshakeEvent(send = if (helloSent) listOf(auth) else listOf(hello(), auth))
      }
      1 -> {
        if (kind != LinkWire.KIND_AUTH || m.size != LinkLimits.AUTH_BYTES) {
          return fail(if (kind == LinkWire.KIND_DATA) "unauthenticated" else "auth")
        }
        val peerRole = if (role == LinkWire.ROLE_REMOTE) LinkWire.ROLE_SCREEN else LinkWire.ROLE_REMOTE
        val expected = LinkWire.authMac(authKey, peerRole, nonce, peerNonce!!)
        if (!LinkWire.equal(m.copyOfRange(1, m.size), expected)) return fail("auth")
        state = 2
        return HandshakeEvent(admittedName = peerName)
      }
      else -> {
        if (kind == LinkWire.KIND_DATA) {
          if (m.size < 2) return HandshakeEvent()
          return HandshakeEvent(data = LinkWire.decodeUtf8(m, 1, m.size - 1))
        }
        if (kind == LinkWire.KIND_HELLO || kind == LinkWire.KIND_AUTH) return fail("protocol")
        return HandshakeEvent() // type inconnu après admission : ignoré
      }
    }
  }
}

// ─────────────────────────────── réassemblage ───────────────────────────────

/** Résultat : message complet, erreur (paquet ignoré), ou ni l'un ni l'autre. */
internal class ReassemblyResult(val message: ByteArray? = null, val error: String? = null)

/**
 * Réassemblage par pair ; même comportement que Reassembler (src/wire.ts) :
 * désordre et doublons tolérés, `maxMessage` octets, MAX_PARTIALS incomplets,
 * délai REASSEMBLY_TIMEOUT_MS. Non partagé entre threads.
 */
internal class Reassembler(var maxMessage: Int, private val timeoutMs: Long = LinkLimits.REASSEMBLY_TIMEOUT_MS) {
  private class Partial(val count: Int, val startedAt: Long) {
    val parts = arrayOfNulls<ByteArray>(count)
    var received = 0
    var bytes = 0
  }

  private val partials = LinkedHashMap<Int, Partial>()
  var dropped = 0
    private set

  val pending: Int get() = partials.size

  fun sweep(now: Long) {
    val it = partials.entries.iterator()
    while (it.hasNext()) {
      if (now - it.next().value.startedAt > timeoutMs) {
        it.remove()
        dropped++
      }
    }
  }

  fun clear() = partials.clear()

  fun push(packet: ByteArray, now: Long): ReassemblyResult {
    if (packet.size <= LinkLimits.FRAG_HEADER_BYTES) return ReassemblyResult(error = "short")
    val id = packet[0].toInt() and 0xff
    val index = ((packet[1].toInt() and 0xff) shl 8) or (packet[2].toInt() and 0xff)
    val count = ((packet[3].toInt() and 0xff) shl 8) or (packet[4].toInt() and 0xff)
    if (count == 0 || count > LinkLimits.MAX_FRAGMENTS || index >= count) return ReassemblyResult(error = "header")
    val chunkLen = packet.size - LinkLimits.FRAG_HEADER_BYTES
    sweep(now)
    if (count == 1) {
      partials.remove(id)
      if (chunkLen > maxMessage) return ReassemblyResult(error = "too-large")
      return ReassemblyResult(message = packet.copyOfRange(LinkLimits.FRAG_HEADER_BYTES, packet.size))
    }
    var p = partials[id]
    if (p != null && p.count != count) {
      partials.remove(id)
      dropped++
      p = null
    }
    if (p == null) {
      if (partials.size >= LinkLimits.MAX_PARTIALS) {
        val oldest = partials.entries.minByOrNull { it.value.startedAt }!!.key
        partials.remove(oldest)
        dropped++
      }
      p = Partial(count, now)
      partials[id] = p
    }
    if (p.parts[index] != null) return ReassemblyResult() // doublon
    p.bytes += chunkLen
    if (p.bytes > maxMessage) {
      partials.remove(id)
      dropped++
      return ReassemblyResult(error = "too-large")
    }
    p.parts[index] = packet.copyOfRange(LinkLimits.FRAG_HEADER_BYTES, packet.size)
    p.received++
    if (p.received < count) return ReassemblyResult()
    partials.remove(id)
    val out = ByteArray(p.bytes)
    var o = 0
    for (part in p.parts) {
      System.arraycopy(part!!, 0, out, o, part.size)
      o += part.size
    }
    return ReassemblyResult(message = out)
  }
}

// ─────────────────────────────── file de réception ───────────────────────────────

internal class InboundFrame(val peer: String, val mode: String, val data: String, val bytes: Int)

/**
 * File bornée des trames reçues ; producteurs : fils de lecture et file
 * interne ; consommateur : drain() sur le thread JS. Pleine (en nombre ou en
 * octets), elle jette les plus anciennes.
 */
internal class Inbox(private val maxFrames: Int, private val maxBytes: Int) {
  private val items = ArrayDeque<InboundFrame>()
  private var bytes = 0L
  /** Vrai quand des trames ont été jetées depuis le dernier relevé complet. */
  private var overflowed = false

  /** Renvoie vrai si des trames anciennes ont été jetées (première fois depuis la dernière vidange). */
  @Synchronized
  fun push(frame: InboundFrame): Boolean {
    items.addLast(frame)
    bytes += frame.bytes
    var dropped = false
    while (items.size > maxFrames || (bytes > maxBytes && items.size > 1)) {
      bytes -= items.removeFirst().bytes
      dropped = true
    }
    if (!dropped || overflowed) return false
    overflowed = true
    return true
  }

  /** Au plus maxFrames trames et maxBytes octets (au moins une), dans l'ordre ; le reste attend. */
  @Synchronized
  fun drain(maxCount: Int, maxSize: Int): List<InboundFrame> {
    val out = ArrayList<InboundFrame>()
    var size = 0L
    while (items.isNotEmpty() && out.size < maxCount) {
      val next = items.first()
      if (out.isNotEmpty() && size + next.bytes > maxSize) break
      out.add(items.removeFirst())
      size += next.bytes
    }
    bytes -= size
    if (items.isEmpty()) overflowed = false
    return out
  }

  @Synchronized
  fun clear() {
    items.clear()
    bytes = 0
    overflowed = false
  }

  @Synchronized
  fun removePeer(peer: String) {
    val it = items.iterator()
    while (it.hasNext()) {
      val f = it.next()
      if (f.peer == peer) {
        bytes -= f.bytes
        it.remove()
      }
    }
  }
}
