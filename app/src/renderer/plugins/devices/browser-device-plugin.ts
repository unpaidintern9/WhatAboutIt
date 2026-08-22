import type { DeviceDetectionResult, DevicePlugin, StudioDevice, StudioDeviceKind } from "./types";
import { cameraProviders } from "../cameras/camera-provider-registry";
import { createCenteredMonoStream, createStudioAudioContext, openAudioStreamWithFallback, stopStudioMediaStream } from "../audio/studio-audio";

let lastLoggedDeviceSnapshot = "";
const DEVICE_ENUMERATION_TIMEOUT_MS = 8000;
const CAMERA_PREVIEW_TIMEOUT_MS = 10000;

function withMediaOperationTimeout<T>(operation: Promise<T>, timeoutMs: number, timeoutError: Error, onLateResolve?: (value: T) => void) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      reject(timeoutError);
    }, timeoutMs);

    operation.then(
      (value) => {
        if (settled) {
          onLateResolve?.(value);
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

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
  if (!device.label) return fallback;
  if (device.kind === "audioinput" && /usb\s+audio\s+codec/i.test(device.label)) {
    return `USB Audio Interface (${device.label.replace(/\s+/g, " ").trim()})`;
  }
  return device.label;
}

function toStudioDevice(device: MediaDeviceInfo, kind: StudioDeviceKind, index: number): StudioDevice {
  const fallbackName = kind === "camera" ? `Camera ${index + 1}` : kind === "microphone" ? `Microphone ${index + 1}` : `Speaker ${index + 1}`;

  return {
    id: device.deviceId,
    label: friendlyDeviceLabel(device, fallbackName),
    rawLabel: device.label || undefined,
    groupId: device.groupId || undefined,
    kind,
    isDefault: device.deviceId === "default",
    audio: kind === "microphone" || kind === "speaker"
      ? { interfaceLike: /usb|m-audio|m-track|audio.?box|interface|codec/i.test(device.label) }
      : undefined,
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

function disambiguateCameraLabels(devices: StudioDevice[]) {
  const totals = new Map<string, number>();
  for (const device of devices) totals.set(device.label, (totals.get(device.label) ?? 0) + 1);
  const indexes = new Map<string, number>();

  return devices.map((device) => {
    if ((totals.get(device.label) ?? 0) < 2) return device;
    const instance = (indexes.get(device.label) ?? 0) + 1;
    indexes.set(device.label, instance);
    return { ...device, label: `${device.label} ${instance}` };
  });
}

async function discoverProviderCameras() {
  // Browser cameras are already enumerated above. Calling enumerateDevices twice
  // during the same refresh can return two different snapshots while Windows is
  // still bringing a USB endpoint online, which makes cameras flicker in and out.
  const supplementalProviders = cameraProviders.filter((provider) => provider.id !== "local-browser-cameras");
  const settled = await Promise.allSettled(supplementalProviders.map(async (provider) => ({ providerId: provider.id, cameras: await provider.discover() })));
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
    const devices = await withMediaOperationTimeout(
      navigator.mediaDevices.enumerateDevices(),
      DEVICE_ENUMERATION_TIMEOUT_MS,
      new DOMException("Windows camera service did not respond within 8 seconds", "TimeoutError")
    );
    const enumeratedCameras = devices.filter((device) => device.kind === "videoinput").map((device, index) => toStudioDevice(device, "camera", index));
    const providerCameras = await discoverProviderCameras();
    const cameras = disambiguateCameraLabels(mergeDevices([...enumeratedCameras, ...providerCameras]));
    const microphones = devices.filter((device) => device.kind === "audioinput").map((device, index) => toStudioDevice(device, "microphone", index));
    const speakers = devices.filter((device) => device.kind === "audiooutput").map((device, index) => toStudioDevice(device, "speaker", index));
    // Audio output labels may stay hidden on Windows even after camera and mic
    // access is granted. Only capture inputs should hold Studio Setup in the
    // permission-needed state.
    const permissionNeeded = devices.some((device) => (device.kind === "videoinput" || device.kind === "audioinput") && !device.label);

    logDeviceDebug("enumerateDevices", {
      permissionNeeded,
      rawDevices: devices.map((device) => ({ kind: device.kind, label: device.label || "(hidden)", deviceId: device.deviceId ? "present" : "missing" })),
      cameras: cameras.map((camera) => ({ id: camera.id ? "present" : "missing", label: camera.label, kind: camera.kind })),
      microphones: microphones.map((microphone) => ({ id: microphone.id ? "present" : "missing", label: microphone.label, kind: microphone.kind })),
      speakers: speakers.map((speaker) => ({ id: speaker.id ? "present" : "missing", label: speaker.label, kind: speaker.kind }))
    });
    const runtimeDetails = {
      permissionNeeded,
      cameras: cameras.map((camera) => ({ id: camera.id, label: camera.label })),
      microphones: microphones.map((microphone) => ({ id: microphone.id, label: microphone.label })),
      speakers: speakers.map((speaker) => ({ id: speaker.id, label: speaker.label }))
    };
    const snapshot = JSON.stringify(runtimeDetails);
    if (snapshot !== lastLoggedDeviceSnapshot) {
      lastLoggedDeviceSnapshot = snapshot;
      void window.studio?.writeRuntimeLog?.({
        level: "info",
        source: "DeviceDiscovery",
        message: "Windows media devices changed.",
        details: runtimeDetails
      }).catch(() => undefined);
    }

    return {
      cameras,
      microphones,
      speakers,
      permissionNeeded,
      errorMessage: permissionNeeded
        ? "Windows is hiding one or more camera or microphone names. Allow camera and microphone access, then check again."
        : undefined
    };
  } catch (error) {
    logDeviceDebug("enumerateDevices failed", String(error));
    const message = String(error);
    const timedOut = message.includes("TimeoutError") || message.includes("did not respond within 8 seconds");
    const permissionBlocked = /NotAllowedError|PermissionDeniedError|permission denied/i.test(message);
    void window.studio?.writeRuntimeLog?.({
      level: "warning",
      source: "DeviceDiscovery",
      message: timedOut ? "Windows media device discovery timed out." : "Windows media device discovery failed.",
      details: { error: message }
    }).catch(() => undefined);
    return {
      cameras: [],
      microphones: [],
      speakers: [],
      permissionNeeded: permissionBlocked,
      errorMessage: timedOut
        ? "Windows camera service stopped responding. Close camera apps or reconnect the USB cameras, then refresh cameras."
        : permissionBlocked
          ? "Windows blocked camera or microphone access. Open Privacy & security settings, allow desktop apps, then try again."
          : "Windows could not list cameras or microphones. Reconnect the devices, then try again."
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
    const failures: unknown[] = [];
    const before = await enumerateStudioDevices();

    // Once Windows exposes labeled inputs, permission has already been granted.
    // Opening and immediately stopping a USB camera here races the live preview
    // owners and can reset other identical UVC endpoints on the same hub.
    if (!before.permissionNeeded) return before;

    // A busy Sony endpoint can be Windows' default camera. Try every enumerated
    // camera independently so that a busy Sony body cannot hide the laptop camera
    // or prevent Chromium from granting camera access at all.
    let cameraGranted = false;
    const cameraIds = [...new Set(before.cameras.map((camera) => camera.id).filter(Boolean))];
    for (const deviceId of cameraIds) {
      try {
        streams.push(await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: false
        }));
        cameraGranted = true;
        logDeviceDebug("camera permission request", { status: "granted", deviceId: "present" });
        break;
      } catch (error) {
        failures.push(error);
        logDeviceDebug("camera permission request failed", String(error));
      }
    }
    if (!cameraGranted) {
      try {
        streams.push(await navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
        cameraGranted = true;
        logDeviceDebug("default camera permission request", "granted");
      } catch (error) {
        failures.push(error);
        logDeviceDebug("default camera permission request failed", String(error));
      }
    }

    let microphoneGranted = false;
    try {
      streams.push(await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
      microphoneGranted = true;
      logDeviceDebug("microphone permission request", "granted");
    } catch (error) {
      failures.push(error);
      logDeviceDebug("microphone permission request failed", String(error));
    }

    await Promise.all(streams.map((stream) => stopStream(stream)));
    const detected = await enumerateStudioDevices();
    if (cameraGranted && microphoneGranted && !detected.permissionNeeded) return detected;

    const permissionBlocked = failures.some((error) => /NotAllowedError|PermissionDeniedError|permission denied/i.test(String(error)));
    const unavailable = [
      !cameraGranted ? "camera" : undefined,
      !microphoneGranted ? "microphone" : undefined
    ].filter((kind): kind is string => Boolean(kind)).join(" and ");
    return {
      ...detected,
      permissionNeeded: detected.permissionNeeded || permissionBlocked,
      errorMessage: permissionBlocked
        ? `Windows blocked ${unavailable || "camera or microphone"} access. Open Windows Settings > Privacy & security, allow access for desktop apps, then check again.`
        : unavailable
          ? `The ${unavailable} could not be opened. Close Camera, Teams, Zoom, Imaging Edge, and browser tabs using it, then check again.`
          : detected.errorMessage
    };
  },

  async sampleMicrophoneLevel(deviceId?: string) {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) return 0;

    const rawStream = await openBrowserAudioStream(deviceId);
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
    const attempts: MediaTrackConstraints[] = [
      {
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 }
      },
      {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      },
      { deviceId: { exact: deviceId } }
    ];
    let lastError: unknown;
    for (const video of attempts) {
      try {
        return await withMediaOperationTimeout(
          navigator.mediaDevices.getUserMedia({ video, audio: false }),
          CAMERA_PREVIEW_TIMEOUT_MS,
          new DOMException("Windows camera service did not open this camera within 10 seconds", "NotReadableError"),
          stopStudioMediaStream
        );
      } catch (error) {
        lastError = error;
        if (!/OverconstrainedError|ConstraintNotSatisfiedError|AbortError/i.test(String(error))) break;
      }
    }
    throw lastError;
  },

  async openMicrophoneStream(deviceId?: string) {
    if (!navigator.mediaDevices?.getUserMedia || !deviceId) throw new Error("Mic needs attention");
    return openBrowserAudioStream(deviceId);
  }
};

function openBrowserAudioStream(deviceId?: string) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Mic needs attention");
  return openAudioStreamWithFallback(
    (audio) => navigator.mediaDevices.getUserMedia({ audio, video: false }),
    deviceId
  );
}
