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
  const formattedDb = audioLevel.toFixed(1);
  const sustainedSec =
    typeof options.sustainedSeconds === 'number' && options.sustainedSeconds > 0
      ? options.sustainedSeconds.toFixed(1)
      : (SOUND_ALERT_SUSTAINED_MS / 1000).toFixed(1);
  const timestamp = new Date(nowMs).toISOString();
  const teacherGreeting = options.teacherName ? `Hello ${options.teacherName},` : 'Hello Teacher,';
  const courseLine = options.courseName ? `Course: ${options.courseName}\n` : '';
  const transcriptLine = options.liveTranscript
    ? `Captured speech cue: "${options.liveTranscript}"\n`
    : 'Captured speech cue: Sustained loud noise detected (no speech transcript).\n';

  const teacherMessageSubject = `[Urgent Sound Alert] ${camera.classroomName} stayed above ${thresholdDb.toFixed(1)} dB (${formattedDb} dB for ${sustainedSec}s)`;
  const teacherMessageBody = [
    teacherGreeting,
    '',
    `An automated sustained-noise alert was triggered in ${camera.classroomName} (${camera.cameraCode}).`,
    `Measured sound level: ${formattedDb} dB (stayed above ${thresholdDb.toFixed(1)} dB for ${sustainedSec}s).`,
    `${courseLine}Estimated occupancy: ${camera.studentCount} present.`,
    transcriptLine.trim(),
    `Logged at: ${timestamp}`,
    '',
    'Please check on the classroom/zone immediately.',
  ].join('\n');

  return {
    id: `alert-db-${camera.id}-${nowMs}-${alertSequenceCounter}`,
    cameraId: camera.id,
    cameraCode: camera.cameraCode,
    classroomName: camera.classroomName,
    alertType: 'sound-threshold',
    severity: 'critical',
    threatCategory: 'disturbance',
    studentCount: camera.studentCount,
    measuredDb: Number(formattedDb),
    headline: `Teacher Sound Alert: ${camera.classroomName} stayed over ${thresholdDb.toFixed(1)} dB (${formattedDb} dB · ${sustainedSec}s)`,
    voiceCue: options.liveTranscript
      ? `${formattedDb} dB (${sustainedSec}s) — "${options.liveTranscript}"`
      : `Sustained sound ${formattedDb} dB exceeded ${thresholdDb.toFixed(1)} dB for ${sustainedSec}s`,
    details: `Sustained noise exceeded ${thresholdDb.toFixed(1)} dB for over ${(SOUND_ALERT_SUSTAINED_MS / 1000).toFixed(0)} seconds. Alert prepared for teacher${options.teacherEmail ? ` (${options.teacherEmail})` : ''}.`,
    teacherMessageSubject,
    teacherMessageBody,
    teacherNotified: false,
    timestamp,
    acknowledged: false,
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
    const isDuplicate = kept.some((existing) =>
      isSamePersonDuplicate(existing.box_2d, candidate.box_2d)
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
  const instantConfidence = options?.instantConfidence ?? 62;
  const minConfidence = options?.minConfidence ?? 48;
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

    // High-confidence person locks in immediately on frame 1
    if (raw.confidence >= instantConfidence) {
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

    // Secondary/partially occluded person (48-61%) confirms once seen in 2 consecutive frames
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

    const isInteriorPerson = prevBox[1] > 30 && prevBox[3] < 970;
    const isSolidTrack = (prev.confirmedFrames ?? 1) >= 2;
    const torsoStillPresent = torsoSim >= 0.74;
    const occludedButPresent =
      isSolidTrack &&
      isInteriorPerson &&
      (Boolean(faceOccluder) || torsoStillPresent);

    if (occludedButPresent) {
      const strongHold = Boolean(faceOccluder) && (torsoSim >= 0.58 || !prev.torsoSignature);
      const effectiveCap = faceOccluder ? maxOccludedFrames : Math.min(18, maxOccludedFrames);
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

  // Deduplicate any tracks that converged onto the same person and sort left-to-right
  nextConfirmed.sort((a, b) => b.box.confidence - a.box.confidence);
  const dedupedTracks: TrackedPersonEntry[] = [];
  for (const track of nextConfirmed) {
    const dup = dedupedTracks.some((kept) =>
      isSamePersonDuplicate(kept.box.box_2d, track.box.box_2d)
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

const LOCAL_BEATING_VOICE_PATTERN =
  /\b(beating|beat me|beat him|beat her|beat up|stop hitting|hitting me|hitting him|hitting her|kicking me|kicking him|slapping|slapped me|punching me|don'?t hit|stomping|whipping|pummeling|brutal assault)\b/i;

const LOCAL_BULLYING_VOICE_PATTERN =
  /\b(bully|bullying|bullied|leave me alone|stop teasing|give me your (money|lunch|bag|phone)|cornered|picking on|don'?t touch me|stop harassing|harassing|mocking me|tripped me|shoved me|shut up loser)\b/i;

const LOCAL_CRITICAL_VOICE_PATTERN =
  /\b(help|fight|fighting|hands up|robbery|gun|knife|weapon|shoot|police|emergency|attack|punch|assault|intruder|fire)\b/i;

const LOCAL_WARNING_VOICE_PATTERN =
  /\b(stop|get off|shut up|hey|scream|screaming|loud|argument|push|shove)\b/i;

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

function analyzeVisualPairGeometry(
  people: DetectedPersonBox[],
  sensitivity: ThreatSensitivity = 'standard'
): {
  closeContactPairs: number;
  crowdingTargetDetected: boolean;
  corneredPairDetected: boolean;
  hasHorizontalCollapsedPerson: boolean;
  maxPairIoU: number;
} {
  const count = people.length;
  if (count === 0) {
    return {
      closeContactPairs: 0,
      crowdingTargetDetected: false,
      corneredPairDetected: false,
      hasHorizontalCollapsedPerson: false,
      maxPairIoU: 0,
    };
  }

  // Require real bounding-box collision (NOT mere sitting side-by-side) and exclude nested duplicates
  const collisionIouThreshold = sensitivity === 'high' ? 0.12 : 0.16;
  const crowdGapThreshold = sensitivity === 'high' ? 38 : 26;
  const crowdDegree = new Array<number>(count).fill(0);
  let closeContactPairs = 0;
  let maxPairIoU = 0;
  let hasHorizontalCollapsedPerson = false;

  for (let i = 0; i < count; i += 1) {
    const [ymin, xmin, ymax, xmax] = people[i].box_2d;
    const w = Math.max(1, xmax - xmin);
    const h = Math.max(1, ymax - ymin);
    // Person knocked down or lying horizontally on floor
    if (w / h >= 1.35 && ymin >= 340) {
      hasHorizontalCollapsedPerson = true;
    }
  }

  if (count >= 2) {
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = people[i].box_2d;
        const b = people[j].box_2d;
        const containment = computeBoxContainment(a, b);
        // Never treat a nested/duplicate fragment as two distinct fighting humans
        if (containment >= 0.65) continue;

        const iou = computeBoxIoU(a, b);
        if (iou > maxPairIoU) maxPairIoU = iou;
        const hGap = computeBoxHorizontalGap(a, b);
        const vOverlap = computeVerticalOverlapRatio(a, b);

        // Actual physical collision / clashing overlap
        if (iou >= collisionIouThreshold && vOverlap >= 0.35) {
          closeContactPairs += 1;
          crowdDegree[i] += 1;
          crowdDegree[j] += 1;
        } else if (count >= 3 && hGap <= crowdGapThreshold && vOverlap >= 0.5) {
          // Track tight encirclement strictly for 3+ person group crowding/bullying
          crowdDegree[i] += 1;
          crowdDegree[j] += 1;
        }
      }
    }
  }

  // Crowding / ganging up: strictly 3+ distinct people surrounding 1 center individual
  const crowdingTargetDetected =
    count >= 3 && crowdDegree.some((deg) => deg >= 2);

  return {
    closeContactPairs,
    crowdingTargetDetected,
    corneredPairDetected: false,
    hasHorizontalCollapsedPerson,
    maxPairIoU,
  };
}

function measureBoxKinematics(
  prevPeople: DetectedPersonBox[],
  currPeople: DetectedPersonBox[]
): {
  maxBoxVelocity: number;
  maxVerticalDrop: number;
} {
  if (prevPeople.length === 0 || currPeople.length === 0) {
    return { maxBoxVelocity: 0, maxVerticalDrop: 0 };
  }

  let maxBoxVelocity = 0;
  let maxVerticalDrop = 0;

  for (const curr of currPeople) {
    const [cymin, cxmin, cymax, cxmax] = curr.box_2d;
    const ccx = (cxmin + cxmax) / 2;
    const ccy = (cymin + cymax) / 2;

    let bestPrev: DetectedPersonBox | null = null;
    let bestDist = Infinity;
    for (const prev of prevPeople) {
      const [pymin, pxmin, pymax, pxmax] = prev.box_2d;
      const pcx = (pxmin + pxmax) / 2;
      const pcy = (pymin + pymax) / 2;
      const dist = Math.hypot(ccx - pcx, ccy - pcy);
      if (dist < bestDist && dist <= 320) {
        bestDist = dist;
        bestPrev = prev;
      }
    }

    if (bestPrev) {
      if (bestDist > maxBoxVelocity) {
        maxBoxVelocity = bestDist;
      }
      // Sudden downward drop of a person's head/top edge (knocked down / tackled)
      const verticalDrop = cymin - bestPrev.box_2d[0];
      if (verticalDrop > maxVerticalDrop) {
        maxVerticalDrop = verticalDrop;
      }
    }
  }

  return {
    maxBoxVelocity: Math.round(maxBoxVelocity),
    maxVerticalDrop: Math.round(maxVerticalDrop),
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

  const geometry = analyzeVisualPairGeometry(people, sensitivity);
  const hasCloseContact = geometry.closeContactPairs > 0;
  const hasWeaponObject = dangerousObjects.length > 0;

  const beatingVoiceHit = Boolean(transcript && LOCAL_BEATING_VOICE_PATTERN.test(transcript));
  const bullyingVoiceHit = Boolean(transcript && LOCAL_BULLYING_VOICE_PATTERN.test(transcript));
  const criticalVoiceHit = Boolean(transcript && LOCAL_CRITICAL_VOICE_PATTERN.test(transcript));
  const warningVoiceHit = Boolean(transcript && LOCAL_WARNING_VOICE_PATTERN.test(transcript));
  const loudSpike = Boolean(params.audioSpikeDetected) || audioLevel > SOUND_ALERT_THRESHOLD_DB;

  const fightMotionThreshold = sensitivity === 'high' ? 12.0 : 16.0;
  const violentBeatingMotionThreshold = sensitivity === 'high' ? 18.0 : 24.0;

  const visualBeating =
    count >= 2 &&
    hasCloseContact &&
    ((geometry.hasHorizontalCollapsedPerson &&
      (frameDeltaPercent >= fightMotionThreshold || audioLevel >= 78)) ||
      frameDeltaPercent >= violentBeatingMotionThreshold ||
      (audioLevel >= 86 && frameDeltaPercent >= 12));

  const visualFight =
    count >= 2 &&
    hasCloseContact &&
    (frameDeltaPercent >= fightMotionThreshold || (audioLevel >= 82 && frameDeltaPercent >= 10));

  const visualBullying =
    geometry.crowdingTargetDetected && (frameDeltaPercent >= 6.0 || audioLevel >= 70);

  let threatCategory: ClassroomAnalysis['threatCategory'] = 'none';
  if (
    hasWeaponObject ||
    (criticalVoiceHit &&
      /\b(robbery|gun|knife|weapon|hands up|shoot)\b/i.test(transcript))
  ) {
    threatCategory = 'robbery_or_weapon';
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
  if (beatingVoiceHit) detectedBehaviors.push(`Beating / striking cue: "${transcript.slice(0, 60)}"`);
  if (bullyingVoiceHit) detectedBehaviors.push(`Bullying / harassment cue: "${transcript.slice(0, 60)}"`);
  if (criticalVoiceHit && !beatingVoiceHit && !bullyingVoiceHit) {
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
  if (loudSpike) detectedBehaviors.push(`Loud sound level (${audioLevel.toFixed(1)} dB)`);
  if (warningVoiceHit && !isFighting) detectedBehaviors.push('Elevated verbal commotion');

  const threatScore =
    threatCategory === 'robbery_or_weapon'
      ? 96
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
      : threatCategory === 'beating'
        ? `On-device BEATING alert: ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
        : threatCategory === 'bullying'
          ? `On-device BULLYING alert: ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
          : isFighting
            ? `On-device FIGHT alert: ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
            : count === 0
              ? 'No people detected in live frame (Empty zone · Edge AI).'
              : `${count} ${count === 1 ? 'person' : 'people'} tracked live · Nominal (Edge AI).`;

  const recommendedAction =
    threatCategory === 'robbery_or_weapon'
      ? 'Initiate immediate security lockdown, alert campus/site security, and contact emergency responders.'
      : threatCategory === 'beating'
        ? 'Emergency intervention required immediately — stop the beating, protect the victim, and dispatch security/medical help.'
        : threatCategory === 'bullying'
          ? 'Intervene immediately, separate aggressor(s) from the targeted individual, and notify the supervising teacher.'
          : isFighting
            ? 'Inspect live feed immediately and dispatch supervising staff to separate individuals.'
            : severity === 'warning'
              ? 'Check room commotion on the live camera feed.'
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
 * Stateful 300ms real-time visual + object + kinematic threat engine.
 * Runs 100% on-device with ZERO cloud quota and works on BOTH live webcams (with or without audio)
 * AND silent uploaded/IP CCTV video feeds.
 * Confirms visual threats across 2-3 consecutive frames to prevent single-frame false positives,
 * then pops alerts immediately and auto-recovers smoothly once calm.
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

  const geometry = analyzeVisualPairGeometry(input.people, sensitivity);
  const kinematics = measureBoxKinematics(prevState.prevPeople, input.people);
  const hasCloseContact = geometry.closeContactPairs > 0;

  // Strictly calibrated thresholds: normal 1-person movement or 2 people sitting/walking NEVER fires false alerts
  const fightMotionMin = sensitivity === 'high' ? 12.0 : 16.0;
  const fightVelocityMin = sensitivity === 'high' ? 50 : 65;
  const beatingMotionMin = sensitivity === 'high' ? 18.0 : 24.0;
  const beatingVelocityMin = sensitivity === 'high' ? 68 : 85;
  const dropMin = sensitivity === 'high' ? 60 : 75;

  const hasWeaponFrame = input.dangerousObjects.length > 0;
  const highConfWeapon = input.dangerousObjects.some((o) => o.confidence >= 84);

  const hasMultiplePeople = input.people.length >= 2;
  const strongVisualClash =
    frameDelta >= fightMotionMin &&
    (kinematics.maxBoxVelocity >= fightVelocityMin || audioLevel >= (sensitivity === 'high' ? 76 : 82));
  const violentVisualAssault =
    frameDelta >= beatingMotionMin && kinematics.maxBoxVelocity >= beatingVelocityMin;

  const beatingFrameSignal =
    hasMultiplePeople &&
    hasCloseContact &&
    (((geometry.hasHorizontalCollapsedPerson || kinematics.maxVerticalDrop >= dropMin) &&
      frameDelta >= (sensitivity === 'high' ? 10 : 14)) ||
      violentVisualAssault ||
      (prevState.fightStreak >= 3 && violentVisualAssault));

  const fightFrameSignal =
    hasMultiplePeople &&
    hasCloseContact &&
    (strongVisualClash ||
      (audioLevel >= (sensitivity === 'high' ? 78 : 84) && frameDelta >= 10));

  const bullyingFrameSignal =
    geometry.crowdingTargetDetected &&
    (frameDelta >= 6.0 || kinematics.maxBoxVelocity >= 32 || audioLevel >= 70);

  const weaponStreak = hasWeaponFrame ? prevState.weaponStreak + 1 : 0;
  const beatingStreak = beatingFrameSignal ? prevState.beatingStreak + 1 : Math.max(0, prevState.beatingStreak - 1);
  const fightStreak = fightFrameSignal ? prevState.fightStreak + 1 : Math.max(0, prevState.fightStreak - 1);
  const bullyingStreak = bullyingFrameSignal
    ? prevState.bullyingStreak + 1
    : Math.max(0, prevState.bullyingStreak - 1);

  const requiredWeaponFrames = highConfWeapon ? 2 : 3;
  const requiredBeatingFrames = sensitivity === 'high' ? 3 : 4;
  const requiredFightFrames = sensitivity === 'high' ? 3 : 4;
  const requiredBullyingFrames = sensitivity === 'high' ? 3 : 5;

  let confirmedCategory: ThreatCategory = 'none';
  const cues: string[] = [];

  if (weaponStreak >= requiredWeaponFrames) {
    confirmedCategory = 'robbery_or_weapon';
    cues.push(
      `Weapon detected on camera: ${input.dangerousObjects.map((o) => `${o.label} (${o.confidence}%)`).join(', ')}`
    );
  } else if (beatingStreak >= requiredBeatingFrames) {
    confirmedCategory = 'beating';
    if (geometry.hasHorizontalCollapsedPerson || kinematics.maxVerticalDrop >= dropMin) {
      cues.push('Victim dropped/collapsed under close physical assault');
    } else {
      cues.push(
        `Repeated violent contact (motion ${frameDelta.toFixed(0)}%, velocity ${kinematics.maxBoxVelocity})`
      );
    }
    if (audioLevel >= 74) {
      cues.push(`Impact / distress audio (${audioLevel.toFixed(1)} dB)`);
    }
  } else if (fightStreak >= requiredFightFrames) {
    confirmedCategory = 'fight';
    cues.push(
      `Clashing physical contact (${geometry.closeContactPairs} overlapping pair${geometry.closeContactPairs === 1 ? '' : 's'}, motion ${frameDelta.toFixed(0)}%)`
    );
    if (kinematics.maxBoxVelocity >= fightVelocityMin) {
      cues.push(`Rapid body agitation (Δpos ${kinematics.maxBoxVelocity})`);
    }
  } else if (bullyingStreak >= requiredBullyingFrames) {
    confirmedCategory = 'bullying';
    if (geometry.crowdingTargetDetected) {
      cues.push(`Group crowding / surrounding 1 individual (${input.people.length} people in tight cluster)`);
    } else {
      cues.push('Sustained cornering / intimidation posture detected');
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
      contactPairs: geometry.closeContactPairs,
      maxBoxVelocity: kinematics.maxBoxVelocity,
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
    contactPairs: geometry.closeContactPairs,
    maxBoxVelocity: kinematics.maxBoxVelocity,
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
  }
): IncidentAlert | null {
  const cleaned = (transcript || '').trim();
  if (!cleaned) return null;

  const isBeating = LOCAL_BEATING_VOICE_PATTERN.test(cleaned);
  const isBullying = LOCAL_BULLYING_VOICE_PATTERN.test(cleaned);
  const isFightOrCritical = LOCAL_CRITICAL_VOICE_PATTERN.test(cleaned);
  if (!isBeating && !isBullying && !isFightOrCritical) {
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
  });
  localAnalysis.studentCount = Math.max(camera.studentCount || 0, localAnalysis.studentCount);

  return evaluateFightNotification(camera, localAnalysis, facilityMode);
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








