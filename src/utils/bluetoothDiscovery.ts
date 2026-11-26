import type { BluetoothDeviceCandidate } from '../types';
import { parseSafeJsonText } from './monitoringLogic';
import {
  CCTV_VIDEO_SERVICE_UUID,
  classifyBluetoothCamera,
  VOICE_AUDIO_SERVICE_UUID,
} from './monitoringLogic';

interface WebBluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: {
    connect: () => Promise<{
      getPrimaryServices: () => Promise<Array<{ uuid: string }>>;
      disconnect: () => void;
    }>;
  };
}

interface WebBluetoothAdvertisementEventLike {
  device: { id: string; name?: string };
  uuids?: Array<string | number>;
  rssi?: number;
}

interface WebBluetoothLEScanLike {
  active: boolean;
  stop: () => void;
}

interface NavigatorBluetoothLike {
  getAvailability?: () => Promise<boolean>;
  getDevices?: () => Promise<WebBluetoothDeviceLike[]>;
  requestDevice: (opts: {
    acceptAllDevices?: boolean;
    optionalServices?: string[];
  }) => Promise<WebBluetoothDeviceLike>;
  requestLEScan?: (opts: { acceptAllAdvertisements?: boolean }) => Promise<WebBluetoothLEScanLike>;
  addEventListener?: (
    type: string,
    listener: (event: WebBluetoothAdvertisementEventLike) => void
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (event: WebBluetoothAdvertisementEventLike) => void
  ) => void;
}

function getNavigatorBluetooth(): NavigatorBluetoothLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as unknown as { bluetooth?: NavigatorBluetoothLike }).bluetooth;
}

export function buildCandidateFromMetadata(
  id: string,
  rawName: string | undefined,
  serviceUuids: string[] = [],
  sourceTransport: BluetoothDeviceCandidate['sourceTransport'] = 'ble',
  extraIds?: { audioDeviceId?: string; videoDeviceId?: string }
): BluetoothDeviceCandidate {
  const deviceName = rawName?.trim() || `Bluetooth-Device-${id.slice(0, 6)}`;
  const preliminary = classifyBluetoothCamera({
    name: deviceName,
    serviceUuids,
    declaredCapabilities: { video: false, voice: false },
  });

  return {
    id: `bt-${id}`,
    name: deviceName,
    macAddress: id,
    serviceUuids,
    declaredCapabilities: {
      video: preliminary.supportsVideo || Boolean(extraIds?.videoDeviceId),
      voice: preliminary.supportsVoice || Boolean(extraIds?.audioDeviceId),
    },
    sourceTransport,
    audioDeviceId: extraIds?.audioDeviceId,
    videoDeviceId: extraIds?.videoDeviceId,
    discoveredAt: new Date().toISOString(),
  };
}

export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export interface BluetoothEnvironmentStatus {
  isIframe: boolean;
  isSecureContext: boolean;
  hasWebBluetoothApi: boolean;
  bluetoothAdapterReady: boolean | null;
  blockedByPermissionsPolicy: boolean;
  supportsLEScan: boolean;
  supportsGetDevices: boolean;
}

export async function getBluetoothEnvironmentStatus(): Promise<BluetoothEnvironmentStatus> {
  const inIframe = isRunningInIframe();
  const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false;
  const navBt = getNavigatorBluetooth();

  if (!navBt) {
    return {
      isIframe: inIframe,
      isSecureContext: isSecure,
      hasWebBluetoothApi: false,
      bluetoothAdapterReady: false,
      blockedByPermissionsPolicy: inIframe,
      supportsLEScan: false,
      supportsGetDevices: false,
    };
  }

  let adapterReady: boolean | null = null;
  let blockedByPolicy = false;

  if (typeof navBt.getAvailability === 'function') {
    try {
      adapterReady = await navBt.getAvailability();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/permissions policy|disallowed|security/i.test(msg)) {
        blockedByPolicy = true;
      }
      adapterReady = false;
    }
  }

  if (typeof navBt.getDevices === 'function' && !blockedByPolicy) {
    try {
      await navBt.getDevices();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/permissions policy|disallowed|security/i.test(msg)) {
        blockedByPolicy = true;
      }
    }
  }

  return {
    isIframe: inIframe,
    isSecureContext: isSecure,
    hasWebBluetoothApi: true,
    bluetoothAdapterReady: adapterReady,
    blockedByPermissionsPolicy: blockedByPolicy,
    supportsLEScan: typeof navBt.requestLEScan === 'function',
    supportsGetDevices: typeof navBt.getDevices === 'function',
  };
}

export async function scanRealBluetoothDevice(): Promise<BluetoothDeviceCandidate> {
  const navBluetooth = getNavigatorBluetooth();

  if (!navBluetooth) {
    throw new Error(
      isRunningInIframe()
        ? 'Web Bluetooth is disabled inside this embedded preview iframe. Click "Open Standalone Tab" to unlock direct Bluetooth hardware access in Chrome/Edge.'
        : 'Web Bluetooth API is unavailable in this browser. Open in Chrome or Edge over HTTPS (or localhost) to pair Bluetooth hardware.'
    );
  }

  try {
    const btDevice = await navBluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        CCTV_VIDEO_SERVICE_UUID,
        VOICE_AUDIO_SERVICE_UUID,
        '00001800-0000-1000-8000-00805f9b34fb',
        '0000180a-0000-1000-8000-00805f9b34fb',
      ],
    });

    const serviceUuids: string[] = [];
    if (btDevice.gatt) {
      try {
        const server = await btDevice.gatt.connect();
        const services = await server.getPrimaryServices();
        for (const s of services) {
          serviceUuids.push(s.uuid);
        }
        server.disconnect();
      } catch {
        // Device refused GATT connection; classify from advertised name & metadata
      }
    }

    return buildCandidateFromMetadata(btDevice.id, btDevice.name, serviceUuids, 'ble');
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/permissions policy|disallowed|security/i.test(msg)) {
      throw new Error(
        'Browser blocked Web Bluetooth inside the embedded preview frame (Permissions Policy). Open the app in a standalone Chrome/Edge tab to pair Bluetooth hardware.'
      );
    }
    if (/User cancelled|canceled/i.test(msg)) {
      throw new Error('Bluetooth device picker was closed before selecting a device.');
    }
    throw err;
  }
}

export interface NearbyScanResult {
  devices: BluetoothDeviceCandidate[];
  notices: string[];
  blockedByIframePolicy: boolean;
  envStatus: BluetoothEnvironmentStatus;
}

export async function searchNearbyBluetoothDevices(
  onDeviceFound?: (device: BluetoothDeviceCandidate) => void,
  options?: { requestMediaLabels?: boolean; openPickerIfLEScanUnavailable?: boolean }
): Promise<NearbyScanResult> {
  const foundMap = new Map<string, BluetoothDeviceCandidate>();
  const notices: string[] = [];
  const envStatus = await getBluetoothEnvironmentStatus();
  let blockedByIframePolicy = envStatus.blockedByPermissionsPolicy;

  const recordDevice = (d: BluetoothDeviceCandidate) => {
    foundMap.set(d.id, d);
    onDeviceFound?.(d);
  };

  // 1. Check backend host OS Bluetooth adapter (works when self-hosted on a bank/school NVR PC)
  try {
    const resp = await fetch('/api/bluetooth/scan');
    if (resp.ok) {
      const parsed = parseSafeJsonText<{
        adapterAvailable: boolean;
        devices: BluetoothDeviceCandidate[];
        message?: string;
      }>(await resp.text());
      if (parsed.ok) {
        const data = parsed.data;
        for (const dev of data.devices || []) {
          recordDevice({ ...dev, sourceTransport: 'host-bluetooth' });
        }
        if (data.message) {
          notices.push(data.message);
        }
      }
    }
  } catch {
    notices.push('Unable to reach local server Bluetooth scan endpoint.');
  }

  // 2. Check already-permitted BLE devices via navigator.bluetooth.getDevices()
  const navBluetooth = getNavigatorBluetooth();
  if (navBluetooth?.getDevices && !envStatus.blockedByPermissionsPolicy) {
    try {
      const permitted = await navBluetooth.getDevices();
      for (const dev of permitted) {
        recordDevice(buildCandidateFromMetadata(dev.id, dev.name, [], 'ble'));
      }
      if (permitted.length > 0) {
        notices.push(`Found ${permitted.length} previously paired BLE device(s) in this browser.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/permissions policy|disallowed|security/i.test(msg)) {
        blockedByIframePolicy = true;
      }
    }
  }

  // 3. Attempt live BLE advertisement scan (navigator.bluetooth.requestLEScan)
  let leScanWorked = false;
  if (navBluetooth?.requestLEScan && navBluetooth.addEventListener && !blockedByIframePolicy) {
    const onAdv = (event: WebBluetoothAdvertisementEventLike) => {
      const uuids = (event.uuids || []).map((u) => String(u));
      recordDevice(buildCandidateFromMetadata(event.device.id, event.device.name, uuids, 'ble'));
    };

    try {
      navBluetooth.addEventListener('advertisementreceived', onAdv);
      const scan = await navBluetooth.requestLEScan({ acceptAllAdvertisements: true });
      leScanWorked = true;
      await new Promise((resolve) => setTimeout(resolve, 3500));
      if (scan.active) {
        scan.stop();
      }
      notices.push('Completed 3.5s browser BLE nearby advertisement scan.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/permissions policy|disallowed|iframe|security/i.test(msg)) {
        blockedByIframePolicy = true;
      } else if (msg) {
        notices.push(`Browser BLE scan note: ${msg}`);
      }
    } finally {
      navBluetooth.removeEventListener?.('advertisementreceived', onAdv);
    }
  }

  // 3b. If running standalone with Web Bluetooth API but requestLEScan flag is off, fall back to requestDevice picker
  if (
    options?.openPickerIfLEScanUnavailable &&
    !leScanWorked &&
    !blockedByIframePolicy &&
    !envStatus.isIframe &&
    navBluetooth?.requestDevice
  ) {
    try {
      const picked = await scanRealBluetoothDevice();
      recordDevice(picked);
      notices.push(`Paired nearby Bluetooth device "${picked.name}".`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/permissions policy|disallowed|iframe|security/i.test(msg)) {
        blockedByIframePolicy = true;
      } else if (msg) {
        notices.push(msg);
      }
    }
  }

  if (blockedByIframePolicy || envStatus.isIframe) {
    notices.push(
      'Web Bluetooth is restricted inside this embedded preview iframe by browser Permissions Policy. Open the standalone tab in Chrome or Edge to connect directly to local Bluetooth radios.'
    );
  } else if (!navBluetooth) {
    notices.push(
      'Web Bluetooth API is unavailable in this browser. Use Google Chrome or Microsoft Edge over HTTPS / localhost in a standalone tab.'
    );
  } else if (!navBluetooth.requestLEScan && !options?.openPickerIfLEScanUnavailable) {
    notices.push(
      'Standard Chrome/Edge hides passive BLE scanning behind chrome://flags; click "Pair Bluetooth Picker" to open your computer’s Bluetooth radio picker.'
    );
  }

  // 4. Inspect OS-paired Bluetooth audio/video devices exposed via MediaDevices (Classic Bluetooth HFP/A2DP/cameras)
  try {
    if (options?.requestMediaLabels && navigator.mediaDevices?.getUserMedia) {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        tempStream.getTracks().forEach((t) => t.stop());
      } catch {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioOnly.getTracks().forEach((t) => t.stop());
        } catch {
          // permission denied
        }
      }
    }

    if (navigator.mediaDevices?.enumerateDevices) {
      const mediaList = await navigator.mediaDevices.enumerateDevices();
      const btMediaPattern = /bluetooth|hands-free|hfp|a2dp|wireless|airpods|buds|headset|cctv|cam/i;
      const unlabeledCount = mediaList.filter(
        (d) => (d.kind === 'audioinput' || d.kind === 'videoinput') && !d.label
      ).length;

      for (const dev of mediaList) {
        if ((dev.kind === 'audioinput' || dev.kind === 'videoinput') && dev.label) {
          if (btMediaPattern.test(dev.label)) {
            recordDevice(
              buildCandidateFromMetadata(
                dev.deviceId.slice(0, 16) || dev.label,
                dev.label,
                [],
                'paired-media-bluetooth',
                {
                  audioDeviceId: dev.kind === 'audioinput' ? dev.deviceId : undefined,
                  videoDeviceId: dev.kind === 'videoinput' ? dev.deviceId : undefined,
                }
              )
            );
          }
        }
      }

      if (unlabeledCount > 0 && !options?.requestMediaLabels) {
        notices.push(
          'Some paired OS Bluetooth microphones/cameras have hidden labels until camera/mic permission is granted. Click "Hardware Cameras & Mics" or grant permission to inspect them.'
        );
      }
    }
  } catch {
    // ignore media enumeration errors
  }

  return {
    devices: Array.from(foundMap.values()),
    notices,
    blockedByIframePolicy,
    envStatus,
  };
}

export interface MediaDeviceSummary {
  videoInputs: MediaDeviceInfo[];
  audioInputs: MediaDeviceInfo[];
}

export async function listHardwareMediaDevices(requestPermission = false): Promise<MediaDeviceSummary> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { videoInputs: [], audioInputs: [] };
  }
  if (requestPermission && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      try {
        const videoOnly = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        videoOnly.getTracks().forEach((t) => t.stop());
      } catch {
        // video permission unavailable; continue to try audio-only
      }
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioOnly.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore if denied
      }
    }
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    videoInputs: devices.filter((d) => d.kind === 'videoinput'),
    audioInputs: devices.filter((d) => d.kind === 'audioinput'),
  };
}
