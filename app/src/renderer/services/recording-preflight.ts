import type { DeviceDefaults } from "../../shared/types";
import { microphoneSlots } from "../../shared/audio-tracks";
import { getDeviceAssignmentConflicts } from "../../shared/device-config";
import { assertMicrophoneInputAvailable, getAudioStreamDiagnostics } from "../plugins/audio/studio-audio";
import type { DeviceService } from "./device-service";

/** Checks real streams and driver-visible channels, not just saved device names. */
export async function checkRecordingInputs(defaults: DeviceDefaults, devices: Pick<DeviceService, "openCameraPreview" | "openMicrophoneStream" | "releaseStream">) {
  const conflicts = getDeviceAssignmentConflicts(defaults);
  if (conflicts.length > 0) throw new Error("Choose a separate physical input for each assigned microphone channel.");
  if (!defaults.cameras.camera1 || !defaults.microphones.morganMic) throw new Error("Choose a main camera and microphone before recording.");
  const streams: Array<{ kind: "camera" | "microphone"; id: string; stream: MediaStream }> = [];
  const checks = [
    ...Object.entries(defaults.cameras).filter((entry): entry is [string, string] => Boolean(entry[1])).map(async ([slot, id]) => {
      const stream = await devices.openCameraPreview(id);
      streams.push({ kind: "camera", id, stream });
      if (!stream.getVideoTracks().some((track) => track.readyState === "live")) throw new Error(`${slot} has no live video track.`);
    }),
    ...[...new Set(Object.values(defaults.microphones).filter((id): id is string => Boolean(id)))].map(async (id) => {
      const stream = await devices.openMicrophoneStream(id);
      streams.push({ kind: "microphone", id, stream });
      if (!stream.getAudioTracks().some((track) => track.readyState === "live")) throw new Error("An assigned microphone has no live audio track.");
      const diagnostics = getAudioStreamDiagnostics(stream);
      for (const { key, label } of microphoneSlots.filter(({ key }) => defaults.microphones[key] === id)) {
        const channel = defaults.microphoneChannels?.[key] ?? "mix";
        if (channel !== "mix" && diagnostics.channelCount === undefined) throw new Error(`${label}: this driver did not report its active input count. Choose Mix or a driver that exposes numbered inputs.`);
        try { assertMicrophoneInputAvailable(channel, diagnostics.channelCount); }
        catch (error) { throw new Error(`${label}: ${String(error).replace(/^Error: /, "")}`, { cause: error }); }
      }
    })
  ];
  try {
    // Settle every opener before releasing: a failed channel must not leak another late stream.
    const results = await Promise.allSettled(checks);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  } finally {
    for (const { kind, id, stream } of streams) devices.releaseStream(kind, id, stream);
  }
}
