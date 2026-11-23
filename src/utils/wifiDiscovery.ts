import { listHardwareMediaDevices } from './bluetoothDiscovery';
import { isPrivateLanHost } from './wifiCameraPresets';

export type WifiDiscoveredKind = 'hotspot-ap' | 'lan-http' | 'wireless-media-device';

export interface WifiDiscoveredCamera {
  id: string;
  name: string;
  kind: WifiDiscoveredKind;
  hostLabel: string;
  brandLabel: string;
  streamUrl?: string;
  videoDeviceId?: string;
  audioDeviceId?: string;
  latencyMs?: number;
  previewUrl?: string;
  requiresPin: false;
}

export interface WifiProbeTarget {
  url: string;
  host: string;
  brandLabel: string;
  kind: 'hotspot-ap' | 'lan-http';
}

export interface ComputerNetworkStatus {
  online: boolean;
  connectionType: string;
  isHttpsMixedContentRisk: boolean;
}

export interface WifiScanProgress {
  phase: 'devices' | 'hotspot' | 'subnet' | 'done';
  label: string;
  checked: number;
  total: number;
}

export interface WifiHotspotQuickPreset {
  id: string;
  label: string;
  subtitle: string;
  host: string;
  streamUrl: string;
  brandLabel: string;
}

/**
 * Common zero-PIN direct Wi-Fi hotspot presets when the computer's Wi-Fi
 * is connected directly to the camera's own Wi-Fi network.
 */
export const WIFI_HOTSPOT_QUICK_PRESETS: WifiHotspotQuickPreset[] = [
  {
    id: 'ap-esp32',
    label: 'ESP32 / Mini Wi-Fi Cam AP',
    subtitle: 'Camera Wi-Fi (192.168.4.1)',
    host: '192.168.4.1',
    streamUrl: 'http://192.168.4.1/capture',
    brandLabel: 'Wi-Fi Camera AP',
  },
  {
    id: 'ap-generic',
    label: 'Direct CCTV Wi-Fi AP',
    subtitle: 'Camera Wi-Fi (192.168.1.1)',
    host: '192.168.1.1',
    streamUrl: 'http://192.168.1.1/shot.jpg',
    brandLabel: 'Wi-Fi CCTV AP',
  },
  {
    id: 'ap-phone',
    label: 'Phone Hotspot Wi-Fi Cam',
    subtitle: 'IP Webcam (192.168.43.1:8080)',
    host: '192.168.43.1',
    streamUrl: 'http://192.168.43.1:8080/shot.jpg',
    brandLabel: 'Phone Wi-Fi Camera',
  },
];

const HOTSPOT_AP_TARGETS: WifiProbeTarget[] = [
  { url: 'http://192.168.4.1/capture', host: '192.168.4.1', brandLabel: 'ESP32-CAM Wi-Fi AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.4.1:81/stream', host: '192.168.4.1', brandLabel: 'ESP32-CAM Wi-Fi AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.4.1/shot.jpg', host: '192.168.4.1', brandLabel: 'Wi-Fi Camera AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.1.1/shot.jpg', host: '192.168.1.1', brandLabel: 'Wi-Fi CCTV AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.1.1/capture', host: '192.168.1.1', brandLabel: 'Wi-Fi CCTV AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.1.1/snapshot.jpg', host: '192.168.1.1', brandLabel: 'Wi-Fi CCTV AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.1.1:8080/shot.jpg', host: '192.168.1.1', brandLabel: 'Wi-Fi CCTV AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.0.1/shot.jpg', host: '192.168.0.1', brandLabel: 'Wi-Fi CCTV AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.0.1/capture', host: '192.168.0.1', brandLabel: 'Wi-Fi CCTV AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.43.1:8080/shot.jpg', host: '192.168.43.1', brandLabel: 'Phone Hotspot Wi-Fi Cam', kind: 'hotspot-ap' },
  { url: 'http://192.168.43.1:4747/video', host: '192.168.43.1', brandLabel: 'DroidCam Wi-Fi', kind: 'hotspot-ap' },
  { url: 'http://192.168.137.1:8080/shot.jpg', host: '192.168.137.1', brandLabel: 'Windows Hotspot Wi-Fi Cam', kind: 'hotspot-ap' },
  { url: 'http://192.168.10.1/capture', host: '192.168.10.1', brandLabel: 'Mini Wi-Fi CCTV AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.100.1/capture', host: '192.168.100.1', brandLabel: 'Mini Wi-Fi CCTV AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.169.1/capture', host: '192.168.169.1', brandLabel: 'Wi-Fi Direct CCTV AP', kind: 'hotspot-ap' },
  { url: 'http://192.168.25.1/snapshot.jpg', host: '192.168.25.1', brandLabel: 'Wi-Fi Camera AP', kind: 'hotspot-ap' },
  { url: 'http://10.5.5.9/gp/gpControl', host: '10.5.5.9', brandLabel: 'Wi-Fi Action Camera AP', kind: 'hotspot-ap' },
  { url: 'http://esp32-cam.local/capture', host: 'esp32-cam.local', brandLabel: 'ESP32-CAM (mDNS Wi-Fi)', kind: 'lan-http' },
  { url: 'http://ipcam.local/shot.jpg', host: 'ipcam.local', brandLabel: 'Wi-Fi IP Camera (mDNS)', kind: 'lan-http' },
  { url: 'http://cctv.local/snapshot.jpg', host: 'cctv.local', brandLabel: 'Wi-Fi CCTV (mDNS)', kind: 'lan-http' },
  { url: 'http://camera.local/shot.jpg', host: 'camera.local', brandLabel: 'Wi-Fi Camera (mDNS)', kind: 'lan-http' },
];

const COMMON_LAN_CAMERA_OCTETS = [
  2, 3, 4, 5, 10, 15, 20, 45, 50, 60, 64, 72, 90, 100, 101, 102, 103, 104, 105, 108, 110, 120, 150, 200,
];

/**
 * Extracts a private IPv4 /24 subnet prefix (e.g., "192.168.1") from a WebRTC ICE
 * candidate string or IP address, ignoring mDNS `.local` aliases and public IPs.
 */
export function extractLocalSubnetPrefix(candidateOrIp: string): string | null {
  if (!candidateOrIp) return null;
  const matches = candidateOrIp.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})\b/g);
  if (!matches) return null;

  for (const ip of matches) {
    if (ip === '127.0.0.1' || ip === '0.0.0.0') continue;
    const octets = ip.split('.').map(Number);
    if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) continue;
    if (!isPrivateLanHost(ip)) continue;
    return `${octets[0]}.${octets[1]}.${octets[2]}`;
  }

  return null;
}

/**
 * Classifies a system video input exposed to the browser to identify wireless / Wi-Fi
 * cameras connected via the computer's Wi-Fi (Continuity Camera, Phone Link, DroidCam,
 * Iriun, Camo, EpocCam, NDI, or IP/Wi-Fi camera drivers).
 */
export function classifyComputerWirelessCamera(device: {
  deviceId: string;
  label: string;
  kind: string;
}): { isWirelessWifiCam: boolean; brandLabel: string } {
  if (device.kind !== 'videoinput') {
    return { isWirelessWifiCam: false, brandLabel: '' };
  }
  const label = (device.label || '').trim();
  if (!label) {
    return { isWirelessWifiCam: false, brandLabel: '' };
  }

  const rules: Array<{ pattern: RegExp; brandLabel: string }> = [
    { pattern: /\b(iphone|ipad|continuity)\b/i, brandLabel: 'Apple Continuity Wi-Fi Cam' },
    { pattern: /\b(phone\s*link|link\s*to\s*windows|windows\s*virtual\s*camera)\b/i, brandLabel: 'Windows Phone Link Wi-Fi Cam' },
    { pattern: /\bdroidcam\b/i, brandLabel: 'DroidCam Wi-Fi' },
    { pattern: /\biriun\b/i, brandLabel: 'Iriun Wi-Fi Webcam' },
    { pattern: /\bcamo\b/i, brandLabel: 'Camo Wireless Camera' },
    { pattern: /\bepoccam\b/i, brandLabel: 'EpocCam Wi-Fi' },
    { pattern: /\bndi\b/i, brandLabel: 'NDI Network Wi-Fi Cam' },
    { pattern: /\b(wi-?fi|wireless|ip\s*cam|network\s*cam|cctv|onvif|rtsp|ezviz|hikvision|reolink|tapo|wyze|esp32)\b/i, brandLabel: 'Computer Wi-Fi Camera' },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(label)) {
      return { isWirelessWifiCam: true, brandLabel: rule.brandLabel };
    }
  }

  return { isWirelessWifiCam: false, brandLabel: '' };
}

/**
 * Builds the prioritized, deduplicated list of browser-side Wi-Fi probe targets:
 * 1) Camera Direct Wi-Fi Hotspot AP gateways (zero IP/PIN needed when PC joins camera Wi-Fi)
 * 2) mDNS zero-config `.local` camera names
 * 3) Local Wi-Fi router subnet hosts (when subnet prefix is detected)
 */
export function buildWifiProbeTargets(subnetPrefix: string | null): WifiProbeTarget[] {
  const seen = new Set<string>();
  const targets: WifiProbeTarget[] = [];

  const pushTarget = (target: WifiProbeTarget) => {
    if (seen.has(target.url)) return;
    seen.add(target.url);
    targets.push(target);
  };

  for (const ap of HOTSPOT_AP_TARGETS) {
    pushTarget(ap);
  }

  if (subnetPrefix && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(subnetPrefix)) {
    for (const hostOctet of COMMON_LAN_CAMERA_OCTETS) {
      const host = `${subnetPrefix}.${hostOctet}`;
      pushTarget({
        url: `http://${host}:8080/shot.jpg`,
        host,
        brandLabel: 'Wi-Fi IP Camera (LAN)',
        kind: 'lan-http',
      });
      pushTarget({
        url: `http://${host}/capture`,
        host,
        brandLabel: 'Wi-Fi CCTV Camera (LAN)',
        kind: 'lan-http',
      });
    }
  }

  return targets;
}

/**
 * Deduplicates discovered Wi-Fi cameras by host/deviceId, retaining the fastest endpoint.
 */
export function deduplicateDiscoveredWifiCameras(
  cameras: WifiDiscoveredCamera[]
): WifiDiscoveredCamera[] {
  const byKey = new Map<string, WifiDiscoveredCamera>();

  for (const cam of cameras) {
    const key = cam.videoDeviceId
      ? `dev:${cam.videoDeviceId}`
      : `host:${cam.hostLabel.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, cam);
      continue;
    }
    const existingMs = existing.latencyMs ?? Number.MAX_SAFE_INTEGER;
    const candidateMs = cam.latencyMs ?? Number.MAX_SAFE_INTEGER;
    if (candidateMs < existingMs) {
      byKey.set(key, cam);
    }
  }

  return Array.from(byKey.values());
}

/**
 * Reads honest browser network connection state (browsers cannot read OS Wi-Fi SSID names).
 */
export function detectBrowserNetworkInfo(): ComputerNetworkStatus {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { online: true, connectionType: 'wifi', isHttpsMixedContentRisk: false };
  }

  const nav = navigator as Navigator & {
    connection?: { type?: string; effectiveType?: string };
  };
  const rawType = nav.connection?.type || nav.connection?.effectiveType || '';
  const connectionType = rawType ? String(rawType) : navigator.onLine ? 'connected' : 'offline';

  return {
    online: navigator.onLine,
    connectionType,
    isHttpsMixedContentRisk: window.location.protocol === 'https:',
  };
}

/**
 * Attempts to read the computer's active local Wi-Fi IPv4 /24 subnet via local-only
 * WebRTC ICE host candidates (no external STUN servers). Returns null if the browser
 * masks local IPs with mDNS `.local` privacy tokens.
 */
export async function detectLocalSubnetViaWebRTC(timeoutMs = 900): Promise<string | null> {
  if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
    return null;
  }

  return new Promise<string | null>((resolve) => {
    let settled = false;
    let pc: RTCPeerConnection | null = null;

    const finish = (prefix: string | null) => {
      if (settled) return;
      settled = true;
      try {
        pc?.close();
      } catch {
        // ignore cleanup error
      }
      resolve(prefix);
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);

    try {
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('wifi-subnet-probe');
      pc.onicecandidate = (event) => {
        if (!event.candidate?.candidate) return;
        const prefix = extractLocalSubnetPrefix(event.candidate.candidate);
        if (prefix) {
          window.clearTimeout(timer);
          finish(prefix);
        }
      };
      void pc
        .createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch(() => {
          window.clearTimeout(timer);
          finish(null);
        });
    } catch {
      window.clearTimeout(timer);
      finish(null);
    }
  });
}

function probeImageUrl(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ ok: true; latencyMs: number } | { ok: false }> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false });
      return;
    }

    const started = performance.now();
    const img = new Image();
    let done = false;

    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = (result: { ok: true; latencyMs: number } | { ok: false }) => {
      if (done) return;
      done = true;
      cleanup();
      if (!result.ok) {
        try {
          img.src = '';
        } catch {
          // ignore
        }
      }
      resolve(result);
    };

    const onAbort = () => finish({ ok: false });
    signal?.addEventListener('abort', onAbort, { once: true });

    const timer = window.setTimeout(() => finish({ ok: false }), timeoutMs);

    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        finish({ ok: true, latencyMs: Math.max(1, Math.round(performance.now() - started)) });
      } else {
        finish({ ok: false });
      }
    };
    img.onerror = () => finish({ ok: false });

    const sep = url.includes('?') ? '&' : '?';
    img.src = `${url}${sep}_cgscan=${Date.now()}`;
  });
}

/**
 * Scans the computer's active Wi-Fi connection directly from the browser for:
 * 1) Wireless / Wi-Fi bridged cameras available to the computer (Continuity, Phone Link, DroidCam, Iriun, Camo, NDI)
 * 2) Direct Camera Wi-Fi Hotspot AP cameras (192.168.4.1, 192.168.1.1, 192.168.43.1, etc.)
 * 3) Local Wi-Fi router subnet cameras & `.local` mDNS cameras
 * Requires zero PIN codes, zero IP typing, and zero backend network access.
 */
export async function scanComputerWifiCameras(options: {
  onProgress?: (progress: WifiScanProgress) => void;
  onFound?: (camera: WifiDiscoveredCamera) => void;
  signal?: AbortSignal;
}): Promise<{
  cameras: WifiDiscoveredCamera[];
  detectedSubnet: string | null;
  checkedEndpoints: number;
}> {
  const { onProgress, onFound, signal } = options;
  const discovered: WifiDiscoveredCamera[] = [];

  const emitFound = (cam: WifiDiscoveredCamera) => {
    discovered.push(cam);
    onFound?.(cam);
  };

  // Phase 1: Instant check for computer Wi-Fi / wireless virtual cameras
  onProgress?.({
    phase: 'devices',
    label: 'Checking computer Wi-Fi & wireless camera bridges...',
    checked: 0,
    total: 1,
  });

  try {
    const { videoInputs, audioInputs } = await listHardwareMediaDevices(false);
    const defaultAudioId = audioInputs[0]?.deviceId || undefined;
    for (const dev of videoInputs) {
      const classified = classifyComputerWirelessCamera(dev);
      if (classified.isWirelessWifiCam) {
        emitFound({
          id: `wifi-dev-${dev.deviceId}`,
          name: dev.label || classified.brandLabel,
          kind: 'wireless-media-device',
          hostLabel: 'Computer Wi-Fi Bridge',
          brandLabel: classified.brandLabel,
          videoDeviceId: dev.deviceId,
          audioDeviceId: defaultAudioId,
          latencyMs: 1,
          requiresPin: false,
        });
      }
    }
  } catch {
    // Non-fatal: continue scanning Wi-Fi HTTP endpoints
  }

  if (signal?.aborted) {
    return {
      cameras: deduplicateDiscoveredWifiCameras(discovered),
      detectedSubnet: null,
      checkedEndpoints: 0,
    };
  }

  // Phase 2: Detect active Wi-Fi LAN subnet & build prioritized targets
  onProgress?.({
    phase: 'hotspot',
    label: 'Scanning Camera Wi-Fi Hotspot APs & local network...',
    checked: 0,
    total: HOTSPOT_AP_TARGETS.length,
  });

  const detectedSubnet = await detectLocalSubnetViaWebRTC(800);
  const targets = buildWifiProbeTargets(detectedSubnet);
  const matchedHosts = new Set<string>();

  let checked = 0;
  const concurrency = 12;

  for (let i = 0; i < targets.length; i += concurrency) {
    if (signal?.aborted) break;
    const batch = targets.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (target) => {
        if (signal?.aborted || matchedHosts.has(target.host)) {
          checked += 1;
          return;
        }
        const res = await probeImageUrl(target.url, 1100, signal);
        checked += 1;
        if (res.ok && !matchedHosts.has(target.host)) {
          matchedHosts.add(target.host);
          emitFound({
            id: `wifi-net-${target.host.replace(/[^a-z0-9]/gi, '-')}`,
            name: `${target.brandLabel} (${target.host})`,
            kind: target.kind,
            hostLabel: target.host,
            brandLabel: target.brandLabel,
            streamUrl: target.url,
            latencyMs: res.latencyMs,
            previewUrl: target.url,
            requiresPin: false,
          });
        }
      })
    );

    onProgress?.({
      phase: i < HOTSPOT_AP_TARGETS.length ? 'hotspot' : 'subnet',
      label:
        i < HOTSPOT_AP_TARGETS.length
          ? 'Scanning direct Camera Wi-Fi hotspots (no PIN)...'
          : detectedSubnet
            ? `Scanning your Wi-Fi network (${detectedSubnet}.*)...`
            : 'Finishing local Wi-Fi scan...',
      checked: Math.min(checked, targets.length),
      total: targets.length,
    });
  }

  onProgress?.({
    phase: 'done',
    label: 'Wi-Fi scan complete',
    checked: targets.length,
    total: targets.length,
  });

  return {
    cameras: deduplicateDiscoveredWifiCameras(discovered),
    detectedSubnet,
    checkedEndpoints: checked,
  };
}
