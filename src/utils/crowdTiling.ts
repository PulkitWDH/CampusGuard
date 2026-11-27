import type { DetectedPersonBox } from '../types';
import { computeBoxContainment, computeBoxIoU } from './monitoringLogic';

export interface NormalizedTileRect {
  /** Normalized 0..1000 tile bounds inside the full source frame */
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/**
 * Generates an evenly spaced overlapping grid of normalized [0..1000] crop tiles.
 * Overlapping edges guarantee that no person standing on a grid seam is cut in half.
 */
export function buildOverlappingTileGrid(
  cols: number,
  rows: number,
  overlapFraction = 0.2
): NormalizedTileRect[] {
  const safeCols = Math.max(1, Math.min(6, Math.round(cols)));
  const safeRows = Math.max(1, Math.min(6, Math.round(rows)));
  const overlap = Math.max(0, Math.min(0.45, overlapFraction));

  // Solve tileSize so `cols` tiles with `overlap` cover [0..1000] exactly
  const tileW = safeCols === 1 ? 1000 : 1000 / (safeCols - (safeCols - 1) * overlap);
  const tileH = safeRows === 1 ? 1000 : 1000 / (safeRows - (safeRows - 1) * overlap);
  const stepX = safeCols === 1 ? 0 : (1000 - tileW) / (safeCols - 1);
  const stepY = safeRows === 1 ? 0 : (1000 - tileH) / (safeRows - 1);

  const tiles: NormalizedTileRect[] = [];
  for (let row = 0; row < safeRows; row += 1) {
    for (let col = 0; col < safeCols; col += 1) {
      const xmin = Math.round(col * stepX);
      const ymin = Math.round(row * stepY);
      const xmax = col === safeCols - 1 ? 1000 : Math.min(1000, Math.round(xmin + tileW));
      const ymax = row === safeRows - 1 ? 1000 : Math.min(1000, Math.round(ymin + tileH));
      tiles.push({ xmin, ymin, xmax, ymax, col, row, cols: safeCols, rows: safeRows });
    }
  }
  return tiles;
}

function describeHorizontalZone(xmin: number, xmax: number): string {
  const center = (xmin + xmax) / 2;
  if (center < 330) return 'left';
  if (center > 670) return 'right';
  return 'center';
}

/**
 * Projects a raw pixel detection [x, y, w, h] from a zoomed crop tile back into
 * full-frame normalized [0..1000] coordinates, rejecting clipped edge slivers that
 * belong cleanly inside an adjacent overlapping tile.
 */
export function mapTilePredictionToFullFrame(
  bboxPx: [number, number, number, number],
  confidencePercent: number,
  tilePixelW: number,
  tilePixelH: number,
  tile: NormalizedTileRect,
  minConfidencePercent = 22
): DetectedPersonBox | null {
  if (confidencePercent < minConfidencePercent || tilePixelW <= 0 || tilePixelH <= 0) {
    return null;
  }

  const [bx, by, bw, bh] = bboxPx;
  const relXMin = Math.max(0, Math.min(1, bx / tilePixelW));
  const relYMin = Math.max(0, Math.min(1, by / tilePixelH));
  const relXMax = Math.max(0, Math.min(1, (bx + bw) / tilePixelW));
  const relYMax = Math.max(0, Math.min(1, (by + bh) / tilePixelH));

  const relW = relXMax - relXMin;
  const relH = relYMax - relYMin;
  if (relW <= 0.02 || relH <= 0.03) return null;

  // Drop razor-thin partial slices glued to an interior tile seam (an adjacent overlapping tile sees their whole body)
  const touchesInteriorLeft = tile.col > 0 && relXMin <= 0.015 && relW < 0.09;
  const touchesInteriorRight = tile.col < tile.cols - 1 && relXMax >= 0.985 && relW < 0.09;
  const touchesInteriorTop = tile.row > 0 && relYMin <= 0.015 && relH < 0.1;
  const touchesInteriorBottom = tile.row < tile.rows - 1 && relYMax >= 0.985 && relH < 0.1;
  if (touchesInteriorLeft || touchesInteriorRight || touchesInteriorTop || touchesInteriorBottom) {
    return null;
  }

  const tileSpanX = tile.xmax - tile.xmin;
  const tileSpanY = tile.ymax - tile.ymin;
  const xmin = Math.round(tile.xmin + relXMin * tileSpanX);
  const xmax = Math.round(tile.xmin + relXMax * tileSpanX);
  const ymin = Math.round(tile.ymin + relYMin * tileSpanY);
  const ymax = Math.round(tile.ymin + relYMax * tileSpanY);

  const normW = xmax - xmin;
  const normH = ymax - ymin;
  if (normW < 10 || normH < 18 || normW * normH < 280) {
    return null;
  }

  // Reject impossible ultra-wide flat strips or absurd full-tile false positives
  const aspect = normW / Math.max(1, normH);
  if (aspect > 2.3 || aspect < 0.16) return null;
  if (normW > 950 && normH > 950 && confidencePercent < 92) return null;

  return {
    label: `Person (${describeHorizontalZone(xmin, xmax)})`,
    box_2d: [ymin, xmin, ymax, xmax],
    confidence: Math.min(100, Math.max(0, Math.round(confidencePercent))),
  };
}

/**
 * Decides whether a scene warrants engaging the deep 4x3 crowd magnification grid.
 * Keeps single-person/close-up rooms ultra-fast while automatically scaling up
 * whenever multiple people or small distant crowd figures appear.
 */
export function shouldEngageDeepCrowdGrid(
  fullBoxes: DetectedPersonBox[],
  quadBoxes: DetectedPersonBox[],
  hasCloseUpDominantPerson: boolean
): boolean {
  if (hasCloseUpDominantPerson) return false;
  const combined = quadBoxes.length > 0 ? quadBoxes : fullBoxes;
  if (combined.length >= 5) return true;
  if (combined.length === 0) return false;

  // Even if full/quad pass only spotted 1-4 small distant figures in a dense crowd,
  // their median height is genuinely small (< 250 normalized units) -> trigger deep zoom grid!
  const heights = combined
    .map((b) => b.box_2d[2] - b.box_2d[0])
    .sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] ?? 1000;
  return medianH < 250;
}

function isCrowdDuplicate(
  a: [number, number, number, number],
  b: [number, number, number, number],
  denseCrowdMode: boolean
): boolean {
  const iou = computeBoxIoU(a, b);
  if (iou >= (denseCrowdMode ? 0.44 : 0.48)) return true;

  const containment = computeBoxContainment(a, b);
  const cxA = (a[1] + a[3]) / 2;
  const cyA = (a[0] + a[2]) / 2;
  const cxB = (b[1] + b[3]) / 2;
  const cyB = (b[0] + b[2]) / 2;
  const wA = Math.max(1, a[3] - a[1]);
  const hA = Math.max(1, a[2] - a[0]);
  const wB = Math.max(1, b[3] - b[1]);
  const hB = Math.max(1, b[2] - b[0]);
  const minW = Math.min(wA, wB);
  const minH = Math.min(hA, hB);

  // Merge exact overlapping duplicate from adjacent tiles (very close centers)
  const centerDx = Math.abs(cxA - cxB);
  const centerDy = Math.abs(cyA - cyB);
  if (centerDx <= minW * 0.38 && centerDy <= minH * 0.35) {
    return true;
  }

  // Merge nested torso/head sub-box inside a slightly larger box of the SAME person,
  // while keeping two separate shoulder-to-shoulder people in a dense crowd distinct!
  if (containment >= 0.78 && centerDx <= Math.max(wA, wB) * 0.32 && centerDy <= Math.max(hA, hB) * 0.35) {
    return true;
  }

  // In normal (non-crowd) scenes, drop giant multi-person merged blob boxes if individual sub-people exist
  if (!denseCrowdMode && containment >= 0.72 && centerDx <= Math.max(wA, wB) * 0.3) {
    return true;
  }

  return false;
}

/**
 * Crowd-aware Non-Maximum Suppression across multi-scale zoom tiles.
 * Preserves closely packed shoulder-to-shoulder people in dense crowds (50-200+ people)
 * while cleanly deduplicating overlapping detections of the same person across tile seams.
 */
export function mergeCrowdTileDetections(
  candidates: DetectedPersonBox[],
  minConfidence = 22
): DetectedPersonBox[] {
  const filtered = candidates.filter((c) => {
    const [ymin, xmin, ymax, xmax] = c.box_2d;
    const w = xmax - xmin;
    const h = ymax - ymin;
    if (c.confidence < minConfidence) return false;
    if (w < 10 || h < 18 || w * h < 280) return false;
    return true;
  });

  if (filtered.length === 0) return [];

  const denseCrowdMode = filtered.length >= 6;

  // In dense crowds, reject giant vague "whole crowd" blob boxes (> 35% of frame) when smaller individual people exist
  const cleanPool = denseCrowdMode
    ? filtered.filter((c) => {
        const w = c.box_2d[3] - c.box_2d[1];
        const h = c.box_2d[2] - c.box_2d[0];
        return !(w * h > 220_000 && c.confidence < 72);
      })
    : filtered;

  // Prefer higher-confidence detections; when tied, prefer tighter/more localized boxes
  const sorted = [...cleanPool].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const areaA = (a.box_2d[2] - a.box_2d[0]) * (a.box_2d[3] - a.box_2d[1]);
    const areaB = (b.box_2d[2] - b.box_2d[0]) * (b.box_2d[3] - b.box_2d[1]);
    return areaA - areaB;
  });

  const kept: DetectedPersonBox[] = [];
  for (const cand of sorted) {
    const duplicate = kept.some((existing) =>
      isCrowdDuplicate(existing.box_2d, cand.box_2d, denseCrowdMode)
    );
    if (!duplicate) {
      kept.push(cand);
    }
  }

  // Sort cleanly left-to-right, top-to-bottom for deterministic IDs
  kept.sort((a, b) => {
    const rowDiff = Math.floor(a.box_2d[0] / 120) - Math.floor(b.box_2d[0] / 120);
    if (rowDiff !== 0) return rowDiff;
    return a.box_2d[1] - b.box_2d[1];
  });

  return kept;
}
