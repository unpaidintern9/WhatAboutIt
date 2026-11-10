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
  let cloudHasEpisode: boolean;
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
    cloudHasEpisode = true;
    parentRevisions = [];
    beforePut = () => undefined;
    electron.fetch.mockImplementation(async (input: string, init: RequestInit) => {
      if (!new URL(input).pathname.endsWith("/manifest")) {
        return new Response(null, { status: init.method === "HEAD" ? 404 : 200 });
      }
      if (init.method !== "PUT") {
        return cloudHasEpisode ? Response.json(current, { headers: { etag: `"${current.revisionId}"` } }) : new Response(null, { status: 404 });
      }
      const next = JSON.parse(String(init.body)) as CloudEpisodeManifest;
      parentRevisions.push(next.parentRevisionId);
      await beforePut();
      const headers = new Headers(init.headers);
      const matchesRevision = cloudHasEpisode ? headers.get("if-match") === `"${current.revisionId}"` : headers.get("if-none-match") === "*";
      if (!matchesRevision) {
        return Response.json({ error: "revision changed" }, { status: 412 });
      }
      current = next;
      cloudHasEpisode = true;
      return Response.json({ ok: true });
    });
    await markProjectMaterialized(episode.id);
  });

  afterEach(async () => {
    configureEpisodesRoot(undefined);
    electron.fetch.mockReset();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([true, false])("publishes a full backup followed by a queued background save (prior cloud episode: %s)", async (hasPriorEpisode) => {
    cloudHasEpisode = hasPriorEpisode;
    if (!hasPriorEpisode) await fs.rm(path.join(episode.folderPath, "Collaboration", "project-sync.json"));
    let release!: () => void;
    const holdFirstPublish = new Promise<void>((resolve) => { release = resolve; });
    beforePut = () => parentRevisions.length === 1 ? holdFirstPublish : undefined;
    const first = publishEpisodeToCloud(episode, "full-backup");
    const second = pushProjectChanges(episode.id);
    const completed = Promise.all([first, second]);
    try {
      await vi.waitFor(() => expect(parentRevisions).toEqual([hasPriorEpisode ? "initial" : undefined]));
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

  it("keeps the backup usable when cloud progress reporting is unavailable", async () => {
    const original = electron.fetch.getMockImplementation()!;
    let reportingAttempts = 0;
    electron.fetch.mockImplementation(async (input: string, init: RequestInit) => {
      if (new URL(input).pathname.endsWith("/upload-status")) {
        reportingAttempts++;
        return Response.json({ error: "Temporarily unavailable" }, { status: 503 });
      }
      return original(input, init);
    });
    await expect(publishEpisodeToCloud(episode, "full-backup")).resolves.toMatchObject({ episodeId: episode.id });
    expect(reportingAttempts).toBe(2);
    expect(current.uploadOperationId).toBeTruthy();
  });
});
