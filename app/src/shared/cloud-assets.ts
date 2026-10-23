import type { CollaborationAssetManifestEntry } from "./collaboration";

/** Local names never double as cloud object identity. Old manifests remain readable. */
export function cloudAssetPath(
  episodeId: string,
  asset: Pick<CollaborationAssetManifestEntry, "relativePath" | "cloudPath">,
) {
  const prefix = `episodes/${episodeId}/`;
  const relative = asset.cloudPath?.startsWith(prefix)
    ? asset.cloudPath.slice(prefix.length)
    : asset.relativePath;
  if (
    !relative ||
    relative.startsWith("/") ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid cloud asset path.");
  return `/episodes/${encodeURIComponent(episodeId)}/assets/${encodeURIComponent(relative)}`;
}
