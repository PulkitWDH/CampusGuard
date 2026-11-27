import assert from 'node:assert/strict';
import test from 'node:test';
import type { DetectedPersonBox, WatchlistSubject } from '../types';
import {
  computeAppearanceSimilarity,
  computeSmoothPtzViewport,
  easePtzViewportToFull,
  extractAppearanceSignature,
  mapBoxThroughPtzViewport,
  mapPointThroughPtzViewport,
  matchSubjectsToWatchlist,
  updateTrackedSubjects,
} from './subjectIntelligence';

function makeSolidPersonBuffer(
  width: number,
  height: number,
  upperRgb: [number, number, number],
  lowerRgb: [number, number, number]
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const [r, g, b] = y < height * 0.55 ? upperRgb : lowerRgb;
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    }
  }
  return buf;
}

test('updateTrackedSubjects assigns persistent Subject IDs, anchors trails at the nose, tracks dwell time, and prunes departed subjects', () => {
  const frame1: DetectedPersonBox[] = [
    { label: 'Person 1', box_2d: [200, 120, 760, 320], confidence: 92 },
  ];
  const step1 = updateTrackedSubjects([], frame1, 1000, 1);
  assert.equal(step1.subjects.length, 1);
  assert.equal(step1.subjects[0].id, 'SUBJ-01');
  assert.equal(step1.subjects[0].dwellSeconds, 0);
  assert.equal(step1.subjects[0].trail.length, 1);
  // Trail must be anchored at the anatomical nose (~276y for a [200..760] tall full body), NOT torso center (480y)
  assert.equal(step1.subjects[0].trail[0].x, 220);
  assert.ok(
    step1.subjects[0].trail[0].y >= 260 && step1.subjects[0].trail[0].y <= 290,
    `Expected nose y near 276, got ${step1.subjects[0].trail[0].y}`
  );

  // Subject walks right 5 seconds later
  const frame2: DetectedPersonBox[] = [
    { label: 'Person 1', box_2d: [210, 190, 770, 390], confidence: 91 },
    { label: 'Person 2', box_2d: [250, 680, 820, 860], confidence: 88 },
  ];
  const step2 = updateTrackedSubjects(step1.subjects, frame2, 6000, step1.nextNumericId);
  assert.equal(step2.subjects.length, 2);
  assert.equal(step2.subjects[0].id, 'SUBJ-01');
  assert.equal(step2.subjects[0].dwellSeconds, 5);
  assert.equal(step2.subjects[0].trail.length, 2);
  assert.equal(step2.subjects[1].id, 'SUBJ-02');
  assert.equal(step2.nextNumericId, 3);

  // Room clears > 6 seconds later -> pruned cleanly
  const step3 = updateTrackedSubjects(step2.subjects, [], 13000, step2.nextNumericId);
  assert.equal(step3.subjects.length, 0);
});

test('extractAppearanceSignature and computeAppearanceSimilarity match the same clothing across cameras and reject different clothing', () => {
  const personACam1 = makeSolidPersonBuffer(100, 100, [215, 38, 32], [28, 45, 115]);
  const personACam2 = makeSolidPersonBuffer(100, 100, [190, 34, 28], [24, 38, 98]);
  const personB = makeSolidPersonBuffer(100, 100, [32, 185, 65], [210, 198, 155]);

  const box: [number, number, number, number] = [0, 0, 1000, 1000];
  const sigA1 = extractAppearanceSignature(personACam1, 100, 100, box);
  const sigA2 = extractAppearanceSignature(personACam2, 100, 100, box);
  const sigB = extractAppearanceSignature(personB, 100, 100, box);

  const sameScore = computeAppearanceSimilarity(sigA1, sigA2);
  const diffScore = computeAppearanceSimilarity(sigA1, sigB);

  assert.ok(sameScore >= 90, `Expected same person across lighting >= 90%, got ${sameScore}%`);
  assert.ok(diffScore <= 25, `Expected different clothing <= 25%, got ${diffScore}%`);
  assert.ok(sigA1.upperColorHex.startsWith('#'));
  assert.ok(sigA1.lowerColorHex.startsWith('#'));
});

test('matchSubjectsToWatchlist triggers only for enrolled matching subjects above threshold', () => {
  const redJacketBuf = makeSolidPersonBuffer(80, 80, [210, 40, 35], [30, 40, 110]);
  const blueShirtBuf = makeSolidPersonBuffer(80, 80, [30, 95, 220], [50, 50, 55]);
  const fullBox: [number, number, number, number] = [100, 100, 900, 900];

  const suspectSig = extractAppearanceSignature(redJacketBuf, 80, 80, fullBox);
  const innocentSig = extractAppearanceSignature(blueShirtBuf, 80, 80, fullBox);

  const watchlist: WatchlistSubject[] = [
    {
      id: 'wl-1',
      label: 'Flagged Intruder',
      enrolledAt: '2026-11-23T12:00:00.000Z',
      sourceCameraCode: 'CAM-1',
      thumbnailDataUrl: 'data:image/jpeg;base64,abc',
      signature: suspectSig,
      matchCount: 0,
    },
  ];

  const tracked = updateTrackedSubjects(
    [],
    [
      { label: 'Person 1', box_2d: [120, 120, 860, 420], confidence: 93 },
      { label: 'Person 2', box_2d: [140, 520, 860, 840], confidence: 91 },
    ],
    1000,
    1
  ).subjects;

  const matches = matchSubjectsToWatchlist(
    tracked,
    {
      'SUBJ-01': suspectSig,
      'SUBJ-02': innocentSig,
    },
    watchlist,
    84
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].subjectId, 'SUBJ-01');
  assert.equal(matches[0].watchlistItem.label, 'Flagged Intruder');
  assert.ok(matches[0].similarity >= 95);
});

test('computeSmoothPtzViewport preserves exact aspect ratio, eliminates micro-jitter via deadband, and glides smoothly', () => {
  const initial = computeSmoothPtzViewport([200, 720, 620, 880], null, 0.1, {
    sourceAspect: 16 / 9,
    targetAspect: 16 / 9,
  });
  assert.ok(initial.xmin >= 0 && initial.xmax <= 1000);
  assert.ok(initial.ymin >= 0 && initial.ymax <= 1000);
  assert.ok(initial.zoomFactor >= 1.3 && initial.zoomFactor <= 2.8, `Expected crisp zoom, got ${initial.zoomFactor}x`);
  const normW = initial.xmax - initial.xmin;
  const normH = initial.ymax - initial.ymin;
  assert.ok(Math.abs(normW - normH) < 2, 'Equal source/target aspect should keep equal normalized spans');

  // Tiny 5-unit COCO-SSD wobble -> deadband holds viewport rock-steady (identical reference!)
  const jittered = computeSmoothPtzViewport([204, 723, 623, 883], initial, 0.1, {
    sourceAspect: 16 / 9,
    targetAspect: 16 / 9,
  });
  assert.strictEqual(jittered, initial, 'Minor bounding-box jitter must not move PTZ viewport');

  // Subject walks left -> smoothed PTZ glides smoothly rather than snapping
  const panned = computeSmoothPtzViewport([200, 140, 620, 300], initial, 0.2, {
    sourceAspect: 16 / 9,
    targetAspect: 16 / 9,
  });
  assert.ok(panned.xmin < initial.xmin, 'PTZ viewport should pan left');
  assert.ok(panned.xmin > 140, 'PTZ viewport should interpolate smoothly rather than snap');

  // Coordinate mapping through PTZ keeps center of viewport at (500, 500)
  const midPt = mapPointThroughPtzViewport(
    { x: (initial.xmin + initial.xmax) / 2, y: (initial.ymin + initial.ymax) / 2 },
    initial
  );
  assert.ok(Math.abs(midPt.x - 500) < 1 && Math.abs(midPt.y - 500) < 1);

  const mappedBox = mapBoxThroughPtzViewport([initial.ymin, initial.xmin, initial.ymax, initial.xmax], initial);
  assert.ok(Math.abs(mappedBox[0]) < 1 && Math.abs(mappedBox[1]) < 1);
  assert.ok(Math.abs(mappedBox[2] - 1000) < 1 && Math.abs(mappedBox[3] - 1000) < 1);

  // Smooth ease back to full wide room
  let vp: typeof initial | null = initial;
  for (let i = 0; i < 60 && vp !== null; i += 1) {
    vp = easePtzViewportToFull(vp, 0.2);
  }
  assert.equal(vp, null, 'PTZ should ease cleanly back to full frame');
});
