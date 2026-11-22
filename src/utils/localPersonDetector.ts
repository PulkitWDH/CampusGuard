import type { DetectedObjectBox, DetectedPersonBox } from '../types';
import {
  computeBoxIoU,
  filterVerifiedPersonDetections,
  mergeTiledPersonDetections,
} from './monitoringLogic';

export type LocalDetectorStatus = 'idle' | 'loading' | 'ready' | 'error';

interface CocoPrediction {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

interface CocoModel {
  detect(
    img: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement,
    maxNumBoxes?: number,
    minScore?: number
  ): Promise<CocoPrediction[]>;
}

const WEAPON_CLASS_THRESHOLDS: Record<string, number> = {
  knife: 62,
  'baseball bat': 62,
  scissors: 76,
};

const OCCLUDER_CLASS_LABELS: Record<string, string> = {
  'tennis racket': 'Tennis Racket',
  book: 'Book',
  backpack: 'Backpack',
  handbag: 'Handbag',
  suitcase: 'Bag',
  'cell phone': 'Phone',
  umbrella: 'Umbrella',
  frisbee: 'Held Object',
  'sports ball': 'Ball',
  skateboard: 'Board',
  'baseball bat': 'Bat / Racket',
};

let modelInstance: CocoModel | null = null;
let modelLoadPromise: Promise<CocoModel> | null = null;
let detectorStatus: LocalDetectorStatus = 'idle';
let detectorErrorMessage: string | null = null;

// Reusable offscreen crop canvases for square-aspect multi-person tiled & torso recovery detection
let leftTileCanvas: HTMLCanvasElement | null = null;
let rightTileCanvas: HTMLCanvasElement | null = null;
let torsoTileCanvas: HTMLCanvasElement | null = null;

export function getLocalDetectorStatus(): {
  status: LocalDetectorStatus;
  error: string | null;
} {
  return { status: detectorStatus, error: detectorErrorMessage };
}

export async function ensureLocalPersonDetector(): Promise<CocoModel> {
  if (modelInstance) return modelInstance;
  if (modelLoadPromise) return modelLoadPromise;

  detectorStatus = 'loading';
  detectorErrorMessage = null;

  modelLoadPromise = (async () => {
    try {
      const tf = await import('@tensorflow/tfjs');
      try {
        await tf.setBackend('webgl');
      } catch {
        await tf.setBackend('cpu');
      }
      await tf.ready();

      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      // Fast lite_mobilenet_v2 paired with square-aspect 60% tiling + torso recovery crop
      const loaded = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      modelInstance = loaded as unknown as CocoModel;
      detectorStatus = 'ready';
      return modelInstance;
    } catch (err) {
      detectorStatus = 'error';
      detectorErrorMessage =
        err instanceof Error ? err.message : 'Unable to initialize on-device person detector.';
      modelLoadPromise = null;
      throw err;
    }
  })();

  return modelLoadPromise;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function describeHorizontalZone(xmin: number, xmax: number): string {
  const center = (xmin + xmax) / 2;
  if (center < 330) return 'left';
  if (center > 670) return 'right';
  return 'center';
}

function mapPredictionsToBoxes(
  rawPredictions: CocoPrediction[],
  width: number,
  height: number,
  minConfidencePercent: number
): DetectedPersonBox[] {
  const mapped = rawPredictions
    .filter((pred) => pred.class === 'person' && Number.isFinite(pred.score))
    .map((pred) => {
      const [bx, by, bw, bh] = pred.bbox;
      const ymin = Math.round((Math.max(0, by) / height) * 1000);
      const xmin = Math.round((Math.max(0, bx) / width) * 1000);
      const ymax = Math.round((Math.min(height, by + bh) / height) * 1000);
      const xmax = Math.round((Math.min(width, bx + bw) / width) * 1000);
      const zone = describeHorizontalZone(xmin, xmax);
      return {
        label: `Person (${zone})`,
        box_2d: [ymin, xmin, ymax, xmax] as [number, number, number, number],
        confidence: Math.round(pred.score * 100),
      };
    });

  return filterVerifiedPersonDetections(mapped, minConfidencePercent);
}

function mapPredictionsToWeakPeople(
  rawPredictions: CocoPrediction[],
  width: number,
  height: number,
  maxConfidenceExclusive: number,
  tileOffsetX = 0,
  tileScaleX = 1,
  tileOffsetY = 0,
  tileScaleY = 1
): DetectedPersonBox[] {
  const results: DetectedPersonBox[] = [];
  for (const pred of rawPredictions) {
    if (pred.class !== 'person' || !Number.isFinite(pred.score)) continue;
    const conf = Math.round(pred.score * 100);
    if (conf < 18 || conf >= maxConfidenceExclusive) continue;

    const [bx, by, bw, bh] = pred.bbox;
    const rawYmin = (Math.max(0, by) / height) * 1000;
    const rawYmax = (Math.min(height, by + bh) / height) * 1000;
    const rawXmin = (Math.max(0, bx) / width) * 1000;
    const rawXmax = (Math.min(width, bx + bw) / width) * 1000;

    const ymin = Math.round(tileOffsetY + rawYmin * tileScaleY);
    const ymax = Math.round(tileOffsetY + rawYmax * tileScaleY);
    const xmin = Math.round(tileOffsetX + rawXmin * tileScaleX);
    const xmax = Math.round(tileOffsetX + rawXmax * tileScaleX);

    const boxW = xmax - xmin;
    const boxH = ymax - ymin;
    // Only keep plausible human body/torso proportions so random shadows never qualify
    if (boxW < 75 || boxH < 150) continue;
    if (boxW > 950 && boxH > 950) continue;

    results.push({
      label: `Person (${describeHorizontalZone(xmin, xmax)})`,
      box_2d: [ymin, xmin, ymax, xmax],
      confidence: conf,
    });
  }
  return results;
}

function mapPredictionsToDangerousObjects(
  rawPredictions: CocoPrediction[],
  width: number,
  height: number,
  tileOffsetX = 0,
  tileScaleX = 1
): DetectedObjectBox[] {
  const items: DetectedObjectBox[] = [];
  for (const pred of rawPredictions) {
    const normalizedClass = String(pred.class || '').toLowerCase();
    const requiredConfidence = WEAPON_CLASS_THRESHOLDS[normalizedClass];
    if (!requiredConfidence || !Number.isFinite(pred.score)) continue;

    const confidence = Math.round(pred.score * 100);
    if (confidence < requiredConfidence) continue;

    const [bx, by, bw, bh] = pred.bbox;
    const ymin = Math.round((Math.max(0, by) / height) * 1000);
    const rawXmin = (Math.max(0, bx) / width) * 1000;
    const rawXmax = (Math.min(width, bx + bw) / width) * 1000;
    const xmin = Math.round(tileOffsetX + rawXmin * tileScaleX);
    const xmax = Math.round(tileOffsetX + rawXmax * tileScaleX);
    const ymax = Math.round((Math.min(height, by + bh) / height) * 1000);

    const boxW = xmax - xmin;
    const boxH = ymax - ymin;
    if (boxW < 14 || boxH < 14) continue;
    if (boxW > 860 && boxH > 860) continue;

    const prettyLabel =
      normalizedClass === 'baseball bat'
        ? 'Blunt Object / Bat'
        : normalizedClass === 'knife'
          ? 'Knife / Blade'
          : 'Sharp Object (Scissors)';

    items.push({
      label: prettyLabel,
      category: 'weapon',
      box_2d: [ymin, xmin, ymax, xmax],
      confidence,
    });
  }
  return items;
}

function mapPredictionsToOccluders(
  rawPredictions: CocoPrediction[],
  width: number,
  height: number,
  tileOffsetX = 0,
  tileScaleX = 1
): DetectedObjectBox[] {
  const items: DetectedObjectBox[] = [];
  for (const pred of rawPredictions) {
    const normalizedClass = String(pred.class || '').toLowerCase();
    const prettyLabel = OCCLUDER_CLASS_LABELS[normalizedClass];
    if (!prettyLabel || !Number.isFinite(pred.score)) continue;

    const confidence = Math.round(pred.score * 100);
    if (confidence < 24) continue;

    const [bx, by, bw, bh] = pred.bbox;
    const ymin = Math.round((Math.max(0, by) / height) * 1000);
    const rawXmin = (Math.max(0, bx) / width) * 1000;
    const rawXmax = (Math.min(width, bx + bw) / width) * 1000;
    const xmin = Math.round(tileOffsetX + rawXmin * tileScaleX);
    const xmax = Math.round(tileOffsetX + rawXmax * tileScaleX);
    const ymax = Math.round((Math.min(height, by + bh) / height) * 1000);

    const boxW = xmax - xmin;
    const boxH = ymax - ymin;
    if (boxW < 28 || boxH < 28) continue;
    if (boxW > 860 && boxH > 860) continue;

    items.push({
      label: prettyLabel,
      category: 'occluder',
      box_2d: [ymin, xmin, ymax, xmax],
      confidence,
    });
  }
  return items;
}

function deduplicateObjects(objects: DetectedObjectBox[]): DetectedObjectBox[] {
  const sorted = [...objects].sort((a, b) => b.confidence - a.confidence);
  const kept: DetectedObjectBox[] = [];
  for (const item of sorted) {
    const dup = kept.some(
      (existing) =>
        existing.label === item.label &&
        existing.category === item.category &&
        computeBoxIoU(existing.box_2d, item.box_2d) >= 0.4
    );
    if (!dup) {
      kept.push(item);
    }
  }
  return kept;
}

function ensureTileCanvas(
  existing: HTMLCanvasElement | null,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = existing || document.createElement('canvas');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

/**
 * Runs real on-device COCO-SSD neural network inference directly on the clean video canvas.
 * Detects:
 * 1. Verified multi-person positions (Full-Frame + Left/Right 60% tiles),
 * 2. Weak occluded-person body/torso proposals + lower-torso recovery crop (so covering
 *    a face with a tennis racket, book, bag, or hand NEVER makes the person vanish),
 * 3. Handheld occluder objects (tennis racket, book, backpack, phone, umbrella, etc.), AND
 * 4. Dangerous weapon-class objects (knife, baseball bat, scissors) with zero API quota.
 */
export async function detectPeopleLocallyOnCanvas(
  canvas: HTMLCanvasElement,
  minConfidencePercent = 48,
  options?: { hadTrackedPeople?: boolean }
): Promise<{
  people: DetectedPersonBox[];
  weakPeople: DetectedPersonBox[];
  dangerousObjects: DetectedObjectBox[];
  occluderObjects: DetectedObjectBox[];
  inferenceMs: number;
}> {
  const model = await ensureLocalPersonDetector();
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) {
    return {
      people: [],
      weakPeople: [],
      dangerousObjects: [],
      occluderObjects: [],
      inferenceMs: 0,
    };
  }

  const startedAt = performance.now();
  // Query COCO-SSD down to 0.18 so face-occluded weak torso detections & handheld rackets are captured
  const rawMinScore = 0.18;

  // Pass 1: Full-frame detection (up to 35 boxes)
  const fullStart = performance.now();
  const fullRaw = await model.detect(canvas, 35, rawMinScore);
  const fullPassMs = performance.now() - fullStart;
  const fullBoxes = mapPredictionsToBoxes(fullRaw, width, height, minConfidencePercent);
  const rawWeakPeople: DetectedPersonBox[] = [
    ...mapPredictionsToWeakPeople(fullRaw, width, height, minConfidencePercent),
  ];
  const rawWeapons: DetectedObjectBox[] = [
    ...mapPredictionsToDangerousObjects(fullRaw, width, height, 0, 1),
  ];
  const rawOccluders: DetectedObjectBox[] = [
    ...mapPredictionsToOccluders(fullRaw, width, height, 0, 1),
  ];

  // Pass 2 & 3: Overlapping 60% square-aspect tiles ONLY for wide multi-person scenes
  // Skip tiling when a close-up person already spans >42% of frame width (prevents slicing 1 webcam user into 2!)
  const hasCloseUpDominantPerson = fullBoxes.some(
    (b) => b.box_2d[3] - b.box_2d[1] >= 420
  );
  const shouldRunTiles =
    width >= 320 &&
    !hasCloseUpDominantPerson &&
    (fullPassMs < 350 || fullBoxes.length >= 2);
  let leftBoxes: DetectedPersonBox[] = [];
  let rightBoxes: DetectedPersonBox[] = [];

  if (shouldRunTiles) {
    const tileW = Math.round(width * 0.6);
    const rightStartX = width - tileW;

    leftTileCanvas = ensureTileCanvas(leftTileCanvas, tileW, height);
    rightTileCanvas = ensureTileCanvas(rightTileCanvas, tileW, height);

    const leftCtx = leftTileCanvas.getContext('2d');
    const rightCtx = rightTileCanvas.getContext('2d');

    if (leftCtx && rightCtx) {
      await yieldToMainThread();
      leftCtx.drawImage(canvas, 0, 0, tileW, height, 0, 0, tileW, height);
      const leftRaw = await model.detect(leftTileCanvas, 30, rawMinScore);
      leftBoxes = mapPredictionsToBoxes(leftRaw, tileW, height, minConfidencePercent);
      rawWeakPeople.push(
        ...mapPredictionsToWeakPeople(leftRaw, tileW, height, minConfidencePercent, 0, 0.6)
      );
      rawWeapons.push(...mapPredictionsToDangerousObjects(leftRaw, tileW, height, 0, 0.6));
      rawOccluders.push(...mapPredictionsToOccluders(leftRaw, tileW, height, 0, 0.6));

      await yieldToMainThread();
      rightCtx.drawImage(canvas, rightStartX, 0, tileW, height, 0, 0, tileW, height);
      const rightRaw = await model.detect(rightTileCanvas, 30, rawMinScore);
      rightBoxes = mapPredictionsToBoxes(rightRaw, tileW, height, minConfidencePercent);
      rawWeakPeople.push(
        ...mapPredictionsToWeakPeople(rightRaw, tileW, height, minConfidencePercent, 400, 0.6)
      );
      rawWeapons.push(...mapPredictionsToDangerousObjects(rightRaw, tileW, height, 400, 0.6));
      rawOccluders.push(...mapPredictionsToOccluders(rightRaw, tileW, height, 400, 0.6));
    }
  }

  let people = shouldRunTiles
    ? mergeTiledPersonDetections(fullBoxes, leftBoxes, rightBoxes, minConfidencePercent)
    : fullBoxes;

  // Pass 4: Lower-Torso Recovery Crop when face is hidden by a racket/book/hand
  // Cropping out the top 34% removes the occluding racket so COCO-SSD locks onto uncovered shoulders/torso!
  if (
    people.length === 0 &&
    height >= 200 &&
    (rawOccluders.length > 0 || options?.hadTrackedPeople)
  ) {
    const cropStartY = Math.round(height * 0.34);
    const cropH = height - cropStartY;
    torsoTileCanvas = ensureTileCanvas(torsoTileCanvas, width, cropH);
    const torsoCtx = torsoTileCanvas.getContext('2d');
    if (torsoCtx) {
      await yieldToMainThread();
      torsoCtx.drawImage(canvas, 0, cropStartY, width, cropH, 0, 0, width, cropH);
      const torsoRaw = await model.detect(torsoTileCanvas, 20, rawMinScore);
      for (const pred of torsoRaw) {
        if (pred.class !== 'person' || !Number.isFinite(pred.score)) continue;
        const conf = Math.round(pred.score * 100);
        if (conf < 22) continue;
        const [bx, by, bw, bh] = pred.bbox;
        const xmin = Math.round((Math.max(0, bx) / width) * 1000);
        const xmax = Math.round((Math.min(width, bx + bw) / width) * 1000);
        const mappedYmin = Math.round(340 + (Math.max(0, by) / cropH) * 660);
        const mappedYmax = Math.round(340 + (Math.min(cropH, by + bh) / cropH) * 660);
        // Extend top upward to cover the occluded head/racket region above the shoulders
        const extendedYmin = Math.max(40, mappedYmin - Math.round((mappedYmax - mappedYmin) * 0.45));
        const boxW = xmax - xmin;
        if (boxW < 85 || mappedYmax - extendedYmin < 180) continue;

        const recovered: DetectedPersonBox = {
          label: `Person (Face Occluded)`,
          box_2d: [extendedYmin, xmin, mappedYmax, xmax],
          confidence: conf,
          faceOccluded: true,
        };
        if (conf >= 44) {
          people = filterVerifiedPersonDetections([...people, recovered], minConfidencePercent);
        } else {
          rawWeakPeople.push(recovered);
        }
      }
    }
  }

  const dangerousObjects = deduplicateObjects(rawWeapons);
  const occluderObjects = deduplicateObjects(rawOccluders);
  const weakPeople = filterVerifiedPersonDetections(rawWeakPeople, 18);

  const inferenceMs = Math.max(1, Math.round(performance.now() - startedAt));
  return { people, weakPeople, dangerousObjects, occluderObjects, inferenceMs };
}
