export type WiredInterfaceType =
  | 'hdmi'
  | 'usb-c'
  | 'sdi-bnc'
  | 'usb'
  | 'built-in'
  | 'wired-generic';

export interface WiredCameraDevice {
  deviceId: string;
  groupId: string;
  label: string;
  interfaceType: WiredInterfaceType;
  interfaceBadge: string;
  matchedAudioDeviceId?: string;
  matchedAudioLabel?: string;
  maxWidth?: number;
  maxHeight?: number;
  maxFrameRate?: number;
  probeStatus: 'ready' | 'probing' | 'verified' | 'busy';
}

const HDMI_CAPTURE_PATTERN =
  /hdmi|cam\s*link|elgato|avermedia|magewell|blackmagic|decklink|macrosilicon|ms2109|ms2130|ezcap|ugreen|fhd\s*capture|4k\s*capture|video\s*capture|usb\s*video|capture\s*card|live\s*gamer|mirabox/i;

const USB_C_PATTERN =
  /type[\s-]?c|usb[\s-]?c|usbc|thunderbolt|displayport|dp\s*capture|usb\s*3\.?\d|usb3/i;

const SDI_BNC_PATTERN =
  /\bsdi\b|\bbnc\b|\bcvbs\b|av\s*to\s*usb|easycap|\bdvr\b|analog|composite|cctv\s*capture|s-video|vga\s*capture/i;

const BUILT_IN_PATTERN =
  /integrated|built[\s-]?in|facetime|internal|hd\s*user\s*facing|hp\s*wide\s*vision|truevision|front\s*camera|back\s*camera|laptop|macbook|surface\s*camera|ir\s*camera/i;

const USB_EXTERNAL_PATTERN =
  /\busb\b|\buvc\b|logitech|brio|c920|c922|c930|razer|kiyo|insta360|obsbot|anker|lifecam|elgato\s*facecam|sony|canon|nikon|gopro|dji|external|webcam|hd\s*pro|1080p|4k/i;

export const INTERFACE_BADGE_LABELS: Record<WiredInterfaceType, string> = {
  hdmi: 'HDMI Capture',
  'usb-c': 'USB-C / Type-C',
  'sdi-bnc': 'SDI / BNC / DVR',
  usb: 'USB UVC',
  'built-in': 'Built-in Cam',
  'wired-generic': 'Wired Video',
};

/**
 * Classifies a real browser MediaDeviceInfo label into its physical wired interface type
 * (HDMI capture card, USB-C / Type-C / Thunderbolt, SDI/BNC/DVR adapter, USB UVC, or Built-in).
 */
export function classifyWiredCameraInterface(label: string): {
  interfaceType: WiredInterfaceType;
  interfaceBadge: string;
} {
  const clean = (label || '').trim();
  if (!clean) {
    return {
      interfaceType: 'wired-generic',
      interfaceBadge: INTERFACE_BADGE_LABELS['wired-generic'],
    };
  }

  if (HDMI_CAPTURE_PATTERN.test(clean)) {
    return { interfaceType: 'hdmi', interfaceBadge: INTERFACE_BADGE_LABELS.hdmi };
  }
  if (SDI_BNC_PATTERN.test(clean)) {
    return { interfaceType: 'sdi-bnc', interfaceBadge: INTERFACE_BADGE_LABELS['sdi-bnc'] };
  }
  if (USB_C_PATTERN.test(clean)) {
    return { interfaceType: 'usb-c', interfaceBadge: INTERFACE_BADGE_LABELS['usb-c'] };
  }
  if (BUILT_IN_PATTERN.test(clean)) {
    return { interfaceType: 'built-in', interfaceBadge: INTERFACE_BADGE_LABELS['built-in'] };
  }
  if (USB_EXTERNAL_PATTERN.test(clean)) {
    return { interfaceType: 'usb', interfaceBadge: INTERFACE_BADGE_LABELS.usb };
  }
  return {
    interfaceType: 'wired-generic',
    interfaceBadge: INTERFACE_BADGE_LABELS['wired-generic'],
  };
}

const INTERFACE_SORT_PRIORITY: Record<WiredInterfaceType, number> = {
  hdmi: 0,
  'usb-c': 1,
  'sdi-bnc': 2,
  usb: 3,
  'wired-generic': 4,
  'built-in': 5,
};

/**
 * Maps real enumerated videoinput & audioinput devices into structured wired camera entries,
 * matching HDMI/USB-C audio channels via shared hardware groupId and sorting external
 * wired capture interfaces (HDMI, USB-C, SDI/BNC, USB) ahead of built-in laptop webcams.
 */
export function buildWiredCameraList(
  videoDevices: Array<Pick<MediaDeviceInfo, 'deviceId' | 'groupId' | 'label'>>,
  audioDevices: Array<Pick<MediaDeviceInfo, 'deviceId' | 'groupId' | 'label'>>
): WiredCameraDevice[] {
  const audioByGroup = new Map<string, Pick<MediaDeviceInfo, 'deviceId' | 'groupId' | 'label'>>();
  for (const audio of audioDevices) {
    if (audio.groupId && !audioByGroup.has(audio.groupId)) {
      audioByGroup.set(audio.groupId, audio);
    }
  }

  const mapped: WiredCameraDevice[] = videoDevices.map((video, index) => {
    const cleanLabel = (video.label || '').trim() || `Wired Camera Port ${index + 1}`;
    const { interfaceType, interfaceBadge } = classifyWiredCameraInterface(video.label || '');
    const pairedAudio = video.groupId ? audioByGroup.get(video.groupId) : undefined;

    return {
      deviceId: video.deviceId,
      groupId: video.groupId || '',
      label: cleanLabel,
      interfaceType,
      interfaceBadge,
      matchedAudioDeviceId: pairedAudio?.deviceId,
      matchedAudioLabel: pairedAudio?.label || undefined,
      probeStatus: 'ready',
    };
  });

  return mapped.sort((a, b) => {
    const priDiff = INTERFACE_SORT_PRIORITY[a.interfaceType] - INTERFACE_SORT_PRIORITY[b.interfaceType];
    if (priDiff !== 0) return priDiff;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Probes a real physical wired camera's live video track capabilities (max resolution & FPS)
 * and immediately stops the track so the camera stays free for monitoring.
 */
export async function probeWiredCameraCapabilities(
  deviceId: string
): Promise<{
  ok: boolean;
  maxWidth?: number;
  maxHeight?: number;
  maxFrameRate?: number;
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false };
  }

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) return { ok: false };

    const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
    const settings = typeof track.getSettings === 'function' ? track.getSettings() : null;

    const maxWidth =
      (caps && typeof caps.width?.max === 'number' ? caps.width.max : undefined) ??
      (settings && typeof settings.width === 'number' ? settings.width : undefined);
    const maxHeight =
      (caps && typeof caps.height?.max === 'number' ? caps.height.max : undefined) ??
      (settings && typeof settings.height === 'number' ? settings.height : undefined);
    const maxFrameRate =
      (caps && typeof caps.frameRate?.max === 'number' ? Math.round(caps.frameRate.max) : undefined) ??
      (settings && typeof settings.frameRate === 'number' ? Math.round(settings.frameRate) : undefined);

    return {
      ok: true,
      maxWidth,
      maxHeight,
      maxFrameRate,
    };
  } catch {
    return { ok: false };
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}
