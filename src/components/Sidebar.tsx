import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  SlidersHorizontal,
} from 'lucide-react';
import type {
  AiEngineModel,
  ClassroomCamera,
  FacilityMode,
  ThreatSensitivity,
} from '../types';
import {
  type CampusSummary,
  DEFAULT_DB_CALIBRATION_OFFSET,
  SOUND_ALERT_THRESHOLD_DB,
  formatFacilityLabels,
} from '../utils/monitoringLogic';
import { GoogleSignInButton } from './GoogleSignInButton';

interface SidebarProps {
  cameras: ClassroomCamera[];
  summary: CampusSummary;
  facilityMode: FacilityMode;
  onChangeFacilityMode: (mode: FacilityMode) => void;
  threatSensitivity: ThreatSensitivity;
  onChangeThreatSensitivity: (mode: ThreatSensitivity) => void;
  focusedCameraId: string | null;
  onFocusCamera: (cameraId: string | null) => void;
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
  userEmail: string | null;
  userDisplayName: string | null;
  isSigningIn: boolean;
  onGoogleSignIn: () => void;
  onSignOut: () => void;
}

export function Sidebar({
  cameras,
  summary,
  facilityMode,
  onChangeFacilityMode,
  threatSensitivity,
  onChangeThreatSensitivity,
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
  userEmail,
  userDisplayName,
  isSigningIn,
  onGoogleSignIn,
  onSignOut,
}: SidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const labels = formatFacilityLabels(facilityMode);

  return (
    <aside className="hidden lg:flex lg:flex-col w-56 shrink-0 bg-[#0B0C0F] border-r border-zinc-800/90 select-none">
      {/* Primary Section: Camera Zone Roster */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/80">
        <section className="p-3.5 space-y-2" aria-label="Connected zone cameras">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-medium text-zinc-400">
              {labels.zonePlural}
            </h2>
            <span className="text-xs font-mono text-zinc-500 tabular-nums">
              {cameras.length}
            </span>
          </div>

          {cameras.length === 0 ? (
            <p className="px-1 text-xs text-zinc-500 leading-relaxed">
              No active feeds. Connect a Wi-Fi CCTV camera, webcam, or Bluetooth unit.
            </p>
          ) : (
            <ul className="space-y-0.5">
              <li>
                <button
                  type="button"
                  onClick={() => onFocusCamera(null)}
                  className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                    focusedCameraId === null
                      ? 'bg-zinc-800/90 text-zinc-50 font-medium'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <span className="truncate">All Feeds</span>
                  <span
                    className="font-mono text-[11px] text-zinc-400 tabular-nums"
                    data-testid="sidebar-total-kids"
                  >
                    {summary.totalKidsCount}
                  </span>
                </button>
              </li>
              {cameras.map((cam) => {
                const isFocused = focusedCameraId === cam.id;
                const statusColor =
                  cam.status === 'fighting'
                    ? 'text-red-400'
                    : cam.status === 'warning'
                      ? 'text-amber-400'
                      : 'text-zinc-400';
                return (
                  <li key={cam.id}>
                    <button
                      type="button"
                      onClick={() => onFocusCamera(isFocused ? null : cam.id)}
                      className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                        isFocused
                          ? 'bg-zinc-800/90 text-zinc-50 font-medium'
                          : 'text-zinc-300 hover:bg-zinc-900'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate">{cam.classroomName}</div>
                        <div className={`text-[11px] font-mono ${statusColor}`}>
                          {cam.status === 'fighting'
                            ? 'Alarm'
                            : cam.status === 'warning'
                              ? 'Warning'
                              : cam.cameraCode}
                        </div>
                      </div>
                      <span className="font-mono text-xs text-zinc-300 tabular-nums shrink-0">
                        {cam.studentCount}
                        {typeof cam.expectedTotalCount === 'number' && cam.expectedTotalCount > 0
                          ? `/${cam.expectedTotalCount}`
                          : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Core Detection Profile */}
        <section className="p-3.5 space-y-3" aria-label="Detection profile">
          <div className="space-y-1.5">
            <label
              htmlFor="facility-mode-select"
              className="block text-xs font-medium text-zinc-400 px-0.5"
            >
              Sector Profile
            </label>
            <select
              id="facility-mode-select"
              value={facilityMode}
              onChange={(e) => onChangeFacilityMode(e.target.value as FacilityMode)}
              className="w-full text-xs bg-[#131419] border border-zinc-800 rounded-md px-2.5 py-2 text-zinc-200 focus-visible:outline-2 focus-visible:outline-zinc-400"
            >
              <option value="all">Bank, School &amp; General</option>
              <option value="bank">Bank &amp; Vault</option>
              <option value="school">School &amp; Classroom</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-zinc-400 px-0.5">
              Threat Sensitivity
            </span>
            <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#131419] border border-zinc-800 rounded-md">
              <button
                type="button"
                onClick={() => onChangeThreatSensitivity('standard')}
                className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  threatSensitivity === 'standard'
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => onChangeThreatSensitivity('high')}
                className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                  threatSensitivity === 'high'
                    ? 'bg-zinc-100 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                High
              </button>
            </div>
          </div>
        </section>

        {/* Collapsible System & Audio Settings (keeps rail uncluttered by default) */}
        <section className="p-3.5" aria-label="System preferences">
          <button
            type="button"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="w-full flex items-center justify-between text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer py-0.5"
          >
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Alert &amp; Audio Tuning</span>
            </span>
            {settingsOpen ? (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>

          {settingsOpen ? (
            <div className="mt-3 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Desktop Alerts</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={desktopNotifications}
                  disabled={notificationPermission === 'unsupported'}
                  onClick={onToggleDesktopNotifications}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer disabled:opacity-40 ${
                    desktopNotifications
                      ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                      : 'bg-[#131419] text-zinc-400 border-zinc-800'
                  }`}
                >
                  {desktopNotifications ? 'On' : 'Off'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Alert Siren</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={soundAlertsEnabled}
                  onClick={onToggleSoundAlerts}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer ${
                    soundAlertsEnabled
                      ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                      : 'bg-[#131419] text-zinc-400 border-zinc-800'
                  }`}
                >
                  {soundAlertsEnabled ? 'On' : 'Off'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Spike Auto-Scan</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={audioSpikeAutoScan}
                  onClick={onToggleAudioSpikeAutoScan}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer ${
                    audioSpikeAutoScan
                      ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                      : 'bg-[#131419] text-zinc-400 border-zinc-800'
                  }`}
                >
                  {audioSpikeAutoScan ? 'On' : 'Off'}
                </button>
              </div>

              <div className="pt-1 space-y-1">
                <label
                  htmlFor="default-ai-model-select"
                  className="block text-[11px] text-zinc-400"
                >
                  Cloud Vision Model
                </label>
                <select
                  id="default-ai-model-select"
                  value={selectedAiModel}
                  onChange={(e) => onChangeAiModel(e.target.value as AiEngineModel)}
                  className="w-full text-xs bg-[#131419] border border-zinc-800 rounded-md px-2 py-1.5 text-zinc-200"
                >
                  <option value="gemini-4-neon">Gemini 4 Neon</option>
                  <option value="gemini-4-hydrogen">Gemini 4 Hydrogen</option>
                  <option value="gpt-6-astra">GPT-6 Astra (High)</option>
                  <option value="gpt-6-sol">GPT-6 Sol</option>
                </select>
              </div>

              <div className="pt-1 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <label htmlFor="sidebar-db-offset" className="text-zinc-400">
                    Mic Offset
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-zinc-200 tabular-nums">
                      +{dbCalibrationOffset} dB
                    </span>
                    {dbCalibrationOffset !== DEFAULT_DB_CALIBRATION_OFFSET ? (
                      <button
                        type="button"
                        onClick={() => onChangeDbCalibrationOffset(DEFAULT_DB_CALIBRATION_OFFSET)}
                        className="text-zinc-300 underline cursor-pointer"
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
                  className="w-full accent-zinc-200 cursor-pointer"
                />
                <p className="text-[11px] text-zinc-500 tabular-nums">
                  Trigger &gt; {SOUND_ALERT_THRESHOLD_DB.toFixed(1)} dB (3s)
                </p>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {/* Operator Account Footer */}
      <div className="p-3 border-t border-zinc-800/90 bg-[#09090B]">
        {userEmail ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-200 truncate">
                {userDisplayName || 'Operator'}
              </div>
              <div className="text-[11px] text-zinc-500 truncate">{userEmail}</div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <GoogleSignInButton loading={isSigningIn} compact onClick={onGoogleSignIn} />
        )}
      </div>
    </aside>
  );
}
