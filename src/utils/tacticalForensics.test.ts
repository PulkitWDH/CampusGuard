import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEATMAP_COLS,
  HEATMAP_ROWS,
  createActivityHeatmap,
  detectPerimeterBreaches,
  normalizeDragToPerimeterZone,
  pushRollingDvrFrame,
  sealForensicEvidenceCase,
  updateActivityHeatmap,
  verifyForensicEvidenceIntegrity,
} from './tacticalForensics';

test('normalizeDragToPerimeterZone maps canvas pixel drag onto aspect-preserved video rect and rejects tiny accidental clicks', () => {
  // Portrait video pillarboxed at x=219..422 inside 640x360 canvas
  const drawRect = { x: 219, y: 0, width: 203, height: 360 };

  // Accidental tiny click (5x5 px) -> null
  assert.equal(
    normalizeDragToPerimeterZone({ x: 300, y: 120 }, { x: 305, y: 125 }, drawRect),
    null
  );

  // Valid drag across middle of portrait video
  const zone = normalizeDragToPerimeterZone(
    { x: 240, y: 90 },
    { x: 400, y: 270 },
    drawRect,
    'Vault Door'
  );
  assert.ok(zone);
  assert.equal(zone.label, 'Vault Door');
  assert.equal(zone.box_2d[0], 250); // ymin = 90/360
  assert.equal(zone.box_2d[2], 750); // ymax = 270/360
  assert.ok(zone.box_2d[1] >= 100 && zone.box_2d[1] <= 110);
  assert.ok(zone.box_2d[3] >= 885 && zone.box_2d[3] <= 900);
});

test('detectPerimeterBreaches detects when a human enters a restricted zone and ignores people outside it', () => {
  const restricted = {
    id: 'z-1',
    label: 'Vault Perimeter',
    box_2d: [200, 600, 800, 950] as [number, number, number, number],
  };

  const outsidePerson = {
    label: 'Person (left)',
    box_2d: [180, 100, 820, 420] as [number, number, number, number],
    confidence: 88,
  };
  const safeRes = detectPerimeterBreaches([outsidePerson], restricted);
  assert.equal(safeRes.breached, false);
  assert.equal(safeRes.breachingPeople.length, 0);

  const intruder = {
    label: 'Person (right)',
    box_2d: [220, 640, 850, 880] as [number, number, number, number],
    confidence: 91,
  };
  const breachRes = detectPerimeterBreaches([outsidePerson, intruder], restricted);
  assert.equal(breachRes.breached, true);
  assert.equal(breachRes.breachingPeople.length, 1);
  assert.equal(breachRes.breachingPeople[0].label, 'Person (right)');
  assert.ok(breachRes.maxOverlap > 0.5);
});

test('updateActivityHeatmap accumulates dwell at person locations and decays cleanly over time', () => {
  const grid = createActivityHeatmap(HEATMAP_COLS, HEATMAP_ROWS);
  const person = {
    label: 'Person (center)',
    box_2d: [300, 400, 700, 600] as [number, number, number, number],
    confidence: 89,
  };

  updateActivityHeatmap(grid, [person]);
  const centerIdx = Math.floor(0.5 * HEATMAP_ROWS) * HEATMAP_COLS + Math.floor(0.5 * HEATMAP_COLS);
  const cornerIdx = 0;
  assert.ok(grid[centerIdx] > 0.2);
  assert.equal(grid[cornerIdx], 0);

  const peakBeforeDecay = grid[centerIdx];
  updateActivityHeatmap(grid, []);
  assert.ok(grid[centerIdx] < peakBeforeDecay);
});

test('pushRollingDvrFrame maintains bounded circular buffer and accurate relative offsets', () => {
  let buf = pushRollingDvrFrame([], {
    capturedAt: '2026-11-23T05:00:00.000Z',
    imageDataUrl: 'data:image/jpeg;base64,AAA',
    studentCount: 1,
    audioLevel: 50,
    threatScore: 5,
    transcript: '',
  }, 3);
  buf = pushRollingDvrFrame(buf, {
    capturedAt: '2026-11-23T05:00:02.000Z',
    imageDataUrl: 'data:image/jpeg;base64,BBB',
    studentCount: 2,
    audioLevel: 65,
    threatScore: 15,
    transcript: 'hey',
  }, 3);
  buf = pushRollingDvrFrame(buf, {
    capturedAt: '2026-11-23T05:00:04.000Z',
    imageDataUrl: 'data:image/jpeg;base64,CCC',
    studentCount: 2,
    audioLevel: 92,
    threatScore: 90,
    transcript: 'help',
  }, 3);
  buf = pushRollingDvrFrame(buf, {
    capturedAt: '2026-11-23T05:00:06.000Z',
    imageDataUrl: 'data:image/jpeg;base64,DDD',
    studentCount: 2,
    audioLevel: 94,
    threatScore: 95,
    transcript: 'stop hitting me',
  }, 3);

  assert.equal(buf.length, 3);
  assert.equal(buf[0].imageDataUrl, 'data:image/jpeg;base64,BBB');
  assert.equal(buf[0].offsetSec, -4);
  assert.equal(buf[2].offsetSec, 0);
});

test('sealForensicEvidenceCase produces real SHA-256 digest and verifyForensicEvidenceIntegrity detects tampering', async () => {
  const sealed = await sealForensicEvidenceCase({
    id: 'ev-1',
    caseNumber: 'CASE-001',
    cameraId: 'cam-1',
    cameraCode: 'CAM-1',
    classroomName: 'Vault Lobby',
    triggerType: 'perimeter_breach',
    threatCategory: 'intrusion',
    severity: 'critical',
    headline: 'Perimeter Breach in Vault Lobby',
    summary: 'Subject crossed restricted perimeter zone.',
    sealedAt: '2026-11-23T05:10:00.000Z',
    peakAudioDb: 72.4,
    maxPeopleCount: 1,
    transcriptSnapshot: '',
    frames: [
      {
        capturedAt: '2026-11-23T05:10:00.000Z',
        offsetSec: 0,
        imageDataUrl: 'data:image/jpeg;base64,FRAME1DATA',
        studentCount: 1,
        audioLevel: 72.4,
        threatScore: 92,
        transcript: '',
      },
    ],
  });

  assert.equal(sealed.sha256Hash.length, 64);
  assert.match(sealed.sha256Hash, /^[0-9a-f]{64}$/);

  const validCheck = await verifyForensicEvidenceIntegrity(sealed);
  assert.equal(validCheck.valid, true);

  // Tamper with summary -> SHA-256 verification MUST fail!
  const tampered = { ...sealed, summary: 'Nothing happened here.' };
  const tamperedCheck = await verifyForensicEvidenceIntegrity(tampered);
  assert.equal(tamperedCheck.valid, false);
  assert.notEqual(tamperedCheck.recomputedHash, tamperedCheck.expectedHash);
});
