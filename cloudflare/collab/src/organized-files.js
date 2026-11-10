import { verifyStoredObject } from "./bounded-verification.js";
import { completeRecoveredUpload } from "./upload-status.js";

const json = (value, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const read = async (bucket, key) => { const object = await bucket.get(key); return { object, value: object ? await object.json() : undefined }; };

export function organizedPath(relativePath, folder) {
  const parts = relativePath.split("/");
  if (!parts.length || parts.some(p => !p || p === "." || p === "..") || !/^[A-Za-z0-9_-]{1,100}$/.test(folder)) throw new Error("Invalid organized file path.");
  const category = parts.length > 1 ? parts.shift() : "Project";
  return `${category}/versions/${folder}/${parts.join("/")}`;
}

/** Organize an already verified backup using R2 streaming copies, never desktop retransfers. */
export async function handleOrganization(request, bucket, episodeId, identity, publish) {
  try {
    const url = new URL(request.url), operationId = url.searchParams.get("operationId");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(operationId || "")) return json({ error: "A valid upload operation is required." }, 400);
    const { value: status } = await read(bucket, `episodes/${episodeId}/upload-logs/${operationId}.json`);
    if (!status || status.owner !== identity) return json({ error: "Upload operation belongs to another editor." }, 403);
    if (status.phase !== "complete" || status.verification !== "manifest-verified") return json({ error: "Publish and verify the original backup before organizing its files." }, 409);
    const key = `upload-organizations/${episodeId}/${operationId}.json`;
    let { value: plan } = await read(bucket, key);
    const { object: currentObject, value: current } = await read(bucket, `episodes/${episodeId}/manifest.json`);
    if (!plan) {
      if (current?.revisionId !== status.manifestRevisionId || current.uploadOperationId !== operationId) return json({ error: "The cloud project changed. Its current files were preserved." }, 409);
      const folder = `${new Date(status.startedAt).toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")}Z_${operationId.slice(0, 8)}`;
      const manifest = { ...current, revisionId: crypto.randomUUID(), parentRevisionId: current.revisionId, assets: current.assets.map(asset => ({ ...asset, cloudPath: `episodes/${episodeId}/${organizedPath(asset.relativePath, folder)}` })) };
      if (new Set(manifest.assets.map(asset => asset.relativePath)).size !== manifest.assets.length) throw new Error("Duplicate backup paths cannot be organized safely.");
      plan = { operationId, sourceRevisionId: current.revisionId, sourceAssets: current.assets, manifest };
      const saved = await bucket.put(key, JSON.stringify(plan), { onlyIf: new Headers({ "if-none-match": "*" }), httpMetadata: { contentType: "application/json" } });
      if (!saved) plan = (await read(bucket, key)).value;
    }
    if (![plan.sourceRevisionId, plan.manifest.revisionId].includes(current?.revisionId)) return json({ error: "The cloud project changed during organization. All original files were preserved." }, 409);
    if (request.method === "GET") return json({ operationId, files: plan.manifest.assets.map(asset => ({ relativePath: asset.relativePath, bytes: asset.bytes })), published: current.revisionId === plan.manifest.revisionId });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const relativePath = url.searchParams.get("relativePath");
    if (!relativePath) {
      if (current.revisionId !== plan.manifest.revisionId) {
        const result = await publish(plan.manifest, currentObject.httpEtag);
        if (!result.ok) return result;
      }
      const status = await completeRecoveredUpload(bucket, episodeId, operationId, plan.manifest.revisionId, identity, "Backup files organized into dated folders and verified.");
      return json({ ok: true, published: true, files: plan.manifest.assets.length, status });
    }
    const asset = plan.manifest.assets.find(asset => asset.relativePath === relativePath);
    const source = plan.sourceAssets.find(asset => asset.relativePath === relativePath);
    if (!asset || !source) return json({ error: "File is outside this reviewed backup." }, 404);
    if (asset.bytes > 5 * 1024 ** 3) return json({ error: "This file exceeds R2's single-copy limit; its original verified copy was preserved." }, 409);
    const targetKey = asset.cloudPath;
    let target = await bucket.head(targetKey);
    if (!target) {
      const sourceKey = source.cloudPath || `episodes/${episodeId}/${source.relativePath}`;
      const original = await bucket.get(sourceKey);
      const { value: receipt } = await read(bucket, `verification/${sourceKey}`);
      if (!original?.body || original.size !== asset.bytes || receipt?.etag !== original.httpEtag || receipt.sha256 !== asset.contentHash) throw new Error("The original backup file is not checksum-verified.");
      const stored = await bucket.put(targetKey, original.body, { sha256: asset.contentHash, onlyIf: new Headers({ "if-none-match": "*" }), httpMetadata: original.httpMetadata, customMetadata: original.customMetadata });
      target = stored || await bucket.head(targetKey);
    }
    if (!target || (target.size !== undefined && target.size !== asset.bytes)) throw new Error("The organized file has an unexpected size.");
    const verified = await verifyStoredObject(bucket, targetKey, { ...target, size: asset.bytes }, asset.contentHash, false);
    if (!verified.verified) throw new Error("The organized file failed SHA-256 verification.");
    return json({ ok: true, relativePath, bytes: asset.bytes });
  } catch (error) { return json({ error: error.message }, 503); }
}
