"""Generate app icons (yellow sticky note + check) without any dependencies.

Outputs: build/icon.ico, assets/icon.ico, assets/icon.png, assets/tray.png
"""

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TOP = (254, 247, 197)
BOTTOM = (243, 224, 118)
EDGE = (120, 100, 30)
MARK = (58, 53, 29)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def sd_rrect(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ax = max(qx, 0.0)
    ay = max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    l2 = vx * vx + vy * vy
    t = 0.0 if l2 == 0 else clamp((wx * vx + wy * vy) / l2, 0.0, 1.0)
    return math.hypot(wx - t * vx, wy - t * vy)


def lerp(a, b, t):
    return a + (b - a) * t


def render(size):
    s = float(size)
    left = 0.075 * s
    right = s - left
    top = left
    bottom = s - left
    radius = 0.215 * s
    cx = (left + right) / 2.0
    cy = (top + bottom) / 2.0
    hw = (right - left) / 2.0
    hh = (bottom - top) / 2.0

    stroke = [((0.325, 0.525), (0.448, 0.652)), ((0.448, 0.652), (0.672, 0.375))]
    stroke = [((a[0] * s, a[1] * s), (b[0] * s, b[1] * s)) for a, b in stroke]
    half = 0.058 * s

    pixels = bytearray()
    for y in range(size):
        py = y + 0.5
        ty = clamp((py - top) / (bottom - top), 0.0, 1.0)
        for x in range(size):
            px = x + 0.5
            d = sd_rrect(px, py, cx, cy, hw, hh, radius)
            a = clamp(0.5 - d, 0.0, 1.0)
            if a <= 0.0:
                pixels.extend((0, 0, 0, 0))
                continue
            r = lerp(TOP[0], BOTTOM[0], ty)
            g = lerp(TOP[1], BOTTOM[1], ty)
            b = lerp(TOP[2], BOTTOM[2], ty)
            # soft inner rim
            rim = clamp((d + 1.6) / 1.6, 0.0, 1.0) * 0.16
            r = lerp(r, EDGE[0], rim)
            g = lerp(g, EDGE[1], rim)
            b = lerp(b, EDGE[2], rim)

            md = min(seg_dist(px, py, a1[0], a1[1], b1[0], b1[1]) for a1, b1 in stroke)
            m = clamp(half + 0.5 - md, 0.0, 1.0)
            if m > 0.0:
                r = lerp(r, MARK[0], m)
                g = lerp(g, MARK[1], m)
                b = lerp(b, MARK[2], m)

            pixels.extend((int(round(r)), int(round(g)), int(round(b)), int(round(a * 255))))
    return bytes(pixels)


def png_bytes(size):
    raw = render(size)
    rows = []
    stride = size * 4
    for y in range(size):
        rows.append(b"\x00" + raw[y * stride:(y + 1) * stride])
    body = b"".join(rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(body, 9))
        + chunk(b"IEND", b"")
    )


def ico_bytes(sizes):
    images = [(s, png_bytes(s)) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    blob = b""
    for size, data in images:
        entries += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,
            size if size < 256 else 0,
            0,
            0,
            1,
            32,
            len(data),
            offset,
        )
        offset += len(data)
        blob += data
    return header + entries + blob


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    print("wrote", os.path.relpath(path, ROOT), len(data), "bytes")


def main():
    ico = ico_bytes([256, 128, 64, 48, 32, 16])
    write(os.path.join(ROOT, "build", "icon.ico"), ico)
    write(os.path.join(ROOT, "assets", "icon.ico"), ico)
    write(os.path.join(ROOT, "assets", "icon.png"), png_bytes(256))
    write(os.path.join(ROOT, "assets", "tray.png"), png_bytes(32))


if __name__ == "__main__":
    main()
