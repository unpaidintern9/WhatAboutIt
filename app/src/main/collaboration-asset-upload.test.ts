import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestCollaborationWithRetry, uploadCollaborationAsset, type MultipartUploadCheckpoint } from "./collaboration-asset-upload";

describe("collaboration asset upload", () => {
  let folder = "";
  let filePath = "";

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "wai-cloud-upload-"));
    filePath = path.join(folder, "camera-1.webm");
  });

  afterEach(async () => {
    await fs.rm(folder, { recursive: true, force: true });
  });

  it("recreates the bounded request body and retries a transient 502", async () => {
    await fs.writeFile(filePath, Buffer.from("camera bytes"));
    let putAttempts = 0;
    const received: string[] = [];
    const onRetry = vi.fn();
    const apiFetch = vi.fn(async (_pathname: string, init?: RequestInit) => {
      if (init?.method !== "PUT") return new Response(null, { status: 404 });
      putAttempts += 1;
      received.push(await new Response(init.body as BodyInit).text());
      return putAttempts === 1
        ? new Response(JSON.stringify({ error: "temporary edge failure" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await uploadCollaborationAsset({
      apiFetch,
      pathname: "/episodes/episode-a/assets/Cameras%2Fcamera-1.webm",
      absolutePath: filePath,
      bytes: 12,
      contentType: "video/webm",
      contentHash: "hash",
      sleep: async () => undefined,
      onRetry,
    });

    expect(putAttempts).toBe(2);
    expect(received).toEqual(["camera bytes", "camera bytes"]);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 502,
        attempt: 1,
        operation: "upload asset",
      }),
    );
  });

  it("retries preflight and manifest requests before aborting a sync", async () => {
    const onRetry = vi.fn();
    const responses = [503, 502, 200];
    const response = await requestCollaborationWithRetry(
      "read cloud episode manifest",
      async () => new Response(null, { status: responses.shift() ?? 200 }),
      { sleep: async () => undefined, onRetry }
    );

    expect(response.status).toBe(200);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.objectContaining({ operation: "read cloud episode manifest", status: 503, attempt: 1 }));
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.objectContaining({ operation: "read cloud episode manifest", status: 502, attempt: 2 }));
  });

  it("uploads long recordings in uniform multipart chunks", async () => {
    const fiveMiB = 5 * 1024 * 1024;
    const bytes = fiveMiB * 2 + 17;
    await fs.writeFile(filePath, Buffer.alloc(bytes, 7));
    const partLengths = new Map<number, number>();
    let completedParts: Array<{ partNumber: number; etag: string }> = [];
    const apiFetch = vi.fn(async (pathname: string, init?: RequestInit) => {
      const url = new URL(pathname, "https://collab.test");
      const action = url.searchParams.get("multipart");
      if (action === "create") return Response.json({ uploadId: "upload-a" });
      if (action === "part") {
        const body = new Uint8Array(
          await new Response(init?.body as BodyInit).arrayBuffer(),
        );
        const partNumber = Number(url.searchParams.get("partNumber"));
        partLengths.set(partNumber, body.length);
        return Response.json({ partNumber, etag: `etag-${partNumber}` });
      }
      if (action === "complete") {
        completedParts = (
          JSON.parse(String(init?.body)) as { parts: typeof completedParts }
        ).parts;
        return Response.json({ ok: true });
      }
      return new Response(null, { status: 404 });
    });

    const onProgress = vi.fn();
    await uploadCollaborationAsset({
      apiFetch,
      pathname: "/episodes/episode-a/assets/Cameras%2Fcamera-1.webm",
      absolutePath: filePath,
      bytes,
      contentType: "video/webm",
      contentHash: "hash",
      multipartThresholdBytes: 1,
      partSizeBytes: fiveMiB,
      sleep: async () => undefined,
      onProgress,
    });

    expect([...partLengths.entries()].sort(([a], [b]) => a - b)).toEqual([[1, fiveMiB], [2, fiveMiB], [3, 17]]);
    expect(completedParts).toEqual([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
      { partNumber: 3, etag: "etag-3" },
    ]);
    expect(onProgress).toHaveBeenLastCalledWith(bytes);
  });

  it("stops before issuing another request when the editor cancels", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const apiFetch = vi.fn(async () => Response.json({ ok: true }));

    await expect(requestCollaborationWithRetry("cancelled transfer", apiFetch, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("resumes a multipart upload from persisted part receipts", async () => {
    const fiveMiB = 5 * 1024 * 1024;
    const bytes = fiveMiB * 2 + 17;
    await fs.writeFile(filePath, Buffer.alloc(bytes, 4));
    const uploadedParts: number[] = [];
    let completedParts: Array<{ partNumber: number; etag: string }> = [];
    let lastCheckpoint: MultipartUploadCheckpoint | undefined;
    const checkpoint: MultipartUploadCheckpoint = {
      uploadId: "upload-existing",
      bytes,
      contentHash: "hash",
      partSizeBytes: fiveMiB,
      parts: [{ partNumber: 1, etag: "etag-1" }],
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    const apiFetch = vi.fn(async (pathname: string, init?: RequestInit) => {
      const url = new URL(pathname, "https://collab.test");
      const action = url.searchParams.get("multipart");
      if (action === "create") throw new Error("A resumed upload must not create a replacement upload.");
      if (action === "part") {
        const partNumber = Number(url.searchParams.get("partNumber"));
        uploadedParts.push(partNumber);
        return Response.json({ partNumber, etag: `etag-${partNumber}` });
      }
      if (action === "complete") {
        completedParts = (JSON.parse(String(init?.body)) as { parts: typeof completedParts }).parts;
        return Response.json({ ok: true });
      }
      return new Response(null, { status: 404 });
    });

    await uploadCollaborationAsset({
      apiFetch,
      pathname: "/episodes/episode-a/assets/Cameras%2Fcamera-1.webm",
      absolutePath: filePath,
      bytes,
      contentType: "video/webm",
      contentHash: "hash",
      multipartThresholdBytes: 1,
      partSizeBytes: fiveMiB,
      checkpoint,
      onCheckpoint: (next) => { lastCheckpoint = next; },
      sleep: async () => undefined,
    });

    expect(uploadedParts.sort()).toEqual([2, 3]);
    expect(completedParts).toEqual([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
      { partNumber: 3, etag: "etag-3" },
    ]);
    expect(lastCheckpoint).toBeUndefined();
  });

  it("restarts safely when a persisted R2 multipart upload has expired", async () => {
    const fiveMiB = 5 * 1024 * 1024;
    const bytes = fiveMiB + 3;
    await fs.writeFile(filePath, Buffer.alloc(bytes, 8));
    let created = 0;
    const uploaded: Array<{ uploadId: string; partNumber: number }> = [];
    const apiFetch = vi.fn(async (pathname: string) => {
      const url = new URL(pathname, "https://collab.test");
      const action = url.searchParams.get("multipart");
      if (action === "create") {
        created += 1;
        return Response.json({ uploadId: "upload-new" });
      }
      if (action === "part") {
        const uploadId = String(url.searchParams.get("uploadId"));
        const partNumber = Number(url.searchParams.get("partNumber"));
        if (uploadId === "upload-expired") return Response.json({ error: "expired" }, { status: 404 });
        uploaded.push({ uploadId, partNumber });
        return Response.json({ partNumber, etag: `etag-${partNumber}` });
      }
      if (action === "complete") return Response.json({ ok: true });
      return new Response(null, { status: 404 });
    });

    await uploadCollaborationAsset({
      apiFetch,
      pathname: "/episodes/episode-a/assets/Cameras%2Fcamera-1.webm",
      absolutePath: filePath,
      bytes,
      contentType: "video/webm",
      contentHash: "hash",
      multipartThresholdBytes: 1,
      partSizeBytes: fiveMiB,
      checkpoint: {
        uploadId: "upload-expired",
        bytes,
        contentHash: "hash",
        partSizeBytes: fiveMiB,
        parts: [{ partNumber: 1, etag: "old-etag" }],
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
      sleep: async () => undefined,
    });

    expect(created).toBe(1);
    expect(uploaded).toEqual(expect.arrayContaining([
      { uploadId: "upload-new", partNumber: 1 },
      { uploadId: "upload-new", partNumber: 2 },
    ]));
  });

  it("accepts a matching remote hash when a final response is ambiguous", async () => {
    await fs.writeFile(filePath, Buffer.from("camera bytes"));
    const apiFetch = vi.fn(async (_pathname: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": "12",
            "x-content-sha256": "matching-hash",
          },
        });
      }
      return new Response(null, { status: 502 });
    });

    await expect(
      uploadCollaborationAsset({
        apiFetch,
        pathname: "/episodes/episode-a/assets/Cameras%2Fcamera-1.webm",
        absolutePath: filePath,
        bytes: 12,
        contentType: "video/webm",
        contentHash: "matching-hash",
        maxAttempts: 1,
      }),
    ).resolves.toBeUndefined();
  });
});
