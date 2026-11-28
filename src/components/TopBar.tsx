import {
  Megaphone,
  Moon,
  Plus,
  RotateCw,
  School,
  Siren,
  SlidersHorizontal,
  Square,
  Sun,
  Volume2,
} from 'lucide-react';
import type { ActiveWorkspaceView, OperationMode } from '../types';
import { getOfflineResilienceStatus } from '../utils/localPersonDetector';
import { formatOperationModeBranding } from '../utils/monitoringLogic';

interface TopBarProps {
  activeView: ActiveWorkspaceView;
  onSelectView: (view: ActiveWorkspaceView) => void;
  operationMode: OperationMode;
  onChangeOperationMode: (mode: OperationMode) => void;
  isOnline: boolean;
  unreadAlertsCount: number;
  evidenceCount: number;
  onOpenScanner: () => void;
  themeMode: 'light' | 'dark';
  onToggleThemeMode: () => void;
  isMobileLandscape: boolean;
  manualLandscape: boolean;
  onToggleLandscapeMode: () => void;
  onOpenMobileDrawer?: () => void;
  paIsOnAir?: boolean;
  autoPaEnabled?: boolean;
  onStopPaAudio?: () => void;
}

export function TopBar({
  activeView,
  onSelectView,
  operationMode,
  onChangeOperationMode,
  isOnline,
  unreadAlertsCount,
  evidenceCount,
  onOpenScanner,
  themeMode,
  onToggleThemeMode,
  isMobileLandscape,
  manualLandscape,
  onToggleLandscapeMode,
  onOpenMobileDrawer,
  paIsOnAir = false,
  autoPaEnabled = true,
  onStopPaAudio,
}: TopBarProps) {
  const branding = formatOperationModeBranding(operationMode);
  const resilience = getOfflineResilienceStatus(isOnline);
  const isDisaster = operationMode === 'disaster';

  const navItems: Array<{
    id: ActiveWorkspaceView;
    label: string;
    mobileLabel: string;
    title?: string;
    count?: number;
    countTone?: 'red' | 'neutral';
  }> = [
    { id: 'grid', label: 'Cameras', mobileLabel: 'Cams' },
    {
      id: 'alerts',
      label: 'Alerts',
      mobileLabel: 'Alerts',
      count: unreadAlertsCount > 0 ? unreadAlertsCount : undefined,
      countTone: 'red',
    },
    {
      id: 'evidence',
      label: 'Evidence',
      mobileLabel: 'Vault',
      count: evidenceCount > 0 ? evidenceCount : undefined,
      countTone: 'neutral',
    },
    { id: 'bluetooth', label: 'Devices', mobileLabel: 'Devices' },
    {
      id: 'workspace',
      label: branding.workspaceNavLabel,
      mobileLabel: branding.workspaceNavMobileLabel,
      title: branding.workspaceFullTitle,
    },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div
        className={`px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-3 lg:gap-6 ${
          isMobileLandscape ? 'h-11' : 'h-12 md:h-14'
        }`}
      >
        {/* Zone 1: Brand Wordmark + Dual-Mode Switcher Pill */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              onSelectView('grid');
            }}
            className="font-display font-semibold text-[15px] md:text-base tracking-tight text-slate-900 hover:text-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            CampusGuard
          </a>

          <div
            role="group"
            aria-label="Operation mode switcher"
            data-testid="operation-mode-switcher"
            className="hidden sm:inline-flex items-center bg-slate-100 border border-slate-200 rounded-full p-0.5 shrink-0"
          >
            <button
              type="button"
              data-testid="mode-switch-disaster"
              aria-pressed={isDisaster}
              onClick={() => onChangeOperationMode('disaster')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                isDisaster
                  ? 'bg-red-600 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Siren className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>Disaster Management Mode</span>
            </button>
            <button
              type="button"
              data-testid="mode-switch-school"
              aria-pressed={!isDisaster}
              onClick={() => onChangeOperationMode('school')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                !isDisaster
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <School className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>School Safety Mode</span>
            </button>
          </div>
        </div>

        {/* Zone 2: Clean typographic nav links (Desktop + Mobile Landscape inline) */}
        <nav
          aria-label="Primary navigation"
          className={`${
            isMobileLandscape ? 'flex items-center gap-3 sm:gap-4' : 'hidden lg:flex items-center gap-5 xl:gap-6'
          } h-full overflow-x-auto`}
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={item.title}
                onClick={() => onSelectView(item.id)}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`topbar-nav-${item.id}`}
                className={`relative h-full inline-flex items-center gap-1.5 ${
                  isMobileLandscape ? 'text-xs' : 'text-sm'
                } font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive ? 'text-slate-950' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <span>{isMobileLandscape ? item.mobileLabel : item.label}</span>
                {typeof item.count === 'number' ? (
                  <span
                    className={`font-mono text-[11px] font-semibold tabular-nums ${
                      item.countTone === 'red' ? 'text-red-600' : 'text-slate-500'
                    }`}
                  >
                    {item.count}
                  </span>
                ) : null}
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 bottom-0 h-[2px] ${
                      isDisaster ? 'bg-red-600' : 'bg-slate-900'
                    }`}
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Mobile Landscape Toggle + Theme Toggle + Primary Action */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isMobileLandscape && onOpenMobileDrawer ? (
            <button
              type="button"
              onClick={onOpenMobileDrawer}
              aria-label="Open zones and settings"
              title="Zones & Settings"
              className="lg:hidden p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer shrink-0"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          ) : null}

          <button
            type="button"
            onClick={onToggleLandscapeMode}
            data-testid="mobile-landscape-toggle"
            aria-pressed={isMobileLandscape || manualLandscape}
            aria-label={
              isMobileLandscape || manualLandscape
                ? 'Exit landscape mode'
                : 'Switch to landscape mode'
            }
            title={
              isMobileLandscape || manualLandscape
                ? 'Exit Landscape Mode'
                : 'Enter Widescreen Landscape Mode'
            }
            className={`lg:hidden inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer shrink-0 ${
              isMobileLandscape || manualLandscape
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="hidden xs:inline sm:inline">
              {isMobileLandscape || manualLandscape ? 'Landscape' : 'Rotate'}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleThemeMode}
            data-testid="topbar-theme-toggle"
            aria-label={themeMode === 'dark' ? 'Switch to light interface' : 'Switch to dark interface'}
            title={themeMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Low-Light Dark Mode'}
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer shrink-0"
          >
            {themeMode === 'dark' ? (
              <Sun className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenScanner}
            data-testid="topbar-add-camera"
            className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Add Camera</span>
          </button>
        </div>
      </div>

      {/* Sub-header Tactical Strip: Mobile Mode Pill + Adaptive Subtitle + Network/Edge Resilience Indicator */}
      <div
        data-testid="topbar-status-strip"
        className={`px-3 sm:px-4 lg:px-6 py-1.5 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 ${
          isDisaster ? 'bg-red-50/70' : 'bg-slate-50/70'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Mobile Portrait Compact Mode Switcher */}
          <div
            role="group"
            aria-label="Mobile operation mode switcher"
            className="inline-flex sm:hidden items-center bg-slate-100 border border-slate-200 rounded-full p-0.5 shrink-0"
          >
            <button
              type="button"
              data-testid="mobile-mode-switch-disaster"
              aria-pressed={isDisaster}
              onClick={() => onChangeOperationMode('disaster')}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                isDisaster ? 'bg-red-600 text-white' : 'text-slate-600'
              }`}
            >
              <Siren className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
              <span>Disaster</span>
            </button>
            <button
              type="button"
              data-testid="mobile-mode-switch-school"
              aria-pressed={!isDisaster}
              onClick={() => onChangeOperationMode('school')}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                !isDisaster ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
            >
              <School className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
              <span>School</span>
            </button>
          </div>

          <p
            data-testid="header-mode-subtitle"
            className={`hidden sm:block text-[11px] font-medium truncate ${
              isDisaster ? 'text-red-800' : 'text-slate-600'
            }`}
          >
            {branding.headerSubtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isDisaster ? (
            paIsOnAir ? (
              <button
                type="button"
                data-testid="topbar-stop-pa"
                onClick={() => onStopPaAudio?.()}
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-600 text-white text-[11px] font-mono font-bold hover:bg-red-700 animate-pulse cursor-pointer whitespace-nowrap"
              >
                <Square className="w-2.5 h-2.5 fill-current shrink-0" aria-hidden="true" />
                <span>PA ON AIR · STOP</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="topbar-pa-console-pill"
                onClick={() => onSelectView('workspace')}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-red-300 bg-white text-red-700 hover:bg-red-50 text-[11px] font-mono font-semibold cursor-pointer whitespace-nowrap"
                title="Open Venue PA Loudspeaker & Rescue Command Console"
              >
                {autoPaEnabled ? (
                  <Volume2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                ) : (
                  <Megaphone className="w-3 h-3 shrink-0" aria-hidden="true" />
                )}
                <span>
                  {autoPaEnabled ? 'AUTO-PA ARMED' : 'PA CONSOLE'}
                </span>
              </button>
            )
          ) : (
            /* Tablet nav shortcut for Workspace when top nav collapses below lg */
            <button
              type="button"
              onClick={() => onSelectView('workspace')}
              className="hidden sm:inline-flex lg:hidden items-center px-2 py-0.5 text-[10px] font-semibold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {branding.workspaceNavLabel}
            </button>
          )}

          <div
            role="status"
            aria-label={`Disaster Resilience Status: ${resilience.badgeLabel}`}
            data-testid="resilience-status-badge"
            title={`Disaster Resilience Status — ${resilience.badgeLabel} · ${resilience.activeBackendLabel}`}
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-mono font-semibold whitespace-nowrap ${
              resilience.isOnline
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-300 text-amber-900'
            }`}
          >
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full shrink-0 ${
                resilience.isOnline ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
              }`}
            />
            <span className="hidden md:inline">{resilience.badgeLabel}</span>
            <span className="md:hidden">{resilience.compactBadgeLabel}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
