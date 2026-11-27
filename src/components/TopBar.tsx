import { Moon, Plus, RotateCw, SlidersHorizontal, Sun } from 'lucide-react';
import type { ActiveWorkspaceView } from '../types';

interface TopBarProps {
  activeView: ActiveWorkspaceView;
  onSelectView: (view: ActiveWorkspaceView) => void;
  unreadAlertsCount: number;
  evidenceCount: number;
  onOpenScanner: () => void;
  themeMode: 'light' | 'dark';
  onToggleThemeMode: () => void;
  isMobileLandscape: boolean;
  manualLandscape: boolean;
  onToggleLandscapeMode: () => void;
  onOpenMobileDrawer?: () => void;
}

export function TopBar({
  activeView,
  onSelectView,
  unreadAlertsCount,
  evidenceCount,
  onOpenScanner,
  themeMode,
  onToggleThemeMode,
  isMobileLandscape,
  manualLandscape,
  onToggleLandscapeMode,
  onOpenMobileDrawer,
}: TopBarProps) {
  const navItems: Array<{
    id: ActiveWorkspaceView;
    label: string;
    mobileLabel: string;
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
    { id: 'workspace', label: 'Teacher Hub', mobileLabel: 'Hub' },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div
        className={`px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-4 md:gap-8 ${
          isMobileLandscape ? 'h-11' : 'h-12 md:h-14'
        }`}
      >
        {/* Zone 1: Single-line Brand Wordmark */}
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

        {/* Zone 2: Clean typographic nav links (Desktop + Mobile Landscape inline) */}
        <nav
          aria-label="Primary navigation"
          className={`${
            isMobileLandscape ? 'flex items-center gap-3 sm:gap-5' : 'hidden md:flex items-center gap-6 lg:gap-7'
          } h-full overflow-x-auto`}
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                aria-current={isActive ? 'page' : undefined}
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
                    className="absolute inset-x-0 bottom-0 h-[2px] bg-slate-900"
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
    </header>
  );
}
