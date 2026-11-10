import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollaborationTransferProgress } from "../shared/collaboration";
import { createUploadProgressReporter } from "./collaboration-upload-progress";

const progress: CollaborationTransferProgress = { operationId: "upload-a", episodeId: "episode-a", direction: "upload", phase: "transferring", completedAssets: 0, totalAssets: 2, transferredBytes: 0, totalBytes: 1000, message: "Uploading episode." };

afterEach(() => vi.useRealTimers());
describe("cloud upload progress", () => {
  it("coalesces many part receipts and sends terminal progress after an in-flight heartbeat", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const reporter = createUploadProgressReporter({ selection: "full-backup", send, onUnavailable: vi.fn() });
    reporter.update(progress);
    for (let index = 1; index <= 50; index++) reporter.update({ ...progress, transferredBytes: index });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(1);
    reporter.update({ ...progress, phase: "complete", transferredBytes: 1000, completedAssets: 2, manifestRevisionId: "published" });
    const closed = reporter.close();
    release();
    await closed;
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({ phase: "complete", transferredBytes: 1000, manifestRevisionId: "published", sequence: 2 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("bounds the log and redacts credential text while cloud failures leave uploads usable", async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValue(new Error("offline"));
    const onUnavailable = vi.fn();
    const reporter = createUploadProgressReporter({ selection: "full-backup", send, onUnavailable });
    reporter.update(progress);
    for (let index = 0; index < 150; index++) reporter.event("retry", "Bearer private-token https://service.test/key accessKey=secret");
    reporter.update({ ...progress, phase: "error" });
    await expect(reporter.close()).resolves.toBeUndefined();
    const payload = send.mock.calls.at(-1)![0];
    expect(payload.events).toHaveLength(100);
    expect(payload.eventCount).toBe(152);
    expect(JSON.stringify(payload.events)).not.toMatch(/private-token|service.test|secret/);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});
