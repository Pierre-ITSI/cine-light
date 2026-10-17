// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Test helpers: packets built byte by byte from the specification tables,
// independently of the library's own builders, plus a fake clock.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

export const CID = '5f1e7a52-3c4b-4d8e-9a10-2b3c4d5e6f70';
export const CID2 = 'a0b1c2d3-e4f5-4a6b-8c7d-0e1f2a3b4c5d';
const CID_BYTES = (cid) => Uint8Array.from(cid.replace(/-/g, '').match(/../g).map((h) => parseInt(h, 16)));
const utf8 = (s) => new TextEncoder().encode(s);

function flagsLength(b, offset) {
  const len = b.length - offset;
  b[offset] = 0x70 | (len >> 8);
  b[offset + 1] = len & 0xff;
}

function root(b, vector, cid) {
  b[0] = 0x00; b[1] = 0x10;                       // Preamble Size
  b[2] = 0x00; b[3] = 0x00;                       // Post-amble Size
  b.set([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00], 4); // "ASC-E1.17\0\0\0"
  flagsLength(b, 16);
  b[18] = 0; b[19] = 0; b[20] = 0; b[21] = vector; // Root vector
  b.set(CID_BYTES(cid), 22);                      // CID
}

/** E1.31-2018 Table 4-1, E1.31 Data Packet. */
export function sacnData({
  cid = CID, name = 'Console', priority = 100, sync = 0, seq = 0, options = 0, universe = 1, startCode = 0, slots = [],
} = {}) {
  const b = new Uint8Array(126 + slots.length);
  root(b, 0x04, cid);                              // VECTOR_ROOT_E131_DATA
  flagsLength(b, 38);
  b[40] = 0; b[41] = 0; b[42] = 0; b[43] = 0x02;   // VECTOR_E131_DATA_PACKET
  b.set(utf8(name).subarray(0, 63), 44);           // Source Name (64 bytes, NUL padded)
  b[108] = priority;
  b[109] = sync >> 8; b[110] = sync & 0xff;        // Synchronization Address
  b[111] = seq;                                    // Sequence Number
  b[112] = options;                                // Options
  b[113] = universe >> 8; b[114] = universe & 0xff;
  flagsLength(b, 115);
  b[117] = 0x02;                                   // VECTOR_DMP_SET_PROPERTY
  b[118] = 0xa1;                                   // Address Type & Data Type
  b[119] = 0x00; b[120] = 0x00;                    // First Property Address
  b[121] = 0x00; b[122] = 0x01;                    // Address Increment
  b[123] = (slots.length + 1) >> 8; b[124] = (slots.length + 1) & 0xff; // Property value count
  b[125] = startCode;                              // DMX512-A START Code
  b.set(slots, 126);
  return b;
}

/** E1.31-2018 Table 4-2, E1.31 Synchronization Packet (49 bytes). */
export function sacnSync({ cid = CID, seq = 0, syncAddress = 1 } = {}) {
  const b = new Uint8Array(49);
  root(b, 0x08, cid);                              // VECTOR_ROOT_E131_EXTENDED
  flagsLength(b, 38);
  b[43] = 0x01;                                    // VECTOR_E131_EXTENDED_SYNCHRONIZATION
  b[44] = seq;
  b[45] = syncAddress >> 8; b[46] = syncAddress & 0xff;
  return b;                                        // 47–48 reserved
}

/** E1.31-2018 Table 4-3, Universe Discovery Packet. */
export function sacnDiscovery({ cid = CID, name = 'Console', page = 0, lastPage = 0, universes = [] } = {}) {
  const b = new Uint8Array(120 + universes.length * 2);
  root(b, 0x08, cid);
  flagsLength(b, 38);
  b[43] = 0x02;                                    // VECTOR_E131_EXTENDED_DISCOVERY
  b.set(utf8(name).subarray(0, 63), 44);
  flagsLength(b, 112);
  b[117] = 0x01;                                   // VECTOR_UNIVERSE_DISCOVERY_UNIVERSE_LIST
  b[118] = page; b[119] = lastPage;
  universes.forEach((u, i) => { b[120 + 2 * i] = u >> 8; b[121 + 2 * i] = u & 0xff; });
  return b;
}

const ARTNET_ID = [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00]; // "Art-Net\0"

/** Art-Net 4, ArtDmx. */
export function artDmx({ seq = 0, physical = 0, net = 0, subUni = 0, length, data = [], protVer = 14 } = {}) {
  const len = length == null ? data.length : length;
  const b = new Uint8Array(18 + data.length);
  b.set(ARTNET_ID, 0);
  b[8] = 0x00; b[9] = 0x50;                        // OpCode 0x5000, low byte first
  b[10] = protVer >> 8; b[11] = protVer & 0xff;    // ProtVerHi, ProtVerLo
  b[12] = seq; b[13] = physical;
  b[14] = subUni; b[15] = net;                     // SubUni, Net
  b[16] = len >> 8; b[17] = len & 0xff;            // LengthHi, Length
  b.set(data, 18);
  return b;
}

/** Art-Net ArtPoll: 14 bytes (pre-Art-Net 4) or 22 bytes with Art-Net 4 targeted-mode fields. */
export function artPoll({ flags = 0, diagPriority = 0, top, bottom, protVer = 14 } = {}) {
  const art4 = top != null;
  const b = new Uint8Array(art4 ? 22 : 14);
  b.set(ARTNET_ID, 0);
  b[8] = 0x00; b[9] = 0x20;                        // OpCode 0x2000
  b[10] = protVer >> 8; b[11] = protVer & 0xff;
  b[12] = flags; b[13] = diagPriority;
  if (art4) { b[14] = top >> 8; b[15] = top & 0xff; b[16] = bottom >> 8; b[17] = bottom & 0xff; }
  return b;
}

/** Fake monotonic clock. */
export function fakeClock(start = 1000) {
  const c = { t: start, now: () => c.t, advance(ms) { c.t += ms; return c.t; } };
  return c;
}

/** A 512-slot universe with some values set (address is 1-based). */
export function universe(values) {
  const u = new Uint8Array(512);
  for (const [addr, v] of Object.entries(values)) u[Number(addr) - 1] = v;
  return u;
}

// ── Live code of the web app, evaluated in isolation (drift checks) ──
const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '..', '..', '..');

/** Extract a top-level `function name(...) {...}` by brace matching. */
export function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

/**
 * Load named functions from web/js files; null when a file or function is missing.
 * @param {Record<string, string>} wanted  function name → file in web/js
 */
export function loadWebFunctions(wanted) {
  const parts = [];
  for (const [name, file] of Object.entries(wanted)) {
    const p = join(REPO_ROOT, 'web', 'js', file);
    if (!existsSync(p)) return null;
    const fn = extractFunction(readFileSync(p, 'utf8'), name);
    if (!fn) return null;
    parts.push(fn);
  }
  return vm.runInNewContext(parts.join('\n') + '\n({' + Object.keys(wanted).join(',') + '})', {});
}

export function readWebFile(file) {
  const p = join(REPO_ROOT, 'web', 'js', file);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
