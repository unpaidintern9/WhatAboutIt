const phases = new Set(["preparing", "transferring", "verifying", "committing", "complete", "cancelled", "error"]);
const selections = new Set(["project-only", "project-and-proxies", "full-backup"]);
const terminal = new Set(["complete", "cancelled", "error"]);
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;

function text(value, limit = 300) {
  return String(value || "").replace(/https?:\/\/\S+|bearer\s+\S+|(?:access[_-]?key|authorization|token)\s*[:=]\s*\S+/gi, "[redacted]").slice(0, limit);
}

function counter(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid upload counter.");
  return value;
}

async function readInput(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Upload status body is required.");
  const chunks = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.length;
    if (length > 64 * 1024) { await reader.cancel(); throw new Error("Upload status is too large."); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function readObject(bucket, key) {
  const object = await bucket.get(key);
  return { etag: object?.httpEtag, value: object ? await object.json() : undefined };
}

async function writeLatest(bucket, key, status) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = await readObject(bucket, key);
    if (previous.value && (previous.value.startedAt > status.startedAt || (previous.value.operationId === status.operationId && previous.value.sequence >= status.sequence))) return;
    const onlyIf = new Headers(previous.etag ? { "if-match": previous.etag } : { "if-none-match": "*" });
    const written = await bucket.put(key, JSON.stringify(status), { onlyIf, httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
    if (written) return;
  }
  throw new Error("Upload status changed concurrently. Retry the status update.");
}

export async function handleUploadStatus(request, bucket, episodeId, identity, redactions = []) {
  const clean = (value, limit) => text(redactions.reduce((result, secret) => result.replaceAll(secret, "[redacted]"), String(value || "")), limit);
  const root = `episodes/${episodeId}/`;
  const operationId = new URL(request.url).searchParams.get("operationId");
  if (request.method === "GET") {
    if (operationId && !idPattern.test(operationId)) return response({ error: "Invalid upload operation." }, 400);
    const key = operationId ? `${root}upload-logs/${operationId}.json` : `${root}upload-status.json`;
    const stored = await readObject(bucket, key);
    if (!stored.value) return response({ error: "No upload progress has been reported by this version of Studio." }, 404);
    const status = stored.value;
    return response({ ...status, stale: !terminal.has(status.phase) && Date.now() > Date.parse(status.validUntil) });
  }
  if (request.method !== "PUT") return response({ error: "Method not allowed." }, 405);
  try {
    const input = await readInput(request);
    if (!idPattern.test(input.operationId) || !phases.has(input.phase) || !selections.has(input.selection)) throw new Error("Invalid upload status.");
    const sequence = counter(input.sequence);
    const totalBytes = counter(input.totalBytes), transferredBytes = counter(input.transferredBytes);
    const totalAssets = counter(input.totalAssets), completedAssets = counter(input.completedAssets);
    if (transferredBytes > totalBytes || completedAssets > totalAssets) throw new Error("Upload progress exceeds the planned total.");
    const key = `${root}upload-logs/${input.operationId}.json`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const previous = await readObject(bucket, key);
      if (previous.value?.owner && previous.value.owner !== identity) return response({ error: "Upload operation belongs to another editor." }, 403);
      if (previous.value && previous.value.selection !== input.selection) throw new Error("Upload mode cannot change within an operation.");
      if (previous.value && (previous.value.sequence >= sequence || terminal.has(previous.value.phase))) {
        const { events: _events, ...summary } = previous.value;
        await writeLatest(bucket, root + (summary.selection === "project-only" ? "project-upload-status.json" : "upload-status.json"), summary);
        return response({ ok: true, status: summary });
      }
      if (input.phase === "complete") {
        const manifest = await readObject(bucket, `${root}manifest.json`);
        if (!manifest.value || manifest.value.uploadOperationId !== input.operationId || manifest.value.revisionId !== input.manifestRevisionId || transferredBytes !== totalBytes || completedAssets !== totalAssets) return response({ error: "The completed upload has no matching published manifest." }, 409);
        const assets = manifest.value.assets || [];
        const hasProgramProxy = assets.some(asset => asset.relativePath.endsWith("/program-review.mp4"));
        const selected = input.selection === "full-backup" ? assets : assets.filter(asset => ["metadata", "timeline", "comments", "captions", "markers"].includes(asset.kind) || (input.selection === "project-and-proxies" && (asset.kind === "proxy-video" || (asset.kind === "program-video" && !hasProgramProxy))));
        if (selected.length !== totalAssets || selected.reduce((bytes, asset) => bytes + asset.bytes, 0) !== totalBytes) return response({ error: "Published files do not match the reported backup total." }, 409);
      }
      const now = Date.now();
      const status = {
        version: 1, episodeId, operationId: input.operationId, owner: identity,
        sequence, selection: input.selection, phase: input.phase,
        startedAt: previous.value?.startedAt || new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(), validUntil: new Date(now + 45_000).toISOString(),
        totalBytes, transferredBytes, totalAssets, completedAssets,
        bytesRemaining: totalBytes - transferredBytes,
        lastByteProgressAt: !previous.value || previous.value.transferredBytes !== transferredBytes ? new Date(now).toISOString() : previous.value.lastByteProgressAt,
        completionPercent: input.phase === "complete" ? 100 : totalBytes ? Math.min(99, Math.floor(transferredBytes / totalBytes * 100)) : null,
        remainingPercent: input.phase === "complete" ? 0 : totalBytes ? 100 - Math.min(99, Math.floor(transferredBytes / totalBytes * 100)) : null,
        verification: input.phase === "complete" ? "manifest-verified" : "client-reported",
        message: clean(input.message), relativePath: clean(input.relativePath, 1024),
        manifestRevisionId: input.phase === "complete" ? input.manifestRevisionId : undefined,
        logPath: key, eventCount: counter(input.eventCount),
        eventsOmitted: Math.max(0, input.eventCount - Math.min(100, Array.isArray(input.events) ? input.events.length : 0)),
        events: (Array.isArray(input.events) ? input.events.slice(-100) : []).map(event => ({ at: clean(event.at, 40), type: clean(event.type, 40), message: clean(event.message), relativePath: clean(event.relativePath, 1024), attempt: Number.isSafeInteger(event.attempt) ? event.attempt : undefined }))
      };
      const onlyIf = new Headers(previous.etag ? { "if-match": previous.etag } : { "if-none-match": "*" });
      const written = await bucket.put(key, JSON.stringify(status), { onlyIf, httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
      if (!written) continue;
      const { events: _events, ...summary } = status;
      await writeLatest(bucket, root + (input.selection === "project-only" ? "project-upload-status.json" : "upload-status.json"), summary);
      return response({ ok: true, status: summary });
    }
    return response({ error: "Upload progress changed concurrently. Retry the status update." }, 409);
  } catch (error) {
    return response({ error: clean(error.message) }, 400);
  }
}


// Server-only recovery can advance an errored operation, but only after ordinary
// publication has revalidated its files and installed that exact manifest.
export async function completeRecoveredUpload(bucket, episodeId, operationId, revisionId, identity, message = "Verified backup publication recovered without retransmitting media.") {
  const root = `episodes/${episodeId}/`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = await readObject(bucket, `${root}upload-logs/${operationId}.json`);
    const status = previous.value;
    const { value: manifest } = await readObject(bucket, `${root}manifest.json`);
    if (!status || status.owner !== identity || manifest?.revisionId !== revisionId || manifest.uploadOperationId !== operationId || manifest.assets.length !== status.totalAssets || manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0) !== status.totalBytes) throw new Error("Recovered backup does not match its verified publication.");
    if (status.phase === "complete" && status.manifestRevisionId === revisionId) return status;
    const now = new Date().toISOString();
    const next = { ...status, sequence: status.sequence + 1, phase: "complete", transferredBytes: status.totalBytes, completedAssets: status.totalAssets, bytesRemaining: 0, completionPercent: 100, remainingPercent: 0, verification: "manifest-verified", manifestRevisionId: revisionId, updatedAt: now, validUntil: now, message, relativePath: "", eventCount: status.eventCount + 1, events: [...(status.events || []), { at: now, type: "recovered", message }].slice(-100) };
    next.eventsOmitted = Math.max(0, next.eventCount - next.events.length);
    const written = await bucket.put(`${root}upload-logs/${operationId}.json`, JSON.stringify(next), { onlyIf: new Headers({ "if-match": previous.etag }), httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
    if (!written) continue;
    const { events: _events, ...summary } = next;
    await writeLatest(bucket, root + "upload-status.json", summary);
    return summary;
  }
  throw new Error("Recovery progress changed concurrently. Retry recovery.");
}
