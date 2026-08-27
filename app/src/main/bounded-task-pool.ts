export async function runBoundedTasks<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be a positive integer.");
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (firstError === undefined) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index]);
      } catch (error) {
        firstError = error;
      }
    }
  });

  await Promise.all(workers);
  if (firstError !== undefined) throw firstError;
  return results;
}
