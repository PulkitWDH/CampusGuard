import { useEffect, useState } from 'react';
import {
  Bluetooth,
  BluetoothSearching,
  CheckCircle2,
  ExternalLink,
  Mic,
  Plus,
  Search,
  Video,
  XCircle,
} from 'lucide-react';
import type { BluetoothDeviceCandidate, ClassroomCamera } from '../types';
import {
  getBluetoothEnvironmentStatus,
  scanRealBluetoothDevice,
  searchNearbyBluetoothDevices,
} from '../utils/bluetoothDiscovery';
import { openRawMediaStream } from '../utils/mediaCapture';
import { classifyBluetoothCamera } from '../utils/monitoringLogic';

interface BluetoothDirectoryViewProps {
  connectedCameras: ClassroomCamera[];
  discoveredDevices: BluetoothDeviceCandidate[];
  onDeviceDiscovered: (device: BluetoothDeviceCandidate) => void;
  onAddBluetoothCamera: (
    device: BluetoothDeviceCandidate,
    classroomName: string,
    options: { streamUrl?: string; videoDeviceId?: string; audioDeviceId?: string; stream?: MediaStream }
  ) => void;
  onOpenModal: () => void;
}

export function BluetoothDirectoryView({
  connectedCameras,
  discoveredDevices,
  onDeviceDiscovered,
  onAddBluetoothCamera,
  onOpenModal,
}: BluetoothDirectoryViewProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [filterOnlyEligible, setFilterOnlyEligible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roomDrafts, setRoomDrafts] = useState<Record<string, string>>({});
  const [streamDrafts, setStreamDrafts] = useState<Record<string, string>>({});
  const [overrideEligibleIds, setOverrideEligibleIds] = useState<Record<string, boolean>>({});
  const [scanNotices, setScanNotices] = useState<string[]>([]);
  const [blockedByIframe, setBlockedByIframe] = useState(false);

  useEffect(() => {
    void getBluetoothEnvironmentStatus().then((status) => {
      if (status.isIframe || status.blockedByPermissionsPolicy) {
        setBlockedByIframe(true);
      }
    });
  }, []);

  const connectedMacs = new Set(connectedCameras.map((c) => c.bluetoothAddress));

  const handleSearchNearby = async (requestMediaLabels = false) => {
    setScanNotices([]);
    setIsScanning(true);
    try {
      const result = await searchNearbyBluetoothDevices(
        (dev) => {
          onDeviceDiscovered(dev);
        },
        {
          requestMediaLabels,
          openPickerIfLEScanUnavailable: !requestMediaLabels,
        }
      );
      setScanNotices(result.notices);
      setBlockedByIframe(result.blockedByIframePolicy || result.envStatus.isIframe);
    } finally {
      setIsScanning(false);
    }
  };

  const handleHardwarePicker = async () => {
    setScanNotices([]);
    setIsScanning(true);
    try {
      const candidate = await scanRealBluetoothDevice();
      onDeviceDiscovered(candidate);
      setScanNotices([`Paired Bluetooth signal "${candidate.name}".`]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bluetooth scan cancelled.';
      if (/permissions policy|disallowed|iframe|standalone/i.test(msg)) {
        setBlockedByIframe(true);
      }
      setScanNotices([msg]);
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnect = async (device: BluetoothDeviceCandidate) => {
    const roomName = (roomDrafts[device.id] ?? '').trim();
    if (!roomName) {
      setScanNotices([`Please enter a zone or classroom name for ${device.name}.`]);
      return;
    }

    const customUrl = (streamDrafts[device.id] ?? '').trim();
    if (customUrl) {
      onAddBluetoothCamera(device, roomName, {
        streamUrl: customUrl,
        audioDeviceId: device.audioDeviceId,
      });
      return;
    }

    try {
      const stream = await openRawMediaStream({
        includeVideo: true,
        videoDeviceId: device.videoDeviceId,
        audioDeviceId: device.audioDeviceId,
      });
      onAddBluetoothCamera(device, roomName, {
        stream,
        videoDeviceId: device.videoDeviceId,
        audioDeviceId: device.audioDeviceId,
      });
    } catch {
      setScanNotices([
        'Provide a snapshot/MJPEG stream URL or grant camera/microphone permission to attach live video and voice.',
      ]);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const displayedDevices = discoveredDevices.filter((device) => {
    const classification = classifyBluetoothCamera(device);
    const isEligible = classification.isEligibleMonitor || Boolean(overrideEligibleIds[device.id]);
    if (filterOnlyEligible && !isEligible) return false;
    if (!normalizedQuery) return true;
    return (
      device.name.toLowerCase().includes(normalizedQuery) ||
      device.macAddress.toLowerCase().includes(normalizedQuery) ||
      classification.deviceCategoryLabel.toLowerCase().includes(normalizedQuery)
    );
  });

  return (
    <section aria-label="Bluetooth CCTV discovery" className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Nearby Bluetooth CCTV Search
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Searches nearby Bluetooth radios, paired audio/video hardware, and BLE signals to identify CCTV cameras with video and voice recognition.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleSearchNearby(false)}
            disabled={isScanning}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
          >
            <BluetoothSearching className="w-4 h-4" aria-hidden="true" />
            <span>{isScanning ? 'Searching Nearby...' : 'Search Nearby Bluetooth'}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleHardwarePicker()}
            disabled={isScanning}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Bluetooth className="w-4 h-4" aria-hidden="true" />
            <span>Pair Bluetooth Picker</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSearchNearby(true)}
            disabled={isScanning}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
          >
            <span>Scan Paired BT Audio/Cam</span>
          </button>
          <button
            type="button"
            onClick={onOpenModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
          >
            <span>Add Hardware Cam / URL</span>
          </button>
        </div>
      </div>

      {blockedByIframe && typeof window !== 'undefined' ? (
        <div
          role="status"
          className="bg-amber-50 border border-amber-300 text-amber-950 rounded-xl px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div>
            <p className="font-semibold">
              Embedded preview blocks browser Web Bluetooth hardware access
            </p>
            <p className="text-amber-900 mt-0.5">
              Chrome and Edge block Web Bluetooth inside iframe previews, and cloud servers do not have your local Bluetooth radio. Open in a standalone tab to pair nearby Bluetooth CCTV cameras directly.
            </p>
          </div>
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-amber-900 text-white hover:bg-amber-800 whitespace-nowrap shrink-0"
          >
            <span>Open Standalone Tab</span>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      ) : null}

      {scanNotices.length > 0 ? (
        <div
          role="status"
          className="text-xs text-slate-700 bg-white border border-slate-200 rounded-xl px-4 py-3 space-y-1.5"
        >
          {scanNotices.map((note, idx) => (
            <p key={idx}>{note}</p>
          ))}
        </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="relative w-full sm:max-w-xs">
              <Search
                className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search discovered Bluetooth devices"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nearby Bluetooth devices..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600"
              />
            </div>
            <span className="text-xs font-medium text-slate-600 tabular-nums whitespace-nowrap">
              {displayedDevices.length} found
            </span>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setFilterOnlyEligible(false)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                !filterOnlyEligible
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Scanned
            </button>
            <button
              type="button"
              onClick={() => setFilterOnlyEligible(true)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                filterOnlyEligible
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              CCTV Video + Voice Only
            </button>
          </div>
        </div>

        {displayedDevices.length === 0 ? (
          <div className="p-10 text-center">
            <Bluetooth className="w-8 h-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-800">
              {discoveredDevices.length === 0
                ? 'No Bluetooth devices discovered yet'
                : 'No discovered devices match your search'}
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Use &quot;Search Nearby Bluetooth&quot;, &quot;Pair Bluetooth Picker&quot; in a standalone Chrome/Edge tab, or &quot;Scan Paired BT Audio/Cam&quot; for OS-paired hardware.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-2.5 px-4">Bluetooth Device</th>
                  <th className="py-2.5 px-4">Identification</th>
                  <th className="py-2.5 px-4">Capabilities</th>
                  <th className="py-2.5 px-4">Zone &amp; Video Feed</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {displayedDevices.map((device) => {
                  const classification = classifyBluetoothCamera(device);
                  const isEligible =
                    classification.isEligibleMonitor || Boolean(overrideEligibleIds[device.id]);
                  const isConnected = connectedMacs.has(device.macAddress);

                  return (
                    <tr key={device.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{device.name}</div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          {device.macAddress}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {isEligible ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                            <span>
                              {classification.isEligibleMonitor ? 'CCTV Camera Ready' : 'Manual CCTV Override'}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
                            <XCircle className="w-4 h-4 text-slate-400" aria-hidden="true" />
                            <span>{classification.deviceCategoryLabel}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        <div className="flex items-center gap-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Video className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{classification.supportsVideo ? 'Video' : 'No Video'}</span>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{classification.supportsVoice ? 'Voice' : 'No Voice'}</span>
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {isEligible && !isConnected ? (
                          <div className="flex flex-col gap-1.5">
                            <input
                              type="text"
                              aria-label={`Assign zone name for ${device.name}`}
                              value={roomDrafts[device.id] ?? ''}
                              onChange={(e) =>
                                setRoomDrafts((prev) => ({ ...prev, [device.id]: e.target.value }))
                              }
                              placeholder="Zone / Classroom name"
                              className="w-48 text-xs px-2.5 py-1.5 border border-slate-300 rounded-md text-slate-800"
                            />
                            <input
                              type="url"
                              aria-label={`Snapshot or MJPEG stream URL for ${device.name}`}
                              value={streamDrafts[device.id] ?? ''}
                              onChange={(e) =>
                                setStreamDrafts((prev) => ({ ...prev, [device.id]: e.target.value }))
                              }
                              placeholder="Optional snapshot/MJPEG URL"
                              className="w-48 text-xs px-2.5 py-1 border border-slate-300 rounded-md text-slate-800"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">
                            {isConnected ? 'Assigned to active grid' : 'Unverified Bluetooth device'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {isConnected ? (
                          <span className="text-xs font-medium text-emerald-700 whitespace-nowrap">
                            Connected
                          </span>
                        ) : isEligible ? (
                          <button
                            type="button"
                            onClick={() => void handleConnect(device)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Add Zone Feed</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setOverrideEligibleIds((prev) => ({ ...prev, [device.id]: true }))
                            }
                            className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap cursor-pointer"
                          >
                            Treat as CCTV
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
