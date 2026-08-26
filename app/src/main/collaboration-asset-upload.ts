import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

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
};

type MultipartPart = {
  partNumber: number;
  etag: string;
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
  return Math.min(500 * 2 ** (attempt - 1), 4_000);
}

export async function requestCollaborationWithRetry(
  operation: string,
  makeRequest: () => Promise<Response>,
  options: Pick<UploadOptions, "maxAttempts" | "sleep" | "onRetry">,
) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const sleep = options.sleep ?? wait;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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

function streamRequest(absolutePath: string, start?: number, end?: number) {
  const stream = createReadStream(
    absolutePath,
    start === undefined ? undefined : { start, end },
  );
  return {
    stream,
    body: Readable.toWeb(stream) as ReadableStream,
  };
}

async function verifiedAfterFailure(options: UploadOptions) {
  if (!options.contentHash) return false;
  try {
    const response = await requestCollaborationWithRetry(
      "verify uploaded asset",
      () => options.apiFetch(options.pathname, { method: "HEAD" }),
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
      const { stream, body } = streamRequest(options.absolutePath);
      try {
        return await options.apiFetch(options.pathname, {
          method: "PUT",
          body,
          headers: {
            "content-type": options.contentType,
            "content-length": String(options.bytes),
            "x-content-sha256": options.contentHash ?? "",
          },
          duplex: "half",
        } as RequestInit & { duplex: "half" });
      } catch (error) {
        stream.destroy();
        throw error;
      }
    },
    options,
  );
  if (!response.ok) throw await responseError(response, "Upload failed");
}

async function uploadMultipart(options: UploadOptions) {
  const createResponse = await requestCollaborationWithRetry(
    "create multipart upload",
    () =>
      options.apiFetch(`${options.pathname}?multipart=create`, {
        method: "POST",
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

  const uploadId = created.uploadId;
  const partSize = Math.max(
    5 * 1024 * 1024,
    options.partSizeBytes ?? DEFAULT_PART_SIZE_BYTES,
  );
  const parts: MultipartPart[] = [];
  try {
    for (
      let offset = 0, partNumber = 1;
      offset < options.bytes;
      offset += partSize, partNumber += 1
    ) {
      const end = Math.min(offset + partSize, options.bytes) - 1;
      const partBytes = end - offset + 1;
      const response = await requestCollaborationWithRetry(
        `upload part ${partNumber}`,
        async () => {
          const { stream, body } = streamRequest(
            options.absolutePath,
            offset,
            end,
          );
          try {
            return await options.apiFetch(
              `${options.pathname}?multipart=part&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
              {
                method: "PUT",
                body,
                headers: {
                  "content-type": "application/octet-stream",
                  "content-length": String(partBytes),
                },
                duplex: "half",
              } as RequestInit & { duplex: "half" },
            );
          } catch (error) {
            stream.destroy();
            throw error;
          }
        },
        options,
      );
      if (!response.ok)
        throw await responseError(response, `Upload part ${partNumber} failed`);
      const uploaded = (await response.json()) as MultipartPart;
      if (uploaded.partNumber !== partNumber || !uploaded.etag)
        throw new Error(
          `Cloud storage returned an invalid receipt for upload part ${partNumber}.`,
        );
      parts.push(uploaded);
    }

    const completeResponse = await requestCollaborationWithRetry(
      "complete multipart upload",
      () =>
        options.apiFetch(
          `${options.pathname}?multipart=complete&uploadId=${encodeURIComponent(uploadId)}`,
          {
            method: "POST",
            body: JSON.stringify({ parts }),
          },
        ),
      options,
    );
    if (!completeResponse.ok)
      throw await responseError(
        completeResponse,
        "Could not complete multipart upload",
      );
  } catch (error) {
    if (await verifiedAfterFailure(options)) return;
    await options
      .apiFetch(
        `${options.pathname}?multipart=abort&uploadId=${encodeURIComponent(uploadId)}`,
        { method: "DELETE" },
      )
      .catch(() => undefined);
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
