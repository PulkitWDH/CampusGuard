import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Megaphone,
  Radio,
  ShieldAlert,
  Siren,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ClassroomCamera, IncidentAlert } from '../types';
import {
  DEFAULT_DEMO_CROWD_THRESHOLD,
  DEFAULT_LIVE_CROWD_THRESHOLD,
  MAX_CROWD_DENSITY_THRESHOLD,
  MAX_ROOM_AREA_SQM,
  MIN_CROWD_DENSITY_THRESHOLD,
  MIN_ROOM_AREA_SQM,
  ROOM_SIZE_PRESETS,
  evaluateCrowdCrushRisk,
} from '../utils/crowdTiling';
import { SOUND_ALERT_THRESHOLD_DB } from '../utils/monitoringLogic';
import {
  PA_BROADCAST_PRESETS,
  type ConnectedPaSpeaker,
  type PaBroadcastLogEntry,
  type PaPresetId,
  type PaSirenProfile,
  type RescueUnitType,
  buildPaAnnouncementText,
  canBroadcastPaAnnouncement,
  formatSpeakerTypeLabel,
  playPaSirenTone,
} from '../utils/paSpeakerEngine';
import { PaSpeakerConnectionPanel } from './PaSpeakerConnectionPanel';

interface DisasterCommandCenterProps {
  cameras: ClassroomCamera[];
  alerts: IncidentAlert[];
  crowdDensityThreshold: number;
  onChangeCrowdDensityThreshold: (value: number) => void;
  roomAreaSqm: number;
  onChangeRoomAreaSqm: (areaSqm: number) => void;
  autoPaEnabled: boolean;
  onToggleAutoPa: () => void;
  paVolume: number;
  onChangePaVolume: (volume: number) => void;
  paIsOnAir: boolean;
  paActiveText: string | null;
  paLogs: PaBroadcastLogEntry[];
  connectedSpeakers: ConnectedPaSpeaker[];
  activeSpeakerId: string | null;
  onConnectSpeaker: (speaker: ConnectedPaSpeaker) => void;
  onDisconnectSpeaker: (speakerId: string) => void;
  onSelectActiveSpeaker: (speakerId: string) => void;
  onBroadcastPa: (params: {
    zoneName: string;
    presetId: PaPresetId | 'custom';
    message: string;
    sirenProfile: PaSirenProfile | 'none';
    repeatCount: 1 | 2;
    unitsDispatched: RescueUnitType[];
  }) => boolean | void;
  onStopPaAudio: () => void;
  onOpenPaModalForAlert: (alert: IncidentAlert) => void;
  peakTrailVelocity?: number;
  fallenVictimCount?: number;
}

export function DisasterCommandCenter({
  cameras,
  alerts,
  crowdDensityThreshold,
  onChangeCrowdDensityThreshold,
  roomAreaSqm,
  onChangeRoomAreaSqm,
  autoPaEnabled,
  onToggleAutoPa,
  paVolume,
  onChangePaVolume,
  paIsOnAir,
  paActiveText,
  paLogs,
  connectedSpeakers,
  activeSpeakerId,
  onConnectSpeaker,
  onDisconnectSpeaker,
  onSelectActiveSpeaker,
  onBroadcastPa,
  onStopPaAudio,
  onOpenPaModalForAlert,
  peakTrailVelocity = 0,
  fallenVictimCount = 0,
}: DisasterCommandCenterProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string>('all');
  const [customMessage, setCustomMessage] = useState<string>('');
  const [repeatTwice, setRepeatTwice] = useState<boolean>(true);
  const [includeSiren, setIncludeSiren] = useState<boolean>(true);
  const speakerGate = useMemo(
    () => canBroadcastPaAnnouncement(connectedSpeakers, activeSpeakerId),
    [activeSpeakerId, connectedSpeakers]
  );

  const selectedZoneName = useMemo(() => {
    if (selectedZoneId === 'all') return 'All Venue PA Zones';
    const found = cameras.find((c) => c.id === selectedZoneId);
    return found ? `${found.classroomName} (${found.cameraCode})` : 'All Venue PA Zones';
  }, [cameras, selectedZoneId]);

  const totalPeople = useMemo(
    () => cameras.reduce((acc, cam) => acc + Math.max(0, cam.studentCount || 0), 0),
    [cameras]
  );

  const peakCamera = useMemo(() => {
    let best: ClassroomCamera | null = null;
    for (const cam of cameras) {
      if (!best || (cam.studentCount || 0) > (best.studentCount || 0)) {
        best = cam;
      }
    }
    return best;
  }, [cameras]);

  const peakCount = peakCamera?.studentCount || 0;

  const overallRisk = useMemo(
    () =>
      evaluateCrowdCrushRisk(Math.max(peakCount, totalPeople), crowdDensityThreshold, {
        roomAreaSqm,
        detectedPeople: peakCamera?.lastAnalysis?.detectedPeople,
        maxTrailVelocityNormPerSec: peakTrailVelocity,
      }),
    [crowdDensityThreshold, peakCamera, peakCount, peakTrailVelocity, roomAreaSqm, totalPeople]
  );

  const activeHazardZonesCount = useMemo(
    () => cameras.filter((c) => Boolean(c.perimeterZone)).length,
    [cameras]
  );

  const criticalAlerts = useMemo(
    () => alerts.filter((a) => !a.acknowledged).slice(0, 8),
    [alerts]
  );

  const handlePresetBroadcast = (presetId: PaPresetId) => {
    if (!speakerGate.allowed) return;
    const preset = PA_BROADCAST_PRESETS.find((p) => p.id === presetId) ?? PA_BROADCAST_PRESETS[0];
    const spoken = buildPaAnnouncementText(preset.id, selectedZoneName);
    onBroadcastPa({
      zoneName: selectedZoneName,
      presetId: preset.id,
      message: spoken,
      sirenProfile: includeSiren ? preset.sirenProfile : 'attention-chime',
      repeatCount: repeatTwice ? 2 : 1,
      unitsDispatched: preset.recommendedUnits,
    });
  };

  const handleCustomBroadcast = () => {
    if (!speakerGate.allowed) return;
    const trimmed = customMessage.trim();
    if (!trimmed) return;
    onBroadcastPa({
      zoneName: selectedZoneName,
      presetId: 'custom',
      message: trimmed,
      sirenProfile: includeSiren ? 'attention-chime' : 'none',
      repeatCount: repeatTwice ? 2 : 1,
      unitsDispatched: ['Venue Security'],
    });
  };

  const handleExportBriefing = () => {
    const lines = [
      'CAMPUSGUARD — DISASTER & RESCUE COMMAND BRIEFING (OFFLINE EXPORT)',
      `Generated: ${new Date().toISOString()}`,
      `Crowd Status: ${overallRisk.status} (${overallRisk.personCount} / ${overallRisk.threshold} cap · ${(overallRisk.densityPerSqm ?? 0).toFixed(2)} p/m² in ${roomAreaSqm} m²)`,
      `Monitored Cameras: ${cameras.length} | Active Hazard Zones: ${activeHazardZonesCount}`,
      '',
      '--- LIVE ZONES ---',
      ...(cameras.length === 0
        ? ['No cameras currently connected.']
        : cameras.map((c) => {
            const zoneRisk = evaluateCrowdCrushRisk(c.studentCount, crowdDensityThreshold, {
              roomAreaSqm,
              detectedPeople: c.lastAnalysis?.detectedPeople,
            });
            return `[${c.cameraCode}] ${c.classroomName} — ${c.studentCount} people (${(zoneRisk.densityPerSqm ?? 0).toFixed(2)} p/m² · ${zoneRisk.status}) · Audio: ${c.audioLevel.toFixed(1)} dB · Hazard: ${c.perimeterZone?.label || 'None'}`;
          })),
      '',
      '--- PA LOUDSPEAKER BROADCAST LOG ---',
      ...(paLogs.length === 0
        ? ['No PA broadcasts logged yet.']
        : paLogs.map(
            (l) =>
              `[${l.timestamp}] (${l.triggeredBy.toUpperCase()}) ${l.zoneName} · Units: ${l.unitsDispatched.join(', ') || 'None'} — "${l.message}"`
          )),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `disaster-rescue-briefing-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5" data-testid="disaster-command-center">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white font-mono text-[10px] font-bold uppercase tracking-wider">
              <Radio className="w-3 h-3" aria-hidden="true" />
              <span>100% Offline Venue PA Ready</span>
            </span>
            <span className="font-mono text-[11px] text-slate-500">
              CCTV + PA Loudspeakers · Zero Internet Required
            </span>
          </div>
          <h1
            data-testid="workspace-hub-title"
            className="text-xl font-bold tracking-tight text-slate-900 mt-1"
          >
            Venue PA Loudspeaker &amp; Rescue Command
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Broadcast live emergency voice evacuation directives and sirens directly to mall, campus,
            or relief-camp PA speakers — no email or cloud required.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {paIsOnAir ? (
            <button
              type="button"
              data-testid="pa-stop-all-btn"
              onClick={onStopPaAudio}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white cursor-pointer animate-pulse"
            >
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>STOP PA / SILENCE SIREN</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="pa-test-siren-btn"
              disabled={!speakerGate.allowed}
              title={speakerGate.allowed ? 'Test chime on connected speaker' : speakerGate.reason}
              onClick={() => {
                if (!speakerGate.allowed) return;
                void playPaSirenTone('attention-chime', {
                  volume: paVolume,
                  sinkId: speakerGate.activeSpeaker?.sinkId,
                });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              <Volume2 className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
              <span>{speakerGate.allowed ? 'Test PA Chime' : 'Connect Speaker to Test'}</span>
            </button>
          )}
          <button
            type="button"
            data-testid="export-rescue-briefing-btn"
            onClick={handleExportBriefing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export Rescue Brief</span>
          </button>
        </div>
      </div>

      {/* Mandatory Connected Speaker Panel (Bluetooth, Wired/AUX, USB/HDMI, Built-in, or IP PA) */}
      <PaSpeakerConnectionPanel
        connectedSpeakers={connectedSpeakers}
        activeSpeakerId={activeSpeakerId}
        paVolume={paVolume}
        onConnectSpeaker={onConnectSpeaker}
        onDisconnectSpeaker={onDisconnectSpeaker}
        onSelectActiveSpeaker={onSelectActiveSpeaker}
      />

      {/* Live PA ON AIR Banner */}
      {paIsOnAir ? (
        <div
          role="status"
          data-testid="pa-on-air-banner"
          className="rounded-xl border border-red-400 bg-red-600 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <Megaphone className="w-5 h-5 shrink-0 mt-0.5 animate-bounce" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-xs font-mono font-bold uppercase tracking-wider">
                PA LOUDSPEAKERS ON AIR — BROADCASTING LIVE AUDIO
              </div>
              {paActiveText ? (
                <p className="text-xs text-red-50 mt-0.5 line-clamp-2">&ldquo;{paActiveText}&rdquo;</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onStopPaAudio}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-white text-red-700 hover:bg-red-50 cursor-pointer shrink-0"
          >
            <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Stop Broadcast</span>
          </button>
        </div>
      ) : null}

      {/* Tactical KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="text-[11px] font-medium text-slate-500">Live Venue Headcount</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
              {overallRisk.personCount}
            </span>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              / {overallRisk.threshold} cap
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Phase 1 · Stampede Risk Meter ({roomAreaSqm} m²)
          </div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            <span
              data-testid="disaster-kpi-density"
              className="text-sm font-mono font-bold text-slate-900 tabular-nums"
            >
              {(overallRisk.densityPerSqm ?? 0).toFixed(2)} p/m²
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                overallRisk.status === 'CRITICAL CRUSH RISK'
                  ? 'bg-red-600 text-white'
                  : overallRisk.status === 'ELEVATED'
                    ? 'bg-amber-500 text-white'
                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}
            >
              {overallRisk.disasterRiskLabel}
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="text-[11px] font-medium text-slate-500">Auto-PA Speaker Trigger</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span
              className={`text-sm font-mono font-bold ${
                !speakerGate.allowed
                  ? 'text-amber-600'
                  : autoPaEnabled
                    ? 'text-red-600'
                    : 'text-slate-500'
              }`}
            >
              {!speakerGate.allowed
                ? 'SPEAKER NEEDED'
                : autoPaEnabled
                  ? 'AUTO-PA ARMED'
                  : 'MANUAL ONLY'}
            </span>
            <button
              type="button"
              role="switch"
              data-testid="disaster-autopa-toggle"
              aria-checked={autoPaEnabled && speakerGate.allowed}
              disabled={!speakerGate.allowed}
              title={speakerGate.allowed ? 'Toggle Auto-PA broadcast on critical alerts' : speakerGate.reason}
              onClick={onToggleAutoPa}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold border disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer ${
                autoPaEnabled && speakerGate.allowed
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              {autoPaEnabled && speakerGate.allowed ? 'Armed' : 'Off'}
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="text-[11px] font-medium text-slate-500">
            Phase 2 · Fallen Victims / Hazards
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-2xl font-mono font-bold tabular-nums ${
                fallenVictimCount > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {fallenVictimCount}
            </span>
            <span className="text-xs text-slate-500">
              fallen · {activeHazardZonesCount} hazard {activeHazardZonesCount === 1 ? 'zone' : 'zones'}
            </span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Command Deck */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left 7 cols: PA Loudspeaker Broadcast Console */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-red-600" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-900">
                Public Venue PA Loudspeaker Console
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <label htmlFor="pa-zone-select" className="text-[11px] text-slate-500">
                Target Speakers:
              </label>
              <select
                id="pa-zone-select"
                data-testid="pa-zone-select"
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900"
              >
                <option value="all">
                  {cameras.length === 0
                    ? 'All Venue PA Speakers (Venue-Wide)'
                    : `All Venue PA Speakers (${cameras.length} ${cameras.length === 1 ? 'zone' : 'zones'})`}
                </option>
                {cameras.map((cam) => (
                  <option key={cam.id} value={cam.id}>
                    {cam.cameraCode} · {cam.classroomName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Speaker Controls Row */}
          <div className="flex flex-wrap items-center gap-4 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs">
            <div className="flex items-center gap-2 min-w-[160px] flex-1">
              <Volume2 className="w-3.5 h-3.5 text-slate-600 shrink-0" aria-hidden="true" />
              <label htmlFor="pa-volume-slider" className="text-slate-600 whitespace-nowrap">
                PA Gain
              </label>
              <input
                id="pa-volume-slider"
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={paVolume}
                onChange={(e) => onChangePaVolume(Number(e.target.value))}
                className="flex-1 accent-red-600 cursor-pointer"
              />
              <span className="font-mono font-semibold text-slate-800 tabular-nums w-9 text-right">
                {Math.round(paVolume * 100)}%
              </span>
            </div>

            <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 select-none">
              <input
                type="checkbox"
                checked={includeSiren}
                onChange={(e) => setIncludeSiren(e.target.checked)}
                className="accent-red-600"
              />
              <span>Emergency Siren</span>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 select-none">
              <input
                type="checkbox"
                checked={repeatTwice}
                onChange={(e) => setRepeatTwice(e.target.checked)}
                className="accent-red-600"
              />
              <span>Repeat 2×</span>
            </label>
          </div>

          {/* 1-Click Scenario PA Broadcast Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-700">
                1-Click Emergency PA Broadcasts (Live Audio + Siren)
              </h3>
              {!speakerGate.allowed ? (
                <span className="text-[11px] font-semibold text-amber-700">
                  Connect any speaker above to unlock
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PA_BROADCAST_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`pa-preset-${preset.id}`}
                  disabled={!speakerGate.allowed}
                  title={speakerGate.allowed ? preset.title : speakerGate.reason}
                  onClick={() => handlePresetBroadcast(preset.id)}
                  className={`text-left p-3 rounded-xl border transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer space-y-1.5 ${
                    preset.severity === 'critical'
                      ? 'border-red-200 bg-red-50/60 hover:bg-red-50 hover:border-red-400'
                      : preset.severity === 'warning'
                        ? 'border-amber-200 bg-amber-50/60 hover:bg-amber-50 hover:border-amber-400'
                        : 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 hover:border-emerald-400'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">{preset.shortLabel}</span>
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${
                        !speakerGate.allowed
                          ? 'bg-slate-400 text-white'
                          : preset.severity === 'critical'
                            ? 'bg-red-600 text-white'
                            : preset.severity === 'warning'
                              ? 'bg-amber-600 text-white'
                              : 'bg-emerald-600 text-white'
                      }`}
                    >
                      <Volume2 className="w-2.5 h-2.5" aria-hidden="true" />
                      <span>{speakerGate.allowed ? 'Broadcast' : 'Locked'}</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-snug line-clamp-2">
                    {buildPaAnnouncementText(preset.id, selectedZoneName)}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Live PA Announcement Box */}
          <div className="pt-3 border-t border-slate-200 space-y-2">
            <label htmlFor="custom-pa-message" className="block text-xs font-semibold text-slate-700">
              Custom Live Voice Announcement ({selectedZoneName})
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="custom-pa-message"
                data-testid="custom-pa-input"
                type="text"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCustomBroadcast();
                  }
                }}
                placeholder={
                  speakerGate.allowed
                    ? 'e.g. Attention Mall Atrium, Gate B is now open — proceed calmly to North Exit...'
                    : 'Connect any speaker above before broadcasting a custom PA announcement...'
                }
                className="flex-1 min-w-0 text-xs px-3 py-2 border border-slate-300 bg-slate-50 rounded-lg text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-red-600"
              />
              <button
                type="button"
                data-testid="custom-pa-broadcast-btn"
                disabled={!speakerGate.allowed || !customMessage.trim()}
                title={speakerGate.allowed ? 'Broadcast custom PA voice announcement' : speakerGate.reason}
                onClick={handleCustomBroadcast}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white cursor-pointer shrink-0"
              >
                <Megaphone className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{speakerGate.allowed ? 'Speak Over PA' : 'Speaker Required'}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Right 5 cols: Multi-Zone Crowd & Hazard Matrix + Stampede Threshold */}
        <section className="xl:col-span-5 space-y-4">
          {/* Room Size & Crowd Crush Calibration Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Siren className="w-4 h-4 text-red-600" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Room Area &amp; Stampede Density
                </h2>
              </div>
              <span
                data-testid="disaster-room-area-badge"
                className="font-mono text-xs font-bold text-red-600 tabular-nums"
              >
                {roomAreaSqm} m² · Cap {overallRisk.threshold}
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span>Floor Area (big halls allow spread-out crowds)</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {roomAreaSqm} m²
                </span>
              </div>
              <input
                type="range"
                aria-label="Room floor area in square meters"
                data-testid="disaster-room-area-slider"
                min={MIN_ROOM_AREA_SQM}
                max={MAX_ROOM_AREA_SQM}
                step={5}
                value={roomAreaSqm}
                onChange={(e) => onChangeRoomAreaSqm(Number(e.target.value))}
                className="w-full accent-red-600 cursor-pointer"
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {ROOM_SIZE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`room-preset-${preset.id}`}
                    onClick={() => onChangeRoomAreaSqm(preset.areaSqm)}
                    className={`px-2 py-1 text-[10px] font-mono rounded border cursor-pointer transition-colors ${
                      roomAreaSqm === preset.areaSqm
                        ? 'bg-red-600 text-white border-red-600 font-semibold'
                        : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preset.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span>Small-Space / Demo Headcount Cap</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {crowdDensityThreshold} people
                </span>
              </div>
              <input
                type="range"
                aria-label="Stampede crowd threshold"
                min={MIN_CROWD_DENSITY_THRESHOLD}
                max={MAX_CROWD_DENSITY_THRESHOLD}
                step={1}
                value={crowdDensityThreshold}
                onChange={(e) => onChangeCrowdDensityThreshold(Number(e.target.value))}
                className="w-full accent-red-600 cursor-pointer"
              />
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-500">
                  Crush limit: ≥2.0 p/m² or tight exit bottleneck · Collapse: &gt;
                  {SOUND_ALERT_THRESHOLD_DB.toFixed(1)} dB
                </span>
                <div className="inline-flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      onChangeCrowdDensityThreshold(DEFAULT_DEMO_CROWD_THRESHOLD);
                      onChangeRoomAreaSqm(15);
                    }}
                    className="px-2 py-0.5 font-mono rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer"
                  >
                    15 Demo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeCrowdDensityThreshold(DEFAULT_LIVE_CROWD_THRESHOLD);
                      onChangeRoomAreaSqm(150);
                    }}
                    className="px-2 py-0.5 font-mono rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer"
                  >
                    150 m² Hall
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Live Camera Zones Matrix */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Zone Crowd &amp; PA Speaker Matrix
              </h2>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {cameras.length} active
              </span>
            </div>

            {cameras.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                Connect any mall, hall, or relief-camp camera on the Cameras wall to monitor zone
                crowd pressure and trigger zone-targeted PA broadcasts.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {cameras.map((cam) => {
                  const risk = evaluateCrowdCrushRisk(cam.studentCount, crowdDensityThreshold, {
                    roomAreaSqm,
                    detectedPeople: cam.lastAnalysis?.detectedPeople,
                  });
                  const pct = Math.min(100, risk.percentOfThreshold);
                  return (
                    <div
                      key={cam.id}
                      className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {cam.classroomName}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {cam.cameraCode} · {cam.studentCount} people (
                            {(risk.densityPerSqm ?? 0).toFixed(2)} p/m²) ·{' '}
                            {cam.audioLevel.toFixed(0)} dB
                            {cam.perimeterZone ? ` · ${cam.perimeterZone.label}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={!speakerGate.allowed}
                          title={speakerGate.allowed ? `Broadcast PA to ${cam.classroomName}` : speakerGate.reason}
                          onClick={() => {
                            if (!speakerGate.allowed) return;
                            const zoneLabel = `${cam.classroomName} (${cam.cameraCode})`;
                            onBroadcastPa({
                              zoneName: zoneLabel,
                              presetId: 'stampede',
                              message: buildPaAnnouncementText('stampede', zoneLabel),
                              sirenProfile: 'evacuation-sweep',
                              repeatCount: 1,
                              unitsDispatched: ['Crowd Control', 'Venue Security'],
                            });
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-red-600 hover:bg-red-700 disabled:opacity-45 disabled:cursor-not-allowed text-white cursor-pointer shrink-0"
                        >
                          <Megaphone className="w-3 h-3" aria-hidden="true" />
                          <span>{speakerGate.allowed ? 'PA Zone' : 'No Speaker'}</span>
                        </button>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            risk.status === 'CRITICAL CRUSH RISK'
                              ? 'bg-red-600'
                              : risk.status === 'ELEVATED'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active Unacknowledged Emergency Alerts */}
          {criticalAlerts.length > 0 ? (
            <div className="bg-white border border-red-200 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-600" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Active Alerts Ready for PA Broadcast
                </h2>
              </div>
              <div className="space-y-2">
                {criticalAlerts.slice(0, 4).map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-red-50/70 border border-red-200"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {alert.headline}
                      </div>
                      <div className="text-[11px] text-slate-600 truncate">
                        {alert.classroomName} · {alert.studentCount} people
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenPaModalForAlert(alert)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer shrink-0"
                    >
                      PA Broadcast
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {/* PA Broadcast Audit Log */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-slate-600" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-900">
              PA Speaker Broadcast &amp; Rescue Dispatch Log
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {paLogs.length} broadcast{paLogs.length === 1 ? '' : 's'}
          </span>
        </div>

        {paLogs.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>
              PA speaker system is standing by. Click any emergency scenario above or enable Auto-PA
              to broadcast live spoken evacuation instructions over venue speakers.
            </span>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200" data-testid="pa-broadcast-log-list">
            {paLogs.slice(0, 12).map((entry) => (
              <li key={entry.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                        entry.triggeredBy === 'auto-pa'
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-900 text-white'
                      }`}
                    >
                      {entry.triggeredBy === 'auto-pa' ? 'AUTO-PA' : 'MANUAL PA'}
                    </span>
                    <span className="text-xs font-semibold text-slate-900">{entry.zoneName}</span>
                    {entry.speakerName ? (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-[10px]">
                        {entry.speakerName}
                        {entry.speakerType ? ` · ${formatSpeakerTypeLabel(entry.speakerType)}` : ''}
                      </span>
                    ) : null}
                    {entry.unitsDispatched.length > 0 ? (
                      <span className="text-[11px] text-slate-500">
                        Units: {entry.unitsDispatched.join(', ')}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-600">&ldquo;{entry.message}&rdquo;</p>
                </div>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
