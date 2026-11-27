import { useEffect, useRef, useState } from 'react';
import {
  Bluetooth,
  Cable,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Mic,
  Plus,
  Radio,
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
import {
  WIFI_HOTSPOT_QUICK_PRESETS,
  detectBrowserNetworkInfo,
  deduplicateDiscoveredWifiCameras,
  scanComputerWifiCameras,
  type WifiDiscoveredCamera,
  type WifiHotspotQuickPreset,
  type WifiScanProgress,
} from '../utils/wifiDiscovery';
import {
  buildWiredCameraList,
  probeWiredCameraCapabilities,
  type WiredCameraDevice,
} from '../utils/wiredCameraDiscovery';

export type ScannerModalTab = 'wifi' | 'bluetooth' | 'hardware' | 'microphone' | 'upload';

interface BluetoothScannerModalProps {
  isOpen: boolean;
  initialTab?: ScannerModalTab;
  existingCameras: ClassroomCamera[];
  discoveredBluetooth: BluetoothDeviceCandidate[];
  onDeviceDiscovered: (device: BluetoothDeviceCandidate) => void;
  onClose: () => void;
  onAddWifiCamera: (params: {
    classroomName: string;
    streamUrl?: string;
    wifiBrand: string;
    wifiDirectMode: boolean;
    stream?: MediaStream;
    videoDeviceId?: string;
    audioDeviceId?: string;
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
  onAddMicrophoneZone: (
    classroomName: string,
    stream: MediaStream | null,
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
  onAddMicrophoneZone,
  onAddUploadedCamera,
}: BluetoothScannerModalProps) {
  const [activeTab, setActiveTab] = useState<ScannerModalTab>(initialTab);
  const [isScanningBt, setIsScanningBt] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);
  const [btNotices, setBtNotices] = useState<string[]>([]);
  const [blockedByIframe, setBlockedByIframe] = useState(false);
  const [btSearch, setBtSearch] = useState('');
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [btStreamUrls, setBtStreamUrls] = useState<Record<string, string>>({});
  const [overrideEligibleIds, setOverrideEligibleIds] = useState<Record<string, boolean>>({});

  // Wi-Fi CCTV Camera setup (zero-PIN computer Wi-Fi auto-discovery + optional advanced manual entry)
  const [wifiBrandId, setWifiBrandId] = useState<string>('ip-webcam');
  const [wifiRoomName, setWifiRoomName] = useState('');
  const [wifiHostOrUrl, setWifiHostOrUrl] = useState('');
  const [wifiPort, setWifiPort] = useState('8080');
  const [wifiUsername, setWifiUsername] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiDirectMode, setWifiDirectMode] = useState(true);
  const [wifiTesting, setWifiTesting] = useState(false);
  const [wifiError, setWifiError] = useState<string | null>(null);
  const [wifiTestResult, setWifiTestResult] = useState<{
    resolvedUrl: string;
    latencyMs: number;
    previewDataUrl?: string;
    note: string;
  } | null>(null);
  const [isScanningWifi, setIsScanningWifi] = useState(false);
  const [wifiScanCompleted, setWifiScanCompleted] = useState(false);
  const [wifiScanProgress, setWifiScanProgress] = useState<WifiScanProgress | null>(null);
  const [discoveredWifiCameras, setDiscoveredWifiCameras] = useState<WifiDiscoveredCamera[]>([]);
  const [wifiDetectedSubnet, setWifiDetectedSubnet] = useState<string | null>(null);
  const [connectingWifiId, setConnectingWifiId] = useState<string | null>(null);
  const [showAdvancedWifi, setShowAdvancedWifi] = useState(false);
  const wifiScanAbortRef = useRef<AbortController | null>(null);
  const networkStatus = detectBrowserNetworkInfo();

  // Wired / Hardware cameras & mics (HDMI capture, USB-C / Type-C, SDI/BNC/DVR, USB UVC, built-in)
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [wiredCameras, setWiredCameras] = useState<WiredCameraDevice[]>([]);
  const [isProbingWired, setIsProbingWired] = useState(false);
  const [connectingWiredId, setConnectingWiredId] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [hardwareRoomName, setHardwareRoomName] = useState('');
  const [hardwareError, setHardwareError] = useState<string | null>(null);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  // Microphone-only acoustic monitor
  const [micRoomName, setMicRoomName] = useState('');
  const [micOnlyError, setMicOnlyError] = useState<string | null>(null);
  const [isConnectingMic, setIsConnectingMic] = useState(false);

  // Upload footage
  const [uploadRoomName, setUploadRoomName] = useState('');
  const [uploadTranscript, setUploadTranscript] = useState('');
  const [uploadFileUrl, setUploadFileUrl] = useState<string | null>(null);
  const [uploadMediaType, setUploadMediaType] = useState<'image' | 'video'>('image');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selectedWifiPreset =
    WIFI_CAMERA_BRAND_PRESETS.find((p) => p.id === wifiBrandId) ??
    WIFI_CAMERA_BRAND_PRESETS[0];

  const refreshMediaDevices = async (requestPermission = false, probePorts = false) => {
    setIsLoadingDevices(true);
    setHardwareError(null);
    try {
      const { videoInputs, audioInputs } = await listHardwareMediaDevices(requestPermission);
      setVideoDevices(videoInputs);
      setAudioDevices(audioInputs);
      const classified = buildWiredCameraList(videoInputs, audioInputs);
      setWiredCameras(classified);
      if (classified.length > 0 && (!selectedVideoId || !videoInputs.some((v) => v.deviceId === selectedVideoId))) {
        setSelectedVideoId(classified[0].deviceId);
        if (classified[0].matchedAudioDeviceId) {
          setSelectedAudioId(classified[0].matchedAudioDeviceId);
        }
      }
      if (audioInputs.length > 0 && !selectedAudioId) {
        setSelectedAudioId(audioInputs[0].deviceId);
      }

      if (probePorts && classified.length > 0) {
        setIsProbingWired(true);
        const probed = await Promise.all(
          classified.map(async (cam) => {
            if (!cam.deviceId) return cam;
            const res = await probeWiredCameraCapabilities(cam.deviceId);
            return {
              ...cam,
              maxWidth: res.maxWidth,
              maxHeight: res.maxHeight,
              maxFrameRate: res.maxFrameRate,
              probeStatus: res.ok ? ('verified' as const) : ('busy' as const),
            };
          })
        );
        setWiredCameras(probed);
        setIsProbingWired(false);
      }
    } catch {
      setHardwareError('Unable to enumerate connected wired cameras or microphones.');
      setIsProbingWired(false);
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

      const handleHotPlug = () => {
        void refreshMediaDevices(false);
      };
      navigator.mediaDevices?.addEventListener?.('devicechange', handleHotPlug);
      return () => {
        navigator.mediaDevices?.removeEventListener?.('devicechange', handleHotPlug);
      };
    } else if (wifiScanAbortRef.current) {
      wifiScanAbortRef.current.abort();
      wifiScanAbortRef.current = null;
      setIsScanningWifi(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (wifiScanAbortRef.current) {
        wifiScanAbortRef.current.abort();
        wifiScanAbortRef.current = null;
      }
    };
  }, []);

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

  const handleScanComputerWifi = async (requestWirelessLabels = false) => {
    setWifiError(null);
    if (wifiScanAbortRef.current) {
      wifiScanAbortRef.current.abort();
    }

    if (requestWirelessLabels) {
      await refreshMediaDevices(true);
    }

    const controller = new AbortController();
    wifiScanAbortRef.current = controller;
    setIsScanningWifi(true);
    setWifiScanCompleted(false);
    setDiscoveredWifiCameras([]);
    setWifiDetectedSubnet(null);

    try {
      const result = await scanComputerWifiCameras({
        signal: controller.signal,
        onProgress: (progress) => setWifiScanProgress(progress),
        onFound: (cam) => {
          setDiscoveredWifiCameras((prev) => deduplicateDiscoveredWifiCameras([...prev, cam]));
        },
      });
      if (!controller.signal.aborted) {
        setDiscoveredWifiCameras(result.cameras);
        setWifiDetectedSubnet(result.detectedSubnet);
        setWifiScanCompleted(true);
      }
    } catch {
      if (!controller.signal.aborted) {
        setWifiError('Unable to complete computer Wi-Fi scan.');
      }
    } finally {
      if (wifiScanAbortRef.current === controller) {
        wifiScanAbortRef.current = null;
        setIsScanningWifi(false);
      }
    }
  };

  const handleStopWifiScan = () => {
    if (wifiScanAbortRef.current) {
      wifiScanAbortRef.current.abort();
      wifiScanAbortRef.current = null;
    }
    setIsScanningWifi(false);
    setWifiScanCompleted(true);
  };

  const handleConnectDiscoveredWifiCamera = async (camera: WifiDiscoveredCamera) => {
    setWifiError(null);
    const zoneLabel = wifiRoomName.trim() || camera.name;

    if (camera.kind === 'wireless-media-device') {
      setConnectingWifiId(camera.id);
      try {
        const stream = await openRawMediaStream({
          includeVideo: true,
          videoDeviceId: camera.videoDeviceId,
          audioDeviceId: camera.audioDeviceId,
        });
        onAddWifiCamera({
          classroomName: zoneLabel,
          wifiBrand: camera.brandLabel,
          wifiDirectMode: true,
          stream,
          videoDeviceId: camera.videoDeviceId,
          audioDeviceId: camera.audioDeviceId,
        });
        setWifiRoomName('');
        onClose();
      } catch {
        setWifiError(
          `Could not open "${camera.name}". Allow camera access or verify the wireless camera app is active on your computer's Wi-Fi.`
        );
      } finally {
        setConnectingWifiId(null);
      }
      return;
    }

    onAddWifiCamera({
      classroomName: zoneLabel,
      streamUrl: camera.streamUrl,
      wifiBrand: camera.brandLabel,
      wifiDirectMode: true,
    });
    setWifiRoomName('');
    onClose();
  };

  const handleConnectHotspotPreset = (preset: WifiHotspotQuickPreset) => {
    setWifiError(null);
    const zoneLabel = wifiRoomName.trim() || preset.label;
    onAddWifiCamera({
      classroomName: zoneLabel,
      streamUrl: preset.streamUrl,
      wifiBrand: preset.brandLabel,
      wifiDirectMode: true,
    });
    setWifiRoomName('');
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
    const zoneLabel = hardwareRoomName.trim() || `Camera ${existingCameras.length + 1}`;
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
      const chosenCam = wiredCameras.find((d) => d.deviceId === selectedVideoId);
      onAddHardwareCamera(
        zoneLabel,
        stream,
        selectedVideoId || undefined,
        selectedAudioId || undefined,
        chosenCam ? `${chosenCam.interfaceBadge} · ${chosenCam.label}` : 'Built-in / Wired Camera'
      );
      setHardwareRoomName('');
      onClose();
    } catch {
      setHardwareError('Camera permission was denied, or the selected camera port is currently in use by another app.');
    }
  };

  const handleStartBuiltInCamera = async (preferredFacing?: 'environment' | 'user') => {
    setHardwareError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setHardwareError('Browser camera capture is unavailable here.');
      return;
    }
    const builtInCam = !preferredFacing
      ? wiredCameras.find((c) => c.interfaceType === 'built-in')
      : undefined;
    const targetVideoId = builtInCam?.deviceId || undefined;
    const targetAudioId = builtInCam?.matchedAudioDeviceId || selectedAudioId || undefined;
    const defaultLabel =
      preferredFacing === 'environment'
        ? 'Rear Phone Camera'
        : preferredFacing === 'user'
          ? 'Front Phone Camera'
          : 'Built-in Camera';
    const zoneLabel = hardwareRoomName.trim() || defaultLabel;
    const busyKey = preferredFacing ? `__builtin_${preferredFacing}__` : '__builtin__';
    setConnectingWiredId(busyKey);
    try {
      const stream = await openRawMediaStream({
        includeVideo: true,
        videoDeviceId: targetVideoId,
        audioDeviceId: targetAudioId,
        facingMode: preferredFacing,
      });
      const liveTrack = stream.getVideoTracks()[0];
      const liveDeviceId = liveTrack?.getSettings?.().deviceId || targetVideoId;
      onAddHardwareCamera(
        zoneLabel,
        stream,
        liveDeviceId,
        targetAudioId,
        builtInCam ? `Built-in · ${builtInCam.label}` : defaultLabel
      );
      setHardwareRoomName('');
      onClose();
    } catch {
      setHardwareError(
        'Could not access the built-in camera. Allow browser camera permission and ensure no other app is locking the lens.'
      );
    } finally {
      setConnectingWiredId(null);
    }
  };

  const handleQuickConnectWired = async (cam: WiredCameraDevice) => {
    setHardwareError(null);
    const zoneName =
      hardwareRoomName.trim() ||
      `${cam.interfaceBadge} ${existingCameras.length + 1}`;
    setConnectingWiredId(cam.deviceId || cam.label);
    try {
      const audioId = cam.matchedAudioDeviceId || selectedAudioId || undefined;
      const stream = await openRawMediaStream({
        includeVideo: true,
        videoDeviceId: cam.deviceId || undefined,
        audioDeviceId: audioId,
      });
      onAddHardwareCamera(
        zoneName,
        stream,
        cam.deviceId || undefined,
        audioId,
        `${cam.interfaceBadge} · ${cam.label}`
      );
      setHardwareRoomName('');
      onClose();
    } catch {
      setHardwareError(
        `Could not open "${cam.label}". Allow camera permission or close other apps using this wired port.`
      );
    } finally {
      setConnectingWiredId(null);
    }
  };

  const handleConnectMicrophoneOnly = async (withLiveStream: boolean) => {
    setMicOnlyError(null);
    if (!micRoomName.trim()) {
      setMicOnlyError('Please enter a zone or classroom name.');
      return;
    }

    const chosenMic = audioDevices.find((d) => d.deviceId === selectedAudioId);
    const label = chosenMic?.label || 'Acoustic Microphone';

    if (!withLiveStream) {
      onAddMicrophoneZone(
        micRoomName.trim(),
        null,
        selectedAudioId || undefined,
        label
      );
      setMicRoomName('');
      onClose();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicOnlyError(
        'Live browser microphone capture is unavailable here. Use "Add Standby Mic Zone" to test acoustic & speech cues.'
      );
      return;
    }

    setIsConnectingMic(true);
    try {
      const stream = await openRawMediaStream({
        includeVideo: false,
        audioDeviceId: selectedAudioId || undefined,
      });
      onAddMicrophoneZone(
        micRoomName.trim(),
        stream,
        selectedAudioId || undefined,
        label
      );
      setMicRoomName('');
      onClose();
    } catch {
      setMicOnlyError(
        'Microphone permission was denied or the device is unavailable. Allow mic access or use "Add Standby Mic Zone".'
      );
    } finally {
      setIsConnectingMic(false);
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
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl w-full max-w-2xl max-h-[92vh] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl pb-[env(safe-area-inset-bottom)]">
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <span className="w-10 h-1 rounded-full bg-slate-300" aria-hidden="true" />
        </div>
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="scanner-modal-title" className="text-base font-semibold text-slate-900">
              Add Security Camera Feed
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Start your phone/laptop built-in camera, or connect Wi-Fi, wired HDMI/USB-C, Bluetooth, or mic feeds.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera setup modal"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-3 sm:px-4 pt-1 border-b border-slate-200 flex items-center gap-0.5 overflow-x-auto bg-slate-50">
          {(
            [
              { id: 'hardware', label: 'Built-in / Wired', icon: Camera },
              { id: 'wifi', label: 'Wi-Fi CCTV', icon: Wifi },
              { id: 'bluetooth', label: 'Bluetooth', icon: Bluetooth },
              { id: 'microphone', label: 'Mic Only', icon: Mic },
              { id: 'upload', label: 'Upload Clip', icon: Upload },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-testid={`scanner-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-slate-900 text-slate-950 font-semibold'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* TAB 1: WI-FI CCTV CAMERA (ZERO-PIN COMPUTER WI-FI AUTO-DISCOVERY) */}
          {activeTab === 'wifi' ? (
            <div className="space-y-4">
              {/* Computer Wi-Fi Status & Zero-PIN Explanation */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        networkStatus.online ? 'bg-emerald-400' : 'bg-amber-400'
                      }`}
                      aria-hidden="true"
                    />
                    <span>
                      {networkStatus.online
                        ? 'Computer Wi-Fi Ready · No PIN or Password Required'
                        : 'Computer Offline · Connect Wi-Fi in OS Menu'}
                    </span>
                  </div>
                  {wifiDetectedSubnet ? (
                    <span className="text-[11px] font-mono text-slate-500">
                      LAN {wifiDetectedSubnet}.*
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Connect your computer&apos;s Wi-Fi to your CCTV camera&apos;s Wi-Fi network (or the same Wi-Fi router), then click{' '}
                  <strong className="text-slate-800">Scan Computer Wi-Fi</strong>. Discovered cameras connect in one click without entering a PIN code, IP address, or password.
                </p>
              </div>

              {/* Optional Zone Name + One-Click Scan Actions */}
              <div className="space-y-3">
                <div>
                  <label htmlFor="wifi-room-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Zone / Room Name <span className="text-slate-500 font-normal">(optional — auto-named if blank)</span>
                  </label>
                  <input
                    id="wifi-room-input"
                    type="text"
                    value={wifiRoomName}
                    onChange={(e) => setWifiRoomName(e.target.value)}
                    placeholder="e.g., Main Corridor Wi-Fi Cam"
                    className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900 focus-visible:outline-2 focus-visible:outline-zinc-400"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isScanningWifi ? (
                    <button
                      type="button"
                      onClick={handleStopWifiScan}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Stop Scan</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleScanComputerWifi(false)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
                    >
                      <Wifi className="w-4 h-4" aria-hidden="true" />
                      <span>Scan Computer Wi-Fi</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleScanComputerWifi(true)}
                    disabled={isScanningWifi}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 disabled:opacity-60 cursor-pointer"
                  >
                    <Radio className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Detect Wireless Phone / Cam Bridges</span>
                  </button>
                </div>

                {/* Live Scan Progress */}
                {isScanningWifi && wifiScanProgress ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-800 flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-700" aria-hidden="true" />
                        <span>{wifiScanProgress.label}</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {wifiScanProgress.checked}/{wifiScanProgress.total}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-200"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (wifiScanProgress.checked / Math.max(1, wifiScanProgress.total)) * 100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Discovered Wi-Fi Cameras (Zero-PIN 1-Click Connect) */}
              {discoveredWifiCameras.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-slate-800">
                      Found on Computer Wi-Fi ({discoveredWifiCameras.length})
                    </h3>
                    <span className="text-[11px] text-emerald-600">Zero-PIN Direct Connect</span>
                  </div>
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                    {discoveredWifiCameras.map((cam) => (
                      <div
                        key={cam.id}
                        className="p-3 bg-slate-50 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {cam.previewUrl ? (
                            <img
                              src={cam.previewUrl}
                              alt={`Live preview from ${cam.name}`}
                              className="w-16 h-10 object-cover rounded border border-slate-300 shrink-0 bg-black"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                              <Wifi className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {cam.name}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                              {cam.hostLabel}
                              {cam.latencyMs ? ` · ${cam.latencyMs}ms` : ''} · No PIN
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleConnectDiscoveredWifiCamera(cam)}
                          disabled={connectingWifiId === cam.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 shrink-0 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{connectingWifiId === cam.id ? 'Connecting...' : 'Connect'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : wifiScanCompleted ? (
                <div className="border border-slate-200 bg-slate-50 rounded-lg p-3.5 space-y-2">
                  <p className="text-xs font-medium text-slate-800">
                    No open Wi-Fi CCTV cameras answered automatically on this network.
                  </p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Make sure your computer&apos;s Wi-Fi is connected to your camera&apos;s Wi-Fi network (or use{' '}
                    <strong className="text-slate-700">Direct Camera Wi-Fi Quick Connect</strong> below with zero IP/PIN typing).
                    {networkStatus.isHttpsMixedContentRisk
                      ? ' On HTTPS pages, browsers may block automatic scanning of local http://192.168.x.x cameras — wireless camera bridges (Phone Link, Continuity Camera, DroidCam, Iriun) connect directly without restrictions.'
                      : ''}
                  </p>
                </div>
              ) : null}

              {/* 1-Click Direct Camera Wi-Fi Hotspot Presets (Zero IP / Zero PIN) */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-700">
                  Direct Camera Wi-Fi Quick Connect <span className="text-slate-500 font-normal">(1 click · no PIN or IP typing)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {WIFI_HOTSPOT_QUICK_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleConnectHotspotPreset(preset)}
                      className="text-left p-2.5 rounded-lg border border-slate-200 bg-slate-100 hover:bg-slate-100 hover:border-slate-400 transition-colors cursor-pointer"
                    >
                      <div className="text-xs font-semibold text-slate-900">{preset.label}</div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {preset.subtitle}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {wifiError ? (
                <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  {wifiError}
                </p>
              ) : null}

              {/* Collapsible Advanced Manual IP / Credentials (hidden by default so user never sees PIN/password forms) */}
              <div className="border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvancedWifi((prev) => !prev)}
                  aria-expanded={showAdvancedWifi}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  {showAdvancedWifi ? (
                    <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>Manual IP / Camera Login (Optional Advanced)</span>
                </button>

                {showAdvancedWifi ? (
                  <div className="mt-3 space-y-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="wifi-brand-select" className="block text-xs font-medium text-slate-700 mb-1">
                          Wi-Fi Camera Brand / Type
                        </label>
                        <select
                          id="wifi-brand-select"
                          value={wifiBrandId}
                          onChange={(e) => handleSelectWifiBrand(e.target.value)}
                          className="w-full text-xs px-2.5 py-2.5 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
                        >
                          {WIFI_CAMERA_BRAND_PRESETS.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="wifi-port-input" className="block text-xs font-medium text-slate-700 mb-1">
                          Port (optional)
                        </label>
                        <input
                          id="wifi-port-input"
                          type="text"
                          value={wifiPort}
                          onChange={(e) => setWifiPort(e.target.value)}
                          placeholder={selectedWifiPreset.defaultPort || '80'}
                          className="w-full text-sm font-mono px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="wifi-host-input" className="block text-xs font-medium text-slate-700 mb-1">
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
                        className="w-full text-sm font-mono px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900 focus-visible:outline-2 focus-visible:outline-zinc-400"
                      />
                    </div>

                    <p className="text-xs text-slate-500">{selectedWifiPreset.notes}</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="wifi-user-input" className="block text-xs font-medium text-slate-500 mb-1">
                          Camera Username (optional)
                        </label>
                        <input
                          id="wifi-user-input"
                          type="text"
                          value={wifiUsername}
                          onChange={(e) => setWifiUsername(e.target.value)}
                          placeholder="admin"
                          className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
                        />
                      </div>
                      <div>
                        <label htmlFor="wifi-pass-input" className="block text-xs font-medium text-slate-500 mb-1">
                          Camera Password (optional)
                        </label>
                        <input
                          id="wifi-pass-input"
                          type="password"
                          value={wifiPassword}
                          onChange={(e) => setWifiPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
                        />
                      </div>
                    </div>

                    <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={wifiDirectMode}
                        onChange={(e) => {
                          setWifiDirectMode(e.target.checked);
                          setWifiTestResult(null);
                        }}
                        className="mt-0.5 accent-zinc-200 rounded cursor-pointer"
                      />
                      <span>
                        <strong className="text-slate-900">Direct Computer Wi-Fi Mode</strong> — Load camera directly over your computer&apos;s Wi-Fi LAN without cloud routing.
                      </span>
                    </label>

                    {wifiTestResult ? (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-3">
                        {wifiTestResult.previewDataUrl ? (
                          <img
                            src={wifiTestResult.previewDataUrl}
                            alt="Verified Wi-Fi CCTV frame"
                            className="w-24 h-14 object-cover rounded border border-emerald-200 shrink-0"
                          />
                        ) : null}
                        <div className="min-w-0 text-xs">
                          <div className="font-semibold text-emerald-700 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>Wi-Fi Camera Connected ({wifiTestResult.latencyMs}ms)</span>
                          </div>
                          <div className="text-slate-700 font-mono truncate mt-0.5">
                            {wifiTestResult.resolvedUrl}
                          </div>
                          <div className="text-slate-500 mt-0.5">{wifiTestResult.note}</div>
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleTestWifiCamera()}
                        disabled={wifiTesting}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 disabled:opacity-60 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${wifiTesting ? 'animate-spin' : ''}`} aria-hidden="true" />
                        <span>{wifiTesting ? 'Testing Connection...' : 'Test Wi-Fi Feed'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitWifiCamera}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
                      >
                        <Wifi className="w-4 h-4" aria-hidden="true" />
                        <span>Add Manual Wi-Fi Camera</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* TAB 2: BLUETOOTH CCTV */}
          {activeTab === 'bluetooth' ? (
            <>
              {blockedByIframe && typeof window !== 'undefined' ? (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <p className="font-semibold">Embedded preview restricts Web Bluetooth</p>
                    <p className="text-amber-800 mt-0.5">
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
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-100 border border-slate-300 text-slate-900 hover:bg-slate-200 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Pair Bluetooth Picker</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleSearchNearbyBt(true)}
                  disabled={isScanningBt}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
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
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-500"
              />

              {btNotices.length > 0 ? (
                <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                  {btNotices.map((n, idx) => (
                    <p key={idx}>{n}</p>
                  ))}
                </div>
              ) : null}

              {filteredBluetooth.length === 0 ? (
                <div className="border border-dashed border-slate-300 rounded-xl p-6 text-center">
                  <Bluetooth className="w-7 h-7 text-slate-500 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-800">No Bluetooth devices scanned yet</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Click Search Nearby Bluetooth or Pair Bluetooth Picker in Chrome/Edge.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                  {filteredBluetooth.map((device) => {
                    const classification = classifyBluetoothCamera(device);
                    const isEligible =
                      classification.isEligibleMonitor || Boolean(overrideEligibleIds[device.id]);
                    const alreadyAdded = connectedAddresses.has(device.macAddress);

                    return (
                      <div key={device.id} className="p-3.5 bg-slate-50 space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 truncate">
                                {device.name}
                              </span>
                              {isEligible ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 whitespace-nowrap">
                                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>
                                    {classification.isEligibleMonitor ? 'CCTV Video + Voice' : 'CCTV Override'}
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 whitespace-nowrap">
                                  <XCircle className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                                  <span>{classification.deviceCategoryLabel}</span>
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
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
                            <span className="text-xs font-medium text-emerald-600 shrink-0">Connected</span>
                          ) : !isEligible ? (
                            <button
                              type="button"
                              onClick={() =>
                                setOverrideEligibleIds((prev) => ({ ...prev, [device.id]: true }))
                              }
                              className="text-xs font-medium text-blue-600 hover:underline shrink-0 cursor-pointer"
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
                              className="text-xs px-2.5 py-1.5 border border-slate-300 rounded-md bg-slate-50 text-slate-900"
                            />
                            <input
                              type="url"
                              value={btStreamUrls[device.id] ?? ''}
                              onChange={(e) =>
                                setBtStreamUrls((prev) => ({ ...prev, [device.id]: e.target.value }))
                              }
                              placeholder="Optional snapshot/MJPEG URL"
                              className="text-xs px-2.5 py-1.5 border border-slate-300 rounded-md bg-slate-50 text-slate-900"
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

          {/* TAB 1: BUILT-IN PHONE/LAPTOP CAMERA & WIRED PORTS (HDMI, USB-C, SDI/BNC, USB) */}
          {activeTab === 'hardware' ? (
            <div className="space-y-4">
              {/* Instant Built-in Camera Launchers (works immediately on Mobile & Desktop without pre-scan) */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900">
                      Built-in Device Camera (Phone &amp; Laptop)
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Launch your phone rear/front lens or laptop webcam in 1 tap — no cable or scan required.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    data-testid="modal-start-rear-camera"
                    onClick={() => void handleStartBuiltInCamera('environment')}
                    disabled={connectingWiredId === '__builtin_environment__'}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                  >
                    <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {connectingWiredId === '__builtin_environment__'
                        ? 'Opening...'
                        : 'Rear / Main Camera'}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid="modal-start-front-camera"
                    onClick={() => void handleStartBuiltInCamera('user')}
                    disabled={connectingWiredId === '__builtin_user__'}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
                  >
                    <Video className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {connectingWiredId === '__builtin_user__' ? 'Opening...' : 'Front Camera'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshMediaDevices(true, true)}
                    disabled={isLoadingDevices || isProbingWired}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] text-xs font-semibold rounded-lg border border-blue-500/40 bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 shrink-0 ${isLoadingDevices || isProbingWired ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>
                      {isProbingWired
                        ? 'Probing Ports...'
                        : isLoadingDevices
                          ? 'Scanning...'
                          : 'Scan Wired Ports'}
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="hw-room-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Zone / Classroom Name
                </label>
                <input
                  id="hw-room-input"
                  type="text"
                  value={hardwareRoomName}
                  onChange={(e) => setHardwareRoomName(e.target.value)}
                  placeholder="e.g., Main Entrance HDMI Cam or Room 204"
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-500"
                />
              </div>

              {/* Detected Wired Ports List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Detected Wired Video Interfaces ({wiredCameras.length})
                  </span>
                  <span className="text-[10px] text-slate-500">
                    HDMI · USB-C · SDI/BNC · USB · Built-in
                  </span>
                </div>

                {wiredCameras.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-500 space-y-1.5">
                    <p className="text-slate-800 font-medium">No wired camera port detected yet.</p>
                    <p>
                      Plug in your USB-C / Type-C camera, USB webcam, or HDMI-to-USB capture card, then click <strong className="text-slate-800">Scan All Wired Ports</strong>.
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Note: Standard laptop HDMI ports are video-out only — wired HDMI/CCTV cameras require an HDMI-to-USB or USB-C UVC capture adapter.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {wiredCameras.map((cam, idx) => {
                      const isConnectingThis = connectingWiredId === (cam.deviceId || cam.label);
                      const isExternal = cam.interfaceType !== 'built-in';
                      const resLabel =
                        cam.maxWidth && cam.maxHeight
                          ? `${cam.maxWidth}×${cam.maxHeight}${cam.maxFrameRate ? ` · ${cam.maxFrameRate}fps` : ''}`
                          : null;
                      return (
                        <div
                          key={cam.deviceId || `${cam.label}-${idx}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                                  cam.interfaceType === 'hdmi'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : cam.interfaceType === 'usb-c'
                                      ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                      : cam.interfaceType === 'sdi-bnc'
                                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                        : isExternal
                                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                          : 'bg-slate-100 text-slate-700 border border-slate-300'
                                }`}
                              >
                                {cam.interfaceBadge}
                              </span>
                              {resLabel ? (
                                <span className="text-[10px] font-mono text-emerald-600">
                                  {resLabel}
                                </span>
                              ) : null}
                              {cam.probeStatus === 'busy' ? (
                                <span className="text-[10px] text-amber-700">Port busy</span>
                              ) : null}
                            </div>
                            <p className="text-xs font-medium text-slate-900 truncate mt-1">
                              {cam.label}
                            </p>
                            {cam.matchedAudioLabel ? (
                              <p className="text-[10px] text-slate-500 truncate">
                                Paired audio: {cam.matchedAudioLabel}
                              </p>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            disabled={isConnectingThis}
                            onClick={() => void handleQuickConnectWired(cam)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-500 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                          >
                            <Cable className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{isConnectingThis ? 'Opening...' : 'Connect'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200">
                <div>
                  <label htmlFor="hw-video-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Manual Video Port Override
                  </label>
                  <select
                    id="hw-video-select"
                    value={selectedVideoId}
                    onChange={(e) => setSelectedVideoId(e.target.value)}
                    className="w-full text-xs px-2.5 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
                  >
                    {wiredCameras.length === 0 ? (
                      <option value="">Default system camera</option>
                    ) : (
                      wiredCameras.map((d, idx) => (
                        <option key={d.deviceId || idx} value={d.deviceId}>
                          [{d.interfaceBadge}] {d.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label htmlFor="hw-audio-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Voice Microphone Input
                  </label>
                  <select
                    id="hw-audio-select"
                    value={selectedAudioId}
                    onChange={(e) => setSelectedAudioId(e.target.value)}
                    className="w-full text-xs px-2.5 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
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
                <p role="alert" className="text-xs text-red-600 font-medium">
                  {hardwareError}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void handleConnectHardware()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors cursor-pointer"
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>Connect Selected Port &amp; Mic</span>
              </button>
            </div>
          ) : null}

          {/* TAB 4: MICROPHONE ONLY (AUDIO-ONLY ACOUSTIC MONITOR) */}
          {activeTab === 'microphone' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  Monitor any room purely by microphone (no camera required). Tracks live dB SPL (&gt;90.1 dB for 3s alerts teacher) and real-time voice recognition for distress, bullying, beating, or fighting cues.
                </p>
                <button
                  type="button"
                  onClick={() => void refreshMediaDevices(true)}
                  disabled={isLoadingDevices}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Detect Mics</span>
                </button>
              </div>

              <div>
                <label htmlFor="mic-room-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Zone / Classroom Name
                </label>
                <input
                  id="mic-room-input"
                  type="text"
                  value={micRoomName}
                  onChange={(e) => setMicRoomName(e.target.value)}
                  placeholder="e.g., Hallway West Mic or Restroom Corridor"
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900 focus-visible:outline-2 focus-visible:outline-zinc-400"
                />
              </div>

              <div>
                <label htmlFor="mic-audio-select" className="block text-xs font-medium text-slate-700 mb-1">
                  Microphone Input (Built-in, USB, or Bluetooth Mic)
                </label>
                <select
                  id="mic-audio-select"
                  value={selectedAudioId}
                  onChange={(e) => setSelectedAudioId(e.target.value)}
                  className="w-full text-xs px-2.5 py-2.5 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
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

              {micOnlyError ? (
                <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  {micOnlyError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleConnectMicrophoneOnly(true)}
                  disabled={isConnectingMic}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  <Mic className="w-4 h-4" aria-hidden="true" />
                  <span>{isConnectingMic ? 'Connecting Mic...' : 'Connect Live Microphone'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleConnectMicrophoneOnly(false)}
                  disabled={isConnectingMic}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <span>Add Standby Mic Zone</span>
                </button>
              </div>
            </div>
          ) : null}

          {/* TAB 5: UPLOAD SECURITY FOOTAGE */}
          {activeTab === 'upload' ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Upload a real CCTV video clip or still frame to run live on-device fighting, beating, bullying, and weapon detection.
              </p>
              <div>
                <label htmlFor="upload-room-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Zone / Classroom Name
                </label>
                <input
                  id="upload-room-input"
                  type="text"
                  value={uploadRoomName}
                  onChange={(e) => setUploadRoomName(e.target.value)}
                  placeholder="e.g., Vault Corridor or Room 101"
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="upload-media-file" className="block text-xs font-medium text-slate-700 mb-1">
                  Video or Image File
                </label>
                <input
                  id="upload-media-file"
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleFileChange}
                  className="block w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-800 hover:file:bg-slate-200"
                />
              </div>
              <div>
                <label htmlFor="upload-transcript-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Voice / Audio Cue (optional)
                </label>
                <input
                  id="upload-transcript-input"
                  type="text"
                  value={uploadTranscript}
                  onChange={(e) => setUploadTranscript(e.target.value)}
                  placeholder="Optional audio transcript for this recording"
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
                />
              </div>
              {uploadError ? (
                <p role="alert" className="text-xs text-red-600 font-medium">
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
