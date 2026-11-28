import type {
  AiEngineModel,
  BluetoothClassification,
  BluetoothDeviceCandidate,
  ClassroomAnalysis,
  ClassroomCamera,
  DetectedObjectBox,
  DetectedPersonBox,
  FacilityMode,
  IncidentAlert,
  OperationMode,
  ThreatCategory,
  ThreatSensitivity,
} from '../types';

const CAMERA_KEYWORDS = [
  'cctv',
  'cam',
  'camera',
  'dome',
  'ipc',
  'hikvision',
  'axis',
  'uniview',
  'dahua',
  'reolink',
  'eufy',
  'arlo',
  'nest',
  'vision',
  'guard',
  'tapo',
  'tp-link',
  'wyze',
  'ring',
  'blink',
  'ezviz',
  'amcrest',
  'lorex',
  'bosch',
  'hanwha',
  'pelco',
  'avigilon',
  'verkada',
  'meraki',
  'esp32',
  'imou',
  'v380',
  'annke',
  'swann',
  'foscam',
  'ubiquiti',
  'unifi',
  'surveillance',
  'nvr',
  'dvr',
  'ptz',
];

const VOICE_KEYWORDS = [
  'voice',
  'mic',
  'audio',
  'av',
  'talk',
  'intercom',
  'sound',
  '2way',
  'two-way',
  'hands-free',
  'hfp',
];

const NON_CAMERA_KEYWORDS = [
  'speaker',
  'headphone',
  'earbud',
  'airpods',
  'tablet',
  'ipad',
  'watch',
  'keyboard',
  'mouse',
  'printer',
];

export const CCTV_VIDEO_SERVICE_UUID = '0000181a-0000-1000-8000-00805f9b34fb';
export const VOICE_AUDIO_SERVICE_UUID = '0000110b-0000-1000-8000-00805f9b34fb';

export function classifyBluetoothCamera(
  device: Pick<BluetoothDeviceCandidate, 'name' | 'serviceUuids' | 'declaredCapabilities'>
): BluetoothClassification {
  const normalizedName = device.name.toLowerCase();
  const uuids = device.serviceUuids.map((u) => u.toLowerCase());

  const explicitlyNonCamera = NON_CAMERA_KEYWORDS.some((kw) => normalizedName.includes(kw));
  const matchesCameraName = CAMERA_KEYWORDS.some((kw) => normalizedName.includes(kw));
  const hasVideoService = uuids.some(
    (u) => u.includes('181a') || u.includes('vid') || u.includes('cam')
  );
  const hasVoiceService = uuids.some(
    (u) => u.includes('110b') || u.includes('111e') || u.includes('aud') || u.includes('mic')
  );

  const supportsVideo =
    !explicitlyNonCamera &&
    (device.declaredCapabilities.video || matchesCameraName || hasVideoService);
  const supportsVoice =
    device.declaredCapabilities.voice ||
    hasVoiceService ||
    VOICE_KEYWORDS.some((kw) => normalizedName.includes(kw));

  const isCctvCamera = !explicitlyNonCamera && (matchesCameraName || device.declaredCapabilities.video);
  const isEligibleMonitor = isCctvCamera && supportsVideo && supportsVoice;

  if (!isCctvCamera) {
    return {
      isCctvCamera: false,
      supportsVideo: false,
      supportsVoice,
      isEligibleMonitor: false,
      deviceCategoryLabel: supportsVoice ? 'Bluetooth Audio / Mic' : 'Bluetooth Accessory',
      capabilitySummary: supportsVoice ? 'Audio/Voice only · Pair with video feed' : 'Not a CCTV camera',
    };
  }

  if (supportsVideo && supportsVoice) {
    return {
      isCctvCamera: true,
      supportsVideo: true,
      supportsVoice: true,
      isEligibleMonitor: true,
      deviceCategoryLabel: 'CCTV Camera',
      capabilitySummary: 'Video + Voice Recognition ready',
    };
  }

  return {
    isCctvCamera: true,
    supportsVideo,
    supportsVoice,
    isEligibleMonitor: false,
    deviceCategoryLabel: 'CCTV Camera (Video Only)',
    capabilitySummary: 'Video stream only · Missing voice microphone',
  };
}

export function deriveSafetyStatus(
  analysis: Pick<ClassroomAnalysis, 'isFighting' | 'severity' | 'threatCategory'>
): ClassroomCamera['status'] {
  if (
    analysis.isFighting ||
    analysis.severity === 'critical' ||
    analysis.threatCategory === 'beating' ||
    analysis.threatCategory === 'bullying' ||
    analysis.threatCategory === 'robbery_or_weapon' ||
    analysis.threatCategory === 'intrusion'
  ) {
    return 'fighting';
  }
  if (analysis.severity === 'warning') {
    return 'warning';
  }
  return 'normal';
}

let alertSequenceCounter = 0;

export interface AlertCategoryBadge {
  label: string;
  tone: 'critical' | 'bullying' | 'warning' | 'attendance';
}

export function formatAlertCategoryBadge(
  alert: Pick<IncidentAlert, 'alertType' | 'threatCategory' | 'severity'>
): AlertCategoryBadge {
  if (alert.alertType === 'attendance') {
    return { label: 'ATTENDANCE', tone: 'attendance' };
  }
  if (alert.alertType === 'sound-threshold') {
    return { label: 'SOUND ALERT', tone: 'critical' };
  }
  switch (alert.threatCategory) {
    case 'beating':
      return { label: 'BEATING ALERT', tone: 'critical' };
    case 'bullying':
      return { label: 'BULLYING ALERT', tone: 'bullying' };
    case 'robbery_or_weapon':
      return { label: 'WEAPON / ROBBERY', tone: 'critical' };
    case 'intrusion':
      return { label: 'BREACH / INTRUSION', tone: 'critical' };
    case 'fight':
      return { label: 'FIGHT ALERT', tone: 'critical' };
    case 'disturbance':
      return { label: 'DISTURBANCE', tone: 'warning' };
    default:
      return alert.severity === 'critical'
        ? { label: 'CRITICAL ALERT', tone: 'critical' }
        : { label: 'SAFETY WARNING', tone: 'warning' };
  }
}

export function evaluateFightNotification(
  camera: Pick<ClassroomCamera, 'id' | 'cameraCode' | 'classroomName'>,
  analysis: ClassroomAnalysis,
  _facilityMode: FacilityMode = 'all'
): IncidentAlert | null {
  const isCriticalThreat =
    analysis.isFighting ||
    analysis.severity === 'critical' ||
    analysis.threatCategory === 'beating' ||
    analysis.threatCategory === 'bullying' ||
    analysis.threatCategory === 'robbery_or_weapon' ||
    analysis.threatCategory === 'intrusion';

  if (!isCriticalThreat && analysis.severity !== 'warning') {
    return null;
  }

  const severity = isCriticalThreat ? 'critical' : 'warning';
  let headline = `Disturbance warning in ${camera.classroomName}`;
  if (analysis.threatCategory === 'robbery_or_weapon') {
    headline = `CRITICAL: Robbery or weapon threat detected in ${camera.classroomName}`;
  } else if (analysis.threatCategory === 'intrusion') {
    headline = `CRITICAL: Forced intrusion or breach in ${camera.classroomName}`;
  } else if (analysis.threatCategory === 'beating') {
    headline = `BEATING ALERT: Physical beating / assault detected in ${camera.classroomName}`;
  } else if (analysis.threatCategory === 'bullying') {
    headline = `BULLYING ALERT: Bullying or intimidation detected in ${camera.classroomName}`;
  } else if (analysis.isFighting || analysis.threatCategory === 'fight') {
    headline = `FIGHT ALERT: Physical altercation detected in ${camera.classroomName}`;
  }

  const fallbackScore =
    analysis.threatCategory === 'robbery_or_weapon'
      ? 96
      : analysis.threatCategory === 'beating'
        ? 95
        : analysis.threatCategory === 'intrusion'
          ? 92
          : analysis.threatCategory === 'bullying'
            ? 86
            : analysis.isFighting || analysis.threatCategory === 'fight'
              ? 88
              : 55;
  const threatScore =
    typeof analysis.threatScore === 'number' && Number.isFinite(analysis.threatScore)
      ? Math.min(100, Math.max(0, Math.round(analysis.threatScore)))
      : fallbackScore;

  const detectedBehaviors =
    Array.isArray(analysis.detectedBehaviors) && analysis.detectedBehaviors.length > 0
      ? analysis.detectedBehaviors
      : analysis.threatCategory === 'beating'
        ? ['Repeated physical beating / striking detected']
        : analysis.threatCategory === 'bullying'
          ? ['Bullying / cornering / verbal intimidation detected']
          : isCriticalThreat
            ? ['Physical aggression / safety escalation detected']
            : ['Loud vocal disturbance'];

  const recommendedAction =
    analysis.recommendedAction?.trim() ||
    (analysis.threatCategory === 'robbery_or_weapon' || analysis.threatCategory === 'intrusion'
      ? 'Initiate immediate lockdown, notify campus/bank security, and dispatch authorities.'
      : analysis.threatCategory === 'beating'
        ? 'Emergency intervention required immediately — stop the assault, protect the victim, and call medical/security staff.'
        : analysis.threatCategory === 'bullying'
          ? 'Intervene immediately, separate aggressor(s) from the targeted individual, and notify supervising teacher.'
          : isCriticalThreat
            ? 'Dispatch supervising staff to intervene immediately and separate individuals.'
            : 'Monitor live zone feed and check on acoustic disturbance.');

  alertSequenceCounter += 1;

  return {
    id: `alert-${camera.id}-${Date.now()}-${alertSequenceCounter}`,
    cameraId: camera.id,
    cameraCode: camera.cameraCode,
    classroomName: camera.classroomName,
    alertType: 'ai-vision',
    severity,
    threatCategory: analysis.threatCategory,
    threatScore,
    detectedBehaviors,
    recommendedAction,
    modelUsed: analysis.modelUsed,
    studentCount: analysis.studentCount,
    headline,
    voiceCue: analysis.voiceAnalysis || 'No vocal cues logged',
    details: analysis.fightReason || analysis.summary,
    timestamp: analysis.analyzedAt,
    acknowledged: false,
  };
}

export const SOUND_ALERT_THRESHOLD_DB = 90.1;
export const SOUND_ALERT_SUSTAINED_MS = 3000;
export const DEFAULT_DB_CALIBRATION_OFFSET = 102;

export function computeSplDecibels(
  timeDomainSamples: ArrayLike<number>,
  calibrationOffsetDb = DEFAULT_DB_CALIBRATION_OFFSET
): number {
  const len = timeDomainSamples.length;
  if (len === 0) return 30.0;

  let sumSquares = 0;
  for (let i = 0; i < len; i += 1) {
    const sample = timeDomainSamples[i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / len);
  if (rms <= 1e-6) {
    return Math.round(Math.max(25, calibrationOffsetDb - 72) * 10) / 10;
  }

  const dbfs = 20 * Math.log10(rms);
  const spl = Math.min(120, Math.max(25, dbfs + calibrationOffsetDb));
  return Math.round(spl * 10) / 10;
}

export interface SustainedSoundResult {
  nextStartMs: number | null;
  sustainedMs: number;
  triggered: boolean;
}

/**
 * Tracks how long a zone microphone stays strictly above thresholdDb (90.1 dB).
 * Resets immediately if sound drops to/below thresholdDb, and triggers ONLY once
 * sustained duration exceeds requiredDurationMs (> 3 seconds).
 */
export function evaluateSustainedSoundDuration(
  prevStartMs: number | null,
  audioLevel: number,
  nowMs: number,
  thresholdDb = SOUND_ALERT_THRESHOLD_DB,
  requiredDurationMs = SOUND_ALERT_SUSTAINED_MS
): SustainedSoundResult {
  if (!Number.isFinite(audioLevel) || audioLevel <= thresholdDb) {
    return {
      nextStartMs: null,
      sustainedMs: 0,
      triggered: false,
    };
  }

  const startMs = prevStartMs ?? nowMs;
  const sustainedMs = Math.max(0, nowMs - startMs);
  return {
    nextStartMs: startMs,
    sustainedMs,
    triggered: sustainedMs >= requiredDurationMs,
  };
}

export interface SpeechResultAlternativeLike {
  transcript?: string;
}

export interface SpeechResultLike {
  isFinal?: boolean;
  length: number;
  [index: number]: SpeechResultAlternativeLike;
}

/**
 * Extracts ONLY the newest spoken utterance from Web Speech API results starting at resultIndex,
 * preventing the classic continuous-mode bug where old sentences from index 0 repeat forever.
 */
export function extractLatestSpeechUtterance(
  results: ArrayLike<SpeechResultLike> | null | undefined,
  resultIndex = 0
): { utterance: string; isFinal: boolean } {
  if (!results || results.length === 0) {
    return { utterance: '', isFinal: false };
  }

  const safeStart = Math.max(0, Math.min(resultIndex, results.length - 1));
  const freshFinalParts: string[] = [];
  const freshInterimParts: string[] = [];

  for (let i = safeStart; i < results.length; i += 1) {
    const res = results[i];
    const text = String(res?.[0]?.transcript || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (res.isFinal) {
      freshFinalParts.push(text);
    } else {
      freshInterimParts.push(text);
    }
  }

  const dedupeSegments = (parts: string[]): string => {
    const kept: string[] = [];
    for (const part of parts) {
      const normalized = part.toLowerCase();
      const prev = kept[kept.length - 1]?.toLowerCase();
      if (prev && (prev === normalized || prev.endsWith(normalized))) {
        continue;
      }
      if (prev && normalized.startsWith(prev)) {
        kept[kept.length - 1] = part;
      } else {
        kept.push(part);
      }
    }
    return kept.join(' ').trim();
  };

  // Show active interim speech while speaking, or the fresh finalized sentence once finished
  if (freshInterimParts.length > 0) {
    const interimText = dedupeSegments(freshInterimParts);
    const finalPrefix = freshFinalParts.length > 0 ? dedupeSegments(freshFinalParts.slice(-1)) : '';
    const combined =
      finalPrefix && !interimText.toLowerCase().startsWith(finalPrefix.toLowerCase())
        ? `${finalPrefix} ${interimText}`.trim()
        : interimText;
    return { utterance: combined.slice(-220), isFinal: false };
  }

  if (freshFinalParts.length > 0) {
    return { utterance: dedupeSegments(freshFinalParts.slice(-2)).slice(-220), isFinal: true };
  }

  // Fallback to the very last non-empty recognition entry only (never index 0 history)
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const text = String(results[i]?.[0]?.transcript || '').replace(/\s+/g, ' ').trim();
    if (text) {
      return { utterance: text.slice(-220), isFinal: Boolean(results[i]?.isFinal) };
    }
  }

  return { utterance: '', isFinal: false };
}

export function shouldTriggerAudioSpikeScan(
  audioLevel: number,
  lastSpikeScanAtMs: number,
  nowMs: number,
  isAnalyzing: boolean,
  thresholdDb = SOUND_ALERT_THRESHOLD_DB,
  cooldownMs = 12000
): boolean {
  if (isAnalyzing) return false;
  if (audioLevel <= thresholdDb) return false;
  return nowMs - lastSpikeScanAtMs >= cooldownMs;
}

export interface SoundThresholdAlertOptions {
  thresholdDb?: number;
  sustainedSeconds?: number;
  teacherEmail?: string;
  teacherName?: string;
  courseName?: string;
  lastAlertAtMs?: number;
  nowMs?: number;
  cooldownMs?: number;
  liveTranscript?: string;
  operationMode?: OperationMode;
}

export function evaluateSoundThresholdAlert(
  camera: Pick<ClassroomCamera, 'id' | 'cameraCode' | 'classroomName' | 'studentCount'>,
  audioLevel: number,
  options: SoundThresholdAlertOptions = {}
): IncidentAlert | null {
  const thresholdDb = options.thresholdDb ?? SOUND_ALERT_THRESHOLD_DB;
  if (!Number.isFinite(audioLevel) || audioLevel <= thresholdDb) {
    return null;
  }

  const nowMs = options.nowMs ?? Date.now();
  const cooldownMs = options.cooldownMs ?? 15000;
  const lastAlertAtMs = options.lastAlertAtMs ?? 0;
  if (lastAlertAtMs > 0 && nowMs - lastAlertAtMs < cooldownMs) {
    return null;
  }

  alertSequenceCounter += 1;
  const isDisaster = options.operationMode === 'disaster';
  const formattedDb = audioLevel.toFixed(1);
  const sustainedSec =
    typeof options.sustainedSeconds === 'number' && options.sustainedSeconds > 0
      ? options.sustainedSeconds.toFixed(1)
      : (SOUND_ALERT_SUSTAINED_MS / 1000).toFixed(1);
  const timestamp = new Date(nowMs).toISOString();
  const teacherGreeting = isDisaster
    ? 'Emergency Command & Rescue Dispatch,'
    : options.teacherName
      ? `Hello ${options.teacherName},`
      : 'Hello Teacher,';
  const courseLine = options.courseName ? `${isDisaster ? 'Sector / Unit' : 'Course'}: ${options.courseName}\n` : '';
  const transcriptLine = options.liveTranscript
    ? `Captured speech cue: "${options.liveTranscript}"\n`
    : isDisaster
      ? 'Captured acoustic cue: Sustained >90.1 dB acoustic distress or structural collapse spike.\n'
      : 'Captured speech cue: Sustained loud noise detected (no speech transcript).\n';

  const teacherMessageSubject = isDisaster
    ? `[ACOUSTIC DISTRESS / STRUCTURAL COLLAPSE ALERT] ${camera.classroomName} reached ${formattedDb} dB (${sustainedSec}s)`
    : `[Urgent Sound Alert] ${camera.classroomName} stayed above ${thresholdDb.toFixed(1)} dB (${formattedDb} dB for ${sustainedSec}s)`;
  const teacherMessageBody = [
    teacherGreeting,
    '',
    isDisaster
      ? `An automated ACOUSTIC DISTRESS / STRUCTURAL COLLAPSE ALERT was triggered in ${camera.classroomName} (${camera.cameraCode}).`
      : `An automated sustained-noise alert was triggered in ${camera.classroomName} (${camera.cameraCode}).`,
    `Measured sound level: ${formattedDb} dB (stayed above ${thresholdDb.toFixed(1)} dB for ${sustainedSec}s).`,
    `${courseLine}Estimated occupancy: ${camera.studentCount} present.`,
    transcriptLine.trim(),
    `Logged at: ${timestamp}`,
    '',
    isDisaster
      ? 'Dispatch rescue / structural assessment team and verify evacuee safety immediately.'
      : 'Please check on the classroom/zone immediately.',
  ].join('\n');

  return {
    id: `alert-db-${camera.id}-${nowMs}-${alertSequenceCounter}`,
    cameraId: camera.id,
    cameraCode: camera.cameraCode,
    classroomName: camera.classroomName,
    alertType: 'sound-threshold',
    disasterPhase: isDisaster ? 2 : undefined,
    severity: 'critical',
    threatCategory: 'disturbance',
    studentCount: camera.studentCount,
    measuredDb: Number(formattedDb),
    headline: isDisaster
      ? `ACOUSTIC DISTRESS / STRUCTURAL COLLAPSE ALERT: ${camera.classroomName} (${formattedDb} dB · ${sustainedSec}s)`
      : `Teacher Sound Alert: ${camera.classroomName} stayed over ${thresholdDb.toFixed(1)} dB (${formattedDb} dB · ${sustainedSec}s)`,
    voiceCue: options.liveTranscript
      ? `${formattedDb} dB (${sustainedSec}s) — "${options.liveTranscript}"`
      : isDisaster
        ? `ACOUSTIC DISTRESS / STRUCTURAL COLLAPSE ALERT: ${formattedDb} dB (> ${thresholdDb.toFixed(1)} dB for ${sustainedSec}s)`
        : `Sustained sound ${formattedDb} dB exceeded ${thresholdDb.toFixed(1)} dB for ${sustainedSec}s`,
    details: isDisaster
      ? `Sustained >90.1 dB acoustic distress / structural collapse alert exceeded ${thresholdDb.toFixed(1)} dB for over ${(SOUND_ALERT_SUSTAINED_MS / 1000).toFixed(0)} seconds (supports Microphone-Only rubble/smoke rescue zones). Rescue dispatch prepared${options.teacherEmail ? ` (${options.teacherEmail})` : ''}.`
      : `Sustained noise exceeded ${thresholdDb.toFixed(1)} dB for over ${(SOUND_ALERT_SUSTAINED_MS / 1000).toFixed(0)} seconds. Alert prepared for teacher${options.teacherEmail ? ` (${options.teacherEmail})` : ''}.`,
    teacherMessageSubject,
    teacherMessageBody,
    teacherNotified: false,
    timestamp,
    acknowledged: false,
  };
}

export interface DisasterPhaseMeta {
  phase: 1 | 2 | 3;
  shortTag: string;
  title: string;
  description: string;
}

export function getDisasterPhaseMeta(phase: 1 | 2 | 3): DisasterPhaseMeta {
  if (phase === 1) {
    return {
      phase: 1,
      shortTag: 'PHASE 1 · PREVENTION',
      title: 'Phase 1 — Prevention & Early Warning',
      description: 'Stampede Risk Meter, Multi-Scale Crowd AI Pyramid, and Hazard Perimeter Zones.',
    };
  }
  if (phase === 2) {
    return {
      phase: 2,
      shortTag: 'PHASE 2 · RESPONSE',
      title: 'Phase 2 — Emergency Response & Victim Detection',
      description: 'Zero-delay Edge AI Fallen Victim detection, Acoustic Collapse (>90.1 dB), and Disaster Speech cues.',
    };
  }
  return {
    phase: 3,
    shortTag: 'PHASE 3 · RELIEF & RE-ID',
    title: 'Phase 3 — Post-Disaster Relief & Missing Person Re-ID',
    description: 'Cross-camera Missing Person / Evacuee Re-Identification and Tamper-Proof SHA-256 Rescue Logs.',
  };
}

export function classifyDisasterPhase(
  alert: Pick<IncidentAlert, 'disasterPhase' | 'alertType' | 'headline' | 'threatCategory' | 'details'>
): DisasterPhaseMeta {
  if (alert.disasterPhase === 1 || alert.disasterPhase === 2 || alert.disasterPhase === 3) {
    return getDisasterPhaseMeta(alert.disasterPhase);
  }
  const text = `${alert.headline || ''} ${alert.details || ''}`.toLowerCase();
  if (
    text.includes('missing person') ||
    text.includes('evacuee') ||
    text.includes('watchlist') ||
    text.includes('re-id') ||
    text.includes('sha-256')
  ) {
    return getDisasterPhaseMeta(3);
  }
  if (
    text.includes('stampede') ||
    text.includes('crush') ||
    text.includes('bottleneck') ||
    text.includes('overcrowding') ||
    text.includes('hazard zone') ||
    text.includes('perimeter') ||
    text.includes('collapsed structure') ||
    text.includes('flood / live wire') ||
    text.includes('fire / smoke') ||
    text.includes('evacuation dispatch')
  ) {
    return getDisasterPhaseMeta(1);
  }
  return getDisasterPhaseMeta(2);
}

export function evaluateFallenVictimAlert(
  camera: Pick<ClassroomCamera, 'id' | 'cameraCode' | 'classroomName' | 'studentCount'>,
  subject: { id: string; fallenDurationMs?: number; confidence?: number },
  options?: {
    nowMs?: number;
    lastAlertAtMs?: number;
    cooldownMs?: number;
  }
): IncidentAlert | null {
  const nowMs = options?.nowMs ?? Date.now();
  const cooldownMs = options?.cooldownMs ?? 15000;
  const lastAlertAtMs = options?.lastAlertAtMs ?? 0;
  if (lastAlertAtMs > 0 && nowMs - lastAlertAtMs < cooldownMs) {
    return null;
  }

  alertSequenceCounter += 1;
  const timestamp = new Date(nowMs).toISOString();
  const fallenSec = Math.max(1.5, ((subject.fallenDurationMs ?? 1500) / 1000)).toFixed(1);

  return {
    id: `alert-fallen-${camera.id}-${nowMs}-${alertSequenceCounter}`,
    cameraId: camera.id,
    cameraCode: camera.cameraCode,
    classroomName: camera.classroomName,
    alertType: 'ai-vision',
    disasterPhase: 2,
    severity: 'critical',
    threatCategory: 'disturbance',
    threatScore: 97,
    detectedBehaviors: [
      `Fallen / collapsed victim (${subject.id}) horizontal & stationary on ground for ${fallenSec}s`,
      'Zero-delay local Edge AI medical rescue trigger',
    ],
    recommendedAction:
      'Dispatch medical / rescue team immediately to check fallen or unconscious individual and clear surrounding pathway.',
    studentCount: Math.max(1, camera.studentCount || 1),
    headline: `FALLEN / COLLAPSED VICTIM DETECTED: ${subject.id} in ${camera.classroomName} (${fallenSec}s)`,
    voiceCue: `Local Edge AI Victim Alert: ${subject.id} stationary on ground (${fallenSec}s)`,
    details: `Phase 2 Emergency Response: Tracked subject ${subject.id} flipped horizontal and remained stationary on the ground for ${fallenSec}s in ${camera.classroomName} (${camera.cameraCode}). Immediate rescue team check required.`,
    teacherMessageSubject: `[RESCUE DISPATCH] Fallen / Collapsed Victim (${subject.id}) in ${camera.classroomName}`,
    teacherMessageBody: [
      'Emergency Command & Medical Rescue Dispatch,',
      '',
      `Phase 2 Fallen / Collapsed Victim Alert triggered in ${camera.classroomName} (${camera.cameraCode}).`,
      `Tracked Subject: ${subject.id}`,
      `Stationary Ground Duration: ${fallenSec}s`,
      `Logged at: ${timestamp}`,
      '',
      'Action Required: Dispatch nearest medical / search-and-rescue responders immediately.',
    ].join('\n'),
    teacherNotified: false,
    timestamp,
    acknowledged: false,
  };
}

export function evaluateStampedeRiskAlert(
  camera: Pick<ClassroomCamera, 'id' | 'cameraCode' | 'classroomName' | 'studentCount'>,
  personCount: number,
  threshold: number,
  options?: {
    dispatcherEmail?: string;
    nowMs?: number;
    panicVelocitySpike?: boolean;
    peakTrailVelocity?: number;
  }
): IncidentAlert {
  alertSequenceCounter += 1;
  const nowMs = options?.nowMs ?? Date.now();
  const timestamp = new Date(nowMs).toISOString();
  const safeCount = Math.max(0, Math.round(personCount));
  const safeThreshold = Math.max(1, Math.round(threshold));
  const panicSpike = Boolean(options?.panicVelocitySpike);
  const thresholdExceeded = safeCount >= safeThreshold || panicSpike;
  const velocityNote =
    panicSpike && options?.peakTrailVelocity
      ? ` · panic trail velocity ${options.peakTrailVelocity} u/s`
      : '';

  const headline = panicSpike
    ? `CRITICAL STAMPEDE RISK (PANIC VELOCITY SPIKE): ${camera.classroomName} (${safeCount} people${velocityNote})`
    : thresholdExceeded
      ? `STAMPEDE / OVERCROWDING RISK: ${camera.classroomName} (${safeCount} people · limit ${safeThreshold})`
      : `EVACUATION DISPATCH: ${camera.classroomName} (${safeCount} people · limit ${safeThreshold})`;
  const details = panicSpike
    ? `Phase 1 Stampede Prevention: Sudden nose-trail panic velocity spike (${options?.peakTrailVelocity ?? 0} u/s) detected on ${camera.classroomName} (${camera.cameraCode}) with ${safeCount} people tracked. Automated evacuation alert triggered.`
    : thresholdExceeded
      ? `CRITICAL STAMPEDE RISK detected on ${camera.classroomName} (${camera.cameraCode}): ${safeCount} people detected by Multi-Scale Crowd AI Pyramid (exceeds threshold of ${safeThreshold}). Automated evacuation dispatch ready.`
      : `Manual precautionary evacuation dispatch initiated on ${camera.classroomName} (${camera.cameraCode}): ${safeCount} people tracked against crowd density threshold of ${safeThreshold}.`;
  const teacherMessageSubject = thresholdExceeded
    ? `[EVACUATION DISPATCH] CRITICAL STAMPEDE / OVERCROWDING RISK in ${camera.classroomName} (${safeCount} people)`
    : `[EVACUATION DISPATCH] Precautionary Evacuation Order for ${camera.classroomName}`;
  const teacherMessageBody = [
    'Emergency Command & Rescue Dispatch,',
    '',
    thresholdExceeded
      ? `CRITICAL STAMPEDE RISK / OVERCROWDING WARNING triggered in ${camera.classroomName} (${camera.cameraCode}).`
      : `Precautionary Evacuation Dispatch initiated for ${camera.classroomName} (${camera.cameraCode}).`,
    `Live Multi-Scale Crowd AI Headcount: ${safeCount} people`,
    `Configured Crowd Density Threshold: ${safeThreshold} people`,
    `Density Classification: ${thresholdExceeded ? 'CRITICAL STAMPEDE RISK' : 'PRECAUTIONARY DISPATCH'}${velocityNote}`,
    `Logged at: ${timestamp}`,
    '',
    'Action Required: Open auxiliary emergency exits immediately, halt incoming foot traffic, and deploy crowd-control & rescue personnel.',
  ].join('\n');

  return {
    id: `alert-stampede-${camera.id}-${nowMs}-${alertSequenceCounter}`,
    cameraId: camera.id,
    cameraCode: camera.cameraCode,
    classroomName: camera.classroomName,
    alertType: 'ai-vision',
    disasterPhase: 1,
    severity: 'critical',
    threatCategory: 'disturbance',
    threatScore: thresholdExceeded ? 98 : 88,
    detectedBehaviors: panicSpike
      ? [
          `CRITICAL STAMPEDE RISK — Panic velocity spike (${options?.peakTrailVelocity ?? 0} u/s)`,
          `${safeCount} people tracked by Multi-Scale Crowd AI Pyramid`,
        ]
      : thresholdExceeded
        ? [
            `CRITICAL STAMPEDE RISK (${safeCount} people >= threshold ${safeThreshold})`,
            'Stampede & bottleneck overcrowding risk',
          ]
        : [`Precautionary evacuation dispatch (${safeCount}/${safeThreshold} people)`],
    recommendedAction:
      'Trigger immediate evacuation broadcast, open secondary exits, and dispatch Emergency Command & Rescue teams.',
    studentCount: safeCount,
    headline,
    voiceCue: panicSpike
      ? `Panic velocity spike (${options?.peakTrailVelocity ?? 0} u/s) — CRITICAL STAMPEDE RISK`
      : thresholdExceeded
        ? `Crowd density ${safeCount}/${safeThreshold} — CRITICAL STAMPEDE RISK`
        : `Precautionary evacuation dispatch (${safeCount}/${safeThreshold})`,
    details,
    teacherMessageSubject,
    teacherMessageBody,
    teacherNotified: false,
    timestamp,
    acknowledged: false,
  };
}

export interface OperationModeBranding {
  mode: OperationMode;
  headerSubtitle: string;
  workspaceNavLabel: string;
  workspaceNavMobileLabel: string;
  workspaceFullTitle: string;
  dispatchModalTitle: string;
  dispatchButtonLabel: string;
  recipientLabel: string;
  standbyTitle: string;
  standbySubtitle: string;
}

export function formatOperationModeBranding(
  operationMode: OperationMode,
  facilityMode: FacilityMode = 'all'
): OperationModeBranding {
  if (operationMode === 'disaster') {
    return {
      mode: 'disaster',
      headerSubtitle:
        'AI-Powered Disaster Management, Stampede Prevention & Emergency Rescue System (Campus & Public Safety)',
      workspaceNavLabel: 'PA & Rescue',
      workspaceNavMobileLabel: 'PA Hub',
      workspaceFullTitle: 'Emergency Command & PA Speaker Dispatch',
      dispatchModalTitle: 'PA Speaker & Evacuation Broadcast',
      dispatchButtonLabel: 'PA Broadcast',
      recipientLabel: 'Emergency Command / PA Zone Target',
      standbyTitle: 'Venue Emergency Command & PA Speaker Monitor',
      standbySubtitle:
        'Connect mall, campus, or relief-camp cameras and microphones for 100% offline stampede early warning, fallen-victim detection, automated PA voice evacuation broadcasts, hazard zones, and missing-person Re-ID.',
    };
  }

  const facility = formatFacilityLabels(facilityMode);
  return {
    mode: 'school',
    headerSubtitle: 'Multi-Zone Edge + Cloud School Safety, Attendance & Acoustic Monitor',
    workspaceNavLabel: 'Teacher Hub',
    workspaceNavMobileLabel: 'Hub',
    workspaceFullTitle: 'Teacher Alerts · Classroom & Gmail',
    dispatchModalTitle: 'Confirm Teacher Alert Dispatch',
    dispatchButtonLabel: 'Send to Teacher',
    recipientLabel: 'Teacher Alert Recipient Email',
    standbyTitle: facility.monitorTitle,
    standbySubtitle:
      'Choose a camera or microphone source to start live on-device human detection and safety monitoring.',
  };
}

export interface FacilityLabels {
  zoneSingular: string;
  zonePlural: string;
  personSingular: string;
  personPlural: string;
  monitorTitle: string;
  sectorDescription: string;
}

export function formatFacilityLabels(mode: FacilityMode): FacilityLabels {
  if (mode === 'bank') {
    return {
      zoneSingular: 'Zone',
      zonePlural: 'Bank Zones',
      personSingular: 'person',
      personPlural: 'people',
      monitorTitle: 'Multi-Zone Bank Security Monitor',
      sectorDescription: 'Detects fights, robbery/holdup postures, weapons, breaches, and panic audio across teller & vault zones.',
    };
  }
  if (mode === 'school') {
    return {
      zoneSingular: 'Classroom',
      zonePlural: 'Classrooms',
      personSingular: 'kid',
      personPlural: 'kids',
      monitorTitle: 'Multi-Classroom CCTV Monitor',
      sectorDescription: 'Detects student fighting, bullying, and distress shouting while counting kids in each classroom.',
    };
  }
  return {
    zoneSingular: 'Zone',
    zonePlural: 'Monitored Zones',
    personSingular: 'person',
    personPlural: 'people',
    monitorTitle: 'Multi-Zone AI Security Monitor',
    sectorDescription: 'Monitors banks, schools, and high-security sites for fights, threats, breaches, and exact headcount.',
  };
}

export interface CampusSummary {
  totalCameras: number;
  totalKidsCount: number;
  activeAlertsCount: number;
  fightingRoomsCount: number;
  voiceActiveCount: number;
}

export function computeCampusSummary(
  cameras: ClassroomCamera[],
  alerts: IncidentAlert[]
): CampusSummary {
  return {
    totalCameras: cameras.length,
    totalKidsCount: cameras.reduce((sum, cam) => sum + Math.max(0, cam.studentCount || 0), 0),
    activeAlertsCount: alerts.filter((a) => !a.acknowledged).length,
    fightingRoomsCount: cameras.filter((c) => c.status === 'fighting').length,
    voiceActiveCount: cameras.filter((c) => c.hasVoice && c.voiceListeningEnabled).length,
  };
}

export function filterIncidentAlerts(
  alerts: IncidentAlert[],
  filterMode: 'all' | 'unread' | 'critical' | 'bullying' | 'beating',
  cameraIdFilter: string
): IncidentAlert[] {
  return alerts.filter((alert) => {
    if (filterMode === 'unread' && alert.acknowledged) return false;
    if (filterMode === 'critical' && alert.severity !== 'critical') return false;
    if (filterMode === 'bullying' && alert.threatCategory !== 'bullying') return false;
    if (filterMode === 'beating' && alert.threatCategory !== 'beating') return false;
    if (cameraIdFilter !== 'all' && alert.cameraId !== cameraIdFilter) return false;
    return true;
  });
}

export function formatMacSignalLabel(rssiDbm: number): string {
  if (rssiDbm >= -55) return 'Strong signal';
  if (rssiDbm >= -70) return 'Good signal';
  return 'Weak signal';
}

export const CAMERA_WATCH_INTERVAL_SEC = 2;
export const CAMERA_ANALYZE_WINDOW_SEC = 8;
export const CAMERA_CYCLE_TOTAL_SEC = CAMERA_WATCH_INTERVAL_SEC + CAMERA_ANALYZE_WINDOW_SEC;

export type CameraAiCyclePhase =
  | 'paused'
  | 'waiting-signal'
  | 'watching-screen'
  | 'analyzing';

export interface CameraCycleStep {
  phase: CameraAiCyclePhase;
  phaseSecondsLeft: number;
  shouldCaptureAndAnalyze: boolean;
  progressPercent: number;
  label: string;
}

export function computeCameraCycleStep(
  elapsedSecInCycle: number,
  hasLiveSignal: boolean,
  autoAiEnabled: boolean
): CameraCycleStep {
  if (!autoAiEnabled) {
    return {
      phase: 'paused',
      phaseSecondsLeft: 0,
      shouldCaptureAndAnalyze: false,
      progressPercent: 0,
      label: 'Autonomous AI paused',
    };
  }

  if (!hasLiveSignal) {
    return {
      phase: 'waiting-signal',
      phaseSecondsLeft: 0,
      shouldCaptureAndAnalyze: false,
      progressPercent: 0,
      label: 'Waiting for camera signal',
    };
  }

  const normalized =
    ((Math.floor(elapsedSecInCycle) % CAMERA_CYCLE_TOTAL_SEC) + CAMERA_CYCLE_TOTAL_SEC) %
    CAMERA_CYCLE_TOTAL_SEC;

  if (normalized < CAMERA_WATCH_INTERVAL_SEC) {
    const left = CAMERA_WATCH_INTERVAL_SEC - normalized;
    return {
      phase: 'watching-screen',
      phaseSecondsLeft: left,
      shouldCaptureAndAnalyze: false,
      progressPercent: Math.round(((normalized + 1) / CAMERA_CYCLE_TOTAL_SEC) * 100),
      label: `Seeing screen (${left}s)`,
    };
  }

  const analyzeElapsed = normalized - CAMERA_WATCH_INTERVAL_SEC;
  const left = CAMERA_ANALYZE_WINDOW_SEC - analyzeElapsed;
  return {
    phase: 'analyzing',
    phaseSecondsLeft: left,
    shouldCaptureAndAnalyze: normalized === CAMERA_WATCH_INTERVAL_SEC,
    progressPercent: Math.round(((normalized + 1) / CAMERA_CYCLE_TOTAL_SEC) * 100),
    label: `AI analyzing (${left}s)`,
  };
}

export function formatCameraAttendanceLabel(
  liveCount: number,
  expectedTotalCount?: number,
  facilityMode: FacilityMode = 'all'
): string {
  const labels = formatFacilityLabels(facilityMode);
  const safeLive = Math.max(0, Math.round(liveCount || 0));
  const word = safeLive === 1 ? labels.personSingular : labels.personPlural;
  if (typeof expectedTotalCount === 'number' && expectedTotalCount > 0) {
    return `${safeLive} live / ${Math.round(expectedTotalCount)} total`;
  }
  return `${safeLive} ${word} live`;
}

export interface ClassAttendanceComputation {
  presentCount: number;
  absentCount: number;
  customTotal: number;
  attendanceRatePercent: number | null;
}

export function computeClassAttendance(
  livePresentCount: number,
  customTotal?: number
): ClassAttendanceComputation {
  const presentCount = Math.max(0, Math.round(Number(livePresentCount) || 0));
  const total =
    typeof customTotal === 'number' && Number.isFinite(customTotal) && customTotal > 0
      ? Math.round(customTotal)
      : 0;
  const absentCount = total > 0 ? Math.max(0, total - presentCount) : 0;
  const attendanceRatePercent =
    total > 0 ? Math.min(100, Math.round((presentCount / total) * 100)) : null;

  return {
    presentCount,
    absentCount,
    customTotal: total,
    attendanceRatePercent,
  };
}

export function getLocalDateKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shouldRunScheduledAttendance(
  attendanceCheckTime: string | undefined,
  attendanceCheckEnabled: boolean | undefined,
  lastCheckedDateKey: string | undefined,
  now: Date = new Date()
): boolean {
  if (!attendanceCheckEnabled || !attendanceCheckTime) return false;
  const match = /^(\d{2}):(\d{2})$/.exec(attendanceCheckTime.trim());
  if (!match) return false;

  const targetHour = Number(match[1]);
  const targetMinute = Number(match[2]);
  if (targetHour < 0 || targetHour > 23 || targetMinute < 0 || targetMinute > 59) {
    return false;
  }

  const todayKey = getLocalDateKey(now);
  if (lastCheckedDateKey === todayKey) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const targetMinutes = targetHour * 60 + targetMinute;
  return currentMinutes >= targetMinutes;
}

export function evaluateAttendanceReportAlert(
  camera: Pick<ClassroomCamera, 'id' | 'cameraCode' | 'classroomName' | 'studentCount' | 'expectedTotalCount' | 'attendanceCheckTime'>,
  options: {
    teacherEmail?: string;
    teacherName?: string;
    courseName?: string;
    now?: Date;
  } = {}
): IncidentAlert {
  const now = options.now ?? new Date();
  const attendance = computeClassAttendance(camera.studentCount, camera.expectedTotalCount);
  const timestamp = now.toISOString();
  alertSequenceCounter += 1;

  const greeting = options.teacherName ? `Hello ${options.teacherName},` : 'Hello Teacher,';
  const courseLine = options.courseName ? `Course: ${options.courseName}\n` : '';
  const scheduleNote = camera.attendanceCheckTime
    ? `Scheduled attendance time: ${camera.attendanceCheckTime}`
    : 'Manual attendance check';

  const summaryTotal =
    attendance.customTotal > 0
      ? `${attendance.presentCount} present, ${attendance.absentCount} absent out of ${attendance.customTotal} total (${attendance.attendanceRatePercent}%)`
      : `${attendance.presentCount} present live (set custom class total for absent count)`;

  const teacherMessageSubject = `[Attendance Report] ${camera.classroomName}: ${attendance.presentCount} Present / ${attendance.absentCount} Absent`;
  const teacherMessageBody = [
    greeting,
    '',
    `Scheduled roll call completed for ${camera.classroomName} (${camera.cameraCode}).`,
    `${courseLine}${scheduleNote}`,
    `Present: ${attendance.presentCount}`,
    `Absent: ${attendance.absentCount}`,
    `Custom Class Total: ${attendance.customTotal > 0 ? attendance.customTotal : 'Not set'}`,
    `Recorded at: ${timestamp}`,
  ].join('\n');

  return {
    id: `alert-att-${camera.id}-${now.getTime()}-${alertSequenceCounter}`,
    cameraId: camera.id,
    cameraCode: camera.cameraCode,
    classroomName: camera.classroomName,
    alertType: 'attendance',
    severity: 'warning',
    threatCategory: 'none',
    studentCount: attendance.presentCount,
    headline: `Attendance Check (${camera.classroomName}): ${attendance.presentCount} Present · ${attendance.absentCount} Absent`,
    voiceCue: scheduleNote,
    details: `${summaryTotal}.${options.teacherEmail ? ` Prepared for ${options.teacherEmail}.` : ''}`,
    teacherMessageSubject,
    teacherMessageBody,
    teacherNotified: false,
    timestamp,
    acknowledged: false,
  };
}

export function computeCalibratedOffsetFromDbfs(
  measuredDbfs: number,
  targetRoomSplDb = 42
): number {
  if (!Number.isFinite(measuredDbfs)) return DEFAULT_DB_CALIBRATION_OFFSET;
  const clampedDbfs = Math.min(-5, Math.max(-95, measuredDbfs));
  const rawOffset = Math.round(targetRoomSplDb - clampedDbfs);
  return Math.min(120, Math.max(85, rawOffset));
}

export function formatAiModelLabel(model?: AiEngineModel): string {
  switch (model) {
    case 'gemini-4-neon':
      return 'Gemini 4 Neon';
    case 'gemini-4-hydrogen':
      return 'Gemini 4 Hydrogen';
    case 'gpt-6-astra':
      return 'GPT-6 Astra';
    case 'gpt-6-sol':
      return 'GPT-6 Sol';
    default:
      return 'Gemini 4 Neon';
  }
}

export const INSTANT_CHANGE_THRESHOLD_PERCENT = 4.5;
export const INSTANT_CHANGE_MIN_GAP_MS = 250;
export const CONTINUOUS_IDLE_HEARTBEAT_MS = 750;

export function computeFrameDeltaPercent(
  prevRgba: ArrayLike<number> | null | undefined,
  currRgba: ArrayLike<number> | null | undefined,
  luminanceDiffThreshold = 18
): number {
  if (!prevRgba || !currRgba || prevRgba.length === 0 || currRgba.length === 0) {
    return 100;
  }
  const len = Math.min(prevRgba.length, currRgba.length);
  const pixelCount = Math.floor(len / 4);
  if (pixelCount === 0) return 0;

  let changedPixels = 0;
  for (let i = 0; i < pixelCount * 4; i += 4) {
    const prevLuma = prevRgba[i] * 0.299 + prevRgba[i + 1] * 0.587 + prevRgba[i + 2] * 0.114;
    const currLuma = currRgba[i] * 0.299 + currRgba[i + 1] * 0.587 + currRgba[i + 2] * 0.114;
    if (Math.abs(currLuma - prevLuma) >= luminanceDiffThreshold) {
      changedPixels += 1;
    }
  }

  return Math.round((changedPixels / pixelCount) * 1000) / 10;
}

export interface ContinuousScanDecision {
  shouldScan: boolean;
  reason: 'paused' | 'waiting-signal' | 'in-flight' | 'instant-change' | 'continuous-live' | 'standby';
}

export function shouldTriggerInstantContinuousScan(params: {
  autoAiEnabled: boolean;
  hasSignal: boolean;
  isAnalyzing: boolean;
  nowMs: number;
  lastScanFinishedAtMs: number;
  frameDeltaPercent: number;
  hasNeverScanned?: boolean;
  hasLocalEdgeVision?: boolean;
  localDetectedPeopleCount?: number;
}): ContinuousScanDecision {
  if (!params.autoAiEnabled) {
    return { shouldScan: false, reason: 'paused' };
  }
  if (!params.hasSignal) {
    return { shouldScan: false, reason: 'waiting-signal' };
  }
  if (params.isAnalyzing) {
    return { shouldScan: false, reason: 'in-flight' };
  }

  // When on-device Edge AI handles live 250ms headcount & boxes with zero quota,
  // only call cloud LLM for deep fight/weapon/robbery analysis when people are present
  // and real movement happens (or initial scan), avoiding wasted 429 calls on empty rooms.
  if (params.hasLocalEdgeVision) {
    const peopleCount = params.localDetectedPeopleCount ?? 0;
    if (peopleCount <= 0) {
      return { shouldScan: false, reason: 'standby' };
    }
    const elapsedSinceLast = Math.max(0, params.nowMs - params.lastScanFinishedAtMs);
    if (params.hasNeverScanned || (params.frameDeltaPercent >= 4.5 && elapsedSinceLast >= 6000)) {
      return { shouldScan: true, reason: 'instant-change' };
    }
    if (elapsedSinceLast >= 12000) {
      return { shouldScan: true, reason: 'continuous-live' };
    }
    return { shouldScan: false, reason: 'standby' };
  }

  if (params.hasNeverScanned) {
    return { shouldScan: true, reason: 'instant-change' };
  }

  const elapsedSinceLast = Math.max(0, params.nowMs - params.lastScanFinishedAtMs);
  if (
    params.frameDeltaPercent >= INSTANT_CHANGE_THRESHOLD_PERCENT &&
    elapsedSinceLast >= INSTANT_CHANGE_MIN_GAP_MS
  ) {
    return { shouldScan: true, reason: 'instant-change' };
  }
  if (elapsedSinceLast >= CONTINUOUS_IDLE_HEARTBEAT_MS) {
    return { shouldScan: true, reason: 'continuous-live' };
  }
  return { shouldScan: false, reason: 'standby' };
}

export function computeBoxIoU(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const interYMin = Math.max(a[0], b[0]);
  const interXMin = Math.max(a[1], b[1]);
  const interYMax = Math.min(a[2], b[2]);
  const interXMax = Math.min(a[3], b[3]);

  const interHeight = Math.max(0, interYMax - interYMin);
  const interWidth = Math.max(0, interXMax - interXMin);
  const interArea = interHeight * interWidth;
  if (interArea <= 0) return 0;

  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const unionArea = areaA + areaB - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

export function computeBoxContainment(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const interYMin = Math.max(a[0], b[0]);
  const interXMin = Math.max(a[1], b[1]);
  const interYMax = Math.min(a[2], b[2]);
  const interXMax = Math.min(a[3], b[3]);

  const interHeight = Math.max(0, interYMax - interYMin);
  const interWidth = Math.max(0, interXMax - interXMin);
  const interArea = interHeight * interWidth;
  if (interArea <= 0) return 0;

  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const minArea = Math.min(areaA, areaB);
  return minArea > 0 ? interArea / minArea : 0;
}

/**
 * Detects when two medium/large foreground person boxes are actually the vertically-split
 * upper half (head/forehead) and lower half (glasses/torso) of the SAME person — typically
 * produced across horizontal 2x2 tile seams when a user sits close to the camera.
 * Safe for dense crowds (requires minW >= 180) and distinct front/back or side-by-side people.
 */
export function isVerticallySplitSamePerson(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  const wA = Math.max(1, a[3] - a[1]);
  const hA = Math.max(1, a[2] - a[0]);
  const wB = Math.max(1, b[3] - b[1]);
  const hB = Math.max(1, b[2] - b[0]);
  const minW = Math.min(wA, wB);
  const maxW = Math.max(wA, wB);

  // Only applies to foreground/mid-ground people — never tiny distant rows in a dense crowd
  if (minW < 180) return false;

  // Must occupy virtually the same horizontal column and closely matched width (same body sliced at seam)
  const interX = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const cxA = (a[1] + a[3]) / 2;
  const cxB = (b[1] + b[3]) / 2;
  if (interX / minW < 0.72 || minW / maxW < 0.72 || Math.abs(cxA - cxB) > maxW * 0.2) {
    return false;
  }

  // Must vertically overlap or tightly abut at the seam
  const interY = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const vGap = a[2] < b[0] ? b[0] - a[2] : b[2] < a[0] ? a[0] - b[2] : 0;
  if (interY <= 0 && vGap > 20) {
    return false;
  }

  // Upper half must look like a chopped head/forehead slice (wide/square aspect >= 0.78),
  // NOT a tall slender distinct standing person (aspect ~0.35-0.55) rising behind the foreground person
  const combinedH = Math.max(a[2], b[2]) - Math.min(a[0], b[0]);
  const upperBox = a[0] <= b[0] ? a : b;
  const upperW = Math.max(1, upperBox[3] - upperBox[1]);
  const upperH = Math.max(1, upperBox[2] - upperBox[0]);
  const upperLooksLikeHeadSlice = upperW / upperH >= 0.78;

  return upperLooksLikeHeadSlice && combinedH <= 1000 && Math.min(hA, hB) <= 720;
}

export function isSamePersonDuplicate(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  const iou = computeBoxIoU(a, b);
  if (iou > 0.5) return true;

  // Merge nested/sliced boxes belonging to the same person (e.g. head/torso sub-box inside full body)
  // while keeping two genuinely offset front-and-back people separate.
  const containment = computeBoxContainment(a, b);
  if (containment > 0.78) {
    return true;
  }
  if (containment > 0.65) {
    const cxA = (a[1] + a[3]) / 2;
    const cxB = (b[1] + b[3]) / 2;
    const maxW = Math.max(1, a[3] - a[1], b[3] - b[1]);
    if (Math.abs(cxA - cxB) <= 0.3 * maxW) {
      return true;
    }
  }

  // Merge boxes that share almost the same horizontal & vertical span (jittered duplicate of same person)
  const interX = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const interY = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const minW = Math.max(1, Math.min(a[3] - a[1], b[3] - b[1]));
  const minH = Math.max(1, Math.min(a[2] - a[0], b[2] - b[0]));
  if (interX / minW >= 0.76 && interY / minH >= 0.68) {
    return true;
  }

  // Merge vertically-split upper/lower seam halves of the exact same close-up person
  if (isVerticallySplitSamePerson(a, b)) {
    return true;
  }

  return false;
}

/**
 * Detects when a weaker box is an outstretched hand, raised forearm, or sliced shoulder
 * attached to a close-up foreground person (e.g. holding a hand up or waving toward the camera),
 * preventing single-person feeds from flickering between 1 and 2 people while preserving
 * distinct 2nd humans and distant background visitors.
 */
export function isAttachedLimbOrHandFragment(
  primary: DetectedPersonBox,
  candidate: DetectedPersonBox
): boolean {
  const [pYmin, pXmin, pYmax, pXmax] = primary.box_2d;
  const [cYmin, cXmin, cYmax, cXmax] = candidate.box_2d;
  const pW = Math.max(1, pXmax - pXmin);
  const pH = Math.max(1, pYmax - pYmin);
  const cW = Math.max(1, cXmax - cXmin);
  const cH = Math.max(1, cYmax - cYmin);
  const pArea = pW * pH;

  // Only applies when primary is a close-up foreground human (even if a fast hand temporarily lowers face confidence)
  if ((pArea < 140_000 && pH < 520) || primary.confidence < 45) {
    return false;
  }

  // Real distinct people with clear visible heads/faces score high (>= 72%) — never drop them
  const confDiff = primary.confidence - candidate.confidence;
  if (candidate.confidence >= 72 || confDiff < 0) {
    return false;
  }

  // Preserve small distant background visitors standing behind/above a close-up presenter's shoulder
  if (cYmax < pYmax - pH * 0.38 && cH < pH * 0.45) {
    return false;
  }

  const containment = computeBoxContainment(primary.box_2d, candidate.box_2d);
  const iou = computeBoxIoU(primary.box_2d, candidate.box_2d);
  const hGap =
    pXmax < cXmin ? cXmin - pXmax : cXmax < pXmin ? pXmin - cXmax : 0;
  const interTop = Math.max(pYmin, cYmin);
  const interBottom = Math.min(pYmax, cYmax);
  const interY = Math.max(0, interBottom - interTop);
  const minH = Math.max(1, Math.min(pH, cH));
  const vOverlap = interY / minH;
  const interX = Math.max(0, Math.min(pXmax, cXmax) - Math.max(pXmin, cXmin));
  const minW = Math.max(1, Math.min(pW, cW));

  const startsBelowHead = cYmin >= pYmin + pH * 0.14;
  const bothBottomAnchored = pYmax >= 820 && cYmax >= 800;
  const handLikeAspect = cW / cH >= 0.62;
  const isCompactFragment = cH <= pH * 0.58;
  const isForearmFromBottom = cYmax >= 820 && (cH <= pH * 0.66 || handLikeAspect);

  // Rule A: Raised hand/forearm in front of chest/face/lens overlapping primary.
  // Even during a fast hand swipe that momentarily lowers body confidence (confDiff >= 0),
  // a compact/hand-shaped/below-head fragment deeply inside the body (containment >= 0.45)
  // is a hand/arm, while a tall distinct person standing behind the shoulder is preserved.
  if (
    (containment >= 0.45 &&
      candidate.confidence < 70 &&
      (handLikeAspect || isCompactFragment || startsBelowHead)) ||
    (containment >= 0.38 &&
      confDiff >= 10 &&
      (startsBelowHead || handLikeAspect || isCompactFragment))
  ) {
    return true;
  }

  // Rule B: Fast outstretched or waving arm/hand extending to the left or right of the body.
  // Catches both attached sleeves (hGap <= 24) and motion-blurred hands reaching up to ~95 units
  // off the torso edge when shaped like a hand/palm or forearm from the bottom edge — while
  // preserving slender portrait background visitors (cW/cH < 0.62, cH > 0.36*pH) standing behind!
  const sideCompactOrForearm =
    hGap <= 95 &&
    startsBelowHead &&
    vOverlap >= 0.35 &&
    candidate.confidence < 70 &&
    (handLikeAspect || cH <= pH * 0.36 || isForearmFromBottom);
  const sideAttachedLimb =
    hGap <= 24 &&
    startsBelowHead &&
    vOverlap >= 0.42 &&
    candidate.confidence < 68 &&
    confDiff >= 10;
  if (sideCompactOrForearm || sideAttachedLimb) {
    return true;
  }

  // Rule C: Raised or swinging arm shifting/splitting a close-up person's bounding box into 2 overlapping detections
  if (
    confDiff >= 8 &&
    (iou >= 0.28 || (interX / minW >= 0.45 && interY / minH >= 0.58)) &&
    (bothBottomAnchored || startsBelowHead)
  ) {
    return true;
  }

  // Rule D: Fast waving hand raised high next to head/ear/shoulder.
  // Detached boxes (hGap > 18) must have hand-like shape or small palm height so slender
  // background visitors standing beside the presenter's shoulder are never dropped.
  if (
    hGap <= 55 &&
    vOverlap >= 0.38 &&
    cYmax >= pYmin + pH * 0.42 &&
    candidate.confidence < 66 &&
    ((hGap <= 18 && cH <= pH * 0.66 && (handLikeAspect || confDiff >= 10)) ||
      (hGap > 18 && (handLikeAspect || cH <= pH * 0.36) && confDiff >= 8) ||
      (hGap === 0 && candidate.confidence < 58 && confDiff >= 24 && cW / cH >= 0.48))
  ) {
    return true;
  }

  return false;
}

export function filterVerifiedPersonDetections(
  rawDetections: Array<{
    label?: string;
    box_2d?: number[];
    confidence?: number;
  }> | null | undefined,
  minConfidence = 78
): DetectedPersonBox[] {
  if (!Array.isArray(rawDetections) || rawDetections.length === 0) {
    return [];
  }

  const validCandidates: DetectedPersonBox[] = [];
  for (const item of rawDetections) {
    if (!item || !Array.isArray(item.box_2d) || item.box_2d.length !== 4) continue;
    const rawCoords = item.box_2d.map((n) => Number(n));
    if (rawCoords.some((n) => !Number.isFinite(n))) continue;

    // Support both 0..1000 and 0..1 normalized boxes gracefully
    const looksUnitNormalized = rawCoords.every((n) => n >= 0 && n <= 1);
    const scaled = looksUnitNormalized
      ? rawCoords.map((n) => Math.round(n * 1000))
      : rawCoords.map((n) => Math.round(n));

    const ymin = Math.min(1000, Math.max(0, scaled[0]));
    const xmin = Math.min(1000, Math.max(0, scaled[1]));
    const ymax = Math.min(1000, Math.max(0, scaled[2]));
    const xmax = Math.min(1000, Math.max(0, scaled[3]));

    const height = ymax - ymin;
    const width = xmax - xmin;
    const area = height * width;
    // Allow back-row students / distant bank visitors while filtering tiny pixel noise
    if (height < 32 || width < 18 || area < 900) continue;

    const confidence =
      typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.min(
            100,
            Math.max(0, Math.round(item.confidence <= 1 ? item.confidence * 100 : item.confidence))
          )
        : 0;

    if (confidence < minConfidence) continue;
    // Reject bogus full-frame fallback boxes
    if (width > 960 && height > 960 && confidence < 92) continue;

    const label = String(item.label || 'Person').trim().slice(0, 60) || 'Person';
    validCandidates.push({
      label,
      box_2d: [ymin, xmin, ymax, xmax],
      confidence,
    });
  }

  // Sort by confidence descending and merge ONLY true duplicates (preserving closely spaced multi-person groups)
  validCandidates.sort((a, b) => b.confidence - a.confidence);
  const kept: DetectedPersonBox[] = [];
  for (const candidate of validCandidates) {
    const isDuplicate = kept.some(
      (existing) =>
        isSamePersonDuplicate(existing.box_2d, candidate.box_2d) ||
        isAttachedLimbOrHandFragment(existing, candidate)
    );
    if (!isDuplicate) {
      kept.push(candidate);
    }
  }

  // Sort left-to-right so #1, #2, #3 labels stay consistent across frames
  kept.sort((a, b) => a.box_2d[1] - b.box_2d[1]);
  return kept;
}

export function mergeTiledPersonDetections(
  fullFrameBoxes: DetectedPersonBox[],
  leftTileBoxes: DetectedPersonBox[],
  rightTileBoxes: DetectedPersonBox[],
  minConfidence = 48
): DetectedPersonBox[] {
  const describeZone = (xmin: number, xmax: number): string => {
    const center = (xmin + xmax) / 2;
    if (center < 330) return 'Person (left)';
    if (center > 670) return 'Person (right)';
    return 'Person (center)';
  };

  const mappedLeft: DetectedPersonBox[] = leftTileBoxes.map((b) => {
    const [ymin, xmin, ymax, xmax] = b.box_2d;
    const mappedXMin = Math.round(xmin * 0.6);
    const mappedXMax = Math.round(xmax * 0.6);
    return {
      label: describeZone(mappedXMin, mappedXMax),
      box_2d: [ymin, mappedXMin, ymax, mappedXMax],
      confidence: b.confidence,
    };
  });

  const mappedRight: DetectedPersonBox[] = rightTileBoxes.map((b) => {
    const [ymin, xmin, ymax, xmax] = b.box_2d;
    const mappedXMin = Math.round(400 + xmin * 0.6);
    const mappedXMax = Math.round(400 + xmax * 0.6);
    return {
      label: describeZone(mappedXMin, mappedXMax),
      box_2d: [ymin, mappedXMin, ymax, mappedXMax],
      confidence: b.confidence,
    };
  });

  // Drop ANY tile fragment that slices or overlaps an already-detected full-frame person
  const isTileFragmentOfFullPerson = (
    tileBox: DetectedPersonBox,
    touchesSeam: boolean
  ): boolean => {
    const [tymin, txmin, tymax, txmax] = tileBox.box_2d;
    const tw = Math.max(1, txmax - txmin);
    const th = Math.max(1, tymax - tymin);
    return fullFrameBoxes.some((full) => {
      const [fymin, fxmin, fymax, fxmax] = full.box_2d;
      const containment = computeBoxContainment(full.box_2d, tileBox.box_2d);
      if (containment >= 0.55) return true;
      if (touchesSeam && containment >= 0.25) return true;

      const interX = Math.max(0, Math.min(fxmax, txmax) - Math.max(fxmin, txmin));
      const interY = Math.max(0, Math.min(fymax, tymax) - Math.max(fymin, tymin));
      if (interX / tw >= 0.6 && interY / th >= 0.45) return true;
      return false;
    });
  };

  const filteredLeft = mappedLeft.filter(
    (b) => !isTileFragmentOfFullPerson(b, b.box_2d[3] >= 560)
  );
  const filteredRight = mappedRight.filter(
    (b) => !isTileFragmentOfFullPerson(b, b.box_2d[1] <= 440)
  );

  // Merge full-frame + unclipped tile boxes with strict person-aware deduplication
  return filterVerifiedPersonDetections(
    [...fullFrameBoxes, ...filteredLeft, ...filteredRight],
    minConfidence
  );
}

export interface TrackedPersonEntry {
  box: DetectedPersonBox;
  missedFrames: number;
  confirmedFrames?: number;
  torsoSignature?: number[];
  faceOccluded?: boolean;
  occludedBy?: string;
}

export interface PersonTrackerState {
  confirmed: TrackedPersonEntry[];
  pending: DetectedPersonBox[];
}

/**
 * Compares two compact lower-torso pixel signatures (0..255 luma/RGB values sampled from the
 * shoulders/chest region of a person's bounding box). Returns a similarity score in [0, 1]
 * that stays high (>= 0.64) when a person covers their face with a racket/hand/book while
 * their torso remains in frame, and drops sharply (< 0.45) when they walk away.
 */
export function computeTorsoPatchSimilarity(
  sigA: number[] | null | undefined,
  sigB: number[] | null | undefined
): number {
  if (!sigA || !sigB || sigA.length === 0 || sigA.length !== sigB.length) {
    return 0;
  }
  let diffSum = 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < sigA.length; i += 1) {
    diffSum += Math.abs(sigA[i] - sigB[i]);
    meanA += sigA[i];
    meanB += sigB[i];
  }
  meanA /= sigA.length;
  meanB /= sigB.length;

  const madScore = Math.max(0, 1 - diffSum / (sigA.length * 105));

  // Combine with zero-mean cosine correlation & reject flat uniform walls when person has left
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < sigA.length; i += 1) {
    const da = sigA[i] - meanA;
    const db = sigB[i] - meanB;
    dot += da * db;
    normA += da * da;
    normB += db * db;
  }
  const stdB = Math.sqrt(normB / sigB.length);
  if (stdB < 5 && Math.sqrt(normA / sigA.length) >= 10) {
    // Previously textured torso became a flat wall/background -> person left
    return 0;
  }
  const denom = Math.sqrt(normA * normB);
  const corrScore = denom > 1e-4 ? Math.max(0, (dot / denom + 1) / 2) : madScore;

  return Math.round((madScore * 0.62 + corrScore * 0.38) * 1000) / 1000;
}

/**
 * Checks whether any detected handheld occluder object (e.g. Tennis Racket, Book, Backpack,
 * Phone, Umbrella) overlaps the upper 60% (head/face/upper-chest zone) of a person's box.
 */
export function findFaceOccluderForPerson(
  personBox: [number, number, number, number],
  occluderObjects: DetectedObjectBox[] | undefined
): DetectedObjectBox | null {
  if (!occluderObjects || occluderObjects.length === 0) return null;
  const [pymin, pxmin, pymax, pxmax] = personBox;
  const pw = Math.max(1, pxmax - pxmin);
  const ph = Math.max(1, pymax - pymin);

  // Upper 62% of the person's box covers head, face, and raised hands holding a racket/object
  const headZone: [number, number, number, number] = [
    Math.max(0, pymin - Math.round(ph * 0.12)),
    Math.max(0, pxmin - Math.round(pw * 0.1)),
    Math.min(1000, pymin + Math.round(ph * 0.62)),
    Math.min(1000, pxmax + Math.round(pw * 0.1)),
  ];

  let best: DetectedObjectBox | null = null;
  let bestOverlap = 0;

  for (const obj of occluderObjects) {
    const [oymin, oxmin, oymax, oxmax] = obj.box_2d;
    const interY = Math.max(0, Math.min(headZone[2], oymax) - Math.max(headZone[0], oymin));
    const interX = Math.max(0, Math.min(headZone[3], oxmax) - Math.max(headZone[1], oxmin));
    const interArea = interX * interY;
    if (interArea <= 0) continue;

    const headArea = Math.max(1, (headZone[2] - headZone[0]) * (headZone[3] - headZone[1]));
    const objArea = Math.max(1, (oymax - oymin) * (oxmax - oxmin));
    const coverage = Math.max(interArea / headArea, interArea / objArea);

    if (coverage >= 0.16 && coverage > bestOverlap) {
      bestOverlap = coverage;
      best = obj;
    }
  }
  return best;
}

function boxesSpatiallyMatch(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  if (computeBoxIoU(a, b) >= 0.22) return true;
  const cxA = (a[1] + a[3]) / 2;
  const cyA = (a[0] + a[2]) / 2;
  const cxB = (b[1] + b[3]) / 2;
  const cyB = (b[0] + b[2]) / 2;
  const maxDim = Math.max(1, a[3] - a[1], a[2] - a[0], b[3] - b[1], b[2] - b[0]);
  const dist = Math.hypot(cxA - cxB, cyA - cyB);
  return dist <= 0.42 * maxDim;
}

function formatOccludedPersonBox(
  box: DetectedPersonBox,
  occludedBy?: string
): DetectedPersonBox {
  const cleanLabel = occludedBy
    ? `Person (Face Covered · ${occludedBy})`
    : 'Person (Face Occluded)';
  return {
    ...box,
    label: cleanLabel,
    faceOccluded: true,
    occludedBy: occludedBy || 'Object / Hand',
  };
}

/**
 * Multi-frame occlusion-resilient person tracker.
 * - Locks onto 2nd/3rd/4th+ partially occluded people without 2->1->2 flicker.
 * - Recognizes when a person covers their face with a racket, book, bag, or hand via:
 *   (1) weak torso/body recovery detections (18-37%),
 *   (2) handheld occluder overlap over the head/face zone, and
 *   (3) lower-torso visual signature continuity (shoulders/chest pixels remain present).
 * - Still clears promptly to 0 when people truly leave the room.
 */
export function stepPersonTracker(
  prevState: PersonTrackerState,
  rawDetections: DetectedPersonBox[],
  options?: {
    instantConfidence?: number;
    minConfidence?: number;
    maxMissedFrames?: number;
    maxOccludedFrames?: number;
    weakDetections?: DetectedPersonBox[];
    occluderObjects?: DetectedObjectBox[];
    sampleTorsoSignature?: (box_2d: [number, number, number, number]) => number[] | null;
  }
): { nextState: PersonTrackerState; people: DetectedPersonBox[] } {
  const instantConfidence = options?.instantConfidence ?? 58;
  const minConfidence = options?.minConfidence ?? 36;
  const maxMissedFrames = options?.maxMissedFrames ?? 2;
  const maxOccludedFrames = options?.maxOccludedFrames ?? 35;
  const weakDetections = options?.weakDetections ?? [];
  const occluderObjects = options?.occluderObjects ?? [];
  const sampleTorso = options?.sampleTorsoSignature;

  const usableRaw = rawDetections.filter((d) => d.confidence >= minConfidence);
  const matchedConfirmedIdx = new Set<number>();
  const matchedWeakIdx = new Set<number>();
  const nextConfirmed: TrackedPersonEntry[] = [];
  const nextPending: DetectedPersonBox[] = [];

  for (const raw of usableRaw) {
    // Prefer matching an existing confirmed track by highest IoU / closest spatial match
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < prevState.confirmed.length; i += 1) {
      if (matchedConfirmedIdx.has(i)) continue;
      const candidateTrack = prevState.confirmed[i];
      if (!boxesSpatiallyMatch(candidateTrack.box.box_2d, raw.box_2d)) continue;
      const iou = computeBoxIoU(candidateTrack.box.box_2d, raw.box_2d);
      if (iou > bestScore) {
        bestScore = iou;
        bestIdx = i;
      }
    }

    const faceOccluder = findFaceOccluderForPerson(raw.box_2d, occluderObjects);
    const taggedBox = faceOccluder
      ? formatOccludedPersonBox(raw, faceOccluder.label)
      : { ...raw, faceOccluded: false, occludedBy: undefined };
    const freshTorso = sampleTorso ? sampleTorso(raw.box_2d) ?? undefined : undefined;

    if (bestIdx !== -1) {
      matchedConfirmedIdx.add(bestIdx);
      const prevTrack = prevState.confirmed[bestIdx];
      nextConfirmed.push({
        box: taggedBox,
        missedFrames: 0,
        confirmedFrames: Math.min(100, (prevTrack.confirmedFrames ?? 1) + 1),
        torsoSignature: freshTorso ?? prevTrack.torsoSignature,
        faceOccluded: Boolean(faceOccluder),
        occludedBy: faceOccluder?.label,
      });
      continue;
    }

    // Check if this brand-new candidate sits right beside/overlapping an existing close-up person:
    // fast waving hands often produce a 1-frame 50-75% motion-blur flash right next to the user.
    // Requiring 2 consecutive stable frames (unless >= 78% confident) blocks 1-frame hand flashes
    // while real people walking in still lock on smoothly within ~250ms!
    const nearExistingCloseUp =
      prevState.confirmed.length > 0 &&
      instantConfidence >= 35 &&
      prevState.confirmed.some((track) => {
        const tb = track.box.box_2d;
        const tw = Math.max(1, tb[3] - tb[1]);
        const th = Math.max(1, tb[2] - tb[0]);
        if (tw * th < 140_000 && th < 520) return false;
        const rb = raw.box_2d;
        const hGap = tb[3] < rb[1] ? rb[1] - tb[3] : rb[3] < tb[1] ? tb[1] - rb[3] : 0;
        const interY = Math.max(0, Math.min(tb[2], rb[2]) - Math.max(tb[0], rb[0]));
        return hGap <= 130 && interY > 0;
      });
    const effectiveInstantConf = nearExistingCloseUp
      ? Math.max(instantConfidence, 78)
      : instantConfidence;

    // High-confidence person locks in immediately on frame 1
    if (raw.confidence >= effectiveInstantConf) {
      nextConfirmed.push({
        box: taggedBox,
        missedFrames: 0,
        confirmedFrames: 1,
        torsoSignature: freshTorso,
        faceOccluded: Boolean(faceOccluder),
        occludedBy: faceOccluder?.label,
      });
      continue;
    }

    // Secondary/partially occluded person confirms once seen in 2 consecutive frames
    const matchedPending = prevState.pending.some((p) =>
      boxesSpatiallyMatch(p.box_2d, raw.box_2d)
    );
    if (matchedPending) {
      nextConfirmed.push({
        box: taggedBox,
        missedFrames: 0,
        confirmedFrames: 2,
        torsoSignature: freshTorso,
        faceOccluded: Boolean(faceOccluder),
        occludedBy: faceOccluder?.label,
      });
    } else {
      nextPending.push(taggedBox);
    }
  }

  // Helper: detect if an unmatched old track actually moved into an already-confirmed box
  // (prevents spawning a phantom 2nd "ghost" person whenever 1 person moves across the frame!)
  const isNearExistingLiveTrack = (box: [number, number, number, number]): boolean => {
    const cxA = (box[1] + box[3]) / 2;
    const cyA = (box[0] + box[2]) / 2;
    const wA = Math.max(1, box[3] - box[1]);
    return nextConfirmed.some((live) => {
      const b = live.box.box_2d;
      if (computeBoxIoU(box, b) >= 0.12) return true;
      if (computeBoxContainment(box, b) >= 0.4) return true;
      const cxB = (b[1] + b[3]) / 2;
      const cyB = (b[0] + b[2]) / 2;
      const maxDim = Math.max(1, wA, box[2] - box[0], b[3] - b[1], b[2] - b[0]);
      if (Math.hypot(cxA - cxB, cyA - cyB) <= 0.55 * maxDim) return true;
      return false;
    });
  };

  // Occlusion recovery for previously confirmed tracks that COCO-SSD missed this frame
  const emptyGrace = usableRaw.length === 0 ? 1 : maxMissedFrames;
  for (let i = 0; i < prevState.confirmed.length; i += 1) {
    if (matchedConfirmedIdx.has(i)) continue;
    const prev = prevState.confirmed[i];
    const prevBox = prev.box.box_2d;

    // ANTI-GHOST GUARD: If this track sits right next to/overlapping a live confirmed person,
    // the person simply shifted position — drop the stale ghost immediately!
    if (isNearExistingLiveTrack(prevBox)) {
      continue;
    }

    // 1. Check weak/occluded person detections (18-47% confidence) matching this person's position
    let bestWeakIdx = -1;
    let bestWeakScore = -1;
    for (let w = 0; w < weakDetections.length; w += 1) {
      if (matchedWeakIdx.has(w)) continue;
      const weak = weakDetections[w];
      if (isNearExistingLiveTrack(weak.box_2d)) continue;
      if (!boxesSpatiallyMatch(prevBox, weak.box_2d)) continue;
      const iou = computeBoxIoU(prevBox, weak.box_2d);
      if (iou > bestWeakScore) {
        bestWeakScore = iou;
        bestWeakIdx = w;
      }
    }

    if (bestWeakIdx !== -1) {
      matchedWeakIdx.add(bestWeakIdx);
      const weak = weakDetections[bestWeakIdx];
      const faceOccluder =
        findFaceOccluderForPerson(weak.box_2d, occluderObjects) ??
        findFaceOccluderForPerson(prevBox, occluderObjects);
      const liveTorso = sampleTorso ? sampleTorso(weak.box_2d) ?? undefined : undefined;
      nextConfirmed.push({
        box: formatOccludedPersonBox(
          {
            ...weak,
            confidence: Math.max(weak.confidence, Math.min(72, prev.box.confidence - 6)),
          },
          faceOccluder?.label ?? prev.occludedBy
        ),
        missedFrames: 0,
        confirmedFrames: Math.min(100, (prev.confirmedFrames ?? 1) + 1),
        torsoSignature: prev.torsoSignature ?? liveTorso,
        faceOccluded: true,
        occludedBy: faceOccluder?.label ?? prev.occludedBy ?? 'Object / Hand',
      });
      continue;
    }

    // 2. Check handheld occluder (e.g. Tennis Racket / Book over face) AND/OR textured torso continuity
    const faceOccluder = findFaceOccluderForPerson(prevBox, occluderObjects);
    const liveTorso =
      sampleTorso && prev.torsoSignature ? sampleTorso(prevBox) : null;
    const torsoSim =
      liveTorso && prev.torsoSignature
        ? computeTorsoPatchSimilarity(prev.torsoSignature, liveTorso)
        : 0;

    const isInteriorPerson = prevBox[1] > 35 && prevBox[3] < 965;
    const isSolidTrack = (prev.confirmedFrames ?? 1) >= 2;
    // Require genuine handheld occluder for extended hold; torso-only continuity holds briefly (<= 4 frames)
    // so departed people NEVER freeze as phantom counts on textured exhibition booth backgrounds!
    const torsoStillPresent = torsoSim >= 0.8;
    const occludedButPresent =
      isSolidTrack &&
      isInteriorPerson &&
      (Boolean(faceOccluder) || torsoStillPresent);

    if (occludedButPresent) {
      const strongHold = Boolean(faceOccluder) && (torsoSim >= 0.62 || !prev.torsoSignature);
      const effectiveCap = faceOccluder ? Math.min(maxOccludedFrames, 14) : Math.min(4, maxOccludedFrames);
      const nextMissed = strongHold ? Math.min(prev.missedFrames, 1) : prev.missedFrames + 1;
      if (nextMissed <= effectiveCap) {
        const occluderName = faceOccluder?.label ?? prev.occludedBy ?? 'Object / Hand';
        nextConfirmed.push({
          box: formatOccludedPersonBox(
            {
              ...prev.box,
              confidence: Math.max(55, Math.min(78, prev.box.confidence)),
            },
            occluderName
          ),
          missedFrames: nextMissed,
          confirmedFrames: prev.confirmedFrames ?? 2,
          torsoSignature: prev.torsoSignature,
          faceOccluded: true,
          occludedBy: occluderName,
        });
        continue;
      }
    }

    // 3. Standard brief blink grace (drops promptly to 0 when person actually leaves)
    const nextMissed = prev.missedFrames + 1;
    if (nextMissed <= emptyGrace) {
      nextConfirmed.push({
        ...prev,
        missedFrames: nextMissed,
      });
    }
  }

  // 4. Even if someone enters the frame ALREADY holding a racket/book over their face,
  // promote a weak torso detection overlapping a handheld occluder — ONLY if not overlapping an existing person
  for (let w = 0; w < weakDetections.length; w += 1) {
    if (matchedWeakIdx.has(w)) continue;
    const weak = weakDetections[w];
    if (weak.confidence < 24) continue;
    if (isNearExistingLiveTrack(weak.box_2d)) continue;
    const [ymin, xmin, ymax, xmax] = weak.box_2d;
    const bw = xmax - xmin;
    const bh = ymax - ymin;
    if (bw < 110 || bh < 200) continue;

    const faceOccluder = findFaceOccluderForPerson(weak.box_2d, occluderObjects);
    if (!faceOccluder) continue;

    const tagged = formatOccludedPersonBox(weak, faceOccluder.label);
    const matchedPending = prevState.pending.some((p) =>
      boxesSpatiallyMatch(p.box_2d, weak.box_2d)
    );
    if (matchedPending) {
      nextConfirmed.push({
        box: tagged,
        missedFrames: 0,
        confirmedFrames: 2,
        torsoSignature: sampleTorso ? sampleTorso(weak.box_2d) ?? undefined : undefined,
        faceOccluded: true,
        occludedBy: faceOccluder.label,
      });
    } else {
      nextPending.push(tagged);
    }
  }

  // Deduplicate any tracks that converged onto the same person and sort left-to-right.
  // Give established multi-frame tracks a small stability edge so a brand-new 1-frame fast-hand
  // detection never outranks the real person whose face briefly blurred while waving!
  nextConfirmed.sort((a, b) => {
    const scoreA = a.box.confidence + Math.min(10, (a.confirmedFrames ?? 1) * 2);
    const scoreB = b.box.confidence + Math.min(10, (b.confirmedFrames ?? 1) * 2);
    return scoreB - scoreA;
  });
  const dedupedTracks: TrackedPersonEntry[] = [];
  for (const track of nextConfirmed) {
    const dup = dedupedTracks.some(
      (kept) =>
        isSamePersonDuplicate(kept.box.box_2d, track.box.box_2d) ||
        isAttachedLimbOrHandFragment(kept.box, track.box)
    );
    if (!dup) {
      dedupedTracks.push(track);
    }
  }
  dedupedTracks.sort((a, b) => a.box.box_2d[1] - b.box.box_2d[1]);

  return {
    nextState: {
      confirmed: dedupedTracks,
      pending: nextPending,
    },
    people: dedupedTracks.map((t) => t.box),
  };
}

export const DISASTER_DISTRESS_KEYWORDS = [
  'help',
  'trapped',
  'fire',
  'earthquake',
  'flood',
  'collapse',
  'medical',
  'emergency',
] as const;

const LOCAL_DISASTER_VOICE_PATTERN =
  /\b(help|trapped|fire|earthquake|flood|collapse|collapsed|medical|emergency|injured|rescue|sos|evacuate|stampede)\b/i;

const LOCAL_BEATING_VOICE_PATTERN =
  /\b(beating|beat me|beat him|beat her|beat up|stop hitting|hitting me|hitting him|hitting her|kicking me|kicking him|slapping|slapped me|punching me|don'?t hit|stomping|whipping|pummeling|brutal assault)\b/i;

const LOCAL_BULLYING_VOICE_PATTERN =
  /\b(bully|bullying|bullied|leave me alone|stop teasing|stop pushing|back off|give it back|get away from me|give me your (money|lunch|bag|phone)|cornered|picking on|don'?t touch me|stop harassing|harassing|mocking me|tripped me|shoved me|shut up loser|stay away from me)\b/i;

const LOCAL_CRITICAL_VOICE_PATTERN =
  /\b(help|fight|fighting|hands up|robbery|gun|knife|weapon|shoot|police|emergency|attack|punch|assault|intruder|fire)\b/i;

const LOCAL_WARNING_VOICE_PATTERN =
  /\b(stop|get off|shut up|hey|scream|screaming|loud|argument|push|shove)\b/i;

export function matchDisasterDistressKeyword(transcript: string): string | null {
  const match = LOCAL_DISASTER_VOICE_PATTERN.exec((transcript || '').trim());
  return match ? match[1].toLowerCase() : null;
}

function computeBoxHorizontalGap(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  if (a[3] < b[1]) return b[1] - a[3];
  if (b[3] < a[1]) return a[1] - b[3];
  return 0;
}

function computeVerticalOverlapRatio(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const interTop = Math.max(a[0], b[0]);
  const interBottom = Math.min(a[2], b[2]);
  const interH = Math.max(0, interBottom - interTop);
  const minH = Math.max(1, Math.min(a[2] - a[0], b[2] - b[0]));
  return interH / minH;
}

interface MatchedPersonMotion {
  currIdx: number;
  curr: DetectedPersonBox;
  prev: DetectedPersonBox | null;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  speed: number;
  verticalDrop: number;
  heightShrink: number;
  width: number;
  height: number;
  nearEdge: boolean;
}

interface PairwiseInteractionMetrics {
  closeContactPairs: number;
  maxPairIoU: number;
  maxPairRelativeSpeed: number;
  maxPairClosingRate: number;
  opposingClashDetected: boolean;
  violentClashDetected: boolean;
  corneredPairDetected: boolean;
  crowdingTargetDetected: boolean;
  crowdingWithAgitation: boolean;
  hasHorizontalCollapsedPerson: boolean;
  maxBoxVelocity: number;
  maxVerticalDrop: number;
  bullyingReason: string;
}

function analyzePairwiseInteractions(
  prevPeople: DetectedPersonBox[],
  currPeople: DetectedPersonBox[],
  sensitivity: ThreatSensitivity = 'standard'
): PairwiseInteractionMetrics {
  const count = currPeople.length;
  if (count === 0) {
    return {
      closeContactPairs: 0,
      maxPairIoU: 0,
      maxPairRelativeSpeed: 0,
      maxPairClosingRate: 0,
      opposingClashDetected: false,
      violentClashDetected: false,
      corneredPairDetected: false,
      crowdingTargetDetected: false,
      crowdingWithAgitation: false,
      hasHorizontalCollapsedPerson: false,
      maxBoxVelocity: 0,
      maxVerticalDrop: 0,
      bullyingReason: '',
    };
  }

  // Match each current person uniquely to their closest previous-frame box
  const usedPrev = new Set<number>();
  const motions: MatchedPersonMotion[] = currPeople.map((curr, currIdx) => {
    const [cymin, cxmin, cymax, cxmax] = curr.box_2d;
    const cx = (cxmin + cxmax) / 2;
    const cy = (cymin + cymax) / 2;
    const width = Math.max(1, cxmax - cxmin);
    const height = Math.max(1, cymax - cymin);

    let bestPrevIdx = -1;
    let bestScore = Infinity;
    for (let p = 0; p < prevPeople.length; p += 1) {
      if (usedPrev.has(p)) continue;
      const [pymin, pxmin, pymax, pxmax] = prevPeople[p].box_2d;
      const pcx = (pxmin + pxmax) / 2;
      const pcy = (pymin + pymax) / 2;
      const dist = Math.hypot(cx - pcx, cy - pcy);
      if (dist <= 300 && dist < bestScore) {
        bestScore = dist;
        bestPrevIdx = p;
      }
    }

    let prev: DetectedPersonBox | null = null;
    let dx = 0;
    let dy = 0;
    let speed = 0;
    let verticalDrop = 0;
    let heightShrink = 0;

    if (bestPrevIdx !== -1) {
      usedPrev.add(bestPrevIdx);
      prev = prevPeople[bestPrevIdx];
      const [pymin, pxmin, pymax, pxmax] = prev.box_2d;
      const pcx = (pxmin + pxmax) / 2;
      const pcy = (pymin + pymax) / 2;
      dx = cx - pcx;
      dy = cy - pcy;
      speed = Math.hypot(dx, dy);
      verticalDrop = cymin - pymin;
      const prevH = Math.max(1, pymax - pymin);
      heightShrink = prevH - height;
    }

    return {
      currIdx,
      curr,
      prev,
      cx,
      cy,
      dx,
      dy,
      speed,
      verticalDrop,
      heightShrink,
      width,
      height,
      nearEdge: cxmin <= 105 || cxmax >= 895,
    };
  });

  let maxBoxVelocity = 0;
  let maxVerticalDrop = 0;
  let hasHorizontalCollapsedPerson = false;

  for (const m of motions) {
    if (m.speed > maxBoxVelocity) maxBoxVelocity = m.speed;
    if (m.verticalDrop > maxVerticalDrop) maxVerticalDrop = m.verticalDrop;
    // Require genuinely knocked-down/horizontal floor posture (NOT slight leaning forward over a desk)
    if (m.width / m.height >= 1.42 && m.curr.box_2d[0] >= 370) {
      hasHorizontalCollapsedPerson = true;
    }
  }

  const collisionIouThreshold = sensitivity === 'high' ? 0.14 : 0.18;
  const fightRelSpeedThreshold = sensitivity === 'high' ? 38 : 54;
  const violentRelSpeedThreshold = sensitivity === 'high' ? 68 : 88;
  const crowdGapThreshold = sensitivity === 'high' ? 52 : 40;

  let closeContactPairs = 0;
  let maxPairIoU = 0;
  let maxPairRelativeSpeed = 0;
  let maxPairClosingRate = 0;
  let opposingClashDetected = false;
  let violentClashDetected = false;
  let corneredPairDetected = false;
  let bullyingReason = '';

  // Track directional flanking per person for 3+ person group bullying
  const flankedLeft = new Array<boolean>(count).fill(false);
  const flankedRight = new Array<boolean>(count).fill(false);
  const crowdDegree = new Array<number>(count).fill(0);
  const crowdAgitationByPerson = new Array<boolean>(count).fill(false);

  if (count >= 2) {
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const mA = motions[i];
        const mB = motions[j];
        const a = mA.curr.box_2d;
        const b = mB.curr.box_2d;

        const containment = computeBoxContainment(a, b);
        const areaA = mA.width * mA.height;
        const areaB = mB.width * mB.height;
        const pairAreaRatio = Math.min(areaA, areaB) / Math.max(1, Math.max(areaA, areaB));
        // Never treat a small nested head/torso fragment as two distinct humans,
        // while allowing two equal-sized grappling people to register as close physical contact!
        if (containment >= 0.78 && pairAreaRatio < 0.55) continue;

        const iou = computeBoxIoU(a, b);
        if (iou > maxPairIoU) maxPairIoU = iou;
        const hGap = computeBoxHorizontalGap(a, b);
        const vOverlap = computeVerticalOverlapRatio(a, b);
        if (vOverlap < 0.32) continue;

        // Relative kinematics between Person A and Person B (immune to unrelated background movement!)
        const relDx = mA.dx - mB.dx;
        const relDy = mA.dy - mB.dy;
        const relSpeed = Math.hypot(relDx, relDy);
        const pairMaxSpeed = Math.max(mA.speed, mB.speed);

        let closingRate = 0;
        let advanceA = 0; // How much A moved toward B
        let advanceB = 0; // How much B moved toward A
        let retreatA = 0; // How much A backed away from B
        let retreatB = 0; // How much B backed away from A

        const dirX = mB.cx - mA.cx;
        const dirY = mB.cy - mA.cy;
        const currDist = Math.max(1, Math.hypot(dirX, dirY));
        const ux = dirX / currDist; // unit vector A -> B
        const uy = dirY / currDist;

        if (mA.prev && mB.prev) {
          const prevAx = (mA.prev.box_2d[1] + mA.prev.box_2d[3]) / 2;
          const prevAy = (mA.prev.box_2d[0] + mA.prev.box_2d[2]) / 2;
          const prevBx = (mB.prev.box_2d[1] + mB.prev.box_2d[3]) / 2;
          const prevBy = (mB.prev.box_2d[0] + mB.prev.box_2d[2]) / 2;
          const prevDist = Math.hypot(prevBx - prevAx, prevBy - prevAy);
          closingRate = prevDist - currDist;

          const projA = mA.dx * ux + mA.dy * uy; // + means A moves toward B
          const projB = -(mB.dx * ux + mB.dy * uy); // + means B moves toward A
          advanceA = Math.max(0, projA);
          advanceB = Math.max(0, projB);
          retreatA = Math.max(0, -projA);
          retreatB = Math.max(0, -projB);
        }

        if (relSpeed > maxPairRelativeSpeed) maxPairRelativeSpeed = relSpeed;
        if (closingRate > maxPairClosingRate) maxPairClosingRate = closingRate;

        // Smooth walking together (same velocity direction, steady spacing, upright posture) is NEVER an altercation!
        const sameDirectionWalking =
          mA.speed >= 8 &&
          mB.speed >= 8 &&
          mA.dx * mB.dx + mA.dy * mB.dy > 0 &&
          relSpeed < 24 &&
          closingRate < 5 &&
          mA.heightShrink < 14 &&
          mB.heightShrink < 14 &&
          mA.verticalDrop < 16 &&
          mB.verticalDrop < 16 &&
          !mA.nearEdge &&
          !mB.nearEdge;

        // 1. Overlapping physical contact / altercation
        if (iou >= collisionIouThreshold && vOverlap >= 0.35) {
          closeContactPairs += 1;
          crowdDegree[i] += 1;
          crowdDegree[j] += 1;

          // Distinguish real fight clash from two people calmly overlapping in depth or walking side-by-side:
          // Require sharp relative motion (collision, shoving, grappling) OR strong mutual inward/erratic motion
          const mutualOpposition =
            (advanceA >= 14 && advanceB >= 14) ||
            (relSpeed >= fightRelSpeedThreshold && !sameDirectionWalking) ||
            (closingRate >= 28 && pairMaxSpeed >= 38);

          if (mutualOpposition) {
            opposingClashDetected = true;
          }
          if (relSpeed >= violentRelSpeedThreshold && !sameDirectionWalking) {
            violentClashDetected = true;
          }
        }

        // 2. Real 2-Person Bullying / Cornering / Shoving / Intimidation Detection!
        const inPersonalSpace =
          (iou >= 0.05 && vOverlap >= 0.45) || (hGap <= 58 && vOverlap >= 0.48);

        if (inPersonalSpace && !sameDirectionWalking) {
          // People of ANY height/age can stand peacefully side-by-side or near edges.
          // NEVER infer bullying from static height differences or stationary poses!
          const activePairMotion = pairMaxSpeed >= 12 || relSpeed >= 14;

          // Case A: Asymmetric lunge & retreat / shoving (Aggressor actively advances while Victim recoils, crouches, or is pinned)
          const aBulliesB =
            activePairMotion &&
            advanceA >= (sensitivity === 'high' ? 12 : 16) &&
            (retreatB >= 8 || mB.heightShrink >= 18 || mB.verticalDrop >= 22 || mB.nearEdge);
          const bBulliesA =
            activePairMotion &&
            advanceB >= (sensitivity === 'high' ? 12 : 16) &&
            (retreatA >= 8 || mA.heightShrink >= 18 || mA.verticalDrop >= 22 || mA.nearEdge);

          // Case B: Active cornering / lunging intimidation (strictly requires active closing or agitation velocity — zero static triggers!)
          const tightLooming =
            activePairMotion &&
            (iou >= 0.08 || hGap <= 30) &&
            vOverlap >= 0.5 &&
            ((closingRate >= 16 &&
              (mA.nearEdge || mB.nearEdge || mA.heightShrink >= 16 || mB.heightShrink >= 16)) ||
              (relSpeed >= (sensitivity === 'high' ? 20 : 28) &&
                (mA.nearEdge || mB.nearEdge || mA.heightShrink >= 16 || mB.heightShrink >= 16)));

          if (aBulliesB || bBulliesA) {
            corneredPairDetected = true;
            bullyingReason =
              'Asymmetric shoving / advancing intimidation against retreating target';
          } else if (tightLooming) {
            corneredPairDetected = true;
            bullyingReason = 'Active cornering / lunging intimidation motion detected';
          }
        }

        // 3. Directional flanking / encirclement for 3+ person group bullying
        if (count >= 3 && (iou >= 0.05 || hGap <= crowdGapThreshold) && vOverlap >= 0.45) {
          crowdDegree[i] += 1;
          crowdDegree[j] += 1;
          if (mA.cx < mB.cx - 18) {
            flankedLeft[j] = true;
            flankedRight[i] = true;
          } else if (mB.cx < mA.cx - 18) {
            flankedLeft[i] = true;
            flankedRight[j] = true;
          }
          // Agitation around the surrounded target (inward pressure, jostling, or target shrinking/recoiling)
          if (
            closingRate >= 12 ||
            relSpeed >= 22 ||
            mA.heightShrink >= 16 ||
            mB.heightShrink >= 16 ||
            mA.verticalDrop >= 18 ||
            mB.verticalDrop >= 18
          ) {
            crowdAgitationByPerson[i] = true;
            crowdAgitationByPerson[j] = true;
          }
        }
      }
    }
  }

  // True 3+ person encirclement: a victim flanked on BOTH left and right sides
  let crowdingTargetDetected = false;
  let crowdingWithAgitation = false;
  for (let i = 0; i < count; i += 1) {
    if (count >= 3 && flankedLeft[i] && flankedRight[i] && crowdDegree[i] >= 2) {
      crowdingTargetDetected = true;
      if (crowdAgitationByPerson[i]) {
        crowdingWithAgitation = true;
        bullyingReason = `Target encircled on both sides with inward agitation (${count} people in cluster)`;
      }
    }
  }

  return {
    closeContactPairs,
    maxPairIoU,
    maxPairRelativeSpeed: Math.round(maxPairRelativeSpeed),
    maxPairClosingRate: Math.round(maxPairClosingRate),
    opposingClashDetected,
    violentClashDetected,
    corneredPairDetected,
    crowdingTargetDetected,
    crowdingWithAgitation,
    hasHorizontalCollapsedPerson,
    maxBoxVelocity: Math.round(maxBoxVelocity),
    maxVerticalDrop: Math.round(maxVerticalDrop),
    bullyingReason,
  };
}

/**
 * Pure on-device safety evaluation used seamlessly whenever cloud AI quota (HTTP 429)
 * is exhausted OR when the user triggers an immediate local Scan Now.
 * Combines verified local multi-person boxes, dangerous weapon objects, visual motion,
 * overlapping physical contact, victim collapse, crowding around a victim, decibel spikes,
 * and live voice-recognition transcript cues with ZERO cloud API calls.
 */
export function evaluateLocalSafetyAnalysis(params: {
  detectedPeople: DetectedPersonBox[];
  detectedObjects?: DetectedObjectBox[];
  voiceTranscript: string;
  audioLevel: number;
  facilityMode: FacilityMode;
  operationMode?: OperationMode;
  isStillImage?: boolean;
  audioSpikeDetected?: boolean;
  frameDeltaPercent?: number;
  sensitivity?: ThreatSensitivity;
}): ClassroomAnalysis {
  const people = params.detectedPeople;
  const dangerousObjects = params.detectedObjects ?? [];
  const count = people.length;
  const transcript = (params.voiceTranscript || '').trim();
  const audioLevel = Number.isFinite(params.audioLevel) ? params.audioLevel : 0;
  const frameDeltaPercent = Number.isFinite(params.frameDeltaPercent)
    ? Math.max(0, params.frameDeltaPercent!)
    : 0;
  const sensitivity = params.sensitivity ?? 'standard';
  const isDisaster = params.operationMode === 'disaster';
  const isStillImage = Boolean(params.isStillImage);

  const geometry = analyzePairwiseInteractions([], people, sensitivity);
  const hasCloseContact = geometry.closeContactPairs > 0;
  const hasWeaponObject = dangerousObjects.length > 0;

  const disasterCueWord = isDisaster ? matchDisasterDistressKeyword(transcript) : null;
  const disasterVoiceHit = Boolean(disasterCueWord);
  const beatingVoiceHit = Boolean(transcript && LOCAL_BEATING_VOICE_PATTERN.test(transcript));
  const bullyingVoiceHit = Boolean(
    !isDisaster && transcript && LOCAL_BULLYING_VOICE_PATTERN.test(transcript)
  );
  const criticalVoiceHit = Boolean(
    transcript && (LOCAL_CRITICAL_VOICE_PATTERN.test(transcript) || disasterVoiceHit)
  );
  const warningVoiceHit = Boolean(transcript && LOCAL_WARNING_VOICE_PATTERN.test(transcript));
  const loudSpike = Boolean(params.audioSpikeDetected) || audioLevel > SOUND_ALERT_THRESHOLD_DB;

  // High bar for single-frame local fallback so minor movement or exhibition chatter NEVER false-triggers
  const fightMotionThreshold = sensitivity === 'high' ? 18.0 : 24.0;
  const violentBeatingMotionThreshold = sensitivity === 'high' ? 24.0 : 32.0;

  // Still uploaded photos NEVER trigger motion-based kinetic alerts (bullying / fighting / beating)
  const visualBeating =
    !isStillImage &&
    count >= 2 &&
    hasCloseContact &&
    ((geometry.hasHorizontalCollapsedPerson &&
      (frameDeltaPercent >= fightMotionThreshold || audioLevel >= 82)) ||
      frameDeltaPercent >= violentBeatingMotionThreshold ||
      (audioLevel >= 88 && frameDeltaPercent >= 18));

  const visualFight =
    !isStillImage &&
    count >= 2 &&
    hasCloseContact &&
    (frameDeltaPercent >= fightMotionThreshold || (audioLevel >= 85 && frameDeltaPercent >= 16));

  // School-style visual bullying is disabled on still images and in Disaster & Rescue public venues
  const visualBullying =
    !isStillImage &&
    !isDisaster &&
    geometry.crowdingTargetDetected &&
    (frameDeltaPercent >= 12.0 || audioLevel >= 78);

  let threatCategory: ClassroomAnalysis['threatCategory'] = 'none';
  if (
    hasWeaponObject ||
    (criticalVoiceHit &&
      /\b(robbery|gun|knife|weapon|hands up|shoot)\b/i.test(transcript))
  ) {
    threatCategory = 'robbery_or_weapon';
  } else if (disasterVoiceHit) {
    threatCategory = 'disturbance';
  } else if (beatingVoiceHit || visualBeating) {
    threatCategory = 'beating';
  } else if (bullyingVoiceHit || visualBullying) {
    threatCategory = 'bullying';
  } else if (criticalVoiceHit || visualFight) {
    threatCategory = 'fight';
  } else if (warningVoiceHit || loudSpike) {
    threatCategory = 'disturbance';
  }

  const isFighting =
    disasterVoiceHit ||
    threatCategory === 'beating' ||
    threatCategory === 'bullying' ||
    threatCategory === 'fight' ||
    threatCategory === 'robbery_or_weapon';

  const severity: ClassroomAnalysis['severity'] = isFighting
    ? 'critical'
    : threatCategory === 'disturbance'
      ? 'warning'
      : 'none';

  const detectedBehaviors: string[] = [];
  if (hasWeaponObject) {
    detectedBehaviors.push(
      `Weapon object detected: ${dangerousObjects.map((o) => `${o.label} (${o.confidence}%)`).join(', ')}`
    );
  }
  if (disasterVoiceHit) {
    detectedBehaviors.push(
      `Disaster distress keyword ("${disasterCueWord}"): "${transcript.slice(0, 60)}"`
    );
  }
  if (beatingVoiceHit) detectedBehaviors.push(`Beating / striking cue: "${transcript.slice(0, 60)}"`);
  if (bullyingVoiceHit) detectedBehaviors.push(`Bullying / harassment cue: "${transcript.slice(0, 60)}"`);
  if (criticalVoiceHit && !beatingVoiceHit && !bullyingVoiceHit && !disasterVoiceHit) {
    detectedBehaviors.push(`Distress speech cue: "${transcript.slice(0, 60)}"`);
  }
  if (visualBeating) {
    detectedBehaviors.push(
      geometry.hasHorizontalCollapsedPerson
        ? 'Collapsed/fallen posture under close physical contact'
        : `Violent physical contact (motion ${frameDeltaPercent.toFixed(0)}%)`
    );
  } else if (visualBullying) {
    detectedBehaviors.push(
      geometry.crowdingTargetDetected
        ? 'Group crowding / surrounding single individual'
        : 'Close cornering / intimidation posture detected'
    );
  } else if (visualFight) {
    detectedBehaviors.push(
      `Overlapping physical altercation (motion ${frameDeltaPercent.toFixed(0)}%)`
    );
  }
  if (loudSpike) {
    detectedBehaviors.push(
      isDisaster
        ? `ACOUSTIC DISTRESS / STRUCTURAL COLLAPSE ALERT (${audioLevel.toFixed(1)} dB)`
        : `Loud sound level (${audioLevel.toFixed(1)} dB)`
    );
  }
  if (warningVoiceHit && !isFighting) detectedBehaviors.push('Elevated verbal commotion');

  const threatScore =
    threatCategory === 'robbery_or_weapon'
      ? 96
      : disasterVoiceHit
        ? 95
        : threatCategory === 'beating'
          ? 95
          : threatCategory === 'fight'
            ? 88
            : threatCategory === 'bullying'
              ? 86
              : severity === 'warning'
                ? 58
                : 0;

  const summary =
    threatCategory === 'robbery_or_weapon'
      ? `On-device WEAPON / ROBBERY alert: ${detectedBehaviors.join(' · ')}`
      : disasterVoiceHit
        ? `DISASTER DISTRESS VOICE ALERT (${disasterCueWord?.toUpperCase()}): ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
        : threatCategory === 'beating'
          ? `On-device BEATING alert: ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
          : threatCategory === 'bullying'
            ? `On-device BULLYING alert: ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
            : isFighting
              ? `On-device FIGHT alert: ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
              : count === 0
                ? isStillImage
                  ? 'No people detected in uploaded still photo (Edge AI).'
                  : 'No people detected in live frame (Empty zone · Edge AI).'
                : isStillImage
                  ? `${count} ${count === 1 ? 'person' : 'people'} counted in still image · Count & Density Mode (kinetic bullying/fight disabled for still photos).`
                  : `${count} ${count === 1 ? 'person' : 'people'} tracked live · Nominal (Edge AI).`;

  const recommendedAction =
    threatCategory === 'robbery_or_weapon'
      ? 'Initiate immediate security lockdown, alert campus/site security, and contact emergency responders.'
      : disasterVoiceHit
        ? 'Broadcast PA evacuation directive immediately, confirm survivor location on live feed, and deploy Rescue teams.'
        : threatCategory === 'beating'
          ? 'Emergency intervention required immediately — stop the beating, protect the victim, and dispatch security/medical help.'
          : threatCategory === 'bullying'
            ? 'Intervene immediately, separate aggressor(s) from the targeted individual, and notify the supervising teacher.'
            : isFighting
              ? 'Inspect live feed immediately and dispatch supervising staff to separate individuals.'
              : severity === 'warning'
                ? isDisaster
                  ? 'Verify structural integrity and broadcast precautionary PA announcement if needed.'
                  : 'Check room commotion on the live camera feed.'
                : 'No action needed; zone is calm.';

  return {
    studentCount: count,
    detectedPeople: people,
    detectedObjects: dangerousObjects,
    isFighting,
    severity,
    threatCategory,
    threatScore,
    detectedBehaviors,
    recommendedAction,
    voiceAnalysis: transcript
      ? `Live speech monitored: "${transcript.slice(0, 80)}" (${audioLevel.toFixed(1)} dB).`
      : `Ambient audio monitored (${audioLevel.toFixed(1)} dB).`,
    fightReason: isFighting ? detectedBehaviors.join('; ') : '',
    summary,
    confidence: dangerousObjects[0]?.confidence ?? people[0]?.confidence ?? 92,
    analyzedAt: new Date().toISOString(),
  };
}

export interface EdgeThreatTrackerState {
  prevPeople: DetectedPersonBox[];
  weaponStreak: number;
  beatingStreak: number;
  fightStreak: number;
  bullyingStreak: number;
  calmFrames: number;
  activeThreatCategory: ThreatCategory;
  lastAlertEmittedAtMs: number;
  lastAlertCategory: ThreatCategory;
}

export function createInitialEdgeThreatState(): EdgeThreatTrackerState {
  return {
    prevPeople: [],
    weaponStreak: 0,
    beatingStreak: 0,
    fightStreak: 0,
    bullyingStreak: 0,
    calmFrames: 0,
    activeThreatCategory: 'none',
    lastAlertEmittedAtMs: 0,
    lastAlertCategory: 'none',
  };
}

export interface RealtimeEdgeThreatResult {
  nextState: EdgeThreatTrackerState;
  analysis: ClassroomAnalysis | null;
  shouldEmitAlert: boolean;
  shouldClearThreat: boolean;
  contactPairs: number;
  maxBoxVelocity: number;
}

const THREAT_PRIORITY: Record<ThreatCategory, number> = {
  none: 0,
  disturbance: 1,
  bullying: 2,
  fight: 3,
  beating: 4,
  intrusion: 5,
  robbery_or_weapon: 6,
};

/**
 * Stateful 300ms real-time visual + object + pairwise kinematic threat engine.
 * - Immune to small movements, lighting shifts, waving, parallel walking, and calm booth crowds.
 * - Accurately detects BOTH 2-person bullying (asymmetric lunge/shove/cornering/looming)
 *   AND 3+ person group encirclement bullying with active agitation.
 * - Confirms threats across multiple consecutive frames to eliminate single-frame noise.
 */
export function evaluateRealtimeEdgeThreat(
  prevState: EdgeThreatTrackerState,
  input: {
    people: DetectedPersonBox[];
    dangerousObjects: DetectedObjectBox[];
    frameDeltaPercent: number;
    voiceTranscript: string;
    audioLevel: number;
    facilityMode: FacilityMode;
    operationMode?: OperationMode;
    isStillImage?: boolean;
    sensitivity?: ThreatSensitivity;
    nowMs: number;
    alertCooldownMs?: number;
  }
): RealtimeEdgeThreatResult {
  const sensitivity = input.sensitivity ?? 'standard';
  const alertCooldownMs = input.alertCooldownMs ?? 12000;
  const frameDelta = Number.isFinite(input.frameDeltaPercent)
    ? Math.max(0, input.frameDeltaPercent)
    : 0;
  const audioLevel = Number.isFinite(input.audioLevel) ? input.audioLevel : 0;
  const transcript = (input.voiceTranscript || '').trim();
  const isStillImage = Boolean(input.isStillImage);
  const isDisaster = input.operationMode === 'disaster';

  const pairMetrics = analyzePairwiseInteractions(prevState.prevPeople, input.people, sensitivity);
  const hasCloseContact = pairMetrics.closeContactPairs > 0;
  // Require real kinetic movement across frames so stationary people or still images NEVER fire motion threats
  const hasKineticMovement =
    !isStillImage &&
    (pairMetrics.maxBoxVelocity >= 10 || pairMetrics.maxPairRelativeSpeed >= 12);

  // Strictly calibrated pairwise thresholds: small movements, waving, or walking past NEVER trigger alerts!
  const fightMotionMin = sensitivity === 'high' ? 12.0 : 16.0;
  const beatingMotionMin = sensitivity === 'high' ? 18.0 : 24.0;
  const dropMin = sensitivity === 'high' ? 70 : 85;

  const hasWeaponFrame = input.dangerousObjects.length > 0;
  const highConfWeapon = input.dangerousObjects.some((o) => o.confidence >= 84);
  const hasMultiplePeople = input.people.length >= 2;

  // Fight requires REAL overlapping contact + opposing/erratic PAIRWISE motion (never mere lighting flicker, calm walking, or still photos!)
  const strongVisualClash =
    hasKineticMovement &&
    pairMetrics.opposingClashDetected &&
    (frameDelta >= fightMotionMin || audioLevel >= (sensitivity === 'high' ? 78 : 84));

  const violentVisualAssault =
    hasKineticMovement && pairMetrics.violentClashDetected && frameDelta >= beatingMotionMin;

  const beatingFrameSignal =
    !isStillImage &&
    hasKineticMovement &&
    hasMultiplePeople &&
    hasCloseContact &&
    (((pairMetrics.hasHorizontalCollapsedPerson || pairMetrics.maxVerticalDrop >= dropMin) &&
      pairMetrics.opposingClashDetected &&
      frameDelta >= (sensitivity === 'high' ? 12 : 15)) ||
      violentVisualAssault ||
      (prevState.fightStreak >= 3 && violentVisualAssault));

  const fightFrameSignal =
    !isStillImage &&
    hasKineticMovement &&
    hasMultiplePeople &&
    hasCloseContact &&
    (strongVisualClash ||
      (pairMetrics.opposingClashDetected &&
        audioLevel >= (sensitivity === 'high' ? 80 : 86) &&
        frameDelta >= 10));

  // Real bullying signal (School Safety Mode + live motion only — NEVER on still photos or Disaster Mode public venues!):
  // 1) 2-person active cornering / shoving / lunging intimidation
  // 2) 3+ person directional encirclement WITH active agitation or loud intimidation audio (calm visitors ignored!)
  const bullyingVoiceHit = Boolean(
    !isStillImage && !isDisaster && transcript && LOCAL_BULLYING_VOICE_PATTERN.test(transcript)
  );
  const bullyingFrameSignal =
    !isStillImage &&
    !isDisaster &&
    hasMultiplePeople &&
    !fightFrameSignal &&
    !beatingFrameSignal &&
    ((hasKineticMovement && pairMetrics.corneredPairDetected) ||
      (hasKineticMovement &&
        pairMetrics.crowdingTargetDetected &&
        (pairMetrics.crowdingWithAgitation || audioLevel >= (sensitivity === 'high' ? 72 : 78))) ||
      (bullyingVoiceHit && (hasCloseContact || pairMetrics.crowdingTargetDetected)));

  const weaponStreak = hasWeaponFrame ? prevState.weaponStreak + 1 : 0;
  const beatingStreak = beatingFrameSignal
    ? prevState.beatingStreak + 1
    : Math.max(0, prevState.beatingStreak - 1);
  const fightStreak = fightFrameSignal
    ? prevState.fightStreak + 1
    : Math.max(0, prevState.fightStreak - 1);
  const bullyingStreak = bullyingFrameSignal
    ? prevState.bullyingStreak + 1
    : Math.max(0, prevState.bullyingStreak - 1);

  const requiredWeaponFrames = highConfWeapon ? 2 : 3;
  const requiredBeatingFrames = sensitivity === 'high' ? 3 : 4;
  const requiredFightFrames = sensitivity === 'high' ? 3 : 5;
  const requiredBullyingFrames = sensitivity === 'high' ? 3 : 4;

  let confirmedCategory: ThreatCategory = 'none';
  const cues: string[] = [];

  if (weaponStreak >= requiredWeaponFrames) {
    confirmedCategory = 'robbery_or_weapon';
    cues.push(
      `Weapon detected on camera: ${input.dangerousObjects.map((o) => `${o.label} (${o.confidence}%)`).join(', ')}`
    );
  } else if (beatingStreak >= requiredBeatingFrames) {
    confirmedCategory = 'beating';
    if (pairMetrics.hasHorizontalCollapsedPerson || pairMetrics.maxVerticalDrop >= dropMin) {
      cues.push('Victim dropped/collapsed under close physical assault');
    } else {
      cues.push(
        `Repeated violent contact (motion ${frameDelta.toFixed(0)}%, pair velocity ${pairMetrics.maxPairRelativeSpeed})`
      );
    }
    if (audioLevel >= 74) {
      cues.push(`Impact / distress audio (${audioLevel.toFixed(1)} dB)`);
    }
  } else if (fightStreak >= requiredFightFrames) {
    confirmedCategory = 'fight';
    cues.push(
      `Clashing physical contact (${pairMetrics.closeContactPairs} overlapping pair${pairMetrics.closeContactPairs === 1 ? '' : 's'}, motion ${frameDelta.toFixed(0)}%)`
    );
    if (pairMetrics.maxPairRelativeSpeed > 0) {
      cues.push(`Opposing body agitation (Δrel ${pairMetrics.maxPairRelativeSpeed})`);
    }
  } else if (bullyingStreak >= requiredBullyingFrames) {
    confirmedCategory = 'bullying';
    if (pairMetrics.bullyingReason) {
      cues.push(pairMetrics.bullyingReason);
    } else if (pairMetrics.crowdingTargetDetected) {
      cues.push(
        `Group encirclement / surrounding 1 individual (${input.people.length} people in cluster)`
      );
    } else {
      cues.push('Sustained cornering / shoving intimidation detected');
    }
    if (bullyingVoiceHit) {
      cues.push(`Bullying speech cue: "${transcript.slice(0, 50)}"`);
    }
  }

  const anySignalActive =
    confirmedCategory !== 'none' ||
    hasWeaponFrame ||
    beatingFrameSignal ||
    fightFrameSignal ||
    bullyingFrameSignal;

  const calmFrames = anySignalActive ? 0 : prevState.calmFrames + 1;
  const shouldClearThreat =
    prevState.activeThreatCategory !== 'none' && calmFrames >= 12;

  if (confirmedCategory === 'none') {
    const nextState: EdgeThreatTrackerState = {
      prevPeople: input.people,
      weaponStreak,
      beatingStreak,
      fightStreak,
      bullyingStreak,
      calmFrames,
      activeThreatCategory: shouldClearThreat ? 'none' : prevState.activeThreatCategory,
      lastAlertEmittedAtMs: prevState.lastAlertEmittedAtMs,
      lastAlertCategory: shouldClearThreat ? 'none' : prevState.lastAlertCategory,
    };
    return {
      nextState,
      analysis: null,
      shouldEmitAlert: false,
      shouldClearThreat,
      contactPairs: pairMetrics.closeContactPairs,
      maxBoxVelocity: pairMetrics.maxBoxVelocity,
    };
  }

  // Confirmed visual / weapon threat!
  const isNewOrUpgraded =
    prevState.lastAlertCategory === 'none' ||
    THREAT_PRIORITY[confirmedCategory] > THREAT_PRIORITY[prevState.lastAlertCategory];
  const cooldownElapsed =
    prevState.lastAlertEmittedAtMs === 0 ||
    input.nowMs - prevState.lastAlertEmittedAtMs >= alertCooldownMs;
  const shouldEmitAlert = isNewOrUpgraded || cooldownElapsed;

  const threatScore =
    confirmedCategory === 'robbery_or_weapon'
      ? 97
      : confirmedCategory === 'beating'
        ? 95
        : confirmedCategory === 'fight'
          ? 89
          : 86;

  const recommendedAction =
    confirmedCategory === 'robbery_or_weapon'
      ? 'Initiate immediate security lockdown, notify site security, and dispatch emergency responders.'
      : confirmedCategory === 'beating'
        ? 'Emergency intervention required immediately — stop the beating, protect the victim, and call security/medical staff.'
        : confirmedCategory === 'bullying'
          ? 'Intervene immediately, separate aggressor(s) from the targeted individual, and notify supervising staff.'
          : 'Dispatch supervising staff to separate individuals immediately.';

  const summaryPrefix =
    confirmedCategory === 'robbery_or_weapon'
      ? 'Live Edge AI WEAPON ALERT'
      : confirmedCategory === 'beating'
        ? 'Live Edge AI BEATING ALERT'
        : confirmedCategory === 'bullying'
          ? 'Live Edge AI BULLYING ALERT'
          : 'Live Edge AI FIGHT ALERT';

  const analysis: ClassroomAnalysis = {
    studentCount: input.people.length,
    detectedPeople: input.people,
    detectedObjects: input.dangerousObjects,
    isFighting: true,
    severity: 'critical',
    threatCategory: confirmedCategory,
    threatScore,
    detectedBehaviors: cues,
    recommendedAction,
    voiceAnalysis: transcript
      ? `Live speech: "${transcript.slice(0, 80)}" (${audioLevel.toFixed(1)} dB)`
      : `Visual threat engine (${audioLevel.toFixed(1)} dB)`,
    fightReason: cues.join('; '),
    summary: `${summaryPrefix}: ${cues.join(' · ')}`,
    confidence: input.dangerousObjects[0]?.confidence ?? input.people[0]?.confidence ?? 90,
    analyzedAt: new Date(input.nowMs).toISOString(),
  };

  const nextState: EdgeThreatTrackerState = {
    prevPeople: input.people,
    weaponStreak,
    beatingStreak,
    fightStreak,
    bullyingStreak,
    calmFrames: 0,
    activeThreatCategory: confirmedCategory,
    lastAlertEmittedAtMs: shouldEmitAlert ? input.nowMs : prevState.lastAlertEmittedAtMs,
    lastAlertCategory: shouldEmitAlert ? confirmedCategory : prevState.lastAlertCategory,
  };

  return {
    nextState,
    analysis,
    shouldEmitAlert,
    shouldClearThreat: false,
    contactPairs: pairMetrics.closeContactPairs,
    maxBoxVelocity: pairMetrics.maxBoxVelocity,
  };
}

export function evaluateVoiceCueThreatAlert(
  camera: Pick<ClassroomCamera, 'id' | 'cameraCode' | 'classroomName' | 'studentCount' | 'lastAnalysis'>,
  transcript: string,
  audioLevel: number,
  facilityMode: FacilityMode,
  options?: {
    lastAlertAtMs?: number;
    nowMs?: number;
    cooldownMs?: number;
    operationMode?: OperationMode;
  }
): IncidentAlert | null {
  const cleaned = (transcript || '').trim();
  if (!cleaned) return null;

  const isDisaster = options?.operationMode === 'disaster';
  const disasterCue = isDisaster ? matchDisasterDistressKeyword(cleaned) : null;
  const isBeating = LOCAL_BEATING_VOICE_PATTERN.test(cleaned);
  const isBullying = LOCAL_BULLYING_VOICE_PATTERN.test(cleaned);
  const isFightOrCritical = LOCAL_CRITICAL_VOICE_PATTERN.test(cleaned);
  if (!disasterCue && !isBeating && !isBullying && !isFightOrCritical) {
    return null;
  }

  const nowMs = options?.nowMs ?? Date.now();
  const cooldownMs = options?.cooldownMs ?? 10000;
  const lastAlertAtMs = options?.lastAlertAtMs ?? 0;
  if (lastAlertAtMs > 0 && nowMs - lastAlertAtMs < cooldownMs) {
    return null;
  }

  const localAnalysis = evaluateLocalSafetyAnalysis({
    detectedPeople: camera.lastAnalysis?.detectedPeople ?? [],
    voiceTranscript: cleaned,
    audioLevel,
    facilityMode,
    operationMode: options?.operationMode,
  });
  localAnalysis.studentCount = Math.max(camera.studentCount || 0, localAnalysis.studentCount);

  const alert = evaluateFightNotification(camera, localAnalysis, facilityMode);
  if (alert && disasterCue) {
    return {
      ...alert,
      disasterPhase: 2,
      headline: `DISASTER DISTRESS VOICE ALERT ("${disasterCue.toUpperCase()}"): ${camera.classroomName}`,
      teacherMessageSubject: `[DISASTER RESCUE ALERT] Distress cue "${disasterCue}" detected in ${camera.classroomName}`,
    };
  }
  return alert && isDisaster ? { ...alert, disasterPhase: 2 } : alert;
}

export type SafeJsonParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; isHtml: boolean; preview: string };

/**
 * Safely parses HTTP response text as JSON without ever throwing
 * `Unexpected token '<', "<!doctype "... is not valid JSON` when a server
 * restart, proxy 502/503, or SPA fallback returns HTML.
 */
export function parseSafeJsonText<T>(rawText: string): SafeJsonParseResult<T> {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    return { ok: false, isHtml: false, preview: '' };
  }
  const looksHtml = /^<(?:!doctype|html|head|body|title|pre|div)\b/i.test(trimmed) || trimmed.startsWith('<');
  if (looksHtml) {
    return { ok: false, isHtml: true, preview: trimmed.slice(0, 80) };
  }
  try {
    return { ok: true, data: JSON.parse(trimmed) as T };
  } catch {
    return { ok: false, isHtml: false, preview: trimmed.slice(0, 80) };
  }
}

export function computeAspectPreservingSize(
  srcWidth: number,
  srcHeight: number,
  maxDim = 640
): { width: number; height: number } {
  const safeW = Number.isFinite(srcWidth) && srcWidth > 0 ? srcWidth : maxDim;
  const safeH = Number.isFinite(srcHeight) && srcHeight > 0 ? srcHeight : Math.round((maxDim * 9) / 16);
  const longest = Math.max(safeW, safeH);
  const scale = longest > maxDim ? maxDim / longest : 1;
  return {
    width: Math.max(2, Math.round(safeW * scale)),
    height: Math.max(2, Math.round(safeH * scale)),
  };
}

export interface ContainDrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computes an aspect-ratio-preserving letterbox/pillarbox destination rectangle inside dstWidth x dstHeight
 * so portrait mobile cameras (e.g. 480x640 or 720x1280) are never horizontally stretched on 16:9 displays.
 */
export function computeContainDrawRect(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): ContainDrawRect {
  if (
    !Number.isFinite(srcWidth) ||
    !Number.isFinite(srcHeight) ||
    srcWidth <= 0 ||
    srcHeight <= 0 ||
    dstWidth <= 0 ||
    dstHeight <= 0
  ) {
    return { x: 0, y: 0, width: Math.max(1, dstWidth), height: Math.max(1, dstHeight) };
  }

  const scale = Math.min(dstWidth / srcWidth, dstHeight / srcHeight);
  const drawW = Math.max(1, Math.round(srcWidth * scale));
  const drawH = Math.max(1, Math.round(srcHeight * scale));
  const x = Math.round((dstWidth - drawW) / 2);
  const y = Math.round((dstHeight - drawH) / 2);
  return { x, y, width: drawW, height: drawH };
}

/**
 * Maps a [ymin, xmin, ymax, xmax] normalized 0..1000 bounding box into pixel coordinates
 * relative to the actual drawn video/image rectangle on the canvas.
 */
export function mapNormalizedBoxToRect(
  box_2d: [number, number, number, number],
  rect: ContainDrawRect
): ContainDrawRect {
  const [ymin, xmin, ymax, xmax] = box_2d;
  const x = Math.round(rect.x + (xmin / 1000) * rect.width);
  const y = Math.round(rect.y + (ymin / 1000) * rect.height);
  const width = Math.max(16, Math.round(((xmax - xmin) / 1000) * rect.width));
  const height = Math.max(16, Math.round(((ymax - ymin) / 1000) * rect.height));
  return { x, y, width, height };
}
