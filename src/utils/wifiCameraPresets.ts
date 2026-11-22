export interface WifiCameraBrandPreset {
  id: string;
  label: string;
  defaultPort: string;
  pathTemplate: string;
  exampleHost: string;
  notes: string;
}

export const WIFI_CAMERA_BRAND_PRESETS: WifiCameraBrandPreset[] = [
  {
    id: 'custom-url',
    label: 'Custom Wi-Fi Snapshot / MJPEG URL',
    defaultPort: '',
    pathTemplate: '',
    exampleHost: 'http://192.168.1.50:8080/shot.jpg',
    notes: 'Paste any HTTP/HTTPS snapshot JPEG or MJPEG stream URL from your Wi-Fi camera.',
  },
  {
    id: 'ip-webcam',
    label: 'IP Webcam (Android Wi-Fi Camera)',
    defaultPort: '8080',
    pathTemplate: '/shot.jpg',
    exampleHost: '192.168.1.45',
    notes: 'Open IP Webcam app on phone, start server, and enter the Wi-Fi IP shown on screen.',
  },
  {
    id: 'esp32-cam',
    label: 'ESP32-CAM Wi-Fi Module',
    defaultPort: '80',
    pathTemplate: '/capture',
    exampleHost: '192.168.1.60',
    notes: 'Works with ESP32-CAM CameraWebServer (/capture or :81/stream).',
  },
  {
    id: 'hikvision',
    label: 'Hikvision / EZVIZ Wi-Fi CCTV',
    defaultPort: '80',
    pathTemplate: '/ISAPI/Streaming/channels/101/picture',
    exampleHost: '192.168.1.64',
    notes: 'Enable ISAPI/HTTP snapshot in camera web settings and provide camera credentials.',
  },
  {
    id: 'dahua-amcrest',
    label: 'Dahua / Amcrest / Lorex Wi-Fi CCTV',
    defaultPort: '80',
    pathTemplate: '/cgi-bin/snapshot.cgi?channel=1',
    exampleHost: '192.168.1.108',
    notes: 'Standard HTTP snapshot CGI endpoint for Dahua, Amcrest, and Lorex Wi-Fi cameras.',
  },
  {
    id: 'reolink',
    label: 'Reolink Wi-Fi CCTV',
    defaultPort: '80',
    pathTemplate: '/cgi-bin/api.cgi?cmd=Snap&channel=0',
    exampleHost: '192.168.1.72',
    notes: 'Enable HTTP/HTTPS in Reolink Network > Advanced > Server Settings.',
  },
  {
    id: 'axis',
    label: 'Axis / Uniview / Generic ONVIF HTTP',
    defaultPort: '80',
    pathTemplate: '/axis-cgi/jpg/image.cgi',
    exampleHost: '192.168.1.90',
    notes: 'Standard Axis/ONVIF HTTP JPEG snapshot URL.',
  },
];

export function isPrivateLanHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  const match172 = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/**
 * Builds a clean HTTP/HTTPS Wi-Fi CCTV snapshot/MJPEG URL from a brand preset,
 * IP/hostname (or full URL), optional port, and optional Basic Auth credentials.
 */
export function buildWifiCameraUrl(params: {
  brandId: string;
  hostOrUrl: string;
  port?: string;
  username?: string;
  password?: string;
}): { ok: true; url: string; hostname: string; isPrivateLan: boolean } | { ok: false; error: string } {
  const rawInput = (params.hostOrUrl || '').trim();
  if (!rawInput) {
    return { ok: false, error: 'Enter a Wi-Fi camera IP address or stream URL.' };
  }

  if (/^rtsp:\/\//i.test(rawInput)) {
    return {
      ok: false,
      error:
        'Browsers cannot play raw rtsp:// directly. Use your Wi-Fi camera HTTP snapshot/MJPEG URL (or an HTTP/WebRTC relay like go2rtc/MediaMTX).',
    };
  }

  const preset =
    WIFI_CAMERA_BRAND_PRESETS.find((p) => p.id === params.brandId) ??
    WIFI_CAMERA_BRAND_PRESETS[0];

  let candidate = rawInput;
  const hasScheme = /^https?:\/\//i.test(candidate);

  if (!hasScheme) {
    candidate = `http://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Enter a valid Wi-Fi IP address (e.g. 192.168.1.50) or HTTP/HTTPS URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only HTTP and HTTPS Wi-Fi camera streams are supported.' };
  }

  const cleanPort = (params.port || '').trim();
  if (!parsed.port && cleanPort && cleanPort !== '80' && cleanPort !== '443') {
    parsed.port = cleanPort;
  } else if (!parsed.port && !hasScheme && preset.defaultPort && preset.defaultPort !== '80') {
    parsed.port = preset.defaultPort;
  }

  // Apply brand snapshot path if user provided only the IP/host without a path
  if ((parsed.pathname === '/' || !parsed.pathname) && preset.pathTemplate) {
    const qIndex = preset.pathTemplate.indexOf('?');
    if (qIndex >= 0) {
      parsed.pathname = preset.pathTemplate.slice(0, qIndex);
      if (!parsed.search) {
        parsed.search = preset.pathTemplate.slice(qIndex);
      }
    } else {
      parsed.pathname = preset.pathTemplate;
    }
  }

  const user = (params.username || '').trim();
  const pass = params.password || '';
  if (user && !parsed.username) {
    parsed.username = user;
    if (pass) {
      parsed.password = pass;
    }
  }

  // Reolink API uses query params when credentials are supplied
  if (preset.id === 'reolink' && user) {
    parsed.searchParams.set('user', user);
    if (pass) parsed.searchParams.set('password', pass);
    parsed.username = '';
    parsed.password = '';
  }

  return {
    ok: true,
    url: parsed.toString(),
    hostname: parsed.hostname,
    isPrivateLan: isPrivateLanHost(parsed.hostname),
  };
}
