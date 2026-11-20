import { AlertTriangle, Bell, CheckCircle2, ShieldAlert, Volume2, Zap } from 'lucide-react';
import type { AiEngineModel, ClassroomCamera, FacilityMode } from '../types';
import {
  DEFAULT_DB_CALIBRATION_OFFSET,
  formatFacilityLabels,
  type CampusSummary,
} from '../utils/monitoringLogic';

interface SidebarProps {
  cameras: ClassroomCamera[];
  summary: CampusSummary;
  facilityMode: FacilityMode;
  onChangeFacilityMode: (mode: FacilityMode) => void;
  focusedCameraId: string | null;
  onFocusCamera: (cameraId: string) => void;
  desktopNotifications: boolean;
  notificationPermission: NotificationPermission | 'unsupported';
  onToggleDesktopNotifications: () => void;
  soundAlertsEnabled: boolean;
  onToggleSoundAlerts: () => void;
  audioSpikeAutoScan: boolean;
  onToggleAudioSpikeAutoScan: () => void;
  selectedAiModel: AiEngineModel;
  onChangeAiModel: (model: AiEngineModel) => void;
  dbCalibrationOffset: number;
  onChangeDbCalibrationOffset: (offset: number) => void;
}

export function Sidebar({
  cameras,
  summary,
  facilityMode,
  onChangeFacilityMode,
  focusedCameraId,
  onFocusCamera,
  desktopNotifications,
  notificationPermission,
  onToggleDesktopNotifications,
  soundAlertsEnabled,
  onToggleSoundAlerts,
  audioSpikeAutoScan,
  onToggleAudioSpikeAutoScan,
  selectedAiModel,
  onChangeAiModel,
  dbCalibrationOffset,
  onChangeDbCalibrationOffset,
}: SidebarProps) {
  const labels = formatFacilityLabels(facilityMode);

  return (
    <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-white border-r border-slate-200 min-h-[calc(100vh-4rem)] p-4 gap-4">
      <section aria-label="Security totals">
        <h2 className="text-xs font-semibold text-slate-500 tracking-wide mb-2">
          Security Overview
        </h2>
        <dl className="divide-y divide-slate-100">
          <div className="py-2 flex items-baseline justify-between">
            <dt className="text-sm text-slate-600">
              All zones live sum
            </dt>
            <dd className="text-base font-semibold font-mono tabular-nums text-slate-900" data-testid="total-kids-count">
              {summary.totalKidsCount}
            </dd>
          </div>
          <div className="py-2 flex items-baseline justify-between">
            <dt className="text-sm text-slate-600">Active {labels.zonePlural.toLowerCase()}</dt>
            <dd className="text-base font-semibold font-mono tabular-nums text-slate-900" data-testid="total-cameras-count">
              {summary.totalCameras}
            </dd>
          </div>
          <div className="py-2 flex items-baseline justify-between">
            <dt className="text-sm text-slate-600">Voice feeds active</dt>
            <dd className="text-base font-semibold font-mono tabular-nums text-slate-900">
              {summary.voiceActiveCount}
            </dd>
          </div>
          <div className="py-2 flex items-baseline justify-between">
            <dt className="text-sm text-slate-600">Unread alerts</dt>
            <dd
              className={`text-base font-semibold font-mono tabular-nums ${
                summary.activeAlertsCount > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
              data-testid="unread-alerts-count"
            >
              {summary.activeAlertsCount}
            </dd>
          </div>
        </dl>
      </section>

      <div className="border-t border-slate-200 pt-4">
        <h2 className="text-xs font-semibold text-slate-500 tracking-wide mb-2">
          Per-Class Places ({cameras.length})
        </h2>
        {cameras.length === 0 ? (
          <p className="text-sm text-slate-500">No cameras connected yet.</p>
        ) : (
          <ul className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {cameras.map((cam) => {
              const isFocused = focusedCameraId === cam.id;
              return (
                <li key={cam.id}>
                  <button
                    type="button"
                    onClick={() => onFocusCamera(cam.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors flex items-center justify-between gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 ${
                      isFocused
                        ? 'bg-blue-50 text-blue-900 border border-blue-200'
                        : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{cam.classroomName}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 tabular-nums">
                        <span>{cam.cameraCode}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-slate-800">
                          {cam.studentCount} live
                          {typeof cam.expectedTotalCount === 'number' && cam.expectedTotalCount > 0
                            ? ` / ${cam.expectedTotalCount}`
                            : ''}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0" title={cam.status === 'fighting' ? 'Critical Alert' : 'Normal'}>
                      {cam.status === 'fighting' ? (
                        <ShieldAlert className="w-4 h-4 text-red-600" aria-label="Critical alert" />
                      ) : cam.status === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600" aria-label="Warning" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="Normal" />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-200 pt-4 space-y-3">
        <h2 className="text-xs font-semibold text-slate-500 tracking-wide">
          AI &amp; Alert Controls
        </h2>

        <div className="space-y-3">
          <div>
            <label htmlFor="facility-mode-select" className="block text-sm text-slate-700 mb-1">
              Facility security mode
            </label>
            <select
              id="facility-mode-select"
              value={facilityMode}
              onChange={(e) => onChangeFacilityMode(e.target.value as FacilityMode)}
              className="w-full text-sm bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <option value="all">Bank, School &amp; General</option>
              <option value="bank">Bank &amp; Financial Vault</option>
              <option value="school">School &amp; Classroom</option>
            </select>
          </div>

          <div>
            <label htmlFor="ai-engine-select" className="block text-sm text-slate-700 mb-1">
              Default AI for new cameras
            </label>
            <select
              id="ai-engine-select"
              value={selectedAiModel}
              onChange={(e) => onChangeAiModel(e.target.value as AiEngineModel)}
              className="w-full text-sm bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <option value="gemini-4-neon">Gemini 4 Neon</option>
              <option value="gemini-4-hydrogen">Gemini 4 Hydrogen</option>
              <option value="gpt-6-astra">GPT-6 Astra (High)</option>
              <option value="gpt-6-sol">GPT-6 Sol (Low)</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-700 inline-flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-slate-500" aria-hidden="true" />
              <span>Audio-spike scan</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={audioSpikeAutoScan}
              aria-label="Toggle automatic scan on loud audio spike"
              onClick={onToggleAudioSpikeAutoScan}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                audioSpikeAutoScan
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {audioSpikeAutoScan ? 'On' : 'Off'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-700 inline-flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-slate-500" aria-hidden="true" />
              <span>Desktop alerts</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={desktopNotifications}
              aria-label="Toggle desktop notifications"
              onClick={onToggleDesktopNotifications}
              disabled={notificationPermission === 'unsupported'}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                desktopNotifications
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              } disabled:opacity-50`}
            >
              {notificationPermission === 'denied'
                ? 'Blocked'
                : desktopNotifications
                  ? 'On'
                  : 'Off'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-700 inline-flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-slate-500" aria-hidden="true" />
              <span>Alert chime</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={soundAlertsEnabled}
              aria-label="Toggle alert sound chime"
              onClick={onToggleSoundAlerts}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                soundAlertsEnabled
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {soundAlertsEnabled ? 'On' : 'Off'}
            </button>
          </div>

          <div className="pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor="sidebar-db-offset" className="text-sm text-slate-700">
                Mic dB calibration
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono font-semibold text-slate-800 tabular-nums" data-testid="sidebar-db-offset-value">
                  +{dbCalibrationOffset} dB
                </span>
                {dbCalibrationOffset !== DEFAULT_DB_CALIBRATION_OFFSET ? (
                  <button
                    type="button"
                    onClick={() => onChangeDbCalibrationOffset(DEFAULT_DB_CALIBRATION_OFFSET)}
                    className="text-xs text-blue-600 hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
            <input
              id="sidebar-db-offset"
              type="range"
              min={85}
              max={120}
              step={1}
              value={dbCalibrationOffset}
              onChange={(e) => onChangeDbCalibrationOffset(Number(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
              <span>Quiet mic (+85)</span>
              <span>Sensitive (+120)</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
