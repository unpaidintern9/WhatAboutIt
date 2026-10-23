import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RecordingFinalizeResult, RecordingSession, RecordingTrackSlot, SyncMetadata } from "../shared/recording";
import type { DeviceDefaults } from "../shared/types";
import { createDeviceMap, createSyncMetadata, requiredRecordingSessionFolders } from "../shared/recording";
import { getMediaDurationMs, runFfmpeg, runFfprobe, validatePlayableMedia } from "./ffmpeg-tools";

interface RecordingPart {
  folder: string;
  durationMs?: number;
  result?: RecordingFinalizeResult;
}
interface RecordingParts { version: 1; sessionId: string; parts: RecordingPart[]; abandonedEmptyParts?: string[] }
const operations = new Map<string, Promise<unknown>>();

export async function withRecordingOperation<T>(folder: string, operation: () => Promise<T>): Promise<T> {
  const prior = operations.get(folder) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(operation);
  operations.set(folder, current);
  try { return await current; } finally { if (operations.get(folder) === current) operations.delete(folder); }
}

export async function readRecordingJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}
export async function writeRecordingJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(data, null, 2)); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}
const journalPath = (folder: string) => path.join(folder, "Session", "recording-parts.json");
export const recordingSessionPath = (folder: string) => path.join(folder, "Session", "recording-session.json");

function partPath(folder: string, part: RecordingPart) {
  const resolved = path.resolve(folder, part.folder);
  if (!resolved.startsWith(`${path.resolve(folder, "Recordings")}${path.sep}`)) throw new Error("Invalid recording part folder.");
  return resolved;
}

export async function allocateRecordingPart(folder: string, session: RecordingSession, defaults: DeviceDefaults, resume = false) {
  let journal: RecordingParts = { version: 1, sessionId: session.id, parts: [] };
  if (resume) {
    journal = await readRecordingJson<RecordingParts>(journalPath(folder));
    if (journal.sessionId !== session.id || journal.parts.length === 0 || journal.parts.some((part) => !part.result?.integrity.programPlayable)) {
      throw new Error("Recover the unfinished recording before resuming it.");
    }
    // Verify every saved Program before allowing a new capture to begin.
    for (const part of journal.parts) if (!(await validatePlayableMedia(path.join(partPath(folder, part), "Program", "program.webm"), undefined, { video: true, audio: true }))) throw new Error("A saved recording part needs recovery.");
  }
  const part: RecordingPart = { folder: path.join("Recordings", `part-${String(journal.parts.length + 1).padStart(4, "0")}-${randomUUID().slice(0, 8)}`) };
  const captureFolderPath = partPath(folder, part);
  await Promise.all(requiredRecordingSessionFolders.map((name) => fs.mkdir(path.join(captureFolderPath, name), { recursive: true })));
  const next: RecordingSession = { ...session, folderPath: folder, captureFolderPath, durablePaused: false, status: "recording", elapsedMs: journal.parts.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) };
  await writeRecordingJson(recordingSessionPath(captureFolderPath), { ...next, folderPath: captureFolderPath });
  await writeRecordingJson(path.join(captureFolderPath, "Session", "device-map.json"), createDeviceMap(defaults));
  await writeRecordingJson(path.join(captureFolderPath, "Session", "sync-metadata.json"), createSyncMetadata(defaults));
  await fs.writeFile(path.join(captureFolderPath, "Logs", "errors.log"), "");
  await writeRecordingJson(journalPath(folder), { ...journal, parts: [...journal.parts, part] });
  await writeRecordingJson(recordingSessionPath(folder), next);
  await writeRecordingJson(path.join(folder, "Session", "recording-state.json"), { sessionId: session.id, status: "recording", elapsedMs: next.elapsedMs, updatedAt: new Date().toISOString(), lastSavedAt: new Date().toISOString() });
  return next;
}

export async function readActiveRecordingPart(folder: string) {
  const session = await readRecordingJson<RecordingSession>(recordingSessionPath(folder));
  const journal = await readRecordingJson<RecordingParts>(journalPath(folder));
  if (journal.sessionId !== session.id || !journal.parts.length) throw new Error("Recording parts do not match this episode.");
  const part = journal.parts.at(-1)!;
  return { session, journal, part, captureFolder: partPath(folder, part) };
}

export async function saveCompletedRecordingPart(folder: string, result: RecordingFinalizeResult) {
  const { journal, part, captureFolder } = await readActiveRecordingPart(folder);
  if (!result.integrity.programPlayable || !result.programPath) throw new Error("Recording part needs recovery before it can be saved or resumed.");
  part.durationMs = await getMediaDurationMs(path.join(captureFolder, "Program", "program.webm"));
  if (!part.durationMs) throw new Error("Recording part has no playable duration.");
  part.result = result;
  await writeRecordingJson(journalPath(folder), journal);
}

export async function retainEmptyRecordingAttempt(folder: string) {
  const { journal, part, captureFolder } = await readActiveRecordingPart(folder);
  if (part.result || journal.parts.length < 2) return;
  for (const group of ["Program", "Cameras", "Audio"]) {
    for (const entry of await fs.readdir(path.join(captureFolder, group), { withFileTypes: true })) {
      if (entry.isFile() && (await fs.stat(path.join(captureFolder, group, entry.name))).size > 0) return;
    }
  }
  // A failed device reopen may allocate a part without writing any media.
  // Preserve its folder for diagnosis and return to the last durable checkpoint.
  journal.parts.pop();
  journal.abandonedEmptyParts = [...(journal.abandonedEmptyParts ?? []), part.folder];
  await writeRecordingJson(journalPath(folder), journal);
}

const targetPaths: Array<{ slot: "program" | RecordingTrackSlot; file: string; video: boolean }> = [
  { slot: "program", file: "Program/program.webm", video: true },
  ...([1, 2, 3] as const).map((number) => ({ slot: `camera${number}` as RecordingTrackSlot, file: `Cameras/camera-${number}.webm`, video: true })),
  ...(["morgan", "guest", "extra"] as const).map((name) => ({ slot: `${name}Mic` as RecordingTrackSlot, file: `Audio/${name}-mic.m4a`, video: false }))
];

interface StreamInfo { codec_type: string; width?: number; height?: number; r_frame_rate?: string; channels?: number }
async function assembleTarget(folder: string, parts: RecordingPart[], target: typeof targetPaths[number], output: string) {
  const inputs = parts.map((part) => path.join(partPath(folder, part), target.file));
  if (parts.length === 1) { await fs.copyFile(inputs[0], output); return; }
  const streams: StreamInfo[][] = [];
  for (const file of inputs) streams.push(JSON.parse((await runFfprobe(["-v", "error", "-show_streams", "-of", "json", file])).stdout).streams);
  const video = streams[0].find((stream) => stream.codec_type === "video");
  const includeAudio = streams.every((list) => list.some((stream) => stream.codec_type === "audio"));
  const channels = streams[0].find((stream) => stream.codec_type === "audio")?.channels ?? 1;
  const filters: string[] = [];
  for (const [index, part] of parts.entries()) {
    const seconds = (part.durationMs ?? 0) / 1000;
    const sync = await readRecordingJson<SyncMetadata>(path.join(partPath(folder, part), "Session", "sync-metadata.json"));
    const offset = target.slot === "program" ? 0 : (sync.sourceStartOffsetsMs?.[target.slot] ?? 0) / 1000;
    if (video) filters.push(`[${index}:v]trim=start=${Math.max(0, offset)},setpts=PTS-STARTPTS,scale=${video.width}:${video.height}:force_original_aspect_ratio=decrease,pad=${video.width}:${video.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${video.r_frame_rate || "30"},tpad=start_mode=clone:start_duration=${Math.max(0, -offset)}:stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds},setpts=PTS-STARTPTS[v${index}]`);
    if (includeAudio) filters.push(`[${index}:a]atrim=start=${Math.max(0, offset)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=${channels === 1 ? "mono" : "stereo"},${offset < 0 ? `adelay=${Array.from({ length: channels === 1 ? 1 : 2 }, () => Math.round(-offset * 1000)).join("|")},` : ""}apad,atrim=duration=${seconds},asetpts=PTS-STARTPTS[a${index}]`);
  }
  filters.push(`${parts.map((_, index) => `${video ? `[v${index}]` : ""}${includeAudio ? `[a${index}]` : ""}`).join("")}concat=n=${parts.length}:v=${video ? 1 : 0}:a=${includeAudio ? 1 : 0}${video ? "[v]" : ""}${includeAudio ? "[a]" : ""}`);
  await runFfmpeg(["-y", ...inputs.flatMap((file) => ["-i", file]), "-filter_complex", filters.join(";"), ...(video ? ["-map", "[v]", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "4", "-b:v", "6M"] : []), ...(includeAudio ? ["-map", "[a]", "-c:a", target.video ? "libopus" : "aac", "-b:a", "192k"] : []), output]);
}

export async function materializeRecordingParts(folder: string): Promise<RecordingFinalizeResult> {
  const { journal } = await readActiveRecordingPart(folder);
  if (journal.parts.some((part) => !part.result?.integrity.programPlayable)) throw new Error("Recover all recording parts before finishing the episode.");
  const staged = path.join(folder, "Session", `.assembly-${randomUUID()}`);
  await fs.mkdir(staged, { recursive: true });
  const outputs: Array<{ target: typeof targetPaths[number]; temporary: string; destination: string }> = [];
  const warnings = journal.parts.flatMap((part) => part.result?.integrity.warnings ?? []);
  try {
    for (const target of targetPaths) {
      const present = journal.parts.every((part) => target.slot === "program" || part.result?.tracks.some((track) => track.slot === target.slot && track.status === "saved"));
      if (!present) {
        if (journal.parts.some((part) => part.result?.tracks.some((track) => track.slot === target.slot))) warnings.push(`${target.slot} is incomplete across recording parts; its originals remain in Recordings.`);
        continue;
      }
      const temporary = path.join(staged, path.basename(target.file));
      await assembleTarget(folder, journal.parts, target, temporary);
      if (!(await validatePlayableMedia(temporary, undefined, { video: target.video, audio: !target.video || target.slot === "program", decode: true }))) throw new Error(`Combined ${target.slot} could not be verified.`);
      outputs.push({ target, temporary, destination: path.join(folder, target.file) });
    }
    // Every assembled file is validated before publishing any canonical media.
    // The immutable parts remain authoritative if publication is interrupted.
    for (const item of outputs) { await fs.mkdir(path.dirname(item.destination), { recursive: true }); await fs.rename(item.temporary, item.destination); }
    const tracks = outputs.filter((item) => item.target.slot !== "program").map((item) => ({ slot: item.target.slot as RecordingTrackSlot, kind: item.target.video ? "camera" as const : "audio" as const, status: "saved" as const, filePath: item.destination, message: "All recording parts combined and verified" }));
    const result: RecordingFinalizeResult = { programPath: path.join(folder, "Program", "program.webm"), tracks, integrity: { checkedAt: new Date().toISOString(), playable: true, programPlayable: true, savedSourceCount: tracks.length, expectedSourceCount: new Set(journal.parts.flatMap((part) => part.result?.tracks.map((track) => track.slot) ?? [])).size, warnings } };
    const firstSync = await readRecordingJson<SyncMetadata>(path.join(partPath(folder, journal.parts[0]), "Session", "sync-metadata.json"));
    await writeRecordingJson(path.join(folder, "Session", "sync-metadata.json"), { ...firstSync, savedMediaFiles: Object.fromEntries(outputs.map((item) => [item.target.slot, item.destination])), sourceStartOffsetsMs: journal.parts.length > 1 ? Object.fromEntries(outputs.map((item) => [item.target.slot, 0])) : firstSync.sourceStartOffsetsMs, trackStates: Object.fromEntries(tracks.map((track) => [track.slot, track])), validation: { programPlayable: true, validatedAt: result.integrity.checkedAt } });
    await writeRecordingJson(path.join(folder, "Session", "recording-integrity.json"), result.integrity);
    return result;
  } finally { await fs.rm(staged, { recursive: true, force: true }); }
}
