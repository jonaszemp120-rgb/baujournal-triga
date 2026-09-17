#!/usr/bin/env python3
"""Erzeugt alle Logo-Dateien der App aus der offiziellen Logodatei.

Aufruf:  python3 tools/build_icons.py     (braucht pillow)

Quelle ist assets/triga-logo-master.jpg, die Originaldatei fuer dunkle
Flaechen. Sie liegt als CMYK-JPEG vor. CMYK-JPEG rendert in Browsern
unzuverlaessig, auf iOS teilweise mit falschen Farben, und JPEG setzt an
den harten Kanten des Schriftzugs Artefakte. Deshalb entsteht daraus
ein RGB-PNG, das die App verwendet.

Hintergrund, Rot und Weiss der Datei stimmen exakt mit der Palette der
App ueberein (#00233f, #b20000, #ffffff), der Hintergrund bleibt
deshalb erhalten und fuegt sich nahtlos in die Navy-Flaechen ein.

Ergebnis:
  assets/triga-logo.png        die Wortbildmarke, einzige Logoquelle der App
  assets/icon-{180,192,512}.png  App-Icons, dazu maskable und Favicon

Die App-Icons zeigen bewusst nur das Zeichen ohne Schriftzug. Auf
180 x 180 Pixeln waere "BAUMANAGEMENT" nicht mehr lesbar und das Logo
fiele zu einem grauen Strich zusammen. In der App selbst wird das
Zeichen nirgends allein verwendet.
"""
import os
from PIL import Image

NAVY = (0, 35, 63)
MARK_ANTEIL = 0.62      # Anteil der Icon-Breite, den das Zeichen einnimmt
LOGO_HOEHE = 248        # Hoehe des ausgelieferten PNG, reicht fuer 3x-Displays

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
MASTER = os.path.join(ASSETS, "triga-logo-master.jpg")


def ist_navy(c, tol=14):
    return all(abs(c[i] - NAVY[i]) <= tol for i in range(3))


def inhalt_bbox(im, x0=None, x1=None):
    """Umschliessendes Rechteck alles Nicht-Hintergrunds. Der aeusserste
    Bildrand bleibt aussen vor, dort sitzen JPEG-Artefakte."""
    w, h = im.size
    px = im.load()
    x0 = 2 if x0 is None else x0
    x1 = w - 3 if x1 is None else x1
    xs = [x for x in range(x0, x1 + 1) if any(not ist_navy(px[x, y]) for y in range(2, h - 2))]
    ys = [y for y in range(2, h - 2) if any(not ist_navy(px[x, y]) for x in range(x0, x1 + 1))]
    return (xs[0], ys[0], xs[-1] + 1, ys[-1] + 1)


def spaltenbloecke(im, luecke=40):
    """Zusammenhaengende Inhaltsbereiche von links nach rechts. Trennt
    das Zeichen vom Schriftzug."""
    w, h = im.size
    px = im.load()
    voll = [any(not ist_navy(px[x, y]) for y in range(2, h - 2)) for x in range(2, w - 2)]
    bloecke, start = [], None
    for i, f in enumerate(voll):
        if f and start is None:
            start = i
        elif not f and start is not None:
            bloecke.append((start + 2, i + 1))
            start = None
    if start is not None:
        bloecke.append((start + 2, w - 3))
    zusammen = []
    for a, b in bloecke:
        if zusammen and a - zusammen[-1][1] < luecke:
            zusammen[-1] = (zusammen[-1][0], b)
        else:
            zusammen.append((a, b))
    return zusammen


def logo_png(im):
    """Die Wortbildmarke, eng beschnitten. Die Bildhoehe entspricht damit
    der Hoehe des Zeichens, height im CSS wirkt direkt darauf."""
    box = inhalt_bbox(im)
    eng = im.crop(box)
    breite = round(eng.width * LOGO_HOEHE / eng.height)
    eng = eng.resize((breite, LOGO_HOEHE), Image.LANCZOS)
    # Das Bild kennt drei Farben plus die weichen Kanten dazwischen. Als
    # Palettenbild ist es ein Viertel so gross, sichtbar identisch. Es
    # wird auf jeder Seite geladen und steckt in jedem PDF, das lohnt.
    eng = eng.quantize(colors=16, method=Image.Quantize.MEDIANCUT,
                       dither=Image.Dither.NONE)
    pfad = os.path.join(ASSETS, "triga-logo.png")
    eng.save(pfad, optimize=True)
    return pfad, eng.size


def icons(im):
    """Das Zeichen aus derselben Datei, mittig auf ein Navy-Quadrat."""
    bloecke = spaltenbloecke(im)
    # Der erste Block sind die roten Balken, der zweite die Klammer.
    # Zusammen ergeben sie das Zeichen, der Rest ist der Schriftzug.
    zeichen_x = (bloecke[0][0], bloecke[1][1])
    box = inhalt_bbox(im, *[zeichen_x[0], zeichen_x[1] - 1])
    mark = im.crop(box)

    raus = []
    for groesse, anteil, name in [(180, MARK_ANTEIL, "icon-180.png"),
                                  (192, MARK_ANTEIL, "icon-192.png"),
                                  (512, MARK_ANTEIL, "icon-512.png"),
                                  (1024, MARK_ANTEIL, "icon-1024.png"),
                                  (512, 0.46, "icon-maskable-512.png"),
                                  (32, MARK_ANTEIL, "favicon-32.png")]:
        ss = 4
        n = groesse * ss
        leinwand = Image.new("RGB", (n, n), NAVY)
        breite = round(n * anteil)
        hoehe = round(breite * mark.height / mark.width)
        skaliert = mark.resize((breite, hoehe), Image.LANCZOS)
        leinwand.paste(skaliert, ((n - breite) // 2, (n - hoehe) // 2))
        pfad = os.path.join(ASSETS, name)
        leinwand.resize((groesse, groesse), Image.LANCZOS).save(pfad, optimize=True)
        raus.append(pfad)
    return raus


if __name__ == "__main__":
    im = Image.open(MASTER).convert("RGB")
    pfad, groesse = logo_png(im)
    print(f"{os.path.relpath(pfad, ROOT)}  {groesse[0]}x{groesse[1]}")
    for p in icons(im):
        print(os.path.relpath(p, ROOT))
