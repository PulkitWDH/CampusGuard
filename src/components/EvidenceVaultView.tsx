import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileJson,
  Film,
  Pause,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Trash2,
  Video,
} from 'lucide-react';
import type { ForensicEvidenceCase } from '../types';
import { verifyForensicEvidenceIntegrity } from '../utils/tacticalForensics';

interface EvidenceVaultViewProps {
  cases: ForensicEvidenceCase[];
  selectedCaseId: string | null;
  onSelectCase: (caseId: string) => void;
  onDeleteCase: (caseId: string) => void;
  onReturnToWall: () => void;
}

export function EvidenceVaultView({
  cases,
  selectedCaseId,
  onSelectCase,
  onDeleteCase,
  onReturnToWall,
}: EvidenceVaultViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'manual'>('all');
  const [viewMode, setViewMode] = useState<'video' | 'frames'>('frames');
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<0.5 | 1 | 2>(1);
  const [integrityResult, setIntegrityResult] = useState<{
    caseId: string;
    valid: boolean;
    checkedAt: string;
  } | null>(null);

  const filteredCases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cases.filter((item) => {
      if (severityFilter === 'critical' && item.severity !== 'critical') return false;
      if (severityFilter === 'manual' && item.triggerType !== 'manual_lock') {
        return false;
      }
      if (!q) return true;
      return (
        item.caseNumber.toLowerCase().includes(q) ||
        item.classroomName.toLowerCase().includes(q) ||
        item.headline.toLowerCase().includes(q) ||
        item.transcriptSnapshot.toLowerCase().includes(q) ||
        item.sha256Hash.toLowerCase().includes(q)
      );
    });
  }, [cases, searchQuery, severityFilter]);

  const activeCase = useMemo(() => {
    if (filteredCases.length === 0) return null;
    if (selectedCaseId) {
      const match = filteredCases.find((c) => c.id === selectedCaseId);
      if (match) return match;
    }
    return filteredCases[0];
  }, [filteredCases, selectedCaseId]);

  useEffect(() => {
    if (!activeCase) {
      setFrameIndex(0);
      setIsPlaying(false);
      setViewMode('frames');
      return;
    }
    setFrameIndex(Math.max(0, activeCase.frames.length - 1));
    setIsPlaying(false);
    setViewMode(activeCase.videoClipUrl ? 'video' : 'frames');
  }, [activeCase?.id, activeCase?.frames.length, activeCase?.videoClipUrl]);

  useEffect(() => {
    if (!isPlaying || !activeCase || activeCase.frames.length <= 1) return;
    const intervalMs = Math.round(900 / playbackSpeed);
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1 >= activeCase.frames.length ? 0 : prev + 1));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [activeCase, isPlaying, playbackSpeed]);

  const activeFrame =
    activeCase && activeCase.frames.length > 0
      ? activeCase.frames[Math.min(frameIndex, activeCase.frames.length - 1)]
      : null;

  const handleVerifyIntegrity = async () => {
    if (!activeCase) return;
    const result = await verifyForensicEvidenceIntegrity(activeCase);
    setIntegrityResult({
      caseId: activeCase.id,
      valid: result.valid,
      checkedAt: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    });
  };

  const handleDownloadFramePng = () => {
    if (!activeCase || !activeFrame) return;
    const link = document.createElement('a');
    link.href = activeFrame.imageDataUrl;
    link.download = `${activeCase.caseNumber.toLowerCase()}-frame-${frameIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadVideoClip = () => {
    if (!activeCase?.videoClipUrl) return;
    const link = document.createElement('a');
    link.href = activeCase.videoClipUrl;
    link.download = `${activeCase.caseNumber.toLowerCase()}-dvr-clip.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportDossierJson = () => {
    if (!activeCase) return;
    const dossier = {
      schema: 'campusguard-forensic-dossier-v1',
      exportedAt: new Date().toISOString(),
      caseNumber: activeCase.caseNumber,
      chainOfCustodySha256: activeCase.sha256Hash,
      cameraCode: activeCase.cameraCode,
      zone: activeCase.classroomName,
      triggerType: activeCase.triggerType,
      threatCategory: activeCase.threatCategory,
      severity: activeCase.severity,
      headline: activeCase.headline,
      summary: activeCase.summary,
      sealedAt: activeCase.sealedAt,
      peakAudioDb: activeCase.peakAudioDb,
      maxPeopleCount: activeCase.maxPeopleCount,
      transcriptSnapshot: activeCase.transcriptSnapshot,
      perimeterZone: activeCase.perimeterZone ?? null,
      frameCount: activeCase.frames.length,
      frames: activeCase.frames.map((f, idx) => ({
        index: idx + 1,
        capturedAt: f.capturedAt,
        offsetSec: f.offsetSec,
        studentCount: f.studentCount,
        audioLevel: f.audioLevel,
        threatScore: f.threatScore,
        transcript: f.transcript,
        imageDataUrl: f.imageDataUrl,
      })),
    };
    const blob = new Blob([JSON.stringify(dossier, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeCase.caseNumber.toLowerCase()}-forensic-dossier.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const activeIntegrity =
    activeCase && integrityResult?.caseId === activeCase.id ? integrityResult : null;

  return (
    <section aria-label="Forensic Evidence Vault" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-950 tracking-tight">
            Forensic Evidence Vault
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Recorded black-box DVR video clips and pre-event forensic timelines sealed automatically on threat, perimeter breach, watchlist match, or manual capture with SHA-256 Chain-of-Custody verification.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500 font-mono tabular-nums">
          <span>{cases.length} sealed {cases.length === 1 ? 'case' : 'cases'}</span>
          <span aria-hidden="true">·</span>
          <span>
            {cases.reduce((acc, c) => acc + c.frames.length, 0)} DVR frames
          </span>
        </div>
      </div>

      {cases.length === 0 ? (
        <div className="border border-slate-200 bg-white rounded-lg p-10 text-center max-w-2xl mx-auto space-y-3">
          <Film className="w-8 h-8 text-slate-500 mx-auto" aria-hidden="true" />
          <h2 className="text-base font-semibold text-slate-900">No sealed forensic evidence yet</h2>
          <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
            Every live feed continuously records a rolling black-box DVR video clip and frame buffer. Threats, perimeter breaches, Watchlist Re-ID hits, or clicking <strong className="text-slate-800">Save Clip</strong> on any feed seal a tamper-evident case here automatically.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={onReturnToWall}
              className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Return to Command Wall
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Case Docket */}
          <div className="lg:col-span-4 space-y-3">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search forensic evidence cases"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search case ID, zone, transcript, or hash..."
                className="w-full text-xs pl-8 pr-3 py-2 border border-slate-200 rounded-md bg-white text-slate-900 placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-zinc-400"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-md">
              {(
                [
                  { id: 'all', label: 'All Cases' },
                  { id: 'critical', label: 'Critical / Hits' },
                  { id: 'manual', label: 'Manual Clips' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSeverityFilter(tab.id)}
                  className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                    severityFilter === tab.id
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="border border-slate-200 bg-white rounded-lg divide-y divide-slate-200 overflow-hidden max-h-[640px] overflow-y-auto">
              {filteredCases.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No sealed cases match your filter.
                </div>
              ) : (
                filteredCases.map((item) => {
                  const isSelected = activeCase?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectCase(item.id)}
                      className={`w-full text-left p-3.5 transition-colors cursor-pointer ${
                        isSelected ? 'bg-slate-100' : 'hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                        <span className="font-semibold text-slate-800">{item.caseNumber}</span>
                        <span
                          className={
                            item.severity === 'critical'
                              ? 'text-red-600 font-semibold'
                              : item.severity === 'warning'
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-500'
                          }
                        >
                          {item.severity === 'critical'
                            ? 'CRITICAL'
                            : item.severity === 'warning'
                              ? 'WARNING'
                              : 'SEALED'}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900 mt-1 line-clamp-1">
                        {item.headline}
                      </p>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 mt-1.5">
                        <span className="truncate">
                          {item.cameraCode} · {item.classroomName}
                        </span>
                        <span className="font-mono tabular-nums shrink-0">
                          {item.frames.length}f
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Forensic DVR Replay & Chain-of-Custody Console */}
          <div className="lg:col-span-8">
            {activeCase ? (
              <div className="border border-slate-200 bg-white rounded-lg overflow-hidden">
                {/* Case Header */}
                <div className="p-4 border-b border-slate-200 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                      <span className="text-slate-900 font-semibold">{activeCase.caseNumber}</span>
                      <span aria-hidden="true">·</span>
                      <span>{activeCase.cameraCode}</span>
                      <span aria-hidden="true">·</span>
                      <span>{activeCase.classroomName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(activeCase.sealedAt).toLocaleTimeString()}</span>
                    </div>
                    <h2 className="text-base font-semibold text-slate-950 mt-1">
                      {activeCase.headline}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">{activeCase.summary}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto min-w-0">
                    <button
                      type="button"
                      onClick={() => void handleVerifyIntegrity()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Verify Integrity</span>
                    </button>
                    {activeCase.videoClipUrl ? (
                      <button
                        type="button"
                        onClick={handleDownloadVideoClip}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Video className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Download WebM</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleDownloadFramePng}
                      disabled={!activeFrame}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-100 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Save Frame</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportDossierJson}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <FileJson className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Export Dossier</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteCase(activeCase.id)}
                      aria-label={`Delete ${activeCase.caseNumber}`}
                      className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Playback Mode Switcher when real WebM video clip is present */}
                {activeCase.videoClipUrl ? (
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 text-xs">
                    <div className="inline-flex items-center bg-slate-100 border border-slate-200 rounded p-0.5">
                      <button
                        type="button"
                        onClick={() => setViewMode('video')}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                          viewMode === 'video'
                            ? 'bg-slate-900 text-white font-semibold'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        Recorded Video (.webm)
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('frames')}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                          viewMode === 'frames'
                            ? 'bg-slate-900 text-white font-semibold'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        Forensic Frame Scrubber ({activeCase.frames.length}f)
                      </button>
                    </div>
                    <span className="font-mono text-[11px] text-emerald-600">LIVE DVR VIDEO SEALED</span>
                  </div>
                ) : null}

                {/* 16:9 Forensic Playback Stage */}
                <div className="relative aspect-video bg-black border-b border-slate-200 flex items-center justify-center overflow-hidden">
                  {viewMode === 'video' && activeCase.videoClipUrl ? (
                    <video
                      key={activeCase.videoClipUrl}
                      src={activeCase.videoClipUrl}
                      controls
                      playsInline
                      className="w-full h-full object-contain bg-black"
                    />
                  ) : activeFrame?.imageDataUrl ? (
                    <img
                      src={activeFrame.imageDataUrl}
                      alt={`Evidence frame ${frameIndex + 1} for ${activeCase.caseNumber}`}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-xs text-slate-500 font-mono">
                      No frame image captured for this case.
                    </div>
                  )}

                  {viewMode === 'frames' && activeFrame ? (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-800">
                      <span>
                        FRAME {frameIndex + 1}/{activeCase.frames.length} · T
                        {activeFrame.offsetSec >= 0
                          ? `+${activeFrame.offsetSec.toFixed(1)}s`
                          : `${activeFrame.offsetSec.toFixed(1)}s`}
                      </span>
                      <span>
                        {activeFrame.studentCount} people · {activeFrame.audioLevel.toFixed(1)} dB ·{' '}
                        {new Date(activeFrame.capturedAt).toISOString().slice(11, 23)} UTC
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* DVR Scrubber & Playback Controls */}
                <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setFrameIndex((prev) => Math.max(0, prev - 1));
                        }}
                        disabled={frameIndex <= 0}
                        aria-label="Previous evidence frame"
                        className="p-1.5 rounded-md border border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                      >
                        <SkipBack className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsPlaying((prev) => !prev)}
                        disabled={activeCase.frames.length <= 1}
                        aria-label={isPlaying ? 'Pause DVR replay' : 'Play DVR replay'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                      >
                        {isPlaying ? (
                          <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <Play className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{isPlaying ? 'Pause' : 'Replay'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsPlaying(false);
                          setFrameIndex((prev) =>
                            Math.min(Math.max(0, activeCase.frames.length - 1), prev + 1)
                          );
                        }}
                        disabled={frameIndex >= activeCase.frames.length - 1}
                        aria-label="Next evidence frame"
                        className="p-1.5 rounded-md border border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                      >
                        <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1 p-0.5 bg-white border border-slate-200 rounded-md">
                      {([0.5, 1, 2] as const).map((spd) => (
                        <button
                          key={spd}
                          type="button"
                          onClick={() => setPlaybackSpeed(spd)}
                          className={`px-2 py-1 text-[11px] font-mono rounded transition-colors cursor-pointer ${
                            playbackSpeed === spd
                              ? 'bg-slate-900 text-white font-semibold'
                              : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  </div>

                  {activeCase.frames.length > 1 ? (
                    <input
                      type="range"
                      aria-label="DVR evidence timeline scrubber"
                      min={0}
                      max={activeCase.frames.length - 1}
                      value={frameIndex}
                      onChange={(e) => {
                        setIsPlaying(false);
                        setFrameIndex(Number(e.target.value));
                      }}
                      className="w-full accent-zinc-100 cursor-pointer"
                    />
                  ) : null}
                </div>

                {/* Forensic Telemetry & Cryptographic SHA-256 Chain-of-Custody */}
                <div className="p-4 space-y-3 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-3 border-b border-slate-200">
                    <div>
                      <div className="text-[11px] text-slate-500">Trigger Source</div>
                      <div className="font-medium text-slate-800 mt-0.5 capitalize">
                        {activeCase.triggerType.replace('_', ' ')}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Peak Audio</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        {activeCase.peakAudioDb.toFixed(1)} dB
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Peak Occupancy</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                        {activeCase.maxPeopleCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Perimeter Zone</div>
                      <div className="font-medium text-slate-800 mt-0.5">
                        {activeCase.perimeterZone ? activeCase.perimeterZone.label : 'None drawn'}
                      </div>
                    </div>
                  </div>

                  {activeCase.transcriptSnapshot ? (
                    <div>
                      <div className="text-[11px] text-slate-500 mb-0.5">Captured Speech Cue</div>
                      <p className="text-slate-800 font-medium">
                        &ldquo;{activeCase.transcriptSnapshot}&rdquo;
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 font-medium">
                        Chain-of-Custody SHA-256 Digest
                      </span>
                      {activeIntegrity ? (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                            activeIntegrity.valid ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {activeIntegrity.valid ? (
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span>
                            {activeIntegrity.valid
                              ? `SHA-256 Verified · Intact (${activeIntegrity.checkedAt})`
                              : 'Integrity Mismatch Detected'}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          Click Verify Integrity to recompute hash
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2 break-all select-all">
                      {activeCase.sha256Hash}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
