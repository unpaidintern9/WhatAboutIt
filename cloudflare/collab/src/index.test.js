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
        return { httpEtag: `etag-${key}` };
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
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader || "");
    if (match) {
      const offset = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), entry.bytes.length - 1) : entry.bytes.length - 1;
      bytes = entry.bytes.slice(offset, end + 1);
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
    return { size: entry.bytes.length, customMetadata: entry.customMetadata, checksums: { sha256: entry.checksum }, httpEtag: `etag-${key}` };
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
