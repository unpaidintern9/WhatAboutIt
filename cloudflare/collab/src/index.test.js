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
        bucket.objects.set(key, { bytes, httpMetadata: upload.options.httpMetadata ?? {}, customMetadata: upload.options.customMetadata ?? {}, checksum, version: 1 });
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
      checksums: { sha256: entry.checksum },
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
    return { size: entry.bytes.length, customMetadata: entry.customMetadata, checksums: { sha256: entry.checksum }, httpEtag: `\"etag-${key}-${entry.version ?? 1}\"` };
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
  const manifest = { version: 1, uploadOperationId: "upload-a", revisionId: "published", episode: { id: "progress" }, assets: Array.from({ length: 10 }, (_, index) => ({ kind: "original-audio", relativePath: `Audio/mic-${index}.wav`, bytes: 100, contentHash: "0".repeat(64) })) };
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
