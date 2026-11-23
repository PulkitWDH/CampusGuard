import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { ClassroomCamera, FacilityMode, IncidentAlert } from '../types';

export const SCOPES: string[] = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/classroom.addons.student',
  'https://www.googleapis.com/auth/classroom.addons.teacher',
  'https://www.googleapis.com/auth/classroom.announcements',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.courses',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.guardianlinks.me.readonly',
  'https://www.googleapis.com/auth/classroom.guardianlinks.students',
  'https://www.googleapis.com/auth/classroom.guardianlinks.students.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/classroom.profile.photos',
  'https://www.googleapis.com/auth/classroom.push-notifications',
  'https://www.googleapis.com/auth/classroom.rosters',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  'https://www.googleapis.com/auth/classroom.topics',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
  'https://www.googleapis.com/auth/gmail.addons.current.message.action',
  'https://www.googleapis.com/auth/gmail.addons.current.message.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
];

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const googleProvider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({ prompt: 'consent select_account' });

// In-memory OAuth access token only (never persisted to localStorage or sessionStorage).
let cachedAccessToken: string | null = null;
let isSigningIn = false;

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
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
  onUserChanged: (user: User | null, accessToken: string | null) => void
): Unsubscribe {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
      onUserChanged(null, null);
      return;
    }
    if (!isSigningIn) {
      onUserChanged(user, cachedAccessToken);
    }
  });
}

export async function googleSignIn(): Promise<{
  user: User;
  accessToken: string | null;
  idToken: string;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken ?? null;
    const idToken = await result.user.getIdToken();
    return {
      user: result.user,
      accessToken: cachedAccessToken,
      idToken,
    };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'auth/unauthorized-domain') {
      const host =
        typeof window !== 'undefined' && window.location.hostname
          ? window.location.hostname
          : 'this domain';
      throw new Error(
        `Domain "${host}" is not authorized for Google Sign-In. Add "${host}" in Firebase Console → Project "${firebaseConfig.projectId}" → Authentication → Settings → Authorized domains.`
      );
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
}

export async function getAccessToken(): Promise<string | null> {
  return cachedAccessToken;
}

export async function getFirebaseIdToken(): Promise<string | null> {
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken();
}

export async function logout(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128);
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
  const uid = sanitizeId(user.uid);
  const path = `users/${uid}`;
  const docRef = doc(db, 'users', uid);

  try {
    const existingSnap = await getDocFromServer(docRef).catch(() => null);
    if (existingSnap && existingSnap.exists()) {
      await updateDoc(docRef, {
        email: (user.email || `${uid}@users.local`).slice(0, 254),
        ...(user.displayName ? { displayName: user.displayName.slice(0, 120) } : {}),
        ...(prefs.defaultTeacherEmail !== undefined
          ? { defaultTeacherEmail: prefs.defaultTeacherEmail.slice(0, 254) }
          : {}),
        ...(prefs.linkedCourseId !== undefined
          ? { linkedCourseId: prefs.linkedCourseId.slice(0, 128) }
          : {}),
        ...(prefs.linkedCourseName !== undefined
          ? { linkedCourseName: prefs.linkedCourseName.slice(0, 160) }
          : {}),
        facilityMode: prefs.facilityMode,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        uid,
        email: (user.email || `${uid}@users.local`).slice(0, 254),
        ...(user.displayName ? { displayName: user.displayName.slice(0, 120) } : {}),
        ...(prefs.defaultTeacherEmail
          ? { defaultTeacherEmail: prefs.defaultTeacherEmail.slice(0, 254) }
          : {}),
        ...(prefs.linkedCourseId ? { linkedCourseId: prefs.linkedCourseId.slice(0, 128) } : {}),
        ...(prefs.linkedCourseName
          ? { linkedCourseName: prefs.linkedCourseName.slice(0, 160) }
          : {}),
        facilityMode: prefs.facilityMode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveZoneToFirestore(
  userUid: string,
  camera: ClassroomCamera
): Promise<void> {
  const uid = sanitizeId(userUid);
  const zoneId = sanitizeId(camera.id);
  const path = `users/${uid}/zones/${zoneId}`;
  const ref = doc(db, 'users', uid, 'zones', zoneId);

  try {
    await setDoc(ref, {
      id: zoneId,
      ownerUid: uid,
      cameraCode: camera.cameraCode.slice(0, 32),
      classroomName: camera.classroomName.slice(0, 140),
      bluetoothDeviceName: camera.bluetoothDeviceName.slice(0, 140),
      bluetoothAddress: camera.bluetoothAddress.slice(0, 128),
      sourceKind: camera.sourceKind,
      hasVideo: Boolean(camera.hasVideo),
      hasVoice: Boolean(camera.hasVoice),
      voiceListeningEnabled: Boolean(camera.voiceListeningEnabled),
      ...(camera.streamUrl ? { streamUrl: camera.streamUrl.slice(0, 1000) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteZoneFromFirestore(userUid: string, cameraId: string): Promise<void> {
  const uid = sanitizeId(userUid);
  const zoneId = sanitizeId(cameraId);
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
  const uid = sanitizeId(userUid);
  const incidentId = sanitizeId(alert.id);
  const path = `users/${uid}/incidents/${incidentId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'incidents', incidentId), {
      id: incidentId,
      ownerUid: uid,
      cameraId: sanitizeId(alert.cameraId),
      cameraCode: alert.cameraCode.slice(0, 32),
      classroomName: alert.classroomName.slice(0, 140),
      alertType: alert.alertType === 'sound-threshold' ? 'sound-threshold' : 'ai-vision',
      severity: alert.severity,
      ...(alert.threatCategory ? { threatCategory: alert.threatCategory } : {}),
      ...(alert.modelUsed ? { modelUsed: alert.modelUsed.slice(0, 64) } : {}),
      studentCount: Math.max(0, Math.min(10000, Math.round(alert.studentCount || 0))),
      ...(typeof alert.measuredDb === 'number'
        ? { measuredDb: Math.max(0, Math.min(200, alert.measuredDb)) }
        : {}),
      headline: alert.headline.slice(0, 240),
      voiceCue: (alert.voiceCue || '').slice(0, 500),
      details: (alert.details || '').slice(0, 1000),
      ...(alert.teacherMessageBody
        ? { teacherMessage: alert.teacherMessageBody.slice(0, 2000) }
        : {}),
      teacherNotified: Boolean(alert.teacherNotified),
      acknowledged: Boolean(alert.acknowledged),
      timestamp: alert.timestamp.slice(0, 64),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateIncidentInFirestore(
  userUid: string,
  incidentIdRaw: string,
  updates: { acknowledged?: boolean; teacherNotified?: boolean }
): Promise<void> {
  const uid = sanitizeId(userUid);
  const incidentId = sanitizeId(incidentIdRaw);
  const path = `users/${uid}/incidents/${incidentId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'incidents', incidentId), {
      ...(updates.acknowledged !== undefined ? { acknowledged: updates.acknowledged } : {}),
      ...(updates.teacherNotified !== undefined
        ? { teacherNotified: updates.teacherNotified }
        : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToUserIncidents(
  userUid: string,
  onIncidents: (incidents: IncidentAlert[]) => void
): Unsubscribe {
  const uid = sanitizeId(userUid);
  const path = `users/${uid}/incidents`;
  const q = query(
    collection(db, 'users', uid, 'incidents'),
    where('ownerUid', '==', uid),
    orderBy('timestamp', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: IncidentAlert[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: String(data.id),
          cameraId: String(data.cameraId),
          cameraCode: String(data.cameraCode),
          classroomName: String(data.classroomName),
          alertType: data.alertType === 'sound-threshold' ? 'sound-threshold' : 'ai-vision',
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
      onIncidents(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
