import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bluetooth,
  Camera,
  Columns2,
  Grid3X3,
  LayoutGrid,
  Mic,
  Square,
  Upload,
  Wifi,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { AlertPopupOverlay } from './components/AlertPopupOverlay';
import { AlertsPanel } from './components/AlertsPanel';
import { AppDownloadControls, OfflineBanner } from './components/AppDownloadControls';
import { BluetoothDirectoryView } from './components/BluetoothDirectoryView';
import { BluetoothScannerModal, type ScannerModalTab } from './components/BluetoothScannerModal';
import {
  CameraFeedCard,
  type CameraFramePayload,
  type DvrBundleSnapshot,
  type RealtimeThreatEvent,
} from './components/CameraFeedCard';
import { DedicatedCameraPanel } from './components/DedicatedCameraPanel';
import { EvidenceVaultView } from './components/EvidenceVaultView';
import { LiveIncidentRail } from './components/LiveIncidentRail';
import { NotificationBanner } from './components/NotificationBanner';
import { Sidebar } from './components/Sidebar';
import { TeacherAlertDispatchModal } from './components/TeacherAlertDispatchModal';
import { TopBar } from './components/TopBar';
import { WorkspaceTeacherHub } from './components/WorkspaceTeacherHub';
import {
  deleteZoneFromFirestore,
  getAccessToken,
  getFirebaseIdToken,
  googleSignIn,
  initAuth,
  logout,
  saveIncidentToFirestore,
  saveZoneToFirestore,
  subscribeToUserIncidents,
  syncUserProfileToFirestore,
  updateIncidentInFirestore,
} from './lib/firebase';
import {
  fetchClassroomCourses,
  fetchCourseRosterInfo,
  fetchRecentGmailMessages,
  postClassroomAnnouncement,
  sendTeacherGmailAlert,
} from './lib/workspaceApi';
import type {
  ActiveWorkspaceView,
  AiEngineModel,
  AppearanceSignature,
  BluetoothDeviceCandidate,
  ClassroomAnalysis,
  ClassroomCamera,
  DetectedObjectBox,
  DetectedPersonBox,
  FacilityMode,
  ForensicEvidenceCase,
  IncidentAlert,
  PerimeterZone,
  ThreatSensitivity,
  WatchlistSubject,
  WorkspaceCourse,
  WorkspaceGmailMessage,
  WorkspaceTeacher,
} from './types';
import { ensureLocalPersonDetector } from './utils/localPersonDetector';
import { extractAppearanceSignature } from './utils/subjectIntelligence';
import { sealForensicEvidenceCase } from './utils/tacticalForensics';
import { openRawMediaStream, playAlertChime, sendBrowserNotification } from './utils/mediaCapture';
import {
  DEFAULT_DB_CALIBRATION_OFFSET,
  SOUND_ALERT_SUSTAINED_MS,
  SOUND_ALERT_THRESHOLD_DB,
  computeCampusSummary,
  computeClassAttendance,
  deriveSafetyStatus,
  evaluateAttendanceReportAlert,
  evaluateFightNotification,
  evaluateLocalSafetyAnalysis,
  evaluateSoundThresholdAlert,
  evaluateSustainedSoundDuration,
  evaluateVoiceCueThreatAlert,
  formatFacilityLabels,
  getLocalDateKey,
  parseSafeJsonText,
  shouldRunScheduledAttendance,
  shouldTriggerAudioSpikeScan,
} from './utils/monitoringLogic';

const STORAGE_CAMERAS_KEY = 'campusguard_cameras_v2';
const STORAGE_ALERTS_KEY = 'campusguard_alerts_v2';
const STORAGE_FACILITY_KEY = 'campusguard_facility_mode_v1';
const STORAGE_TEACHER_EMAIL_KEY = 'campusguard_teacher_email_v1';
const STORAGE_DB_OFFSET_KEY = 'campusguard_db_offset_v1';
const STORAGE_SENSITIVITY_KEY = 'campusguard_threat_sensitivity_v1';
const STORAGE_WATCHLIST_KEY = 'campusguard_watchlist_v1';

function loadSavedWatchlist(): WatchlistSubject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_WATCHLIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WatchlistSubject[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSavedThreatSensitivity(): ThreatSensitivity {
  if (typeof window === 'undefined') return 'standard';
  try {
    const raw = localStorage.getItem(STORAGE_SENSITIVITY_KEY);
    return raw === 'high' ? 'high' : 'standard';
  } catch {
    return 'standard';
  }
}

function loadSavedCameras(): ClassroomCamera[] {
  if (typeof window === 'undefined') return [];
  try {
    localStorage.removeItem('campusguard_cameras_v1');
    localStorage.removeItem('campusguard_alerts_v1');
    const raw = localStorage.getItem(STORAGE_CAMERAS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClassroomCamera[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((cam) => cam.sourceKind !== 'uploaded-media')
      .map((cam) => ({
        ...cam,
        isAnalyzing: false,
        errorMessage: undefined,
      }));
  } catch {
    return [];
  }
}

function loadSavedAlerts(): IncidentAlert[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_ALERTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as IncidentAlert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSavedFacilityMode(): FacilityMode {
  if (typeof window === 'undefined') return 'all';
  try {
    const raw = localStorage.getItem(STORAGE_FACILITY_KEY);
    if (raw === 'bank' || raw === 'school' || raw === 'all') return raw;
    return 'all';
  } catch {
    return 'all';
  }
}

function loadSavedTeacherEmail(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(STORAGE_TEACHER_EMAIL_KEY) || '';
  } catch {
    return '';
  }
}

function loadSavedDbOffset(): number {
  if (typeof window === 'undefined') return DEFAULT_DB_CALIBRATION_OFFSET;
  try {
    const raw = localStorage.getItem(STORAGE_DB_OFFSET_KEY);
    if (!raw) return DEFAULT_DB_CALIBRATION_OFFSET;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 85 && parsed <= 120) {
      return Math.round(parsed);
    }
    return DEFAULT_DB_CALIBRATION_OFFSET;
  } catch {
    return DEFAULT_DB_CALIBRATION_OFFSET;
  }
}

export default function App() {
  const [cameras, setCameras] = useState<ClassroomCamera[]>(loadSavedCameras);
  const [alerts, setAlerts] = useState<IncidentAlert[]>(loadSavedAlerts);
  const [popupAlerts, setPopupAlerts] = useState<IncidentAlert[]>([]);
  const [facilityMode, setFacilityMode] = useState<FacilityMode>(loadSavedFacilityMode);
  const [threatSensitivity, setThreatSensitivity] = useState<ThreatSensitivity>(
    loadSavedThreatSensitivity
  );
  const [discoveredBluetooth, setDiscoveredBluetooth] = useState<BluetoothDeviceCandidate[]>([]);
  const lastVoiceCueAlertAtRef = useRef<Record<string, number>>({});
  const loudHoldStartByCamRef = useRef<Record<string, number | null>>({});
  const [activeView, setActiveView] = useState<ActiveWorkspaceView>('grid');
  const [focusedCameraId, setFocusedCameraId] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerInitialTab, setScannerInitialTab] = useState<ScannerModalTab>('wifi');
  const [wallLayout, setWallLayout] = useState<'1x1' | '2x2' | '3x3'>('2x2');
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [evidenceCases, setEvidenceCases] = useState<ForensicEvidenceCase[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistSubject[]>(loadSavedWatchlist);

  const openScannerOnTab = useCallback((tab: ScannerModalTab) => {
    setScannerInitialTab(tab);
    setIsScannerOpen(true);
  }, []);

  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState(true);
  const [audioSpikeAutoScan, setAudioSpikeAutoScan] = useState(true);
  const [dbCalibrationOffset, setDbCalibrationOffset] = useState<number>(loadSavedDbOffset);
  const [selectedAiModel, setSelectedAiModel] = useState<AiEngineModel>('gemini-4-neon');
  const [cloudQuotaExhausted, setCloudQuotaExhausted] = useState(false);
  const cloudQuotaExhaustedRef = useRef(false);
  const localEdgeActiveCamerasRef = useRef<Set<string>>(new Set());
  const [aiCapabilities, setAiCapabilities] = useState<{
    openaiConfigured: boolean;
    geminiConfigured: boolean;
  }>({ openaiConfigured: true, geminiConfigured: true });
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  });
  const [desktopNotifications, setDesktopNotifications] = useState(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    return Notification.permission === 'granted';
  });

  // Firebase Auth & Google Workspace (Classroom + Gmail) in-memory state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [defaultTeacherEmail, setDefaultTeacherEmail] = useState<string>(loadSavedTeacherEmail);
  const [courses, setCourses] = useState<WorkspaceCourse[]>([]);
  const [linkedCourseId, setLinkedCourseId] = useState<string>('');
  const [linkedCourseName, setLinkedCourseName] = useState<string>('');
  const [courseTeachers, setCourseTeachers] = useState<WorkspaceTeacher[]>([]);
  const [courseStudentCount, setCourseStudentCount] = useState<number | null>(null);
  const [gmailMessages, setGmailMessages] = useState<WorkspaceGmailMessage[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [dispatchAlert, setDispatchAlert] = useState<IncidentAlert | null>(null);

  useEffect(() => {
    // Pre-warm self-hosted COCO-SSD neural model on startup so any device recognizes humans immediately
    const warmTimer = window.setTimeout(() => {
      void ensureLocalPersonDetector().catch(() => {});
    }, 600);
    return () => clearTimeout(warmTimer);
  }, []);

  useEffect(() => {
    fetch('/api/ai/capabilities')
      .then(async (r) => {
        if (!r.ok) return null;
        const parsed = parseSafeJsonText<{
          openaiConfigured?: boolean;
          geminiConfigured?: boolean;
          defaultModel?: AiEngineModel;
        }>(await r.text());
        return parsed.ok ? parsed.data : null;
      })
      .then(
        (
          data: {
            openaiConfigured?: boolean;
            geminiConfigured?: boolean;
            defaultModel?: AiEngineModel;
          } | null
        ) => {
          if (!data) return;
          const openaiOk = Boolean(data.openaiConfigured);
          const geminiOk = Boolean(data.geminiConfigured);
          setAiCapabilities({ openaiConfigured: openaiOk, geminiConfigured: geminiOk });
          if (data.defaultModel) {
            setSelectedAiModel(data.defaultModel);
          }
          if (!openaiOk && geminiOk) {
            setCameras((prev) =>
              prev.map((cam) =>
                cam.aiModel === 'gpt-6-astra' || cam.aiModel === 'gpt-6-sol'
                  ? { ...cam, aiModel: 'gemini-4-neon' }
                  : cam
              )
            );
          }
        }
      )
      .catch(() => {});
  }, []);

  const camerasRef = useRef<ClassroomCamera[]>(cameras);
  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  const currentUserRef = useRef<User | null>(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const teacherEmailRef = useRef<string>(defaultTeacherEmail);
  useEffect(() => {
    teacherEmailRef.current = defaultTeacherEmail;
  }, [defaultTeacherEmail]);

  const courseNameRef = useRef<string>(linkedCourseName);
  useEffect(() => {
    courseNameRef.current = linkedCourseName;
  }, [linkedCourseName]);

  const courseTeachersRef = useRef<WorkspaceTeacher[]>(courseTeachers);
  useEffect(() => {
    courseTeachersRef.current = courseTeachers;
  }, [courseTeachers]);

  const frameCapturersRef = useRef<Record<string, () => CameraFramePayload | null>>({});
  const dvrProvidersRef = useRef<Record<string, () => DvrBundleSnapshot>>({});
  const caseCounterRef = useRef(1);
  const mediaStreamsRef = useRef<Record<string, MediaStream>>({});
  const analyzingIdsRef = useRef<Set<string>>(new Set());
  const lastSpikeScanAtRef = useRef<Record<string, number>>({});
  const lastDbAlertAtRef = useRef<Record<string, number>>({});
  const [, setStreamRevision] = useState(0);

  // Sync Firebase Auth state & load persisted Cloud SQL state when authenticated
  const syncWorkspaceFromGoogle = useCallback(async (token: string | null) => {
    if (!token) return;
    setLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const [loadedCourses, loadedEmails] = await Promise.all([
        fetchClassroomCourses(token),
        fetchRecentGmailMessages(token, 6),
      ]);
      setCourses(loadedCourses);
      setGmailMessages(loadedEmails);
      if (loadedCourses.length > 0 && !linkedCourseId) {
        const first = loadedCourses[0];
        setLinkedCourseId(first.id);
        setLinkedCourseName(first.name);
        const roster = await fetchCourseRosterInfo(token, first.id).catch(() => ({
          teachers: [],
          studentCount: 0,
        }));
        setCourseTeachers(roster.teachers);
        setCourseStudentCount(roster.studentCount);
        const firstTeacherEmail = roster.teachers.find((t) => t.email)?.email;
        if (firstTeacherEmail && !teacherEmailRef.current) {
          setDefaultTeacherEmail(firstTeacherEmail);
        }
      }
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Unable to sync Google Classroom & Gmail.'
      );
    } finally {
      setLoadingWorkspace(false);
    }
  }, [linkedCourseId]);

  const syncBackendWorkspaceState = useCallback(async (user: User) => {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/workspace-state', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) return;
      const parsedState = parseSafeJsonText<{
        profile?: {
          defaultTeacherEmail?: string | null;
          linkedCourseId?: string | null;
          linkedCourseName?: string | null;
          facilityMode?: FacilityMode;
        };
        zones?: Array<{
          id: string;
          cameraCode: string;
          classroomName: string;
          bluetoothDeviceName: string;
          bluetoothAddress: string;
          sourceKind: ClassroomCamera['sourceKind'];
          hasVideo: boolean;
          hasVoice: boolean;
          voiceListeningEnabled: boolean;
          streamUrl?: string | null;
          studentCount: number;
          status: ClassroomCamera['status'];
        }>;
      }>(await res.text());
      if (!parsedState.ok) return;
      const data = parsedState.data;

      if (data.profile?.defaultTeacherEmail && !teacherEmailRef.current) {
        setDefaultTeacherEmail(data.profile.defaultTeacherEmail);
      }
      if (data.profile?.linkedCourseId) {
        setLinkedCourseId(data.profile.linkedCourseId);
      }
      if (data.profile?.linkedCourseName) {
        setLinkedCourseName(data.profile.linkedCourseName);
      }
      if (data.zones && data.zones.length > 0 && camerasRef.current.length === 0) {
        setCameras(
          data.zones.map((z) => ({
            id: z.id,
            cameraCode: z.cameraCode,
            classroomName: z.classroomName,
            bluetoothDeviceName: z.bluetoothDeviceName,
            bluetoothAddress: z.bluetoothAddress,
            sourceKind: z.sourceKind,
            hasVideo: z.hasVideo,
            hasVoice: z.hasVoice,
            voiceListeningEnabled: z.voiceListeningEnabled,
            streamUrl: z.streamUrl ?? undefined,
            liveTranscript: '',
            audioLevel: 0,
            status: z.status || 'normal',
            studentCount: z.studentCount || 0,
            lastAnalysis: null,
            isAnalyzing: false,
          }))
        );
      }
    } catch {
      // keep silent in UI
    }
  }, []);

  useEffect(() => {
    const unsubscribe = initAuth((user, token) => {
      setCurrentUser(user);
      setHasAccessToken(Boolean(token));
      if (user) {
        void syncUserProfileToFirestore(user, {
          defaultTeacherEmail: teacherEmailRef.current || undefined,
          linkedCourseId: linkedCourseId || undefined,
          linkedCourseName: courseNameRef.current || undefined,
          facilityMode,
        }).catch(() => {});
        void syncBackendWorkspaceState(user);
      } else {
        setCourses([]);
        setGmailMessages([]);
        setCourseTeachers([]);
        setCourseStudentCount(null);
      }
    });
    return () => unsubscribe();
  }, [facilityMode, linkedCourseId, syncBackendWorkspaceState]);

  useEffect(() => {
    if (!currentUser) return;
    const unsub = subscribeToUserIncidents(currentUser.uid, (firestoreIncidents) => {
      if (firestoreIncidents.length > 0) {
        setAlerts((prev) => {
          const merged = new Map<string, IncidentAlert>();
          for (const item of firestoreIncidents) merged.set(item.id, item);
          for (const localItem of prev) {
            if (!merged.has(localItem.id)) merged.set(localItem.id, localItem);
          }
          return Array.from(merged.values())
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            .slice(0, 50);
        });
      }
    });
    return () => unsub();
  }, [currentUser]);

  const handleGoogleSignIn = useCallback(async () => {
    setIsSigningIn(true);
    setWorkspaceError(null);
    try {
      const { user, accessToken } = await googleSignIn();
      setCurrentUser(user);
      setHasAccessToken(Boolean(accessToken));
      await syncUserProfileToFirestore(user, {
        defaultTeacherEmail: teacherEmailRef.current || user.email || undefined,
        linkedCourseId: linkedCourseId || undefined,
        linkedCourseName: courseNameRef.current || undefined,
        facilityMode,
      }).catch(() => {});
      void syncBackendWorkspaceState(user);
      if (accessToken) {
        await syncWorkspaceFromGoogle(accessToken);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setWorkspaceError(msg);
      setGlobalError(msg);
    } finally {
      setIsSigningIn(false);
    }
  }, [facilityMode, linkedCourseId, syncBackendWorkspaceState, syncWorkspaceFromGoogle]);

  const handleSignOut = useCallback(async () => {
    await logout();
    setCurrentUser(null);
    setHasAccessToken(false);
    setCourses([]);
    setGmailMessages([]);
  }, []);

  const persistZoneAsync = useCallback(async (camera: ClassroomCamera) => {
    const user = currentUserRef.current;
    if (!user) return;
    void saveZoneToFirestore(user.uid, camera).catch(() => {});
    try {
      const idToken = await getFirebaseIdToken();
      if (!idToken) return;
      await fetch('/api/zones', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          id: camera.id,
          cameraCode: camera.cameraCode,
          classroomName: camera.classroomName,
          bluetoothDeviceName: camera.bluetoothDeviceName,
          bluetoothAddress: camera.bluetoothAddress,
          sourceKind: camera.sourceKind,
          hasVideo: camera.hasVideo,
          hasVoice: camera.hasVoice,
          voiceListeningEnabled: camera.voiceListeningEnabled,
          streamUrl: camera.streamUrl ?? null,
          studentCount: camera.studentCount,
          status: camera.status,
        }),
      });
    } catch {
      // background sync failure kept non-blocking
    }
  }, []);

  const persistIncidentAsync = useCallback(async (incident: IncidentAlert) => {
    const user = currentUserRef.current;
    if (!user) return;
    void saveIncidentToFirestore(user.uid, incident).catch(() => {});
    try {
      const idToken = await getFirebaseIdToken();
      if (!idToken) return;
      await fetch('/api/incidents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          ...incident,
          teacherMessage: incident.teacherMessageBody ?? null,
        }),
      });
    } catch {
      // background sync failure kept non-blocking
    }
  }, []);

  useEffect(() => {
    try {
      const serializable = cameras.map((cam) => ({
        ...cam,
        isAnalyzing: false,
        errorMessage: undefined,
      }));
      localStorage.setItem(STORAGE_CAMERAS_KEY, JSON.stringify(serializable));
    } catch {
      // ignore storage quota errors
    }
  }, [cameras]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ALERTS_KEY, JSON.stringify(alerts.slice(0, 50)));
    } catch {
      // ignore storage quota errors
    }
  }, [alerts]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_FACILITY_KEY, facilityMode);
    } catch {
      // ignore storage errors
    }
  }, [facilityMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_TEACHER_EMAIL_KEY, defaultTeacherEmail);
    } catch {
      // ignore storage errors
    }
  }, [defaultTeacherEmail]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DB_OFFSET_KEY, String(dbCalibrationOffset));
    } catch {
      // ignore storage errors
    }
  }, [dbCalibrationOffset]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SENSITIVITY_KEY, threatSensitivity);
    } catch {
      // ignore storage errors
    }
  }, [threatSensitivity]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_WATCHLIST_KEY, JSON.stringify(watchlist.slice(0, 24)));
    } catch {
      // ignore storage quota errors
    }
  }, [watchlist]);

  const labels = useMemo(() => formatFacilityLabels(facilityMode), [facilityMode]);

  const summary = useMemo(
    () => computeCampusSummary(cameras, alerts),
    [cameras, alerts]
  );

  const latestUnacknowledgedAlert = useMemo(
    () => alerts.find((a) => !a.acknowledged) ?? null,
    [alerts]
  );

  const soundThresholdAlerts = useMemo(
    () => alerts.filter((a) => a.alertType === 'sound-threshold'),
    [alerts]
  );

  const registerCapture = useCallback(
    (cameraId: string, captureFn: (() => CameraFramePayload | null) | null) => {
      if (captureFn) {
        frameCapturersRef.current[cameraId] = captureFn;
      } else {
        delete frameCapturersRef.current[cameraId];
      }
    },
    []
  );

  const registerDvrProvider = useCallback(
    (cameraId: string, provider: (() => DvrBundleSnapshot) | null) => {
      if (provider) {
        dvrProvidersRef.current[cameraId] = provider;
      } else {
        delete dvrProvidersRef.current[cameraId];
      }
    },
    []
  );

  const sealEvidenceCaseForCamera = useCallback(
    async (params: {
      camera: ClassroomCamera | null;
      triggerType: ForensicEvidenceCase['triggerType'];
      threatCategory: ForensicEvidenceCase['threatCategory'];
      severity: ForensicEvidenceCase['severity'];
      headline: string;
      summary: string;
      bundle?: DvrBundleSnapshot;
      fallbackSnapshotUrl?: string;
      perimeterZone?: PerimeterZone;
    }): Promise<ForensicEvidenceCase> => {
      const { camera } = params;
      const caseSeq = caseCounterRef.current++;
      const caseNumber = `CASE-${String(caseSeq).padStart(3, '0')}`;
      const sealedAt = new Date().toISOString();

      const liveBundle =
        params.bundle ?? (camera ? dvrProvidersRef.current[camera.id]?.() : undefined);
      let collectedFrames = liveBundle?.frames ? [...liveBundle.frames] : [];

      if (collectedFrames.length === 0 && params.fallbackSnapshotUrl) {
        collectedFrames = [
          {
            capturedAt: sealedAt,
            offsetSec: 0,
            imageDataUrl: params.fallbackSnapshotUrl,
            studentCount: camera?.studentCount ?? 0,
            audioLevel: camera?.audioLevel ?? 0,
            threatScore: camera?.lastAnalysis?.threatScore ?? 0,
            transcript: camera?.liveTranscript ?? '',
          },
        ];
      }

      const peakAudioDb = Math.max(
        camera?.audioLevel ?? 0,
        ...collectedFrames.map((f) => f.audioLevel || 0)
      );
      const maxPeopleCount = Math.max(
        camera?.studentCount ?? 0,
        ...collectedFrames.map((f) => f.studentCount || 0)
      );

      const sealed = await sealForensicEvidenceCase({
        id: `ev-${Date.now()}-${caseSeq}`,
        caseNumber,
        cameraId: camera?.id ?? 'site-command',
        cameraCode: camera?.cameraCode ?? 'SITE',
        classroomName: camera?.classroomName ?? 'Site Command',
        triggerType: params.triggerType,
        threatCategory: params.threatCategory,
        severity: params.severity,
        headline: params.headline,
        summary: params.summary,
        sealedAt,
        peakAudioDb,
        maxPeopleCount,
        transcriptSnapshot: camera?.liveTranscript || '',
        perimeterZone: params.perimeterZone ?? camera?.perimeterZone,
        videoClipUrl: liveBundle?.videoClipUrl,
        videoClipMimeType: liveBundle?.videoClipMimeType,
        frames: collectedFrames,
      });

      setEvidenceCases((prev) => [sealed, ...prev].slice(0, 40));
      setSelectedEvidenceId((prev) => prev ?? sealed.id);
      return sealed;
    },
    []
  );

  const handleDeviceDiscovered = useCallback((device: BluetoothDeviceCandidate) => {
    setDiscoveredBluetooth((prev) => [device, ...prev.filter((d) => d.id !== device.id)]);
  }, []);

  const analyzeCamera = useCallback(
    async (
      cameraId: string,
      options?: { audioSpikeDetected?: boolean; isAutoTrigger?: boolean }
    ) => {
      const target = camerasRef.current.find((c) => c.id === cameraId);
      if (!target || analyzingIdsRef.current.has(cameraId)) return;

      const isAutoTrigger = Boolean(options?.isAutoTrigger);
      const transcriptToSend = target.voiceListeningEnabled ? target.liveTranscript : '';
      const audioLevelToSend = target.voiceListeningEnabled ? target.audioLevel : 0;

      const capturePayload = frameCapturersRef.current[cameraId]?.() ?? null;

      // Helper: run 100% on-device local safety analysis when cloud API quota (HTTP 429) is exhausted
      const applyLocalEdgeSafetyFallback = (
        previewDataUrl?: string,
        quotaMessage?: string
      ) => {
        const currentPeople = target.lastAnalysis?.detectedPeople ?? [];
        const currentObjects =
          capturePayload?.detectedObjects ?? target.lastAnalysis?.detectedObjects ?? [];
        const localResult = evaluateLocalSafetyAnalysis({
          detectedPeople: currentPeople,
          detectedObjects: currentObjects,
          frameDeltaPercent: capturePayload?.liveMotionPercent ?? 0,
          voiceTranscript: transcriptToSend,
          audioLevel: audioLevelToSend,
          facilityMode,
          audioSpikeDetected: options?.audioSpikeDetected,
          sensitivity: threatSensitivity,
        });
        const nextStatus = deriveSafetyStatus(localResult);
        setCameras((prev) =>
          prev.map((cam) => {
            if (cam.id !== cameraId) return cam;
            const livePeople = cam.lastAnalysis?.detectedPeople ?? currentPeople;
            const liveObjects = cam.lastAnalysis?.detectedObjects ?? currentObjects;
            const merged: ClassroomAnalysis = {
              ...localResult,
              studentCount: livePeople.length,
              detectedPeople: livePeople,
              detectedObjects: liveObjects,
            };
            return {
              ...cam,
              isAnalyzing: false,
              studentCount: livePeople.length,
              status: nextStatus,
              lastAnalysis: merged,
              errorMessage: undefined,
            };
          })
        );
        if (quotaMessage) {
          setStatusNotice(quotaMessage);
        }
        const newAlert = evaluateFightNotification(target, localResult, facilityMode);
        if (newAlert) {
          const enrichedAlert: IncidentAlert = previewDataUrl
            ? { ...newAlert, evidenceSnapshotUrl: previewDataUrl }
            : newAlert;
          setAlerts((prev) => [enrichedAlert, ...prev]);
          setPopupAlerts((prev) => [enrichedAlert, ...prev.filter((item) => item.id !== enrichedAlert.id)].slice(0, 6));
          void persistIncidentAsync(enrichedAlert);
          void sealEvidenceCaseForCamera({
            camera: target,
            triggerType: 'threat',
            threatCategory: enrichedAlert.threatCategory ?? 'disturbance',
            severity: enrichedAlert.severity === 'critical' ? 'critical' : 'warning',
            headline: enrichedAlert.headline,
            summary: enrichedAlert.details,
            fallbackSnapshotUrl: previewDataUrl,
          });
          if (soundAlertsEnabled) {
            playAlertChime();
          }
          if (desktopNotifications) {
            sendBrowserNotification(enrichedAlert);
          }
        }
      };

      // If cloud API quota was already reached, stay cleanly on unlimited local Edge AI during background scans
      if (isAutoTrigger && cloudQuotaExhaustedRef.current) {
        applyLocalEdgeSafetyFallback(capturePayload?.previewDataUrl);
        return;
      }

      const frameBase64 = capturePayload?.frameBase64;
      const previousFrameBase64 = capturePayload?.previousFrameBase64;

      if (!frameBase64 && !transcriptToSend) {
        if (!isAutoTrigger) {
          const isMicOnly = target.sourceKind === 'microphone-only' || !target.hasVideo;
          const noSignalMsg = isMicOnly
            ? 'No speech cue captured yet for this microphone-only zone. Click Connect Live Mic or Inspect → Edit cue to analyze audio.'
            : 'Camera video feed is offline (NO SIGNAL) and no audio transcript is present. Reconnect the camera or verify stream URL before scanning.';
          setGlobalError(`${target.classroomName}: ${noSignalMsg}`);
          setCameras((prev) =>
            prev.map((cam) =>
              cam.id === cameraId ? { ...cam, isAnalyzing: false, errorMessage: noSignalMsg } : cam
            )
          );
        }
        return;
      }

      analyzingIdsRef.current.add(cameraId);
      if (!isAutoTrigger) {
        setGlobalError(null);
      }
      setCameras((prev) =>
        prev.map((cam) =>
          cam.id === cameraId
            ? { ...cam, isAnalyzing: true, errorMessage: undefined }
            : cam
        )
      );

      try {
        let cameraAiModel = target.aiModel || selectedAiModel;
        if (
          !aiCapabilities.openaiConfigured &&
          aiCapabilities.geminiConfigured &&
          (cameraAiModel === 'gpt-6-astra' || cameraAiModel === 'gpt-6-sol')
        ) {
          cameraAiModel = 'gemini-4-neon';
        }
        const response = await fetch('/api/analyze-classroom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classroomName: target.classroomName,
            facilityMode,
            imageBase64: frameBase64,
            previousFrameBase64,
            imageMimeType: 'image/jpeg',
            voiceTranscript: transcriptToSend,
            audioLevel: audioLevelToSend,
            audioSpikeDetected: Boolean(options?.audioSpikeDetected),
            aiModel: cameraAiModel,
          }),
        });

        const rawBody = await response.text();
        const parsedBody = parseSafeJsonText<ClassroomAnalysis & { error?: string }>(rawBody);
        if (!parsedBody.ok) {
          // Server restarting or reverse-proxy returned HTML (<!doctype ...>) — never show raw JSON syntax error
          applyLocalEdgeSafetyFallback(
            capturePayload?.previewDataUrl,
            !isAutoTrigger
              ? `Cloud AI server temporarily reloaded (HTTP ${response.status}) — running live on-device Edge AI. Click Scan Now in a moment to retry cloud AI.`
              : undefined
          );
          return;
        }
        const data = parsedBody.data;
        if (!response.ok) {
          const apiErr = new Error(
            data.error || `Analysis request failed (${response.status})`
          ) as Error & { status?: number };
          apiErr.status = response.status;
          throw apiErr;
        }

        // Cloud scan succeeded -> re-enable cloud polling if previously exhausted
        if (cloudQuotaExhaustedRef.current) {
          cloudQuotaExhaustedRef.current = false;
          setCloudQuotaExhausted(false);
        }

        const nextStatus = deriveSafetyStatus(data);
        const usesLocalEdgeCount = localEdgeActiveCamerasRef.current.has(cameraId);

        setCameras((prev) =>
          prev.map((cam) => {
            if (cam.id !== cameraId) return cam;
            // When real-time local Edge AI is active, preserve its instant live headcount & boxes
            // so slower cloud threat scans never overwrite an empty room with a stale count
            const effectivePeople = usesLocalEdgeCount
              ? cam.lastAnalysis?.detectedPeople ?? []
              : data.detectedPeople ?? [];
            const effectiveCount = usesLocalEdgeCount ? effectivePeople.length : data.studentCount;
            const mergedAnalysis: ClassroomAnalysis = {
              ...data,
              studentCount: effectiveCount,
              detectedPeople: effectivePeople,
            };
            const updated: ClassroomCamera = {
              ...cam,
              isAnalyzing: false,
              studentCount: effectiveCount,
              status: nextStatus,
              lastAnalysis: mergedAnalysis,
              errorMessage: undefined,
            };
            void persistZoneAsync(updated);
            return updated;
          })
        );

        const newAlert = evaluateFightNotification(target, data, facilityMode);
        if (newAlert) {
          const enrichedAlert: IncidentAlert = capturePayload?.previewDataUrl
            ? { ...newAlert, evidenceSnapshotUrl: capturePayload.previewDataUrl }
            : newAlert;
          setAlerts((prev) => [enrichedAlert, ...prev]);
          setPopupAlerts((prev) => [enrichedAlert, ...prev.filter((item) => item.id !== enrichedAlert.id)].slice(0, 6));
          void persistIncidentAsync(enrichedAlert);
          void sealEvidenceCaseForCamera({
            camera: target,
            triggerType: 'threat',
            threatCategory: enrichedAlert.threatCategory ?? 'disturbance',
            severity: enrichedAlert.severity === 'critical' ? 'critical' : 'warning',
            headline: enrichedAlert.headline,
            summary: enrichedAlert.details,
            fallbackSnapshotUrl: capturePayload?.previewDataUrl,
          });
          if (soundAlertsEnabled) {
            playAlertChime();
          }
          if (desktopNotifications) {
            sendBrowserNotification(enrichedAlert);
          }
        }
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (status === 429) {
          cloudQuotaExhaustedRef.current = true;
          setCloudQuotaExhausted(true);
          setGlobalError(null);
          applyLocalEdgeSafetyFallback(
            capturePayload?.previewDataUrl,
            'Cloud API quota limit reached (HTTP 429) — running seamlessly on unlimited on-device Edge AI (multi-person counting + local voice & safety monitoring). Click Scan Now anytime to retry cloud AI.'
          );
          return;
        }

        const baseMessage =
          err instanceof Error ? err.message : 'Unable to complete zone AI analysis.';
        const shouldPauseOnAuth = status === 401 || status === 403;
        const finalMessage = shouldPauseOnAuth
          ? `${baseMessage} Autonomous scanning paused for this camera.`
          : baseMessage;
        setGlobalError(finalMessage);
        setCameras((prev) =>
          prev.map((cam) =>
            cam.id === cameraId
              ? {
                  ...cam,
                  isAnalyzing: false,
                  autoAiEnabled: shouldPauseOnAuth ? false : cam.autoAiEnabled,
                  errorMessage: finalMessage,
                }
              : cam
          )
        );
      } finally {
        analyzingIdsRef.current.delete(cameraId);
      }
    },
    [
      aiCapabilities.geminiConfigured,
      aiCapabilities.openaiConfigured,
      desktopNotifications,
      facilityMode,
      persistIncidentAsync,
      persistZoneAsync,
      sealEvidenceCaseForCamera,
      selectedAiModel,
      soundAlertsEnabled,
      threatSensitivity,
    ]
  );

  const handleLocalPersonDetections = useCallback(
    (
      cameraId: string,
      detectedPeople: DetectedPersonBox[],
      detectedObjects: DetectedObjectBox[]
    ) => {
      localEdgeActiveCamerasRef.current.add(cameraId);
      setCameras((prev) =>
        prev.map((cam) => {
          if (cam.id !== cameraId) return cam;
          const count = detectedPeople.length;
          const prevAnalysis = cam.lastAnalysis;
          const nextAnalysis: ClassroomAnalysis = prevAnalysis
            ? {
                ...prevAnalysis,
                studentCount: count,
                detectedPeople,
                detectedObjects,
                analyzedAt: new Date().toISOString(),
                summary:
                  count === 0 && !prevAnalysis.isFighting
                    ? 'No people detected in live frame (empty room · Edge AI).'
                    : prevAnalysis.summary,
              }
            : {
                studentCount: count,
                detectedPeople,
                detectedObjects,
                isFighting: false,
                severity: 'none',
                threatCategory: 'none',
                threatScore: 0,
                detectedBehaviors: [],
                recommendedAction: 'No action needed; zone is calm.',
                voiceAnalysis: 'Ambient zone audio monitored.',
                fightReason: '',
                summary:
                  count === 0
                    ? 'No people detected in live frame (empty room · Edge AI).'
                    : `${count} ${count === 1 ? 'person' : 'people'} detected live (Edge AI).`,
                confidence: detectedPeople[0]?.confidence ?? 95,
                analyzedAt: new Date().toISOString(),
              };
          return {
            ...cam,
            studentCount: count,
            lastAnalysis: nextAnalysis,
          };
        })
      );
    },
    []
  );

  const handleRealtimeEdgeThreat = useCallback(
    (cameraId: string, event: RealtimeThreatEvent) => {
      const target = camerasRef.current.find((c) => c.id === cameraId);
      if (!target) return;

      if (event.shouldClearThreat) {
        setCameras((prev) =>
          prev.map((cam) => {
            if (cam.id !== cameraId || cam.status === 'normal') return cam;
            const livePeople = cam.lastAnalysis?.detectedPeople ?? [];
            const liveObjects = cam.lastAnalysis?.detectedObjects ?? [];
            return {
              ...cam,
              status: 'normal',
              lastAnalysis: cam.lastAnalysis
                ? {
                    ...cam.lastAnalysis,
                    isFighting: false,
                    severity: 'none',
                    threatCategory: 'none',
                    threatScore: 0,
                    detectedBehaviors: [],
                    fightReason: '',
                    recommendedAction: 'No action needed; zone has returned to calm.',
                    summary:
                      livePeople.length === 0
                        ? 'No people detected in live frame (empty room · Edge AI).'
                        : `${livePeople.length} ${livePeople.length === 1 ? 'person' : 'people'} detected — zone nominal.`,
                    detectedPeople: livePeople,
                    detectedObjects: liveObjects,
                    analyzedAt: new Date().toISOString(),
                  }
                : null,
            };
          })
        );
        return;
      }

      if (!event.analysis) return;

      const threatAnalysis = event.analysis;
      const nextStatus = deriveSafetyStatus(threatAnalysis);

      setCameras((prev) =>
        prev.map((cam) => {
          if (cam.id !== cameraId) return cam;
          const livePeople =
            threatAnalysis.detectedPeople ?? cam.lastAnalysis?.detectedPeople ?? [];
          const liveObjects =
            threatAnalysis.detectedObjects ?? cam.lastAnalysis?.detectedObjects ?? [];
          return {
            ...cam,
            status: nextStatus,
            studentCount: livePeople.length,
            lastAnalysis: {
              ...threatAnalysis,
              studentCount: livePeople.length,
              detectedPeople: livePeople,
              detectedObjects: liveObjects,
            },
          };
        })
      );

      if (event.shouldEmitAlert) {
        const alert = evaluateFightNotification(target, threatAnalysis, facilityMode);
        if (alert) {
          const enriched: IncidentAlert = event.previewDataUrl
            ? { ...alert, evidenceSnapshotUrl: event.previewDataUrl }
            : alert;
          setAlerts((prev) => [enriched, ...prev]);
          setPopupAlerts((prev) =>
            [enriched, ...prev.filter((item) => item.id !== enriched.id)].slice(0, 6)
          );
          void persistIncidentAsync(enriched);
          void sealEvidenceCaseForCamera({
            camera: target,
            triggerType: 'threat',
            threatCategory: enriched.threatCategory ?? 'disturbance',
            severity: enriched.severity === 'critical' ? 'critical' : 'warning',
            headline: enriched.headline,
            summary: enriched.details,
            fallbackSnapshotUrl: event.previewDataUrl,
          });
          if (soundAlertsEnabled) {
            playAlertChime();
          }
          if (desktopNotifications) {
            sendBrowserNotification(enriched);
          }
        }
      }
    },
    [
      desktopNotifications,
      facilityMode,
      persistIncidentAsync,
      sealEvidenceCaseForCamera,
      soundAlertsEnabled,
    ]
  );

  const handlePerimeterBreach = useCallback(
    (
      cameraId: string,
      breachingPeople: DetectedPersonBox[],
      zone: PerimeterZone,
      bundle: DvrBundleSnapshot
    ) => {
      const target = camerasRef.current.find((c) => c.id === cameraId);
      if (!target) return;
      const nowIso = new Date().toISOString();
      const count = breachingPeople.length;
      const headline = `Restricted Perimeter Breach (${zone.label || 'Restricted Zone'})`;
      const details = `${count} ${count === 1 ? 'person' : 'people'} crossed into restricted zone "${zone.label || 'Restricted Zone'}" on ${target.classroomName}. Forensic video & DVR buffer automatically sealed.`;

      setCameras((prev) =>
        prev.map((cam) =>
          cam.id === cameraId
            ? {
                ...cam,
                status: 'fighting',
                lastAnalysis: cam.lastAnalysis
                  ? {
                      ...cam.lastAnalysis,
                      isFighting: true,
                      severity: 'critical',
                      threatCategory: 'intrusion',
                      threatScore: 96,
                      detectedBehaviors: ['Restricted perimeter breach'],
                      fightReason: details,
                      recommendedAction:
                        'Dispatch security immediately and review sealed DVR frames & video clip in Evidence Vault.',
                      summary: headline,
                      analyzedAt: nowIso,
                    }
                  : {
                      studentCount: cam.studentCount,
                      detectedPeople: breachingPeople,
                      detectedObjects: [],
                      isFighting: true,
                      severity: 'critical',
                      threatCategory: 'intrusion',
                      threatScore: 96,
                      detectedBehaviors: ['Restricted perimeter breach'],
                      recommendedAction:
                        'Dispatch security immediately and review sealed DVR frames & video clip in Evidence Vault.',
                      voiceAnalysis: 'Perimeter intrusion alarm active.',
                      fightReason: details,
                      summary: headline,
                      confidence: 96,
                      analyzedAt: nowIso,
                    },
              }
            : cam
        )
      );

      const snapshot = bundle.frames[bundle.frames.length - 1]?.imageDataUrl;
      const breachAlert: IncidentAlert = {
        id: `alert-breach-${Date.now()}-${cameraId}`,
        alertType: 'ai-vision',
        cameraId: target.id,
        cameraCode: target.cameraCode,
        classroomName: target.classroomName,
        timestamp: nowIso,
        severity: 'critical',
        threatCategory: 'intrusion',
        threatScore: 96,
        headline,
        details,
        detectedBehaviors: ['Restricted perimeter breach'],
        recommendedAction:
          'Dispatch security immediately and review sealed DVR frames & video clip in Evidence Vault.',
        voiceCue: target.liveTranscript || 'Perimeter sensor triggered.',
        studentCount: target.studentCount,
        evidenceSnapshotUrl: snapshot,
        acknowledged: false,
      };

      setAlerts((prev) => [breachAlert, ...prev]);
      setPopupAlerts((prev) =>
        [breachAlert, ...prev.filter((item) => item.id !== breachAlert.id)].slice(0, 6)
      );
      void persistIncidentAsync(breachAlert);
      void sealEvidenceCaseForCamera({
        camera: target,
        triggerType: 'perimeter_breach',
        threatCategory: 'intrusion',
        severity: 'critical',
        headline,
        summary: details,
        bundle,
        perimeterZone: zone,
      });

      if (soundAlertsEnabled) {
        playAlertChime();
      }
      if (desktopNotifications) {
        sendBrowserNotification(breachAlert);
      }
    },
    [desktopNotifications, persistIncidentAsync, sealEvidenceCaseForCamera, soundAlertsEnabled]
  );

  const handleManualLockEvidence = useCallback(
    (cameraId: string, bundle: DvrBundleSnapshot) => {
      const target = camerasRef.current.find((c) => c.id === cameraId);
      if (!target) return;
      const frameCount = bundle.frames.length;
      const hasVideoClip = Boolean(bundle.videoClipUrl);
      void sealEvidenceCaseForCamera({
        camera: target,
        triggerType: 'manual_lock',
        threatCategory: target.lastAnalysis?.threatCategory ?? 'none',
        severity: target.status === 'fighting' ? 'critical' : 'info',
        headline: `Manual Forensic Clip · ${target.classroomName}`,
        summary: `Operator saved ${
          hasVideoClip ? 'recorded .webm video clip and ' : ''
        }${frameCount} rolling black-box DVR ${
          frameCount === 1 ? 'frame' : 'frames'
        } from ${target.cameraCode} (${target.classroomName}) with SHA-256 Chain-of-Custody seal.`,
        bundle,
      }).then((sealed) => {
        setSelectedEvidenceId(sealed.id);
        setStatusNotice(
          `Forensic evidence ${sealed.caseNumber} sealed (SHA-256) in Evidence Vault (${sealed.frames.length} frames${
            sealed.videoClipUrl ? ' + .webm video clip' : ''
          }).`
        );
      });
    },
    [sealEvidenceCaseForCamera]
  );

  const handleEnrollLiveSubject = useCallback(
    (
      cameraId: string,
      payload: {
        label: string;
        thumbnailDataUrl: string;
        signature: AppearanceSignature;
      }
    ) => {
      const target = camerasRef.current.find((c) => c.id === cameraId);
      const entry: WatchlistSubject = {
        id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: payload.label,
        enrolledAt: new Date().toISOString(),
        sourceCameraCode: target?.cameraCode ?? 'LIVE',
        thumbnailDataUrl: payload.thumbnailDataUrl,
        signature: payload.signature,
        matchCount: 0,
      };
      setWatchlist((prev) => [entry, ...prev].slice(0, 24));
      setStatusNotice(
        `Watchlist Re-ID armed for "${entry.label}" (${entry.sourceCameraCode}). All cameras will alert automatically if this person appears.`
      );
    },
    []
  );

  const handleEnrollWatchlistPhoto = useCallback((file: File, label: string) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 256;
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(32, Math.round((img.naturalWidth || 160) * scale));
        const h = Math.max(32, Math.round((img.naturalHeight || 160) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const rgba = ctx.getImageData(0, 0, w, h).data;
        const signature = extractAppearanceSignature(rgba, w, h, [0, 0, 1000, 1000]);

        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 160;
        thumbCanvas.height = 160;
        const tCtx = thumbCanvas.getContext('2d');
        let thumbnailDataUrl = '';
        if (tCtx) {
          const srcSide = Math.min(img.naturalWidth || w, img.naturalHeight || h);
          const sx = Math.max(0, Math.round(((img.naturalWidth || w) - srcSide) / 2));
          const sy = Math.max(0, Math.round(((img.naturalHeight || h) - srcSide) / 2));
          tCtx.drawImage(img, sx, sy, srcSide, srcSide, 0, 0, 160, 160);
          thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.82);
        }

        const entry: WatchlistSubject = {
          id: `wl-photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: label.trim() || 'Watchlist Target',
          enrolledAt: new Date().toISOString(),
          sourceCameraCode: 'PHOTO',
          thumbnailDataUrl,
          signature,
          matchCount: 0,
        };
        setWatchlist((prev) => [entry, ...prev].slice(0, 24));
        setStatusNotice(
          `Enrolled "${entry.label}" into Cross-Camera Watchlist Re-ID. Matching active across all cameras.`
        );
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setGlobalError('Could not read reference photo for Watchlist enrollment.');
    };
    img.src = objectUrl;
  }, []);

  const handleRemoveWatchlistSubject = useCallback((id: string) => {
    setWatchlist((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleWatchlistMatch = useCallback(
    (
      cameraId: string,
      payload: {
        watchlistItem: WatchlistSubject;
        subjectId: string;
        similarity: number;
        bundle: DvrBundleSnapshot;
      }
    ) => {
      const target = camerasRef.current.find((c) => c.id === cameraId);
      if (!target) return;
      const nowIso = new Date().toISOString();
      const { watchlistItem, subjectId, similarity, bundle } = payload;

      setWatchlist((prev) =>
        prev.map((item) =>
          item.id === watchlistItem.id
            ? {
                ...item,
                matchCount: item.matchCount + 1,
                lastMatchedAt: nowIso,
                lastMatchedZone: target.classroomName,
              }
            : item
        )
      );

      const headline = `WATCHLIST MATCH · ${watchlistItem.label} (${similarity}%)`;
      const details = `Tracked subject ${subjectId} on ${target.classroomName} (${target.cameraCode}) matched Watchlist target "${watchlistItem.label}" with ${similarity}% spatial appearance Re-ID confidence.`;

      setCameras((prev) =>
        prev.map((cam) =>
          cam.id === cameraId
            ? {
                ...cam,
                status: 'fighting',
                lastAnalysis: cam.lastAnalysis
                  ? {
                      ...cam.lastAnalysis,
                      isFighting: true,
                      severity: 'critical',
                      threatCategory: 'intrusion',
                      threatScore: Math.max(cam.lastAnalysis.threatScore ?? 0, similarity),
                      detectedBehaviors: [
                        `Watchlist Re-ID match: ${watchlistItem.label} (${similarity}%)`,
                      ],
                      fightReason: details,
                      recommendedAction:
                        'Verify matched subject on live feed and review sealed clip in Evidence Vault.',
                      summary: headline,
                      analyzedAt: nowIso,
                    }
                  : {
                      studentCount: Math.max(1, cam.studentCount),
                      detectedPeople: [],
                      detectedObjects: [],
                      isFighting: true,
                      severity: 'critical',
                      threatCategory: 'intrusion',
                      threatScore: similarity,
                      detectedBehaviors: [
                        `Watchlist Re-ID match: ${watchlistItem.label} (${similarity}%)`,
                      ],
                      recommendedAction:
                        'Verify matched subject on live feed and review sealed clip in Evidence Vault.',
                      voiceAnalysis: 'Watchlist Re-ID engine triggered.',
                      fightReason: details,
                      summary: headline,
                      confidence: similarity,
                      analyzedAt: nowIso,
                    },
              }
            : cam
        )
      );

      const snapshot = bundle.frames[bundle.frames.length - 1]?.imageDataUrl;
      const matchAlert: IncidentAlert = {
        id: `alert-wl-${Date.now()}-${cameraId}`,
        alertType: 'ai-vision',
        cameraId: target.id,
        cameraCode: target.cameraCode,
        classroomName: target.classroomName,
        timestamp: nowIso,
        severity: 'critical',
        threatCategory: 'intrusion',
        threatScore: similarity,
        headline,
        details,
        detectedBehaviors: [`Watchlist Re-ID match: ${watchlistItem.label} (${similarity}%)`],
        recommendedAction:
          'Verify matched subject on live feed and review sealed clip in Evidence Vault.',
        voiceCue: target.liveTranscript || 'Cross-camera Re-ID alert.',
        studentCount: target.studentCount,
        evidenceSnapshotUrl: snapshot ?? watchlistItem.thumbnailDataUrl,
        acknowledged: false,
      };

      setAlerts((prev) => [matchAlert, ...prev]);
      setPopupAlerts((prev) =>
        [matchAlert, ...prev.filter((item) => item.id !== matchAlert.id)].slice(0, 6)
      );
      void persistIncidentAsync(matchAlert);
      void sealEvidenceCaseForCamera({
        camera: target,
        triggerType: 'watchlist_match',
        threatCategory: 'intrusion',
        severity: 'critical',
        headline,
        summary: details,
        bundle,
      });

      if (soundAlertsEnabled) {
        playAlertChime();
      }
      if (desktopNotifications) {
        sendBrowserNotification(matchAlert);
      }
    },
    [desktopNotifications, persistIncidentAsync, sealEvidenceCaseForCamera, soundAlertsEnabled]
  );

  const handleDeleteEvidenceCase = useCallback((caseId: string) => {
    setEvidenceCases((prev) => {
      const next = prev.filter((item) => item.id !== caseId);
      setSelectedEvidenceId((current) =>
        current === caseId ? next[0]?.id ?? null : current
      );
      return next;
    });
  }, []);

  const handleUpdateCameraSettings = useCallback(
    (
      cameraId: string,
      patch: Partial<
        Pick<
          ClassroomCamera,
          | 'aiModel'
          | 'autoAiEnabled'
          | 'expectedTotalCount'
          | 'attendanceCheckTime'
          | 'attendanceCheckEnabled'
          | 'linkedCourseId'
          | 'linkedCourseName'
          | 'teacherEmail'
          | 'ptzAutoTrackEnabled'
          | 'trailsEnabled'
          | 'heatmapEnabled'
          | 'perimeterZone'
        >
      >
    ) => {
      setCameras((prev) =>
        prev.map((cam) => (cam.id === cameraId ? { ...cam, ...patch } : cam))
      );
    },
    []
  );

  const handleRunAttendanceCheck = useCallback(
    (cameraId: string, triggeredBySchedule = false) => {
      const target = camerasRef.current.find((c) => c.id === cameraId);
      if (!target) return;

      const now = new Date();
      const dateKey = getLocalDateKey(now);
      const attendance = computeClassAttendance(target.studentCount, target.expectedTotalCount);

      setCameras((prev) =>
        prev.map((cam) =>
          cam.id === cameraId
            ? {
                ...cam,
                lastAttendanceRecord: {
                  dateKey,
                  checkedAt: now.toISOString(),
                  scheduledTime: cam.attendanceCheckTime,
                  presentCount: attendance.presentCount,
                  absentCount: attendance.absentCount,
                  customTotal: attendance.customTotal,
                },
              }
            : cam
        )
      );

      const primaryTeacher = courseTeachersRef.current[0];
      const reportAlert = evaluateAttendanceReportAlert(target, {
        teacherEmail:
          target.teacherEmail || teacherEmailRef.current || primaryTeacher?.email || undefined,
        teacherName: primaryTeacher?.name,
        courseName: target.linkedCourseName || courseNameRef.current || undefined,
        now,
      });

      setAlerts((prev) => [reportAlert, ...prev]);
      setPopupAlerts((prev) => [reportAlert, ...prev.filter((item) => item.id !== reportAlert.id)].slice(0, 6));
      void persistIncidentAsync(reportAlert);
      setStatusNotice(
        `${triggeredBySchedule ? 'Scheduled attendance' : 'Attendance roll call'} recorded for ${target.classroomName}: ${attendance.presentCount} present, ${attendance.absentCount} absent.`
      );
      if (soundAlertsEnabled) {
        playAlertChime();
      }
      if (desktopNotifications) {
        sendBrowserNotification(reportAlert);
      }
    },
    [desktopNotifications, persistIncidentAsync, soundAlertsEnabled]
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      for (const cam of camerasRef.current) {
        if (
          shouldRunScheduledAttendance(
            cam.attendanceCheckTime,
            cam.attendanceCheckEnabled,
            cam.lastAttendanceRecord?.dateKey,
            now
          )
        ) {
          handleRunAttendanceCheck(cam.id, true);
        }
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [handleRunAttendanceCheck]);

  const handleToggleVoiceListening = useCallback((cameraId: string) => {
    setCameras((prev) =>
      prev.map((cam) =>
        cam.id === cameraId
          ? { ...cam, voiceListeningEnabled: !cam.voiceListeningEnabled }
          : cam
      )
    );
  }, []);

  const handleUpdateTranscript = useCallback(
    (cameraId: string, transcript: string, audioLevel?: number) => {
      setCameras((prev) =>
        prev.map((cam) =>
          cam.id === cameraId
            ? {
                ...cam,
                liveTranscript: transcript,
                audioLevel: audioLevel ?? cam.audioLevel,
              }
            : cam
        )
      );

      const target = camerasRef.current.find((c) => c.id === cameraId);
      const nowMs = Date.now();

      // Immediately detect bullying, beating, or fight distress speech cues and pop alert on screen
      if (target && transcript.trim()) {
        const lastVoiceMs = lastVoiceCueAlertAtRef.current[cameraId] ?? 0;
        const effectiveAudio = typeof audioLevel === 'number' ? audioLevel : target.audioLevel;
        const voiceThreatAlert = evaluateVoiceCueThreatAlert(
          target,
          transcript,
          effectiveAudio,
          facilityMode,
          {
            lastAlertAtMs: lastVoiceMs,
            nowMs,
            cooldownMs: 10000,
          }
        );
        if (voiceThreatAlert) {
          lastVoiceCueAlertAtRef.current[cameraId] = nowMs;
          const capture = frameCapturersRef.current[cameraId]?.() ?? null;
          const enrichedVoiceAlert: IncidentAlert = capture?.previewDataUrl
            ? { ...voiceThreatAlert, evidenceSnapshotUrl: capture.previewDataUrl }
            : voiceThreatAlert;

          setCameras((prev) =>
            prev.map((cam) =>
              cam.id === cameraId
                ? {
                    ...cam,
                    status: 'fighting',
                    lastAnalysis: cam.lastAnalysis
                      ? {
                          ...cam.lastAnalysis,
                          isFighting: true,
                          severity: 'critical',
                          threatCategory: voiceThreatAlert.threatCategory,
                          threatScore: voiceThreatAlert.threatScore,
                          voiceAnalysis: voiceThreatAlert.voiceCue,
                          fightReason: voiceThreatAlert.details,
                          summary: voiceThreatAlert.headline,
                        }
                      : {
                          studentCount: cam.studentCount,
                          detectedPeople: [],
                          detectedObjects: [],
                          isFighting: true,
                          severity: 'critical',
                          threatCategory: voiceThreatAlert.threatCategory,
                          threatScore: voiceThreatAlert.threatScore,
                          detectedBehaviors: voiceThreatAlert.detectedBehaviors,
                          recommendedAction: voiceThreatAlert.recommendedAction,
                          voiceAnalysis: voiceThreatAlert.voiceCue,
                          fightReason: voiceThreatAlert.details,
                          summary: voiceThreatAlert.headline,
                          confidence: 92,
                          analyzedAt: voiceThreatAlert.timestamp,
                        },
                  }
                : cam
            )
          );
          setAlerts((prev) => [enrichedVoiceAlert, ...prev]);
          setPopupAlerts((prev) =>
            [enrichedVoiceAlert, ...prev.filter((item) => item.id !== enrichedVoiceAlert.id)].slice(0, 6)
          );
          void persistIncidentAsync(enrichedVoiceAlert);
          void sealEvidenceCaseForCamera({
            camera: target,
            triggerType: 'threat',
            threatCategory: enrichedVoiceAlert.threatCategory ?? 'disturbance',
            severity: 'critical',
            headline: enrichedVoiceAlert.headline,
            summary: enrichedVoiceAlert.details,
            fallbackSnapshotUrl: capture?.previewDataUrl,
          });
          if (soundAlertsEnabled) {
            playAlertChime();
          }
          if (desktopNotifications) {
            sendBrowserNotification(enrichedVoiceAlert);
          }
        }
      }

      if (typeof audioLevel === 'number') {
        // Trigger urgent teacher sound alert ONLY when sound stays strictly > 90.1 dB for > 3 seconds
        if (target && target.voiceListeningEnabled) {
          const sustained = evaluateSustainedSoundDuration(
            loudHoldStartByCamRef.current[cameraId] ?? null,
            audioLevel,
            nowMs,
            SOUND_ALERT_THRESHOLD_DB,
            SOUND_ALERT_SUSTAINED_MS
          );
          loudHoldStartByCamRef.current[cameraId] = sustained.nextStartMs;

          if (sustained.triggered) {
            const lastDbMs = lastDbAlertAtRef.current[cameraId] ?? 0;
            const primaryTeacher = courseTeachersRef.current[0];
            const dbAlert = evaluateSoundThresholdAlert(target, audioLevel, {
              thresholdDb: SOUND_ALERT_THRESHOLD_DB,
              sustainedSeconds: sustained.sustainedMs / 1000,
              teacherEmail:
                target.teacherEmail || teacherEmailRef.current || primaryTeacher?.email || undefined,
              teacherName: primaryTeacher?.name,
              courseName: target.linkedCourseName || courseNameRef.current || undefined,
              lastAlertAtMs: lastDbMs,
              nowMs,
              liveTranscript: transcript,
            });
            if (dbAlert) {
              lastDbAlertAtRef.current[cameraId] = nowMs;
              loudHoldStartByCamRef.current[cameraId] = null;
              setAlerts((prev) => [dbAlert, ...prev]);
              setPopupAlerts((prev) => [dbAlert, ...prev.filter((item) => item.id !== dbAlert.id)].slice(0, 6));
              void persistIncidentAsync(dbAlert);
              void sealEvidenceCaseForCamera({
                camera: target,
                triggerType: 'sound_threshold',
                threatCategory: 'disturbance',
                severity: 'critical',
                headline: dbAlert.headline,
                summary: dbAlert.details,
              });
              if (soundAlertsEnabled) {
                playAlertChime();
              }
              if (desktopNotifications) {
                sendBrowserNotification(dbAlert);
              }
            }
          }
        }

        if (audioSpikeAutoScan) {
          const lastMs = lastSpikeScanAtRef.current[cameraId] ?? 0;
          if (
            target &&
            target.voiceListeningEnabled &&
            shouldTriggerAudioSpikeScan(audioLevel, lastMs, nowMs, target.isAnalyzing)
          ) {
            lastSpikeScanAtRef.current[cameraId] = nowMs;
            void analyzeCamera(cameraId, { audioSpikeDetected: true });
          }
        }
      }
    },
    [
      analyzeCamera,
      audioSpikeAutoScan,
      desktopNotifications,
      facilityMode,
      persistIncidentAsync,
      sealEvidenceCaseForCamera,
      soundAlertsEnabled,
    ]
  );

  const handleReconnectStream = useCallback(async (cameraId: string) => {
    const target = camerasRef.current.find((c) => c.id === cameraId);
    if (!target) return;
    const isMicOnly = target.sourceKind === 'microphone-only' || !target.hasVideo;
    try {
      const stream = await openRawMediaStream({
        includeVideo: !isMicOnly,
        videoDeviceId: isMicOnly ? undefined : target.videoDeviceId,
        audioDeviceId: target.audioDeviceId,
      });
      mediaStreamsRef.current[cameraId] = stream;
      setStreamRevision((v) => v + 1);
      setStatusNotice(
        isMicOnly
          ? `Live microphone connected for "${target.classroomName}".`
          : `Live camera reconnected for "${target.classroomName}".`
      );
    } catch {
      setGlobalError(
        isMicOnly
          ? `Unable to access microphone for ${target.classroomName}. Allow browser mic permissions and retry.`
          : `Unable to reconnect camera stream for ${target.classroomName}.`
      );
    }
  }, []);

  const handleAddBluetoothCamera = useCallback(
    (
      device: BluetoothDeviceCandidate,
      classroomName: string,
      options: { streamUrl?: string; videoDeviceId?: string; audioDeviceId?: string; stream?: MediaStream }
    ) => {
      const newCamId = `cam-bt-${Date.now()}`;
      if (options.stream) {
        mediaStreamsRef.current[newCamId] = options.stream;
      }

      const newCamera: ClassroomCamera = {
        id: newCamId,
        cameraCode: `CAM-${camerasRef.current.length + 1}`,
        classroomName,
        bluetoothDeviceName: device.name,
        bluetoothAddress: device.macAddress,
        sourceKind: 'bluetooth-cctv',
        hasVideo: true,
        hasVoice: true,
        voiceListeningEnabled: true,
        autoAiEnabled: true,
        aiModel: selectedAiModel,
        videoDeviceId: options.videoDeviceId,
        audioDeviceId: options.audioDeviceId,
        streamUrl: options.streamUrl,
        liveTranscript: '',
        audioLevel: 0,
        status: 'normal',
        studentCount: 0,
        lastAnalysis: null,
        isAnalyzing: false,
      };

      setCameras((prev) => [...prev, newCamera]);
      void persistZoneAsync(newCamera);
      setActiveView('grid');
      setIsScannerOpen(false);
    },
    [persistZoneAsync, selectedAiModel]
  );

  const handleAddHardwareCamera = useCallback(
    (
      classroomName: string,
      stream: MediaStream,
      videoDeviceId?: string,
      audioDeviceId?: string,
      deviceLabel?: string
    ) => {
      const newCamId = `cam-hw-${Date.now()}`;
      mediaStreamsRef.current[newCamId] = stream;
      const newCamera: ClassroomCamera = {
        id: newCamId,
        cameraCode: `CAM-${camerasRef.current.length + 1}`,
        classroomName,
        bluetoothDeviceName: deviceLabel || 'Hardware Camera',
        bluetoothAddress: videoDeviceId ? videoDeviceId.slice(0, 12) : 'LOCAL-AV',
        sourceKind: 'device-camera',
        hasVideo: true,
        hasVoice: true,
        voiceListeningEnabled: true,
        autoAiEnabled: true,
        aiModel: selectedAiModel,
        videoDeviceId,
        audioDeviceId,
        liveTranscript: '',
        audioLevel: 0,
        status: 'normal',
        studentCount: 0,
        lastAnalysis: null,
        isAnalyzing: false,
      };

      setCameras((prev) => [...prev, newCamera]);
      void persistZoneAsync(newCamera);
      setActiveView('grid');
    },
    [persistZoneAsync, selectedAiModel]
  );

  const handleAddMicrophoneZone = useCallback(
    (
      classroomName: string,
      stream: MediaStream | null,
      audioDeviceId?: string,
      deviceLabel?: string
    ) => {
      const newZoneId = `mic-${Date.now()}`;
      if (stream) {
        mediaStreamsRef.current[newZoneId] = stream;
        setStreamRevision((v) => v + 1);
      }

      const micCount =
        camerasRef.current.filter((c) => c.sourceKind === 'microphone-only').length + 1;
      const newZone: ClassroomCamera = {
        id: newZoneId,
        cameraCode: `MIC-${micCount}`,
        classroomName,
        bluetoothDeviceName: deviceLabel || 'Acoustic Microphone',
        bluetoothAddress: audioDeviceId ? audioDeviceId.slice(0, 12) : 'AUDIO-MIC',
        sourceKind: 'microphone-only',
        hasVideo: false,
        hasVoice: true,
        voiceListeningEnabled: true,
        autoAiEnabled: true,
        aiModel: selectedAiModel,
        audioDeviceId,
        liveTranscript: '',
        audioLevel: 0,
        status: 'normal',
        studentCount: 0,
        lastAnalysis: null,
        isAnalyzing: false,
      };

      setCameras((prev) => [...prev, newZone]);
      void persistZoneAsync(newZone);
      setActiveView('grid');
      setStatusNotice(
        stream
          ? `Live microphone monitor "${classroomName}" is armed (>90.1 dB & distress voice AI).`
          : `Microphone-only zone "${classroomName}" added in standby mode.`
      );
    },
    [persistZoneAsync, selectedAiModel]
  );

  const handleAddWifiCamera = useCallback(
    (params: {
      classroomName: string;
      streamUrl?: string;
      wifiBrand: string;
      wifiDirectMode: boolean;
      stream?: MediaStream;
      videoDeviceId?: string;
      audioDeviceId?: string;
    }) => {
      const newCamId = `cam-wifi-${Date.now()}`;
      if (params.stream) {
        mediaStreamsRef.current[newCamId] = params.stream;
      }

      let hostAddress = params.stream ? 'WIFI-BRIDGE' : 'WIFI-CCTV';
      if (params.streamUrl) {
        try {
          hostAddress = new URL(params.streamUrl).hostname || 'WIFI-CCTV';
        } catch {
          hostAddress = 'WIFI-CCTV';
        }
      }

      const newCamera: ClassroomCamera = {
        id: newCamId,
        cameraCode: `CAM-${camerasRef.current.length + 1}`,
        classroomName: params.classroomName,
        bluetoothDeviceName: params.wifiBrand || 'Wi-Fi CCTV',
        bluetoothAddress: hostAddress,
        sourceKind: 'wifi-cctv',
        wifiBrand: params.wifiBrand,
        wifiDirectMode: params.wifiDirectMode,
        hasVideo: true,
        hasVoice: true,
        voiceListeningEnabled: true,
        autoAiEnabled: true,
        aiModel: selectedAiModel,
        streamUrl: params.streamUrl,
        videoDeviceId: params.videoDeviceId,
        audioDeviceId: params.audioDeviceId,
        liveTranscript: '',
        audioLevel: 0,
        status: 'normal',
        studentCount: 0,
        lastAnalysis: null,
        isAnalyzing: false,
      };

      setCameras((prev) => [...prev, newCamera]);
      void persistZoneAsync(newCamera);
      setActiveView('grid');
      setStatusNotice(
        `Wi-Fi CCTV camera "${params.classroomName}" (${params.wifiBrand}) connected via computer Wi-Fi (no PIN required).`
      );
    },
    [persistZoneAsync, selectedAiModel]
  );

  const handleAddStreamUrlCamera = useCallback(
    (classroomName: string, streamUrl: string) => {
      const newCamId = `cam-url-${Date.now()}`;
      const newCamera: ClassroomCamera = {
        id: newCamId,
        cameraCode: `CAM-${camerasRef.current.length + 1}`,
        classroomName,
        bluetoothDeviceName: 'IP Snapshot / MJPEG',
        bluetoothAddress: new URL(streamUrl).hostname,
        sourceKind: 'stream-url',
        hasVideo: true,
        hasVoice: true,
        voiceListeningEnabled: true,
        autoAiEnabled: true,
        aiModel: selectedAiModel,
        streamUrl,
        liveTranscript: '',
        audioLevel: 0,
        status: 'normal',
        studentCount: 0,
        lastAnalysis: null,
        isAnalyzing: false,
      };

      setCameras((prev) => [...prev, newCamera]);
      void persistZoneAsync(newCamera);
      setActiveView('grid');
    },
    [persistZoneAsync, selectedAiModel]
  );

  const handleAddUploadedCamera = useCallback(
    (
      classroomName: string,
      mediaUrl: string,
      mediaType: 'image' | 'video',
      voiceTranscript: string
    ) => {
      const newCamId = `cam-upload-${Date.now()}`;
      const newCamera: ClassroomCamera = {
        id: newCamId,
        cameraCode: `CAM-${camerasRef.current.length + 1}`,
        classroomName,
        bluetoothDeviceName: 'Uploaded Media',
        bluetoothAddress: 'LOCAL-FILE',
        sourceKind: 'uploaded-media',
        hasVideo: true,
        hasVoice: true,
        voiceListeningEnabled: true,
        autoAiEnabled: true,
        aiModel: selectedAiModel,
        customMediaUrl: mediaUrl,
        customMediaType: mediaType,
        liveTranscript: voiceTranscript,
        audioLevel: 0,
        status: 'normal',
        studentCount: 0,
        lastAnalysis: null,
        isAnalyzing: false,
      };

      setCameras((prev) => [...prev, newCamera]);
      setActiveView('grid');
    },
    [selectedAiModel]
  );

  const handleRemoveCamera = useCallback((cameraId: string) => {
    const stream = mediaStreamsRef.current[cameraId];
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      delete mediaStreamsRef.current[cameraId];
    }
    delete dvrProvidersRef.current[cameraId];
    setCameras((prev) => prev.filter((c) => c.id !== cameraId));
    setFocusedCameraId((prev) => (prev === cameraId ? null : prev));

    const user = currentUserRef.current;
    if (user) {
      void deleteZoneFromFirestore(user.uid, cameraId).catch(() => {});
      void getFirebaseIdToken().then((idToken) => {
        if (!idToken) return;
        return fetch(`/api/zones/${encodeURIComponent(cameraId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` },
        });
      });
    }
  }, []);

  const handleAcknowledgeAlert = useCallback((alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
    );
    setPopupAlerts((prev) => prev.filter((a) => a.id !== alertId));
    const user = currentUserRef.current;
    if (user) {
      void updateIncidentInFirestore(user.uid, alertId, { acknowledged: true }).catch(() => {});
      void getFirebaseIdToken().then((idToken) => {
        if (!idToken) return;
        return fetch(`/api/incidents/${encodeURIComponent(alertId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ acknowledged: true }),
        });
      });
    }
  }, []);

  const handleAcknowledgeAll = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
    setPopupAlerts([]);
    void getFirebaseIdToken().then((idToken) => {
      if (!idToken) return;
      return fetch('/api/incidents/acknowledge-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
    });
  }, []);

  const handleClearAcknowledged = useCallback(() => {
    setAlerts((prev) => prev.filter((a) => !a.acknowledged));
    void getFirebaseIdToken().then((idToken) => {
      if (!idToken) return;
      return fetch('/api/incidents/acknowledged', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
    });
  }, []);

  const markTeacherNotified = useCallback((alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, teacherNotified: true } : a))
    );
    setPopupAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, teacherNotified: true } : a))
    );
    const user = currentUserRef.current;
    if (user) {
      void updateIncidentInFirestore(user.uid, alertId, { teacherNotified: true }).catch(() => {});
      void getFirebaseIdToken().then((idToken) => {
        if (!idToken) return;
        return fetch(`/api/incidents/${encodeURIComponent(alertId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ teacherNotified: true }),
        });
      });
    }
  }, []);

  const handleConfirmSendGmail = useCallback(
    async (params: { alertId: string; to: string; subject: string; body: string }) => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Sign in with Google first to send emails via Gmail.');
      }
      await sendTeacherGmailAlert(token, {
        to: params.to,
        subject: params.subject,
        body: params.body,
      });
      markTeacherNotified(params.alertId);
      setStatusNotice(`Teacher alert email sent via Gmail to ${params.to}.`);
    },
    [markTeacherNotified]
  );

  const handleConfirmPostClassroom = useCallback(
    async (params: { alertId: string; courseId: string; text: string }) => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Sign in with Google first to post to Google Classroom.');
      }
      await postClassroomAnnouncement(token, params.courseId, params.text);
      markTeacherNotified(params.alertId);
      setStatusNotice('Alert announcement posted to Google Classroom.');
    },
    [markTeacherNotified]
  );

  const handleSaveTeacherEmail = useCallback(
    (email: string) => {
      setDefaultTeacherEmail(email);
      const user = currentUserRef.current;
      if (user) {
        void syncUserProfileToFirestore(user, {
          defaultTeacherEmail: email,
          linkedCourseId: linkedCourseId || undefined,
          linkedCourseName: linkedCourseName || undefined,
          facilityMode,
        }).catch(() => {});
        void getFirebaseIdToken().then((idToken) => {
          if (!idToken) return;
          return fetch('/api/user/preferences', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ defaultTeacherEmail: email }),
          });
        });
      }
    },
    [facilityMode, linkedCourseId, linkedCourseName]
  );

  const handleSelectCourse = useCallback(
    async (course: WorkspaceCourse) => {
      setLinkedCourseId(course.id);
      setLinkedCourseName(course.name);
      const token = await getAccessToken();
      if (token) {
        const roster = await fetchCourseRosterInfo(token, course.id).catch(() => ({
          teachers: [],
          studentCount: 0,
        }));
        setCourseTeachers(roster.teachers);
        setCourseStudentCount(roster.studentCount);
      }
      const user = currentUserRef.current;
      if (user) {
        void getFirebaseIdToken().then((idToken) => {
          if (!idToken) return;
          return fetch('/api/user/preferences', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              linkedCourseId: course.id,
              linkedCourseName: course.name,
            }),
          });
        });
      }
    },
    []
  );

  const handleToggleDesktopNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (desktopNotifications) {
      setDesktopNotifications(false);
      return;
    }
    if (Notification.permission === 'granted') {
      setNotificationPermission('granted');
      setDesktopNotifications(true);
      return;
    }
    const result = await Notification.requestPermission();
    setNotificationPermission(result);
    setDesktopNotifications(result === 'granted');
  };

  const handleFocusFromAlert = (cameraId: string) => {
    setActiveView('grid');
    setFocusedCameraId(cameraId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const focusedCamera = useMemo(
    () => (focusedCameraId ? cameras.find((c) => c.id === focusedCameraId) ?? null : null),
    [cameras, focusedCameraId]
  );

  const otherCameras = useMemo(
    () => (focusedCamera ? cameras.filter((c) => c.id !== focusedCamera.id) : []),
    [cameras, focusedCamera]
  );

  const hasCriticalCameraOrAlert =
    cameras.some((c) => c.status === 'fighting') ||
    summary.fightingRoomsCount > 0 ||
    alerts.some((a) => !a.acknowledged && a.severity === 'critical');
  const hasWarningCameraOrAlert =
    cameras.some((c) => c.status === 'warning') ||
    alerts.some((a) => !a.acknowledged && a.severity === 'warning');

  const threatStatusLabel = hasCriticalCameraOrAlert
    ? 'CRITICAL'
    : hasWarningCameraOrAlert
      ? 'WARNING'
      : 'NOMINAL';
  const threatStatusTone = hasCriticalCameraOrAlert
    ? 'text-red-400'
    : hasWarningCameraOrAlert
      ? 'text-amber-400'
      : 'text-emerald-400';

  const wallGridClass =
    wallLayout === '1x1' || (cameras.length === 1 && wallLayout === '2x2')
      ? 'grid-cols-1'
      : wallLayout === '3x3'
        ? 'grid-cols-1 md:grid-cols-2 2xl:grid-cols-3'
        : 'grid-cols-1 md:grid-cols-2';

  return (
    <div id="top" className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        unreadAlertsCount={summary.activeAlertsCount}
        evidenceCount={evidenceCases.length}
        onOpenScanner={() => openScannerOnTab('wifi')}
      />
      <OfflineBanner />

      <div className="flex flex-1 min-w-0">
        <Sidebar
          cameras={cameras}
          summary={summary}
          facilityMode={facilityMode}
          onChangeFacilityMode={setFacilityMode}
          threatSensitivity={threatSensitivity}
          onChangeThreatSensitivity={setThreatSensitivity}
          focusedCameraId={focusedCameraId}
          onFocusCamera={(id) => {
            setActiveView('grid');
            setFocusedCameraId(id);
          }}
          desktopNotifications={desktopNotifications}
          notificationPermission={notificationPermission}
          onToggleDesktopNotifications={() => {
            void handleToggleDesktopNotifications();
          }}
          soundAlertsEnabled={soundAlertsEnabled}
          onToggleSoundAlerts={() => setSoundAlertsEnabled((prev) => !prev)}
          audioSpikeAutoScan={audioSpikeAutoScan}
          onToggleAudioSpikeAutoScan={() => setAudioSpikeAutoScan((prev) => !prev)}
          selectedAiModel={selectedAiModel}
          onChangeAiModel={setSelectedAiModel}
          dbCalibrationOffset={dbCalibrationOffset}
          onChangeDbCalibrationOffset={setDbCalibrationOffset}
          userEmail={currentUser?.email ?? null}
          userDisplayName={currentUser?.displayName ?? null}
          isSigningIn={isSigningIn}
          onGoogleSignIn={() => {
            void handleGoogleSignIn();
          }}
          onSignOut={() => {
            void handleSignOut();
          }}
          watchlist={watchlist}
          onEnrollWatchlistPhoto={handleEnrollWatchlistPhoto}
          onRemoveWatchlistSubject={handleRemoveWatchlistSubject}
          onStatusNotice={setStatusNotice}
        />

        {activeView === 'grid' ? (
          <div className="flex-1 min-w-0 flex flex-col xl:flex-row">
            {/* Center Surveillance Stage */}
            <main className="flex-1 min-w-0 flex flex-col">
              {/* Operational Telemetry Ribbon */}
              <div
                data-testid="telemetry-ribbon"
                className="bg-[#101114] border-b border-zinc-800/90 px-4 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] text-zinc-500">Occupancy</span>
                    <span
                      className="text-sm font-mono font-semibold tabular-nums text-zinc-100"
                      data-testid="telemetry-occupancy"
                    >
                      {summary.totalKidsCount}
                    </span>
                  </div>
                  <span className="hidden sm:inline-block h-3.5 w-px bg-zinc-800" aria-hidden="true" />
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] text-zinc-500">Active Feeds</span>
                    <span className="text-sm font-mono font-semibold tabular-nums text-zinc-100">
                      {summary.totalCameras}
                    </span>
                  </div>
                  <span className="hidden sm:inline-block h-3.5 w-px bg-zinc-800" aria-hidden="true" />
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] text-zinc-500">Status</span>
                    <span className={`text-xs font-mono font-semibold tracking-wider ${threatStatusTone}`}>
                      {threatStatusLabel}
                    </span>
                  </div>
                  <span className="hidden sm:inline-block h-3.5 w-px bg-zinc-800" aria-hidden="true" />
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] text-zinc-500">Open Alerts</span>
                    <span
                      className={`text-sm font-mono font-semibold tabular-nums ${
                        summary.activeAlertsCount > 0 ? 'text-red-400' : 'text-zinc-300'
                      }`}
                    >
                      {summary.activeAlertsCount}
                    </span>
                  </div>
                </div>

                {/* Right Controls: Mobile selectors + Wall Layout Switcher */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
                  <select
                    aria-label="Select facility mode"
                    value={facilityMode}
                    onChange={(e) => setFacilityMode(e.target.value as FacilityMode)}
                    className="lg:hidden text-xs bg-[#09090B] border border-zinc-800 rounded-md px-2 py-1 text-zinc-200"
                  >
                    <option value="all">All Sectors</option>
                    <option value="bank">Bank &amp; Vault</option>
                    <option value="school">School &amp; Class</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setThreatSensitivity((prev) => (prev === 'standard' ? 'high' : 'standard'))
                    }
                    className="lg:hidden text-xs bg-[#09090B] border border-zinc-800 rounded-md px-2 py-1 text-zinc-300 cursor-pointer"
                  >
                    AI: {threatSensitivity === 'high' ? 'High' : 'Std'}
                  </button>
                  <AppDownloadControls compact onStatusNotice={setStatusNotice} />

                  {focusedCamera ? (
                    <button
                      type="button"
                      onClick={() => setFocusedCameraId(null)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-zinc-800 bg-[#16181D] text-zinc-200 hover:bg-zinc-800 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>All Feeds ({cameras.length})</span>
                    </button>
                  ) : (
                    <div
                      role="group"
                      aria-label="Monitor wall layout"
                      className="inline-flex items-center bg-[#09090B] border border-zinc-800 rounded-md p-0.5"
                    >
                      {(
                        [
                          { id: '1x1', label: '1x1', icon: Square },
                          { id: '2x2', label: '2x2', icon: Columns2 },
                          { id: '3x3', label: '3x3', icon: Grid3X3 },
                        ] as const
                      ).map((opt) => {
                        const Icon = opt.icon;
                        const active = wallLayout === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            aria-label={`${opt.label} grid layout`}
                            onClick={() => setWallLayout(opt.id)}
                            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-mono rounded transition-colors cursor-pointer ${
                              active
                                ? 'bg-zinc-800 text-zinc-100 font-semibold'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            <Icon className="w-3 h-3" aria-hidden="true" />
                            <span className="hidden sm:inline">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Center Stage Workspace */}
              <div className="flex-1 p-4 sm:p-5 space-y-4 min-w-0">
                <NotificationBanner
                  alert={latestUnacknowledgedAlert}
                  onInspectCamera={handleFocusFromAlert}
                  onNotifyTeacher={(alert) => setDispatchAlert(alert)}
                  onAcknowledge={handleAcknowledgeAlert}
                />

                {statusNotice ? (
                  <div
                    role="status"
                    className="bg-emerald-950/50 border border-emerald-800/70 text-emerald-100 rounded-lg px-4 py-2.5 text-xs flex items-center justify-between gap-4"
                  >
                    <span>{statusNotice}</span>
                    <button
                      type="button"
                      onClick={() => setStatusNotice(null)}
                      className="text-xs font-semibold text-emerald-300 hover:underline cursor-pointer shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}

                {globalError ? (
                  <div
                    role="alert"
                    className="bg-amber-950/50 border border-amber-800/70 text-amber-100 rounded-lg px-4 py-2.5 text-xs flex items-center justify-between gap-4"
                  >
                    <span>{globalError}</span>
                    <button
                      type="button"
                      onClick={() => setGlobalError(null)}
                      className="text-xs font-semibold text-amber-300 hover:underline cursor-pointer shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}

                {cameras.length === 0 ? (
                  <section
                    aria-label="Standby surveillance wall"
                    data-testid="empty-cameras-state"
                    className="relative bg-[#0E0F12] border border-zinc-800/90 rounded-lg overflow-hidden p-6 sm:p-8 flex flex-col justify-between min-h-[440px]"
                  >
                    {/* Viewfinder corner reticles */}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-3 left-3 w-4 h-4 border-t border-l border-zinc-700"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t border-r border-zinc-700"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b border-l border-zinc-700"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-3 right-3 w-4 h-4 border-b border-r border-zinc-700"
                    />

                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
                      <span>CH-00 · STANDBY</span>
                      <span>
                        EDGE AI ARMED · {threatSensitivity === 'high' ? 'HIGH' : 'STANDARD'} · &gt;
                        {SOUND_ALERT_THRESHOLD_DB.toFixed(1)} dB
                      </span>
                    </div>

                    <div className="my-auto py-8 max-w-2xl mx-auto text-center space-y-3">
                      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-100">
                        {labels.monitorTitle}
                      </h1>
                      <p className="text-sm text-zinc-400 leading-relaxed max-w-xl mx-auto">
                        Select a camera source to bring the surveillance wall online. Real-time on-device vision tracks people through face occlusion while filtering normal movement to prevent false fight alarms.
                      </p>

                      {/* 5 Direct Quick-Connect Source Tiles */}
                      <div className="pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-left">
                        <button
                          type="button"
                          onClick={() => openScannerOnTab('wifi')}
                          className="group bg-[#14161B] hover:bg-[#1A1D24] border border-zinc-800 hover:border-zinc-600 rounded-lg p-3.5 transition-colors cursor-pointer flex flex-col gap-2"
                        >
                          <Wifi className="w-4 h-4 text-zinc-100" aria-hidden="true" />
                          <div>
                            <div className="text-xs font-semibold text-zinc-100">Wi-Fi CCTV</div>
                            <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                              Auto-scan computer Wi-Fi · No PIN needed
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => openScannerOnTab('hardware')}
                          className="group bg-[#14161B] hover:bg-[#1A1D24] border border-zinc-800 hover:border-zinc-600 rounded-lg p-3.5 transition-colors cursor-pointer flex flex-col gap-2"
                        >
                          <Camera className="w-4 h-4 text-zinc-100" aria-hidden="true" />
                          <div>
                            <div className="text-xs font-semibold text-zinc-100">Wired (HDMI / USB-C)</div>
                            <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                              Scan HDMI capture, Type-C, SDI/BNC &amp; USB cams
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => openScannerOnTab('microphone')}
                          className="group bg-[#14161B] hover:bg-[#1A1D24] border border-zinc-800 hover:border-zinc-600 rounded-lg p-3.5 transition-colors cursor-pointer flex flex-col gap-2"
                        >
                          <Mic className="w-4 h-4 text-zinc-100" aria-hidden="true" />
                          <div>
                            <div className="text-xs font-semibold text-zinc-100">Mic Only</div>
                            <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                              Audio-only dB &amp; voice distress monitor
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => openScannerOnTab('bluetooth')}
                          className="group bg-[#14161B] hover:bg-[#1A1D24] border border-zinc-800 hover:border-zinc-600 rounded-lg p-3.5 transition-colors cursor-pointer flex flex-col gap-2"
                        >
                          <Bluetooth className="w-4 h-4 text-zinc-100" aria-hidden="true" />
                          <div>
                            <div className="text-xs font-semibold text-zinc-100">Bluetooth CCTV</div>
                            <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                              Pair Bluetooth camera or mic hardware
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => openScannerOnTab('upload')}
                          className="group bg-[#14161B] hover:bg-[#1A1D24] border border-zinc-800 hover:border-zinc-600 rounded-lg p-3.5 transition-colors cursor-pointer flex flex-col gap-2"
                        >
                          <Upload className="w-4 h-4 text-zinc-100" aria-hidden="true" />
                          <div>
                            <div className="text-xs font-semibold text-zinc-100">Upload Clip</div>
                            <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                              Test recorded CCTV video or photo frame
                            </div>
                          </div>
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 text-[11px] font-mono text-zinc-600 min-w-0">
                      <span className="truncate">{labels.sectorDescription}</span>
                      <span className="shrink-0">READY</span>
                    </div>
                  </section>
                ) : focusedCamera ? (
                  <div className="space-y-4" data-testid="dedicated-camera-space">
                    <CameraFeedCard
                      key={focusedCamera.id}
                      camera={focusedCamera}
                      facilityMode={facilityMode}
                      threatSensitivity={threatSensitivity}
                      defaultAiModel={selectedAiModel}
                      dbCalibrationOffset={dbCalibrationOffset}
                      cloudQuotaExhausted={cloudQuotaExhausted}
                      isFocused
                      liveMediaStream={mediaStreamsRef.current[focusedCamera.id] ?? null}
                      watchlist={watchlist}
                      onRegisterCapture={registerCapture}
                      onRegisterDvrProvider={registerDvrProvider}
                      onLocalPersonDetections={handleLocalPersonDetections}
                      onRealtimeEdgeThreat={handleRealtimeEdgeThreat}
                      onPerimeterBreach={handlePerimeterBreach}
                      onManualLockEvidence={handleManualLockEvidence}
                      onEnrollLiveSubject={handleEnrollLiveSubject}
                      onWatchlistMatch={handleWatchlistMatch}
                      onReconnectStream={(id) => {
                        void handleReconnectStream(id);
                      }}
                      onAnalyzeCamera={(id, isAutoTrigger) => {
                        void analyzeCamera(id, { isAutoTrigger });
                      }}
                      onToggleVoiceListening={handleToggleVoiceListening}
                      onUpdateTranscript={handleUpdateTranscript}
                      onUpdateCameraSettings={handleUpdateCameraSettings}
                      onToggleFocus={(id) => {
                        setFocusedCameraId((prev) => (prev === id ? null : id));
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      onRemoveCamera={handleRemoveCamera}
                    />

                    {otherCameras.length > 0 ? (
                      <section aria-label="Other active camera feeds" className="space-y-2.5">
                        <h2 className="text-xs font-medium text-zinc-400">
                          Other Active {labels.zonePlural} ({otherCameras.length})
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {otherCameras.map((cam) => (
                            <CameraFeedCard
                              key={cam.id}
                              camera={cam}
                              facilityMode={facilityMode}
                              threatSensitivity={threatSensitivity}
                              defaultAiModel={selectedAiModel}
                              dbCalibrationOffset={dbCalibrationOffset}
                              cloudQuotaExhausted={cloudQuotaExhausted}
                              isFocused={false}
                              liveMediaStream={mediaStreamsRef.current[cam.id] ?? null}
                              watchlist={watchlist}
                              onRegisterCapture={registerCapture}
                              onRegisterDvrProvider={registerDvrProvider}
                              onLocalPersonDetections={handleLocalPersonDetections}
                              onRealtimeEdgeThreat={handleRealtimeEdgeThreat}
                              onPerimeterBreach={handlePerimeterBreach}
                              onManualLockEvidence={handleManualLockEvidence}
                              onEnrollLiveSubject={handleEnrollLiveSubject}
                              onWatchlistMatch={handleWatchlistMatch}
                              onReconnectStream={(id) => {
                                void handleReconnectStream(id);
                              }}
                              onAnalyzeCamera={(id, isAutoTrigger) => {
                                void analyzeCamera(id, { isAutoTrigger });
                              }}
                              onToggleVoiceListening={handleToggleVoiceListening}
                              onUpdateTranscript={handleUpdateTranscript}
                              onUpdateCameraSettings={handleUpdateCameraSettings}
                              onToggleFocus={(id) => {
                                setFocusedCameraId((prev) => (prev === id ? null : id));
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              onRemoveCamera={handleRemoveCamera}
                            />
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </div>
                ) : (
                  <div
                    data-testid="camera-grid"
                    className={`grid ${wallGridClass} gap-4`}
                  >
                    {cameras.map((cam) => (
                      <CameraFeedCard
                        key={cam.id}
                        camera={cam}
                        facilityMode={facilityMode}
                        threatSensitivity={threatSensitivity}
                        defaultAiModel={selectedAiModel}
                        dbCalibrationOffset={dbCalibrationOffset}
                        cloudQuotaExhausted={cloudQuotaExhausted}
                        isFocused={false}
                        liveMediaStream={mediaStreamsRef.current[cam.id] ?? null}
                        watchlist={watchlist}
                        onRegisterCapture={registerCapture}
                        onRegisterDvrProvider={registerDvrProvider}
                        onLocalPersonDetections={handleLocalPersonDetections}
                        onRealtimeEdgeThreat={handleRealtimeEdgeThreat}
                        onPerimeterBreach={handlePerimeterBreach}
                        onManualLockEvidence={handleManualLockEvidence}
                        onEnrollLiveSubject={handleEnrollLiveSubject}
                        onWatchlistMatch={handleWatchlistMatch}
                        onReconnectStream={(id) => {
                          void handleReconnectStream(id);
                        }}
                        onAnalyzeCamera={(id, isAutoTrigger) => {
                          void analyzeCamera(id, { isAutoTrigger });
                        }}
                        onToggleVoiceListening={handleToggleVoiceListening}
                        onUpdateTranscript={handleUpdateTranscript}
                        onUpdateCameraSettings={handleUpdateCameraSettings}
                        onToggleFocus={(id) => {
                          setFocusedCameraId((prev) => (prev === id ? null : id));
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        onRemoveCamera={handleRemoveCamera}
                      />
                    ))}
                  </div>
                )}
              </div>
            </main>

            {/* Right Docked Command Rail: Zone Inspector when focused, otherwise Live Incident Stream */}
            {focusedCamera ? (
              <DedicatedCameraPanel
                key={focusedCamera.id}
                camera={focusedCamera}
                allCameras={cameras}
                facilityMode={facilityMode}
                defaultAiModel={selectedAiModel}
                defaultTeacherEmail={defaultTeacherEmail}
                courses={courses}
                cameraAlerts={alerts.filter((a) => a.cameraId === focusedCamera.id)}
                onBackToAll={() => setFocusedCameraId(null)}
                onSelectCameraPlace={(id) => setFocusedCameraId(id)}
                onUpdateCameraSettings={handleUpdateCameraSettings}
                onRunAttendanceCheck={(id) => handleRunAttendanceCheck(id, false)}
                onAcknowledgeAlert={handleAcknowledgeAlert}
                onNotifyTeacher={(alert) => setDispatchAlert(alert)}
              />
            ) : (
              <LiveIncidentRail
                alerts={alerts}
                facilityMode={facilityMode}
                onAcknowledgeAlert={handleAcknowledgeAlert}
                onAcknowledgeAll={handleAcknowledgeAll}
                onFocusCamera={handleFocusFromAlert}
                onNotifyTeacher={(alert) => setDispatchAlert(alert)}
                onViewAllIncidents={() => setActiveView('alerts')}
              />
            )}
          </div>
        ) : (
          <main className="flex-1 min-w-0 p-4 sm:p-6 space-y-5 max-w-[1360px]">
            <NotificationBanner
              alert={latestUnacknowledgedAlert}
              onInspectCamera={handleFocusFromAlert}
              onNotifyTeacher={(alert) => setDispatchAlert(alert)}
              onAcknowledge={handleAcknowledgeAlert}
            />

            {statusNotice ? (
              <div
                role="status"
                className="bg-emerald-950/50 border border-emerald-800/70 text-emerald-100 rounded-lg px-4 py-2.5 text-xs flex items-center justify-between gap-4"
              >
                <span>{statusNotice}</span>
                <button
                  type="button"
                  onClick={() => setStatusNotice(null)}
                  className="text-xs font-semibold text-emerald-300 hover:underline cursor-pointer shrink-0"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {globalError ? (
              <div
                role="alert"
                className="bg-amber-950/50 border border-amber-800/70 text-amber-100 rounded-lg px-4 py-2.5 text-xs flex items-center justify-between gap-4"
              >
                <span>{globalError}</span>
                <button
                  type="button"
                  onClick={() => setGlobalError(null)}
                  className="text-xs font-semibold text-amber-300 hover:underline cursor-pointer shrink-0"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {activeView === 'bluetooth' ? (
              <BluetoothDirectoryView
                connectedCameras={cameras}
                discoveredDevices={discoveredBluetooth}
                onDeviceDiscovered={handleDeviceDiscovered}
                onAddBluetoothCamera={handleAddBluetoothCamera}
                onOpenModal={() => openScannerOnTab('wifi')}
              />
            ) : null}

            {activeView === 'alerts' ? (
              <div className="space-y-4">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
                    Incident &amp; Threat Audit Log
                  </h1>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Review verified fighting, beating, bullying, weapon, breach, and &gt;{SOUND_ALERT_THRESHOLD_DB.toFixed(1)} dB (3s) acoustic alerts with occupancy counts and evidence frames.
                  </p>
                </div>
                <AlertsPanel
                  alerts={alerts}
                  cameras={cameras}
                  facilityMode={facilityMode}
                  onAcknowledgeAlert={handleAcknowledgeAlert}
                  onAcknowledgeAll={handleAcknowledgeAll}
                  onClearAcknowledged={handleClearAcknowledged}
                  onFocusCamera={handleFocusFromAlert}
                  onNotifyTeacher={(alert) => setDispatchAlert(alert)}
                />
              </div>
            ) : null}

            {activeView === 'evidence' ? (
              <EvidenceVaultView
                cases={evidenceCases}
                selectedCaseId={selectedEvidenceId}
                onSelectCase={setSelectedEvidenceId}
                onDeleteCase={handleDeleteEvidenceCase}
                onReturnToWall={() => setActiveView('grid')}
              />
            ) : null}

            {activeView === 'workspace' ? (
              <WorkspaceTeacherHub
                userEmail={currentUser?.email ?? null}
                userName={currentUser?.displayName ?? null}
                hasAccessToken={hasAccessToken}
                isSigningIn={isSigningIn}
                onGoogleSignIn={handleGoogleSignIn}
                onSignOut={handleSignOut}
                defaultTeacherEmail={defaultTeacherEmail}
                onSaveTeacherEmail={handleSaveTeacherEmail}
                courses={courses}
                linkedCourseId={linkedCourseId}
                onSelectCourse={(c) => {
                  void handleSelectCourse(c);
                }}
                courseTeachers={courseTeachers}
                courseStudentCount={courseStudentCount}
                gmailMessages={gmailMessages}
                loadingWorkspace={loadingWorkspace}
                workspaceError={workspaceError}
                onRefreshWorkspace={async () => {
                  const token = await getAccessToken();
                  await syncWorkspaceFromGoogle(token);
                }}
                cameras={cameras}
                soundAlerts={soundThresholdAlerts}
                dbCalibrationOffset={dbCalibrationOffset}
                onChangeDbCalibrationOffset={setDbCalibrationOffset}
                onOpenDispatchModal={(alert) => setDispatchAlert(alert)}
              />
            ) : null}
          </main>
        )}
      </div>

      <AlertPopupOverlay
        popups={popupAlerts}
        onDismissPopup={(alertId) =>
          setPopupAlerts((prev) => prev.filter((item) => item.id !== alertId))
        }
        onDismissAllPopups={() => setPopupAlerts([])}
        onInspectCamera={handleFocusFromAlert}
        onNotifyTeacher={(alert) => setDispatchAlert(alert)}
        onAcknowledge={handleAcknowledgeAlert}
      />

      <BluetoothScannerModal
        isOpen={isScannerOpen}
        initialTab={scannerInitialTab}
        existingCameras={cameras}
        discoveredBluetooth={discoveredBluetooth}
        onDeviceDiscovered={handleDeviceDiscovered}
        onClose={() => setIsScannerOpen(false)}
        onAddWifiCamera={handleAddWifiCamera}
        onAddBluetoothCamera={handleAddBluetoothCamera}
        onAddHardwareCamera={handleAddHardwareCamera}
        onAddMicrophoneZone={handleAddMicrophoneZone}
        onAddStreamUrlCamera={handleAddStreamUrlCamera}
        onAddUploadedCamera={handleAddUploadedCamera}
      />

      <TeacherAlertDispatchModal
        alert={dispatchAlert}
        defaultTeacherEmail={defaultTeacherEmail}
        courses={courses}
        linkedCourseId={linkedCourseId}
        hasAccessToken={hasAccessToken}
        onGoogleSignIn={handleGoogleSignIn}
        onConfirmSendGmail={handleConfirmSendGmail}
        onConfirmPostClassroom={handleConfirmPostClassroom}
        onClose={() => setDispatchAlert(null)}
      />
    </div>
  );
}
