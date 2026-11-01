import {readFileSync} from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {auditFont, formatAuditMarkdown} from "@/lib/font/audit";
import {
  contourToPolygon,
  countSelfIntersections,
  findMissingExtrema,
  pointInPolygon,
  segmentsCross,
  signedArea
} from "@/lib/font/geometry";
import {measureStroke} from "@/lib/font/raster";
import {parseFont, SfntError} from "@/lib/font/sfnt";

/**
 * Der Glyph-Auditor ist das Messinstrument für „ist das Alphabet gut?“.
 * Getestet wird er gegen zwei mit fontTools gebaute Echt-Binaries
 * (`tests/fixtures/fonts`, erzeugt mit `scripts/make-font-audit-fixtures.py`):
 *
 *  - `audit-good.ttf`  → darf keine Fehler produzieren.
 *  - `audit-broken.ttf` → enthält jede Fehlerklasse absichtlich; jede muss
 *    erkannt und dem richtigen Zeichen zugeordnet werden.
 *
 * Zusätzlich werden die Geometrie-Primitive einzeln geprüft, weil die
 * Aussagekraft des Auditors genau an ihnen hängt.
 */

const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "fonts");

function loadFont(name: string): ArrayBuffer {
  const buffer = readFileSync(path.join(FIXTURE_DIR, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

const goodFont = () => loadFont("audit-good.ttf");
const brokenFont = () => loadFont("audit-broken.ttf");

describe("sfnt-Reader", () => {
  it("liest Kopf-, Namens-, Cmap- und Metriktabellen einer echten TTF", () => {
    const font = parseFont(goodFont());

    expect(font.flavor).toBe("truetype");
    expect(font.unitsPerEm).toBe(1000);
    expect(font.numGlyphs).toBe(38);
    expect(font.names.get(1)).toBe("Audit Good");
    expect(font.names.get(6)).toBe("AuditGood-Regular");
    expect(font.cmapFormat).toBe(4);
    expect(font.hhea.ascender).toBe(800);
    expect(font.os2?.usWinAscent).toBe(800);
    expect(font.os2?.usWinDescent).toBe(220);

    const glyphIdOfA = font.cmap.get(0x41);
    expect(glyphIdOfA).toBeGreaterThan(0);
    const glyphA = font.glyphs[glyphIdOfA!];
    expect(glyphA.contours.length).toBe(2);
    expect(glyphA.advanceWidth).toBe(600);
    expect(glyphA.bbox).toEqual({xMin: 100, yMin: 0, xMax: 500, yMax: 700});
  });

  it("weist strukturell kaputte Dateien mit SfntError ab", () => {
    expect(() => parseFont(new Uint8Array(4).buffer)).toThrow(SfntError);

    const truncated = loadFont("audit-good.ttf").slice(0, 40);
    expect(() => parseFont(truncated)).toThrow(SfntError);

    const garbage = new Uint8Array(512);
    garbage.fill(0x42);
    expect(() => parseFont(garbage.buffer)).toThrow(SfntError);
  });
});

describe("Geometrie-Primitive", () => {
  it("berechnet die Laufrichtung über die vorzeichenbehaftete Fläche", () => {
    const clockwise = [
      {x: 0, y: 0},
      {x: 0, y: 100},
      {x: 100, y: 100},
      {x: 100, y: 0}
    ];
    const counterClockwise = [...clockwise].reverse();

    expect(signedArea(clockwise)).toBeLessThan(0);
    expect(signedArea(counterClockwise)).toBeGreaterThan(0);
  });

  it("erkennt Selbstschnitte in einer Achter-Kontur", () => {
    const figureEight = [
      {x: 100, y: 100},
      {x: 500, y: 600},
      {x: 500, y: 100},
      {x: 100, y: 600}
    ];
    expect(countSelfIntersections(figureEight)).toBeGreaterThan(0);
    expect(
      countSelfIntersections([
        {x: 0, y: 0},
        {x: 0, y: 100},
        {x: 100, y: 100},
        {x: 100, y: 0}
      ])
    ).toBe(0);
  });

  it("unterscheidet echte Kreuzung von gemeinsamen Eckpunkten", () => {
    const a = {x: 0, y: 0};
    const b = {x: 100, y: 100};
    const c = {x: 100, y: 0};
    const d = {x: 0, y: 100};

    expect(segmentsCross(a, b, c, d)).toBe(true); // X-Kreuzung
    expect(segmentsCross(a, b, b, c)).toBe(false); // gemeinsamer Eckpunkt
    expect(segmentsCross({x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: -50}, {x: 50, y: 50})).toBe(true); // T-Stoß
  });

  it("wandelt TrueType-Konturen mit impliziten Off-Curve-Punkten in Polygone", () => {
    const contour = [
      {x: 0, y: 0, onCurve: true},
      {x: 100, y: 200, onCurve: false},
      {x: 200, y: 0, onCurve: true}
    ];
    const polygon = contourToPolygon(contour, 8);

    expect(polygon.length).toBe(9);
    // Der Bogen läuft durch den impliziten Scheitel (100, 100).
    const apex = polygon.reduce((best, point) => (point.y > best.y ? point : best), polygon[0]);
    expect(apex.x).toBeCloseTo(100, 0);
    expect(apex.y).toBeCloseTo(100, 0);
    expect(pointInPolygon({x: 100, y: 50}, polygon)).toBe(true);
    expect(pointInPolygon({x: 100, y: 150}, polygon)).toBe(false);
  });

  it("findet Extremwerte mitten im Segment", () => {
    const missing = findMissingExtrema([
      {x: 0, y: 0, onCurve: true},
      {x: 300, y: 700, onCurve: false},
      {x: 600, y: 0, onCurve: true}
    ]);
    expect(missing.length).toBeGreaterThan(0);
    // Der Bogen hat seinen Scheitel bei t = 0.5 in y-Richtung; x verläuft monoton.
    expect(missing[0].axis).toBe("y");

    const withExtremum = findMissingExtrema([
      {x: 0, y: 0, onCurve: true},
      {x: 200, y: 400, onCurve: false},
      {x: 300, y: 500, onCurve: true},
      {x: 400, y: 400, onCurve: false},
      {x: 600, y: 0, onCurve: true}
    ]);
    expect(withExtremum.length).toBe(0);
  });
});

describe("Strichbreitenmessung", () => {
  it("misst einen 100-Unit-Rahmen als ~100 Units Strichbreite", () => {
    const outer = [
      {x: 0, y: 0},
      {x: 0, y: 700},
      {x: 600, y: 700},
      {x: 600, y: 0}
    ];
    const inner = [
      {x: 100, y: 100},
      {x: 500, y: 100},
      {x: 500, y: 600},
      {x: 100, y: 600}
    ];
    const measure = measureStroke([outer, inner], 1000, {pixelsPerEm: 128});

    expect(measure.medianStrokeWidth).toBeGreaterThan(90);
    expect(measure.medianStrokeWidth).toBeLessThan(112);
    // Ecken der Distanzkarte erzeugen legitime Streuung – der Rahmen bleibt aber ruhig.
    expect(measure.relativeSpread).toBeLessThan(0.25);
    expect(measure.samples).toBeGreaterThan(10);
  });
});

describe("Audit: saubere Schrift", () => {
  const report = auditFont(goodFont());

  it("meldet keine Fehler und bewertet die Datei als produktionsreif", () => {
    const errors = report.findings.filter((finding) => finding.severity === "error");
    expect(errors).toEqual([]);
    expect(report.verdict).toBe("produktionsreif");
    expect(report.score.total).toBeGreaterThanOrEqual(90);
  });

  it("bestätigt vollständige Zeichenabdeckung und konsistente Strichstärke", () => {
    expect(report.coverage.missingLetters).toEqual([]);
    expect(report.coverage.missingDigits).toEqual([]);
    expect(report.coverage.letters.length).toBe(26);
    expect(report.style.coeffOfVariation).toBeLessThan(0.05);
    expect(report.style.medianStrokeWidth).toBeGreaterThan(90);
    expect(report.style.medianStrokeWidth).toBeLessThan(112);
  });

  it("hält die vertikalen Metriken innerhalb von OS/2 usWin*", () => {
    expect(report.font.maxGlyphY).toBeLessThanOrEqual(report.font.winAscent);
    expect(report.font.minGlyphY).toBeGreaterThanOrEqual(-report.font.winDescent);
  });
});

describe("Audit: fehlerhafte Schrift", () => {
  const report = auditFont(brokenFont());
  const byId = (id: string) => report.findings.find((finding) => finding.id === id);

  it("erkennt nicht vereinigte Überlappungen und ordnet sie dem Zeichen zu", () => {
    const finding = byId("geometrie.ueberlappung");
    expect(finding?.severity).toBe("error");
    expect(finding?.affected).toContain("A");
  });

  it("erkennt Selbstschnitte", () => {
    const finding = byId("geometrie.selbstschnitt");
    expect(finding?.severity).toBe("error");
    expect(finding?.affected).toContain("C");
  });

  it("erkennt falsche Laufrichtung (B ist gegen den Uhrzeigersinn gewickelt)", () => {
    const finding = byId("geometrie.laufrichtung");
    expect(finding?.severity).toBe("error");
    expect(finding?.affected).toContain("B");
    // Überlappende Glyphen (A) werden nicht zusätzlich als Wickelfehler gemeldet.
    expect(finding?.affected).not.toContain("A");
  });

  it("erkennt fehlende Extrema", () => {
    const finding = byId("geometrie.extrema.fehlt");
    expect(finding?.severity).toBe("warning");
    expect(finding?.affected).toContain("F");
  });

  it("erkennt abgeschnittene Kronen und Daggers", () => {
    expect(byId("metrik.clipping.oben")?.affected).toContain("E");
    expect(byId("metrik.clipping.unten")?.affected).toContain("D");
    expect(byId("metrik.clipping.oben")?.values?.maxGlyphY).toBe(900);
    expect(byId("metrik.clipping.unten")?.values?.minGlyphY).toBe(-420);
  });

  it("erkennt Vorschub 0, Kollisionen und fehlende Abdeckung", () => {
    expect(byId("metrik.vorschub.null")?.affected).toContain("F");
    expect(byId("metrik.abstand.kollision")).toBeDefined();
    expect(byId("struktur.coverage.buchstaben")?.severity).toBe("error");
  });

  it("stuft die Datei nicht als produktionsreif ein", () => {
    expect(report.verdict).not.toBe("produktionsreif");
    expect(report.score.byCategory.geometrie).toBeLessThan(30);
    expect(report.score.byCategory.metrik).toBeLessThan(25);
  });

  it("liefert einen lesbaren Markdown-Bericht", () => {
    const markdown = formatAuditMarkdown(report);
    expect(markdown).toContain("# Font-Audit: Audit Broken Regular");
    expect(markdown).toContain("geometrie.ueberlappung");
    expect(markdown).toContain("nicht-exportfähig");
    expect(markdown).toContain("| unitsPerEm | 1000 |");
  });
});
