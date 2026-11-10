import { sha256 } from "@noble/hashes/sha2.js";

// Keep JavaScript hashing bounded for the Workers Free CPU budget.
export const CHUNK_BYTES = 256 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_NATIVE_BYTES = 5 * 1024 ** 3;
const STATE_VERSION = "sha256-noble-2.4.0-blocks-v1";
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");

/** Only full 64-byte compression blocks are checkpointed. No file bytes are persisted in hash state. */
export async function verifyObjectChunk(bucket, key, object, expectedHash, chunkBytes = CHUNK_BYTES) {
  const stateKey = `verification-state/${key}`;
  const checkpoint = await bucket.get(stateKey);
  const saved = checkpoint ? await checkpoint.json() : undefined;
  const compatible = saved?.version === STATE_VERSION && saved.etag === object.httpEtag && saved.size === object.size && saved.expectedHash === expectedHash;
  const offset = compatible ? saved.offset : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > object.size || offset % 64 || chunkBytes % 64 || chunkBytes < 64 || chunkBytes > MAX_CHUNK_BYTES) throw new Error("Invalid checksum checkpoint.");
  const hash = sha256.create();
  if (offset) {
    if (!Array.isArray(saved.words) || saved.words.length !== 8 || saved.words.some(word => !Number.isInteger(word) || word < -2147483648 || word > 4294967295)) throw new Error("Invalid checksum state.");
    // This adapter is pinned to the audited library version above. Tests compare
    // serialization at block boundaries with native SHA-256 over the entire file.
    hash.set(...saved.words);
    hash.length = offset;
  }
  const length = Math.min(chunkBytes, object.size - offset);
  if (length) {
    const range = await bucket.get(key, { range: { offset, length }, onlyIf: new Headers({ "if-match": object.httpEtag }) });
    if (!range?.body || range.httpEtag !== object.httpEtag) throw new Error("The stored file changed during verification.");
    const bytes = new Uint8Array(await new Response(range.body).arrayBuffer());
    if (bytes.length !== length) throw new Error("Cloud storage returned an incomplete checksum range.");
    hash.update(bytes);
  }
  const verifiedBytes = offset + length;
  if (verifiedBytes === object.size) {
    const actualHash = hex(hash.digest());
    if (actualHash !== expectedHash) return { verified: false, mismatch: true, verifiedBytes, totalBytes: object.size };
    await bucket.put(`verification/${key}`, JSON.stringify({ sha256: actualHash, etag: object.httpEtag, size: object.size }));
    await bucket.delete(stateKey);
    return { verified: true, verifiedBytes, totalBytes: object.size };
  }
  const next = { version: STATE_VERSION, etag: object.httpEtag, size: object.size, expectedHash, offset: verifiedBytes, words: hash.get() };
  hash.destroy();
  const onlyIf = new Headers(checkpoint?.httpEtag ? { "if-match": checkpoint.httpEtag } : { "if-none-match": "*" });
  const written = await bucket.put(stateKey, JSON.stringify(next), { onlyIf });
  if (!written) {
    const current = await bucket.get(stateKey);
    const state = current ? await current.json() : undefined;
    if (state?.etag !== object.httpEtag) throw new Error("Checksum progress changed concurrently. Retry verification.");
    return { verified: false, verifiedBytes: state.offset, totalBytes: object.size };
  }
  return { verified: false, verifiedBytes, totalBytes: object.size };
}

/** R2 validates the expected SHA-256 while streaming, outside Worker hashing code.
 * Rewriting only an unverified object preserves its bytes and metadata; the ETag
 * precondition prevents overwriting a concurrent version. Published objects have
 * a receipt and never enter this path. R2's single-write limit is 5 GiB.
 */
export async function verifyStoredObject(bucket, key, object, expectedHash, bounded) {
  let verified = object;
  const nativeHash = object.checksums?.sha256;
  if (nativeHash) {
    if (hex(new Uint8Array(nativeHash)) !== expectedHash) return { mismatch: true };
  } else if (object.size <= MAX_NATIVE_BYTES) {
    const stored = await bucket.get(key, { onlyIf: new Headers({ "if-match": object.httpEtag }) });
    if (!stored?.body || stored.httpEtag !== object.httpEtag) throw new Error("The stored file changed during verification.");
    try {
      verified = await bucket.put(key, stored.body, {
        sha256: expectedHash,
        onlyIf: new Headers({ "if-match": object.httpEtag }),
        httpMetadata: stored.httpMetadata,
        customMetadata: stored.customMetadata,
        storageClass: stored.storageClass,
      });
    } catch (error) {
      if (/sha-?256|checksum|hash mismatch/i.test(String(error?.message || error))) return { mismatch: true };
      throw error;
    }
    if (!verified) throw new Error("The stored file changed during verification. Retry verification.");
  } else {
    if (!bounded) return { updateRequired: true };
    return { ...await verifyObjectChunk(bucket, key, object, expectedHash), etag: object.httpEtag };
  }
  await bucket.put(`verification/${key}`, JSON.stringify({ sha256: expectedHash, etag: verified.httpEtag, size: object.size }));
  await bucket.delete(`verification-state/${key}`);
  return { verified: true, verifiedBytes: object.size, totalBytes: object.size, etag: verified.httpEtag };
}
