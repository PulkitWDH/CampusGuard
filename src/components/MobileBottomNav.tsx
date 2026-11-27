import { Bell, Bluetooth, Camera, FolderLock, SlidersHorizontal } from 'lucide-react';
import type { ActiveWorkspaceView } from '../types';

interface MobileBottomNavProps {
  activeView: ActiveWorkspaceView;
  onSelectView: (view: ActiveWorkspaceView) => void;
  unreadAlertsCount: number;
  evidenceCount: number;
  isSettingsOpen: boolean;
  onOpenSettings: () => void;
  hidden?: boolean;
}

export function MobileBottomNav({
  activeView,
  onSelectView,
  unreadAlertsCount,
  evidenceCount,
  isSettingsOpen,
  onOpenSettings,
  hidden = false,
}: MobileBottomNavProps) {
  if (hidden) return null;

  const tabs: Array<{
    id: ActiveWorkspaceView;
    label: string;
    icon: typeof Camera;
    count?: number;
    countTone?: 'red' | 'neutral';
  }> = [
    { id: 'grid', label: 'Cameras', icon: Camera },
    {
      id: 'alerts',
      label: 'Alerts',
      icon: Bell,
      count: unreadAlertsCount > 0 ? unreadAlertsCount : undefined,
      countTone: 'red',
    },
    {
      id: 'evidence',
      label: 'Vault',
      icon: FolderLock,
      count: evidenceCount > 0 ? evidenceCount : undefined,
      countTone: 'neutral',
    },
    { id: 'bluetooth', label: 'Devices', icon: Bluetooth },
  ];

  return (
    <nav
      aria-label="Mobile bottom navigation"
      data-testid="mobile-bottom-nav"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-5 h-14 px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = !isSettingsOpen && activeView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectView(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-lg transition-colors cursor-pointer ${
                isActive ? 'text-slate-950 font-semibold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon className="w-[19px] h-[19px]" aria-hidden="true" />
                {typeof tab.count === 'number' ? (
                  <span
                    className={`absolute -top-1.5 -right-3 font-mono text-[10px] font-bold tabular-nums leading-none ${
                      tab.countTone === 'red' ? 'text-red-600' : 'text-slate-600'
                    }`}
                  >
                    {tab.count > 99 ? '99+' : tab.count}
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] tracking-tight leading-none whitespace-nowrap">
                {tab.label}
              </span>
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute top-0 inset-x-4 h-[2px] rounded-full bg-slate-900"
                />
              ) : null}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onOpenSettings}
          data-testid="mobile-open-zones-drawer"
          aria-expanded={isSettingsOpen}
          aria-label="Open zones and settings"
          className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[44px] rounded-lg transition-colors cursor-pointer ${
            isSettingsOpen ? 'text-slate-950 font-semibold' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <SlidersHorizontal className="w-[19px] h-[19px]" aria-hidden="true" />
          <span className="text-[10px] tracking-tight leading-none whitespace-nowrap">
            Zones
          </span>
          {isSettingsOpen ? (
            <span
              aria-hidden="true"
              className="absolute top-0 inset-x-4 h-[2px] rounded-full bg-slate-900"
            />
          ) : null}
        </button>
      </div>
    </nav>
  );
}
