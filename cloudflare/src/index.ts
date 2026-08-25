export interface Env {
  APP_NAMESPACE: string;
  WHATABOUTIT_COLLABORATION_APP_KEY: string;
  EPISODES: R2Bucket;
  EPISODE_SESSIONS: DurableObjectNamespace;
}

type LockRecord = {
  memberId: string;
  memberName: string;
  token: string;
  expiresAt: number;
};

const LOCK_TTL_MS = 2 * 60 * 1000;

function json(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) }
  });
}

function safeEpisodeId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}

function safeAssetPath(value: string) {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.startsWith("/") || decoded.includes("..") || decoded.includes("\\")) return undefined;
  return decoded;
}

function authorized(request: Request, env: Env) {
  const supplied = request.headers.get("x-whataboutit-key") ?? "";
  return Boolean(env.WHATABOUTIT_COLLABORATION_APP_KEY && supplied === env.WHATABOUTIT_COLLABORATION_APP_KEY);
}

async function objectResponse(object: R2ObjectBody | null) {
  if (!object) return json({ error: "not_found" }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-whataboutit-sha256", object.customMetadata?.sha256 ?? "");
  return new Response(object.body, { headers });
}

export class EpisodeSession {
  constructor(private readonly state: DurableObjectState) {}

  private async currentLock() {
    const lock = await this.state.storage.get<LockRecord>("lock");
    if (lock && lock.expiresAt <= Date.now()) {
      await this.state.storage.delete("lock");
      return undefined;
    }
    return lock;
  }

  async fetch(request: Request) {
    const method = request.method.toUpperCase();
    const current = await this.currentLock();

    if (method === "GET") {
      return json({ locked: Boolean(current), lock: current ? { memberId: current.memberId, memberName: current.memberName, expiresAt: current.expiresAt } : null });
    }

    if (method === "POST") {
      const body = (await request.json()) as { memberId?: string; memberName?: string };
      if (!body.memberId || !body.memberName) return json({ error: "member_required" }, { status: 400 });
      if (current && current.memberId !== body.memberId) {
        return json({ error: "already_locked", lock: { memberId: current.memberId, memberName: current.memberName, expiresAt: current.expiresAt } }, { status: 409 });
      }
      const lock: LockRecord = {
        memberId: body.memberId,
        memberName: body.memberName,
        token: crypto.randomUUID(),
        expiresAt: Date.now() + LOCK_TTL_MS
      };
      await this.state.storage.put("lock", lock);
      return json({ locked: true, token: lock.token, expiresAt: lock.expiresAt });
    }

    const token = request.headers.get("x-whataboutit-lock-token");
    if (!current || !token || token !== current.token) return json({ error: "invalid_lock_token" }, { status: 409 });

    if (method === "PUT") {
      const next = { ...current, expiresAt: Date.now() + LOCK_TTL_MS };
      await this.state.storage.put("lock", next);
      return json({ locked: true, expiresAt: next.expiresAt });
    }

    if (method === "DELETE") {
      await this.state.storage.delete("lock");
      return json({ locked: false });
    }

    return json({ error: "method_not_allowed" }, { status: 405 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "whataboutit-collaboration", namespace: env.APP_NAMESPACE });
    }

    if (!authorized(request, env)) return json({ error: "unauthorized" }, { status: 401 });

    const lockMatch = url.pathname.match(/^\/v1\/episodes\/([^/]+)\/lock$/);
    if (lockMatch) {
      const episodeId = decodeURIComponent(lockMatch[1]);
      if (!safeEpisodeId(episodeId)) return json({ error: "invalid_episode_id" }, { status: 400 });
      const id = env.EPISODE_SESSIONS.idFromName(`whataboutit:${episodeId}`);
      return env.EPISODE_SESSIONS.get(id).fetch(request);
    }

    const manifestMatch = url.pathname.match(/^\/v1\/episodes\/([^/]+)\/manifest$/);
    if (manifestMatch) {
      const episodeId = decodeURIComponent(manifestMatch[1]);
      if (!safeEpisodeId(episodeId)) return json({ error: "invalid_episode_id" }, { status: 400 });
      const key = `episodes/${episodeId}/manifest.json`;
      if (request.method === "GET") return objectResponse(await env.EPISODES.get(key));
      if (request.method === "PUT") {
        await env.EPISODES.put(key, request.body, { httpMetadata: { contentType: "application/json" } });
        return json({ ok: true, key });
      }
      return json({ error: "method_not_allowed" }, { status: 405 });
    }

    const assetMatch = url.pathname.match(/^\/v1\/episodes\/([^/]+)\/assets\/(.+)$/);
    if (assetMatch) {
      const episodeId = decodeURIComponent(assetMatch[1]);
      const assetPath = safeAssetPath(assetMatch[2]);
      if (!safeEpisodeId(episodeId) || !assetPath) return json({ error: "invalid_path" }, { status: 400 });
      const key = `episodes/${episodeId}/${assetPath}`;

      if (request.method === "GET") return objectResponse(await env.EPISODES.get(key));
      if (request.method === "HEAD") {
        const object = await env.EPISODES.head(key);
        if (!object) return new Response(null, { status: 404 });
        return new Response(null, { status: 200, headers: { etag: object.httpEtag, "x-whataboutit-sha256": object.customMetadata?.sha256 ?? "" } });
      }
      if (request.method === "PUT") {
        const sha256 = request.headers.get("x-whataboutit-sha256") ?? undefined;
        await env.EPISODES.put(key, request.body, {
          httpMetadata: request.headers.get("content-type") ? { contentType: request.headers.get("content-type")! } : undefined,
          customMetadata: sha256 ? { sha256 } : undefined
        });
        return json({ ok: true, key, sha256 });
      }
      return json({ error: "method_not_allowed" }, { status: 405 });
    }

    return json({ error: "not_found" }, { status: 404 });
  }
};
