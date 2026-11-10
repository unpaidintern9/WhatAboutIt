import type { CollaborationTransferProgress, CollaborationUploadSelection } from "../shared/collaboration";

type UploadEvent = { at: string; type: string; message: string; relativePath?: string; attempt?: number };
type ProgressOptions = {
  selection: CollaborationUploadSelection;
  send: (body: unknown) => Promise<void>;
  onUnavailable: () => void | Promise<void>;
  intervalMs?: number;
};

function safeMessage(message: string) {
  return message.replace(/https?:\/\/\S+|bearer\s+\S+|(?:access[_-]?key|authorization|token)\s*[:=]\s*\S+/gi, "[redacted]").slice(0, 300);
}

/** Coalesces receipts and retries into a bounded status/log snapshot every ten seconds. */
export function createUploadProgressReporter(options: ProgressOptions) {
  let progress: CollaborationTransferProgress | undefined;
  let sequence = 0;
  let eventCount = 0;
  const events: UploadEvent[] = [];
  let inFlight: Promise<void> | undefined;
  let unavailable = false;

  function event(type: string, message: string, relativePath?: string, attempt?: number) {
    eventCount++;
    events.push({ at: new Date().toISOString(), type, message: safeMessage(message), relativePath: relativePath?.slice(0, 1024), attempt });
    if (events.length > 100) events.shift();
  }

  function flush() {
    if (inFlight) return inFlight;
    if (!progress) return Promise.resolve();
    const body = { ...progress, message: safeMessage(progress.message), relativePath: progress.relativePath?.slice(0, 1024), selection: options.selection, sequence: ++sequence, eventCount, events: [...events] };
    while (body.events.length && Buffer.byteLength(JSON.stringify(body)) > 48 * 1024) body.events.shift();
    inFlight = Promise.resolve().then(() => options.send(body)).then(() => { unavailable = false; }).catch(async () => {
      if (!unavailable) {
        unavailable = true;
        await options.onUnavailable();
      }
    }).catch(() => undefined).finally(() => { inFlight = undefined; });
    return inFlight;
  }

  const timer = setInterval(() => { void flush(); }, options.intervalMs ?? 10_000);
  timer.unref?.();
  return {
    event,
    update(next: CollaborationTransferProgress) {
      const first = !progress;
      if (next.phase !== progress?.phase) event(next.phase, next.message, next.relativePath);
      progress = next;
      if (first) void flush();
    },
    async close() {
      clearInterval(timer);
      await inFlight;
      await flush();
    }
  };
}
