// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Art-Net 4 (Artistic Licence) — ArtDmx, ArtPoll, ArtSync parsing and ArtPollReply building.
//
// Reference: "Art-Net 4 Specification", Protocol Release V1.4, document revision
// 1.4dp (23/10/2025), https://art-net.org.uk/downloads/art-net.pdf — sections
// ArtPoll, ArtPollReply, ArtDmx, ArtSync, "Data merging" and "Port-Address".
// Byte offsets were cross-checked against OLA (plugins/artnet/ArtNetPackets.h)
// and jwetzell/artnet-go (pollreply.go); see docs/DMX.md, "Références".
//
// The parser never throws on network input: it returns { ok: false, reason }.

import {
  toBytes, u16be, u16le, w16be, w16le, bytesEqual, writeAsciiField, decodeAsciiField, ipv4Bytes, macBytes,
} from './bytes.js';

/** UDP port 0x1936 used by every Art-Net packet. */
export const ARTNET_PORT = 6454;
/** Packet ID "Art-Net\0". */
export const ARTNET_ID = Object.freeze([0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00]);
/** Protocol version implemented (Art-Net 4 = 14). */
export const ARTNET_PROTOCOL_VERSION = 14;

export const OP_POLL = 0x2000;
export const OP_POLL_REPLY = 0x2100;
export const OP_DMX = 0x5000;
export const OP_SYNC = 0x5200;

/** Highest 15-bit Port-Address (Net 7 bits | Sub-Net 4 bits | Universe 4 bits). */
export const PORT_ADDRESS_MAX = 0x7fff;
/** ArtDmx header size; DMX data starts at offset 18. */
export const ARTDMX_HEADER_LEN = 18;
/** ArtPollReply size in bytes (Art-Net 4, including the trailing filler). */
export const ARTPOLLREPLY_LEN = 239;
/** Datagrams larger than this are rejected without parsing. */
export const ARTNET_MAX_PACKET = 1024;

/** ArtPoll Flags bits (Art-Net 4, ArtPoll → Flags). */
export const POLL_FLAG_REPLY_ON_CHANGE = 0x02;
export const POLL_FLAG_DIAGNOSTICS = 0x04;
export const POLL_FLAG_DIAG_UNICAST = 0x08;
export const POLL_FLAG_VLC_DISABLE = 0x10;
export const POLL_FLAG_TARGETED = 0x20;

/** Status / port bits used in our ArtPollReply. */
export const STATUS1_INDICATORS_NORMAL = 0xc0;        // bits 7-6 = 11: indicators normal
export const STATUS1_PORT_ADDRESS_LOCAL = 0x10;       // bits 5-4 = 01: Port-Address set by front panel (our app UI)
export const STATUS2_PORT_ADDRESS_15BIT = 0x08;       // bit 3: supports 15-bit Port-Address (Art-Net 3/4)
export const STATUS2_DHCP_CAPABLE = 0x04;             // bit 2
export const STATUS2_DHCP_CONFIGURED = 0x02;          // bit 1
export const PORT_TYPE_OUTPUT_DMX = 0x80;             // bit 7: can output data from the Art-Net network; protocol DMX512
export const GOOD_OUTPUT_DATA = 0x80;                 // GoodOutputA bit 7: data is being output
export const GOOD_OUTPUT_MERGING = 0x08;              // GoodOutputA bit 3: output is merging Art-Net data
export const GOOD_OUTPUT_LTP = 0x02;                  // GoodOutputA bit 1: merge mode is LTP
export const GOOD_OUTPUT_SACN = 0x01;                 // GoodOutputA bit 0: output fed from sACN instead of Art-Net
export const GOOD_OUTPUT_B_RDM_DISABLED = 0x80;       // GoodOutputB bit 7: RDM disabled
export const STYLE_NODE = 0x00;                       // StNode: a DMX to/from Art-Net device
/** Status3 bits 7-6: failsafe behaviour advertised to the console. */
export const FAILSAFE = Object.freeze({ hold: 0x00, zero: 0x40, full: 0x80, scene: 0xc0 });
/** NodeReport status code RcPowerOk. */
export const RC_POWER_OK = 0x0001;
/** Art-Net OEM code "OemUnknown" (request a real code from Artistic Licence for production). */
export const OEM_UNKNOWN = 0x00ff;

const reject = (reason, extra) => (extra ? { ok: false, reason, ...extra } : { ok: false, reason });

/** Split a 15-bit Port-Address into Net / Sub-Net / Universe. */
export function splitPortAddress(portAddress) {
  return { net: (portAddress >> 8) & 0x7f, subNet: (portAddress >> 4) & 0x0f, universe: portAddress & 0x0f };
}

/** Build a 15-bit Port-Address from Net (0–127), Sub-Net (0–15) and Universe (0–15). */
export function makePortAddress(net, subNet, universe) {
  return ((net & 0x7f) << 8) | ((subNet & 0x0f) << 4) | (universe & 0x0f);
}

/** Quick test used to route an incoming datagram to the right parser. */
export function looksLikeArtNet(input) {
  const b = toBytes(input);
  return !!b && b.length >= 10 && bytesEqual(b, 0, ARTNET_ID);
}

/**
 * @typedef {object} ArtDmxPacket
 * @property {true} ok
 * @property {'dmx'} kind
 * @property {number} protVer
 * @property {number} sequence     0 = sequencing disabled, else 1–255
 * @property {number} physical     informational physical input port
 * @property {number} net          0–127
 * @property {number} subNet       0–15
 * @property {number} universe     0–15 (low nibble)
 * @property {number} portAddress  15-bit Port-Address 0–32767
 * @property {Uint8Array} data     copy of the Length DMX slots
 */

/**
 * @typedef {object} ArtPollPacket
 * @property {true} ok
 * @property {'poll'} kind
 * @property {number} protVer
 * @property {number} flags
 * @property {number} diagPriority
 * @property {boolean} replyOnChange
 * @property {boolean} targeted
 * @property {number|null} targetTop      Art-Net 4 targeted mode upper Port-Address (null if absent)
 * @property {number|null} targetBottom
 * @property {number|null} estaMan
 * @property {number|null} oem
 */

/**
 * Parse one Art-Net datagram. Supported: ArtDmx, ArtPoll, ArtSync, ArtPollReply.
 * @param {import('./bytes.js').ByteInput} input
 * @param {{strictLength?: boolean}} [opts] strictLength (default true) enforces the
 *   ArtDmx rule "Length is an even number in the range 2–512"; false also accepts odd 1–511.
 */
export function parseArtNet(input, opts) {
  const b = toBytes(input);
  if (!b) return reject('type');
  if (b.length < 10) return reject('too-short');
  if (b.length > ARTNET_MAX_PACKET) return reject('too-long');
  if (!bytesEqual(b, 0, ARTNET_ID)) return reject('id');
  const opCode = u16le(b, 8);
  if (opCode === OP_POLL_REPLY) return parsePollReply(b);
  // Every other packet carries ProtVerHi/ProtVerLo at 10–11.
  if (b.length < 12) return reject('too-short');
  const protVer = u16be(b, 10);
  if (protVer < ARTNET_PROTOCOL_VERSION) return reject('protocol-version', { protVer });
  if (opCode === OP_DMX) return parseDmx(b, protVer, !(opts && opts.strictLength === false));
  if (opCode === OP_POLL) return parsePoll(b, protVer);
  if (opCode === OP_SYNC) return b.length >= 14 ? { ok: true, kind: 'sync', protVer } : reject('too-short');
  return reject('unsupported-opcode', { opCode });
}

function parseDmx(b, protVer, strict) {
  if (b.length < ARTDMX_HEADER_LEN + 1) return reject('too-short');
  const length = u16be(b, 16);
  if (length < 1 || length > 512 || (strict && (length < 2 || length % 2 !== 0))) return reject('length', { length });
  if (b.length < ARTDMX_HEADER_LEN + length) return reject('truncated', { length });
  if (b.length > ARTDMX_HEADER_LEN + 512) return reject('too-long');
  const subUni = b[14];
  const net = b[15];
  if (net > 0x7f) return reject('port-address');
  const portAddress = (net << 8) | subUni;
  return {
    ok: true,
    kind: 'dmx',
    protVer,
    sequence: b[12],
    physical: b[13],
    net,
    subNet: subUni >> 4,
    universe: subUni & 0x0f,
    portAddress,
    data: b.slice(ARTDMX_HEADER_LEN, ARTDMX_HEADER_LEN + length),
  };
}

function parsePoll(b, protVer) {
  if (b.length < 14) return reject('too-short');
  const flags = b[12];
  const has = (n) => b.length >= n;
  return {
    ok: true,
    kind: 'poll',
    protVer,
    flags,
    diagPriority: b[13],
    replyOnChange: (flags & POLL_FLAG_REPLY_ON_CHANGE) !== 0,
    targeted: (flags & POLL_FLAG_TARGETED) !== 0,
    targetTop: has(16) ? u16be(b, 14) & PORT_ADDRESS_MAX : null,
    targetBottom: has(18) ? u16be(b, 16) & PORT_ADDRESS_MAX : null,
    estaMan: has(20) ? u16be(b, 18) : null,
    oem: has(22) ? u16be(b, 20) : null,
  };
}

function parsePollReply(b) {
  // Pre-Art-Net-3 nodes sent shorter replies; the fields up to MAC (207 bytes) are mandatory.
  if (b.length < 207) return reject('too-short');
  const numPorts = Math.min(4, b[173]);
  const ports = [];
  for (let i = 0; i < numPorts; i++) {
    ports.push({
      type: b[174 + i],
      goodInput: b[178 + i],
      goodOutputA: b[182 + i],
      swIn: b[186 + i],
      swOut: b[190 + i],
      portAddress: ((b[18] & 0x7f) << 8) | ((b[19] & 0x0f) << 4) | (b[190 + i] & 0x0f),
    });
  }
  return {
    ok: true,
    kind: 'pollReply',
    ip: b[10] + '.' + b[11] + '.' + b[12] + '.' + b[13],
    port: u16le(b, 14),
    versInfo: u16be(b, 16),
    netSwitch: b[18],
    subSwitch: b[19],
    oem: u16be(b, 20),
    status1: b[23],
    estaMan: u16le(b, 24),
    shortName: decodeAsciiField(b, 26, 18),
    longName: decodeAsciiField(b, 44, 64),
    nodeReport: decodeAsciiField(b, 108, 64),
    numPorts: u16be(b, 172),
    ports,
    style: b[200],
    mac: Array.from(b.slice(201, 207), (x) => (x < 16 ? '0' : '') + x.toString(16)).join(':'),
    bindIp: b.length >= 211 ? b[207] + '.' + b[208] + '.' + b[209] + '.' + b[210] : null,
    bindIndex: b.length >= 212 ? b[211] : null,
    status2: b.length >= 213 ? b[212] : null,
    status3: b.length >= 218 ? b[217] : null,
    refreshRate: b.length >= 228 ? u16be(b, 226) : null,
  };
}

/**
 * Art-Net 4 targeted mode: reply only when one of our Port-Addresses lies in
 * [TargetPortAddressBottom, TargetPortAddressTop]. Untargeted polls always get a reply.
 * @param {ArtPollPacket} poll
 * @param {number[]} portAddresses
 */
export function shouldReplyToPoll(poll, portAddresses) {
  if (!poll || !poll.targeted || poll.targetTop == null || poll.targetBottom == null) return true;
  return portAddresses.some((pa) => pa >= poll.targetBottom && pa <= poll.targetTop);
}

/**
 * Format the NodeReport text: "#xxxx [yyyy] text" (status code in hex, reply counter in decimal).
 * @param {number} code
 * @param {number} counter
 * @param {string} text
 */
export function formatNodeReport(code, counter, text) {
  const hex = (code & 0xffff).toString(16).padStart(4, '0');
  const cnt = String(Math.max(0, counter | 0) % 10000).padStart(4, '0');
  return '#' + hex + ' [' + cnt + '] ' + text;
}

/**
 * @typedef {object} ArtPollReplyOptions
 * @property {string|number[]} ip          gateway IPv4 address (also used as BindIp)
 * @property {string|number[]} [mac]       gateway MAC (zeros if unknown — iOS does not expose it)
 * @property {string} [shortName]          ≤ 17 ASCII chars (e.g. "SetRemote GW")
 * @property {string} [longName]           ≤ 63 ASCII chars
 * @property {string} [nodeReportText]     free text after "#0001 [nnnn] "
 * @property {number} [replyCounter]       counter shown in NodeReport
 * @property {number[]} portAddresses      15-bit Port-Addresses received by the gateway (≥ 1)
 * @property {number[]} [activePortAddresses] Port-Addresses currently receiving data (GoodOutputA bit 7)
 * @property {number[]} [mergingPortAddresses] Port-Addresses currently merging two sources
 * @property {boolean} [ltp]               merge mode is LTP (default HTP)
 * @property {number[]} [sacnPortAddresses] outputs currently fed from sACN instead of Art-Net
 * @property {number} [portsPerReply=4]    1–4 ports per ArtPollReply (Art-Net 4 BindIndex scheme)
 * @property {number} [oem=0x00ff]
 * @property {number} [estaMan=0x0000]
 * @property {number} [firmwareVersion=1]
 * @property {boolean} [dhcp]              address obtained by DHCP
 * @property {'hold'|'zero'|'full'|'scene'} [failsafe='hold']
 * @property {number} [refreshRate=44]     maximum ArtDmx rate processed, Hz
 */

/**
 * Build the ArtPollReply packets describing the gateway. One reply covers at
 * most 4 ports sharing the same Net and Sub-Net; extra groups get BindIndex 2, 3…
 * Art-Net 4 requires replies to be UNICAST to the IP that sent the ArtPoll, port 6454.
 * @param {ArtPollReplyOptions} o
 * @returns {Uint8Array[]}
 */
export function buildArtPollReplies(o) {
  const ip = ipv4Bytes(o.ip);
  if (!ip) throw new TypeError('ArtPollReply: invalid ip ' + o.ip);
  const mac = macBytes(o.mac);
  if (!mac) throw new TypeError('ArtPollReply: invalid mac ' + o.mac);
  const list = Array.from(new Set((o.portAddresses && o.portAddresses.length ? o.portAddresses : [0])))
    .filter((pa) => Number.isInteger(pa) && pa >= 0 && pa <= PORT_ADDRESS_MAX)
    .sort((a, b) => a - b);
  if (!list.length) throw new RangeError('ArtPollReply: no valid Port-Address');
  const per = Math.max(1, Math.min(4, o.portsPerReply || 4));
  const groups = [];
  for (const pa of list) {
    const g = groups[groups.length - 1];
    if (g && g.length < per && (g[0] >> 4) === (pa >> 4)) g.push(pa);
    else groups.push([pa]);
  }
  return groups.map((g, i) => buildOneReply(o, ip, mac, g, i + 1));
}

/** Convenience: the first (or only) ArtPollReply. */
export function buildArtPollReply(o) {
  return buildArtPollReplies(o)[0];
}

function buildOneReply(o, ip, mac, ports, bindIndex) {
  const b = new Uint8Array(ARTPOLLREPLY_LEN);
  const has = (arr, pa) => Array.isArray(arr) && arr.indexOf(pa) !== -1;
  b.set(ARTNET_ID, 0);
  w16le(b, 8, OP_POLL_REPLY);
  b.set(ip, 10);
  w16le(b, 14, ARTNET_PORT);                        // Port: always 0x1936, low byte first
  w16be(b, 16, (o.firmwareVersion == null ? 1 : o.firmwareVersion) & 0xffff); // VersInfoH/L
  b[18] = (ports[0] >> 8) & 0x7f;                    // NetSwitch: Port-Address bits 14-8
  b[19] = (ports[0] >> 4) & 0x0f;                    // SubSwitch: Port-Address bits 7-4
  w16be(b, 20, o.oem == null ? OEM_UNKNOWN : o.oem); // OemHi/OemLo
  b[22] = 0;                                         // UbeaVersion: no UBEA
  b[23] = STATUS1_INDICATORS_NORMAL | STATUS1_PORT_ADDRESS_LOCAL;
  w16le(b, 24, o.estaMan || 0);                      // EstaManLo, EstaManHi
  writeAsciiField(b, 26, 18, o.shortName || 'SetRemote GW');
  writeAsciiField(b, 44, 64, o.longName || 'SetRemote DMX gateway');
  writeAsciiField(b, 108, 64, formatNodeReport(RC_POWER_OK, o.replyCounter || 0, o.nodeReportText || 'OK'));
  w16be(b, 172, ports.length);                       // NumPortsHi/Lo
  for (let i = 0; i < ports.length; i++) {
    const pa = ports[i];
    b[174 + i] = PORT_TYPE_OUTPUT_DMX;
    b[178 + i] = 0;                                  // GoodInput: no input ports
    b[182 + i] = (has(o.activePortAddresses, pa) ? GOOD_OUTPUT_DATA : 0)
      | (has(o.mergingPortAddresses, pa) ? GOOD_OUTPUT_MERGING : 0)
      | (o.ltp ? GOOD_OUTPUT_LTP : 0)
      | (has(o.sacnPortAddresses, pa) ? GOOD_OUTPUT_SACN : 0);
    b[186 + i] = 0;                                  // SwIn
    b[190 + i] = pa & 0x0f;                          // SwOut: Port-Address bits 3-0
    b[213 + i] = GOOD_OUTPUT_B_RDM_DISABLED;         // GoodOutputB
  }
  b[194] = 0;                                        // AcnPriority (sACN output priority; no sACN output)
  b[195] = 0;                                        // SwMacro
  b[196] = 0;                                        // SwRemote
  b[200] = STYLE_NODE;
  b.set(mac, 201);
  b.set(ip, 207);                                    // BindIp
  b[211] = bindIndex;                                // BindIndex: 1 = root device
  b[212] = STATUS2_PORT_ADDRESS_15BIT | (o.dhcp ? STATUS2_DHCP_CAPABLE | STATUS2_DHCP_CONFIGURED : 0);
  b[217] = FAILSAFE[o.failsafe || 'hold'] || 0;     // Status3
  // 218–223 DefaultRespUID (no RDM): zero; 224–225 User: zero
  w16be(b, 226, o.refreshRate == null ? 44 : o.refreshRate); // RefreshRateHi/Lo
  // 228 BackgroundQueuePolicy and 229–238 Filler: zero
  return b;
}

// ─────────────────────────── Builders for simulators and tests ───────────────────────────

/**
 * Build an ArtDmx packet.
 * @param {{portAddress: number, data: ArrayLike<number>, sequence?: number, physical?: number}} p
 */
export function buildArtDmx(p) {
  const n = p.data.length;
  if (n < 1 || n > 512) throw new RangeError('ArtDmx data length must be 1–512');
  const b = new Uint8Array(ARTDMX_HEADER_LEN + n);
  b.set(ARTNET_ID, 0);
  w16le(b, 8, OP_DMX);
  w16be(b, 10, ARTNET_PROTOCOL_VERSION);
  b[12] = (p.sequence || 0) & 0xff;
  b[13] = (p.physical || 0) & 0xff;
  b[14] = p.portAddress & 0xff;
  b[15] = (p.portAddress >> 8) & 0x7f;
  w16be(b, 16, n);
  for (let i = 0; i < n; i++) b[18 + i] = p.data[i];
  return b;
}

/**
 * Build an Art-Net 4 ArtPoll (22 bytes).
 * @param {{flags?: number, diagPriority?: number, targetTop?: number, targetBottom?: number}} [p]
 */
export function buildArtPoll(p) {
  const o = p || {};
  const b = new Uint8Array(22);
  b.set(ARTNET_ID, 0);
  w16le(b, 8, OP_POLL);
  w16be(b, 10, ARTNET_PROTOCOL_VERSION);
  b[12] = o.flags || 0;
  b[13] = o.diagPriority || 0;
  w16be(b, 14, o.targetTop || 0);
  w16be(b, 16, o.targetBottom || 0);
  return b;
}
