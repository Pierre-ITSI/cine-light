// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ZIP minimal côté Node pour les tests des projets .setremote (web/js/72-project.js) :
// lecture (vérifie le CRC) et fabrication de fichiers, y compris volontairement faux.
import zlib from 'node:zlib';

export function unzip(buf) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('pas de ZIP');
  const n = buf.readUInt16LE(i + 10);
  let p = buf.readUInt32LE(i + 16);
  const out = new Map();
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('répertoire central');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), cs = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + xl + cl;
    if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('en-tête local');
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(ds, ds + cs);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (zlib.crc32(data) !== crc) throw new Error('CRC ' + name);
    out.set(name, { data, method });
  }
  return out;
}
export const json = (z, name) => JSON.parse(z.get(name).data.toString('utf8'));

// entries : [{ name, data (Buffer | string | objet → JSON), method (8 par défaut), crc?, usize? }]
export function zip(entries) {
  const locals = [], central = [];
  let off = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
    const method = e.method ?? 8;
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const name = Buffer.from(e.name);
    const crc = e.crc ?? zlib.crc32(data), usize = e.usize ?? data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800 | (e.flags || 0), 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800 | (e.flags || 0), 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
// Manifeste minimal d'un projet
export const manifest = (o = {}) => ({ format: 'setremote-project', version: 1, app: '1.0.0', created: '2026-07-17T10:00:00.000Z', name: 'Test', sections: [], counts: {}, files: 0, ...o });
