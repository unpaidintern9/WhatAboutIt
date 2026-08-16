import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { shell } from "electron";
import type { ExportJob, ExportRequest } from "../shared/export";
import { compactTimelineDraftForPersistence, isTimelineTrackAvailableAt, type TimelineEditOperation, type TimelineTrack } from "../shared/timeline";
import type { CameraSlotKey, MicrophoneSlotKey } from "../shared/types";
import type { ReviewMediaTreatmentPreview } from "../shared/review-media";
import { completeExportJob, createExportJob, createExportSummary, failExportJob, cancelExportJob } from "../shared/export";
import { getEpisodesRoot } from "./config-service";
import { detectMediaTools, getMediaDurationMs, requireMediaTools, runFfmpeg, runFfmpegWithProgress, validatePlayableMedia } from "./ffmpeg-tools";
import { logger } from "./logger";
import { loadImportedOriginalPaths, mediaFilePlaybackUrl } from "./review-media-store";

type ExportProgressReporter = (job: ExportJob) => void;

const activeExports = new Map<string, { jobId: string; controller: AbortController }>();
const pendingExportEpisodes = new Set<string>();
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

function safeFileName(value: string) {
  const printable = Array.from(value).filter((character) => character.charCodeAt(0) >= 32).join("");
  const cleaned = printable.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "episode";
}

async function nextAvailableDirectoryPath(parentFolder: string, name: string) {
  for (let version = 1; ; version += 1) {
    const folderName = version === 1 ? name : `${name} ${version}`;
    const folderPath = path.join(parentFolder, folderName);
    if (!(await fileExists(folderPath))) return folderPath;
  }
}

async function requestExportFolder(request: ExportRequest) {
  if (request.type !== "editor-handoff") return exportFolder(request.episodeId);
  if (!request.destinationFolderPath) throw new Error("Choose where to save the editor handoff package.");
  await fs.mkdir(request.destinationFolderPath, { recursive: true });
  const folder = await nextAvailableDirectoryPath(
    request.destinationFolderPath,
    `What About It - ${safeFileName(request.episodeId)} - Editor Handoff`
  );
  await fs.mkdir(folder, { recursive: true });
  return folder;
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
  return Boolean(await findProgramRecording(episodeId));
}

async function findProgramRecording(episodeId: string) {
  const originals = await loadImportedOriginalPaths(episodeId);
  try {
    await fs.access(path.join(episodeFolder(episodeId), "Session", "program-from-camera-1.json"));
    if (originals["camera-1"]) return originals["camera-1"];
  } catch {
    // A recorded Program file is preferred unless Camera 1 created the fallback.
  }
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
  if (type === "social-clip-placeholder") return "what-about-it-social-clip.mp4";
  if (type === "editor-handoff") return path.join("01 Reference Edit", "what-about-it-reference-edit.mp4");
  return "what-about-it-full-episode-video.mp4";
}

export async function nextAvailableExportPath(folder: string, relativeFileName: string) {
  const parsed = path.parse(relativeFileName);
  for (let version = 1; ; version += 1) {
    const fileName = version === 1
      ? relativeFileName
      : path.join(parsed.dir, `${parsed.name}-${version}${parsed.ext}`);
    if (!(await fileExists(path.join(folder, fileName)))) return { fileName, outputPath: path.join(folder, fileName) };
  }
}

async function hasEnoughSpaceForExport(folder: string, sourceFile: string, request: ExportRequest, durationMs: number) {
  try {
    const volume = await fs.statfs(folder);
    const availableBytes = Number(volume.bavail) * Number(volume.bsize);
    const sourceBytes = (await fs.stat(sourceFile)).size;
    const seconds = Math.max(1, durationMs / 1000);
    const primaryEstimate = request.type === "audio-only"
      ? seconds * 48_000
      : request.type === "archive-master"
        ? Math.max(sourceBytes * 2.5, seconds * 5_000_000)
        : request.type === "editor-handoff"
          ? Math.max(sourceBytes * 6, seconds * 12_000_000)
        : Math.max(sourceBytes * 1.25, seconds * 2_000_000);
    const cameraMasterEstimate = request.type === "full-episode-video" && !request.practice && request.includeCameraMasters !== false ? sourceBytes * 3 : 0;
    const audioMasterEstimate = (request.type === "full-episode-video" || request.type === "archive-master") && !request.practice && request.includeAudioMasters !== false ? sourceBytes : 0;
    const requiredBytes = Math.ceil(primaryEstimate + cameraMasterEstimate + audioMasterEstimate + 1024 * 1024 * 1024);
    return availableBytes >= requiredBytes;
  } catch (error) {
    await logger.warning("ExportService", "Could not complete the export disk-space preflight.", { error: String(error) });
    return true;
  }
}

function qualityArgs(type: ExportRequest["type"], preset: ExportRequest["qualityPreset"], includeVideoFilter = true) {
  if (type === "audio-only") {
    return ["-vn", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", preset === "high" || preset === "archive" ? "320k" : "192k"];
  }

  if (type === "archive-master") {
    return [...(includeVideoFilter ? ["-vf", videoOutputFilter(preset, type)] : []), "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "12", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le"];
  }

  const crf = type === "editor-handoff" ? "16" : preset === "high" ? "16" : preset === "archive" ? "14" : "20";
  const speed = type === "editor-handoff" || preset === "high" || preset === "archive" ? "slow" : "veryfast";
  const audioBitrate = type === "editor-handoff" || preset !== "standard" ? "320k" : "192k";
  return [
    ...(includeVideoFilter ? ["-vf", videoOutputFilter(preset, type)] : []),
    "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", speed, "-crf", crf,
    "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", audioBitrate
  ];
}

function outputSize(preset: ExportRequest["qualityPreset"], type?: ExportRequest["type"]) {
  if (type === "social-clip-placeholder") return { width: 1080, height: 1920 };
  if (type === "editor-handoff") return { width: 1920, height: 1080 };
  return preset === "high" || preset === "archive" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

function videoOutputFilter(preset: ExportRequest["qualityPreset"], type?: ExportRequest["type"]) {
  const size = outputSize(preset, type);
  return type === "social-clip-placeholder"
    ? `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},setsar=1,fps=30`
    : `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
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
  const originalSources = await loadImportedOriginalPaths(request.episodeId);
  let inputIndex = 1;

  for (const track of request.draft.tracks) {
    if (!track.sourceAssetId) continue;
    const filePath = sourcePathForTrack(request.episodeId, track, originalSources);
    if (!filePath || !(await fileExists(filePath))) continue;
    if (track.kind === "camera" && track.includedInProgram) cameraInputs.push({ track, filePath, inputIndex });
    if (track.kind === "microphone") audioInputs.push({ track, filePath, inputIndex });
    if (track.kind !== "camera" && track.kind !== "microphone") continue;
    inputArgs.push("-i", filePath);
    inputIndex += 1;
  }

  const hasDraftDecisions = request.draft.cameraDecisions.length > 0
    || request.draft.editLog.length > 0
    || request.draft.tracks.some(hasTrackAdjustments)
    || request.type === "social-clip-placeholder";
  if (!hasDraftDecisions) return false;

  const filters: string[] = [];
  const selectedClipRange = request.type === "social-clip-placeholder" && request.draft.selection?.endTimestampMs !== undefined
    ? { startMs: request.draft.selection.timestampMs, endMs: request.draft.selection.endTimestampMs }
    : undefined;
  const globalEdits = [
    ...editsForTrack(request.draft.editLog, "program"),
    ...(selectedClipRange
      ? [
          { id: "social-clip-in", type: "trim-before" as const, label: "Social clip start", timestampMs: selectedClipRange.startMs, targetTrackId: "program", createdAt: request.draft.updatedAt },
          { id: "social-clip-out", type: "trim-after" as const, label: "Social clip end", timestampMs: selectedClipRange.endMs, targetTrackId: "program", createdAt: request.draft.updatedAt }
        ]
      : [])
  ];
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
  const programTrack = request.draft.tracks.find((track) => track.id === "program");
  const size = outputSize(request.qualityPreset, request.type);

  if (request.type !== "audio-only") {
    const segments = keepRanges.map((range) => {
      const decision = [...request.draft.cameraDecisions].reverse().find((item) => item.startMs <= range.startMs);
      const camera = decision ? cameraByTrack.get(decision.cameraTrackId) : undefined;
      const midpoint = range.startMs + (range.endMs - range.startMs) / 2;
      const chosenCamera = camera && isTimelineTrackAvailableAt(request.draft, camera.track.id, midpoint) ? camera : undefined;
      const chosen = chosenCamera?.inputIndex ?? 0;
      const chosenTrack = chosenCamera?.track ?? programTrack;
      const syncOffsetMs = chosenTrack?.syncOffsetMs ?? 0;
      const focusX = (((chosenTrack?.positionX ?? 0) + 100) / 200).toFixed(3);
      const focusY = (((chosenTrack?.positionY ?? 0) + 100) / 200).toFixed(3);
      const cropFilter = request.type === "social-clip-placeholder"
        ? `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height}:(iw-ow)*${focusX}:(ih-oh)*${focusY}`
        : chosenTrack?.cropMode === "fill"
          ? `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height}`
        : `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2`;
      const pictureFilters = createVideoTreatment(request.type === "social-clip-placeholder" && chosenTrack ? { ...chosenTrack, positionX: 0, positionY: 0 } : chosenTrack, size);
      return { range, chosen, chosenTrack, syncOffsetMs, cropFilter, pictureFilters };
    });
    if (segments.length === 0) throw new Error("The draft removed every video section.");

    const transitionInto = segments.map((segment, index) => {
      const previous = segments[index - 1];
      if (!previous || request.draft.cameraTransition !== "fade" || previous.range.endMs !== segment.range.startMs) return 0;
      const requested = Math.min(
        request.draft.cameraTransitionMs,
        (previous.range.endMs - previous.range.startMs) / 3,
        (segment.range.endMs - segment.range.startMs) / 3
      );
      return Math.max(0, Math.min(requested, segment.range.startMs + segment.syncOffsetMs));
    });
    const outputParts: string[] = [];
    const addVideoSlice = (segment: (typeof segments)[number], startMs: number, endMs: number, label: string) => {
      filters.push(
        `[${segment.chosen}:v:0]trim=start=${seconds(startMs + segment.syncOffsetMs)}:end=${seconds(endMs + segment.syncOffsetMs)},setpts=PTS-STARTPTS,` +
        `${segment.cropFilter},${segment.pictureFilters}setsar=1,fps=30[${label}]`
      );
    };
    for (const [index, segment] of segments.entries()) {
      const outgoingTransitionMs = transitionInto[index + 1] ?? 0;
      const mainEndMs = segment.range.endMs - outgoingTransitionMs;
      if (mainEndMs > segment.range.startMs) {
        const mainLabel = `draftvm${index}`;
        addVideoSlice(segment, segment.range.startMs, mainEndMs, mainLabel);
        outputParts.push(`[${mainLabel}]`);
      }
      if (outgoingTransitionMs > 0) {
        const next = segments[index + 1];
        const outgoingLabel = `draftvto${index}`;
        const incomingLabel = `draftvti${index}`;
        const blendedLabel = `draftvt${index}`;
        addVideoSlice(segment, segment.range.endMs - outgoingTransitionMs, segment.range.endMs, outgoingLabel);
        addVideoSlice(next, next.range.startMs - outgoingTransitionMs, next.range.startMs, incomingLabel);
        filters.push(
          `[${outgoingLabel}][${incomingLabel}]blend=all_expr='A*(1-T/${seconds(outgoingTransitionMs)})+B*(T/${seconds(outgoingTransitionMs)})':shortest=1[${blendedLabel}]`
        );
        outputParts.push(`[${blendedLabel}]`);
      }
    }
    filters.push(outputParts.length === 1
      ? `${outputParts[0]}null[vout]`
      : `${outputParts.join("")}concat=n=${outputParts.length}:v=1:a=0[vout]`);
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
  const loudnessFinish = request.masteringMode === "measured"
    ? "aresample=48000"
    : `loudnorm=I=${loudnessTarget}:LRA=11:TP=${truePeak},aresample=48000`;
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

function sourcePathForTrack(episodeId: string, track: TimelineTrack, originalSources: Awaited<ReturnType<typeof loadImportedOriginalPaths>> = {}) {
  const original = track.sourceAssetId ? originalSources[track.sourceAssetId as keyof typeof originalSources] : undefined;
  if (original) return original;
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

export async function renderTrackTreatmentPreview(input: { episodeId: string; draft: ExportRequest["draft"]; trackId: string; timestampMs: number }): Promise<ReviewMediaTreatmentPreview> {
  const track = input.draft.tracks.find((candidate) => candidate.id === input.trackId);
  if (!track || (track.kind !== "camera" && track.kind !== "microphone")) throw new Error("Choose a camera or microphone track to preview its effects.");
  const originals = await loadImportedOriginalPaths(input.episodeId);
  const sourceFile = sourcePathForTrack(input.episodeId, track, originals);
  if (!sourceFile || !(await fileExists(sourceFile))) throw new Error(`${track.label} does not have a media file to preview.`);
  const sourceDurationMs = await getMediaDurationMs(sourceFile);
  const startMs = Math.max(0, Math.min(sourceDurationMs - 500, input.timestampMs - 2000));
  const durationMs = Math.max(500, Math.min(10000, sourceDurationMs - startMs));
  const previewFolder = path.join(episodeFolder(input.episodeId), "Session", "Review");
  const safeTrackId = track.id.replace(/[^a-z0-9-]+/gi, "-");
  const kind = track.kind === "camera" ? "video" as const : "audio" as const;
  const previewPrefix = `treatment-preview-${safeTrackId}-`;
  const outputPath = path.join(previewFolder, `${previewPrefix}${randomUUID()}.${kind === "video" ? "webm" : "m4a"}`);
  await fs.mkdir(previewFolder, { recursive: true });
  if (kind === "video") {
    const size = { width: 1280, height: 720 };
    const crop = track.cropMode === "fill"
      ? `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},`
      : `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,`;
    await runFfmpeg([
      "-y", "-ss", seconds(startMs), "-i", sourceFile, "-t", seconds(durationMs), "-an",
      "-vf", `${crop}${createVideoTreatment(track, size)}setsar=1,fps=30`,
      "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-crf", "32", "-b:v", "0", outputPath
    ]);
  } else {
    const volume = Math.max(0, Math.min(1.5, track.volume / 100));
    const loudnessTarget = Math.max(-24, Math.min(-12, input.draft.loudnessTargetLufs ?? -16));
    const truePeak = Math.max(-3, Math.min(-0.5, input.draft.truePeakDb ?? -1.5));
    const filters = `${createAudioTreatment(track)}volume=${track.muted ? 0 : volume.toFixed(3)},${createPanFilter(track.pan)}${createLimiterFilter(track)},loudnorm=I=${loudnessTarget}:LRA=11:TP=${truePeak}`;
    await runFfmpeg(["-y", "-ss", seconds(startMs), "-i", sourceFile, "-t", seconds(durationMs), "-vn", "-filter:a", filters, "-c:a", "aac", "-b:a", "192k", outputPath]);
  }
  if (!(await validatePlayableMedia(outputPath, undefined, kind === "video" ? { video: true, decode: true } : { audio: true, decode: true }))) {
    throw new Error("The effect preview could not be decoded.");
  }
  const oldPreviews = (await fs.readdir(previewFolder, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.startsWith(previewPrefix) && entry.name !== path.basename(outputPath))
    .sort((left, right) => right.name.localeCompare(left.name));
  for (const oldPreview of oldPreviews.slice(4)) {
    await fs.rm(path.join(previewFolder, oldPreview.name), { force: true }).catch(() => undefined);
  }
  return {
    trackId: track.id,
    kind,
    playbackUrl: `${mediaFilePlaybackUrl(outputPath)}?version=${Date.now()}`,
    durationMs
  };
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

interface LoudnessMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

async function renderMeasuredLoudness(input: {
  sourcePath: string;
  outputPath: string;
  request: ExportRequest;
  durationMs: number;
  signal: AbortSignal;
  onProgress: (progress: number) => void;
}) {
  const targetI = Math.max(-24, Math.min(-12, input.request.draft.loudnessTargetLufs ?? -16));
  const targetTp = Math.max(-3, Math.min(-0.5, input.request.draft.truePeakDb ?? -1.5));
  const analysis = await runFfmpeg([
    "-hide_banner", "-i", input.sourcePath, "-map", "0:a:0", "-af",
    `loudnorm=I=${targetI}:LRA=11:TP=${targetTp}:print_format=json`, "-f", "null", "-"
  ]);
  const matches = analysis.stderr.match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/g);
  if (!matches?.length) throw new Error("Measured loudness analysis did not return usable results.");
  const measured = JSON.parse(matches.at(-1) ?? "{}") as LoudnessMeasurement;
  const filter = [
    `loudnorm=I=${targetI}:LRA=11:TP=${targetTp}`,
    `measured_I=${measured.input_i}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_TP=${measured.input_tp}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    "linear=true"
  ].join(":");
  const isAudioOnly = input.request.type === "audio-only";
  const mapArgs = isAudioOnly ? ["-map", "0:a:0"] : ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy"];
  const audioArgs = input.request.type === "archive-master"
    ? ["-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le"]
    : ["-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", input.request.qualityPreset === "standard" ? "192k" : "320k"];
  await runFfmpegWithProgress(
    ["-y", "-i", input.sourcePath, ...mapArgs, "-filter:a", filter, ...audioArgs, ...(input.outputPath.endsWith(".mp4") ? ["-movflags", "+faststart"] : []), input.outputPath],
    { durationMs: input.durationMs, signal: input.signal, onProgress: input.onProgress }
  );
}

function createCaptionSidecar(request: ExportRequest) {
  const selection = request.type === "social-clip-placeholder" && request.draft.selection?.endTimestampMs !== undefined
    ? { startMs: request.draft.selection.timestampMs, endMs: request.draft.selection.endTimestampMs }
    : undefined;
  const edits = [
    ...editsForTrack(request.draft.editLog, "program"),
    ...(selection
      ? [
          { id: "caption-trim-in", type: "trim-before" as const, label: "Caption trim", timestampMs: selection.startMs, targetTrackId: "program", createdAt: request.draft.updatedAt },
          { id: "caption-trim-out", type: "trim-after" as const, label: "Caption trim", timestampMs: selection.endMs, targetTrackId: "program", createdAt: request.draft.updatedAt }
        ]
      : [])
  ];
  const ranges = createVideoRanges(request.draft.durationMs, edits, []);
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  let outputOffsetMs = 0;
  for (const range of ranges) {
    for (const cue of request.draft.captions) {
      const startMs = Math.max(range.startMs, cue.startMs);
      const endMs = Math.min(range.endMs, cue.endMs);
      if (endMs <= startMs || !cue.text.trim()) continue;
      cues.push({
        startMs: outputOffsetMs + startMs - range.startMs,
        endMs: outputOffsetMs + endMs - range.startMs,
        text: cue.text.trim()
      });
    }
    outputOffsetMs += range.endMs - range.startMs;
  }
  const format = (milliseconds: number) => {
    const total = Math.max(0, Math.round(milliseconds));
    const hours = Math.floor(total / 3_600_000);
    const minutes = Math.floor((total % 3_600_000) / 60_000);
    const seconds = Math.floor((total % 60_000) / 1000);
    const millis = total % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
  };
  return cues.map((cue, index) => `${index + 1}\n${format(cue.startMs)} --> ${format(cue.endMs)}\n${cue.text}\n`).join("\n");
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
  const originalSources = await loadImportedOriginalPaths(request.episodeId);
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
    const sourceFile = originalSources[`camera-${cameraNumber}` as keyof typeof originalSources]
      ?? path.join(episodeFolder(request.episodeId), "Cameras", `camera-${cameraNumber}.webm`);
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
    const reserved = await nextAvailableExportPath(exportFolder(request.episodeId), item.relativeOutput);
    const outputPath = reserved.outputPath;
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
    outputs.push(reserved.fileName);
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
  const originalSources = await loadImportedOriginalPaths(request.episodeId);
  const tracks = request.draft.tracks.filter((track) => track.kind === "microphone" && track.sourceAssetId);
  const available: Array<{ track: TimelineTrack; sourceFile: string; relativeOutput: string }> = [];
  for (const track of tracks) {
    const sourceFile = sourcePathForTrack(request.episodeId, track, originalSources);
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
    const reserved = await nextAvailableExportPath(exportFolder(request.episodeId), item.relativeOutput);
    const outputPath = reserved.outputPath;
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
    outputs.push(reserved.fileName);
  }
  return outputs;
}

async function createEditorCameraFiles(
  request: ExportRequest,
  running: ExportJob,
  sourceDurationMs: number,
  signal: AbortSignal,
  report?: ExportProgressReporter
) {
  const outputs: string[] = [];
  const originalSources = await loadImportedOriginalPaths(request.episodeId);
  const available: Array<{ cameraNumber: string; sourceFile: string; relativeOutput: string }> = [];
  for (const cameraNumber of ["1", "2", "3"]) {
    const sourceFile = originalSources[`camera-${cameraNumber}` as keyof typeof originalSources]
      ?? path.join(episodeFolder(request.episodeId), "Cameras", `camera-${cameraNumber}.webm`);
    if (!(await fileExists(sourceFile))) continue;
    available.push({
      cameraNumber,
      sourceFile,
      relativeOutput: path.join("02 Camera Video", `Camera ${cameraNumber}.mp4`)
    });
  }

  for (const [index, item] of available.entries()) {
    const start = 62 + (index / Math.max(1, available.length)) * 18;
    const width = 18 / Math.max(1, available.length);
    const outputPath = path.join(running.outputFolder, item.relativeOutput);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const durationMs = (await getMediaDurationMs(item.sourceFile)) || sourceDurationMs;
    await runFfmpegWithProgress(
      [
        "-y", "-fflags", "+genpts", "-i", item.sourceFile,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", videoOutputFilter("high", "editor-handoff"),
        "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath
      ],
      {
        durationMs,
        signal,
        onProgress: (progress) => updateRunningJob(running, start + (progress / 100) * width, `Preparing Camera ${item.cameraNumber} for outside editors`, report)
      }
    );
    if (!(await validatePlayableMedia(outputPath, undefined, { video: true, decode: true }))) {
      throw new Error(`${item.relativeOutput} could not be decoded.`);
    }
    outputs.push(item.relativeOutput);
  }
  return outputs;
}

async function createEditorAudioFiles(
  request: ExportRequest,
  running: ExportJob,
  sourceDurationMs: number,
  signal: AbortSignal,
  report?: ExportProgressReporter
) {
  const outputs: string[] = [];
  const originalSources = await loadImportedOriginalPaths(request.episodeId);
  const labels: Array<{ assetId: "morgan-mic" | "guest-mic" | "extra-mic"; label: string }> = [
    { assetId: "morgan-mic", label: "Morgan Mic" },
    { assetId: "guest-mic", label: "Guest Mic" },
    { assetId: "extra-mic", label: "Extra Mic" }
  ];
  const available = labels.flatMap((item) => {
    const sourceFile = originalSources[item.assetId]
      ?? path.join(episodeFolder(request.episodeId), "Audio", `${item.assetId}.m4a`);
    return [{ ...item, sourceFile, relativeOutput: path.join("03 Isolated Audio", `${item.label}.wav`) }];
  });
  const existing = [] as typeof available;
  for (const item of available) if (await fileExists(item.sourceFile)) existing.push(item);

  for (const [index, item] of existing.entries()) {
    const start = 81 + (index / Math.max(1, existing.length)) * 12;
    const width = 12 / Math.max(1, existing.length);
    const outputPath = path.join(running.outputFolder, item.relativeOutput);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const durationMs = (await getMediaDurationMs(item.sourceFile)) || sourceDurationMs;
    await runFfmpegWithProgress(
      ["-y", "-fflags", "+genpts", "-i", item.sourceFile, "-map", "0:a:0", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s24le", outputPath],
      {
        durationMs,
        signal,
        onProgress: (progress) => updateRunningJob(running, start + (progress / 100) * width, `Preparing ${item.label} WAV`, report)
      }
    );
    if (!(await validatePlayableMedia(outputPath, undefined, { audio: true, decode: true }))) {
      throw new Error(`${item.relativeOutput} could not be decoded.`);
    }
    outputs.push(item.relativeOutput);
  }
  return outputs;
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createSyncMap(request: ExportRequest) {
  const rows = request.draft.tracks
    .filter((track) => track.kind === "camera" || track.kind === "microphone")
    .map((track) => {
      const offset = Math.round(track.syncOffsetMs);
      const action = offset > 0 ? `Trim ${offset} ms from the start` : offset < 0 ? `Delay by ${Math.abs(offset)} ms` : "No offset";
      return [track.label, track.kind, track.sourceAssetId ?? "", offset, action].map(csvCell).join(",");
    });
  return ["track,kind,source_asset,sync_offset_ms,editor_action", ...rows].join("\n");
}

function createMarkerCsv(request: ExportRequest) {
  const rows = request.draft.markers.map((marker) => [marker.label, marker.timestampMs, (marker.timestampMs / 1000).toFixed(3), marker.createdAt].map(csvCell).join(","));
  return ["marker,timestamp_ms,timestamp_seconds,created_at", ...rows].join("\n");
}

function editorReadme(request: ExportRequest, cameraOutputs: string[], audioOutputs: string[]) {
  return [
    "WHAT ABOUT IT? - EDITOR HANDOFF",
    "",
    "This folder is designed for Adobe Premiere Pro, DaVinci Resolve, Final Cut Pro, CapCut, and other common editors.",
    "All compatibility video is H.264 MP4 with 48 kHz guide audio when available. Isolated microphones are 48 kHz, 24-bit WAV.",
    "",
    "START HERE",
    "1. Import everything inside 02 Camera Video and 03 Isolated Audio.",
    "2. Use waveform synchronization / Auto Sync Audio. The camera files contain the shared guide audio recorded in the studio.",
    "3. If automatic sync needs help, use 04 Project Notes/sync-map.csv. A positive offset means trim that amount from the source start; a negative offset means delay it.",
    "4. Use 01 Reference Edit/what-about-it-reference-edit.mp4 as the visual and pacing reference.",
    "5. Captions, markers, and the non-destructive What About It edit decision list are in 04 Project Notes.",
    "6. Before copying or uploading, compare files against SHA256SUMS.txt if transfer integrity is in doubt.",
    "",
    `Episode ID: ${request.episodeId}`,
    `Camera files: ${cameraOutputs.length}`,
    `Isolated microphone files: ${audioOutputs.length}`,
    "",
    "The source recordings inside What About It Studio were not changed or deleted by this export."
  ].join("\n");
}

async function copyIfExists(sourcePath: string, destinationPath: string) {
  if (!(await fileExists(sourcePath))) return false;
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
  return true;
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function packageFiles(folder: string, current = folder): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await packageFiles(folder, entryPath));
    else if (entry.isFile() && !["SHA256SUMS.txt", "export-job.json", "export-log.txt", "export-summary.json"].includes(entry.name)) files.push(path.relative(folder, entryPath));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function writeEditorHandoffNotes(request: ExportRequest, running: ExportJob, cameraOutputs: string[], audioOutputs: string[]) {
  const notesFolder = path.join(running.outputFolder, "04 Project Notes");
  await fs.mkdir(notesFolder, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(running.outputFolder, "README - START HERE.txt"), editorReadme(request, cameraOutputs, audioOutputs), "utf8"),
    fs.writeFile(path.join(notesFolder, "sync-map.csv"), createSyncMap(request), "utf8"),
    fs.writeFile(path.join(notesFolder, "markers.csv"), createMarkerCsv(request), "utf8"),
    copyIfExists(path.join(episodeFolder(request.episodeId), "Session", "sync-metadata.json"), path.join(notesFolder, "recording-sync-metadata.json")),
    copyIfExists(path.join(episodeFolder(request.episodeId), "Session", "capture-manifest.json"), path.join(notesFolder, "recording-capture-manifest.json"))
  ]);
  const files = await packageFiles(running.outputFolder);
  const checksums: string[] = [];
  for (const relativePath of files) {
    checksums.push(`${await sha256File(path.join(running.outputFolder, relativePath))}  ${relativePath.split(path.sep).join("/")}`);
  }
  await fs.writeFile(path.join(running.outputFolder, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`, "utf8");
  return [
    "README - START HERE.txt",
    path.join("04 Project Notes", "sync-map.csv"),
    path.join("04 Project Notes", "markers.csv"),
    "SHA256SUMS.txt"
  ];
}

async function createExportUnlocked(request: ExportRequest, report?: ExportProgressReporter): Promise<ExportJob> {
  const folder = await requestExportFolder(request);
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

  if (request.type === "social-clip-placeholder" && (request.draft.selection?.endTimestampMs === undefined || request.draft.selection.endTimestampMs <= request.draft.selection.timestampMs)) {
    const failed = failExportJob(running, "clip-range-missing");
    await writeExportArtifacts(failed);
    report?.(failed);
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

  const reservedOutput = await nextAvailableExportPath(folder, outputFileName(request.type));
  const fileName = reservedOutput.fileName;
  const outputPath = reservedOutput.outputPath;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
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
    if (!(await hasEnoughSpaceForExport(folder, sourceFile, request, sourceDurationMs))) {
      const failed = failExportJob(running, "not-enough-space");
      await writeExportArtifacts(failed);
      report?.(failed);
      return failed;
    }
    const measuredMastering = request.masteringMode === "measured";
    const premasterPath = measuredMastering
      ? path.join(folder, `.${path.basename(outputPath, path.extname(outputPath))}-premaster-${randomUUID()}${path.extname(outputPath)}`)
      : outputPath;
    const renderInput = {
      request,
      sourceFile,
      outputPath: premasterPath,
      durationMs: sourceDurationMs,
      signal: controller.signal,
      onProgress: (progress: number) => {
        running = updateRunningJob(running, 12 + (progress / 100) * (measuredMastering ? 30 : 48), "Exporting your episode", report);
      }
    };
    let renderedDraft = false;
    try {
      renderedDraft = Boolean(!request.practice && await renderDraftExport(renderInput));
      if (!renderedDraft) await renderExport(renderInput);
      if (measuredMastering) {
        running = updateRunningJob(running, 43, "Measuring podcast loudness", report);
        await renderMeasuredLoudness({
          sourcePath: premasterPath,
          outputPath,
          request,
          durationMs: sourceDurationMs,
          signal: controller.signal,
          onProgress: (progress) => {
            running = updateRunningJob(running, 43 + (progress / 100) * 17, "Applying measured loudness", report);
          }
        });
      }
    } finally {
      if (measuredMastering) await fs.rm(premasterPath, { force: true }).catch(() => undefined);
    }
    running = updateRunningJob(running, 61, "Checking playback and sound", report);
    const requirements = request.type === "audio-only"
      ? { audio: true, decode: true }
      : { video: true, audio: true, decode: true };
    const isPlayable = await validatePlayableMedia(outputPath, tools, requirements);
    if (!isPlayable) throw new Error("Export output could not be validated.");
    const cameraOutputs = request.type === "editor-handoff" && !request.practice
      ? await createEditorCameraFiles(request, running, sourceDurationMs, controller.signal, report)
      : request.type === "full-episode-video" && !request.practice && request.includeCameraMasters !== false
        ? await createCameraMasters(request, running, sourceDurationMs, controller.signal, report)
        : [];
    const audioOutputs = request.type === "editor-handoff" && !request.practice
      ? await createEditorAudioFiles(request, running, sourceDurationMs, controller.signal, report)
      : (request.type === "full-episode-video" || request.type === "archive-master") && !request.practice && request.includeAudioMasters !== false
        ? await createAudioMasters(request, running, sourceDurationMs, controller.signal, report)
        : [];
    running = updateRunningJob(running, 95, "Finishing your export", report);
    const captionSidecar = createCaptionSidecar(request);
    let captionFile: string | undefined;
    if (captionSidecar) {
      const reservedCaptions = await nextAvailableExportPath(folder, request.type === "editor-handoff" ? path.join("04 Project Notes", "captions.srt") : "captions.srt");
      captionFile = reservedCaptions.fileName;
      await fs.mkdir(path.dirname(reservedCaptions.outputPath), { recursive: true });
      await fs.writeFile(reservedCaptions.outputPath, captionSidecar, "utf8");
    }
    const reservedEditDecision = await nextAvailableExportPath(folder, request.type === "editor-handoff" ? path.join("04 Project Notes", "edit-decision-list.json") : "edit-decision-list.json");
    const editDecisionFile = reservedEditDecision.fileName;
    await fs.mkdir(path.dirname(reservedEditDecision.outputPath), { recursive: true });
    await fs.writeFile(reservedEditDecision.outputPath, JSON.stringify(compactTimelineDraftForPersistence(request.draft), null, 2), "utf8");
    const handoffNotes = request.type === "editor-handoff"
      ? await writeEditorHandoffNotes(request, running, cameraOutputs, audioOutputs)
      : [];
    const outputFileNames = [fileName, ...cameraOutputs, ...audioOutputs, ...(captionFile ? [captionFile] : []), editDecisionFile, ...handoffNotes];
    const completeBase = completeExportJob(running, fileName);
    const completionMessage = request.type === "editor-handoff"
      ? `Editor handoff complete with ${cameraOutputs.length} camera file${cameraOutputs.length === 1 ? "" : "s"} and ${audioOutputs.length} isolated microphone file${audioOutputs.length === 1 ? "" : "s"}`
      : renderedDraft
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

export async function createExport(request: ExportRequest, report?: ExportProgressReporter): Promise<ExportJob> {
  if (request.type === "editor-handoff" && !request.destinationFolderPath) {
    const failed = failExportJob(createExportJob({
      episodeId: request.episodeId,
      type: request.type,
      qualityPreset: request.qualityPreset,
      outputFolder: exportFolder(request.episodeId)
    }), "destination-missing");
    report?.(failed);
    return failed;
  }
  if (pendingExportEpisodes.has(request.episodeId)) {
    const failed = failExportJob(createExportJob({
      episodeId: request.episodeId,
      type: request.type,
      qualityPreset: request.qualityPreset,
      outputFolder: exportFolder(request.episodeId)
    }), "export-already-running");
    report?.(failed);
    return failed;
  }
  pendingExportEpisodes.add(request.episodeId);
  try {
    return await createExportUnlocked(request, report);
  } finally {
    pendingExportEpisodes.delete(request.episodeId);
  }
}

export async function cancelExport(episodeId: string, job: ExportJob): Promise<ExportJob> {
  activeExports.get(episodeId)?.controller.abort();
  const canceled = cancelExportJob(job);
  await writeExportArtifacts(canceled);
  await logger.info("ExportService", "Canceled local export job.", { episodeId });
  return canceled;
}

export async function openExportFolder(episodeId: string, outputFolder?: string): Promise<string> {
  const folder = outputFolder ?? exportFolder(episodeId);
  await fs.mkdir(folder, { recursive: true });
  await shell.openPath(folder);
  return folder;
}

export { detectMediaTools };
