import type { DetectedObjectBox, DetectedPersonBox } from '../types';
import {
  analyzeFrameExposure,
  buildCocoModelCandidateUrls,
  shouldPreferCpuBackend,
  shouldTriggerSilentZeroWebglWatchdog,
} from './crossDeviceVision';
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

export type LocalDetectorBackend = 'webgl' | 'cpu' | null;

let modelInstance: CocoModel | null = null;
let modelLoadPromise: Promise<CocoModel> | null = null;
let detectorStatus: LocalDetectorStatus = 'idle';
let detectorBackend: LocalDetectorBackend = null;
let detectorModelSource: 'local' | 'cdn' | null = null;
let detectorErrorMessage: string | null = null;
let tfModuleCache: typeof import('@tensorflow/tfjs') | null = null;
let consecutiveSilentZeroWebglFrames = 0;
let cpuShadowCheckDone = false;

// Reusable offscreen crop/enhancement canvases
let leftTileCanvas: HTMLCanvasElement | null = null;
let rightTileCanvas: HTMLCanvasElement | null = null;
let torsoTileCanvas: HTMLCanvasElement | null = null;
let enhancedCanvas: HTMLCanvasElement | null = null;
let exposureProbeCanvas: HTMLCanvasElement | null = null;

export function getLocalDetectorStatus(): {
  status: LocalDetectorStatus;
  backend: LocalDetectorBackend;
  modelSource: 'local' | 'cdn' | null;
  error: string | null;
} {
  return {
    status: detectorStatus,
    backend: detectorBackend,
    modelSource: detectorModelSource,
    error: detectorErrorMessage,
  };
}

export function resetLocalPersonDetectorForRetry(): void {
  if (detectorStatus === 'error') {
    modelLoadPromise = null;
    detectorStatus = 'idle';
    detectorErrorMessage = null;
  }
}

function createWarmupCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(20, 12, 24, 42);
  }
  return canvas;
}

/**
 * Verifies WebGL produces finite, accurate MobileNetV2-style depthwiseConv2d math.
 * Catches iOS Safari & mobile Adreno/Mali float16 WebGL precision failures that
 * silently output NaN/0 without throwing JavaScript exceptions.
 */
async function runWebglNumericSelfTest(
  tf: typeof import('@tensorflow/tfjs')
): Promise<boolean> {
  try {
    const ok = tf.tidy(() => {
      const input = tf.ones([1, 8, 8, 3], 'float32').mul(tf.scalar(128));
      const filter = tf.ones([3, 3, 3, 1], 'float32').mul(tf.scalar(0.25));
      const conv = tf.depthwiseConv2d(input as Parameters<typeof tf.depthwiseConv2d>[0], filter as Parameters<typeof tf.depthwiseConv2d>[1], 1, 'same');
      const maxVal = conv.max().dataSync()[0];
      const minVal = conv.min().dataSync()[0];
      // Expected interior value = 9 * 128 * 0.25 = 288
      return Number.isFinite(maxVal) && Number.isFinite(minVal) && maxVal > 200 && maxVal < 400;
    });
    return Boolean(ok);
  } catch {
    return false;
  }
}

async function switchToCpuBackend(): Promise<boolean> {
  try {
    const tf = tfModuleCache ?? (await import('@tensorflow/tfjs'));
    tfModuleCache = tf;
    if (tf.getBackend() !== 'cpu') {
      await tf.setBackend('cpu');
    }
    await tf.ready();
    detectorBackend = 'cpu';
    consecutiveSilentZeroWebglFrames = 0;
    return true;
  } catch {
    return false;
  }
}

async function safeModelDetect(
  model: CocoModel,
  input: HTMLCanvasElement,
  maxNumBoxes: number,
  minScore: number
): Promise<CocoPrediction[]> {
  try {
    return await model.detect(input, maxNumBoxes, minScore);
  } catch (err) {
    // Mobile WebGL context loss or unsupported GPU shader -> seamlessly fall back to CPU backend and retry
    if (detectorBackend === 'webgl') {
      const switched = await switchToCpuBackend();
      if (switched) {
        return await model.detect(input, maxNumBoxes, minScore);
      }
    }
    throw err;
  }
}

async function loadCocoSsdWithSelfHostedFallback(
  cocoSsd: typeof import('@tensorflow-models/coco-ssd')
): Promise<{ model: CocoModel; source: 'local' | 'cdn' }> {
  const baseUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : '/';
  const candidateUrls = buildCocoModelCandidateUrls(baseUrl);

  let lastErr: unknown = null;
  for (let i = 0; i < candidateUrls.length; i += 1) {
    const candidateUrl = candidateUrls[i];
    const isLocal = i === 0 && !candidateUrl.startsWith('http');
    try {
      const loaded = (await cocoSsd.load({
        base: 'lite_mobilenet_v2',
        modelUrl: candidateUrl,
      })) as unknown as CocoModel;
      return {
        model: loaded,
        source: isLocal ? 'local' : 'cdn',
      };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr ?? new Error('Unable to download COCO-SSD neural weights.');
}

export async function ensureLocalPersonDetector(): Promise<CocoModel> {
  if (modelInstance) return modelInstance;
  if (modelLoadPromise) return modelLoadPromise;

  detectorStatus = 'loading';
  detectorErrorMessage = null;

  modelLoadPromise = (async () => {
    try {
      const tf = await import('@tensorflow/tfjs');
      tfModuleCache = tf;

      let preferredBackend: 'webgl' | 'cpu' = 'cpu';
      try {
        // Prevent silent float16 precision overflow in MobileNetV2 on phones/tablets
        tf.env().set('WEBGL_FORCE_F16_TEXTURES', false);
        await tf.setBackend('webgl');
        await tf.ready();
        if (tf.getBackend() === 'webgl') {
          const renderFloat32Capable = Boolean(tf.env().getBool('WEBGL_RENDER_FLOAT32_CAPABLE'));
          const numericSelfTestPassed = await runWebglNumericSelfTest(tf);
          if (shouldPreferCpuBackend({ renderFloat32Capable, numericSelfTestPassed })) {
            await tf.setBackend('cpu');
            await tf.ready();
            preferredBackend = 'cpu';
          } else {
            preferredBackend = 'webgl';
          }
        }
      } catch {
        await tf.setBackend('cpu');
        await tf.ready();
        preferredBackend = 'cpu';
      }

      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      const { model: loaded, source } = await loadCocoSsdWithSelfHostedFallback(cocoSsd);
      detectorModelSource = source;

      // Verify inference executes cleanly on active backend
      const warmupCanvas = createWarmupCanvas();
      try {
        await loaded.detect(warmupCanvas, 1, 0.5);
        detectorBackend = preferredBackend;
      } catch {
        if (preferredBackend === 'webgl') {
          await tf.setBackend('cpu');
          await tf.ready();
          await loaded.detect(warmupCanvas, 1, 0.5);
          detectorBackend = 'cpu';
        } else {
          throw new Error('On-device person detector warmup failed.');
        }
      }

      modelInstance = loaded;
      detectorStatus = 'ready';
      consecutiveSilentZeroWebglFrames = 0;
      cpuShadowCheckDone = false;
      return modelInstance;
    } catch (err) {
      detectorStatus = 'error';
      detectorBackend = null;
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
    if (conf < 16 || conf >= maxConfidenceExclusive) continue;

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
    if (boxW < 70 || boxH < 140) continue;
    if (boxW > 960 && boxH > 960) continue;

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

function measureCanvasExposure(canvas: HTMLCanvasElement) {
  try {
    exposureProbeCanvas = ensureTileCanvas(exposureProbeCanvas, 48, 36);
    const pctx = exposureProbeCanvas.getContext('2d', { willReadFrequently: true });
    if (!pctx) return null;
    pctx.drawImage(canvas, 0, 0, 48, 36);
    const rgba = pctx.getImageData(0, 0, 48, 36).data;
    return analyzeFrameExposure(rgba);
  } catch {
    return null;
  }
}

/**
 * Runs real on-device COCO-SSD neural network inference directly on the clean video canvas.
 * Cross-device hardened for phones, tablets, laptops, Windows app, and offline PWAs:
 * - Self-hosted same-origin model weights (/models/coco-ssd/model.json)
 * - Automatic float16/broken-WebGL detection & deterministic float32 CPU fallback
 * - Runtime silent-zero WebGL watchdog
 * - Automatic low-light brightness/contrast boost pass for dim cameras
 * - Multi-person 60% tiling + face-occluded lower-torso recovery
 */
export async function detectPeopleLocallyOnCanvas(
  canvas: HTMLCanvasElement,
  minConfidencePercent = 28,
  options?: { hadTrackedPeople?: boolean }
): Promise<{
  people: DetectedPersonBox[];
  weakPeople: DetectedPersonBox[];
  dangerousObjects: DetectedObjectBox[];
  occluderObjects: DetectedObjectBox[];
  inferenceMs: number;
  backend: LocalDetectorBackend;
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
      backend: detectorBackend,
    };
  }

  const startedAt = performance.now();
  const rawMinScore = 0.15;

  // Pass 1: Full-frame detection on aspect-ratio-preserved canvas
  const fullStart = performance.now();
  let fullRaw = await safeModelDetect(model, canvas, 35, rawMinScore);
  const fullPassMs = performance.now() - fullStart;

  const exposure = measureCanvasExposure(canvas);

  // Runtime silent-zero WebGL watchdog: if a phone/laptop GPU silently outputs 0 predictions
  // across 5 consecutive real non-blank frames, shadow-test CPU once and switch permanently if CPU sees objects!
  if (detectorBackend === 'webgl' && !cpuShadowCheckDone && exposure) {
    const watchdog = shouldTriggerSilentZeroWebglWatchdog({
      backend: detectorBackend,
      rawPredictionCount: fullRaw.length,
      isBlankFrame: exposure.isBlankFrame,
      consecutiveSilentZeroFrames: consecutiveSilentZeroWebglFrames,
    });
    consecutiveSilentZeroWebglFrames = watchdog.nextSilentCount;

    if (watchdog.shouldProbeCpu) {
      cpuShadowCheckDone = true;
      const switched = await switchToCpuBackend();
      if (switched) {
        const cpuProbeRaw = await model.detect(canvas, 35, rawMinScore);
        if (cpuProbeRaw.length > 0) {
          // Confirmed broken/silent-zero WebGL GPU on this device — stay permanently on CPU!
          fullRaw = cpuProbeRaw;
        } else if (tfModuleCache) {
          // Scene genuinely has 0 objects even on CPU — restore WebGL for speed
          try {
            await tfModuleCache.setBackend('webgl');
            await tfModuleCache.ready();
            if (tfModuleCache.getBackend() === 'webgl') {
              detectorBackend = 'webgl';
            }
          } catch {
            detectorBackend = 'cpu';
          }
        }
      }
    }
  } else if (fullRaw.length > 0) {
    consecutiveSilentZeroWebglFrames = 0;
  }

  let fullBoxes = mapPredictionsToBoxes(fullRaw, width, height, minConfidencePercent);
  const rawWeakPeople: DetectedPersonBox[] = [
    ...mapPredictionsToWeakPeople(fullRaw, width, height, minConfidencePercent),
  ];
  const rawWeapons: DetectedObjectBox[] = [
    ...mapPredictionsToDangerousObjects(fullRaw, width, height, 0, 1),
  ];
  const rawOccluders: DetectedObjectBox[] = [
    ...mapPredictionsToOccluders(fullRaw, width, height, 0, 1),
  ];

  // Low-Light Exposure Boost Pass: if camera is dim/dark on another device and Pass 1 found 0 people,
  // run a fast software brightness/contrast-normalized pass so dimly lit humans still lock on!
  if (fullBoxes.length === 0 && exposure?.needsLowLightBoost) {
    enhancedCanvas = ensureTileCanvas(enhancedCanvas, width, height);
    const ectx = enhancedCanvas.getContext('2d');
    if (ectx) {
      await yieldToMainThread();
      ectx.save();
      ectx.filter = 'brightness(1.5) contrast(1.25)';
      ectx.drawImage(canvas, 0, 0, width, height);
      ectx.restore();
      const boostedRaw = await safeModelDetect(model, enhancedCanvas, 25, rawMinScore);
      const boostedBoxes = mapPredictionsToBoxes(boostedRaw, width, height, minConfidencePercent);
      if (boostedBoxes.length > 0) {
        fullBoxes = boostedBoxes;
      }
      rawWeakPeople.push(
        ...mapPredictionsToWeakPeople(boostedRaw, width, height, minConfidencePercent)
      );
      rawWeapons.push(...mapPredictionsToDangerousObjects(boostedRaw, width, height, 0, 1));
      rawOccluders.push(...mapPredictionsToOccluders(boostedRaw, width, height, 0, 1));
    }
  }

  // Pass 2 & 3: Overlapping 60% square-aspect tiles ONLY for wide landscape multi-person scenes
  const hasCloseUpDominantPerson = fullBoxes.some(
    (b) => b.box_2d[3] - b.box_2d[1] >= 420 || b.box_2d[2] - b.box_2d[0] >= 580
  );
  const isLandscape = width >= height;
  const shouldRunTiles =
    isLandscape &&
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
      const leftRaw = await safeModelDetect(model, leftTileCanvas, 30, rawMinScore);
      leftBoxes = mapPredictionsToBoxes(leftRaw, tileW, height, minConfidencePercent);
      rawWeakPeople.push(
        ...mapPredictionsToWeakPeople(leftRaw, tileW, height, minConfidencePercent, 0, 0.6)
      );
      rawWeapons.push(...mapPredictionsToDangerousObjects(leftRaw, tileW, height, 0, 0.6));
      rawOccluders.push(...mapPredictionsToOccluders(leftRaw, tileW, height, 0, 0.6));

      await yieldToMainThread();
      rightCtx.drawImage(canvas, rightStartX, 0, tileW, height, 0, 0, tileW, height);
      const rightRaw = await safeModelDetect(model, rightTileCanvas, 30, rawMinScore);
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
      const torsoRaw = await safeModelDetect(model, torsoTileCanvas, 20, rawMinScore);
      for (const pred of torsoRaw) {
        if (pred.class !== 'person' || !Number.isFinite(pred.score)) continue;
        const conf = Math.round(pred.score * 100);
        if (conf < 20) continue;
        const [bx, by, bw, bh] = pred.bbox;
        const xmin = Math.round((Math.max(0, bx) / width) * 1000);
        const xmax = Math.round((Math.min(width, bx + bw) / width) * 1000);
        const mappedYmin = Math.round(340 + (Math.max(0, by) / cropH) * 660);
        const mappedYmax = Math.round(340 + (Math.min(cropH, by + bh) / cropH) * 660);
        const extendedYmin = Math.max(40, mappedYmin - Math.round((mappedYmax - mappedYmin) * 0.45));
        const boxW = xmax - xmin;
        if (boxW < 80 || mappedYmax - extendedYmin < 170) continue;

        const recovered: DetectedPersonBox = {
          label: `Person (Face Occluded)`,
          box_2d: [extendedYmin, xmin, mappedYmax, xmax],
          confidence: conf,
          faceOccluded: true,
        };
        if (conf >= 38) {
          people = filterVerifiedPersonDetections([...people, recovered], minConfidencePercent);
        } else {
          rawWeakPeople.push(recovered);
        }
      }
    }
  }

  const dangerousObjects = deduplicateObjects(rawWeapons);
  const occluderObjects = deduplicateObjects(rawOccluders);
  const weakPeople = filterVerifiedPersonDetections(rawWeakPeople, 16);

  const inferenceMs = Math.max(1, Math.round(performance.now() - startedAt));
  return {
    people,
    weakPeople,
    dangerousObjects,
    occluderObjects,
    inferenceMs,
    backend: detectorBackend,
  };
}
