#!/usr/bin/env python3
"""Génère les icônes PWA de Ciné Light (PNG, stdlib uniquement)."""
import struct, zlib, math

def lerp(a, b, t):
    return a + (b - a) * t

def make_icon(size):
    cx = cy = (size - 1) / 2.0
    half = size / 2.0
    # couleurs
    dark = (14, 14, 16)
    glow_center = (245, 240, 232)
    glow_edge = (184, 141, 74)
    ring_col = (232, 201, 122)
    glow_r = 0.46          # rayon relatif du halo
    ring_r = 0.40          # rayon de l'anneau
    ring_w = 0.018         # épaisseur de l'anneau
    rows = bytearray()
    for y in range(size):
        rows.append(0)     # filtre 0 (None) par scanline
        for x in range(size):
            dx = (x - cx) / half
            dy = (y - cy) / half
            d = math.sqrt(dx * dx + dy * dy)
            r, g, b = dark
            # halo radial doré
            if d < glow_r:
                t = d / glow_r
                gi = (1 - t) ** 1.6
                gc = (lerp(glow_center[0], glow_edge[0], t),
                      lerp(glow_center[1], glow_edge[1], t),
                      lerp(glow_center[2], glow_edge[2], t))
                r = lerp(r, gc[0], gi)
                g = lerp(g, gc[1], gi)
                b = lerp(b, gc[2], gi)
            # anneau fin (diaphragme)
            ring = math.exp(-((d - ring_r) / ring_w) ** 2)
            r = lerp(r, ring_col[0], ring * 0.85)
            g = lerp(g, ring_col[1], ring * 0.85)
            b = lerp(b, ring_col[2], ring * 0.85)
            rows.append(max(0, min(255, int(round(r)))))
            rows.append(max(0, min(255, int(round(g)))))
            rows.append(max(0, min(255, int(round(b)))))
    return png_bytes(size, size, bytes(rows))

def png_bytes(w, h, raw):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    with open(name, "wb") as f:
        f.write(make_icon(size))
    print("écrit", name)
