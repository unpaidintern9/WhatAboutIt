const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });

const PRESENCE_TTL_MS = 45_000;
const EDITOR_LEASE_MS = 30_000;

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-headers": "content-type, authorization, x-whataboutit-key, x-content-sha256",
    "access-control-allow-methods": "GET, HEAD, PUT, POST, DELETE, OPTIONS"
  };
}

function authorized(request, env) {
  if (!env.WHATABOUTIT_COLLAB_ACCESS_KEY) return true;
  const supplied = request.headers.get("x-whataboutit-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return supplied === env.WHATABOUTIT_COLLAB_ACCESS_KEY;
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
    const page = await env.EPISODE_MEDIA.list({ prefix: "episodes/", cursor, limit: 1000 });
    const manifests = page.objects.filter((object) => object.key.endsWith("/manifest.json"));
    for (const object of manifests) {
      const stored = await env.EPISODE_MEDIA.get(object.key);
      if (!stored) continue;
      try {
        const manifest = await stored.json();
        const summary = cloudSummary(manifest);
        if (summary.id) summaries.push(summary);
      } catch {
        // Ignore a malformed manifest rather than hiding healthy episodes.
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
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
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return json({ ok: true, service: "whataboutit-collab", storage: "r2", coordination: "durable-objects", presence: true, editorLease: true, episodeLibrary: true }, 200, cors);
    if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401, cors);

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
        return new Response(object.body, { headers });
      }
      if (request.method === "PUT") {
        try {
          const input = await request.json();
          const episode = input?.episode || {};
          if (cleanEpisodeId(String(episode.id || "")) !== episodeId) throw new Error("Manifest episode id does not match the route.");
          const manifest = {
            version: 1,
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
            assets: Array.isArray(input?.assets) ? input.assets : []
          };
          await env.EPISODE_MEDIA.put(key, JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
          return json({ ok: true, key, manifest }, 200, cors);
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
      if (request.method === "HEAD") {
        const object = await env.EPISODE_MEDIA.head(key);
        if (!object) return new Response(null, { status: 404, headers: cors });
        const headers = new Headers(cors);
        if (object.httpEtag) headers.set("etag", object.httpEtag);
        headers.set("x-content-sha256", object.customMetadata?.sha256 || "");
        headers.set("content-length", String(object.size || 0));
        return new Response(null, { status: 200, headers });
      }
      if (request.method === "PUT") {
        await env.EPISODE_MEDIA.put(key, request.body, {
          httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
          customMetadata: {
            sha256: request.headers.get("x-content-sha256") || "",
            uploadedAt: new Date().toISOString()
          }
        });
        return json({ ok: true, key }, 200, cors);
      }
      if (request.method === "GET") {
        const object = await env.EPISODE_MEDIA.get(key);
        if (!object) return json({ error: "Asset not found" }, 404, cors);
        const headers = new Headers(cors);
        object.writeHttpMetadata(headers);
        if (object.httpEtag) headers.set("etag", object.httpEtag);
        headers.set("x-content-sha256", object.customMetadata?.sha256 || "");
        return new Response(object.body, { headers });
      }
      if (request.method === "DELETE") {
        await env.EPISODE_MEDIA.delete(key);
        return json({ ok: true, key }, 200, cors);
      }
    }

    return json({ error: "Not found" }, 404, cors);
  }
};
