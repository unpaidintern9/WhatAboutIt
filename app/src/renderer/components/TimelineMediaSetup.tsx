import { memo, useState } from "react";
import { RotateCcw, ShieldCheck, Upload, Video, Waves } from "lucide-react";
import type { EpisodeCleanupScope, EpisodeStorageSummary } from "../../shared/episode-maintenance";
import type { ReviewMediaImportProgress, ReviewMediaImportSlot, ReviewMediaInventory } from "../../shared/review-media";
import { formatRecordingTime } from "../services";

interface TimelineMediaSetupProps {
  media?: ReviewMediaInventory;
  importProgress?: ReviewMediaImportProgress;
  onImportMedia?: (slot: ReviewMediaImportSlot) => Promise<string>;
  onCancelImport?: (slot: ReviewMediaImportSlot) => Promise<void>;
  onAutoSync?: () => Promise<string>;
  onRelinkMedia?: (slot: ReviewMediaImportSlot) => Promise<string>;
  onVerifyOriginals?: () => Promise<string>;
  onGetEpisodeStorage?: () => Promise<EpisodeStorageSummary>;
  onCleanupEpisodeStorage?: (scope: EpisodeCleanupScope) => Promise<EpisodeStorageSummary>;
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const TimelineMediaSetup = memo(function TimelineMediaSetup({ media, importProgress, onImportMedia, onCancelImport, onAutoSync, onRelinkMedia, onVerifyOriginals, onGetEpisodeStorage, onCleanupEpisodeStorage }: TimelineMediaSetupProps) {
  const [message, setMessage] = useState("Add up to three camera files and the main podcast audio. Full-quality originals stay protected while lighter copies keep editing responsive.");
  const [busy, setBusy] = useState<ReviewMediaImportSlot | "sync">();
  const [storage, setStorage] = useState<EpisodeStorageSummary>();
  const [storageBusy, setStorageBusy] = useState(false);

  async function runMediaAction(action: () => Promise<string>, failureLabel: string, slot: ReviewMediaImportSlot | "sync") {
    setBusy(slot);
    try {
      setMessage(await action());
    } catch (error) {
      setMessage(`${failureLabel}: ${String(error)}`);
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshStorage() {
    if (!onGetEpisodeStorage) return;
    setStorageBusy(true);
    try {
      setStorage(await onGetEpisodeStorage());
    } catch (error) {
      setMessage(`Storage scan failed: ${String(error)}`);
    } finally {
      setStorageBusy(false);
    }
  }

  async function cleanupStorage(scope: EpisodeCleanupScope) {
    if (!onCleanupEpisodeStorage) return;
    const description = scope === "review-cache" ? "rebuildable review previews" : "finished exports";
    if (!window.confirm(`Delete this episode's ${description}? Protected originals and editing media will not be touched.`)) return;
    setStorageBusy(true);
    try {
      setStorage(await onCleanupEpisodeStorage(scope));
      setMessage(scope === "review-cache" ? "Review cache cleared. Reopen the episode when you want its editing previews rebuilt." : "Finished exports deleted. Protected originals were not changed.");
    } catch (error) {
      setMessage(`Storage cleanup failed: ${String(error)}`);
    } finally {
      setStorageBusy(false);
    }
  }

  return (
    <section className="editor-media-setup" aria-label="Episode media setup">
      <div className="editor-media-setup-heading">
        <div>
          <p className="signature">Media setup</p>
          <h3>Three cameras. One synchronized episode.</h3>
        </div>
        <div className="editor-media-setup-actions">
          <button type="button" disabled={!onAutoSync || Boolean(busy)} onClick={() => onAutoSync && void runMediaAction(onAutoSync, "Automatic sync failed", "sync")}>
            <Waves size={17} /> {busy === "sync" ? "Working…" : "Sync automatically"}
          </button>
          <button type="button" disabled={!onVerifyOriginals || Boolean(busy)} onClick={() => onVerifyOriginals && void runMediaAction(onVerifyOriginals, "Integrity check failed", "sync")}>
            <ShieldCheck size={17} /> Verify originals
          </button>
        </div>
      </div>
      <div className="editor-media-slots">
        {(["camera-1", "camera-2", "camera-3", "morgan-mic"] as ReviewMediaImportSlot[]).map((slot) => {
          const asset = slot.startsWith("camera-") ? media?.cameras.find((candidate) => candidate.id === slot) : media?.audio.find((candidate) => candidate.id === slot);
          const label = slot.startsWith("camera-") ? slot.replace("camera-", "Camera ") : "Main audio";
          return (
            <div className={asset?.status === "ready" ? "ready" : "missing"} key={slot}>
              <span>{slot.startsWith("camera-") ? <Video size={17} /> : <Waves size={17} />}<strong>{label}</strong></span>
              <small>{asset?.status === "ready" ? `${asset.codecSummary ?? "Ready"}${asset.durationMs ? ` · ${formatRecordingTime(asset.durationMs)}` : ""}` : "Choose a file"}</small>
              <button type="button" disabled={!onImportMedia || Boolean(busy)} onClick={() => onImportMedia && void runMediaAction(() => onImportMedia(slot), "Import failed", slot)}>
                <Upload size={15} /> {busy === slot ? "Importing…" : asset?.status === "ready" ? "Replace" : "Add file"}
              </button>
              {asset?.status === "ready" && onRelinkMedia && (
                <button type="button" className="editor-relink-button" disabled={Boolean(busy)} onClick={() => void runMediaAction(() => onRelinkMedia(slot), "Relink failed", slot)}>
                  <RotateCcw size={15} /> Relink original
                </button>
              )}
              {busy === slot && importProgress?.slot === slot && (
                <div className="editor-import-progress">
                  <progress max="100" value={importProgress.progress} aria-label={`${label} import progress`} />
                  <span>{importProgress.progress}% · {importProgress.message}</span>
                  {onCancelImport && <button type="button" className="editor-import-cancel" onClick={() => void onCancelImport(slot)}>Cancel</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="editor-media-message" aria-live="polite">{message}</p>
      {onGetEpisodeStorage && (
        <details className="editor-storage-summary" onToggle={(event) => {
          if (event.currentTarget.open && !storage && !storageBusy) void refreshStorage();
        }}>
          <summary>Episode media storage{storage ? ` · ${formatFileSize(storage.totalBytes)}` : storageBusy ? " · Scanning…" : ""}</summary>
          {storage && (
            <div className="editor-storage-buckets">
              {storage.buckets.map((bucket) => (
                <div key={bucket.id}>
                  <strong>{bucket.label}</strong>
                  <span>{formatFileSize(bucket.sizeBytes)} · {bucket.fileCount} file{bucket.fileCount === 1 ? "" : "s"}</span>
                  <small>{bucket.rebuildable ? "Safe to rebuild" : "Kept until you remove it"}</small>
                </div>
              ))}
            </div>
          )}
          <div className="editor-storage-actions">
            <button type="button" disabled={storageBusy} onClick={() => void refreshStorage()}>Refresh</button>
            <button type="button" disabled={!onCleanupEpisodeStorage || storageBusy} onClick={() => void cleanupStorage("review-cache")}>Clear review cache</button>
            <button type="button" disabled={!onCleanupEpisodeStorage || storageBusy} onClick={() => void cleanupStorage("exports")}>Delete exports</button>
          </div>
        </details>
      )}
    </section>
  );
});
