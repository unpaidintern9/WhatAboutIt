import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { CollaborationAssetKind, CollaborationAssetManifestEntry } from "../shared/collaboration";

const ignoredTopLevel = new Set(["Logs", "Reports"]);

export function classifyCollaborationAsset(relativePath: string): { kind: CollaborationAssetKind; localOriginal: boolean } {
  const normalized = relativePath.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  if (lower === "metadata.json") return { kind: "metadata", localOriginal: false };
  if (lower.includes("collaboration/workspace.json")) return { kind: "comments", localOriginal: false };
  if (lower.includes("timeline") && lower.endsWith(".json")) return { kind: "timeline", localOriginal: false };
  if (lower.includes("caption") && (lower.endsWith(".json") || lower.endsWith(".vtt") || lower.endsWith(".srt"))) return { kind: "captions", localOriginal: false };
  if (lower.includes("marker") && lower.endsWith(".json")) return { kind: "markers", localOriginal: false };
  if (lower.startsWith("exports/")) return { kind: "export", localOriginal: false };
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
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export async function buildEpisodeAssetManifest(episodeFolder: string, episodeId: string): Promise<CollaborationAssetManifestEntry[]> {
  const now = new Date().toISOString();
  const files = await walk(episodeFolder);
  const manifest: CollaborationAssetManifestEntry[] = [];
  for (const relativePath of files) {
    const absolutePath = path.join(episodeFolder, relativePath);
    const stat = await fs.stat(absolutePath);
    const classified = classifyCollaborationAsset(relativePath);
    manifest.push({
      id: crypto.createHash("sha1").update(relativePath.replaceAll("\\", "/")).digest("hex"),
      kind: classified.kind,
      relativePath: relativePath.replaceAll("\\", "/"),
      localOriginal: classified.localOriginal,
      cloudPath: `episodes/${episodeId}/${relativePath.replaceAll("\\", "/")}`,
      contentHash: await sha256(absolutePath),
      bytes: stat.size,
      state: "local-only",
      updatedAt: now
    });
  }
  return manifest.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
