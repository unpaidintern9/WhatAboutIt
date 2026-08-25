const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-headers": "content-type, authorization, x-whataboutit-key",
    "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS"
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

function episodeAssetKey(episodeId, relativePath) {
  const cleaned = relativePath.split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/");
  if (!cleaned) throw new Error("Asset path is required.");
  return `episodes/${episodeId}/${cleaned}`;
}

export class EpisodeCollaboration {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const state = (await this.ctx.storage.get("state")) || {
      activeEditor: null,
      members: [],
      comments: [],
      version: 1,
      updatedAt: new Date().toISOString()
    };

    if (request.method === "GET" && url.pathname.endsWith("/state")) return json(state);

    if (request.method === "PUT" && url.pathname.endsWith("/state")) {
      const next = { ...(await request.json()), updatedAt: new Date().toISOString() };
      await this.ctx.storage.put("state", next);
      return json(next);
    }

    if (request.method === "POST" && url.pathname.endsWith("/lock")) {
      const input = await request.json();
      const now = Date.now();
      const current = state.activeEditor;
      if (current && current.expiresAt > now && current.memberId !== input.memberId) {
        return json({ ok: false, activeEditor: current }, 409);
      }
      const activeEditor = {
        memberId: String(input.memberId || "unknown"),
        displayName: String(input.displayName || "Editor"),
        acquiredAt: now,
        expiresAt: now + 120000
      };
      const next = { ...state, activeEditor, updatedAt: new Date().toISOString() };
      await this.ctx.storage.put("state", next);
      return json({ ok: true, activeEditor });
    }

    if (request.method === "DELETE" && url.pathname.endsWith("/lock")) {
      const memberId = url.searchParams.get("memberId");
      if (!state.activeEditor || !memberId || state.activeEditor.memberId === memberId) {
        const next = { ...state, activeEditor: null, updatedAt: new Date().toISOString() };
        await this.ctx.storage.put("state", next);
        return json({ ok: true });
      }
      return json({ ok: false, activeEditor: state.activeEditor }, 409);
    }

    return json({ error: "Not found" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health") return json({ ok: true, service: "whataboutit-collab", storage: "r2", coordination: "durable-objects" }, 200, cors);
    if (!authorized(request, env)) return json({ error: "Unauthorized" }, 401, cors);

    const match = url.pathname.match(/^\/episodes\/([^/]+)(\/.*)?$/);
    if (!match) return json({ error: "Not found" }, 404, cors);

    let episodeId;
    try {
      episodeId = cleanEpisodeId(decodeURIComponent(match[1]));
    } catch (error) {
      return json({ error: error.message }, 400, cors);
    }
    const suffix = match[2] || "";

    if (suffix === "/state" || suffix === "/lock") {
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
        if (!object) return json({ episodeId, assets: [], version: 1 }, 200, cors);
        const headers = new Headers(cors);
        headers.set("content-type", object.httpMetadata?.contentType || "application/json; charset=utf-8");
        return new Response(object.body, { headers });
      }
      if (request.method === "PUT") {
        const body = await request.arrayBuffer();
        await env.EPISODE_MEDIA.put(key, body, { httpMetadata: { contentType: "application/json" } });
        return json({ ok: true, key }, 200, cors);
      }
    }

    if (suffix.startsWith("/assets/")) {
      let key;
      try {
        key = episodeAssetKey(episodeId, decodeURIComponent(suffix.slice("/assets/".length)));
      } catch (error) {
        return json({ error: error.message }, 400, cors);
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
