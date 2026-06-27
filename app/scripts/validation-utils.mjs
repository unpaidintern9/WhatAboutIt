import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function listFiles(root, extension = "") {
  const results = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "release") continue;
    if (entry.isDirectory()) {
      results.push(...(await listFiles(fullPath, extension)));
    } else if (!extension || entry.name.endsWith(extension)) {
      results.push(fullPath);
    }
  }

  return results;
}

export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function fail(message) {
  throw new Error(message);
}

