// Décodeur PNG minimal (zéro dépendance) + comparaison pixel à pixel.
// Couvre ce que produit Chromium : 8 bits, non entrelacé, types de couleur
// 0 (gris), 2 (RVB), 4 (gris+alpha), 6 (RVBA), filtres 0 à 4.
import { inflateSync } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('PNG invalide');
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = CHANNELS[ctype];
  if (depth !== 8 || !ch || interlace) throw new Error(`PNG non géré (profondeur ${depth}, type ${ctype}, entrelacé ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride), pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride)); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * ch, d = (y * width + x) * 4;
      if (ch === 1 || ch === 2) { out[d] = out[d + 1] = out[d + 2] = line[s]; out[d + 3] = ch === 2 ? line[s + 1] : 255; }
      else { out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]; out[d + 3] = ch === 4 ? line[s + 3] : 255; }
    }
    prev = line;
  }
  return { width, height, data: out };
}

// Nombre de pixels différents (tolérance par canal, 0 = strict).
export function diffPng(bufA, bufB, tolerance = 0) {
  if (bufA.equals(bufB)) return { identical: true, diffPixels: 0, total: 0, sameSize: true };
  const A = decodePng(bufA), B = decodePng(bufB);
  if (A.width !== B.width || A.height !== B.height) {
    return { identical: false, diffPixels: Infinity, total: A.width * A.height, sameSize: false,
      sizes: `${A.width}×${A.height} ≠ ${B.width}×${B.height}` };
  }
  let n = 0, maxDelta = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]),
      Math.abs(A.data[i + 2] - B.data[i + 2]), Math.abs(A.data[i + 3] - B.data[i + 3]));
    if (d > tolerance) n++;
    if (d > maxDelta) maxDelta = d;
  }
  return { identical: n === 0, diffPixels: n, maxDelta, total: A.width * A.height, sameSize: true };
}

// Bruit de rastérisation toléré : quelques pixels d'anticrénelage (coins
// arrondis) peuvent varier de ±1 d'un rendu à l'autre. Tout écart plus grand,
// ou touchant plus de NOISE_MAX_PIXELS pixels, reste un changement visuel.
export const NOISE_MAX_PIXELS = 16;
export function visuallyEqual(d) {
  return d.identical || (d.sameSize && d.maxDelta <= 1 && d.diffPixels <= NOISE_MAX_PIXELS);
}
