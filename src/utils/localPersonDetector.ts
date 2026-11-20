import type { DetectedPersonBox } from '../types';
import {
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

let modelInstance: CocoModel | null = null;
let modelLoadPromise: Promise<CocoModel> | null = null;
let detectorStatus: LocalDetectorStatus = 'idle';
let detectorErrorMessage: string | null = null;

// Reusable offscreen crop canvases for square-aspect multi-person tiled detection
let leftTileCanvas: HTMLCanvasElement | null = null;
let rightTileCanvas: HTMLCanvasElement | null = null;

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
      // Fast lite_mobilenet_v2 paired with square-aspect 60% tiling keeps UI 60fps while accurately detecting 2, 3, 5+ people
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
 * Uses Full-Frame + Sequential Square-Aspect Left/Right 60% Tiles (yielding between passes)
 * so 2, 3, 5, 10+ people standing close together or farther back are accurately detected
 * without blocking the browser UI. Zero API quota, zero HTTP 429, zero cooldown.
 */
export async function detectPeopleLocallyOnCanvas(
  canvas: HTMLCanvasElement,
  minConfidencePercent = 38
): Promise<{ people: DetectedPersonBox[]; inferenceMs: number }> {
  const model = await ensureLocalPersonDetector();
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) {
    return { people: [], inferenceMs: 0 };
  }

  const startedAt = performance.now();
  const minScore = Math.max(0.32, Math.min(0.95, minConfidencePercent / 100));

  // Pass 1: Full-frame detection (up to 40 people)
  const fullStart = performance.now();
  const fullRaw = await model.detect(canvas, 40, minScore);
  const fullPassMs = performance.now() - fullStart;
  const fullBoxes = mapPredictionsToBoxes(fullRaw, width, height, minConfidencePercent);

  // Pass 2 & 3: Overlapping 60% square-aspect tiles to catch closely spaced / back-row 2nd, 3rd, 4th+ people
  // Run sequential tiles with main-thread yield whenever GPU is fast (<350ms) OR >= 1 person is present
  const shouldRunTiles = width >= 320 && (fullPassMs < 350 || fullBoxes.length >= 1);
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
      const leftRaw = await model.detect(leftTileCanvas, 30, minScore);
      leftBoxes = mapPredictionsToBoxes(leftRaw, tileW, height, minConfidencePercent);

      await yieldToMainThread();
      rightCtx.drawImage(canvas, rightStartX, 0, tileW, height, 0, 0, tileW, height);
      const rightRaw = await model.detect(rightTileCanvas, 30, minScore);
      rightBoxes = mapPredictionsToBoxes(rightRaw, tileW, height, minConfidencePercent);
    }
  }

  const people = shouldRunTiles
    ? mergeTiledPersonDetections(fullBoxes, leftBoxes, rightBoxes, minConfidencePercent)
    : fullBoxes;

  const inferenceMs = Math.max(1, Math.round(performance.now() - startedAt));
  return { people, inferenceMs };
}
