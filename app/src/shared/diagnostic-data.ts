const sensitiveKey = /authorization|password|secret|token|access.?key|api.?key|cookie|credential/i;
export function redactDiagnosticText(text: string) {
  return text.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@").replace(/\bBearer\s+[^\s"',}]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:[a-z_-]*token|key|access_?key|api_?key|secret|sig|signature|x-amz-credential|x-amz-signature)=)[^&#\s"']+/gi, "$1[redacted]")
    .replace(/("(?:[^"\\]*(?:password|secret|token|access.?key|api.?key|authorization|cookie)[^"\\]*)"\s*:\s*")[^"\n]*(")/gi, "$1[redacted]$2");
}
/** Keep errors useful, but bound circular details and remove credentials. */
export function sanitizeDiagnosticValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactDiagnosticText(value).slice(0, 6000);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return String(value);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return "[binary omitted]";
  if (typeof Blob !== "undefined" && value instanceof Blob) return `[media omitted: ${value.size} bytes]`;
  if (seen.has(value)) return "[circular]";
  if (depth > 6) return "[depth limit]";
  seen.add(value);
  if (value instanceof Error) {
    const error = value as Error & Record<string, unknown>;
    return Object.fromEntries(["name", "message", "stack", "code", "errno", "syscall", "path", "dest", "cause"]
      .filter((key) => error[key] !== undefined).map((key) => [key, sanitizeDiagnosticValue(error[key], depth + 1, seen)]));
  }
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeDiagnosticValue(item, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).slice(0, 60).map(([key, item]) => [key,
    /^(samples|audioData|pcmData)$/i.test(key) ? "[audio samples omitted]" : sensitiveKey.test(key) ? "[redacted]" : sanitizeDiagnosticValue(item, depth + 1, seen)]));
}

/** Redact a JSON document without trimming recording-part arrays or other metadata. */
export function redactDiagnosticJson(text: string, pretty = true) {
  const value = JSON.parse(text, (key, item: unknown) => {
    if (sensitiveKey.test(key)) return "[redacted]";
    if (/^(samples|audioData|pcmData)$/i.test(key)) return "[audio samples omitted]";
    if (typeof item === "string") return redactDiagnosticText(item);
    return item;
  });
  return JSON.stringify(value, null, pretty ? 2 : undefined);
}
