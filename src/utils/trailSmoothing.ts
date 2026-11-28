export interface Point2D {
  x: number;
  y: number;
}

export interface SmoothSplinePoint {
  x: number;
  y: number;
  /** Normalized progression along the curve from tail (0) to live nose head (1) */
  progress: number;
}

export interface NoseFilterOptions {
  /** Micro-jitter deadband in normalized 0..1000 units (default 5.5) */
  deadband?: number;
  /** Base smoothing factor when nearly stationary (default 0.22) */
  minAlpha?: number;
  /** Maximum smoothing factor during fast motion (default 0.68) */
  maxAlpha?: number;
  /** Single-frame jump distance above which outlier spike damping engages (default 135) */
  spikeThreshold?: number;
}

export interface SmoothSplineOptions {
  /** Minimum pixel distance between adjacent control points before collapsing (default 2.5) */
  minControlSpacing?: number;
  /** Number of Laplacian smoothing passes on interior control points (default 2) */
  laplacianPasses?: number;
  /** Number of Catmull-Rom subdivisions per control segment (default 8) */
  subdivisionsPerSegment?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Velocity-adaptive low-pass filter (One-Euro-inspired) for nose trajectory samples.
 * - Heavily damps COCO-SSD bounding-box micro-jitter when a person is still or barely moving.
 * - Damps sudden single-frame glitch spikes so a momentary bad box cannot inject a sharp zigzag.
 * - Opens up responsively during real movement so trails glide without sluggish lag.
 */
export function filterNoseSample(
  prev: Point2D | null,
  raw: Point2D,
  dtSec: number,
  options?: NoseFilterOptions
): Point2D {
  if (!prev) {
    return {
      x: clamp(roundTenth(raw.x), 0, 1000),
      y: clamp(roundTenth(raw.y), 0, 1000),
    };
  }

  const deadband = options?.deadband ?? 5.5;
  const minAlpha = options?.minAlpha ?? 0.22;
  const maxAlpha = options?.maxAlpha ?? 0.68;
  const spikeThreshold = options?.spikeThreshold ?? 135;

  const dx = raw.x - prev.x;
  const dy = raw.y - prev.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 0.25) {
    return prev;
  }

  const safeDt = Math.max(0.05, dtSec);
  let alpha: number;

  if (dist <= deadband) {
    // Inside jitter deadband: ultra-gentle drift keeps anchor calm while still preventing permanent offset
    alpha = 0.08;
  } else if (dist >= spikeThreshold && safeDt < 0.75) {
    // Single-frame bounding-box glitch/seam jump: damp hard so it cannot draw a lightning spike
    alpha = 0.28;
  } else {
    const speed = dist / safeDt; // normalized units per second
    const speedRatio = clamp((speed - 24) / 220, 0, 1);
    // Smoothstep ramp from heavy smoothing (slow) to responsive tracking (fast)
    const smoothRamp = speedRatio * speedRatio * (3 - 2 * speedRatio);
    alpha = minAlpha + (maxAlpha - minAlpha) * smoothRamp;
  }

  return {
    x: clamp(roundTenth(prev.x + dx * alpha), 0, 1000),
    y: clamp(roundTenth(prev.y + dy * alpha), 0, 1000),
  };
}

/**
 * 60 FPS frame-rate-independent visual damper for the live nose dot and trail tip.
 * Eliminates the discrete 4 Hz step-jumping between AI detection snapshots.
 */
export function advanceSmoothedDisplayPoint(
  prevDisplay: Point2D | null,
  target: Point2D,
  dtMs: number
): Point2D {
  if (!prevDisplay) {
    return { x: target.x, y: target.y };
  }

  const dx = target.x - prevDisplay.x;
  const dy = target.y - prevDisplay.y;
  const dist = Math.hypot(dx, dy);

  // Snap immediately on huge teleports (e.g., new stream/re-acquisition) or sub-pixel convergence
  if (dist > 320 || dist < 0.6) {
    return { x: target.x, y: target.y };
  }

  const dtSec = clamp(dtMs / 1000, 0.004, 0.12);
  // Adaptive stiffness: gentle for small wobble, crisp for deliberate motion
  const motionRatio = clamp((dist - 4) / 65, 0, 1);
  const lambda = 7.5 + motionRatio * 9.5; // 7.5..17 rad/s
  const factor = 1 - Math.exp(-lambda * dtSec);

  return {
    x: prevDisplay.x + dx * factor,
    y: prevDisplay.y + dy * factor,
  };
}

/**
 * Evaluates a Centripetal Catmull-Rom spline (alpha = 0.5) between p1 and p2
 * given surrounding points p0 and p3. Centripetal parameterization is mathematically
 * guaranteed never to form cusps or self-intersecting loops on tight turns.
 */
function evalCentripetalCatmullRom(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  u: number
): Point2D {
  const alpha = 0.5;
  const eps = 1e-4;

  const d01 = Math.max(eps, Math.pow(Math.hypot(p1.x - p0.x, p1.y - p0.y), alpha));
  const d12 = Math.max(eps, Math.pow(Math.hypot(p2.x - p1.x, p2.y - p1.y), alpha));
  const d23 = Math.max(eps, Math.pow(Math.hypot(p3.x - p2.x, p3.y - p2.y), alpha));

  const t0 = 0;
  const t1 = t0 + d01;
  const t2 = t1 + d12;
  const t3 = t2 + d23;
  const t = t1 + u * (t2 - t1);

  const lerpPt = (a: Point2D, b: Point2D, ta: number, tb: number): Point2D => {
    const denom = tb - ta;
    if (Math.abs(denom) < eps) return a;
    const w = (t - ta) / denom;
    return {
      x: a.x + (b.x - a.x) * w,
      y: a.y + (b.y - a.y) * w,
    };
  };

  const A1 = lerpPt(p0, p1, t0, t1);
  const A2 = lerpPt(p1, p2, t1, t2);
  const A3 = lerpPt(p2, p3, t2, t3);

  const B1 = lerpPt(A1, A2, t0, t2);
  const B2 = lerpPt(A2, A3, t1, t3);

  return lerpPt(B1, B2, t1, t2);
}

/**
 * Turns coarse trajectory waypoints into a silky-smooth, C1-continuous spline curve:
 * 1. Collapses near-duplicate points that cause tangent kinks.
 * 2. Applies gentle Laplacian smoothing to interior waypoints (preserving tail & live head endpoints)
 *    to remove alternating high-frequency zigzag wobble.
 * 3. Samples a Centripetal Catmull-Rom spline with uniform arc-length progress [0..1].
 */
export function buildSmoothTrailSpline(
  points: Point2D[],
  options?: SmoothSplineOptions
): SmoothSplinePoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [{ x: points[0].x, y: points[0].y, progress: 1 }];
  }

  const minSpacing = options?.minControlSpacing ?? 2.5;
  const laplacianPasses = options?.laplacianPasses ?? 2;
  const subdivisions = Math.max(2, options?.subdivisionsPerSegment ?? 8);

  // 1. Deduplicate near-coincident points while always keeping exact tail and live nose head
  const cleaned: Point2D[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = cleaned[cleaned.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= minSpacing) {
      cleaned.push(points[i]);
    }
  }
  const head = points[points.length - 1];
  const lastCleaned = cleaned[cleaned.length - 1];
  if (Math.hypot(head.x - lastCleaned.x, head.y - lastCleaned.y) >= 0.75) {
    cleaned.push(head);
  } else if (cleaned.length > 1) {
    cleaned[cleaned.length - 1] = head;
  }

  if (cleaned.length < 2) {
    return [{ x: head.x, y: head.y, progress: 1 }];
  }

  if (cleaned.length === 2) {
    const out: SmoothSplinePoint[] = [];
    for (let s = 0; s <= subdivisions; s += 1) {
      const u = s / subdivisions;
      out.push({
        x: cleaned[0].x + (cleaned[1].x - cleaned[0].x) * u,
        y: cleaned[0].y + (cleaned[1].y - cleaned[0].y) * u,
        progress: u,
      });
    }
    return out;
  }

  // 2. Interior Laplacian smoothing passes (1-2-1 kernel) to erase sharp zigzag corners
  let ctrl = cleaned.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < laplacianPasses; pass += 1) {
    const next = ctrl.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 1; i < ctrl.length - 1; i += 1) {
      next[i] = {
        x: ctrl[i - 1].x * 0.25 + ctrl[i].x * 0.5 + ctrl[i + 1].x * 0.25,
        y: ctrl[i - 1].y * 0.25 + ctrl[i].y * 0.5 + ctrl[i + 1].y * 0.25,
      };
    }
    ctrl = next;
  }

  // 3. Centripetal Catmull-Rom interpolation across every segment
  const sampled: Point2D[] = [];
  const segCount = ctrl.length - 1;

  for (let i = 0; i < segCount; i += 1) {
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    // Phantom reflection endpoints for natural zero-curvature starts and ends
    const p0 =
      i > 0
        ? ctrl[i - 1]
        : { x: p1.x + (p1.x - p2.x), y: p1.y + (p1.y - p2.y) };
    const p3 =
      i + 2 < ctrl.length
        ? ctrl[i + 2]
        : { x: p2.x + (p2.x - p1.x), y: p2.y + (p2.y - p1.y) };

    const startStep = i === 0 ? 0 : 1;
    for (let s = startStep; s <= subdivisions; s += 1) {
      const u = s / subdivisions;
      sampled.push(evalCentripetalCatmullRom(p0, p1, p2, p3, u));
    }
  }

  // Compute true arc-length progress [0..1] for even alpha & width tapering
  const cumLen = new Array<number>(sampled.length).fill(0);
  let totalLen = 0;
  for (let i = 1; i < sampled.length; i += 1) {
    totalLen += Math.hypot(sampled[i].x - sampled[i - 1].x, sampled[i].y - sampled[i - 1].y);
    cumLen[i] = totalLen;
  }

  const denom = Math.max(1e-4, totalLen);
  return sampled.map((pt, idx) => ({
    x: pt.x,
    y: pt.y,
    progress: totalLen > 1e-4 ? cumLen[idx] / denom : idx / Math.max(1, sampled.length - 1),
  }));
}
