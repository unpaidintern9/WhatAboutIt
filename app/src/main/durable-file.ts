import { logger } from "./logger";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const lockRetryDelaysMs = [20, 40, 80, 160, 320, 400, 400, 400];
/** Windows readers/scanners can briefly deny a rename even on a writable drive.
 * Retry only lock-like failures, for less than two seconds; never delete the
 * destination or replay a media append to work around a failed replacement.
 */
export async function withFileLockRetry<T>(operation: () => Promise<T>, details: Record<string, unknown> = {}): Promise<T> {
  let previousError: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await operation();
      if (attempt) void logger.warning("FileAccess", "Temporary file lock recovered.", { ...details, attempts: attempt + 1, retryDelayMs: lockRetryDelaysMs.slice(0, attempt).reduce((a, b) => a + b, 0), error: previousError });
      return result;
    }
    catch (error) {
      previousError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt >= lockRetryDelaysMs.length) {
        if (code !== "ENOENT") void logger.error("FileAccess", "File operation failed after retry handling.", { ...details, attempts: attempt + 1, error });
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, lockRetryDelaysMs[attempt]));
    }
  }
}
export function renameWithRetry(source: string, destination: string) {
  return withFileLockRetry(() => fs.rename(source, destination), { operation: "rename", sourcePath: source, destinationPath: destination });
}

export async function durableAppend(file: string, bytes: Uint8Array) {
  const handle = await fs.open(file, "a");
  try {
    await handle.writeFile(bytes);
    await handle.datasync();
  } finally {
    await handle.close();
  }
}

export async function durableJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx");
    try {
      await handle.writeFile(JSON.stringify(value, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temporary, file);
    // Windows does not support fsync on directory handles.
    if (process.platform !== "win32") {
      try {
        const directory = await fs.open(path.dirname(file), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } catch (error) {
        if (
          !["EINVAL", "ENOTSUP", "EPERM", "EISDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
  } finally {
    // A locked orphan temp must not hide the original save failure.
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}
