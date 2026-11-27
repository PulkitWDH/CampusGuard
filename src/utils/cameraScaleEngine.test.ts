import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClassroomCamera } from '../types';
import {
  InferenceScheduler,
  MAX_SUPPORTED_CAMERAS,
  getAdaptiveRenderProfile,
  getWallPageSize,
  paginateCameras,
  stripCamerasForStorage,
} from './cameraScaleEngine';

function makeCameras(count: number): ClassroomCamera[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `cam-${idx + 1}`,
    cameraCode: `CAM-${idx + 1}`,
    classroomName: `Zone ${String(idx + 1).padStart(3, '0')}`,
    bluetoothDeviceName: `IP-Cam-${idx + 1}`,
    bluetoothAddress: `00:11:22:33:${String(Math.floor(idx / 100)).padStart(2, '0')}:${String(idx % 100).padStart(2, '0')}`,
    sourceKind: 'wifi-cctv',
    hasVideo: true,
    hasVoice: true,
    voiceListeningEnabled: false,
    autoAiEnabled: true,
    streamUrl: `http://192.168.1.${(idx % 250) + 2}/snapshot.jpg`,
    liveTranscript: 'sample voice text',
    audioLevel: 42,
    status: idx === 249 ? 'fighting' : idx === 412 ? 'warning' : 'normal',
    studentCount: idx % 5,
    lastAnalysis: {
      studentCount: 2,
      detectedPeople: [
        { label: 'Person', box_2d: [100, 100, 500, 300], confidence: 90 },
      ],
      detectedObjects: [],
      isFighting: idx === 249,
      severity: idx === 249 ? 'critical' : 'none',
      threatCategory: idx === 249 ? 'fight' : 'none',
      threatScore: idx === 249 ? 92 : 0,
      detectedBehaviors: [],
      recommendedAction: 'Monitor',
      voiceAnalysis: 'Quiet',
      fightReason: '',
      summary: 'Nominal',
      confidence: 92,
      analyzedAt: '2026-11-27T00:00:00.000Z',
    },
    isAnalyzing: true,
  }));
}

test('paginateCameras smoothly paginates, filters, and alert-prioritizes 500 cameras', () => {
  const cams500 = makeCameras(500);
  assert.equal(getWallPageSize('1x1'), 1);
  assert.equal(getWallPageSize('2x2'), 4);
  assert.equal(getWallPageSize('3x3'), 9);
  assert.equal(getWallPageSize('4x4'), 16);

  const startedAt = performance.now();
  const page1 = paginateCameras(cams500, {
    page: 1,
    layout: '4x4',
    prioritizeAlerts: true,
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(page1.totalCameras, 500);
  assert.equal(page1.totalPages, 32); // ceil(500 / 16) = 32
  assert.equal(page1.pageCameras.length, 16);
  // Alarmed cameras (CAM-250 fighting, CAM-413 warning) bubble to front of page 1
  assert.equal(page1.pageCameras[0].id, 'cam-250');
  assert.equal(page1.pageCameras[1].id, 'cam-413');
  assert.ok(elapsedMs < 25, `Expected O(N) 500-cam pagination < 25ms, got ${elapsedMs}ms`);

  // Clamps out-of-bounds page cleanly to last page (500 - 31*16 = 4 cameras on page 32)
  const lastPage = paginateCameras(cams500, { page: 999, layout: '4x4' });
  assert.equal(lastPage.currentPage, 32);
  assert.equal(lastPage.pageCameras.length, 4);

  // Search filter across 500 cameras
  const searchRes = paginateCameras(cams500, {
    page: 1,
    layout: '2x2',
    searchQuery: 'Zone 485',
  });
  assert.equal(searchRes.totalMatched, 1);
  assert.equal(searchRes.pageCameras[0].id, 'cam-485');

  // Alerts-only filter
  const alertRes = paginateCameras(cams500, {
    page: 1,
    layout: '2x2',
    filterMode: 'alerts',
  });
  assert.equal(alertRes.totalMatched, 2);
});

test('getAdaptiveRenderProfile scales canvas resolution & FPS smoothly from 1 to 16 visible feeds', () => {
  const singleFullHd = getAdaptiveRenderProfile(1, false, 1920, 1);
  assert.equal(singleFullHd.targetWidth, 1920);
  assert.equal(singleFullHd.targetHeight, 1080);
  assert.equal(singleFullHd.targetFps, 60);

  const focusedOverridesGrid = getAdaptiveRenderProfile(16, true, 1920, 2);
  assert.equal(focusedOverridesGrid.targetWidth, 1920);
  assert.equal(focusedOverridesGrid.targetFps, 60);

  const quad = getAdaptiveRenderProfile(4, false, 1920, 2);
  assert.equal(quad.targetWidth, 1280);
  assert.equal(quad.targetHeight, 720);
  assert.equal(quad.targetFps, 30);

  const wall3x3 = getAdaptiveRenderProfile(9, false, 1920, 2);
  assert.equal(wall3x3.targetWidth, 960);
  assert.equal(wall3x3.targetFps, 20);
  assert.equal(wall3x3.enableMultiTileScan, false);

  const wall4x4 = getAdaptiveRenderProfile(16, false, 1920, 2);
  assert.equal(wall4x4.targetWidth, 640);
  assert.equal(wall4x4.targetHeight, 360);
  assert.equal(wall4x4.targetFps, 15);
  assert.equal(wall4x4.allowAutoPtzInset, false);
});

test('stripCamerasForStorage keeps 500 cameras compact and well under browser localStorage quota', () => {
  const cams520 = makeCameras(520);
  const stripped = stripCamerasForStorage(cams520);
  assert.equal(stripped.length, MAX_SUPPORTED_CAMERAS);
  assert.equal(stripped[0].lastAnalysis, null);
  assert.equal(stripped[0].isAnalyzing, false);
  const jsonBytes = Buffer.byteLength(JSON.stringify(stripped), 'utf8');
  assert.ok(jsonBytes < 350_000, `Expected 500 stored cameras < 350 KB, got ${jsonBytes} bytes`);
});

test('InferenceScheduler enforces strict concurrency=1, prioritizes alarms, and rotates fairly', async () => {
  const scheduler = new InferenceScheduler({ maxConcurrency: 1, yieldBetweenMs: 0 });
  let running = 0;
  let peakRunning = 0;
  const executionOrder: string[] = [];

  const job = (id: string, delayMs: number) => async () => {
    running += 1;
    peakRunning = Math.max(peakRunning, running);
    executionOrder.push(id);
    await new Promise((r) => setTimeout(r, delayMs));
    running -= 1;
  };

  // Start cam-1 (holds the single slot), then enqueue normal cam-2, normal cam-3, and critical cam-alarm (priority 0)
  const p1 = scheduler.schedule('cam-1', 1, job('cam-1', 15));
  const p2 = scheduler.schedule('cam-2', 1, job('cam-2', 5));
  const p3 = scheduler.schedule('cam-3', 1, job('cam-3', 5));
  const pAlarm = scheduler.schedule('cam-alarm', 0, job('cam-alarm', 5));

  await Promise.all([p1, p2, p3, pAlarm]);

  assert.equal(peakRunning, 1, 'Concurrency must never exceed 1');
  assert.equal(executionOrder[0], 'cam-1');
  assert.equal(executionOrder[1], 'cam-alarm', 'Priority 0 alarm camera must run immediately next');
  assert.equal(executionOrder.length, 4);
});
