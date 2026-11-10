import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudEpisodeManifest } from "../shared/collaboration";
import type { EpisodeMetadata } from "../shared/types";

const electron = vi.hoisted(() => ({ userData: "", fetch: vi.fn() }));

vi.mock("electron", () => ({
  app: { isPackaged: true, getPath: () => electron.userData },
  net: { fetch: electron.fetch },
  safeStorage: { isEncryptionAvailable: () => false }
}));
vi.mock("./review-proxy-store", () => ({ prepareEpisodeReviewProxies: vi.fn(async () => undefined) }));

import { configureEpisodesRoot } from "./config-service";
import { markProjectMaterialized, publishEpisodeToCloud, pushProjectChanges } from "./collaboration-project-sync";

describe("episode cloud publishing", () => {
  let root: string;
  let episode: EpisodeMetadata;
  let current: CloudEpisodeManifest;
  let parentRevisions: Array<string | undefined>;
  let beforePut: () => void | Promise<void>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-cloud-publish-"));
    electron.userData = root;
    configureEpisodesRoot(root);
    const timestamp = "2026-11-10T18:50:00.000Z";
    episode = { id: "episode-a", title: "Episode A", status: "draft", createdAt: timestamp, updatedAt: timestamp, folderPath: path.join(root, "episode-a"), phase: "phase-1-shell" };
    await fs.mkdir(episode.folderPath);
    await fs.writeFile(path.join(episode.folderPath, "metadata.json"), JSON.stringify(episode));
    await fs.writeFile(path.join(root, "collaboration-remote.json"), JSON.stringify({ apiUrl: "https://collaboration.test" }));
    current = { version: 1, episode, revisionId: "initial", assets: [], uploadedAt: timestamp, collaborationStatus: "working" };
    parentRevisions = [];
    beforePut = () => undefined;
    electron.fetch.mockImplementation(async (input: string, init: RequestInit) => {
      if (!new URL(input).pathname.endsWith("/manifest")) {
        return new Response(null, { status: init.method === "HEAD" ? 404 : 200 });
      }
      if (init.method !== "PUT") return Response.json(current, { headers: { etag: `"${current.revisionId}"` } });
      const next = JSON.parse(String(init.body)) as CloudEpisodeManifest;
      parentRevisions.push(next.parentRevisionId);
      await beforePut();
      if (new Headers(init.headers).get("if-match") !== `"${current.revisionId}"`) {
        return Response.json({ error: "revision changed" }, { status: 412 });
      }
      current = next;
      return Response.json({ ok: true });
    });
    await markProjectMaterialized(episode.id);
  });

  afterEach(async () => {
    configureEpisodesRoot(undefined);
    electron.fetch.mockReset();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("publishes a background save and a manual upload against successive revisions", async () => {
    let release!: () => void;
    const holdFirstPublish = new Promise<void>((resolve) => { release = resolve; });
    beforePut = () => parentRevisions.length === 1 ? holdFirstPublish : undefined;
    const first = publishEpisodeToCloud(episode, "project-and-proxies");
    const second = pushProjectChanges(episode.id);
    const completed = Promise.all([first, second]);
    try {
      await vi.waitFor(() => expect(parentRevisions).toEqual(["initial"]));
    } finally {
      release();
      await completed;
    }
    expect(parentRevisions).toHaveLength(2);
    expect(parentRevisions[1]).toBeTruthy();
    expect(parentRevisions[1]).not.toBe("initial");
    expect(current.parentRevisionId).toBe(parentRevisions[1]);
  });

  it("rejects a real competing publish and refuses to overwrite it on retry", async () => {
    beforePut = () => { current = { ...current, revisionId: "other-computer" }; };
    await expect(publishEpisodeToCloud(episode, "project-and-proxies")).rejects.toThrow("changed while the upload was running");
    await expect(pushProjectChanges(episode.id)).rejects.toThrow("Newer project changes");
    expect(parentRevisions).toEqual(["initial"]);
    expect(current.revisionId).toBe("other-computer");
  });
});
