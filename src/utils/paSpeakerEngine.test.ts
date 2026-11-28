import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PA_BROADCAST_PRESETS,
  type ConnectedPaSpeaker,
  buildPaAnnouncementText,
  canBroadcastPaAnnouncement,
  classifySpeakerConnectionType,
  createPaBroadcastLogEntry,
  formatSpeakerTypeLabel,
  getPaPresetById,
  inferPaPresetForAlert,
} from './paSpeakerEngine';

test('PA_BROADCAST_PRESETS includes all 6 emergency public-venue loudspeaker scenarios', () => {
  const ids = PA_BROADCAST_PRESETS.map((p) => p.id);
  assert.deepEqual(ids, [
    'stampede',
    'fire',
    'earthquake',
    'flood',
    'missing-person',
    'all-clear',
  ]);
  const fire = getPaPresetById('fire');
  assert.equal(fire.sirenProfile, 'fire-alarm');
  assert.ok(fire.recommendedUnits.includes('Fire & Rescue'));
});

test('buildPaAnnouncementText injects target zone name into emergency PA script', () => {
  const msg = buildPaAnnouncementText('stampede', 'Main Mall Atrium (CAM-2)');
  assert.match(msg, /Main Mall Atrium \(CAM-2\)/);
  assert.match(msg, /crowd density/i);

  const fallbackZone = buildPaAnnouncementText('fire', '   ');
  assert.match(fallbackZone, /All Venue Zones/);
});

test('inferPaPresetForAlert maps alerts to the right emergency PA scenario automatically', () => {
  assert.equal(
    inferPaPresetForAlert({
      headline: 'STAMPEDE / OVERCROWDING RISK — Atrium',
      details: '32 people detected exceeding threshold',
    }),
    'stampede'
  );
  assert.equal(
    inferPaPresetForAlert({
      headline: 'DISASTER DISTRESS VOICE ALERT ("fire")',
      details: 'Smoke and fire reported near food court',
    }),
    'fire'
  );
  assert.equal(
    inferPaPresetForAlert({
      headline: 'ACOUSTIC DISTRESS / STRUCTURAL COLLAPSE ALERT',
      details: 'Sustained 95.4 dB tremor in stairwell',
    }),
    'earthquake'
  );
  assert.equal(
    inferPaPresetForAlert({
      headline: 'HAZARD ZONE BREACH (Flood / Live Wire Hazard)',
      details: 'Water entering lower concourse',
    }),
    'flood'
  );
  assert.equal(
    inferPaPresetForAlert({
      headline: 'MISSING PERSON / EVACUEE MATCH · Child in Red Jacket',
      details: 'Clothing HSV match 89%',
    }),
    'missing-person'
  );
});

test('createPaBroadcastLogEntry builds complete audit record with timestamp, speaker info, and dispatched units', () => {
  const entry = createPaBroadcastLogEntry({
    zoneName: 'East Gate (CAM-4)',
    presetId: 'stampede',
    message: 'Attention East Gate. Disperse calmly.',
    sirenProfile: 'evacuation-sweep',
    unitsDispatched: ['Crowd Control', 'Medical / EMS'],
    triggeredBy: 'auto-pa',
    speakerName: 'JBL PartyBox Hall PA',
    speakerType: 'bluetooth',
  });

  assert.ok(entry.id.startsWith('pa-'));
  assert.equal(entry.zoneName, 'East Gate (CAM-4)');
  assert.equal(entry.triggeredBy, 'auto-pa');
  assert.equal(entry.speakerName, 'JBL PartyBox Hall PA');
  assert.equal(entry.speakerType, 'bluetooth');
  assert.deepEqual(entry.unitsDispatched, ['Crowd Control', 'Medical / EMS']);
  assert.ok(entry.timestamp.includes('T'));
});

test('canBroadcastPaAnnouncement blocks Disaster PA announcements when no speaker is connected and unlocks for any connected speaker type', () => {
  // 1. Zero connected speakers -> strictly blocked!
  const blocked = canBroadcastPaAnnouncement([], null);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.activeSpeaker, null);
  assert.match(blocked.reason, /no speaker connected/i);

  // 2. Any speaker type (Bluetooth, Wired/AUX, USB/HDMI, Built-in, Network IP) unlocks announcements
  const speakers: ConnectedPaSpeaker[] = [
    {
      id: 'spk-bt-1',
      name: 'JBL Charge 5 Bluetooth PA',
      connectionType: 'bluetooth',
      connectedAt: '2026-11-28T10:00:00.000Z',
      verified: true,
    },
    {
      id: 'spk-aux-1',
      name: 'Atrium 3.5mm AUX Amplifier',
      connectionType: 'wired-aux',
      connectedAt: '2026-11-28T10:01:00.000Z',
      verified: true,
    },
  ];

  const defaultSelected = canBroadcastPaAnnouncement(speakers, null);
  assert.equal(defaultSelected.allowed, true);
  assert.equal(defaultSelected.activeSpeaker?.id, 'spk-bt-1');

  const explicitSelected = canBroadcastPaAnnouncement(speakers, 'spk-aux-1');
  assert.equal(explicitSelected.allowed, true);
  assert.equal(explicitSelected.activeSpeaker?.name, 'Atrium 3.5mm AUX Amplifier');

  // 3. Speaker type classifier covers all hardware types
  assert.equal(classifySpeakerConnectionType('JBL Flip 6 Bluetooth'), 'bluetooth');
  assert.equal(classifySpeakerConnectionType('Realtek 3.5mm Line Out Amplifier'), 'wired-aux');
  assert.equal(classifySpeakerConnectionType('Dell HDMI Monitor Audio'), 'usb-hdmi');
  assert.equal(classifySpeakerConnectionType('http://192.168.1.50/pa IP Horn'), 'network-ip');
  assert.equal(classifySpeakerConnectionType('MacBook Pro Speakers'), 'builtin');
  assert.equal(formatSpeakerTypeLabel('wired-aux'), 'Wired / AUX PA');
});
