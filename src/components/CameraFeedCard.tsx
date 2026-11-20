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
import type { AiEngineModel, ClassroomCamera, DetectedPersonBox, FacilityMode } from '../types';
import { captureCanvasJpegBase64 } from '../utils/mediaCapture';
import {
  detectPeopleLocallyOnCanvas,
  ensureLocalPersonDetector,
} from '../utils/localPersonDetector';
import {
  DEFAULT_DB_CALIBRATION_OFFSET,
  INSTANT_CHANGE_THRESHOLD_PERCENT,
  SOUND_ALERT_THRESHOLD_DB,
  type PersonTrackerState,
  computeFrameDeltaPercent,
  computeSplDecibels,
  formatAiModelLabel,
  formatFacilityLabels,
  shouldTriggerInstantContinuousScan,
  stepPersonTracker,
} from '../utils/monitoringLogic';

export interface CameraFramePayload {
  frameBase64: string;
  previousFrameBase64?: string;
  previewDataUrl?: string;
}

interface CameraFeedCardProps {
  camera: ClassroomCamera;
  facilityMode: FacilityMode;
  defaultAiModel: AiEngineModel;
  dbCalibrationOffset?: number;
  cloudQuotaExhausted?: boolean;
  isFocused: boolean;
  liveMediaStream?: MediaStream | null;
  onRegisterCapture: (cameraId: string, captureFn: (() => CameraFramePayload | null) | null) => void;
  onLocalPersonDetections: (cameraId: string, detectedPeople: DetectedPersonBox[]) => void;
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
  defaultAiModel,
  dbCalibrationOffset = DEFAULT_DB_CALIBRATION_OFFSET,
  cloudQuotaExhausted = false,
  isFocused,
  liveMediaStream,
  onRegisterCapture,
  onLocalPersonDetections,
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
  const [scanModeLabel, setScanModeLabel] = useState('Edge AI · Loading model');
  const [localEdgeState, setLocalEdgeState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [streamError, setStreamError] = useState<string | null>(null);
  const rawCaptureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastScannedThumbRef = useRef<Uint8ClampedArray | null>(null);
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
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechRestartTimerRef = useRef<number | null>(null);
  const speechClearTimerRef = useRef<number | null>(null);
  const [loudHoldSeconds, setLoudHoldSeconds] = useState(0);
  const loudHoldStartRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const liveTranscriptRef = useRef(camera.liveTranscript);
  const isAnalyzingRef = useRef(camera.isAnalyzing);
  const detectedPeopleRef = useRef(camera.lastAnalysis?.detectedPeople ?? []);
  const cameraStatusRef = useRef(camera.status);
  const cloudQuotaExhaustedRef = useRef(cloudQuotaExhausted);
  const onAnalyzeCameraRef = useRef(onAnalyzeCamera);
  const onLocalPersonDetectionsRef = useRef(onLocalPersonDetections);
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
    cameraStatusRef.current = camera.status;
  }, [camera.lastAnalysis?.detectedPeople, camera.status]);

  useEffect(() => {
    cloudQuotaExhaustedRef.current = cloudQuotaExhausted;
  }, [cloudQuotaExhausted]);

  useEffect(() => {
    onAnalyzeCameraRef.current = onAnalyzeCamera;
  }, [onAnalyzeCamera]);

  useEffect(() => {
    onLocalPersonDetectionsRef.current = onLocalPersonDetections;
  }, [onLocalPersonDetections]);

  useEffect(() => {
    setTotalDraft(
      typeof camera.expectedTotalCount === 'number' && camera.expectedTotalCount > 0
        ? String(camera.expectedTotalCount)
        : ''
    );
  }, [camera.expectedTotalCount]);

  // Preload zero-quota on-device TensorFlow.js COCO-SSD person detector
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

  // Real-time zero-quota on-device Edge AI person detector (runs every 300ms with NO cooldown & NO API limits)
  useEffect(() => {
    if (!isAutoAiOn || !hasLiveSignal || localEdgeState !== 'ready') {
      return;
    }

    let cancelled = false;
    const runEdgeDetect = async () => {
      if (cancelled || localDetectInFlightRef.current || !hasLiveFrameRef.current) return;
      const clean = captureCleanFrameRef.current();
      if (!clean || !rawCaptureCanvasRef.current) return;

      localDetectInFlightRef.current = true;
      try {
        const { people: rawPeople, inferenceMs } = await detectPeopleLocallyOnCanvas(
          rawCaptureCanvasRef.current,
          38
        );
        if (cancelled) return;

        const { nextState, people } = stepPersonTracker(
          personTrackerStateRef.current,
          rawPeople,
          { instantConfidence: 52, minConfidence: 38, maxMissedFrames: 2 }
        );
        personTrackerStateRef.current = nextState;
        detectedPeopleRef.current = people;
        localPeopleCountRef.current = people.length;

        const sig = people
          .map((p) => `${p.label}:${p.confidence}:${p.box_2d.map((v) => Math.round(v / 20)).join(',')}`)
          .join('|');
        if (sig !== lastLocalBoxSigRef.current) {
          lastLocalBoxSigRef.current = sig;
          onLocalPersonDetectionsRef.current(camera.id, people);
        }
        if (!isAnalyzingRef.current) {
          setScanModeLabel(
            cloudQuotaExhaustedRef.current
              ? `Edge AI live · ${inferenceMs}ms (unlimited · 0 quota)`
              : `Edge AI live · ${inferenceMs}ms (0 cooldown)`
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

  // Continuous zero-cooldown cloud threat & voice AI loop
  useEffect(() => {
    if (!isAutoAiOn) {
      setScanModeLabel('Continuous AI paused');
      setLiveMotionPercent(0);
      return;
    }
    if (!hasAiFeedSignal) {
      setScanModeLabel('Waiting for camera signal');
      setLiveMotionPercent(0);
      return;
    }
    if (localEdgeState === 'loading') {
      setScanModeLabel('Loading on-device Edge AI...');
      return;
    }

    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      const currPixels = sampleMotionPixelsRef.current();
      const deltaPercent = currPixels
        ? computeFrameDeltaPercent(lastScannedThumbRef.current, currPixels)
        : 0;
      setLiveMotionPercent(deltaPercent);

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
        setScanModeLabel('Cloud threat AI analyzing...');
        return;
      }

      // If cloud API quota is full and on-device Edge AI is running, stay 100% on local Edge AI without 429 spam
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
            ? 'Scene change · cloud threat check'
            : 'Cloud threat AI · scanning live'
        );
        onAnalyzeCameraRef.current(camera.id, true);
      } else if (!localEdgeReadyRef.current) {
        setScanModeLabel(
          deltaPercent >= INSTANT_CHANGE_THRESHOLD_PERCENT
            ? `Change ${deltaPercent.toFixed(0)}% · scanning`
            : 'Continuous AI · watching live'
        );
      }
    }, 250);

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

  // Poll real IP camera HTTP snapshot or MJPEG URL via server proxy when streamUrl is configured
  useEffect(() => {
    if (!camera.streamUrl) return;
    let cancelled = false;

    const loadSnapshot = () => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        if (img.naturalWidth > 0) {
          setStreamError(null);
          loadedImageRef.current = img;
          hasLiveFrameRef.current = true;
          setHasLiveSignal(true);
        }
      };
      img.onerror = () => {
        if (cancelled) return;
        hasLiveFrameRef.current = false;
        setHasLiveSignal(false);
        setStreamError('Unable to reach camera snapshot or MJPEG stream URL.');
      };
      img.src = `/api/snapshot-proxy?url=${encodeURIComponent(camera.streamUrl!)}&t=${Date.now()}`;
    };

    loadSnapshot();
    const timer = setInterval(loadSnapshot, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [camera.streamUrl]);

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

  // Draw live video/image frame onto canvas
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
      ctx.fillStyle = '#0f172a';
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
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '500 14px "DM Sans", sans-serif';
        const message =
          camera.sourceKind === 'stream-url'
            ? 'Connecting to camera stream URL...'
            : 'Camera stream offline. Click Reconnect Live Camera.';
        const m = ctx.measureText(message);
        ctx.fillText(message, Math.max(20, (width - m.width) / 2), height / 2);
      }

      // Draw grounded AI person bounding boxes directly on live display canvas (never included in clean AI capture)
      const boxes = detectedPeopleRef.current;
      if (hasLiveFrameRef.current && Array.isArray(boxes) && boxes.length > 0) {
        const isCritical = cameraStatusRef.current === 'fighting';
        const strokeColor = isCritical ? '#ef4444' : '#10b981';
        const fillTint = isCritical ? 'rgba(239, 68, 68, 0.14)' : 'rgba(16, 185, 129, 0.12)';
        const tagBg = isCritical ? 'rgba(185, 28, 28, 0.92)' : 'rgba(6, 95, 70, 0.92)';

        boxes.forEach((person, idx) => {
          const [ymin, xmin, ymax, xmax] = person.box_2d;
          const x = Math.max(2, Math.min(width - 18, Math.round((xmin / 1000) * width)));
          const y = Math.max(32, Math.min(height - 38, Math.round((ymin / 1000) * height)));
          const bw = Math.max(16, Math.min(width - x - 2, Math.round(((xmax - xmin) / 1000) * width)));
          const bh = Math.max(16, Math.min(height - y - 2, Math.round(((ymax - ymin) / 1000) * height)));

          ctx.fillStyle = fillTint;
          ctx.fillRect(x, y, bw, bh);

          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(x, y, bw, bh);

          // Corner brackets for unmistakable visual grounding
          const corner = Math.min(14, Math.floor(Math.min(bw, bh) / 3));
          ctx.lineWidth = 4;
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

          const tagText = `#${idx + 1} ${person.label} · ${person.confidence}%`;
          ctx.font = '600 11px "JetBrains Mono", monospace';
          const textW = ctx.measureText(tagText).width;
          const tagW = Math.min(width - 8, Math.ceil(textW) + 12);
          const tagX = Math.max(4, Math.min(x, width - tagW - 4));
          const rawTagY = y >= 54 ? y - 22 : Math.min(height - 54, y + 4);
          let tagY = Math.max(34, Math.min(height - 54, rawTagY));
          // Keep right-side labels clear of the top-right live count HUD badge
          if (tagY < 90 && tagX + tagW > width - 165) {
            tagY = Math.min(height - 54, Math.max(92, y + 6));
          }
          ctx.fillStyle = tagBg;
          ctx.fillRect(tagX, tagY, tagW, 18);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(tagText, tagX + 6, tagY + 13, tagW - 12);
        });
      }

      ctx.fillStyle = 'rgba(15, 23, 42, 0.68)';
      ctx.fillRect(0, 0, width, 30);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '500 12px "JetBrains Mono", monospace';
      const timeLabel = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      ctx.fillText(`${camera.cameraCode} · ${camera.bluetoothDeviceName}`, 12, 20);
      const timeMetrics = ctx.measureText(timeLabel);
      ctx.fillText(timeLabel, width - timeMetrics.width - 12, 20);
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

      // Auto-clear stale sentence after 15 seconds of silence so old speech never sticks on screen
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
        setMicError(
          'Microphone speech recognition permission blocked (dB level metering remains active).'
        );
      } else if (code === 'network') {
        setMicError(
          'Speech-to-text service briefly unreachable; retrying while dB metering stays live.'
        );
      } else {
        setMicError('Speech recognition paused; live dB metering remains active.');
      }
    };

    recognition.onend = () => {
      if (!micActiveRef.current) return;
      // Always start a fresh SpeechRecognition session after a short backoff so event.results
      // resets cleanly and never accumulates or repeats old sentences.
      speechRestartTimerRef.current = window.setTimeout(() => {
        if (!micActiveRef.current) return;
        try {
          startFreshSpeechSession(SpeechCtor);
        } catch {
          // ignore restart throttle when micActive remains true for dB metering
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
      // Reuse already-live camera audio track if present to avoid Windows/Chrome dual-mic conflicts
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
        setMicError('Microphone active (dB level monitored); browser speech-to-text is unavailable here.');
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

  const statusBorderClass =
    camera.status === 'fighting'
      ? 'animate-alert-critical-pulse border-2 border-red-500 ring-2 ring-red-200'
      : camera.status === 'warning'
        ? 'border-amber-300'
        : 'border-slate-200';

  const countWord = camera.studentCount === 1 ? labels.personSingular : labels.personPlural;
  const modelLabel = camera.lastAnalysis?.modelUsed
    ? formatAiModelLabel(camera.lastAnalysis.modelUsed)
    : null;

  return (
    <article
      data-testid={`camera-card-${camera.id}`}
      className={`bg-white border rounded-xl overflow-hidden flex flex-col transition-colors ${statusBorderClass}`}
    >
      <div className="relative bg-slate-900 aspect-video w-full overflow-hidden">
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
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60 p-4">
            <button
              type="button"
              onClick={() => onReconnectStream(camera.id)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reconnect Live Camera</span>
            </button>
          </div>
        ) : null}

        {/* High-visibility Live Count / Empty Room HUD Badge */}
        {hasLiveSignal ? (
          <div
            data-testid={`camera-hud-count-${camera.id}`}
            className={`pointer-events-none absolute top-9 right-3 z-20 rounded-lg px-3 py-1.5 backdrop-blur-md border shadow-md flex items-center gap-2 ${
              camera.status === 'fighting'
                ? 'bg-red-700/90 border-red-300 text-white'
                : camera.studentCount === 0
                  ? 'bg-slate-900/85 border-slate-500/80 text-slate-100'
                  : 'bg-emerald-900/85 border-emerald-400/80 text-white'
            }`}
          >
            <span className="text-2xl leading-none font-extrabold font-mono tabular-nums">
              {camera.studentCount}
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {camera.studentCount === 0 ? 'EMPTY' : countWord.toUpperCase()}
              </span>
              <span className="text-[9px] font-mono opacity-85 uppercase">
                {camera.studentCount === 0 ? '0 detected' : 'Live count'}
              </span>
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3.5 py-2.5 flex items-end justify-between gap-3">
          <div className="text-xs text-slate-100 flex items-center gap-2 min-w-0">
            <span
              className={`font-mono font-semibold uppercase tracking-wider ${
                hasLiveSignal ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {hasLiveSignal ? 'LIVE' : 'NO SIGNAL'}
            </span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span className="font-mono tabular-nums font-semibold">
              {camera.studentCount} {countWord} live
              {typeof camera.expectedTotalCount === 'number' && camera.expectedTotalCount > 0
                ? ` / ${camera.expectedTotalCount}`
                : ''}
            </span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span
              className={`truncate ${
                camera.voiceListeningEnabled && camera.audioLevel > SOUND_ALERT_THRESHOLD_DB
                  ? 'text-red-300 font-semibold'
                  : 'text-slate-200'
              }`}
            >
              {camera.voiceListeningEnabled
                ? `Voice ${camera.audioLevel.toFixed(1)} dB${
                    camera.audioLevel > SOUND_ALERT_THRESHOLD_DB
                      ? ` (>${SOUND_ALERT_THRESHOLD_DB.toFixed(1)} · ${Math.min(
                          SOUND_ALERT_SUSTAINED_MS / 1000,
                          loudHoldSeconds
                        ).toFixed(1)}s/3s)`
                      : ''
                  }`
                : 'Voice muted'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onToggleFocus(camera.id)}
            aria-label={isFocused ? `Exit focus for ${camera.classroomName}` : `Focus ${camera.classroomName}`}
            className="pointer-events-auto p-1.5 rounded-md bg-black/50 text-white hover:bg-black/75 transition-colors cursor-pointer shrink-0"
          >
            {isFocused ? (
              <Minimize2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 truncate">
              {camera.classroomName}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
              <span>{camera.bluetoothDeviceName}</span>
              <span aria-hidden="true">·</span>
              <span>{camera.hasVoice ? 'Video + Voice' : 'Video'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{camera.bluetoothAddress}</span>
            </p>
          </div>

          <div className="shrink-0">
            {camera.status === 'fighting' ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap">
                <ShieldAlert className="w-4 h-4 text-red-600" aria-hidden="true" />
                <span>
                  {camera.lastAnalysis?.threatCategory === 'robbery_or_weapon'
                    ? 'Threat / Robbery'
                    : camera.lastAnalysis?.threatCategory === 'intrusion'
                      ? 'Breach Alert'
                      : camera.lastAnalysis?.threatCategory === 'beating'
                        ? 'Beating Detected'
                        : camera.lastAnalysis?.threatCategory === 'bullying'
                          ? 'Bullying Detected'
                          : 'Fight Detected'}
                </span>
              </span>
            ) : camera.status === 'warning' ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
                <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
                <span>Loud Disturbance</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                <span>Normal</span>
              </span>
            )}
          </div>
        </div>

        {/* Per-Camera Individual Live vs Class Total & Continuous Instant AI Box */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-md text-base font-extrabold font-mono tabular-nums ${
                    camera.status === 'fighting'
                      ? 'bg-red-100 text-red-800 border border-red-300'
                      : camera.studentCount === 0
                        ? 'bg-slate-200 text-slate-700'
                        : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                  }`}
                  data-testid={`camera-live-count-${camera.id}`}
                >
                  {camera.studentCount}
                </span>
                <span className="text-slate-600 font-semibold">
                  {camera.studentCount === 0 ? 'Empty' : `${countWord} live`}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Class total: </span>
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
                    className="font-mono font-semibold text-slate-800 hover:text-blue-600 underline decoration-dotted cursor-pointer tabular-nums"
                  >
                    {typeof camera.expectedTotalCount === 'number' && camera.expectedTotalCount > 0
                      ? camera.expectedTotalCount
                      : 'Set'}
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={isAutoAiOn}
              aria-label={`Toggle autonomous AI for ${camera.classroomName}`}
              onClick={() => onUpdateCameraSettings(camera.id, { autoAiEnabled: !isAutoAiOn })}
              className={`px-2 py-0.5 text-[11px] font-medium rounded border cursor-pointer whitespace-nowrap ${
                isAutoAiOn
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
              }`}
            >
              {isAutoAiOn ? 'Auto AI On' : 'Auto AI Off'}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                  camera.isAnalyzing
                    ? 'bg-blue-600 animate-pulse'
                    : isAutoAiOn && hasAiFeedSignal
                      ? 'bg-emerald-500'
                      : 'bg-slate-400'
                }`}
                aria-hidden="true"
              />
              <span className="font-medium text-slate-700 truncate" data-testid={`camera-cycle-label-${camera.id}`}>
                {camera.isAnalyzing ? 'AI analyzing live frame...' : scanModeLabel}
              </span>
              {isAutoAiOn && hasAiFeedSignal && liveMotionPercent > 0 ? (
                <span className="text-[10px] font-mono text-slate-500 tabular-nums shrink-0">
                  Δ{liveMotionPercent.toFixed(0)}%
                </span>
              ) : null}
            </div>

            <select
              aria-label={`AI model for ${camera.classroomName}`}
              value={activeCameraAiModel}
              onChange={(e) =>
                onUpdateCameraSettings(camera.id, { aiModel: e.target.value as AiEngineModel })
              }
              className="text-[11px] bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-800"
            >
              <option value="gemini-4-neon">Gemini 4 Neon</option>
              <option value="gemini-4-hydrogen">Gemini 4 Hydrogen</option>
              <option value="gpt-6-astra">GPT-6 Astra (High)</option>
              <option value="gpt-6-sol">GPT-6 Sol</option>
            </select>
          </div>

          {isAutoAiOn && hasAiFeedSignal ? (
            <div className="w-full h-1 bg-slate-200 rounded-full overflow-hidden" aria-hidden="true">
              <div
                className={`h-full transition-all duration-200 ${
                  camera.isAnalyzing ? 'bg-blue-600 w-full animate-pulse' : 'bg-emerald-500'
                }`}
                style={
                  camera.isAnalyzing
                    ? undefined
                    : { width: `${Math.min(100, Math.max(18, Math.round(liveMotionPercent * 4)))}%` }
                }
              />
            </div>
          ) : null}

          {camera.lastAnalysis ? (
            <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="font-semibold text-slate-700">Detected:</span>
              {camera.lastAnalysis.detectedPeople && camera.lastAnalysis.detectedPeople.length > 0 ? (
                camera.lastAnalysis.detectedPeople.map((p, idx) => (
                  <span
                    key={`${p.label}-${idx}`}
                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-mono text-[10px]"
                  >
                    #{idx + 1} {p.label} ({p.confidence}%)
                  </span>
                ))
              ) : (
                <span className="text-slate-500 font-medium">0 humans in frame (Empty)</span>
              )}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-100 pt-2.5 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-600">
              Live speech{micActive ? ' · Listening' : ''}
            </span>
            <div className="flex items-center gap-3">
              {camera.liveTranscript && !editingVoice ? (
                <button
                  type="button"
                  onClick={() => onUpdateTranscript(camera.id, '', undefined, 'audio-meter')}
                  className="text-xs text-slate-400 hover:text-slate-700 font-medium cursor-pointer whitespace-nowrap"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setEditingVoice((prev) => !prev)}
                className="text-xs text-slate-500 hover:text-slate-900 font-medium cursor-pointer whitespace-nowrap"
              >
                {editingVoice ? 'Cancel' : 'Edit cue'}
              </button>
              <button
                type="button"
                onClick={() => onToggleVoiceListening(camera.id)}
                className="text-xs text-blue-600 hover:underline font-medium cursor-pointer whitespace-nowrap"
              >
                {camera.voiceListeningEnabled ? 'Mute voice' : 'Enable voice'}
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
                className="flex-1 min-w-0 text-xs px-2 py-1 border border-slate-300 rounded-md text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
                placeholder="Enter voice note or live speech text..."
              />
              <button
                type="submit"
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shrink-0"
              >
                Save
              </button>
            </form>
          ) : (
            <p
              data-testid={`live-speech-${camera.id}`}
              className="text-slate-700 leading-relaxed line-clamp-2"
            >
              {camera.voiceListeningEnabled
                ? camera.liveTranscript ||
                  (micActive
                    ? 'Listening live for speech... speak to transcribe.'
                    : 'No speech transcript captured yet. Click Live Mic to listen.')
                : 'Voice monitoring paused for this zone.'}
            </p>
          )}

          {camera.lastAnalysis ? (
            <div className="space-y-0.5">
              <p className="text-slate-500 leading-relaxed">
                <span className="font-medium text-slate-700">
                  AI check{modelLabel ? ` (${modelLabel})` : ''}:
                </span>{' '}
                {camera.lastAnalysis.summary}
              </p>
              {camera.lastAnalysis.fallbackNote ? (
                <p className="text-[11px] text-amber-700">{camera.lastAnalysis.fallbackNote}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-slate-400">
              Continuous instant AI scans every change automatically with zero wait limit, or click Scan Now.
            </p>
          )}

          {streamError ? (
            <p role="alert" className="text-amber-700 font-medium">
              {streamError}
            </p>
          ) : null}
          {camera.errorMessage ? (
            <p role="alert" className="text-red-600 font-medium">
              {camera.errorMessage}
            </p>
          ) : null}
          {micError ? <p className="text-amber-700">{micError}</p> : null}
        </div>

        <div className="mt-auto pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onAnalyzeCamera(camera.id, false)}
              disabled={camera.isAnalyzing}
              aria-label={`Scan AI safety for ${camera.classroomName}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
            >
              <ScanSearch className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{camera.isAnalyzing ? 'Analyzing...' : 'Scan Now'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleLiveMic}
              aria-label={
                micActive
                  ? `Stop live microphone on ${camera.classroomName}`
                  : `Listen via microphone on ${camera.classroomName}`
              }
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                micActive
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {micActive ? (
                <Mic className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <MicOff className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{micActive ? 'Mic Live' : 'Live Mic'}</span>
            </button>

            {!isFocused ? (
              <button
                type="button"
                onClick={() => onToggleFocus(camera.id)}
                aria-label={`Open dedicated place for ${camera.classroomName}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Open Place</span>
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => onRemoveCamera(camera.id)}
            aria-label={`Remove ${camera.classroomName}`}
            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}
