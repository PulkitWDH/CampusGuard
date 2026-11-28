export type PaPresetId =
  | 'stampede'
  | 'fire'
  | 'earthquake'
  | 'flood'
  | 'missing-person'
  | 'all-clear';

export type PaSirenProfile =
  | 'evacuation-sweep'
  | 'fire-alarm'
  | 'attention-chime'
  | 'all-clear-chime';

export type RescueUnitType =
  | 'Crowd Control'
  | 'Medical / EMS'
  | 'Fire & Rescue'
  | 'Search & Rescue'
  | 'Venue Security';

export interface PaBroadcastPreset {
  id: PaPresetId;
  title: string;
  shortLabel: string;
  sirenProfile: PaSirenProfile;
  recommendedUnits: RescueUnitType[];
  severity: 'critical' | 'warning' | 'info';
  template: string;
}

export type PaSpeakerConnectionType =
  | 'bluetooth'
  | 'wired-aux'
  | 'usb-hdmi'
  | 'builtin'
  | 'network-ip';

export interface ConnectedPaSpeaker {
  id: string;
  name: string;
  connectionType: PaSpeakerConnectionType;
  sinkId?: string;
  endpointUrl?: string;
  connectedAt: string;
  verified: boolean;
}

export interface DetectedBrowserSpeaker {
  deviceId: string;
  label: string;
  connectionType: PaSpeakerConnectionType;
}

export interface PaSpeakerGateResult {
  allowed: boolean;
  activeSpeaker: ConnectedPaSpeaker | null;
  reason: string;
}

export function formatSpeakerTypeLabel(type: PaSpeakerConnectionType): string {
  switch (type) {
    case 'bluetooth':
      return 'Bluetooth Speaker';
    case 'wired-aux':
      return 'Wired / AUX PA';
    case 'usb-hdmi':
      return 'USB / HDMI Audio';
    case 'network-ip':
      return 'Network / IP PA';
    default:
      return 'Built-in / System';
  }
}

export function classifySpeakerConnectionType(label: string): PaSpeakerConnectionType {
  const lower = (label || '').toLowerCase();
  if (
    /\b(bluetooth|bt\b|airpods|jbl|bose|sony|buds|a2dp|hands-?free|wireless|beats|marshall|anker|soundcore)\b/.test(
      lower
    )
  ) {
    return 'bluetooth';
  }
  if (/\b(http|rtsp|sip|network|ip pa|wifi|wi-fi|lan|sonos|airplay|cast)\b/.test(lower)) {
    return 'network-ip';
  }
  if (/\b(usb|hdmi|displayport|type-c|usb-c|thunderbolt|dac|monitor audio)\b/.test(lower)) {
    return 'usb-hdmi';
  }
  if (/\b(aux|line[\s-]?out|headphone|3\.5mm|jack|amplifier|amp\b|pa horn|loudspeaker|external)\b/.test(lower)) {
    return 'wired-aux';
  }
  return 'builtin';
}

export function canBroadcastPaAnnouncement(
  connectedSpeakers: ConnectedPaSpeaker[],
  activeSpeakerId: string | null
): PaSpeakerGateResult {
  if (!connectedSpeakers || connectedSpeakers.length === 0) {
    return {
      allowed: false,
      activeSpeaker: null,
      reason:
        'No speaker connected. Connect any Bluetooth, Wired/AUX, USB/HDMI, Built-in, or IP PA speaker to make announcements.',
    };
  }
  const matched =
    (activeSpeakerId ? connectedSpeakers.find((s) => s.id === activeSpeakerId) : null) ??
    connectedSpeakers[0];
  return {
    allowed: true,
    activeSpeaker: matched,
    reason: `Connected to ${matched.name} (${formatSpeakerTypeLabel(matched.connectionType)})`,
  };
}

export async function scanBrowserAudioOutputSpeakers(): Promise<DetectedBrowserSpeaker[]> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.enumerateDevices !== 'function'
  ) {
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === 'audiooutput');
    const seen = new Set<string>();
    const results: DetectedBrowserSpeaker[] = [];
    for (let i = 0; i < outputs.length; i += 1) {
      const dev = outputs[i];
      const id = dev.deviceId || `output-${i}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const rawLabel = (dev.label || '').trim();
      const label =
        rawLabel ||
        (id === 'default'
          ? 'System Default Audio Output (Wired / Built-in / OS Bluetooth)'
          : `Audio Output Device ${i + 1}`);
      results.push({
        deviceId: id,
        label,
        connectionType: rawLabel ? classifySpeakerConnectionType(rawLabel) : 'builtin',
      });
    }
    return results;
  } catch {
    return [];
  }
}

export async function pickBrowserSpeakerViaSystemDialog(): Promise<DetectedBrowserSpeaker | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return null;
  const mediaDevicesAny = navigator.mediaDevices as MediaDevices & {
    selectAudioOutput?: () => Promise<MediaDeviceInfo>;
  };
  if (typeof mediaDevicesAny.selectAudioOutput !== 'function') {
    return null;
  }
  try {
    const picked = await mediaDevicesAny.selectAudioOutput();
    if (!picked) return null;
    const label = (picked.label || '').trim() || 'Selected Audio Output Speaker';
    return {
      deviceId: picked.deviceId || 'default',
      label,
      connectionType: classifySpeakerConnectionType(label),
    };
  } catch {
    return null;
  }
}

export async function pairBluetoothSpeakerDevice(): Promise<
  { ok: true; speaker: ConnectedPaSpeaker } | { ok: false; error: string }
> {
  if (typeof navigator === 'undefined') {
    return { ok: false, error: 'Browser Bluetooth API is unavailable in this environment.' };
  }
  const navWithBt = navigator as Navigator & {
    bluetooth?: {
      requestDevice: (options: {
        acceptAllDevices: boolean;
        optionalServices?: string[];
      }) => Promise<{ id: string; name?: string }>;
    };
  };
  if (!navWithBt.bluetooth || typeof navWithBt.bluetooth.requestDevice !== 'function') {
    return {
      ok: false,
      error:
        'Web Bluetooth picker is restricted in this browser. Pair the Bluetooth speaker in OS settings and select it under System / Bluetooth Output below.',
    };
  }
  try {
    const device = await navWithBt.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['0000110b-0000-1000-8000-00805f9b34fb', 'battery_service'],
    });
    const cleanName = (device.name || '').trim() || 'Bluetooth PA Speaker';
    return {
      ok: true,
      speaker: {
        id: `bt-${device.id || Date.now()}`,
        name: cleanName,
        connectionType: 'bluetooth',
        connectedAt: new Date().toISOString(),
        verified: true,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bluetooth pairing cancelled.';
    return { ok: false, error: msg };
  }
}

export interface PaBroadcastLogEntry {
  id: string;
  timestamp: string;
  zoneName: string;
  presetId: PaPresetId | 'custom';
  message: string;
  sirenProfile: PaSirenProfile | 'none';
  unitsDispatched: RescueUnitType[];
  triggeredBy: 'manual' | 'auto-pa';
  speakerName?: string;
  speakerType?: PaSpeakerConnectionType;
}

export const PA_BROADCAST_PRESETS: PaBroadcastPreset[] = [
  {
    id: 'stampede',
    title: 'Stampede & Crowd Dispersal PA',
    shortLabel: 'Stampede Dispersal',
    sirenProfile: 'evacuation-sweep',
    recommendedUnits: ['Crowd Control', 'Medical / EMS', 'Venue Security'],
    severity: 'critical',
    template:
      'Attention all visitors. High crowd density detected in {ZONE}. Please stop moving forward immediately. Turn calmly toward the secondary emergency exits and follow marshals.',
  },
  {
    id: 'fire',
    title: 'Fire & Smoke Evacuation PA',
    shortLabel: 'Fire Evacuation',
    sirenProfile: 'fire-alarm',
    recommendedUnits: ['Fire & Rescue', 'Crowd Control', 'Medical / EMS'],
    severity: 'critical',
    template:
      'Emergency fire alert in {ZONE}. Please evacuate the building immediately using the nearest emergency stairwells. Do not use elevators. Move to the outdoor assembly point.',
  },
  {
    id: 'earthquake',
    title: 'Earthquake / Structural Collapse PA',
    shortLabel: 'Collapse / Quake',
    sirenProfile: 'evacuation-sweep',
    recommendedUnits: ['Search & Rescue', 'Medical / EMS', 'Fire & Rescue'],
    severity: 'critical',
    template:
      'Structural hazard alert in {ZONE}. Keep clear of overhead fixtures and restricted collapse zones. Evacuate immediately through marked open exits.',
  },
  {
    id: 'flood',
    title: 'Flood / Electrical Hazard PA',
    shortLabel: 'Flood / Electrical',
    sirenProfile: 'attention-chime',
    recommendedUnits: ['Search & Rescue', 'Venue Security', 'Medical / EMS'],
    severity: 'warning',
    template:
      'Safety warning for {ZONE}. Flood or electrical hazard detected. Move to higher ground immediately and stay clear of waterlogged corridors and power panels.',
  },
  {
    id: 'missing-person',
    title: 'Missing Person / Evacuee Located PA',
    shortLabel: 'Evacuee Located',
    sirenProfile: 'attention-chime',
    recommendedUnits: ['Search & Rescue', 'Medical / EMS'],
    severity: 'warning',
    template:
      'Attention Relief Command and Floor Marshals. Missing individual spotted by CCTV clothing Re-ID at {ZONE}. Reunion and medical team please respond immediately.',
  },
  {
    id: 'all-clear',
    title: 'All Clear — Resume Normal Operations PA',
    shortLabel: 'All Clear',
    sirenProfile: 'all-clear-chime',
    recommendedUnits: ['Venue Security'],
    severity: 'info',
    template:
      'Attention all visitors and staff. The emergency in {ZONE} has been cleared by Rescue Command. You may safely follow staff instructions.',
  },
];

export function getPaPresetById(presetId: PaPresetId): PaBroadcastPreset {
  return PA_BROADCAST_PRESETS.find((p) => p.id === presetId) ?? PA_BROADCAST_PRESETS[0];
}

export function buildPaAnnouncementText(
  presetId: PaPresetId,
  zoneName: string,
  extraContext?: string
): string {
  const preset = getPaPresetById(presetId);
  const cleanZone = (zoneName || 'All Venue Zones').trim() || 'All Venue Zones';
  const base = preset.template.replace(/\{ZONE\}/g, cleanZone);
  const cleanExtra = (extraContext || '').trim();
  return cleanExtra ? `${base} ${cleanExtra}` : base;
}

export function inferPaPresetForAlert(alert: {
  headline?: string;
  details?: string;
  voiceCue?: string;
  threatCategory?: string;
}): PaPresetId {
  const haystack = `${alert.headline || ''} ${alert.details || ''} ${alert.voiceCue || ''}`.toLowerCase();
  if (/stampede|overcrowding|crush risk|crowd density/.test(haystack)) return 'stampede';
  if (/fire|smoke|flames/.test(haystack)) return 'fire';
  if (/earthquake|collapse|trapped|structural/.test(haystack)) return 'earthquake';
  if (/flood|water|electrical/.test(haystack)) return 'flood';
  if (/missing|evacuee|re-id|watchlist/.test(haystack)) return 'missing-person';
  return 'stampede';
}

export function createPaBroadcastLogEntry(params: {
  zoneName: string;
  presetId: PaPresetId | 'custom';
  message: string;
  sirenProfile: PaSirenProfile | 'none';
  unitsDispatched: RescueUnitType[];
  triggeredBy: 'manual' | 'auto-pa';
  speakerName?: string;
  speakerType?: PaSpeakerConnectionType;
  nowMs?: number;
}): PaBroadcastLogEntry {
  const ts = params.nowMs ?? Date.now();
  return {
    id: `pa-${ts}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date(ts).toISOString(),
    zoneName: (params.zoneName || 'All Venue PA Speakers').trim(),
    presetId: params.presetId,
    message: params.message.trim(),
    sirenProfile: params.sirenProfile,
    unitsDispatched: [...params.unitsDispatched],
    triggeredBy: params.triggeredBy,
    speakerName: params.speakerName,
    speakerType: params.speakerType,
  };
}

// ============================================================================
// Live Browser PA Speaker & Emergency Siren Audio Engine (100% Offline Web Audio + SpeechSynthesis)
// ============================================================================

let activeSirenCtx: AudioContext | null = null;
let activeSirenOsc: OscillatorNode | null = null;
let activeSirenTimer: number | null = null;
let activeRepeatTimer: number | null = null;
let paPlaybackListeners: Set<(isOnAir: boolean, activeText: string | null) => void> = new Set();
let currentOnAirState = false;
let currentBroadcastText: string | null = null;

function notifyPaState(isOnAir: boolean, text: string | null) {
  currentOnAirState = isOnAir;
  currentBroadcastText = text;
  paPlaybackListeners.forEach((listener) => {
    try {
      listener(isOnAir, text);
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribePaAudioState(
  listener: (isOnAir: boolean, activeText: string | null) => void
): () => void {
  paPlaybackListeners.add(listener);
  listener(currentOnAirState, currentBroadcastText);
  return () => {
    paPlaybackListeners.delete(listener);
  };
}

export function stopAllPaAudio(): void {
  if (activeSirenTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(activeSirenTimer);
    activeSirenTimer = null;
  }
  if (activeRepeatTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(activeRepeatTimer);
    activeRepeatTimer = null;
  }
  if (activeSirenOsc) {
    try {
      activeSirenOsc.stop();
      activeSirenOsc.disconnect();
    } catch {
      // ignore already-stopped oscillator
    }
    activeSirenOsc = null;
  }
  if (activeSirenCtx) {
    try {
      void activeSirenCtx.close().catch(() => {});
    } catch {
      // ignore close errors
    }
    activeSirenCtx = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore speech cancellation errors
    }
  }
  notifyPaState(false, null);
}

/**
 * Plays a synthesized PA pre-chime or emergency evacuation siren over connected speakers
 * using the browser Web Audio API (zero external audio files, works 100% offline).
 */
export function playPaSirenTone(
  profile: PaSirenProfile,
  options?: { volume?: number; durationMs?: number; sinkId?: string }
): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      resolve();
      return;
    }

    // Stop any previous siren tone cleanly before starting a new one
    if (activeSirenOsc) {
      try {
        activeSirenOsc.stop();
      } catch {
        // ignore
      }
      activeSirenOsc = null;
    }
    if (activeSirenCtx) {
      try {
        void activeSirenCtx.close().catch(() => {});
      } catch {
        // ignore
      }
      activeSirenCtx = null;
    }

    const volume = Math.max(0.05, Math.min(1, options?.volume ?? 0.75));

    try {
      const ctx = new AudioCtx();
      activeSirenCtx = ctx;
      const ctxWithSink = ctx as AudioContext & {
        setSinkId?: (sinkId: string) => Promise<void>;
      };
      if (options?.sinkId && options.sinkId !== 'default' && typeof ctxWithSink.setSinkId === 'function') {
        void ctxWithSink.setSinkId(options.sinkId).catch(() => {});
      }
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);

      if (profile === 'attention-chime' || profile === 'all-clear-chime') {
        // Authentic 3-note mall / airport PA announcement chime (E4 -> G#4 -> B4 or reverse)
        const notes =
          profile === 'all-clear-chime' ? [523.25, 659.25, 783.99] : [440, 554.37, 659.25];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const noteGain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.24);
          noteGain.gain.setValueAtTime(0.001, now + idx * 0.24);
          noteGain.gain.exponentialRampToValueAtTime(volume * 0.45, now + idx * 0.24 + 0.03);
          noteGain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.24 + 0.42);
          osc.connect(noteGain);
          noteGain.connect(ctx.destination);
          osc.start(now + idx * 0.24);
          osc.stop(now + idx * 0.24 + 0.44);
        });
        const totalMs = 1050;
        activeSirenTimer = window.setTimeout(() => {
          activeSirenTimer = null;
          if (activeSirenCtx === ctx) {
            void ctx.close().catch(() => {});
            activeSirenCtx = null;
          }
          resolve();
        }, totalMs);
        return;
      }

      // Emergency Evacuation Sweep Siren or Fire Alarm Temporal-3 pulse
      const durationMs = options?.durationMs ?? 2400;
      const durationSec = durationMs / 1000;
      const osc = ctx.createOscillator();
      activeSirenOsc = osc;
      osc.type = profile === 'fire-alarm' ? 'square' : 'sawtooth';
      osc.connect(gain);

      if (profile === 'fire-alarm') {
        // NFPA Temporal-3 emergency horn cadence (3 sharp pulses)
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.001, now);
        for (let pulse = 0; pulse < 3; pulse += 1) {
          const t0 = now + pulse * 0.72;
          gain.gain.setValueAtTime(0.001, t0);
          gain.gain.linearRampToValueAtTime(volume * 0.32, t0 + 0.04);
          gain.gain.setValueAtTime(volume * 0.32, t0 + 0.46);
          gain.gain.linearRampToValueAtTime(0.001, t0 + 0.52);
        }
      } else {
        // Dual-cycle civil defense / mall evacuation whoop sweep (520Hz -> 1240Hz -> 520Hz)
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(volume * 0.3, now + 0.08);
        const cycles = Math.max(1, Math.round(durationSec / 1.1));
        for (let c = 0; c < cycles; c += 1) {
          const t0 = now + c * 1.1;
          osc.frequency.setValueAtTime(520, t0);
          osc.frequency.exponentialRampToValueAtTime(1240, t0 + 0.55);
          osc.frequency.exponentialRampToValueAtTime(520, t0 + 1.05);
        }
        gain.gain.setValueAtTime(volume * 0.3, now + Math.max(0.2, durationSec - 0.12));
        gain.gain.linearRampToValueAtTime(0.001, now + durationSec);
      }

      osc.start(now);
      osc.stop(now + durationSec + 0.04);
      activeSirenTimer = window.setTimeout(() => {
        activeSirenTimer = null;
        if (activeSirenOsc === osc) activeSirenOsc = null;
        if (activeSirenCtx === ctx) {
          void ctx.close().catch(() => {});
          activeSirenCtx = null;
        }
        resolve();
      }, durationMs + 60);
    } catch {
      resolve();
    }
  });
}

/**
 * Plays optional PA siren/pre-chime followed by audible SpeechSynthesis PA voice broadcast
 * over the connected venue/Bluetooth/wired/system speaker. Works 100% offline.
 */
export async function broadcastPaAnnouncement(params: {
  text: string;
  sirenProfile?: PaSirenProfile | 'none';
  volume?: number;
  repeatCount?: 1 | 2;
  sinkId?: string;
}): Promise<void> {
  const cleanText = (params.text || '').trim();
  if (!cleanText) return;

  stopAllPaAudio();
  const volume = Math.max(0.1, Math.min(1, params.volume ?? 0.85));
  const repeatCount = params.repeatCount ?? 1;
  notifyPaState(true, cleanText);

  if (params.sirenProfile && params.sirenProfile !== 'none') {
    await playPaSirenTone(params.sirenProfile, {
      volume,
      sinkId: params.sinkId,
      durationMs: params.sirenProfile === 'attention-chime' || params.sirenProfile === 'all-clear-chime' ? 1000 : 2000,
    });
    if (!currentOnAirState) return; // User clicked STOP during siren
  }

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    notifyPaState(false, null);
    return;
  }

  const speakOnce = (remaining: number) => {
    if (!currentOnAirState) return;
    try {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.volume = volume;
      utterance.rate = 0.96;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';
      utterance.onend = () => {
        if (!currentOnAirState) return;
        if (remaining > 1) {
          activeRepeatTimer = window.setTimeout(() => {
            activeRepeatTimer = null;
            speakOnce(remaining - 1);
          }, 800);
        } else {
          notifyPaState(false, null);
        }
      };
      utterance.onerror = () => {
        notifyPaState(false, null);
      };
      window.speechSynthesis.speak(utterance);
    } catch {
      notifyPaState(false, null);
    }
  };

  speakOnce(repeatCount);
}
