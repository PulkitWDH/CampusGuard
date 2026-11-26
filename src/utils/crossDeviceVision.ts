export const OFFICIAL_COCO_SSD_MODEL_URL =
  'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json';

/**
 * Builds ordered COCO-SSD model.json candidate URLs:
 * 1. Same-origin self-hosted weights (/models/coco-ssd/model.json) — works behind firewalls,
 *    on mobile data, on GitHub Pages subpaths, and offline in the Windows app / PWA.
 * 2. Official TensorFlow.js CDN URL as fallback.
 */
export function buildCocoModelCandidateUrls(baseUrl = '/'): string[] {
  const trimmed = (baseUrl || '/').trim();
  const normalizedBase = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  const localUrl = `${normalizedBase}models/coco-ssd/model.json`;
  const candidates: string[] = [localUrl];
  if (localUrl !== OFFICIAL_COCO_SSD_MODEL_URL) {
    candidates.push(OFFICIAL_COCO_SSD_MODEL_URL);
  }
  return candidates;
}

/**
 * Determines whether TensorFlow.js should bypass WebGL and use deterministic float32 CPU.
 * Many mobile GPUs (iOS Safari, budget Android Adreno/Mali) lack float32 render targets
 * (WEBGL_RENDER_FLOAT32_CAPABLE = false), causing MobileNetV2 depthwise convolutions to
 * silently overflow float16 to NaN/0 and return 0 person detections without throwing an error.
 */
export function shouldPreferCpuBackend(params: {
  renderFloat32Capable: boolean;
  numericSelfTestPassed: boolean;
}): boolean {
  if (!params.renderFloat32Capable) return true;
  if (!params.numericSelfTestPassed) return true;
  return false;
}

export interface FrameExposureMetrics {
  meanLuma: number;
  lumaStdDev: number;
  isBlankFrame: boolean;
  needsLowLightBoost: boolean;
}

/**
 * Computes fast luminance mean & standard deviation over an RGBA pixel buffer to detect:
 * - Uninitialized/black frames (avoid falsely flagging a cold camera as broken WebGL)
 * - Dark/under-exposed secondary webcams or dim rooms that benefit from contrast/gamma boost.
 */
export function analyzeFrameExposure(rgba: Uint8ClampedArray): FrameExposureMetrics {
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount <= 0) {
    return {
      meanLuma: 0,
      lumaStdDev: 0,
      isBlankFrame: true,
      needsLowLightBoost: false,
    };
  }

  // Sample up to ~2000 evenly spaced pixels using an odd stride to avoid 2-pixel pattern aliasing
  const rawStride = Math.max(1, Math.floor(pixelCount / 2000));
  const stride = rawStride > 1 && rawStride % 2 === 0 ? rawStride + 1 : rawStride;
  let sum = 0;
  let sumSq = 0;
  let samples = 0;

  for (let p = 0; p < pixelCount; p += stride) {
    const idx = p * 4;
    const luma = rgba[idx] * 0.299 + rgba[idx + 1] * 0.587 + rgba[idx + 2] * 0.114;
    sum += luma;
    sumSq += luma * luma;
    samples += 1;
  }

  const meanLuma = samples > 0 ? sum / samples : 0;
  const variance = samples > 0 ? Math.max(0, sumSq / samples - meanLuma * meanLuma) : 0;
  const lumaStdDev = Math.sqrt(variance);
  const isBlankFrame = lumaStdDev < 3.5;
  const needsLowLightBoost = !isBlankFrame && meanLuma < 85;

  return {
    meanLuma: Math.round(meanLuma * 10) / 10,
    lumaStdDev: Math.round(lumaStdDev * 10) / 10,
    isBlankFrame,
    needsLowLightBoost,
  };
}

/**
 * Runtime watchdog to catch devices whose WebGL shaders silently return 0 predictions
 * for every single frame even when a real, non-blank scene is visible.
 */
export function shouldTriggerSilentZeroWebglWatchdog(params: {
  backend: 'webgl' | 'cpu' | null;
  rawPredictionCount: number;
  isBlankFrame: boolean;
  consecutiveSilentZeroFrames: number;
  thresholdFrames?: number;
}): {
  nextSilentCount: number;
  shouldProbeCpu: boolean;
} {
  const threshold = params.thresholdFrames ?? 5;
  if (params.backend !== 'webgl' || params.isBlankFrame) {
    return {
      nextSilentCount: params.backend === 'webgl' ? params.consecutiveSilentZeroFrames : 0,
      shouldProbeCpu: false,
    };
  }

  if (params.rawPredictionCount > 0) {
    return {
      nextSilentCount: 0,
      shouldProbeCpu: false,
    };
  }

  const nextCount = params.consecutiveSilentZeroFrames + 1;
  return {
    nextSilentCount: nextCount,
    shouldProbeCpu: nextCount >= threshold,
  };
}
