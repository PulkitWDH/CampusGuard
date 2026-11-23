import { Plus } from 'lucide-react';
import type { ActiveWorkspaceView } from '../types';

interface TopBarProps {
  activeView: ActiveWorkspaceView;
  onSelectView: (view: ActiveWorkspaceView) => void;
  unreadAlertsCount: number;
  evidenceCount: number;
  onOpenScanner: () => void;
}

export function TopBar({
  activeView,
  onSelectView,
  unreadAlertsCount,
  evidenceCount,
  onOpenScanner,
}: TopBarProps) {
  const navItems: Array<{
    id: ActiveWorkspaceView;
    label: string;
    mobileLabel: string;
    count?: number;
    countTone?: 'red' | 'neutral';
  }> = [
    { id: 'grid', label: 'Command Wall', mobileLabel: 'Wall' },
    {
      id: 'alerts',
      label: 'Incidents',
      mobileLabel: 'Alerts',
      count: unreadAlertsCount > 0 ? unreadAlertsCount : undefined,
      countTone: 'red',
    },
    {
      id: 'evidence',
      label: 'Evidence Vault',
      mobileLabel: 'Vault',
      count: evidenceCount > 0 ? evidenceCount : undefined,
      countTone: 'neutral',
    },
    { id: 'bluetooth', label: 'Devices', mobileLabel: 'Devices' },
    { id: 'workspace', label: 'Teacher Hub', mobileLabel: 'Hub' },
  ];

  return (
    <header className="sticky top-0 z-30 bg-[#09090B]/95 backdrop-blur-md border-b border-zinc-800/90">
      <div className="h-13 px-4 lg:px-5 flex items-center justify-between gap-4 md:gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectView('grid');
          }}
          className="font-display font-semibold text-base tracking-tight text-zinc-100 hover:text-white transition-colors whitespace-nowrap shrink-0"
        >
          CampusGuard
        </a>

        {/* Zone 2 (Desktop): Clean typographic nav links with subtle bottom active rule */}
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
                  isActive ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>{item.label}</span>
                {typeof item.count === 'number' ? (
                  <span
                    className={`font-mono text-[11px] font-semibold tabular-nums ${
                      item.countTone === 'red' ? 'text-red-400' : 'text-zinc-300'
                    }`}
                  >
                    {item.count}
                  </span>
                ) : null}
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[2px] bg-zinc-100"
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onOpenScanner}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-zinc-100 text-zinc-950 hover:bg-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Add Camera</span>
          </button>
        </div>
      </div>

      {/* Mobile Navigation Row (zero clipping on 390px viewports) */}
      <nav
        aria-label="Mobile navigation"
        className="flex md:hidden items-center justify-between border-t border-zinc-800/80 px-3 h-10 gap-1"
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
                isActive ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span className="sm:hidden">{item.mobileLabel}</span>
              <span className="hidden sm:inline">{item.label}</span>
              {typeof item.count === 'number' ? (
                <span
                  className={`font-mono text-[10px] font-semibold tabular-nums ${
                    item.countTone === 'red' ? 'text-red-400' : 'text-zinc-300'
                  }`}
                >
                  {item.count}
                </span>
              ) : null}
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-zinc-100"
                />
              ) : null}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
