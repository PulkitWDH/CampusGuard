import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Flame,
  Focus,
  FolderOpen,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  RefreshCw,
  Route,
  ScanSearch,
  ShieldAlert,
  Trash2,
  UserPlus,
  Video,
} from 'lucide-react';
import type {
  AiEngineModel,
  AppearanceSignature,
  ClassroomAnalysis,
  ClassroomCamera,
  DetectedObjectBox,
  DetectedPersonBox,
  DvrEvidenceFrame,
  FacilityMode,
  PerimeterZone,
  ThreatSensitivity,
  TrackedSubject,
  WatchlistSubject,
} from '../types';
import { captureCanvasJpegBase64 } from '../utils/mediaCapture';
import {
  detectPeopleLocallyOnCanvas,
  ensureLocalPersonDetector,
  getLocalDetectorStatus,
} from '../utils/localPersonDetector';
import {
  DEFAULT_DB_CALIBRATION_OFFSET,
  INSTANT_CHANGE_THRESHOLD_PERCENT,
  SOUND_ALERT_SUSTAINED_MS,
  SOUND_ALERT_THRESHOLD_DB,
  type ContainDrawRect,
  type EdgeThreatTrackerState,
  type PersonTrackerState,
  type SpeechResultLike,
  computeAspectPreservingSize,
  computeContainDrawRect,
  computeFrameDeltaPercent,
  computeSplDecibels,
  createInitialEdgeThreatState,
  evaluateRealtimeEdgeThreat,
  extractLatestSpeechUtterance,
  formatAiModelLabel,
  formatFacilityLabels,
  mapNormalizedBoxToRect,
  shouldTriggerInstantContinuousScan,
  stepPersonTracker,
} from '../utils/monitoringLogic';
import {
  HEATMAP_COLS,
  HEATMAP_ROWS,
  createActivityHeatmap,
  detectPerimeterBreaches,
  mapIronbowColor,
  normalizeDragToPerimeterZone,
  pushRollingDvrFrame,
  updateActivityHeatmap,
} from '../utils/tacticalForensics';
import {
  type PtzViewportRect,
  computeSmoothPtzViewport,
  extractAppearanceSignature,
  matchSubjectsToWatchlist,
  updateTrackedSubjects,
} from '../utils/subjectIntelligence';

export interface CameraFramePayload {
  frameBase64: string;
  previousFrameBase64?: string;
  previewDataUrl?: string;
  liveMotionPercent?: number;
  detectedObjects?: DetectedObjectBox[];
}

export interface RealtimeThreatEvent {
  analysis: ClassroomAnalysis | null;
  shouldEmitAlert: boolean;
  shouldClearThreat: boolean;
  previewDataUrl?: string;
}

export interface DvrBundleSnapshot {
  frames: DvrEvidenceFrame[];
  videoClipUrl?: string;
  videoClipMimeType?: string;
}

interface CameraFeedCardProps {
  camera: ClassroomCamera;
  facilityMode: FacilityMode;
  threatSensitivity: ThreatSensitivity;
  defaultAiModel: AiEngineModel;
  dbCalibrationOffset?: number;
  cloudQuotaExhausted?: boolean;
  isFocused: boolean;
  liveMediaStream?: MediaStream | null;
  watchlist?: WatchlistSubject[];
  onRegisterCapture: (cameraId: string, captureFn: (() => CameraFramePayload | null) | null) => void;
  onRegisterDvrProvider?: (
    cameraId: string,
    provider: (() => DvrBundleSnapshot) | null
  ) => void;
  onLocalPersonDetections: (
    cameraId: string,
    detectedPeople: DetectedPersonBox[],
    detectedObjects: DetectedObjectBox[]
  ) => void;
  onRealtimeEdgeThreat: (cameraId: string, event: RealtimeThreatEvent) => void;
  onPerimeterBreach?: (
    cameraId: string,
    breachingPeople: DetectedPersonBox[],
    zone: PerimeterZone,
    bundle: DvrBundleSnapshot
  ) => void;
  onManualLockEvidence?: (cameraId: string, bundle: DvrBundleSnapshot) => void;
  onEnrollLiveSubject?: (
    cameraId: string,
    payload: {
      label: string;
      thumbnailDataUrl: string;
      signature: AppearanceSignature;
    }
  ) => void;
  onWatchlistMatch?: (
    cameraId: string,
    payload: {
      watchlistItem: WatchlistSubject;
      subjectId: string;
      similarity: number;
      bundle: DvrBundleSnapshot;
    }
  ) => void;
  onReconnectStream: (cameraId: string) => void;
  onAnalyzeCamera: (cameraId: string, isAutoTrigger?: boolean) => void;
  onToggleVoiceListening: (cameraId: string) => void;
  onUpdateTranscript: (
    cameraId: string,
    transcript: string,
    audioLevel?: number,
    source?: 'speech' | 'audio-meter' | 'manual'
  ) => void;
  onUpdateCameraSettings: (
    cameraId: string,
    patch: Partial<
      Pick<
        ClassroomCamera,
        | 'aiModel'
        | 'autoAiEnabled'
        | 'expectedTotalCount'
        | 'ptzAutoTrackEnabled'
        | 'trailsEnabled'
        | 'heatmapEnabled'
        | 'perimeterZone'
      >
    >
  ) => void;
  onToggleFocus: (cameraId: string) => void;
  onRemoveCamera: (cameraId: string) => void;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  lang: string;
  onresult:
    | ((event: { resultIndex?: number; results: ArrayLike<SpeechResultLike> }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function CameraFeedCard({
  camera,
  facilityMode,
  threatSensitivity,
  defaultAiModel,
  dbCalibrationOffset = DEFAULT_DB_CALIBRATION_OFFSET,
  cloudQuotaExhausted = false,
  isFocused,
  liveMediaStream = null,
  watchlist = [],
  onRegisterCapture,
  onRegisterDvrProvider,
  onLocalPersonDetections,
  onRealtimeEdgeThreat,
  onPerimeterBreach,
  onManualLockEvidence,
  onEnrollLiveSubject,
  onWatchlistMatch,
  onReconnectStream,
  onAnalyzeCamera,
  onToggleVoiceListening,
  onUpdateTranscript,
  onUpdateCameraSettings,
  onToggleFocus,
  onRemoveCamera,
}: CameraFeedCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const hasLiveFrameRef = useRef(false);
  const [hasLiveSignal, setHasLiveSignal] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const micActiveRef = useRef(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [editingVoice, setEditingVoice] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState(camera.liveTranscript);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalDraft, setTotalDraft] = useState(
    typeof camera.expectedTotalCount === 'number' && camera.expectedTotalCount > 0
      ? String(camera.expectedTotalCount)
      : ''
  );
  const isAudioOnly = camera.sourceKind === 'microphone-only' || !camera.hasVideo;

  const [liveMotionPercent, setLiveMotionPercent] = useState(0);
  const [contactPairsCount, setContactPairsCount] = useState(0);
  const [scanModeLabel, setScanModeLabel] = useState(
    isAudioOnly ? 'Acoustic AI · Standby' : 'Edge AI · Loading model'
  );
  const [localEdgeState, setLocalEdgeState] = useState<'loading' | 'ready' | 'fallback'>(
    isAudioOnly ? 'fallback' : 'loading'
  );
  const [streamError, setStreamError] = useState<string | null>(null);

  const rawCaptureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDrawRectRef = useRef<ContainDrawRect>({ x: 0, y: 0, width: 640, height: 360 });
  const waveformBinsRef = useRef<number[]>(new Array<number>(48).fill(0.06));
  const lastScannedThumbRef = useRef<Uint8ClampedArray | null>(null);
  const prevEdgeThumbRef = useRef<Uint8ClampedArray | null>(null);
  const liveMotionPercentRef = useRef<number>(0);
  const lastScanFinishedAtRef = useRef<number>(0);
  const hasScannedOnceRef = useRef<boolean>(Boolean(camera.lastAnalysis));
  const localDetectInFlightRef = useRef<boolean>(false);
  const localEdgeReadyRef = useRef<boolean>(false);
  const localPeopleCountRef = useRef<number>(camera.studentCount);
  const lastLocalBoxSigRef = useRef<string>('__INIT__');
  const consecutiveEdgeErrorsRef = useRef<number>(0);
  const personTrackerStateRef = useRef<PersonTrackerState>({
    confirmed: [],
    pending: [],
  });
  const edgeThreatStateRef = useRef<EdgeThreatTrackerState>(createInitialEdgeThreatState());
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechRestartTimerRef = useRef<number | null>(null);
  const speechClearTimerRef = useRef<number | null>(null);
  const [loudHoldSeconds, setLoudHoldSeconds] = useState(0);
  const loudHoldStartRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const liveTranscriptRef = useRef(camera.liveTranscript);
  const audioLevelRef = useRef(camera.audioLevel);
  const voiceListeningRef = useRef(camera.voiceListeningEnabled);
  const isAnalyzingRef = useRef(camera.isAnalyzing);
  const detectedPeopleRef = useRef(camera.lastAnalysis?.detectedPeople ?? []);
  const detectedObjectsRef = useRef<DetectedObjectBox[]>(camera.lastAnalysis?.detectedObjects ?? []);
  const cameraStatusRef = useRef(camera.status);
  const threatCategoryRef = useRef(camera.lastAnalysis?.threatCategory ?? 'none');
  const cloudQuotaExhaustedRef = useRef(cloudQuotaExhausted);
  const facilityModeRef = useRef(facilityMode);
  const threatSensitivityRef = useRef(threatSensitivity);

  const onAnalyzeCameraRef = useRef(onAnalyzeCamera);
  const onLocalPersonDetectionsRef = useRef(onLocalPersonDetections);
  const onRealtimeEdgeThreatRef = useRef(onRealtimeEdgeThreat);
  const onUpdateTranscriptRef = useRef(onUpdateTranscript);
  const onPerimeterBreachRef = useRef(onPerimeterBreach);
  onPerimeterBreachRef.current = onPerimeterBreach;
  const onWatchlistMatchRef = useRef(onWatchlistMatch);
  onWatchlistMatchRef.current = onWatchlistMatch;
  const watchlistRef = useRef<WatchlistSubject[]>(watchlist);
  watchlistRef.current = watchlist;

  // Real-Time Subject Tracking, Auto-PTZ Zoom, Re-ID Watchlist, Heatmap, Perimeter & Black-Box Video DVR
  const ptzAutoTrackEnabled = camera.ptzAutoTrackEnabled ?? true;
  const trailsEnabled = camera.trailsEnabled ?? true;
  const heatmapEnabled = Boolean(camera.heatmapEnabled);
  const perimeterZone = camera.perimeterZone ?? null;
  const ptzAutoTrackEnabledRef = useRef<boolean>(ptzAutoTrackEnabled);
  const trailsEnabledRef = useRef<boolean>(trailsEnabled);
  const heatmapEnabledRef = useRef<boolean>(heatmapEnabled);
  const perimeterZoneRef = useRef<PerimeterZone | null>(perimeterZone);
  const perimeterBreachedRef = useRef<boolean>(false);
  const lastPerimeterAlertAtRef = useRef<number>(0);
  const [perimeterBreached, setPerimeterBreached] = useState(false);
  const [isDrawingZone, setIsDrawingZone] = useState(false);
  const dragStartPxRef = useRef<{ x: number; y: number } | null>(null);
  const dragCurrentPxRef = useRef<{ x: number; y: number } | null>(null);
  const heatmapGridRef = useRef<Float32Array>(createActivityHeatmap(HEATMAP_COLS, HEATMAP_ROWS));
  const dvrBufferRef = useRef<DvrEvidenceFrame[]>([]);
  const [dvrFrameCount, setDvrFrameCount] = useState(0);
  const [justLockedEvidence, setJustLockedEvidence] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);

  // Persistent Subject Tracker + Re-ID Signatures + Smooth Auto-PTZ Viewport
  const trackedSubjectsRef = useRef<TrackedSubject[]>([]);
  const nextSubjectNumericIdRef = useRef<number>(1);
  const subjectSignaturesRef = useRef<Record<string, AppearanceSignature>>({});
  const lastWatchlistAlertAtRef = useRef<Record<string, number>>({});
  const ptzViewportRef = useRef<PtzViewportRect | null>(null);
  const [lockedPtzSubjectId, setLockedPtzSubjectId] = useState<string | null>(null);
  const lockedPtzSubjectIdRef = useRef<string | null>(null);
  lockedPtzSubjectIdRef.current = lockedPtzSubjectId;
  const [liveTrackedSubjects, setLiveTrackedSubjects] = useState<TrackedSubject[]>([]);
  const lastTrackedUiSigRef = useRef<string>('');

  // Real MediaRecorder rolling WebM video clip state
  const currentVideoChunksRef = useRef<Blob[]>([]);
  const completedVideoBlobRef = useRef<Blob | null>(null);
  const activeVideoMimeRef = useRef<string>('video/webm');

  useEffect(() => {
    ptzAutoTrackEnabledRef.current = ptzAutoTrackEnabled;
    trailsEnabledRef.current = trailsEnabled;
    heatmapEnabledRef.current = heatmapEnabled;
    perimeterZoneRef.current = perimeterZone;
    if (!perimeterZone) {
      perimeterBreachedRef.current = false;
      setPerimeterBreached(false);
    }
  }, [heatmapEnabled, perimeterZone, ptzAutoTrackEnabled, trailsEnabled]);

  const captureAnnotatedDvrFrame = (): DvrEvidenceFrame | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    try {
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.62);
      return {
        capturedAt: new Date().toISOString(),
        offsetSec: 0,
        imageDataUrl,
        studentCount: localPeopleCountRef.current,
        audioLevel: audioLevelRef.current,
        threatScore: camera.lastAnalysis?.threatScore ?? (perimeterBreachedRef.current ? 92 : 0),
        transcript: liveTranscriptRef.current.trim(),
      };
    } catch {
      return null;
    }
  };

  const getLatestVideoClipSnapshot = (): { videoClipUrl?: string; videoClipMimeType?: string } => {
    try {
      const mimeType = activeVideoMimeRef.current || 'video/webm';
      let blob: Blob | null = null;
      if (currentVideoChunksRef.current.length >= 2) {
        blob = new Blob(currentVideoChunksRef.current, { type: mimeType });
      } else if (completedVideoBlobRef.current && completedVideoBlobRef.current.size > 0) {
        blob = completedVideoBlobRef.current;
      } else if (currentVideoChunksRef.current.length === 1) {
        blob = new Blob(currentVideoChunksRef.current, { type: mimeType });
      }
      if (!blob || blob.size < 512) return {};
      return {
        videoClipUrl: URL.createObjectURL(blob),
        videoClipMimeType: mimeType,
      };
    } catch {
      return {};
    }
  };

  const getDvrBundleSnapshot = (): DvrBundleSnapshot => {
    const instant = captureAnnotatedDvrFrame();
    if (instant) {
      dvrBufferRef.current = pushRollingDvrFrame(dvrBufferRef.current, instant, 14);
      setDvrFrameCount(dvrBufferRef.current.length);
    }
    const videoSnap = getLatestVideoClipSnapshot();
    return {
      frames: [...dvrBufferRef.current],
      videoClipUrl: videoSnap.videoClipUrl,
      videoClipMimeType: videoSnap.videoClipMimeType,
    };
  };

  const getDvrBundleSnapshotRef = useRef(getDvrBundleSnapshot);
  getDvrBundleSnapshotRef.current = getDvrBundleSnapshot;

  useEffect(() => {
    if (!onRegisterDvrProvider) return;
    onRegisterDvrProvider(camera.id, () => getDvrBundleSnapshotRef.current());
    return () => onRegisterDvrProvider(camera.id, null);
  }, [camera.id, onRegisterDvrProvider]);

  // Rolling 15-second Black-Box DVR frame sampler (1 frame every 1.2s, max 14 frames)
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!isAudioOnly && !hasLiveFrameRef.current) return;
      const frame = captureAnnotatedDvrFrame();
      if (frame) {
        dvrBufferRef.current = pushRollingDvrFrame(dvrBufferRef.current, frame, 14);
        setDvrFrameCount(dvrBufferRef.current.length);
      }
    }, 1200);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.id, isAudioOnly]);

  // Real rolling MediaRecorder (.webm) black-box video clip buffer (self-contained 14s segments)
  useEffect(() => {
    if (isAudioOnly || !hasLiveSignal) {
      setIsRecordingVideo(false);
      return;
    }
    const canvas = canvasRef.current;
    if (
      !canvas ||
      typeof MediaRecorder === 'undefined' ||
      typeof canvas.captureStream !== 'function'
    ) {
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let rotateTimer: number | null = null;

    const preferredMimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const supportedMime =
      preferredMimes.find((m) => {
        try {
          return MediaRecorder.isTypeSupported(m);
        } catch {
          return false;
        }
      }) || '';

    const startSegment = () => {
      if (cancelled || !stream) return;
      if (currentVideoChunksRef.current.length > 0) {
        completedVideoBlobRef.current = new Blob(currentVideoChunksRef.current, {
          type: activeVideoMimeRef.current,
        });
      }
      currentVideoChunksRef.current = [];
      try {
        recorder = supportedMime
          ? new MediaRecorder(stream, {
              mimeType: supportedMime,
              videoBitsPerSecond: 650_000,
            })
          : new MediaRecorder(stream);
        activeVideoMimeRef.current = recorder.mimeType || supportedMime || 'video/webm';
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            currentVideoChunksRef.current.push(ev.data);
          }
        };
        recorder.start(1000);
        setIsRecordingVideo(true);
      } catch {
        setIsRecordingVideo(false);
      }
    };

    try {
      stream = canvas.captureStream(12);
      startSegment();
      rotateTimer = window.setInterval(() => {
        if (recorder && recorder.state === 'recording') {
          try {
            recorder.stop();
          } catch {
            // ignore
          }
        }
        startSegment();
      }, 14_000);
    } catch {
      setIsRecordingVideo(false);
    }

    return () => {
      cancelled = true;
      if (rotateTimer !== null) window.clearInterval(rotateTimer);
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setIsRecordingVideo(false);
    };
  }, [camera.id, hasLiveSignal, isAudioOnly]);

  const handleFlagLiveSubject = (subject: TrackedSubject) => {
    if (!onEnrollLiveSubject) return;
    const rawCanvas = rawCaptureCanvasRef.current || canvasRef.current;
    if (!rawCanvas || rawCanvas.width <= 0 || rawCanvas.height <= 0) return;

    try {
      const [ymin, xmin, ymax, xmax] = subject.box_2d;
      const cw = rawCanvas.width;
      const ch = rawCanvas.height;
      const sx = Math.max(0, Math.floor((xmin / 1000) * cw));
      const sy = Math.max(0, Math.floor((ymin / 1000) * ch));
      const sw = Math.max(12, Math.min(cw - sx, Math.floor(((xmax - xmin) / 1000) * cw)));
      const sh = Math.max(12, Math.min(ch - sy, Math.floor(((ymax - ymin) / 1000) * ch)));

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 160;
      thumbCanvas.height = 160;
      const tctx = thumbCanvas.getContext('2d', { willReadFrequently: true });
      if (!tctx) return;
      tctx.fillStyle = '#09090b';
      tctx.fillRect(0, 0, 160, 160);
      const scale = Math.min(160 / sw, 160 / sh);
      const dw = Math.round(sw * scale);
      const dh = Math.round(sh * scale);
      tctx.drawImage(rawCanvas, sx, sy, sw, sh, Math.round((160 - dw) / 2), Math.round((160 - dh) / 2), dw, dh);
      const thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.82);

      let signature = subjectSignaturesRef.current[subject.id];
      if (!signature) {
        const rctx = rawCanvas.getContext('2d', { willReadFrequently: true });
        if (rctx) {
          const rgba = rctx.getImageData(0, 0, cw, ch).data;
          signature = extractAppearanceSignature(rgba, cw, ch, subject.box_2d);
        }
      }
      if (!signature) return;

      onEnrollLiveSubject(camera.id, {
        label: `${subject.id} (${camera.cameraCode})`,
        thumbnailDataUrl,
        signature,
      });
    } catch {
      // ignore cross-origin tainted stream errors
    }
  };

  const getCanvasPointFromPointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY)),
    };
  };

  const handleCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingZone || isAudioOnly) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getCanvasPointFromPointer(e);
    dragStartPxRef.current = pt;
    dragCurrentPxRef.current = pt;
  };

  const handleCanvasPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingZone || !dragStartPxRef.current) return;
    dragCurrentPxRef.current = getCanvasPointFromPointer(e);
  };

  const handleCanvasPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingZone || !dragStartPxRef.current) return;
    const endPt = getCanvasPointFromPointer(e);
    const createdZone = normalizeDragToPerimeterZone(
      dragStartPxRef.current,
      endPt,
      lastDrawRectRef.current,
      'Restricted Perimeter'
    );
    dragStartPxRef.current = null;
    dragCurrentPxRef.current = null;
    setIsDrawingZone(false);
    if (createdZone) {
      onUpdateCameraSettings(camera.id, { perimeterZone: createdZone });
    }
  };

  const handleManualLockClick = () => {
    const bundle = getDvrBundleSnapshot();
    onManualLockEvidence?.(camera.id, bundle);
    setJustLockedEvidence(true);
    window.setTimeout(() => setJustLockedEvidence(false), 1800);
  };

  const captureCleanFrame = (): { base64: string; dataUrl: string } | null => {
    if (isAudioOnly || !hasLiveFrameRef.current) return null;
    if (!rawCaptureCanvasRef.current) {
      rawCaptureCanvasRef.current = document.createElement('canvas');
    }
    const targetCanvas = rawCaptureCanvasRef.current;

    const video = videoRef.current;
    const hasVideoFeed =
      Boolean(video) &&
      video!.readyState >= 2 &&
      video!.videoWidth > 0 &&
      (Boolean(liveMediaStream) ||
        (camera.customMediaType === 'video' && Boolean(camera.customMediaUrl)));

    let srcW = 640;
    let srcH = 360;
    let sourceEl: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null = null;

    if (hasVideoFeed && video) {
      srcW = video.videoWidth;
      srcH = video.videoHeight;
      sourceEl = video;
    } else if (
      loadedImageRef.current &&
      loadedImageRef.current.complete &&
      loadedImageRef.current.naturalWidth > 0
    ) {
      srcW = loadedImageRef.current.naturalWidth;
      srcH = loadedImageRef.current.naturalHeight;
      sourceEl = loadedImageRef.current;
    } else if (canvasRef.current) {
      srcW = canvasRef.current.width;
      srcH = canvasRef.current.height;
      sourceEl = canvasRef.current;
    } else {
      return null;
    }

    // Preserve true camera aspect ratio (e.g. portrait phone 360x640 vs landscape laptop 640x360)
    // so humans on mobile/tablet cameras are NEVER stretched horizontally before COCO-SSD inference!
    const fitted = computeAspectPreservingSize(srcW, srcH, 640);
    if (targetCanvas.width !== fitted.width) targetCanvas.width = fitted.width;
    if (targetCanvas.height !== fitted.height) targetCanvas.height = fitted.height;

    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(sourceEl, 0, 0, targetCanvas.width, targetCanvas.height);

    let dataUrl = '';
    let base64 = '';
    try {
      dataUrl = targetCanvas.toDataURL('image/jpeg', 0.85);
      base64 = captureCanvasJpegBase64(targetCanvas);
    } catch {
      // Cross-origin image without CORS headers: keep canvas intact if readable, avoid aborting frame draw
    }

    return {
      base64,
      dataUrl,
    };
  };

  const captureCleanFrameRef = useRef(captureCleanFrame);
  captureCleanFrameRef.current = captureCleanFrame;

  const sampleMotionPixels = (): Uint8ClampedArray | null => {
    if (!hasLiveFrameRef.current) return null;
    if (!motionCanvasRef.current) {
      const thumb = document.createElement('canvas');
      thumb.width = 64;
      thumb.height = 36;
      motionCanvasRef.current = thumb;
    }
    const thumbCanvas = motionCanvasRef.current;
    const ctx = thumbCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const video = videoRef.current;
    const hasVideoFeed =
      Boolean(video) &&
      video!.readyState >= 2 &&
      video!.videoWidth > 0 &&
      (Boolean(liveMediaStream) ||
        (camera.customMediaType === 'video' && Boolean(camera.customMediaUrl)));

    if (hasVideoFeed && video) {
      ctx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
    } else if (
      loadedImageRef.current &&
      loadedImageRef.current.complete &&
      loadedImageRef.current.naturalWidth > 0
    ) {
      ctx.drawImage(loadedImageRef.current, 0, 0, thumbCanvas.width, thumbCanvas.height);
    } else {
      return null;
    }

    try {
      return ctx.getImageData(0, 0, thumbCanvas.width, thumbCanvas.height).data;
    } catch {
      return null;
    }
  };

  const sampleMotionPixelsRef = useRef(sampleMotionPixels);
  sampleMotionPixelsRef.current = sampleMotionPixels;

  const labels = formatFacilityLabels(facilityMode);
  const isAutoAiOn = camera.autoAiEnabled !== false;
  const activeCameraAiModel = camera.aiModel || defaultAiModel;
  const hasAiFeedSignal =
    hasLiveSignal || (camera.voiceListeningEnabled && Boolean(camera.liveTranscript.trim()));

  useEffect(() => {
    const wasAnalyzing = isAnalyzingRef.current;
    isAnalyzingRef.current = camera.isAnalyzing;
    if (wasAnalyzing && !camera.isAnalyzing) {
      lastScanFinishedAtRef.current = Date.now();
      hasScannedOnceRef.current = true;
    }
  }, [camera.isAnalyzing]);

  useEffect(() => {
    detectedPeopleRef.current = camera.lastAnalysis?.detectedPeople ?? [];
    detectedObjectsRef.current = camera.lastAnalysis?.detectedObjects ?? [];
    cameraStatusRef.current = camera.status;
    threatCategoryRef.current = camera.lastAnalysis?.threatCategory ?? 'none';
  }, [
    camera.lastAnalysis?.detectedPeople,
    camera.lastAnalysis?.detectedObjects,
    camera.lastAnalysis?.threatCategory,
    camera.status,
  ]);

  useEffect(() => {
    audioLevelRef.current = camera.audioLevel;
    voiceListeningRef.current = camera.voiceListeningEnabled;
  }, [camera.audioLevel, camera.voiceListeningEnabled]);

  useEffect(() => {
    cloudQuotaExhaustedRef.current = cloudQuotaExhausted;
  }, [cloudQuotaExhausted]);

  useEffect(() => {
    facilityModeRef.current = facilityMode;
  }, [facilityMode]);

  useEffect(() => {
    threatSensitivityRef.current = threatSensitivity;
  }, [threatSensitivity]);

  useEffect(() => {
    onAnalyzeCameraRef.current = onAnalyzeCamera;
  }, [onAnalyzeCamera]);

  useEffect(() => {
    onLocalPersonDetectionsRef.current = onLocalPersonDetections;
  }, [onLocalPersonDetections]);

  useEffect(() => {
    onRealtimeEdgeThreatRef.current = onRealtimeEdgeThreat;
  }, [onRealtimeEdgeThreat]);

  useEffect(() => {
    setTotalDraft(
      typeof camera.expectedTotalCount === 'number' && camera.expectedTotalCount > 0
        ? String(camera.expectedTotalCount)
        : ''
    );
  }, [camera.expectedTotalCount]);

  // Preload zero-quota on-device TensorFlow.js COCO-SSD person + weapon detector once video signal is active
  useEffect(() => {
    if (isAudioOnly) {
      localEdgeReadyRef.current = false;
      setLocalEdgeState('fallback');
      return;
    }
    if (!hasLiveSignal && !liveMediaStream) {
      return;
    }
    let cancelled = false;
    ensureLocalPersonDetector()
      .then(() => {
        if (!cancelled) {
          localEdgeReadyRef.current = true;
          setLocalEdgeState('ready');
          const { backend } = getLocalDetectorStatus();
          setScanModeLabel(
            backend === 'cpu' ? 'Edge AI (CPU) · Armed' : 'Edge AI (WebGL) · Armed'
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          localEdgeReadyRef.current = false;
          setLocalEdgeState('fallback');
          setScanModeLabel('Cloud AI fallback · Edge model unavailable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasLiveSignal, isAudioOnly, liveMediaStream]);

  // Real-time zero-quota on-device Edge AI person + weapon + visual threat engine (runs every 300ms)
  useEffect(() => {
    if (isAudioOnly || !isAutoAiOn || !hasLiveSignal || localEdgeState !== 'ready') {
      return;
    }

    let cancelled = false;
    const runEdgeDetect = async () => {
      if (cancelled || localDetectInFlightRef.current || !hasLiveFrameRef.current) return;
      const clean = captureCleanFrameRef.current();
      if (!clean || !rawCaptureCanvasRef.current) return;

      // Measure true frame-to-frame visual motion right at inference time
      const currThumb = sampleMotionPixelsRef.current();
      const instantDelta =
        currThumb && prevEdgeThumbRef.current
          ? computeFrameDeltaPercent(prevEdgeThumbRef.current, currThumb)
          : 0;
      if (currThumb) {
        prevEdgeThumbRef.current = new Uint8ClampedArray(currThumb);
      }
      liveMotionPercentRef.current = instantDelta;
      setLiveMotionPercent(instantDelta);

      localDetectInFlightRef.current = true;
      try {
        const rawCanvas = rawCaptureCanvasRef.current;
        const {
          people: rawPeople,
          weakPeople,
          dangerousObjects,
          occluderObjects,
          inferenceMs,
          backend,
        } = await detectPeopleLocallyOnCanvas(rawCanvas, 36, {
          hadTrackedPeople: personTrackerStateRef.current.confirmed.length > 0,
        });
        if (cancelled) return;
        consecutiveEdgeErrorsRef.current = 0;

        // Lightweight 6x4 lower-torso patch sampler (shoulders/chest below face) for occlusion resilience
        const sampleTorsoSignature = (
          box_2d: [number, number, number, number]
        ): number[] | null => {
          try {
            const cw = rawCanvas.width;
            const ch = rawCanvas.height;
            if (cw <= 0 || ch <= 0) return null;
            const [ymin, xmin, ymax, xmax] = box_2d;
            const torsoYmin = ymin + Math.round((ymax - ymin) * 0.44);
            const sx = Math.max(0, Math.floor((xmin / 1000) * cw));
            const sy = Math.max(0, Math.floor((torsoYmin / 1000) * ch));
            const sw = Math.max(4, Math.floor(((xmax - xmin) / 1000) * cw));
            const sh = Math.max(4, Math.floor(((ymax - torsoYmin) / 1000) * ch));
            const scratch = document.createElement('canvas');
            scratch.width = 6;
            scratch.height = 4;
            const sctx = scratch.getContext('2d', { willReadFrequently: true });
            if (!sctx) return null;
            sctx.drawImage(rawCanvas, sx, sy, Math.min(sw, cw - sx), Math.min(sh, ch - sy), 0, 0, 6, 4);
            const data = sctx.getImageData(0, 0, 6, 4).data;
            const vec: number[] = [];
            for (let i = 0; i < data.length; i += 4) {
              vec.push(Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114));
            }
            return vec;
          } catch {
            return null;
          }
        };

        const { nextState, people } = stepPersonTracker(
          personTrackerStateRef.current,
          rawPeople,
          {
            instantConfidence: 58,
            minConfidence: 36,
            maxMissedFrames: 2,
            maxOccludedFrames: 35,
            weakDetections: weakPeople,
            occluderObjects,
            sampleTorsoSignature,
          }
        );
        personTrackerStateRef.current = nextState;
        detectedPeopleRef.current = people;
        detectedObjectsRef.current = dangerousObjects;
        localPeopleCountRef.current = people.length;

        const sig = [
          ...people.map(
            (p) =>
              `${p.label}:${p.faceOccluded ? 'OCC' : 'CLR'}:${p.confidence}:${p.box_2d.map((v) => Math.round(v / 20)).join(',')}`
          ),
          ...dangerousObjects.map(
            (o) => `W:${o.label}:${o.confidence}:${o.box_2d.map((v) => Math.round(v / 20)).join(',')}`
          ),
        ].join('|');

        if (sig !== lastLocalBoxSigRef.current) {
          lastLocalBoxSigRef.current = sig;
          onLocalPersonDetectionsRef.current(camera.id, people, dangerousObjects);
        }

        // Accumulate real spatial activity heatmap dwell from confirmed tracked humans
        updateActivityHeatmap(heatmapGridRef.current, people, HEATMAP_COLS, HEATMAP_ROWS);

        // Update persistent Subject IDs, movement trajectories, dwell timers & Appearance Re-ID Watchlist
        const nowTrackMs = Date.now();
        const trackedStep = updateTrackedSubjects(
          trackedSubjectsRef.current,
          people,
          nowTrackMs,
          nextSubjectNumericIdRef.current
        );
        nextSubjectNumericIdRef.current = trackedStep.nextNumericId;
        let nextTracked = trackedStep.subjects;

        // Extract real 36-bin spatial HSV appearance signatures directly from raw frame pixels
        try {
          const rctx = rawCanvas.getContext('2d', { willReadFrequently: true });
          if (rctx && nextTracked.length > 0) {
            const rawPixels = rctx.getImageData(0, 0, rawCanvas.width, rawCanvas.height).data;
            const nextSigs: Record<string, AppearanceSignature> = {};
            for (const subj of nextTracked) {
              nextSigs[subj.id] = extractAppearanceSignature(
                rawPixels,
                rawCanvas.width,
                rawCanvas.height,
                subj.box_2d
              );
            }
            subjectSignaturesRef.current = nextSigs;

            // Cross-camera Watchlist Re-ID matching (works even when face is covered)
            if (watchlistRef.current.length > 0) {
              const matches = matchSubjectsToWatchlist(
                nextTracked,
                nextSigs,
                watchlistRef.current,
                84
              );
              const matchBySubject = new Map(matches.map((m) => [m.subjectId, m]));
              nextTracked = nextTracked.map((subj) => {
                const hit = matchBySubject.get(subj.id);
                if (!hit) {
                  return {
                    ...subj,
                    matchedWatchlistId: undefined,
                    matchedWatchlistLabel: undefined,
                    matchedSimilarity: undefined,
                  };
                }
                return {
                  ...subj,
                  matchedWatchlistId: hit.watchlistItem.id,
                  matchedWatchlistLabel: hit.watchlistItem.label,
                  matchedSimilarity: hit.similarity,
                };
              });

              for (const hit of matches) {
                const lastHitMs = lastWatchlistAlertAtRef.current[hit.watchlistItem.id] ?? 0;
                if (nowTrackMs - lastHitMs >= 15_000) {
                  lastWatchlistAlertAtRef.current[hit.watchlistItem.id] = nowTrackMs;
                  onWatchlistMatchRef.current?.(camera.id, {
                    watchlistItem: hit.watchlistItem,
                    subjectId: hit.subjectId,
                    similarity: hit.similarity,
                    bundle: getDvrBundleSnapshotRef.current(),
                  });
                }
              }
            }
          } else {
            subjectSignaturesRef.current = {};
          }
        } catch {
          // ignore cross-origin tainted readback
        }

        trackedSubjectsRef.current = nextTracked;
        const trackedUiSig = nextTracked
          .map((s) => `${s.id}:${s.dwellSeconds}:${s.matchedWatchlistId ?? ''}:${s.matchedSimilarity ?? 0}`)
          .join('|');
        if (trackedUiSig !== lastTrackedUiSigRef.current) {
          lastTrackedUiSigRef.current = trackedUiSig;
          setLiveTrackedSubjects(nextTracked);
        }

        // Evaluate interactive Restricted Perimeter Zone breach in real time
        const activeZone = perimeterZoneRef.current;
        if (activeZone) {
          const breachEval = detectPerimeterBreaches(people, activeZone);
          if (breachEval.breached !== perimeterBreachedRef.current) {
            perimeterBreachedRef.current = breachEval.breached;
            setPerimeterBreached(breachEval.breached);
          }
          const nowBreachMs = Date.now();
          if (breachEval.breached && nowBreachMs - lastPerimeterAlertAtRef.current >= 12_000) {
            lastPerimeterAlertAtRef.current = nowBreachMs;
            onPerimeterBreachRef.current?.(
              camera.id,
              breachEval.breachingPeople,
              activeZone,
              getDvrBundleSnapshotRef.current()
            );
          }
        }

        // Run real-time stateful visual + weapon + contact threat detector on EVERY frame
        const threatEval = evaluateRealtimeEdgeThreat(edgeThreatStateRef.current, {
          people,
          dangerousObjects,
          frameDeltaPercent: instantDelta,
          voiceTranscript: voiceListeningRef.current ? liveTranscriptRef.current : '',
          audioLevel: voiceListeningRef.current ? audioLevelRef.current : 0,
          facilityMode: facilityModeRef.current,
          sensitivity: threatSensitivityRef.current,
          nowMs: Date.now(),
        });
        edgeThreatStateRef.current = threatEval.nextState;
        setContactPairsCount(threatEval.contactPairs);

        if (threatEval.analysis || threatEval.shouldClearThreat) {
          onRealtimeEdgeThreatRef.current(camera.id, {
            analysis: threatEval.analysis,
            shouldEmitAlert: threatEval.shouldEmitAlert,
            shouldClearThreat: threatEval.shouldClearThreat,
            previewDataUrl: threatEval.shouldEmitAlert ? clean.dataUrl : undefined,
          });
        }

        if (!isAnalyzingRef.current) {
          const backendTag = backend === 'cpu' ? 'CPU' : 'WebGL';
          setScanModeLabel(
            cloudQuotaExhaustedRef.current
              ? `Edge AI (${backendTag}) · ${inferenceMs}ms`
              : `Edge (${backendTag}) + Cloud · ${inferenceMs}ms`
          );
        }
      } catch (err) {
        consecutiveEdgeErrorsRef.current += 1;
        if (consecutiveEdgeErrorsRef.current >= 4) {
          const msg = err instanceof Error ? err.message : '';
          setScanModeLabel(
            /tainted|security/i.test(msg)
              ? 'Edge AI blocked by stream CORS'
              : 'Edge AI retrying on device...'
          );
        }
      } finally {
        localDetectInFlightRef.current = false;
      }
    };

    void runEdgeDetect();
    const edgeTimer = window.setInterval(() => {
      void runEdgeDetect();
    }, 300);

    return () => {
      cancelled = true;
      clearInterval(edgeTimer);
    };
  }, [camera.id, hasLiveSignal, isAudioOnly, isAutoAiOn, localEdgeState]);

  // Cloud multimodal threat verification loop (complements on-device Edge AI when cloud quota is available)
  useEffect(() => {
    if (isAudioOnly) {
      const hasLiveAudio = Boolean(liveMediaStream?.getAudioTracks().length) || micActive;
      setScanModeLabel(
        !isAutoAiOn
          ? 'Acoustic AI paused'
          : hasLiveAudio
            ? 'Acoustic AI · Live Mic Armed'
            : 'Acoustic AI · Standby'
      );
      setLiveMotionPercent(0);
      return;
    }
    if (!isAutoAiOn) {
      setScanModeLabel('Threat AI paused');
      setLiveMotionPercent(0);
      return;
    }
    if (!hasAiFeedSignal) {
      setScanModeLabel('Waiting for video signal');
      setLiveMotionPercent(0);
      return;
    }
    if (localEdgeState === 'loading') {
      setScanModeLabel('Loading Edge AI model...');
      return;
    }

    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      const currPixels = sampleMotionPixelsRef.current();
      const deltaPercent = currPixels
        ? computeFrameDeltaPercent(lastScannedThumbRef.current, currPixels)
        : liveMotionPercentRef.current;

      if (!localEdgeReadyRef.current) {
        setLiveMotionPercent(deltaPercent);
        liveMotionPercentRef.current = deltaPercent;
      }

      const decision = shouldTriggerInstantContinuousScan({
        autoAiEnabled: true,
        hasSignal: true,
        isAnalyzing: isAnalyzingRef.current,
        nowMs,
        lastScanFinishedAtMs: lastScanFinishedAtRef.current,
        frameDeltaPercent: deltaPercent,
        hasNeverScanned: !hasScannedOnceRef.current,
        hasLocalEdgeVision: localEdgeReadyRef.current,
        localDetectedPeopleCount: localPeopleCountRef.current,
      });

      if (decision.reason === 'in-flight') {
        setScanModeLabel('Cloud AI verifying scene...');
        return;
      }

      // When cloud API quota is exhausted, on-device 300ms Edge AI handles all live threat detection continuously
      if (cloudQuotaExhausted && localEdgeReadyRef.current) {
        return;
      }

      if (decision.shouldScan) {
        if (currPixels) {
          lastScannedThumbRef.current = new Uint8ClampedArray(currPixels);
        }
        hasScannedOnceRef.current = true;
        setScanModeLabel(
          decision.reason === 'instant-change'
            ? 'Scene change · verifying threats'
            : 'Cloud vision scan active'
        );
        onAnalyzeCameraRef.current(camera.id, true);
      } else if (!localEdgeReadyRef.current) {
        setScanModeLabel(
          deltaPercent >= INSTANT_CHANGE_THRESHOLD_PERCENT
            ? `Motion ${deltaPercent.toFixed(0)}% · scanning`
            : 'Continuous AI · armed'
        );
      }
    }, 350);

    return () => clearInterval(timer);
  }, [
    camera.id,
    cloudQuotaExhausted,
    hasAiFeedSignal,
    isAudioOnly,
    isAutoAiOn,
    liveMediaStream,
    localEdgeState,
    micActive,
  ]);

  useEffect(() => {
    onUpdateTranscriptRef.current = onUpdateTranscript;
  }, [onUpdateTranscript]);

  useEffect(() => {
    if (!editingVoice) {
      setVoiceDraft(camera.liveTranscript);
    }
    liveTranscriptRef.current = camera.liveTranscript;
  }, [camera.liveTranscript, editingVoice]);

  useEffect(() => {
    onRegisterCapture(camera.id, () => {
      const current = captureCleanFrameRef.current();
      if (!current) return null;
      return {
        frameBase64: current.base64,
        previewDataUrl: current.dataUrl,
        liveMotionPercent: liveMotionPercentRef.current,
        detectedObjects: detectedObjectsRef.current,
      };
    });
    return () => {
      onRegisterCapture(camera.id, null);
    };
  }, [camera.id, onRegisterCapture]);

  // Attach live MediaStream or uploaded video/image
  useEffect(() => {
    setStreamError(null);
    hasLiveFrameRef.current = false;
    setHasLiveSignal(false);
    loadedImageRef.current = null;
    prevEdgeThumbRef.current = null;
    edgeThreatStateRef.current = createInitialEdgeThreatState();

    if (liveMediaStream && videoRef.current) {
      videoRef.current.srcObject = liveMediaStream;
      void videoRef.current.play().catch(() => {});
      return;
    }

    if (camera.customMediaUrl && camera.customMediaType === 'video' && videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = camera.customMediaUrl;
      videoRef.current.loop = true;
      void videoRef.current.play().catch(() => {});
      return;
    }

    if (camera.customMediaUrl && camera.customMediaType === 'image') {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 0) {
          loadedImageRef.current = img;
          hasLiveFrameRef.current = true;
          setHasLiveSignal(true);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (canvas && ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
        }
      };
      img.onerror = () => {
        hasLiveFrameRef.current = false;
        setHasLiveSignal(false);
        setStreamError('Unable to load image file.');
      };
      img.src = camera.customMediaUrl;
    }
  }, [camera.customMediaType, camera.customMediaUrl, liveMediaStream]);

  // Poll real Wi-Fi / IP CCTV HTTP snapshot or MJPEG URL (via proxy or Direct LAN mode)
  useEffect(() => {
    if (!camera.streamUrl) return;
    let cancelled = false;
    let inFlight = false;

    const loadSnapshot = () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      const img = new Image();
      if (camera.wifiDirectMode) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => {
        inFlight = false;
        if (cancelled) return;
        if (img.naturalWidth > 0) {
          setStreamError(null);
          loadedImageRef.current = img;
          hasLiveFrameRef.current = true;
          setHasLiveSignal(true);
        }
      };
      img.onerror = () => {
        inFlight = false;
        if (cancelled) return;
        hasLiveFrameRef.current = false;
        setHasLiveSignal(false);
        setStreamError(
          camera.sourceKind === 'wifi-cctv'
            ? 'Unable to reach Wi-Fi CCTV feed. Verify camera IP/URL, Wi-Fi network, or toggle Direct LAN mode.'
            : 'Unable to reach camera snapshot or MJPEG stream URL.'
        );
      };

      if (camera.wifiDirectMode) {
        const sep = camera.streamUrl!.includes('?') ? '&' : '?';
        img.src = `${camera.streamUrl!}${sep}_t=${Date.now()}`;
      } else {
        img.src = `/api/snapshot-proxy?url=${encodeURIComponent(camera.streamUrl!)}&t=${Date.now()}`;
      }
    };

    loadSnapshot();
    const pollMs = camera.sourceKind === 'wifi-cctv' ? 900 : 1500;
    const timer = setInterval(loadSnapshot, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [camera.sourceKind, camera.streamUrl, camera.wifiDirectMode]);

  // Measure real time-domain RMS decibel level (dB SPL) with peak-hold responsiveness
  useEffect(() => {
    const streamToMeter = liveMediaStream || micStreamRef.current;
    if (!streamToMeter || streamToMeter.getAudioTracks().length === 0) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let ctx: AudioContext | null = null;
    let sampleTimer = 0;
    let peakDbInWindow = 30.0;
    let ticksSinceEmit = 0;

    try {
      ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      const source = ctx.createMediaStreamSource(streamToMeter);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const timeData = new Float32Array(analyser.fftSize);
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      sampleTimer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(timeData);
        analyser.getByteFrequencyData(freqData);
        const bins = waveformBinsRef.current;
        const binCount = bins.length;
        const stride = Math.max(1, Math.floor(freqData.length / (binCount * 2)));
        for (let b = 0; b < binCount; b += 1) {
          let sum = 0;
          for (let k = 0; k < stride; k += 1) {
            sum += freqData[Math.min(freqData.length - 1, b * stride + k)] ?? 0;
          }
          const normalized = Math.min(1, sum / (stride * 210));
          bins[b] = Math.max(0.05, bins[b] * 0.45 + normalized * 0.55);
        }

        const instantDb = computeSplDecibels(timeData, dbCalibrationOffset);
        if (instantDb > peakDbInWindow) {
          peakDbInWindow = instantDb;
        }
        ticksSinceEmit += 1;
        if (ticksSinceEmit >= 3) {
          const nowMs = Date.now();
          if (peakDbInWindow > SOUND_ALERT_THRESHOLD_DB) {
            const startMs = loudHoldStartRef.current ?? nowMs;
            loudHoldStartRef.current = startMs;
            setLoudHoldSeconds(Math.round(((nowMs - startMs) / 1000) * 10) / 10);
          } else {
            if (loudHoldStartRef.current !== null) {
              loudHoldStartRef.current = null;
              setLoudHoldSeconds(0);
            }
          }
          onUpdateTranscriptRef.current(
            camera.id,
            liveTranscriptRef.current,
            peakDbInWindow,
            'audio-meter'
          );
          peakDbInWindow = 30.0;
          ticksSinceEmit = 0;
        }
      }, 100);
    } catch {
      // ignore AudioContext setup failure
    }

    return () => {
      if (sampleTimer) clearInterval(sampleTimer);
      waveformBinsRef.current = new Array<number>(48).fill(0.06);
      loudHoldStartRef.current = null;
      setLoudHoldSeconds(0);
      if (ctx) void ctx.close().catch(() => {});
    };
  }, [camera.id, dbCalibrationOffset, liveMediaStream, micActive]);

  // Draw live video/image frame + grounded person & weapon bounding boxes onto display canvas
  useEffect(() => {
    const drawFrame = (timestamp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.fillStyle = '#070A0F';
      ctx.fillRect(0, 0, width, height);

      if (isAudioOnly) {
        const audioConnected =
          Boolean(liveMediaStream?.getAudioTracks().length) || micActiveRef.current;
        const dbVal = audioLevelRef.current || 0;
        const isCritical = cameraStatusRef.current === 'fighting';
        const isLoud = dbVal > SOUND_ALERT_THRESHOLD_DB;

        // Subtle acoustic monitor grid
        ctx.fillStyle = '#0A0C10';
        ctx.fillRect(0, 0, width, height);

        const chartLeft = 36;
        const chartRight = width - 24;
        const chartTop = 98;
        const chartBottom = height - 66;
        const chartW = chartRight - chartLeft;
        const chartH = chartBottom - chartTop;

        ctx.strokeStyle = 'rgba(63, 63, 70, 0.45)';
        ctx.lineWidth = 1;
        for (const dbMark of [40, 60, 80, 100]) {
          const yLine = chartBottom - ((dbMark - 20) / 100) * chartH;
          ctx.beginPath();
          ctx.moveTo(chartLeft, yLine);
          ctx.lineTo(chartRight, yLine);
          ctx.stroke();
          ctx.fillStyle = '#52525b';
          ctx.font = '500 10px "JetBrains Mono", monospace';
          ctx.fillText(`${dbMark}`, 8, yLine + 3);
        }

        // Red dashed 90.1 dB alert threshold line
        const thresholdY = chartBottom - ((SOUND_ALERT_THRESHOLD_DB - 20) / 100) * chartH;
        ctx.save();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(chartLeft, thresholdY);
        ctx.lineTo(chartRight, thresholdY);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#f87171';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText('90.1 dB ALERT', chartRight - 84, thresholdY - 5);

        // Live 48-bar acoustic spectrum
        const bins = waveformBinsRef.current;
        const barGap = 3;
        const barW = Math.max(4, Math.floor((chartW - barGap * (bins.length - 1)) / bins.length));
        for (let i = 0; i < bins.length; i += 1) {
          const amp = audioConnected
            ? bins[i]
            : 0.04 + 0.02 * Math.sin(timestamp / 500 + i * 0.35);
          const barH = Math.max(4, Math.round(amp * chartH));
          const bx = chartLeft + i * (barW + barGap);
          const by = chartBottom - barH;
          ctx.fillStyle =
            isCritical || isLoud
              ? '#ef4444'
              : amp > 0.65
                ? '#f59e0b'
                : audioConnected
                  ? '#10b981'
                  : '#3f3f46';
          ctx.fillRect(bx, by, barW, barH);
        }

        // Large monospace dB readout
        ctx.fillStyle = isCritical || isLoud ? '#f87171' : audioConnected ? '#34d399' : '#e4e4e7';
        ctx.font = '700 34px "JetBrains Mono", monospace';
        ctx.fillText(`${dbVal.toFixed(1)} dB`, chartLeft, 76);

        ctx.fillStyle = '#a1a1aa';
        ctx.font = '500 11px "JetBrains Mono", monospace';
        const modeText = audioConnected
          ? 'MICROPHONE ONLY · LIVE ACOUSTIC & VOICE AI'
          : 'MICROPHONE ONLY · STANDBY (CLICK CONNECT MIC OR INSPECT)';
        ctx.fillText(modeText, chartLeft + 180, 68);

        // Live speech cue line
        const transcript = liveTranscriptRef.current.trim();
        ctx.fillStyle = transcript ? '#f4f4f5' : '#71717a';
        ctx.font = '500 12px "DM Sans", sans-serif';
        const cueLine = transcript
          ? `Speech: "${transcript.slice(0, 74)}"`
          : audioConnected
            ? 'Listening for fight, beating, bullying, and distress speech...'
            : 'Ready to monitor acoustic spikes (>90.1 dB) & distress speech.';
        ctx.fillText(cueLine, chartLeft, height - 38);
      } else {
        const video = videoRef.current;
        const hasVideoFeed =
          (Boolean(liveMediaStream) ||
            (camera.customMediaType === 'video' && Boolean(camera.customMediaUrl))) &&
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0;

        if (hasVideoFeed && video) {
          const drawRect = computeContainDrawRect(video.videoWidth, video.videoHeight, width, height);
          lastDrawRectRef.current = drawRect;
          ctx.drawImage(video, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
          if (!hasLiveFrameRef.current) {
            hasLiveFrameRef.current = true;
            setHasLiveSignal(true);
          }
        } else if (
          loadedImageRef.current &&
          loadedImageRef.current.complete &&
          loadedImageRef.current.naturalWidth > 0
        ) {
          const drawRect = computeContainDrawRect(
            loadedImageRef.current.naturalWidth,
            loadedImageRef.current.naturalHeight,
            width,
            height
          );
          lastDrawRectRef.current = drawRect;
          ctx.drawImage(
            loadedImageRef.current,
            drawRect.x,
            drawRect.y,
            drawRect.width,
            drawRect.height
          );
          if (!hasLiveFrameRef.current) {
            hasLiveFrameRef.current = true;
            setHasLiveSignal(true);
          }
        } else {
          if (hasLiveFrameRef.current) {
            hasLiveFrameRef.current = false;
            setHasLiveSignal(false);
          }
          ctx.fillStyle = '#0D131D';
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = '#94a3b8';
          ctx.font = '500 13px "DM Sans", sans-serif';
          const message =
            camera.sourceKind === 'wifi-cctv'
              ? 'Connecting to Wi-Fi CCTV stream...'
              : camera.sourceKind === 'stream-url'
                ? 'Connecting to IP camera stream...'
                : 'Feed offline · Click Reconnect Live Camera';
          const m = ctx.measureText(message);
          ctx.fillText(message, Math.max(20, (width - m.width) / 2), height / 2);
        }

        const activeRect = lastDrawRectRef.current;

        // Spatial Activity Dwell Heatmap overlay (real accumulated person coordinates)
        if (heatmapEnabledRef.current) {
          const grid = heatmapGridRef.current;
          const cellW = activeRect.width / HEATMAP_COLS;
          const cellH = activeRect.height / HEATMAP_ROWS;
          for (let r = 0; r < HEATMAP_ROWS; r += 1) {
            for (let c = 0; c < HEATMAP_COLS; c += 1) {
              const intensity = grid[r * HEATMAP_COLS + c];
              if (intensity < 0.05) continue;
              const [hr, hg, hb] = mapIronbowColor(0.35 + intensity * 0.65);
              ctx.fillStyle = `rgba(${hr}, ${hg}, ${hb}, ${(0.18 + intensity * 0.48).toFixed(2)})`;
              ctx.fillRect(
                activeRect.x + c * cellW,
                activeRect.y + r * cellH,
                Math.ceil(cellW),
                Math.ceil(cellH)
              );
            }
          }
        }

        // Real-time Movement Trajectory Trails for every persistent tracked subject
        const trackedSubjects = trackedSubjectsRef.current;
        if (hasLiveFrameRef.current && trailsEnabledRef.current && trackedSubjects.length > 0) {
          trackedSubjects.forEach((subj) => {
            if (subj.trail.length < 2) return;
            const isWatchlistHit = Boolean(subj.matchedWatchlistId);
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (let i = 1; i < subj.trail.length; i += 1) {
              const prevPt = subj.trail[i - 1];
              const currPt = subj.trail[i];
              const alpha = (i / subj.trail.length) * 0.85;
              const px1 = activeRect.x + (prevPt.x / 1000) * activeRect.width;
              const py1 = activeRect.y + (prevPt.y / 1000) * activeRect.height;
              const px2 = activeRect.x + (currPt.x / 1000) * activeRect.width;
              const py2 = activeRect.y + (currPt.y / 1000) * activeRect.height;
              ctx.strokeStyle = isWatchlistHit
                ? `rgba(239, 68, 68, ${alpha.toFixed(2)})`
                : `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(px1, py1);
              ctx.lineTo(px2, py2);
              ctx.stroke();
            }
            const head = subj.trail[subj.trail.length - 1];
            const hx = activeRect.x + (head.x / 1000) * activeRect.width;
            const hy = activeRect.y + (head.y / 1000) * activeRect.height;
            ctx.fillStyle = isWatchlistHit ? '#ef4444' : '#38bdf8';
            ctx.beginPath();
            ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });
        }

        // Draw active Restricted Perimeter Zone or in-progress drag preview
        const activePerimeter = perimeterZoneRef.current;
        if (activePerimeter) {
          const pRect = mapNormalizedBoxToRect(activePerimeter.box_2d, activeRect);
          const isBreached = perimeterBreachedRef.current;
          ctx.save();
          ctx.fillStyle = isBreached ? 'rgba(220, 38, 38, 0.28)' : 'rgba(245, 158, 11, 0.14)';
          ctx.fillRect(pRect.x, pRect.y, pRect.width, pRect.height);
          ctx.strokeStyle = isBreached ? '#ef4444' : '#f59e0b';
          ctx.lineWidth = isBreached ? 3 : 2;
          if (!isBreached) ctx.setLineDash([7, 5]);
          ctx.strokeRect(pRect.x, pRect.y, pRect.width, pRect.height);
          ctx.restore();

          const pLabel = isBreached
            ? 'PERIMETER BREACH'
            : activePerimeter.label.toUpperCase();
          ctx.font = '700 10px "JetBrains Mono", monospace';
          const pW = Math.min(width - 12, Math.ceil(ctx.measureText(pLabel).width) + 12);
          const pTagY = Math.max(30, pRect.y >= 48 ? pRect.y - 18 : pRect.y + 4);
          ctx.fillStyle = isBreached ? '#dc2626' : 'rgba(180, 83, 9, 0.92)';
          ctx.fillRect(pRect.x, pTagY, pW, 16);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(pLabel, pRect.x + 6, pTagY + 11, pW - 10);
        }

        if (dragStartPxRef.current && dragCurrentPxRef.current) {
          const sx = Math.min(dragStartPxRef.current.x, dragCurrentPxRef.current.x);
          const sy = Math.min(dragStartPxRef.current.y, dragCurrentPxRef.current.y);
          const sw = Math.abs(dragCurrentPxRef.current.x - dragStartPxRef.current.x);
          const sh = Math.abs(dragCurrentPxRef.current.y - dragStartPxRef.current.y);
          ctx.save();
          ctx.fillStyle = 'rgba(245, 158, 11, 0.18)';
          ctx.fillRect(sx, sy, sw, sh);
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ctx.strokeRect(sx, sy, sw, sh);
          ctx.restore();
        }

        // Draw grounded AI person bounding boxes with persistent Subject ID, Dwell Time & Watchlist Re-ID
        const boxes = detectedPeopleRef.current;
        if (hasLiveFrameRef.current && Array.isArray(boxes) && boxes.length > 0) {
          const isCritical = cameraStatusRef.current === 'fighting';
          const isBullying = threatCategoryRef.current === 'bullying';

          boxes.forEach((person, idx) => {
            const matchedSubj = trackedSubjects[idx];
            const isWatchlistHit = Boolean(matchedSubj?.matchedWatchlistId);
            const mapped = mapNormalizedBoxToRect(person.box_2d, activeRect);
            const x = Math.max(2, Math.min(width - 18, mapped.x));
            const y = Math.max(32, Math.min(height - 38, mapped.y));
            const bw = Math.max(16, Math.min(width - x - 2, mapped.width));
            const bh = Math.max(16, Math.min(height - y - 2, mapped.height));

            const isOccluded = Boolean(person.faceOccluded);
            const strokeColor = isWatchlistHit
              ? '#ef4444'
              : isBullying
                ? '#f97316'
                : isCritical
                  ? '#ef4444'
                  : isOccluded
                    ? '#38bdf8'
                    : '#10b981';
            const fillTint = isWatchlistHit
              ? 'rgba(239, 68, 68, 0.18)'
              : isBullying
                ? 'rgba(249, 115, 22, 0.14)'
                : isCritical
                  ? 'rgba(239, 68, 68, 0.14)'
                  : isOccluded
                    ? 'rgba(56, 189, 248, 0.12)'
                    : 'rgba(16, 185, 129, 0.10)';
            const tagBg = isWatchlistHit
              ? 'rgba(220, 38, 38, 0.95)'
              : isBullying
                ? 'rgba(194, 65, 12, 0.92)'
                : isCritical
                  ? 'rgba(185, 28, 28, 0.92)'
                  : isOccluded
                    ? 'rgba(3, 105, 161, 0.92)'
                    : 'rgba(6, 95, 70, 0.90)';

            ctx.fillStyle = fillTint;
            ctx.fillRect(x, y, bw, bh);

            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = isWatchlistHit ? 2.5 : 2;
            if (isOccluded && !isCritical && !isWatchlistHit) {
              ctx.setLineDash([6, 4]);
            }
            ctx.strokeRect(x, y, bw, bh);
            ctx.setLineDash([]);

            const corner = Math.min(12, Math.floor(Math.min(bw, bh) / 3));
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(x, y + corner);
            ctx.lineTo(x, y);
            ctx.lineTo(x + corner, y);
            ctx.moveTo(x + bw - corner, y);
            ctx.lineTo(x + bw, y);
            ctx.lineTo(x + bw, y + corner);
            ctx.moveTo(x, y + bh - corner);
            ctx.lineTo(x, y + bh);
            ctx.lineTo(x + corner, y + bh);
            ctx.moveTo(x + bw - corner, y + bh);
            ctx.lineTo(x + bw, y + bh);
            ctx.lineTo(x + bw, y + bh - corner);
            ctx.stroke();

            const subjectPrefix = matchedSubj ? matchedSubj.id : `#${idx + 1}`;
            const dwellSuffix =
              matchedSubj && matchedSubj.dwellSeconds > 0 ? ` · ${matchedSubj.dwellSeconds}s` : '';
            const tagText = isWatchlistHit
              ? `WATCHLIST: ${matchedSubj?.matchedWatchlistLabel} ${matchedSubj?.matchedSimilarity}%`
              : isOccluded
                ? `${subjectPrefix}${dwellSuffix} · OCCLUDED`
                : `${subjectPrefix}${dwellSuffix} · ${person.confidence}%`;
            ctx.font = '600 11px "JetBrains Mono", monospace';
            const textW = ctx.measureText(tagText).width;
            const tagW = Math.min(width - 8, Math.ceil(textW) + 12);
            const tagX = Math.max(4, Math.min(x, width - tagW - 4));
            const rawTagY = y >= 54 ? y - 20 : Math.min(height - 54, y + 4);
            let tagY = Math.max(34, Math.min(height - 54, rawTagY));
            if (tagY < 88 && tagX + tagW > width - 150) {
              tagY = Math.min(height - 54, Math.max(90, y + 6));
            }
            ctx.fillStyle = tagBg;
            ctx.fillRect(tagX, tagY, tagW, 18);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(tagText, tagX + 6, tagY + 13, tagW - 12);
          });
        }

        // Real Digital Auto-PTZ Close-Up Picture-in-Picture (smoothly tracks locked/active subject)
        if (hasLiveFrameRef.current && ptzAutoTrackEnabledRef.current && trackedSubjects.length > 0) {
          const targetSubj =
            trackedSubjects.find((s) => s.id === lockedPtzSubjectIdRef.current) ||
            trackedSubjects.find((s) => Boolean(s.matchedWatchlistId)) ||
            trackedSubjects[0];

          const srcMedia: HTMLVideoElement | HTMLImageElement | null =
            hasVideoFeed && video
              ? video
              : loadedImageRef.current &&
                  loadedImageRef.current.complete &&
                  loadedImageRef.current.naturalWidth > 0
                ? loadedImageRef.current
                : null;

          if (targetSubj && srcMedia) {
            const srcW =
              srcMedia instanceof HTMLVideoElement ? srcMedia.videoWidth : srcMedia.naturalWidth;
            const srcH =
              srcMedia instanceof HTMLVideoElement ? srcMedia.videoHeight : srcMedia.naturalHeight;

            if (srcW > 0 && srcH > 0) {
              const vp = computeSmoothPtzViewport(targetSubj.box_2d, ptzViewportRef.current, 0.24);
              ptzViewportRef.current = vp;

              const cropX = Math.max(0, Math.floor((vp.xmin / 1000) * srcW));
              const cropY = Math.max(0, Math.floor((vp.ymin / 1000) * srcH));
              const cropW = Math.max(16, Math.min(srcW - cropX, Math.floor(((vp.xmax - vp.xmin) / 1000) * srcW)));
              const cropH = Math.max(16, Math.min(srcH - cropY, Math.floor(((vp.ymax - vp.ymin) / 1000) * srcH)));

              const pipW = 192;
              const pipH = 112;
              const pipX = width - pipW - 10;
              const pipY = height - pipH - 36;
              const isHit = Boolean(targetSubj.matchedWatchlistId);

              ctx.save();
              ctx.fillStyle = '#09090b';
              ctx.fillRect(pipX - 2, pipY - 18, pipW + 4, pipH + 20);
              ctx.drawImage(srcMedia, cropX, cropY, cropW, cropH, pipX, pipY, pipW, pipH);

              // Crisp PTZ reticle + header strip
              ctx.strokeStyle = isHit ? '#ef4444' : '#38bdf8';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(pipX - 1, pipY - 17, pipW + 2, pipH + 18);

              ctx.fillStyle = isHit ? 'rgba(185, 28, 28, 0.94)' : 'rgba(9, 12, 18, 0.92)';
              ctx.fillRect(pipX - 1, pipY - 17, pipW + 2, 17);

              ctx.fillStyle = '#ffffff';
              ctx.font = '700 9px "JetBrains Mono", monospace';
              const ptzLabel = isHit
                ? `PTZ LOCK · ${targetSubj.matchedWatchlistLabel?.slice(0, 12)} · ${vp.zoomFactor}x`
                : `AUTO-PTZ · ${targetSubj.id} · ${vp.zoomFactor}x`;
              ctx.fillText(ptzLabel, pipX + 5, pipY - 5, pipW - 10);

              // Subtle optical center crosshair inside PiP
              const cx = pipX + pipW / 2;
              const cy = pipY + pipH / 2;
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(cx - 8, cy);
              ctx.lineTo(cx - 3, cy);
              ctx.moveTo(cx + 3, cy);
              ctx.lineTo(cx + 8, cy);
              ctx.moveTo(cx, cy - 8);
              ctx.lineTo(cx, cy - 3);
              ctx.moveTo(cx, cy + 3);
              ctx.lineTo(cx, cy + 8);
              ctx.stroke();
              ctx.restore();
            }
          }
        } else if (trackedSubjects.length === 0) {
          ptzViewportRef.current = null;
        }

        // Draw crimson bounding boxes for any detected weapon objects
        const weapons = detectedObjectsRef.current;
        if (hasLiveFrameRef.current && Array.isArray(weapons) && weapons.length > 0) {
          weapons.forEach((weapon) => {
            const mapped = mapNormalizedBoxToRect(weapon.box_2d, activeRect);
            const x = Math.max(2, Math.min(width - 18, mapped.x));
            const y = Math.max(32, Math.min(height - 38, mapped.y));
            const bw = Math.max(16, Math.min(width - x - 2, mapped.width));
            const bh = Math.max(16, Math.min(height - y - 2, mapped.height));

            ctx.fillStyle = 'rgba(220, 38, 38, 0.24)';
            ctx.fillRect(x, y, bw, bh);
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, bw, bh);

            const tagText = `WEAPON: ${weapon.label.toUpperCase()} ${weapon.confidence}%`;
            ctx.font = '700 11px "JetBrains Mono", monospace';
            const textW = ctx.measureText(tagText).width;
            const tagW = Math.min(width - 8, Math.ceil(textW) + 12);
            const tagX = Math.max(4, Math.min(x, width - tagW - 4));
            const tagY = Math.max(34, y >= 54 ? y - 20 : y + 4);
            ctx.fillStyle = '#dc2626';
            ctx.fillRect(tagX, tagY, tagW, 18);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(tagText, tagX + 6, tagY + 13, tagW - 12);
          });
        }
      }

      // Top CCTV telemetry bar
      ctx.fillStyle = 'rgba(7, 10, 15, 0.78)';
      ctx.fillRect(0, 0, width, 28);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '500 11px "JetBrains Mono", monospace';
      const timeLabel = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      ctx.fillText(`${camera.cameraCode} · ${camera.bluetoothDeviceName}`, 10, 18);
      const timeMetrics = ctx.measureText(timeLabel);
      ctx.fillText(timeLabel, width - timeMetrics.width - 10, 18);
    };

    drawFrame(performance.now());
    const intervalId = window.setInterval(() => drawFrame(performance.now()), 90);
    return () => window.clearInterval(intervalId);
  }, [
    camera.bluetoothDeviceName,
    camera.cameraCode,
    camera.customMediaType,
    camera.customMediaUrl,
    camera.sourceKind,
    isAudioOnly,
    liveMediaStream,
  ]);

  useEffect(() => {
    return () => {
      micActiveRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (speechRestartTimerRef.current !== null) {
        clearTimeout(speechRestartTimerRef.current);
      }
      if (speechClearTimerRef.current !== null) {
        clearTimeout(speechClearTimerRef.current);
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const stopSpeechRecognition = () => {
    if (speechRestartTimerRef.current !== null) {
      clearTimeout(speechRestartTimerRef.current);
      speechRestartTimerRef.current = null;
    }
    if (speechClearTimerRef.current !== null) {
      clearTimeout(speechClearTimerRef.current);
      speechClearTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
  };

  const startFreshSpeechSession = (
    SpeechCtor: new () => SpeechRecognitionInstance
  ) => {
    if (!micActiveRef.current) return;
    stopSpeechRecognition();

    const recognition = new SpeechCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

    recognition.onresult = (event) => {
      if (!micActiveRef.current) return;
      const { utterance } = extractLatestSpeechUtterance(event.results, event.resultIndex ?? 0);
      if (!utterance) return;

      onUpdateTranscriptRef.current(camera.id, utterance, undefined, 'speech');

      if (speechClearTimerRef.current !== null) {
        clearTimeout(speechClearTimerRef.current);
      }
      speechClearTimerRef.current = window.setTimeout(() => {
        if (micActiveRef.current) {
          onUpdateTranscriptRef.current(camera.id, '', undefined, 'audio-meter');
        }
      }, 15000);
    };

    recognition.onerror = (event) => {
      const code = event?.error;
      if (code === 'no-speech' || code === 'aborted') {
        return;
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setMicError('Speech recognition blocked (dB level metering remains active).');
      } else if (code === 'network') {
        setMicError('Speech-to-text retrying; dB metering remains live.');
      } else {
        setMicError('Speech recognition paused; live dB metering active.');
      }
    };

    recognition.onend = () => {
      if (!micActiveRef.current) return;
      speechRestartTimerRef.current = window.setTimeout(() => {
        if (!micActiveRef.current) return;
        try {
          startFreshSpeechSession(SpeechCtor);
        } catch {
          // ignore restart throttle
        }
      }, 280);
    };

    recognition.start();
    recognitionRef.current = recognition;
  };

  const handleToggleLiveMic = async () => {
    setMicError(null);
    if (micActive) {
      micActiveRef.current = false;
      stopSpeechRecognition();
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      setMicActive(false);
      return;
    }

    try {
      const existingAudioTracks = liveMediaStream?.getAudioTracks() ?? [];
      if (existingAudioTracks.length === 0 && navigator.mediaDevices?.getUserMedia) {
        const audioConstraints: MediaTrackConstraints = {
          ...(camera.audioDeviceId ? { deviceId: { exact: camera.audioDeviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        };
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: camera.audioDeviceId ? { deviceId: { exact: camera.audioDeviceId } } : true,
          });
        }
        micStreamRef.current = stream;
      }

      const SpeechCtor =
        (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance })
          .SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
          .webkitSpeechRecognition;

      micActiveRef.current = true;
      onUpdateTranscriptRef.current(camera.id, '', undefined, 'audio-meter');

      if (SpeechCtor) {
        startFreshSpeechSession(SpeechCtor);
      } else {
        setMicError('Microphone live (dB monitored); speech-to-text unavailable in this browser.');
      }
      setMicActive(true);
    } catch {
      micActiveRef.current = false;
      setMicError('Microphone permission denied or unavailable.');
      setMicActive(false);
    }
  };

  // Auto-arm live speech recognition when a Microphone-Only zone has an active audio stream
  useEffect(() => {
    if (!isAudioOnly || !liveMediaStream || liveMediaStream.getAudioTracks().length === 0) return;
    if (micActiveRef.current) return;

    const SpeechCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
        .webkitSpeechRecognition;

    micActiveRef.current = true;
    setMicActive(true);
    if (SpeechCtor) {
      try {
        startFreshSpeechSession(SpeechCtor);
      } catch {
        // dB metering continues even if speech API refuses auto-start
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudioOnly, liveMediaStream]);

  const isAudioStreamLive =
    isAudioOnly && (Boolean(liveMediaStream?.getAudioTracks().length) || micActive);

  const needsStreamReconnect =
    !isAudioOnly &&
    (camera.sourceKind === 'device-camera' ||
      (camera.sourceKind === 'bluetooth-cctv' && !camera.streamUrl && !camera.customMediaUrl)) &&
    !liveMediaStream;

  const needsMicConnect = isAudioOnly && !isAudioStreamLive;

  const activeCategory = camera.lastAnalysis?.threatCategory;
  const isBullyingStatus = camera.status === 'fighting' && activeCategory === 'bullying';
  const statusBorderClass =
    isBullyingStatus
      ? 'border-orange-500 ring-1 ring-orange-500/40'
      : camera.status === 'fighting'
        ? 'animate-alert-critical-pulse border-red-500 ring-1 ring-red-500/40'
        : camera.status === 'warning'
          ? 'border-amber-500/70'
          : 'border-zinc-800/90 hover:border-zinc-700';

  const countWord = camera.studentCount === 1 ? labels.personSingular : labels.personPlural;
  const modelLabel = camera.lastAnalysis?.modelUsed
    ? formatAiModelLabel(camera.lastAnalysis.modelUsed)
    : null;
  const detectedWeapons = camera.lastAnalysis?.detectedObjects ?? [];

  const statusLabel =
    camera.status === 'fighting'
      ? activeCategory === 'robbery_or_weapon'
        ? 'Weapon / Robbery'
        : activeCategory === 'intrusion'
          ? 'Breach Alert'
          : activeCategory === 'beating'
            ? 'Beating Detected'
            : activeCategory === 'bullying'
              ? 'Bullying Detected'
              : 'Fight Detected'
      : camera.status === 'warning'
        ? 'Disturbance'
        : 'Nominal';

  return (
    <article
      data-testid={`camera-card-${camera.id}`}
      className={`bg-[#101114] border rounded-lg overflow-hidden flex flex-col transition-colors ${statusBorderClass}`}
    >
      {/* Dominant 16:9 Live CCTV or Acoustic Monitor */}
      <div className="relative bg-black aspect-video w-full overflow-hidden">
        {!isAudioOnly ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onLoadedMetadata={(e) => {
              void e.currentTarget.play().catch(() => {});
            }}
            aria-hidden="true"
            className="absolute top-0 left-0 w-px h-px opacity-[0.01] pointer-events-none"
          />
        ) : null}
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          data-testid={`camera-canvas-${camera.id}`}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          aria-label={
            isAudioOnly
              ? `Live acoustic monitor for ${camera.classroomName}`
              : `Live CCTV feed for ${camera.classroomName}`
          }
          className={`w-full h-full object-cover block relative z-10 ${
            isDrawingZone ? 'cursor-crosshair touch-none' : ''
          }`}
        />

        {isDrawingZone ? (
          <div className="pointer-events-none absolute top-9 left-2.5 z-20 rounded bg-amber-950/90 border border-amber-500/60 px-2.5 py-1 text-[11px] font-medium text-amber-100">
            Drag on feed to draw restricted perimeter
          </div>
        ) : null}

        {needsStreamReconnect ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
            <button
              type="button"
              onClick={() => onReconnectStream(camera.id)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md bg-zinc-100 text-zinc-950 hover:bg-white cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reconnect Live Camera</span>
            </button>
          </div>
        ) : null}

        {needsMicConnect ? (
          <div className="pointer-events-none absolute top-9 right-2.5 z-20">
            <button
              type="button"
              onClick={() => onReconnectStream(camera.id)}
              className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-zinc-100 text-zinc-950 hover:bg-white cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Connect Live Mic</span>
            </button>
          </div>
        ) : null}

        {/* Minimal Tactical Occupancy HUD (video feeds only) */}
        {!isAudioOnly && hasLiveSignal ? (
          <div
            data-testid={`camera-hud-count-${camera.id}`}
            className={`pointer-events-none absolute top-9 right-2.5 z-20 rounded px-2 py-1 backdrop-blur-md border flex items-baseline gap-1.5 ${
              isBullyingStatus
                ? 'bg-orange-950/85 border-orange-400/70 text-orange-100'
                : camera.status === 'fighting'
                  ? 'bg-red-950/90 border-red-400/70 text-red-50'
                  : 'bg-black/75 border-zinc-700/80 text-zinc-100'
            }`}
          >
            <span className="text-lg leading-none font-bold font-mono tabular-nums">
              {camera.studentCount}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-300">
              {detectedWeapons.length > 0
                ? `${detectedWeapons.length} WEAPON`
                : camera.studentCount === 0
                  ? 'EMPTY'
                  : countWord}
            </span>
          </div>
        ) : null}

        {/* Bottom Scrim Telemetry Strip */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 py-2 flex items-end justify-between gap-2">
          <div className="text-[11px] font-mono text-zinc-300 flex items-center gap-2 min-w-0">
            <span
              className={`font-semibold uppercase ${
                isAudioOnly
                  ? isAudioStreamLive
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                  : hasLiveSignal
                    ? 'text-emerald-400'
                    : 'text-amber-400'
              }`}
            >
              {isAudioOnly
                ? isAudioStreamLive
                  ? 'MIC LIVE'
                  : 'STANDBY'
                : hasLiveSignal
                  ? 'LIVE'
                  : 'OFFLINE'}
            </span>
            {!isAudioOnly ? (
              <>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span className="tabular-nums">Δ{liveMotionPercent.toFixed(0)}%</span>
              </>
            ) : null}
            <span aria-hidden="true" className="text-zinc-600">·</span>
            <span
              className={`truncate tabular-nums ${
                camera.voiceListeningEnabled && camera.audioLevel > SOUND_ALERT_THRESHOLD_DB
                  ? 'text-red-400 font-semibold'
                  : 'text-zinc-300'
              }`}
            >
              {camera.voiceListeningEnabled
                ? `${camera.audioLevel.toFixed(1)} dB${
                    camera.audioLevel > SOUND_ALERT_THRESHOLD_DB
                      ? ` (${Math.min(
                          SOUND_ALERT_SUSTAINED_MS / 1000,
                          loudHoldSeconds
                        ).toFixed(1)}s/3s)`
                      : ''
                  }`
                : 'Muted'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onToggleFocus(camera.id)}
            aria-label={isFocused ? `Exit focus for ${camera.classroomName}` : `Focus ${camera.classroomName}`}
            className="pointer-events-auto p-1 rounded bg-black/60 text-zinc-300 hover:bg-black/90 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            {isFocused ? (
              <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Single Clean NVR Monitor Control Bar */}
      <div className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-zinc-800/80">
        <div className="min-w-0 flex-1 basis-[170px]">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs sm:text-sm font-semibold text-zinc-100 truncate">
              {camera.classroomName}
            </h3>
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                isBullyingStatus
                  ? 'text-orange-400'
                  : camera.status === 'fighting'
                    ? 'text-red-400'
                    : camera.status === 'warning'
                      ? 'text-amber-400'
                      : 'text-emerald-400'
              }`}
            >
              {camera.status === 'fighting' ? (
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : camera.status === 'warning' ? (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{statusLabel}</span>
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
            {isAudioOnly ? (
              <span className="font-mono text-zinc-300" data-testid={`camera-live-count-${camera.id}`}>
                Mic Only
              </span>
            ) : (
              <span className="font-mono text-zinc-300 tabular-nums" data-testid={`camera-live-count-${camera.id}`}>
                {camera.studentCount} {countWord}
              </span>
            )}
            <span aria-hidden="true"> · </span>
            <span className="font-mono" data-testid={`camera-cycle-label-${camera.id}`}>
              {camera.isAnalyzing ? 'Analyzing...' : scanModeLabel}
            </span>
            {!isAudioOnly && contactPairsCount > 0 ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-mono text-amber-400">{contactPairsCount} overlap</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onAnalyzeCamera(camera.id, false)}
            disabled={camera.isAnalyzing}
            aria-label={`Scan AI safety for ${camera.classroomName}`}
            title="Scan frame now"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-zinc-100 text-zinc-950 hover:bg-white disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <ScanSearch className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{camera.isAnalyzing ? 'Scanning' : 'Scan'}</span>
          </button>

          <button
            type="button"
            onClick={handleManualLockClick}
            aria-label={`Lock forensic DVR evidence for ${camera.classroomName}`}
            title="Save rolling WebM DVR video clip & forensic frames to Evidence Vault (SHA-256)"
            className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
              justLockedEvidence
                ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300'
                : 'bg-[#17181C] border-zinc-800 text-zinc-200 hover:text-white hover:border-zinc-700'
            }`}
          >
            <Video className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">
              {justLockedEvidence ? 'Clip Saved' : 'Save Clip'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleToggleLiveMic}
            aria-label={
              micActive
                ? `Stop live microphone on ${camera.classroomName}`
                : `Listen via microphone on ${camera.classroomName}`
            }
            title={micActive ? 'Stop live mic' : 'Enable live mic'}
            className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
              micActive
                ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                : 'bg-[#17181C] border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700'
            }`}
          >
            {micActive ? (
              <Mic className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <MicOff className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span className="hidden xl:inline">{micActive ? 'Live' : 'Mic'}</span>
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={isAutoAiOn}
            aria-label={`Toggle autonomous AI for ${camera.classroomName}`}
            onClick={() => onUpdateCameraSettings(camera.id, { autoAiEnabled: !isAutoAiOn })}
            className={`px-2 py-1.5 text-[11px] font-medium rounded-md border cursor-pointer whitespace-nowrap ${
              isAutoAiOn
                ? 'bg-emerald-950/50 text-emerald-300 border-emerald-700/60'
                : 'bg-[#17181C] text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
          >
            {isAutoAiOn ? 'Armed' : 'Paused'}
          </button>

          {!isFocused ? (
            <button
              type="button"
              onClick={() => onToggleFocus(camera.id)}
              aria-label={`Open dedicated place for ${camera.classroomName}`}
              title="Inspect camera details"
              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-zinc-800 bg-[#17181C] text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Inspect</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => onRemoveCamera(camera.id)}
            aria-label={`Remove ${camera.classroomName}`}
            title="Remove camera"
            className="p-1.5 text-zinc-500 hover:text-red-400 rounded-md hover:bg-zinc-800/80 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Real-Time Tracking, Auto-PTZ Zoom, Heatmap & Restricted Perimeter Strip (video feeds) */}
      {!isAudioOnly ? (
        <div className="px-3.5 py-2 border-t border-zinc-800/80 bg-[#0C0D11] space-y-2 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  onUpdateCameraSettings(camera.id, {
                    ptzAutoTrackEnabled: !ptzAutoTrackEnabled,
                  })
                }
                aria-pressed={ptzAutoTrackEnabled}
                aria-label={`Toggle digital Auto-PTZ zoom tracking for ${camera.classroomName}`}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer whitespace-nowrap ${
                  ptzAutoTrackEnabled
                    ? 'bg-sky-950/60 border-sky-500/60 text-sky-200'
                    : 'bg-[#14161B] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Focus className="w-3 h-3" aria-hidden="true" />
                <span>Auto-PTZ</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateCameraSettings(camera.id, { trailsEnabled: !trailsEnabled })
                }
                aria-pressed={trailsEnabled}
                aria-label={`Toggle movement trajectory trails for ${camera.classroomName}`}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer whitespace-nowrap ${
                  trailsEnabled
                    ? 'bg-sky-950/60 border-sky-500/60 text-sky-200'
                    : 'bg-[#14161B] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Route className="w-3 h-3" aria-hidden="true" />
                <span>Trails</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateCameraSettings(camera.id, { heatmapEnabled: !heatmapEnabled })
                }
                aria-pressed={heatmapEnabled}
                aria-label={`Toggle activity heatmap for ${camera.classroomName}`}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer whitespace-nowrap ${
                  heatmapEnabled
                    ? 'bg-amber-950/60 border-amber-500/60 text-amber-300'
                    : 'bg-[#14161B] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Flame className="w-3 h-3" aria-hidden="true" />
                <span>Heatmap</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (perimeterZone && !isDrawingZone) {
                    onUpdateCameraSettings(camera.id, { perimeterZone: null });
                  } else {
                    setIsDrawingZone((prev) => !prev);
                  }
                }}
                aria-label={
                  perimeterZone && !isDrawingZone
                    ? `Clear restricted perimeter on ${camera.classroomName}`
                    : `Draw restricted perimeter on ${camera.classroomName}`
                }
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer whitespace-nowrap ${
                  perimeterBreached
                    ? 'bg-red-950/80 border-red-500/70 text-red-200'
                    : isDrawingZone || perimeterZone
                      ? 'bg-amber-950/60 border-amber-500/60 text-amber-200'
                      : 'bg-[#14161B] border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700'
                }`}
              >
                <Crosshair className="w-3 h-3" aria-hidden="true" />
                <span>
                  {isDrawingZone
                    ? 'Cancel Draw'
                    : perimeterZone
                      ? 'Clear Zone'
                      : 'Draw Zone'}
                </span>
              </button>

              <span className="font-mono text-[10px] text-zinc-500 tabular-nums hidden sm:inline">
                {isRecordingVideo ? `REC · ${dvrFrameCount}f` : `DVR ${dvrFrameCount}f`}
              </span>
            </div>
          </div>

          {/* Live Tracked Subjects Strip: Click to lock Auto-PTZ or Flag to Cross-Camera Re-ID Watchlist */}
          {liveTrackedSubjects.length > 0 ? (
            <div className="pt-1.5 border-t border-zinc-800/70 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-mono text-zinc-500 uppercase mr-1">Tracked:</span>
              {liveTrackedSubjects.map((subj) => {
                const isLocked =
                  lockedPtzSubjectId === subj.id ||
                  (!lockedPtzSubjectId && liveTrackedSubjects[0]?.id === subj.id);
                const isHit = Boolean(subj.matchedWatchlistId);
                return (
                  <div
                    key={subj.id}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-mono tabular-nums ${
                      isHit
                        ? 'bg-red-950/70 border-red-500/70 text-red-100'
                        : isLocked && ptzAutoTrackEnabled
                          ? 'bg-sky-950/50 border-sky-500/50 text-sky-100'
                          : 'bg-[#14161B] border-zinc-800 text-zinc-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setLockedPtzSubjectId(subj.id)}
                      title={`Lock Auto-PTZ onto ${subj.id}`}
                      className="hover:underline cursor-pointer"
                    >
                      {isHit ? `${subj.matchedWatchlistLabel} ${subj.matchedSimilarity}%` : subj.id}
                      {subj.dwellSeconds > 0 ? ` · ${subj.dwellSeconds}s` : ''}
                    </button>
                    {!isHit && onEnrollLiveSubject ? (
                      <button
                        type="button"
                        onClick={() => handleFlagLiveSubject(subj)}
                        title={`Flag ${subj.id} to Cross-Camera Re-ID Watchlist`}
                        className="inline-flex items-center gap-0.5 pl-1.5 border-l border-zinc-700 text-amber-300 hover:text-amber-200 cursor-pointer font-sans font-medium"
                      >
                        <UserPlus className="w-3 h-3" aria-hidden="true" />
                        <span>Flag</span>
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Stream / Error Alerts (only rendered if present) */}
      {streamError || camera.errorMessage || micError ? (
        <div className="px-3.5 py-2 border-t border-zinc-800/80 bg-[#0D0E12] text-xs space-y-1">
          {streamError ? (
            <p role="alert" className="text-amber-400 font-medium">
              {streamError}
            </p>
          ) : null}
          {camera.errorMessage ? (
            <p role="alert" className="text-red-400 font-medium">
              {camera.errorMessage}
            </p>
          ) : null}
          {micError ? <p className="text-amber-400">{micError}</p> : null}
        </div>
      ) : null}

      {/* Focused Command Strip: Live Voice Cue Editor & Threat Assessment (shown cleanly only in Focused Inspect View) */}
      {isFocused ? (
        <div className="px-3.5 py-3 border-t border-zinc-800/80 bg-[#0C0D10] space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-zinc-400 font-medium">Audio Cue</span>
              <span className="text-zinc-600" aria-hidden="true">·</span>
              <span className="font-mono text-[11px] text-zinc-500">
                {camera.bluetoothDeviceName} ({camera.bluetoothAddress})
              </span>
            </div>
            <div className="flex items-center gap-3">
              {editingTotal ? (
                <form
                  className="inline-flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const num = Number(totalDraft);
                    onUpdateCameraSettings(camera.id, {
                      expectedTotalCount: Number.isFinite(num) && num > 0 ? Math.round(num) : undefined,
                    });
                    setEditingTotal(false);
                  }}
                >
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    aria-label={`Class total for ${camera.classroomName}`}
                    value={totalDraft}
                    onChange={(e) => setTotalDraft(e.target.value)}
                    className="w-14 text-xs px-1.5 py-0.5 border border-zinc-700 rounded bg-[#09090B] text-zinc-100"
                  />
                  <button
                    type="submit"
                    className="text-[11px] font-semibold text-zinc-100 hover:underline cursor-pointer"
                  >
                    Save
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingTotal(true)}
                  className="text-xs text-zinc-400 hover:text-zinc-100 cursor-pointer whitespace-nowrap"
                >
                  Total:{' '}
                  <span className="font-mono text-zinc-200 tabular-nums">
                    {typeof camera.expectedTotalCount === 'number' && camera.expectedTotalCount > 0
                      ? camera.expectedTotalCount
                      : 'Set'}
                  </span>
                </button>
              )}
              {camera.liveTranscript && !editingVoice ? (
                <button
                  type="button"
                  onClick={() => onUpdateTranscript(camera.id, '', undefined, 'audio-meter')}
                  className="text-xs text-zinc-500 hover:text-zinc-200 cursor-pointer"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setEditingVoice((prev) => !prev)}
                className="text-xs text-zinc-300 hover:text-white cursor-pointer whitespace-nowrap"
              >
                {editingVoice ? 'Cancel' : 'Edit cue'}
              </button>
              <button
                type="button"
                onClick={() => onToggleVoiceListening(camera.id)}
                className="text-xs text-zinc-300 hover:text-white font-medium cursor-pointer whitespace-nowrap"
              >
                {camera.voiceListeningEnabled ? 'Mute' : 'Unmute'}
              </button>
            </div>
          </div>

          {editingVoice ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onUpdateTranscript(camera.id, voiceDraft.trim(), undefined, 'manual');
                setEditingVoice(false);
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                aria-label={`Voice transcript for ${camera.classroomName}`}
                value={voiceDraft}
                onChange={(e) => setVoiceDraft(e.target.value)}
                className="flex-1 min-w-0 text-xs px-2.5 py-1.5 border border-zinc-700 rounded-md bg-[#09090B] text-zinc-100 focus-visible:outline-2 focus-visible:outline-zinc-400"
                placeholder="Type speech or distress phrase..."
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-zinc-100 text-zinc-950 hover:bg-white cursor-pointer shrink-0"
              >
                Save
              </button>
            </form>
          ) : (
            <p
              data-testid={`live-speech-${camera.id}`}
              className="text-zinc-300 leading-relaxed"
            >
              {camera.voiceListeningEnabled
                ? camera.liveTranscript ||
                  (micActive
                    ? 'Listening live for speech...'
                    : 'No speech captured yet · Click Mic or Edit cue to test voice alerts.')
                : 'Voice monitoring muted for this camera.'}
            </p>
          )}

          {camera.lastAnalysis ? (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/70">
              <p className="text-zinc-400 leading-relaxed flex-1 min-w-0">
                <span className="text-zinc-200 font-medium">
                  Assessment{modelLabel ? ` (${modelLabel})` : ''}:
                </span>{' '}
                {camera.lastAnalysis.summary}
              </p>
              <select
                aria-label={`AI model for ${camera.classroomName}`}
                value={activeCameraAiModel}
                onChange={(e) =>
                  onUpdateCameraSettings(camera.id, { aiModel: e.target.value as AiEngineModel })
                }
                className="text-[11px] bg-[#17181C] border border-zinc-800 rounded px-2 py-1 text-zinc-300 shrink-0"
              >
                <option value="gemini-4-neon">Gemini 4 Neon</option>
                <option value="gemini-4-hydrogen">Gemini 4 Hydrogen</option>
                <option value="gpt-6-astra">GPT-6 Astra</option>
                <option value="gpt-6-sol">GPT-6 Sol</option>
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
