import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isProjectCollaborationAsset, type CollaborationAssetManifestEntry } from "../shared/collaboration";

export type CollaborationUploadSource = {
  asset: CollaborationAssetManifestEntry;
  absolutePath: string;
};

function localAssetPath(episodeFolder: string, relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) throw new Error("Upload contains an unsafe asset path.");
  const root = path.resolve(episodeFolder);
  const resolved = path.resolve(root, ...normalized.split("/"));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Upload asset escaped its episode folder.");
  return resolved;
}

export async function prepareCollaborationUploadSources(
  episodeFolder: string,
  assets: CollaborationAssetManifestEntry[],
  snapshotFolder: string
): Promise<CollaborationUploadSource[]> {
  await fs.mkdir(snapshotFolder, { recursive: true });
  return Promise.all(assets.map(async (asset) => {
    const absolutePath = localAssetPath(episodeFolder, asset.relativePath);
    if (!isProjectCollaborationAsset(asset.kind)) return { asset, absolutePath };

    // Project JSON/captions can change while an upload is running. Upload an
    // immutable byte snapshot so the object and published manifest can never drift.
    const bytes = await fs.readFile(absolutePath);
    const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
    const snapshotPath = path.join(snapshotFolder, `${asset.id}-${crypto.randomUUID()}.snapshot`);
    await fs.writeFile(snapshotPath, bytes);
    return {
      asset: { ...asset, bytes: bytes.length, contentHash },
      absolutePath: snapshotPath
    };
  }));
}
