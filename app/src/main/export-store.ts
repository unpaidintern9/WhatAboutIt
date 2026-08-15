import path from "node:path";
import fs from "node:fs/promises";
import { shell } from "electron";
import type { ExportJob, ExportRequest } from "../shared/export";
import { isTimelineTrackAvailableAt, type TimelineEditOperation, type TimelineTrack } from "../shared/timeline";
import type { CameraSlotKey, MicrophoneSlotKey } from "../shared/types";
import { completeExportJob, createExportJob, createExportSummary, failExportJob, cancelExportJob } from "../shared/export";
import { getEpisodesRoot } from "./config-service";
import { detectMediaTools, getMediaDurationMs, requireMediaTools, runFfmpeg, runFfmpegWithProgress, validatePlayableMedia } from "./ffmpeg-tools";
import { logger } from "./logger";

type ExportProgressReporter = (job: ExportJob) => void;

const activeExports = new Map<string, { jobId: string; controller: AbortController }>();
const fallbackCameraMicrophones: Record<CameraSlotKey, MicrophoneSlotKey> = {
  camera1: "morganMic",
  camera2: "guestMic",
  camera3: "extraMic"
};
const microphoneFileNames: Record<MicrophoneSlotKey, string> = {
  morganMic: "morgan-mic.m4a",
  guestMic: "guest-mic.m4a",
  extraMic: "extra-mic.m4a"
};

function exportFolder(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Exports");
}

function programFolder(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Program");
}

function episodeFolder(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId);
}

async function writeExportArtifacts(job: ExportJob) {
  await fs.mkdir(job.outputFolder, { recursive: true });
  await fs.writeFile(path.join(job.outputFolder, "export-job.json"), JSON.stringify(job, null, 2), "utf8");
  await fs.writeFile(
    path.join(job.outputFolder, "export-log.txt"),
    [
      "What About It? Studio export log",
      `Job: ${job.id}`,
      `Status: ${job.status}`,
      `Message: ${job.message}`,
      "Your original recording stays safe."
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(job.outputFolder, "export-summary.json"),
    JSON.stringify(createExportSummary(job), null, 2),
    "utf8"
  );
}

async function hasProgramRecording(episodeId: string) {
  try {
    await fs.access(path.join(programFolder(episodeId), "program.webm"));
    return true;
  } catch {
    return false;
  }
}

async function findProgramRecording(episodeId: string) {
  try {
    const recording = path.join(programFolder(episodeId), "program.webm");
    await fs.access(recording);
    return recording;
  } catch {
    return null;
  }
}

function outputFileName(type: ExportRequest["type"]) {
  if (type === "audio-only") return "what-about-it-audio-only.m4a";
  if (type === "archive-master") return "what-about-it-archive-master.mkv";
  return "what-about-it-full-episode-video.mp4";
}

function qualityArgs(type: ExportRequest["type"], preset: ExportRequest["qualityPreset"], includeVideoFilter = true) {
  if (type === "audio-only") {
    return ["-vn", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", preset === "high" || preset === "archive" ? "320k" : "192k"];
  }

  if (type === "archive-master") {
    return [...(includeVideoFilter ? ["-vf", videoOutputFilter(preset)] : []), "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le"];
  }

  const crf = preset === "high" ? "16" : preset === "archive" ? "14" : "20";
  const speed = preset === "high" || preset === "archive" ? "slow" : "veryfast";
  const audioBitrate = preset === "standard" ? "192k" : "320k";
  return [
    ...(includeVideoFilter ? ["-vf", videoOutputFilter(preset)] : []),
    "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", speed, "-crf", crf,
    "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", audioBitrate
  ];
}

function outputSize(preset: ExportRequest["qualityPreset"]) {
  return preset === "high" || preset === "archive" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

function videoOutputFilter(preset: ExportRequest["qualityPreset"]) {
  const size = outputSize(preset);
  return `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
}

async function createPracticeSource(episodeId: string) {
  const folder = programFolder(episodeId);
  const output = path.join(folder, "practice-export-source.mp4");
  await fs.mkdir(folder, { recursive: true });

  try {
    await fs.access(output);
    return output;
  } catch {
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=1280x720:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-t",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      output
    ]);
    return output;
  }
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function renderExport(input: {
  request: ExportRequest;
  sourceFile: string;
  audioFile?: string;
  outputPath: string;
  durationMs: number;
  signal: AbortSignal;
  onProgress: (progress: number) => void;
}) {
  const inputArgs = ["-y", "-fflags", "+genpts", "-i", input.sourceFile];
  if (input.audioFile) inputArgs.push("-i", input.audioFile);
  const mapArgs = input.request.type === "audio-only"
    ? ["-map", "0:a:0"]
    : input.audioFile
      ? ["-map", "0:v:0", "-map", "1:a:0"]
      : ["-map", "0:v:0", "-map", "0:a:0"];
  const containerArgs = input.outputPath.endsWith(".mp4") ? ["-movflags", "+faststart"] : [];

  await runFfmpegWithProgress(
    [...inputArgs, ...mapArgs, ...qualityArgs(input.request.type, input.request.qualityPreset), ...containerArgs, input.outputPath],
    { durationMs: input.durationMs, signal: input.signal, onProgress: input.onProgress }
  );
}

interface DraftInput {
  track: TimelineTrack;
  filePath: string;
  inputIndex: number;
}

async function renderDraftExport(input: {
  request: ExportRequest;
  sourceFile: string;
  outputPath: string;
  durationMs: number;
  signal: AbortSignal;
  onProgress: (progress: number) => void;
}) {
  const { request } = input;
  const inputArgs = ["-y", "-fflags", "+genpts", "-i", input.sourceFile];
  const cameraInputs: DraftInput[] = [];
  const audioInputs: DraftInput[] = [];
  let inputIndex = 1;

  for (const track of request.draft.tracks) {
    if (!track.sourceAssetId) continue;
    const filePath = sourcePathForTrack(request.episodeId, track);
    if (!filePath || !(await fileExists(filePath))) continue;
    if (track.kind === "camera" && track.includedInProgram) cameraInputs.push({ track, filePath, inputIndex });
    if (track.kind === "microphone") audioInputs.push({ track, filePath, inputIndex });
    if (track.kind !== "camera" && track.kind !== "microphone") continue;
    inputArgs.push("-i", filePath);
    inputIndex += 1;
  }

  const hasDraftDecisions = request.draft.cameraDecisions.length > 0
    || request.draft.editLog.length > 0
    || request.draft.tracks.some(hasTrackAdjustments);
  if (!hasDraftDecisions) return false;

  const filters: string[] = [];
  const globalEdits = editsForTrack(request.draft.editLog, "program");
  const cameraEditPoints = request.draft.editLog.flatMap((edit) => {
    const target = request.draft.tracks.find((track) => track.id === edit.targetTrackId);
    return target?.kind === "camera"
      ? [edit.timestampMs, ...(edit.endTimestampMs === undefined ? [] : [edit.endTimestampMs])]
      : [];
  });
  const keepRanges = createVideoRanges(
    request.draft.durationMs || input.durationMs,
    globalEdits,
    [...request.draft.cameraDecisions.map((decision) => decision.startMs), ...cameraEditPoints]
  );
  const editedDurationMs = keepRanges.reduce((total, range) => total + range.endMs - range.startMs, 0);
  const cameraByTrack = new Map(cameraInputs.map((item) => [item.track.id, item]));
  const videoLabels: string[] = [];
  const programTrack = request.draft.tracks.find((track) => track.id === "program");
  const size = outputSize(request.qualityPreset);

  if (request.type !== "audio-only") {
    for (const [index, range] of keepRanges.entries()) {
      const decision = [...request.draft.cameraDecisions].reverse().find((item) => item.startMs <= range.startMs);
      const camera = decision ? cameraByTrack.get(decision.cameraTrackId) : undefined;
      const midpoint = range.startMs + (range.endMs - range.startMs) / 2;
      const chosenCamera = camera && isTimelineTrackAvailableAt(request.draft, camera.track.id, midpoint) ? camera : undefined;
      const chosen = chosenCamera?.inputIndex ?? 0;
      const chosenTrack = chosenCamera?.track ?? programTrack;
      const syncOffsetMs = chosenTrack?.syncOffsetMs ?? 0;
      const sourceStartMs = Math.max(0, range.startMs + syncOffsetMs);
      const sourceEndMs = Math.max(sourceStartMs + 1, range.endMs + syncOffsetMs);
      const cropFilter = chosenTrack?.cropMode === "fill"
        ? `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height}`
        : `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`;
      const pictureFilters = createVideoTreatment(chosenTrack, size);
      const transitionFilter = createVideoTransitionFilter(
        request.draft.cameraTransition,
        request.draft.cameraTransitionMs,
        index,
        keepRanges.length,
        range.endMs - range.startMs
      );
      const label = `draftv${index}`;
      filters.push(
        `[${chosen}:v:0]trim=start=${seconds(sourceStartMs)}:end=${seconds(sourceEndMs)},setpts=PTS-STARTPTS,` +
        `${cropFilter},${pictureFilters}${transitionFilter}setsar=1,fps=30[${label}]`
      );
      videoLabels.push(`[${label}]`);
    }
    if (videoLabels.length === 0) throw new Error("The draft removed every video section.");
    filters.push(videoLabels.length === 1
      ? `${videoLabels[0]}null[vout]`
      : `${videoLabels.join("")}concat=n=${videoLabels.length}:v=1:a=0[vout]`);
  }

  const audioLabels: string[] = [];
  const enabledAudioInputs = audioInputs.filter((item) => item.track.includedInProgram && !item.track.muted);
  const anySolo = enabledAudioInputs.some((item) => item.track.solo);
  const activeAudioInputs = anySolo ? enabledAudioInputs.filter((item) => item.track.solo) : enabledAudioInputs;
  const allSeparateMicrophonesMuted = audioInputs.length > 0 && activeAudioInputs.length === 0;
  const audioSources = activeAudioInputs.length > 0
    ? activeAudioInputs.map((item) => ({ inputIndex: item.inputIndex, track: item.track }))
    : [{ inputIndex: 0, track: request.draft.tracks.find((track) => track.id === "program") }];
  for (const [index, source] of audioSources.entries()) {
    const label = `drafta${index}`;
    const trackEdits = editsForTrack(request.draft.editLog, source.track?.id ?? "program");
    const volume = allSeparateMicrophonesMuted ? 0 : Math.max(0, Math.min(1.5, (source.track?.volume ?? 100) / 100));
    const muteExpression = createMuteExpression(trackEdits, volume);
    const keepExpression = createKeepExpression(globalEdits);
    const syncFilter = createAudioSyncFilter(source.track?.syncOffsetMs ?? 0);
    const treatment = createAudioTreatment(source.track);
    const panFilter = createPanFilter(source.track?.pan ?? 0);
    const fadeFilter = createFadeFilter(source.track, request.draft.durationMs || input.durationMs);
    filters.push(
      `[${source.inputIndex}:a:0]${syncFilter}${treatment}volume='${muteExpression}':eval=frame,` +
      `${keepExpression ? `aselect='${keepExpression}',` : ""}asetpts=N/SR/TB,aresample=48000:async=1:first_pts=0,` +
      `aformat=sample_fmts=fltp:channel_layouts=stereo,${panFilter}${fadeFilter}${createLimiterFilter(source.track)}[${label}]`
    );
    audioLabels.push(`[${label}]`);
  }
  const loudnessTarget = Math.max(-24, Math.min(-12, request.draft.loudnessTargetLufs ?? -16));
  const truePeak = Math.max(-3, Math.min(-0.5, request.draft.truePeakDb ?? -1.5));
  const loudnessFinish = `loudnorm=I=${loudnessTarget}:LRA=11:TP=${truePeak},aresample=48000`;
  filters.push(audioLabels.length === 1
    ? `${audioLabels[0]}${loudnessFinish}[aout]`
    : `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest,alimiter=limit=0.95,${loudnessFinish}[aout]`);

  const mapArgs = request.type === "audio-only" ? ["-map", "[aout]"] : ["-map", "[vout]", "-map", "[aout]"];
  const containerArgs = input.outputPath.endsWith(".mp4") ? ["-movflags", "+faststart"] : [];
  await runFfmpegWithProgress(
    [...inputArgs, "-filter_complex", filters.join(";"), ...mapArgs, ...qualityArgs(request.type, request.qualityPreset, false), "-t", seconds(editedDurationMs), ...containerArgs, input.outputPath],
    { durationMs: input.durationMs, signal: input.signal, onProgress: input.onProgress }
  );
  return true;
}

function sourcePathForTrack(episodeId: string, track: TimelineTrack) {
  if (track.kind === "camera" && /^camera-[123]$/.test(track.sourceAssetId ?? "")) {
    return path.join(episodeFolder(episodeId), "Cameras", `${track.sourceAssetId}.webm`);
  }
  const audioFiles: Record<string, string> = {
    "morgan-mic": "morgan-mic.m4a",
    "guest-mic": "guest-mic.m4a",
    "extra-mic": "extra-mic.m4a"
  };
  const audioFile = track.sourceAssetId ? audioFiles[track.sourceAssetId] : undefined;
  return audioFile ? path.join(episodeFolder(episodeId), "Audio", audioFile) : undefined;
}

function editsForTrack(edits: TimelineEditOperation[], trackId: string) {
  return edits.filter((edit) => (edit.targetTrackId ?? "program") === trackId);
}

function hasTrackAdjustments(track: TimelineTrack) {
  return !track.includedInProgram
    || track.muted
    || track.solo
    || track.volume !== 100
    || track.pan !== 0
    || track.fadeInMs > 0
    || track.fadeOutMs > 0
    || track.syncOffsetMs !== 0
    || track.audioPreset !== "natural"
    || track.noiseReduction !== 0
    || track.noiseGateDb !== -80
    || track.deEsser !== 0
    || track.compression !== 0
    || track.eqLowDb !== 0
    || track.eqMidDb !== 0
    || track.eqHighDb !== 0
    || track.cropMode !== "fit"
    || track.brightness !== 0
    || track.contrast !== 100
    || track.saturation !== 100
    || track.temperature !== 0
    || track.tint !== 0
    || track.sharpness !== 0
    || track.denoise !== 0
    || track.zoom !== 100
    || track.positionX !== 0
    || track.positionY !== 0;
}

function createVideoRanges(durationMs: number, globalEdits: TimelineEditOperation[], decisionPoints: number[]) {
  const trimStart = Math.max(0, ...globalEdits.filter((edit) => edit.type === "trim-before").map((edit) => edit.timestampMs));
  const trimEnd = Math.min(durationMs, ...globalEdits.filter((edit) => edit.type === "trim-after").map((edit) => edit.timestampMs), durationMs);
  const cuts = globalEdits.filter((edit) => edit.type === "delete-section").map((edit) => ({
    startMs: edit.timestampMs,
    endMs: Math.min(durationMs, edit.endTimestampMs ?? edit.timestampMs + 15000)
  }));
  const boundaries = new Set([trimStart, trimEnd, ...decisionPoints, ...cuts.flatMap((cut) => [cut.startMs, cut.endMs])]);
  const ordered = [...boundaries].filter((value) => value >= trimStart && value <= trimEnd).sort((a, b) => a - b);
  return ordered.slice(0, -1).map((startMs, index) => ({ startMs, endMs: ordered[index + 1] }))
    .filter((range) => range.endMs > range.startMs && !cuts.some((cut) => range.startMs >= cut.startMs && range.endMs <= cut.endMs));
}

function createMuteExpression(edits: TimelineEditOperation[], volume: number) {
  const muted: string[] = [];
  for (const edit of edits) {
    if (edit.type === "trim-before") muted.push(`lt(t,${seconds(edit.timestampMs)})`);
    if (edit.type === "trim-after") muted.push(`gte(t,${seconds(edit.timestampMs)})`);
    if (edit.type === "delete-section") muted.push(`between(t,${seconds(edit.timestampMs)},${seconds(edit.endTimestampMs ?? edit.timestampMs + 15000)})`);
  }
  return muted.length > 0 ? `if(${muted.join("+")},0,${volume.toFixed(3)})` : volume.toFixed(3);
}

function createKeepExpression(edits: TimelineEditOperation[]) {
  const removed: string[] = [];
  for (const edit of edits) {
    if (edit.type === "trim-before") removed.push(`lt(t,${seconds(edit.timestampMs)})`);
    if (edit.type === "trim-after") removed.push(`gte(t,${seconds(edit.timestampMs)})`);
    if (edit.type === "delete-section") removed.push(`between(t,${seconds(edit.timestampMs)},${seconds(edit.endTimestampMs ?? edit.timestampMs + 15000)})`);
  }
  return removed.length > 0 ? `not(${removed.join("+")})` : "";
}

function createAudioSyncFilter(syncOffsetMs: number) {
  if (syncOffsetMs > 0) return `atrim=start=${seconds(syncOffsetMs)},asetpts=PTS-STARTPTS,`;
  if (syncOffsetMs < 0) {
    const delay = Math.abs(Math.round(syncOffsetMs));
    return `adelay=${delay}|${delay},`;
  }
  return "";
}

function createAudioTreatment(track: TimelineTrack | undefined) {
  const preset = track?.audioPreset ?? "natural";
  const filters: string[] = [];
  if (preset === "clean") filters.push("highpass=f=70", "lowpass=f=16000");
  if (preset === "warm") filters.push("highpass=f=70", "equalizer=f=180:t=q:w=1:g=1.5");
  if (preset === "broadcast") filters.push("highpass=f=80", "equalizer=f=3200:t=q:w=1:g=2");
  if (track) {
    if (track.noiseReduction > 0) filters.push(`afftdn=nr=${Math.max(0.01, track.noiseReduction * 0.65).toFixed(2)}:nf=-50:tn=1`);
    if (track.noiseGateDb > -80) {
      const threshold = Math.pow(10, track.noiseGateDb / 20);
      filters.push(`agate=threshold=${threshold.toFixed(5)}:ratio=2.5:attack=15:release=220:range=0.08`);
    }
    if (track.deEsser > 0) filters.push(`equalizer=f=6500:t=q:w=1.2:g=${(-track.deEsser * 0.045).toFixed(2)}`);
    if (track.eqLowDb !== 0) filters.push(`equalizer=f=120:t=q:w=0.8:g=${track.eqLowDb.toFixed(1)}`);
    if (track.eqMidDb !== 0) filters.push(`equalizer=f=1200:t=q:w=1:g=${track.eqMidDb.toFixed(1)}`);
    if (track.eqHighDb !== 0) filters.push(`equalizer=f=6000:t=q:w=0.8:g=${track.eqHighDb.toFixed(1)}`);
    if (track.compression > 0) {
      const ratio = 1.5 + track.compression * 0.045;
      const threshold = 0.24 - track.compression * 0.0017;
      filters.push(`acompressor=threshold=${Math.max(0.05, threshold).toFixed(3)}:ratio=${ratio.toFixed(2)}:attack=5:release=110:makeup=1.15`);
    }
  }
  return filters.length > 0 ? `${filters.join(",")},` : "";
}

function createLimiterFilter(track: TimelineTrack | undefined) {
  return track?.limiterEnabled ? ",alimiter=limit=0.95" : "";
}

function createVideoTreatment(track: TimelineTrack | undefined, size: { width: number; height: number }) {
  const brightness = ((track?.brightness ?? 0) / 100).toFixed(2);
  const contrast = ((track?.contrast ?? 100) / 100).toFixed(2);
  const saturation = ((track?.saturation ?? 100) / 100).toFixed(2);
  const temperature = ((track?.temperature ?? 0) * 0.0015).toFixed(3);
  const tint = ((track?.tint ?? 0) * 0.001).toFixed(3);
  const zoom = (track?.zoom ?? 100) / 100;
  const scaledWidth = Math.max(size.width, Math.round(size.width * zoom));
  const scaledHeight = Math.max(size.height, Math.round(size.height * zoom));
  const x = (((track?.positionX ?? 0) + 100) / 200).toFixed(3);
  const y = (((track?.positionY ?? 0) + 100) / 200).toFixed(3);
  const filters = [
    `scale=${scaledWidth}:${scaledHeight},crop=${size.width}:${size.height}:(iw-ow)*${x}:(ih-oh)*${y}`,
    `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`
  ];
  if (track?.temperature || track?.tint) filters.push(`colorbalance=rm=${temperature}:bm=${(-Number(temperature)).toFixed(3)}:gm=${tint}`);
  if ((track?.denoise ?? 0) > 0) {
    const strength = ((track?.denoise ?? 0) / 25).toFixed(2);
    filters.push(`hqdn3d=${strength}:${strength}:${(Number(strength) * 1.5).toFixed(2)}:${(Number(strength) * 1.5).toFixed(2)}`);
  }
  if ((track?.sharpness ?? 0) > 0) filters.push(`unsharp=5:5:${((track?.sharpness ?? 0) * 0.015).toFixed(2)}:5:5:0`);
  return `${filters.join(",")},`;
}

function createVideoTransitionFilter(
  transition: "cut" | "fade",
  transitionMs: number,
  index: number,
  count: number,
  durationMs: number
) {
  if (transition !== "fade" || count < 2) return "";
  const duration = Math.min(transitionMs, Math.max(100, durationMs / 3));
  const filters: string[] = [];
  if (index > 0) filters.push(`fade=t=in:st=0:d=${seconds(duration)}`);
  if (index < count - 1) filters.push(`fade=t=out:st=${seconds(Math.max(0, durationMs - duration))}:d=${seconds(duration)}`);
  return filters.length > 0 ? `${filters.join(",")},` : "";
}

function createPanFilter(pan: number) {
  const normalized = Math.max(-1, Math.min(1, pan / 100));
  const left = normalized > 0 ? 1 - normalized : 1;
  const right = normalized < 0 ? 1 + normalized : 1;
  return `pan=stereo|c0=${left.toFixed(3)}*c0|c1=${right.toFixed(3)}*c1`;
}

function createFadeFilter(track: TimelineTrack | undefined, durationMs: number) {
  if (!track) return "";
  const filters: string[] = [];
  if (track.fadeInMs > 0) filters.push(`afade=t=in:st=0:d=${seconds(track.fadeInMs)}`);
  if (track.fadeOutMs > 0) filters.push(`afade=t=out:st=${seconds(Math.max(0, durationMs - track.fadeOutMs))}:d=${seconds(track.fadeOutMs)}`);
  return filters.length > 0 ? `,${filters.join(",")}` : "";
}

function seconds(milliseconds: number) {
  return (Math.max(0, milliseconds) / 1000).toFixed(3);
}

function updateRunningJob(job: ExportJob, progress: number, message: string, report?: ExportProgressReporter): ExportJob {
  const next = {
    ...job,
    status: "running" as const,
    progress: Math.round(Math.min(99, Math.max(0, progress))),
    updatedAt: new Date().toISOString(),
    message
  };
  report?.(next);
  return next;
}

async function createCameraMasters(
  request: ExportRequest,
  running: ExportJob,
  sourceDurationMs: number,
  signal: AbortSignal,
  report?: ExportProgressReporter
) {
  const outputs: string[] = [];
  const available: Array<{ cameraSlot: CameraSlotKey; sourceFile: string; audioFile: string; relativeOutput: string }> = [];
  let savedRoutes: Partial<Record<CameraSlotKey, MicrophoneSlotKey>>;
  try {
    const deviceMap = JSON.parse(await fs.readFile(path.join(episodeFolder(request.episodeId), "Session", "device-map.json"), "utf8")) as {
      cameraMicrophones?: Partial<Record<CameraSlotKey, MicrophoneSlotKey>>;
    };
    savedRoutes = deviceMap.cameraMicrophones ?? {};
  } catch {
    savedRoutes = {};
  }
  for (const cameraSlot of ["camera1", "camera2", "camera3"] as CameraSlotKey[]) {
    const cameraNumber = cameraSlot.at(-1);
    const sourceFile = path.join(episodeFolder(request.episodeId), "Cameras", `camera-${cameraNumber}.webm`);
    const microphoneSlot = savedRoutes[cameraSlot] ?? request.deviceDefaults?.cameraMicrophones?.[cameraSlot] ?? fallbackCameraMicrophones[cameraSlot];
    const audioFile = path.join(episodeFolder(request.episodeId), "Audio", microphoneFileNames[microphoneSlot]);
    if (!(await fileExists(sourceFile)) || !(await fileExists(audioFile))) continue;
    available.push({
      cameraSlot,
      sourceFile,
      audioFile,
      relativeOutput: path.join("Camera Masters", `camera-${cameraNumber}-with-${microphoneFileNames[microphoneSlot].replace(".m4a", "")}.mp4`)
    });
  }

  for (const [index, item] of available.entries()) {
    const start = 62 + (index / Math.max(1, available.length)) * 18;
    const width = 18 / Math.max(1, available.length);
    const outputPath = path.join(exportFolder(request.episodeId), item.relativeOutput);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const durationMs = (await getMediaDurationMs(item.audioFile)) || sourceDurationMs;
    await renderExport({
      request: { ...request, type: "full-episode-video" },
      sourceFile: item.sourceFile,
      audioFile: item.audioFile,
      outputPath,
      durationMs,
      signal,
      onProgress: (progress) => updateRunningJob(running, start + (progress / 100) * width, `Building Camera ${item.cameraSlot.at(-1)} with its microphone`, report)
    });
    if (!(await validatePlayableMedia(outputPath, undefined, { video: true, audio: true, decode: true }))) {
      throw new Error(`${item.relativeOutput} could not be decoded with video and audio.`);
    }
    outputs.push(item.relativeOutput);
  }
  return outputs;
}

async function createAudioMasters(
  request: ExportRequest,
  running: ExportJob,
  sourceDurationMs: number,
  signal: AbortSignal,
  report?: ExportProgressReporter
) {
  const outputs: string[] = [];
  const tracks = request.draft.tracks.filter((track) => track.kind === "microphone" && track.sourceAssetId);
  const available: Array<{ track: TimelineTrack; sourceFile: string; relativeOutput: string }> = [];
  for (const track of tracks) {
    const sourceFile = sourcePathForTrack(request.episodeId, track);
    if (!sourceFile || !(await fileExists(sourceFile))) continue;
    available.push({
      track,
      sourceFile,
      relativeOutput: path.join("Audio Masters", `${track.sourceAssetId}-edited.wav`)
    });
  }

  for (const [index, item] of available.entries()) {
    const start = 81 + (index / Math.max(1, available.length)) * 12;
    const width = 12 / Math.max(1, available.length);
    const outputPath = path.join(exportFolder(request.episodeId), item.relativeOutput);
    const trackEdits = editsForTrack(request.draft.editLog, item.track.id);
    const globalEdits = editsForTrack(request.draft.editLog, "program");
    const volume = Math.max(0, Math.min(1.5, item.track.volume / 100));
    const muteExpression = createMuteExpression(trackEdits, volume);
    const keepExpression = createKeepExpression(globalEdits);
    const filters = [
      createAudioSyncFilter(item.track.syncOffsetMs),
      createAudioTreatment(item.track),
      `volume='${muteExpression}':eval=frame,`,
      keepExpression ? `aselect='${keepExpression}',` : "",
      "asetpts=N/SR/TB,aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,",
      createPanFilter(item.track.pan),
      createFadeFilter(item.track, request.draft.durationMs || sourceDurationMs),
      createLimiterFilter(item.track)
    ].join("");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await runFfmpegWithProgress(
      ["-y", "-fflags", "+genpts", "-i", item.sourceFile, "-filter:a", filters, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", outputPath],
      {
        durationMs: sourceDurationMs,
        signal,
        onProgress: (progress) => updateRunningJob(running, start + (progress / 100) * width, `Building ${item.track.label} audio master`, report)
      }
    );
    if (!(await validatePlayableMedia(outputPath, undefined, { audio: true, decode: true }))) {
      throw new Error(`${item.relativeOutput} could not be decoded.`);
    }
    outputs.push(item.relativeOutput);
  }
  return outputs;
}

export async function createExport(request: ExportRequest, report?: ExportProgressReporter): Promise<ExportJob> {
  const folder = exportFolder(request.episodeId);
  const queued = createExportJob({
    episodeId: request.episodeId,
    type: request.type,
    qualityPreset: request.qualityPreset,
    outputFolder: folder
  });
  report?.(queued);
  let running = updateRunningJob(queued, 4, "Checking your recording", report);
  await writeExportArtifacts(running);

  const mediaTools = await detectMediaTools();
  if (!mediaTools.ready) {
    const failed = failExportJob(running, "media-tools-missing");
    await writeExportArtifacts(failed);
    report?.(failed);
    await logger.warning("ExportService", "Media tools missing for export.", { episodeId: request.episodeId });
    return failed;
  }

  const canExport = request.practice || (await hasProgramRecording(request.episodeId));
  if (!canExport) {
    const failed = failExportJob(running, "recording-missing");
    await writeExportArtifacts(failed);
    report?.(failed);
    await logger.warning("ExportService", "Recording file missing for export.", { episodeId: request.episodeId });
    return failed;
  }

  const fileName = outputFileName(request.type);
  const outputPath = path.join(folder, fileName);
  const tools = await requireMediaTools();
  const sourceFile = request.practice ? await createPracticeSource(request.episodeId) : await findProgramRecording(request.episodeId);
  if (!sourceFile) {
    const failed = failExportJob(running, "recording-missing");
    await writeExportArtifacts(failed);
    report?.(failed);
    await logger.warning("ExportService", "Recording file missing for export.", { episodeId: request.episodeId });
    return failed;
  }
  const controller = new AbortController();
  activeExports.set(request.episodeId, { jobId: queued.id, controller });

  try {
    running = updateRunningJob(running, 12, "Preparing video and audio", report);
    const sourceDurationMs = (await getMediaDurationMs(sourceFile, tools)) || request.draft.durationMs || 1000;
    const renderInput = {
      request,
      sourceFile,
      outputPath,
      durationMs: sourceDurationMs,
      signal: controller.signal,
      onProgress: (progress: number) => {
        running = updateRunningJob(running, 12 + (progress / 100) * 48, "Exporting your episode", report);
      }
    };
    const renderedDraft = !request.practice && await renderDraftExport(renderInput);
    if (!renderedDraft) await renderExport(renderInput);
    running = updateRunningJob(running, 61, "Checking playback and sound", report);
    const requirements = request.type === "audio-only"
      ? { audio: true, decode: true }
      : { video: true, audio: true, decode: true };
    const isPlayable = await validatePlayableMedia(outputPath, tools, requirements);
    if (!isPlayable) throw new Error("Export output could not be validated.");
    const cameraOutputs = request.type === "full-episode-video" && !request.practice
      ? await createCameraMasters(request, running, sourceDurationMs, controller.signal, report)
      : [];
    const audioOutputs = (request.type === "full-episode-video" || request.type === "archive-master") && !request.practice
      ? await createAudioMasters(request, running, sourceDurationMs, controller.signal, report)
      : [];
    running = updateRunningJob(running, 95, "Finishing your export", report);
    const editDecisionFile = "edit-decision-list.json";
    await fs.writeFile(path.join(folder, editDecisionFile), JSON.stringify(request.draft, null, 2), "utf8");
    const outputFileNames = [fileName, ...cameraOutputs, ...audioOutputs, editDecisionFile];
    const completeBase = completeExportJob(running, fileName);
    const completionMessage = renderedDraft
      ? `Export complete from your ${request.draft.editMode === "auto" ? "Auto Edit" : "manual"} draft`
      : cameraOutputs.length > 0
        ? `Export complete with ${cameraOutputs.length} camera master${cameraOutputs.length === 1 ? "" : "s"}`
        : completeBase.message;
    const complete = {
      ...completeBase,
      outputFileNames,
      message: completionMessage
    };
    await writeExportArtifacts(complete);
    report?.(complete);
    await logger.info("ExportService", "Created playable local export.", {
      episodeId: request.episodeId,
      outputFileName: fileName,
      cameraOutputs,
      audioOutputs,
      ffmpegVersion: tools.ffmpegVersion,
      ffprobeVersion: tools.ffprobeVersion
    });
    return complete;
  } catch (error) {
    const failed = error instanceof Error && error.name === "AbortError"
      ? cancelExportJob(running)
      : failExportJob(running, "needs-attention");
    await writeExportArtifacts(failed);
    report?.(failed);
    await logger.error("ExportService", "FFmpeg export failed.", { episodeId: request.episodeId, error: String(error) });
    return failed;
  } finally {
    const active = activeExports.get(request.episodeId);
    if (active?.jobId === queued.id) activeExports.delete(request.episodeId);
  }
}

export async function cancelExport(episodeId: string, job: ExportJob): Promise<ExportJob> {
  activeExports.get(episodeId)?.controller.abort();
  const canceled = cancelExportJob({ ...job, outputFolder: exportFolder(episodeId) });
  await writeExportArtifacts(canceled);
  await logger.info("ExportService", "Canceled local export job.", { episodeId });
  return canceled;
}

export async function openExportFolder(episodeId: string): Promise<string> {
  const folder = exportFolder(episodeId);
  await fs.mkdir(folder, { recursive: true });
  await shell.openPath(folder);
  return folder;
}

export { detectMediaTools };
