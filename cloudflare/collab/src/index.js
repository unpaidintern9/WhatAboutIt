const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });

const PRESENCE_TTL_MS = 45_000;
const EDITOR_LEASE_MS = 30_000;
const MAX_MANIFEST_ASSETS = 2_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

function logEvent(level, event, details = {}) {
  console[level](JSON.stringify({ service: "whataboutit-collab", event, at: new Date().toISOString(), ...details }));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowedOrigins = String(env.WHATABOUTIT_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : undefined;
  return {
    ...(allowedOrigin ? { "access-control-allow-origin": allowedOrigin, vary: "Origin" } : {}),
    "access-control-allow-headers": "content-type, authorization, x-whataboutit-key, x-content-sha256, x-request-id, if-match, if-none-match, range",
    "access-control-allow-methods": "GET, HEAD, PUT, POST, DELETE, OPTIONS"
  };
}

function configuredAccessKeys(env) {
  try {
    const parsed = JSON.parse(env.WHATABOUTIT_COLLAB_ACCESS_KEYS || "{}");
    return Object.entries(parsed).filter(([identity, key]) => /^[A-Za-z0-9._-]{1,80}$/.test(identity) && typeof key === "string" && key.length >= 24);
  } catch {
    return [];
  }
}

async function constantTimeEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right))
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function authorizedIdentity(request, env) {
  const supplied = request.headers.get("x-whataboutit-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supplied) return undefined;
  for (const [identity, key] of configuredAccessKeys(env)) {
    if (await constantTimeEqual(supplied, key)) return identity;
  }
  return undefined;
}

function cleanSha256(value) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("A valid SHA-256 checksum is required.");
  return hash;
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function hashObject(object) {
  if (typeof DigestStream === "undefined") {
    return hex(await crypto.subtle.digest("SHA-256", await new Response(object.body).arrayBuffer()));
  }
  const digest = new DigestStream("SHA-256");
  await object.body.pipeTo(digest);
  return hex(await digest.digest);
}

function cleanEpisodeId(value) {
  if (!value || !/^[A-Za-z0-9._-]{1,160}$/.test(value)) throw new Error("Invalid episode id.");
  return value;
}

function cleanMember(input) {
  const memberId = String(input?.memberId || "").trim();
  const displayName = String(input?.displayName || "").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(memberId)) throw new Error("Invalid member id.");
  if (!displayName || displayName.length > 120) throw new Error("Invalid display name.");
  return { memberId, displayName };
}

function episodeAssetKey(episodeId, relativePath) {
  const cleaned = relativePath.split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/");
  if (!cleaned) throw new Error("Asset path is required.");
  return `episodes/${episodeId}/${cleaned}`;
}

function temporaryStorageFailure(error, cors) {
  console.error("WhatAboutIt collaboration storage operation failed", error);
  return json({ error: "Cloud storage is temporarily unavailable. The app can retry this upload safely." }, 503, cors);
}

function multipartStorageFailure(error, cors) {
  const message = String(error?.message || error || "");
  if (/NoSuchUpload|multipart upload (?:was )?not found|does not exist/i.test(message)) {
    return json({ error: "Multipart upload no longer exists.", code: "multipart-upload-expired" }, 404, cors);
  }
  return temporaryStorageFailure(error, cors);
}

function normalizeState(state) {
  const now = Date.now();
  const presence = Object.fromEntries(
    Object.entries(state.presence || {}).filter(([, entry]) => Number(entry?.expiresAt || 0) > now)
  );
  const activeEditor = state.activeEditor && Number(state.activeEditor.expiresAt || 0) > now ? state.activeEditor : null;
  return { ...state, presence, activeEditor };
}

function cloudSummary(manifest) {
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const episode = manifest?.episode || {};
  return {
    id: String(episode.id || ""),
    title: String(episode.title || "Untitled Episode"),
    guestName: episode.guestName || undefined,
    description: episode.description || undefined,
    status: String(episode.status || "draft"),
    createdAt: String(episode.createdAt || manifest.uploadedAt || new Date(0).toISOString()),
    updatedAt: String(episode.updatedAt || manifest.uploadedAt || new Date(0).toISOString()),
    uploadedAt: String(manifest.uploadedAt || episode.updatedAt || new Date(0).toISOString()),
    assetCount: assets.length,
    totalBytes: assets.reduce((total, asset) => total + Number(asset?.bytes || 0), 0)
  };
}

async function listCloudEpisodes(env) {
  const summaries = [];
  let cursor;
  do {
    const page = await env.EPISODE_MEDIA.list({ prefix: "episode-index/", cursor, limit: 1000 });
    for (const object of page.objects) {
      const stored = await env.EPISODE_MEDIA.get(object.key);
      if (!stored) continue;
      try {
        const summary = await stored.json();
        if (summary.id) summaries.push(summary);
      } catch {
        // Ignore a malformed manifest rather than hiding healthy episodes.
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  // One-time compatibility migration for buckets created before the compact
  // index existed. Normal requests never scan media keys after this succeeds.
  if (summaries.length === 0) {
    let legacyCursor;
    do {
      const page = await env.EPISODE_MEDIA.list({ prefix: "episodes/", cursor: legacyCursor, limit: 1000 });
      for (const object of page.objects.filter((candidate) => candidate.key.endsWith("/manifest.json"))) {
        const stored = await env.EPISODE_MEDIA.get(object.key);
        if (!stored) continue;
        try {
          const summary = cloudSummary(await stored.json());
          if (!summary.id) continue;
          summaries.push(summary);
          await env.EPISODE_MEDIA.put(`episode-index/${summary.id}.json`, JSON.stringify(summary), { httpMetadata: { contentType: "application/json" } });
        } catch {
          // Leave malformed legacy data isolated from the healthy index.
        }
      }
      legacyCursor = page.truncated ? page.cursor : undefined;
    } while (legacyCursor);
    if (summaries.length > 0) logEvent("log", "episode-index-migrated", { episodeCount: summaries.length });
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export class EpisodeCollaboration {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async readState() {
    const stored = (await this.ctx.storage.get("state")) || {
      activeEditor: null,
      presence: {},
      members: [],
      comments: [],
      version: 2,
      updatedAt: new Date().toISOString()
    };
    const state = normalizeState(stored);
    if (JSON.stringify(state) !== JSON.stringify(stored)) await this.ctx.storage.put("state", state);
    return state;
  }

  async writeState(state) {
    const next = { ...state, version: 2, updatedAt: new Date().toISOString() };
    await this.ctx.storage.put("state", next);
    return next;
  }

  async fetch(request) {
    const url = new URL(request.url);
    let state = await this.readState();

    if (request.method === "GET" && url.pathname.endsWith("/state")) return json(state);

    if (request.method === "PUT" && url.pathname.endsWith("/state")) {
      const input = await request.json();
      const next = await this.writeState({
        ...state,
        members: Array.isArray(input.members) ? input.members : state.members,
        comments: Array.isArray(input.comments) ? input.comments : state.comments
      });
      return json(next);
    }

    if (request.method === "POST" && url.pathname.endsWith("/presence")) {
      try {
        const input = await request.json();
        const member = cleanMember(input);
        const now = Date.now();
        const requestedMode = input.mode === "editing" ? "editing" : "viewing";
        const currentEditor = state.activeEditor;
        const actualMode = requestedMode === "editing" && currentEditor?.memberId === member.memberId ? "editing" : "viewing";
        const presence = {
          ...state.presence,
          [member.memberId]: {
            ...member,
            mode: actualMode,
            lastSeenAt: now,
            expiresAt: now + PRESENCE_TTL_MS
          }
        };
        state = await this.writeState({ ...state, presence });
        return json({ ok: true, state });
      } catch (error) {
        return json({ error: error.message }, 400);
      }
    }

    if (request.method === "DELETE" && url.pathname.endsWith("/presence")) {
      const memberId = url.searchParams.get("memberId");
      const presence = { ...state.presence };
      if (memberId) delete presence[memberId];
      const activeEditor = state.activeEditor?.memberId === memberId ? null : state.activeEditor;
      state = await this.writeState({ ...state, presence, activeEditor });
      return json({ ok: true, state });
    }

    if (request.method === "POST" && url.pathname.endsWith("/lock")) {
      try {
        const input = await request.json();
        const member = cleanMember(input);
        const now = Date.now();
        const current = state.activeEditor;
        if (current && current.memberId !== member.memberId) {
          return json({ ok: false, reason: "already-locked", activeEditor: current, state }, 409);
        }
        const activeEditor = {
          ...member,
          acquiredAt: current?.memberId === member.memberId ? current.acquiredAt : now,
          heartbeatAt: now,
          expiresAt: now + EDITOR_LEASE_MS
        };
        const presence = {
          ...state.presence,
          [member.memberId]: {
            ...member,
            mode: "editing",
            lastSeenAt: now,
            expiresAt: now + PRESENCE_TTL_MS
          }
        };
        state = await this.writeState({ ...state, activeEditor, presence });
        return json({ ok: true, activeEditor, state });
      } catch (error) {
        return json({ error: error.message }, 400);
      }
    }

    if (request.method === "POST" && url.pathname.endsWith("/lock/heartbeat")) {
      try {
        const input = await request.json();
        const member = cleanMember(input);
        if (!state.activeEditor || state.activeEditor.memberId !== member.memberId) {
          return json({ ok: false, reason: "not-editor", activeEditor: state.activeEditor, state }, 409);
        }
        const now = Date.now();
        const activeEditor = { ...state.activeEditor, heartbeatAt: now, expiresAt: now + EDITOR_LEASE_MS };
        const presence = {
          ...state.presence,
          [member.memberId]: {
            ...member,
            mode: "editing",
            lastSeenAt: now,
            expiresAt: now + PRESENCE_TTL_MS
          }
        };
        state = await this.writeState({ ...state, activeEditor, presence });
        return json({ ok: true, activeEditor, state });
      } catch (error) {
        return json({ error: error.message }, 400);
      }
    }

    if (request.method === "DELETE" && url.pathname.endsWith("/lock")) {
      const memberId = url.searchParams.get("memberId");
      if (!state.activeEditor || !memberId || state.activeEditor.memberId === memberId) {
        const presence = { ...state.presence };
        if (memberId && presence[memberId]) presence[memberId] = { ...presence[memberId], mode: "viewing" };
        state = await this.writeState({ ...state, activeEditor: null, presence });
        return json({ ok: true, state });
      }
      return json({ ok: false, activeEditor: state.activeEditor, state }, 409);
    }

    return json({ error: "Not found" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const accessKeys = configuredAccessKeys(env);
    if (url.pathname === "/health") return json({ ok: true, service: "whataboutit-collab", storage: "r2", coordination: "durable-objects", presence: true, editorLease: true, episodeLibrary: true, authenticationConfigured: accessKeys.length > 0, indexedLibrary: true, checksums: "sha256" }, 200, cors);
    if (accessKeys.length === 0) return json({ error: "Collaboration authentication is not configured." }, 503, cors);
    const identity = await authorizedIdentity(request, env);
    if (!identity) return json({ error: "Unauthorized" }, 401, cors);
    logEvent("log", "request", { identity, requestId: request.headers.get("x-request-id") || crypto.randomUUID(), method: request.method, path: url.pathname });

    if (url.pathname === "/episodes" && request.method === "GET") {
      return json({ episodes: await listCloudEpisodes(env) }, 200, cors);
    }

    const match = url.pathname.match(/^\/episodes\/([^/]+)(\/.*)?$/);
    if (!match) return json({ error: "Not found" }, 404, cors);

    let episodeId;
    try {
      episodeId = cleanEpisodeId(decodeURIComponent(match[1]));
    } catch (error) {
      return json({ error: error.message }, 400, cors);
    }
    const suffix = match[2] || "";

    if (suffix === "/state" || suffix === "/presence" || suffix === "/lock" || suffix === "/lock/heartbeat") {
      const stub = env.EPISODES.getByName(episodeId);
      const response = await stub.fetch(request);
      const headers = new Headers(response.headers);
      Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
      return new Response(response.body, { status: response.status, headers });
    }

    if (suffix === "/manifest") {
      const key = `episodes/${episodeId}/manifest.json`;
      if (request.method === "GET") {
        const object = await env.EPISODE_MEDIA.get(key);
        if (!object) return json({ error: "Episode is not in the cloud library." }, 404, cors);
        const headers = new Headers(cors);
        headers.set("content-type", object.httpMetadata?.contentType || "application/json; charset=utf-8");
        if (object.httpEtag) headers.set("etag", object.httpEtag);
        return new Response(object.body, { headers });
      }
      if (request.method === "PUT") {
        try {
          const declaredLength = Number(request.headers.get("content-length") || 0);
          if (declaredLength > MAX_MANIFEST_BYTES) throw new Error("Manifest is too large.");
          const input = await request.json();
          const episode = input?.episode || {};
          if (cleanEpisodeId(String(episode.id || "")) !== episodeId) throw new Error("Manifest episode id does not match the route.");
          if (!Array.isArray(input?.assets) || input.assets.length > MAX_MANIFEST_ASSETS) throw new Error(`Manifest must contain at most ${MAX_MANIFEST_ASSETS} assets.`);
          const assets = input.assets.map((asset) => {
            const relativePath = String(asset?.relativePath || "").replaceAll("\\", "/");
            if (!relativePath || relativePath.length > 1024 || relativePath.startsWith("/") || relativePath.split("/").some((part) => !part || part === "..")) throw new Error("Manifest contains an invalid asset path.");
            const bytes = Number(asset?.bytes);
            if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Manifest contains an invalid asset size.");
            return { ...asset, relativePath, bytes, contentHash: cleanSha256(asset?.contentHash) };
          });
          const manifest = {
            version: 1,
            revisionId: String(input?.revisionId || crypto.randomUUID()),
            parentRevisionId: input?.parentRevisionId ? String(input.parentRevisionId) : undefined,
            episode: {
              id: episodeId,
              title: String(episode.title || "Untitled Episode").slice(0, 300),
              guestName: episode.guestName ? String(episode.guestName).slice(0, 300) : undefined,
              description: episode.description ? String(episode.description).slice(0, 4000) : undefined,
              status: String(episode.status || "draft").slice(0, 80),
              createdAt: String(episode.createdAt || new Date().toISOString()),
              updatedAt: String(episode.updatedAt || new Date().toISOString())
            },
            collaborationStatus: String(input?.collaborationStatus || "working"),
            uploadedAt: new Date().toISOString(),
            assets
          };
          const conditionalHeaders = new Headers();
          if (request.headers.has("if-match")) conditionalHeaders.set("if-match", request.headers.get("if-match"));
          if (request.headers.has("if-none-match")) conditionalHeaders.set("if-none-match", request.headers.get("if-none-match"));
          const hasCondition = request.headers.has("if-match") || request.headers.has("if-none-match");
          let stored;
          try {
            stored = await env.EPISODE_MEDIA.put(key, JSON.stringify(manifest), {
              httpMetadata: { contentType: "application/json" },
              ...(hasCondition ? { onlyIf: conditionalHeaders } : {})
            });
          } catch (error) {
            return temporaryStorageFailure(error, cors);
          }
          if (!stored) return json({ error: "The cloud episode changed before this manifest could be saved." }, 412, cors);
          await env.EPISODE_MEDIA.put(`episode-index/${episodeId}.json`, JSON.stringify(cloudSummary(manifest)), {
            httpMetadata: { contentType: "application/json" }
          });
          const responseHeaders = { ...cors };
          if (stored.httpEtag) responseHeaders.etag = stored.httpEtag;
          return json({ ok: true, key, manifest }, 200, responseHeaders);
        } catch (error) {
          return json({ error: error.message }, 400, cors);
        }
      }
    }

    if (suffix.startsWith("/assets/")) {
      let key;
      try {
        key = episodeAssetKey(episodeId, decodeURIComponent(suffix.slice("/assets/".length)));
      } catch (error) {
        return json({ error: error.message }, 400, cors);
      }
      const multipartAction = url.searchParams.get("multipart");
      if (multipartAction === "create" && request.method === "POST") {
        try {
          const contentHash = cleanSha256(request.headers.get("x-content-sha256"));
          const upload = await env.EPISODE_MEDIA.createMultipartUpload(key, {
            httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
            customMetadata: {
              sha256: contentHash,
              uploadedAt: new Date().toISOString()
            }
          });
          return json({ key: upload.key, uploadId: upload.uploadId }, 200, cors);
        } catch (error) {
          return multipartStorageFailure(error, cors);
        }
      }
      if (multipartAction === "part" && request.method === "PUT") {
        const uploadId = url.searchParams.get("uploadId");
        const partNumber = Number(url.searchParams.get("partNumber"));
        if (!uploadId || uploadId.length > 1024 || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
          return json({ error: "A valid multipart upload id and part number are required." }, 400, cors);
        }
        if (!request.body) return json({ error: "Upload part body is required." }, 400, cors);
        try {
          const upload = env.EPISODE_MEDIA.resumeMultipartUpload(key, uploadId);
          const part = await upload.uploadPart(partNumber, request.body);
          return json({ partNumber: part.partNumber, etag: part.etag }, 200, cors);
        } catch (error) {
          return multipartStorageFailure(error, cors);
        }
      }
      if (multipartAction === "complete" && request.method === "POST") {
        const uploadId = url.searchParams.get("uploadId");
        if (!uploadId || uploadId.length > 1024) return json({ error: "A valid multipart upload id is required." }, 400, cors);
        let parts;
        try {
          const input = await request.json();
          parts = Array.isArray(input?.parts) ? input.parts : [];
          if (!parts.length || parts.some((part) => !Number.isInteger(part?.partNumber) || part.partNumber < 1 || part.partNumber > 10_000 || typeof part.etag !== "string" || !part.etag)) {
            return json({ error: "Valid uploaded part receipts are required." }, 400, cors);
          }
        } catch {
          return json({ error: "Multipart completion body must be valid JSON." }, 400, cors);
        }
        try {
          const upload = env.EPISODE_MEDIA.resumeMultipartUpload(key, uploadId);
          const object = await upload.complete(parts);
          const stored = await env.EPISODE_MEDIA.get(key);
          if (!stored) throw new Error("Completed object could not be verified.");
          const expectedHash = cleanSha256(stored.customMetadata?.sha256);
          const actualHash = await hashObject(stored);
          if (actualHash !== expectedHash) {
            await env.EPISODE_MEDIA.delete(key);
            logEvent("error", "checksum-mismatch", { identity, key, expectedHash, actualHash });
            return json({ error: "Uploaded bytes did not match the declared SHA-256 checksum.", code: "checksum-mismatch" }, 422, cors);
          }
          logEvent("log", "multipart-verified", { identity, key, sha256: actualHash });
          return json({ ok: true, key, etag: object.httpEtag }, 200, cors);
        } catch (error) {
          return multipartStorageFailure(error, cors);
        }
      }
      if (multipartAction === "abort" && request.method === "DELETE") {
        const uploadId = url.searchParams.get("uploadId");
        if (!uploadId || uploadId.length > 1024) return json({ error: "A valid multipart upload id is required." }, 400, cors);
        try {
          const upload = env.EPISODE_MEDIA.resumeMultipartUpload(key, uploadId);
          await upload.abort();
          return json({ ok: true, key }, 200, cors);
        } catch (error) {
          if (/sha-?256|checksum|hash mismatch/i.test(String(error?.message || error))) {
            return json({ error: "Uploaded bytes did not match the declared SHA-256 checksum.", code: "checksum-mismatch" }, 422, cors);
          }
          return temporaryStorageFailure(error, cors);
        }
      }
      if (request.method === "HEAD") {
        const object = await env.EPISODE_MEDIA.head(key);
        if (!object) return new Response(null, { status: 404, headers: cors });
        const headers = new Headers(cors);
        if (object.httpEtag) headers.set("etag", object.httpEtag);
        headers.set("x-content-sha256", object.checksums?.sha256 ? hex(object.checksums.sha256) : object.customMetadata?.sha256 || "");
        headers.set("content-length", String(object.size || 0));
        return new Response(null, { status: 200, headers });
      }
      if (request.method === "PUT") {
        try {
          const contentHash = cleanSha256(request.headers.get("x-content-sha256"));
          const stored = await env.EPISODE_MEDIA.put(key, request.body, {
            httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
            sha256: contentHash,
            customMetadata: {
              sha256: contentHash,
              uploadedAt: new Date().toISOString()
            }
          });
          const verifiedHash = stored?.checksums?.sha256 ? hex(stored.checksums.sha256) : contentHash;
          logEvent("log", "direct-upload-verified", { identity, key, sha256: verifiedHash });
          return json({ ok: true, key, sha256: verifiedHash }, 200, cors);
        } catch (error) {
          if (/sha-?256|checksum|hash mismatch/i.test(String(error?.message || error))) {
            return json({ error: "Uploaded bytes did not match the declared SHA-256 checksum.", code: "checksum-mismatch" }, 422, cors);
          }
          return temporaryStorageFailure(error, cors);
        }
      }
      if (request.method === "GET") {
        const rangeHeader = request.headers.get("range");
        const object = await env.EPISODE_MEDIA.get(key, rangeHeader ? { range: request.headers } : undefined);
        if (!object) return json({ error: "Asset not found" }, 404, cors);
        const headers = new Headers(cors);
        object.writeHttpMetadata(headers);
        if (object.httpEtag) headers.set("etag", object.httpEtag);
        headers.set("x-content-sha256", object.checksums?.sha256 ? hex(object.checksums.sha256) : object.customMetadata?.sha256 || "");
        headers.set("accept-ranges", "bytes");
        if (object.range) {
          headers.set("content-range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
          headers.set("content-length", String(object.range.length));
        } else {
          headers.set("content-length", String(object.size));
        }
        return new Response(object.body, { status: object.range ? 206 : 200, headers });
      }
      if (request.method === "DELETE") {
        await env.EPISODE_MEDIA.delete(key);
        return json({ ok: true, key }, 200, cors);
      }
    }

    return json({ error: "Not found" }, 404, cors);
  }
};
