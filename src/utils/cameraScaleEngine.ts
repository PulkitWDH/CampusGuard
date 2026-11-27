import type { ClassroomCamera } from '../types';

export const MAX_SUPPORTED_CAMERAS = 500;
export const MAX_CONCURRENT_CLOUD_SCANS = 2;
export const MAX_CONCURRENT_STREAM_RECONNECTS = 3;

export type WallLayoutMode = '1x1' | '2x2' | '3x3' | '4x4';
export type WallFilterMode = 'all' | 'alerts';

export interface AdaptiveRenderProfile {
  /** Target canvas pixel width (always 16:9 paired with targetHeight) */
  targetWidth: number;
  /** Target canvas pixel height */
  targetHeight: number;
  /** Target display draw FPS to cap GPU/CPU load across multi-cam walls */
  targetFps: number;
  /** Minimum interval between on-device COCO-SSD inference requests for this card */
  inferenceIntervalMs: number;
  /** Rolling DVR snapshot cadence */
  dvrIntervalMs: number;
  /** Whether to run multi-tile secondary crops in COCO-SSD */
  enableMultiTileScan: boolean;
  /** Whether Auto-PTZ inset crop is rendered (disable on ultra-dense 4x4 grids to save GPU) */
  allowAutoPtzInset: boolean;
}

export function getWallPageSize(layout: WallLayoutMode): number {
  switch (layout) {
    case '1x1':
      return 1;
    case '2x2':
      return 4;
    case '3x3':
      return 9;
    case '4x4':
      return 16;
    default:
      return 4;
  }
}

/**
 * Computes GPU-safe resolution, FPS, and AI scheduling cadence based on how many
 * camera canvases are simultaneously visible on screen.
 * - 1 camera (or focused): Native Full HD 1920x1080 @ 60fps
 * - 2–4 cameras (2x2):     HD 1280x720 @ 30fps
 * - 5–9 cameras (3x3):     960x540 @ 20fps
 * - 10–16 cameras (4x4):   640x360 @ 15fps
 * Caps total VRAM below ~35 MB even when 500 cameras are registered in the workspace.
 */
export function getAdaptiveRenderProfile(
  visibleCameraCount: number,
  isFocused: boolean,
  sourceWidth = 1280,
  devicePixelRatio = 1
): AdaptiveRenderProfile {
  const effectiveVisible = isFocused ? 1 : Math.max(1, visibleCameraCount);
  const clampedDpr = Math.min(2, Math.max(1, devicePixelRatio || 1));

  if (effectiveVisible <= 1) {
    const wantFullHd = sourceWidth >= 1400 || clampedDpr >= 1.5;
    return {
      targetWidth: wantFullHd ? 1920 : 1280,
      targetHeight: wantFullHd ? 1080 : 720,
      targetFps: 60,
      inferenceIntervalMs: 180,
      dvrIntervalMs: 1000,
      enableMultiTileScan: true,
      allowAutoPtzInset: true,
    };
  }

  if (effectiveVisible <= 4) {
    return {
      targetWidth: 1280,
      targetHeight: 720,
      targetFps: 30,
      inferenceIntervalMs: 320,
      dvrIntervalMs: 1500,
      enableMultiTileScan: true,
      allowAutoPtzInset: true,
    };
  }

  if (effectiveVisible <= 9) {
    return {
      targetWidth: 960,
      targetHeight: 540,
      targetFps: 20,
      inferenceIntervalMs: 550,
      dvrIntervalMs: 2200,
      enableMultiTileScan: false,
      allowAutoPtzInset: false,
    };
  }

  return {
    targetWidth: 640,
    targetHeight: 360,
    targetFps: 15,
    inferenceIntervalMs: 850,
    dvrIntervalMs: 3000,
    enableMultiTileScan: false,
    allowAutoPtzInset: false,
  };
}

export interface PaginateCamerasOptions {
  page: number;
  layout: WallLayoutMode;
  searchQuery?: string;
  filterMode?: WallFilterMode;
  prioritizeAlerts?: boolean;
}

export interface PaginatedCamerasResult {
  pageCameras: ClassroomCamera[];
  matchedCameras: ClassroomCamera[];
  totalCameras: number;
  totalMatched: number;
  pageSize: number;
  totalPages: number;
  currentPage: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Filters, optionally alert-prioritizes, and paginates up to 500+ cameras in O(N) time
 * so the DOM only ever mounts the active matrix page (1 to 16 cameras).
 */
export function paginateCameras(
  cameras: ClassroomCamera[],
  options: PaginateCamerasOptions
): PaginatedCamerasResult {
  const pageSize = getWallPageSize(options.layout);
  const query = (options.searchQuery || '').trim().toLowerCase();
  const filterMode = options.filterMode ?? 'all';

  let matched = cameras;
  if (filterMode === 'alerts' || query.length > 0) {
    matched = cameras.filter((cam) => {
      if (filterMode === 'alerts' && cam.status !== 'fighting' && cam.status !== 'warning') {
        return false;
      }
      if (query.length > 0) {
        const hay = `${cam.classroomName} ${cam.cameraCode} ${cam.bluetoothDeviceName}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }

  // Optionally bubble active alarms (fighting -> warning -> normal) to page 1 for instant triage
  let ordered = matched;
  if (options.prioritizeAlerts && matched.length > pageSize) {
    const hasAnyAlert = matched.some((c) => c.status === 'fighting' || c.status === 'warning');
    if (hasAnyAlert) {
      const rank = (s: ClassroomCamera['status']) => (s === 'fighting' ? 0 : s === 'warning' ? 1 : 2);
      ordered = [...matched].sort((a, b) => rank(a.status) - rank(b.status));
    }
  }

  const totalMatched = ordered.length;
  const totalPages = Math.max(1, Math.ceil(totalMatched / pageSize));
  const currentPage = Math.max(1, Math.min(totalPages, Math.floor(options.page || 1)));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(totalMatched, startIndex + pageSize);
  const pageCameras = ordered.slice(startIndex, endIndex);

  return {
    pageCameras,
    matchedCameras: ordered,
    totalCameras: cameras.length,
    totalMatched,
    pageSize,
    totalPages,
    currentPage,
    startIndex,
    endIndex,
  };
}

/**
 * Strips heavy transient per-frame payloads (bounding box arrays, uploaded blob URLs,
 * and live error banners) before saving to localStorage so 500 cameras stay compact
 * (< 250 KB, well under the 5 MB browser localStorage quota) and serialize rapidly.
 */
export function stripCamerasForStorage(cameras: ClassroomCamera[]): ClassroomCamera[] {
  return cameras
    .slice(0, MAX_SUPPORTED_CAMERAS)
    .filter((cam) => cam.sourceKind !== 'uploaded-media')
    .map((cam) => ({
      ...cam,
      isAnalyzing: false,
      errorMessage: undefined,
      liveTranscript: '',
      audioLevel: 0,
      lastAnalysis: null,
    }));
}

interface ScheduledInferenceTask {
  cameraId: string;
  priority: number; // lower number = higher priority (0 = critical/focused, 1 = visible, 2 = background)
  enqueuedAt: number;
  run: () => Promise<void>;
  resolve: () => void;
}

/**
 * Cooperative priority round-robin scheduler for on-device TensorFlow / COCO-SSD inference.
 * Guarantees at most `maxConcurrency` (default 1) neural network pass runs at a time,
 * drops stale superseded requests for the same camera (coalescing), prioritizes active alarms,
 * and rotates fairly across visible cameras so the UI stays smooth at 60 FPS even with 500 cameras.
 */
export class InferenceScheduler {
  private readonly maxConcurrency: number;
  private readonly yieldBetweenMs: number;
  private activeCount = 0;
  private pendingByCamera = new Map<string, ScheduledInferenceTask>();
  private lastServedOrder = new Map<string, number>();
  private serveCounter = 0;

  constructor(options?: { maxConcurrency?: number; yieldBetweenMs?: number }) {
    this.maxConcurrency = Math.max(1, options?.maxConcurrency ?? 1);
    this.yieldBetweenMs = Math.max(0, options?.yieldBetweenMs ?? 8);
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getPendingCount(): number {
    return this.pendingByCamera.size;
  }

  /**
   * Enqueues a camera inference job. If a job for the same camera is already waiting,
   * the older waiting job is skipped immediately so queues never grow unbounded.
   */
  schedule(cameraId: string, priority: number, work: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      const existing = this.pendingByCamera.get(cameraId);
      if (existing) {
        existing.resolve();
      }
      this.pendingByCamera.set(cameraId, {
        cameraId,
        priority,
        enqueuedAt: Date.now(),
        run: work,
        resolve,
      });
      this.pump();
    });
  }

  cancel(cameraId: string): void {
    const existing = this.pendingByCamera.get(cameraId);
    if (existing) {
      this.pendingByCamera.delete(cameraId);
      existing.resolve();
    }
  }

  private pickNextTask(): ScheduledInferenceTask | null {
    let best: ScheduledInferenceTask | null = null;
    for (const task of this.pendingByCamera.values()) {
      if (!best) {
        best = task;
        continue;
      }
      if (task.priority < best.priority) {
        best = task;
        continue;
      }
      if (task.priority === best.priority) {
        const lastTask = this.lastServedOrder.get(task.cameraId) ?? -1;
        const lastBest = this.lastServedOrder.get(best.cameraId) ?? -1;
        if (lastTask < lastBest) {
          best = task;
        }
      }
    }
    return best;
  }

  private pump(): void {
    while (this.activeCount < this.maxConcurrency && this.pendingByCamera.size > 0) {
      const next = this.pickNextTask();
      if (!next) break;
      this.pendingByCamera.delete(next.cameraId);
      this.activeCount += 1;
      this.serveCounter += 1;
      this.lastServedOrder.set(next.cameraId, this.serveCounter);

      void (async () => {
        try {
          await next.run();
        } catch {
          // Caller handles errors internally
        } finally {
          this.activeCount -= 1;
          next.resolve();
          if (this.pendingByCamera.size > 0) {
            if (this.yieldBetweenMs > 0) {
              setTimeout(() => this.pump(), this.yieldBetweenMs);
            } else {
              this.pump();
            }
          }
        }
      })();
    }
  }
}

export const globalEdgeInferenceScheduler = new InferenceScheduler({
  maxConcurrency: 1,
  yieldBetweenMs: 12,
});
