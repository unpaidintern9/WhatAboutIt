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
  async put(key, body, options = {}) {
    const bytes = body instanceof ReadableStream ? new Uint8Array(await new Response(body).arrayBuffer()) : new TextEncoder().encode(typeof body === "string" ? body : String(body ?? ""));
    this.objects.set(key, { bytes, httpMetadata: options.httpMetadata ?? {}, customMetadata: options.customMetadata ?? {} });
  }
  async get(key) {
    const entry = this.objects.get(key);
    if (!entry) return null;
    return {
      body: new Response(entry.bytes).body,
      httpMetadata: entry.httpMetadata,
      customMetadata: entry.customMetadata,
      httpEtag: `etag-${key}`,
      async json() { return JSON.parse(new TextDecoder().decode(entry.bytes)); },
      writeHttpMetadata(headers) { if (entry.httpMetadata.contentType) headers.set("content-type", entry.httpMetadata.contentType); }
    };
  }
  async head(key) {
    const entry = this.objects.get(key);
    if (!entry) return null;
    return { size: entry.bytes.length, customMetadata: entry.customMetadata, httpEtag: `etag-${key}` };
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
    WHATABOUTIT_COLLAB_ACCESS_KEY: "test-key",
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
    headers: { "x-whataboutit-key": "test-key", ...(init.headers ?? {}) }
  });
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
    assets: [{ relativePath: "Session/draft-timeline.json", bytes: 42 }]
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
