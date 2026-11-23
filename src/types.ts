export type CameraSourceKind =
  | 'wifi-cctv'
  | 'bluetooth-cctv'
  | 'device-camera'
  | 'microphone-only'
  | 'stream-url'
  | 'uploaded-media';

export type SafetyStatus = 'normal' | 'warning' | 'fighting';

export type AlertSeverity = 'none' | 'warning' | 'critical';

export type AiEngineModel =
  | 'gemini-4-neon'
  | 'gemini-4-hydrogen'
  | 'gpt-6-astra'
  | 'gpt-6-sol';

export type FacilityMode = 'all' | 'bank' | 'school';

export type ThreatCategory =
  | 'none'
  | 'fight'
  | 'beating'
  | 'bullying'
  | 'robbery_or_weapon'
  | 'intrusion'
  | 'disturbance';

export type ThreatSensitivity = 'standard' | 'high';

export interface PerimeterZone {
  id: string;
  label: string;
  /** Normalized 0..1000 coordinates relative to the active video/image draw rect */
  box_2d: [number, number, number, number];
}

export interface SubjectTrailPoint {
  x: number;
  y: number;
  atMs: number;
}

export interface AppearanceSignature {
  /** 36-element normalized spatial HSV histogram (18 upper torso + 18 lower body) */
  vector: number[];
  upperColorHex: string;
  lowerColorHex: string;
  lowerBodyVisible: boolean;
}

export interface TrackedSubject {
  id: string;
  numericId: number;
  box_2d: [number, number, number, number];
  confidence: number;
  faceOccluded?: boolean;
  occludedBy?: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  dwellSeconds: number;
  speedNormPerSec: number;
  trail: SubjectTrailPoint[];
  matchedWatchlistId?: string;
  matchedWatchlistLabel?: string;
  matchedSimilarity?: number;
}

export interface WatchlistSubject {
  id: string;
  label: string;
  notes?: string;
  enrolledAt: string;
  sourceCameraCode: string;
  thumbnailDataUrl: string;
  signature: AppearanceSignature;
  matchCount: number;
  lastMatchedAt?: string;
  lastMatchedZone?: string;
}

export interface DvrEvidenceFrame {
  capturedAt: string;
  offsetSec: number;
  imageDataUrl: string;
  studentCount: number;
  audioLevel: number;
  threatScore: number;
  transcript: string;
}

export interface ForensicEvidenceCase {
  id: string;
  caseNumber: string;
  cameraId: string;
  cameraCode: string;
  classroomName: string;
  triggerType:
    | 'threat'
    | 'perimeter_breach'
    | 'watchlist_match'
    | 'manual_lock'
    | 'sound_threshold';
  threatCategory: ThreatCategory;
  severity: 'info' | 'warning' | 'critical';
  headline: string;
  summary: string;
  sealedAt: string;
  sha256Hash: string;
  verified?: boolean;
  frames: DvrEvidenceFrame[];
  /** Real recorded WebM video clip URL when MediaRecorder captured live video */
  videoClipUrl?: string;
  videoClipMimeType?: string;
  peakAudioDb: number;
  maxPeopleCount: number;
  transcriptSnapshot: string;
  perimeterZone?: PerimeterZone | null;
}

export interface DetectedPersonBox {
  label: string;
  box_2d: [number, number, number, number];
  confidence: number;
  faceOccluded?: boolean;
  occludedBy?: string;
}

export interface DetectedObjectBox {
  label: string;
  category: 'weapon' | 'occluder' | 'object';
  box_2d: [number, number, number, number];
  confidence: number;
}

export interface ClassroomAnalysis {
  studentCount: number;
  detectedPeople?: DetectedPersonBox[];
  detectedObjects?: DetectedObjectBox[];
  isFighting: boolean;
  severity: AlertSeverity;
  threatCategory?: ThreatCategory;
  threatScore?: number;
  detectedBehaviors?: string[];
  recommendedAction?: string;
  voiceAnalysis: string;
  fightReason: string;
  summary: string;
  confidence: number;
  analyzedAt: string;
  modelUsed?: AiEngineModel;
  fallbackNote?: string;
}

export interface AttendanceRecord {
  dateKey: string;
  checkedAt: string;
  scheduledTime?: string;
  presentCount: number;
  absentCount: number;
  customTotal: number;
}

export interface ClassroomCamera {
  id: string;
  cameraCode: string;
  classroomName: string;
  bluetoothDeviceName: string;
  bluetoothAddress: string;
  sourceKind: CameraSourceKind;
  hasVideo: boolean;
  hasVoice: boolean;
  voiceListeningEnabled: boolean;
  autoAiEnabled?: boolean;
  aiModel?: AiEngineModel;
  expectedTotalCount?: number;
  attendanceCheckTime?: string;
  attendanceCheckEnabled?: boolean;
  lastAttendanceRecord?: AttendanceRecord;
  linkedCourseId?: string;
  linkedCourseName?: string;
  teacherEmail?: string;
  videoDeviceId?: string;
  audioDeviceId?: string;
  streamUrl?: string;
  wifiBrand?: string;
  wifiDirectMode?: boolean;
  customMediaUrl?: string;
  customMediaType?: 'image' | 'video';
  liveTranscript: string;
  audioLevel: number;
  status: SafetyStatus;
  studentCount: number;
  lastAnalysis: ClassroomAnalysis | null;
  isAnalyzing: boolean;
  errorMessage?: string;
  ptzAutoTrackEnabled?: boolean;
  trailsEnabled?: boolean;
  heatmapEnabled?: boolean;
  perimeterZone?: PerimeterZone | null;
}

export interface BluetoothDeviceCandidate {
  id: string;
  name: string;
  macAddress: string;
  serviceUuids: string[];
  declaredCapabilities: {
    video: boolean;
    voice: boolean;
  };
  sourceTransport?: 'ble' | 'host-bluetooth' | 'paired-media-bluetooth';
  audioDeviceId?: string;
  videoDeviceId?: string;
  discoveredAt: string;
}

export interface BluetoothClassification {
  isCctvCamera: boolean;
  supportsVideo: boolean;
  supportsVoice: boolean;
  isEligibleMonitor: boolean;
  deviceCategoryLabel: string;
  capabilitySummary: string;
}

export interface IncidentAlert {
  id: string;
  cameraId: string;
  cameraCode: string;
  classroomName: string;
  alertType?: 'ai-vision' | 'sound-threshold' | 'attendance';
  severity: Exclude<AlertSeverity, 'none'>;
  threatCategory?: ThreatCategory;
  threatScore?: number;
  detectedBehaviors?: string[];
  recommendedAction?: string;
  evidenceSnapshotUrl?: string;
  modelUsed?: AiEngineModel;
  studentCount: number;
  measuredDb?: number;
  headline: string;
  voiceCue: string;
  details: string;
  teacherMessageSubject?: string;
  teacherMessageBody?: string;
  teacherNotified?: boolean;
  timestamp: string;
  acknowledged: boolean;
}

export interface WorkspaceCourse {
  id: string;
  name: string;
  section?: string;
  room?: string;
  courseState?: string;
}

export interface WorkspaceTeacher {
  userId: string;
  name: string;
  email?: string;
}

export interface WorkspaceGmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export type ActiveWorkspaceView = 'grid' | 'bluetooth' | 'alerts' | 'evidence' | 'workspace';
