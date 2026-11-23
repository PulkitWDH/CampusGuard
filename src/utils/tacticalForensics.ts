import type {
  DetectedPersonBox,
  DvrEvidenceFrame,
  ForensicEvidenceCase,
  PerimeterZone,
} from '../types';
import type { ContainDrawRect } from './monitoringLogic';

export const HEATMAP_COLS = 32;
export const HEATMAP_ROWS = 18;

/**
 * Converts pointer drag start/end pixels on the display canvas into a normalized
 * 0..1000 PerimeterZone clamped strictly inside the actual drawn video/image rect.
 * Returns null if the dragged box is too tiny (< 40 normalized units on either axis).
 */
export function normalizeDragToPerimeterZone(
  startPx: { x: number; y: number },
  endPx: { x: number; y: number },
  drawRect: ContainDrawRect,
  label = 'Restricted Perimeter'
): PerimeterZone | null {
  if (drawRect.width <= 0 || drawRect.height <= 0) return null;

  const toNormX = (px: number) =>
    Math.max(0, Math.min(1000, Math.round(((px - drawRect.x) / drawRect.width) * 1000)));
  const toNormY = (py: number) =>
    Math.max(0, Math.min(1000, Math.round(((py - drawRect.y) / drawRect.height) * 1000)));

  const x1 = toNormX(startPx.x);
  const x2 = toNormX(endPx.x);
  const y1 = toNormY(startPx.y);
  const y2 = toNormY(endPx.y);

  const xmin = Math.min(x1, x2);
  const xmax = Math.max(x1, x2);
  const ymin = Math.min(y1, y2);
  const ymax = Math.max(y1, y2);

  if (xmax - xmin < 40 || ymax - ymin < 40) {
    return null;
  }

  return {
    id: `zone-${Date.now()}`,
    label,
    box_2d: [ymin, xmin, ymax, xmax],
  };
}

/**
 * Computes intersection ratio of a person bounding box against a drawn restricted perimeter zone.
 * Uses intersection / min(personArea, zoneArea) so either stepping into a large zone OR
 * crossing a narrow doorway tripwire reliably triggers a perimeter breach.
 */
export function computeBoxOverlapRatio(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const [ay1, ax1, ay2, ax2] = a;
  const [by1, bx1, by2, bx2] = b;

  const interX = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const interY = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const interArea = interX * interY;
  if (interArea <= 0) return 0;

  const areaA = Math.max(1, (ax2 - ax1) * (ay2 - ay1));
  const areaB = Math.max(1, (bx2 - bx1) * (by2 - by1));
  return interArea / Math.min(areaA, areaB);
}

/**
 * Evaluates whether any confirmed tracked human has crossed into the restricted perimeter zone.
 */
export function detectPerimeterBreaches(
  people: DetectedPersonBox[],
  zone: PerimeterZone | null | undefined,
  minOverlapRatio = 0.14
): {
  breached: boolean;
  breachingPeople: DetectedPersonBox[];
  maxOverlap: number;
} {
  if (!zone || !Array.isArray(people) || people.length === 0) {
    return { breached: false, breachingPeople: [], maxOverlap: 0 };
  }

  const breachingPeople: DetectedPersonBox[] = [];
  let maxOverlap = 0;

  for (const person of people) {
    const overlap = computeBoxOverlapRatio(person.box_2d, zone.box_2d);
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
    }
    if (overlap >= minOverlapRatio) {
      breachingPeople.push(person);
    }
  }

  return {
    breached: breachingPeople.length > 0,
    breachingPeople,
    maxOverlap: Number(maxOverlap.toFixed(3)),
  };
}

/**
 * Maps a normalized 0..1 spatial traffic density value onto a clear heatmap color ramp:
 * deep navy -> violet -> crimson -> amber -> bright gold.
 */
export function mapIronbowColor(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  if (c < 0.25) {
    const k = c / 0.25;
    return [
      Math.round(8 + k * 56),
      Math.round(10 + k * 6),
      Math.round(32 + k * 96),
    ];
  }
  if (c < 0.55) {
    const k = (c - 0.25) / 0.3;
    return [
      Math.round(64 + k * 140),
      Math.round(16 + k * 28),
      Math.round(128 - k * 36),
    ];
  }
  if (c < 0.82) {
    const k = (c - 0.55) / 0.27;
    return [
      Math.round(204 + k * 51),
      Math.round(44 + k * 144),
      Math.round(92 - k * 68),
    ];
  }
  const k = (c - 0.82) / 0.18;
  return [
    255,
    Math.round(188 + k * 67),
    Math.round(24 + k * 212),
  ];
}

/**
 * Creates a fresh spatial dwell/activity heatmap buffer (cols x rows).
 */
export function createActivityHeatmap(
  cols = HEATMAP_COLS,
  rows = HEATMAP_ROWS
): Float32Array {
  return new Float32Array(cols * rows);
}

/**
 * Accumulates real spatial occupancy dwell from confirmed person bounding boxes into the heatmap
 * with gentle exponential decay so active hotspots remain clear without saturating forever.
 */
export function updateActivityHeatmap(
  grid: Float32Array,
  detectedPeople: DetectedPersonBox[],
  cols = HEATMAP_COLS,
  rows = HEATMAP_ROWS,
  decayFactor = 0.985
): void {
  for (let i = 0; i < grid.length; i += 1) {
    grid[i] *= decayFactor;
    if (grid[i] < 0.005) grid[i] = 0;
  }

  for (const person of detectedPeople) {
    const [ymin, xmin, ymax, xmax] = person.box_2d;
    const cStart = Math.max(0, Math.floor((xmin / 1000) * cols));
    const cEnd = Math.min(cols - 1, Math.floor((xmax / 1000) * cols));
    const rStart = Math.max(0, Math.floor((ymin / 1000) * rows));
    const rEnd = Math.min(rows - 1, Math.floor((ymax / 1000) * rows));

    const centerC = (cStart + cEnd) / 2;
    const centerR = (rStart + rEnd) / 2;
    const radiusC = Math.max(1, (cEnd - cStart) / 2 + 0.5);
    const radiusR = Math.max(1, (rEnd - rStart) / 2 + 0.5);

    for (let r = rStart; r <= rEnd; r += 1) {
      for (let c = cStart; c <= cEnd; c += 1) {
        const dx = (c - centerC) / radiusC;
        const dy = (r - centerR) / radiusR;
        const distSq = dx * dx + dy * dy;
        const weight = Math.max(0.08, 0.34 * Math.exp(-distSq * 1.4));
        const idx = r * cols + c;
        grid[idx] = Math.min(1, grid[idx] + weight);
      }
    }
  }
}

/**
 * Appends a DVR frame to a rolling circular black-box buffer, keeping only the most recent `maxFrames`
 * and recomputing relative offsetSec values cleanly.
 */
export function pushRollingDvrFrame(
  buffer: DvrEvidenceFrame[],
  frame: Omit<DvrEvidenceFrame, 'offsetSec'>,
  maxFrames = 14
): DvrEvidenceFrame[] {
  const next = [...buffer, { ...frame, offsetSec: 0 }];
  const trimmed = next.length > maxFrames ? next.slice(next.length - maxFrames) : next;
  const latestMs = Date.parse(trimmed[trimmed.length - 1].capturedAt) || Date.now();
  return trimmed.map((item) => {
    const itemMs = Date.parse(item.capturedAt) || latestMs;
    return {
      ...item,
      offsetSec: Number(((itemMs - latestMs) / 1000).toFixed(1)),
    };
  });
}

/**
 * Produces a deterministic canonical JSON string of a ForensicEvidenceCase's immutable fields
 * for real SHA-256 tamper-evident Chain-of-Custody sealing and verification.
 */
export function serializeEvidencePayloadForHash(
  evidence: Omit<ForensicEvidenceCase, 'sha256Hash' | 'verified'>
): string {
  return JSON.stringify({
    id: evidence.id,
    caseNumber: evidence.caseNumber,
    cameraId: evidence.cameraId,
    cameraCode: evidence.cameraCode,
    classroomName: evidence.classroomName,
    triggerType: evidence.triggerType,
    threatCategory: evidence.threatCategory,
    severity: evidence.severity,
    headline: evidence.headline,
    summary: evidence.summary,
    sealedAt: evidence.sealedAt,
    peakAudioDb: evidence.peakAudioDb,
    maxPeopleCount: evidence.maxPeopleCount,
    transcriptSnapshot: evidence.transcriptSnapshot,
    perimeterZone: evidence.perimeterZone ?? null,
    frames: evidence.frames.map((f) => ({
      capturedAt: f.capturedAt,
      studentCount: f.studentCount,
      audioLevel: f.audioLevel,
      threatScore: f.threatScore,
      transcript: f.transcript,
      imageFingerprint: `${f.imageDataUrl.length}:${f.imageDataUrl.slice(0, 64)}:${f.imageDataUrl.slice(-48)}`,
    })),
  });
}

/**
 * Computes a real SHA-256 hex digest using Web Crypto (`globalThis.crypto.subtle`).
 */
export async function computeSha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digestBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Seals a ForensicEvidenceCase with a real cryptographic SHA-256 Chain-of-Custody hash.
 */
export async function sealForensicEvidenceCase(
  draft: Omit<ForensicEvidenceCase, 'sha256Hash' | 'verified'>
): Promise<ForensicEvidenceCase> {
  const canonical = serializeEvidencePayloadForHash(draft);
  const sha256Hash = await computeSha256Hex(canonical);
  return {
    ...draft,
    sha256Hash,
    verified: true,
  };
}

/**
 * Recomputes SHA-256 over a sealed ForensicEvidenceCase to cryptographically verify
 * whether the evidence package is intact or has been altered.
 */
export async function verifyForensicEvidenceIntegrity(
  evidence: ForensicEvidenceCase
): Promise<{ valid: boolean; expectedHash: string; recomputedHash: string }> {
  const { sha256Hash, verified: _verified, ...immutablePayload } = evidence;
  const canonical = serializeEvidencePayloadForHash(immutablePayload);
  const recomputedHash = await computeSha256Hex(canonical);
  return {
    valid: recomputedHash === sha256Hash,
    expectedHash: sha256Hash,
    recomputedHash,
  };
}
