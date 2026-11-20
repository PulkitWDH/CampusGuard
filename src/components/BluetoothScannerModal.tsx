import { useEffect, useState } from 'react';
import {
  Bluetooth,
  Camera,
  CheckCircle2,
  ExternalLink,
  Globe,
  Mic,
  Plus,
  RefreshCw,
  Upload,
  Video,
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
import { classifyBluetoothCamera } from '../utils/monitoringLogic';

interface BluetoothScannerModalProps {
  isOpen: boolean;
  existingCameras: ClassroomCamera[];
  discoveredBluetooth: BluetoothDeviceCandidate[];
  onDeviceDiscovered: (device: BluetoothDeviceCandidate) => void;
  onClose: () => void;
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

type ModalTab = 'bluetooth' | 'hardware' | 'stream';

export function BluetoothScannerModal({
  isOpen,
  existingCameras,
  discoveredBluetooth,
  onDeviceDiscovered,
  onClose,
  onAddBluetoothCamera,
  onAddHardwareCamera,
  onAddStreamUrlCamera,
  onAddUploadedCamera,
}: BluetoothScannerModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('bluetooth');
  const [isScanningBt, setIsScanningBt] = useState(false);
  const [btNotices, setBtNotices] = useState<string[]>([]);
  const [blockedByIframe, setBlockedByIframe] = useState(false);
  const [btSearch, setBtSearch] = useState('');
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [btStreamUrls, setBtStreamUrls] = useState<Record<string, string>>({});
  const [overrideEligibleIds, setOverrideEligibleIds] = useState<Record<string, boolean>>({});

  // Hardware cameras & mics
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [hardwareRoomName, setHardwareRoomName] = useState('');
  const [hardwareError, setHardwareError] = useState<string | null>(null);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  // Stream URL & Upload
  const [streamRoomName, setStreamRoomName] = useState('');
  const [streamUrlInput, setStreamUrlInput] = useState('');
  const [uploadRoomName, setUploadRoomName] = useState('');
  const [uploadTranscript, setUploadTranscript] = useState('');
  const [uploadFileUrl, setUploadFileUrl] = useState<string | null>(null);
  const [uploadMediaType, setUploadMediaType] = useState<'image' | 'video'>('image');
  const [streamError, setStreamError] = useState<string | null>(null);

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
        'Could not open local video/mic stream. Provide an IP camera snapshot/MJPEG URL for this Bluetooth CCTV or allow camera permissions.',
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

  const handleSubmitStreamUrl = () => {
    setStreamError(null);
    if (!streamRoomName.trim()) {
      setStreamError('Please enter a zone or classroom name.');
      return;
    }
    try {
      const parsed = new URL(streamUrlInput.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Invalid protocol');
      }
    } catch {
      setStreamError('Enter a valid HTTP or HTTPS camera snapshot or MJPEG stream URL.');
      return;
    }
    onAddStreamUrlCamera(streamRoomName.trim(), streamUrlInput.trim());
    setStreamRoomName('');
    setStreamUrlInput('');
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStreamError(null);
    const objectUrl = URL.createObjectURL(file);
    setUploadFileUrl(objectUrl);
    setUploadMediaType(file.type.startsWith('video/') ? 'video' : 'image');
  };

  const handleSubmitUpload = () => {
    setStreamError(null);
    if (!uploadRoomName.trim()) {
      setStreamError('Please enter a zone or classroom name.');
      return;
    }
    if (!uploadFileUrl) {
      setStreamError('Please choose a security image or video file.');
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
      className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-lg">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="scanner-modal-title" className="text-lg font-semibold text-slate-900">
              Connect Security Zone Camera
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Search nearby Bluetooth CCTV hardware, attach physical cameras/mics, or add an IP snapshot / MJPEG stream.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera setup modal"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 pt-3 border-b border-slate-200 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('bluetooth')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'bluetooth'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Web Bluetooth Scan
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('hardware')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'hardware'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Hardware Cameras &amp; Mics
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stream')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'stream'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            IP Snapshot / MJPEG / Upload
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {activeTab === 'bluetooth' ? (
            <>
              {blockedByIframe && typeof window !== 'undefined' ? (
                <div className="bg-amber-50 border border-amber-300 text-amber-950 rounded-lg p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <p className="font-semibold">Browser preview iframe restricts Web Bluetooth</p>
                    <p className="text-amber-900 mt-0.5">
                      Open this app in a standalone Chrome or Edge tab to pair nearby Bluetooth devices directly.
                    </p>
                  </div>
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-900 text-white hover:bg-amber-800 whitespace-nowrap shrink-0"
                  >
                    <span>Open Standalone Tab</span>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSearchNearbyBt(false)}
                  disabled={isScanningBt}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Bluetooth className="w-4 h-4" aria-hidden="true" />
                  <span>{isScanningBt ? 'Searching Nearby...' : 'Search Nearby Bluetooth'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleScanBluetooth()}
                  disabled={isScanningBt}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Pair Bluetooth Picker</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleSearchNearbyBt(true)}
                  disabled={isScanningBt}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
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
                className="w-full text-xs px-3 py-2 border border-slate-300 rounded-lg text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
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
                  <Bluetooth className="w-7 h-7 text-slate-400 mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-800">No Bluetooth devices scanned yet</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Click &quot;Search Nearby Bluetooth&quot;, &quot;Pair Bluetooth Picker&quot; (in standalone tab), or &quot;Scan Paired BT Audio/Cam&quot; for paired Bluetooth microphones and cameras.
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
                      <div key={device.id} className="p-3.5 bg-white space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 truncate">
                                {device.name}
                              </span>
                              {isEligible ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 whitespace-nowrap">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                                  <span>
                                    {classification.isEligibleMonitor ? 'CCTV Video + Voice' : 'CCTV Override'}
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 whitespace-nowrap">
                                  <XCircle className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
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
                            <span className="text-xs font-medium text-emerald-700 shrink-0">Connected</span>
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
                              className="text-xs px-2.5 py-1.5 border border-slate-300 rounded-md text-slate-800"
                            />
                            <input
                              type="url"
                              value={btStreamUrls[device.id] ?? ''}
                              onChange={(e) =>
                                setBtStreamUrls((prev) => ({ ...prev, [device.id]: e.target.value }))
                              }
                              placeholder="Optional snapshot/MJPEG URL"
                              className="text-xs px-2.5 py-1.5 border border-slate-300 rounded-md text-slate-800"
                            />
                            <button
                              type="button"
                              onClick={() => void handleConnectBtCamera(device)}
                              className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
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

          {activeTab === 'hardware' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-slate-600">
                  Select any connected USB, built-in, or Bluetooth-paired camera and microphone for a zone.
                </p>
                <button
                  type="button"
                  onClick={() => void refreshMediaDevices(true)}
                  disabled={isLoadingDevices}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Detect Names</span>
                </button>
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
                  placeholder="e.g., Main Teller Lobby or Room 204"
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="hw-video-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Video Camera Input
                  </label>
                  <select
                    id="hw-video-select"
                    value={selectedVideoId}
                    onChange={(e) => setSelectedVideoId(e.target.value)}
                    className="w-full text-xs px-2.5 py-2 border border-slate-300 rounded-lg bg-white text-slate-800"
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
                  <label htmlFor="hw-audio-select" className="block text-xs font-medium text-slate-700 mb-1">
                    Voice Microphone Input
                  </label>
                  <select
                    id="hw-audio-select"
                    value={selectedAudioId}
                    onChange={(e) => setSelectedAudioId(e.target.value)}
                    className="w-full text-xs px-2.5 py-2 border border-slate-300 rounded-lg bg-white text-slate-800"
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
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
                <span>Connect Camera &amp; Mic</span>
              </button>
            </div>
          ) : null}

          {activeTab === 'stream' ? (
            <div className="space-y-6">
              <div className="space-y-3 pb-5 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  IP / CCTV Snapshot or MJPEG Stream URL
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    aria-label="Zone name for IP stream"
                    value={streamRoomName}
                    onChange={(e) => setStreamRoomName(e.target.value)}
                    placeholder="Zone / Classroom name"
                    className="text-sm px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                  <input
                    type="url"
                    aria-label="Camera snapshot or MJPEG HTTP URL"
                    value={streamUrlInput}
                    onChange={(e) => setStreamUrlInput(e.target.value)}
                    placeholder="https://camera-host/snapshot.jpg"
                    className="text-sm px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSubmitStreamUrl}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
                >
                  <Globe className="w-4 h-4" aria-hidden="true" />
                  <span>Add IP Camera Feed</span>
                </button>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Upload Real Security Video or Image
                </h3>
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
                    className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
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
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-medium file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="upload-transcript-input" className="block text-xs font-medium text-slate-700 mb-1">
                    Voice / Audio Note (optional)
                  </label>
                  <input
                    id="upload-transcript-input"
                    type="text"
                    value={uploadTranscript}
                    onChange={(e) => setUploadTranscript(e.target.value)}
                    placeholder="Optional audio transcript for this recording"
                    className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  />
                </div>
                {streamError ? (
                  <p role="alert" className="text-xs text-red-600 font-medium">
                    {streamError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleSubmitUpload}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                  <Upload className="w-4 h-4" aria-hidden="true" />
                  <span>Add Uploaded Feed</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
