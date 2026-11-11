import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.root } }));
import { prepareUploadObjectPath, clearPreparedUploadPaths, setUploadCheckpoint, getUploadCheckpoint } from "./collaboration-upload-journal";
import { organizedCloudObjectPath, isVersionedCloudPath } from "../shared/cloud-assets";
beforeEach(async () => { state.root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-prepared-")); });
afterEach(async () => { await fs.rm(state.root, { recursive: true, force: true }); });
it("retains verified cloud file identities after clearing the final multipart checkpoint", async () => {
  const key = organizedCloudObjectPath("Audio/guest-mic.flac", "2026-11-10_23-12-56");
  expect(key).toBe("_system/versions/2026-11-10_23-12-56/Audio/guest-mic.flac");
  expect(isVersionedCloudPath(key)).toBe(true);
  await prepareUploadObjectPath("episode", "Audio/guest-mic.flac", "hash", key);
  await setUploadCheckpoint("episode", "Audio/guest-mic.flac", { uploadId: "saved", bytes: 10, partSizeBytes: 10, parts: [], updatedAt: "now" });
  await setUploadCheckpoint("episode", "Audio/guest-mic.flac", undefined);
  expect(await getUploadCheckpoint("episode", "Audio/guest-mic.flac")).toBeUndefined();
  expect(await prepareUploadObjectPath("episode", "Audio/guest-mic.flac", "hash", "another-upload")).toBe(key);
  await clearPreparedUploadPaths("episode");
  expect(await prepareUploadObjectPath("episode", "Audio/guest-mic.flac", "hash", "new-upload")).toBe("new-upload");
});
it("uses a new version for changed bytes and preserves parallel journal updates", async () => {
  await Promise.all([
    prepareUploadObjectPath("episode", "Audio/a.flac", "hash-a", "Audio/versions/day/a.flac"),
    prepareUploadObjectPath("episode", "Cameras/a.webm", "hash-b", "Cameras/versions/day/a.webm")
  ]);
  expect(await prepareUploadObjectPath("episode", "Cameras/a.webm", "hash-b", "other")).toBe("Cameras/versions/day/a.webm");
  expect(await prepareUploadObjectPath("episode", "Audio/a.flac", "changed", "Audio/versions/new/a.flac")).toBe("Audio/versions/new/a.flac");
  expect(() => organizedCloudObjectPath("../secret", "today")).toThrow();
  expect(() => organizedCloudObjectPath("Audio/a.flac", "../today")).toThrow();
});
