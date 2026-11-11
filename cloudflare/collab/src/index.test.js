import test from "node:test";
import assert from "node:assert/strict";
import worker, { EpisodeCollaboration } from "./index.js";

class MemoryStorage {
  values = new Map();
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
}

class MemoryR2 {
  objects = new Map();
  multipartUploads = new Map();
  nextUploadId = 1;
  async bytes(body) {
    if (body instanceof ReadableStream) return new Uint8Array(await new Response(body).arrayBuffer());
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return new TextEncoder().encode(typeof body === "string" ? body : String(body ?? ""));
  }
  async put(key, body, options = {}) {
    const current = this.objects.get(key);
    const ifMatch = options.onlyIf instanceof Headers ? options.onlyIf.get("if-match") : undefined;
    const ifNoneMatch = options.onlyIf instanceof Headers ? options.onlyIf.get("if-none-match") : undefined;
    const currentEtag = current ? `\"etag-${key}-${current.version}\"` : undefined;
    if (ifMatch && ifMatch !== currentEtag) return null;
    if (ifNoneMatch === "*" && current) return null;
    const bytes = await this.bytes(body);
    const checksum = await crypto.subtle.digest("SHA-256", bytes);
    const checksumHex = [...new Uint8Array(checksum)].map((value) => value.toString(16).padStart(2, "0")).join("");
    if (options.sha256 && options.sha256 !== checksumHex) throw new Error("SHA-256 mismatch");
    const version = (current?.version ?? 0) + 1;
    this.objects.set(key, { bytes, httpMetadata: options.httpMetadata ?? {}, customMetadata: options.customMetadata ?? {}, version, checksum });
    return { httpEtag: `\"etag-${key}-${version}\"`, checksums: { sha256: checksum } };
  }
  async createMultipartUpload(key, options = {}) {
    const uploadId = `upload-${this.nextUploadId++}`;
    this.multipartUploads.set(uploadId, { key, options, parts: new Map() });
    return { key, uploadId };
  }
  resumeMultipartUpload(key, uploadId) {
    const bucket = this;
    const current = () => {
      const upload = bucket.multipartUploads.get(uploadId);
      if (!upload || upload.key !== key) throw new Error("Multipart upload not found.");
      return upload;
    };
    return {
      key,
      uploadId,
      async uploadPart(partNumber, body) {
        const upload = current();
        const bytes = await bucket.bytes(body);
        const part = { partNumber, etag: `etag-${uploadId}-${partNumber}` };
        upload.parts.set(partNumber, { ...part, bytes });
        return part;
      },
      async complete(parts) {
        const upload = current();
        const chunks = parts.map((part) => {
          const stored = upload.parts.get(part.partNumber);
          if (!stored || stored.etag !== part.etag) throw new Error("Multipart receipt mismatch.");
          return stored.bytes;
        });
        const size = chunks.reduce((total, bytes) => total + bytes.length, 0);
        const bytes = new Uint8Array(size);
        let offset = 0;
        chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
        const checksum = await crypto.subtle.digest("SHA-256", bytes);
        bucket.objects.set(key, { bytes, httpMetadata: upload.options.httpMetadata ?? {}, customMetadata: upload.options.customMetadata ?? {}, version: 1 });
        bucket.multipartUploads.delete(uploadId);
        return { httpEtag: `\"etag-${key}-1\"` };
      },
      async abort() { current(); bucket.multipartUploads.delete(uploadId); }
    };
  }
  async get(key, options = {}) {
    const entry = this.objects.get(key);
    if (!entry) return null;
    let bytes = entry.bytes;
    let range;
    const rangeHeader = options.range instanceof Headers ? options.range.get("range") : undefined;
    const etag = `\"etag-${key}-${entry.version ?? 1}\"`;
    if (options.onlyIf instanceof Headers && options.onlyIf.get("if-match") !== etag) return null;
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader || "");
    if (match) {
      const offset = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), entry.bytes.length - 1) : entry.bytes.length - 1;
      bytes = entry.bytes.slice(offset, end + 1);
      range = { offset, length: bytes.length };
    }
    if (options.range && !(options.range instanceof Headers)) {
      const offset = options.range.offset || 0;
      bytes = entry.bytes.slice(offset, offset + options.range.length);
      range = { offset, length: bytes.length };
    }
    return {
      body: new Response(bytes).body,
      size: entry.bytes.length,
      range,
      checksums: entry.checksum ? { sha256: entry.checksum } : {},
      httpMetadata: entry.httpMetadata,
      customMetadata: entry.customMetadata,
      httpEtag: `\"etag-${key}-${entry.version ?? 1}\"`,
      async json() { return JSON.parse(new TextDecoder().decode(entry.bytes)); },
      writeHttpMetadata(headers) { if (entry.httpMetadata.contentType) headers.set("content-type", entry.httpMetadata.contentType); }
    };
  }
  async head(key) {
    const entry = this.objects.get(key);
    if (!entry) return null;
    return { size: entry.bytes.length, customMetadata: entry.customMetadata, checksums: entry.checksum ? { sha256: entry.checksum } : {}, httpEtag: `\"etag-${key}-${entry.version ?? 1}\"` };
  }
  async delete(key) { this.objects.delete(key); }
  async list({ prefix = "" } = {}) {
    return {
      objects: [...this.objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, size: value.bytes.length })),
      truncated: false
    };
  }
}

function makeEnv() {
  const r2 = new MemoryR2();
  const instances = new Map();
  return {
    WHATABOUTIT_COLLAB_ACCESS_KEYS: JSON.stringify({ "test-user": "test-key-with-at-least-24-characters" }),
    EPISODE_MEDIA: r2,
    EPISODES: {
      getByName(name) {
        if (!instances.has(name)) instances.set(name, new EpisodeCollaboration({ storage: new MemoryStorage() }));
        const instance = instances.get(name);
        return { fetch: (request) => instance.fetch(request) };
      }
    }
  };
}

function request(pathname, init = {}) {
  return new Request(`https://collab.test${pathname}`, {
    ...init,
    headers: { "x-whataboutit-key": "test-key-with-at-least-24-characters", ...(init.headers ?? {}) }
  });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("health is public and reports the collaboration capabilities", async () => {
  const response = await worker.fetch(new Request("https://collab.test/health"), makeEnv());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.presence, true);
  assert.equal(body.editorLease, true);
  assert.equal(body.episodeLibrary, true);
});

test("protected routes reject the wrong collaboration key", async () => {
  const response = await worker.fetch(new Request("https://collab.test/episodes"), makeEnv());
  assert.equal(response.status, 401);
});

test("protected routes fail closed when the collaboration secret is missing", async () => {
  const env = makeEnv();
  delete env.WHATABOUTIT_COLLAB_ACCESS_KEYS;
  const response = await worker.fetch(new Request("https://collab.test/episodes"), env);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /authentication is not configured/i);
});

test("manifest upload becomes a discoverable cloud episode", async () => {
  const env = makeEnv();
  const manifest = {
    version: 1,
    episode: {
      id: "episode-a",
      title: "Episode A",
      status: "draft",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T01:00:00.000Z"
    },
    collaborationStatus: "working",
    assets: [{ relativePath: "Session/draft-timeline.json", bytes: 42, contentHash: await sha256("timeline") }]
  };
  const put = await worker.fetch(request("/episodes/episode-a/manifest", { method: "PUT", body: JSON.stringify(manifest), headers: { "content-type": "application/json" } }), env);
  assert.equal(put.status, 200);

  const list = await worker.fetch(request("/episodes"), env);
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.episodes.length, 1);
  assert.equal(body.episodes[0].id, "episode-a");
  assert.equal(body.episodes[0].assetCount, 1);
});

test("manifest writes reject a stale revision instead of overwriting another computer", async () => {
  const env = makeEnv();
  const manifest = {
    version: 1,
    episode: { id: "episode-a", title: "Episode A", status: "draft" },
    collaborationStatus: "working",
    assets: []
  };
  const created = await worker.fetch(request("/episodes/episode-a/manifest", {
    method: "PUT",
    body: JSON.stringify(manifest),
    headers: { "content-type": "application/json", "if-none-match": "*" }
  }), env);
  assert.equal(created.status, 200);
  const etag = created.headers.get("etag");
  assert.ok(etag);

  const updated = await worker.fetch(request("/episodes/episode-a/manifest", {
    method: "PUT",
    body: JSON.stringify(manifest),
    headers: { "content-type": "application/json", "if-match": etag }
  }), env);
  assert.equal(updated.status, 200);

  const stale = await worker.fetch(request("/episodes/episode-a/manifest", {
    method: "PUT",
    body: JSON.stringify(manifest),
    headers: { "content-type": "application/json", "if-match": etag }
  }), env);
  assert.equal(stale.status, 412);
});

test("editor lease prevents two collaborators from editing the same episode", async () => {
  const env = makeEnv();
  const morgan = await worker.fetch(request("/episodes/episode-a/lock", { method: "POST", body: JSON.stringify({ memberId: "morgan-owner", displayName: "Morgan" }), headers: { "content-type": "application/json" } }), env);
  assert.equal(morgan.status, 200);

  const susan = await worker.fetch(request("/episodes/episode-a/lock", { method: "POST", body: JSON.stringify({ memberId: "susan-editor", displayName: "Susan" }), headers: { "content-type": "application/json" } }), env);
  assert.equal(susan.status, 409);
  const body = await susan.json();
  assert.equal(body.reason, "already-locked");
  assert.equal(body.activeEditor.memberId, "morgan-owner");
});

test("multipart upload assembles camera media and preserves verification metadata", async () => {
  const env = makeEnv();
  const pathname = "/episodes/episode-a/assets/Cameras%2Fcamera-1.webm";
  const cameraHash = await sha256("camera-bytes");
  const create = await worker.fetch(request(`${pathname}?multipart=create`, {
    method: "POST",
    headers: { "content-type": "video/webm", "x-content-sha256": cameraHash }
  }), env);
  assert.equal(create.status, 200);
  const { uploadId } = await create.json();

  const first = await worker.fetch(request(`${pathname}?multipart=part&uploadId=${uploadId}&partNumber=1`, { method: "PUT", body: "camera-" }), env);
  const second = await worker.fetch(request(`${pathname}?multipart=part&uploadId=${uploadId}&partNumber=2`, { method: "PUT", body: "bytes" }), env);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const complete = await worker.fetch(request(`${pathname}?multipart=complete&uploadId=${uploadId}`, {
    method: "POST",
    body: JSON.stringify({ parts: [await first.json(), await second.json()] }),
    headers: { "content-type": "application/json" }
  }), env);
  assert.equal(complete.status, 200);

  const head = await worker.fetch(request(pathname, { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "12");
  assert.equal(head.headers.get("x-content-sha256"), cameraHash);
  const downloaded = await worker.fetch(request(pathname), env);
  assert.equal(await downloaded.text(), "camera-bytes");

  const resumed = await worker.fetch(request(pathname, { headers: { range: "bytes=7-" } }), env);
  assert.equal(resumed.status, 206);
  assert.equal(resumed.headers.get("content-range"), "bytes 7-11/12");
  assert.equal(await resumed.text(), "bytes");
});

test("multipart completion rejects and deletes bytes with the wrong SHA-256", async () => {
  const env = makeEnv();
  const pathname = "/episodes/episode-a/assets/Cameras%2Fcamera-2.webm";
  const create = await worker.fetch(request(`${pathname}?multipart=create`, {
    method: "POST",
    headers: { "x-content-sha256": await sha256("different-bytes") }
  }), env);
  const { uploadId } = await create.json();
  const part = await worker.fetch(request(`${pathname}?multipart=part&uploadId=${uploadId}&partNumber=1`, { method: "PUT", body: "actual-bytes" }), env);
  const complete = await worker.fetch(request(`${pathname}?multipart=complete&uploadId=${uploadId}`, {
    method: "POST",
    body: JSON.stringify({ parts: [await part.json()] })
  }), env);
  assert.equal(complete.status, 422);
  assert.equal((await worker.fetch(request(pathname, { method: "HEAD" }), env)).status, 404);
});

test("storage failures return a retryable response instead of an unhandled Worker error", async () => {
  const env = makeEnv();
  env.EPISODE_MEDIA.put = async () => { throw new Error("temporary R2 failure"); };
  const response = await worker.fetch(request("/episodes/episode-a/assets/Cameras%2Fcamera-1.webm", { method: "PUT", body: "camera", headers: { "x-content-sha256": await sha256("camera") } }), env);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /temporarily unavailable/i);
  const manifestResponse = await worker.fetch(request("/episodes/episode-a/manifest", {
    method: "PUT",
    body: JSON.stringify({ episode: { id: "episode-a", title: "Episode A" }, assets: [] })
  }), env);
  assert.equal(manifestResponse.status, 503);
  assert.match((await manifestResponse.json()).error, /temporarily unavailable/i);
});

test("versioned publications require verified assets and retain the previous revision on failure", async () => {
  const env = makeEnv();
  const episodeId = "versioned-episode";
  const body = "protected-original";
  const hash = await sha256(body);
  const relative = `objects/revision-a/${hash}/Recordings/part-1/Audio/mic.flac`;
  const assetUrl = `/episodes/${episodeId}/assets/${encodeURIComponent(relative)}`;
  assert.equal((await worker.fetch(request(assetUrl, { method: "PUT", body, headers: { "x-content-sha256": hash } }), env)).status, 200);
  const head = await worker.fetch(request(assetUrl, { method: "HEAD" }), env);
  assert.equal(head.headers.get("x-content-verified"), "true");
  const manifest = {
    version: 1, revisionId: "revision-a", uploadedAt: "2026-10-23T00:00:00Z", episode: { id: episodeId },
    assets: [{ id: "audio", relativePath: "Recordings/part-1/Audio/mic.flac", cloudPath: `episodes/${episodeId}/${relative}`, contentHash: hash, bytes: body.length }]
  };
  const saved = await worker.fetch(request(`/episodes/${episodeId}/manifest`, { method: "PUT", body: JSON.stringify(manifest), headers: { "if-none-match": "*" } }), env);
  assert.equal(saved.status, 200);
  const failed = await worker.fetch(request(`/episodes/${episodeId}/manifest`, { method: "PUT", body: JSON.stringify({ ...manifest, revisionId: "revision-b", assets: [{ ...manifest.assets[0], cloudPath: `episodes/${episodeId}/objects/missing/file` }] }) }), env);
  assert.equal(failed.status, 400);
  const current = await worker.fetch(request(`/episodes/${episodeId}/manifest`), env);
  assert.equal((await current.json()).revisionId, "revision-a");
  assert.equal(await (await worker.fetch(request(assetUrl), env)).text(), body);
  assert.equal((await worker.fetch(request(assetUrl, { method: "DELETE" }), env)).status, 409);
  assert.ok(await env.EPISODE_MEDIA.get(`episode-history/${episodeId}/revision-a.json`));
});

test("stale publication cannot overwrite a newer revision or its media", async () => {
  const env = makeEnv();
  const first = { revisionId: "first", episode: { id: "cas" }, assets: [] };
  const saved = await worker.fetch(request("/episodes/cas/manifest", { method: "PUT", body: JSON.stringify(first) }), env);
  const etag = saved.headers.get("etag");
  const second = await worker.fetch(request("/episodes/cas/manifest", { method: "PUT", body: JSON.stringify({ ...first, revisionId: "second" }), headers: { "if-match": etag } }), env);
  assert.equal(second.status, 200);
  const stale = await worker.fetch(request("/episodes/cas/manifest", { method: "PUT", body: JSON.stringify({ ...first, revisionId: "stale" }), headers: { "if-match": etag } }), env);
  assert.equal(stale.status, 412);
  assert.equal((await (await worker.fetch(request("/episodes/cas/manifest"), env)).json()).revisionId, "second");
});

test("retains the installed editor map while accepting the existing legacy credential", async () => {
  const env = makeEnv();
  const legacy = "existing-legacy-credential-32-characters";
  env.WHATABOUTIT_COLLAB_ACCESS_KEY = legacy;
  assert.equal((await worker.fetch(request("/episodes"), env)).status, 200);
  const legacyRequest = new Request("https://collab.test/episodes", { headers: { "x-whataboutit-key": legacy } });
  assert.equal((await worker.fetch(legacyRequest, env)).status, 200);
  env.WHATABOUTIT_COLLAB_ACCESS_KEYS = "{}";
  assert.equal((await worker.fetch(legacyRequest, env)).status, 200);
  assert.equal((await worker.fetch(new Request("https://collab.test/episodes"), env)).status, 401);
  env.WHATABOUTIT_COLLAB_ACCESS_KEY = "short";
  assert.equal((await worker.fetch(legacyRequest, env)).status, 503);
});

test("upload progress remains below 100 until the matching manifest is published", async () => {
  const env = makeEnv();
  const endpoint = "/episodes/progress/upload-status";
  const payload = { operationId: "upload-a", sequence: 1, selection: "full-backup", phase: "transferring", completedAssets: 9, totalAssets: 10, transferredBytes: 10, totalBytes: 1000, eventCount: 1, events: [{ type: "retry", message: "Bearer private-value https://private.test/token key=test-key-with-at-least-24-characters" }] };
  const put = (input) => worker.fetch(request(endpoint, { method: "PUT", body: JSON.stringify(input) }), env);
  assert.equal((await worker.fetch(new Request("https://collab.test" + endpoint), env)).status, 401);
  assert.equal((await put(payload)).status, 200);
  const stored = await (await env.EPISODE_MEDIA.get("episodes/progress/upload-status.json")).json();
  assert.equal(stored.completionPercent, 1);
  assert.equal(stored.remainingPercent, 99);
  const logs = await (await env.EPISODE_MEDIA.get(stored.logPath)).json();
  assert.doesNotMatch(JSON.stringify(logs.events), /private-value|private.test|test-key-with-at-least-24-characters/);
  const finishedBytes = { ...payload, sequence: 2, completedAssets: 10, transferredBytes: 1000, phase: "committing" };
  assert.equal((await put(finishedBytes)).status, 200);
  assert.equal((await (await env.EPISODE_MEDIA.get(stored.logPath)).json()).completionPercent, 99);
  const complete = { ...finishedBytes, sequence: 3, phase: "complete", manifestRevisionId: "published" };
  assert.equal((await put(complete)).status, 409);
  const manifest = { version: 1, uploadOperationId: "upload-a", revisionId: "published", episode: { id: "progress" }, assets: Array.from({ length: 10 }, (_, index) => ({ kind: "metadata", relativePath: `Data/file-${index}.json`, bytes: 100, contentHash: "0".repeat(64) })) };
  assert.equal((await worker.fetch(request("/episodes/progress/manifest", { method: "PUT", body: JSON.stringify(manifest) }), env)).status, 200);
  assert.equal((await put(complete)).status, 200);
  const final = await (await worker.fetch(request(endpoint), env)).json();
  assert.equal(final.completionPercent, 100);
  assert.equal(final.verification, "manifest-verified");
  assert.equal((await put({ ...payload, sequence: 4 })).status, 200);
  assert.equal((await (await worker.fetch(request(endpoint), env)).json()).phase, "complete");
});

test("late status reports, project autosaves, invalid counters and other editors cannot overwrite a media upload", async () => {
  const env = makeEnv();
  const endpoint = "/episodes/progress/upload-status";
  const payload = { operationId: "upload-a", sequence: 2, selection: "full-backup", phase: "transferring", completedAssets: 0, totalAssets: 1, transferredBytes: 50, totalBytes: 100, eventCount: 0, events: [] };
  const put = (input, headers) => worker.fetch(request(endpoint, { method: "PUT", body: JSON.stringify(input), headers }), env);
  assert.equal((await put(payload)).status, 200);
  assert.equal((await put({ ...payload, sequence: 1, transferredBytes: 0 })).status, 200);
  assert.equal((await (await worker.fetch(request(endpoint), env)).json()).completionPercent, 50);
  assert.equal((await put({ ...payload, sequence: 3, transferredBytes: 101 })).status, 400);
  assert.equal((await put({ ...payload, operationId: "autosave", selection: "project-only" })).status, 200);
  assert.equal((await (await worker.fetch(request(endpoint), env)).json()).operationId, "upload-a");
  env.WHATABOUTIT_COLLAB_ACCESS_KEYS = JSON.stringify({ "test-user": "test-key-with-at-least-24-characters", other: "other-key-with-at-least-24-characters" });
  assert.equal((await put({ ...payload, sequence: 3 }, { "x-whataboutit-key": "other-key-with-at-least-24-characters" })).status, 403);
  const storedKey = "episodes/progress/upload-status.json";
  const stale = await (await env.EPISODE_MEDIA.get(storedKey)).json();
  await env.EPISODE_MEDIA.put(storedKey, JSON.stringify({ ...stale, validUntil: "2000-01-01T00:00:00Z" }));
  assert.equal((await (await worker.fetch(request(endpoint), env)).json()).stale, true);
});

test("bounded SHA-256 checkpoints match native hashes across resumptions and reject corrupted bytes", async () => {
  const { verifyObjectChunk } = await import("./bounded-verification.js");
  for (const length of [0, 1, 55, 56, 63, 64, 65, 4095, 4096, 4097, 10003]) {
    const bucket = new MemoryR2();
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 83 + 17) % 256);
    const expected = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
    await bucket.put("file", bytes, { customMetadata: { sha256: expected } });
    const head = await bucket.head("file");
    let result;
    let calls = 0;
    do {
      result = await verifyObjectChunk(bucket, "file", head, expected, 1024);
      calls++;
      assert.ok(calls <= Math.ceil(length / 1024) + 1);
    } while (!result.verified);
    const receipt = await (await bucket.get("verification/file")).json();
    assert.equal(receipt.sha256, expected);
    assert.equal(receipt.etag, head.httpEtag);
    assert.equal(await bucket.get("verification-state/file"), null);
    const failed = await verifyObjectChunk(bucket, "file", head, "0".repeat(64), 16 * 1024 * 1024);
    assert.equal(failed.mismatch, true);
  }
});

test("multipart completion recovers a stored object after a lost completion response", async () => {
  const env = makeEnv();
  const bytes = "a completed recording";
  const hash = await sha256(bytes);
  const path = "/episodes/recover/assets/objects%2Fcanary%2Fprogram.webm";
  await env.EPISODE_MEDIA.put("episodes/recover/objects/canary/program.webm", bytes, { customMetadata: { sha256: hash } });
  const body = JSON.stringify({ verification: "bounded-v1", parts: [{ partNumber: 1, etag: "original-receipt" }] });
  for (let attempt = 0; attempt < 2; attempt++) {
    const complete = await worker.fetch(request(path + "?multipart=complete&uploadId=already-completed", { method: "POST", body }), env);
    assert.equal(complete.status, 200, await complete.clone().text());
    assert.equal((await complete.json()).ok, true);
  }
  const head = await worker.fetch(request(path, { method: "HEAD" }), env);
  assert.equal(head.headers.get("x-content-verified"), "true");
});


test("R2 streaming verification preserves bytes and metadata and reuses native checksums", async () => {
  const { verifyStoredObject } = await import("./bounded-verification.js");
  const bucket = new MemoryR2();
  const bytes = "recording audio and video";
  const expected = await sha256(bytes);
  await bucket.put("file", bytes, { customMetadata: { sha256: expected, recordedAt: "today" }, httpMetadata: { contentType: "video/webm" } });
  bucket.objects.get("file").checksum = undefined;
  const original = await bucket.head("file");
  const verified = await verifyStoredObject(bucket, "file", original, expected, false);
  assert.equal(verified.verified, true);
  assert.notEqual(verified.etag, original.httpEtag);
  const stored = await bucket.get("file");
  assert.equal(await new Response(stored.body).text(), bytes);
  assert.equal(stored.httpMetadata.contentType, "video/webm");
  assert.equal(stored.customMetadata.recordedAt, "today");
  assert.equal((await (await bucket.get("verification/file")).json()).etag, verified.etag);
  const again = await verifyStoredObject(bucket, "file", await bucket.head("file"), expected, true);
  assert.equal(again.etag, verified.etag);
});

test("R2 rejects corrupt assembled bytes without deleting versioned media or writing a receipt", async () => {
  const { verifyStoredObject } = await import("./bounded-verification.js");
  const bucket = new MemoryR2();
  await bucket.put("file", "corrupt bytes", { customMetadata: { sha256: "0".repeat(64) } });
  bucket.objects.get("file").checksum = undefined;
  const original = await bucket.head("file");
  assert.equal((await verifyStoredObject(bucket, "file", original, "0".repeat(64), true)).mismatch, true);
  assert.equal((await bucket.head("file")).httpEtag, original.httpEtag);
  assert.equal(await bucket.get("verification/file"), null);
});

test("files above the native write limit require resumable verification and hash only 256 KiB", async () => {
  const { verifyStoredObject, CHUNK_BYTES } = await import("./bounded-verification.js");
  const bucket = new MemoryR2();
  await bucket.put("file", new Uint8Array(CHUNK_BYTES), { customMetadata: { sha256: "0".repeat(64) } });
  bucket.objects.get("file").checksum = undefined;
  const large = { ...await bucket.head("file"), size: 5 * 1024 ** 3 + 1 };
  assert.equal((await verifyStoredObject(bucket, "file", large, "0".repeat(64), false)).updateRequired, true);
  assert.equal(await bucket.get("verification/file"), null);
  const first = await verifyStoredObject(bucket, "file", large, "0".repeat(64), true);
  assert.equal(first.verified, false);
  assert.equal(first.verifiedBytes, 256 * 1024);
  assert.equal(await bucket.get("verification/file"), null);
});

test("a concurrent R2 version cannot be overwritten by checksum verification", async () => {
  const { verifyStoredObject } = await import("./bounded-verification.js");
  const bucket = new MemoryR2();
  const expected = await sha256("original");
  await bucket.put("file", "original", { customMetadata: { sha256: expected } });
  bucket.objects.get("file").checksum = undefined;
  const original = await bucket.head("file");
  const put = bucket.put.bind(bucket);
  bucket.put = async (key, body, options) => {
    if (key === "file") await put(key, "concurrent recording");
    return put(key, body, options);
  };
  await assert.rejects(verifyStoredObject(bucket, "file", original, expected, true), /changed during verification/);
  assert.equal(await new Response((await bucket.get("file")).body).text(), "concurrent recording");
  assert.equal(await bucket.get("verification/file"), null);
});


test("default free-plan SHA-256 steps resume across block boundaries and verify the entire file", async () => {
  const { verifyObjectChunk, CHUNK_BYTES } = await import("./bounded-verification.js");
  const bucket = new MemoryR2();
  const bytes = Uint8Array.from({ length: CHUNK_BYTES * 8 + 7 }, (_, i) => (i * 31 + 7) % 256);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
  await bucket.put("file", bytes);
  const head = await bucket.head("file");
  for (let step = 1; step <= 9; step++) {
    const result = await verifyObjectChunk(bucket, "file", head, hash);
    assert.equal(result.verifiedBytes, Math.min(bytes.length, step * CHUNK_BYTES));
    assert.equal(result.verified, step === 9);
  }
  assert.equal((await (await bucket.get("verification/file")).json()).sha256, hash);
});

test("logical parent revisions tolerate a transformed transport ETag but reject real competing edits", async () => {
  const env = makeEnv();
  const manifest = { version: 1, revisionId: "base", episode: { id: "logical", title: "Episode", createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z" }, uploadedAt: "2026-11-10T00:00:00Z", assets: [], collaborationStatus: "working" };
  assert.equal((await worker.fetch(request("/episodes/logical/manifest", { method: "PUT", body: JSON.stringify(manifest), headers: { "if-none-match": "*" } }), env)).status, 200);
  const read = await worker.fetch(request("/episodes/logical/manifest"), env);
  assert.equal(read.headers.get("cache-control"), "no-store, no-transform");
  const next = { ...manifest, revisionId: "next", parentRevisionId: "base" };
  assert.equal((await worker.fetch(request("/episodes/logical/manifest", { method: "PUT", body: JSON.stringify(next), headers: { "if-match": `W/${read.headers.get("etag")}` } }), env)).status, 200);
  assert.equal((await worker.fetch(request("/episodes/logical/manifest", { method: "PUT", body: JSON.stringify(next), headers: { "if-match": `W/${read.headers.get("etag")}` } }), env)).status, 200, "A lost successful response must be recoverable by replaying the identical publication");
  const current = await worker.fetch(request("/episodes/logical/manifest"), env);
  const stale = { ...manifest, revisionId: "stale", parentRevisionId: "base" };
  assert.equal((await worker.fetch(request("/episodes/logical/manifest", { method: "PUT", body: JSON.stringify(stale), headers: { "if-match": current.headers.get("etag") } }), env)).status, 412);
  assert.equal((await (await worker.fetch(request("/episodes/logical/manifest"), env)).json()).revisionId, "next");
});

async function pendingBackup() {
  const env = makeEnv();
  const episodeId = "recover-publish", operationId = "completed-transfer";
  const bytes = "verified recording";
  const hash = await sha256(bytes);
  const asset = { id: "video", kind: "program-video", relativePath: "Program/program.webm", cloudPath: `episodes/${episodeId}/objects/backup/program.webm`, contentHash: hash, bytes: bytes.length };
  await worker.fetch(request(`/episodes/${episodeId}/assets/objects%2Fbackup%2Fprogram.webm`, { method: "PUT", body: bytes, headers: { "x-content-sha256": hash } }), env);
  const base = { version: 1, revisionId: "base", episode: { id: episodeId, title: "Episode" }, collaborationStatus: "working", assets: [] };
  await worker.fetch(request(`/episodes/${episodeId}/manifest`, { method: "PUT", body: JSON.stringify(base) }), env);
  const candidate = { ...base, revisionId: "pending", parentRevisionId: "base", uploadOperationId: operationId, assets: [asset] };
  // A pre-fix failed CAS kept this candidate in history, without an operation index.
  await env.EPISODE_MEDIA.put(`episode-history/${episodeId}/pending.json`, JSON.stringify(candidate));
  const status = { operationId, sequence: 1, phase: "error", selection: "full-backup", completedAssets: 1, totalAssets: 1, transferredBytes: bytes.length, totalBytes: bytes.length, eventCount: 1, events: [{ type: "error", message: "Publication failed" }] };
  await worker.fetch(request(`/episodes/${episodeId}/upload-status`, { method: "PUT", body: JSON.stringify(status) }), env);
  return { env, candidate, base, url: `/episodes/${episodeId}/upload-recovery?operationId=${operationId}` };
}

test("server recovery publishes a checksum-verified pending backup without rewriting its media", async () => {
  const { env, url, candidate } = await pendingBackup();
  const put = env.EPISODE_MEDIA.put.bind(env.EPISODE_MEDIA);
  let mediaWrites = 0;
  env.EPISODE_MEDIA.put = async (key, body, options) => { if (key.includes("/objects/")) mediaWrites++; return put(key, body, options); };
  assert.equal((await (await worker.fetch(request(url), env)).json()).canRecover, true);
  const result = await worker.fetch(request(url, { method: "POST" }), env);
  assert.equal(result.status, 200, await result.clone().text());
  const body = await result.json();
  assert.equal(body.status.phase, "complete");
  assert.equal(body.status.completionPercent, 100);
  assert.equal(body.status.verification, "manifest-verified");
  assert.equal(body.status.manifestRevisionId, candidate.revisionId);
  assert.equal(mediaWrites, 0);
  assert.equal((await worker.fetch(request(url, { method: "POST" }), env)).status, 200);
  assert.equal(mediaWrites, 0);
});

test("recovery preserves another cloud revision and is restricted to the upload owner", async () => {
  const { env, url, base } = await pendingBackup();
  await worker.fetch(request("/episodes/recover-publish/manifest", { method: "PUT", body: JSON.stringify({ ...base, revisionId: "other-editor" }) }), env);
  assert.equal((await worker.fetch(request(url, { method: "POST" }), env)).status, 409);
  assert.equal((await (await worker.fetch(request("/episodes/recover-publish/manifest"), env)).json()).revisionId, "other-editor");
  env.WHATABOUTIT_COLLAB_ACCESS_KEYS = JSON.stringify({ "test-user": "test-key-with-at-least-24-characters", other: "other-key-with-at-least-24-characters" });
  assert.equal((await worker.fetch(request(url, { method: "POST", headers: { "x-whataboutit-key": "other-key-with-at-least-24-characters" } }), env)).status, 403);
});

test("client completion counters cannot recover missing checksum receipts", async () => {
  const { env, url, candidate } = await pendingBackup();
  await env.EPISODE_MEDIA.delete(`verification/${candidate.assets[0].cloudPath}`);
  env.EPISODE_MEDIA.objects.get(candidate.assets[0].cloudPath).checksum = undefined;
  const response = await worker.fetch(request(url, { method: "POST" }), env);
  assert.equal(response.status, 400, await response.clone().text());
  assert.equal((await (await worker.fetch(request("/episodes/recover-publish/upload-status"), env)).json()).phase, "error");
  assert.equal((await (await worker.fetch(request("/episodes/recover-publish/manifest"), env)).json()).revisionId, "base");
});

test("organization publishes readable category folders, verifies copies and retains the original revision", async () => {
  const { env, url, candidate } = await pendingBackup();
  assert.equal((await worker.fetch(request(url, { method: "POST" }), env)).status, 200);
  const organize = url.replace("upload-recovery", "upload-organization");
  const plan = await worker.fetch(request(organize), env);
  assert.equal(plan.status, 200);
  assert.equal((await plan.json()).files.length, 1);
  let copies = 0;
  const put = env.EPISODE_MEDIA.put.bind(env.EPISODE_MEDIA);
  env.EPISODE_MEDIA.put = async (key, body, options) => { if (key.startsWith("episodes/") && key.includes("/versions/")) copies++; return put(key, body, options); };
  const copyUrl = organize + "&relativePath=" + encodeURIComponent(candidate.assets[0].relativePath);
  assert.equal((await worker.fetch(request(copyUrl, { method: "POST" }), env)).status, 200);
  assert.equal((await worker.fetch(request(copyUrl, { method: "POST" }), env)).status, 200);
  assert.equal(copies, 1);
  const published = await worker.fetch(request(organize, { method: "POST" }), env);
  assert.equal(published.status, 200, await published.clone().text());
  assert.equal((await published.json()).status.completionPercent, 100);
  const manifest = await (await worker.fetch(request("/episodes/recover-publish/manifest"), env)).json();
  assert.match(manifest.assets[0].cloudPath, /^episodes\/recover-publish\/Program\/versions\/\d{4}-\d{2}-\d{2}_/);
  assert.ok(await env.EPISODE_MEDIA.head(candidate.assets[0].cloudPath));
  const relative = manifest.assets[0].cloudPath.slice("episodes/recover-publish/".length);
  const assetUrl = "/episodes/recover-publish/assets/" + encodeURIComponent(relative);
  assert.equal((await worker.fetch(request(assetUrl, { method: "HEAD" }), env)).headers.get("x-content-verified"), "true");
  assert.equal(await (await worker.fetch(request(assetUrl), env)).text(), "verified recording");
  assert.equal((await worker.fetch(request(assetUrl, { method: "DELETE" }), env)).status, 409);
  assert.equal((await worker.fetch(request(assetUrl, { method: "PUT", body: "overwrite", headers: { "x-content-sha256": await sha256("overwrite") } }), env)).status, 409);
  assert.equal((await (await worker.fetch(request(organize), env)).json()).published, true);
});

test("organization cannot publish missing copies or overwrite concurrent project edits", async () => {
  const { env, url, base } = await pendingBackup();
  await worker.fetch(request(url, { method: "POST" }), env);
  const organize = url.replace("upload-recovery", "upload-organization");
  await worker.fetch(request(organize), env);
  assert.equal((await worker.fetch(request(organize, { method: "POST" }), env)).status, 400);
  await worker.fetch(request("/episodes/recover-publish/manifest", { method: "PUT", body: JSON.stringify({ ...base, revisionId: "concurrent" }) }), env);
  assert.equal((await worker.fetch(request(organize, { method: "POST" }), env)).status, 409);
  assert.equal((await (await worker.fetch(request("/episodes/recover-publish/manifest"), env)).json()).revisionId, "concurrent");
});

test("organized paths preserve file names and reject unsafe categories or version folders", async () => {
  const { organizedPath } = await import("./organized-files.js");
  assert.equal(organizedPath("Audio/guest-mic.flac", "2026-11-10_23-12-56"), "Audio/versions/2026-11-10_23-12-56/guest-mic.flac");
  assert.equal(organizedPath("metadata.json", "today"), "Project/versions/today/metadata.json");
  for (const name of ["../escape", "/escape", "Audio//file"]) assert.throws(() => organizedPath(name, "today"));
  assert.throws(() => organizedPath("Audio/file", "../escape"));
});


test("organization verifies legacy bytes even when no old receipt exists", async () => {
  const { env, url, candidate } = await pendingBackup();
  await worker.fetch(request(url, { method: "POST" }), env);
  await env.EPISODE_MEDIA.delete(`verification/${candidate.assets[0].cloudPath}`);
  const organize = url.replace("upload-recovery", "upload-organization");
  assert.equal((await worker.fetch(request(organize), env)).status, 200);
  const copied = await worker.fetch(request(organize + "&relativePath=" + encodeURIComponent(candidate.assets[0].relativePath), { method: "POST" }), env);
  assert.equal(copied.status, 200, await copied.clone().text());
  assert.equal((await worker.fetch(request(organize, { method: "POST" }), env)).status, 200);
});

test("legacy source metadata cannot make corrupted bytes pass copy verification", async () => {
  const { env, url, candidate } = await pendingBackup();
  await worker.fetch(request(url, { method: "POST" }), env);
  const sourceKey = candidate.assets[0].cloudPath;
  await env.EPISODE_MEDIA.delete(`verification/${sourceKey}`);
  await env.EPISODE_MEDIA.put(sourceKey, "x".repeat(candidate.assets[0].bytes), { customMetadata: { sha256: candidate.assets[0].contentHash } });
  const organize = url.replace("upload-recovery", "upload-organization");
  await worker.fetch(request(organize), env);
  assert.equal((await worker.fetch(request(organize + "&relativePath=" + encodeURIComponent(candidate.assets[0].relativePath), { method: "POST" }), env)).status, 503);
  assert.equal((await worker.fetch(request(organize, { method: "POST" }), env)).status, 400);
  assert.equal((await (await worker.fetch(request("/episodes/recover-publish/manifest"), env)).json()).revisionId, "pending");
});


test("organization uses the uploader's canonical R2 encoding for spaces, Unicode and percent signs", async () => {
  const { env, url, candidate } = await pendingBackup();
  await worker.fetch(request(url, { method: "POST" }), env);
  const name = "Exports/edited 50% 🎥/export-job.json";
  const relative = "objects/with-spaces/" + name;
  const asset = { ...candidate.assets[0], relativePath: name, cloudPath: "episodes/recover-publish/" + relative };
  const uploaded = await worker.fetch(request("/episodes/recover-publish/assets/" + encodeURIComponent(relative), { method: "PUT", body: "verified recording", headers: { "x-content-sha256": asset.contentHash } }), env);
  assert.equal(uploaded.status, 200);
  const current = await worker.fetch(request("/episodes/recover-publish/manifest"), env);
  const next = { ...candidate, revisionId: "with-spaces", parentRevisionId: "pending", assets: [asset] };
  assert.equal((await worker.fetch(request("/episodes/recover-publish/manifest", { method: "PUT", headers: { "if-match": current.headers.get("etag") }, body: JSON.stringify(next) }), env)).status, 200);
  assert.equal((await worker.fetch(request(url, { method: "POST" }), env)).status, 200);
  const organize = url.replace("upload-recovery", "upload-organization");
  await worker.fetch(request(organize), env);
  const copied = await worker.fetch(request(organize + "&relativePath=" + encodeURIComponent(name), { method: "POST" }), env);
  assert.equal(copied.status, 200, await copied.clone().text());
  assert.equal((await worker.fetch(request(organize, { method: "POST" }), env)).status, 200);
  const manifest = await (await worker.fetch(request("/episodes/recover-publish/manifest"), env)).json();
  const target = manifest.assets[0].cloudPath.slice("episodes/recover-publish/".length);
  assert.equal(await (await worker.fetch(request("/episodes/recover-publish/assets/" + encodeURIComponent(target)), env)).text(), "verified recording");
});

test("current files use direct normal filenames and unchanged repeats copy no media", async () => {
  const { env, url, candidate } = await pendingBackup();
  await worker.fetch(request(url, { method: "POST" }), env);
  const route = "/episodes/recover-publish/current-files";
  const initial = await (await worker.fetch(request(route), env)).json();
  assert.equal(initial.fullBackupVerified, true);
  assert.equal(initial.currentFilesReady, false);
  assert.equal(initial.files[0].path, "Program/program.webm");
  const copyUrl = route + "?relativePath=" + encodeURIComponent(candidate.assets[0].relativePath);
  const first = await (await worker.fetch(request(copyUrl, { method: "POST" }), env)).json();
  assert.equal(first.path, "Program/program.webm");
  assert.equal(first.copiedBytes, candidate.assets[0].bytes);
  const second = await (await worker.fetch(request(copyUrl, { method: "POST" }), env)).json();
  assert.equal(second.copiedBytes, 0);
  assert.equal((await worker.fetch(request(route, { method: "POST" }), env)).status, 200);
  const ready = await (await worker.fetch(request(route), env)).json();
  assert.equal(ready.currentFilesReady, true);
  assert.equal(ready.fullBackupVerified, true);
  assert.equal(await (await worker.fetch(request("/episodes/recover-publish/assets/Program%2Fprogram.webm"), env)).text(), "verified recording");
  assert.ok(await env.EPISODE_MEDIA.get(candidate.assets[0].cloudPath));
});

test("current files preserve an unmanaged legacy recording with different bytes", async () => {
  const { env, url, candidate } = await pendingBackup();
  await worker.fetch(request(url, { method: "POST" }), env);
  await env.EPISODE_MEDIA.put("episodes/recover-publish/Program/program.webm", "a different old recording");
  const response = await worker.fetch(request("/episodes/recover-publish/current-files?relativePath=" + encodeURIComponent(candidate.assets[0].relativePath), { method: "POST" }), env);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).path, "Program/Latest-program.webm");
  assert.equal(await new Response((await env.EPISODE_MEDIA.get("episodes/recover-publish/Program/program.webm")).body).text(), "a different old recording");
});

test("simple file publication refuses corrupted source bytes and premature readiness", async () => {
  const { env, url, candidate } = await pendingBackup();
  await worker.fetch(request(url, { method: "POST" }), env);
  const route = "/episodes/recover-publish/current-files";
  assert.equal((await worker.fetch(request(route, { method: "POST" }), env)).status, 409);
  await env.EPISODE_MEDIA.put(candidate.assets[0].cloudPath, "x".repeat(candidate.assets[0].bytes));
  assert.equal((await worker.fetch(request(route + "?relativePath=" + encodeURIComponent(candidate.assets[0].relativePath), { method: "POST" }), env)).status, 503);
  assert.equal((await (await worker.fetch(request(route), env)).json()).currentFilesReady, false);
});

test("cloud summaries distinguish project data from a thirty-minute compressed review copy", async () => {
  const env = makeEnv(), episodeId = "review-only";
  const catalog = JSON.stringify({ assets: [{ id: "program", durationMs: 32 * 60 * 1000 }] });
  const hash = await sha256(catalog);
  await env.EPISODE_MEDIA.put(`episodes/${episodeId}/Session/proxy-catalog.json`, catalog);
  const manifest = { version: 1, episode: { id: episodeId }, revisionId: "review", collaborationStatus: "working", assets: [
    { kind: "metadata", relativePath: "Session/proxy-catalog.json", contentHash: hash, bytes: catalog.length },
    { kind: "proxy-video", relativePath: "Session/Proxies/program-review.mp4", contentHash: "a".repeat(64), bytes: 380700000 }
  ] };
  assert.equal((await worker.fetch(request(`/episodes/${episodeId}/manifest`, { method: "PUT", body: JSON.stringify(manifest) }), env)).status, 200);
  const summary = await (await worker.fetch(request(`/episodes/${episodeId}/current-files`), env)).json();
  assert.equal(summary.fullBackupVerified, false);
  assert.equal(summary.originalCount, 0);
  assert.equal(summary.reviewCount, 1);
  assert.equal(summary.durationMs, 32 * 60 * 1000);
  assert.equal(summary.files[0].path, "Review/program-review.mp4");
});

test("project-only autosaves retain the full recording backup proof", async () => {
  const { env, url, candidate } = await pendingBackup();
  await worker.fetch(request(url, { method: "POST" }), env);
  const next = { ...candidate, revisionId: "project-save", parentRevisionId: candidate.revisionId, uploadOperationId: "project-save", episode: { ...candidate.episode, title: "Updated title" } };
  const response = await worker.fetch(request("/episodes/recover-publish/manifest", { method: "PUT", headers: { "if-match": "a-transformed-etag" }, body: JSON.stringify(next) }), env);
  assert.equal(response.status, 200);
  const summary = await (await worker.fetch(request("/episodes/recover-publish/current-files"), env)).json();
  assert.equal(summary.fullBackupVerified, true);
});

test("delta publication updates one changed recording and reuses the unchanged microphone", async () => {
  const { env, url, candidate } = await pendingBackup();
  await worker.fetch(request(url, { method: "POST" }), env);
  const microphone = { ...candidate.assets[0], relativePath: "Audio/guest-mic.flac", kind: "original-audio" };
  const first = { ...candidate, revisionId: "two-files", parentRevisionId: candidate.revisionId, assets: [...candidate.assets, microphone] };
  let current = await worker.fetch(request("/episodes/recover-publish/manifest"), env);
  await worker.fetch(request("/episodes/recover-publish/manifest", { method: "PUT", headers: { "if-match": current.headers.get("etag") }, body: JSON.stringify(first) }), env);
  const route = "/episodes/recover-publish/current-files";
  for (const asset of first.assets) assert.equal((await worker.fetch(request(route + "?relativePath=" + encodeURIComponent(asset.relativePath), { method: "POST" }), env)).status, 200);
  assert.equal((await worker.fetch(request(route, { method: "POST" }), env)).status, 200);
  const updatedBytes = "changed program video";
  const updated = { ...candidate.assets[0], bytes: updatedBytes.length, contentHash: await sha256(updatedBytes), cloudPath: "episodes/recover-publish/objects/updated/program.webm" };
  await worker.fetch(request("/episodes/recover-publish/assets/objects%2Fupdated%2Fprogram.webm", { method: "PUT", body: updatedBytes, headers: { "x-content-sha256": updated.contentHash } }), env);
  current = await worker.fetch(request("/episodes/recover-publish/manifest"), env);
  const next = { ...first, revisionId: "changed-file", parentRevisionId: first.revisionId, assets: [updated, microphone] };
  await worker.fetch(request("/episodes/recover-publish/manifest", { method: "PUT", headers: { "if-match": current.headers.get("etag") }, body: JSON.stringify(next) }), env);
  const changed = await (await worker.fetch(request(route + "?relativePath=" + encodeURIComponent(updated.relativePath), { method: "POST" }), env)).json();
  const unchanged = await (await worker.fetch(request(route + "?relativePath=" + encodeURIComponent(microphone.relativePath), { method: "POST" }), env)).json();
  assert.equal(changed.copiedBytes, updatedBytes.length);
  assert.equal(unchanged.copiedBytes, 0);
  assert.equal((await worker.fetch(request(route, { method: "POST" }), env)).status, 200);
  assert.ok(await env.EPISODE_MEDIA.get(candidate.assets[0].cloudPath));
});

test("unverified legacy media cannot obtain a full-backup proof from declared metadata", async () => {
  const env = makeEnv();
  await env.EPISODE_MEDIA.put("episodes/unsafe/Program/program.webm", "actual bytes", { customMetadata: { sha256: "0".repeat(64) } });
  env.EPISODE_MEDIA.objects.get("episodes/unsafe/Program/program.webm").checksum = undefined;
  const manifest = { version: 1, uploadSelection: "full-backup", revisionId: "unverified", episode: { id: "unsafe" }, assets: [{ kind: "program-video", relativePath: "Program/program.webm", contentHash: "0".repeat(64), bytes: 12 }] };
  assert.equal((await worker.fetch(request("/episodes/unsafe/manifest", { method: "PUT", body: JSON.stringify(manifest) }), env)).status, 400);
  assert.equal(await env.EPISODE_MEDIA.get("_system/last-full-backup/unsafe.json"), null);
});
