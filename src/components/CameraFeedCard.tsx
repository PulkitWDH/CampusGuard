import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type {
  AiEngineModel,
  ClassroomAnalysis,
  ClassroomCamera,
  DetectedObjectBox,
  DetectedPersonBox,
  FacilityMode,
  ThreatSensitivity,
} from '../types';
import { captureCanvasJpegBase64 } from '../utils/mediaCapture';
import {
  detectPeopleLocallyOnCanvas,
  ensureLocalPersonDetector,
} from '../utils/localPersonDetector';
import {
  DEFAULT_DB_CALIBRATION_OFFSET,
  INSTANT_CHANGE_THRESHOLD_PERCENT,
  SOUND_ALERT_SUSTAINED_MS,
  SOUND_ALERT_THRESHOLD_DB,
  type EdgeThreatTrackerState,
  type PersonTrackerState,
  type SpeechResultLike,
  computeFrameDeltaPercent,
  computeSplDecibels,
  createInitialEdgeThreatState,
  evaluateRealtimeEdgeThreat,
  extractLatestSpeechUtterance,
  formatAiModelLabel,
  formatFacilityLabels,
  shouldTriggerInstantContinuousScan,
  stepPersonTracker,
} from '../utils/monitoringLogic';

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

interface CameraFeedCardProps {
  camera: ClassroomCamera;
  facilityMode: FacilityMode;
  threatSensitivity: ThreatSensitivity;
  defaultAiModel: AiEngineModel;
  dbCalibrationOffset?: number;
  cloudQuotaExhausted?: boolean;
  isFocused: boolean;
  liveMediaStream?: MediaStream | null;
  onRegisterCapture: (cameraId: string, captureFn: (() => CameraFramePayload | null) | null) => void;
  onLocalPersonDetections: (
    cameraId: string,
    detectedPeople: DetectedPersonBox[],
    detectedObjects: DetectedObjectBox[]
  ) => void;
  onRealtimeEdgeThreat: (cameraId: string, event: RealtimeThreatEvent) => void;
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
      Pick<ClassroomCamera, 'aiModel' | 'autoAiEnabled' | 'expectedTotalCount'>
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
  liveMediaStream,
  onRegisterCapture,
  onLocalPersonDetections,
  onRealtimeEdgeThreat,
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
  const [liveMotionPercent, setLiveMotionPercent] = useState(0);
  const [contactPairsCount, setContactPairsCount] = useState(0);
  const [scanModeLabel, setScanModeLabel] = useState('Edge AI · Loading model');
  const [localEdgeState, setLocalEdgeState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [streamError, setStreamError] = useState<string | null>(null);

  const rawCaptureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastScannedThumbRef = useRef<Uint8ClampedArray | null>(null);
  const prevEdgeThumbRef = useRef<Uint8ClampedArray | null>(null);
  const liveMotionPercentRef = useRef<number>(0);
  const lastScanFinishedAtRef = useRef<number>(0);
  const hasScannedOnceRef = useRef<boolean>(Boolean(camera.lastAnalysis));
  const localDetectInFlightRef = useRef<boolean>(false);
  const localEdgeReadyRef = useRef<boolean>(false);
  const localPeopleCountRef = useRef<number>(camera.studentCount);
  const lastLocalBoxSigRef = useRef<string>('__INIT__');
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

  const captureCleanFrame = (): { base64: string; dataUrl: string } | null => {
    if (!hasLiveFrameRef.current) return null;
    if (!rawCaptureCanvasRef.current) {
      const offscreen = document.createElement('canvas');
      offscreen.width = 640;
      offscreen.height = 360;
      rawCaptureCanvasRef.current = offscreen;
    }
    const targetCanvas = rawCaptureCanvasRef.current;
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return null;

    const video = videoRef.current;
    const hasVideoFeed =
      Boolean(video) &&
      video!.readyState >= 2 &&
      video!.videoWidth > 0 &&
      (Boolean(liveMediaStream) ||
        (camera.customMediaType === 'video' && Boolean(camera.customMediaUrl)));

    if (hasVideoFeed && video) {
      ctx.drawImage(video, 0, 0, targetCanvas.width, targetCanvas.height);
    } else if (
      loadedImageRef.current &&
      loadedImageRef.current.complete &&
      loadedImageRef.current.naturalWidth > 0
    ) {
      ctx.drawImage(loadedImageRef.current, 0, 0, targetCanvas.width, targetCanvas.height);
    } else if (canvasRef.current) {
      ctx.drawImage(canvasRef.current, 0, 0, targetCanvas.width, targetCanvas.height);
    } else {
      return null;
    }

    const dataUrl = targetCanvas.toDataURL('image/jpeg', 0.85);
    return {
      base64: captureCanvasJpegBase64(targetCanvas),
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

  // Preload zero-quota on-device TensorFlow.js COCO-SSD person + weapon detector
  useEffect(() => {
    let cancelled = false;
    ensureLocalPersonDetector()
      .then(() => {
        if (!cancelled) {
          localEdgeReadyRef.current = true;
          setLocalEdgeState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          localEdgeReadyRef.current = false;
          setLocalEdgeState('fallback');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Real-time zero-quota on-device Edge AI person + weapon + visual threat engine (runs every 300ms)
  useEffect(() => {
    if (!isAutoAiOn || !hasLiveSignal || localEdgeState !== 'ready') {
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
        } = await detectPeopleLocallyOnCanvas(rawCanvas, 48, {
          hadTrackedPeople: personTrackerStateRef.current.confirmed.length > 0,
        });
        if (cancelled) return;

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
            instantConfidence: 62,
            minConfidence: 48,
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
          setScanModeLabel(
            cloudQuotaExhaustedRef.current
              ? `Edge AI · ${inferenceMs}ms (On-device armed)`
              : `Edge + Cloud AI · ${inferenceMs}ms`
          );
        }
      } catch {
        // Keep last valid state on transient frame read error
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
  }, [camera.id, hasLiveSignal, isAutoAiOn, localEdgeState]);

  // Cloud multimodal threat verification loop (complements on-device Edge AI when cloud quota is available)
  useEffect(() => {
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
  }, [camera.id, cloudQuotaExhausted, hasAiFeedSignal, isAutoAiOn, localEdgeState]);

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
          const ctx = canvas?.getContext('2d');
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
      source.connect(analyser);
      const timeData = new Float32Array(analyser.fftSize);

      sampleTimer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(timeData);
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
      loudHoldStartRef.current = null;
      setLoudHoldSeconds(0);
      if (ctx) void ctx.close().catch(() => {});
    };
  }, [camera.id, dbCalibrationOffset, liveMediaStream, micActive]);

  // Draw live video/image frame + grounded person & weapon bounding boxes onto display canvas
  useEffect(() => {
    let rafId = 0;
    let lastDraw = 0;

    const drawFrame = (timestamp: number) => {
      rafId = requestAnimationFrame(drawFrame);
      if (timestamp - lastDraw < 100) return;
      lastDraw = timestamp;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.fillStyle = '#070A0F';
      ctx.fillRect(0, 0, width, height);

      const video = videoRef.current;
      const hasVideoFeed =
        (Boolean(liveMediaStream) ||
          (camera.customMediaType === 'video' && Boolean(camera.customMediaUrl))) &&
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0;

      if (hasVideoFeed && video) {
        ctx.drawImage(video, 0, 0, width, height);
        if (!hasLiveFrameRef.current) {
          hasLiveFrameRef.current = true;
          setHasLiveSignal(true);
        }
      } else if (
        loadedImageRef.current &&
        loadedImageRef.current.complete &&
        loadedImageRef.current.naturalWidth > 0
      ) {
        ctx.drawImage(loadedImageRef.current, 0, 0, width, height);
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

      // Draw grounded AI person bounding boxes (including face-occluded tracking state)
      const boxes = detectedPeopleRef.current;
      if (hasLiveFrameRef.current && Array.isArray(boxes) && boxes.length > 0) {
        const isCritical = cameraStatusRef.current === 'fighting';
        const isBullying = threatCategoryRef.current === 'bullying';

        boxes.forEach((person, idx) => {
          const [ymin, xmin, ymax, xmax] = person.box_2d;
          const x = Math.max(2, Math.min(width - 18, Math.round((xmin / 1000) * width)));
          const y = Math.max(32, Math.min(height - 38, Math.round((ymin / 1000) * height)));
          const bw = Math.max(16, Math.min(width - x - 2, Math.round(((xmax - xmin) / 1000) * width)));
          const bh = Math.max(16, Math.min(height - y - 2, Math.round(((ymax - ymin) / 1000) * height)));

          const isOccluded = Boolean(person.faceOccluded);
          const strokeColor = isBullying
            ? '#f97316'
            : isCritical
              ? '#ef4444'
              : isOccluded
                ? '#38bdf8'
                : '#10b981';
          const fillTint = isBullying
            ? 'rgba(249, 115, 22, 0.14)'
            : isCritical
              ? 'rgba(239, 68, 68, 0.14)'
              : isOccluded
                ? 'rgba(56, 189, 248, 0.12)'
                : 'rgba(16, 185, 129, 0.10)';
          const tagBg = isBullying
            ? 'rgba(194, 65, 12, 0.92)'
            : isCritical
              ? 'rgba(185, 28, 28, 0.92)'
              : isOccluded
                ? 'rgba(3, 105, 161, 0.92)'
                : 'rgba(6, 95, 70, 0.90)';

          ctx.fillStyle = fillTint;
          ctx.fillRect(x, y, bw, bh);

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 2;
          if (isOccluded && !isCritical) {
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

          const tagText = isOccluded
            ? `#${idx + 1} ${person.label}`
            : `#${idx + 1} ${person.label} ${person.confidence}%`;
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

      // Draw crimson bounding boxes for any detected weapon objects
      const weapons = detectedObjectsRef.current;
      if (hasLiveFrameRef.current && Array.isArray(weapons) && weapons.length > 0) {
        weapons.forEach((weapon) => {
          const [ymin, xmin, ymax, xmax] = weapon.box_2d;
          const x = Math.max(2, Math.min(width - 18, Math.round((xmin / 1000) * width)));
          const y = Math.max(32, Math.min(height - 38, Math.round((ymin / 1000) * height)));
          const bw = Math.max(16, Math.min(width - x - 2, Math.round(((xmax - xmin) / 1000) * width)));
          const bh = Math.max(16, Math.min(height - y - 2, Math.round(((ymax - ymin) / 1000) * height)));

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

    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, [
    camera.bluetoothDeviceName,
    camera.cameraCode,
    camera.customMediaType,
    camera.customMediaUrl,
    camera.sourceKind,
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

  const needsStreamReconnect =
    (camera.sourceKind === 'device-camera' ||
      (camera.sourceKind === 'bluetooth-cctv' && !camera.streamUrl && !camera.customMediaUrl)) &&
    !liveMediaStream;

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
      {/* Dominant 16:9 Live CCTV Monitor */}
      <div className="relative bg-black aspect-video w-full overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none"
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          data-testid={`camera-canvas-${camera.id}`}
          aria-label={`Live CCTV feed for ${camera.classroomName}`}
          className="w-full h-full object-cover block relative z-10"
        />

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

        {/* Minimal Tactical Occupancy HUD */}
        {hasLiveSignal ? (
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
                hasLiveSignal ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {hasLiveSignal ? 'LIVE' : 'OFFLINE'}
            </span>
            <span aria-hidden="true" className="text-zinc-600">·</span>
            <span className="tabular-nums">Δ{liveMotionPercent.toFixed(0)}%</span>
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
            <span className="font-mono text-zinc-300 tabular-nums" data-testid={`camera-live-count-${camera.id}`}>
              {camera.studentCount} {countWord}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono" data-testid={`camera-cycle-label-${camera.id}`}>
              {camera.isAnalyzing ? 'Analyzing...' : scanModeLabel}
            </span>
            {contactPairsCount > 0 ? (
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
