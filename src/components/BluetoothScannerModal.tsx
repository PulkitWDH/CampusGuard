import { useEffect, useState } from 'react';
import {
  Bluetooth,
  Camera,
  CheckCircle2,
  ExternalLink,
  Mic,
  Plus,
  RefreshCw,
  Upload,
  Video,
  Wifi,
  X,
  XCircle,
} from 'lucide-react';
import type { BluetoothDeviceCandidate, ClassroomCamera } from '../types';
import {
  getBluetoothEnvironmentStatus,
  listHardwareMediaDevices,
  scanRealBluetoothDevice,
  searchNearbyBluetoothDevices,
} from '../utils/bluetoothDiscovery';
import { openRawMediaStream } from '../utils/mediaCapture';
import { classifyBluetoothCamera, parseSafeJsonText } from '../utils/monitoringLogic';
import {
  WIFI_CAMERA_BRAND_PRESETS,
  buildWifiCameraUrl,
} from '../utils/wifiCameraPresets';

export type ScannerModalTab = 'wifi' | 'bluetooth' | 'hardware' | 'upload';

interface BluetoothScannerModalProps {
  isOpen: boolean;
  initialTab?: ScannerModalTab;
  existingCameras: ClassroomCamera[];
  discoveredBluetooth: BluetoothDeviceCandidate[];
  onDeviceDiscovered: (device: BluetoothDeviceCandidate) => void;
  onClose: () => void;
  onAddWifiCamera: (params: {
    classroomName: string;
    streamUrl: string;
    wifiBrand: string;
    wifiDirectMode: boolean;
  }) => void;
  onAddBluetoothCamera: (
    device: BluetoothDeviceCandidate,
    classroomName: string,
    options: { streamUrl?: string; videoDeviceId?: string; audioDeviceId?: string; stream?: MediaStream }
  ) => void;
  onAddHardwareCamera: (
    classroomName: string,
    stream: MediaStream,
    videoDeviceId?: string,
    audioDeviceId?: string,
    deviceLabel?: string
  ) => void;
  onAddStreamUrlCamera: (classroomName: string, streamUrl: string) => void;
  onAddUploadedCamera: (
    classroomName: string,
    mediaUrl: string,
    mediaType: 'image' | 'video',
    voiceTranscript: string
  ) => void;
}

export function BluetoothScannerModal({
  isOpen,
  initialTab = 'wifi',
  existingCameras,
  discoveredBluetooth,
  onDeviceDiscovered,
  onClose,
  onAddWifiCamera,
  onAddBluetoothCamera,
  onAddHardwareCamera,
  onAddUploadedCamera,
}: BluetoothScannerModalProps) {
  const [activeTab, setActiveTab] = useState<ScannerModalTab>(initialTab);
  const [isScanningBt, setIsScanningBt] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);
  const [btNotices, setBtNotices] = useState<string[]>([]);
  const [blockedByIframe, setBlockedByIframe] = useState(false);
  const [btSearch, setBtSearch] = useState('');
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [btStreamUrls, setBtStreamUrls] = useState<Record<string, string>>({});
  const [overrideEligibleIds, setOverrideEligibleIds] = useState<Record<string, boolean>>({});

  // Wi-Fi CCTV Camera setup
  const [wifiBrandId, setWifiBrandId] = useState<string>('ip-webcam');
  const [wifiRoomName, setWifiRoomName] = useState('');
  const [wifiHostOrUrl, setWifiHostOrUrl] = useState('');
  const [wifiPort, setWifiPort] = useState('8080');
  const [wifiUsername, setWifiUsername] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiDirectMode, setWifiDirectMode] = useState(false);
  const [wifiTesting, setWifiTesting] = useState(false);
  const [wifiError, setWifiError] = useState<string | null>(null);
  const [wifiTestResult, setWifiTestResult] = useState<{
    resolvedUrl: string;
    latencyMs: number;
    previewDataUrl?: string;
    note: string;
  } | null>(null);

  // Hardware cameras & mics
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [hardwareRoomName, setHardwareRoomName] = useState('');
  const [hardwareError, setHardwareError] = useState<string | null>(null);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  // Upload footage
  const [uploadRoomName, setUploadRoomName] = useState('');
  const [uploadTranscript, setUploadTranscript] = useState('');
  const [uploadFileUrl, setUploadFileUrl] = useState<string | null>(null);
  const [uploadMediaType, setUploadMediaType] = useState<'image' | 'video'>('image');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selectedWifiPreset =
    WIFI_CAMERA_BRAND_PRESETS.find((p) => p.id === wifiBrandId) ??
    WIFI_CAMERA_BRAND_PRESETS[0];

  const refreshMediaDevices = async (requestPermission = false) => {
    setIsLoadingDevices(true);
    setHardwareError(null);
    try {
      const { videoInputs, audioInputs } = await listHardwareMediaDevices(requestPermission);
      setVideoDevices(videoInputs);
      setAudioDevices(audioInputs);
      if (videoInputs.length > 0 && !selectedVideoId) {
        setSelectedVideoId(videoInputs[0].deviceId);
      }
      if (audioInputs.length > 0 && !selectedAudioId) {
        setSelectedAudioId(audioInputs[0].deviceId);
      }
    } catch {
      setHardwareError('Unable to enumerate connected cameras or microphones.');
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void refreshMediaDevices(false);
      void getBluetoothEnvironmentStatus().then((status) => {
        if (status.isIframe || status.blockedByPermissionsPolicy) {
          setBlockedByIframe(true);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const connectedAddresses = new Set(existingCameras.map((c) => c.bluetoothAddress));

  const handleSelectWifiBrand = (brandId: string) => {
    setWifiBrandId(brandId);
    setWifiError(null);
    setWifiTestResult(null);
    const preset = WIFI_CAMERA_BRAND_PRESETS.find((p) => p.id === brandId);
    if (preset) {
      setWifiPort(preset.defaultPort);
    }
  };

  const handleTestWifiCamera = async () => {
    setWifiError(null);
    setWifiTestResult(null);

    const built = buildWifiCameraUrl({
      brandId: wifiBrandId,
      hostOrUrl: wifiHostOrUrl,
      port: wifiPort,
      username: wifiUsername,
      password: wifiPassword,
    });
    if (!built.ok) {
      setWifiError(built.error);
      return;
    }

    setWifiTesting(true);
    try {
      if (wifiDirectMode) {
        const started = performance.now();
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve();
          img.onerror = () =>
            reject(
              new Error(
                'Browser could not load Wi-Fi camera directly. Check that your device is on the same Wi-Fi network and that HTTP/CORS is allowed.'
              )
            );
          const sep = built.url.includes('?') ? '&' : '?';
          img.src = `${built.url}${sep}_t=${Date.now()}`;
        });
        setWifiTestResult({
          resolvedUrl: built.url,
          latencyMs: Math.max(1, Math.round(performance.now() - started)),
          previewDataUrl: built.url,
          note: 'Direct LAN browser connection verified.',
        });
        return;
      }

      const response = await fetch('/api/wifi-camera/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: built.url,
          probeCommonPaths: wifiBrandId === 'custom-url',
        }),
      });
      const raw = await response.text();
      const parsed = parseSafeJsonText<{
        reachable?: boolean;
        resolvedUrl?: string;
        latencyMs?: number;
        previewDataUrl?: string;
        error?: string;
      }>(raw);

      if (!parsed.ok || !response.ok || !parsed.data.reachable) {
        const serverErr = parsed.ok ? parsed.data.error : 'Server could not reach camera.';
        const lanHint = built.isPrivateLan
          ? ' Note: Private Wi-Fi IP (192.168.x.x / 10.x.x.x) requires running the server on your local Wi-Fi network OR enabling "Direct LAN Browser Mode" below.'
          : '';
        setWifiError(`${serverErr || 'Wi-Fi camera unreachable.'}${lanHint}`);
        return;
      }

      setWifiTestResult({
        resolvedUrl: parsed.data.resolvedUrl || built.url,
        latencyMs: parsed.data.latencyMs || 1,
        previewDataUrl: parsed.data.previewDataUrl,
        note: `Connected via server proxy (${parsed.data.latencyMs}ms).`,
      });
    } catch (err) {
      setWifiError(err instanceof Error ? err.message : 'Unable to test Wi-Fi camera.');
    } finally {
      setWifiTesting(false);
    }
  };

  const handleSubmitWifiCamera = () => {
    setWifiError(null);
    if (!wifiRoomName.trim()) {
      setWifiError('Please enter a zone or classroom name.');
      return;
    }

    const built = buildWifiCameraUrl({
      brandId: wifiBrandId,
      hostOrUrl: wifiHostOrUrl,
      port: wifiPort,
      username: wifiUsername,
      password: wifiPassword,
    });
    if (!built.ok) {
      setWifiError(built.error);
      return;
    }

    onAddWifiCamera({
      classroomName: wifiRoomName.trim(),
      streamUrl: wifiTestResult?.resolvedUrl || built.url,
      wifiBrand: selectedWifiPreset.label,
      wifiDirectMode,
    });

    setWifiRoomName('');
    setWifiHostOrUrl('');
    setWifiUsername('');
    setWifiPassword('');
    setWifiTestResult(null);
    onClose();
  };

  const handleSearchNearbyBt = async (requestMediaLabels = false) => {
    setIsScanningBt(true);
    setBtNotices([]);
    try {
      const res = await searchNearbyBluetoothDevices(
        (dev) => {
          onDeviceDiscovered(dev);
        },
        {
          requestMediaLabels,
          openPickerIfLEScanUnavailable: !requestMediaLabels,
        }
      );
      setBtNotices(res.notices);
      setBlockedByIframe(res.blockedByIframePolicy || res.envStatus.isIframe);
    } finally {
      setIsScanningBt(false);
    }
  };

  const handleScanBluetooth = async () => {
    setIsScanningBt(true);
    setBtNotices([]);
    try {
      const candidate = await scanRealBluetoothDevice();
      onDeviceDiscovered(candidate);
      setBtNotices([`Paired Bluetooth signal "${candidate.name}".`]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bluetooth scan cancelled.';
      if (/permissions policy|disallowed|iframe|standalone/i.test(msg)) {
        setBlockedByIframe(true);
      }
      setBtNotices([msg]);
    } finally {
      setIsScanningBt(false);
    }
  };

  const handleConnectBtCamera = async (device: BluetoothDeviceCandidate) => {
    const classroom = (roomNames[device.id] ?? '').trim();
    if (!classroom) {
      setBtNotices([`Please enter a zone or classroom name for ${device.name}.`]);
      return;
    }

    const customUrl = (btStreamUrls[device.id] ?? '').trim();
    if (customUrl) {
      onAddBluetoothCamera(device, classroom, {
        streamUrl: customUrl,
        audioDeviceId: device.audioDeviceId || selectedAudioId || undefined,
      });
      onClose();
      return;
    }

    try {
      const videoId = device.videoDeviceId || selectedVideoId;
      const audioId = device.audioDeviceId || selectedAudioId;
      const stream = await openRawMediaStream({
        includeVideo: true,
        videoDeviceId: videoId || undefined,
        audioDeviceId: audioId || undefined,
      });
      onAddBluetoothCamera(device, classroom, {
        stream,
        videoDeviceId: videoId || undefined,
        audioDeviceId: audioId || undefined,
      });
      onClose();
    } catch {
      setBtNotices([
        'Could not open local video/mic stream. Provide a Wi-Fi HTTP snapshot/MJPEG URL or allow camera permissions.',
      ]);
    }
  };

  const handleConnectHardware = async () => {
    setHardwareError(null);
    if (!hardwareRoomName.trim()) {
      setHardwareError('Please enter a zone or classroom name.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setHardwareError('Browser camera and microphone capture is unavailable here.');
      return;
    }
    try {
      const stream = await openRawMediaStream({
        includeVideo: true,
        videoDeviceId: selectedVideoId || undefined,
        audioDeviceId: selectedAudioId || undefined,
      });
      const chosenCam = videoDevices.find((d) => d.deviceId === selectedVideoId);
      onAddHardwareCamera(
        hardwareRoomName.trim(),
        stream,
        selectedVideoId || undefined,
        selectedAudioId || undefined,
        chosenCam?.label || 'Connected Camera'
      );
      setHardwareRoomName('');
      onClose();
    } catch {
      setHardwareError('Camera or microphone permission was denied, or the selected device is busy.');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    const objectUrl = URL.createObjectURL(file);
    setUploadFileUrl(objectUrl);
    setUploadMediaType(file.type.startsWith('video/') ? 'video' : 'image');
  };

  const handleSubmitUpload = () => {
    setUploadError(null);
    if (!uploadRoomName.trim()) {
      setUploadError('Please enter a zone or classroom name.');
      return;
    }
    if (!uploadFileUrl) {
      setUploadError('Please choose a security image or video file.');
      return;
    }
    onAddUploadedCamera(
      uploadRoomName.trim(),
      uploadFileUrl,
      uploadMediaType,
      uploadTranscript.trim()
    );
    setUploadRoomName('');
    setUploadTranscript('');
    setUploadFileUrl(null);
    onClose();
  };

  const normalizedSearch = btSearch.trim().toLowerCase();
  const filteredBluetooth = discoveredBluetooth.filter(
    (d) =>
      !normalizedSearch ||
      d.name.toLowerCase().includes(normalizedSearch) ||
      d.macAddress.toLowerCase().includes(normalizedSearch)
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-modal-title"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-[#101114] border border-zinc-800 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-zinc-800/90 flex items-center justify-between gap-4">
          <div>
            <h2 id="scanner-modal-title" className="text-base font-semibold text-zinc-100">
              Add Security Camera Feed
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Connect Wi-Fi-only CCTV cameras, Bluetooth CCTV, local USB/built-in cameras, or recorded footage.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera setup modal"
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 pt-1 border-b border-zinc-800/90 flex items-center gap-1 overflow-x-auto bg-[#0B0C0F]">
          {(
            [
              { id: 'wifi', label: 'Wi-Fi CCTV', icon: Wifi },
              { id: 'bluetooth', label: 'Bluetooth CCTV', icon: Bluetooth },
              { id: 'hardware', label: 'USB / Built-in Cam', icon: Camera },
              { id: 'upload', label: 'Upload Video / Photo', icon: Upload },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'border-zinc-100 text-zinc-50'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* TAB 1: WI-FI CCTV CAMERA */}
          {activeTab === 'wifi' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="wifi-room-input" className="block text-xs font-medium text-slate-300 mb-1">
                    Zone / Classroom Name
                  </label>
                  <input
                    id="wifi-room-input"
                    type="text"
                    value={wifiRoomName}
                    onChange={(e) => setWifiRoomName(e.target.value)}
                    placeholder="e.g., Main Corridor Wi-Fi Cam"
                    className="w-full text-sm px-3 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100 focus-visible:outline-2 focus-visible:outline-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="wifi-brand-select" className="block text-xs font-medium text-slate-300 mb-1">
                    Wi-Fi Camera Type / Brand
                  </label>
                  <select
                    id="wifi-brand-select"
                    value={wifiBrandId}
                    onChange={(e) => handleSelectWifiBrand(e.target.value)}
                    className="w-full text-xs px-2.5 py-2.5 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100"
                  >
                    {WIFI_CAMERA_BRAND_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="wifi-host-input" className="block text-xs font-medium text-slate-300 mb-1">
                    Wi-Fi IP Address or Snapshot / MJPEG URL
                  </label>
                  <input
                    id="wifi-host-input"
                    type="text"
                    value={wifiHostOrUrl}
                    onChange={(e) => {
                      setWifiHostOrUrl(e.target.value);
                      setWifiTestResult(null);
                    }}
                    placeholder={selectedWifiPreset.exampleHost}
                    className="w-full text-sm font-mono px-3 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100 focus-visible:outline-2 focus-visible:outline-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="wifi-port-input" className="block text-xs font-medium text-slate-300 mb-1">
                    Port (optional)
                  </label>
                  <input
                    id="wifi-port-input"
                    type="text"
                    value={wifiPort}
                    onChange={(e) => setWifiPort(e.target.value)}
                    placeholder={selectedWifiPreset.defaultPort || '80'}
                    className="w-full text-sm font-mono px-3 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100"
                  />
                </div>
              </div>

              <p className="text-xs text-slate-400">{selectedWifiPreset.notes}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="wifi-user-input" className="block text-xs font-medium text-slate-400 mb-1">
                    Camera Username (optional)
                  </label>
                  <input
                    id="wifi-user-input"
                    type="text"
                    value={wifiUsername}
                    onChange={(e) => setWifiUsername(e.target.value)}
                    placeholder="admin"
                    className="w-full text-xs px-3 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="wifi-pass-input" className="block text-xs font-medium text-slate-400 mb-1">
                    Camera Password (optional)
                  </label>
                  <input
                    id="wifi-pass-input"
                    type="password"
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full text-xs px-3 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={wifiDirectMode}
                  onChange={(e) => {
                    setWifiDirectMode(e.target.checked);
                    setWifiTestResult(null);
                  }}
                  className="mt-0.5 accent-blue-500 rounded cursor-pointer"
                />
                <span>
                  <strong className="text-slate-100">Direct Local Wi-Fi Mode</strong> — Load camera directly from your browser on the same Wi-Fi LAN (use if camera IP is private like <code className="font-mono text-slate-200">192.168.x.x</code> and this app is hosted remotely).
                </span>
              </label>

              {wifiError ? (
                <p role="alert" className="text-xs text-red-300 bg-red-950/50 border border-red-500/40 rounded-lg p-3">
                  {wifiError}
                </p>
              ) : null}

              {wifiTestResult ? (
                <div className="bg-emerald-950/35 border border-emerald-500/40 rounded-lg p-3 flex items-center gap-3">
                  {wifiTestResult.previewDataUrl ? (
                    <img
                      src={wifiTestResult.previewDataUrl}
                      alt="Verified Wi-Fi CCTV frame"
                      className="w-24 h-14 object-cover rounded border border-emerald-500/40 shrink-0"
                    />
                  ) : null}
                  <div className="min-w-0 text-xs">
                    <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Wi-Fi Camera Connected ({wifiTestResult.latencyMs}ms)</span>
                    </div>
                    <div className="text-slate-300 font-mono truncate mt-0.5">
                      {wifiTestResult.resolvedUrl}
                    </div>
                    <div className="text-slate-400 mt-0.5">{wifiTestResult.note}</div>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleTestWifiCamera()}
                  disabled={wifiTesting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-zinc-800 bg-[#16181D] text-zinc-200 hover:bg-zinc-800 disabled:opacity-60 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${wifiTesting ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span>{wifiTesting ? 'Testing Connection...' : 'Test Wi-Fi Feed'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSubmitWifiCamera}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-zinc-100 text-zinc-950 hover:bg-white cursor-pointer"
                >
                  <Wifi className="w-4 h-4" aria-hidden="true" />
                  <span>Add Wi-Fi CCTV Camera</span>
                </button>
              </div>
            </div>
          ) : null}

          {/* TAB 2: BLUETOOTH CCTV */}
          {activeTab === 'bluetooth' ? (
            <>
              {blockedByIframe && typeof window !== 'undefined' ? (
                <div className="bg-amber-950/45 border border-amber-500/40 text-amber-100 rounded-lg p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <p className="font-semibold">Embedded preview restricts Web Bluetooth</p>
                    <p className="text-amber-200/80 mt-0.5">
                      Open this app in a standalone Chrome or Edge tab to pair nearby Bluetooth CCTV cameras directly.
                    </p>
                  </div>
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-600 text-white hover:bg-amber-500 whitespace-nowrap shrink-0"
                  >
                    <span>Open Tab</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSearchNearbyBt(false)}
                  disabled={isScanningBt}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Bluetooth className="w-4 h-4" aria-hidden="true" />
                  <span>{isScanningBt ? 'Searching...' : 'Search Nearby Bluetooth'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleScanBluetooth()}
                  disabled={isScanningBt}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#182130] border border-slate-700 text-slate-100 hover:bg-slate-700 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Pair Bluetooth Picker</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleSearchNearbyBt(true)}
                  disabled={isScanningBt}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-[#0A0E14] text-slate-300 hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Scan Paired BT Audio/Cam</span>
                </button>
              </div>

              <input
                type="search"
                aria-label="Filter nearby Bluetooth devices"
                value={btSearch}
                onChange={(e) => setBtSearch(e.target.value)}
                placeholder="Search scanned Bluetooth devices by name or ID..."
                className="w-full text-xs px-3 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100 focus-visible:outline-2 focus-visible:outline-blue-500"
              />

              {btNotices.length > 0 ? (
                <div className="text-xs text-slate-300 bg-[#0D121B] border border-slate-800 rounded-lg p-3 space-y-1">
                  {btNotices.map((n, idx) => (
                    <p key={idx}>{n}</p>
                  ))}
                </div>
              ) : null}

              {filteredBluetooth.length === 0 ? (
                <div className="border border-dashed border-slate-700 rounded-xl p-6 text-center">
                  <Bluetooth className="w-7 h-7 text-slate-500 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-200">No Bluetooth devices scanned yet</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Click Search Nearby Bluetooth or Pair Bluetooth Picker in Chrome/Edge.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
                  {filteredBluetooth.map((device) => {
                    const classification = classifyBluetoothCamera(device);
                    const isEligible =
                      classification.isEligibleMonitor || Boolean(overrideEligibleIds[device.id]);
                    const alreadyAdded = connectedAddresses.has(device.macAddress);

                    return (
                      <div key={device.id} className="p-3.5 bg-[#0D121B] space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-100 truncate">
                                {device.name}
                              </span>
                              {isEligible ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 whitespace-nowrap">
                                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>
                                    {classification.isEligibleMonitor ? 'CCTV Video + Voice' : 'CCTV Override'}
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 whitespace-nowrap">
                                  <XCircle className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                                  <span>{classification.deviceCategoryLabel}</span>
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                              <span className="font-mono">{device.macAddress}</span>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1">
                                <Video className="w-3 h-3" aria-hidden="true" />
                                <span>{classification.supportsVideo ? 'Video' : 'No Video'}</span>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1">
                                <Mic className="w-3 h-3" aria-hidden="true" />
                                <span>{classification.supportsVoice ? 'Voice' : 'No Voice'}</span>
                              </span>
                            </div>
                          </div>

                          {alreadyAdded ? (
                            <span className="text-xs font-medium text-emerald-400 shrink-0">Connected</span>
                          ) : !isEligible ? (
                            <button
                              type="button"
                              onClick={() =>
                                setOverrideEligibleIds((prev) => ({ ...prev, [device.id]: true }))
                              }
                              className="text-xs font-medium text-blue-400 hover:underline shrink-0 cursor-pointer"
                            >
                              Treat as CCTV
                            </button>
                          ) : null}
                        </div>

                        {isEligible && !alreadyAdded ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                            <input
                              type="text"
                              value={roomNames[device.id] ?? ''}
                              onChange={(e) =>
                                setRoomNames((prev) => ({ ...prev, [device.id]: e.target.value }))
                              }
                              placeholder="Zone / Classroom name (required)"
                              className="text-xs px-2.5 py-1.5 border border-slate-700 rounded-md bg-[#0A0E14] text-slate-100"
                            />
                            <input
                              type="url"
                              value={btStreamUrls[device.id] ?? ''}
                              onChange={(e) =>
                                setBtStreamUrls((prev) => ({ ...prev, [device.id]: e.target.value }))
                              }
                              placeholder="Optional snapshot/MJPEG URL"
                              className="text-xs px-2.5 py-1.5 border border-slate-700 rounded-md bg-[#0A0E14] text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() => void handleConnectBtCamera(device)}
                              className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Add Zone Camera</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}

          {/* TAB 3: HARDWARE CAMERAS & MICS */}
          {activeTab === 'hardware' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-400">
                  Attach any connected USB webcam, built-in laptop camera, or Bluetooth-paired camera and microphone.
                </p>
                <button
                  type="button"
                  onClick={() => void refreshMediaDevices(true)}
                  disabled={isLoadingDevices}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-[#182130] text-slate-200 hover:bg-slate-700 cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Detect Names</span>
                </button>
              </div>

              <div>
                <label htmlFor="hw-room-input" className="block text-xs font-medium text-slate-300 mb-1">
                  Zone / Classroom Name
                </label>
                <input
                  id="hw-room-input"
                  type="text"
                  value={hardwareRoomName}
                  onChange={(e) => setHardwareRoomName(e.target.value)}
                  placeholder="e.g., Main Teller Lobby or Room 204"
                  className="w-full text-sm px-3 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100 focus-visible:outline-2 focus-visible:outline-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="hw-video-select" className="block text-xs font-medium text-slate-300 mb-1">
                    Video Camera Input
                  </label>
                  <select
                    id="hw-video-select"
                    value={selectedVideoId}
                    onChange={(e) => setSelectedVideoId(e.target.value)}
                    className="w-full text-xs px-2.5 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100"
                  >
                    {videoDevices.length === 0 ? (
                      <option value="">Default system camera</option>
                    ) : (
                      videoDevices.map((d, idx) => (
                        <option key={d.deviceId || idx} value={d.deviceId}>
                          {d.label || `Camera ${idx + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label htmlFor="hw-audio-select" className="block text-xs font-medium text-slate-300 mb-1">
                    Voice Microphone Input
                  </label>
                  <select
                    id="hw-audio-select"
                    value={selectedAudioId}
                    onChange={(e) => setSelectedAudioId(e.target.value)}
                    className="w-full text-xs px-2.5 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100"
                  >
                    {audioDevices.length === 0 ? (
                      <option value="">Default system microphone</option>
                    ) : (
                      audioDevices.map((d, idx) => (
                        <option key={d.deviceId || idx} value={d.deviceId}>
                          {d.label || `Microphone ${idx + 1}`}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {hardwareError ? (
                <p role="alert" className="text-xs text-red-400 font-medium">
                  {hardwareError}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void handleConnectHardware()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors cursor-pointer"
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>Connect Camera &amp; Mic</span>
              </button>
            </div>
          ) : null}

          {/* TAB 4: UPLOAD SECURITY FOOTAGE */}
          {activeTab === 'upload' ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Upload a real CCTV video clip or still frame to run live on-device fighting, beating, bullying, and weapon detection.
              </p>
              <div>
                <label htmlFor="upload-room-input" className="block text-xs font-medium text-slate-300 mb-1">
                  Zone / Classroom Name
                </label>
                <input
                  id="upload-room-input"
                  type="text"
                  value={uploadRoomName}
                  onChange={(e) => setUploadRoomName(e.target.value)}
                  placeholder="e.g., Vault Corridor or Room 101"
                  className="w-full text-sm px-3 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="upload-media-file" className="block text-xs font-medium text-slate-300 mb-1">
                  Video or Image File
                </label>
                <input
                  id="upload-media-file"
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileChange}
                  className="block w-full text-xs text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-700 file:text-xs file:font-medium file:bg-[#182130] file:text-slate-200 hover:file:bg-slate-700"
                />
              </div>
              <div>
                <label htmlFor="upload-transcript-input" className="block text-xs font-medium text-slate-300 mb-1">
                  Voice / Audio Cue (optional)
                </label>
                <input
                  id="upload-transcript-input"
                  type="text"
                  value={uploadTranscript}
                  onChange={(e) => setUploadTranscript(e.target.value)}
                  placeholder="Optional audio transcript for this recording"
                  className="w-full text-sm px-3 py-2 border border-slate-700 rounded-lg bg-[#0A0E14] text-slate-100"
                />
              </div>
              {uploadError ? (
                <p role="alert" className="text-xs text-red-400 font-medium">
                  {uploadError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleSubmitUpload}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 cursor-pointer"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                <span>Add Footage Feed</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
