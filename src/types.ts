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

export type ActiveWorkspaceView = 'grid' | 'bluetooth' | 'alerts' | 'workspace';
