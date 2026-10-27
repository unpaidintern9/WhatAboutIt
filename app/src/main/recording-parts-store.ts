import { preferredAudioFile } from "./audio-source";
import { microphoneSlots } from "../shared/audio-tracks";
import { durableJson } from "./durable-file";
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
export async function writeRecordingJson(file: string, data: unknown) { return durableJson(file, data); }
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
  ...microphoneSlots.map(({ key, assetId }) => ({ slot: key as RecordingTrackSlot, file: `Audio/${assetId}.flac`, video: false }))
];

interface StreamInfo { codec_name?: string; sample_rate?: string; pix_fmt?: string; time_base?: string; codec_type: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; channels?: number }
function recordingFrameRate(video: StreamInfo) {
  // Chromium VFR WebM can report its 1 ms time base as 1000 fps. Do not
  // duplicate every frame to that rate when a resumed part needs rendering.
  for (const rate of [video.avg_frame_rate, video.r_frame_rate]) {
    if (!rate) continue;
    const [numerator, denominator = 1] = rate.split("/").map(Number);
    const fps = numerator / denominator;
    if (Number.isFinite(fps) && fps >= 1 && fps <= 60) return rate;
  }
  return "30";
}
async function assembleTarget(folder: string, parts: RecordingPart[], target: typeof targetPaths[number], output: string) {
  const inputs = parts.map((part) => target.video ? path.join(partPath(folder, part), target.file) : preferredAudioFile(partPath(folder, part), path.basename(target.file)));
  if (parts.length === 1) {
    if (!target.video && path.extname(inputs[0]) !== ".flac") await runFfmpeg(["-y", "-i", inputs[0], "-c:a", "flac", "-sample_fmt", "s32", output]);
    else await fs.copyFile(inputs[0], output);
    return;
  }
  const streams: StreamInfo[][] = [];
  for (const file of inputs) streams.push(JSON.parse((await runFfprobe(["-v", "error", "-show_streams", "-of", "json", file])).stdout).streams);
  const video = streams[0].find((stream) => stream.codec_type === "video");
  const includeAudio = streams.every((list) => list.some((stream) => stream.codec_type === "audio"));
  const channels = streams[0].find((stream) => stream.codec_type === "audio")?.channels ?? 1;
  const syncs = await Promise.all(parts.map((part) => readRecordingJson<SyncMetadata>(path.join(partPath(folder, part), "Session", "sync-metadata.json"))));
  const signature = (list: StreamInfo[]) => JSON.stringify(list.map(({ codec_type, codec_name, width, height, r_frame_rate, channels, sample_rate, pix_fmt, time_base }) => ({ codec_type, codec_name, width, height, r_frame_rate, channels, sample_rate, pix_fmt, time_base })));
  const compatible = streams.every((list) => signature(list) === signature(streams[0]))
    && syncs.every((sync) => target.slot === "program" || Math.abs(sync.sourceStartOffsetsMs?.[target.slot] ?? 0) <= 2);
  if (compatible) {
    const listFile = `${output}.ffconcat`;
    const escapeFile = (file: string) => file.replaceAll("\\", "/").replaceAll("'", "'\\''");
    await fs.writeFile(listFile, inputs.map((file, index) => `file '${escapeFile(file)}'\nduration ${((parts[index].durationMs ?? 0) / 1000).toFixed(6)}`).join("\n"));
    try {
      await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-map", "0", "-c", "copy", output]);
      const duration = await getMediaDurationMs(output);
      const expected = parts.reduce((sum, part) => sum + (part.durationMs ?? 0), 0);
      if (Math.abs(duration - expected) <= 120 && await validatePlayableMedia(output, undefined, { video: target.video, audio: !target.video || target.slot === "program", decode: true })) return;
    } catch { await fs.rm(output, { force: true }); }
    finally { await fs.rm(listFile, { force: true }); }
  }
  const filters: string[] = [];
  for (const [index, part] of parts.entries()) {
    const seconds = (part.durationMs ?? 0) / 1000;
    const sync = syncs[index];
    const offset = target.slot === "program" ? 0 : -(sync.sourceStartOffsetsMs?.[target.slot] ?? 0) / 1000;
    if (video) filters.push(`[${index}:v]trim=start=${Math.max(0, offset)},setpts=PTS-STARTPTS,scale=${video.width}:${video.height}:force_original_aspect_ratio=decrease,pad=${video.width}:${video.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${recordingFrameRate(video)},tpad=start_mode=clone:start_duration=${Math.max(0, -offset)}:stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds},setpts=PTS-STARTPTS[v${index}]`);
    if (includeAudio) filters.push(`[${index}:a]atrim=start=${Math.max(0, offset)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=${channels === 1 ? "mono" : "stereo"},${offset < 0 ? `adelay=${Array.from({ length: channels === 1 ? 1 : 2 }, () => Math.round(-offset * 1000)).join("|")},` : ""}apad,atrim=duration=${seconds},asetpts=PTS-STARTPTS[a${index}]`);
  }
  filters.push(`${parts.map((_, index) => `${video ? `[v${index}]` : ""}${includeAudio ? `[a${index}]` : ""}`).join("")}concat=n=${parts.length}:v=${video ? 1 : 0}:a=${includeAudio ? 1 : 0}${video ? "[v]" : ""}${includeAudio ? "[a]" : ""}`);
  await runFfmpeg(["-y", ...inputs.flatMap((file) => ["-i", file]), "-filter_complex", filters.join(";"), ...(video ? ["-map", "[v]", "-c:v", "libvpx-vp9", "-lossless", "1", "-deadline", "good", "-cpu-used", "4"] : []), ...(includeAudio ? ["-map", "[a]", "-c:a", target.video ? "libopus" : "flac", ...(target.video ? ["-b:a", "192k"] : ["-sample_fmt", "s32"])] : []), output]);
}

export async function materializeRecordingParts(folder: string, report?: (progress: number, message: string) => void): Promise<RecordingFinalizeResult> {
  const { journal } = await readActiveRecordingPart(folder);
  if (journal.parts.some((part) => !part.result?.integrity.programPlayable)) throw new Error("Recover all recording parts before finishing the episode.");
  const staged = path.join(folder, "Session", `.assembly-${randomUUID()}`);
  await fs.mkdir(staged, { recursive: true });
  const outputs: Array<{ target: typeof targetPaths[number]; temporary: string; destination: string }> = [];
  const warnings = journal.parts.flatMap((part) => part.result?.integrity.warnings ?? []);
  try {
    for (const [index, target] of targetPaths.entries()) {
      report?.(Math.round(index / targetPaths.length * 95), `Assembling and verifying ${target.slot}`);
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
    report?.(100, "Episode saved and verified");
    return result;
  } finally { await fs.rm(staged, { recursive: true, force: true }); }
}
