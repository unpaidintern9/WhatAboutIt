/** One budget shared by analysis, encoding and transfers. Capture always wins. */
import { AsyncLocalStorage } from "node:async_hooks";
const capturing = new Set<string | number>();
const waiting = new Set<() => void>();
let running = 0;
let finalizing = 0;
const foreground = new AsyncLocalStorage<boolean>();
const captureListeners = new Set<(active: boolean) => void>();
export function onCapturePriorityChange(listener: (active: boolean) => void) {
  captureListeners.add(listener);
  return () => { captureListeners.delete(listener); };
}
export function setCapturePriority(id: string | number, active: boolean) {
  if (active) capturing.add(id);
  else capturing.delete(id);
  for (const listener of captureListeners) listener(capturing.size > 0 || finalizing > 0);
  for (const wake of waiting) wake();
}

/** Finish/recover a take before restarting disposable proxies and exports. */
export async function withRecordingFinalization<T>(operation: () => Promise<T>): Promise<T> {
  finalizing++;
  for (const listener of captureListeners) listener(true);
  try { return await foreground.run(true, operation); }
  finally {
    finalizing--;
    for (const listener of captureListeners) listener(capturing.size > 0 || finalizing > 0);
    for (const wake of waiting) wake();
  }
}

/** Restart disposable background work after capture, including on Windows.
 * The operation must overwrite only its own derived output, never a source.
 * Cancellation belongs to the caller; a capture yield is internal and retryable.
 */
export async function runCaptureYieldingWork<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const isForeground = Boolean(foreground.getStore());
  while (true) {
    signal?.throwIfAborted();
    const attempt = new AbortController();
    let yielded = false;
    const abort = () => attempt.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await scheduleMediaWork(async () => {
        signal?.throwIfAborted();
        const unsubscribe = onCapturePriorityChange((active) => {
          if (active && (!isForeground || capturing.size > 0)) { yielded = true; attempt.abort(new Error("Background processing yielded to recording")); }
        });
        try { return await operation(attempt.signal); }
        finally { unsubscribe(); }
      }, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (!yielded) throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
}
export async function waitForMediaBudget(signal?: AbortSignal) {
  const blocked = () => capturing.size > 0 || (!foreground.getStore() && finalizing > 0);
  while (blocked()) {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        waiting.delete(done);
        signal?.removeEventListener("abort", aborted);
        resolve();
      };
      const aborted = () => {
        waiting.delete(done);
        reject(signal?.reason);
      };
      waiting.add(done);
      signal?.addEventListener("abort", aborted, { once: true });
      if (!blocked()) done();
    });
  }
  signal?.throwIfAborted();
}
export async function scheduleMediaWork<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  while (true) {
    await waitForMediaBudget(signal);
    if (running < 2) {
      running += 1;
      break;
    }
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        waiting.delete(done);
        signal?.removeEventListener("abort", aborted);
        resolve();
      };
      const aborted = () => {
        waiting.delete(done);
        reject(signal?.reason);
      };
      waiting.add(done);
      signal?.addEventListener("abort", aborted, { once: true });
    });
  }
  try {
    signal?.throwIfAborted();
    return await operation();
  } finally {
    running -= 1;
    for (const wake of waiting) wake();
  }
}
export function mediaWorkStatus() {
  return { capturing: capturing.size, finalizing, running, waiting: waiting.size };
}
