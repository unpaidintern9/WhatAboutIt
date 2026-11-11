import { recordedMedia as media, recordingFingerprint as fingerprint, saveFullBackupProof } from "./backup-proof.js";
import { episodeAssetKey } from "./storage-keys.js";

const json = (value, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const read = async (bucket, key) => { const object = await bucket.get(key); return { object, value: object ? await object.json() : undefined }; };
const hex = value => [...new Uint8Array(value)].map(b => b.toString(16).padStart(2, "0")).join("");


export function visibleFiles(assets) {
  return assets.flatMap(asset => {
    const name = asset.relativePath;
    if (/^(Audio|Cameras|Program)\/[^/]+\.(webm|mp4|mov|wav|flac|m4a|mp3)$/i.test(name)) return [{ ...asset, path: name, label: name.split("/").at(-1), type: "original" }];
    if (/^Session\/Proxies\/[^/]+\.(mp4|m4a|webm)$/.test(name)) return [{ ...asset, path: "Review/" + name.split("/").at(-1), label: name.split("/").at(-1), type: "review" }];
    if (name.startsWith("Exports/") && /\.(mp4|webm|mov|wav|flac|mp3|m4a)$/i.test(name)) return [{ ...asset, path: name, label: name.split("/").at(-1), type: "export" }];
    return [];
  });
}
async function matches(bucket, key, object, asset) {
  if (!object || object.size !== asset.bytes) return false;
  if (object.checksums?.sha256) return hex(object.checksums.sha256) === asset.contentHash;
  const { value: receipt } = await read(bucket, `verification/${key}`);
  return receipt?.etag === object.httpEtag && receipt.sha256 === asset.contentHash;
}
async function duration(bucket, episodeId, assets) {
  for (const name of ["Session/recording-parts.json", "Session/recording-session.json", "Session/proxy-catalog.json"]) {
    const asset = assets.find(a => a.relativePath === name && a.bytes <= 256 * 1024);
    if (!asset) continue;
    try {
      const key = episodeAssetKey(episodeId, asset.cloudPath?.slice(`episodes/${episodeId}/`.length) || name);
      const { value } = await read(bucket, key);
      const ms = name.includes("parts") ? value?.parts?.reduce((sum, p) => sum + (p.durationMs || 0), 0) : name.includes("catalog") ? Math.max(0, ...(value?.assets || []).map(a => a.durationMs || 0)) : value?.elapsedMs;
      if (Number.isFinite(ms) && ms > 0) return ms;
    } catch { /* Missing legacy duration does not imply a short or missing recording. */ }
  }
}

export async function handleCurrentFiles(request, bucket, episodeId) {
  try {
    const url = new URL(request.url), root = `episodes/${episodeId}/`;
    const { value: manifest } = await read(bucket, root + "manifest.json");
    if (!manifest) return json({ error: "This episode has no published cloud files." }, 404);
    const assets = manifest.assets || [], visible = visibleFiles(assets);
    const { value: catalog } = await read(bucket, root + "current-files.json");
    const { value: upload } = await read(bucket, root + "upload-status.json");
    const { value: proof } = await read(bucket, `_system/last-full-backup/${episodeId}.json`);
    let fullBackupVerified = Boolean((manifest.uploadSelection === "full-backup" || proof?.fingerprint === fingerprint(assets)) && assets.some(media));
    if (upload?.selection === "full-backup" && upload.phase === "complete" && upload.verification === "manifest-verified") {
      const snapshot = manifest.revisionId === upload.manifestRevisionId ? manifest : (await read(bucket, `episode-history/${episodeId}/${encodeURIComponent(upload.manifestRevisionId)}.json`)).value;
      fullBackupVerified ||= Boolean(snapshot && snapshot.assets.some(media) && fingerprint(snapshot.assets) === fingerprint(assets));
    }
    const catalogCurrent = catalog?.sourceFingerprint === JSON.stringify(visible.map(a => [a.relativePath, a.contentHash, a.bytes]));
    if (request.method === "GET") return json({ episodeId, revisionId: manifest.revisionId, assetCount: assets.length, totalBytes: assets.reduce((sum, a) => sum + a.bytes, 0), originalCount: assets.filter(media).length, recordedAssets: assets.filter(media).map(a => ({ relativePath: a.relativePath, contentHash: a.contentHash, bytes: a.bytes })), reviewCount: assets.filter(a => a.kind === "proxy-video").length, fullBackupVerified, durationMs: await duration(bucket, episodeId, assets), currentFilesReady: Boolean(catalogCurrent), files: visible.map(a => ({ relativePath: a.relativePath, label: a.label, type: a.type, bytes: a.bytes, contentHash: a.contentHash, path: catalogCurrent ? catalog.files.find(f => f.relativePath === a.relativePath)?.path : a.path })) });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const requested = url.searchParams.get("relativePath");
    const files = [];
    let copied = false;
    for (const asset of visible) {
      if (requested && asset.relativePath !== requested) continue;
      const stateKey = `_system/current-files/${episodeId}/${encodeURIComponent(asset.relativePath)}.json`;
      const { value: previous } = await read(bucket, stateKey);
      let path = previous?.path || asset.path;
      let key = episodeAssetKey(episodeId, path), object = await bucket.head(key);
      let matched = await matches(bucket, key, object, asset);
      // Never replace a pre-existing, unmanaged legacy recording. Use an obvious
      // current-file name instead; immutable source versions remain authoritative.
      if ((!previous || !previous.owned) && object && !matched) {
        const parts = path.split("/"); parts[parts.length - 1] = "Latest-" + parts.at(-1); path = parts.join("/");
        key = episodeAssetKey(episodeId, path); object = await bucket.head(key); matched = await matches(bucket, key, object, asset);
        if (object && !matched) throw new Error("A current-file name is already used by another file. The original was preserved.");
      }
      if (requested && !matched) {
        if (object && previous?.etag !== object.httpEtag) throw new Error("The current file changed outside Studio. Its bytes were preserved.");
        if (asset.bytes > 5 * 1024 ** 3) throw new Error("This file exceeds R2's single-copy limit. Its verified backup is still available.");
        const sourceKey = episodeAssetKey(episodeId, asset.cloudPath?.slice(root.length) || asset.relativePath);
        const source = await bucket.get(sourceKey);
        if (!source?.body || source.size !== asset.bytes) throw new Error("The source backup is missing or changed size.");
        const { value: latest } = await read(bucket, root + "manifest.json");
        if (!latest?.assets?.some(a => a.relativePath === asset.relativePath && a.contentHash === asset.contentHash && a.bytes === asset.bytes)) {
          await source.body.cancel();
          return json({ error: "The recording changed while preparing its current file. Retry the latest recording." }, 409);
        }
        const written = await bucket.put(key, source.body, { sha256: asset.contentHash, onlyIf: new Headers(object ? { "if-match": object.httpEtag } : { "if-none-match": "*" }), httpMetadata: source.httpMetadata, customMetadata: { ...source.customMetadata, studioCurrentFile: "true" } });
        copied = Boolean(written);
        object = await bucket.head(key);
        matched = await matches(bucket, key, object, asset);
        if (!matched) throw new Error("The current file was not checksum-verified. Retry safely.");
        await bucket.put(`verification/${key}`, JSON.stringify({ sha256: asset.contentHash, etag: object.httpEtag, size: asset.bytes }));
      }
      if (!matched) return json({ error: "Some readable files are still being prepared.", relativePath: asset.relativePath }, 409);
      if (requested && (!previous || previous.etag !== object.httpEtag || previous.path !== path)) await bucket.put(stateKey, JSON.stringify({ path, etag: object.httpEtag, sha256: asset.contentHash, owned: copied || previous?.owned || object.customMetadata?.studioCurrentFile === "true" }), { httpMetadata: { contentType: "application/json" } });
      files.push({ relativePath: asset.relativePath, path, contentHash: asset.contentHash, bytes: asset.bytes, label: asset.label, type: asset.type });
    }
    if (requested) return files.length ? json({ ok: true, ...files[0], copiedBytes: copied ? files[0].bytes : 0 }) : json({ error: "File is outside this episode's media list." }, 404);
    const { value: current } = await read(bucket, root + "manifest.json");
    if (JSON.stringify(visibleFiles(current?.assets || []).map(a => [a.relativePath, a.contentHash, a.bytes])) !== JSON.stringify(visible.map(a => [a.relativePath, a.contentHash, a.bytes]))) return json({ error: "The recording changed during publication. Retry using its latest files." }, 409);
    const result = { episodeId, revisionId: current.revisionId, sourceFingerprint: JSON.stringify(visible.map(a => [a.relativePath, a.contentHash, a.bytes])), files, ready: true, updatedAt: new Date().toISOString() };
    if (fullBackupVerified) await saveFullBackupProof(bucket, episodeId, current);
    await bucket.put(root + "current-files.json", JSON.stringify(result), { httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
    return json({ ok: true, ready: true, files: files.length });
  } catch (error) { return json({ error: error.message }, 503); }
}
