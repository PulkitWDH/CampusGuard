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
import { getOfflineResilienceStatus } from '../utils/localPersonDetector';
import { buildWindowsLauncherEntries, buildZipArchive } from '../utils/zipBuilder';

interface AppDownloadControlsProps {
  compact?: boolean;
  embedded?: boolean;
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
  embedded = false,
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
            'Downloaded CampusGuard-Windows-App-and-Website.zip (includes offline AI model, Windows desktop launcher, and local website server).'
          );
          return;
        }
      }
      const launcherBytes = buildZipArchive(buildWindowsLauncherEntries(origin));
      const fallbackBytes = new Uint8Array(launcherBytes.byteLength);
      fallbackBytes.set(launcherBytes);
      triggerBlobDownload(
        new Blob([fallbackBytes], { type: 'application/zip' }),
        'CampusGuard-Windows-Launcher.zip'
      );
      onStatusNotice?.(
        'Downloaded CampusGuard-Windows-Launcher.zip — extract and run OPEN-HOSTED-WINDOWS-APP.bat.'
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
        onStatusNotice?.('CampusGuard installed as a standalone desktop/mobile app.');
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
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={() => setInstallGuideOpen(false)}
    >
      <div
        className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Install CampusGuard as a Windows App
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Run in its own desktop window with full camera, mic, and offline AI access.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInstallGuideOpen(false)}
            aria-label="Close install instructions"
            className="p-1 text-slate-400 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {isIOS ? (
          <ol className="space-y-2 text-xs text-slate-600 list-decimal list-inside">
            <li>Tap the Share icon in Safari&apos;s toolbar.</li>
            <li>
              Scroll down and tap <span className="font-semibold text-slate-900">Add to Home Screen</span>.
            </li>
            <li>
              Tap <span className="font-semibold text-slate-900">Add</span> to launch fullscreen.
            </li>
          </ol>
        ) : (
          <div className="space-y-3 text-xs text-slate-600">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-semibold text-slate-900">Option 1 — Instant Windows App (Edge / Chrome)</div>
              <p className="text-slate-600 leading-relaxed">
                Click the <span className="text-slate-900 font-medium">Install App</span> icon in your browser address bar.
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              <div className="font-semibold text-slate-900">Option 2 — Offline Windows App &amp; Website ZIP</div>
              <p className="text-slate-600 leading-relaxed">
                Extract the ZIP on Windows and double-click{' '}
                <span className="font-mono text-slate-900">START-WINDOWS-APP.bat</span> or{' '}
                <span className="font-mono text-slate-900">START-WEBSITE-SERVER.bat</span>.
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 cursor-pointer"
          >
            <FolderArchive className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Download ZIP</span>
          </button>
          <button
            type="button"
            onClick={() => setInstallGuideOpen(false)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
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
              className="lg:hidden inline-flex items-center gap-1 text-xs bg-white border border-slate-300 rounded-md px-2 py-1 text-slate-700 hover:bg-slate-50 cursor-pointer"
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
            className="lg:hidden inline-flex items-center gap-1 text-xs bg-white border border-slate-300 rounded-md px-2 py-1 text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
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
      <div className={embedded ? 'space-y-2' : 'p-4 space-y-2'} aria-label="Windows App and ZIP Package">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-600">Windows App &amp; Web</span>
          {isInstalled ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-600">
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
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-60"
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
              className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <Laptop className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Install Windows App</span>
            </button>
          ) : null}
        </div>
      </div>
      {installModal}
    </>
  );
}

export function OfflineBanner({ isOnlineOverride }: { isOnlineOverride?: boolean } = {}) {
  const hookOnline = useOnlineStatus();
  const isOnline = typeof isOnlineOverride === 'boolean' ? isOnlineOverride : hookOnline;
  if (isOnline) return null;

  const status = getOfflineResilienceStatus(false);

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="bg-amber-50 border-b border-amber-200 text-amber-950 px-4 py-2 text-xs flex items-center justify-center gap-2.5"
    >
      <WifiOff className="w-4 h-4 shrink-0 text-amber-600" aria-hidden="true" />
      <span className="leading-snug">
        <strong className="font-semibold">{status.bannerTitle}:</strong> {status.bannerDetail}
      </span>
    </div>
  );
}
