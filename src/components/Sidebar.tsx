import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Moon,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AiEngineModel,
  ClassroomCamera,
  FacilityMode,
  OperationMode,
  ThreatSensitivity,
  WatchlistLabelMode,
  WatchlistSubject,
} from '../types';
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
import {
  type CampusSummary,
  DEFAULT_DB_CALIBRATION_OFFSET,
  SOUND_ALERT_THRESHOLD_DB,
  formatFacilityLabels,
} from '../utils/monitoringLogic';
import { getWatchlistModeMeta } from '../utils/subjectIntelligence';
import { AppDownloadControls } from './AppDownloadControls';
import { GoogleSignInButton } from './GoogleSignInButton';

interface SidebarProps {
  cameras: ClassroomCamera[];
  summary: CampusSummary;
  operationMode: OperationMode;
  crowdDensityThreshold: number;
  onChangeCrowdDensityThreshold: (value: number) => void;
  roomAreaSqm: number;
  onChangeRoomAreaSqm: (areaSqm: number) => void;
  watchlistLabelMode: WatchlistLabelMode;
  onChangeWatchlistLabelMode: (mode: WatchlistLabelMode) => void;
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
  watchlist: WatchlistSubject[];
  onEnrollWatchlistPhoto: (file: File, label: string) => void;
  onRemoveWatchlistSubject: (id: string) => void;
  onStatusNotice?: (message: string) => void;
  themeMode: 'light' | 'dark';
  onChangeThemeMode: (mode: 'light' | 'dark') => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({
  cameras,
  summary,
  operationMode,
  crowdDensityThreshold,
  onChangeCrowdDensityThreshold,
  roomAreaSqm,
  onChangeRoomAreaSqm,
  watchlistLabelMode,
  onChangeWatchlistLabelMode,
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
  watchlist,
  onEnrollWatchlistPhoto,
  onRemoveWatchlistSubject,
  onStatusNotice,
  themeMode,
  onChangeThemeMode,
  mobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [zoneSearch, setZoneSearch] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(40);
  const watchlistFileRef = useRef<HTMLInputElement | null>(null);
  const labels = formatFacilityLabels(facilityMode);
  const watchlistMeta = getWatchlistModeMeta(watchlistLabelMode);
  const isDisaster = operationMode === 'disaster';
  const peakCamera = useMemo(() => {
    let best: ClassroomCamera | null = null;
    for (const cam of cameras) {
      if (!best || (cam.studentCount || 0) > (best.studentCount || 0)) {
        best = cam;
      }
    }
    return best;
  }, [cameras]);
  const peakCameraCount = peakCamera?.studentCount || 0;
  const crowdRisk = useMemo(
    () =>
      evaluateCrowdCrushRisk(Math.max(peakCameraCount, summary.totalKidsCount), crowdDensityThreshold, {
        roomAreaSqm,
        detectedPeople: peakCamera?.lastAnalysis?.detectedPeople,
      }),
    [crowdDensityThreshold, peakCamera, peakCameraCount, roomAreaSqm, summary.totalKidsCount]
  );

  const filteredSidebarCameras = useMemo(() => {
    const q = zoneSearch.trim().toLowerCase();
    const list = q
      ? cameras.filter((cam) =>
          `${cam.classroomName} ${cam.cameraCode} ${cam.bluetoothDeviceName}`.toLowerCase().includes(q)
        )
      : cameras;
    if (list.length <= 12) return list;
    const hasAlert = list.some((c) => c.status === 'fighting' || c.status === 'warning');
    if (!hasAlert) return list;
    const rank = (s: ClassroomCamera['status']) => (s === 'fighting' ? 0 : s === 'warning' ? 1 : 2);
    return [...list].sort((a, b) => rank(a.status) - rank(b.status));
  }, [cameras, zoneSearch]);

  const displayedSidebarCameras = useMemo(
    () => filteredSidebarCameras.slice(0, visibleLimit),
    [filteredSidebarCameras, visibleLimit]
  );

  const handleSelectCamera = (cameraId: string | null) => {
    onFocusCamera(cameraId);
    onCloseMobile?.();
  };

  const sidebarInner = (
    <>
      {/* Main Scrollable Rail */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-200/80">
        {/* Simple Default View: Connected Cameras & Zones */}
        <section className="p-4 space-y-2.5" aria-label="Connected zone cameras">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-slate-600">
              {labels.zonePlural}
            </h2>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {cameras.length}
            </span>
          </div>

          {cameras.length === 0 ? (
            <p className="px-1 text-xs text-slate-500 leading-relaxed">
              No cameras connected yet. Click Add Camera to start monitoring.
            </p>
          ) : (
            <div className="space-y-2">
              {cameras.length > 10 ? (
                <div className="relative">
                  <Search
                    className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={zoneSearch}
                    onChange={(e) => {
                      setZoneSearch(e.target.value);
                      setVisibleLimit(40);
                    }}
                    placeholder={`Search ${cameras.length} zones...`}
                    aria-label="Filter monitored zones"
                    data-testid="sidebar-zone-search"
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-blue-600"
                  />
                </div>
              ) : null}

              <ul className="space-y-1">
                <li>
                  <button
                    type="button"
                    onClick={() => handleSelectCamera(null)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                      focusedCameraId === null
                        ? 'bg-slate-900 text-white font-medium'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <span className="truncate">All Feeds</span>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        focusedCameraId === null ? 'text-slate-300' : 'text-slate-500'
                      }`}
                      data-testid="sidebar-total-kids"
                    >
                      {summary.totalKidsCount}
                    </span>
                  </button>
                </li>
                {displayedSidebarCameras.map((cam) => {
                  const isFocused = focusedCameraId === cam.id;
                  const statusColor =
                    cam.status === 'fighting'
                      ? isFocused
                        ? 'text-red-300'
                        : 'text-red-600'
                      : cam.status === 'warning'
                        ? isFocused
                          ? 'text-amber-300'
                          : 'text-amber-600'
                        : isFocused
                          ? 'text-slate-300'
                          : 'text-slate-400';
                  return (
                    <li key={cam.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectCamera(isFocused ? null : cam.id)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                          isFocused
                            ? 'bg-slate-900 text-white font-medium'
                            : 'text-slate-700 hover:bg-slate-100'
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
                        <span
                          className={`font-mono text-xs tabular-nums shrink-0 ${
                            isFocused ? 'text-slate-200' : 'text-slate-600'
                          }`}
                        >
                          {cam.sourceKind === 'microphone-only' || !cam.hasVideo
                            ? `${cam.audioLevel.toFixed(0)} dB`
                            : `${cam.studentCount}${
                                typeof cam.expectedTotalCount === 'number' && cam.expectedTotalCount > 0
                                  ? `/${cam.expectedTotalCount}`
                                  : ''
                              }`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {filteredSidebarCameras.length > visibleLimit ? (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + 60)}
                  className="w-full py-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
                >
                  Show more ({filteredSidebarCameras.length - visibleLimit} remaining)
                </button>
              ) : null}
            </div>
          )}
        </section>

        {/* Disaster Stampede & Crowd Crush Threshold Controls (Always visible in Disaster Mode) */}
        {isDisaster ? (
          <section
            className="p-4 space-y-2.5 bg-red-50/40"
            aria-label="Stampede and crowd crush threshold"
            data-testid="sidebar-crowd-threshold-section"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-red-900">
                Crowd Density Threshold
              </span>
              <span
                data-testid="sidebar-crowd-density-badge"
                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${
                  crowdRisk.status === 'CRITICAL CRUSH RISK'
                    ? 'bg-red-600 text-white'
                    : crowdRisk.status === 'ELEVATED'
                      ? 'bg-amber-500 text-white'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                }`}
              >
                {crowdRisk.status}
              </span>
            </div>

            <div className="space-y-2.5">
              {/* Room Floor Area (m²) so big halls stay SAFE when people are spread out */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-1 text-[11px]">
                  <label htmlFor="sidebar-room-area" className="text-slate-600 whitespace-nowrap">
                    Room Area
                  </label>
                  <span
                    data-testid="sidebar-room-area-value"
                    className="font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap"
                  >
                    {roomAreaSqm} m² · {(crowdRisk.densityPerSqm ?? 0).toFixed(2)} p/m²
                  </span>
                </div>
                <input
                  id="sidebar-room-area"
                  data-testid="sidebar-room-area-slider"
                  type="range"
                  min={MIN_ROOM_AREA_SQM}
                  max={MAX_ROOM_AREA_SQM}
                  step={5}
                  value={roomAreaSqm}
                  onChange={(e) => onChangeRoomAreaSqm(Number(e.target.value))}
                  className="w-full accent-red-600 cursor-pointer"
                />
                <div className="grid grid-cols-2 gap-1">
                  {ROOM_SIZE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onChangeRoomAreaSqm(preset.areaSqm)}
                      className={`py-1 px-1.5 text-[10px] font-mono font-semibold rounded border cursor-pointer transition-colors ${
                        roomAreaSqm === preset.areaSqm
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {preset.shortLabel}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 pt-1 border-t border-red-200/60">
                <div className="flex items-center justify-between text-[11px]">
                  <label htmlFor="sidebar-crowd-threshold" className="text-slate-600">
                    Effective Safe Cap
                  </label>
                  <span
                    data-testid="sidebar-crowd-threshold-value"
                    className="font-mono font-semibold text-slate-900 tabular-nums"
                  >
                    {crowdRisk.threshold} people
                  </span>
                </div>
                <input
                  id="sidebar-crowd-threshold"
                  data-testid="sidebar-crowd-threshold-slider"
                  type="range"
                  min={MIN_CROWD_DENSITY_THRESHOLD}
                  max={MAX_CROWD_DENSITY_THRESHOLD}
                  step={1}
                  value={crowdDensityThreshold}
                  onChange={(e) => onChangeCrowdDensityThreshold(Number(e.target.value))}
                  className="w-full accent-red-600 cursor-pointer"
                />
                <div className="flex items-center justify-between gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onChangeCrowdDensityThreshold(DEFAULT_DEMO_CROWD_THRESHOLD);
                      onChangeRoomAreaSqm(15);
                    }}
                    className={`flex-1 py-1 text-[10px] font-mono font-semibold rounded border cursor-pointer transition-colors ${
                      crowdDensityThreshold === DEFAULT_DEMO_CROWD_THRESHOLD && roomAreaSqm <= 20
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    15 (Demo Booth)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onChangeCrowdDensityThreshold(DEFAULT_LIVE_CROWD_THRESHOLD);
                      onChangeRoomAreaSqm(150);
                    }}
                    className={`flex-1 py-1 text-[10px] font-mono font-semibold rounded border cursor-pointer transition-colors ${
                      roomAreaSqm === 150
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    150 m² Hall
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* Advanced Settings Drawer (Collapsed by default so UI stays ultra-simple) */}
        <section className="p-4" aria-label="Advanced settings">
          <button
            type="button"
            aria-expanded={advancedOpen}
            data-testid="sidebar-advanced-settings-toggle"
            onClick={() => setAdvancedOpen((prev) => !prev)}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-700 hover:text-slate-950 transition-colors cursor-pointer py-1"
          >
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>Advanced Settings</span>
            </span>
            {advancedOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            )}
          </button>

          {!advancedOpen ? (
            <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
              Sector mode, AI sensitivity, Watchlist Re-ID, audio calibration &amp; ZIP download.
            </p>
          ) : (
            <div className="mt-4 space-y-4 text-xs">
              {/* Sector Profile */}
              <div className="space-y-1.5">
                <label
                  htmlFor="facility-mode-select"
                  className="block text-[11px] font-medium text-slate-500"
                >
                  Sector Profile
                </label>
                <select
                  id="facility-mode-select"
                  value={facilityMode}
                  onChange={(e) => onChangeFacilityMode(e.target.value as FacilityMode)}
                  className="w-full text-xs bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <option value="all">Bank, School &amp; General</option>
                  <option value="bank">Bank &amp; Vault</option>
                  <option value="school">School &amp; Classroom</option>
                </select>
              </div>

              {/* Threat Sensitivity */}
              <div className="space-y-1.5">
                <span className="block text-[11px] font-medium text-slate-500">
                  Threat Sensitivity
                </span>
                <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                  <button
                    type="button"
                    onClick={() => onChangeThreatSensitivity('standard')}
                    className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                      threatSensitivity === 'standard'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Standard
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeThreatSensitivity('high')}
                    className={`py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                      threatSensitivity === 'high'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    High
                  </button>
                </div>
              </div>

              {/* Watchlist / Missing Person Re-ID */}
              <div className="pt-3 border-t border-slate-200 space-y-2" aria-label={watchlistMeta.title}>
                <div className="flex items-center justify-between gap-1">
                  <span
                    data-testid="sidebar-watchlist-title"
                    className="text-[11px] font-semibold text-slate-700 truncate"
                  >
                    {watchlistMeta.title}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                    {watchlist.length}
                  </span>
                </div>

                <div
                  role="group"
                  aria-label="Watchlist or Missing Person Re-ID label mode"
                  className="grid grid-cols-2 gap-1 p-0.5 bg-slate-100 border border-slate-200 rounded-md"
                >
                  <button
                    type="button"
                    data-testid="watchlist-label-security"
                    aria-pressed={watchlistLabelMode === 'security'}
                    onClick={() => onChangeWatchlistLabelMode('security')}
                    className={`py-1 px-1 text-[10px] font-medium rounded transition-colors cursor-pointer truncate ${
                      watchlistLabelMode === 'security'
                        ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Security Watchlist
                  </button>
                  <button
                    type="button"
                    data-testid="watchlist-label-missing"
                    aria-pressed={watchlistLabelMode === 'missing-person'}
                    onClick={() => onChangeWatchlistLabelMode('missing-person')}
                    className={`py-1 px-1 text-[10px] font-medium rounded transition-colors cursor-pointer truncate ${
                      watchlistLabelMode === 'missing-person'
                        ? 'bg-white text-red-700 shadow-2xs font-semibold'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Missing / Evacuee
                  </button>
                </div>

                <p className="text-[10px] text-slate-500 leading-snug">
                  {watchlistMeta.description}
                </p>

                <input
                  ref={watchlistFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
                      onEnrollWatchlistPhoto(
                        file,
                        baseName ||
                          (watchlistLabelMode === 'missing-person'
                            ? `Evacuee ${watchlist.length + 1}`
                            : `Target ${watchlist.length + 1}`)
                      );
                    }
                    e.target.value = '';
                  }}
                />

                <button
                  type="button"
                  onClick={() => watchlistFileRef.current?.click()}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{watchlistMeta.enrollButtonLabel}</span>
                </button>

                {watchlist.length > 0 ? (
                  <ul className="space-y-1.5">
                    {watchlist.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-2 p-1.5 rounded-md bg-slate-50 border border-slate-200"
                      >
                        <img
                          src={item.thumbnailDataUrl}
                          alt={item.label}
                          className="w-8 h-8 rounded object-cover bg-slate-900 shrink-0 border border-slate-200"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-slate-900 truncate">{item.label}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span
                              title="Upper-body clothing signature"
                              className="w-2.5 h-2.5 rounded-sm border border-slate-300 shrink-0"
                              style={{ backgroundColor: item.signature.upperColorHex }}
                            />
                            <span
                              title="Lower-body clothing signature"
                              className="w-2.5 h-2.5 rounded-sm border border-slate-300 shrink-0"
                              style={{ backgroundColor: item.signature.lowerColorHex }}
                            />
                            <span className="text-[10px] font-mono text-slate-500 tabular-nums truncate">
                              {item.matchCount > 0 ? `${item.matchCount} hits` : item.sourceCameraCode}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveWatchlistSubject(item.id)}
                          aria-label={`Remove ${item.label} from watchlist`}
                          className="p-1 text-slate-400 hover:text-red-600 transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {/* Alert & Audio Calibration */}
              <div className="pt-3 border-t border-slate-200 space-y-2.5">
                <span className="block text-[11px] font-semibold text-slate-600">
                  Alerts &amp; Audio
                </span>

                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Desktop Alerts</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={desktopNotifications}
                    disabled={notificationPermission === 'unsupported'}
                    onClick={onToggleDesktopNotifications}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer disabled:opacity-40 ${
                      desktopNotifications
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-500 border-slate-300'
                    }`}
                  >
                    {desktopNotifications ? 'On' : 'Off'}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Alert Siren</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={soundAlertsEnabled}
                    onClick={onToggleSoundAlerts}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer ${
                      soundAlertsEnabled
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-500 border-slate-300'
                    }`}
                  >
                    {soundAlertsEnabled ? 'On' : 'Off'}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Spike Auto-Scan</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={audioSpikeAutoScan}
                    onClick={onToggleAudioSpikeAutoScan}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer ${
                      audioSpikeAutoScan
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-500 border-slate-300'
                    }`}
                  >
                    {audioSpikeAutoScan ? 'On' : 'Off'}
                  </button>
                </div>

                <div className="pt-1 space-y-1">
                  <label
                    htmlFor="default-ai-model-select"
                    className="block text-[11px] text-slate-500"
                  >
                    Cloud Vision Model
                  </label>
                  <select
                    id="default-ai-model-select"
                    value={selectedAiModel}
                    onChange={(e) => onChangeAiModel(e.target.value as AiEngineModel)}
                    className="w-full text-xs bg-white border border-slate-300 rounded-md px-2 py-1.5 text-slate-800"
                  >
                    <option value="gemini-4-neon">Gemini 4 Neon</option>
                    <option value="gemini-4-hydrogen">Gemini 4 Hydrogen</option>
                    <option value="gpt-6-astra">GPT-6 Astra (High)</option>
                    <option value="gpt-6-sol">GPT-6 Sol</option>
                  </select>
                </div>

                <div className="pt-1 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <label htmlFor="sidebar-db-offset" className="text-slate-500">
                      Mic Offset
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-700 tabular-nums">
                        +{dbCalibrationOffset} dB
                      </span>
                      {dbCalibrationOffset !== DEFAULT_DB_CALIBRATION_OFFSET ? (
                        <button
                          type="button"
                          onClick={() => onChangeDbCalibrationOffset(DEFAULT_DB_CALIBRATION_OFFSET)}
                          className="text-blue-600 underline cursor-pointer"
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
                    className="w-full accent-slate-900 cursor-pointer"
                  />
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    Trigger &gt; {SOUND_ALERT_THRESHOLD_DB.toFixed(1)} dB (3s)
                  </p>
                </div>
              </div>

              {/* Windows Desktop App & ZIP Package inside Advanced Settings */}
              <div className="pt-3 border-t border-slate-200">
                <AppDownloadControls embedded onStatusNotice={onStatusNotice} />
              </div>
            </div>
          )}
        </section>
        {/* Low-Light Interface Theme Toggle */}
        <section className="p-4 space-y-2" aria-label="Interface theme">
          <span className="block text-[11px] font-semibold text-slate-600">
            Interface Theme
          </span>
          <div
            role="group"
            aria-label="Switch light or dark interface"
            className="grid grid-cols-2 gap-1 p-0.5 bg-slate-100 border border-slate-200 rounded-md"
          >
            <button
              type="button"
              aria-pressed={themeMode === 'light'}
              data-testid="sidebar-theme-light"
              onClick={() => onChangeThemeMode('light')}
              className={`inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                themeMode === 'light'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Sun className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Light</span>
            </button>
            <button
              type="button"
              aria-pressed={themeMode === 'dark'}
              data-testid="sidebar-theme-dark"
              onClick={() => onChangeThemeMode('dark')}
              className={`inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer ${
                themeMode === 'dark'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Moon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Dark</span>
            </button>
          </div>
        </section>
      </div>

      {/* Operator Account Footer */}
      <div className="p-3.5 border-t border-slate-200 bg-slate-50/70">
        {userEmail ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-900 truncate">
                {userDisplayName || 'Operator'}
              </div>
              <div className="text-[11px] text-slate-500 truncate">{userEmail}</div>
            </div>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <GoogleSignInButton loading={isSigningIn} compact onClick={onGoogleSignIn} />
        )}
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-white border-r border-slate-200 select-none">
        {sidebarInner}
      </aside>

      {mobileOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Monitored zones and settings"
          data-testid="mobile-zones-drawer"
          className="lg:hidden fixed inset-0 z-50 flex items-end bg-slate-950/55 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCloseMobile?.();
          }}
        >
          <div className="w-full max-h-[86vh] bg-white rounded-t-3xl border-t border-slate-200 flex flex-col overflow-hidden shadow-2xl pb-[env(safe-area-inset-bottom)]">
            <div className="flex justify-center pt-2.5 pb-1">
              <span className="w-10 h-1 rounded-full bg-slate-300" aria-hidden="true" />
            </div>
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <span className="font-display text-sm font-semibold text-slate-900">
                Zones &amp; Command Settings
              </span>
              <button
                type="button"
                onClick={() => onCloseMobile?.()}
                aria-label="Close zones and settings"
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col">{sidebarInner}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
