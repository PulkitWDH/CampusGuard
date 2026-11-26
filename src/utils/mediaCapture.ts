import type { IncidentAlert } from '../types';

export function captureCanvasJpegBase64(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

export function playAlertChime(): void {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.setValueAtTime(660, now + 0.16);
    gain1.gain.setValueAtTime(0.14, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.38);
  } catch {
    // Ignore autoplay audio restrictions when user hasn't interacted
  }
}

export function sendBrowserNotification(alert: IncidentAlert): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    new Notification(`CampusGuard Alert: ${alert.classroomName}`, {
      body: `${alert.headline} (${alert.studentCount} kids present). Voice: ${alert.voiceCue}`,
      tag: alert.cameraId,
    });
  } catch {
    // Ignore notification errors in restricted contexts
  }
}

export async function openRawMediaStream(options: {
  includeVideo?: boolean;
  videoDeviceId?: string;
  audioDeviceId?: string;
}): Promise<MediaStream> {
  const { includeVideo = true, videoDeviceId, audioDeviceId } = options;
  const exactVideo: MediaTrackConstraints | boolean = includeVideo
    ? videoDeviceId
      ? { deviceId: { exact: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } }
    : false;

  const rawAudioConstraint: MediaTrackConstraints = {
    ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
  };

  // Attempt 1: Exact device + raw unattenuated audio
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: exactVideo,
      audio: rawAudioConstraint,
    });
  } catch {
    // Attempt 2: Relaxed ideal deviceId (handles stale device IDs across different devices/browsers)
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: includeVideo
          ? videoDeviceId
            ? { deviceId: { ideal: videoDeviceId } }
            : true
          : false,
        audio: audioDeviceId ? { deviceId: { ideal: audioDeviceId } } : true,
      });
    } catch (err) {
      // Attempt 3: Video-only fallback if device has no microphone or mic permission is denied/busy
      if (includeVideo) {
        return await navigator.mediaDevices.getUserMedia({
          video: videoDeviceId ? { deviceId: { ideal: videoDeviceId } } : true,
          audio: false,
        });
      }
      throw err;
    }
  }
}


