import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNoseAnchor,
  findHoveredBodySubject,
  isPointInsideBodySilhouette,
} from './bodySilhouette';
import type { TrackedSubject } from '../types';

test('computeNoseAnchor anchors full-body and close-up trails to anatomical nose position', () => {
  // Full-body standing person: h=600, w=200 (aspect=3.0) -> nose near top ~13.5%
  const standingNose = computeNoseAnchor([100, 300, 700, 500]);
  assert.equal(standingNose.x, 400);
  assert.equal(Math.round(standingNose.y), 181);

  // Close-up portrait: h=300, w=320 (aspect=0.94) -> nose ~28% from top
  const closeupNose = computeNoseAnchor([200, 300, 500, 620]);
  assert.equal(closeupNose.x, 460);
  assert.equal(Math.round(closeupNose.y), 284);
});

test('isPointInsideBodySilhouette hits ONLY the human body and rejects empty background box corners', () => {
  const standingRect = { x: 100, y: 40, width: 100, height: 260 };

  // Top-left & top-right background wall corners MUST be false (NOT a square box!)
  assert.equal(isPointInsideBodySilhouette(105, 45, standingRect), false);
  assert.equal(isPointInsideBodySilhouette(195, 45, standingRect), false);

  // Head center & chest center MUST be true
  assert.equal(isPointInsideBodySilhouette(150, 72, standingRect), true);
  assert.equal(isPointInsideBodySilhouette(150, 150, standingRect), true);

  // Gap between feet at very bottom center MUST be false
  assert.equal(isPointInsideBodySilhouette(150, 290, standingRect), false);
  // Left & right legs MUST be true
  assert.equal(isPointInsideBodySilhouette(135, 260, standingRect), true);
  assert.equal(isPointInsideBodySilhouette(165, 260, standingRect), true);
});

test('findHoveredBodySubject returns only the specific person whose body is under the cursor', () => {
  const activeRect = { x: 0, y: 0, width: 640, height: 360 };
  const subjects: TrackedSubject[] = [
    {
      id: 'SUBJ-01',
      numericId: 1,
      box_2d: [100, 100, 900, 320],
      confidence: 92,
      firstSeenAtMs: 0,
      lastSeenAtMs: 1000,
      dwellSeconds: 1,
      speedNormPerSec: 0,
      trail: [],
    },
    {
      id: 'SUBJ-02',
      numericId: 2,
      box_2d: [100, 550, 900, 780],
      confidence: 90,
      firstSeenAtMs: 0,
      lastSeenAtMs: 1000,
      dwellSeconds: 1,
      speedNormPerSec: 0,
      trail: [],
    },
  ];

  // Cursor over SUBJ-02 chest
  const hit2 = findHoveredBodySubject({ x: 425, y: 180 }, subjects, activeRect);
  assert.equal(hit2?.id, 'SUBJ-02');

  // Cursor in empty background between the two people
  const miss = findHoveredBodySubject({ x: 280, y: 180 }, subjects, activeRect);
  assert.equal(miss, null);

  // Cursor in empty upper-left wall corner of SUBJ-01's bounding box -> must NOT falsely hover SUBJ-01
  const cornerMiss = findHoveredBodySubject({ x: 66, y: 40 }, subjects, activeRect);
  assert.equal(cornerMiss, null);
});
