import { useState } from 'react';
import {
  Check,
  Download,
  FolderArchive,
  Laptop,
  Loader2,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { buildWindowsLauncherEntries, buildZipArchive } from '../utils/zipBuilder';

interface AppDownloadControlsProps {
  compact?: boolean;
  onStatusNotice?: (message: string) => void;
}

const ZIP_FILENAME = 'CampusGuard-Windows-App-and-Website.zip';

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function AppDownloadControls({
  compact = false,
  onStatusNotice,
}: AppDownloadControlsProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [installGuideOpen, setInstallGuideOpen] = useState(false);

  const handleDownloadZip = async () => {
    if (downloadingZip) return;
    setDownloadingZip(true);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    try {
      const response = await fetch(
        `/api/download-app-zip?origin=${encodeURIComponent(origin)}`
      );
      if (
        response.ok &&
        (response.headers.get('content-type') || '').includes('application/zip')
      ) {
        const blob = await response.blob();
        if (blob.size > 100) {
          triggerBlobDownload(blob, ZIP_FILENAME);
          onStatusNotice?.(
            'Downloaded CampusGuard-Windows-App-and-Website.zip (includes START-WINDOWS-APP.bat, START-WEBSITE-SERVER.bat, Desktop Shortcut installer, and full app source).'
          );
          return;
        }
      }
      // Static-host fallback: generate valid Windows App + Hosted Launcher ZIP client-side
      const launcherBytes = buildZipArchive(buildWindowsLauncherEntries(origin));
      const fallbackBytes = new Uint8Array(launcherBytes.byteLength);
      fallbackBytes.set(launcherBytes);
      triggerBlobDownload(
        new Blob([fallbackBytes], { type: 'application/zip' }),
        'CampusGuard-Windows-Launcher.zip'
      );
      onStatusNotice?.(
        'Downloaded CampusGuard-Windows-Launcher.zip — extract and run OPEN-HOSTED-WINDOWS-APP.bat or INSTALL-DESKTOP-SHORTCUT.ps1.'
      );
    } catch {
      const launcherBytes = buildZipArchive(buildWindowsLauncherEntries(origin));
      const fallbackBytes = new Uint8Array(launcherBytes.byteLength);
      fallbackBytes.set(launcherBytes);
      triggerBlobDownload(
        new Blob([fallbackBytes], { type: 'application/zip' }),
        'CampusGuard-Windows-Launcher.zip'
      );
      onStatusNotice?.(
        'Downloaded CampusGuard-Windows-Launcher.zip — extract and run OPEN-HOSTED-WINDOWS-APP.bat on Windows.'
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) {
        onStatusNotice?.(
          'CampusGuard installed as a standalone desktop/mobile app.'
        );
      }
      return;
    }
    setInstallGuideOpen(true);
  };

  const installModal = installGuideOpen ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Install CampusGuard as Windows App"
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      onClick={() => setInstallGuideOpen(false)}
    >
      <div
        className="w-full max-w-md bg-[#111216] border border-zinc-800 rounded-lg p-5 space-y-4 text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Install CampusGuard as a Windows App
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              Run in its own native window with a desktop icon, taskbar pin, and full camera/mic access.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInstallGuideOpen(false)}
            aria-label="Close install instructions"
            className="p-1 text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {isIOS ? (
          <ol className="space-y-2 text-xs text-zinc-300 list-decimal list-inside">
            <li>Tap the Share icon in Safari&apos;s toolbar.</li>
            <li>Scroll down and tap <span className="font-semibold text-zinc-100">Add to Home Screen</span>.</li>
            <li>Tap <span className="font-semibold text-zinc-100">Add</span> to launch CampusGuard fullscreen.</li>
          </ol>
        ) : (
          <div className="space-y-3 text-xs text-zinc-300">
            <div className="p-3 rounded-md bg-[#0B0C0F] border border-zinc-800 space-y-1.5">
              <div className="font-semibold text-zinc-100">Option 1 — Instant Windows App (Edge / Chrome)</div>
              <p className="text-zinc-400 leading-relaxed">
                Click the <span className="text-zinc-100 font-medium">Install App</span> icon on the right side of your browser address bar (or menu <span className="font-mono text-zinc-200">⋮ → Cast, save, and share → Install CampusGuard</span>).
              </p>
            </div>
            <div className="p-3 rounded-md bg-[#0B0C0F] border border-zinc-800 space-y-1.5">
              <div className="font-semibold text-zinc-100">Option 2 — Offline Windows App &amp; Website ZIP</div>
              <p className="text-zinc-400 leading-relaxed">
                Download the ZIP package, extract it on Windows, and double-click{' '}
                <span className="font-mono text-zinc-200">START-WINDOWS-APP.bat</span> (desktop window) or{' '}
                <span className="font-mono text-zinc-200">START-WEBSITE-SERVER.bat</span> (local website).
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setInstallGuideOpen(false);
              void handleDownloadZip();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            <FolderArchive className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Download ZIP</span>
          </button>
          <button
            type="button"
            onClick={() => setInstallGuideOpen(false)}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-zinc-100 text-zinc-950 hover:bg-zinc-200 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (compact) {
    return (
      <>
        <div className="inline-flex items-center gap-1.5">
          {!isInstalled ? (
            <button
              type="button"
              onClick={() => {
                void handleInstallClick();
              }}
              data-testid="mobile-install-app-btn"
              className="lg:hidden inline-flex items-center gap-1 text-xs bg-[#09090B] border border-zinc-800 rounded-md px-2 py-1 text-zinc-200 hover:border-zinc-700 cursor-pointer"
            >
              <Laptop className="w-3 h-3" aria-hidden="true" />
              <span>App</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void handleDownloadZip();
            }}
            disabled={downloadingZip}
            data-testid="mobile-download-zip-btn"
            className="lg:hidden inline-flex items-center gap-1 text-xs bg-[#09090B] border border-zinc-800 rounded-md px-2 py-1 text-zinc-200 hover:border-zinc-700 cursor-pointer disabled:opacity-50"
          >
            {downloadingZip ? (
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="w-3 h-3" aria-hidden="true" />
            )}
            <span>ZIP</span>
          </button>
        </div>
        {installModal}
      </>
    );
  }

  return (
    <>
      <section className="p-3.5 space-y-2" aria-label="Windows App and ZIP Package">
        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-xs font-medium text-zinc-400">Windows App &amp; Web</h2>
          {isInstalled ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400">
              <Check className="w-3 h-3" aria-hidden="true" />
              APP
            </span>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => {
              void handleDownloadZip();
            }}
            disabled={downloadingZip}
            data-testid="download-app-zip-btn"
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-md border border-zinc-700 bg-zinc-100 text-zinc-950 hover:bg-white transition-colors cursor-pointer disabled:opacity-60"
          >
            {downloadingZip ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
            ) : (
              <FolderArchive className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>{downloadingZip ? 'Packaging ZIP...' : 'Download ZIP (Win + Web)'}</span>
          </button>

          {!isInstalled ? (
            <button
              type="button"
              onClick={() => {
                void handleInstallClick();
              }}
              data-testid="install-windows-app-btn"
              className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-zinc-800 bg-[#131419] text-zinc-200 hover:bg-zinc-800/80 hover:border-zinc-700 transition-colors cursor-pointer"
            >
              <Laptop className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Install Windows App</span>
            </button>
          ) : null}
        </div>

        <p className="px-0.5 text-[11px] text-zinc-500 leading-snug">
          ZIP includes Windows desktop launcher, local website server, and shortcut installer.
        </p>
      </section>
      {installModal}
    </>
  );
}

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="bg-amber-950/80 border-b border-amber-700/70 text-amber-100 px-4 py-1.5 text-xs flex items-center justify-center gap-2"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0 text-amber-300" aria-hidden="true" />
      <span>
        Offline mode — local Edge AI person tracking, acoustic alarms, and DVR recording remain active.
      </span>
    </div>
  );
}
