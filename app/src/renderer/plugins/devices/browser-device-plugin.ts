import type { DeviceDetectionResult, DevicePlugin, StudioDevice, StudioDeviceKind } from "./types";
import { cameraProviders } from "../cameras/camera-provider-registry";
import { createCenteredMonoStream, createStudioAudioContext, highQualityAudioConstraint, stopStudioMediaStream } from "../audio/studio-audio";

function deviceDebugEnabled() {
  try {
    return window.localStorage.getItem("waiDeviceDebug") === "1";
  } catch {
    return false;
  }
}

function logDeviceDebug(label: string, details: unknown) {
  if (!deviceDebugEnabled()) return;
  console.info(`[DeviceDiscovery] ${label}`, details);
}

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

function mergeDevices(devices: StudioDevice[]) {
  const seen = new Set<string>();
  return devices.filter((device) => {
    const key = `${device.kind}:${device.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function discoverProviderCameras() {
  const settled = await Promise.allSettled(cameraProviders.map(async (provider) => ({ providerId: provider.id, cameras: await provider.discover() })));
  const providerResults = settled.map((result) =>
    result.status === "fulfilled" ? result.value : { providerId: "unknown", cameras: [] as StudioDevice[], error: String(result.reason) }
  );

  logDeviceDebug("camera provider registry", providerResults.map((result) => ({
    providerId: result.providerId,
    cameras: result.cameras.map((camera) => ({ id: camera.id ? "present" : "missing", label: camera.label }))
  })));

  return providerResults.flatMap((result) => result.cameras);
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
    const enumeratedCameras = devices.filter((device) => device.kind === "videoinput").map((device, index) => toStudioDevice(device, "camera", index));
    const providerCameras = await discoverProviderCameras();
    const cameras = mergeDevices([...enumeratedCameras, ...providerCameras]);
    const microphones = devices.filter((device) => device.kind === "audioinput").map((device, index) => toStudioDevice(device, "microphone", index));
    const speakers = devices.filter((device) => device.kind === "audiooutput").map((device, index) => toStudioDevice(device, "speaker", index));
    const permissionNeeded = devices.some((device) => !device.label);

    logDeviceDebug("enumerateDevices", {
      permissionNeeded,
      rawDevices: devices.map((device) => ({ kind: device.kind, label: device.label || "(hidden)", deviceId: device.deviceId ? "present" : "missing" })),
      cameras: cameras.map((camera) => ({ id: camera.id ? "present" : "missing", label: camera.label, kind: camera.kind })),
      microphones: microphones.map((microphone) => ({ id: microphone.id ? "present" : "missing", label: microphone.label, kind: microphone.kind })),
      speakers: speakers.map((speaker) => ({ id: speaker.id ? "present" : "missing", label: speaker.label, kind: speaker.kind }))
    });

    return { cameras, microphones, speakers, permissionNeeded };
  } catch (error) {
    logDeviceDebug("enumerateDevices failed", String(error));
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
  stopStudioMediaStream(stream);
}

export const browserDevicePlugin: DevicePlugin = {
  detectDevices: enumerateStudioDevices,

  async requestStudioPermissions() {
    if (!navigator.mediaDevices?.getUserMedia) return enumerateStudioDevices();

    const streams: MediaStream[] = [];
    let grantedAny = false;

    try {
      streams.push(await navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      grantedAny = true;
      logDeviceDebug("camera permission request", "granted");
    } catch (error) {
      logDeviceDebug("camera permission request failed", String(error));
      // Keep going. A busy camera should not hide microphones or already enumerated devices.
    }

    try {
      streams.push(await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
      grantedAny = true;
      logDeviceDebug("microphone permission request", "granted");
    } catch (error) {
      logDeviceDebug("microphone permission request failed", String(error));
      // Keep going. A missing or muted mic should not hide cameras from setup.
    }

    await Promise.all(streams.map((stream) => stopStream(stream)));

    if (!grantedAny) {
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

    const rawStream = await navigator.mediaDevices.getUserMedia({
      audio: highQualityAudioConstraint(deviceId),
      video: false
    });
    const stream = createCenteredMonoStream(rawStream);

    const audioContext = createStudioAudioContext();
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

  async playTestSound(deviceId?: string) {
    const audioContext = createStudioAudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();
    const audio = new Audio();
    const sinkableAudio = audio as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };

    oscillator.frequency.value = 440;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(destination);
    audio.srcObject = destination.stream;
    if (deviceId && sinkableAudio.setSinkId) await sinkableAudio.setSinkId(deviceId);
    await audio.play();
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.25);

    await new Promise((resolve) => window.setTimeout(resolve, 320));
    audio.pause();
    destination.stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();
  },

  async openCameraPreview(deviceId?: string) {
    if (!navigator.mediaDevices?.getUserMedia || !deviceId) throw new Error("Camera needs attention");
    return navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false
    });
  },

  async openMicrophoneStream(deviceId?: string) {
    if (!navigator.mediaDevices?.getUserMedia || !deviceId) throw new Error("Mic needs attention");
    return navigator.mediaDevices.getUserMedia({
      audio: highQualityAudioConstraint(deviceId),
      video: false
    });
  }
};
