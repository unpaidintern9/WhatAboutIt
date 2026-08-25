import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadCollaborationAsset } from "./collaboration-asset-upload";

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

  it("recreates the file stream and retries a transient 502", async () => {
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

  it("uploads long recordings in uniform multipart chunks", async () => {
    const fiveMiB = 5 * 1024 * 1024;
    const bytes = fiveMiB * 2 + 17;
    await fs.writeFile(filePath, Buffer.alloc(bytes, 7));
    const partLengths: number[] = [];
    let completedParts: Array<{ partNumber: number; etag: string }> = [];
    const apiFetch = vi.fn(async (pathname: string, init?: RequestInit) => {
      const url = new URL(pathname, "https://collab.test");
      const action = url.searchParams.get("multipart");
      if (action === "create") return Response.json({ uploadId: "upload-a" });
      if (action === "part") {
        const body = new Uint8Array(
          await new Response(init?.body as BodyInit).arrayBuffer(),
        );
        partLengths.push(body.length);
        const partNumber = Number(url.searchParams.get("partNumber"));
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
    });

    expect(partLengths).toEqual([fiveMiB, fiveMiB, 17]);
    expect(completedParts).toEqual([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
      { partNumber: 3, etag: "etag-3" },
    ]);
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
