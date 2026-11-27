import { Moon, Plus, Sun } from 'lucide-react';
import type { ActiveWorkspaceView } from '../types';

interface TopBarProps {
  activeView: ActiveWorkspaceView;
  onSelectView: (view: ActiveWorkspaceView) => void;
  unreadAlertsCount: number;
  evidenceCount: number;
  onOpenScanner: () => void;
  themeMode: 'light' | 'dark';
  onToggleThemeMode: () => void;
}

export function TopBar({
  activeView,
  onSelectView,
  unreadAlertsCount,
  evidenceCount,
  onOpenScanner,
  themeMode,
  onToggleThemeMode,
}: TopBarProps) {
  const navItems: Array<{
    id: ActiveWorkspaceView;
    label: string;
    mobileLabel: string;
    count?: number;
    countTone?: 'red' | 'neutral';
  }> = [
    { id: 'grid', label: 'Cameras', mobileLabel: 'Cameras' },
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
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="h-14 px-4 lg:px-6 flex items-center justify-between gap-4 md:gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectView('grid');
          }}
          className="font-display font-semibold text-base tracking-tight text-slate-900 hover:text-slate-700 transition-colors whitespace-nowrap shrink-0"
        >
          CampusGuard
        </a>

        {/* Zone 2 (Desktop): Clean typographic nav links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 lg:gap-7 h-full"
        >
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative h-full inline-flex items-center gap-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive ? 'text-slate-950' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <span>{item.label}</span>
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

        {/* Zone 3: Theme Toggle + Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
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
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Add Camera</span>
          </button>
        </div>
      </div>

      {/* Mobile Navigation Row */}
      <nav
        aria-label="Mobile navigation"
        className="flex md:hidden items-center justify-between border-t border-slate-200 px-3 h-10 gap-1 bg-white"
      >
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative h-full inline-flex items-center gap-1 px-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isActive ? 'text-slate-950' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <span className="sm:hidden">{item.mobileLabel}</span>
              <span className="hidden sm:inline">{item.label}</span>
              {typeof item.count === 'number' ? (
                <span
                  className={`font-mono text-[10px] font-semibold tabular-nums ${
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
    </header>
  );
}
