import type {
  CameraSourceKind,
  ClassroomCamera,
  FacilityMode,
  IncidentAlert,
  ThreatCategory,
} from '../types';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]{1,128}$/;

const VALID_FACILITY_MODES: ReadonlySet<FacilityMode> = new Set(['all', 'bank', 'school']);

const VALID_SOURCE_KINDS: ReadonlySet<CameraSourceKind> = new Set([
  'wifi-cctv',
  'bluetooth-cctv',
  'device-camera',
  'microphone-only',
  'stream-url',
  'uploaded-media',
]);

const VALID_THREAT_CATEGORIES: ReadonlySet<ThreatCategory> = new Set([
  'none',
  'fight',
  'beating',
  'bullying',
  'robbery_or_weapon',
  'intrusion',
  'disturbance',
]);

export function sanitizeDocumentId(raw: string, fallbackPrefix = 'doc'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
  if (cleaned.length >= 1 && VALID_ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  return `${fallbackPrefix}-${Date.now().toString(36)}`.slice(0, 128);
}

/**
 * Validates that a Firebase Auth UID matches firestore.rules `isValidId(userId)` without mutating it.
 * Never mutate a Firebase Auth UID because `request.auth.uid == userId` must hold verbatim.
 */
export function validateOwnerUid(
  requestedUid: string | null | undefined,
  currentAuthUid: string | null | undefined
): string | null {
  if (!requestedUid || !currentAuthUid) return null;
  if (requestedUid !== currentAuthUid) return null;
  if (!VALID_ID_REGEX.test(requestedUid)) return null;
  return requestedUid;
}

export function normalizeFacilityMode(mode: FacilityMode | string | undefined): FacilityMode {
  if (mode && VALID_FACILITY_MODES.has(mode as FacilityMode)) {
    return mode as FacilityMode;
  }
  return 'all';
}

export function formatFriendlyAuthError(err: unknown): { cancelled: boolean; message: string } {
  const code = (err as { code?: string } | null)?.code || '';
  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/user-cancelled'
  ) {
    return { cancelled: true, message: '' };
  }
  if (code === 'auth/popup-blocked') {
    return {
      cancelled: false,
      message:
        'Sign-in popup was blocked by your browser. Allow popups for this site and click Sign in again.',
    };
  }
  if (code === 'auth/unauthorized-domain') {
    const host =
      typeof window !== 'undefined' && window.location.hostname
        ? window.location.hostname
        : 'this domain';
    return {
      cancelled: false,
      message: `Domain "${host}" is not listed under Firebase Authorized Domains yet. Monitoring & local Edge AI still work 100% without signing in.`,
    };
  }
  if (code === 'auth/network-request-failed') {
    return {
      cancelled: false,
      message:
        'No internet connection for Google Sign-In. CampusGuard continues operating 100% locally offline.',
    };
  }
  if (code === 'auth/operation-not-allowed') {
    return {
      cancelled: false,
      message: 'Google Sign-In provider is not enabled in Firebase Authentication settings yet.',
    };
  }
  if (code === 'auth/web-storage-unsupported') {
    return {
      cancelled: false,
      message:
        'Browser storage is restricted in this tab. Enable cookies/storage or open the app in a dedicated browser window to sign in.',
    };
  }
  if (code === 'auth/internal-error') {
    return {
      cancelled: false,
      message:
        'Google Sign-In could not connect to Firebase Auth. Check popup permissions and internet connection, then try again.',
    };
  }
  const raw = err instanceof Error ? err.message : 'Google Sign-In could not be completed.';
  return {
    cancelled: false,
    message: raw.replace(/^Firebase:\s*/i, '').trim(),
  };
}

export interface UserProfileInput {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  defaultTeacherEmail?: string;
  linkedCourseId?: string;
  linkedCourseName?: string;
  facilityMode?: FacilityMode;
}

function normalizeEmail(uid: string, email?: string | null): string {
  const trimmed = (email || '').trim().slice(0, 254);
  if (trimmed.length >= 3) return trimmed;
  return `${uid.slice(0, 40)}@users.local`;
}

export function buildUserProfileCreateFields(input: UserProfileInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    uid: input.uid,
    email: normalizeEmail(input.uid, input.email),
    facilityMode: normalizeFacilityMode(input.facilityMode),
  };
  if (input.displayName && input.displayName.trim()) {
    payload.displayName = input.displayName.trim().slice(0, 120);
  }
  if (input.defaultTeacherEmail && input.defaultTeacherEmail.trim()) {
    payload.defaultTeacherEmail = input.defaultTeacherEmail.trim().slice(0, 254);
  }
  if (input.linkedCourseId && input.linkedCourseId.trim()) {
    payload.linkedCourseId = input.linkedCourseId.trim().slice(0, 128);
  }
  if (input.linkedCourseName && input.linkedCourseName.trim()) {
    payload.linkedCourseName = input.linkedCourseName.trim().slice(0, 160);
  }
  return payload;
}

/**
 * Strictly emits ONLY keys permitted by firestore.rules `users/{userId}` `allow update`
 * (never mutating `uid` or `createdAt`).
 */
export function buildUserProfileUpdateFields(input: UserProfileInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    email: normalizeEmail(input.uid, input.email),
    facilityMode: normalizeFacilityMode(input.facilityMode),
  };
  if (input.displayName && input.displayName.trim()) {
    payload.displayName = input.displayName.trim().slice(0, 120);
  }
  if (input.defaultTeacherEmail !== undefined) {
    payload.defaultTeacherEmail = input.defaultTeacherEmail.trim().slice(0, 254);
  }
  if (input.linkedCourseId !== undefined) {
    payload.linkedCourseId = input.linkedCourseId.trim().slice(0, 128);
  }
  if (input.linkedCourseName !== undefined) {
    payload.linkedCourseName = input.linkedCourseName.trim().slice(0, 160);
  }
  return payload;
}

export function buildMonitoredZoneCreateFields(
  ownerUid: string,
  zoneId: string,
  camera: ClassroomCamera
): Record<string, unknown> {
  const sourceKind: CameraSourceKind = VALID_SOURCE_KINDS.has(camera.sourceKind)
    ? camera.sourceKind
    : 'device-camera';
  const cameraCode = (camera.cameraCode || '').trim().slice(0, 32) || 'CAM-01';
  const classroomName = (camera.classroomName || '').trim().slice(0, 140) || 'Monitored Zone';
  const bluetoothDeviceName =
    (camera.bluetoothDeviceName || '').trim().slice(0, 140) || 'Local Camera';
  const bluetoothAddress = (camera.bluetoothAddress || '').trim().slice(0, 128) || 'local';

  const payload: Record<string, unknown> = {
    id: zoneId,
    ownerUid,
    cameraCode,
    classroomName,
    bluetoothDeviceName,
    bluetoothAddress,
    sourceKind,
    hasVideo: Boolean(camera.hasVideo),
    hasVoice: Boolean(camera.hasVoice),
    voiceListeningEnabled: Boolean(camera.voiceListeningEnabled),
  };
  if (camera.streamUrl && camera.streamUrl.trim()) {
    payload.streamUrl = camera.streamUrl.trim().slice(0, 1000);
  }
  return payload;
}

/**
 * Strictly emits ONLY keys permitted by firestore.rules `zones/{zoneId}` `allow update`.
 */
export function buildMonitoredZoneUpdateFields(camera: ClassroomCamera): Record<string, unknown> {
  const classroomName = (camera.classroomName || '').trim().slice(0, 140) || 'Monitored Zone';
  const payload: Record<string, unknown> = {
    classroomName,
    voiceListeningEnabled: Boolean(camera.voiceListeningEnabled),
  };
  if (camera.streamUrl && camera.streamUrl.trim()) {
    payload.streamUrl = camera.streamUrl.trim().slice(0, 1000);
  }
  return payload;
}

export function buildSafetyIncidentCreateFields(
  ownerUid: string,
  incidentId: string,
  alert: IncidentAlert
): Record<string, unknown> {
  const alertType =
    alert.alertType === 'sound-threshold' || alert.alertType === 'attendance'
      ? alert.alertType
      : 'ai-vision';
  const severity = alert.severity === 'critical' ? 'critical' : 'warning';
  const cameraId = sanitizeDocumentId(alert.cameraId, 'cam');
  const cameraCode = (alert.cameraCode || '').trim().slice(0, 32) || 'CAM-01';
  const classroomName = (alert.classroomName || '').trim().slice(0, 140) || 'Monitored Zone';
  const headline = (alert.headline || '').trim().slice(0, 240) || 'Safety alert detected';
  const timestamp = (alert.timestamp || '').trim().slice(0, 64) || new Date().toISOString();

  const payload: Record<string, unknown> = {
    id: incidentId,
    ownerUid,
    cameraId,
    cameraCode,
    classroomName,
    alertType,
    severity,
    studentCount: Math.max(0, Math.min(10000, Math.round(Number(alert.studentCount) || 0))),
    headline,
    voiceCue: String(alert.voiceCue || '').slice(0, 500),
    details: String(alert.details || '').slice(0, 1000),
    teacherNotified: Boolean(alert.teacherNotified),
    acknowledged: Boolean(alert.acknowledged),
    timestamp,
  };

  if (alert.threatCategory && VALID_THREAT_CATEGORIES.has(alert.threatCategory)) {
    payload.threatCategory = alert.threatCategory;
  }
  if (alert.modelUsed && String(alert.modelUsed).trim()) {
    payload.modelUsed = String(alert.modelUsed).trim().slice(0, 64);
  }
  if (typeof alert.measuredDb === 'number' && Number.isFinite(alert.measuredDb)) {
    payload.measuredDb = Math.max(0, Math.min(200, alert.measuredDb));
  }
  if (alert.teacherMessageBody && alert.teacherMessageBody.trim()) {
    payload.teacherMessage = alert.teacherMessageBody.trim().slice(0, 2000);
  }
  return payload;
}

/**
 * Strictly emits ONLY keys permitted by firestore.rules `incidents/{incidentId}` `allow update`.
 */
export function buildSafetyIncidentUpdateFields(updates: {
  acknowledged?: boolean;
  teacherNotified?: boolean;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (updates.acknowledged !== undefined) {
    payload.acknowledged = Boolean(updates.acknowledged);
  }
  if (updates.teacherNotified !== undefined) {
    payload.teacherNotified = Boolean(updates.teacherNotified);
  }
  return payload;
}

export function sortIncidentsDescending(incidents: IncidentAlert[]): IncidentAlert[] {
  return [...incidents].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
