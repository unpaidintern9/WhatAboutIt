import fs from "node:fs/promises";

const DEFAULT_MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024;
const DEFAULT_PART_SIZE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_ATTEMPTS = 4;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type UploadFetch = (pathname: string, init?: RequestInit) => Promise<Response>;

export type CollaborationUploadRetry = {
  operation: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  status?: number;
  error?: string;
};

type UploadOptions = {
  apiFetch: UploadFetch;
  pathname: string;
  absolutePath: string;
  bytes: number;
  contentType: string;
  contentHash?: string;
  multipartThresholdBytes?: number;
  partSizeBytes?: number;
  maxAttempts?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (event: CollaborationUploadRetry) => void | Promise<void>;
  multipartConcurrency?: number;
  checkpoint?: MultipartUploadCheckpoint;
  onCheckpoint?: (checkpoint: MultipartUploadCheckpoint | undefined) => void | Promise<void>;
  signal?: AbortSignal;
  onProgress?: (completedBytes: number) => void | Promise<void>;
};

export type MultipartPart = {
  partNumber: number;
  etag: string;
};

export type MultipartUploadCheckpoint = {
  uploadId: string;
  bytes: number;
  contentHash?: string;
  partSizeBytes: number;
  parts: MultipartPart[];
  updatedAt: string;
};

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs));

function retryDelayMs(response: Response | undefined, attempt: number) {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1000, 30_000);
  }
  const base = Math.min(500 * 2 ** (attempt - 1), 4_000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Transfer cancelled", "AbortError");
}

export async function requestCollaborationWithRetry(
  operation: string,
  makeRequest: () => Promise<Response>,
  options: Pick<UploadOptions, "maxAttempts" | "sleep" | "onRetry" | "signal">,
) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const sleep = options.sleep ?? wait;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    let response: Response | undefined;
    try {
      response = await makeRequest();
      if (
        response.ok ||
        !RETRYABLE_STATUSES.has(response.status) ||
        attempt === maxAttempts
      )
        return response;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const delayMs = retryDelayMs(undefined, attempt);
      await options.onRetry?.({
        operation,
        attempt,
        maxAttempts,
        delayMs,
        error: String(error),
      });
      throwIfAborted(options.signal);
      await sleep(delayMs);
      continue;
    }

    const delayMs = retryDelayMs(response, attempt);
    await response.body?.cancel().catch(() => undefined);
    await options.onRetry?.({
      operation,
      attempt,
      maxAttempts,
      delayMs,
      status: response.status,
    });
    throwIfAborted(options.signal);
    await sleep(delayMs);
  }

  throw new Error(`${operation} did not complete.`);
}

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  const error = new Error(
    body.error || `${fallback} (${response.status}).`,
  ) as Error & { status?: number };
  error.status = response.status;
  return error;
}

async function readRequestBody(
  absolutePath: string,
  start?: number,
  end?: number,
) {
  if (start === undefined || end === undefined)
    return new Uint8Array(await fs.readFile(absolutePath));
  const length = end - start + 1;
  const handle = await fs.open(absolutePath, "r");
  try {
    const body = new Uint8Array(length);
    const { bytesRead } = await handle.read(body, 0, length, start);
    if (bytesRead !== length)
      throw new Error(
        `Could not read the complete upload chunk (${bytesRead}/${length} bytes).`,
      );
    return body;
  } finally {
    await handle.close();
  }
}

async function verifiedAfterFailure(options: UploadOptions) {
  if (!options.contentHash) return false;
  try {
    const response = await requestCollaborationWithRetry(
      "verify uploaded asset",
      () => options.apiFetch(options.pathname, { method: "HEAD", signal: options.signal }),
      options,
    );
    if (!response.ok) return false;
    const length = Number(response.headers.get("content-length"));
    return (
      response.headers.get("x-content-sha256") === options.contentHash &&
      (!Number.isFinite(length) || length === options.bytes)
    );
  } catch {
    return false;
  }
}

async function uploadDirect(options: UploadOptions) {
  const response = await requestCollaborationWithRetry(
    "upload asset",
    async () => {
      const body = await readRequestBody(options.absolutePath);
      return options.apiFetch(options.pathname, {
        method: "PUT",
        body,
        signal: options.signal,
        headers: {
          "content-type": options.contentType,
          "x-content-sha256": options.contentHash ?? "",
        },
      });
    },
    options,
  );
  if (!response.ok) throw await responseError(response, "Upload failed");
  await options.onProgress?.(options.bytes);
}

async function uploadMultipart(options: UploadOptions) {
  const partSize = Math.max(
    5 * 1024 * 1024,
    options.partSizeBytes ?? DEFAULT_PART_SIZE_BYTES,
  );
  const reusableCheckpoint = options.checkpoint
    && options.checkpoint.bytes === options.bytes
    && options.checkpoint.contentHash === options.contentHash
    && options.checkpoint.partSizeBytes === partSize
    ? options.checkpoint
    : undefined;
  let uploadId = reusableCheckpoint?.uploadId;
  const partsByNumber = new Map((reusableCheckpoint?.parts ?? []).map((part) => [part.partNumber, part]));

  if (!uploadId) {
    const createResponse = await requestCollaborationWithRetry(
      "create multipart upload",
      () =>
        options.apiFetch(`${options.pathname}?multipart=create`, {
          method: "POST",
          signal: options.signal,
          headers: {
            "content-type": options.contentType,
            "x-content-sha256": options.contentHash ?? "",
          },
        }),
      options,
    );
    if (!createResponse.ok)
      throw await responseError(
        createResponse,
        "Could not start multipart upload",
      );
    const created = (await createResponse.json()) as { uploadId?: string };
    if (!created.uploadId)
      throw new Error("Cloud storage did not return a multipart upload id.");
    uploadId = created.uploadId;
    await options.onCheckpoint?.({ uploadId, bytes: options.bytes, contentHash: options.contentHash, partSizeBytes: partSize, parts: [], updatedAt: new Date().toISOString() });
  }

  const partCount = Math.ceil(options.bytes / partSize);
  const pendingPartNumbers = Array.from({ length: partCount }, (_, index) => index + 1)
    .filter((partNumber) => !partsByNumber.has(partNumber));
  const concurrency = Math.max(1, Math.min(4, options.multipartConcurrency ?? 3));
  let checkpointWrite = Promise.resolve();

  const saveCheckpoint = async () => {
    const checkpoint: MultipartUploadCheckpoint = {
      uploadId,
      bytes: options.bytes,
      contentHash: options.contentHash,
      partSizeBytes: partSize,
      parts: [...partsByNumber.values()].sort((a, b) => a.partNumber - b.partNumber),
      updatedAt: new Date().toISOString(),
    };
    checkpointWrite = checkpointWrite.then(() => options.onCheckpoint?.(checkpoint));
    await checkpointWrite;
  };

  const uploadPart = async (partNumber: number) => {
    const offset = (partNumber - 1) * partSize;
    const end = Math.min(offset + partSize, options.bytes) - 1;
    const response = await requestCollaborationWithRetry(
      `upload part ${partNumber}`,
      async () => {
        const body = await readRequestBody(options.absolutePath, offset, end);
        return options.apiFetch(
          `${options.pathname}?multipart=part&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
          { method: "PUT", body, signal: options.signal, headers: { "content-type": "application/octet-stream" } },
        );
      },
      options,
    );
    if (!response.ok)
      throw await responseError(response, `Upload part ${partNumber} failed`);
    const uploaded = (await response.json()) as MultipartPart;
    if (uploaded.partNumber !== partNumber || !uploaded.etag)
      throw new Error(`Cloud storage returned an invalid receipt for upload part ${partNumber}.`);
    partsByNumber.set(partNumber, uploaded);
    await options.onProgress?.(Math.min(options.bytes, [...partsByNumber.keys()].reduce((total, uploadedPartNumber) => {
      const start = (uploadedPartNumber - 1) * partSize;
      return total + Math.min(partSize, options.bytes - start);
    }, 0)));
    await saveCheckpoint();
  };

  try {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, pendingPartNumbers.length) }, async () => {
      while (nextIndex < pendingPartNumbers.length) {
        const partNumber = pendingPartNumbers[nextIndex++];
        await uploadPart(partNumber);
      }
    });
    await Promise.all(workers);

    const completeResponse = await requestCollaborationWithRetry(
      "complete multipart upload",
      () =>
        options.apiFetch(
          `${options.pathname}?multipart=complete&uploadId=${encodeURIComponent(uploadId)}`,
          {
            method: "POST",
            signal: options.signal,
            body: JSON.stringify({ parts: [...partsByNumber.values()].sort((a, b) => a.partNumber - b.partNumber) }),
          },
        ),
      options,
    );
    if (!completeResponse.ok)
      throw await responseError(
        completeResponse,
        "Could not complete multipart upload",
      );
    await options.onCheckpoint?.(undefined);
  } catch (error) {
    if (reusableCheckpoint && (error as Error & { status?: number }).status === 404) {
      await options.onCheckpoint?.(undefined);
      return uploadMultipart({ ...options, checkpoint: undefined });
    }
    if (await verifiedAfterFailure(options)) {
      await options.onCheckpoint?.(undefined);
      return;
    }
    // Keep the multipart upload and its receipts for a later retry. R2 expires
    // abandoned uploads automatically, while preserving them here makes a
    // network interruption or app restart genuinely resumable.
    throw error;
  }
}

export async function uploadCollaborationAsset(options: UploadOptions) {
  try {
    if (
      options.bytes >=
      (options.multipartThresholdBytes ?? DEFAULT_MULTIPART_THRESHOLD_BYTES)
    ) {
      await uploadMultipart(options);
    } else {
      await uploadDirect(options);
    }
  } catch (error) {
    if (await verifiedAfterFailure(options)) return;
    throw error;
  }
}
