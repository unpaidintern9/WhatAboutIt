import { durableJson } from "./durable-file";
import { scheduleMediaWork, waitForMediaBudget } from "./media-work-scheduler";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { isInternalCollaborationAssetPath, shouldIncludeCollaborationAsset, type CollaborationAssetKind, type CollaborationAssetManifestEntry, type CollaborationUploadSelection } from "../shared/collaboration";

const ignoredTopLevel = new Set(["Logs", "Reports"]);

export function classifyCollaborationAsset(relativePath: string): { kind: CollaborationAssetKind; localOriginal: boolean } {
  const normalized = relativePath.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  if (lower.includes(".partial.") || lower.endsWith(".tmp") || /\/\.assembly-/.test(lower)) return { kind: "other", localOriginal: true };
  if (/^recordings\/[^/]+\/(program|cameras|audio)\//.test(lower)) return { kind: lower.includes("/audio/") ? "original-audio" : "original-video", localOriginal: true };
  if (lower.startsWith("session/proxies/") || /^session\/review\/.*-review\.(webm|mp4|m4a)$/.test(lower)) return { kind: "proxy-video", localOriginal: false };
  if (lower === "session/proxy-catalog.json") return { kind: "metadata", localOriginal: false };
  if (lower === "metadata.json") return { kind: "metadata", localOriginal: false };
  if (lower.includes("collaboration/workspace.json")) return { kind: "comments", localOriginal: false };
  if (lower.includes("timeline") && lower.endsWith(".json")) return { kind: "timeline", localOriginal: false };
  if (lower.includes("caption") && (lower.endsWith(".json") || lower.endsWith(".vtt") || lower.endsWith(".srt"))) return { kind: "captions", localOriginal: false };
  if (lower.includes("marker") && lower.endsWith(".json")) return { kind: "markers", localOriginal: false };
  if (lower.startsWith("exports/")) return { kind: "export", localOriginal: false };
  if (lower === "program/program.webm") return { kind: "program-video", localOriginal: true };
  if (lower.includes("proxy") || lower.includes("editing")) return { kind: "proxy-video", localOriginal: false };
  if (lower.startsWith("cameras/") || lower.startsWith("program/")) return { kind: "original-video", localOriginal: true };
  if (lower.startsWith("audio/")) return { kind: "original-audio", localOriginal: true };
  return { kind: "other", localOriginal: false };
}

async function walk(root: string, relative = ""): Promise<string[]> {
  const absolute = path.join(root, relative);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!relative && ignoredTopLevel.has(entry.name)) continue;
    if (!relative && entry.name === "Backup") continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, next)));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}

async function sha256(filePath: string) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath, { highWaterMark: 256 * 1024 })) {
    await waitForMediaBudget();
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function buildEpisodeAssetManifest(episodeFolder: string, episodeId: string, selection?: CollaborationUploadSelection): Promise<CollaborationAssetManifestEntry[]> {
  const now = new Date().toISOString();
  const cachePath = path.join(episodeFolder, "Session", "asset-hashes.json");
  const cache = await fs.readFile(cachePath, "utf8").then((text) => JSON.parse(text) as Record<string, { signature: string; hash: string }>, () => ({} as Record<string, { signature: string; hash: string }>));
  const files = await walk(episodeFolder);
  const manifest: CollaborationAssetManifestEntry[] = [];
  for (const relativePath of files) {
    if (isInternalCollaborationAssetPath(relativePath)) continue;
    if (relativePath.replaceAll("\\", "/").split("/").some((part) => part.startsWith(".")) || /\.partial\.|\.tmp$/.test(relativePath)) continue;
    const absolutePath = path.join(episodeFolder, relativePath);
    const classified = classifyCollaborationAsset(relativePath);
    if (selection && !shouldIncludeCollaborationAsset(classified.kind, selection)) continue;
    const stat = await fs.stat(absolutePath);
    const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const normalized = relativePath.replaceAll("\\", "/");
    const cached = classified.localOriginal && cache[normalized]?.signature === signature ? cache[normalized].hash : undefined;
    const hash = cached ?? await scheduleMediaWork(() => sha256(absolutePath));
    const after = await fs.stat(absolutePath);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error(`Wait for recording to finish before uploading ${normalized}.`);
    cache[normalized] = { signature, hash };
    manifest.push({
      id: crypto.createHash("sha1").update(relativePath.replaceAll("\\", "/")).digest("hex"),
      kind: classified.kind,
      relativePath: relativePath.replaceAll("\\", "/"),
      localOriginal: classified.localOriginal,
      cloudPath: `episodes/${episodeId}/${relativePath.replaceAll("\\", "/")}`,
      contentHash: hash,
      bytes: stat.size,
      state: "local-only",
      updatedAt: now
    });
  }
  await durableJson(cachePath, cache);
  return manifest.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
