import { useCallback, useEffect, useState } from "react";
import { audioTreatmentSignature, needsExactAudioTreatment } from "../../shared/audio-treatment";
import type { TimelineTrack } from "../../shared/timeline";
import type { PreparedReviewAudio, ReviewMediaAsset, ReviewMediaInventory } from "../../shared/review-media";

export function useExactReviewAudio(tracks: TimelineTrack[], media?: ReviewMediaInventory) {
  const [prepared, setPrepared] = useState<Record<string, PreparedReviewAudio & { sourceVersion: string }>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const sourceVersion = `${media?.episodeId}:${media?.loadedAt}`;
  const requested = tracks.filter((track) => track.kind === "microphone" && needsExactAudioTreatment(track) && media?.audio.some((asset) => asset.id === track.sourceAssetId && asset.status === "ready"));
  const requestKey = JSON.stringify(requested.map((track) => [track.id, track.sourceAssetId, audioTreatmentSignature(track)]));
  useEffect(() => {
    let cancelled = false;
    setFailures({});
    const timer = window.setTimeout(() => {
      if (!media?.episodeId || !window.studio?.prepareReviewAudio) return;
      for (const track of requested) {
        const existing = prepared[track.id];
        if (existing?.sourceVersion === sourceVersion && existing.signature === audioTreatmentSignature(track)) continue;
        const asset = media.audio.find((asset) => asset.id === track.sourceAssetId);
        if (!asset?.filePath) {
          setFailures((current) => ({ ...current, [track.id]: "Download the episode originals to hear exact audio cleanup." }));
          continue;
        }
        void window.studio.prepareReviewAudio(media.episodeId, track).then((result) => {
          if (!cancelled) setPrepared((current) => ({ ...current, [track.id]: { ...result, sourceVersion } }));
        }).catch((error) => {
          if (!cancelled) setFailures((current) => ({ ...current, [track.id]: error instanceof Error ? error.message : "Exact audio preview needs attention." }));
        });
      }
    }, 650);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.studio?.cancelPreparedReviewAudio?.();
    };
    // Source treatment is intentionally independent of volume, selection and the playhead.
  }, [requestKey, sourceVersion]);

  const playback = useCallback((asset: ReviewMediaAsset, track?: TimelineTrack) => {
    const cached = track ? prepared[track.id] : undefined;
    return cached && cached.sourceVersion === sourceVersion && cached.signature === audioTreatmentSignature(track) && cached.sourceAssetId === asset.id
      ? { playbackUrl: cached.playbackUrl, baked: true }
      : { playbackUrl: asset.playbackUrl, baked: false };
  }, [prepared, sourceVersion]);
  const ready = requested.filter((track) => prepared[track.id]?.sourceVersion === sourceVersion && prepared[track.id]?.signature === audioTreatmentSignature(track)).length;
  const error = requested.map((track) => failures[track.id]).find(Boolean);
  const message = requested.length === 0 ? "Live audio controls ready. Final mix loudness is applied during export."
    : error ? `${error} Basic live preview remains available.`
    : !window.studio?.prepareReviewAudio ? "Basic live preview. Use the final-quality preview to check audio cleanup."
    : ready === requested.length ? "Exact track cleanup is ready. Final mix loudness is applied during export."
    : `Preparing exact track cleanup (${ready}/${requested.length}). Basic live preview remains available.`;
  return { playback, message };
}
