import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DB_CALIBRATION_OFFSET,
  SOUND_ALERT_THRESHOLD_DB,
  classifyBluetoothCamera,
  computeBoxIoU,
  computeCalibratedOffsetFromDbfs,
  computeCameraCycleStep,
  computeCampusSummary,
  computeClassAttendance,
  computeFrameDeltaPercent,
  computeSplDecibels,
  deriveSafetyStatus,
  evaluateAttendanceReportAlert,
  evaluateFightNotification,
  evaluateLocalSafetyAnalysis,
  evaluateSoundThresholdAlert,
  evaluateVoiceCueThreatAlert,
  filterIncidentAlerts,
  filterVerifiedPersonDetections,
  formatAiModelLabel,
  formatAlertCategoryBadge,
  formatCameraAttendanceLabel,
  formatFacilityLabels,
  mergeTiledPersonDetections,
  parseSafeJsonText,
  shouldRunScheduledAttendance,
  shouldTriggerAudioSpikeScan,
  shouldTriggerInstantContinuousScan,
  stepPersonTracker,
} from './monitoringLogic';
import type { ClassroomAnalysis, ClassroomCamera, IncidentAlert } from '../types';

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
  assert.equal(shouldTriggerAudioSpikeScan(82, 0, 20000, false), true);
  assert.equal(shouldTriggerAudioSpikeScan(85, 15000, 20000, false), false);
  assert.equal(shouldTriggerAudioSpikeScan(85, 0, 20000, true), false);
});

test('evaluateSoundThresholdAlert triggers strictly above 81.1 dB with teacher alert message and cooldown', () => {
  assert.equal(SOUND_ALERT_THRESHOLD_DB, 81.1);
  const cam = {
    id: 'cam-room-4',
    cameraCode: 'CAM-4',
    classroomName: 'Science Lab 4',
    studentCount: 14,
  };

  // Exactly 81.1 dB does NOT exceed 81.1 dB
  assert.equal(evaluateSoundThresholdAlert(cam, 81.1, { nowMs: 30000 }), null);

  // 81.2 dB strictly exceeds 81.1 dB -> generates teacher alert message
  const alert = evaluateSoundThresholdAlert(cam, 81.2, {
    nowMs: 30000,
    teacherEmail: 'teacher@school.edu',
    teacherName: 'Ms. Rivera',
    courseName: 'Chemistry 101',
    liveTranscript: 'Stop yelling',
  });
  assert.ok(alert);
  assert.equal(alert.alertType, 'sound-threshold');
  assert.equal(alert.measuredDb, 81.2);
  assert.equal(alert.severity, 'critical');
  assert.match(alert.headline, /81\.2 dB/);
  assert.ok(alert.teacherMessageSubject?.includes('81.1 dB'));
  assert.ok(alert.teacherMessageBody?.includes('Hello Ms. Rivera'));
  assert.ok(alert.teacherMessageBody?.includes('Chemistry 101'));

  // Cooldown suppresses duplicate alert within 15s
  assert.equal(
    evaluateSoundThresholdAlert(cam, 88.4, { lastAlertAtMs: 30000, nowMs: 35000 }),
    null
  );
});

test('computeSplDecibels maps quiet, normal speech, and shouting RMS accurately', () => {
  const quiet = new Float32Array(256).fill(0.0008);
  const speech = new Float32Array(256).fill(0.02);
  const shout = new Float32Array(256).fill(0.12);

  const quietDb = computeSplDecibels(quiet, DEFAULT_DB_CALIBRATION_OFFSET);
  const speechDb = computeSplDecibels(speech, DEFAULT_DB_CALIBRATION_OFFSET);
  const shoutDb = computeSplDecibels(shout, DEFAULT_DB_CALIBRATION_OFFSET);

  assert.ok(quietDb >= 35 && quietDb <= 48, `Expected quiet ~40 dB, got ${quietDb}`);
  assert.ok(speechDb >= 62 && speechDb <= 74, `Expected speech ~68 dB, got ${speechDb}`);
  assert.ok(shoutDb > SOUND_ALERT_THRESHOLD_DB, `Expected shout > 81.1 dB, got ${shoutDb}`);
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
  const p2Occluded = { label: 'Person (right)', box_2d: [220, 520, 780, 790] as [number, number, number, number], confidence: 44 };

  // Frame 1: p1 instant (>=52%), p2 pending (44%)
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









