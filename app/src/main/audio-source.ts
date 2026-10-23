import { existsSync } from "node:fs";
import path from "node:path";

/** Prefer lossless recordings while keeping every older episode readable. */
export function preferredAudioFile(folder: string, name: string) {
  const base = name.replace(/\.(m4a|flac|wav)$/i, "");
  for (const extension of ["flac", "wav", "m4a"]) {
    const file = path.join(folder, "Audio", `${base}.${extension}`);
    if (existsSync(file)) return file;
  }
  return path.join(folder, "Audio", `${base}.m4a`);
}
