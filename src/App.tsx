import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BluetoothSearching, LayoutGrid, Plus, ShieldAlert } from 'lucide-react';
import type { User } from 'firebase/auth';
import { AlertPopupOverlay } from './components/AlertPopupOverlay';
import { AlertsPanel } from './components/AlertsPanel';
import { BluetoothDirectoryView } from './components/BluetoothDirectoryView';
import { BluetoothScannerModal } from './components/BluetoothScannerModal';
import { CameraFeedCard, type CameraFramePayload } from './components/CameraFeedCard';
import { DedicatedCameraPanel } from './components/DedicatedCameraPanel';
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
  BluetoothDeviceCandidate,
  ClassroomAnalysis,
  ClassroomCamera,
  DetectedPersonBox,
  FacilityMode,
  IncidentAlert,
  WorkspaceCourse,
  WorkspaceGmailMessage,
  WorkspaceTeacher,
} from './types';
import { openRawMediaStream, playAlertChime, sendBrowserNotification } from './utils/mediaCapture';
import {
  DEFAULT_DB_CALIBRATION_OFFSET,
  SOUND_ALERT_THRESHOLD_DB,
  computeCampusSummary,
  computeClassAttendance,
  deriveSafetyStatus,
  evaluateAttendanceReportAlert,
  evaluateFightNotification,
  evaluateLocalSafetyAnalysis,
  evaluateSoundThresholdAlert,
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
  const [discoveredBluetooth, setDiscoveredBluetooth] = useState<BluetoothDeviceCandidate[]>([]);
  const lastVoiceCueAlertAtRef = useRef<Record<string, number>>({});
  const [activeView, setActiveView] = useState<ActiveWorkspaceView>('grid');
  const [focusedCameraId, setFocusedCameraId] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

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
      setWorkspaceError(err instanceof Error ? err.message : 'Google sign-in failed.');
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

      // Helper: run 100% on-device local safety analysis when cloud API quota (HTTP 429) is exhausted
      const applyLocalEdgeSafetyFallback = (
        previewDataUrl?: string,
        quotaMessage?: string
      ) => {
        const currentPeople = target.lastAnalysis?.detectedPeople ?? [];
        const localResult = evaluateLocalSafetyAnalysis({
          detectedPeople: currentPeople,
          voiceTranscript: transcriptToSend,
          audioLevel: audioLevelToSend,
          facilityMode,
          audioSpikeDetected: options?.audioSpikeDetected,
        });
        const nextStatus = deriveSafetyStatus(localResult);
        setCameras((prev) =>
          prev.map((cam) => {
            if (cam.id !== cameraId) return cam;
            const livePeople = cam.lastAnalysis?.detectedPeople ?? currentPeople;
            const merged: ClassroomAnalysis = {
              ...localResult,
              studentCount: livePeople.length,
              detectedPeople: livePeople,
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
        applyLocalEdgeSafetyFallback();
        return;
      }

      const capturePayload = frameCapturersRef.current[cameraId]?.() ?? null;
      const frameBase64 = capturePayload?.frameBase64;
      const previousFrameBase64 = capturePayload?.previousFrameBase64;

      if (!frameBase64 && !transcriptToSend) {
        if (!isAutoTrigger) {
          const noSignalMsg =
            'Camera video feed is offline (NO SIGNAL) and no audio transcript is present. Reconnect the camera or verify stream URL before scanning.';
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
      selectedAiModel,
      soundAlertsEnabled,
    ]
  );

  const handleLocalPersonDetections = useCallback(
    (cameraId: string, detectedPeople: DetectedPersonBox[]) => {
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
                analyzedAt: new Date().toISOString(),
                summary:
                  count === 0 && !prevAnalysis.isFighting
                    ? 'No people detected in live frame (empty room · Edge AI).'
                    : prevAnalysis.summary,
              }
            : {
                studentCount: count,
                detectedPeople,
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
                        }
                      : cam.lastAnalysis,
                  }
                : cam
            )
          );
          setAlerts((prev) => [enrichedVoiceAlert, ...prev]);
          setPopupAlerts((prev) =>
            [enrichedVoiceAlert, ...prev.filter((item) => item.id !== enrichedVoiceAlert.id)].slice(0, 6)
          );
          void persistIncidentAsync(enrichedVoiceAlert);
          if (soundAlertsEnabled) {
            playAlertChime();
          }
          if (desktopNotifications) {
            sendBrowserNotification(enrichedVoiceAlert);
          }
        }
      }

      if (typeof audioLevel === 'number') {
        // Trigger immediate alert message to the teacher whenever sound strictly exceeds 81.1 dB
        if (target && target.voiceListeningEnabled && audioLevel > SOUND_ALERT_THRESHOLD_DB) {
          const lastDbMs = lastDbAlertAtRef.current[cameraId] ?? 0;
          const primaryTeacher = courseTeachersRef.current[0];
          const dbAlert = evaluateSoundThresholdAlert(target, audioLevel, {
            thresholdDb: SOUND_ALERT_THRESHOLD_DB,
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
            setAlerts((prev) => [dbAlert, ...prev]);
            setPopupAlerts((prev) => [dbAlert, ...prev.filter((item) => item.id !== dbAlert.id)].slice(0, 6));
            void persistIncidentAsync(dbAlert);
            if (soundAlertsEnabled) {
              playAlertChime();
            }
            if (desktopNotifications) {
              sendBrowserNotification(dbAlert);
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
      soundAlertsEnabled,
    ]
  );

  const handleReconnectStream = useCallback(async (cameraId: string) => {
    const target = camerasRef.current.find((c) => c.id === cameraId);
    if (!target) return;
    try {
      const stream = await openRawMediaStream({
        includeVideo: true,
        videoDeviceId: target.videoDeviceId,
        audioDeviceId: target.audioDeviceId,
      });
      mediaStreamsRef.current[cameraId] = stream;
      setStreamRevision((v) => v + 1);
    } catch {
      setGlobalError(`Unable to reconnect camera stream for ${target.classroomName}.`);
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

  return (
    <div id="top" className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        unreadAlertsCount={summary.activeAlertsCount}
        onOpenScanner={() => setIsScannerOpen(true)}
        userEmail={currentUser?.email ?? null}
        userDisplayName={currentUser?.displayName ?? null}
        isSigningIn={isSigningIn}
        onGoogleSignIn={() => {
          void handleGoogleSignIn();
        }}
        onSignOut={() => {
          void handleSignOut();
        }}
      />

      <div className="flex flex-1">
        <Sidebar
          cameras={cameras}
          summary={summary}
          facilityMode={facilityMode}
          onChangeFacilityMode={setFacilityMode}
          focusedCameraId={focusedCameraId}
          onFocusCamera={(id) => {
            setActiveView('grid');
            setFocusedCameraId((prev) => (prev === id ? null : id));
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
        />

        <main className="flex-1 min-w-0 p-4 sm:p-6 space-y-5 max-w-[1440px]">
          <NotificationBanner
            alert={latestUnacknowledgedAlert}
            onInspectCamera={handleFocusFromAlert}
            onNotifyTeacher={(alert) => setDispatchAlert(alert)}
            onAcknowledge={handleAcknowledgeAlert}
          />

          {statusNotice ? (
            <div
              role="status"
              className="bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-4"
            >
              <span>{statusNotice}</span>
              <button
                type="button"
                onClick={() => setStatusNotice(null)}
                className="text-xs font-semibold underline cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {globalError ? (
            <div
              role="alert"
              className="bg-amber-50 border border-amber-300 text-amber-950 rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-4"
            >
              <span>{globalError}</span>
              <button
                type="button"
                onClick={() => setGlobalError(null)}
                className="text-xs font-semibold underline cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {activeView === 'grid' ? (
            <>
              <div className="grid grid-cols-3 gap-3 lg:hidden bg-white border border-slate-200 rounded-xl p-3.5">
                <div>
                  <div className="text-xs text-slate-500 capitalize">
                    All {labels.zonePlural.toLowerCase()} live
                  </div>
                  <div className="text-lg font-semibold font-mono tabular-nums text-slate-900">
                    {summary.totalKidsCount}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">{labels.zonePlural}</div>
                  <div className="text-lg font-semibold font-mono tabular-nums text-slate-900">
                    {summary.totalCameras}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Unread alerts</div>
                  <div
                    className={`text-lg font-semibold font-mono tabular-nums ${
                      summary.activeAlertsCount > 0 ? 'text-red-600' : 'text-slate-900'
                    }`}
                  >
                    {summary.activeAlertsCount}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                    {focusedCamera ? `${focusedCamera.classroomName} · Dedicated Place` : labels.monitorTitle}
                  </h1>
                  <p className="text-sm text-slate-600 mt-0.5">
                    <span className="tabular-nums">{summary.totalCameras} independent {summary.totalCameras === 1 ? 'camera' : 'cameras'}</span>
                    <span aria-hidden="true"> · </span>
                    <span>Instant continuous AI (zero wait · real-time change detection)</span>
                    <span aria-hidden="true"> · </span>
                    <span>Teacher alert &gt; {SOUND_ALERT_THRESHOLD_DB.toFixed(1)} dB</span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    aria-label="Select facility mode"
                    value={facilityMode}
                    onChange={(e) => setFacilityMode(e.target.value as FacilityMode)}
                    className="lg:hidden text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800"
                  >
                    <option value="all">Bank, School &amp; General</option>
                    <option value="bank">Bank &amp; Vault</option>
                    <option value="school">School &amp; Classroom</option>
                  </select>
                  {focusedCamera ? (
                    <button
                      type="button"
                      onClick={() => setFocusedCameraId(null)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <LayoutGrid className="w-4 h-4" aria-hidden="true" />
                      <span>All {labels.zonePlural} ({cameras.length})</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <BluetoothSearching className="w-4 h-4" aria-hidden="true" />
                    <span>Connect Camera</span>
                  </button>
                </div>
              </div>

              {/* Per-Class Dedicated Places Switcher Strip (supports 2, 3, 5, 10+ classes) */}
              {cameras.length > 0 ? (
                <div
                  data-testid="per-class-places-bar"
                  className="bg-white border border-slate-200 rounded-xl p-2.5 flex items-center gap-2 overflow-x-auto"
                >
                  <button
                    type="button"
                    onClick={() => setFocusedCameraId(null)}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      !focusedCameraId
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    All {labels.zonePlural} ({cameras.length})
                  </button>
                  {cameras.map((cam) => {
                    const isActivePlace = focusedCameraId === cam.id;
                    return (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => setFocusedCameraId(cam.id)}
                        className={`px-3 py-1.5 rounded-lg text-left whitespace-nowrap shrink-0 border transition-colors cursor-pointer flex items-center gap-2.5 ${
                          isActivePlace
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-xs font-semibold">{cam.classroomName}</span>
                        <span
                          className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded ${
                            isActivePlace
                              ? 'bg-blue-700 text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {cam.studentCount} live
                          {typeof cam.expectedTotalCount === 'number' && cam.expectedTotalCount > 0
                            ? ` / ${cam.expectedTotalCount}`
                            : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {/* Per-Class Separate Counts Overview (every camera gets its own live + class total card) */}
              {cameras.length > 0 && !focusedCamera ? (
                <section aria-label="Individual class and zone counts" data-testid="per-class-counts-strip">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {cameras.map((cam) => {
                      const att = computeClassAttendance(cam.studentCount, cam.expectedTotalCount);
                      return (
                        <button
                          key={cam.id}
                          type="button"
                          onClick={() => setFocusedCameraId(cam.id)}
                          className="text-left bg-white border border-slate-200 hover:border-blue-400 rounded-xl p-3.5 transition-colors cursor-pointer flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-mono text-slate-500">{cam.cameraCode}</div>
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {cam.classroomName}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                              {cam.audioLevel.toFixed(1)} dB ·{' '}
                              {cam.attendanceCheckEnabled && cam.attendanceCheckTime
                                ? `Roll call ${cam.attendanceCheckTime}`
                                : cam.autoAiEnabled !== false
                                  ? 'Instant AI'
                                  : 'Manual AI'}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                              {att.presentCount} <span className="text-xs font-normal text-slate-500">live</span>
                            </div>
                            <div className="text-xs font-mono text-slate-600 tabular-nums">
                              {att.customTotal > 0
                                ? `${att.absentCount} absent / ${att.customTotal}`
                                : 'Total: —'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {cameras.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center" data-testid="empty-cameras-state">
                  <ShieldAlert className="w-9 h-9 text-slate-400 mx-auto mb-3" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-slate-900">
                    No security cameras connected
                  </h2>
                  <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
                    {labels.sectorDescription} Each connected camera gets its own dedicated place, its own live count &amp; class total, and continuous zero-wait instant AI with automatic failover.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsScannerOpen(true)}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>Connect First Zone Camera</span>
                  </button>
                </div>
              ) : focusedCamera ? (
                <div className="space-y-6" data-testid="dedicated-camera-space">
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                    <div className="xl:col-span-7">
                      <CameraFeedCard
                        key={focusedCamera.id}
                        camera={focusedCamera}
                        facilityMode={facilityMode}
                        defaultAiModel={selectedAiModel}
                        dbCalibrationOffset={dbCalibrationOffset}
                        cloudQuotaExhausted={cloudQuotaExhausted}
                        isFocused
                        liveMediaStream={mediaStreamsRef.current[focusedCamera.id] ?? null}
                        onRegisterCapture={registerCapture}
                        onLocalPersonDetections={handleLocalPersonDetections}
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
                    </div>
                    <div className="xl:col-span-5">
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
                    </div>
                  </div>

                  {otherCameras.length > 0 ? (
                    <section aria-label="Other classes live feeds" className="space-y-3">
                      <h2 className="text-sm font-semibold text-slate-700">
                        Other {labels.zonePlural} Running Independently ({otherCameras.length})
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {otherCameras.map((cam) => (
                          <CameraFeedCard
                            key={cam.id}
                            camera={cam}
                            facilityMode={facilityMode}
                            defaultAiModel={selectedAiModel}
                            dbCalibrationOffset={dbCalibrationOffset}
                            cloudQuotaExhausted={cloudQuotaExhausted}
                            isFocused={false}
                            liveMediaStream={mediaStreamsRef.current[cam.id] ?? null}
                            onRegisterCapture={registerCapture}
                            onLocalPersonDetections={handleLocalPersonDetections}
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
                  className="grid grid-cols-1 md:grid-cols-2 gap-5"
                >
                  {cameras.map((cam) => (
                    <CameraFeedCard
                      key={cam.id}
                      camera={cam}
                      facilityMode={facilityMode}
                      defaultAiModel={selectedAiModel}
                      dbCalibrationOffset={dbCalibrationOffset}
                      cloudQuotaExhausted={cloudQuotaExhausted}
                      isFocused={false}
                      liveMediaStream={mediaStreamsRef.current[cam.id] ?? null}
                      onRegisterCapture={registerCapture}
                      onLocalPersonDetections={handleLocalPersonDetections}
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
            </>
          ) : null}

          {activeView === 'bluetooth' ? (
            <BluetoothDirectoryView
              connectedCameras={cameras}
              discoveredDevices={discoveredBluetooth}
              onDeviceDiscovered={handleDeviceDiscovered}
              onAddBluetoothCamera={handleAddBluetoothCamera}
              onOpenModal={() => setIsScannerOpen(true)}
            />
          ) : null}

          {activeView === 'alerts' ? (
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  Safety Notifications &amp; Threat Audit Log
                </h1>
                <p className="text-sm text-slate-600 mt-0.5">
                  Review critical fight, robbery, weapon, breach, and &gt;81.1 dB teacher sound alerts alongside exact headcounts and voice cues.
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
        existingCameras={cameras}
        discoveredBluetooth={discoveredBluetooth}
        onDeviceDiscovered={handleDeviceDiscovered}
        onClose={() => setIsScannerOpen(false)}
        onAddBluetoothCamera={handleAddBluetoothCamera}
        onAddHardwareCamera={handleAddHardwareCamera}
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
