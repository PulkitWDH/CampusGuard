import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClassroomCamera, IncidentAlert } from '../types';
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

test('validateOwnerUid enforces exact authenticated UID match without mutation', () => {
  assert.equal(validateOwnerUid('abcDEF123_45-xyz', 'abcDEF123_45-xyz'), 'abcDEF123_45-xyz');
  assert.equal(validateOwnerUid('user-a', 'user-b'), null);
  assert.equal(validateOwnerUid('user-a', null), null);
  assert.equal(validateOwnerUid('', ''), null);
  assert.equal(validateOwnerUid('bad/uid..path', 'bad/uid..path'), null);
});

test('sanitizeDocumentId guarantees firestore.rules isValidId compliance', () => {
  assert.equal(sanitizeDocumentId('cam 1 / main@hall'), 'cam-1-main-hall');
  assert.match(sanitizeDocumentId('   ', 'zone'), /^zone-[a-z0-9]+$/);
  assert.equal(sanitizeDocumentId('a'.repeat(200)).length, 128);
});

test('formatFriendlyAuthError handles cancellation, blocked popups, storage restrictions, and domain errors', () => {
  assert.deepEqual(formatFriendlyAuthError({ code: 'auth/popup-closed-by-user' }), {
    cancelled: true,
    message: '',
  });
  assert.deepEqual(formatFriendlyAuthError({ code: 'auth/cancelled-popup-request' }), {
    cancelled: true,
    message: '',
  });
  const blocked = formatFriendlyAuthError({ code: 'auth/popup-blocked' });
  assert.equal(blocked.cancelled, false);
  assert.match(blocked.message, /popup/i);

  const storage = formatFriendlyAuthError({ code: 'auth/web-storage-unsupported' });
  assert.equal(storage.cancelled, false);
  assert.match(storage.message, /storage/i);

  const offline = formatFriendlyAuthError({ code: 'auth/network-request-failed' });
  assert.equal(offline.cancelled, false);
  assert.match(offline.message, /offline/i);
});

test('UserProfile create and update payloads strictly comply with firestore.rules', () => {
  const created = buildUserProfileCreateFields({
    uid: 'uid_12345',
    email: 'teacher@school.edu',
    displayName: 'Principal Rao',
    facilityMode: 'school',
  });
  assert.equal(created.uid, 'uid_12345');
  assert.equal(created.email, 'teacher@school.edu');
  assert.equal(created.facilityMode, 'school');

  // Update payload MUST NOT include immutable `uid` or `createdAt`
  const updated = buildUserProfileUpdateFields({
    uid: 'uid_12345',
    email: 'teacher@school.edu',
    defaultTeacherEmail: 'safety@school.edu',
    facilityMode: 'all',
  });
  assert.equal('uid' in updated, false);
  assert.equal('createdAt' in updated, false);
  assert.equal(updated.defaultTeacherEmail, 'safety@school.edu');
  assert.equal(updated.facilityMode, 'all');
});

test('MonitoredZone create/update payloads prevent empty-field PERMISSION_DENIED and restrict update keys', () => {
  const cameraWithBlankBluetooth: ClassroomCamera = {
    id: 'cam-wifi-1',
    cameraCode: '',
    classroomName: '',
    bluetoothDeviceName: '',
    bluetoothAddress: '',
    sourceKind: 'wifi-cctv',
    hasVideo: true,
    hasVoice: false,
    voiceListeningEnabled: false,
    streamUrl: 'http://192.168.1.40:8080/video',
    liveTranscript: '',
    audioLevel: 0,
    status: 'normal',
    studentCount: 0,
    lastAnalysis: null,
    isAnalyzing: false,
  };

  const created = buildMonitoredZoneCreateFields('uid_123', 'cam-wifi-1', cameraWithBlankBluetooth);
  assert.ok(String(created.cameraCode).length >= 1);
  assert.ok(String(created.classroomName).length >= 1);
  assert.ok(String(created.bluetoothDeviceName).length >= 1);
  assert.ok(String(created.bluetoothAddress).length >= 1);
  assert.equal(created.ownerUid, 'uid_123');

  const updated = buildMonitoredZoneUpdateFields(cameraWithBlankBluetooth);
  // firestore.rules only allows classroomName, voiceListeningEnabled, streamUrl, updatedAt on update
  assert.deepEqual(Object.keys(updated).sort(), [
    'classroomName',
    'streamUrl',
    'voiceListeningEnabled',
  ]);
});

test('SafetyIncident create/update payloads enforce schema bounds and sort descending without composite index', () => {
  const alert: IncidentAlert = {
    id: 'inc-1',
    cameraId: 'cam-1',
    cameraCode: 'CAM-1',
    classroomName: 'Main Hall',
    alertType: 'sound-threshold',
    severity: 'critical',
    threatCategory: 'disturbance',
    studentCount: 24,
    measuredDb: 96.4,
    headline: 'Acoustic spike above 90.1 dB',
    voiceCue: 'help',
    details: 'Loud acoustic distress detected',
    teacherNotified: false,
    acknowledged: false,
    timestamp: '2026-11-28T10:00:00.000Z',
  };

  const created = buildSafetyIncidentCreateFields('uid_123', 'inc-1', alert);
  assert.equal(created.ownerUid, 'uid_123');
  assert.equal(created.measuredDb, 96.4);
  assert.equal(created.threatCategory, 'disturbance');

  const updated = buildSafetyIncidentUpdateFields({ acknowledged: true });
  assert.deepEqual(updated, { acknowledged: true });

  const sorted = sortIncidentsDescending([
    { ...alert, id: 'older', timestamp: '2026-11-28T09:00:00.000Z' },
    { ...alert, id: 'newer', timestamp: '2026-11-28T11:30:00.000Z' },
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['newer', 'older']
  );
});
