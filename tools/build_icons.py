#!/usr/bin/env python3
"""Erzeugt die TRIGA-Marke als SVG und die PWA-Icons als PNG.

Aufruf:  python3 tools/build_icons.py

Die Geometrie ist der pixelgenaue Vektor-Nachbau der Originalmarke,
viewBox 0 0 320 296: drei rote Balken links, die Klammer rechts.
Durchgehend Marken-Rot #b20000, bewusst kein zweiter Rot-Ton.
Die Klammer gibt es in Navy (heller Hintergrund) und Weiss (Navy-Flaeche).

Alle Pfade bestehen ausschliesslich aus Geraden, deshalb genuegt Pillow
zum Rastern, es braucht keinen SVG-Renderer.
"""
import os

NAVY = "#00233f"
RED = "#b20000"
WHITE = "#ffffff"

VB_W, VB_H = 320, 296

RED_BARS = [
    [(10, 223), (10, 255), (141, 285), (139, 253)],
    [(10, 130), (10, 161), (141, 161), (140, 130)],
    [(141, 10), (12, 40), (10, 72), (140, 42)],
]
BRACKET = [
    (182, 10), (182, 42), (251, 54), (251, 129), (182, 131), (182, 161),
    (251, 162), (251, 241), (182, 254), (182, 285), (282, 268), (283, 28),
]

MARK_SCALE = 0.62        # Anteil der Icon-Breite, den die Marke einnimmt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def _d(poly):
    head = f"M{poly[0][0]},{poly[0][1]}"
    rest = " ".join(f"L{x},{y}" for x, y in poly[1:])
    return f"{head} {rest} Z"


def write_svg(path, bracket_fill):
    paths = "\n".join(f'  <path fill="{RED}" d="{_d(b)}"/>' for b in RED_BARS)
    paths += f'\n  <path fill="{bracket_fill}" d="{_d(BRACKET)}"/>'
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VB_W} {VB_H}" '
        f'role="img" aria-label="TRIGA">\n{paths}\n</svg>\n'
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)
    return path


def write_png(path, size, scale=MARK_SCALE, bg=NAVY, bracket=WHITE):
    from PIL import Image, ImageDraw
    ss = 4
    n = size * ss
    img = Image.new("RGBA", (n, n), bg if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = n * scale / VB_W
    ox = (n - VB_W * k) / 2.0
    oy = (n - VB_H * k) / 2.0
    tf = lambda poly: [(x * k + ox, y * k + oy) for x, y in poly]
    for bar in RED_BARS:
        d.polygon(tf(bar), fill=RED)
    d.polygon(tf(BRACKET), fill=bracket)
    img.resize((size, size), Image.LANCZOS).save(path)
    return path


if __name__ == "__main__":
    os.makedirs(ASSETS, exist_ok=True)
    out = [
        write_svg(os.path.join(ASSETS, "triga-mark-light.svg"), WHITE),
        write_svg(os.path.join(ASSETS, "triga-mark-navy.svg"), NAVY),
    ]
    for size in (180, 192, 512, 1024):
        out.append(write_png(os.path.join(ASSETS, f"icon-{size}.png"), size))
    # maskable: mehr Luft, damit Androids Zuschnitt die Marke nicht anschneidet
    out.append(write_png(os.path.join(ASSETS, "icon-maskable-512.png"), 512, scale=0.46))
    out.append(write_png(os.path.join(ASSETS, "favicon-32.png"), 32))
    for p in out:
        print(os.path.relpath(p, ROOT))
