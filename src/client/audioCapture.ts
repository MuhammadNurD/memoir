const DEVICE_STORAGE_KEY = "memoir.audioInputDeviceId";

export type AudioInputDevice = {
  deviceId: string;
  groupId: string;
  label: string;
};

export function readStoredAudioInputDeviceId(): string | null {
  try {
    const value = localStorage.getItem(DEVICE_STORAGE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function storeAudioInputDeviceId(deviceId: string): void {
  try {
    localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
  } catch {
    // ignore quota / private-mode failures
  }
}

export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device, index) => ({
      deviceId: device.deviceId,
      groupId: device.groupId,
      label: device.label?.trim() || `Microphone ${index + 1}`,
    }));
}

function audioConstraints(deviceId?: string | null): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  if (deviceId) {
    base.deviceId = { exact: deviceId };
  }
  return base;
}

export async function getAudioInputStream(deviceId?: string | null): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Live audio recording is not supported in this browser.");
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints(deviceId),
      video: false,
    });
  } catch (error) {
    if (deviceId) {
      return navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(null),
        video: false,
      });
    }
    throw error;
  }
}

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore
    }
  }
}

export type InputMeter = {
  sampleRms: () => number;
  sampleBins: (barCount: number) => number[];
  close: () => Promise<void>;
};

export function createInputMeter(stream: MediaStream): InputMeter {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();
  void context.resume();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.72;
  source.connect(analyser);

  const timeDomain = new Uint8Array(analyser.fftSize);
  const frequency = new Uint8Array(analyser.frequencyBinCount);

  return {
    sampleRms() {
      analyser.getByteTimeDomainData(timeDomain);
      let sum = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        const centered = (timeDomain[i] - 128) / 128;
        sum += centered * centered;
      }
      return Math.sqrt(sum / timeDomain.length);
    },
    sampleBins(barCount: number) {
      analyser.getByteFrequencyData(frequency);
      const bins = new Array<number>(barCount).fill(0);
      const slice = Math.max(1, Math.floor(frequency.length / barCount));
      for (let i = 0; i < barCount; i++) {
        let total = 0;
        const start = i * slice;
        for (let j = 0; j < slice && start + j < frequency.length; j++) {
          total += frequency[start + j];
        }
        bins[i] = total / slice / 255;
      }
      return bins;
    },
    async close() {
      source.disconnect();
      analyser.disconnect();
      if (context.state !== "closed") {
        await context.close().catch(() => undefined);
      }
    },
  };
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp4") || mimeType.includes("m4a") || mimeType.includes("aac")) {
    return "m4a";
  }
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}
