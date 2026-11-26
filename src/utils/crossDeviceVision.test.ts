import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OFFICIAL_COCO_SSD_MODEL_URL,
  analyzeFrameExposure,
  buildCocoModelCandidateUrls,
  shouldPreferCpuBackend,
  shouldTriggerSilentZeroWebglWatchdog,
} from './crossDeviceVision';

test('buildCocoModelCandidateUrls prioritizes same-origin self-hosted model and supports subpath bases', () => {
  const rootUrls = buildCocoModelCandidateUrls('/');
  assert.equal(rootUrls[0], '/models/coco-ssd/model.json');
  assert.equal(rootUrls[1], OFFICIAL_COCO_SSD_MODEL_URL);

  const ghPagesUrls = buildCocoModelCandidateUrls('/campusguard-cctv');
  assert.equal(ghPagesUrls[0], '/campusguard-cctv/models/coco-ssd/model.json');
  assert.equal(ghPagesUrls[1], OFFICIAL_COCO_SSD_MODEL_URL);
});

test('shouldPreferCpuBackend forces deterministic CPU on float16-only mobile GPUs or failed numeric self-tests', () => {
  assert.equal(
    shouldPreferCpuBackend({ renderFloat32Capable: true, numericSelfTestPassed: true }),
    false
  );
  assert.equal(
    shouldPreferCpuBackend({ renderFloat32Capable: false, numericSelfTestPassed: true }),
    true
  );
  assert.equal(
    shouldPreferCpuBackend({ renderFloat32Capable: true, numericSelfTestPassed: false }),
    true
  );
});

test('analyzeFrameExposure distinguishes blank black frames, dark dim webcams, and normal bright scenes', () => {
  // Blank solid black frame (e.g. cold mobile camera before first frame)
  const black = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  const blackMetrics = analyzeFrameExposure(black);
  assert.equal(blackMetrics.isBlankFrame, true);
  assert.equal(blackMetrics.needsLowLightBoost, false);

  // Dimly lit webcam with real scene contrast (mean ~42, stdDev > 15)
  const dim = new Uint8ClampedArray(64 * 64 * 4);
  for (let p = 0; p < 64 * 64; p += 1) {
    const v = p % 2 === 0 ? 22 : 62;
    dim[p * 4] = v;
    dim[p * 4 + 1] = v;
    dim[p * 4 + 2] = v;
    dim[p * 4 + 3] = 255;
  }
  const dimMetrics = analyzeFrameExposure(dim);
  assert.equal(dimMetrics.isBlankFrame, false);
  assert.equal(dimMetrics.needsLowLightBoost, true);

  // Well-lit normal scene
  const bright = new Uint8ClampedArray(64 * 64 * 4);
  for (let p = 0; p < 64 * 64; p += 1) {
    const v = p % 2 === 0 ? 110 : 195;
    bright[p * 4] = v;
    bright[p * 4 + 1] = v;
    bright[p * 4 + 2] = v;
    bright[p * 4 + 3] = 255;
  }
  const brightMetrics = analyzeFrameExposure(bright);
  assert.equal(brightMetrics.isBlankFrame, false);
  assert.equal(brightMetrics.needsLowLightBoost, false);
});

test('shouldTriggerSilentZeroWebglWatchdog triggers CPU probe after 5 consecutive empty non-blank WebGL frames and resets on detection', () => {
  let count = 0;
  for (let i = 0; i < 4; i += 1) {
    const step = shouldTriggerSilentZeroWebglWatchdog({
      backend: 'webgl',
      rawPredictionCount: 0,
      isBlankFrame: false,
      consecutiveSilentZeroFrames: count,
    });
    count = step.nextSilentCount;
    assert.equal(step.shouldProbeCpu, false);
  }

  // Blank frames do not falsely advance watchdog
  const blankStep = shouldTriggerSilentZeroWebglWatchdog({
    backend: 'webgl',
    rawPredictionCount: 0,
    isBlankFrame: true,
    consecutiveSilentZeroFrames: count,
  });
  assert.equal(blankStep.shouldProbeCpu, false);
  assert.equal(blankStep.nextSilentCount, 4);

  // 5th non-blank empty WebGL frame triggers CPU shadow check
  const triggerStep = shouldTriggerSilentZeroWebglWatchdog({
    backend: 'webgl',
    rawPredictionCount: 0,
    isBlankFrame: false,
    consecutiveSilentZeroFrames: count,
  });
  assert.equal(triggerStep.shouldProbeCpu, true);

  // Any detection resets counter to 0
  const resetStep = shouldTriggerSilentZeroWebglWatchdog({
    backend: 'webgl',
    rawPredictionCount: 2,
    isBlankFrame: false,
    consecutiveSilentZeroFrames: 4,
  });
  assert.equal(resetStep.nextSilentCount, 0);
  assert.equal(resetStep.shouldProbeCpu, false);
});
