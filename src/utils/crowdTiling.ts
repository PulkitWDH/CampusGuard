import type { DetectedPersonBox } from '../types';
import {
  computeBoxContainment,
  computeBoxIoU,
  isAttachedLimbOrHandFragment,
  isVerticallySplitSamePerson,
} from './monitoringLogic';

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

export interface TileDetectionMeta {
  sourcePass: 'full' | 'quad' | 'deep';
  col?: number;
  row?: number;
  cols?: number;
  rows?: number;
  clippedLeft?: boolean;
  clippedRight?: boolean;
  clippedTop?: boolean;
  clippedBottom?: boolean;
}

export interface TileCandidateBox extends DetectedPersonBox {
  tileMeta?: TileDetectionMeta;
}

function isInteriorSeamClipped(meta?: TileDetectionMeta): boolean {
  return Boolean(
    meta && (meta.clippedLeft || meta.clippedRight || meta.clippedTop || meta.clippedBottom)
  );
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
 * belong cleanly inside an adjacent overlapping tile and tagging interior-seam clips.
 */
export function mapTilePredictionToFullFrame(
  bboxPx: [number, number, number, number],
  confidencePercent: number,
  tilePixelW: number,
  tilePixelH: number,
  tile: NormalizedTileRect,
  minConfidencePercent = 22,
  sourcePass: 'quad' | 'deep' = 'quad'
): TileCandidateBox | null {
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

  const clippedLeft = tile.col > 0 && relXMin <= 0.04;
  const clippedRight = tile.col < tile.cols - 1 && relXMax >= 0.96;
  const clippedTop = tile.row > 0 && relYMin <= 0.04;
  const clippedBottom = tile.row < tile.rows - 1 && relYMax >= 0.96;

  // Reject wide foreground forehead/torso slices pinned flat against an interior horizontal tile seam
  // (e.g., top-right 2x2 tile chopping a close-up user's head off at y=562 as a wide horizontal box)
  if ((clippedTop || clippedBottom) && aspect > 1.3 && relW >= 0.65) {
    return null;
  }

  return {
    label: `Person (${describeHorizontalZone(xmin, xmax)})`,
    box_2d: [ymin, xmin, ymax, xmax],
    confidence: Math.min(100, Math.max(0, Math.round(confidencePercent))),
    tileMeta: {
      sourcePass,
      col: tile.col,
      row: tile.row,
      cols: tile.cols,
      rows: tile.rows,
      clippedLeft,
      clippedRight,
      clippedTop,
      clippedBottom,
    },
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
  const combined = quadBoxes.length > 0 ? quadBoxes : fullBoxes;
  // If a close-up presenter stands in front of a large background crowd (>= 6 detections in quad pass),
  // still engage deep crowd grid so background visitors are accurately counted!
  if (hasCloseUpDominantPerson) {
    return quadBoxes.length >= 6;
  }
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

/**
 * Suppresses isolated low-confidence large tile phantoms (e.g., chairs, jackets, shadows, or small
 * curtain/lighting movements in an empty room) when Pass 1 full-frame saw 0 people and Pass 3
 * dense crowd mode did not engage — while preserving genuine distant crowd figures (height < 300).
 */
export function filterEmptyRoomMovementPhantoms(
  fullBoxes: TileCandidateBox[],
  quadBoxes: TileCandidateBox[],
  crowdScanUsed: boolean
): TileCandidateBox[] {
  if (fullBoxes.length > 0 || crowdScanUsed || quadBoxes.length === 0) {
    return quadBoxes;
  }
  // If >= 3 distinct small/medium figures appear across tiles, treat as a genuine multi-person scene
  if (quadBoxes.length >= 3) {
    return quadBoxes;
  }
  return quadBoxes.filter((box) => {
    const h = box.box_2d[2] - box.box_2d[0];
    // Genuine distant people (h < 300) pass cleanly; isolated large blobs missed by Pass 1 need >= 44% confidence
    if (h >= 300 && box.confidence < 44) {
      return false;
    }
    return true;
  });
}

/**
 * Detects when two adjacent-column tile detections (col=0 clipped right + col=1 clipped left)
 * are opposite horizontal halves of ONE centered person split down the vertical tile seam.
 * Never merges two distinct side-by-side people (whose boxes are not both pinned flat to opposite seams).
 */
function isHorizontallySplitTileSeamPair(a: TileCandidateBox, b: TileCandidateBox): boolean {
  const mA = a.tileMeta;
  const mB = b.tileMeta;
  if (!mA || !mB || mA.sourcePass === 'full' || mB.sourcePass === 'full') return false;
  if (mA.col === undefined || mB.col === undefined || mA.row !== mB.row) return false;

  const leftBox = a.box_2d[1] <= b.box_2d[1] ? a : b;
  const rightBox = leftBox === a ? b : a;
  const mL = leftBox.tileMeta!;
  const mR = rightBox.tileMeta!;

  if (mL.col === undefined || mR.col === undefined || mR.col !== mL.col + 1) return false;
  if (!mL.clippedRight || !mR.clippedLeft) return false;

  const [lYmin, lXmin, lYmax, lXmax] = leftBox.box_2d;
  const [rYmin, rXmin, rYmax, rXmax] = rightBox.box_2d;
  const lH = Math.max(1, lYmax - lYmin);
  const rH = Math.max(1, rYmax - rYmin);
  const minH = Math.min(lH, rH);
  const maxH = Math.max(lH, rH);

  // Must overlap horizontally across the seam band and share nearly identical vertical bounds
  const interX = Math.min(lXmax, rXmax) - Math.max(lXmin, rXmin);
  const interY = Math.max(0, Math.min(lYmax, rYmax) - Math.max(lYmin, rYmin));
  const combinedW = Math.max(lXmax, rXmax) - Math.min(lXmin, rXmin);

  if (interX <= 0) return false;
  if (interY / minH < 0.76) return false;
  if (Math.abs(lYmin - rYmin) > maxH * 0.16 || Math.abs(lYmax - rYmax) > maxH * 0.16) return false;
  // Combined width must still look like 1 person (not wider than ~1.15x height for a seated/standing torso)
  if (combinedW > maxH * 1.25 || combinedW > 820) return false;

  return true;
}

/**
 * Drops giant Pass-1 "multi-person composite wrapper" boxes that accidentally span 2+ distinct,
 * mutually non-overlapping, unclipped people standing side-by-side (preventing 2 real people
 * from being swallowed into a single 1-person box).
 */
function filterCompositeGroupWrappers(candidates: TileCandidateBox[]): TileCandidateBox[] {
  if (candidates.length < 3) return candidates;

  const droppedIndices = new Set<number>();

  for (let i = 0; i < candidates.length; i += 1) {
    const wrapper = candidates[i];
    const [gYmin, gXmin, gYmax, gXmax] = wrapper.box_2d;
    const gW = gXmax - gXmin;
    const gH = gYmax - gYmin;
    const gArea = gW * gH;

    // Only consider wide composite boxes that could plausibly wrap >= 2 side-by-side humans
    if (gW < 420 || gArea < 180_000) continue;

    // Find confident, portrait-proportioned, unclipped individual candidates well-contained inside wrapper
    const innerIndividuals: TileCandidateBox[] = [];
    for (let j = 0; j < candidates.length; j += 1) {
      if (i === j) continue;
      const inner = candidates[j];
      if (inner.confidence < 56) continue;
      if (isInteriorSeamClipped(inner.tileMeta)) continue;

      const [cYmin, cXmin, cYmax, cXmax] = inner.box_2d;
      const cW = Math.max(1, cXmax - cXmin);
      const cH = Math.max(1, cYmax - cYmin);
      if (cW < 70 || cH < Math.max(120, gH * 0.55)) continue;
      // Portrait human proportions (reject wide hands/arms)
      if (cW / cH > 0.9) continue;
      // Must be significantly narrower than the giant wrapper
      if (cW > gW * 0.68) continue;

      const containment = computeBoxContainment(wrapper.box_2d, inner.box_2d);
      if (containment < 0.72) continue;

      innerIndividuals.push(inner);
    }

    if (innerIndividuals.length < 2) continue;

    // Verify there exists a pair of genuinely separate, non-overlapping distinct people inside wrapper
    let foundDistinctPair = false;
    for (let a = 0; a < innerIndividuals.length && !foundDistinctPair; a += 1) {
      for (let b = a + 1; b < innerIndividuals.length; b += 1) {
        const p1 = innerIndividuals[a].box_2d;
        const p2 = innerIndividuals[b].box_2d;
        const w1 = p1[3] - p1[1];
        const w2 = p2[3] - p2[1];
        const minW = Math.max(1, Math.min(w1, w2));
        const interX = Math.max(0, Math.min(p1[3], p2[3]) - Math.max(p1[1], p2[1]));
        const cx1 = (p1[1] + p1[3]) / 2;
        const cx2 = (p2[1] + p2[3]) / 2;

        if (
          computeBoxIoU(p1, p2) < 0.14 &&
          interX / minW < 0.22 &&
          Math.abs(cx1 - cx2) >= minW * 0.78
        ) {
          foundDistinctPair = true;
          break;
        }
      }
    }

    if (foundDistinctPair) {
      droppedIndices.add(i);
    }
  }

  return droppedIndices.size > 0
    ? candidates.filter((_, idx) => !droppedIndices.has(idx))
    : candidates;
}

function isCrowdDuplicate(
  a: [number, number, number, number],
  b: [number, number, number, number],
  denseCrowdMode: boolean
): boolean {
  const iou = computeBoxIoU(a, b);
  if (iou >= (denseCrowdMode ? 0.44 : 0.46)) return true;

  const containment = computeBoxContainment(a, b);
  const cxA = (a[1] + a[3]) / 2;
  const cyA = (a[0] + a[2]) / 2;
  const cxB = (b[1] + b[3]) / 2;
  const cyB = (b[0] + b[2]) / 2;
  const wA = Math.max(1, a[3] - a[1]);
  const hA = Math.max(1, a[2] - a[0]);
  const wB = Math.max(1, b[3] - b[1]);
  const hB = Math.max(1, b[2] - b[0]);
  const areaA = wA * hA;
  const areaB = wB * hB;
  const minW = Math.min(wA, wB);
  const minH = Math.min(hA, hB);

  // Merge exact overlapping duplicate from adjacent tiles (very close centers WITH meaningful overlap)
  // Requires iou >= 0.30 or containment >= 0.55 so offset front-and-back people are NOT merged!
  const centerDx = Math.abs(cxA - cxB);
  const centerDy = Math.abs(cyA - cyB);
  if (
    centerDx <= minW * 0.3 &&
    centerDy <= minH * 0.25 &&
    (iou >= 0.3 || containment >= 0.55)
  ) {
    return true;
  }

  // Protect close-up foreground humans from being sliced into 2 boxes across 2x2 tile seams:
  // If a tile detection is >= 68% contained inside a large foreground person box (>= 16% of frame)
  // and shares similar width/torso alignment — AND does not rise high above the foreground person's
  // head like a second person standing behind them — merge it!
  const largerArea = Math.max(areaA, areaB);
  const smallerArea = Math.min(areaA, areaB);
  const largerBox = areaA >= areaB ? a : b;
  const smallerBox = areaA >= areaB ? b : a;
  const largerH = Math.max(1, largerBox[2] - largerBox[0]);
  const smallerW = Math.max(1, smallerBox[3] - smallerBox[1]);
  const smallerH = Math.max(1, smallerBox[2] - smallerBox[0]);
  const smallerRisesAboveHead =
    smallerBox[0] <= largerBox[0] - largerH * 0.12 && smallerW / smallerH < 0.72;

  if (
    !smallerRisesAboveHead &&
    largerArea >= 160_000 &&
    containment >= 0.68 &&
    smallerArea / largerArea >= 0.28 &&
    centerDx <= Math.max(wA, wB) * 0.42
  ) {
    return true;
  }

  // Merge nested torso/head sub-box inside a slightly larger box of the SAME person,
  // while keeping smaller distant visitors behind a close-up presenter AND shoulder-to-shoulder crowds distinct!
  const areaRatio = smallerArea / Math.max(1, largerArea);
  if (
    !smallerRisesAboveHead &&
    containment >= 0.78 &&
    areaRatio >= 0.25 &&
    centerDx <= Math.max(wA, wB) * 0.32 &&
    centerDy <= Math.max(hA, hB) * 0.35
  ) {
    return true;
  }

  // In normal (non-crowd) scenes, merge partial duplicate boxes of the same person
  // without swallowing much smaller background people standing behind them
  if (
    !denseCrowdMode &&
    !smallerRisesAboveHead &&
    containment >= 0.72 &&
    areaRatio >= 0.25 &&
    centerDx <= Math.max(wA, wB) * 0.3
  ) {
    return true;
  }

  // Merge vertically-split upper/lower seam halves of the same foreground person
  if (isVerticallySplitSamePerson(a, b)) {
    return true;
  }

  return false;
}

/**
 * Detects when an interior-seam-clipped 2x2/3x3 tile crop catches a fast-moving arm, hand,
 * or shoulder edge of a close-up person already cleanly detected in Pass 1 (full frame).
 * Because the tile cuts right through the outstretched arm/shoulder at the seam, COCO-SSD
 * sometimes scores the sliced arm+shoulder as a 45-74% "person" box beside the primary body.
 */
function isSeamClippedLimbSliceOfFullPerson(
  existing: TileCandidateBox,
  cand: TileCandidateBox
): boolean {
  if (existing.tileMeta?.sourcePass !== 'full') return false;
  if (!isInteriorSeamClipped(cand.tileMeta)) return false;
  if (cand.confidence >= 76) return false;

  const [eYmin, eXmin, eYmax, eXmax] = existing.box_2d;
  const [cYmin, cXmin, cYmax, cXmax] = cand.box_2d;
  const eW = Math.max(1, eXmax - eXmin);
  const eH = Math.max(1, eYmax - eYmin);
  const cW = Math.max(1, cXmax - cXmin);
  const cH = Math.max(1, cYmax - cYmin);

  // Only applies when existing is a substantial close-up foreground human
  if (eW * eH < 140_000 && eH < 520) return false;

  // Preserve a distinct portrait second person standing clearly taller behind/above the foreground head
  const risesAboveHead = cYmin <= eYmin - eH * 0.12 && cW / cH < 0.72;
  if (risesAboveHead) return false;

  const containment = computeBoxContainment(existing.box_2d, cand.box_2d);
  const iou = computeBoxIoU(existing.box_2d, cand.box_2d);
  if (containment >= 0.34 || iou >= 0.16) {
    return true;
  }

  // Tile seam directly slices through the outstretched arm/shoulder touching the full-frame body
  const hGap = eXmax < cXmin ? cXmin - eXmax : cXmax < eXmin ? eXmin - cXmax : 0;
  const interY = Math.max(0, Math.min(eYmax, cYmax) - Math.max(eYmin, cYmin));
  const vOverlap = interY / Math.max(1, Math.min(eH, cH));
  if (hGap <= 40 && vOverlap >= 0.42 && cand.confidence < 72) {
    return true;
  }

  return false;
}

/**
 * Crowd-aware Non-Maximum Suppression across multi-scale zoom tiles.
 * Preserves closely packed shoulder-to-shoulder people in dense crowds (50-200+ people),
 * splits multi-person composite group wrappers into individual humans, stitches vertically
 * or horizontally seam-split close-up halves, and suppresses attached hand/arm fragments.
 */
export function mergeCrowdTileDetections(
  candidates: TileCandidateBox[],
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

  // In dense crowds, reject giant vague "whole crowd" blob boxes (> 22% of frame) when smaller individual people exist
  const withoutGiantBlobs = denseCrowdMode
    ? filtered.filter((c) => {
        const w = c.box_2d[3] - c.box_2d[1];
        const h = c.box_2d[2] - c.box_2d[0];
        return !(w * h > 220_000 && c.confidence < 72);
      })
    : filtered;

  // Split giant composite group wrappers that swallow 2+ distinct side-by-side people
  const cleanPool = filterCompositeGroupWrappers(withoutGiantBlobs);

  // Prefer unclipped full-frame boxes over interior-seam-clipped partial crops of similar confidence,
  // otherwise prefer higher confidence and tighter/more localized boxes
  const sorted = [...cleanPool].sort((a, b) => {
    const aClipped = isInteriorSeamClipped(a.tileMeta);
    const bClipped = isInteriorSeamClipped(b.tileMeta);
    const aEffective = a.confidence - (aClipped ? 8 : 0);
    const bEffective = b.confidence - (bClipped ? 8 : 0);
    if (bEffective !== aEffective) return bEffective - aEffective;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const areaA = (a.box_2d[2] - a.box_2d[0]) * (a.box_2d[3] - a.box_2d[1]);
    const areaB = (b.box_2d[2] - b.box_2d[0]) * (b.box_2d[3] - b.box_2d[1]);
    return areaA - areaB;
  });

  const kept: TileCandidateBox[] = [];
  for (const cand of sorted) {
    let matchedIdx = -1;
    let matchedSeamSplit = false;
    for (let i = 0; i < kept.length; i += 1) {
      const existing = kept[i];
      if (
        isVerticallySplitSamePerson(existing.box_2d, cand.box_2d) ||
        isHorizontallySplitTileSeamPair(existing, cand)
      ) {
        matchedIdx = i;
        matchedSeamSplit = true;
        break;
      }
      if (
        isCrowdDuplicate(existing.box_2d, cand.box_2d, denseCrowdMode) ||
        isAttachedLimbOrHandFragment(existing, cand) ||
        isSeamClippedLimbSliceOfFullPerson(existing, cand)
      ) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx === -1) {
      kept.push({ ...cand, box_2d: [...cand.box_2d] as [number, number, number, number] });
    } else if (matchedSeamSplit) {
      // Stitch vertically or horizontally split seam halves back into one complete person box
      const existing = kept[matchedIdx];
      const [eYmin, eXmin, eYmax, eXmax] = existing.box_2d;
      const [cYmin, cXmin, cYmax, cXmax] = cand.box_2d;
      existing.box_2d = [
        Math.min(eYmin, cYmin),
        Math.min(eXmin, cXmin),
        Math.max(eYmax, cYmax),
        Math.max(eXmax, cXmax),
      ];
      existing.confidence = Math.max(existing.confidence, cand.confidence);
    } else if (!denseCrowdMode && cand.confidence >= 52) {
      // If a full-frame box scored slightly below a tile crop of the same person's lower half,
      // restore the unclipped vertical head/torso bounds without widening into neighboring people
      const existing = kept[matchedIdx];
      const [eYmin, eXmin, eYmax, eXmax] = existing.box_2d;
      const [cYmin, cXmin, cYmax, cXmax] = cand.box_2d;
      const eW = Math.max(1, eXmax - eXmin);
      const eH = Math.max(1, eYmax - eYmin);
      const cW = Math.max(1, cXmax - cXmin);
      const cH = Math.max(1, cYmax - cYmin);
      const interX = Math.max(0, Math.min(eXmax, cXmax) - Math.max(eXmin, cXmin));
      if (cW <= eW * 1.25 && interX / eW >= 0.8 && cH > eH * 1.22) {
        existing.box_2d = [
          Math.min(eYmin, cYmin),
          eXmin,
          Math.max(eYmax, cYmax),
          eXmax,
        ];
      }
    }
  }

  // Sort cleanly left-to-right, top-to-bottom for deterministic IDs and strip internal tile metadata
  kept.sort((a, b) => {
    const rowDiff = Math.floor(a.box_2d[0] / 120) - Math.floor(b.box_2d[0] / 120);
    if (rowDiff !== 0) return rowDiff;
    return a.box_2d[1] - b.box_2d[1];
  });

  return kept.map(({ tileMeta: _meta, ...clean }) => clean);
}

export const DEFAULT_DEMO_CROWD_THRESHOLD = 15;
export const DEFAULT_LIVE_CROWD_THRESHOLD = 30;
export const MIN_CROWD_DENSITY_THRESHOLD = 5;
export const MAX_CROWD_DENSITY_THRESHOLD = 100;

export const DEFAULT_ROOM_AREA_SQM = 50;
export const MIN_ROOM_AREA_SQM = 10;
export const MAX_ROOM_AREA_SQM = 1000;
export const ELEVATED_DENSITY_PER_SQM = 1.0;
export const CRITICAL_DENSITY_PER_SQM = 2.0;

export interface RoomSizePreset {
  id: 'small' | 'medium' | 'large' | 'xlarge';
  label: string;
  shortLabel: string;
  areaSqm: number;
}

export const ROOM_SIZE_PRESETS: RoomSizePreset[] = [
  { id: 'small', label: 'Small Room / Corridor (20 m²)', shortLabel: '20 m² Room', areaSqm: 20 },
  { id: 'medium', label: 'Classroom / Hallway (50 m²)', shortLabel: '50 m² Class', areaSqm: 50 },
  { id: 'large', label: 'Exhibition Hall (150 m²)', shortLabel: '150 m² Hall', areaSqm: 150 },
  { id: 'xlarge', label: 'Mall Atrium / Arena (400 m²)', shortLabel: '400 m² Atrium', areaSqm: 400 },
];

export interface LocalizedBottleneckResult {
  isBottleneck: boolean;
  clusterCount: number;
  clusterCoverageRatio: number;
}

/**
 * Detects whether >= 10 people are tightly packed shoulder-to-shoulder (box gap <= 20 normalized
 * units horizontally & vertically) into a compact connected bottleneck pocket covering <= 32%
 * of the frame (e.g. a narrow doorway or exit gate), which poses a localized crush risk even
 * inside a large auditorium or mall atrium — while evenly spread-out crowds stay SAFE.
 */
export function detectLocalizedCrushCluster(
  detectedPeople?: DetectedPersonBox[]
): LocalizedBottleneckResult {
  if (!detectedPeople || detectedPeople.length < 10) {
    return { isBottleneck: false, clusterCount: 0, clusterCoverageRatio: 0 };
  }

  const n = detectedPeople.length;
  const boxes = detectedPeople.map((p) => p.box_2d);
  const visited = new Uint8Array(n);
  let bestComponent: number[] = [];

  const isTightlyPacked = (
    a: [number, number, number, number],
    b: [number, number, number, number]
  ): boolean => {
    const hGap = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
    const vGap = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2]));
    return hGap <= 20 && vGap <= 20;
  };

  for (let i = 0; i < n; i += 1) {
    if (visited[i]) continue;
    const queue: number[] = [i];
    visited[i] = 1;
    const component: number[] = [];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (let j = 0; j < n; j += 1) {
        if (visited[j]) continue;
        if (isTightlyPacked(boxes[curr], boxes[j])) {
          visited[j] = 1;
          queue.push(j);
        }
      }
    }

    if (component.length > bestComponent.length) {
      bestComponent = component;
    }
  }

  if (bestComponent.length < 10) {
    return {
      isBottleneck: false,
      clusterCount: bestComponent.length,
      clusterCoverageRatio: 0,
    };
  }

  let minX = 1000;
  let minY = 1000;
  let maxX = 0;
  let maxY = 0;
  for (const idx of bestComponent) {
    const [ymin, xmin, ymax, xmax] = boxes[idx];
    if (xmin < minX) minX = xmin;
    if (ymin < minY) minY = ymin;
    if (xmax > maxX) maxX = xmax;
    if (ymax > maxY) maxY = ymax;
  }

  const coverageRatio = Number((((maxX - minX) * (maxY - minY)) / 1_000_000).toFixed(2));
  return {
    isBottleneck: coverageRatio <= 0.32,
    clusterCount: bestComponent.length,
    clusterCoverageRatio: coverageRatio,
  };
}

export const PANIC_TRAIL_VELOCITY_MULTI_PERSON_THRESHOLD = 260;
export const PANIC_TRAIL_VELOCITY_SINGLE_SPIKE_THRESHOLD = 380;

export type StampedeDisasterRiskLabel =
  | 'NORMAL'
  | 'BOTTLENECK WARNING'
  | 'CRITICAL STAMPEDE RISK';

export interface CrowdCrushAssessment {
  status: 'SAFE' | 'ELEVATED' | 'CRITICAL CRUSH RISK';
  disasterRiskLabel: StampedeDisasterRiskLabel;
  personCount: number;
  threshold: number;
  ratio: number;
  percentOfThreshold: number;
  exceeded: boolean;
  summary: string;
  roomAreaSqm?: number;
  densityPerSqm?: number;
  effectiveCapacity?: number;
  isLocalizedBottleneck?: boolean;
  bottleneckClusterCount?: number;
  panicVelocitySpike?: boolean;
  peakTrailVelocity?: number;
}

export interface CrowdCrushOptions {
  roomAreaSqm?: number;
  detectedPeople?: DetectedPersonBox[];
  /** Peak tracked nose-trail velocity in normalized 0..1000 units/sec */
  maxTrailVelocityNormPerSec?: number;
}

/**
 * Evaluates live Multi-Scale Crowd AI Pyramid headcount against the configured
 * Room Area (m²), areal crowd density (people/m²), localized exit bottlenecks,
 * nose-trail panic velocity spikes, and Crowd Density Threshold to classify
 * NORMAL (SAFE) -> BOTTLENECK WARNING (ELEVATED) -> CRITICAL STAMPEDE RISK (CRITICAL CRUSH RISK).
 *
 * When `options.roomAreaSqm` is provided, large rooms (e.g. 150–400 m² halls) stay SAFE
 * when many people are safely spread out (< 1.0 person/m²), while small rooms (>= 2.0 p/m²),
 * localized shoulder-to-shoulder exit bottlenecks, OR sudden panic velocity spikes immediately
 * trigger CRITICAL STAMPEDE RISK.
 */
export function evaluateCrowdCrushRisk(
  personCount: number,
  threshold = DEFAULT_DEMO_CROWD_THRESHOLD,
  options?: CrowdCrushOptions
): CrowdCrushAssessment {
  const safeCount = Math.max(0, Math.round(Number(personCount) || 0));
  const safeThreshold = Math.max(
    MIN_CROWD_DENSITY_THRESHOLD,
    Math.min(MAX_CROWD_DENSITY_THRESHOLD, Math.round(Number(threshold) || DEFAULT_DEMO_CROWD_THRESHOLD))
  );
  const peakTrailVelocity =
    typeof options?.maxTrailVelocityNormPerSec === 'number' &&
    Number.isFinite(options.maxTrailVelocityNormPerSec)
      ? Math.max(0, Math.round(options.maxTrailVelocityNormPerSec))
      : 0;
  const panicVelocitySpike =
    (safeCount >= 2 && peakTrailVelocity >= PANIC_TRAIL_VELOCITY_MULTI_PERSON_THRESHOLD) ||
    (safeCount >= 1 && peakTrailVelocity >= PANIC_TRAIL_VELOCITY_SINGLE_SPIKE_THRESHOLD);

  // Room-area-aware physical crowd density mode (people / m² + localized crush bottleneck)
  if (typeof options?.roomAreaSqm === 'number' && Number.isFinite(options.roomAreaSqm)) {
    const roomAreaSqm = Math.max(
      MIN_ROOM_AREA_SQM,
      Math.min(MAX_ROOM_AREA_SQM, Math.round(options.roomAreaSqm))
    );
    const densityPerSqm = Number((safeCount / roomAreaSqm).toFixed(2));
    const roomPhysicalCapacity = Math.max(
      MIN_CROWD_DENSITY_THRESHOLD,
      Math.round(roomAreaSqm * CRITICAL_DENSITY_PER_SQM)
    );
    const isSmallRoom = roomAreaSqm <= 25;
    const effectiveCapacity = isSmallRoom
      ? Math.min(safeThreshold, roomPhysicalCapacity)
      : roomPhysicalCapacity;

    const bottleneck = detectLocalizedCrushCluster(options.detectedPeople);
    const ratio = safeCount / Math.max(1, effectiveCapacity);
    const percentOfThreshold = Math.round(ratio * 100);

    const isCriticalByDensity = densityPerSqm >= CRITICAL_DENSITY_PER_SQM;
    const isCriticalBySmallRoomCap = isSmallRoom && safeCount >= effectiveCapacity;
    const isElevatedByDensity = densityPerSqm >= ELEVATED_DENSITY_PER_SQM;
    const isElevatedBySmallRoomCap =
      isSmallRoom && safeCount >= Math.max(1, Math.ceil(effectiveCapacity * 0.7));

    if (panicVelocitySpike) {
      return {
        status: 'CRITICAL CRUSH RISK',
        disasterRiskLabel: 'CRITICAL STAMPEDE RISK',
        personCount: safeCount,
        threshold: effectiveCapacity,
        ratio: Number(ratio.toFixed(2)),
        percentOfThreshold: Math.max(100, percentOfThreshold),
        exceeded: true,
        roomAreaSqm,
        densityPerSqm,
        effectiveCapacity,
        isLocalizedBottleneck: bottleneck.isBottleneck,
        bottleneckClusterCount: bottleneck.clusterCount,
        panicVelocitySpike: true,
        peakTrailVelocity,
        summary: `CRITICAL STAMPEDE RISK — PANIC VELOCITY SPIKE (${peakTrailVelocity} u/s) with ${safeCount} ${
          safeCount === 1 ? 'person' : 'people'
        } in ${roomAreaSqm} m² — initiate immediate evacuation & open emergency exits.`,
      };
    }

    if (bottleneck.isBottleneck) {
      return {
        status: 'CRITICAL CRUSH RISK',
        disasterRiskLabel: 'CRITICAL STAMPEDE RISK',
        personCount: safeCount,
        threshold: effectiveCapacity,
        ratio: Number(ratio.toFixed(2)),
        percentOfThreshold: Math.max(100, percentOfThreshold),
        exceeded: true,
        roomAreaSqm,
        densityPerSqm,
        effectiveCapacity,
        isLocalizedBottleneck: true,
        bottleneckClusterCount: bottleneck.clusterCount,
        panicVelocitySpike: false,
        peakTrailVelocity,
        summary: `LOCALIZED CRUSH BOTTLENECK: ${bottleneck.clusterCount} people jammed into ${Math.round(
          bottleneck.clusterCoverageRatio * 100
        )}% of frame inside ${roomAreaSqm} m² zone (${densityPerSqm.toFixed(2)} p/m²) — open secondary exits immediately.`,
      };
    }

    if (isCriticalByDensity || isCriticalBySmallRoomCap) {
      return {
        status: 'CRITICAL CRUSH RISK',
        disasterRiskLabel: 'CRITICAL STAMPEDE RISK',
        personCount: safeCount,
        threshold: effectiveCapacity,
        ratio: Number(ratio.toFixed(2)),
        percentOfThreshold,
        exceeded: true,
        roomAreaSqm,
        densityPerSqm,
        effectiveCapacity,
        isLocalizedBottleneck: false,
        bottleneckClusterCount: bottleneck.clusterCount,
        panicVelocitySpike: false,
        peakTrailVelocity,
        summary: `STAMPEDE / OVERCROWDING RISK: ${safeCount} people in ${roomAreaSqm} m² (${densityPerSqm.toFixed(
          2
        )} people/m², limit ${effectiveCapacity}) — initiate immediate crowd dispersal & PA evacuation.`,
      };
    }

    if (isElevatedByDensity || isElevatedBySmallRoomCap) {
      return {
        status: 'ELEVATED',
        disasterRiskLabel: 'BOTTLENECK WARNING',
        personCount: safeCount,
        threshold: effectiveCapacity,
        ratio: Number(ratio.toFixed(2)),
        percentOfThreshold,
        exceeded: false,
        roomAreaSqm,
        densityPerSqm,
        effectiveCapacity,
        isLocalizedBottleneck: false,
        bottleneckClusterCount: bottleneck.clusterCount,
        panicVelocitySpike: false,
        peakTrailVelocity,
        summary: `BOTTLENECK WARNING: Elevated crowd density — ${safeCount} people in ${roomAreaSqm} m² (${densityPerSqm.toFixed(
          2
        )} people/m²) — monitor exits closely.`,
      };
    }

    return {
      status: 'SAFE',
      disasterRiskLabel: 'NORMAL',
      personCount: safeCount,
      threshold: effectiveCapacity,
      ratio: Number(ratio.toFixed(2)),
      percentOfThreshold,
      exceeded: false,
      roomAreaSqm,
      densityPerSqm,
      effectiveCapacity,
      isLocalizedBottleneck: false,
      bottleneckClusterCount: bottleneck.clusterCount,
      panicVelocitySpike: false,
      peakTrailVelocity,
      summary: `Safe density: ${safeCount} people in ${roomAreaSqm} m² (${densityPerSqm.toFixed(
        2
      )} people/m² · safe capacity ${effectiveCapacity}).`,
    };
  }

  // Legacy headcount-only mode (backward compatible when roomAreaSqm is omitted)
  const ratio = safeCount / safeThreshold;
  const percentOfThreshold = Math.round(ratio * 100);
  const elevatedCutoff = Math.max(1, Math.ceil(safeThreshold * 0.7));

  if (panicVelocitySpike) {
    return {
      status: 'CRITICAL CRUSH RISK',
      disasterRiskLabel: 'CRITICAL STAMPEDE RISK',
      personCount: safeCount,
      threshold: safeThreshold,
      ratio: Number(ratio.toFixed(2)),
      percentOfThreshold: Math.max(100, percentOfThreshold),
      exceeded: true,
      panicVelocitySpike: true,
      peakTrailVelocity,
      summary: `CRITICAL STAMPEDE RISK — PANIC VELOCITY SPIKE (${peakTrailVelocity} u/s) with ${safeCount} people — trigger immediate evacuation.`,
    };
  }

  if (safeCount >= safeThreshold) {
    return {
      status: 'CRITICAL CRUSH RISK',
      disasterRiskLabel: 'CRITICAL STAMPEDE RISK',
      personCount: safeCount,
      threshold: safeThreshold,
      ratio: Number(ratio.toFixed(2)),
      percentOfThreshold,
      exceeded: true,
      panicVelocitySpike: false,
      peakTrailVelocity,
      summary: `STAMPEDE / OVERCROWDING RISK: ${safeCount} people detected (threshold ${safeThreshold}) — initiate immediate crowd dispersal & evacuation.`,
    };
  }

  if (safeCount >= elevatedCutoff) {
    return {
      status: 'ELEVATED',
      disasterRiskLabel: 'BOTTLENECK WARNING',
      personCount: safeCount,
      threshold: safeThreshold,
      ratio: Number(ratio.toFixed(2)),
      percentOfThreshold,
      exceeded: false,
      panicVelocitySpike: false,
      peakTrailVelocity,
      summary: `BOTTLENECK WARNING: Elevated crowd density ${safeCount}/${safeThreshold} (${percentOfThreshold}% of crush threshold) — monitor exits closely.`,
    };
  }

  return {
    status: 'SAFE',
    disasterRiskLabel: 'NORMAL',
    personCount: safeCount,
    threshold: safeThreshold,
    ratio: Number(ratio.toFixed(2)),
    percentOfThreshold,
    exceeded: false,
    panicVelocitySpike: false,
    peakTrailVelocity,
    summary: `Safe crowd density: ${safeCount}/${safeThreshold} people tracked.`,
  };
}
