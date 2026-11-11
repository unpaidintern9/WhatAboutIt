import fs from "node:fs/promises";
import path from "node:path";
import { buildEpisodeAssetManifest } from "./collaboration-asset-index";
import { loadCollaborationWorkspace } from "./collaboration-store";

export async function readEpisodeCollaborationInventory(folder: string, episodeId: string, title: string) {
  const workspace = await loadCollaborationWorkspace(folder, episodeId, title);
  const indexed = await buildEpisodeAssetManifest(folder, episodeId);
  const previous = new Map(workspace.assets.map(asset => [asset.relativePath, asset]));
  const assets = indexed.map(asset => {
    const saved = previous.get(asset.relativePath);
    return saved && saved.contentHash === asset.contentHash ? { ...asset, state: saved.state, cloudPath: saved.cloudPath } : asset;
  });
  let durationMs: number | undefined;
  for (const file of ["recording-parts.json", "recording-session.json", "proxy-catalog.json"]) {
    try {
      const value = JSON.parse(await fs.readFile(path.join(folder, "Session", file), "utf8"));
      const duration = file.includes("parts") ? value.parts?.reduce((sum: number, part: { durationMs?: number }) => sum + (part.durationMs || 0), 0) : file.includes("catalog") ? Math.max(0, ...(value.assets || []).map((asset: { durationMs?: number }) => asset.durationMs || 0)) : value.elapsedMs;
      if (Number.isFinite(duration) && duration > 0) { durationMs = duration; break; }
    } catch { /* Unknown duration is displayed explicitly rather than inferred from bytes. */ }
  }
  // Reading the inventory must not rewrite workspace.json and create a false edit.
  return { ...workspace, assets, inventoryScanned: true, durationMs };
}
