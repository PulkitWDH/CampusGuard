import assert from 'node:assert/strict';
import test from 'node:test';
import type { DetectedPersonBox } from '../types';
import {
  buildOverlappingTileGrid,
  mapTilePredictionToFullFrame,
  mergeCrowdTileDetections,
  shouldEngageDeepCrowdGrid,
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
