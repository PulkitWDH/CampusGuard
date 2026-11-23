import type {
  AppearanceSignature,
  DetectedPersonBox,
  TrackedSubject,
  WatchlistSubject,
} from '../types';

export interface PtzViewportRect {
  /** Normalized 0..1000 crop coordinates inside active video draw rect */
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  zoomFactor: number;
}

export interface WatchlistMatchResult {
  subjectId: string;
  watchlistItem: WatchlistSubject;
  similarity: number;
  box_2d: [number, number, number, number];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function boxIoU(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const interYMin = Math.max(a[0], b[0]);
  const interXMin = Math.max(a[1], b[1]);
  const interYMax = Math.min(a[2], b[2]);
  const interXMax = Math.min(a[3], b[3]);
  const interW = Math.max(0, interXMax - interXMin);
  const interH = Math.max(0, interYMax - interYMin);
  const interArea = interW * interH;
  if (interArea <= 0) return 0;
  const areaA = Math.max(1, (a[2] - a[0]) * (a[3] - a[1]));
  const areaB = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
  return interArea / (areaA + areaB - interArea);
}

function boxCenter(box: [number, number, number, number]): { x: number; y: number } {
  return {
    x: (box[1] + box[3]) / 2,
    y: (box[0] + box[2]) / 2,
  };
}

/**
 * Maintains persistent Subject IDs (SUBJ-01, SUBJ-02...), movement trajectory trails,
 * dwell time, and normalized movement speed across frames.
 */
export function updateTrackedSubjects(
  prevSubjects: TrackedSubject[],
  detections: DetectedPersonBox[],
  nowMs: number,
  nextNumericIdStart: number,
  options?: { maxAgeMs?: number; maxTrailPoints?: number }
): { subjects: TrackedSubject[]; nextNumericId: number } {
  const maxAgeMs = options?.maxAgeMs ?? 6000;
  const maxTrailPoints = options?.maxTrailPoints ?? 28;

  const activePrev = prevSubjects.filter((s) => nowMs - s.lastSeenAtMs <= maxAgeMs);
  const matchedPrevIds = new Set<string>();
  const matchedDetIndices = new Set<number>();

  // Score all (prev, detection) candidate pairs
  const pairs: Array<{ prevIdx: number; detIdx: number; score: number }> = [];
  for (let p = 0; p < activePrev.length; p += 1) {
    const prev = activePrev[p];
    const pc = boxCenter(prev.box_2d);
    for (let d = 0; d < detections.length; d += 1) {
      const det = detections[d];
      const dc = boxCenter(det.box_2d);
      const iou = boxIoU(prev.box_2d, det.box_2d);
      const dist = Math.hypot(dc.x - pc.x, dc.y - pc.y);
      const proxScore = Math.max(0, 1 - dist / 280);
      const score = iou * 0.65 + proxScore * 0.35;
      if (score >= 0.24 || iou >= 0.18) {
        pairs.push({ prevIdx: p, detIdx: d, score });
      }
    }
  }

  pairs.sort((a, b) => b.score - a.score);

  const nextSubjects: TrackedSubject[] = [];
  for (const pair of pairs) {
    const prev = activePrev[pair.prevIdx];
    if (matchedPrevIds.has(prev.id) || matchedDetIndices.has(pair.detIdx)) continue;
    matchedPrevIds.add(prev.id);
    matchedDetIndices.add(pair.detIdx);

    const det = detections[pair.detIdx];
    const prevCenter = boxCenter(prev.box_2d);
    const nextCenter = boxCenter(det.box_2d);
    const dtSec = Math.max(0.05, (nowMs - prev.lastSeenAtMs) / 1000);
    const stepDist = Math.hypot(nextCenter.x - prevCenter.x, nextCenter.y - prevCenter.y);
    const instantSpeed = stepDist / dtSec;
    const smoothedSpeed = prev.speedNormPerSec * 0.6 + instantSpeed * 0.4;

    const lastTrail = prev.trail[prev.trail.length - 1];
    const trailDist = lastTrail
      ? Math.hypot(nextCenter.x - lastTrail.x, nextCenter.y - lastTrail.y)
      : 999;

    const nextTrail =
      trailDist >= 8 || prev.trail.length === 0
        ? [...prev.trail, { x: Math.round(nextCenter.x), y: Math.round(nextCenter.y), atMs: nowMs }].slice(
            -maxTrailPoints
          )
        : prev.trail;

    nextSubjects.push({
      ...prev,
      box_2d: det.box_2d,
      confidence: det.confidence,
      faceOccluded: det.faceOccluded,
      occludedBy: det.occludedBy,
      lastSeenAtMs: nowMs,
      dwellSeconds: Math.max(0, Math.round((nowMs - prev.firstSeenAtMs) / 1000)),
      speedNormPerSec: Math.round(smoothedSpeed),
      trail: nextTrail,
    });
  }

  let nextNumericId = nextNumericIdStart;
  for (let d = 0; d < detections.length; d += 1) {
    if (matchedDetIndices.has(d)) continue;
    const det = detections[d];
    const center = boxCenter(det.box_2d);
    const numericId = nextNumericId++;
    nextSubjects.push({
      id: `SUBJ-${String(numericId).padStart(2, '0')}`,
      numericId,
      box_2d: det.box_2d,
      confidence: det.confidence,
      faceOccluded: det.faceOccluded,
      occludedBy: det.occludedBy,
      firstSeenAtMs: nowMs,
      lastSeenAtMs: nowMs,
      dwellSeconds: 0,
      speedNormPerSec: 0,
      trail: [{ x: Math.round(center.x), y: Math.round(center.y), atMs: nowMs }],
    });
  }

  nextSubjects.sort((a, b) => a.numericId - b.numericId);
  return { subjects: nextSubjects, nextNumericId };
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d > 0) {
    if (max === rn) {
      h = ((gn - bn) / d) % 6;
    } else if (max === gn) {
      h = (bn - rn) / d + 2;
    } else {
      h = (rn - gn) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

function toHexChannel(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

function extractRegionHistogram(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): { bins: number[]; avgHex: string; sampleCount: number } {
  const bins = new Array<number>(18).fill(0);
  const startX = clamp(Math.floor(x0), 0, Math.max(0, width - 1));
  const endX = clamp(Math.floor(x1), startX + 1, width);
  const startY = clamp(Math.floor(y0), 0, Math.max(0, height - 1));
  const endY = clamp(Math.floor(y1), startY + 1, height);

  const stepX = Math.max(1, Math.floor((endX - startX) / 24));
  const stepY = Math.max(1, Math.floor((endY - startY) / 24));

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  for (let y = startY; y < endY; y += stepY) {
    for (let x = startX; x < endX; x += stepX) {
      const idx = (y * width + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      rSum += r;
      gSum += g;
      bSum += b;
      count += 1;

      const [h, s, v] = rgbToHsv(r, g, b);
      if (s >= 0.18 && v >= 0.12) {
        const hueBin = Math.min(11, Math.floor(h / 30));
        bins[hueBin] += 1;
      } else {
        const grayBin = Math.min(5, Math.floor(v * 6));
        bins[12 + grayBin] += 1;
      }
    }
  }

  if (count === 0) {
    return { bins, avgHex: '#52525b', sampleCount: 0 };
  }

  let normSq = 0;
  for (let i = 0; i < bins.length; i += 1) {
    normSq += bins[i] * bins[i];
  }
  const norm = Math.sqrt(normSq) || 1;
  for (let i = 0; i < bins.length; i += 1) {
    bins[i] = Number((bins[i] / norm).toFixed(4));
  }

  const avgHex = `#${toHexChannel(rSum / count)}${toHexChannel(gSum / count)}${toHexChannel(bSum / count)}`;
  return { bins, avgHex, sampleCount: count };
}

/**
 * Extracts a face-occlusion-proof spatial HSV clothing/appearance signature
 * directly from real RGBA video pixels inside a person's bounding box.
 */
export function extractAppearanceSignature(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  box2d: [number, number, number, number]
): AppearanceSignature {
  const [ymin, xmin, ymax, xmax] = box2d;
  const pxXMin = (clamp(xmin, 0, 1000) / 1000) * width;
  const pxXMax = (clamp(xmax, 0, 1000) / 1000) * width;
  const pxYMin = (clamp(ymin, 0, 1000) / 1000) * height;
  const pxYMax = (clamp(ymax, 0, 1000) / 1000) * height;

  const bw = Math.max(4, pxXMax - pxXMin);
  const bh = Math.max(4, pxYMax - pxYMin);

  // Inset horizontally by 20% to focus on torso/clothing rather than room background
  const innerX0 = pxXMin + bw * 0.2;
  const innerX1 = pxXMax - bw * 0.2;

  const upperY0 = pxYMin + bh * 0.18;
  const upperY1 = pxYMin + bh * 0.56;
  const lowerY0 = pxYMin + bh * 0.56;
  const lowerY1 = pxYMin + bh * 0.90;

  const upper = extractRegionHistogram(rgba, width, height, innerX0, upperY0, innerX1, upperY1);
  const lower = extractRegionHistogram(rgba, width, height, innerX0, lowerY0, innerX1, lowerY1);
  const lowerBodyVisible = ymax < 975 && lower.sampleCount >= 8;

  return {
    vector: [...upper.bins, ...lower.bins],
    upperColorHex: upper.avgHex,
    lowerColorHex: lower.avgHex,
    lowerBodyVisible,
  };
}

function dotRange(a: number[], b: number[], start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i += 1) {
    sum += (a[i] || 0) * (b[i] || 0);
  }
  return clamp(sum, 0, 1);
}

/**
 * Computes 0..100 appearance Re-ID similarity between two subjects' spatial HSV descriptors.
 * Works across cameras and even when the person's face is covered.
 */
export function computeAppearanceSimilarity(
  a: AppearanceSignature,
  b: AppearanceSignature
): number {
  if (a.vector.length < 36 || b.vector.length < 36) return 0;
  const upperSim = dotRange(a.vector, b.vector, 0, 18);
  const lowerSim = dotRange(a.vector, b.vector, 18, 36);

  if (!a.lowerBodyVisible || !b.lowerBodyVisible) {
    return Math.round(upperSim * 100);
  }

  // Require strong agreement on both upper and lower torso to avoid false matches
  const combined = upperSim * 0.62 + lowerSim * 0.38;
  const minPart = Math.min(upperSim, lowerSim);
  const adjusted = minPart < 0.45 ? combined * 0.78 : combined;
  return Math.round(clamp(adjusted, 0, 1) * 100);
}

/**
 * Matches currently tracked subjects against enrolled Watchlist subjects.
 */
export function matchSubjectsToWatchlist(
  subjects: TrackedSubject[],
  signaturesBySubjectId: Record<string, AppearanceSignature>,
  watchlist: WatchlistSubject[],
  thresholdPercent = 84
): WatchlistMatchResult[] {
  if (subjects.length === 0 || watchlist.length === 0) return [];
  const results: WatchlistMatchResult[] = [];

  for (const subject of subjects) {
    const sig = signaturesBySubjectId[subject.id];
    if (!sig) continue;

    let bestItem: WatchlistSubject | null = null;
    let bestScore = 0;
    for (const target of watchlist) {
      const score = computeAppearanceSimilarity(sig, target.signature);
      if (score > bestScore) {
        bestScore = score;
        bestItem = target;
      }
    }

    if (bestItem && bestScore >= thresholdPercent) {
      results.push({
        subjectId: subject.id,
        watchlistItem: bestItem,
        similarity: bestScore,
        box_2d: subject.box_2d,
      });
    }
  }

  return results;
}

/**
 * Computes a smoothly damped 16:9 Digital Auto-PTZ zoom crop locked onto a target subject's
 * head & upper torso, clamped cleanly inside normalized [0..1000] video bounds.
 */
export function computeSmoothPtzViewport(
  targetBox: [number, number, number, number],
  prevViewport: PtzViewportRect | null,
  smoothing = 0.22
): PtzViewportRect {
  const [ymin, xmin, ymax, xmax] = targetBox;
  const boxW = Math.max(80, xmax - xmin);
  const boxH = Math.max(100, ymax - ymin);

  // Target center slightly biased toward upper body/head (38% down from top of bounding box)
  const cx = (xmin + xmax) / 2;
  const cy = ymin + boxH * 0.38;

  // Compute zoom window width/height with generous padding so subject stays comfortably framed
  const targetSpan = clamp(Math.max(boxW * 2.1, boxH * 1.15), 260, 620);
  const halfW = targetSpan / 2;
  const halfH = targetSpan / 2;

  let nextXMin = cx - halfW;
  let nextXMax = cx + halfW;
  if (nextXMin < 0) {
    nextXMax -= nextXMin;
    nextXMin = 0;
  }
  if (nextXMax > 1000) {
    nextXMin -= nextXMax - 1000;
    nextXMax = 1000;
  }

  let nextYMin = cy - halfH;
  let nextYMax = cy + halfH;
  if (nextYMin < 0) {
    nextYMax -= nextYMin;
    nextYMin = 0;
  }
  if (nextYMax > 1000) {
    nextYMin -= nextYMax - 1000;
    nextYMax = 1000;
  }

  nextXMin = clamp(nextXMin, 0, 990);
  nextXMax = clamp(nextXMax, nextXMin + 10, 1000);
  nextYMin = clamp(nextYMin, 0, 990);
  nextYMax = clamp(nextYMax, nextYMin + 10, 1000);

  if (!prevViewport) {
    const zoomFactor = Number((1000 / Math.max(100, nextXMax - nextXMin)).toFixed(1));
    return {
      xmin: nextXMin,
      ymin: nextYMin,
      xmax: nextXMax,
      ymax: nextYMax,
      zoomFactor,
    };
  }

  const alpha = clamp(smoothing, 0.05, 1);
  const lerp = (a: number, b: number) => a + (b - a) * alpha;
  const xminSmooth = lerp(prevViewport.xmin, nextXMin);
  const yminSmooth = lerp(prevViewport.ymin, nextYMin);
  const xmaxSmooth = lerp(prevViewport.xmax, nextXMax);
  const ymaxSmooth = lerp(prevViewport.ymax, nextYMax);
  const zoomFactor = Number((1000 / Math.max(100, xmaxSmooth - xminSmooth)).toFixed(1));

  return {
    xmin: xminSmooth,
    ymin: yminSmooth,
    xmax: xmaxSmooth,
    ymax: ymaxSmooth,
    zoomFactor,
  };
}
