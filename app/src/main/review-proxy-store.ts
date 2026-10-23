import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { microphoneSlots } from "../shared/audio-tracks";
import { preferredAudioFile } from "./audio-source";
import {
  getMediaDurationMs,
  runFfmpegWithProgress,
  validatePlayableMedia,
} from "./ffmpeg-tools";
import { durableJson } from "./durable-file";

export interface ReviewProxyEntry {
  id: string;
  relativePath: string;
  durationMs: number;
  sourceBytes: number;
  sourceMtime: number;
}
const pending = new Map<string, Promise<ReviewProxyEntry[]>>();
const controllers = new Map<string, AbortController>();

export async function prepareEpisodeReviewProxies(
  folder: string,
  signal?: AbortSignal,
  progress?: (message: string) => void,
) {
  const prior = pending.get(folder);
  if (prior) return prior;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  controllers.set(folder, controller);
  const work = generate(folder, controller.signal, progress);
  pending.set(folder, work);
  try {
    return await work;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (pending.get(folder) === work) {
      pending.delete(folder);
      controllers.delete(folder);
    }
  }
}
async function generate(
  folder: string,
  signal?: AbortSignal,
  progress?: (message: string) => void,
) {
  const catalogPath = path.join(folder, "Session", "proxy-catalog.json");
  const catalog: ReviewProxyEntry[] = await fs
    .readFile(catalogPath, "utf8")
    .then(
      (text) => JSON.parse(text).assets ?? [],
      () => [],
    );
  const sources = [
    {
      id: "program",
      file: path.join(folder, "Program", "program.webm"),
      video: true,
    },
    ...[1, 2, 3].map((number) => ({
      id: `camera-${number}`,
      file: path.join(folder, "Cameras", `camera-${number}.webm`),
      video: true,
    })),
    ...microphoneSlots.map(({ assetId }) => ({
      id: assetId,
      file: preferredAudioFile(folder, assetId),
      video: false,
    })),
  ];
  const result: ReviewProxyEntry[] = [];
  for (const source of sources) {
    signal?.throwIfAborted();
    const stat = await fs.stat(source.file).catch(() => undefined);
    if (!stat?.isFile() || stat.size === 0) continue;
    const relativePath = `Session/Proxies/${source.id}-review.${source.video ? "mp4" : "m4a"}`;
    const destination = path.join(folder, relativePath);
    const previous = catalog.find(
      (entry) =>
        entry.id === source.id &&
        entry.sourceBytes === stat.size &&
        entry.sourceMtime === stat.mtimeMs,
    );
    if (
      previous &&
      (await fs.stat(destination).then(
        (item) => item.size > 0,
        () => false,
      ))
    ) {
      result.push(previous);
      continue;
    }
    progress?.(`Preparing a smaller review copy: ${source.id}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = path.join(
      path.dirname(destination),
      `.${randomUUID()}${path.extname(destination)}`,
    );
    const durationMs = await getMediaDurationMs(source.file);
    try {
      await runFfmpegWithProgress(
        [
          "-y",
          "-i",
          source.file,
          ...(source.video
            ? [
                "-map",
                "0:v:0",
                ...(source.id === "program" ? ["-map", "0:a:0?"] : ["-an"]),
                "-vf",
                "scale=trunc(min(1280\\,iw)/2)*2:-2",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "26",
                "-maxrate",
                "2M",
                "-bufsize",
                "4M",
                "-pix_fmt",
                "yuv420p",
              ]
            : ["-map", "0:a:0", "-vn"]),
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          temporary,
        ],
        { durationMs, signal },
      );
      if (
        !(await validatePlayableMedia(temporary, undefined, {
          video: source.video,
          audio: !source.video || source.id === "program",
          decode: true,
        }))
      )
        throw new Error(`Review copy failed verification: ${source.id}`);
      const after = await fs.stat(source.file);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
        throw new Error(
          "Recording media changed while preparing review copies. Retry after it finishes saving.",
        );
      await fs.rename(temporary, destination);
      result.push({
        id: source.id,
        relativePath,
        durationMs,
        sourceBytes: stat.size,
        sourceMtime: stat.mtimeMs,
      });
      await durableJson(catalogPath, { version: 1, assets: result });
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  return result;
}

export async function cancelEpisodeReviewProxies(folder: string) {
  controllers.get(folder)?.abort(new Error("Review copies cancelled"));
  await pending.get(folder)?.catch(() => undefined);
}

export async function cancelAllReviewProxyWork() {
  for (const controller of controllers.values())
    controller.abort(new Error("Review copies cancelled"));
  await Promise.allSettled([...pending.values()]);
}
