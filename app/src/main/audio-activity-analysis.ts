import fs from "node:fs/promises";
import path from "node:path";
import type { AutoEditActivitySegment } from "../shared/auto-edit";
import type { CameraSlotKey, MicrophoneSlotKey } from "../shared/types";
import { runFfmpeg } from "./ffmpeg-tools";

const cameraTrackIds: Record<CameraSlotKey, string> = {
  camera1: "camera-camera1",
  camera2: "camera-camera2",
  camera3: "camera-camera3"
};
const microphoneTrackIds: Record<MicrophoneSlotKey, string> = {
  morganMic: "mic-morganMic",
  guestMic: "mic-guestMic",
  extraMic: "mic-extraMic"
};
const microphoneFiles: Record<MicrophoneSlotKey, string> = {
  morganMic: "morgan-mic.m4a",
  guestMic: "guest-mic.m4a",
  extraMic: "extra-mic.m4a"
};

interface DeviceMapFile {
  cameraMicrophones?: Partial<Record<CameraSlotKey, MicrophoneSlotKey>>;
}

interface ActivitySource {
  cameraTrackId: string;
  microphoneTrackId: string;
  filePath: string;
}

export async function analyzeEpisodeAudioActivity(episodeFolder: string): Promise<AutoEditActivitySegment[]> {
  const routes = await loadRoutes(episodeFolder);
  const sources: ActivitySource[] = [];
  for (const cameraSlot of ["camera1", "camera2", "camera3"] as CameraSlotKey[]) {
    const microphoneSlot = routes[cameraSlot];
    if (!microphoneSlot) continue;
    const filePath = path.join(episodeFolder, "Audio", microphoneFiles[microphoneSlot]);
    try {
      await fs.access(filePath);
      sources.push({
        cameraTrackId: cameraTrackIds[cameraSlot],
        microphoneTrackId: microphoneTrackIds[microphoneSlot],
        filePath
      });
    } catch {
      // Auto Edit only makes a camera claim when the routed mic was actually saved.
    }
  }
  if (sources.length === 0) return [];

  const readings = await Promise.all(sources.map(async (source) => {
    const result = await runFfmpeg([
      "-loglevel", "verbose", "-nostats", "-i", source.filePath,
      "-filter:a", "ebur128=framelog=verbose", "-f", "null", "-"
    ]);
    return { source, levels: parseEbur128Levels(result.stderr) };
  }));
  return deriveActivitySegments(readings);
}

export function parseEbur128Levels(output: string) {
  const levels: Array<{ timestampMs: number; db: number }> = [];
  const pattern = /\bt:\s*([\d.]+).*?\bM:\s*(-?[\d.]+)/g;
  for (const match of output.matchAll(pattern)) {
    const seconds = Number(match[1]);
    const db = Number(match[2]);
    if (Number.isFinite(seconds) && Number.isFinite(db)) levels.push({ timestampMs: Math.round(seconds * 1000), db });
  }
  return levels;
}

export function deriveActivitySegments(
  readings: Array<{ source: Pick<ActivitySource, "cameraTrackId" | "microphoneTrackId">; levels: Array<{ timestampMs: number; db: number }> }>,
  bucketMs = 1000
): AutoEditActivitySegment[] {
  const buckets = new Map<number, Array<{ source: ActivitySource; db: number }>>();
  for (const reading of readings) {
    const grouped = new Map<number, number[]>();
    for (const level of reading.levels) {
      const bucket = Math.floor(level.timestampMs / bucketMs) * bucketMs;
      grouped.set(bucket, [...(grouped.get(bucket) ?? []), level.db]);
    }
    for (const [bucket, values] of grouped) {
      const db = values.reduce((sum, value) => sum + value, 0) / values.length;
      buckets.set(bucket, [...(buckets.get(bucket) ?? []), { source: { ...reading.source, filePath: "" }, db }]);
    }
  }

  const winners = [...buckets.entries()].sort(([a], [b]) => a - b).flatMap(([startMs, candidates]) => {
    const winner = [...candidates].sort((a, b) => b.db - a.db)[0];
    return winner && winner.db > -55 ? [{ startMs, ...winner }] : [];
  });
  if (winners.length === 0) return [];

  const segments: AutoEditActivitySegment[] = [];
  let active = winners[0];
  let activeStart = active.startMs;
  for (let index = 1; index < winners.length; index += 1) {
    const current = winners[index];
    const next = winners[index + 1];
    const sustainedSwitch = current.source.cameraTrackId !== active.source.cameraTrackId
      && next?.source.cameraTrackId === current.source.cameraTrackId;
    if (!sustainedSwitch) continue;
    segments.push({
      startMs: activeStart,
      endMs: current.startMs,
      cameraTrackId: active.source.cameraTrackId,
      microphoneTrackId: active.source.microphoneTrackId,
      averageDb: active.db
    });
    active = current;
    activeStart = current.startMs;
  }
  const last = winners.at(-1)!;
  segments.push({
    startMs: activeStart,
    endMs: last.startMs + bucketMs,
    cameraTrackId: active.source.cameraTrackId,
    microphoneTrackId: active.source.microphoneTrackId,
    averageDb: active.db
  });
  return segments;
}

async function loadRoutes(episodeFolder: string): Promise<Partial<Record<CameraSlotKey, MicrophoneSlotKey>>> {
  try {
    const deviceMap = JSON.parse(await fs.readFile(path.join(episodeFolder, "Session", "device-map.json"), "utf8")) as DeviceMapFile;
    return deviceMap.cameraMicrophones ?? {};
  } catch {
    return {};
  }
}
