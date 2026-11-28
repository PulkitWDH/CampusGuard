import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getAuth,
  inMemoryPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { ClassroomCamera, FacilityMode, IncidentAlert } from '../types';
import {
  buildMonitoredZoneCreateFields,
  buildMonitoredZoneUpdateFields,
  buildSafetyIncidentCreateFields,
  buildSafetyIncidentUpdateFields,
  buildUserProfileCreateFields,
  buildUserProfileUpdateFields,
  formatFriendlyAuthError,
  sanitizeDocumentId,
  sortIncidentsDescending,
  validateOwnerUid,
} from './firebaseHelpers';

// Minimal scopes ONLY requested when a School Mode operator explicitly links Google Classroom & Gmail
export const WORKSPACE_SCOPES: string[] = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.announcements',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

function createFirebaseApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

function createFirebaseAuth(firebaseApp: FirebaseApp): Auth {
  try {
    return initializeAuth(firebaseApp, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence,
      ],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // Already initialized (e.g. during module reload)
    return getAuth(firebaseApp);
  }
}

const app = createFirebaseApp();
export const auth = createFirebaseAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Standard Firebase Google Sign-In provider (ZERO restricted Gmail/Classroom scopes -> works on every Google account!)
const basicGoogleProvider = new GoogleAuthProvider();
basicGoogleProvider.setCustomParameters({ prompt: 'select_account' });

// Optional Workspace provider for School Safety Classroom/Gmail dispatch linking
const workspaceGoogleProvider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  workspaceGoogleProvider.addScope(scope);
}
workspaceGoogleProvider.setCustomParameters({ prompt: 'consent select_account' });

// In-memory OAuth access token only (never persisted to localStorage or sessionStorage).
let cachedAccessToken: string | null = null;
let persistenceConfigured = false;
let activeSignInPromise: Promise<{
  user: User;
  accessToken: string | null;
  idToken: string;
} | null> | null = null;

// Tracks verified `/users/{uid}` document readiness so subcollection writes never race ahead of profile creation
const ensuredUserProfiles = new Set<string>();
const inFlightProfileSyncs = new Map<string, Promise<void>>();

/**
 * Ensures Firebase Auth uses persistent storage (`browserLocalPersistence` -> `browserSessionPersistence`
 * -> `inMemoryPersistence`) so sessions survive reloads and never throw in restricted iframes.
 */
async function ensureAuthPersistence(): Promise<void> {
  if (persistenceConfigured) return;
  const fallbacks = [browserLocalPersistence, browserSessionPersistence, inMemoryPersistence];
  for (const persistence of fallbacks) {
    try {
      await setPersistence(auth, persistence);
      persistenceConfigured = true;
      return;
    } catch {
      // Try next storage tier (e.g., third-party iframe blocking localStorage/IndexedDB)
    }
  }
}

/**
 * Waits for Firebase Auth to finish restoring any persisted session from storage on startup.
 */
export async function waitForAuthReady(): Promise<User | null> {
  await auth.authStateReady();
  return auth.currentUser;
}

// Validate connection to Firestore on boot (silently logs config warning only if offline/misconfigured)
async function testConnection() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore offline or unavailable — continuing in local Edge AI mode.');
    }
  }
}
void testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function initAuth(
  onUserChanged: (user: User | null, accessToken: string | null) => void,
  onAuthReady?: () => void
): Unsubscribe {
  let notifiedReady = false;
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
      ensuredUserProfiles.clear();
      inFlightProfileSyncs.clear();
      onUserChanged(null, null);
    } else {
      onUserChanged(user, cachedAccessToken);
    }
    if (!notifiedReady) {
      notifiedReady = true;
      onAuthReady?.();
    }
  });
}

async function performPopupSignIn(
  provider: GoogleAuthProvider,
  captureWorkspaceAccessToken: boolean
): Promise<{
  user: User;
  accessToken: string | null;
  idToken: string;
} | null> {
  if (activeSignInPromise) {
    return activeSignInPromise;
  }

  const run = (async () => {
    try {
      await ensureAuthPersistence();
      const result = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (captureWorkspaceAccessToken) {
        cachedAccessToken = credential?.accessToken ?? null;
      }
      const idToken = await result.user.getIdToken();
      return {
        user: result.user,
        accessToken: cachedAccessToken,
        idToken,
      };
    } catch (err) {
      const friendly = formatFriendlyAuthError(err);
      if (friendly.cancelled) {
        return null;
      }
      throw new Error(friendly.message);
    } finally {
      activeSignInPromise = null;
    }
  })();

  activeSignInPromise = run;
  return run;
}

/**
 * Standard Firebase Google Sign-In (no restricted Workspace scopes so ANY Google account works reliably).
 */
export async function googleSignIn(): Promise<{
  user: User;
  accessToken: string | null;
  idToken: string;
} | null> {
  return performPopupSignIn(basicGoogleProvider, false);
}

/**
 * Explicit opt-in Google Workspace (Classroom & Gmail) OAuth linking for School Safety Mode.
 */
export async function connectGoogleWorkspace(): Promise<{
  user: User;
  accessToken: string | null;
  idToken: string;
} | null> {
  return performPopupSignIn(workspaceGoogleProvider, true);
}

export async function getAccessToken(): Promise<string | null> {
  return cachedAccessToken;
}

export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  await auth.authStateReady();
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken(forceRefresh);
}

export async function logout(): Promise<void> {
  cachedAccessToken = null;
  ensuredUserProfiles.clear();
  inFlightProfileSyncs.clear();
  await auth.signOut();
}

export async function syncUserProfileToFirestore(
  user: User,
  prefs: {
    defaultTeacherEmail?: string;
    linkedCourseId?: string;
    linkedCourseName?: string;
    facilityMode: FacilityMode;
  }
): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  await auth.authStateReady();
  const uid = validateOwnerUid(user.uid, auth.currentUser?.uid);
  if (!uid) return;

  const path = `users/${uid}`;
  const docRef = doc(db, 'users', uid);

  const syncTask = (async () => {
    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        await updateDoc(docRef, {
          ...buildUserProfileUpdateFields({
            uid,
            email: user.email,
            displayName: user.displayName,
            defaultTeacherEmail: prefs.defaultTeacherEmail,
            linkedCourseId: prefs.linkedCourseId,
            linkedCourseName: prefs.linkedCourseName,
            facilityMode: prefs.facilityMode,
          }),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(docRef, {
          ...buildUserProfileCreateFields({
            uid,
            email: user.email,
            displayName: user.displayName,
            defaultTeacherEmail: prefs.defaultTeacherEmail,
            linkedCourseId: prefs.linkedCourseId,
            linkedCourseName: prefs.linkedCourseName,
            facilityMode: prefs.facilityMode,
          }),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      ensuredUserProfiles.add(uid);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    } finally {
      inFlightProfileSyncs.delete(uid);
    }
  })();

  inFlightProfileSyncs.set(uid, syncTask);
  return syncTask;
}

/**
 * Guarantees `/users/{uid}` exists before any `zones` or `incidents` subcollection write/delete,
 * satisfying `exists(/databases/$(database)/documents/users/$(userId))` in firestore.rules.
 */
async function ensureUserProfileReady(uid: string): Promise<boolean> {
  if (ensuredUserProfiles.has(uid)) return true;
  const pending = inFlightProfileSyncs.get(uid);
  if (pending) {
    await pending.catch(() => {});
    if (ensuredUserProfiles.has(uid)) return true;
  }
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== uid) return false;

  await syncUserProfileToFirestore(currentUser, { facilityMode: 'all' });
  return ensuredUserProfiles.has(uid);
}

export async function saveZoneToFirestore(
  userUid: string,
  camera: ClassroomCamera
): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  await auth.authStateReady();
  const uid = validateOwnerUid(userUid, auth.currentUser?.uid);
  if (!uid) return;

  const profileReady = await ensureUserProfileReady(uid);
  if (!profileReady) return;

  const zoneId = sanitizeDocumentId(camera.id, 'zone');
  const path = `users/${uid}/zones/${zoneId}`;
  const ref = doc(db, 'users', uid, 'zones', zoneId);

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        ...buildMonitoredZoneUpdateFields(camera),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...buildMonitoredZoneCreateFields(uid, zoneId, camera),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteZoneFromFirestore(userUid: string, cameraId: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  await auth.authStateReady();
  const uid = validateOwnerUid(userUid, auth.currentUser?.uid);
  if (!uid) return;

  const profileReady = await ensureUserProfileReady(uid);
  if (!profileReady) return;

  const zoneId = sanitizeDocumentId(cameraId, 'zone');
  const path = `users/${uid}/zones/${zoneId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'zones', zoneId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveIncidentToFirestore(
  userUid: string,
  alert: IncidentAlert
): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  await auth.authStateReady();
  const uid = validateOwnerUid(userUid, auth.currentUser?.uid);
  if (!uid) return;

  const profileReady = await ensureUserProfileReady(uid);
  if (!profileReady) return;

  const incidentId = sanitizeDocumentId(alert.id, 'incident');
  const path = `users/${uid}/incidents/${incidentId}`;
  const ref = doc(db, 'users', uid, 'incidents', incidentId);
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        ...buildSafetyIncidentUpdateFields({
          acknowledged: alert.acknowledged,
          teacherNotified: alert.teacherNotified,
        }),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...buildSafetyIncidentCreateFields(uid, incidentId, alert),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateIncidentInFirestore(
  userUid: string,
  incidentIdRaw: string,
  updates: { acknowledged?: boolean; teacherNotified?: boolean }
): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  await auth.authStateReady();
  const uid = validateOwnerUid(userUid, auth.currentUser?.uid);
  if (!uid) return;

  const profileReady = await ensureUserProfileReady(uid);
  if (!profileReady) return;

  const incidentId = sanitizeDocumentId(incidentIdRaw, 'incident');
  const path = `users/${uid}/incidents/${incidentId}`;
  const fields = buildSafetyIncidentUpdateFields(updates);
  if (Object.keys(fields).length === 0) return;

  try {
    await updateDoc(doc(db, 'users', uid, 'incidents', incidentId), {
      ...fields,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToUserZones(
  userUid: string,
  onZones: (zones: ClassroomCamera[]) => void
): Unsubscribe {
  const uid = validateOwnerUid(userUid, auth.currentUser?.uid);
  if (!uid) {
    return () => {};
  }
  const path = `users/${uid}/zones`;
  // Uses equality filter on ownerUid only (matches firestore.rules `allow list` without needing composite index)
  const q = query(collection(db, 'users', uid, 'zones'), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: ClassroomCamera[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          cameraCode: String(data.cameraCode || 'CAM-01'),
          classroomName: String(data.classroomName || 'Monitored Zone'),
          bluetoothDeviceName: String(data.bluetoothDeviceName || 'Local Camera'),
          bluetoothAddress: String(data.bluetoothAddress || 'local'),
          sourceKind: (data.sourceKind || 'device-camera') as ClassroomCamera['sourceKind'],
          hasVideo: Boolean(data.hasVideo),
          hasVoice: Boolean(data.hasVoice),
          voiceListeningEnabled: Boolean(data.voiceListeningEnabled),
          streamUrl: data.streamUrl ? String(data.streamUrl) : undefined,
          liveTranscript: '',
          audioLevel: 0,
          status: 'normal',
          studentCount: 0,
          lastAnalysis: null,
          isAnalyzing: false,
        };
      });
      onZones(list);
    },
    (error) => {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'unavailable' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        return;
      }
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Logged structured FirestoreErrorInfo above; avoid unhandled crash inside async listener
      }
    }
  );
}

export function subscribeToUserIncidents(
  userUid: string,
  onIncidents: (incidents: IncidentAlert[]) => void
): Unsubscribe {
  const uid = validateOwnerUid(userUid, auth.currentUser?.uid);
  if (!uid) {
    return () => {};
  }
  const path = `users/${uid}/incidents`;
  // Filter strictly by ownerUid (matches firestore.rules `allow list`) and sort in-memory
  // so no Firestore composite index on (ownerUid, timestamp) is required.
  const q = query(collection(db, 'users', uid, 'incidents'), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: IncidentAlert[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id || d.id),
          cameraId: String(data.cameraId || ''),
          cameraCode: String(data.cameraCode || ''),
          classroomName: String(data.classroomName || ''),
          alertType:
            data.alertType === 'sound-threshold' || data.alertType === 'attendance'
              ? data.alertType
              : 'ai-vision',
          severity: data.severity === 'critical' ? 'critical' : 'warning',
          threatCategory: data.threatCategory,
          modelUsed: data.modelUsed,
          studentCount: Number(data.studentCount || 0),
          measuredDb: typeof data.measuredDb === 'number' ? data.measuredDb : undefined,
          headline: String(data.headline || ''),
          voiceCue: String(data.voiceCue || ''),
          details: String(data.details || ''),
          teacherMessageBody: data.teacherMessage ? String(data.teacherMessage) : undefined,
          teacherNotified: Boolean(data.teacherNotified),
          timestamp: String(data.timestamp || ''),
          acknowledged: Boolean(data.acknowledged),
        };
      });
      onIncidents(sortIncidentsDescending(list));
    },
    (error) => {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'unavailable' || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        return;
      }
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Logged structured FirestoreErrorInfo above; avoid unhandled crash inside async listener
      }
    }
  );
}
