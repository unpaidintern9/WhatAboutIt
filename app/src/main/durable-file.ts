import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
    await fs.rename(temporary, file);
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
    await fs.rm(temporary, { force: true });
  }
}
