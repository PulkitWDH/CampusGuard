import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNoseAnchor } from './bodySilhouette';
import { updateTrackedSubjects } from './subjectIntelligence';
import {
  advanceSmoothedDisplayPoint,
  buildSmoothTrailSpline,
  filterNoseSample,
} from './trailSmoothing';

test('computeNoseAnchor varies smoothly with aspect ratio without vertical cliffs around 1.15 or 1.65', () => {
  const before115 = computeNoseAnchor([100, 200, 670, 700]); // aspect = 570 / 500 = 1.14
  const after115 = computeNoseAnchor([100, 200, 680, 700]); // aspect = 580 / 500 = 1.16
  assert.ok(
    Math.abs(after115.y - before115.y) < 3,
    `Expected smooth nose Y transition across aspect 1.15, got jump of ${Math.abs(after115.y - before115.y)}`
  );

  const before165 = computeNoseAnchor([100, 200, 756, 600]); // aspect = 656 / 400 = 1.64
  const after165 = computeNoseAnchor([100, 200, 764, 600]); // aspect = 664 / 400 = 1.66
  assert.ok(
    Math.abs(after165.y - before165.y) < 3,
    `Expected smooth nose Y transition across aspect 1.65, got jump of ${Math.abs(after165.y - before165.y)}`
  );
});

test('filterNoseSample suppresses stationary micro-jitter, damps sudden spikes, and tracks real walking smoothly', () => {
  // 1. Stationary wobble within deadband barely moves
  const anchor = { x: 500, y: 300 };
  const jittered = filterNoseSample(anchor, { x: 504, y: 297 }, 0.25);
  assert.ok(
    Math.hypot(jittered.x - anchor.x, jittered.y - anchor.y) < 1.0,
    `Expected micro-jitter < 1 unit, got (${jittered.x}, ${jittered.y})`
  );

  // 2. Single-frame 200-unit vertical glitch spike is heavily damped
  const spiked = filterNoseSample(anchor, { x: 500, y: 100 }, 0.2);
  assert.ok(
    spiked.y > 235 && spiked.y < 290,
    `Expected spike to be heavily damped near anchor, got y=${spiked.y}`
  );

  // 3. Deliberate fast horizontal motion tracks responsively
  const walking = filterNoseSample(anchor, { x: 610, y: 300 }, 0.25);
  assert.ok(
    walking.x >= 555 && walking.x <= 610,
    `Expected responsive tracking during real walk, got x=${walking.x}`
  );
});

test('advanceSmoothedDisplayPoint glides smoothly at 60fps without overshooting', () => {
  let pt = { x: 200, y: 300 };
  const target = { x: 320, y: 300 };

  for (let frame = 0; frame < 30; frame += 1) {
    const next = advanceSmoothedDisplayPoint(pt, target, 16.67);
    assert.ok(next.x >= pt.x && next.x <= target.x, 'Display point must glide monotonically toward target');
    pt = next;
  }

  assert.ok(pt.x > 305, `Expected near convergence after 0.5s at 60fps, got x=${pt.x}`);
});

test('buildSmoothTrailSpline turns jagged alternating zigzag points into a smooth C1 curve', () => {
  const jagged = [
    { x: 100, y: 200 },
    { x: 140, y: 165 },
    { x: 180, y: 235 },
    { x: 220, y: 170 },
    { x: 260, y: 230 },
    { x: 300, y: 200 },
  ];

  const spline = buildSmoothTrailSpline(jagged, {
    minControlSpacing: 2,
    laplacianPasses: 2,
    subdivisionsPerSegment: 8,
  });

  assert.ok(spline.length > jagged.length * 4, 'Spline should be densely sampled');
  assert.equal(spline[0].progress, 0);
  assert.equal(spline[spline.length - 1].progress, 1);
  assert.ok(Math.hypot(spline[0].x - 100, spline[0].y - 200) < 0.01, 'Tail endpoint stays pinned');
  assert.ok(
    Math.hypot(spline[spline.length - 1].x - 300, spline[spline.length - 1].y - 200) < 0.01,
    'Head endpoint stays pinned'
  );

  // Verify smoothed curve dramatically reduces vertical zigzag amplitude (raw peak-to-peak = 70px)
  const ys = spline.map((p) => p.y);
  const peakToPeak = Math.max(...ys) - Math.min(...ys);
  assert.ok(
    peakToPeak < 40,
    `Expected Laplacian + Catmull-Rom smoothing to cut zigzag amplitude below 40px, got ${peakToPeak.toFixed(1)}px`
  );

  // Verify every point is finite and progress is strictly non-decreasing
  for (let i = 1; i < spline.length; i += 1) {
    assert.ok(Number.isFinite(spline[i].x) && Number.isFinite(spline[i].y));
    assert.ok(spline[i].progress >= spline[i - 1].progress);
  }
});

test('updateTrackedSubjects avoids stationary trail scribble buildup and prunes expired trail waypoints', () => {
  let subjects = updateTrackedSubjects(
    [],
    [{ label: 'Person 1', box_2d: [200, 350, 880, 750], confidence: 88 }],
    1000,
    1
  ).subjects;

  // Simulate 10 frames of +/-5 unit COCO-SSD bounding box wobble while person sits still
  for (let i = 1; i <= 10; i += 1) {
    const jitter = i % 2 === 0 ? 5 : -5;
    subjects = updateTrackedSubjects(
      subjects,
      [{ label: 'Person 1', box_2d: [200 + jitter, 350 - jitter, 880 + jitter, 750 - jitter], confidence: 86 }],
      1000 + i * 250,
      2
    ).subjects;
  }

  assert.equal(
    subjects[0].trail.length,
    1,
    `Stationary person with +/-5 unit box wobble must not build a zigzag trail, got ${subjects[0].trail.length} points`
  );

  // Person walks right, then stands still past trailMaxAgeMs (8s) -> old waypoints expire cleanly
  subjects = updateTrackedSubjects(
    subjects,
    [{ label: 'Person 1', box_2d: [200, 500, 880, 900], confidence: 88 }],
    4000,
    2
  ).subjects;
  assert.equal(subjects[0].trail.length, 2);

  subjects = updateTrackedSubjects(
    subjects,
    [{ label: 'Person 1', box_2d: [200, 500, 880, 900], confidence: 88 }],
    14000,
    2
  ).subjects;
  assert.equal(subjects[0].trail.length, 1, 'Expired trail points should dissolve cleanly when stationary');
});
