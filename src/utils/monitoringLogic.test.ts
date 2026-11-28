import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DB_CALIBRATION_OFFSET,
  SOUND_ALERT_THRESHOLD_DB,
  classifyBluetoothCamera,
  classifyDisasterPhase,
  computeAspectPreservingSize,
  computeBoxIoU,
  computeCalibratedOffsetFromDbfs,
  computeCameraCycleStep,
  computeCampusSummary,
  computeClassAttendance,
  computeContainDrawRect,
  computeFrameDeltaPercent,
  computeSplDecibels,
  computeTorsoPatchSimilarity,
  createInitialEdgeThreatState,
  deriveSafetyStatus,
  evaluateAttendanceReportAlert,
  evaluateFallenVictimAlert,
  evaluateFightNotification,
  evaluateLocalSafetyAnalysis,
  evaluateRealtimeEdgeThreat,
  evaluateSoundThresholdAlert,
  evaluateStampedeRiskAlert,
  evaluateVoiceCueThreatAlert,
  filterIncidentAlerts,
  filterVerifiedPersonDetections,
  findFaceOccluderForPerson,
  formatAiModelLabel,
  formatAlertCategoryBadge,
  formatCameraAttendanceLabel,
  formatFacilityLabels,
  formatOperationModeBranding,
  mapNormalizedBoxToRect,
  matchDisasterDistressKeyword,
  mergeTiledPersonDetections,
  parseSafeJsonText,
  shouldRunScheduledAttendance,
  shouldTriggerAudioSpikeScan,
  shouldTriggerInstantContinuousScan,
  stepPersonTracker,
} from './monitoringLogic';
import type { ClassroomAnalysis, ClassroomCamera, IncidentAlert } from '../types';
import { getOfflineResilienceStatus } from './localPersonDetector';
import { buildWifiCameraUrl, isPrivateLanHost } from './wifiCameraPresets';

test('classifyBluetoothCamera detects CCTV camera with video and voice recognition', () => {
  const result = classifyBluetoothCamera({
    name: 'Hikvision-BT-CCTV-Room305-AV',
    serviceUuids: ['0000181a-0000-1000-8000-00805f9b34fb', '0000110b-0000-1000-8000-00805f9b34fb'],
    declaredCapabilities: { video: true, voice: true },
  });

  assert.equal(result.isCctvCamera, true);
  assert.equal(result.supportsVideo, true);
  assert.equal(result.supportsVoice, true);
  assert.equal(result.isEligibleMonitor, true);
  assert.equal(result.deviceCategoryLabel, 'CCTV Camera');
});

test('classifyBluetoothCamera rejects non-camera Bluetooth speakers and video-only cameras', () => {
  const speaker = classifyBluetoothCamera({
    name: 'Sony-Classroom-Speaker',
    serviceUuids: ['0000110b-0000-1000-8000-00805f9b34fb'],
    declaredCapabilities: { video: false, voice: true },
  });
  assert.equal(speaker.isCctvCamera, false);
  assert.equal(speaker.isEligibleMonitor, false);

  const videoOnlyCam = classifyBluetoothCamera({
    name: 'Eufy-Hallway-Cam',
    serviceUuids: ['0000181a-0000-1000-8000-00805f9b34fb'],
    declaredCapabilities: { video: true, voice: false },
  });
  assert.equal(videoOnlyCam.isCctvCamera, true);
  assert.equal(videoOnlyCam.isEligibleMonitor, false);
});

test('evaluateFightNotification creates critical notification when fighting is detected', () => {
  const analysis: ClassroomAnalysis = {
    studentCount: 7,
    isFighting: true,
    severity: 'critical',
    voiceAnalysis: 'Elevated shouting and distress detected',
    fightReason: 'Two students shoving and grappling in the center aisle.',
    summary: 'Altercation in progress with 7 students present.',
    confidence: 94,
    analyzedAt: '2026-11-18T23:10:00.000Z',
  };

  assert.equal(deriveSafetyStatus(analysis), 'fighting');
  const alert = evaluateFightNotification(
    { id: 'cam-1', cameraCode: 'CAM-1', classroomName: 'Class A' },
    analysis
  );
  assert.ok(alert);
  assert.equal(alert.severity, 'critical');
  assert.equal(alert.studentCount, 7);
  assert.equal(alert.acknowledged, false);
  assert.match(alert.headline, /Class A/);
});

test('evaluateFightNotification returns null for calm classroom', () => {
  const analysis: ClassroomAnalysis = {
    studentCount: 8,
    isFighting: false,
    severity: 'none',
    voiceAnalysis: 'Calm lesson environment',
    fightReason: '',
    summary: '8 students seated at desks.',
    confidence: 97,
    analyzedAt: '2026-11-18T23:10:00.000Z',
  };

  assert.equal(deriveSafetyStatus(analysis), 'normal');
  assert.equal(
    evaluateFightNotification(
      { id: 'cam-1', cameraCode: 'CAM-1', classroomName: 'Class A' },
      analysis
    ),
    null
  );
});

test('computeCampusSummary and filterIncidentAlerts aggregate across multiple classrooms', () => {
  const cameras: ClassroomCamera[] = [
    {
      id: 'cam-1',
      cameraCode: 'CAM-1',
      classroomName: 'Class A',
      bluetoothDeviceName: 'BT-Cam-1',
      bluetoothAddress: 'AA:BB:CC:01',
      sourceKind: 'bluetooth-cctv',
      hasVideo: true,
      hasVoice: true,
      voiceListeningEnabled: true,
      liveTranscript: '',
      audioLevel: 12,
      status: 'normal',
      studentCount: 8,
      lastAnalysis: null,
      isAnalyzing: false,
    },
    {
      id: 'cam-2',
      cameraCode: 'CAM-2',
      classroomName: 'Class B',
      bluetoothDeviceName: 'BT-Cam-2',
      bluetoothAddress: 'AA:BB:CC:02',
      sourceKind: 'device-camera',
      hasVideo: true,
      hasVoice: true,
      voiceListeningEnabled: false,
      liveTranscript: '',
      audioLevel: 76,
      status: 'fighting',
      studentCount: 7,
      lastAnalysis: null,
      isAnalyzing: false,
    },
  ];

  const alerts: IncidentAlert[] = [
    {
      id: 'al-1',
      cameraId: 'cam-2',
      cameraCode: 'CAM-2',
      classroomName: 'Class B',
      severity: 'critical',
      studentCount: 7,
      headline: 'Fight detected',
      voiceCue: 'Shouting',
      details: 'Two students fighting',
      timestamp: '2026-11-18T23:10:00.000Z',
      acknowledged: false,
    },
    {
      id: 'al-2',
      cameraId: 'cam-1',
      cameraCode: 'CAM-1',
      classroomName: 'Class A',
      severity: 'warning',
      studentCount: 8,
      headline: 'Loud noise',
      voiceCue: 'Elevated speech',
      details: 'Brief noise spike',
      timestamp: '2026-11-18T23:05:00.000Z',
      acknowledged: true,
    },
  ];

  const summary = computeCampusSummary(cameras, alerts);
  assert.equal(summary.totalCameras, 2);
  assert.equal(summary.totalKidsCount, 15);
  assert.equal(summary.activeAlertsCount, 1);
  assert.equal(summary.fightingRoomsCount, 1);
  assert.equal(summary.voiceActiveCount, 1);

  assert.equal(filterIncidentAlerts(alerts, 'unread', 'all').length, 1);
  assert.equal(filterIncidentAlerts(alerts, 'all', 'cam-1').length, 1);
  assert.equal(filterIncidentAlerts(alerts, 'critical', 'all').length, 1);
});

test('classifyBluetoothCamera recognizes expanded security CCTV brands', () => {
  const tapo = classifyBluetoothCamera({
    name: 'TP-Link-Tapo-C210-Voice',
    serviceUuids: [],
    declaredCapabilities: { video: false, voice: false },
  });
  assert.equal(tapo.isCctvCamera, true);
  assert.equal(tapo.supportsVideo, true);
  assert.equal(tapo.supportsVoice, true);
  assert.equal(tapo.isEligibleMonitor, true);
});

test('evaluateFightNotification escalates robbery_or_weapon threats in bank mode', () => {
  const analysis: ClassroomAnalysis = {
    studentCount: 5,
    isFighting: false,
    severity: 'critical',
    threatCategory: 'robbery_or_weapon',
    voiceAnalysis: 'Panic shouting "hands up" detected',
    fightReason: 'Subject holding weapon near teller counter while customers raise hands.',
    summary: 'Critical robbery/weapon threat in Teller Lobby.',
    confidence: 96,
    analyzedAt: '2026-11-19T12:00:00.000Z',
    modelUsed: 'gpt-6-astra',
  };

  assert.equal(deriveSafetyStatus(analysis), 'fighting');
  const alert = evaluateFightNotification(
    { id: 'cam-bank-1', cameraCode: 'CAM-1', classroomName: 'Main Teller Lobby' },
    analysis,
    'bank'
  );
  assert.ok(alert);
  assert.equal(alert.severity, 'critical');
  assert.equal(alert.threatCategory, 'robbery_or_weapon');
  assert.equal(alert.modelUsed, 'gpt-6-astra');
  assert.match(alert.headline, /Robbery or weapon threat/i);
});

test('shouldTriggerAudioSpikeScan enforces decibel threshold and cooldown', () => {
  assert.equal(shouldTriggerAudioSpikeScan(65, 0, 20000, false), false);
  assert.equal(shouldTriggerAudioSpikeScan(92, 0, 20000, false), true);
  assert.equal(shouldTriggerAudioSpikeScan(95, 15000, 20000, false), false);
  assert.equal(shouldTriggerAudioSpikeScan(95, 0, 20000, true), false);
});

test('evaluateSoundThresholdAlert triggers strictly above 90.1 dB with teacher alert message and cooldown', () => {
  assert.equal(SOUND_ALERT_THRESHOLD_DB, 90.1);
  const cam = {
    id: 'cam-room-4',
    cameraCode: 'CAM-4',
    classroomName: 'Science Lab 4',
    studentCount: 14,
  };

  // Exactly 90.1 dB does NOT exceed 90.1 dB
  assert.equal(evaluateSoundThresholdAlert(cam, 90.1, { nowMs: 30000 }), null);

  // 91.2 dB strictly exceeds 90.1 dB -> generates teacher alert message
  const alert = evaluateSoundThresholdAlert(cam, 91.2, {
    nowMs: 30000,
    teacherEmail: 'teacher@school.edu',
    teacherName: 'Ms. Rivera',
    courseName: 'Chemistry 101',
    liveTranscript: 'Stop yelling',
  });
  assert.ok(alert);
  assert.equal(alert.alertType, 'sound-threshold');
  assert.equal(alert.measuredDb, 91.2);
  assert.equal(alert.severity, 'critical');
  assert.match(alert.headline, /91\.2 dB/);
  assert.ok(alert.teacherMessageSubject?.includes('90.1 dB'));
  assert.ok(alert.teacherMessageBody?.includes('Hello Ms. Rivera'));
  assert.ok(alert.teacherMessageBody?.includes('Chemistry 101'));

  // Cooldown suppresses duplicate alert within 15s
  assert.equal(
    evaluateSoundThresholdAlert(cam, 96.4, { lastAlertAtMs: 30000, nowMs: 35000 }),
    null
  );
});

test('computeSplDecibels maps quiet, normal speech, and shouting RMS accurately', () => {
  const quiet = new Float32Array(256).fill(0.0008);
  const speech = new Float32Array(256).fill(0.02);
  const shout = new Float32Array(256).fill(0.3);

  const quietDb = computeSplDecibels(quiet, DEFAULT_DB_CALIBRATION_OFFSET);
  const speechDb = computeSplDecibels(speech, DEFAULT_DB_CALIBRATION_OFFSET);
  const shoutDb = computeSplDecibels(shout, DEFAULT_DB_CALIBRATION_OFFSET);

  assert.ok(quietDb >= 35 && quietDb <= 48, `Expected quiet ~40 dB, got ${quietDb}`);
  assert.ok(speechDb >= 62 && speechDb <= 74, `Expected speech ~68 dB, got ${speechDb}`);
  assert.ok(shoutDb > SOUND_ALERT_THRESHOLD_DB, `Expected shout > 90.1 dB, got ${shoutDb}`);
});

test('formatFacilityLabels adapts terminology for bank, school, and all-sector modes', () => {
  const bank = formatFacilityLabels('bank');
  const school = formatFacilityLabels('school');
  const all = formatFacilityLabels('all');

  assert.equal(bank.zonePlural, 'Bank Zones');
  assert.equal(bank.personPlural, 'people');
  assert.equal(school.zonePlural, 'Classrooms');
  assert.equal(school.personPlural, 'kids');
  assert.equal(all.zonePlural, 'Monitored Zones');
});

test('computeCameraCycleStep runs 2s screen watch then 8s autonomous analyze cycle', () => {
  assert.equal(computeCameraCycleStep(0, true, false).phase, 'paused');
  assert.equal(computeCameraCycleStep(0, false, true).phase, 'waiting-signal');

  const sec0 = computeCameraCycleStep(0, true, true);
  assert.equal(sec0.phase, 'watching-screen');
  assert.equal(sec0.phaseSecondsLeft, 2);
  assert.equal(sec0.shouldCaptureAndAnalyze, false);

  const sec1 = computeCameraCycleStep(1, true, true);
  assert.equal(sec1.phase, 'watching-screen');
  assert.equal(sec1.phaseSecondsLeft, 1);
  assert.equal(sec1.shouldCaptureAndAnalyze, false);

  const sec2 = computeCameraCycleStep(2, true, true);
  assert.equal(sec2.phase, 'analyzing');
  assert.equal(sec2.phaseSecondsLeft, 8);
  assert.equal(sec2.shouldCaptureAndAnalyze, true);

  const sec9 = computeCameraCycleStep(9, true, true);
  assert.equal(sec9.phase, 'analyzing');
  assert.equal(sec9.phaseSecondsLeft, 1);
  assert.equal(sec9.shouldCaptureAndAnalyze, false);

  const sec10 = computeCameraCycleStep(10, true, true);
  assert.equal(sec10.phase, 'watching-screen');
  assert.equal(sec10.phaseSecondsLeft, 2);
});

test('formatCameraAttendanceLabel keeps live and class total distinct per camera', () => {
  assert.equal(formatCameraAttendanceLabel(24, 26, 'school'), '24 live / 26 total');
  assert.equal(formatCameraAttendanceLabel(1, undefined, 'school'), '1 kid live');
  assert.equal(formatCameraAttendanceLabel(5, undefined, 'bank'), '5 people live');
});

test('computeClassAttendance computes exact present, absent, and rate from custom total', () => {
  const full = computeClassAttendance(22, 30);
  assert.equal(full.presentCount, 22);
  assert.equal(full.absentCount, 8);
  assert.equal(full.customTotal, 30);
  assert.equal(full.attendanceRatePercent, 73);

  const emptyRoom = computeClassAttendance(0, 25);
  assert.equal(emptyRoom.presentCount, 0);
  assert.equal(emptyRoom.absentCount, 25);
  assert.equal(emptyRoom.attendanceRatePercent, 0);

  const overflow = computeClassAttendance(28, 25);
  assert.equal(overflow.absentCount, 0);
  assert.equal(overflow.attendanceRatePercent, 100);
});

test('shouldRunScheduledAttendance triggers once at or after target HH:MM on each day', () => {
  const before = new Date(2026, 10, 19, 8, 59, 0);
  const atTarget = new Date(2026, 10, 19, 9, 0, 0);
  const after = new Date(2026, 10, 19, 9, 15, 0);

  assert.equal(shouldRunScheduledAttendance('09:00', false, undefined, after), false);
  assert.equal(shouldRunScheduledAttendance('09:00', true, undefined, before), false);
  assert.equal(shouldRunScheduledAttendance('09:00', true, undefined, atTarget), true);
  assert.equal(shouldRunScheduledAttendance('09:00', true, '2026-11-19', after), false);
  assert.equal(shouldRunScheduledAttendance('09:00', true, '2026-11-18', after), true);
});

test('evaluateAttendanceReportAlert creates teacher attendance roll call message', () => {
  const alert = evaluateAttendanceReportAlert(
    {
      id: 'cam-1',
      cameraCode: 'CAM-1',
      classroomName: 'Grade 6 Math',
      studentCount: 18,
      expectedTotalCount: 24,
      attendanceCheckTime: '08:30',
    },
    {
      teacherEmail: 'math@school.edu',
      teacherName: 'Mr. Patel',
      courseName: 'Math 6A',
      now: new Date('2026-11-19T08:30:05.000Z'),
    }
  );
  assert.equal(alert.alertType, 'attendance');
  assert.match(alert.headline, /18 Present · 6 Absent/);
  assert.ok(alert.teacherMessageSubject?.includes('18 Present / 6 Absent'));
  assert.ok(alert.teacherMessageBody?.includes('Absent: 6'));
  assert.ok(alert.teacherMessageBody?.includes('Math 6A'));
});

test('computeCalibratedOffsetFromDbfs calibrates microphone sensitivity and clamps bounds', () => {
  assert.equal(computeCalibratedOffsetFromDbfs(-60, 42), 102);
  assert.equal(computeCalibratedOffsetFromDbfs(-72, 42), 114);
  assert.equal(computeCalibratedOffsetFromDbfs(-20, 42), 85);
  assert.equal(computeCalibratedOffsetFromDbfs(-90, 42), 120);
});

test('formatAiModelLabel includes Gemini 4 Neon and all supported engines', () => {
  assert.equal(formatAiModelLabel('gemini-4-neon'), 'Gemini 4 Neon');
  assert.equal(formatAiModelLabel('gemini-4-hydrogen'), 'Gemini 4 Hydrogen');
  assert.equal(formatAiModelLabel('gpt-6-astra'), 'GPT-6 Astra');
  assert.equal(formatAiModelLabel('gpt-6-sol'), 'GPT-6 Sol');
});

test('computeFrameDeltaPercent detects instant scene changes accurately', () => {
  const staticA = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255]);
  const staticB = new Uint8ClampedArray([102, 102, 102, 255, 99, 99, 99, 255, 100, 100, 100, 255, 101, 101, 101, 255]);
  const moved = new Uint8ClampedArray([220, 220, 220, 255, 100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255]);

  assert.equal(computeFrameDeltaPercent(staticA, staticB), 0);
  assert.equal(computeFrameDeltaPercent(staticA, moved), 25);
  assert.equal(computeFrameDeltaPercent(null, moved), 100);
});

test('shouldTriggerInstantContinuousScan runs zero-wait scans on change and continuously without fixed cycle limit', () => {
  // First scan triggers immediately
  assert.equal(
    shouldTriggerInstantContinuousScan({
      autoAiEnabled: true,
      hasSignal: true,
      isAnalyzing: false,
      nowMs: 1000,
      lastScanFinishedAtMs: 0,
      frameDeltaPercent: 0,
      hasNeverScanned: true,
    }).shouldScan,
    true
  );

  // Instant scene change triggers right after 250ms paint gap
  const instantChange = shouldTriggerInstantContinuousScan({
    autoAiEnabled: true,
    hasSignal: true,
    isAnalyzing: false,
    nowMs: 1300,
    lastScanFinishedAtMs: 1000,
    frameDeltaPercent: 8.5,
  });
  assert.equal(instantChange.shouldScan, true);
  assert.equal(instantChange.reason, 'instant-change');

  // Calm frame still scans continuously right after 750ms heartbeat (no 8-10s delay)
  const continuous = shouldTriggerInstantContinuousScan({
    autoAiEnabled: true,
    hasSignal: true,
    isAnalyzing: false,
    nowMs: 1800,
    lastScanFinishedAtMs: 1000,
    frameDeltaPercent: 0.4,
  });
  assert.equal(continuous.shouldScan, true);
  assert.equal(continuous.reason, 'continuous-live');

  // Never overlaps an active scan
  assert.equal(
    shouldTriggerInstantContinuousScan({
      autoAiEnabled: true,
      hasSignal: true,
      isAnalyzing: true,
      nowMs: 5000,
      lastScanFinishedAtMs: 1000,
      frameDeltaPercent: 40,
    }).reason,
    'in-flight'
  );

  // Hybrid Edge AI mode: 0 people in room stays standby (0 cloud calls), >=1 person triggers cloud threat check
  assert.equal(
    shouldTriggerInstantContinuousScan({
      autoAiEnabled: true,
      hasSignal: true,
      isAnalyzing: false,
      nowMs: 10000,
      lastScanFinishedAtMs: 1000,
      frameDeltaPercent: 12,
      hasLocalEdgeVision: true,
      localDetectedPeopleCount: 0,
    }).shouldScan,
    false
  );
  assert.equal(
    shouldTriggerInstantContinuousScan({
      autoAiEnabled: true,
      hasSignal: true,
      isAnalyzing: false,
      nowMs: 10000,
      lastScanFinishedAtMs: 1000,
      frameDeltaPercent: 12,
      hasLocalEdgeVision: true,
      localDetectedPeopleCount: 1,
    }).shouldScan,
    true
  );
});

test('filterVerifiedPersonDetections rejects low-confidence phantoms and merges nested body-part duplicates', () => {
  // Empty room returns 0
  assert.deepEqual(filterVerifiedPersonDetections([]), []);

  // Low-confidence hanging clothes / shadow guess rejected (<78%)
  assert.equal(
    filterVerifiedPersonDetections([
      { label: 'Hanging jacket shadow', box_2d: [150, 200, 450, 350], confidence: 70 },
    ]).length,
    0
  );

  // Tiny noise box rejected
  assert.equal(
    filterVerifiedPersonDetections([
      { label: 'Noise', box_2d: [100, 100, 110, 110], confidence: 95 },
    ]).length,
    0
  );

  // Valid person kept, overlapping duplicate AND nested head/torso sub-box suppressed into 1 person
  const filtered = filterVerifiedPersonDetections([
    { label: 'Person 1 (desk)', box_2d: [200, 300, 700, 550], confidence: 92 },
    { label: 'Duplicate Person 1', box_2d: [210, 310, 690, 540], confidence: 84 },
    { label: 'Head inside Person 1', box_2d: [210, 360, 380, 490], confidence: 85 },
    { label: 'Person 2 (standing)', box_2d: [180, 650, 750, 860], confidence: 89 },
  ]);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].label, 'Person 1 (desk)');
  assert.equal(filtered[1].label, 'Person 2 (standing)');
  assert.ok(computeBoxIoU([200, 300, 700, 550], [210, 310, 690, 540]) > 0.6);

  // Two distinct people standing closely front-and-back MUST BOTH be preserved (not merged into 1)
  const closelySpaced = filterVerifiedPersonDetections(
    [
      { label: 'Person front', box_2d: [120, 200, 900, 620], confidence: 88 },
      { label: 'Person slightly behind right', box_2d: [160, 460, 760, 690], confidence: 62 },
    ],
    38
  );
  assert.equal(closelySpaced.length, 2);
});

test('mergeTiledPersonDetections preserves multi-person groups across tiles without seam double-counting', () => {
  const fullFrame = [
    { label: 'Person (center)', box_2d: [150, 410, 850, 660] as [number, number, number, number], confidence: 86 },
  ];
  const leftTile = [
    // Person 1 on far left missed by full frame (tile coords 0..1000 -> 0..600)
    { label: 'Person (left)', box_2d: [220, 80, 760, 360] as [number, number, number, number], confidence: 54 },
    // Clipped right half of center person touching tile seam (xmax=995 -> 597)
    { label: 'Person (right)', box_2d: [155, 690, 845, 995] as [number, number, number, number], confidence: 71 },
  ];
  const rightTile = [
    // Person 3 on far right missed by full frame (tile coords 0..1000 -> 400..1000)
    { label: 'Person (right)', box_2d: [200, 620, 780, 940] as [number, number, number, number], confidence: 59 },
  ];

  const merged = mergeTiledPersonDetections(fullFrame, leftTile, rightTile, 38);
  assert.equal(merged.length, 3);
  // Sorted left-to-right
  assert.ok(merged[0].box_2d[1] < merged[1].box_2d[1]);
  assert.ok(merged[1].box_2d[1] < merged[2].box_2d[1]);
});

test('stepPersonTracker locks onto 2nd occluded person, prevents 2->1->2 flicker, and clears empty room to 0', () => {
  const p1 = { label: 'Person (left)', box_2d: [150, 120, 820, 420] as [number, number, number, number], confidence: 86 };
  const p2Occluded = { label: 'Person (right)', box_2d: [220, 520, 780, 790] as [number, number, number, number], confidence: 54 };

  // Frame 1: p1 instant (>=62%), p2 pending (54%)
  const f1 = stepPersonTracker({ confirmed: [], pending: [] }, [p1, p2Occluded]);
  assert.equal(f1.people.length, 1);

  // Frame 2: p2 seen 2 frames in a row -> locks in as 2 people
  const f2 = stepPersonTracker(f1.nextState, [p1, p2Occluded]);
  assert.equal(f2.people.length, 2);

  // Frame 3: p2 blinks out for 1 frame while turning -> stays steady at 2 (no flicker)
  const f3 = stepPersonTracker(f2.nextState, [p1]);
  assert.equal(f3.people.length, 2);

  // Frame 4 & 5: everyone leaves room (0 raw detections for 2 frames) -> clears cleanly to 0
  const f4 = stepPersonTracker(f3.nextState, []);
  const f5 = stepPersonTracker(f4.nextState, []);
  assert.equal(f5.people.length, 0);
});

test('evaluateLocalSafetyAnalysis provides on-device safety alerts with zero cloud quota', () => {
  const calm = evaluateLocalSafetyAnalysis({
    detectedPeople: [
      { label: 'Person (left)', box_2d: [150, 100, 820, 380], confidence: 88 },
      { label: 'Person (right)', box_2d: [160, 560, 830, 850], confidence: 84 },
    ],
    voiceTranscript: 'Working quietly on math problems',
    audioLevel: 54.0,
    facilityMode: 'school',
  });
  assert.equal(calm.studentCount, 2);
  assert.equal(calm.isFighting, false);
  assert.equal(calm.severity, 'none');

  const beating = evaluateLocalSafetyAnalysis({
    detectedPeople: [
      { label: 'Person (center)', box_2d: [150, 260, 820, 560], confidence: 90 },
      { label: 'Person (center)', box_2d: [170, 420, 830, 720], confidence: 86 },
    ],
    voiceTranscript: 'Stop hitting him, help!',
    audioLevel: 85.4,
    facilityMode: 'school',
    audioSpikeDetected: true,
  });
  assert.equal(beating.studentCount, 2);
  assert.equal(beating.isFighting, true);
  assert.equal(beating.severity, 'critical');
  assert.equal(beating.threatCategory, 'beating');

  const bullying = evaluateLocalSafetyAnalysis({
    detectedPeople: [
      { label: 'Person 1', box_2d: [150, 180, 820, 460], confidence: 88 },
      { label: 'Person 2', box_2d: [160, 320, 820, 600], confidence: 84 },
      { label: 'Person 3', box_2d: [160, 460, 820, 740], confidence: 81 },
    ],
    voiceTranscript: 'Stop bullying me, leave me alone!',
    audioLevel: 74.2,
    facilityMode: 'school',
  });
  assert.equal(bullying.isFighting, true);
  assert.equal(bullying.severity, 'critical');
  assert.equal(bullying.threatCategory, 'bullying');
});

test('evaluateFightNotification, deriveSafetyStatus, formatAlertCategoryBadge, and filterIncidentAlerts support Beating and Bullying alerts', () => {
  const cam = { id: 'cam-9', cameraCode: 'CAM-9', classroomName: 'Hallway West', studentCount: 3, lastAnalysis: null };

  const beatingAnalysis: ClassroomAnalysis = {
    studentCount: 2,
    isFighting: true,
    severity: 'critical',
    threatCategory: 'beating',
    voiceAnalysis: 'Shouting "stop beating me"',
    fightReason: 'Repeated physical strikes on fallen student',
    summary: 'Beating incident detected.',
    confidence: 95,
    analyzedAt: '2026-11-20T14:30:00.000Z',
  };
  assert.equal(deriveSafetyStatus(beatingAnalysis), 'fighting');
  const beatingAlert = evaluateFightNotification(cam, beatingAnalysis, 'school');
  assert.ok(beatingAlert);
  assert.equal(beatingAlert.severity, 'critical');
  assert.equal(beatingAlert.threatCategory, 'beating');
  assert.match(beatingAlert.headline, /BEATING ALERT/i);
  assert.equal(formatAlertCategoryBadge(beatingAlert).label, 'BEATING ALERT');

  const bullyingAlert = evaluateVoiceCueThreatAlert(
    cam,
    'Stop bullying him, leave him alone!',
    73.5,
    'school',
    { nowMs: 20000, lastAlertAtMs: 0 }
  );
  assert.ok(bullyingAlert);
  assert.equal(bullyingAlert.threatCategory, 'bullying');
  assert.match(bullyingAlert.headline, /BULLYING ALERT/i);
  assert.equal(formatAlertCategoryBadge(bullyingAlert).label, 'BULLYING ALERT');

  // Cooldown prevents duplicate voice-cue spam within 10s
  const suppressed = evaluateVoiceCueThreatAlert(
    cam,
    'Stop bullying him!',
    73.5,
    'school',
    { nowMs: 25000, lastAlertAtMs: 20000, cooldownMs: 10000 }
  );
  assert.equal(suppressed, null);

  // Filter by beating and bullying specifically
  const allAlerts: IncidentAlert[] = [beatingAlert, bullyingAlert];
  assert.equal(filterIncidentAlerts(allAlerts, 'beating', 'all').length, 1);
  assert.equal(filterIncidentAlerts(allAlerts, 'beating', 'all')[0].threatCategory, 'beating');
  assert.equal(filterIncidentAlerts(allAlerts, 'bullying', 'all').length, 1);
  assert.equal(filterIncidentAlerts(allAlerts, 'bullying', 'all')[0].threatCategory, 'bullying');
});

test('parseSafeJsonText safely catches HTML <!doctype> fallback pages instead of throwing SyntaxError', () => {
  const valid = parseSafeJsonText<{ ok: boolean }>('{"ok":true}');
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.data.ok, true);

  const html = parseSafeJsonText('<!doctype html><html><body>502 Bad Gateway</body></html>');
  assert.equal(html.ok, false);
  if (!html.ok) assert.equal(html.isHtml, true);

  const empty = parseSafeJsonText('   ');
  assert.equal(empty.ok, false);
});

test('evaluateRealtimeEdgeThreat ignores normal movement and reliably detects genuine multi-person fights, beatings, bullying, and weapons', () => {
  const calmPeople = [
    { label: 'Person (left)', box_2d: [150, 80, 820, 320] as [number, number, number, number], confidence: 90 },
    { label: 'Person (right)', box_2d: [160, 620, 830, 880] as [number, number, number, number], confidence: 88 },
  ];

  // 1a. Single person moving rapidly across webcam MUST NEVER trigger fighting or beating
  let soloState = createInitialEdgeThreatState();
  for (let i = 0; i < 6; i += 1) {
    const shiftedBox: [number, number, number, number] = [140, 120 + i * 90, 900, 520 + i * 90];
    const res = evaluateRealtimeEdgeThreat(soloState, {
      people: [{ label: 'Person (center)', box_2d: shiftedBox, confidence: 88 }],
      dangerousObjects: [],
      frameDeltaPercent: 28.0,
      voiceTranscript: '',
      audioLevel: 76,
      facilityMode: 'school',
      nowMs: 1000 + i * 300,
    });
    soloState = res.nextState;
    assert.equal(res.analysis, null);
    assert.equal(res.shouldEmitAlert, false);
  }

  // 1b. Two people sitting closely side-by-side moving arms (no box collision) -> ZERO false fight alert
  const sideBySidePeople = [
    { label: 'Person (left)', box_2d: [150, 140, 820, 440] as [number, number, number, number], confidence: 90 },
    { label: 'Person (right)', box_2d: [160, 455, 830, 760] as [number, number, number, number], confidence: 88 },
  ];
  let calmState = createInitialEdgeThreatState();
  for (let i = 0; i < 6; i += 1) {
    const res = evaluateRealtimeEdgeThreat(calmState, {
      people: sideBySidePeople,
      dangerousObjects: [],
      frameDeltaPercent: 10.5,
      voiceTranscript: '',
      audioLevel: 65,
      facilityMode: 'school',
      nowMs: 5000 + i * 300,
    });
    calmState = res.nextState;
    assert.equal(res.analysis, null);
    assert.equal(res.shouldEmitAlert, false);
  }

  // 1c. Two people walking smoothly in the SAME direction (passing behind booth) -> ZERO false fight alert
  let walkState = createInitialEdgeThreatState();
  for (let i = 0; i < 6; i += 1) {
    const walkShift = i * 42;
    const walkingPair = [
      { label: 'Person (left)', box_2d: [160, 120 + walkShift, 820, 380 + walkShift] as [number, number, number, number], confidence: 90 },
      { label: 'Person (right)', box_2d: [170, 290 + walkShift, 830, 550 + walkShift] as [number, number, number, number], confidence: 88 },
    ];
    const res = evaluateRealtimeEdgeThreat(walkState, {
      people: walkingPair,
      dangerousObjects: [],
      frameDeltaPercent: 18.0,
      voiceTranscript: '',
      audioLevel: 58,
      facilityMode: 'school',
      nowMs: 7000 + i * 300,
    });
    walkState = res.nextState;
    assert.equal(res.analysis, null);
    assert.equal(res.shouldEmitAlert, false);
  }

  // 1d. Three calm exhibition visitors standing side-by-side with small jitter -> ZERO false bullying alert
  let calmCrowdState = createInitialEdgeThreatState();
  for (let i = 0; i < 6; i += 1) {
    const jitter = i % 2 === 0 ? 0 : 4;
    const calmVisitors = [
      { label: 'Person (left)', box_2d: [180, 160 + jitter, 820, 400 + jitter] as [number, number, number, number], confidence: 88 },
      { label: 'Person (center)', box_2d: [200, 390 - jitter, 820, 610 - jitter] as [number, number, number, number], confidence: 86 },
      { label: 'Person (right)', box_2d: [180, 600 + jitter, 820, 840 + jitter] as [number, number, number, number], confidence: 87 },
    ];
    const res = evaluateRealtimeEdgeThreat(calmCrowdState, {
      people: calmVisitors,
      dangerousObjects: [],
      frameDeltaPercent: 8.0,
      voiceTranscript: '',
      audioLevel: 60,
      facilityMode: 'school',
      nowMs: 8500 + i * 300,
    });
    calmCrowdState = res.nextState;
    assert.equal(res.analysis, null);
    assert.equal(res.shouldEmitAlert, false);
  }

  // 2. Genuine silent visual fight (opposing relative clash with overlapping contact across 5 frames)
  let fightState = createInitialEdgeThreatState();
  let fightResult = null as ReturnType<typeof evaluateRealtimeEdgeThreat> | null;
  for (let i = 0; i < 6; i += 1) {
    const lungeA = i % 2 === 0 ? 0 : 34;
    const lungeB = i % 2 === 0 ? 0 : -32;
    const clashingPeople = [
      { label: 'Person (center)', box_2d: [160, 280 + lungeA, 820, 560 + lungeA] as [number, number, number, number], confidence: 91 },
      { label: 'Person (center)', box_2d: [170, 420 + lungeB, 830, 700 + lungeB] as [number, number, number, number], confidence: 87 },
    ];
    fightResult = evaluateRealtimeEdgeThreat(fightState, {
      people: clashingPeople,
      dangerousObjects: [],
      frameDeltaPercent: 21.0,
      voiceTranscript: '',
      audioLevel: 0,
      facilityMode: 'school',
      nowMs: 10000 + i * 300,
    });
    fightState = fightResult.nextState;
  }
  assert.equal(fightResult?.shouldEmitAlert, true);
  assert.equal(fightResult?.analysis?.threatCategory, 'fight');
  assert.equal(fightResult?.analysis?.severity, 'critical');

  // 3. Genuine silent visual beating (victim collapsed horizontally on floor under active opposing strikes)
  let beatState = createInitialEdgeThreatState();
  let beatResult = null as ReturnType<typeof evaluateRealtimeEdgeThreat> | null;
  for (let i = 0; i < 5; i += 1) {
    const strikeShift = i % 2 === 0 ? 0 : 48;
    const victimShift = i % 2 === 0 ? 0 : -24;
    const beatingPeople = [
      { label: 'Person (center)', box_2d: [160, 310 + strikeShift, 820, 580 + strikeShift] as [number, number, number, number], confidence: 92 },
      // Horizontal fallen victim box (width 440 / height 240 = 1.83 >= 1.42, ymin 540 >= 370)
      { label: 'Person (center)', box_2d: [540, 350 + victimShift, 780, 790 + victimShift] as [number, number, number, number], confidence: 84 },
    ];
    beatResult = evaluateRealtimeEdgeThreat(beatState, {
      people: beatingPeople,
      dangerousObjects: [],
      frameDeltaPercent: 18.5,
      voiceTranscript: '',
      audioLevel: 0,
      facilityMode: 'school',
      nowMs: 20000 + i * 300,
    });
    beatState = beatResult.nextState;
  }
  assert.equal(beatResult?.shouldEmitAlert, true);
  assert.equal(beatResult?.analysis?.threatCategory, 'beating');

  // 4a. Genuine 2-person visual bullying (aggressor shoving/advancing into retreating & crouching victim)
  let pairBullyState = createInitialEdgeThreatState();
  let pairBullyResult = null as ReturnType<typeof evaluateRealtimeEdgeThreat> | null;
  for (let i = 0; i < 5; i += 1) {
    const aggressorX = 240 + i * 28;
    const victimX = 480 + i * 22;
    const victimTop = 210 + i * 32; // crouching/flinching downward while retreating
    pairBullyResult = evaluateRealtimeEdgeThreat(pairBullyState, {
      people: [
        { label: 'Person (left)', box_2d: [150, aggressorX, 840, aggressorX + 240], confidence: 90 },
        { label: 'Person (right)', box_2d: [victimTop, victimX, 840, victimX + 200], confidence: 86 },
      ],
      dangerousObjects: [],
      frameDeltaPercent: 12.5,
      voiceTranscript: '',
      audioLevel: 0,
      facilityMode: 'school',
      nowMs: 26000 + i * 300,
    });
    pairBullyState = pairBullyResult.nextState;
  }
  assert.equal(pairBullyResult?.shouldEmitAlert, true);
  assert.equal(pairBullyResult?.analysis?.threatCategory, 'bullying');

  // 4b. Genuine 3-person group visual bullying (bilateral flankers closing inward around center target)
  let bullyState = createInitialEdgeThreatState();
  let bullyResult = null as ReturnType<typeof evaluateRealtimeEdgeThreat> | null;
  for (let i = 0; i < 5; i += 1) {
    const press = i * 16;
    const crowdingPeople = [
      { label: 'Person (left)', box_2d: [180, 180 + press, 820, 420 + press] as [number, number, number, number], confidence: 88 },
      { label: 'Person (center)', box_2d: [220 + i * 8, 410, 820, 610] as [number, number, number, number], confidence: 85 },
      { label: 'Person (right)', box_2d: [180, 600 - press, 820, 840 - press] as [number, number, number, number], confidence: 87 },
    ];
    bullyResult = evaluateRealtimeEdgeThreat(bullyState, {
      people: crowdingPeople,
      dangerousObjects: [],
      frameDeltaPercent: 12.5,
      voiceTranscript: '',
      audioLevel: 0,
      facilityMode: 'school',
      nowMs: 30000 + i * 300,
    });
    bullyState = bullyResult.nextState;
  }
  assert.equal(bullyResult?.shouldEmitAlert, true);
  assert.equal(bullyResult?.analysis?.threatCategory, 'bullying');

  // 5. On-device weapon object detection requires multi-frame confirmation (no 1-frame fluke)
  const weaponObj = {
    label: 'Knife / Blade',
    category: 'weapon' as const,
    box_2d: [380, 260, 490, 350] as [number, number, number, number],
    confidence: 86,
  };
  const w1 = evaluateRealtimeEdgeThreat(createInitialEdgeThreatState(), {
    people: [calmPeople[0]],
    dangerousObjects: [weaponObj],
    frameDeltaPercent: 2.0,
    voiceTranscript: '',
    audioLevel: 0,
    facilityMode: 'all',
    nowMs: 40000,
  });
  assert.equal(w1.shouldEmitAlert, false);
  const weaponRes = evaluateRealtimeEdgeThreat(w1.nextState, {
    people: [calmPeople[0]],
    dangerousObjects: [weaponObj],
    frameDeltaPercent: 2.0,
    voiceTranscript: '',
    audioLevel: 0,
    facilityMode: 'all',
    nowMs: 40300,
  });
  assert.equal(weaponRes.shouldEmitAlert, true);
  assert.equal(weaponRes.analysis?.threatCategory, 'robbery_or_weapon');

  // 6. Auto-recovers cleanly to calm after 12 consecutive calm frames
  let recoveryState = weaponRes.nextState;
  let cleared = false;
  for (let i = 0; i < 12; i += 1) {
    const r = evaluateRealtimeEdgeThreat(recoveryState, {
      people: calmPeople,
      dangerousObjects: [],
      frameDeltaPercent: 1.0,
      voiceTranscript: '',
      audioLevel: 0,
      facilityMode: 'all',
      nowMs: 41000 + i * 300,
    });
    recoveryState = r.nextState;
    if (r.shouldClearThreat) cleared = true;
  }
  assert.equal(cleared, true);
  assert.equal(recoveryState.activeThreatCategory, 'none');
});

test('wifiCameraPresets builds valid HTTP URLs, embeds auth, detects private LAN, and rejects raw RTSP', () => {
  assert.equal(isPrivateLanHost('192.168.1.42'), true);
  assert.equal(isPrivateLanHost('10.0.0.15'), true);
  assert.equal(isPrivateLanHost('172.16.5.9'), true);
  assert.equal(isPrivateLanHost('camera.example.com'), false);

  const androidCam = buildWifiCameraUrl({
    brandId: 'ip-webcam',
    hostOrUrl: '192.168.1.50',
  });
  assert.equal(androidCam.ok, true);
  if (androidCam.ok) {
    assert.equal(androidCam.url, 'http://192.168.1.50:8080/shot.jpg');
    assert.equal(androidCam.isPrivateLan, true);
  }

  const hikvisionCam = buildWifiCameraUrl({
    brandId: 'hikvision',
    hostOrUrl: '192.168.1.64',
    username: 'admin',
    password: 'secret',
  });
  assert.equal(hikvisionCam.ok, true);
  if (hikvisionCam.ok) {
    assert.equal(
      hikvisionCam.url,
      'http://admin:secret@192.168.1.64/ISAPI/Streaming/channels/101/picture'
    );
  }

  const reolinkCam = buildWifiCameraUrl({
    brandId: 'reolink',
    hostOrUrl: 'cam.school.org',
    username: 'admin',
    password: 'pw',
  });
  assert.equal(reolinkCam.ok, true);
  if (reolinkCam.ok) {
    assert.equal(
      reolinkCam.url,
      'http://cam.school.org/cgi-bin/api.cgi?cmd=Snap&channel=0&user=admin&password=pw'
    );
    assert.equal(reolinkCam.isPrivateLan, false);
  }

  const rtspRejected = buildWifiCameraUrl({
    brandId: 'custom-url',
    hostOrUrl: 'rtsp://192.168.1.90:554/stream1',
  });
  assert.equal(rtspRejected.ok, false);
  if (!rtspRejected.ok) {
    assert.match(rtspRejected.error, /rtsp/i);
  }
});

test('stepPersonTracker stays locked when a person covers their face with a tennis racket or hand, and drops cleanly to 0 when they leave', () => {
  const personTorso = [
    68, 72, 70, 65, 69, 71,
    80, 84, 82, 79, 81, 83,
    92, 95, 90, 88, 91, 94,
    75, 78, 74, 72, 76, 77,
  ];
  const emptyChair = [
    185, 190, 188, 192, 186, 189,
    180, 182, 184, 179, 181, 183,
    176, 178, 175, 177, 174, 179,
    170, 172, 171, 169, 173, 171,
  ];

  assert.ok(computeTorsoPatchSimilarity(personTorso, personTorso.map((v) => v + 4)) >= 0.85);
  assert.ok(computeTorsoPatchSimilarity(personTorso, emptyChair) < 0.45);

  const personBox: [number, number, number, number] = [140, 260, 920, 740];
  const racketOverFace = {
    label: 'Tennis Racket',
    category: 'occluder' as const,
    box_2d: [120, 320, 490, 660] as [number, number, number, number],
    confidence: 64,
  };
  assert.equal(findFaceOccluderForPerson(personBox, [racketOverFace])?.label, 'Tennis Racket');

  // Frames 1-2: Person sits normally in front of camera (builds solid track + torso signature)
  let state = { confirmed: [], pending: [] } as ReturnType<typeof stepPersonTracker>['nextState'];
  const f1 = stepPersonTracker(
    state,
    [{ label: 'Person (center)', box_2d: personBox, confidence: 82 }],
    { sampleTorsoSignature: () => personTorso }
  );
  state = f1.nextState;
  const f2 = stepPersonTracker(
    state,
    [{ label: 'Person (center)', box_2d: personBox, confidence: 84 }],
    { sampleTorsoSignature: () => personTorso }
  );
  state = f2.nextState;
  assert.equal(f2.people.length, 1);

  // Frames 3-12: Person holds a Tennis Racket directly over their face -> COCO-SSD drops person to 0%!
  // Smart occlusion tracker MUST keep counting 1 person & label them "Face Covered · Tennis Racket"!
  let lastPeople = f2.people;
  for (let i = 0; i < 10; i += 1) {
    const res = stepPersonTracker(state, [], {
      occluderObjects: [racketOverFace],
      sampleTorsoSignature: () => personTorso.map((v) => v + (i % 3)),
    });
    state = res.nextState;
    lastPeople = res.people;
  }
  assert.equal(lastPeople.length, 1);
  assert.equal(lastPeople[0].faceOccluded, true);
  assert.match(lastPeople[0].label, /Tennis Racket/i);

  // Frames 13-16: Person puts racket down and covers face with bare hands (no COCO occluder object,
  // but shoulders/torso signature still matches!) -> MUST stay locked at 1!
  for (let i = 0; i < 4; i += 1) {
    const res = stepPersonTracker(state, [], {
      occluderObjects: [],
      sampleTorsoSignature: () => personTorso.map((v) => v - 2),
    });
    state = res.nextState;
    lastPeople = res.people;
  }
  assert.equal(lastPeople.length, 1);
  assert.equal(lastPeople[0].faceOccluded, true);

  // Frames 17-19: Person stands up and walks away (no racket + torso pixels change to empty background)
  // -> MUST drop cleanly to 0 with zero ghost boxes!
  for (let i = 0; i < 3; i += 1) {
    const res = stepPersonTracker(state, [], {
      occluderObjects: [],
      sampleTorsoSignature: () => emptyChair,
    });
    state = res.nextState;
    lastPeople = res.people;
  }
  assert.equal(lastPeople.length, 0);
});

test('mergeTiledPersonDetections and stepPersonTracker never hallucinate a phantom 2nd person when 1 user sits close-up or shifts position', () => {
  // 1. Single centered close-up person sliced by left/right 60% tiles -> MUST stay strictly 1 person
  const fullFrame = [
    { label: 'Person (center)', box_2d: [120, 180, 980, 820] as [number, number, number, number], confidence: 89 },
  ];
  const leftTileHalf = [
    // Right edge at 575 (inside full person)
    { label: 'Person (center)', box_2d: [180, 310, 980, 958] as [number, number, number, number], confidence: 76 },
  ];
  const rightTileHalf = [
    // Left edge at 430 (inside full person, shifted vertically)
    { label: 'Person (right)', box_2d: [250, 50, 980, 680] as [number, number, number, number], confidence: 74 },
  ];
  const merged = mergeTiledPersonDetections(fullFrame, leftTileHalf, rightTileHalf, 48);
  assert.equal(merged.length, 1);

  // 2. Single person shifts from left-center to right-center while holding a racket -> MUST stay 1 person (no ghost clone!)
  const torso = [
    60, 75, 90, 65, 80, 95,
    70, 85, 100, 72, 88, 92,
    68, 82, 96, 70, 84, 90,
    64, 78, 91, 66, 80, 86,
  ];
  let tracker = { confirmed: [], pending: [] } as ReturnType<typeof stepPersonTracker>['nextState'];
  const s1 = stepPersonTracker(
    tracker,
    [{ label: 'Person (center)', box_2d: [120, 180, 950, 560], confidence: 86 }],
    { sampleTorsoSignature: () => torso }
  );
  tracker = s1.nextState;
  const s2 = stepPersonTracker(
    tracker,
    [{ label: 'Person (center)', box_2d: [120, 180, 950, 560], confidence: 88 }],
    { sampleTorsoSignature: () => torso }
  );
  tracker = s2.nextState;

  // User shifts right to [120, 360, 950, 760] while an occluder sits near old box
  const s3 = stepPersonTracker(
    tracker,
    [{ label: 'Person (center)', box_2d: [120, 360, 950, 760], confidence: 87 }],
    {
      occluderObjects: [
        { label: 'Tennis Racket', category: 'occluder', box_2d: [150, 220, 480, 500], confidence: 65 },
      ],
      sampleTorsoSignature: () => torso,
    }
  );
  assert.equal(s3.people.length, 1);
});

test('computeAspectPreservingSize preserves portrait phone and landscape aspect ratios for cross-device AI detection', () => {
  // Portrait smartphone camera (720x1280) stays portrait (360x640) instead of squashing into 640x360
  assert.deepEqual(computeAspectPreservingSize(720, 1280, 640), { width: 360, height: 640 });

  // Landscape 1080p webcam scales cleanly to 640x360
  assert.deepEqual(computeAspectPreservingSize(1920, 1080, 640), { width: 640, height: 360 });

  // Low-res secondary webcam (320x240) is never upscaled beyond native resolution
  assert.deepEqual(computeAspectPreservingSize(320, 240, 640), { width: 320, height: 240 });

  // Invalid dimensions fall back safely
  assert.deepEqual(computeAspectPreservingSize(0, 0, 640), { width: 640, height: 360 });
});

test('computeContainDrawRect and mapNormalizedBoxToRect align bounding boxes accurately on portrait mobile feeds', () => {
  // Portrait 360x640 video rendered inside 640x360 16:9 display canvas -> pillarboxed at center
  const rect = computeContainDrawRect(360, 640, 640, 360);
  assert.equal(rect.height, 360);
  assert.equal(rect.width, 203);
  assert.equal(rect.x, 219);
  assert.equal(rect.y, 0);

  // Person occupying full portrait width (100..900) and mid-height (200..800) maps inside pillarbox rect
  const mapped = mapNormalizedBoxToRect([200, 100, 800, 900], rect);
  assert.equal(mapped.x, Math.round(219 + 0.1 * 203));
  assert.equal(mapped.y, Math.round(0.2 * 360));
  assert.equal(mapped.width, Math.round(0.8 * 203));
  assert.equal(mapped.height, Math.round(0.6 * 360));
});

test('stepPersonTracker detects dim secondary-device humans at 40% confidence in 2 frames while rejecting 1-frame noise', () => {
  const dimPerson = {
    label: 'Person (center)',
    box_2d: [140, 240, 880, 720] as [number, number, number, number],
    confidence: 40,
  };

  // Single-frame 40% glitch must stay pending (0 confirmed -> zero false positives)
  const noiseFrame = stepPersonTracker({ confirmed: [], pending: [] }, [dimPerson]);
  assert.equal(noiseFrame.people.length, 0);

  // If glitch disappears on frame 2, stays 0
  const clearedNoise = stepPersonTracker(noiseFrame.nextState, []);
  assert.equal(clearedNoise.people.length, 0);

  // Real human on dim secondary laptop/phone seen 2 consecutive frames at 40% -> confirmed cleanly!
  const confirmedFrame = stepPersonTracker(noiseFrame.nextState, [dimPerson]);
  assert.equal(confirmedFrame.people.length, 1);
});

test('microphone-only zones trigger voice-cue beating alerts and >90.1 dB sound threshold alerts with zero video', () => {
  const micZone = {
    id: 'mic-1',
    cameraCode: 'MIC-1',
    classroomName: 'Hallway West Mic',
    studentCount: 0,
    lastAnalysis: null,
  };

  const voiceAlert = evaluateVoiceCueThreatAlert(
    micZone,
    'help stop hitting me',
    76.5,
    'school',
    { nowMs: 50000, lastAlertAtMs: 0 }
  );
  assert.ok(voiceAlert);
  assert.equal(voiceAlert.severity, 'critical');
  assert.equal(voiceAlert.threatCategory, 'beating');
  assert.match(voiceAlert.headline, /BEATING ALERT/i);

  // Sound threshold (>90.1 dB) fires alert on mic-only zone, while <=90.1 dB stays quiet
  const atThreshold = evaluateSoundThresholdAlert(micZone, 90.1, { nowMs: 60000 });
  assert.equal(atThreshold, null);

  const sustainedLoud = evaluateSoundThresholdAlert(micZone, 93.4, {
    nowMs: 60000,
    sustainedSeconds: 3,
    liveTranscript: 'loud screaming in hallway',
  });
  assert.ok(sustainedLoud);
  assert.equal(sustainedLoud.alertType, 'sound-threshold');
  assert.equal(sustainedLoud.severity, 'critical');
  assert.equal(sustainedLoud.measuredDb, 93.4);
});

test('Disaster Management Mode adapts branding, distress keywords, >90.1 dB structural collapse alerts, 3-phase classification, fallen victim alerts, stampede alerts, and offline resilience badge', () => {
  const schoolBrand = formatOperationModeBranding('school', 'school');
  assert.equal(schoolBrand.workspaceNavLabel, 'Teacher Hub');

  const disasterBrand = formatOperationModeBranding('disaster', 'school');
  assert.equal(disasterBrand.workspaceNavLabel, 'PA & Rescue');
  assert.equal(disasterBrand.workspaceFullTitle, 'Emergency Command & PA Speaker Dispatch');
  assert.equal(disasterBrand.dispatchButtonLabel, 'PA Broadcast');
  assert.equal(
    disasterBrand.headerSubtitle,
    'AI-Powered Disaster Management, Stampede Prevention & Emergency Rescue System (Campus & Public Safety)'
  );

  // Disaster distress cues trigger in Disaster Mode (including 'collapse')
  for (const cue of ['help', 'trapped', 'fire', 'earthquake', 'flood', 'collapse', 'medical', 'emergency']) {
    assert.equal(matchDisasterDistressKeyword(`Please send ${cue} immediately!`), cue);
  }

  const shelterCam = {
    id: 'cam-shelter-1',
    cameraCode: 'CAM-1',
    classroomName: 'Relief Camp Gate A',
    studentCount: 22,
    lastAnalysis: null,
  };

  const trappedAlert = evaluateVoiceCueThreatAlert(
    shelterCam,
    'Someone is trapped under the stairwell after the collapse!',
    78.2,
    'all',
    { nowMs: 90000, lastAlertAtMs: 0, operationMode: 'disaster' }
  );
  assert.ok(trappedAlert);
  assert.equal(trappedAlert.severity, 'critical');
  assert.equal(trappedAlert.disasterPhase, 2);
  assert.equal(classifyDisasterPhase(trappedAlert).phase, 2);
  assert.match(trappedAlert.headline, /DISASTER DISTRESS VOICE ALERT/i);

  // >90.1 dB spike in Disaster Mode labels as ACOUSTIC DISTRESS / STRUCTURAL COLLAPSE ALERT (Phase 2)
  const collapseSpike = evaluateSoundThresholdAlert(shelterCam, 94.8, {
    nowMs: 95000,
    sustainedSeconds: 3.4,
    operationMode: 'disaster',
  });
  assert.ok(collapseSpike);
  assert.equal(collapseSpike.disasterPhase, 2);
  assert.match(collapseSpike.headline, /ACOUSTIC DISTRESS \/ STRUCTURAL COLLAPSE ALERT/i);

  // Stampede alert captures live count, threshold & Phase 1 classification (plus panic velocity spike support)
  const stampedeAlert = evaluateStampedeRiskAlert(shelterCam, 22, 15, { nowMs: 96000 });
  assert.equal(stampedeAlert.severity, 'critical');
  assert.equal(stampedeAlert.disasterPhase, 1);
  assert.equal(classifyDisasterPhase(stampedeAlert).phase, 1);
  assert.match(stampedeAlert.headline, /STAMPEDE \/ OVERCROWDING RISK/i);
  assert.match(stampedeAlert.details, /22 people/);
  assert.match(stampedeAlert.details, /threshold of 15/);

  const panicAlert = evaluateStampedeRiskAlert(shelterCam, 4, 15, {
    nowMs: 96500,
    panicVelocitySpike: true,
    peakTrailVelocity: 340,
  });
  assert.equal(panicAlert.disasterPhase, 1);
  assert.match(panicAlert.headline, /PANIC VELOCITY SPIKE/i);

  // Phase 2 Fallen / Collapsed Victim Alert fires instantly and respects cooldown
  const fallenAlert = evaluateFallenVictimAlert(
    shelterCam,
    { id: 'SUBJ-03', fallenDurationMs: 1850, confidence: 88 },
    { nowMs: 97000, lastAlertAtMs: 0 }
  );
  assert.ok(fallenAlert);
  assert.equal(fallenAlert.severity, 'critical');
  assert.equal(fallenAlert.disasterPhase, 2);
  assert.equal(classifyDisasterPhase(fallenAlert).phase, 2);
  assert.match(fallenAlert.headline, /FALLEN \/ COLLAPSED VICTIM DETECTED/i);

  const fallenCooldownBlocked = evaluateFallenVictimAlert(
    shelterCam,
    { id: 'SUBJ-03', fallenDurationMs: 2500 },
    { nowMs: 100000, lastAlertAtMs: 97000, cooldownMs: 15000 }
  );
  assert.equal(fallenCooldownBlocked, null);

  // Phase 3 classification for Missing Person / Evacuee Re-ID
  assert.equal(
    classifyDisasterPhase({
      alertType: 'ai-vision',
      headline: 'MISSING PERSON / EVACUEE LOCATED: Child in Red Jacket',
      threatCategory: 'intrusion',
      details: 'Cross-camera HSV Re-ID match',
    }).phase,
    3
  );

  // Offline resilience status badge strings
  const online = getOfflineResilienceStatus(true);
  assert.equal(online.badgeLabel, 'ONLINE: Edge + Cloud AI Synced');
  assert.equal(online.isOnline, true);

  const offline = getOfflineResilienceStatus(false);
  assert.equal(offline.badgeLabel, 'OFFLINE RESILIENCE MODE: 100% Local Edge AI Active');
  assert.equal(offline.isOnline, false);
  assert.match(offline.bannerDetail, /TensorFlow\.js/i);
});

test('still uploaded photos, mixed-height stationary people near frame edges, and Disaster Mode crowds NEVER trigger false bullying alerts', () => {
  // 1. Tall adult + shorter child/person standing completely still next to frame edge -> ZERO bullying!
  const tallAndShortStatic: Array<{ label: string; box_2d: [number, number, number, number]; confidence: number }> = [
    { label: 'Person (left)', box_2d: [120, 120, 860, 360], confidence: 90 }, // taller (h=740)
    { label: 'Person (left)', box_2d: [340, 15, 860, 175], confidence: 88 },  // shorter (h=520) near left edge (xmin=15)
  ];
  let staticState = createInitialEdgeThreatState();
  for (let i = 0; i < 8; i += 1) {
    const res = evaluateRealtimeEdgeThreat(staticState, {
      people: tallAndShortStatic,
      dangerousObjects: [],
      frameDeltaPercent: 1.5,
      voiceTranscript: '',
      audioLevel: 45,
      facilityMode: 'school',
      operationMode: 'school',
      nowMs: 100000 + i * 300,
    });
    staticState = res.nextState;
    assert.equal(res.analysis, null);
    assert.equal(res.shouldEmitAlert, false);
  }

  // 2. Uploaded STILL PHOTO (isStillImage: true) with dense overlapping crowd -> NEVER fires bullying/fight/beating,
  //    but STILL detects weapons!
  const densePhotoCrowd: Array<{ label: string; box_2d: [number, number, number, number]; confidence: number }> = [
    { label: 'Person', box_2d: [160, 180, 820, 420], confidence: 88 },
    { label: 'Person', box_2d: [220, 360, 820, 560], confidence: 86 },
    { label: 'Person', box_2d: [160, 520, 820, 760], confidence: 87 },
  ];
  let stillState = createInitialEdgeThreatState();
  for (let i = 0; i < 6; i += 1) {
    const res = evaluateRealtimeEdgeThreat(stillState, {
      people: densePhotoCrowd,
      dangerousObjects: [],
      frameDeltaPercent: 25,
      voiceTranscript: 'stop bullying me',
      audioLevel: 85,
      facilityMode: 'school',
      operationMode: 'school',
      isStillImage: true,
      nowMs: 110000 + i * 300,
    });
    stillState = res.nextState;
    assert.equal(res.analysis, null);
    assert.equal(res.shouldEmitAlert, false);
  }

  // Still photo local safety evaluation stays nominal (no kinetic bullying/fight) and reports Count & Density mode
  const stillLocal = evaluateLocalSafetyAnalysis({
    detectedPeople: densePhotoCrowd,
    detectedObjects: [],
    frameDeltaPercent: 30,
    voiceTranscript: '',
    audioLevel: 0,
    facilityMode: 'school',
    operationMode: 'school',
    isStillImage: true,
  });
  assert.equal(stillLocal.threatCategory, 'none');
  assert.equal(stillLocal.isFighting, false);
  assert.match(stillLocal.summary, /still image/i);

  // Weapon inside a still photo STILL triggers robbery_or_weapon
  const stillWeapon = evaluateLocalSafetyAnalysis({
    detectedPeople: densePhotoCrowd,
    detectedObjects: [
      { label: 'Knife / Blade', category: 'weapon', box_2d: [380, 400, 490, 470], confidence: 89 },
    ],
    frameDeltaPercent: 0,
    voiceTranscript: '',
    audioLevel: 0,
    facilityMode: 'all',
    operationMode: 'school',
    isStillImage: true,
  });
  assert.equal(stillWeapon.threatCategory, 'robbery_or_weapon');

  // 3. Disaster & Rescue Mode NEVER triggers school-style visual bullying on moving public crowds
  let disasterCrowdState = createInitialEdgeThreatState();
  for (let i = 0; i < 6; i += 1) {
    const press = i * 16;
    const res = evaluateRealtimeEdgeThreat(disasterCrowdState, {
      people: [
        { label: 'Person', box_2d: [180, 180 + press, 820, 420 + press], confidence: 88 },
        { label: 'Person', box_2d: [220 + i * 8, 410, 820, 610], confidence: 85 },
        { label: 'Person', box_2d: [180, 600 - press, 820, 840 - press], confidence: 87 },
      ],
      dangerousObjects: [],
      frameDeltaPercent: 14,
      voiceTranscript: '',
      audioLevel: 76,
      facilityMode: 'all',
      operationMode: 'disaster',
      nowMs: 120000 + i * 300,
    });
    disasterCrowdState = res.nextState;
    assert.notEqual(res.analysis?.threatCategory, 'bullying');
  }
});

