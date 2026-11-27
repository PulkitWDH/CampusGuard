export interface MobileViewportInput {
  width: number;
  height: number;
  manualLandscape: boolean;
}

export interface MobileLayoutState {
  isMobileWidth: boolean;
  isPhysicalLandscape: boolean;
  isMobileLandscape: boolean;
  showBottomTabBar: boolean;
  preferredWallColumns: 1 | 2;
}

/**
 * Computes responsive mobile portrait vs mobile landscape layout mode.
 * Works both when the user physically rotates a smartphone (e.g., 844x390)
 * and when the user taps the manual "Landscape" toggle on mobile.
 */
export function computeMobileLayoutState(input: MobileViewportInput): MobileLayoutState {
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));
  const isMobileWidth = width < 768;
  const isTouchSized = Math.min(width, height) <= 560 && Math.max(width, height) <= 1024;
  const isPhysicalLandscape = width > height && isTouchSized;
  const isMobileLandscape = isPhysicalLandscape || (input.manualLandscape && (isMobileWidth || isTouchSized));
  const showBottomTabBar = isMobileWidth && !isMobileLandscape;
  const preferredWallColumns: 1 | 2 = isMobileLandscape ? 2 : 1;

  return {
    isMobileWidth,
    isPhysicalLandscape,
    isMobileLandscape,
    showBottomTabBar,
    preferredWallColumns,
  };
}

/**
 * Best-effort hardware landscape orientation lock (supported on Android Chrome / PWAs).
 * Always degrades gracefully on iOS Safari and desktop browsers without throwing.
 */
export async function requestDeviceLandscapeLock(enable: boolean): Promise<'locked' | 'unlocked' | 'css-fallback'> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 'css-fallback';
  }
  const orientation = window.screen?.orientation as
    | (ScreenOrientation & { lock?: (mode: string) => Promise<void>; unlock?: () => void })
    | undefined;

  if (enable) {
    try {
      const rootEl = document.documentElement;
      if (!document.fullscreenElement && typeof rootEl.requestFullscreen === 'function') {
        await rootEl.requestFullscreen().catch(() => {});
      }
      if (orientation && typeof orientation.lock === 'function') {
        await orientation.lock('landscape');
        return 'locked';
      }
    } catch {
      // iOS Safari & desktop browsers restrict orientation.lock; CSS landscape stage still activates
    }
    return 'css-fallback';
  }

  try {
    if (orientation && typeof orientation.unlock === 'function') {
      orientation.unlock();
    }
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen().catch(() => {});
    }
    return 'unlocked';
  } catch {
    return 'css-fallback';
  }
}
