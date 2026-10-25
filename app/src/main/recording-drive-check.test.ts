import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCapturePriority } from "./media-work-scheduler";
const paths = vi.hoisted(() => ({ root: "" }));
vi.mock("./config-service", () => ({ getEpisodesRoot: () => paths.root }));
describe("recording volume write check", () => {
  beforeEach(async () => { paths.root = await fs.mkdtemp(path.join(os.tmpdir(), "wai-drive-")); });
  afterEach(async () => { setCapturePriority("test-drive", false); await fs.rm(paths.root, { recursive: true, force: true }); });
  it("measures durable writes on the selected volume and cleans up without touching media", async () => {
    const { checkRecordingDrive } = await import("./recording-drive-check");
    const original = path.join(paths.root, "recording.webm");
    await fs.writeFile(original, "protected original");
    const result = await checkRecordingDrive();
    expect(result.folder).toBe(paths.root);
    expect(result.testedBytes).toBeGreaterThan(0);
    expect(result.testedBytes).toBeLessThanOrEqual(24 * 1024 * 1024);
    expect(result.writeBytesPerSecond).toBeGreaterThan(0);
    expect(await fs.readdir(paths.root)).toEqual(["recording.webm"]);
    expect(await fs.readFile(original, "utf8")).toBe("protected original");
  });
  it("refuses a write benchmark during capture", async () => {
    const { checkRecordingDrive } = await import("./recording-drive-check");
    setCapturePriority("test-drive", true);
    await expect(checkRecordingDrive()).rejects.toThrow("before starting capture");
    expect(await fs.readdir(paths.root)).toEqual([]);
  });
});
