import { BluetoothSearching } from 'lucide-react';
import type { ActiveWorkspaceView } from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';

interface TopBarProps {
  activeView: ActiveWorkspaceView;
  onSelectView: (view: ActiveWorkspaceView) => void;
  unreadAlertsCount: number;
  onOpenScanner: () => void;
  userEmail: string | null;
  userDisplayName: string | null;
  isSigningIn: boolean;
  onGoogleSignIn: () => void;
  onSignOut: () => void;
}

export function TopBar({
  activeView,
  onSelectView,
  unreadAlertsCount,
  onOpenScanner,
  userEmail,
  userDisplayName,
  isSigningIn,
  onGoogleSignIn,
  onSignOut,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-3 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-6">
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onSelectView('grid');
        }}
        className="text-sm sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 rounded-sm"
      >
        CampusGuard
      </a>

      <nav aria-label="Primary" className="flex items-center gap-2 sm:gap-5 text-xs sm:text-sm font-medium min-w-0">
        <button
          type="button"
          onClick={() => onSelectView('grid')}
          className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 ${
            activeView === 'grid'
              ? 'border-blue-600 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span className="hidden sm:inline">Live Grid</span>
          <span className="sm:hidden">Grid</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectView('bluetooth')}
          className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 ${
            activeView === 'bluetooth'
              ? 'border-blue-600 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span className="hidden sm:inline">Bluetooth</span>
          <span className="sm:hidden">BT</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectView('alerts')}
          className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 tabular-nums ${
            activeView === 'alerts'
              ? 'border-blue-600 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Alerts{unreadAlertsCount > 0 ? ` (${unreadAlertsCount})` : ''}
        </button>
        <button
          type="button"
          onClick={() => onSelectView('workspace')}
          className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 ${
            activeView === 'workspace'
              ? 'border-blue-600 text-slate-900'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span className="hidden sm:inline">Teacher Hub</span>
          <span className="sm:hidden">Teacher</span>
        </button>
      </nav>

      <div className="flex items-center gap-2 shrink-0">
        {userEmail ? (
          <button
            type="button"
            onClick={onSignOut}
            title={`Signed in as ${userEmail}. Click to sign out.`}
            className="hidden md:inline-flex items-center h-9 px-3 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            {userDisplayName || userEmail} · Sign out
          </button>
        ) : (
          <div className="hidden md:block">
            <GoogleSignInButton loading={isSigningIn} onClick={onGoogleSignIn} />
          </div>
        )}

        <button
          type="button"
          onClick={onOpenScanner}
          className="inline-flex items-center gap-1.5 px-2.5 sm:px-4 h-9 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <BluetoothSearching className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Add Camera</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>
    </header>
  );
}
