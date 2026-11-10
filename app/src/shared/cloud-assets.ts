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


export function isVersionedCloudPath(value: string) {
  return /(?:^|\/)(?:objects|versions)\//.test(value);
}

export function organizedCloudObjectPath(relativePath: string, folder: string) {
  const parts = relativePath.split("/");
  if (parts.some(part => !part || part === "." || part === "..") || !/^[A-Za-z0-9_-]{1,100}$/.test(folder)) throw new Error("Invalid organized cloud file path.");
  const category = parts.length > 1 ? parts.shift()! : "Project";
  return `${category}/versions/${folder}/${parts.join("/")}`;
}
