import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  userData: "",
  documents: "",
  fetch: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: (name: string) => name === "userData" ? electron.userData : electron.documents
  },
  net: {
    fetch: (...args: Parameters<typeof fetch>) => electron.fetch(...args)
  },
  safeStorage: {
    isEncryptionAvailable: () => false
  },
  shell: { openPath: vi.fn() }
}));

import { configureEpisodesRoot } from "./config-service";
import { downloadCloudEpisode } from "./collaboration-remote-service";

function hash(bytes: Uint8Array) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

describe("cloud episode download", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-cloud-download-"));
    electron.userData = path.join(root, "user-data");
    electron.documents = root;
    configureEpisodesRoot(path.join(root, "episodes"));
    await fs.mkdir(electron.userData, { recursive: true });
    await fs.writeFile(path.join(electron.userData, "collaboration-remote.json"), JSON.stringify({
      apiUrl: "https://collaboration.test",
      accessKey: "test-access-key",
      personId: "morgan-owner"
    }));
    electron.fetch.mockReset();
  });

  afterEach(async () => {
    configureEpisodesRoot(undefined);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("downloads concurrently, protects originals, and ignores stale machine-local markers", async () => {
    const episodeId = "episode-a";
    const files = new Map([
      ["metadata.json", Buffer.from(JSON.stringify({ id: episodeId, title: "Episode A", status: "draft", createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" }))],
      ["Exports/final.mp4", Buffer.from("export-bytes")],
      ["Captions/final.vtt", Buffer.from("caption-bytes")],
      ["Program/program.webm", Buffer.from("cloud-original")]
    ]);
    const localOriginal = Buffer.from("protected-local-original");
    const episodeFolder = path.join(root, "episodes", episodeId);
    await fs.mkdir(path.join(episodeFolder, "Program"), { recursive: true });
    await fs.writeFile(path.join(episodeFolder, "Program", "program.webm"), localOriginal);

    const assets = [
      ...[...files].map(([relativePath, bytes], index) => ({
        id: `asset-${index}`,
        kind: relativePath === "metadata.json" ? "metadata" : relativePath.startsWith("Program/") ? "original-video" : relativePath.startsWith("Exports/") ? "export" : "captions",
        relativePath,
        localOriginal: relativePath.startsWith("Program/"),
        contentHash: hash(bytes),
        bytes: bytes.length,
        state: "synced",
        updatedAt: "2026-08-27T00:00:00.000Z"
      })),
      {
        id: "stale-marker",
        kind: "other",
        relativePath: "Collaboration/project-sync.json",
        localOriginal: false,
        contentHash: hash(Buffer.from("old-marker")),
        bytes: 10,
        state: "synced",
        updatedAt: "2026-08-27T00:00:00.000Z"
      }
    ];
    const manifest = {
      version: 1,
      revisionId: "revision-a",
      episode: { id: episodeId, title: "Episode A", status: "draft", createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" },
      collaborationStatus: "working",
      uploadedAt: "2026-08-27T00:00:00.000Z",
      assets
    };
    let activeStreams = 0;
    let maximumStreams = 0;
    const requestedAssets: string[] = [];

    electron.fetch.mockImplementation(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/manifest")) return Response.json(manifest);
      const encodedPath = url.pathname.split("/assets/")[1];
      if (!encodedPath) throw new Error(`Unexpected request ${url}`);
      const relativePath = decodeURIComponent(encodedPath);
      requestedAssets.push(relativePath);
      const bytes = files.get(relativePath);
      if (!bytes) throw new Error(`Unexpected asset request ${relativePath}`);
      activeStreams += 1;
      maximumStreams = Math.max(maximumStreams, activeStreams);
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          controller.enqueue(bytes);
          controller.close();
          activeStreams -= 1;
        }
      });
      return new Response(body, { headers: { "content-length": String(bytes.length) } });
    });

    const result = await downloadCloudEpisode(episodeId);

    expect(requestedAssets).not.toContain("Collaboration/project-sync.json");
    expect(maximumStreams).toBeGreaterThan(1);
    expect(await fs.readFile(path.join(episodeFolder, "Exports", "final.mp4"))).toEqual(files.get("Exports/final.mp4"));
    expect(await fs.readFile(path.join(episodeFolder, "Captions", "final.vtt"))).toEqual(files.get("Captions/final.vtt"));
    expect(await fs.readFile(path.join(episodeFolder, "Program", "program.webm"))).toEqual(localOriginal);
    expect(result.sync.downloadedAssets).toBe(3);
    expect(result.sync.skippedAssets).toBe(1);
    const completion = JSON.parse(await fs.readFile(path.join(episodeFolder, "Session", "cloud-download-complete.json"), "utf8")) as { assetCount: number };
    expect(completion.assetCount).toBe(4);
  });

  it("resumes an interrupted asset with a byte range and commits only after checksum verification", async () => {
    const episodeId = "episode-resume";
    const relativePath = "Captions/final.vtt";
    const bytes = Buffer.from("complete-caption-payload");
    const splitAt = 9;
    const episodeFolder = path.join(root, "episodes", episodeId);
    const destination = path.join(episodeFolder, "Captions", "final.vtt");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(`${destination}.cloud-download.partial`, bytes.subarray(0, splitAt));
    const manifest = {
      version: 1,
      revisionId: "revision-resume",
      episode: { id: episodeId, title: "Resume", status: "draft", createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" },
      collaborationStatus: "working",
      uploadedAt: "2026-08-27T00:00:00.000Z",
      assets: [{
        id: "caption",
        kind: "captions",
        relativePath,
        localOriginal: false,
        contentHash: hash(bytes),
        bytes: bytes.length,
        state: "synced",
        updatedAt: "2026-08-27T00:00:00.000Z"
      }]
    };
    let requestedRange: string | null = null;
    electron.fetch.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/manifest")) return Response.json(manifest);
      requestedRange = new Headers(init?.headers).get("range");
      return new Response(bytes.subarray(splitAt), {
        status: 206,
        headers: {
          "content-length": String(bytes.length - splitAt),
          "content-range": `bytes ${splitAt}-${bytes.length - 1}/${bytes.length}`
        }
      });
    });

    await downloadCloudEpisode(episodeId);

    expect(requestedRange).toBe(`bytes=${splitAt}-`);
    expect(await fs.readFile(destination)).toEqual(bytes);
    await expect(fs.access(`${destination}.cloud-download.partial`)).rejects.toThrow();
  });
});
