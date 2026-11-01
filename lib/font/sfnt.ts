/**
 * Dependency-freier SFNT-Reader (TrueType `.ttf`, `.otf` nur teilweise).
 *
 * Zweck: Der Glyph-Auditor (`lib/font/audit.ts`) muss die *echte* Binärdatei
 * prüfen, die aus der Font-Pipeline kommt – nicht das Modell davor. Nur so
 * lassen sich Fehler finden, die erst beim Schreiben der Tabellen entstehen
 * (fehlende Pfad-Vereinigung, falsche Laufrichtung, abgeschnittene
 * Dagger-/Drip-Ausläufer, inkonsistente Metriken).
 *
 * Bewusste Grenze: CFF-/CFF2-Outlines (`.otf` mit PostScript-Kurven) werden
 * nicht dekompiliert. Für solche Dateien liefert der Reader alle Tabellen- und
 * Metrikdaten, aber keine Konturen; der Auditor meldet das ausdrücklich als
 * `audit.scope.cff-not-decompiled` statt stillschweigend „alles gut“ zu sagen.
 */

export class SfntError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SfntError";
    this.code = code;
  }
}

export interface SfntTableRecord {
  tag: string;
  offset: number;
  length: number;
}

export interface FontPoint {
  x: number;
  y: number;
  onCurve: boolean;
}

export interface GlyphBBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface GlyphOutline {
  index: number;
  /** Anzahl Konturen laut `glyf`; `-1` = Composite-Glyphe. */
  numberOfContours: number;
  isComposite: boolean;
  /** Konturen mit On-/Off-Curve-Punkten (nur bei einfachen TrueType-Glyphen). */
  contours: FontPoint[][];
  /** Referenzierte Glyph-Indizes bei Composite-Glyphen. */
  components: number[];
  advanceWidth: number;
  leftSideBearing: number;
  bbox: GlyphBBox | null;
  /** `glyf`-Flags-Bit 6 (OVERLAP_SIMPLE) gesetzt. */
  overlapsSimple: boolean;
}

export interface Os2Data {
  version: number;
  xAvgCharWidth: number;
  usWeightClass: number;
  usWidthClass: number;
  fsType: number;
  fsSelection: number;
  usFirstCharIndex: number;
  usLastCharIndex: number;
  sTypoAscender: number;
  sTypoDescender: number;
  sTypoLineGap: number;
  usWinAscent: number;
  usWinDescent: number;
  sxHeight: number | null;
  sCapHeight: number | null;
}

export interface HeadData {
  fontRevision: number;
  unitsPerEm: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  macStyle: number;
  lowestRecPPEM: number;
  indexToLocFormat: number;
}

export interface HheaData {
  ascender: number;
  descender: number;
  lineGap: number;
  advanceWidthMax: number;
  minLeftSideBearing: number;
  minRightSideBearing: number;
  xMaxExtent: number;
  numberOfHMetrics: number;
}

export interface VariationAxis {
  tag: string;
  min: number;
  default: number;
  max: number;
}

export interface ColorInfo {
  hasColr: boolean;
  hasCpal: boolean;
  colrVersion: number | null;
  numBaseGlyphs: number;
  numLayers: number;
  numPalettes: number;
  numPaletteEntries: number;
}

export interface FeatureInfo {
  hasKern: boolean;
  kernPairCount: number;
  hasGpos: boolean;
  hasGsub: boolean;
  hasGdef: boolean;
  gposLookupCount: number;
  gsubLookupCount: number;
  hasColr: boolean;
  hasCpal: boolean;
  hasCff: boolean;
  hasCff2: boolean;
  hasSvg: boolean;
  hasMath: boolean;
}

export interface ParsedFont {
  sfntVersion: number;
  sfntVersionRaw: string;
  flavor: "truetype" | "cff" | "unknown";
  unitsPerEm: number;
  numGlyphs: number;
  tableTags: string[];
  tables: Map<string, SfntTableRecord>;
  head: HeadData;
  hhea: HheaData;
  os2: Os2Data | null;
  maxpVersion: number;
  glyphs: GlyphOutline[];
  /** Unicode-Codepoint → Glyph-ID (beste Unicode-Subtabelle). */
  cmap: Map<number, number>;
  cmapFormat: number;
  names: Map<number, string>;
  features: FeatureInfo;
  color: ColorInfo;
  axes: VariationAxis[];
  hasGvar: boolean;
  hasAvar: boolean;
  hasStat: boolean;
  hasFvar: boolean;
  postVersion: number;
  /** Dateigröße in Bytes. */
  byteLength: number;
  warnings: string[];
}

const TAG_HEAD = "head";

function requireTable(tables: Map<string, SfntTableRecord>, tag: string): SfntTableRecord {
  const record = tables.get(tag);
  if (!record) throw new SfntError(`missing-${tag.trim().toLowerCase()}`, `Tabelle '${tag}' fehlt`);
  return record;
}
const MAX_REASONABLE_GLYPHS = 65_535;

class ByteReader {
  private readonly view: DataView;

  constructor(
    private readonly buffer: ArrayBuffer,
    readonly offset: number,
    readonly limit: number
  ) {
    this.view = new DataView(buffer);
  }

  private assertInBounds(pos: number, size: number): void {
    if (pos < this.offset || pos + size > this.limit) {
      throw new SfntError("bounds", `Lesen außerhalb des Tabellenbereichs (${pos}+${size} > ${this.limit})`);
    }
  }

  u8(pos: number): number {
    this.assertInBounds(pos, 1);
    return this.view.getUint8(pos);
  }

  i8(pos: number): number {
    this.assertInBounds(pos, 1);
    return this.view.getInt8(pos);
  }

  u16(pos: number): number {
    this.assertInBounds(pos, 2);
    return this.view.getUint16(pos);
  }

  i16(pos: number): number {
    this.assertInBounds(pos, 2);
    return this.view.getInt16(pos);
  }

  u32(pos: number): number {
    this.assertInBounds(pos, 4);
    return this.view.getUint32(pos);
  }

  i32(pos: number): number {
    this.assertInBounds(pos, 4);
    return this.view.getInt32(pos);
  }

  i64AsNumber(pos: number): number {
    this.assertInBounds(pos, 8);
    return Number(this.view.getBigInt64(pos));
  }

  ascii(pos: number, size: number): string {
    this.assertInBounds(pos, size);
    let out = "";
    for (let i = 0; i < size; i++) out += String.fromCharCode(this.view.getUint8(pos + i));
    return out;
  }

  tagged(pos: number): string {
    return this.ascii(pos, 4);
  }

  utf16be(pos: number, byteLength: number): string {
    this.assertInBounds(pos, byteLength);
    let out = "";
    for (let i = 0; i + 1 < byteLength; i += 2) out += String.fromCharCode(this.view.getUint16(pos + i));
    return out;
  }

  rawBytes(pos: number, size: number): Uint8Array {
    this.assertInBounds(pos, size);
    return new Uint8Array(this.buffer, pos, size);
  }
}

/**
 * Parst eine Font-Binärdatei. Wirft `SfntError`, wenn die Datei strukturell
 * unbrauchbar ist (falscher Magic-Wert, abgeschnittene Tabelle, …).
 */
export function parseFont(input: ArrayBuffer | Uint8Array): ParsedFont {
  const buffer: ArrayBuffer =
    input instanceof Uint8Array
      ? (input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer)
      : input;

  if (buffer.byteLength < 12) {
    throw new SfntError("too-small", "Datei ist kleiner als ein SFNT-Header (12 Bytes)");
  }

  const reader = new ByteReader(buffer, 0, buffer.byteLength);
  const sfntVersion = reader.u32(0);
  const sfntVersionRaw = reader.tagged(0);
  const numTables = reader.u16(4);

  if (numTables === 0 || numTables > 512) {
    throw new SfntError("bad-table-count", `Ungültige Tabellenanzahl: ${numTables}`);
  }
  if (12 + numTables * 16 > buffer.byteLength) {
    throw new SfntError("truncated-directory", "Tabellenverzeichnis ragt über das Dateiende hinaus");
  }

  const tables = new Map<string, SfntTableRecord>();
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    const tag = reader.tagged(base);
    const offset = reader.u32(base + 8);
    const length = reader.u32(base + 12);
    if (offset + length > buffer.byteLength) {
      throw new SfntError("truncated-table", `Tabelle '${tag}' ragt über das Dateiende hinaus`);
    }
    tables.set(tag, {tag, offset, length});
  }

  const warnings: string[] = [];
  const flavor: ParsedFont["flavor"] =
    sfntVersion === 0x00010000 || sfntVersionRaw === "true"
      ? "truetype"
      : sfntVersionRaw === "OTTO"
        ? "cff"
        : "unknown";

  if (!tables.has(TAG_HEAD)) throw new SfntError("missing-head", "Tabelle 'head' fehlt");
  if (!tables.has("maxp")) throw new SfntError("missing-maxp", "Tabelle 'maxp' fehlt");
  if (!tables.has("cmap")) throw new SfntError("missing-cmap", "Tabelle 'cmap' fehlt");

  const headRec = requireTable(tables, TAG_HEAD);
  const headReader = new ByteReader(buffer, headRec.offset, headRec.offset + headRec.length);
  const magic = headReader.u32(headRec.offset + 12);
  if (magic !== 0x5f0f3cf5) {
    throw new SfntError("bad-head-magic", "head.magicNumber ist ungültig (0x5F0F3CF5 erwartet)");
  }

  const head: HeadData = {
    fontRevision: headReader.i32(headRec.offset + 4) / 65536,
    unitsPerEm: headReader.u16(headRec.offset + 18),
    xMin: headReader.i16(headRec.offset + 36),
    yMin: headReader.i16(headRec.offset + 38),
    xMax: headReader.i16(headRec.offset + 40),
    yMax: headReader.i16(headRec.offset + 42),
    macStyle: headReader.u16(headRec.offset + 44),
    lowestRecPPEM: headReader.u16(headRec.offset + 46),
    indexToLocFormat: headReader.i16(headRec.offset + 50)
  };

  if (head.indexToLocFormat !== 0 && head.indexToLocFormat !== 1) {
    throw new SfntError("bad-loca-format", `head.indexToLocFormat = ${head.indexToLocFormat} ist ungültig`);
  }

  const maxpRec = requireTable(tables, "maxp");
  const maxpReader = new ByteReader(buffer, maxpRec.offset, maxpRec.offset + maxpRec.length);
  const maxpVersion = maxpReader.u32(maxpRec.offset);
  const numGlyphs = maxpReader.u16(maxpRec.offset + 4);
  if (numGlyphs === 0 || numGlyphs > MAX_REASONABLE_GLYPHS) {
    throw new SfntError("bad-num-glyphs", `maxp.numGlyphs = ${numGlyphs} ist ungültig`);
  }

  let hhea: HheaData = {
    ascender: 0,
    descender: 0,
    lineGap: 0,
    advanceWidthMax: 0,
    minLeftSideBearing: 0,
    minRightSideBearing: 0,
    xMaxExtent: 0,
    numberOfHMetrics: 0
  };
  const hheaRec = tables.get("hhea");
  if (hheaRec) {
    const r = new ByteReader(buffer, hheaRec.offset, hheaRec.offset + hheaRec.length);
    hhea = {
      ascender: r.i16(hheaRec.offset + 4),
      descender: r.i16(hheaRec.offset + 6),
      lineGap: r.i16(hheaRec.offset + 8),
      advanceWidthMax: r.u16(hheaRec.offset + 10),
      minLeftSideBearing: r.i16(hheaRec.offset + 12),
      minRightSideBearing: r.i16(hheaRec.offset + 14),
      xMaxExtent: r.i16(hheaRec.offset + 16),
      numberOfHMetrics: r.u16(hheaRec.offset + 34)
    };
  } else {
    warnings.push("Tabelle 'hhea' fehlt – OTS/Browser lehnen solche Fonts in der Regel ab.");
  }

  const os2 = readOs2(buffer, tables);
  const names = readNames(buffer, tables);
  const cmapResult = readCmap(buffer, tables);
  const {advances, bearings} = readHmtx(buffer, tables, numGlyphs, hhea.numberOfHMetrics, warnings);
  const glyphs = readGlyf(buffer, tables, head, numGlyphs, advances, bearings, warnings);
  const features = readFeatures(buffer, tables);
  const color = readColor(buffer, tables);
  const axes = readFvarAxes(buffer, tables);

  return {
    sfntVersion,
    sfntVersionRaw,
    flavor,
    unitsPerEm: head.unitsPerEm,
    numGlyphs,
    tableTags: [...tables.keys()],
    tables,
    head,
    hhea,
    os2,
    maxpVersion,
    glyphs,
    cmap: cmapResult.map,
    cmapFormat: cmapResult.format,
    names,
    features,
    color,
    axes,
    hasGvar: tables.has("gvar"),
    hasAvar: tables.has("avar"),
    hasStat: tables.has("STAT"),
    hasFvar: tables.has("fvar"),
    postVersion: readPostVersion(buffer, tables),
    byteLength: buffer.byteLength,
    warnings
  };
}

function readOs2(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>): Os2Data | null {
  const rec = tables.get("OS/2");
  if (!rec) return null;
  const r = new ByteReader(buffer, rec.offset, rec.offset + rec.length);
  const base = rec.offset;
  const version = r.u16(base);
  return {
    version,
    xAvgCharWidth: r.i16(base + 2),
    usWeightClass: r.u16(base + 4),
    usWidthClass: r.u16(base + 6),
    fsType: r.u16(base + 8),
    fsSelection: r.u16(base + 62),
    usFirstCharIndex: r.u16(base + 64),
    usLastCharIndex: r.u16(base + 66),
    sTypoAscender: r.i16(base + 68),
    sTypoDescender: r.i16(base + 70),
    sTypoLineGap: r.i16(base + 72),
    usWinAscent: r.u16(base + 74),
    usWinDescent: r.u16(base + 76),
    sxHeight: version >= 2 && rec.length >= 88 ? r.i16(base + 86) : null,
    sCapHeight: version >= 2 && rec.length >= 90 ? r.i16(base + 88) : null
  };
}

function readNames(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>): Map<number, string> {
  const out = new Map<number, string>();
  const rec = tables.get("name");
  if (!rec) return out;
  const r = new ByteReader(buffer, rec.offset, rec.offset + rec.length);
  const count = r.u16(rec.offset + 2);
  const stringOffset = r.u16(rec.offset + 4);
  for (let i = 0; i < count; i++) {
    const base = rec.offset + 6 + i * 12;
    if (base + 12 > rec.offset + rec.length) break;
    const platformId = r.u16(base);
    const nameId = r.u16(base + 6);
    const length = r.u16(base + 8);
    const offset = r.u16(base + 10);
    const abs = rec.offset + stringOffset + offset;
    if (abs + length > rec.offset + rec.length) continue;
    let value: string;
    if (platformId === 3 || platformId === 0) value = r.utf16be(abs, length);
    else value = r.ascii(abs, length);
    // Windows-Einträge (platformId 3) bevorzugen.
    if (!out.has(nameId) || platformId === 3) out.set(nameId, value);
  }
  return out;
}

interface CmapResult {
  map: Map<number, number>;
  format: number;
}

function readCmap(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>): CmapResult {
  const rec = requireTable(tables, "cmap");
  const r = new ByteReader(buffer, rec.offset, rec.offset + rec.length);
  const numSubtables = r.u16(rec.offset + 2);
  const candidates: {platformId: number; encodingId: number; offset: number; format: number}[] = [];

  for (let i = 0; i < numSubtables; i++) {
    const base = rec.offset + 4 + i * 8;
    if (base + 8 > rec.offset + rec.length) break;
    const platformId = r.u16(base);
    const encodingId = r.u16(base + 2);
    const subOffset = rec.offset + r.u32(base + 4);
    if (subOffset + 2 > rec.offset + rec.length) continue;
    candidates.push({platformId, encodingId, offset: subOffset, format: r.u16(subOffset)});
  }

  const pick =
    candidates.find((c) => c.format === 12 && c.platformId === 3 && c.encodingId === 10) ??
    candidates.find((c) => c.format === 12) ??
    candidates.find((c) => c.format === 4 && c.platformId === 3 && c.encodingId === 1) ??
    candidates.find((c) => c.format === 4);

  const map = new Map<number, number>();
  if (!pick) return {map, format: 0};
  if (pick.format === 4) readCmapFormat4(buffer, pick.offset, map);
  if (pick.format === 12) readCmapFormat12(buffer, pick.offset, map);
  return {map, format: pick.format};
}

function readCmapFormat4(buffer: ArrayBuffer, offset: number, out: Map<number, number>): void {
  const r = new ByteReader(buffer, offset, buffer.byteLength);
  const segCount = r.u16(offset + 6) / 2;
  const endBase = offset + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;

  for (let seg = 0; seg < segCount; seg++) {
    const end = r.u16(endBase + seg * 2);
    const start = r.u16(startBase + seg * 2);
    const delta = r.i16(deltaBase + seg * 2);
    const rangeOffset = r.u16(rangeBase + seg * 2);
    if (start === 0xffff) continue;
    for (let cp = start; cp <= end && cp !== 0x10000; cp++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (cp + delta) & 0xffff;
      } else {
        const glyphIndexPos = rangeBase + seg * 2 + rangeOffset + (cp - start) * 2;
        if (glyphIndexPos + 2 > buffer.byteLength) continue;
        glyph = r.u16(glyphIndexPos);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0 && !out.has(cp)) out.set(cp, glyph);
    }
  }
}

function readCmapFormat12(buffer: ArrayBuffer, offset: number, out: Map<number, number>): void {
  const r = new ByteReader(buffer, offset, buffer.byteLength);
  const numGroups = r.u32(offset + 12);
  for (let i = 0; i < numGroups; i++) {
    const base = offset + 16 + i * 12;
    const startChar = r.u32(base);
    const endChar = r.u32(base + 4);
    const startGlyph = r.u32(base + 8);
    for (let cp = startChar; cp <= endChar; cp++) {
      if (!out.has(cp)) out.set(cp, startGlyph + (cp - startChar));
    }
  }
}

function readHmtx(
  buffer: ArrayBuffer,
  tables: Map<string, SfntTableRecord>,
  numGlyphs: number,
  numberOfHMetrics: number,
  warnings: string[]
): {advances: number[]; bearings: number[]} {
  const advances = new Array<number>(numGlyphs).fill(0);
  const bearings = new Array<number>(numGlyphs).fill(0);
  const rec = tables.get("hmtx");
  if (!rec) {
    warnings.push("Tabelle 'hmtx' fehlt – Vorschubbreiten sind nicht bestimmbar.");
    return {advances, bearings};
  }
  const r = new ByteReader(buffer, rec.offset, rec.offset + rec.length);
  const metrics = Math.max(1, Math.min(numberOfHMetrics, numGlyphs));
  let lastAdvance = 0;
  for (let i = 0; i < numGlyphs; i++) {
    if (i < metrics) {
      const base = rec.offset + i * 4;
      if (base + 4 > rec.offset + rec.length) break;
      advances[i] = r.u16(base);
      bearings[i] = r.i16(base + 2);
      lastAdvance = advances[i];
    } else {
      advances[i] = lastAdvance;
      const base = rec.offset + metrics * 4 + (i - metrics) * 2;
      bearings[i] = base + 2 <= rec.offset + rec.length ? r.i16(base) : 0;
    }
  }
  return {advances, bearings};
}

function readGlyf(
  buffer: ArrayBuffer,
  tables: Map<string, SfntTableRecord>,
  head: HeadData,
  numGlyphs: number,
  advances: number[],
  bearings: number[],
  warnings: string[]
): GlyphOutline[] {
  const glyphs: GlyphOutline[] = [];
  const glyfRec = tables.get("glyf");
  const locaRec = tables.get("loca");

  for (let i = 0; i < numGlyphs; i++) {
    glyphs.push({
      index: i,
      numberOfContours: 0,
      isComposite: false,
      contours: [],
      components: [],
      advanceWidth: advances[i] ?? 0,
      leftSideBearing: bearings[i] ?? 0,
      bbox: null,
      overlapsSimple: false
    });
  }

  if (!glyfRec || !locaRec) {
    if (!glyfRec) warnings.push("Tabelle 'glyf' fehlt – Konturen können nicht geprüft werden.");
    return glyphs;
  }

  const loca = new ByteReader(buffer, locaRec.offset, locaRec.offset + locaRec.length);
  const offsets: number[] = [];
  for (let i = 0; i <= numGlyphs; i++) {
    const pos = locaRec.offset + (head.indexToLocFormat === 0 ? i * 2 : i * 4);
    if (pos + (head.indexToLocFormat === 0 ? 2 : 4) > locaRec.offset + locaRec.length) {
      warnings.push("Tabelle 'loca' ist zu kurz für maxp.numGlyphs.");
      break;
    }
    offsets.push(head.indexToLocFormat === 0 ? loca.u16(pos) * 2 : loca.u32(pos));
  }

  const glyf = new ByteReader(buffer, glyfRec.offset, glyfRec.offset + glyfRec.length);

  for (let i = 0; i < numGlyphs && i + 1 < offsets.length; i++) {
    const start = glyfRec.offset + offsets[i];
    const end = glyfRec.offset + offsets[i + 1];
    const outline = glyphs[i];
    if (end <= start) continue; // leere Glyphe (z. B. space) – zulässig
    if (end > glyfRec.offset + glyfRec.length) {
      warnings.push(`Glyphe ${i}: loca-Offset zeigt hinter das Ende von 'glyf'.`);
      continue;
    }

    try {
      const numberOfContours = glyf.i16(start);
      const bbox: GlyphBBox = {
        xMin: glyf.i16(start + 2),
        yMin: glyf.i16(start + 4),
        xMax: glyf.i16(start + 6),
        yMax: glyf.i16(start + 8)
      };
      outline.numberOfContours = numberOfContours;
      outline.bbox = bbox;

      if (numberOfContours < 0) {
        outline.isComposite = true;
        outline.components = readCompositeComponents(glyf, start + 10, end);
        continue;
      }

      const parsed = readSimpleGlyph(glyf, start + 10, numberOfContours, end);
      outline.contours = parsed.contours;
      outline.overlapsSimple = parsed.overlapsSimple;
    } catch (error) {
      warnings.push(
        `Glyphe ${i}: Konturdaten nicht lesbar (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  return glyphs;
}

function readCompositeComponents(r: ByteReader, start: number, end: number): number[] {
  const components: number[] = [];
  let pos = start;
  for (let guard = 0; guard < 64; guard++) {
    if (pos + 4 > end) break;
    const flags = r.u16(pos);
    const glyphIndex = r.u16(pos + 2);
    components.push(glyphIndex);
    pos += 4;
    pos += flags & 0x0001 ? 4 : 2; // ARG_1_AND_2_ARE_WORDS
    if (flags & 0x0008) pos += 2; // WE_HAVE_A_SCALE
    else if (flags & 0x0040) pos += 4; // WE_HAVE_AN_X_AND_Y_SCALE
    else if (flags & 0x0080) pos += 8; // WE_HAVE_A_TWO_BY_TWO
    if (!(flags & 0x0020)) break; // MORE_COMPONENTS
  }
  return components;
}

function readSimpleGlyph(
  r: ByteReader,
  start: number,
  numberOfContours: number,
  end: number
): {contours: FontPoint[][]; overlapsSimple: boolean} {
  const endPts: number[] = [];
  let pos = start;
  for (let i = 0; i < numberOfContours; i++) {
    endPts.push(r.u16(pos));
    pos += 2;
  }
  const instructionLength = r.u16(pos);
  pos += 2 + instructionLength;

  const numPoints = numberOfContours > 0 ? endPts[endPts.length - 1] + 1 : 0;
  const flags = new Uint8Array(numPoints);
  let overlapsSimple = false;

  for (let i = 0; i < numPoints; i++) {
    const flag = r.u8(pos++);
    flags[i] = flag;
    if (flag & 0x40) overlapsSimple = true;
    if (flag & 0x08) {
      let repeat = r.u8(pos++);
      while (repeat-- > 0 && i + 1 < numPoints) flags[++i] = flag;
    }
  }

  const xs = new Int16Array(numPoints);
  const ys = new Int16Array(numPoints);
  let x = 0;
  for (let i = 0; i < numPoints; i++) {
    const flag = flags[i];
    if (flag & 0x02) {
      const delta = r.u8(pos++);
      x += flag & 0x10 ? delta : -delta;
    } else if (!(flag & 0x10)) {
      x += r.i16(pos);
      pos += 2;
    }
    xs[i] = x;
  }
  let y = 0;
  for (let i = 0; i < numPoints; i++) {
    const flag = flags[i];
    if (flag & 0x04) {
      const delta = r.u8(pos++);
      y += flag & 0x20 ? delta : -delta;
    } else if (!(flag & 0x20)) {
      y += r.i16(pos);
      pos += 2;
    }
    ys[i] = y;
  }
  if (pos > end) {
    throw new SfntError("glyph-overrun", "Punktdaten überschreiten die Glyphenlänge");
  }

  const contours: FontPoint[][] = [];
  let pointIndex = 0;
  for (const lastPoint of endPts) {
    const contour: FontPoint[] = [];
    for (; pointIndex <= lastPoint && pointIndex < numPoints; pointIndex++) {
      contour.push({x: xs[pointIndex], y: ys[pointIndex], onCurve: (flags[pointIndex] & 0x01) !== 0});
    }
    contours.push(contour);
  }
  return {contours, overlapsSimple};
}

function readPostVersion(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>): number {
  const rec = tables.get("post");
  if (!rec) return 0;
  const r = new ByteReader(buffer, rec.offset, rec.offset + rec.length);
  return r.u32(rec.offset) / 65536;
}

function readFeatures(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>): FeatureInfo {
  const info: FeatureInfo = {
    hasKern: tables.has("kern"),
    kernPairCount: 0,
    hasGpos: tables.has("GPOS"),
    hasGsub: tables.has("GSUB"),
    hasGdef: tables.has("GDEF"),
    gposLookupCount: 0,
    gsubLookupCount: 0,
    hasColr: tables.has("COLR"),
    hasCpal: tables.has("CPAL"),
    hasCff: tables.has("CFF "),
    hasCff2: tables.has("CFF2"),
    hasSvg: tables.has("SVG "),
    hasMath: tables.has("MATH")
  };

  const kernRec = tables.get("kern");
  if (kernRec) {
    try {
      const r = new ByteReader(buffer, kernRec.offset, kernRec.offset + kernRec.length);
      const version = r.u16(kernRec.offset);
      if (version === 0) {
        const nTables = r.u16(kernRec.offset + 2);
        let pos = kernRec.offset + 4;
        for (let i = 0; i < nTables; i++) {
          const length = r.u16(pos + 2);
          const coverage = r.u16(pos + 4);
          const format = coverage >> 8;
          if (format === 0 && length >= 14) {
            info.kernPairCount += r.u16(pos + 6);
          }
          pos += length || 14;
        }
      }
    } catch {
      // kern bleibt bei 0 – der Auditor meldet die fehlende Abdeckung separat.
    }
  }

  const gposRec = tables.get("GPOS");
  if (gposRec) {
    try {
      const r = new ByteReader(buffer, gposRec.offset, gposRec.offset + gposRec.length);
      info.gposLookupCount = r.u16(gposRec.offset + 8);
    } catch {
      info.gposLookupCount = 0;
    }
  }

  const gsubRec = tables.get("GSUB");
  if (gsubRec) {
    try {
      const r = new ByteReader(buffer, gsubRec.offset, gsubRec.offset + gsubRec.length);
      info.gsubLookupCount = r.u16(gsubRec.offset + 8);
    } catch {
      info.gsubLookupCount = 0;
    }
  }

  return info;
}

function readColor(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>): ColorInfo {
  const info: ColorInfo = {
    hasColr: tables.has("COLR"),
    hasCpal: tables.has("CPAL"),
    colrVersion: null,
    numBaseGlyphs: 0,
    numLayers: 0,
    numPalettes: 0,
    numPaletteEntries: 0
  };

  const colrRec = tables.get("COLR");
  if (colrRec) {
    try {
      const r = new ByteReader(buffer, colrRec.offset, colrRec.offset + colrRec.length);
      info.colrVersion = r.u16(colrRec.offset);
      info.numBaseGlyphs = r.u16(colrRec.offset + 2);
      info.numLayers = r.u16(colrRec.offset + 12);
    } catch {
      info.colrVersion = null;
    }
  }

  const cpalRec = tables.get("CPAL");
  if (cpalRec) {
    try {
      const r = new ByteReader(buffer, cpalRec.offset, cpalRec.offset + cpalRec.length);
      info.numPaletteEntries = r.u16(cpalRec.offset + 2);
      info.numPalettes = r.u16(cpalRec.offset + 4);
    } catch {
      info.numPalettes = 0;
    }
  }

  return info;
}

function readFvarAxes(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>): VariationAxis[] {
  const rec = tables.get("fvar");
  if (!rec) return [];
  const axes: VariationAxis[] = [];
  try {
    const r = new ByteReader(buffer, rec.offset, rec.offset + rec.length);
    const axesArrayOffset = r.u16(rec.offset + 4);
    const axisCount = r.u16(rec.offset + 8);
    const axisSize = r.u16(rec.offset + 10);
    for (let i = 0; i < axisCount; i++) {
      const base = rec.offset + axesArrayOffset + i * axisSize;
      if (base + axisSize > rec.offset + rec.length) break;
      axes.push({
        tag: r.tagged(base),
        min: r.i32(base + 4) / 65536,
        default: r.i32(base + 8) / 65536,
        max: r.i32(base + 12) / 65536
      });
    }
  } catch {
    return [];
  }
  return axes;
}
