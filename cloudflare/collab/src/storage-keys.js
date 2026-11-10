/** Preserve the uploader's canonical encoding for every individual R2 path segment. */
export function episodeAssetKey(episodeId, relativePath) {
  const cleaned = relativePath.split("/").filter(Boolean).map(part => encodeURIComponent(part)).join("/");
  if (!cleaned) throw new Error("Asset path is required.");
  return `episodes/${episodeId}/${cleaned}`;
}
