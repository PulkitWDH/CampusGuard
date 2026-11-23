import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIFI_HOTSPOT_QUICK_PRESETS,
  buildWifiProbeTargets,
  classifyComputerWirelessCamera,
  deduplicateDiscoveredWifiCameras,
  extractLocalSubnetPrefix,
} from './wifiDiscovery';

test('extractLocalSubnetPrefix parses private LAN subnets from WebRTC ICE candidates and ignores public/loopback IPs', () => {
  const iceCandidate =
    'candidate:842163049 1 udp 1677729535 192.168.1.42 54321 typ host generation 0';
  assert.equal(extractLocalSubnetPrefix(iceCandidate), '192.168.1');

  assert.equal(extractLocalSubnetPrefix('candidate:1 1 udp 1 10.0.4.19 5000 typ host'), '10.0.4');
  assert.equal(extractLocalSubnetPrefix('candidate:1 1 udp 1 172.20.10.3 5000 typ host'), '172.20.10');

  // Loopback, public, and mDNS obfuscated candidates must return null
  assert.equal(extractLocalSubnetPrefix('candidate:1 1 udp 1 127.0.0.1 5000 typ host'), null);
  assert.equal(extractLocalSubnetPrefix('candidate:1 1 udp 1 8.8.8.8 5000 typ srflx'), null);
  assert.equal(
    extractLocalSubnetPrefix('candidate:1 1 udp 1 a1b2c3d4.local 5000 typ host'),
    null
  );
});

test('classifyComputerWirelessCamera identifies wireless/Wi-Fi camera bridges and excludes standard USB webcams', () => {
  const iphone = classifyComputerWirelessCamera({
    deviceId: 'dev-1',
    label: "Alex's iPhone Camera",
    kind: 'videoinput',
  });
  assert.equal(iphone.isWirelessWifiCam, true);
  assert.match(iphone.brandLabel, /Continuity/i);

  const phoneLink = classifyComputerWirelessCamera({
    deviceId: 'dev-2',
    label: 'Windows Virtual Camera (Phone Link)',
    kind: 'videoinput',
  });
  assert.equal(phoneLink.isWirelessWifiCam, true);

  const droidcam = classifyComputerWirelessCamera({
    deviceId: 'dev-3',
    label: 'DroidCam Source 3',
    kind: 'videoinput',
  });
  assert.equal(droidcam.isWirelessWifiCam, true);

  const builtinWebcam = classifyComputerWirelessCamera({
    deviceId: 'dev-4',
    label: 'Integrated HD Webcam (04f2:b725)',
    kind: 'videoinput',
  });
  assert.equal(builtinWebcam.isWirelessWifiCam, false);

  const audioMic = classifyComputerWirelessCamera({
    deviceId: 'mic-1',
    label: 'iPhone Microphone',
    kind: 'audioinput',
  });
  assert.equal(audioMic.isWirelessWifiCam, false);
});

test('buildWifiProbeTargets prioritizes zero-PIN camera Wi-Fi APs and expands local LAN subnet cleanly', () => {
  const withoutSubnet = buildWifiProbeTargets(null);
  assert.ok(withoutSubnet.some((t) => t.host === '192.168.4.1' && t.kind === 'hotspot-ap'));
  assert.ok(withoutSubnet.some((t) => t.host === '192.168.1.1' && t.kind === 'hotspot-ap'));
  assert.ok(withoutSubnet.some((t) => t.host === 'esp32-cam.local'));

  const withSubnet = buildWifiProbeTargets('192.168.50');
  assert.ok(withSubnet.length > withoutSubnet.length);
  assert.ok(withSubnet.some((t) => t.url === 'http://192.168.50.45:8080/shot.jpg'));
  assert.ok(withSubnet.some((t) => t.url === 'http://192.168.50.60/capture'));

  // Zero duplicate URLs
  const uniqueUrls = new Set(withSubnet.map((t) => t.url));
  assert.equal(uniqueUrls.size, withSubnet.length);
});

test('deduplicateDiscoveredWifiCameras keeps fastest endpoint per host and preserves zero-PIN presets', () => {
  const merged = deduplicateDiscoveredWifiCameras([
    {
      id: 'a',
      name: 'Cam A',
      kind: 'hotspot-ap',
      hostLabel: '192.168.4.1',
      brandLabel: 'ESP32-CAM',
      streamUrl: 'http://192.168.4.1/shot.jpg',
      latencyMs: 140,
      requiresPin: false,
    },
    {
      id: 'b',
      name: 'Cam A Fast',
      kind: 'hotspot-ap',
      hostLabel: '192.168.4.1',
      brandLabel: 'ESP32-CAM',
      streamUrl: 'http://192.168.4.1/capture',
      latencyMs: 38,
      requiresPin: false,
    },
    {
      id: 'c',
      name: 'DroidCam',
      kind: 'wireless-media-device',
      hostLabel: 'Computer Wi-Fi Bridge',
      brandLabel: 'DroidCam Wi-Fi',
      videoDeviceId: 'vid-droid',
      latencyMs: 1,
      requiresPin: false,
    },
  ]);

  assert.equal(merged.length, 2);
  const apCam = merged.find((c) => c.hostLabel === '192.168.4.1');
  assert.equal(apCam?.streamUrl, 'http://192.168.4.1/capture');
  assert.equal(WIFI_HOTSPOT_QUICK_PRESETS.length, 3);
  assert.ok(WIFI_HOTSPOT_QUICK_PRESETS.every((p) => p.streamUrl.startsWith('http://')));
});
