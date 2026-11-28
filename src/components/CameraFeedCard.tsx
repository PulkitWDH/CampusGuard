import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Video,
  X,
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
  OperationMode,
  PerimeterZone,
  PerimeterZonePreset,
  ThreatSensitivity,
  TrackedSubject,
  WatchlistLabelMode,
  WatchlistSubject,
} from '../types';
import { captureCanvasJpegBase64 } from '../utils/mediaCapture';
import {
  detectPeopleLocallyOnCanvas,
  ensureLocalPersonDetector,
  getLocalDetectorStatus,
  resetLocalPersonDetectorForRetry,
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
  PERIMETER_ZONE_PRESETS,
  createActivityHeatmap,
  detectPerimeterBreaches,
  getDefaultPerimeterPreset,
  mapIronbowColor,
  normalizeDragToPerimeterZone,
  pushRollingDvrFrame,
  updateActivityHeatmap,
} from '../utils/tacticalForensics';
import {
  type PtzViewportRect,
  computePeakTrailVelocity,
  computeSmoothPtzViewport,
  easePtzViewportToFull,
  extractAppearanceSignature,
  getWatchlistModeMeta,
  mapBoxThroughPtzViewport,
  mapPointThroughPtzViewport,
  matchSubjectsToWatchlist,
  updateTrackedSubjects,
} from '../utils/subjectIntelligence';
import {
  computeNoseAnchor,
  drawBodyOnlyHighlight,
  findHoveredBodySubject,
} from '../utils/bodySilhouette';
import {
  getAdaptiveRenderProfile,
  globalEdgeInferenceScheduler,
} from '../utils/cameraScaleEngine';
import {
  type Point2D,
  advanceSmoothedDisplayPoint,
  buildSmoothTrailSpline,
} from '../utils/trailSmoothing';

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
  operationMode?: OperationMode;
  watchlistLabelMode?: WatchlistLabelMode;
  threatSensitivity: ThreatSensitivity;
  defaultAiModel: AiEngineModel;
  dbCalibrationOffset?: number;
  cloudQuotaExhausted?: boolean;
  isFocused: boolean;
  visibleCameraCount?: number;
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
  onSubjectTelemetry?: (
    cameraId: string,
    telemetry: {
      peakTrailVelocity: number;
      fallenSubjects: TrackedSubject[];
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

function CameraFeedCardInner({
  camera,
  facilityMode,
  operationMode = 'school',
  watchlistLabelMode = operationMode === 'disaster' ? 'missing-person' : 'security',
  threatSensitivity,
  defaultAiModel,
  dbCalibrationOffset = DEFAULT_DB_CALIBRATION_OFFSET,
  cloudQuotaExhausted = false,
  isFocused,
  visibleCameraCount = 1,
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
  onSubjectTelemetry,
  onReconnectStream,
  onAnalyzeCamera,
  onToggleVoiceListening,
  onUpdateTranscript,
  onUpdateCameraSettings,
  onToggleFocus,
  onRemoveCamera,
}: CameraFeedCardProps) {
  const isDisasterMode = operationMode === 'disaster';
  const watchlistMeta = getWatchlistModeMeta(watchlistLabelMode);
  const operationModeRef = useRef<OperationMode>(operationMode);
  operationModeRef.current = operationMode;
  const watchlistLabelModeRef = useRef<WatchlistLabelMode>(watchlistLabelMode);
  watchlistLabelModeRef.current = watchlistLabelMode;
  const [zonePreset, setZonePreset] = useState<PerimeterZonePreset>(() =>
    PERIMETER_ZONE_PRESETS.includes(camera.perimeterZone?.label as PerimeterZonePreset)
      ? (camera.perimeterZone!.label as PerimeterZonePreset)
      : getDefaultPerimeterPreset(operationMode)
  );
  useEffect(() => {
    if (camera.perimeterZone?.label && PERIMETER_ZONE_PRESETS.includes(camera.perimeterZone.label as PerimeterZonePreset)) {
      setZonePreset(camera.perimeterZone.label as PerimeterZonePreset);
    } else if (!camera.perimeterZone) {
      setZonePreset(getDefaultPerimeterPreset(operationMode));
    }
  }, [camera.perimeterZone, operationMode]);
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
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
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
  const onSubjectTelemetryRef = useRef(onSubjectTelemetry);
  onSubjectTelemetryRef.current = onSubjectTelemetry;
  const watchlistRef = useRef<WatchlistSubject[]>(watchlist);
  watchlistRef.current = watchlist;

  // Real-Time Subject Tracking, Auto-PTZ Zoom, Re-ID Watchlist, Heatmap, Perimeter & Black-Box Video DVR
  const ptzAutoTrackEnabled = Boolean(camera.ptzAutoTrackEnabled);
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
  const isDrawingZoneRef = useRef(false);
  isDrawingZoneRef.current = isDrawingZone;
  const dragStartPxRef = useRef<{ x: number; y: number } | null>(null);
  const dragCurrentPxRef = useRef<{ x: number; y: number } | null>(null);
  const heatmapGridRef = useRef<Float32Array>(createActivityHeatmap(HEATMAP_COLS, HEATMAP_ROWS));
  const dvrBufferRef = useRef<DvrEvidenceFrame[]>([]);
  const [dvrFrameCount, setDvrFrameCount] = useState(0);
  const [justLockedEvidence, setJustLockedEvidence] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);

  // Interactive ONLY-BODY Person Picker (Green default -> Red on cursor hover) for Trail, Flag & PTZ
  const [pickMode, setPickMode] = useState<'trail' | 'flag' | 'ptz' | null>(null);
  const pickModeRef = useRef<'trail' | 'flag' | 'ptz' | null>(null);
  pickModeRef.current = pickMode;
  const [hoveredSubjectId, setHoveredSubjectId] = useState<string | null>(null);
  const hoveredSubjectIdRef = useRef<string | null>(null);
  const lastPickerPointerPxRef = useRef<{ x: number; y: number } | null>(null);
  const [selectedTrailSubjectIds, setSelectedTrailSubjectIds] = useState<string[]>([]);
  const selectedTrailSubjectIdsRef = useRef<string[]>([]);
  selectedTrailSubjectIdsRef.current = selectedTrailSubjectIds;
  const [pickFeedback, setPickFeedback] = useState<string | null>(null);
  const pickFeedbackTimerRef = useRef<number | null>(null);

  const showPickFeedback = (message: string) => {
    setPickFeedback(message);
    if (pickFeedbackTimerRef.current !== null) {
      window.clearTimeout(pickFeedbackTimerRef.current);
    }
    pickFeedbackTimerRef.current = window.setTimeout(() => {
      setPickFeedback(null);
      pickFeedbackTimerRef.current = null;
    }, 2400);
  };

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
  const smoothedDisplayNoseRef = useRef<Map<string, Point2D>>(new Map());
  const lastTrailRenderMsRef = useRef<number>(0);

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

  useEffect(() => {
    return () => {
      if (pickFeedbackTimerRef.current !== null) {
        window.clearTimeout(pickFeedbackTimerRef.current);
      }
    };
  }, []);

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
    const scaleX = 640 / Math.max(1, rect.width);
    const scaleY = 360 / Math.max(1, rect.height);
    return {
      x: Math.max(0, Math.min(640, (e.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(360, (e.clientY - rect.top) * scaleY)),
    };
  };

  const togglePickMode = (mode: 'trail' | 'flag' | 'ptz') => {
    setIsDrawingZone(false);
    setPickMode((prev) => {
      const next = prev === mode ? null : mode;
      if (!next) {
        lastPickerPointerPxRef.current = null;
        hoveredSubjectIdRef.current = null;
        setHoveredSubjectId(null);
      }
      return next;
    });
  };

  const handleCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (isAudioOnly) return;

    if (pickModeRef.current !== null) {
      const pt = getCanvasPointFromPointer(e);
      const hit = findHoveredBodySubject(pt, trackedSubjectsRef.current, lastDrawRectRef.current);
      if (!hit) return;

      if (pickModeRef.current === 'trail') {
        const alreadySelected = selectedTrailSubjectIdsRef.current.includes(hit.id);
        const nextIds = alreadySelected
          ? selectedTrailSubjectIdsRef.current.filter((id) => id !== hit.id)
          : [...selectedTrailSubjectIdsRef.current, hit.id];
        selectedTrailSubjectIdsRef.current = nextIds;
        setSelectedTrailSubjectIds(nextIds);
        if (!trailsEnabledRef.current) {
          onUpdateCameraSettings(camera.id, { trailsEnabled: true });
        }
        showPickFeedback(
          alreadySelected
            ? `Removed nose trail from ${hit.id}`
            : `Nose trail locked on ${hit.id}`
        );
      } else if (pickModeRef.current === 'flag') {
        handleFlagLiveSubject(hit);
        showPickFeedback(`Registered ${hit.id} to ${watchlistMeta.title}`);
        lastPickerPointerPxRef.current = null;
        hoveredSubjectIdRef.current = null;
        setHoveredSubjectId(null);
        setPickMode(null);
      } else if (pickModeRef.current === 'ptz') {
        setLockedPtzSubjectId(hit.id);
        onUpdateCameraSettings(camera.id, { ptzAutoTrackEnabled: true });
        showPickFeedback(`Auto-PTZ locked on ${hit.id}`);
        lastPickerPointerPxRef.current = null;
        hoveredSubjectIdRef.current = null;
        setHoveredSubjectId(null);
        setPickMode(null);
      }
      return;
    }

    if (!isDrawingZone) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getCanvasPointFromPointer(e);
    dragStartPxRef.current = pt;
    dragCurrentPxRef.current = pt;
  };

  const handleCanvasPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (isAudioOnly) return;
    if (isDrawingZone && dragStartPxRef.current) {
      dragCurrentPxRef.current = getCanvasPointFromPointer(e);
      return;
    }
    if (pickModeRef.current !== null) {
      const pt = getCanvasPointFromPointer(e);
      lastPickerPointerPxRef.current = pt;
      const hit = findHoveredBodySubject(pt, trackedSubjectsRef.current, lastDrawRectRef.current);
      const nextId = hit?.id ?? null;
      if (hoveredSubjectIdRef.current !== nextId) {
        hoveredSubjectIdRef.current = nextId;
        setHoveredSubjectId(nextId);
      }
    }
  };

  const handleCanvasPointerLeave = () => {
    lastPickerPointerPxRef.current = null;
    if (hoveredSubjectIdRef.current !== null) {
      hoveredSubjectIdRef.current = null;
      setHoveredSubjectId(null);
    }
  };

  const handleCanvasPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingZone || !dragStartPxRef.current) return;
    const endPt = getCanvasPointFromPointer(e);
    const createdZone = normalizeDragToPerimeterZone(
      dragStartPxRef.current,
      endPt,
      lastDrawRectRef.current,
      zonePreset
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
    } else {
      // Never fall back to canvasRef.current (it contains HUD boxes & Auto-PTZ inset which would double-count people)
      return null;
    }

    // Preserve true camera aspect ratio (e.g. portrait phone 360x640 vs landscape laptop 640x360)
    // and retain up to 1080px detail on focused/1-2 camera views so dense crowd zoom tiles stay razor sharp!
    const maxInferenceDim = isFocused || visibleCameraCount <= 2 ? 1080 : 640;
    const fitted = computeAspectPreservingSize(srcW, srcH, maxInferenceDim);
    if (targetCanvas.width !== fitted.width) targetCanvas.width = fitted.width;
    if (targetCanvas.height !== fitted.height) targetCanvas.height = fitted.height;

    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
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

  // Preload zero-quota on-device TensorFlow.js COCO-SSD person + weapon detector with automatic retry
  useEffect(() => {
    if (isAudioOnly) {
      localEdgeReadyRef.current = false;
      setLocalEdgeState('fallback');
      return;
    }
    let cancelled = false;
    let retryTimer: number | null = null;
    let attempt = 0;

    const loadDetector = () => {
      attempt += 1;
      if (!cancelled && attempt > 1) {
        setLocalEdgeState('loading');
        setScanModeLabel(`Retrying Edge AI model (${attempt}/3)...`);
      }
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
          if (cancelled) return;
          if (attempt < 3) {
            resetLocalPersonDetectorForRetry();
            retryTimer = window.setTimeout(loadDetector, attempt * 2000);
          } else {
            localEdgeReadyRef.current = false;
            setLocalEdgeState('fallback');
            setScanModeLabel('Cloud AI fallback · Edge model unavailable');
          }
        });
    };

    loadDetector();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [hasLiveSignal, isAudioOnly, liveMediaStream]);

  // Real-time zero-quota on-device Edge AI person + weapon + visual threat engine (runs every 300ms)
  useEffect(() => {
    if (isAudioOnly || !isAutoAiOn || !hasLiveSignal || localEdgeState !== 'ready') {
      return;
    }

    let cancelled = false;
    let lastStaticCrowdUrl = '';
    let lastStaticCrowdAtMs = 0;

    const runEdgeDetect = async () => {
      if (cancelled || localDetectInFlightRef.current || !hasLiveFrameRef.current) return;

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

      // Avoid repeating heavy 12-tile deep crowd scans on an unchanged static photo every 300ms
      const isStaticImage = camera.customMediaType === 'image' && Boolean(camera.customMediaUrl);
      if (
        isStaticImage &&
        lastStaticCrowdUrl === camera.customMediaUrl &&
        instantDelta < 0.5 &&
        Date.now() - lastStaticCrowdAtMs < 6000
      ) {
        return;
      }

      const clean = captureCleanFrameRef.current();
      if (!clean || !rawCaptureCanvasRef.current) return;

      localDetectInFlightRef.current = true;
      try {
        const rawCanvas = rawCaptureCanvasRef.current;
        const allowDeepCrowdScan = isFocused || visibleCameraCount <= 2;
        const {
          people: rawPeople,
          weakPeople,
          dangerousObjects,
          occluderObjects,
          inferenceMs,
          backend,
          crowdScanUsed,
        } = await detectPeopleLocallyOnCanvas(rawCanvas, 28, {
          hadTrackedPeople: personTrackerStateRef.current.confirmed.length > 0,
          allowDeepCrowdScan,
        });
        if (cancelled) return;
        consecutiveEdgeErrorsRef.current = 0;
        if (isStaticImage && crowdScanUsed) {
          lastStaticCrowdUrl = camera.customMediaUrl || '';
          lastStaticCrowdAtMs = Date.now();
        }

        // Lightweight 6x4 lower-torso patch sampler (only needed for sparse rooms, skipped for 20+ crowds for speed)
        const sampleTorsoSignature =
          rawPeople.length >= 20
            ? undefined
            : (box_2d: [number, number, number, number]): number[] | null => {
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
            instantConfidence: crowdScanUsed ? 22 : 76,
            minConfidence: crowdScanUsed ? 22 : 26,
            maxMissedFrames: 2,
            maxOccludedFrames: 10,
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
        // Scale maxAgeMs to tolerate slow software WebGL or static-image crowd throttle windows without churning IDs
        const nowTrackMs = Date.now();
        const trackedStep = updateTrackedSubjects(
          trackedSubjectsRef.current,
          people,
          nowTrackMs,
          nextSubjectNumericIdRef.current,
          { maxAgeMs: Math.max(20_000, inferenceMs * 4) }
        );
        nextSubjectNumericIdRef.current = trackedStep.nextNumericId;
        let nextTracked = trackedStep.subjects;

        // Extract real 36-bin spatial HSV appearance signatures directly from raw frame pixels
        // (For 20+ dense crowds with empty watchlist, defer signature extraction to on-demand Flag click for 0ms latency)
        try {
          const shouldExtractSigs = nextTracked.length > 0 && (nextTracked.length < 20 || watchlistRef.current.length > 0);
          const rctx = shouldExtractSigs ? rawCanvas.getContext('2d', { willReadFrequently: true }) : null;
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
        const peakTrailVelocity = computePeakTrailVelocity(nextTracked);
        const fallenSubjects = nextTracked.filter((s) => Boolean(s.isFallenVictim));
        onSubjectTelemetryRef.current?.(camera.id, {
          peakTrailVelocity,
          fallenSubjects,
        });
        if (pickModeRef.current !== null && lastPickerPointerPxRef.current) {
          const liveHit = findHoveredBodySubject(
            lastPickerPointerPxRef.current,
            nextTracked,
            lastDrawRectRef.current
          );
          const nextHoverId = liveHit?.id ?? null;
          if (hoveredSubjectIdRef.current !== nextHoverId) {
            hoveredSubjectIdRef.current = nextHoverId;
            setHoveredSubjectId(nextHoverId);
          }
        }
        const trackedUiSig = nextTracked
          .map(
            (s) =>
              `${s.id}:${s.dwellSeconds}:${s.matchedWatchlistId ?? ''}:${s.matchedSimilarity ?? 0}:${s.isFallenVictim ? 'F' : ''}`
          )
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
        // (Still uploaded photos automatically skip kinetic bullying/fight/beating alerts and stay in Count & Density mode)
        const isStillPhoto = camera.customMediaType === 'image';
        const threatEval = evaluateRealtimeEdgeThreat(edgeThreatStateRef.current, {
          people,
          dangerousObjects,
          frameDeltaPercent: isStillPhoto ? 0 : instantDelta,
          voiceTranscript: !isStillPhoto && voiceListeningRef.current ? liveTranscriptRef.current : '',
          audioLevel: !isStillPhoto && voiceListeningRef.current ? audioLevelRef.current : 0,
          facilityMode: facilityModeRef.current,
          operationMode: operationModeRef.current,
          isStillImage: isStillPhoto,
          sensitivity: threatSensitivityRef.current,
          nowMs: Date.now(),
        });
        edgeThreatStateRef.current = threatEval.nextState;
        setContactPairsCount(isStillPhoto ? 0 : threatEval.contactPairs);

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
          if (isStillPhoto) {
            setScanModeLabel(`Still Photo · Count & Density (${backendTag}) · ${inferenceMs}ms`);
          } else {
            const engineTag = crowdScanUsed ? `Crowd AI (${backendTag})` : `Edge AI (${backendTag})`;
            setScanModeLabel(
              cloudQuotaExhaustedRef.current
                ? `${engineTag} · ${inferenceMs}ms`
                : `${engineTag} + Cloud · ${inferenceMs}ms`
            );
          }
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

    const renderProfile = getAdaptiveRenderProfile(visibleCameraCount, isFocused);
    const scheduleEdgeDetect = () => {
      if (cancelled || localDetectInFlightRef.current || !hasLiveFrameRef.current) return;
      const priority =
        isFocused || cameraStatusRef.current === 'fighting' || cameraStatusRef.current === 'warning'
          ? 0
          : 1;
      void globalEdgeInferenceScheduler.schedule(camera.id, priority, runEdgeDetect);
    };

    scheduleEdgeDetect();
    const edgeTimer = window.setInterval(scheduleEdgeDetect, renderProfile.inferenceIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(edgeTimer);
      globalEdgeInferenceScheduler.cancel(camera.id);
    };
  }, [camera.id, hasLiveSignal, isAudioOnly, isAutoAiOn, isFocused, localEdgeState, visibleCameraCount]);

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
      const vid = videoRef.current;
      vid.muted = true;
      vid.playsInline = true;
      vid.setAttribute('playsinline', 'true');
      vid.setAttribute('webkit-playsinline', 'true');
      if (vid.srcObject !== liveMediaStream) {
        vid.srcObject = liveMediaStream;
      }
      const ensurePlaying = () => {
        if (
          vid.srcObject === liveMediaStream &&
          liveMediaStream.active &&
          liveMediaStream.getVideoTracks().some((t) => t.readyState === 'live') &&
          vid.paused
        ) {
          void vid.play().catch(() => {});
        }
      };
      ensurePlaying();
      const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
          ensurePlaying();
        }
      };
      vid.addEventListener('pause', ensurePlaying);
      document.addEventListener('visibilitychange', handleVisibility);
      return () => {
        vid.removeEventListener('pause', ensurePlaying);
        document.removeEventListener('visibilitychange', handleVisibility);
      };
    }

    if (camera.customMediaUrl && camera.customMediaType === 'video' && videoRef.current) {
      const vid = videoRef.current;
      vid.muted = true;
      vid.playsInline = true;
      vid.setAttribute('playsinline', 'true');
      vid.setAttribute('webkit-playsinline', 'true');
      vid.srcObject = null;
      vid.src = camera.customMediaUrl;
      vid.loop = true;
      void vid.play().catch(() => {});
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
          const ctx = canvas?.getContext('2d');
          if (canvas && ctx) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
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

      // Adaptive GPU resolution scaling: Full HD 1920x1080 on 1 cam, 1280x720 on 2x2, 960x540 on 3x3, 640x360 on 4x4
      const activeVideo = videoRef.current;
      const activeImg = loadedImageRef.current;
      const sourceW =
        activeVideo && activeVideo.videoWidth > 0
          ? activeVideo.videoWidth
          : activeImg && activeImg.naturalWidth > 0
            ? activeImg.naturalWidth
            : 1280;
      const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
      const profile = getAdaptiveRenderProfile(visibleCameraCount, isFocused, sourceW, dpr);
      if (canvas.width !== profile.targetWidth || canvas.height !== profile.targetHeight) {
        canvas.width = profile.targetWidth;
        canvas.height = profile.targetHeight;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Render in logical 640x360 HUD coordinates mapped 1:1 onto the Full HD GPU canvas
      const width = 640;
      const height = 360;
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
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
        const chartTop = 114;
        const chartBottom = height - 64;
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
        const thresholdLabel =
          operationModeRef.current === 'disaster'
            ? '90.1 dB COLLAPSE / DISTRESS'
            : '90.1 dB ALERT';
        ctx.fillText(
          thresholdLabel,
          operationModeRef.current === 'disaster' ? chartRight - 168 : chartRight - 84,
          thresholdY - 5
        );

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
        ctx.font = '700 32px "JetBrains Mono", monospace';
        ctx.fillText(`${dbVal.toFixed(1)} dB`, chartLeft, 72);

        ctx.fillStyle = '#a1a1aa';
        ctx.font = '500 10.5px "JetBrains Mono", monospace';
        const modeText = audioConnected
          ? operationModeRef.current === 'disaster'
            ? 'MICROPHONE ONLY · DISASTER DISTRESS & COLLAPSE AI'
            : 'MICROPHONE ONLY · LIVE ACOUSTIC & VOICE AI'
          : 'MICROPHONE ONLY · STANDBY (CLICK CONNECT LIVE MIC)';
        ctx.fillText(modeText, chartLeft, 94, Math.max(180, chartW - 16));

        // Live speech cue line
        const transcript = liveTranscriptRef.current.trim();
        ctx.fillStyle = transcript ? '#f4f4f5' : '#71717a';
        ctx.font = '500 12px "DM Sans", sans-serif';
        const cueLine = transcript
          ? `Speech: "${transcript.slice(0, 74)}"`
          : audioConnected
            ? operationModeRef.current === 'disaster'
              ? 'Listening for help, trapped, fire, earthquake, flood, collapse, medical, emergency...'
              : 'Listening for fight, beating, bullying, and distress speech...'
            : operationModeRef.current === 'disaster'
              ? 'Ready for >90.1 dB ACOUSTIC DISTRESS / STRUCTURAL COLLAPSE ALERT (rubble/smoke zones).'
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

        let activeSourceMedia: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null = null;
        let activeSourceW = 0;
        let activeSourceH = 0;

        if (hasVideoFeed && video) {
          activeSourceMedia = video;
          activeSourceW = video.videoWidth;
          activeSourceH = video.videoHeight;
          if (!hasLiveFrameRef.current) {
            hasLiveFrameRef.current = true;
            setHasLiveSignal(true);
          }
        } else if (
          loadedImageRef.current &&
          loadedImageRef.current.complete &&
          loadedImageRef.current.naturalWidth > 0
        ) {
          activeSourceMedia = loadedImageRef.current;
          activeSourceW = loadedImageRef.current.naturalWidth;
          activeSourceH = loadedImageRef.current.naturalHeight;
          if (!hasLiveFrameRef.current) {
            hasLiveFrameRef.current = true;
            setHasLiveSignal(true);
          }
        } else if (
          (camera.customMediaType === 'video' && Boolean(camera.customMediaUrl) && video && !video.error) ||
          (Boolean(liveMediaStream?.active) &&
            liveMediaStream!.getVideoTracks().some((t) => t.readyState === 'live'))
        ) {
          if (
            rawCaptureCanvasRef.current &&
            rawCaptureCanvasRef.current.width > 0 &&
            rawCaptureCanvasRef.current.height > 0
          ) {
            activeSourceMedia = rawCaptureCanvasRef.current;
            activeSourceW = rawCaptureCanvasRef.current.width;
            activeSourceH = rawCaptureCanvasRef.current.height;
          } else {
            ctx.fillStyle = '#0D131D';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '500 13px "DM Sans", sans-serif';
            const msg = 'Connecting live HD camera...';
            const m = ctx.measureText(msg);
            ctx.fillText(msg, Math.max(20, (width - m.width) / 2), height / 2);
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
                : camera.customMediaType === 'video' && Boolean(camera.customMediaUrl)
                  ? 'Loading uploaded video clip...'
                  : 'Feed offline · Click Reconnect Live Camera';
          const m = ctx.measureText(message);
          ctx.fillText(message, Math.max(20, (width - m.width) / 2), height / 2);
        }

        const trackedSubjects = trackedSubjectsRef.current;
        const allowPtzHere = getAdaptiveRenderProfile(visibleCameraCount, isFocused).allowAutoPtzInset;
        let ptzTargetSubj: TrackedSubject | null = null;

        if (activeSourceMedia && activeSourceW > 0 && activeSourceH > 0) {
          const drawRect = computeContainDrawRect(activeSourceW, activeSourceH, width, height);
          lastDrawRectRef.current = drawRect;

          // Broadcast-grade Full-Frame Digital Auto-PTZ:
          // Smoothly zooms & tracks locked person with exact aspect ratio preservation & zero jitter.
          // Automatically eases back to full wide view while picking a person or drawing a zone.
          const shouldTrackPtz =
            allowPtzHere &&
            ptzAutoTrackEnabledRef.current &&
            pickModeRef.current === null &&
            !isDrawingZoneRef.current &&
            trackedSubjects.length > 0;

          if (shouldTrackPtz) {
            ptzTargetSubj =
              trackedSubjects.find((s) => s.id === lockedPtzSubjectIdRef.current) ||
              trackedSubjects.find((s) => Boolean(s.matchedWatchlistId)) ||
              trackedSubjects[0];

            const srcAspect = activeSourceW / Math.max(1, activeSourceH);
            const destAspect = drawRect.width / Math.max(1, drawRect.height);
            ptzViewportRef.current = computeSmoothPtzViewport(
              ptzTargetSubj.box_2d,
              ptzViewportRef.current,
              0.1,
              {
                sourceAspect: srcAspect,
                targetAspect: destAspect,
                centerDeadband: 18,
                spanDeadband: 34,
              }
            );
          } else {
            ptzViewportRef.current = easePtzViewportToFull(ptzViewportRef.current, 0.16);
          }

          const activePtz = ptzViewportRef.current;
          if (activePtz) {
            const cropX = Math.max(0, (activePtz.xmin / 1000) * activeSourceW);
            const cropY = Math.max(0, (activePtz.ymin / 1000) * activeSourceH);
            const cropW = Math.max(
              16,
              Math.min(activeSourceW - cropX, ((activePtz.xmax - activePtz.xmin) / 1000) * activeSourceW)
            );
            const cropH = Math.max(
              16,
              Math.min(activeSourceH - cropY, ((activePtz.ymax - activePtz.ymin) / 1000) * activeSourceH)
            );
            ctx.drawImage(
              activeSourceMedia,
              cropX,
              cropY,
              cropW,
              cropH,
              drawRect.x,
              drawRect.y,
              drawRect.width,
              drawRect.height
            );
          } else {
            ctx.drawImage(
              activeSourceMedia,
              drawRect.x,
              drawRect.y,
              drawRect.width,
              drawRect.height
            );
          }
        } else {
          ptzViewportRef.current = null;
        }

        const activeRect = lastDrawRectRef.current;
        const activePtz = ptzViewportRef.current;

        // Spatial Activity Dwell Heatmap overlay (real accumulated person coordinates)
        if (heatmapEnabledRef.current && !activePtz) {
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

        // Silky 60 FPS Nose-Anchored Movement Trajectory Trails (Centripetal Catmull-Rom Splines)
        if (hasLiveFrameRef.current && trailsEnabledRef.current && trackedSubjects.length > 0) {
          const selectedIds = selectedTrailSubjectIdsRef.current;
          const trailSubjects =
            selectedIds.length > 0
              ? trackedSubjects.filter((s) => selectedIds.includes(s.id))
              : trackedSubjects;

          const trailDtMs =
            lastTrailRenderMsRef.current > 0
              ? Math.max(4, Math.min(100, timestamp - lastTrailRenderMsRef.current))
              : 16.67;
          lastTrailRenderMsRef.current = timestamp;

          const activeSubjectIds = new Set(trackedSubjects.map((s) => s.id));
          smoothedDisplayNoseRef.current.forEach((_val, key) => {
            if (!activeSubjectIds.has(key)) {
              smoothedDisplayNoseRef.current.delete(key);
            }
          });

          trailSubjects.forEach((subj) => {
            const targetNose = subj.smoothedNose ?? computeNoseAnchor(subj.box_2d);
            const prevDisplayNose = smoothedDisplayNoseRef.current.get(subj.id) ?? null;
            const liveNose = advanceSmoothedDisplayPoint(prevDisplayNose, targetNose, trailDtMs);
            smoothedDisplayNoseRef.current.set(subj.id, liveNose);

            const isWatchlistHit = Boolean(subj.matchedWatchlistId);
            const isPinnedTrail = selectedIds.includes(subj.id);

            // Convert trail history + 60fps damped live head into canvas pixel space
            const rawNormPts: Point2D[] =
              subj.trail.length > 0 ? [...subj.trail, liveNose] : [liveNose];
            const pixelWaypoints: Point2D[] = rawNormPts.map((pt) => {
              const mapped = mapPointThroughPtzViewport(pt, activePtz);
              return {
                x: activeRect.x + (mapped.x / 1000) * activeRect.width,
                y: activeRect.y + (mapped.y / 1000) * activeRect.height,
              };
            });

            const splinePts = buildSmoothTrailSpline(pixelWaypoints, {
              minControlSpacing: 3,
              laplacianPasses: 2,
              subdivisionsPerSegment: 8,
            });

            const rgb = isWatchlistHit
              ? '239, 68, 68'
              : isPinnedTrail
                ? '16, 185, 129'
                : '56, 189, 248';
            const anchorColor = isWatchlistHit ? '#ef4444' : isPinnedTrail ? '#10b981' : '#38bdf8';

            ctx.save();
            ctx.lineJoin = 'round';

            if (splinePts.length >= 2) {
              // 1. Subtle continuous soft halo ribbon along the entire smooth spline
              ctx.beginPath();
              ctx.moveTo(splinePts[0].x, splinePts[0].y);
              for (let i = 1; i < splinePts.length; i += 1) {
                ctx.lineTo(splinePts[i].x, splinePts[i].y);
              }
              ctx.lineCap = 'round';
              ctx.lineWidth = isPinnedTrail ? 7 : 6;
              ctx.strokeStyle = `rgba(${rgb}, 0.14)`;
              ctx.stroke();

              // 2. Tapered smooth comet core divided into contiguous bands with butt inner joins
              //    (zero overlapping round-cap knots, smooth alpha + width ramp from tail to nose)
              const bandCount = Math.min(16, Math.max(1, Math.floor((splinePts.length - 1) / 2)));
              const baseMaxWidth = isPinnedTrail ? 3.4 : 2.8;
              for (let b = 0; b < bandCount; b += 1) {
                const startIdx = Math.floor((b * (splinePts.length - 1)) / bandCount);
                const endIdx = Math.floor(((b + 1) * (splinePts.length - 1)) / bandCount);
                if (endIdx <= startIdx) continue;

                const midProgress = splinePts[Math.floor((startIdx + endIdx) / 2)].progress;
                // Smooth cubic ease-in for comet fade
                const alpha = 0.08 + Math.pow(midProgress, 1.35) * 0.86;
                const widthScale = 0.35 + midProgress * 0.65;

                ctx.beginPath();
                ctx.moveTo(splinePts[startIdx].x, splinePts[startIdx].y);
                for (let i = startIdx + 1; i <= endIdx; i += 1) {
                  ctx.lineTo(splinePts[i].x, splinePts[i].y);
                }
                ctx.lineCap = b === 0 || b === bandCount - 1 ? 'round' : 'butt';
                ctx.lineWidth = baseMaxWidth * widthScale;
                ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
                ctx.stroke();
              }
            }

            // Crisp 60 FPS gliding nose anchor dot & soft halo welded to the spline tip
            const headPt = mapPointThroughPtzViewport(liveNose, activePtz);
            const hx = activeRect.x + (headPt.x / 1000) * activeRect.width;
            const hy = activeRect.y + (headPt.y / 1000) * activeRect.height;

            ctx.fillStyle = `rgba(${rgb}, 0.24)`;
            ctx.beginPath();
            ctx.arc(hx, hy, 9, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = anchorColor;
            ctx.beginPath();
            ctx.arc(hx, hy, 4.2, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(hx, hy, 6.4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          });
        } else if (trackedSubjects.length === 0 && smoothedDisplayNoseRef.current.size > 0) {
          smoothedDisplayNoseRef.current.clear();
          lastTrailRenderMsRef.current = 0;
        }

        // Draw active Restricted Perimeter Zone or in-progress drag preview
        const activePerimeter = perimeterZoneRef.current;
        if (activePerimeter) {
          const pRect = mapNormalizedBoxToRect(
            mapBoxThroughPtzViewport(activePerimeter.box_2d, activePtz),
            activeRect
          );
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

        // Interactive ONLY-BODY Picker Mode (Trail / Flag / PTZ):
        // Everyone's BODY ONLY turns GREEN; hovered person's BODY ONLY turns RED (zero square boxes!)
        const activePickMode = pickModeRef.current;
        if (activePickMode !== null && hasLiveFrameRef.current && trackedSubjects.length > 0) {
          const livePointerHitId = lastPickerPointerPxRef.current
            ? findHoveredBodySubject(lastPickerPointerPxRef.current, trackedSubjects, activeRect)?.id ??
              null
            : null;
          const effectiveHoveredId = livePointerHitId ?? hoveredSubjectIdRef.current;

          trackedSubjects.forEach((subj) => {
            const mapped = mapNormalizedBoxToRect(
              mapBoxThroughPtzViewport(subj.box_2d, activePtz),
              activeRect
            );
            const isHovered = effectiveHoveredId === subj.id;
            const isSelected =
              activePickMode === 'trail' && selectedTrailSubjectIdsRef.current.includes(subj.id);
            const label = isHovered
              ? activePickMode === 'flag'
                ? `FLAG ${subj.id}`
                : activePickMode === 'ptz'
                  ? `LOCK PTZ · ${subj.id}`
                  : isSelected
                    ? `REMOVE TRAIL · ${subj.id}`
                    : `NOSE TRAIL · ${subj.id}`
              : isSelected
                ? `${subj.id} · TRAIL ON`
                : subj.id;

            drawBodyOnlyHighlight(ctx, mapped, {
              isHovered,
              isSelected,
              label,
            });
          });
        } else {
          // Standard grounded AI person bounding boxes with persistent Subject ID, Dwell Time & Watchlist Re-ID
          const boxes = detectedPeopleRef.current;
          if (hasLiveFrameRef.current && Array.isArray(boxes) && boxes.length > 0) {
            const isCritical = cameraStatusRef.current === 'fighting';
            const isBullying = threatCategoryRef.current === 'bullying';

            const isCrowdView = boxes.length >= 12;

            boxes.forEach((person, idx) => {
              const matchedSubj = trackedSubjects[idx];
              const isWatchlistHit = Boolean(matchedSubj?.matchedWatchlistId);
              const isFallenVictim = Boolean(matchedSubj?.isFallenVictim);
              const mapped = mapNormalizedBoxToRect(
                mapBoxThroughPtzViewport(person.box_2d, activePtz),
                activeRect
              );
              const x = Math.max(2, Math.min(width - 14, mapped.x));
              const y = Math.max(30, Math.min(height - 34, mapped.y));
              const bw = Math.max(12, Math.min(width - x - 2, mapped.width));
              const bh = Math.max(14, Math.min(height - y - 2, mapped.height));

              const isOccluded = Boolean(person.faceOccluded);
              const strokeColor =
                isFallenVictim || isWatchlistHit
                  ? '#ef4444'
                  : isBullying
                    ? '#f97316'
                    : isCritical
                      ? '#ef4444'
                      : isOccluded
                        ? '#38bdf8'
                        : '#10b981';
              const fillTint =
                isFallenVictim || isWatchlistHit
                  ? 'rgba(239, 68, 68, 0.22)'
                  : isCrowdView
                    ? 'rgba(16, 185, 129, 0.06)'
                    : isBullying
                      ? 'rgba(249, 115, 22, 0.14)'
                      : isCritical
                        ? 'rgba(239, 68, 68, 0.14)'
                        : isOccluded
                          ? 'rgba(56, 189, 248, 0.12)'
                          : 'rgba(16, 185, 129, 0.10)';
              const tagBg =
                isFallenVictim || isWatchlistHit
                  ? 'rgba(220, 38, 38, 0.96)'
                  : isBullying
                    ? 'rgba(194, 65, 12, 0.92)'
                    : isCritical
                      ? 'rgba(185, 28, 28, 0.92)'
                      : isOccluded
                        ? 'rgba(3, 105, 161, 0.92)'
                        : 'rgba(6, 95, 70, 0.88)';

              ctx.fillStyle = fillTint;
              ctx.fillRect(x, y, bw, bh);

              ctx.strokeStyle = strokeColor;
              ctx.lineWidth = isFallenVictim || isWatchlistHit ? 2.8 : isCrowdView ? 1.35 : 2;
              if (isOccluded && !isCritical && !isWatchlistHit && !isFallenVictim) {
                ctx.setLineDash([6, 4]);
              }
              ctx.strokeRect(x, y, bw, bh);
              ctx.setLineDash([]);

              if (!isCrowdView || isWatchlistHit || isFallenVictim) {
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
              }

              const subjectPrefix = matchedSubj ? matchedSubj.id : `#${idx + 1}`;
              const dwellSuffix =
                matchedSubj && matchedSubj.dwellSeconds > 0 ? ` · ${matchedSubj.dwellSeconds}s` : '';
              const activeMatchPrefix = getWatchlistModeMeta(watchlistLabelModeRef.current).matchTagPrefix;
              const fallenSec = matchedSubj?.fallenDurationMs
                ? `${(matchedSubj.fallenDurationMs / 1000).toFixed(1)}s`
                : '1.5s+';
              const tagText = isFallenVictim
                ? `FALLEN VICTIM · ${subjectPrefix} (${fallenSec})`
                : isWatchlistHit
                  ? `${activeMatchPrefix}: ${matchedSubj?.matchedWatchlistLabel} ${matchedSubj?.matchedSimilarity}%`
                  : isCrowdView
                    ? `${idx + 1}`
                    : isOccluded
                      ? `${subjectPrefix}${dwellSuffix} · OCCLUDED`
                      : `${subjectPrefix}${dwellSuffix} · ${person.confidence}%`;

              ctx.font = isCrowdView && !isWatchlistHit && !isFallenVictim
                ? '700 8.5px "JetBrains Mono", monospace'
                : '600 11px "JetBrains Mono", monospace';
              const tagH = isCrowdView && !isWatchlistHit ? 12 : 18;
              const padX = isCrowdView && !isWatchlistHit ? 3 : 6;
              const textW = ctx.measureText(tagText).width;
              const tagW = Math.min(width - 8, Math.ceil(textW) + padX * 2);
              const tagX = Math.max(2, Math.min(x, width - tagW - 2));
              const rawTagY = y >= 50 ? y - tagH - 1 : Math.min(height - 44, y + 2);
              let tagY = Math.max(30, Math.min(height - 44, rawTagY));
              if (!isCrowdView && tagY < 88 && tagX + tagW > width - 150) {
                tagY = Math.min(height - 54, Math.max(90, y + 6));
              }
              ctx.fillStyle = tagBg;
              ctx.fillRect(tagX, tagY, tagW, tagH);
              ctx.fillStyle = '#ffffff';
              ctx.fillText(tagText, tagX + padX, tagY + (isCrowdView && !isWatchlistHit ? 9 : 13), tagW - padX * 2);
            });
          }
        }

        // Clean Wide-Angle Room Radar Mini-Map when Full-Frame Auto-PTZ is actively zoomed in
        if (
          activePtz &&
          ptzAutoTrackEnabledRef.current &&
          ptzTargetSubj &&
          activeSourceMedia &&
          activeSourceW > 0 &&
          activeSourceH > 0
        ) {
          const mapMaxW = 136;
          const mapMaxH = 78;
          const mapFit = computeContainDrawRect(activeSourceW, activeSourceH, mapMaxW, mapMaxH);
          const mapW = Math.max(64, Math.round(mapFit.width));
          const mapH = Math.max(44, Math.round(mapFit.height));
          const mapX = width - mapW - 10;
          const mapY = height - mapH - 36;
          const isHit = Boolean(ptzTargetSubj.matchedWatchlistId);

          ctx.save();
          ctx.fillStyle = 'rgba(9, 12, 18, 0.88)';
          ctx.fillRect(mapX - 2, mapY - 17, mapW + 4, mapH + 19);

          ctx.globalAlpha = 0.88;
          ctx.drawImage(activeSourceMedia, mapX, mapY, mapW, mapH);
          ctx.globalAlpha = 1;

          // Live PTZ zoom frame box inside the wide-angle radar mini-map
          const fx = mapX + (activePtz.xmin / 1000) * mapW;
          const fy = mapY + (activePtz.ymin / 1000) * mapH;
          const fw = ((activePtz.xmax - activePtz.xmin) / 1000) * mapW;
          const fh = ((activePtz.ymax - activePtz.ymin) / 1000) * mapH;
          ctx.strokeStyle = isHit ? '#ef4444' : '#38bdf8';
          ctx.lineWidth = 1.75;
          ctx.strokeRect(fx, fy, fw, fh);

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 1;
          ctx.strokeRect(mapX - 1, mapY - 16, mapW + 2, mapH + 17);

          ctx.fillStyle = isHit ? 'rgba(185, 28, 28, 0.94)' : 'rgba(9, 12, 18, 0.94)';
          ctx.fillRect(mapX - 1, mapY - 16, mapW + 2, 16);
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 8.5px "JetBrains Mono", monospace';
          const ptzBadge = `PTZ ${activePtz.zoomFactor.toFixed(1)}x · ${ptzTargetSubj.id}`;
          ctx.fillText(ptzBadge, mapX + 4, mapY - 5, mapW - 8);
          ctx.restore();
        }

        // Draw crimson bounding boxes for any detected weapon objects
        const weapons = detectedObjectsRef.current;
        if (hasLiveFrameRef.current && Array.isArray(weapons) && weapons.length > 0) {
          weapons.forEach((weapon) => {
            const mapped = mapNormalizedBoxToRect(
              mapBoxThroughPtzViewport(weapon.box_2d, activePtz),
              activeRect
            );
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

    const targetProfile = getAdaptiveRenderProfile(visibleCameraCount, isFocused);
    const minFrameMs = Math.max(33, Math.round(1000 / Math.min(30, targetProfile.targetFps)));
    let rafId = 0;
    let lastDrawnAt = 0;

    const rafLoop = (now: number) => {
      rafId = window.requestAnimationFrame(rafLoop);
      if (document.hidden) return;
      if (now - lastDrawnAt >= minFrameMs) {
        lastDrawnAt = now;
        drawFrame(now);
      }
    };

    drawFrame(performance.now());
    rafId = window.requestAnimationFrame(rafLoop);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    camera.bluetoothDeviceName,
    camera.cameraCode,
    camera.customMediaType,
    camera.customMediaUrl,
    camera.sourceKind,
    isAudioOnly,
    isFocused,
    liveMediaStream,
    visibleCameraCount,
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

  const hasLiveVideoStream =
    Boolean(liveMediaStream?.active) &&
    Boolean(liveMediaStream?.getVideoTracks().some((t) => t.readyState === 'live'));

  const isAudioStreamLive =
    isAudioOnly &&
    ((Boolean(liveMediaStream?.active) &&
      Boolean(liveMediaStream?.getAudioTracks().some((t) => t.readyState === 'live'))) ||
      micActive);

  const needsStreamReconnect =
    !isAudioOnly &&
    (camera.sourceKind === 'device-camera' ||
      (camera.sourceKind === 'bluetooth-cctv' && !camera.streamUrl && !camera.customMediaUrl)) &&
    !hasLiveVideoStream;

  const needsMicConnect = isAudioOnly && !isAudioStreamLive;

  const activeCategory = camera.lastAnalysis?.threatCategory;
  const isBullyingStatus = camera.status === 'fighting' && activeCategory === 'bullying';
  const statusBorderClass =
    isBullyingStatus
      ? 'border-orange-400 ring-1 ring-orange-400/40'
      : camera.status === 'fighting'
        ? 'animate-alert-critical-pulse border-red-500 ring-1 ring-red-500/40'
        : camera.status === 'warning'
          ? 'border-amber-400'
          : 'border-slate-200 hover:border-slate-300';

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
      className={`bg-white border rounded-xl overflow-hidden flex flex-col transition-colors shadow-2xs ${statusBorderClass}`}
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
              e.currentTarget.muted = true;
              e.currentTarget.playsInline = true;
              void e.currentTarget.play().catch(() => {});
            }}
            onLoadedData={(e) => {
              if (e.currentTarget.videoWidth > 0) {
                hasLiveFrameRef.current = true;
                setHasLiveSignal(true);
              }
            }}
            onPlaying={(e) => {
              if (e.currentTarget.videoWidth > 0) {
                hasLiveFrameRef.current = true;
                setHasLiveSignal(true);
              }
            }}
            onCanPlay={(e) => {
              if (e.currentTarget.paused) {
                void e.currentTarget.play().catch(() => {});
              }
            }}
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-contain opacity-0 pointer-events-none z-0"
          />
        ) : null}
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          data-testid={`camera-canvas-${camera.id}`}
          data-pick-mode={pickMode ?? 'none'}
          data-hovered-subject={hoveredSubjectId ?? ''}
          data-trail-targets={selectedTrailSubjectIds.join(',')}
          data-ptz-active={ptzAutoTrackEnabled ? 'true' : 'false'}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerLeave={handleCanvasPointerLeave}
          onPointerUp={handleCanvasPointerUp}
          aria-label={
            isAudioOnly
              ? `Live acoustic monitor for ${camera.classroomName}`
              : `Live CCTV feed for ${camera.classroomName}`
          }
          className={`w-full h-full object-cover block relative z-10 ${
            isDrawingZone || pickMode !== null ? 'cursor-crosshair touch-none' : ''
          }`}
        />

        {pickMode !== null ? (
          <div
            data-testid={`camera-picker-banner-${camera.id}`}
            className="absolute top-9 left-2.5 z-20 flex flex-wrap items-center gap-1.5 rounded-md bg-zinc-950/92 border border-emerald-500/70 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-lg max-w-[calc(100%-5.5rem)]"
          >
            <span className="text-emerald-300 font-semibold">
              {pickMode === 'trail'
                ? 'Nose Trail Picker:'
                : pickMode === 'flag'
                  ? `${watchlistMeta.flagActionLabel} Picker:`
                  : 'Auto-PTZ Target:'}
            </span>
            <span className="text-zinc-200">
              {hoveredSubjectId
                ? `Click red body (${hoveredSubjectId})`
                : 'Hover body (turns red) & click'}
            </span>
            {pickMode === 'trail' ? (
              <button
                type="button"
                onClick={() => {
                  selectedTrailSubjectIdsRef.current = [];
                  setSelectedTrailSubjectIds([]);
                  onUpdateCameraSettings(camera.id, { trailsEnabled: true });
                  showPickFeedback('Nose trails active on all people');
                }}
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] font-semibold text-zinc-100 cursor-pointer"
              >
                All
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                hoveredSubjectIdRef.current = null;
                setHoveredSubjectId(null);
                setPickMode(null);
              }}
              aria-label="Close person picker"
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-[10px] font-semibold text-white cursor-pointer"
            >
              <X className="w-3 h-3" aria-hidden="true" />
              <span>Done</span>
            </button>
          </div>
        ) : null}

        {pickFeedback && pickMode === null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-9 left-2.5 z-20 rounded-md bg-zinc-950/90 border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-emerald-300"
          >
            {pickFeedback}
          </div>
        ) : null}

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

      {/* Clean Simple Monitor Control Bar */}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-slate-200 bg-white">
        <div className="min-w-0 flex-1 basis-[170px]">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 truncate">
              {camera.classroomName}
            </h3>
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                isBullyingStatus
                  ? 'text-orange-600'
                  : camera.status === 'fighting'
                    ? 'text-red-600'
                    : camera.status === 'warning'
                      ? 'text-amber-600'
                      : 'text-emerald-600'
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
          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
            {isAudioOnly ? (
              <span className="font-mono text-slate-700 font-medium" data-testid={`camera-live-count-${camera.id}`}>
                Mic Only
              </span>
            ) : (
              <span className="font-mono text-slate-700 font-medium tabular-nums" data-testid={`camera-live-count-${camera.id}`}>
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
                <span className="font-mono text-amber-600 font-medium">{contactPairsCount} overlap</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => onAnalyzeCamera(camera.id, false)}
            disabled={camera.isAnalyzing}
            aria-label={`Scan AI safety for ${camera.classroomName}`}
            title="Scan frame now"
            className={`inline-flex items-center gap-1 font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer ${
              !isFocused && visibleCameraCount >= 5
                ? 'px-2 py-1 text-[11px]'
                : 'px-2.5 py-1.5 text-xs'
            }`}
          >
            <ScanSearch className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{camera.isAnalyzing ? 'Scanning' : 'Scan'}</span>
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
            className={`inline-flex items-center gap-1 font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
              !isFocused && visibleCameraCount >= 5
                ? 'px-1.5 py-1 text-[11px]'
                : 'px-2 py-1.5 text-xs'
            } ${
              micActive
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {micActive ? (
              <Mic className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <MicOff className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {isFocused || visibleCameraCount < 5 ? (
              <span className="hidden xl:inline">{micActive ? 'Live' : 'Mic'}</span>
            ) : null}
          </button>

          {!isAudioOnly && hasLiveSignal && (isFocused || visibleCameraCount <= 4) ? (
            <>
              <button
                type="button"
                data-testid={`camera-trail-btn-${camera.id}`}
                onClick={() => togglePickMode('trail')}
                aria-pressed={pickMode === 'trail'}
                aria-label={`Choose person for nose trail on ${camera.classroomName}`}
                title="Pick specific person for nose-anchored trail (bodies turn green, red on hover)"
                className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                  pickMode === 'trail'
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : selectedTrailSubjectIds.length > 0
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Route className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {selectedTrailSubjectIds.length > 0
                    ? `Trail (${selectedTrailSubjectIds.length})`
                    : 'Trail'}
                </span>
              </button>

              {onEnrollLiveSubject ? (
                <button
                  type="button"
                  data-testid={`camera-flag-btn-${camera.id}`}
                  onClick={() => togglePickMode('flag')}
                  aria-pressed={pickMode === 'flag'}
                  aria-label={`Choose person to flag on ${camera.classroomName}`}
                  title="Pick specific person to flag to Watchlist (bodies turn green, red on hover)"
                  className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                    pickMode === 'flag'
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Flag</span>
                </button>
              ) : null}

              <button
                type="button"
                data-testid={`camera-ptz-btn-${camera.id}`}
                onClick={() =>
                  onUpdateCameraSettings(camera.id, {
                    ptzAutoTrackEnabled: !ptzAutoTrackEnabled,
                  })
                }
                aria-pressed={ptzAutoTrackEnabled}
                aria-label={`Toggle smooth Auto-PTZ on ${camera.classroomName}`}
                title="Smooth digital Auto-PTZ zoom tracking"
                className={`inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                  ptzAutoTrackEnabled
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Focus className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">PTZ</span>
              </button>
            </>
          ) : null}

          {!isFocused ? (
            <button
              type="button"
              onClick={() => onToggleFocus(camera.id)}
              aria-label={`Open dedicated place for ${camera.classroomName}`}
              title="Inspect camera details"
              className={`inline-flex items-center gap-1 font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer ${
                visibleCameraCount >= 5
                  ? 'px-2 py-1 text-[11px]'
                  : 'px-2 py-1.5 text-xs'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Inspect</span>
            </button>
          ) : null}

          <button
            type="button"
            aria-expanded={showAdvancedTools}
            aria-label={`Advanced camera controls for ${camera.classroomName}`}
            onClick={() => setShowAdvancedTools((prev) => !prev)}
            title="Advanced tracking, Auto-PTZ, Heatmap, Perimeter Zone & DVR Clip tools"
            className={`inline-flex items-center gap-1 font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
              !isFocused && visibleCameraCount >= 5
                ? 'px-1.5 py-1 text-[11px]'
                : 'px-2 py-1.5 text-xs'
            } ${
              showAdvancedTools
                ? 'bg-slate-100 border-slate-400 text-slate-900'
                : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            {isFocused || visibleCameraCount < 5 ? (
              <span className="hidden sm:inline">Advanced</span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => onRemoveCamera(camera.id)}
            aria-label={`Remove ${camera.classroomName}`}
            title="Remove camera"
            className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Collapsible Advanced Camera Controls (Hidden by default so card stays ultra-simple) */}
      {showAdvancedTools ? (
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 space-y-2.5 text-[11px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleManualLockClick}
                aria-label={`Lock forensic DVR evidence for ${camera.classroomName}`}
                title="Save rolling WebM DVR video clip & forensic frames to Evidence Vault (SHA-256)"
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                  justLockedEvidence
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Video className="w-3 h-3" aria-hidden="true" />
                <span>{justLockedEvidence ? 'Clip Saved' : 'Save Clip'}</span>
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={isAutoAiOn}
                aria-label={`Toggle autonomous AI for ${camera.classroomName}`}
                onClick={() => onUpdateCameraSettings(camera.id, { autoAiEnabled: !isAutoAiOn })}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border cursor-pointer whitespace-nowrap ${
                  isAutoAiOn
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-white text-slate-500 border-slate-300 hover:text-slate-900'
                }`}
              >
                {isAutoAiOn ? 'AI Armed' : 'AI Paused'}
              </button>

              {!isAudioOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCameraSettings(camera.id, {
                        ptzAutoTrackEnabled: !ptzAutoTrackEnabled,
                      })
                    }
                    aria-pressed={ptzAutoTrackEnabled}
                    aria-label={`Toggle digital Auto-PTZ zoom tracking for ${camera.classroomName}`}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                      ptzAutoTrackEnabled
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Focus className="w-3 h-3" aria-hidden="true" />
                    <span>Auto-PTZ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => togglePickMode('ptz')}
                    aria-pressed={pickMode === 'ptz'}
                    aria-label={`Pick Auto-PTZ target person on ${camera.classroomName}`}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                      pickMode === 'ptz'
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>Pick PTZ Target</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCameraSettings(camera.id, { trailsEnabled: !trailsEnabled })
                    }
                    aria-pressed={trailsEnabled}
                    aria-label={`Toggle nose-anchored movement trails for ${camera.classroomName}`}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                      trailsEnabled
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Route className="w-3 h-3" aria-hidden="true" />
                    <span>{trailsEnabled ? 'Nose Trails ON' : 'Nose Trails OFF'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => togglePickMode('trail')}
                    aria-pressed={pickMode === 'trail'}
                    aria-label={`Pick specific person for nose trail on ${camera.classroomName}`}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                      pickMode === 'trail'
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <span>Pick Trail Person</span>
                  </button>

                  {onEnrollLiveSubject ? (
                    <button
                      type="button"
                      onClick={() => togglePickMode('flag')}
                      aria-pressed={pickMode === 'flag'}
                      aria-label={`Pick specific person for ${watchlistMeta.title} on ${camera.classroomName}`}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                        pickMode === 'flag'
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <UserPlus className="w-3 h-3" aria-hidden="true" />
                      <span>
                        {watchlistLabelMode === 'missing-person' ? 'Pick Evacuee' : 'Pick Flag Person'}
                      </span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCameraSettings(camera.id, { heatmapEnabled: !heatmapEnabled })
                    }
                    aria-pressed={heatmapEnabled}
                    aria-label={`Toggle activity heatmap for ${camera.classroomName}`}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                      heatmapEnabled
                        ? 'bg-amber-50 border-amber-300 text-amber-800'
                        : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Flame className="w-3 h-3" aria-hidden="true" />
                    <span>Heatmap</span>
                  </button>

                  <select
                    aria-label={`Perimeter zone hazard label for ${camera.classroomName}`}
                    data-testid={`perimeter-preset-select-${camera.id}`}
                    value={zonePreset}
                    onChange={(e) => {
                      const nextPreset = e.target.value as PerimeterZonePreset;
                      setZonePreset(nextPreset);
                      if (perimeterZone) {
                        onUpdateCameraSettings(camera.id, {
                          perimeterZone: { ...perimeterZone, label: nextPreset },
                        });
                      }
                    }}
                    className="px-2 py-1 text-[11px] font-medium rounded-md border border-slate-300 bg-white text-slate-700 cursor-pointer"
                  >
                    {PERIMETER_ZONE_PRESETS.map((preset) => (
                      <option key={preset} value={preset}>
                        {preset}
                      </option>
                    ))}
                  </select>

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
                        ? `Clear ${perimeterZone.label} zone on ${camera.classroomName}`
                        : `Draw ${zonePreset} zone on ${camera.classroomName}`
                    }
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                      perimeterBreached
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : isDrawingZone || perimeterZone
                          ? 'bg-amber-50 border-amber-300 text-amber-800'
                          : 'bg-white border-slate-300 text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Crosshair className="w-3 h-3" aria-hidden="true" />
                    <span>
                      {isDrawingZone
                        ? 'Cancel Draw'
                        : perimeterZone
                          ? `Clear (${perimeterZone.label})`
                          : isDisasterMode
                            ? 'Draw Hazard Zone'
                            : 'Draw Zone'}
                    </span>
                  </button>
                </>
              ) : null}
            </div>

            {!isAudioOnly ? (
              <span className="font-mono text-[10px] text-slate-400 tabular-nums hidden sm:inline">
                {isRecordingVideo ? `REC · ${dvrFrameCount}f` : `DVR ${dvrFrameCount}f`}
              </span>
            ) : null}
          </div>

          {/* Tracked Subjects & Watchlist Flagging */}
          {!isAudioOnly && liveTrackedSubjects.length > 0 ? (
            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-mono text-slate-500 uppercase mr-1">Tracked:</span>
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
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : isLocked && ptzAutoTrackEnabled
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'bg-white border-slate-300 text-slate-700'
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
                        title={`Add ${subj.id} to ${watchlistMeta.title}`}
                        className="inline-flex items-center gap-0.5 pl-1.5 border-l border-slate-300 text-amber-700 hover:text-amber-900 cursor-pointer font-sans font-medium"
                      >
                        <UserPlus className="w-3 h-3" aria-hidden="true" />
                        <span>{watchlistMeta.flagActionLabel}</span>
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
        <div className="px-4 py-2 border-t border-slate-200 bg-amber-50/70 text-xs space-y-1">
          {streamError ? (
            <p role="alert" className="text-amber-800 font-medium">
              {streamError}
            </p>
          ) : null}
          {camera.errorMessage ? (
            <p role="alert" className="text-red-700 font-medium">
              {camera.errorMessage}
            </p>
          ) : null}
          {micError ? <p className="text-amber-800">{micError}</p> : null}
        </div>
      ) : null}

      {/* Focused Command Strip: Live Voice Cue Editor & Threat Assessment */}
      {isFocused ? (
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-slate-700 font-medium">Audio Cue</span>
              <span className="text-slate-400" aria-hidden="true">·</span>
              <span className="font-mono text-[11px] text-slate-500">
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
                    className="w-14 text-xs px-1.5 py-0.5 border border-slate-300 rounded bg-white text-slate-900"
                  />
                  <button
                    type="submit"
                    className="text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer"
                  >
                    Save
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingTotal(true)}
                  className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer whitespace-nowrap"
                >
                  Total:{' '}
                  <span className="font-mono text-slate-800 tabular-nums">
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
                  className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setEditingVoice((prev) => !prev)}
                className="text-xs text-slate-700 hover:text-slate-950 cursor-pointer whitespace-nowrap"
              >
                {editingVoice ? 'Cancel' : 'Edit cue'}
              </button>
              <button
                type="button"
                onClick={() => onToggleVoiceListening(camera.id)}
                className="text-xs text-slate-700 hover:text-slate-950 font-medium cursor-pointer whitespace-nowrap"
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
                className="flex-1 min-w-0 text-xs px-2.5 py-1.5 border border-slate-300 rounded-md bg-white text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600"
                placeholder="Type speech or distress phrase..."
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 cursor-pointer shrink-0"
              >
                Save
              </button>
            </form>
          ) : (
            <p
              data-testid={`live-speech-${camera.id}`}
              className="text-slate-700 leading-relaxed"
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
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
              <p className="text-slate-600 leading-relaxed flex-1 min-w-0">
                <span className="text-slate-900 font-medium">
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
                className="text-[11px] bg-white border border-slate-300 rounded px-2 py-1 text-slate-700 shrink-0"
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

export const CameraFeedCard = memo(CameraFeedCardInner);
