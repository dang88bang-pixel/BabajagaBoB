#!/usr/bin/env python3
"""Erzeugt die Testfonts für den Glyph-Auditor (`tests/unit/font-audit.test.ts`).

Warum überhaupt Fixtures? Ein Auditor, der nur an selbst erzeugten
Datenstrukturen getestet wird, prüft sich selbst. Diese Fixtures werden mit
fontTools (dem Referenz-Compiler der Branche) gebaut, damit der Reader gegen
echte SFNT-Binaries antritt:

  * `audit-good.ttf` – saubere Geometrie, korrekte Laufrichtung, ausreichende
    OS/2-Metriken. Der Auditor darf hier *keine* Fehler melden.
  * `audit-broken.ttf` – enthält absichtlich genau die Fehlerklassen, die eine
    Stroke-Expansion ohne Boolean-Union produziert: Überlappungen,
    Selbstschnitte, falsche Laufrichtung, fehlende Extrema, Dagger unterhalb
    von usWinDescent, Krone oberhalb von usWinAscent, Vorschub 0.

Aufruf (nur zum Neuerzeugen der Fixtures nötig, nicht im Testlauf):

    python3 -m venv .venv && .venv/bin/pip install fonttools
    .venv/bin/python scripts/make-font-audit-fixtures.py
"""

from __future__ import annotations

import os

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
DIGITS = "0123456789"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "fonts")


def signed_area(points: list[tuple[int, int]]) -> float:
    total = 0.0
    for index, (x0, y0) in enumerate(points):
        x1, y1 = points[(index + 1) % len(points)]
        total += x0 * y1 - x1 * y0
    return total / 2


def ensure_clockwise(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """TrueType: Außenkonturen laufen im Uhrzeigersinn (negative Fläche, y-up)."""
    return points if signed_area(points) < 0 else list(reversed(points))


def ensure_counter_clockwise(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    return points if signed_area(points) > 0 else list(reversed(points))


def add_contour(pen: TTGlyphPen, points: list[tuple[int, int]]) -> None:
    pen.moveTo(points[0])
    for point in points[1:]:
        pen.lineTo(point)
    pen.closePath()


def frame_glyph(advance: int = 600, weight: int = 100) -> tuple[object, int, int]:
    """Ein rechteckiger Rahmen: korrekt gewickelt, ein Innenraum, konstante Strichbreite."""
    pen = TTGlyphPen(None)
    left, right = 100, 500
    bottom, top = 0, 700
    outer = ensure_clockwise(
        [(left, bottom), (left, top), (right, top), (right, bottom)]
    )
    inner = ensure_counter_clockwise(
        [
            (left + weight, bottom + weight),
            (right - weight, bottom + weight),
            (right - weight, top - weight),
            (left + weight, top - weight),
        ]
    )
    add_contour(pen, outer)
    add_contour(pen, inner)
    return pen.glyph(), advance, left


def bullet_glyph(advance: int = 300) -> tuple[object, int, int]:
    pen = TTGlyphPen(None)
    square = ensure_clockwise([(100, 0), (100, 120), (220, 120), (220, 0)])
    add_contour(pen, square)
    return pen.glyph(), advance, 100


def notdef_glyph() -> object:
    pen = TTGlyphPen(None)
    add_contour(pen, ensure_clockwise([(50, 0), (50, 700), (450, 700), (450, 0)]))
    pen.moveTo((150, 120))
    pen.lineTo((350, 120))
    pen.lineTo((350, 580))
    pen.lineTo((150, 580))
    pen.closePath()
    return pen.glyph()


def build_good(path: str) -> None:
    glyph_order = [".notdef", "space"] + list(LETTERS) + list(DIGITS)
    glyphs: dict[str, object] = {".notdef": notdef_glyph()}
    metrics: dict[str, tuple[int, int]] = {".notdef": (500, 50)}
    cmap: dict[int, str] = {0x20: "space"}
    metrics["space"] = (250, 0)
    glyphs["space"] = TTGlyphPen(None).glyph()

    for character in LETTERS + DIGITS:
        glyph, advance, lsb = frame_glyph()
        glyphs[character] = glyph
        metrics[character] = (advance, lsb)
        cmap[ord(character)] = character

    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap(cmap)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupOS2(
        sTypoAscender=800,
        sTypoDescender=-200,
        sTypoLineGap=200,
        usWinAscent=800,
        usWinDescent=220,
        sxHeight=500,
        sCapHeight=700,
    )
    builder.setupNameTable(
        {
            "familyName": "Audit Good",
            "styleName": "Regular",
            "uniqueFontIdentifier": "Audit Good Regular 1.000",
            "fullName": "Audit Good Regular",
            "psName": "AuditGood-Regular",
            "version": "Version 1.000",
        }
    )
    builder.setupPost()
    builder.save(path)


def build_broken(path: str) -> None:
    glyphs: dict[str, object] = {".notdef": notdef_glyph()}
    metrics: dict[str, tuple[int, int]] = {".notdef": (500, 50)}
    cmap: dict[int, str] = {0x20: "space"}
    glyphs["space"] = TTGlyphPen(None).glyph()
    metrics["space"] = (250, 0)

    # 1) Nicht vereinigte Überlappung: Stamm + Querbalken als zwei Rechtecke.
    pen = TTGlyphPen(None)
    add_contour(pen, ensure_clockwise([(0, 0), (0, 700), (140, 700), (140, 0)]))
    add_contour(pen, ensure_clockwise([(0, 300), (500, 300), (500, 420), (0, 420)]))
    glyphs["A"] = pen.glyph()
    metrics["A"] = (600, 0)
    cmap[ord("A")] = "A"

    # 2) Falsche Laufrichtung: Außenkontur gegen den Uhrzeigersinn.
    pen = TTGlyphPen(None)
    add_contour(pen, ensure_counter_clockwise([(0, 0), (0, 700), (450, 700), (450, 0)]))
    glyphs["B"] = pen.glyph()
    metrics["B"] = (550, 0)
    cmap[ord("B")] = "B"

    # 3) Selbstschnitt: Achterbahn-Kontur (Figur 8).
    pen = TTGlyphPen(None)
    add_contour(
        pen,
        [
            (100, 100),
            (500, 600),
            (500, 100),
            (100, 600),
        ],
    )
    glyphs["C"] = pen.glyph()
    metrics["C"] = (600, 100)
    cmap[ord("C")] = "C"

    # 4) Dagger unter usWinDescent (Drip/Dolch, der abgeschnitten wird).
    pen = TTGlyphPen(None)
    add_contour(
        pen,
        ensure_clockwise(
            [(0, 0), (0, 700), (400, 700), (400, 0), (200, -420)]
        ),
    )
    glyphs["D"] = pen.glyph()
    metrics["D"] = (450, 0)
    cmap[ord("D")] = "D"

    # 5) Krone über usWinAscent.
    pen = TTGlyphPen(None)
    add_contour(pen, ensure_clockwise([(0, 0), (0, 900), (400, 900), (400, 0)]))
    glyphs["E"] = pen.glyph()
    metrics["E"] = (450, 0)
    cmap[ord("E")] = "E"

    # 6) Fehlende Extrema: quadratisches Segment mit Extremwert bei t = 0.5.
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0))
    pen.qCurveTo((300, 700), (600, 0))
    pen.lineTo((600, -50))
    pen.lineTo((0, -50))
    pen.closePath()
    glyphs["F"] = pen.glyph()
    metrics["F"] = (0, 0)  # 7) Vorschub 0
    cmap[ord("F")] = "F"

    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder([".notdef", "space", "A", "B", "C", "D", "E", "F"])
    builder.setupCharacterMap(cmap)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupOS2(
        sTypoAscender=800,
        sTypoDescender=-200,
        sTypoLineGap=200,
        usWinAscent=800,
        usWinDescent=200,
        sxHeight=500,
        sCapHeight=700,
    )
    builder.setupNameTable(
        {
            "familyName": "Audit Broken",
            "styleName": "Regular",
            "uniqueFontIdentifier": "Audit Broken Regular 1.000",
            "fullName": "Audit Broken Regular",
            "psName": "AuditBroken-Regular",
            "version": "Version 1.000",
        }
    )
    builder.setupPost()
    builder.save(path)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    build_good(os.path.join(OUT_DIR, "audit-good.ttf"))
    build_broken(os.path.join(OUT_DIR, "audit-broken.ttf"))
    print("Fixtures geschrieben nach", os.path.normpath(OUT_DIR))


if __name__ == "__main__":
    main()
