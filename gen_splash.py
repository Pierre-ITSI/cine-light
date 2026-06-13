#!/usr/bin/env python3
"""Génère les écrans de lancement iOS (apple-touch-startup-image) + les balises <link>."""
import struct, zlib, math

def png_bytes(w, h, raw):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

def make_splash(W, H):
    rowlen = 1 + W * 3
    raw = bytearray(rowlen * H)          # zéros = filtre 0 + fond noir pur (#000)
    cx, cy = (W - 1) / 2.0, (H - 1) / 2.0
    m = min(W, H)
    RH = m * 0.17                         # rayon du halo
    RR = m * 0.15                         # rayon de l'anneau
    sigma = m * 0.0065
    reach = RH * 1.18
    gc, ge, rc = (245, 240, 232), (184, 141, 74), (232, 201, 122)
    x0, x1 = max(0, int(cx - reach)), min(W, int(cx + reach) + 1)
    y0, y1 = max(0, int(cy - reach)), min(H, int(cy + reach) + 1)
    for y in range(y0, y1):
        base = y * rowlen + 1
        dy = y - cy
        for x in range(x0, x1):
            dx = x - cx
            d = math.hypot(dx, dy)
            r = g = b = 0.0
            if d < RH:
                t = d / RH
                gi = (1 - t) ** 1.6
                r = (gc[0] + (ge[0] - gc[0]) * t) * gi
                g = (gc[1] + (ge[1] - gc[1]) * t) * gi
                b = (gc[2] + (ge[2] - gc[2]) * t) * gi
            ring = math.exp(-((d - RR) / sigma) ** 2)
            if ring > 0.003:
                r += (rc[0] - r) * ring * 0.9
                g += (rc[1] - g) * ring * 0.9
                b += (rc[2] - b) * ring * 0.9
            if r or g or b:
                o = base + x * 3
                raw[o] = min(255, int(r)); raw[o+1] = min(255, int(g)); raw[o+2] = min(255, int(b))
    return png_bytes(W, H, bytes(raw))

# (cssW, cssH, ratio) — iPhones courants (~2017→2024)
DEVICES = [
    (320, 568, 2), (375, 667, 2), (414, 736, 3), (375, 812, 3), (390, 844, 3),
    (393, 852, 3), (414, 896, 2), (414, 896, 3), (428, 926, 3), (430, 932, 3),
]

links = []
made = set()
for cssW, cssH, ratio in DEVICES:
    pw, ph = cssW * ratio, cssH * ratio   # physique portrait
    for orient, (W, H) in (("portrait", (pw, ph)), ("landscape", (ph, pw))):
        fn = "splash-%dx%d.png" % (W, H)
        if fn not in made:
            with open(fn, "wb") as f:
                f.write(make_splash(W, H))
            made.add(fn)
        media = ("(device-width: %dpx) and (device-height: %dpx) and "
                 "(-webkit-device-pixel-ratio: %d) and (orientation: %s)" % (cssW, cssH, ratio, orient))
        links.append('<link rel="apple-touch-startup-image" media="%s" href="%s">' % (media, fn))

with open("splash_links.html", "w") as f:
    f.write("\n".join(links) + "\n")
print("Généré %d images, %d balises" % (len(made), len(links)))
