import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMobileLayoutState } from './mobileLayout';

test('computeMobileLayoutState detects mobile portrait with bottom tab bar', () => {
  const portrait = computeMobileLayoutState({ width: 390, height: 844, manualLandscape: false });
  assert.equal(portrait.isMobileWidth, true);
  assert.equal(portrait.isPhysicalLandscape, false);
  assert.equal(portrait.isMobileLandscape, false);
  assert.equal(portrait.showBottomTabBar, true);
  assert.equal(portrait.preferredWallColumns, 1);
});

test('computeMobileLayoutState detects physical mobile landscape and hides bottom tab bar', () => {
  const landscape = computeMobileLayoutState({ width: 844, height: 390, manualLandscape: false });
  assert.equal(landscape.isPhysicalLandscape, true);
  assert.equal(landscape.isMobileLandscape, true);
  assert.equal(landscape.showBottomTabBar, false);
  assert.equal(landscape.preferredWallColumns, 2);
});

test('computeMobileLayoutState honors manual landscape toggle on portrait phone without affecting desktop', () => {
  const manualOnPhone = computeMobileLayoutState({ width: 390, height: 844, manualLandscape: true });
  assert.equal(manualOnPhone.isMobileLandscape, true);
  assert.equal(manualOnPhone.showBottomTabBar, false);
  assert.equal(manualOnPhone.preferredWallColumns, 2);

  const desktop = computeMobileLayoutState({ width: 1440, height: 900, manualLandscape: true });
  assert.equal(desktop.isMobileWidth, false);
  assert.equal(desktop.isMobileLandscape, false);
  assert.equal(desktop.showBottomTabBar, false);
});
