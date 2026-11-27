import type { TrackedSubject } from '../types';
import { mapNormalizedBoxToRect, type ContainDrawRect } from './monitoringLogic';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computes the anatomical nose anchor coordinate in normalized 0..1000 space.
 * Adapts vertical ratio cleanly between full-body standing detections and close-up upper-body views.
 */
export function computeNoseAnchor(
  box: [number, number, number, number]
): { x: number; y: number } {
  const [ymin, xmin, ymax, xmax] = box;
  const w = Math.max(1, xmax - xmin);
  const h = Math.max(1, ymax - ymin);
  const aspect = h / w;

  // Full-body standing person (~7.5 heads tall): nose is ~13.5% from top of box.
  // Waist-up person (~4.5 heads): nose is ~20% from top.
  // Close-up head/shoulders (~2.5 heads): nose is ~28% from top.
  const noseRatio = aspect >= 1.65 ? 0.135 : aspect >= 1.15 ? 0.2 : 0.28;
  return {
    x: Math.max(0, Math.min(1000, (xmin + xmax) / 2)),
    y: Math.max(0, Math.min(1000, ymin + h * noseRatio)),
  };
}

/**
 * Tests whether a logical pixel point (px, py) falls strictly inside the anatomical
 * human body silhouette (head + neck + shoulders + torso + arms + legs),
 * excluding empty background corners and gaps around the person's bounding box.
 */
export function isPointInsideBodySilhouette(
  px: number,
  py: number,
  rect: PixelRect
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const u = (px - rect.x) / rect.width;
  const v = (py - rect.y) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;

  const isUpperBody = rect.height / rect.width < 1.35;
  const dx = Math.abs(u - 0.5);

  if (isUpperBody) {
    // Head oval
    const headDy = (v - 0.26) / 0.23;
    const headDx = (u - 0.5) / 0.22;
    if (headDx * headDx + headDy * headDy <= 1) return true;
    // Neck
    if (v >= 0.42 && v <= 0.54 && dx <= 0.11) return true;
    // Rounded shoulders & upper torso / arms (excludes top-left & top-right wall corners)
    if (v >= 0.50 && v <= 1.0) {
      const shoulderCurve = v < 0.66 ? 0.20 + ((v - 0.50) / 0.16) * 0.26 : 0.46;
      return dx <= shoulderCurve;
    }
    return false;
  }

  // Full-body standing silhouette
  // 1. Head oval
  const headDy = (v - 0.125) / 0.11;
  const headDx = (u - 0.5) / 0.175;
  if (headDx * headDx + headDy * headDy <= 1) return true;

  // 2. Neck
  if (v >= 0.21 && v <= 0.27 && dx <= 0.095) return true;

  // 3. Shoulders, chest, arms & torso
  if (v >= 0.25 && v <= 0.58) {
    const halfWidth =
      v < 0.34
        ? 0.16 + ((v - 0.25) / 0.09) * 0.28 // curved shoulder slope
        : v < 0.48
          ? 0.44 - ((v - 0.34) / 0.14) * 0.05 // arms + chest
          : 0.39 - ((v - 0.48) / 0.10) * 0.06; // waist/hips
    return dx <= halfWidth;
  }

  // 4. Hips & Legs (two distinct leg columns with center gap below v=0.64)
  if (v > 0.58 && v <= 1.0) {
    const outerLimit = 0.33 - ((v - 0.58) / 0.42) * 0.07;
    if (dx > outerLimit) return false;
    if (v > 0.65 && dx < 0.045) return false; // clean inner gap between legs
    return true;
  }

  return false;
}

/**
 * Finds which tracked subject's BODY silhouette is currently under the cursor.
 * Prioritizes smaller/foreground subjects when overlapping.
 */
export function findHoveredBodySubject(
  pointerPx: { x: number; y: number },
  subjects: TrackedSubject[],
  activeRect: ContainDrawRect
): TrackedSubject | null {
  let best: TrackedSubject | null = null;
  let bestArea = Infinity;

  for (const subj of subjects) {
    const mapped = mapNormalizedBoxToRect(subj.box_2d, activeRect);
    if (isPointInsideBodySilhouette(pointerPx.x, pointerPx.y, mapped)) {
      const area = mapped.width * mapped.height;
      if (area < bestArea) {
        bestArea = area;
        best = subj;
      }
    }
  }
  return best;
}

/**
 * Traces a clean, sculpted anatomical human body silhouette path on Canvas 2D
 * so highlights paint ONLY the person's body — never a boxy square over walls/background.
 */
export function traceBodySilhouettePath(
  ctx: CanvasRenderingContext2D,
  rect: PixelRect
): void {
  const { x, y, width: w, height: h } = rect;
  const cx = x + w * 0.5;
  const isUpperBody = h / Math.max(1, w) < 1.35;

  ctx.beginPath();

  if (isUpperBody) {
    // Head + neck + curved shoulders + torso bust (no square top corners!)
    ctx.ellipse(cx, y + h * 0.25, w * 0.21, h * 0.22, 0, 0, Math.PI * 2);

    // Continuous shoulders + torso path
    ctx.moveTo(cx - w * 0.10, y + h * 0.44);
    ctx.lineTo(cx + w * 0.10, y + h * 0.44);
    ctx.quadraticCurveTo(cx + w * 0.38, y + h * 0.50, cx + w * 0.45, y + h * 0.66);
    ctx.lineTo(cx + w * 0.47, y + h * 0.99);
    ctx.lineTo(cx - w * 0.47, y + h * 0.99);
    ctx.lineTo(cx - w * 0.45, y + h * 0.66);
    ctx.quadraticCurveTo(cx - w * 0.38, y + h * 0.50, cx - w * 0.10, y + h * 0.44);
    ctx.closePath();
    return;
  }

  // Full-body anatomical silhouette: head oval + sculpted shoulders/arms/torso + two legs
  ctx.ellipse(cx, y + h * 0.125, w * 0.165, h * 0.105, 0, 0, Math.PI * 2);

  ctx.moveTo(cx - w * 0.085, y + h * 0.22);
  ctx.lineTo(cx + w * 0.085, y + h * 0.22);
  // Right shoulder & arm contour
  ctx.quadraticCurveTo(cx + w * 0.34, y + h * 0.25, cx + w * 0.42, y + h * 0.36);
  ctx.lineTo(cx + w * 0.40, y + h * 0.56);
  ctx.quadraticCurveTo(cx + w * 0.33, y + h * 0.58, cx + w * 0.31, y + h * 0.60);
  // Right leg
  ctx.lineTo(cx + w * 0.26, y + h * 0.98);
  ctx.lineTo(cx + w * 0.07, y + h * 0.98);
  ctx.lineTo(cx + w * 0.04, y + h * 0.64);
  // Inner crotch arch
  ctx.quadraticCurveTo(cx, y + h * 0.61, cx - w * 0.04, y + h * 0.64);
  // Left leg
  ctx.lineTo(cx - w * 0.07, y + h * 0.98);
  ctx.lineTo(cx - w * 0.26, y + h * 0.98);
  ctx.lineTo(cx - w * 0.31, y + h * 0.60);
  // Left waist, arm & shoulder contour
  ctx.quadraticCurveTo(cx - w * 0.33, y + h * 0.58, cx - w * 0.40, y + h * 0.56);
  ctx.lineTo(cx - w * 0.42, y + h * 0.36);
  ctx.quadraticCurveTo(cx - w * 0.34, y + h * 0.25, cx - w * 0.085, y + h * 0.22);
  ctx.closePath();
}

/**
 * Renders an ONLY-BODY translucent highlight directly onto the CCTV canvas:
 * - Default (choosing): vibrant translucent GREEN (#22c55e)
 * - Cursor hovering over this person's body: vibrant translucent RED (#ef4444)
 */
export function drawBodyOnlyHighlight(
  ctx: CanvasRenderingContext2D,
  rect: PixelRect,
  options: {
    isHovered: boolean;
    isSelected?: boolean;
    label?: string;
  }
): void {
  const { isHovered, isSelected = false, label } = options;

  ctx.save();
  traceBodySilhouettePath(ctx, rect);

  // Fill ONLY the human body silhouette (GREEN when choosing, RED on cursor hover)
  ctx.fillStyle = isHovered
    ? 'rgba(239, 68, 68, 0.52)'
    : isSelected
      ? 'rgba(16, 185, 129, 0.48)'
      : 'rgba(34, 197, 94, 0.38)';
  ctx.fill();

  // Crisp anatomical body contour outline
  ctx.strokeStyle = isHovered ? '#ef4444' : '#22c55e';
  ctx.lineWidth = isHovered ? 2.8 : 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  if (label) {
    ctx.font = '700 10px "JetBrains Mono", monospace';
    const textW = ctx.measureText(label).width;
    const tagW = Math.ceil(textW) + 10;
    const tagX = Math.max(4, Math.min(rect.x + (rect.width - tagW) / 2, 640 - tagW - 4));
    const tagY = Math.max(30, rect.y - 18);
    ctx.fillStyle = isHovered ? 'rgba(220, 38, 38, 0.94)' : 'rgba(21, 128, 61, 0.92)';
    ctx.fillRect(tagX, tagY, tagW, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, tagX + 5, tagY + 11.5);
  }

  ctx.restore();
}
