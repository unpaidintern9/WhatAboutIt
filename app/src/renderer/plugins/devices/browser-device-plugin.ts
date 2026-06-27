import type { DeviceDetectionResult, DevicePlugin, StudioDevice, StudioDeviceKind } from "./types";

function friendlyDeviceLabel(device: MediaDeviceInfo, fallback: string) {
  return device.label || fallback;
}

function toStudioDevice(device: MediaDeviceInfo, kind: StudioDeviceKind, index: number): StudioDevice {
  const fallbackName = kind === "camera" ? `Camera ${index + 1}` : kind === "microphone" ? `Microphone ${index + 1}` : `Speaker ${index + 1}`;

  return {
    id: device.deviceId,
    label: friendlyDeviceLabel(device, fallbackName),
    kind,
    isDefault: device.deviceId === "default",
    camera:
      kind === "camera"
        ? {
            connectionType: index === 0 ? "built-in" : "usb",
            signal: "unknown",
            autoReconnect: true,
            maxResolution: "Auto",
            maxFps: 30
          }
        : undefined
  };
}

async function enumerateStudioDevices(): Promise<DeviceDetectionResult> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return {
      cameras: [],
      microphones: [],
      speakers: [],
      permissionNeeded: true,
      errorMessage: "Permission needed"
    };
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput").map((device, index) => toStudioDevice(device, "camera", index));
    const microphones = devices.filter((device) => device.kind === "audioinput").map((device, index) => toStudioDevice(device, "microphone", index));
    const speakers = devices.filter((device) => device.kind === "audiooutput").map((device, index) => toStudioDevice(device, "speaker", index));
    const permissionNeeded = devices.some((device) => !device.label);

    return { cameras, microphones, speakers, permissionNeeded };
  } catch {
    return {
      cameras: [],
      microphones: [],
      speakers: [],
      permissionNeeded: true,
      errorMessage: "Permission needed"
    };
  }
}

async function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

export const browserDevicePlugin: DevicePlugin = {
  detectDevices: enumerateStudioDevices,

  async requestStudioPermissions() {
    if (!navigator.mediaDevices?.getUserMedia) return enumerateStudioDevices();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      await stopStream(stream);
    } catch {
      return {
        ...(await enumerateStudioDevices()),
        permissionNeeded: true,
        errorMessage: "Permission needed"
      };
    }

    return enumerateStudioDevices();
  },

  async sampleMicrophoneLevel(deviceId?: string) {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) return 0;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false
    });

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    const samples = new Uint8Array(analyser.frequencyBinCount);

    source.connect(analyser);
    analyser.getByteTimeDomainData(samples);

    const level =
      samples.reduce((total, sample) => total + Math.abs(sample - 128), 0) / Math.max(samples.length, 1);

    await stopStream(stream);
    await audioContext.close();

    return Math.min(100, Math.round(level * 3));
  },

  async playTestSound(_deviceId?: string) {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.frequency.value = 440;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.25);

    await new Promise((resolve) => window.setTimeout(resolve, 320));
    await audioContext.close();
  }
};
