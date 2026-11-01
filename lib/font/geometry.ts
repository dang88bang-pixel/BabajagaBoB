/**
 * Kontur-Geometrie für den Glyph-Auditor.
 *
 * Arbeitet ausschließlich auf den aus `glyf` gelesenen Punkten (TrueType:
 * On-Curve-/Off-Curve-Punkte mit impliziten Zwischenpunkten). Es gibt keine
 * Abhängigkeit zu Canvas oder einer Vektor-Bibliothek, damit die Prüfung
 * deterministisch und im Browser wie in Node identisch läuft.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface FontPointLike {
  x: number;
  y: number;
  onCurve: boolean;
}

export interface ContourSegment {
  from: Vec2;
  to: Vec2;
  /** Nur bei quadratischen Segmenten gesetzt. */
  control: Vec2 | null;
}

export interface ContourPath {
  start: Vec2;
  segments: ContourSegment[];
}

const EPSILON = 1e-9;

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
}

/**
 * Wandelt eine TrueType-Kontur in Startpunkt + Segmentliste um.
 * Off-Curve-Paare werden über den impliziten Mittelpunkt verbunden.
 */
export function contourToPath(contour: FontPointLike[]): ContourPath | null {
  if (contour.length < 2) return null;

  let startIndex = contour.findIndex((p) => p.onCurve);
  let start: Vec2;
  if (startIndex === -1) {
    // Reine Off-Curve-Kontur: Startpunkt ist der implizite Mittelpunkt.
    startIndex = 0;
    start = midpoint(contour[0], contour[1 % contour.length]);
    startIndex = 0;
    const segments = buildSegmentsFrom(contour, startIndex, start);
    return {start, segments: segments};
  }
  start = {x: contour[startIndex].x, y: contour[startIndex].y};
  return {start, segments: buildSegmentsFrom(contour, startIndex, start)};
}

function buildSegmentsFrom(contour: FontPointLike[], startIndex: number, start: Vec2): ContourSegment[] {
  const n = contour.length;
  const segments: ContourSegment[] = [];
  let current = start;
  let control: Vec2 | null = null;

  for (let step = 1; step <= n; step++) {
    const point = contour[(startIndex + step) % n];
    if (point.onCurve) {
      segments.push({from: current, to: {x: point.x, y: point.y}, control});
      current = {x: point.x, y: point.y};
      control = null;
    } else {
      const off = {x: point.x, y: point.y};
      if (control) {
        const implied = midpoint(control, off);
        segments.push({from: current, to: implied, control});
        current = implied;
      }
      control = off;
    }
  }

  // Restbogen schließen, falls die Kontur mit Off-Curve-Punkten endet.
  if (control) {
    segments.push({from: current, to: start, control});
  }

  return segments;
}

/** Flacht eine Kontur zu einem geschlossenen Polygon ab. */
export function contourToPolygon(contour: FontPointLike[], stepsPerCurve = 6): Vec2[] {
  const path = contourToPath(contour);
  if (!path) return contour.map((p) => ({x: p.x, y: p.y}));
  const points: Vec2[] = [path.start];
  for (const segment of path.segments) {
    if (!segment.control) {
      points.push(segment.to);
      continue;
    }
    for (let step = 1; step <= stepsPerCurve; step++) {
      const t = step / stepsPerCurve;
      const mt = 1 - t;
      points.push({
        x: mt * mt * segment.from.x + 2 * mt * t * segment.control.x + t * t * segment.to.x,
        y: mt * mt * segment.from.y + 2 * mt * t * segment.control.y + t * t * segment.to.y
      });
    }
  }
  // Doppelte Schlusskante entfernen.
  if (points.length > 1 && distance(points[0], points[points.length - 1]) < 1e-6) points.pop();
  return points;
}

/** Vorzeichenbehaftete Fläche (Shoelace). > 0 = mathematisch gegen den Uhrzeigersinn. */
export function signedArea(polygon: Vec2[]): number {
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonBounds(polygon: Vec2[]): {xMin: number; yMin: number; xMax: number; yMax: number} {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const p of polygon) {
    if (p.x < xMin) xMin = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  }
  return {xMin, yMin, xMax, yMax};
}

/** Punkt-in-Polygon nach Ray-Casting (Randfälle gelten als „innen“). */
export function pointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = a.y > point.y !== b.y > point.y;
    if (intersects && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < EPSILON) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
  return (
    Math.min(a.x, b.x) - EPSILON <= c.x &&
    c.x <= Math.max(a.x, b.x) + EPSILON &&
    Math.min(a.y, b.y) - EPSILON <= c.y &&
    c.y <= Math.max(a.y, b.y) + EPSILON
  );
}

/**
 * Echte Kreuzung zweier Segmente.
 *
 * Harmlos sind nur Berührungen in gemeinsamen Endpunkten (z. B. benachbarte
 * Konturen eines zusammengesetzten Buchstabens). Alles andere – echte Kreuzung,
 * kollineare Überlappung, T-Stoß mitten in einem Segment – gilt als Treffer,
 * weil genau das beim Nicht-Vereinigen von Expansionskonturen passiert.
 */
export function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);

  // Echte Kreuzung setzt vier nicht-degenerierte Orientierungen voraus –
  // sonst würden zusammenfallende Endpunkte als Kreuzung gelten.
  if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4) return true;

  if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) {
    const axis: "x" | "y" = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? "x" : "y";
    const a0 = Math.min(p1[axis], p2[axis]);
    const a1 = Math.max(p1[axis], p2[axis]);
    const b0 = Math.min(p3[axis], p4[axis]);
    const b1 = Math.max(p3[axis], p4[axis]);
    return Math.min(a1, b1) - Math.max(a0, b0) > 1e-6;
  }

  const touches = (point: Vec2, a: Vec2, b: Vec2): boolean => {
    if (!onSegment(a, b, point)) return false;
    const sharedVertex = equal(point, a) || equal(point, b);
    return !sharedVertex;
  };

  if (o1 === 0 && touches(p3, p1, p2)) return true;
  if (o2 === 0 && touches(p4, p1, p2)) return true;
  if (o3 === 0 && touches(p1, p3, p4)) return true;
  if (o4 === 0 && touches(p2, p3, p4)) return true;

  return false;
}

function equal(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/** Selbstüberschneidungen innerhalb einer Kontur. */
export function countSelfIntersections(polygon: Vec2[]): number {
  const n = polygon.length;
  if (n < 4) return 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];
      if (segmentsCross(a1, a2, b1, b2)) count++;
    }
  }
  return count;
}

/** Überschneidungen zwischen zwei Konturen (z. B. nicht vereinigte Überlappungen). */
export function contoursIntersect(a: Vec2[], b: Vec2[]): boolean {
  const boundsA = polygonBounds(a);
  const boundsB = polygonBounds(b);
  if (
    boundsA.xMax < boundsB.xMin ||
    boundsB.xMax < boundsA.xMin ||
    boundsA.yMax < boundsB.yMin ||
    boundsB.yMax < boundsA.yMin
  ) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

export interface ExtremaGap {
  axis: "x" | "y";
  t: number;
  position: Vec2;
}

/**
 * Findet Extremwerte, die mitten in einem quadratischen Segment liegen.
 *
 * TrueType verlangt On-Curve-Punkte an allen Extremstellen; fehlen sie,
 * rasterisieren kleine Größen unsauber und Hinting greift nicht. Genau dieser
 * Fehler entsteht, wenn eine Expansions-Engine Kurven ohne Extrema-Nachlauf
 * ausgibt.
 */
export function findMissingExtrema(contour: FontPointLike[], tolerance = 0.04): ExtremaGap[] {
  const path = contourToPath(contour);
  if (!path) return [];
  const gaps: ExtremaGap[] = [];

  for (const segment of path.segments) {
    if (!segment.control) continue;
    const {from, control, to} = segment;
    const axes: ("x" | "y")[] = ["x", "y"];
    for (const axis of axes) {
      const p0 = from[axis];
      const c = control[axis];
      const p2 = to[axis];
      const denominator = p0 - 2 * c + p2;
      if (Math.abs(denominator) < 1e-9) continue;
      const t = (p0 - c) / denominator;
      if (t <= tolerance || t >= 1 - tolerance) continue;
      const mt = 1 - t;
      const position = {
        x: mt * mt * from.x + 2 * mt * t * control.x + t * t * to.x,
        y: mt * mt * from.y + 2 * mt * t * control.y + t * t * to.y
      };
      gaps.push({axis, t, position});
    }
  }
  return gaps;
}

/** Nächstgelegener Punkt-zu-Polygon-Abstand (für Silhouetten-/Abstandsprüfungen). */
export function distancePointToPolygon(point: Vec2, polygon: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq > 0 ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}
