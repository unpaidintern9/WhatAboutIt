import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { getEpisodesRoot } from "./config-service";
import { mediaWorkStatus } from "./media-work-scheduler";
import type { RecordingDriveCheck } from "../shared/diagnostics";

let pending: Promise<RecordingDriveCheck> | undefined;
/** Bounded scratch write on the selected recording volume; never opens episode media. */
export async function checkRecordingDrive(): Promise<RecordingDriveCheck> {
  if (mediaWorkStatus().capturing > 0) throw new Error("Check the recording drive before starting capture.");
  if (pending) return pending;
  const work = measureDrive();
  pending = work;
  try { return await work; } finally { if (pending === work) pending = undefined; }
}
async function measureDrive(): Promise<RecordingDriveCheck> {
  const folder = getEpisodesRoot();
  await fs.mkdir(folder, { recursive: true });
  const target = path.join(folder, `.recording-drive-test-${randomUUID()}.tmp`);
  const handle = await fs.open(target, "wx");
  let bytes = 0;
  const started = performance.now();
  try {
    const block = randomBytes(4 * 1024 * 1024);
    for (let i = 0; i < 6; i++) {
      if (mediaWorkStatus().capturing > 0) throw new Error("Drive test stopped because recording started.");
      await handle.writeFile(block);
      await handle.datasync();
      bytes += block.byteLength;
      if (performance.now() - started > 3000) break;
    }
    const durationMs = Math.max(1, performance.now() - started);
    if (getEpisodesRoot() !== folder) throw new Error("The recording drive changed during the test. Check the new drive before capture.");
    const stat = await fs.statfs(folder);
    return { folder, checkedAt: new Date().toISOString(), testedBytes: bytes, durationMs, writeBytesPerSecond: bytes * 1000 / durationMs, availableBytes: Number(stat.bavail) * Number(stat.bsize) };
  } finally {
    await handle.close();
    await fs.rm(target, { force: true });
  }
}
