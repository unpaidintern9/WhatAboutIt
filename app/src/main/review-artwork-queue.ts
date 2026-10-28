/** Keep a slow camera from holding every microphone waveform behind it. */
export async function runReviewArtworkQueue<T extends { kind: string }>(
  assets: T[],
  prepare: (asset: T) => Promise<void>,
  signal: AbortSignal,
  onError: (error: unknown) => void
) {
  const queue = [...assets.filter((asset) => asset.kind === "audio"), ...assets.filter((asset) => asset.kind !== "audio")];
  let next = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const asset = queue[next++];
      if (!asset) return;
      try { await prepare(asset); }
      catch (error) { if (!signal.aborted) onError(error); }
    }
  };
  await Promise.all([worker(), worker()]);
}
