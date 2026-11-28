import assert from 'node:assert/strict';
import test from 'node:test';
import type { DetectedPersonBox } from '../types';
import { type PersonTrackerState, stepPersonTracker } from './monitoringLogic';
import {
  DEFAULT_DEMO_CROWD_THRESHOLD,
  DEFAULT_LIVE_CROWD_THRESHOLD,
  buildOverlappingTileGrid,
  evaluateCrowdCrushRisk,
  filterEmptyRoomMovementPhantoms,
  mapTilePredictionToFullFrame,
  mergeCrowdTileDetections,
  shouldEngageDeepCrowdGrid,
  type TileCandidateBox,
} from './crowdTiling';

test('buildOverlappingTileGrid covers full [0..1000] frame seamlessly with overlap across seams', () => {
  const quad = buildOverlappingTileGrid(2, 2, 0.2);
  assert.equal(quad.length, 4);
  assert.equal(quad[0].xmin, 0);
  assert.equal(quad[0].ymin, 0);
  assert.equal(quad[3].xmax, 1000);
  assert.equal(quad[3].ymax, 1000);
  // Tile 0 (left) and Tile 1 (right) must overlap horizontally
  assert.ok(quad[0].xmax > quad[1].xmin, 'Adjacent tiles must overlap so seam people are not split');

  const crowdGrid = buildOverlappingTileGrid(4, 3, 0.22);
  assert.equal(crowdGrid.length, 12);
  assert.equal(crowdGrid[0].xmin, 0);
  assert.equal(crowdGrid[11].xmax, 1000);
  assert.equal(crowdGrid[11].ymax, 1000);
});

test('mapTilePredictionToFullFrame projects zoomed tile boxes accurately and rejects thin interior seam slices', () => {
  const grid = buildOverlappingTileGrid(4, 3, 0.22);
  const centerTile = grid.find((t) => t.col === 1 && t.row === 1)!;

  // Person centered inside tile -> projects accurately into full frame
  const projected = mapTilePredictionToFullFrame([100, 80, 90, 160], 68, 300, 300, centerTile, 22);
  assert.ok(projected);
  assert.equal(projected.confidence, 68);
  assert.ok(projected.box_2d[1] > centerTile.xmin && projected.box_2d[3] < centerTile.xmax);
  assert.ok(projected.box_2d[0] > centerTile.ymin && projected.box_2d[2] < centerTile.ymax);

  // Razor-thin sliver glued to interior left seam -> dropped because adjacent tile sees full body
  const seamSliver = mapTilePredictionToFullFrame([0, 90, 14, 150], 55, 300, 300, centerTile, 22);
  assert.equal(seamSliver, null);
});

test('shouldEngageDeepCrowdGrid skips close-up webcam people and activates for dense or distant crowds', () => {
  const singleSmallCrowdPerson: DetectedPersonBox[] = [
    { label: 'Person', box_2d: [500, 410, 740, 490], confidence: 35 },
  ];
  // Even 1 small person (height 240 < 340) triggers deep 4x3 crowd zoom grid!
  assert.equal(shouldEngageDeepCrowdGrid(singleSmallCrowdPerson, singleSmallCrowdPerson, false), true);

  // Single close-up webcam person does NOT trigger 12-tile overhead
  assert.equal(
    shouldEngageDeepCrowdGrid(
      [{ label: 'Person', box_2d: [120, 220, 920, 780], confidence: 92 }],
      [],
      true
    ),
    false
  );
});

test('mergeCrowdTileDetections preserves 25+ shoulder-to-shoulder crowd people while deduplicating overlapping seam repeats', () => {
  const crowd: DetectedPersonBox[] = [];
  // Build a 5x5 grid of 25 closely packed people + duplicate detections from overlapping tiles
  for (let r = 0; r < 5; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      const ymin = 100 + r * 165;
      const xmin = 80 + c * 170;
      const ymax = ymin + 150;
      const xmax = xmin + 130;
      crowd.push({ label: 'Person', box_2d: [ymin, xmin, ymax, xmax], confidence: 62 });
      // Overlapping tile duplicate shifted by 6 units
      crowd.push({ label: 'Person', box_2d: [ymin + 5, xmin + 6, ymax + 4, xmax + 5], confidence: 54 });
    }
  }

  const merged = mergeCrowdTileDetections(crowd, 22);
  assert.equal(merged.length, 25, `Expected 25 unique crowd people after seam dedup, got ${merged.length}`);
});

test('evaluateCrowdCrushRisk classifies SAFE, ELEVATED, and CRITICAL CRUSH RISK accurately', () => {
  assert.equal(DEFAULT_DEMO_CROWD_THRESHOLD, 15);
  assert.equal(DEFAULT_LIVE_CROWD_THRESHOLD, 30);

  const safe = evaluateCrowdCrushRisk(8, 15);
  assert.equal(safe.status, 'SAFE');
  assert.equal(safe.exceeded, false);

  const elevated = evaluateCrowdCrushRisk(11, 15);
  assert.equal(elevated.status, 'ELEVATED');
  assert.equal(elevated.exceeded, false);

  const critical = evaluateCrowdCrushRisk(15, 15);
  assert.equal(critical.status, 'CRITICAL CRUSH RISK');
  assert.equal(critical.exceeded, true);
  assert.equal(critical.percentOfThreshold, 100);

  const liveCritical = evaluateCrowdCrushRisk(36, DEFAULT_LIVE_CROWD_THRESHOLD);
  assert.equal(liveCritical.status, 'CRITICAL CRUSH RISK');
  assert.equal(liveCritical.exceeded, true);
  assert.equal(liveCritical.percentOfThreshold, 120);
});

test('mergeCrowdTileDetections deduplicates sliced close-up foreground presenter while keeping background exhibition visitors', () => {
  const mixedExhibitionScene: DetectedPersonBox[] = [
    // Close-up presenter in front of booth (large box, area ~340k)
    { label: 'Person', box_2d: [120, 260, 960, 680], confidence: 91 },
    // Seam-sliced half of the same close-up presenter from Pass 2 quadrant tile (must collapse into presenter!)
    { label: 'Person', box_2d: [160, 275, 920, 560], confidence: 74 },
    // Distinct smaller visitor standing behind-left
    { label: 'Person', box_2d: [220, 50, 640, 230], confidence: 58 },
    // Distinct smaller visitor standing behind-right
    { label: 'Person', box_2d: [240, 710, 650, 880], confidence: 55 },
    // Distant visitor in back-center behind shoulder (small area ratio < 0.28 -> kept!)
    { label: 'Person', box_2d: [170, 520, 410, 635], confidence: 46 },
  ];

  const merged = mergeCrowdTileDetections(mixedExhibitionScene, 22);
  assert.equal(merged.length, 4, `Expected 4 unique people (1 presenter + 3 visitors), got ${merged.length}`);

  // Deep crowd grid activates even with a close-up foreground presenter if quad tiles see >= 6 people
  assert.equal(
    shouldEngageDeepCrowdGrid(
      [mixedExhibitionScene[0]],
      Array.from({ length: 6 }, (_, i) => ({
        label: 'Person',
        box_2d: [220, 60 + i * 140, 560, 170 + i * 140] as [number, number, number, number],
        confidence: 52,
      })),
      true
    ),
    true
  );
});

test('evaluateCrowdCrushRisk accounts for room floor area (m²): big room stays SAFE with many spread-out people while small room or localized bottleneck triggers CRITICAL CRUSH RISK', () => {
  // 1. 40 people spread out across a big 200 m² exhibition hall (0.20 p/m²) -> SAFE even if demo threshold was 15!
  const spreadOutInBigHall: DetectedPersonBox[] = Array.from({ length: 40 }, (_, idx) => {
    const row = Math.floor(idx / 8);
    const col = idx % 8;
    const ymin = 40 + row * 185;
    const xmin = 30 + col * 118;
    return {
      label: 'Person',
      box_2d: [ymin, xmin, ymin + 120, xmin + 80] as [number, number, number, number],
      confidence: 70,
    };
  });
  const bigRoomRisk = evaluateCrowdCrushRisk(40, 15, {
    roomAreaSqm: 200,
    detectedPeople: spreadOutInBigHall,
  });
  assert.equal(bigRoomRisk.status, 'SAFE');
  assert.equal(bigRoomRisk.exceeded, false);
  assert.equal(bigRoomRisk.densityPerSqm, 0.2);
  assert.equal(bigRoomRisk.effectiveCapacity, 400);
  assert.equal(bigRoomRisk.isLocalizedBottleneck, false);

  // 2. 30 people packed into a small 15 m² corridor (2.00 p/m²) -> CRITICAL CRUSH RISK!
  const smallRoomRisk = evaluateCrowdCrushRisk(30, 30, { roomAreaSqm: 15 });
  assert.equal(smallRoomRisk.status, 'CRITICAL CRUSH RISK');
  assert.equal(smallRoomRisk.exceeded, true);
  assert.equal(smallRoomRisk.densityPerSqm, 2.0);

  // 3. 60 people in a medium 50 m² classroom (1.20 p/m²) -> ELEVATED
  const mediumElevated = evaluateCrowdCrushRisk(60, 15, { roomAreaSqm: 50 });
  assert.equal(mediumElevated.status, 'ELEVATED');
  assert.equal(mediumElevated.exceeded, false);
  assert.equal(mediumElevated.densityPerSqm, 1.2);

  // 4. Localized exit-gate bottleneck: 12 people jammed shoulder-to-shoulder into one corner (< 35% of frame)
  //    even inside a huge 250 m² atrium -> CRITICAL CRUSH RISK via isLocalizedBottleneck!
  const jammedAtExitDoor: DetectedPersonBox[] = Array.from({ length: 12 }, (_, idx) => {
    const row = Math.floor(idx / 4);
    const col = idx % 4;
    const ymin = 300 + row * 60;
    const xmin = 650 + col * 55;
    return {
      label: 'Person',
      box_2d: [ymin, xmin, ymin + 90, xmin + 50] as [number, number, number, number],
      confidence: 65,
    };
  });
  const bottleneckRisk = evaluateCrowdCrushRisk(12, 30, {
    roomAreaSqm: 250,
    detectedPeople: jammedAtExitDoor,
  });
  assert.equal(bottleneckRisk.status, 'CRITICAL CRUSH RISK');
  assert.equal(bottleneckRisk.exceeded, true);
  assert.equal(bottleneckRisk.isLocalizedBottleneck, true);
  assert.ok((bottleneckRisk.bottleneckClusterCount ?? 0) >= 10);
});

test('mergeCrowdTileDetections never double-counts an outstretched or raised hand as a 2nd person while keeping 2 real close-up people distinct', () => {
  const soloUser: DetectedPersonBox = {
    label: 'Person (center)',
    box_2d: [110, 260, 980, 740],
    confidence: 90,
  };

  // 1. Hand/arm held out to the left at chest/shoulder height (weak limb box touching side of body) -> strictly 1 person
  const outstretchedHand: DetectedPersonBox = {
    label: 'Person (left)',
    box_2d: [360, 40, 820, 320],
    confidence: 48,
  };
  assert.equal(mergeCrowdTileDetections([soloUser, outstretchedHand], 22).length, 1);

  // 2. Hand raised directly in front of camera/chest -> strictly 1 person
  const handInFront: DetectedPersonBox = {
    label: 'Person (center)',
    box_2d: [280, 180, 840, 560],
    confidence: 55,
  };
  assert.equal(mergeCrowdTileDetections([soloUser, handInFront], 22).length, 1);

  // 3. Hand raised high waving next to ear/head connected to shoulder -> strictly 1 person
  const highWavingHand: DetectedPersonBox = {
    label: 'Person (left)',
    box_2d: [155, 70, 720, 310],
    confidence: 46,
  };
  assert.equal(mergeCrowdTileDetections([soloUser, highWavingHand], 22).length, 1);

  // 4. Arm movement causing COCO-SSD to emit a shifted overlapping split box -> strictly 1 person
  const shiftedSplitBox: DetectedPersonBox = {
    label: 'Person (right)',
    box_2d: [180, 440, 960, 890],
    confidence: 54,
  };
  assert.equal(mergeCrowdTileDetections([soloUser, shiftedSplitBox], 22).length, 1);

  // 5. Two REAL close-up people standing side-by-side -> MUST stay 2 people!
  const realPair: DetectedPersonBox[] = [
    { label: 'Person (left)', box_2d: [120, 70, 980, 510], confidence: 88 },
    { label: 'Person (right)', box_2d: [140, 460, 980, 910], confidence: 85 },
  ];
  assert.equal(mergeCrowdTileDetections(realPair, 22).length, 2);

  // 6. Close-up adult + real shorter child standing right beside them (real head/face -> high confidence) -> MUST stay 2 people!
  const adultAndChild: DetectedPersonBox[] = [
    soloUser,
    { label: 'Person (left)', box_2d: [360, 30, 960, 280], confidence: 82 },
  ];
  assert.equal(mergeCrowdTileDetections(adultAndChild, 22).length, 2);
});

test('mergeCrowdTileDetections & mapTilePredictionToFullFrame never split 1 close-up person vertically across 2x2 tile seams into 2 people', () => {
  // Exact geometry from close-up webcam 2x2 tile seam split:
  // Top-right tile head slice (76%) + bottom-right tile torso/glasses slice (81%)
  const topHalfSlice: DetectedPersonBox = {
    label: 'Person (right)',
    box_2d: [188, 438, 555, 990],
    confidence: 76,
  };
  const bottomHalfSlice: DetectedPersonBox = {
    label: 'Person (right)',
    box_2d: [415, 438, 1000, 965],
    confidence: 81,
  };

  // 1. Even with ONLY the two tile halves (if Pass 1 missed), they MUST collapse & stitch into 1 complete person!
  const stitched = mergeCrowdTileDetections([bottomHalfSlice, topHalfSlice], 22);
  assert.equal(stitched.length, 1, `Expected 1 stitched person, got ${stitched.length}`);
  assert.equal(stitched[0].box_2d[0], 188, 'Stitched box must preserve top of head');
  assert.equal(stitched[0].box_2d[2], 1000, 'Stitched box must preserve shoulders/bottom');

  // 2. If Pass 1 full-frame scored slightly lower (70%) than bottom tile (81%), still 1 complete full-body person!
  const fullFrameLowerConf: DetectedPersonBox = {
    label: 'Person (right)',
    box_2d: [180, 440, 1000, 980],
    confidence: 70,
  };
  const mergedWithFull = mergeCrowdTileDetections(
    [fullFrameLowerConf, bottomHalfSlice, topHalfSlice],
    22
  );
  assert.equal(mergedWithFull.length, 1);
  assert.ok(mergedWithFull[0].box_2d[0] <= 188 && mergedWithFull[0].box_2d[2] >= 995);

  // 3. mapTilePredictionToFullFrame directly rejects wide forehead slices slammed against interior horizontal seam
  const quad = buildOverlappingTileGrid(2, 2, 0.22);
  const topRightTile = quad.find((t) => t.col === 1 && t.row === 0)!;
  const wideHeadStrip = mapTilePredictionToFullFrame(
    [2, 100, 294, 198], // relW=0.98, relYMax=0.993 (interior bottom seam!), aspect=1.48
    76,
    300,
    300,
    topRightTile,
    22
  );
  assert.equal(wideHeadStrip, null);
});

test('mergeCrowdTileDetections splits giant multi-person wrappers into 2 real people while stitching horizontal 2x2 seam splits into 1', () => {
  // 1. Giant Pass-1 group box spanning 2 real side-by-side people + Pass-2 unclipped individual detections -> MUST yield 2 people!
  const giantGroupWrapper: TileCandidateBox = {
    label: 'Person (center)',
    box_2d: [140, 120, 960, 880],
    confidence: 78,
    tileMeta: { sourcePass: 'full' },
  };
  const personLeft: TileCandidateBox = {
    label: 'Person (left)',
    box_2d: [150, 130, 950, 480],
    confidence: 72,
    tileMeta: { sourcePass: 'quad', col: 0, row: 0, clippedLeft: false, clippedRight: false },
  };
  const personRight: TileCandidateBox = {
    label: 'Person (right)',
    box_2d: [160, 490, 950, 860],
    confidence: 70,
    tileMeta: { sourcePass: 'quad', col: 1, row: 0, clippedLeft: false, clippedRight: false },
  };
  const splitTwo = mergeCrowdTileDetections([giantGroupWrapper, personLeft, personRight], 22);
  assert.equal(splitTwo.length, 2, `Expected 2 distinct people after splitting composite wrapper, got ${splitTwo.length}`);

  // 2. One centered person sliced horizontally across the 2x2 left/right seam (col=0 clipped right + col=1 clipped left) -> strictly 1 stitched person!
  const leftSeamHalf: TileCandidateBox = {
    label: 'Person (center)',
    box_2d: [140, 240, 960, 560],
    confidence: 68,
    tileMeta: { sourcePass: 'quad', col: 0, row: 0, cols: 2, rows: 2, clippedRight: true },
  };
  const rightSeamHalf: TileCandidateBox = {
    label: 'Person (center)',
    box_2d: [150, 440, 955, 760],
    confidence: 66,
    tileMeta: { sourcePass: 'quad', col: 1, row: 0, cols: 2, rows: 2, clippedLeft: true },
  };
  const stitchedHorizontal = mergeCrowdTileDetections([leftSeamHalf, rightSeamHalf], 22);
  assert.equal(stitchedHorizontal.length, 1, `Expected 1 horizontally stitched person, got ${stitchedHorizontal.length}`);
  assert.equal(stitchedHorizontal[0].box_2d[1], 240);
  assert.equal(stitchedHorizontal[0].box_2d[3], 760);

  // 3. Hand held right in front of face/chest lowering body confidence (68% body + 60% hand) -> strictly 1 person!
  const bodyPartiallyCovered: TileCandidateBox = {
    label: 'Person (center)',
    box_2d: [120, 250, 970, 750],
    confidence: 68,
    tileMeta: { sourcePass: 'full' },
  };
  const handOverChest: TileCandidateBox = {
    label: 'Person (center)',
    box_2d: [310, 330, 690, 650],
    confidence: 60,
    tileMeta: { sourcePass: 'quad' },
  };
  assert.equal(mergeCrowdTileDetections([bodyPartiallyCovered, handOverChest], 22).length, 1);

  // 4. Offset front-and-back real people stay 2 people (not merged by wide centerDy)
  const frontPerson: TileCandidateBox = {
    label: 'Person (center)',
    box_2d: [220, 280, 960, 600],
    confidence: 86,
  };
  const backPerson: TileCandidateBox = {
    label: 'Person (center)',
    box_2d: [90, 380, 620, 590],
    confidence: 74,
  };
  assert.equal(mergeCrowdTileDetections([frontPerson, backPerson], 22).length, 2);
});

test('filterEmptyRoomMovementPhantoms suppresses isolated weak large blobs while preserving genuine distant crowd figures', () => {
  // 1. Empty room where a curtain/chair shift triggers 1 weak large quad blob (conf 34%, h=420) -> 0 people!
  const emptyRoomPhantom: TileCandidateBox[] = [
    { label: 'Person (left)', box_2d: [220, 80, 640, 310], confidence: 34, tileMeta: { sourcePass: 'quad' } },
  ];
  assert.equal(filterEmptyRoomMovementPhantoms([], emptyRoomPhantom, false).length, 0);

  // 2. Genuine distant crowd photo where Pass 1 saw 0 people but Pass 2 sees small distant figures (h=180) -> preserved!
  const distantSmallPeople: TileCandidateBox[] = [
    { label: 'Person (left)', box_2d: [320, 120, 500, 200], confidence: 32, tileMeta: { sourcePass: 'quad' } },
    { label: 'Person (right)', box_2d: [330, 620, 510, 700], confidence: 35, tileMeta: { sourcePass: 'quad' } },
  ];
  assert.equal(filterEmptyRoomMovementPhantoms([], distantSmallPeople, false).length, 2);
});

test('fast hand movement never double-counts 1 person as 2 across blurred face, seam-sliced tiles, or 1-frame swipe flashes', () => {
  // 1. Fast hand waved out to the left while face temporarily blurs down to 56% -> strictly 1 person
  const blurredSoloPerson: TileCandidateBox = {
    label: 'Person (center)',
    box_2d: [180, 440, 990, 960],
    confidence: 56,
    tileMeta: { sourcePass: 'full' },
  };
  const fastWavingHandLeft: TileCandidateBox = {
    label: 'Person (left)',
    box_2d: [420, 140, 740, 385],
    confidence: 54,
    tileMeta: { sourcePass: 'quad' },
  };
  assert.equal(mergeCrowdTileDetections([blurredSoloPerson, fastWavingHandLeft], 22).length, 1);

  // 2. Interior-seam-clipped 2x2 left tile catching a waving arm + shoulder slice next to Pass-1 person -> strictly 1 person
  const fullFrameUser: TileCandidateBox = {
    label: 'Person (right)',
    box_2d: [180, 420, 990, 960],
    confidence: 82,
    tileMeta: { sourcePass: 'full' },
  };
  const seamSlicedArm: TileCandidateBox = {
    label: 'Person (left)',
    box_2d: [250, 140, 950, 608],
    confidence: 66,
    tileMeta: {
      sourcePass: 'quad',
      row: 0,
      col: 0,
      clippedRight: true,
    },
  };
  assert.equal(mergeCrowdTileDetections([fullFrameUser, seamSlicedArm], 22).length, 1);

  // 3. Temporal guard in stepPersonTracker: 1-frame fast-hand motion-blur flash (68%) next to confirmed person
  //    stays 1 person, while a real second person present for 2 consecutive frames confirms cleanly as 2 people!
  let tracker: PersonTrackerState = { confirmed: [], pending: [] };
  const soloBody: DetectedPersonBox = {
    label: 'Person (center)',
    box_2d: [180, 460, 990, 960],
    confidence: 84,
  };
  const step1 = stepPersonTracker(tracker, [soloBody], { instantConfidence: 76, minConfidence: 26 });
  tracker = step1.nextState;
  assert.equal(step1.people.length, 1);

  const oneFrameFastHandFlash: DetectedPersonBox = {
    label: 'Person (left)',
    box_2d: [210, 180, 820, 400],
    confidence: 68,
  };
  const step2 = stepPersonTracker(tracker, [soloBody, oneFrameFastHandFlash], {
    instantConfidence: 76,
    minConfidence: 26,
  });
  tracker = step2.nextState;
  assert.equal(
    step2.people.length,
    1,
    'A single-frame 68% motion-blur hand flash beside a close-up person must NOT jump count to 2'
  );

  // Hand stops / vanishes next frame -> remains 1 person
  const step3 = stepPersonTracker(tracker, [soloBody], { instantConfidence: 76, minConfidence: 26 });
  tracker = step3.nextState;
  assert.equal(step3.people.length, 1);

  // Real 2nd person walks in and stays for 2 frames at 68% -> confirms cleanly as 2 people!
  const realSecondPerson: DetectedPersonBox = {
    label: 'Person (left)',
    box_2d: [170, 90, 920, 360],
    confidence: 68,
  };
  const step4 = stepPersonTracker(tracker, [soloBody, realSecondPerson], {
    instantConfidence: 76,
    minConfidence: 26,
  });
  tracker = step4.nextState;
  assert.equal(step4.people.length, 1);

  const step5 = stepPersonTracker(tracker, [soloBody, realSecondPerson], {
    instantConfidence: 76,
    minConfidence: 26,
  });
  assert.equal(step5.people.length, 2, 'A real 2nd person present for 2 consecutive frames must confirm cleanly');
});

test('Phase 1 Stampede Risk Meter progresses NORMAL -> BOTTLENECK WARNING -> CRITICAL STAMPEDE RISK and triggers on sudden nose-trail panic velocity spikes', () => {
  const normal = evaluateCrowdCrushRisk(4, 15, { maxTrailVelocityNormPerSec: 30 });
  assert.equal(normal.disasterRiskLabel, 'NORMAL');
  assert.equal(normal.panicVelocitySpike, false);
  assert.equal(normal.exceeded, false);

  const bottleneck = evaluateCrowdCrushRisk(11, 15, { maxTrailVelocityNormPerSec: 40 });
  assert.equal(bottleneck.disasterRiskLabel, 'BOTTLENECK WARNING');
  assert.equal(bottleneck.exceeded, false);

  const criticalByCount = evaluateCrowdCrushRisk(16, 15, { maxTrailVelocityNormPerSec: 25 });
  assert.equal(criticalByCount.disasterRiskLabel, 'CRITICAL STAMPEDE RISK');
  assert.equal(criticalByCount.exceeded, true);

  // Even below static headcount limit, sudden multi-person nose-trail panic velocity spike triggers CRITICAL STAMPEDE RISK!
  const criticalByPanicVelocity = evaluateCrowdCrushRisk(3, 15, {
    maxTrailVelocityNormPerSec: 310,
  });
  assert.equal(criticalByPanicVelocity.disasterRiskLabel, 'CRITICAL STAMPEDE RISK');
  assert.equal(criticalByPanicVelocity.panicVelocitySpike, true);
  assert.equal(criticalByPanicVelocity.exceeded, true);
  assert.equal(criticalByPanicVelocity.peakTrailVelocity, 310);
});





