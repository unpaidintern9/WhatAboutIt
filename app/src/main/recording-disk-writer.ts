import fs from "node:fs/promises";
import path from "node:path";
import { durableAppend, durableJson } from "./durable-file";

const sources = new Map<string, Promise<unknown>>();
const backupStates = new Map<
  string,
  {
    destination: string;
    queue: Promise<void>;
    pending: number;
    warning?: string;
  }
>();
const volumes = new Map<string, { at: number; available: number }>();

export async function serializeSourceWrite<T>(
  source: string,
  operation: () => Promise<T>,
) {
  const previous = sources.get(source) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  sources.set(source, next);
  try {
    return await next;
  } finally {
    if (sources.get(source) === next) sources.delete(source);
  }
}
/** Finalization must not rename a source while a protected append is in flight. */
export async function waitForRecordingWrites(folder: string, timeoutMs = 10000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drain = async () => {
    while (true) {
      const pending = [...sources.entries()].filter(([source]) => source.startsWith(`${folder}:`)).map(([, work]) => work);
      if (!pending.length) return;
      await Promise.allSettled(pending);
    }
  };
  try { await Promise.race([drain(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Recording writes are still pending. Wait for the drive, then retry saving; recovery files remain in place.")), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
export async function assertRecordingCapacity(folder: string, bytes: number) {
  let capacity = volumes.get(folder);
  if (!capacity || Date.now() - capacity.at > 2000) {
    const stat = await fs.statfs(folder);
    capacity = {
      at: Date.now(),
      available: Number(stat.bavail) * Number(stat.bsize),
    };
    volumes.set(folder, capacity);
  }
  if (capacity.available < bytes + 128 * 1024 * 1024)
    throw new Error(
      "Recording drive is nearly full. Capture paused to preserve recovery space.",
    );
  capacity.available -= bytes;
}
export async function configureRollingBackup(
  folder: string,
  destination?: string,
) {
  if (!destination) return;
  const state = {
    destination,
    queue: Promise.resolve(),
    pending: 0,
    warning: undefined as string | undefined,
  };
  backupStates.set(folder, state);
  try {
    for (const name of ["Program", "Cameras", "Audio", "Session", "Logs"])
      await fs.mkdir(path.join(destination, name), { recursive: true });
    for (const name of [
      "recording-session.json",
      "device-map.json",
      "sync-metadata.json",
      "recording-state.json",
    ]) {
      const value = await fs
        .readFile(path.join(folder, "Session", name), "utf8")
        .then(
          (text) => JSON.parse(text),
          () => undefined,
        );
      if (value)
        await durableJson(
          path.join(destination, "Session", name),
          name === "recording-session.json"
            ? {
                ...value,
                folderPath: destination,
                captureFolderPath: destination,
                backupFolderPath: undefined,
              }
            : value,
        );
    }
    const session = JSON.parse(
      await fs.readFile(
        path.join(folder, "Session", "recording-session.json"),
        "utf8",
      ),
    );
    await durableJson(path.join(destination, "metadata.json"), {
      id: path.basename(destination),
      title: session.episodeTitle,
      status: "draft",
      folderPath: destination,
      createdAt: session.startedAt,
      updatedAt: session.startedAt,
      phase: "phase-1-shell",
    });
  } catch (error) {
    state.warning = `Second-drive backup could not start: ${String(error)}`;
  }
}
export function queueRollingBackup(
  folder: string,
  relativeFile: string,
  bytes: Uint8Array,
  manifest: unknown,
) {
  const state = backupStates.get(folder);
  if (!state || state.warning) return;
  if (state.pending + bytes.length > 32 * 1024 * 1024) {
    state.warning =
      "Second-drive backup is too slow. Primary recording remains protected; check the backup drive.";
    return;
  }
  state.pending += bytes.length;
  state.queue = state.queue
    .then(async () => {
      const destination = path.join(state.destination, relativeFile);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await durableAppend(destination, bytes);
      const copy = structuredClone(manifest) as {
        sources?: Record<string, { partialPath: string }>;
      };
      for (const source of Object.values(copy.sources ?? {}))
        source.partialPath = path.join(
          state.destination,
          path.relative(folder, source.partialPath),
        );
      await durableJson(
        path.join(state.destination, "Session", "capture-manifest.json"),
        copy,
      );
    })
    .catch((error) => {
      state.warning = `Second-drive backup needs attention: ${String(error)}`;
    })
    .finally(() => {
      state.pending -= bytes.length;
    });
}
export async function finishRollingBackup(folder: string) {
  const state = backupStates.get(folder);
  await state?.queue;
  backupStates.delete(folder);
  volumes.delete(folder);
  return state?.warning;
}
export function rollingBackupWarning(folder: string) {
  return backupStates.get(folder)?.warning;
}
