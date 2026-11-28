import { useEffect, useState } from 'react';
import {
  Bluetooth,
  Cable,
  CheckCircle2,
  MonitorSpeaker,
  Plus,
  RefreshCw,
  Speaker,
  Trash2,
  Volume2,
  Wifi,
} from 'lucide-react';
import {
  type ConnectedPaSpeaker,
  type DetectedBrowserSpeaker,
  type PaSpeakerConnectionType,
  formatSpeakerTypeLabel,
  pairBluetoothSpeakerDevice,
  pickBrowserSpeakerViaSystemDialog,
  playPaSirenTone,
  scanBrowserAudioOutputSpeakers,
} from '../utils/paSpeakerEngine';

interface PaSpeakerConnectionPanelProps {
  connectedSpeakers: ConnectedPaSpeaker[];
  activeSpeakerId: string | null;
  paVolume: number;
  compact?: boolean;
  onConnectSpeaker: (speaker: ConnectedPaSpeaker) => void;
  onDisconnectSpeaker: (speakerId: string) => void;
  onSelectActiveSpeaker: (speakerId: string) => void;
}

type SpeakerConnectTab = 'system' | 'bluetooth' | 'wired' | 'network';

export function PaSpeakerConnectionPanel({
  connectedSpeakers,
  activeSpeakerId,
  paVolume,
  compact = false,
  onConnectSpeaker,
  onDisconnectSpeaker,
  onSelectActiveSpeaker,
}: PaSpeakerConnectionPanelProps) {
  const [connectTab, setConnectTab] = useState<SpeakerConnectTab>('system');
  const [showAddForm, setShowAddForm] = useState<boolean>(connectedSpeakers.length === 0);
  const [detectedOutputs, setDetectedOutputs] = useState<DetectedBrowserSpeaker[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [wiredName, setWiredName] = useState<string>('Venue PA Amplifier (3.5mm AUX / Line-Out)');
  const [wiredType, setWiredType] = useState<PaSpeakerConnectionType>('wired-aux');
  const [bluetoothFallbackName, setBluetoothFallbackName] = useState<string>(
    'Bluetooth PA Speaker (OS Paired)'
  );
  const [ipSpeakerName, setIpSpeakerName] = useState<string>('Main Hall IP PA Horn');
  const [ipSpeakerUrl, setIpSpeakerUrl] = useState<string>('http://192.168.1.50/pa');

  const activeSpeaker =
    (activeSpeakerId ? connectedSpeakers.find((s) => s.id === activeSpeakerId) : null) ??
    connectedSpeakers[0] ??
    null;
  const hasConnectedSpeaker = Boolean(activeSpeaker);

  useEffect(() => {
    if (connectedSpeakers.length === 0) {
      setShowAddForm(true);
    }
  }, [connectedSpeakers.length]);

  const handleScanSystemOutputs = async () => {
    setIsScanning(true);
    setFeedback(null);
    const list = await scanBrowserAudioOutputSpeakers();
    setDetectedOutputs(list);
    setIsScanning(false);
    if (list.length === 0) {
      setFeedback(
        'No named audio outputs returned yet. Click "Connect Default System / AUX Speaker" or use Wired / Bluetooth below.'
      );
    }
  };

  useEffect(() => {
    void handleScanSystemOutputs();
  }, []);

  const connectAndChime = (speaker: ConnectedPaSpeaker) => {
    onConnectSpeaker(speaker);
    setFeedback(`Connected: ${speaker.name} (${formatSpeakerTypeLabel(speaker.connectionType)})`);
    setShowAddForm(false);
    void playPaSirenTone('attention-chime', {
      volume: Math.min(0.6, paVolume),
      sinkId: speaker.sinkId,
    });
  };

  const handleSystemPicker = async () => {
    setFeedback(null);
    const picked = await pickBrowserSpeakerViaSystemDialog();
    if (picked) {
      connectAndChime({
        id: `sys-${picked.deviceId}`,
        name: picked.label,
        connectionType: picked.connectionType,
        sinkId: picked.deviceId,
        connectedAt: new Date().toISOString(),
        verified: true,
      });
      return;
    }
    // Fallback when browser does not implement selectAudioOutput()
    await handleScanSystemOutputs();
    const first = detectedOutputs[0];
    connectAndChime({
      id: `sys-${first?.deviceId || 'default'}`,
      name: first?.label || 'System Default Speaker (Built-in / AUX / USB)',
      connectionType: first?.connectionType || 'builtin',
      sinkId: first?.deviceId || 'default',
      connectedAt: new Date().toISOString(),
      verified: true,
    });
  };

  const handlePairBluetooth = async () => {
    setFeedback(null);
    const result = await pairBluetoothSpeakerDevice();
    if (result.ok) {
      connectAndChime(result.speaker);
    } else {
      setFeedback(result.error);
    }
  };

  const handleConnectManualWired = () => {
    const cleanName = wiredName.trim() || 'Wired AUX / PA Speaker';
    connectAndChime({
      id: `wired-${Date.now()}`,
      name: cleanName,
      connectionType: wiredType,
      sinkId: 'default',
      connectedAt: new Date().toISOString(),
      verified: true,
    });
  };

  const handleConnectManualBluetooth = () => {
    const cleanName = bluetoothFallbackName.trim() || 'Bluetooth PA Speaker';
    connectAndChime({
      id: `bt-os-${Date.now()}`,
      name: cleanName,
      connectionType: 'bluetooth',
      sinkId: 'default',
      connectedAt: new Date().toISOString(),
      verified: true,
    });
  };

  const handleConnectIpSpeaker = () => {
    const cleanName = ipSpeakerName.trim() || 'Network IP PA Speaker';
    const cleanUrl = ipSpeakerUrl.trim();
    if (!cleanUrl) {
      setFeedback('Enter the IP / LAN endpoint URL of your network PA speaker.');
      return;
    }
    connectAndChime({
      id: `ip-${Date.now()}`,
      name: cleanName,
      connectionType: 'network-ip',
      endpointUrl: cleanUrl,
      connectedAt: new Date().toISOString(),
      verified: true,
    });
  };

  return (
    <div
      data-testid="pa-speaker-connection-panel"
      className={`rounded-xl border ${
        hasConnectedSpeaker
          ? 'border-emerald-200 bg-emerald-50/40'
          : 'border-amber-300 bg-amber-50/70'
      } ${compact ? 'p-3 space-y-2.5' : 'p-4 space-y-3'}`}
    >
      {/* Top Speaker Connection Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
              hasConnectedSpeaker
                ? 'bg-emerald-600 text-white'
                : 'bg-amber-500 text-white'
            }`}
          >
            <Speaker className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                data-testid="pa-speaker-status-label"
                className={`text-xs font-bold ${
                  hasConnectedSpeaker ? 'text-emerald-950' : 'text-amber-950'
                }`}
              >
                {hasConnectedSpeaker
                  ? `Speaker Connected: ${activeSpeaker!.name}`
                  : 'Speaker Required for Disaster Announcements'}
              </span>
              {activeSpeaker ? (
                <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white font-mono text-[10px] font-semibold">
                  {formatSpeakerTypeLabel(activeSpeaker.connectionType)}
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-mono text-[10px] font-bold uppercase">
                  PA Locked
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-600">
              {hasConnectedSpeaker
                ? 'PA announcements, emergency sirens, and Auto-PA evacuation broadcasts are unlocked.'
                : 'Connect any speaker (Bluetooth, Wired/AUX, USB/HDMI, Built-in, or IP PA) to broadcast announcements.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {hasConnectedSpeaker ? (
            <>
              <button
                type="button"
                data-testid="pa-speaker-test-chime-btn"
                onClick={() => {
                  void playPaSirenTone('attention-chime', {
                    volume: paVolume,
                    sinkId: activeSpeaker?.sinkId,
                  });
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50 cursor-pointer"
              >
                <Volume2 className="w-3 h-3" aria-hidden="true" />
                <span>Test</span>
              </button>
              <button
                type="button"
                data-testid="pa-speaker-add-another-btn"
                onClick={() => setShowAddForm((prev) => !prev)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Plus className="w-3 h-3" aria-hidden="true" />
                <span>{showAddForm ? 'Hide' : 'Add Speaker'}</span>
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Active Connected Speakers Strip */}
      {connectedSpeakers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {connectedSpeakers.map((spk) => {
            const isSelected = spk.id === activeSpeaker?.id;
            return (
              <div
                key={spk.id}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] ${
                  isSelected
                    ? 'bg-emerald-600 text-white border-emerald-600 font-semibold'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectActiveSpeaker(spk.id)}
                  className="inline-flex items-center gap-1 cursor-pointer"
                >
                  <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="truncate max-w-[180px]">{spk.name}</span>
                </button>
                <button
                  type="button"
                  data-testid={`disconnect-speaker-${spk.id}`}
                  aria-label={`Disconnect ${spk.name}`}
                  onClick={() => onDisconnectSpeaker(spk.id)}
                  className={`p-0.5 rounded cursor-pointer ${
                    isSelected ? 'hover:bg-emerald-700 text-emerald-100' : 'hover:bg-slate-100 text-slate-400'
                  }`}
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Speaker Connection Selector (Shown automatically when 0 speakers connected, or when adding) */}
      {showAddForm ? (
        <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2.5">
          {/* Connection Type Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="speaker-tab-system"
              onClick={() => setConnectTab('system')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border cursor-pointer ${
                connectTab === 'system'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <MonitorSpeaker className="w-3 h-3" aria-hidden="true" />
              <span>System / Built-in / USB</span>
            </button>
            <button
              type="button"
              data-testid="speaker-tab-bluetooth"
              onClick={() => setConnectTab('bluetooth')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border cursor-pointer ${
                connectTab === 'bluetooth'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Bluetooth className="w-3 h-3" aria-hidden="true" />
              <span>Bluetooth Speaker</span>
            </button>
            <button
              type="button"
              data-testid="speaker-tab-wired"
              onClick={() => setConnectTab('wired')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border cursor-pointer ${
                connectTab === 'wired'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Cable className="w-3 h-3" aria-hidden="true" />
              <span>Wired / AUX / PA Amp</span>
            </button>
            <button
              type="button"
              data-testid="speaker-tab-network"
              onClick={() => setConnectTab('network')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border cursor-pointer ${
                connectTab === 'network'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <Wifi className="w-3 h-3" aria-hidden="true" />
              <span>IP / Wi-Fi PA Horn</span>
            </button>
          </div>

          {connectTab === 'system' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  data-testid="connect-system-speaker-btn"
                  onClick={() => {
                    void handleSystemPicker();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  <Speaker className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Connect Active System / Built-in / USB Speaker</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleScanSystemOutputs();
                  }}
                  disabled={isScanning}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span>Rescan Audio Outputs</span>
                </button>
              </div>
              {detectedOutputs.length > 0 ? (
                <div className="space-y-1">
                  {detectedOutputs.slice(0, 4).map((out) => (
                    <div
                      key={out.deviceId}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 truncate">{out.label}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {formatSpeakerTypeLabel(out.connectionType)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          connectAndChime({
                            id: `sys-${out.deviceId}`,
                            name: out.label,
                            connectionType: out.connectionType,
                            sinkId: out.deviceId,
                            connectedAt: new Date().toISOString(),
                            verified: true,
                          })
                        }
                        className="px-2.5 py-1 text-[11px] font-semibold rounded bg-slate-900 hover:bg-slate-800 text-white cursor-pointer shrink-0"
                      >
                        Connect
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {connectTab === 'bluetooth' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="pair-bluetooth-speaker-btn"
                  onClick={() => {
                    void handlePairBluetooth();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                >
                  <Bluetooth className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Scan &amp; Pair Bluetooth Speaker</span>
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 pt-1 border-t border-slate-100">
                <input
                  type="text"
                  value={bluetoothFallbackName}
                  onChange={(e) => setBluetoothFallbackName(e.target.value)}
                  placeholder="OS-paired Bluetooth speaker name (e.g. JBL Charge 5)"
                  className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-slate-50 text-slate-900"
                />
                <button
                  type="button"
                  data-testid="connect-os-bluetooth-speaker-btn"
                  onClick={handleConnectManualBluetooth}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900 hover:bg-slate-800 text-white cursor-pointer shrink-0"
                >
                  Use OS-Paired Bluetooth
                </button>
              </div>
            </div>
          ) : null}

          {connectTab === 'wired' ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={wiredType}
                onChange={(e) => setWiredType(e.target.value as PaSpeakerConnectionType)}
                className="text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-slate-50 text-slate-900"
              >
                <option value="wired-aux">3.5mm AUX / Line-Out PA</option>
                <option value="usb-hdmi">USB / HDMI Audio Speaker</option>
                <option value="builtin">Built-in Device Speaker</option>
              </select>
              <input
                type="text"
                value={wiredName}
                onChange={(e) => setWiredName(e.target.value)}
                placeholder="Speaker name (e.g. Hall PA Amplifier)"
                className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-slate-50 text-slate-900"
              />
              <button
                type="button"
                data-testid="connect-wired-speaker-btn"
                onClick={handleConnectManualWired}
                className="px-3 py-1.5 text-xs font-bold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shrink-0"
              >
                Connect Wired Speaker
              </button>
            </div>
          ) : null}

          {connectTab === 'network' ? (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={ipSpeakerName}
                onChange={(e) => setIpSpeakerName(e.target.value)}
                placeholder="Speaker label"
                className="sm:col-span-4 text-xs px-2.5 py-1.5 rounded-md border border-slate-300 bg-slate-50 text-slate-900"
              />
              <input
                type="text"
                value={ipSpeakerUrl}
                onChange={(e) => setIpSpeakerUrl(e.target.value)}
                placeholder="http://192.168.1.50/pa"
                className="sm:col-span-5 text-xs font-mono px-2.5 py-1.5 rounded-md border border-slate-300 bg-slate-50 text-slate-900"
              />
              <button
                type="button"
                data-testid="connect-ip-speaker-btn"
                onClick={handleConnectIpSpeaker}
                className="sm:col-span-3 px-3 py-1.5 text-xs font-bold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
              >
                Connect IP PA
              </button>
            </div>
          ) : null}

          {feedback ? (
            <p className="text-[11px] text-slate-600">{feedback}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
