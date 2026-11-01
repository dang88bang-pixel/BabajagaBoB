/**
 * Kleiner Scanline-Rasterizer + Distanztransformation.
 *
 * Wozu: Die Strichstärke ist das wichtigste Stilmerkmal einer Graffiti-Schrift.
 * Sie lässt sich nicht aus der Kontur „ablesen“, sondern nur flächig messen –
 * genau dafür dient die Distanztransformation (jeder Innenpunkt kennt seinen
 * Abstand zum Rand; die doppelte Distanz auf dem Grat ist die lokale
 * Strichbreite).
 *
 * Der Rasterizer arbeitet mit der Nonzero-Regel, damit auch Fonts mit
 * überlappenden Konturen korrekt gefüllt werden (TrueType-Verhalten).
 */

import {contourToPolygon, polygonBounds, type Vec2} from "./geometry";
import type {FontPointLike} from "./geometry";

export interface RasterResult {
  width: number;
  height: number;
  /** Pixel pro Font-Unit. */
  scale: number;
  /** Font-Unit-Koordinate der linken Pixelkante. */
  originX: number;
  /** Font-Unit-Koordinate der unteren Pixelkante. */
  originY: number;
  ink: Uint8Array;
  inkPixels: number;
}

export interface StrokeMeasure {
  /** Median der lokalen Strichbreite in Font-Units. */
  medianStrokeWidth: number;
  /** Streuung innerhalb der Glyphe (0 = perfekt gleichmäßig). */
  relativeSpread: number;
  /** Aufsummierte Fläche in Font-Unit². */
  area: number;
  /** Messpunkte, die zur Schätzung beigetragen haben. */
  samples: number;
}

export interface RasterizeOptions {
  /** Zielauflösung in Pixeln pro em (Standard 96 – guter Kompromiss). */
  pixelsPerEm?: number;
  padding?: number;
}

export function rasterizePolygons(
  polygons: Vec2[][],
  bounds: {xMin: number; yMin: number; xMax: number; yMax: number},
  unitsPerEm: number,
  options: RasterizeOptions = {}
): RasterResult {
  const pixelsPerEm = options.pixelsPerEm ?? 96;
  const padding = options.padding ?? 2;
  const scale = pixelsPerEm / Math.max(1, unitsPerEm);

  const width = Math.max(1, Math.ceil((bounds.xMax - bounds.xMin) * scale) + padding * 2);
  const height = Math.max(1, Math.ceil((bounds.yMax - bounds.yMin) * scale) + padding * 2);
  const originX = bounds.xMin - padding / scale;
  const originY = bounds.yMin - padding / scale;

  const ink = new Uint8Array(width * height);
  const edges: {x0: number; y0: number; x1: number; y1: number; dir: number}[] = [];

  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (a.y === b.y) continue;
      edges.push({x0: a.x, y0: a.y, x1: b.x, y1: b.y, dir: b.y > a.y ? 1 : -1});
    }
  }

  const crossings: {x: number; dir: number}[] = [];
  for (let row = 0; row < height; row++) {
    const sampleY = originY + (row + 0.5) / scale;
    crossings.length = 0;
    for (const edge of edges) {
      const minY = Math.min(edge.y0, edge.y1);
      const maxY = Math.max(edge.y0, edge.y1);
      if (sampleY < minY || sampleY >= maxY) continue;
      const t = (sampleY - edge.y0) / (edge.y1 - edge.y0);
      crossings.push({x: edge.x0 + t * (edge.x1 - edge.x0), dir: edge.dir});
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a.x - b.x);

    let winding = 0;
    for (let i = 0; i < crossings.length - 1; i++) {
      winding += crossings[i].dir;
      if (winding === 0) continue;
      const startPx = Math.max(0, Math.ceil((crossings[i].x - originX) * scale - 0.5));
      const endPx = Math.min(width - 1, Math.floor((crossings[i + 1].x - originX) * scale - 0.5));
      for (let col = startPx; col <= endPx; col++) {
        ink[row * width + col] = 1;
      }
    }
  }

  let inkPixels = 0;
  for (let i = 0; i < ink.length; i++) if (ink[i]) inkPixels++;

  return {width, height, scale, originX, originY, ink, inkPixels};
}

/**
 * Chamfer-Distanztransformation (3-4-Maske) → Abstand jedes Innenpixels zum
 * Rand, in Pixeln. Genau genug für Strichbreitenmessungen und dabei O(n).
 */
export function distanceTransform(ink: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e9;
  const dist = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i++) dist[i] = ink[i] ? INF : 0;

  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= width || y >= height ? 0 : dist[y * width + x]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!ink[index]) continue;
      let best = dist[index];
      best = Math.min(best, at(x - 1, y) + 3);
      best = Math.min(best, at(x, y - 1) + 3);
      best = Math.min(best, at(x - 1, y - 1) + 4);
      best = Math.min(best, at(x + 1, y - 1) + 4);
      dist[index] = best;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const index = y * width + x;
      if (!ink[index]) continue;
      let best = dist[index];
      best = Math.min(best, at(x + 1, y) + 3);
      best = Math.min(best, at(x, y + 1) + 3);
      best = Math.min(best, at(x + 1, y + 1) + 4);
      best = Math.min(best, at(x - 1, y + 1) + 4);
      dist[index] = best;
    }
  }

  for (let i = 0; i < dist.length; i++) dist[i] = ink[i] ? dist[i] / 3 : 0;
  return dist;
}

/**
 * Misst die Strichbreite einer Glyphe über die Gratlinien der Distanzkarte.
 * Der Median ist robust gegen Ecken und Drips; die relative Streuung zeigt,
 * ob der Stil über die Glyphe hinweg konsistent ist (Kalligrafie hat legitime
 * Streuung, eine fehlerhafte Expansion meist mehr).
 */
export function measureStroke(
  polygons: Vec2[][],
  unitsPerEm: number,
  options: RasterizeOptions = {}
): StrokeMeasure & {raster: RasterResult} {
  if (polygons.length === 0) {
    return {
      medianStrokeWidth: 0,
      relativeSpread: 0,
      area: 0,
      samples: 0,
      raster: rasterizePolygons([], {xMin: 0, yMin: 0, xMax: 1, yMax: 1}, unitsPerEm, options)
    };
  }

  const all = polygons.flat();
  const bounds = polygonBounds(all);
  const raster = rasterizePolygons(polygons, bounds, unitsPerEm, options);
  const dist = distanceTransform(raster.ink, raster.width, raster.height);

  const ridge: number[] = [];
  for (let y = 1; y < raster.height - 1; y++) {
    for (let x = 1; x < raster.width - 1; x++) {
      const index = y * raster.width + x;
      const d = dist[index];
      if (d <= 0) continue;
      if (
        d >= dist[index - 1] &&
        d >= dist[index + 1] &&
        d >= dist[index - raster.width] &&
        d >= dist[index + raster.width]
      ) {
        ridge.push(d);
      }
    }
  }

  ridge.sort((a, b) => a - b);
  const medianPx = ridge.length > 0 ? ridge[Math.floor(ridge.length / 2)] : 0;
  const medianStrokeWidth = (medianPx * 2) / raster.scale;

  const mean = ridge.length > 0 ? ridge.reduce((sum, value) => sum + value, 0) / ridge.length : 0;
  const variance =
    ridge.length > 0 ? ridge.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ridge.length : 0;
  const relativeSpread = mean > 0 ? Math.sqrt(variance) / mean : 0;

  return {
    medianStrokeWidth,
    relativeSpread,
    area: raster.inkPixels / (raster.scale * raster.scale),
    samples: ridge.length,
    raster
  };
}

/** Convenience: Konturen (TrueType-Punkte) → Polygone in Font-Units. */
export function contoursToPolygons(contours: FontPointLike[][], stepsPerCurve = 8): Vec2[][] {
  return contours.filter((contour) => contour.length >= 2).map((contour) => contourToPolygon(contour, stepsPerCurve));
}
