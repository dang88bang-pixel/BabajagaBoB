/**
 * Glyph-Auditor für generierte TrueType-Schriften.
 *
 * Der Auditor beantwortet die Frage, die man einer Vorschau nicht ansieht:
 * *Ist die Binärdatei, die aus der Pipeline kommt, wirklich brauchbar?*
 * Geprüft werden die Fehlerklassen, die genau bei einer
 * „Skeleton → Stroke-Expansion → TTF“-Kette typisch sind:
 *
 *  - Konturen, die nicht vereinigt wurden (Überlappungen, Selbstschnitte)
 *  - falsche oder gemischte Laufrichtung (Löcher werden gefüllt)
 *  - fehlende Extremwert-Knoten (unsaubere Rasterung kleiner Grade)
 *  - abgeschnittene Dagger-/Drip-Ausläufer durch zu kleine `OS/2`-Metriken
 *  - Vorschubbreiten und Seitenlagen, die zu Kollisionen führen
 *  - inkonsistente Strichstärke (Stilbruch innerhalb des Alphabets)
 *  - fehlende Kerning-/OpenType-Daten und Farbschichten (COLR/CPAL)
 *  - Schablonen-Tauglichkeit (Inseln ohne Steg)
 *
 * Die Prüfung ist deterministisch und braucht keine externen Dienste.
 */

import {parseFont, type ParsedFont} from "./sfnt";
import {
  contourToPolygon,
  contoursIntersect,
  countSelfIntersections,
  findMissingExtrema,
  pointInPolygon,
  signedArea,
  type Vec2
} from "./geometry";
import {measureStroke} from "./raster";

export type Severity = "error" | "warning" | "info";
export type Category = "struktur" | "geometrie" | "metrik" | "stil" | "features" | "stencil";

export interface Finding {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  detail: string;
  /** Betroffene Zeichen (max. 12, danach „…“). */
  affected?: string[];
  /** Rohwerte für maschinelle Auswertung. */
  values?: Record<string, number | string>;
}

export interface GlyphAudit {
  gid: number;
  unicode: number | null;
  label: string;
  isComposite: boolean;
  contourCount: number;
  counterCount: number;
  selfIntersections: number;
  crossIntersections: number;
  windingConsistent: boolean;
  missingExtrema: number;
  degenerateContours: number;
  strokeWidth: number;
  strokeSpread: number;
  inkArea: number;
  advanceWidth: number;
  leftSideBearing: number;
  rightSideBearing: number;
  bbox: {xMin: number; yMin: number; xMax: number; yMax: number} | null;
}

export interface FontSummary {
  familyName: string;
  subfamilyName: string;
  fullName: string;
  postScriptName: string;
  unitsPerEm: number;
  numGlyphs: number;
  flavor: string;
  cmapFormat: number;
  byteLength: number;
  tables: string[];
  ascender: number;
  descender: number;
  typoAscender: number;
  typoDescender: number;
  winAscent: number;
  winDescent: number;
  maxGlyphY: number;
  minGlyphY: number;
  kernPairs: number;
  hasGpos: boolean;
  hasGsub: boolean;
  axes: {tag: string; min: number; default: number; max: number}[];
  colorLayers: number;
  palettes: number;
}

export interface AuditReport {
  font: FontSummary;
  glyphs: GlyphAudit[];
  findings: Finding[];
  coverage: {
    letters: string[];
    missingLetters: string[];
    digits: string[];
    missingDigits: string[];
    punctuation: string[];
    missingPunctuation: string[];
  };
  style: {
    medianStrokeWidth: number;
    coeffOfVariation: number;
    contrastRatio: number;
    inkAreaCv: number;
    perGlyph: {label: string; strokeWidth: number; inkArea: number}[];
  };
  spacing: {
    pairCount: number;
    collisions: {left: string; right: string; gap: number}[];
    minGap: number;
    maxGap: number;
    gapCv: number;
  };
  score: {
    total: number;
    byCategory: Record<Category, number>;
    weights: Record<Category, number>;
  };
  verdict: "produktionsreif" | "nutzbar-mit-nacharbeiten" | "nicht-exportfähig";
}

export interface AuditOptions {
  /** Zielabstand zwischen zwei Buchstaben in Font-Units (Standard: 0,08 em). */
  targetGapRatio?: number;
  /** Auflösung für die Strichmessung (Pixel pro em). */
  pixelsPerEm?: number;
}

const REQUIRED_TABLES = ["head", "hhea", "maxp", "OS/2", "hmtx", "cmap", "name", "post"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const DIGITS = "0123456789".split("");
const PUNCTUATION = [".", ",", "!", "?", "-", "'", '"', "/", ":", ";", "&", "(", ")", "#", "@", "+", "%"];
const CATEGORY_WEIGHTS: Record<Category, number> = {
  struktur: 20,
  geometrie: 30,
  metrik: 25,
  stil: 15,
  features: 5,
  stencil: 5
};
const STROKE_CV_LIMIT = 0.22;
const GAP_CV_LIMIT = 0.35;
const MIN_STEM_FOR_STENCIL = 45;

function labelFor(parsed: ParsedFont, gid: number, reverseCmap: Map<number, number>): string {
  const unicode = reverseCmap.get(gid);
  if (unicode === undefined) return `gid${gid}`;
  const char = String.fromCodePoint(unicode);
  if (char === " ") return "␠";
  if (unicode < 0x20 || unicode === 0x7f) return `U+${unicode.toString(16).toUpperCase().padStart(4, "0")}`;
  return char;
}

function reverseCmapOf(parsed: ParsedFont): Map<number, number> {
  const reverse = new Map<number, number>();
  for (const [unicode, gid] of parsed.cmap) {
    // Für die Anzeige bevorzugen wir den kleinsten Codepoint pro Glyphe.
    if (!reverse.has(gid) || unicode < (reverse.get(gid) as number)) reverse.set(gid, unicode);
  }
  return reverse;
}

function pushFinding(list: Finding[], finding: Finding): void {
  list.push(finding);
}

function limitList(values: string[], max = 12): string[] {
  return values.length > max ? [...values.slice(0, max), `… (${values.length - max} weitere)`] : values;
}

/** „1 Glyphe“ / „7 Glyphen“ – der Report wird gelesen, also soll er klingen. */
function glyphCount(count: number): string {
  return count === 1 ? "1 Glyphe" : `${count} Glyphen`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Hauptfunktion: parst die Datei und liefert einen vollständigen Bericht.
 */
export function auditFont(input: ArrayBuffer | Uint8Array, options: AuditOptions = {}): AuditReport {
  const parsed = parseFont(input);
  const unitsPerEm = parsed.unitsPerEm;
  const targetGap = (options.targetGapRatio ?? 0.08) * unitsPerEm;
  const pixelsPerEm = options.pixelsPerEm ?? 96;
  const reverseCmap = reverseCmapOf(parsed);
  const findings: Finding[] = [];

  // ---------------------------------------------------------------- Struktur
  if (parsed.flavor === "cff" || parsed.features.hasCff || parsed.features.hasCff2) {
    pushFinding(findings, {
      id: "audit.scope.cff-nicht-dekodiert",
      severity: "warning",
      category: "struktur",
      title: "CFF-Outlines werden nicht geprüft",
      detail:
        "Die Datei enthält PostScript-Outlines (CFF/CFF2). Der Auditor prüft Tabellen und Metriken, aber nicht die Konturen. Für eine vollständige Geometrieprüfung die Pipeline auf TrueType-Outlines (`glyf`) umstellen oder die Datei vorher mit FontForge/fontTools nach TTF konvertieren."
    });
  }

  for (const tag of REQUIRED_TABLES) {
    if (!parsed.tables.has(tag)) {
      pushFinding(findings, {
        id: `struktur.tabelle.${tag}`,
        severity: tag === "OS/2" || tag === "name" ? "warning" : "error",
        category: "struktur",
        title: `Tabelle '${tag}' fehlt`,
        detail:
          tag === "OS/2"
            ? "Ohne OS/2 fehlen Windows-Metriken; DirectWrite und viele Browser behandeln die Schrift dann unvorhersehbar."
            : `Die Tabelle '${tag}' ist für eine gültige OpenType-Datei erforderlich.`
      });
    }
  }

  if (![1000, 2048].includes(unitsPerEm)) {
    pushFinding(findings, {
      id: "struktur.em.ungewoehnlich",
      severity: "warning",
      category: "struktur",
      title: `unitsPerEm = ${unitsPerEm}`,
      detail: "Üblich sind 1000 (PostScript) oder 2048 (TrueType). Andere Werte funktionieren, erschweren aber Hinting und Metrik-Abgleich."
    });
  }

  const familyName = parsed.names.get(1) ?? "";
  const subfamilyName = parsed.names.get(2) ?? "";
  if (!familyName) {
    pushFinding(findings, {
      id: "struktur.name.family-fehlt",
      severity: "error",
      category: "struktur",
      title: "Kein Familienname (name-ID 1)",
      detail: "Ohne name-ID 1 zeigen Betriebssysteme die Schrift als „Unnamed“ an und installieren sie unter Umständen gar nicht."
    });
  }

  const os2 = parsed.os2;
  const winAscent = os2?.usWinAscent ?? parsed.hhea.ascender;
  const winDescent = os2?.usWinDescent ?? Math.abs(parsed.hhea.descender);

  // ---------------------------------------------------------------- Glyphen
  const glyphAudits: GlyphAudit[] = [];
  const overlapGlyphs: string[] = [];
  const selfIntersectionGlyphs: string[] = [];
  const windingGlyphs: string[] = [];
  const extremaGlyphs: string[] = [];
  const degenerateGlyphs: string[] = [];
  const negativeBearingGlyphs: string[] = [];
  const zeroAdvanceGlyphs: string[] = [];
  const clippingTop: string[] = [];
  const clippingBottom: string[] = [];

  let maxGlyphY = -Infinity;
  let minGlyphY = Infinity;

  for (const glyph of parsed.glyphs) {
    const label = labelFor(parsed, glyph.index, reverseCmap);
    const glyphStrokeWidths: number[] = [];
    let strokeWidth = 0;
    let strokeSpread = 0;
    let inkArea = 0;
    let selfIntersections = 0;
    let crossIntersections = 0;
    let missingExtrema = 0;
    let degenerate = 0;
    let windingConsistent = true;
    let counterCount = 0;
    const polygons: Vec2[][] = [];

    if (glyph.contours.length > 0 && !glyph.isComposite) {
      const contours = glyph.contours.filter((contour) => contour.length >= 2);
      const areas: number[] = [];
      const polygonList: Vec2[][] = [];

      for (const contour of contours) {
        const polygon = contourToPolygon(contour, 8);
        if (polygon.length < 3) {
          degenerate++;
          continue;
        }
        const area = signedArea(polygon);
        if (Math.abs(area) < 1) degenerate++;
        areas.push(area);
        polygonList.push(polygon);
        polygons.push(polygon);
        selfIntersections += countSelfIntersections(polygon);
        missingExtrema += findMissingExtrema(contour).length;
      }

      // Überlappungen zwischen Konturen (= nicht vereinigte Expansionspfade)
      for (let i = 0; i < polygonList.length; i++) {
        for (let j = i + 1; j < polygonList.length; j++) {
          if (contoursIntersect(polygonList[i], polygonList[j])) crossIntersections++;
        }
      }

      // Laufrichtung: gerade Verschachtelungstiefe = Außenkontur (TrueType: im
      // Uhrzeigersinn, also negative Fläche), ungerade = Innenkontur.
      // Bei überlappenden oder selbstschneidenden Konturen ist „innen/außen“
      // geometrisch nicht definiert – dann wird die Richtung nicht bewertet.
      const windingDecidable = crossIntersections === 0 && selfIntersections === 0;
      for (let i = 0; windingDecidable && i < polygonList.length; i++) {
        const probe = polygonList[i][0];
        let depth = 0;
        for (let j = 0; j < polygonList.length; j++) {
          if (i === j) continue;
          if (pointInPolygon(probe, polygonList[j])) depth++;
        }
        if (depth % 2 === 1) counterCount++;
        const expectsClockwise = depth % 2 === 0;
        const isClockwise = areas[i] < 0;
        if (expectsClockwise !== isClockwise) windingConsistent = false;
      }

      if (polygons.length > 0) {
        const measure = measureStroke(polygons, unitsPerEm, {pixelsPerEm});
        strokeWidth = Math.round(measure.medianStrokeWidth);
        strokeSpread = measure.relativeSpread;
        inkArea = Math.round(measure.area);
        glyphStrokeWidths.push(measure.medianStrokeWidth);
      }
    }

    const bbox = glyph.bbox;
    if (bbox) {
      if (bbox.yMax > maxGlyphY) maxGlyphY = bbox.yMax;
      if (bbox.yMin < minGlyphY) minGlyphY = bbox.yMin;
      if (bbox.yMax > winAscent) clippingTop.push(label);
      if (bbox.yMin < -winDescent) clippingBottom.push(label);
    }

    const advanceWidth = glyph.advanceWidth;
    const leftSideBearing = glyph.leftSideBearing;
    const rightSideBearing = bbox ? advanceWidth - bbox.xMax : advanceWidth;
    if (bbox && (leftSideBearing < -2 || rightSideBearing < -2)) negativeBearingGlyphs.push(label);
    if (bbox && advanceWidth <= 0) zeroAdvanceGlyphs.push(label);

    if (selfIntersections > 0) selfIntersectionGlyphs.push(label);
    if (crossIntersections > 0) overlapGlyphs.push(label);
    if (!windingConsistent) windingGlyphs.push(label);
    if (missingExtrema > 0) extremaGlyphs.push(label);
    if (degenerate > 0) degenerateGlyphs.push(label);

    glyphAudits.push({
      gid: glyph.index,
      unicode: reverseCmap.get(glyph.index) ?? null,
      label,
      isComposite: glyph.isComposite,
      contourCount: glyph.contours.length,
      counterCount,
      selfIntersections,
      crossIntersections,
      windingConsistent,
      missingExtrema,
      degenerateContours: degenerate,
      strokeWidth,
      strokeSpread: Number(strokeSpread.toFixed(3)),
      inkArea,
      advanceWidth,
      leftSideBearing,
      rightSideBearing: Math.round(rightSideBearing),
      bbox
    });
  }

  if (overlapGlyphs.length > 0) {
    pushFinding(findings, {
      id: "geometrie.ueberlappung",
      severity: "error",
      category: "geometrie",
      title: `${glyphCount(overlapGlyphs.length)} mit überlappenden Konturen`,
      detail:
        "Konturen schneiden sich, statt vereinigt zu sein (z. B. Stamm + Querbalken). TrueType füllt das mit der Nonzero-Regel meist noch korrekt, aber Plotter, SVG-Exporte, Schablonen und Farb-Layer (COLR) erzeugen sichtbare Doppellinien bzw. Löcher. Abhilfe: Boolean-Union (Clipper/Martinez) vor dem Font-Build.",
      affected: limitList(overlapGlyphs)
    });
  }

  if (selfIntersectionGlyphs.length > 0) {
    pushFinding(findings, {
      id: "geometrie.selbstschnitt",
      severity: "error",
      category: "geometrie",
      title: `${glyphCount(selfIntersectionGlyphs.length)} mit selbstschneidenden Konturen`,
      detail:
        "Eine Kontur kreuzt sich selbst. Ursache sind meist Miter-Spikes an spitzen Ecken oder eine zu große Stroke-Expansion. Abhilfe: Miter-Limit senken, Ecken abrunden (Bevel/Round) oder Kontur nach der Vereinigung neu schneiden.",
      affected: limitList(selfIntersectionGlyphs)
    });
  }

  if (windingGlyphs.length > 0) {
    pushFinding(findings, {
      id: "geometrie.laufrichtung",
      severity: "error",
      category: "geometrie",
      title: `${glyphCount(windingGlyphs.length)} mit falscher Laufrichtung`,
      detail:
        "Außenkonturen müssen bei TrueType im Uhrzeigersinn laufen, Innenkonturen (Punzen) gegen den Uhrzeigersinn. Sonst verschwinden Löcher (O, A, B, 0) oder werden gefüllt – sichtbar in Photoshop, Plottern und in der Farb-Font-Ausgabe.",
      affected: limitList(windingGlyphs)
    });
  }

  if (extremaGlyphs.length > 0) {
    pushFinding(findings, {
      id: "geometrie.extrema.fehlt",
      severity: "warning",
      category: "geometrie",
      title: `${glyphCount(extremaGlyphs.length)} ohne On-Curve-Extrema`,
      detail:
        "Extremwerte von Bögen liegen mitten im Segment statt auf einem Knoten. Kleine Grade fransen dadurch aus, Hinting greift nicht, und automatische Schriftglättungen (z. B. beim Konvertieren) verschieben die Formen.",
      affected: limitList(extremaGlyphs)
    });
  }

  if (degenerateGlyphs.length > 0) {
    pushFinding(findings, {
      id: "geometrie.degeneriert",
      severity: "warning",
      category: "geometrie",
      title: `${glyphCount(degenerateGlyphs.length)} mit degenerierten Konturen`,
      detail: "Konturen mit weniger als drei Punkten oder Fläche null. Sie tragen nichts zur Form bei, erzeugen aber Fehler in manchen Rasterizern.",
      affected: limitList(degenerateGlyphs)
    });
  }

  // ---------------------------------------------------------------- Metrik
  if (clippingTop.length > 0) {
    pushFinding(findings, {
      id: "metrik.clipping.oben",
      severity: "error",
      category: "metrik",
      title: `${glyphCount(clippingTop.length)} ${clippingTop.length === 1 ? "überragt" : "überragen"} OS/2.usWinAscent`,
      detail:
        `Höchster Punkt im Font: ${Math.round(maxGlyphY)} Units, usWinAscent: ${winAscent}. Alles darüber wird in Word, DirectWrite und vielen Browsern abgeschnitten (typisch bei Kronen, Hörnern, Pfeil-Finials). usWinAscent auf den tatsächlichen Maximalwert setzen.`,
      affected: limitList(clippingTop),
      values: {maxGlyphY: Math.round(maxGlyphY), winAscent}
    });
  }

  if (clippingBottom.length > 0) {
    pushFinding(findings, {
      id: "metrik.clipping.unten",
      severity: "error",
      category: "metrik",
      title: `${glyphCount(clippingBottom.length)} ${clippingBottom.length === 1 ? "ragt" : "ragen"} unter OS/2.usWinDescent`,
      detail:
        `Tiefster Punkt im Font: ${Math.round(minGlyphY)} Units, usWinDescent: ${winDescent}. Daggers, Drips und Unterlängen werden sonst horizontal abgeschnitten.`,
      affected: limitList(clippingBottom),
      values: {minGlyphY: Math.round(minGlyphY), winDescent}
    });
  }

  if (os2 && (os2.sTypoAscender <= 0 || os2.sTypoDescender >= 0)) {
    pushFinding(findings, {
      id: "metrik.typo.vorzeichen",
      severity: "error",
      category: "metrik",
      title: "OS/2 Typo-Metriken mit falschem Vorzeichen",
      detail: `sTypoAscender = ${os2.sTypoAscender}, sTypoDescender = ${os2.sTypoDescender}. Der Ascender muss positiv, der Descender negativ sein.`
    });
  }

  if (zeroAdvanceGlyphs.length > 0) {
    pushFinding(findings, {
      id: "metrik.vorschub.null",
      severity: "error",
      category: "metrik",
      title: `${glyphCount(zeroAdvanceGlyphs.length)} mit Vorschub 0`,
      detail: "Glyphen mit Tinte, aber advanceWidth 0, stapeln sich übereinander. Mindestens Striche + Seitenlage als Vorschub setzen.",
      affected: limitList(zeroAdvanceGlyphs)
    });
  }

  if (negativeBearingGlyphs.length > 0) {
    pushFinding(findings, {
      id: "metrik.seitenlage.negativ",
      severity: "warning",
      category: "metrik",
      title: `${glyphCount(negativeBearingGlyphs.length)} mit negativer Seitenlage`,
      detail:
        "Die Tinte ragt links vor den Ursprung oder rechts über den Vorschub hinaus. Ohne Kerning kollidieren diese Zeichen mit dem Nachbarn.",
      affected: limitList(negativeBearingGlyphs)
    });
  }

  // Abstandsrhythmik zwischen Großbuchstaben
  const letterGlyphs = glyphAudits.filter(
    (g) => g.unicode !== null && LETTERS.includes(String.fromCodePoint(g.unicode)) && g.bbox !== null
  );
  const gaps: number[] = [];
  const collisions: {left: string; right: string; gap: number}[] = [];
  for (const left of letterGlyphs) {
    for (const right of letterGlyphs) {
      if (!left.bbox || !right.bbox) continue;
      const gap = left.advanceWidth + right.bbox.xMin - left.bbox.xMax;
      gaps.push(gap);
      if (gap < 0) collisions.push({left: left.label, right: right.label, gap: Math.round(gap)});
    }
  }
  const minGap = gaps.length > 0 ? Math.min(...gaps) : 0;
  const maxGap = gaps.length > 0 ? Math.max(...gaps) : 0;
  const gapCv = coefficientOfVariation(gaps);
  // Paare, die deutlich unter dem gewünschten optischen Abstand liegen.
  const underSpaced = gaps.filter((gap) => gap < targetGap * 0.6).length;

  if (collisions.length > 0) {
    pushFinding(findings, {
      id: "metrik.abstand.kollision",
      severity: "error",
      category: "metrik",
      title: `${collisions.length} ${collisions.length === 1 ? "Buchstabenpaar kollidiert" : "Buchstabenpaare kollidieren"}`,
      detail:
        "Die Bounding-Boxen überlappen ohne Kerning. Optische Kerning-Engine (Silhouetten-Scan) oder breitere Seitenlagen verwenden. Die schlimmsten Paare stehen in `spacing.collisions`.",
      affected: limitList(collisions.slice(0, 6).map((pair) => `${pair.left}${pair.right}`)),
      values: {minGap: Math.round(minGap)}
    });
  }

  if (gaps.length > 0 && gapCv > GAP_CV_LIMIT) {
    pushFinding(findings, {
      id: "metrik.abstand.streuung",
      severity: "warning",
      category: "metrik",
      title: "Ungleichmäßiger Weißraum zwischen Buchstaben",
      detail:
        `Streuung der Paarabstände: ${(gapCv * 100).toFixed(0)} % (Ziel < ${Math.round(GAP_CV_LIMIT * 100)} %, Minimum ${Math.round(minGap)}, Maximum ${Math.round(maxGap)} Units, Zielabstand ${Math.round(targetGap)} Units). ${underSpaced} Paare liegen deutlich unter dem Zielabstand. Ein reiner Bounding-Box-Vorschub reicht für Graffiti-Silhouetten nicht; ein optisches Kerning ist nötig.`,
      values: {gapCv: Number(gapCv.toFixed(3)), underSpacedPairs: underSpaced}
    });
  }

  if (!parsed.features.hasKern && !parsed.features.hasGpos) {
    pushFinding(findings, {
      id: "metrik.kerning.fehlt",
      severity: "warning",
      category: "metrik",
      title: "Keine Kerning-Daten",
      detail:
        "Weder `kern` noch `GPOS` vorhanden. Paare wie AV, LT, WA sitzen dann zwangsläufig zu weit auseinander. Für Satz und Kartenmotive Kerning-Paare exportieren (kern format 0 oder GPOS Pair Positioning)."
    });
  }

  // ---------------------------------------------------------------- Coverage
  const codepoints = new Set(parsed.cmap.keys());
  const codeOf = (char: string): number => char.codePointAt(0) ?? 0;
  const letters = LETTERS.filter((letter) => codepoints.has(codeOf(letter)));
  const missingLetters = LETTERS.filter((letter) => !codepoints.has(codeOf(letter)));
  const digits = DIGITS.filter((digit) => codepoints.has(codeOf(digit)));
  const missingDigits = DIGITS.filter((digit) => !codepoints.has(codeOf(digit)));
  const punctuation = PUNCTUATION.filter((char) => codepoints.has(codeOf(char)));
  const missingPunctuation = PUNCTUATION.filter((char) => !codepoints.has(codeOf(char)));

  if (missingLetters.length > 0) {
    pushFinding(findings, {
      id: "struktur.coverage.buchstaben",
      severity: missingLetters.length > 6 ? "error" : "warning",
      category: "struktur",
      title: `${missingLetters.length} ${missingLetters.length === 1 ? "Großbuchstabe fehlt" : "Großbuchstaben fehlen"}`,
      detail: "Für Tags, Poster und Karten sollten A–Z vollständig sein.",
      affected: limitList(missingLetters, 26)
    });
  }

  if (missingDigits.length > 0) {
    pushFinding(findings, {
      id: "struktur.coverage.ziffern",
      severity: "warning",
      category: "struktur",
      title: `${missingDigits.length} ${missingDigits.length === 1 ? "Ziffer fehlt" : "Ziffern fehlen"}`,
      detail: "Ziffern werden für Jahreszahlen, Crew-Nummern und Preise gebraucht.",
      affected: limitList(missingDigits, 10)
    });
  }

  if (!codepoints.has(0x20)) {
    pushFinding(findings, {
      id: "struktur.coverage.leerzeichen",
      severity: "error",
      category: "struktur",
      title: "Leerzeichen (U+0020) fehlt",
      detail: "Ohne U+0020 sind Wörter in jeder Anwendung unlesbar."
    });
  }

  // ---------------------------------------------------------------- Stil
  const withInk = glyphAudits.filter((g) => g.strokeWidth > 0);
  const strokeWidths = withInk.map((g) => g.strokeWidth);
  const medianStroke = Math.round(median(strokeWidths));
  const strokeCv = coefficientOfVariation(strokeWidths);
  const inkCy = coefficientOfVariation(withInk.map((g) => g.inkArea));
  const contrastRatio =
    strokeWidths.length > 0 ? Math.max(...strokeWidths) / Math.max(1, Math.min(...strokeWidths)) : 1;

  if (strokeWidths.length >= 3 && strokeCv > STROKE_CV_LIMIT) {
    const outliers = withInk
      .filter((g) => medianStroke > 0 && Math.abs(g.strokeWidth - medianStroke) / medianStroke > 0.35)
      .map((g) => g.label);
    pushFinding(findings, {
      id: "stil.strichbreite.streuung",
      severity: "warning",
      category: "stil",
      title: "Strichstärke im Alphabet inkonsistent",
      detail:
        `Median ${medianStroke} Units, Variationskoeffizient ${(strokeCv * 100).toFixed(0)} % (Ziel < ${Math.round(STROKE_CV_LIMIT * 100)} %). Ursache ist meist eine Strich-Expansion, die pro Skelett-Segment statt pro Glyphe normalisiert. Abweichende Glyphen sind unten gelistet.`,
      affected: limitList(outliers),
      values: {medianStrokeWidth: medianStroke, coefficientOfVariation: Number(strokeCv.toFixed(3))}
    });
  }

  // ---------------------------------------------------------------- Stencil
  // .notdef (gid 0) zählt nicht als Nutzzeichen.
  const counterGlyphs = glyphAudits.filter((g) => g.counterCount > 0 && g.gid !== 0);
  if (medianStroke > 0 && medianStroke < MIN_STEM_FOR_STENCIL) {
    pushFinding(findings, {
      id: "stencil.duenne-stege",
      severity: "warning",
      category: "stencil",
      title: "Strichstärke zu dünn für Schnittschablonen",
      detail:
        `Median-Strich ${medianStroke} Units (~${((medianStroke / unitsPerEm) * 100).toFixed(1)} % der em-Höhe). Für Mylar-Schablonen und Plotter sind mindestens ${MIN_STEM_FOR_STENCIL} Units bzw. 1,5 mm Endmaß sinnvoll.`
    });
  }

  if (counterGlyphs.length > 0) {
    pushFinding(findings, {
      id: "stencil.inseln",
      severity: "info",
      category: "stencil",
      title: `${glyphCount(counterGlyphs.length)} mit geschlossenen Inseln`,
      detail:
        "Bei geschnittenen Schablonen fallen die Innenräume heraus (A, B, D, O, P, Q, R, 0, 4, 6, 8, 9). Vor dem Plotter-Export Stege von mindestens 20–40 Units (1–2 mm) einplanen oder die Glyphen in zwei Ebenen (Insel separat) ausgeben.",
      affected: limitList(counterGlyphs.map((g) => g.label))
    });
  }

  // ---------------------------------------------------------------- Features
  if (!parsed.features.hasGsub && !parsed.features.hasGpos) {
    pushFinding(findings, {
      id: "features.keine-opentype",
      severity: "info",
      category: "features",
      title: "Keine OpenType-Layout-Tabellen",
      detail:
        "Ohne GSUB/GPOS gibt es keine Ligaturen, keine kontextuellen Alternativen und kein Kerning über GPOS. Für Graffiti-Verbindungen (`ST`, `CH`, `TH`) und Wortmarken ist GSUB mit `liga`/`calt` der Hebel."
    });
  }

  if (parsed.color.hasColr && !parsed.color.hasCpal) {
    pushFinding(findings, {
      id: "features.farbe.ohne-palette",
      severity: "error",
      category: "features",
      title: "COLR ohne CPAL",
      detail: "Farbschichten ohne Palette werden von Renderern ignoriert oder schwarz gezeichnet."
    });
  }

  if (parsed.color.hasColr && parsed.color.hasCpal) {
    pushFinding(findings, {
      id: "features.farbe",
      severity: "info",
      category: "features",
      title: `Farbfont mit ${parsed.color.numBaseGlyphs} Basisglyphen, ${parsed.color.numLayers} Layern, ${parsed.color.numPalettes} Paletten`,
      detail:
        "COLR/CPAL ist vorhanden. Prüfen: jede Basiszüge hat alle Layer, Layer-IDs liegen innerhalb `numGlyphs`, Palette ≥ 1. Für Browser-Darstellung unterstützt Chromium/Safari COLRv0 problemlos, Firefox ab Version 105."
    });
  }

  if (parsed.axes.length > 0) {
    pushFinding(findings, {
      id: "features.variabel",
      severity: "info",
      category: "features",
      title: `Variable Font mit ${parsed.axes.length} Achse(n)`,
      detail:
        "Achsen: " +
        parsed.axes.map((axis) => `${axis.tag} ${axis.min}–${axis.max} (Default ${axis.default})`).join(", ") +
        (parsed.hasGvar ? ". gvar vorhanden." : ". ACHTUNG: keine gvar-Tabelle – die Achsen sind wirkungslos.")
    });
    if (!parsed.hasGvar) {
      pushFinding(findings, {
        id: "features.variabel.ohne-gvar",
        severity: "error",
        category: "features",
        title: "fvar ohne gvar",
        detail: "Achsen sind deklariert, aber es gibt keine Variationsdaten. Interpolation findet nicht statt."
      });
    }
  }

  // ---------------------------------------------------------------- Score
  const byCategory = Object.fromEntries(
    (Object.keys(CATEGORY_WEIGHTS) as Category[]).map((category) => [category, CATEGORY_WEIGHTS[category]])
  ) as Record<Category, number>;

  for (const category of Object.keys(CATEGORY_WEIGHTS) as Category[]) {
    const errors = Math.min(5, findings.filter((f) => f.category === category && f.severity === "error").length);
    const warnings = Math.min(6, findings.filter((f) => f.category === category && f.severity === "warning").length);
    byCategory[category] = Math.max(0, Math.round((CATEGORY_WEIGHTS[category] - errors * 5 - warnings * 2) * 10) / 10);
  }

  const total = Math.round(Object.values(byCategory).reduce((sum, value) => sum + value, 0) * 10) / 10;
  const hasErrors = findings.some((f) => f.severity === "error");
  const verdict: AuditReport["verdict"] =
    total >= 90 && !hasErrors ? "produktionsreif" : total >= 60 ? "nutzbar-mit-nacharbeiten" : "nicht-exportfähig";

  // Nach Schweregrad sortiert ausgeben (error → warning → info).
  const order: Record<Severity, number> = {error: 0, warning: 1, info: 2};
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    font: {
      familyName,
      subfamilyName,
      fullName: parsed.names.get(4) ?? "",
      postScriptName: parsed.names.get(6) ?? "",
      unitsPerEm,
      numGlyphs: parsed.numGlyphs,
      flavor: parsed.flavor,
      cmapFormat: parsed.cmapFormat,
      byteLength: parsed.byteLength,
      tables: parsed.tableTags.slice().sort(),
      ascender: parsed.hhea.ascender,
      descender: parsed.hhea.descender,
      typoAscender: os2?.sTypoAscender ?? 0,
      typoDescender: os2?.sTypoDescender ?? 0,
      winAscent,
      winDescent,
      maxGlyphY: Number.isFinite(maxGlyphY) ? maxGlyphY : 0,
      minGlyphY: Number.isFinite(minGlyphY) ? minGlyphY : 0,
      kernPairs: parsed.features.kernPairCount,
      hasGpos: parsed.features.hasGpos,
      hasGsub: parsed.features.hasGsub,
      axes: parsed.axes,
      colorLayers: parsed.color.numLayers,
      palettes: parsed.color.numPalettes
    },
    glyphs: glyphAudits,
    findings,
    coverage: {letters, missingLetters, digits, missingDigits, punctuation, missingPunctuation},
    style: {
      medianStrokeWidth: medianStroke,
      coeffOfVariation: Number(strokeCv.toFixed(3)),
      contrastRatio: Number(contrastRatio.toFixed(2)),
      inkAreaCv: Number(inkCy.toFixed(3)),
      perGlyph: withInk.map((g) => ({label: g.label, strokeWidth: g.strokeWidth, inkArea: g.inkArea}))
    },
    spacing: {
      pairCount: gaps.length,
      collisions: collisions.sort((a, b) => a.gap - b.gap).slice(0, 20),
      minGap: Math.round(minGap),
      maxGap: Math.round(maxGap),
      gapCv: Number(gapCv.toFixed(3))
    },
    score: {total, byCategory, weights: CATEGORY_WEIGHTS},
    verdict
  };
}

/** Kompakter Markdown-Bericht für CLI, Pull Request oder Doku. */
export function formatAuditMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  const {font, score} = report;
  const icon = (severity: Severity) => (severity === "error" ? "🛑" : severity === "warning" ? "⚠️" : "ℹ️");

  lines.push(`# Font-Audit: ${font.familyName || "(ohne Namen)"} ${font.subfamilyName}`.trim());
  lines.push("");
  lines.push(
    `**Urteil:** ${report.verdict} · **Score:** ${score.total}/100 · ` +
      `**Datei:** ${font.numGlyphs} Glyphen, ${Math.round(font.byteLength / 1024)} KB, ${font.flavor}, cmap-Format ${font.cmapFormat}`
  );
  lines.push("");
  lines.push("| Kategorie | Punkte | Maximum |");
  lines.push("| --- | --- | --- |");
  for (const category of Object.keys(score.byCategory) as Category[]) {
    lines.push(`| ${category} | ${score.byCategory[category]} | ${score.weights[category]} |`);
  }
  lines.push("");

  lines.push("## Befunde");
  if (report.findings.length === 0) {
    lines.push("Keine Befunde. 🎉");
  }
  for (const finding of report.findings) {
    lines.push("");
    lines.push(`### ${icon(finding.severity)} ${finding.title}`);
    lines.push(`\`${finding.id}\` · ${finding.category}`);
    lines.push("");
    lines.push(finding.detail);
    if (finding.affected && finding.affected.length > 0) {
      lines.push("");
      lines.push(`Betroffen: ${finding.affected.join(" ")}`);
    }
  }

  lines.push("");
  lines.push("## Metriken");
  lines.push("");
  lines.push("| Wert | Zahl |");
  lines.push("| --- | --- |");
  lines.push(`| unitsPerEm | ${font.unitsPerEm} |`);
  lines.push(`| hhea ascender/descender | ${font.ascender} / ${font.descender} |`);
  lines.push(`| OS/2 Typo | ${font.typoAscender} / ${font.typoDescender} |`);
  lines.push(`| OS/2 win | ${font.winAscent} / ${font.winDescent} |`);
  lines.push(`| tatsächlich oben/unten | ${font.maxGlyphY} / ${font.minGlyphY} |`);
  lines.push(`| Median-Strich | ${report.style.medianStrokeWidth} Units (CV ${(report.style.coeffOfVariation * 100).toFixed(0)} %) |`);
  lines.push(`| Kontrast (dick/dünn) | ${report.style.contrastRatio}× |`);
  lines.push(`| Paarabstand min/max | ${report.spacing.minGap} / ${report.spacing.maxGap} Units |`);
  lines.push(`| Kerning-Paare | ${font.kernPairs}${font.hasGpos ? " + GPOS" : ""} |`);
  lines.push(
    `| Buchstaben | ${report.coverage.letters.length}/26${report.coverage.missingLetters.length > 0 ? ` (fehlt: ${report.coverage.missingLetters.join("")})` : ""} |`
  );
  lines.push(
    `| Ziffern | ${report.coverage.digits.length}/10${report.coverage.missingDigits.length > 0 ? ` (fehlt: ${report.coverage.missingDigits.join("")})` : ""} |`
  );
  lines.push("");

  if (report.spacing.collisions.length > 0) {
    lines.push("## Kollidierende Paare");
    lines.push("");
    lines.push("| Paar | Abstand |");
    lines.push("| --- | --- |");
    for (const pair of report.spacing.collisions.slice(0, 10)) {
      lines.push(`| ${pair.left}${pair.right} | ${pair.gap} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
