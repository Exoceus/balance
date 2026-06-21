#!/usr/bin/env python3
"""Generate Balance extension icons (no external deps — pure stdlib PNG writer).

The mark: a dark rounded square with three stacked pills in green/amber/red —
the three lanes (Enrich / Recharge / Drift). Run: python3 tools/make_icons.py
"""
import os
import struct
import zlib

BG = (0x14, 0x18, 0x24, 255)
BARS = [(0x3f, 0xb9, 0x50, 255), (0xd2, 0xa0, 0x00, 255), (0xe5, 0x53, 0x4b, 255)]
OUT = os.path.join(os.path.dirname(__file__), "..", "icons")


def in_rounded(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def pixel(x, y, size):
    s = size - 1
    # rounded-square background; transparent outside
    if not in_rounded(x, y, 0, 0, s, s, size * 0.22):
        return (0, 0, 0, 0)
    color = BG
    bar_h = size * 0.16
    gap = size * 0.07
    total = 3 * bar_h + 2 * gap
    top = (size - total) / 2
    bx0, bx1 = size * 0.24, size * 0.76
    for i, c in enumerate(BARS):
        y0 = top + i * (bar_h + gap)
        if in_rounded(x, y, bx0, y0, bx1, y0 + bar_h, bar_h / 2):
            color = c
    return color


def chunk(typ, data):
    return (struct.pack(">I", len(data)) + typ + data +
            struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))


def write_png(path, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: none
        for x in range(size):
            raw += bytes(pixel(x, y, size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA, 8-bit
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", os.path.relpath(path))


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 48, 128):
        write_png(os.path.join(OUT, f"icon{size}.png"), size)


if __name__ == "__main__":
    main()
