// sACN — ANSI E1.31 "Lightweight streaming protocol for transport of DMX512 using ACN".
//
// Layouts follow ANSI E1.31-2018, Table 4-1 (E1.31 Data Packet), Table 4-2
// (E1.31 Synchronization Packet), Table 4-3 (E1.31 Universe Discovery Packet)
// and Appendix A (constants). E1.31-2018 has since been superseded by
// ANSI E1.31-2025 (wire format unchanged; the data-loss timeout is clarified
// to count data packets only, which is how merge.js already behaves).
// See docs/DMX.md, "Références".
//
// The parser never throws on network input: it returns { ok: false, reason }.

import {
  toBytes, u16be, u32be, w16be, w32be, bytesEqual, decodeUtf8Field, writeUtf8Field, uuidString, uuidBytes,
} from './bytes.js';

/** UDP port for E1.31 (ACN_SDT_MULTICAST_PORT, E1.31 §9 and Appendix A). */
export const SACN_PORT = 5568;

/** ACN Packet Identifier "ASC-E1.17\0\0\0" (E1.31 §5.3). */
export const ACN_PACKET_IDENTIFIER = Object.freeze([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);

// Appendix A — vectors
export const VECTOR_ROOT_E131_DATA = 0x00000004;
export const VECTOR_ROOT_E131_EXTENDED = 0x00000008;
export const VECTOR_E131_DATA_PACKET = 0x00000002;
export const VECTOR_E131_EXTENDED_SYNCHRONIZATION = 0x00000001;
export const VECTOR_E131_EXTENDED_DISCOVERY = 0x00000002;
export const VECTOR_DMP_SET_PROPERTY = 0x02;
export const VECTOR_UNIVERSE_DISCOVERY_UNIVERSE_LIST = 0x00000001;

/** E131_NETWORK_DATA_LOSS_TIMEOUT (Appendix A): 2.5 s. */
export const E131_NETWORK_DATA_LOSS_TIMEOUT_MS = 2500;
/** E131_UNIVERSE_DISCOVERY_INTERVAL (Appendix A): 10 s. */
export const E131_UNIVERSE_DISCOVERY_INTERVAL_MS = 10000;
/** Universe used by Universe Discovery packets (Appendix A). */
export const E131_DISCOVERY_UNIVERSE = 64214;

/** Valid data universes (E1.31 §6.2.7): 1–63999. */
export const SACN_UNIVERSE_MIN = 1;
export const SACN_UNIVERSE_MAX = 63999;
/** Priority range (E1.31 §6.2.3): 0–200, default 100. */
export const SACN_PRIORITY_MAX = 200;
export const SACN_PRIORITY_DEFAULT = 100;

/** Options field bits (E1.31 §6.2.6). */
export const OPT_PREVIEW_DATA = 0x80;
export const OPT_STREAM_TERMINATED = 0x40;
export const OPT_FORCE_SYNCHRONIZATION = 0x20;

/** Address Type & Data Type of the DMP layer (E1.31 §7.2). */
export const DMP_ADDRESS_DATA_TYPE = 0xa1;

const DATA_HEADER_LEN = 126;         // bytes up to and including the START code (offset 125)
const DATA_MAX_LEN = 638;            // 126 + 512 slots
const SYNC_LEN = 49;
const DISCOVERY_HEADER_LEN = 120;
const DISCOVERY_MAX_LEN = 120 + 512 * 2;
/** Anything larger than the largest E1.31 packet is rejected before parsing. */
export const SACN_MAX_PACKET = DISCOVERY_MAX_LEN;

/**
 * @typedef {object} SacnOptions
 * @property {boolean} preview          Preview_Data (bit 7): visualisation only, not for live output
 * @property {boolean} streamTerminated Stream_Terminated (bit 6): source stops sending this universe
 * @property {boolean} forceSync        Force_Synchronization (bit 5)
 */

/**
 * @typedef {object} SacnDataPacket
 * @property {true} ok
 * @property {'data'} kind
 * @property {string} cid          Component Identifier, lowercase UUID
 * @property {string} sourceName   UTF-8 source name (≤ 64 bytes on the wire)
 * @property {number} priority     0–200
 * @property {number} syncAddress  0 = not synchronised, else the sync universe
 * @property {number} sequence     0–255
 * @property {SacnOptions} options
 * @property {number} universe     1–63999
 * @property {number} startCode    always 0x00 (other START codes are rejected)
 * @property {Uint8Array} data     DMX slots 1..n (copy; n = property value count − 1, 0–512)
 */

/**
 * @typedef {object} SacnSyncPacket
 * @property {true} ok
 * @property {'sync'} kind
 * @property {string} cid
 * @property {number} sequence
 * @property {number} syncAddress  1–63999
 */

/**
 * @typedef {object} SacnDiscoveryPacket
 * @property {true} ok
 * @property {'discovery'} kind
 * @property {string} cid
 * @property {string} sourceName
 * @property {number} page
 * @property {number} lastPage
 * @property {number[]} universes
 */

/**
 * @typedef {object} SacnReject
 * @property {false} ok
 * @property {string} reason  machine-readable reason (list in docs/DMX-NATIVE.md, « Codes de rejet »)
 * @property {number} [startCode]
 * @property {number} [universe]
 */

/** @typedef {SacnDataPacket | SacnSyncPacket | SacnDiscoveryPacket | SacnReject} SacnParseResult */

const reject = (reason, extra) => (extra ? { ok: false, reason, ...extra } : { ok: false, reason });

/**
 * Check an ACN "Flags and Length" field: high nibble must be 0x7, low 12 bits
 * must equal the number of bytes from `offset` to the end of the packet.
 */
function checkFlagsLength(b, offset) {
  const v = u16be(b, offset);
  if ((v & 0xf000) !== 0x7000) return 'flags';
  if ((v & 0x0fff) !== b.length - offset) return 'length';
  return null;
}

/** Quick test used to route an incoming datagram to the right parser. */
export function looksLikeSacn(input) {
  const b = toBytes(input);
  return !!b && b.length >= 16 && b[0] === 0x00 && b[1] === 0x10 && bytesEqual(b, 4, ACN_PACKET_IDENTIFIER);
}

/**
 * Parse one E1.31 datagram (data, synchronization or universe discovery).
 * Rejected safely (never throws): wrong sizes, bad identifiers/vectors,
 * inconsistent PDU lengths, out-of-range universe or priority, non-zero START code.
 * @param {import('./bytes.js').ByteInput} input
 * @returns {SacnParseResult}
 */
export function parseSacn(input) {
  const b = toBytes(input);
  if (!b) return reject('type');
  if (b.length < SYNC_LEN) return reject('too-short');
  if (b.length > SACN_MAX_PACKET) return reject('too-long');

  // ── Root layer (E1.31 §5) ──
  if (u16be(b, 0) !== 0x0010) return reject('preamble');
  if (u16be(b, 2) !== 0x0000) return reject('postamble');
  if (!bytesEqual(b, 4, ACN_PACKET_IDENTIFIER)) return reject('acn-id');
  const rootErr = checkFlagsLength(b, 16);
  if (rootErr) return reject('root-' + rootErr);
  const rootVector = u32be(b, 18);
  const cid = uuidString(b, 22);

  if (rootVector === VECTOR_ROOT_E131_DATA) return parseData(b, cid);
  if (rootVector === VECTOR_ROOT_E131_EXTENDED) {
    const framingErr = checkFlagsLength(b, 38);
    if (framingErr) return reject('framing-' + framingErr);
    const v = u32be(b, 40);
    if (v === VECTOR_E131_EXTENDED_SYNCHRONIZATION) return parseSync(b, cid);
    if (v === VECTOR_E131_EXTENDED_DISCOVERY) return parseDiscovery(b, cid);
    return reject('framing-vector');
  }
  return reject('root-vector');
}

function parseData(b, cid) {
  if (b.length < DATA_HEADER_LEN) return reject('too-short');
  if (b.length > DATA_MAX_LEN) return reject('too-long');
  // ── Framing layer (E1.31 §6) ──
  const framingErr = checkFlagsLength(b, 38);
  if (framingErr) return reject('framing-' + framingErr);
  if (u32be(b, 40) !== VECTOR_E131_DATA_PACKET) return reject('framing-vector');
  const sourceName = decodeUtf8Field(b, 44, 64);
  const priority = b[108];
  if (priority > SACN_PRIORITY_MAX) return reject('priority');
  const syncAddress = u16be(b, 109);
  if (syncAddress > SACN_UNIVERSE_MAX) return reject('sync-address');
  const sequence = b[111];
  const opt = b[112];
  const universe = u16be(b, 113);
  if (universe < SACN_UNIVERSE_MIN || universe > SACN_UNIVERSE_MAX) return reject('universe', { universe });

  // ── DMP layer (E1.31 §7) ──
  const dmpErr = checkFlagsLength(b, 115);
  if (dmpErr) return reject('dmp-' + dmpErr);
  if (b[117] !== VECTOR_DMP_SET_PROPERTY) return reject('dmp-vector');
  if (b[118] !== DMP_ADDRESS_DATA_TYPE) return reject('dmp-address-type');
  if (u16be(b, 119) !== 0x0000) return reject('dmp-first-address');
  if (u16be(b, 121) !== 0x0001) return reject('dmp-increment');
  const count = u16be(b, 123);
  if (count < 1 || count > 513) return reject('dmp-count');
  if (b.length !== 125 + count) return reject('dmp-count');
  const startCode = b[125];
  const options = {
    preview: (opt & OPT_PREVIEW_DATA) !== 0,
    streamTerminated: (opt & OPT_STREAM_TERMINATED) !== 0,
    forceSync: (opt & OPT_FORCE_SYNCHRONIZATION) !== 0,
  };
  // Only the NULL START code carries dimmer levels (DMX512-A). Alternate START
  // codes (e.g. 0xDD per-address priority) are not used by the gateway.
  if (startCode !== 0x00) return reject('start-code', { startCode, universe });
  return {
    ok: true,
    kind: 'data',
    cid,
    sourceName,
    priority,
    syncAddress,
    sequence,
    options,
    universe,
    startCode,
    data: b.slice(126, 125 + count),
  };
}

function parseSync(b, cid) {
  if (b.length !== SYNC_LEN) return reject(b.length < SYNC_LEN ? 'too-short' : 'too-long');
  const syncAddress = u16be(b, 45);
  if (syncAddress < SACN_UNIVERSE_MIN || syncAddress > SACN_UNIVERSE_MAX) return reject('sync-address');
  return { ok: true, kind: 'sync', cid, sequence: b[44], syncAddress };
}

function parseDiscovery(b, cid) {
  if (b.length < DISCOVERY_HEADER_LEN) return reject('too-short');
  const sourceName = decodeUtf8Field(b, 44, 64);
  const layerErr = checkFlagsLength(b, 112);
  if (layerErr) return reject('discovery-' + layerErr);
  if (u32be(b, 114) !== VECTOR_UNIVERSE_DISCOVERY_UNIVERSE_LIST) return reject('discovery-vector');
  const listBytes = b.length - DISCOVERY_HEADER_LEN;
  if (listBytes % 2 !== 0) return reject('discovery-length');
  const universes = [];
  for (let o = DISCOVERY_HEADER_LEN; o < b.length; o += 2) universes.push(u16be(b, o));
  return { ok: true, kind: 'discovery', cid, sourceName, page: b[118], lastPage: b[119], universes };
}

/**
 * IPv4 multicast group for a universe (E1.31 §9, IPv4 multicast addressing): 239.255.{hi}.{lo}.
 * @param {number} universe 1–63999, or 64214 (discovery)
 * @returns {string}
 */
export function sacnMulticastAddress(universe) {
  if (!Number.isInteger(universe)
    || !((universe >= SACN_UNIVERSE_MIN && universe <= SACN_UNIVERSE_MAX) || universe === E131_DISCOVERY_UNIVERSE)) {
    throw new RangeError('sACN universe must be an integer in 1–63999 (or 64214 for discovery): ' + universe);
  }
  return '239.255.' + (universe >> 8) + '.' + (universe & 0xff);
}

// ─────────────────────────── Builders (simulators, tests, loopback) ───────────────────────────

function writeRoot(b, rootVector, cid) {
  w16be(b, 0, 0x0010);
  w16be(b, 2, 0x0000);
  for (let i = 0; i < 12; i++) b[4 + i] = ACN_PACKET_IDENTIFIER[i];
  w16be(b, 16, 0x7000 | (b.length - 16));
  w32be(b, 18, rootVector);
  const id = uuidBytes(cid);
  if (!id) throw new TypeError('cid must be a UUID string');
  b.set(id, 22);
}

/**
 * Build an E1.31 data packet (NULL START code).
 * @param {object} p
 * @param {string} p.cid
 * @param {number} p.universe
 * @param {ArrayLike<number>} p.data   up to 512 slot values
 * @param {string} [p.sourceName]
 * @param {number} [p.priority=100]
 * @param {number} [p.sequence=0]
 * @param {number} [p.syncAddress=0]
 * @param {Partial<SacnOptions>} [p.options]
 * @returns {Uint8Array}
 */
export function buildSacnDataPacket(p) {
  const data = p.data || [];
  if (data.length > 512) throw new RangeError('at most 512 slots');
  const b = new Uint8Array(126 + data.length);
  writeRoot(b, VECTOR_ROOT_E131_DATA, p.cid);
  w16be(b, 38, 0x7000 | (b.length - 38));
  w32be(b, 40, VECTOR_E131_DATA_PACKET);
  writeUtf8Field(b, 44, 64, p.sourceName || '');
  b[108] = p.priority == null ? SACN_PRIORITY_DEFAULT : p.priority;
  w16be(b, 109, p.syncAddress || 0);
  b[111] = (p.sequence || 0) & 0xff;
  const o = p.options || {};
  b[112] = (o.preview ? OPT_PREVIEW_DATA : 0) | (o.streamTerminated ? OPT_STREAM_TERMINATED : 0)
    | (o.forceSync ? OPT_FORCE_SYNCHRONIZATION : 0);
  w16be(b, 113, p.universe);
  w16be(b, 115, 0x7000 | (b.length - 115));
  b[117] = VECTOR_DMP_SET_PROPERTY;
  b[118] = DMP_ADDRESS_DATA_TYPE;
  w16be(b, 119, 0x0000);
  w16be(b, 121, 0x0001);
  w16be(b, 123, data.length + 1);
  b[125] = 0x00;
  for (let i = 0; i < data.length; i++) b[126 + i] = data[i];
  return b;
}

/**
 * Build an E1.31 synchronization packet.
 * @param {{cid: string, syncAddress: number, sequence?: number}} p
 * @returns {Uint8Array}
 */
export function buildSacnSyncPacket(p) {
  const b = new Uint8Array(SYNC_LEN);
  writeRoot(b, VECTOR_ROOT_E131_EXTENDED, p.cid);
  w16be(b, 38, 0x7000 | (b.length - 38));
  w32be(b, 40, VECTOR_E131_EXTENDED_SYNCHRONIZATION);
  b[44] = (p.sequence || 0) & 0xff;
  w16be(b, 45, p.syncAddress);
  // 47–48 reserved, transmitted as zero
  return b;
}
