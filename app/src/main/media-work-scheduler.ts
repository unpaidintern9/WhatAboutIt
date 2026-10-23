/** One budget shared by analysis, encoding and transfers. Capture always wins. */
const capturing = new Set<string | number>();
const waiting = new Set<() => void>();
let running = 0;
export function setCapturePriority(id: string | number, active: boolean) {
  if (active) capturing.add(id);
  else capturing.delete(id);
  for (const wake of waiting) wake();
}
export async function waitForMediaBudget(signal?: AbortSignal) {
  while (capturing.size > 0) {
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
      if (capturing.size === 0) done();
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
  return { capturing: capturing.size, running, waiting: waiting.size };
}
