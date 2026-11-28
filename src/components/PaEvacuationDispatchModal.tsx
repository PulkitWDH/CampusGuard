import { useEffect, useState } from 'react';
import { CheckCircle2, Megaphone, Siren, Square, Volume2, X } from 'lucide-react';
import type { IncidentAlert } from '../types';
import {
  PA_BROADCAST_PRESETS,
  type ConnectedPaSpeaker,
  type PaPresetId,
  type PaSirenProfile,
  type RescueUnitType,
  buildPaAnnouncementText,
  canBroadcastPaAnnouncement,
  inferPaPresetForAlert,
} from '../utils/paSpeakerEngine';
import { PaSpeakerConnectionPanel } from './PaSpeakerConnectionPanel';

const ALL_RESCUE_UNITS: RescueUnitType[] = [
  'Crowd Control',
  'Medical / EMS',
  'Fire & Rescue',
  'Search & Rescue',
  'Venue Security',
];

interface PaEvacuationDispatchModalProps {
  alert: IncidentAlert | null;
  paIsOnAir: boolean;
  paVolume: number;
  connectedSpeakers: ConnectedPaSpeaker[];
  activeSpeakerId: string | null;
  onConnectSpeaker: (speaker: ConnectedPaSpeaker) => void;
  onDisconnectSpeaker: (speakerId: string) => void;
  onSelectActiveSpeaker: (speakerId: string) => void;
  onBroadcastPa: (params: {
    alertId: string;
    zoneName: string;
    presetId: PaPresetId | 'custom';
    message: string;
    sirenProfile: PaSirenProfile | 'none';
    repeatCount: 1 | 2;
    unitsDispatched: RescueUnitType[];
  }) => boolean | void;
  onStopPaAudio: () => void;
  onClose: () => void;
}

export function PaEvacuationDispatchModal({
  alert,
  paIsOnAir,
  paVolume,
  connectedSpeakers,
  activeSpeakerId,
  onConnectSpeaker,
  onDisconnectSpeaker,
  onSelectActiveSpeaker,
  onBroadcastPa,
  onStopPaAudio,
  onClose,
}: PaEvacuationDispatchModalProps) {
  const [presetId, setPresetId] = useState<PaPresetId>('stampede');
  const [messageDraft, setMessageDraft] = useState('');
  const [includeSiren, setIncludeSiren] = useState(true);
  const [repeatTwice, setRepeatTwice] = useState(true);
  const [selectedUnits, setSelectedUnits] = useState<RescueUnitType[]>([
    'Crowd Control',
    'Medical / EMS',
  ]);
  const [broadcastSent, setBroadcastSent] = useState(false);

  useEffect(() => {
    if (!alert) return;
    const inferred = inferPaPresetForAlert(alert);
    const preset = PA_BROADCAST_PRESETS.find((p) => p.id === inferred) ?? PA_BROADCAST_PRESETS[0];
    setPresetId(inferred);
    setMessageDraft(buildPaAnnouncementText(inferred, `${alert.classroomName} (${alert.cameraCode})`));
    setSelectedUnits([...preset.recommendedUnits]);
    setBroadcastSent(false);
  }, [alert]);

  if (!alert) return null;

  const speakerGate = canBroadcastPaAnnouncement(connectedSpeakers, activeSpeakerId);
  const zoneLabel = `${alert.classroomName} (${alert.cameraCode})`;

  const handleSelectPreset = (nextPresetId: PaPresetId) => {
    setPresetId(nextPresetId);
    const preset = PA_BROADCAST_PRESETS.find((p) => p.id === nextPresetId) ?? PA_BROADCAST_PRESETS[0];
    setMessageDraft(buildPaAnnouncementText(nextPresetId, zoneLabel));
    setSelectedUnits([...preset.recommendedUnits]);
  };

  const toggleUnit = (unit: RescueUnitType) => {
    setSelectedUnits((prev) =>
      prev.includes(unit) ? prev.filter((u) => u !== unit) : [...prev, unit]
    );
  };

  const handleLaunchBroadcast = (withSiren: boolean) => {
    if (!speakerGate.allowed) return;
    const preset = PA_BROADCAST_PRESETS.find((p) => p.id === presetId) ?? PA_BROADCAST_PRESETS[0];
    const ok = onBroadcastPa({
      alertId: alert.id,
      zoneName: zoneLabel,
      presetId,
      message: messageDraft.trim() || buildPaAnnouncementText(presetId, zoneLabel),
      sirenProfile: withSiren ? preset.sirenProfile : 'attention-chime',
      repeatCount: repeatTwice ? 2 : 1,
      unitsDispatched: selectedUnits,
    });
    if (ok !== false) {
      setBroadcastSent(true);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pa-dispatch-modal-title"
      data-testid="pa-evacuation-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-red-600 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Megaphone className="w-5 h-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="pa-dispatch-modal-title" className="text-sm font-bold truncate">
                PA Loudspeaker Evacuation &amp; Rescue Broadcast
              </h2>
              <p className="text-[11px] text-red-100 truncate">
                {speakerGate.allowed
                  ? `Active Speaker: ${speakerGate.activeSpeaker?.name} · Target: ${zoneLabel}`
                  : `Connect Any Speaker Required · Target: ${zoneLabel}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PA broadcast dialog"
            className="p-1.5 rounded-lg text-red-100 hover:text-white hover:bg-red-700 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Mandatory Speaker Connection Gate */}
          <PaSpeakerConnectionPanel
            compact
            connectedSpeakers={connectedSpeakers}
            activeSpeakerId={activeSpeakerId}
            paVolume={paVolume}
            onConnectSpeaker={onConnectSpeaker}
            onDisconnectSpeaker={onDisconnectSpeaker}
            onSelectActiveSpeaker={onSelectActiveSpeaker}
          />

          <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-950 space-y-0.5">
            <div className="font-semibold">{alert.headline}</div>
            <div className="text-red-800">
              Live Headcount: <strong className="font-mono">{alert.studentCount}</strong> ·{' '}
              {alert.voiceCue}
            </div>
          </div>

          {/* Preset selector */}
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-slate-700">
              Emergency PA Scenario
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PA_BROADCAST_PRESETS.filter((p) => p.id !== 'all-clear').map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPreset(p.id)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border cursor-pointer transition-colors ${
                    presetId === p.id
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {p.shortLabel}
                </button>
              ))}
            </div>
          </div>

          {/* Spoken Announcement Script */}
          <div className="space-y-1.5">
            <label htmlFor="pa-modal-script" className="block text-xs font-semibold text-slate-700">
              Spoken PA Loudspeaker Announcement
            </label>
            <textarea
              id="pa-modal-script"
              rows={3}
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-900 focus-visible:outline-2 focus-visible:outline-red-600"
            />
          </div>

          {/* Options */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeSiren}
                onChange={(e) => setIncludeSiren(e.target.checked)}
                className="accent-red-600"
              />
              <span>Sound Evacuation Siren First</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={repeatTwice}
                onChange={(e) => setRepeatTwice(e.target.checked)}
                className="accent-red-600"
              />
              <span>Repeat Announcement 2×</span>
            </label>
          </div>

          {/* On-site Units to Dispatch */}
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-slate-700">
              Log On-Site Rescue Units Dispatched
            </span>
            <div className="flex flex-wrap gap-1.5">
              {ALL_RESCUE_UNITS.map((unit) => {
                const active = selectedUnits.includes(unit);
                return (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => toggleUnit(unit)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md border cursor-pointer transition-colors ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {unit}
                  </button>
                );
              })}
            </div>
          </div>

          {broadcastSent && speakerGate.allowed ? (
            <div
              role="status"
              className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>
                PA evacuation broadcast launched on <strong>{speakerGate.activeSpeaker?.name}</strong>{' '}
                &amp; logged to Rescue Command.
              </span>
            </div>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          {paIsOnAir ? (
            <button
              type="button"
              onClick={onStopPaAudio}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>Silence PA / Siren</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              Close
            </button>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="pa-modal-voice-only-btn"
              disabled={!speakerGate.allowed}
              title={speakerGate.allowed ? 'Play chime and spoken PA announcement' : speakerGate.reason}
              onClick={() => handleLaunchBroadcast(false)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              <Volume2 className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />
              <span>{speakerGate.allowed ? 'Chime + Voice PA' : 'Connect Speaker First'}</span>
            </button>
            <button
              type="button"
              data-testid="pa-modal-siren-broadcast-btn"
              disabled={!speakerGate.allowed}
              title={speakerGate.allowed ? 'Sound emergency siren and broadcast PA announcement' : speakerGate.reason}
              onClick={() => handleLaunchBroadcast(includeSiren)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-45 disabled:cursor-not-allowed text-white cursor-pointer"
            >
              <Siren className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {speakerGate.allowed ? 'Sound Siren & Broadcast PA' : 'Speaker Required'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
