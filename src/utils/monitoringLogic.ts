import type {
  AiEngineModel,
  BluetoothClassification,
  BluetoothDeviceCandidate,
  ClassroomAnalysis,
  ClassroomCamera,
  DetectedPersonBox,
  FacilityMode,
  IncidentAlert,
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
  if (iou > 0.72) return true;

  // Only merge nested boxes when they truly belong to the SAME person
  // (e.g. a head/torso box inside the exact same person's body box),
  // NOT two distinct people standing side-by-side or front-and-back.
  const containment = computeBoxContainment(a, b);
  if (containment > 0.85) {
    const cxA = (a[1] + a[3]) / 2;
    const cxB = (b[1] + b[3]) / 2;
    const maxW = Math.max(1, a[3] - a[1], b[3] - b[1]);
    const maxH = Math.max(1, a[2] - a[0], b[2] - b[0]);
    const horizontalAligned = Math.abs(cxA - cxB) <= 0.24 * maxW;
    const topAligned = Math.abs(a[0] - b[0]) <= 0.24 * maxH;
    if (horizontalAligned && topAligned) {
      return true;
    }
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
  minConfidence = 38
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

  // Drop tile-seam clipped half-boxes if a complete full-frame box already wraps that person
  const isClippedSeamDuplicate = (
    tileBox: DetectedPersonBox,
    touchesSeam: boolean
  ): boolean => {
    if (!touchesSeam) return false;
    return fullFrameBoxes.some((full) => {
      const containment = computeBoxContainment(full.box_2d, tileBox.box_2d);
      const maxH = Math.max(1, full.box_2d[2] - full.box_2d[0], tileBox.box_2d[2] - tileBox.box_2d[0]);
      const topClose = Math.abs(full.box_2d[0] - tileBox.box_2d[0]) <= 0.25 * maxH;
      return containment > 0.72 && topClose;
    });
  };

  const filteredLeft = mappedLeft.filter(
    (b) => !isClippedSeamDuplicate(b, b.box_2d[3] >= 585)
  );
  const filteredRight = mappedRight.filter(
    (b) => !isClippedSeamDuplicate(b, b.box_2d[1] <= 415)
  );

  // Merge full-frame + unclipped tile boxes with person-aware deduplication
  return filterVerifiedPersonDetections(
    [...fullFrameBoxes, ...filteredLeft, ...filteredRight],
    minConfidence
  );
}

export interface TrackedPersonEntry {
  box: DetectedPersonBox;
  missedFrames: number;
}

export interface PersonTrackerState {
  confirmed: TrackedPersonEntry[];
  pending: DetectedPersonBox[];
}

function boxesSpatiallyMatch(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  if (computeBoxIoU(a, b) >= 0.24) return true;
  const cxA = (a[1] + a[3]) / 2;
  const cyA = (a[0] + a[2]) / 2;
  const cxB = (b[1] + b[3]) / 2;
  const cyB = (b[0] + b[2]) / 2;
  const maxDim = Math.max(1, a[3] - a[1], a[2] - a[0], b[3] - b[1], b[2] - b[0]);
  const dist = Math.hypot(cxA - cxB, cyA - cyB);
  return dist <= 0.38 * maxDim;
}

/**
 * Multi-frame person tracker that locks onto 2nd/3rd/4th+ partially occluded people
 * without single-frame flicker (2 -> 1 -> 2), while clearing quickly to 0 on empty rooms.
 */
export function stepPersonTracker(
  prevState: PersonTrackerState,
  rawDetections: DetectedPersonBox[],
  options?: {
    instantConfidence?: number;
    minConfidence?: number;
    maxMissedFrames?: number;
  }
): { nextState: PersonTrackerState; people: DetectedPersonBox[] } {
  const instantConfidence = options?.instantConfidence ?? 52;
  const minConfidence = options?.minConfidence ?? 38;
  const maxMissedFrames = options?.maxMissedFrames ?? 2;

  const usableRaw = rawDetections.filter((d) => d.confidence >= minConfidence);
  const matchedConfirmedIdx = new Set<number>();
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

    if (bestIdx !== -1) {
      matchedConfirmedIdx.add(bestIdx);
      nextConfirmed.push({ box: raw, missedFrames: 0 });
      continue;
    }

    // High-confidence person locks in immediately on frame 1
    if (raw.confidence >= instantConfidence) {
      nextConfirmed.push({ box: raw, missedFrames: 0 });
      continue;
    }

    // Secondary/partially occluded person (38-51%) confirms once seen in 2 consecutive frames
    const matchedPending = prevState.pending.some((p) =>
      boxesSpatiallyMatch(p.box_2d, raw.box_2d)
    );
    if (matchedPending) {
      nextConfirmed.push({ box: raw, missedFrames: 0 });
    } else {
      nextPending.push(raw);
    }
  }

  // Gracefully hold unmatched confirmed tracks across brief occlusion blinks,
  // but drop promptly on empty frames (max 1 grace frame when room reads 0)
  const emptyGrace = usableRaw.length === 0 ? 1 : maxMissedFrames;
  for (let i = 0; i < prevState.confirmed.length; i += 1) {
    if (matchedConfirmedIdx.has(i)) continue;
    const prev = prevState.confirmed[i];
    const nextMissed = prev.missedFrames + 1;
    if (nextMissed <= emptyGrace) {
      nextConfirmed.push({
        box: prev.box,
        missedFrames: nextMissed,
      });
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

/**
 * Pure on-device safety evaluation used seamlessly whenever cloud AI quota (HTTP 429)
 * is exhausted. Combines verified local multi-person boxes, overlapping physical contact,
 * crowding around a victim, decibel spikes, and live voice-recognition transcript cues
 * (including dedicated Beating and Bullying alerts) with ZERO cloud API calls.
 */
export function evaluateLocalSafetyAnalysis(params: {
  detectedPeople: DetectedPersonBox[];
  voiceTranscript: string;
  audioLevel: number;
  facilityMode: FacilityMode;
  audioSpikeDetected?: boolean;
}): ClassroomAnalysis {
  const people = params.detectedPeople;
  const count = people.length;
  const transcript = (params.voiceTranscript || '').trim();
  const audioLevel = Number.isFinite(params.audioLevel) ? params.audioLevel : 0;

  let closeContactPairs = 0;
  if (count >= 2) {
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        if (computeBoxIoU(people[i].box_2d, people[j].box_2d) >= 0.12) {
          closeContactPairs += 1;
        }
      }
    }
  }
  const hasCloseContact = closeContactPairs > 0;

  const beatingVoiceHit = Boolean(transcript && LOCAL_BEATING_VOICE_PATTERN.test(transcript));
  const bullyingVoiceHit = Boolean(transcript && LOCAL_BULLYING_VOICE_PATTERN.test(transcript));
  const criticalVoiceHit = Boolean(transcript && LOCAL_CRITICAL_VOICE_PATTERN.test(transcript));
  const warningVoiceHit = Boolean(transcript && LOCAL_WARNING_VOICE_PATTERN.test(transcript));
  const loudSpike = Boolean(params.audioSpikeDetected) || audioLevel > SOUND_ALERT_THRESHOLD_DB;

  const crowdedIntimidation = count >= 3 && closeContactPairs >= 2 && audioLevel >= 72;
  const intenseBeatingContact = hasCloseContact && audioLevel >= 80;
  const closeAltercation = hasCloseContact && audioLevel >= 76;

  let threatCategory: ClassroomAnalysis['threatCategory'] = 'none';
  if (
    criticalVoiceHit &&
    params.facilityMode === 'bank' &&
    /\b(robbery|gun|knife|weapon|hands up|shoot)\b/i.test(transcript)
  ) {
    threatCategory = 'robbery_or_weapon';
  } else if (beatingVoiceHit || intenseBeatingContact) {
    threatCategory = 'beating';
  } else if (bullyingVoiceHit || crowdedIntimidation) {
    threatCategory = 'bullying';
  } else if (criticalVoiceHit || closeAltercation) {
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
  if (beatingVoiceHit) detectedBehaviors.push(`Beating / striking cue: "${transcript.slice(0, 60)}"`);
  if (bullyingVoiceHit) detectedBehaviors.push(`Bullying / harassment cue: "${transcript.slice(0, 60)}"`);
  if (criticalVoiceHit && !beatingVoiceHit && !bullyingVoiceHit) {
    detectedBehaviors.push(`Distress speech cue: "${transcript.slice(0, 60)}"`);
  }
  if (intenseBeatingContact) {
    detectedBehaviors.push('Severe close physical contact + loud impact/shouting');
  } else if (crowdedIntimidation) {
    detectedBehaviors.push('Group crowding / cornering posture + raised voices');
  } else if (closeAltercation) {
    detectedBehaviors.push('Close overlapping physical contact + elevated audio');
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
              : 6;

  const summary =
    threatCategory === 'beating'
      ? `On-device BEATING alert: ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
      : threatCategory === 'bullying'
        ? `On-device BULLYING alert: ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
        : isFighting
          ? `On-device safety alert: ${detectedBehaviors.join(' · ')} (${count} ${count === 1 ? 'person' : 'people'} in frame).`
          : count === 0
            ? 'No people detected in live frame (empty room · On-device Edge AI).'
            : `${count} ${count === 1 ? 'person' : 'people'} tracked live via on-device Edge AI (unlimited · 0 quota).`;

  const recommendedAction =
    threatCategory === 'beating'
      ? 'Emergency intervention required immediately — stop the beating, protect the victim, and dispatch security/medical help.'
      : threatCategory === 'bullying'
        ? 'Intervene immediately, separate aggressor(s) from the targeted individual, and notify the supervising teacher.'
        : isFighting
          ? 'Inspect live feed immediately and notify supervising teacher or security.'
          : severity === 'warning'
            ? 'Check room noise/commotion on the live camera feed.'
            : 'No action needed; zone is calm.';

  return {
    studentCount: count,
    detectedPeople: people,
    isFighting,
    severity,
    threatCategory,
    threatScore,
    detectedBehaviors,
    recommendedAction,
    voiceAnalysis: transcript
      ? `Live speech monitored: "${transcript.slice(0, 80)}" (${audioLevel.toFixed(1)} dB).`
      : `Ambient audio monitored on-device (${audioLevel.toFixed(1)} dB).`,
    fightReason: isFighting ? detectedBehaviors.join('; ') : '',
    summary,
    confidence: people[0]?.confidence ?? 92,
    analyzedAt: new Date().toISOString(),
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








