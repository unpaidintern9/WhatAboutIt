export const recordedMedia = asset => ["program-video", "original-video", "original-audio"].includes(asset.kind);
export const recordingFingerprint = assets => JSON.stringify(assets.filter(recordedMedia).map(a => [a.relativePath, a.contentHash, a.bytes]).sort((a, b) => a[0].localeCompare(b[0])));
export async function saveFullBackupProof(bucket, episodeId, manifest) {
  if (!manifest.assets.some(recordedMedia)) return;
  const key = `_system/last-full-backup/${episodeId}.json`;
  const object = await bucket.get(key), previous = object ? await object.json() : undefined;
  const fingerprint = recordingFingerprint(manifest.assets);
  if (previous?.fingerprint === fingerprint) return;
  await bucket.put(key, JSON.stringify({ episodeId, revisionId: manifest.revisionId, fingerprint, verifiedAt: new Date().toISOString() }), { httpMetadata: { contentType: "application/json" } });
}
