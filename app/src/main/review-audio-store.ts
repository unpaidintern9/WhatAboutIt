import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getEpisodesRoot } from "./config-service";
import { preferredAudioFile } from "./audio-source";
import { createAudioTreatment } from "./audio-treatment-filters";
import { audioTreatmentSignature } from "../shared/audio-treatment";
import type { TimelineTrack } from "../shared/timeline";
import { loadImportedOriginalPaths, mediaFilePlaybackUrl } from "./review-media-store";
import { getMediaDurationMs, runFfmpegWithProgress, validatePlayableMedia } from "./ffmpeg-tools";
import type { PreparedReviewAudio } from "../shared/review-media";

const active = new Map<string, { folder: string; controller: AbortController; signature: string; promise: Promise<PreparedReviewAudio> }>();
export function cancelPreparedReviewAudio(client: string) {
  for (const [key, job] of active) if (key.startsWith(`${client}:`)) job.controller.abort();
}
export async function cancelReviewAudioWork(folder?: string) {
  const jobs = [...active.values()].filter((job) => !folder || job.folder === folder);
  for (const job of jobs) job.controller.abort();
  await Promise.allSettled(jobs.map((job) => job.promise));
}

export async function prepareReviewAudio(client: string, episodeId: string, track: TimelineTrack): Promise<PreparedReviewAudio> {
  if (!episodeId || path.basename(episodeId) !== episodeId || [".", ".."].includes(episodeId)) throw new Error("Invalid episode.");
  if (track.kind !== "microphone" || !track.sourceAssetId || !/^[a-z0-9-]+$/i.test(track.sourceAssetId)) throw new Error("Choose an isolated microphone source.");
  const folder = path.join(getEpisodesRoot(), episodeId);
  const originals = await loadImportedOriginalPaths(episodeId);
  const source = originals[track.sourceAssetId as keyof typeof originals] ?? preferredAudioFile(folder, track.sourceAssetId);
  const before = await fs.stat(source);
  const signature = audioTreatmentSignature(track);
  const filters = createAudioTreatment(track).replace(/,$/, "");
  const identity = `${source}:${before.size}:${before.mtimeMs}:${before.ctimeMs}:${signature}:${filters}`;
  const key = `${client}:${episodeId}:${track.id}`;
  const prior = active.get(key);
  if (prior?.signature === identity) return prior.promise;
  prior?.controller.abort();
  const controller = new AbortController();
  const promise = (async () => {
    const hash = createHash("sha256").update(identity).digest("hex");
    const destination = path.join(folder, "Session", "Review", `audio-treatment-${hash}.flac`);
    if (!(await fs.stat(destination).then((stat) => stat.size > 0, () => false))) {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = path.join(path.dirname(destination), `.audio-treatment-${randomUUID()}.flac`);
      try {
        await runFfmpegWithProgress(["-y", "-i", source, "-vn", "-af", filters, "-c:a", "flac", "-sample_fmt", "s32", "-ar", "48000", temporary], { durationMs: await getMediaDurationMs(source), signal: controller.signal });
        controller.signal.throwIfAborted();
        if (!await validatePlayableMedia(temporary, undefined, { audio: true, decode: true, signal: controller.signal })) throw new Error("Processed review audio could not be verified.");
        const after = await fs.stat(source);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Audio source changed while preparing its preview.");
        controller.signal.throwIfAborted();
        await fs.rename(temporary, destination);
      } finally { await fs.rm(temporary, { force: true }); }
    }
    controller.signal.throwIfAborted();
    return { trackId: track.id, sourceAssetId: track.sourceAssetId!, signature, playbackUrl: mediaFilePlaybackUrl(destination) };
  })().finally(() => { if (active.get(key)?.controller === controller) active.delete(key); });
  active.set(key, { folder, controller, signature: identity, promise });
  return promise;
}
