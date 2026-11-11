# Release Process

Windows release packaging and in-app updates are active. Every verified app change merged to `main` starts the Windows release workflow.

## Automated Main Release

`.github/workflows/release-main.yml` runs on Windows and:

1. Installs the locked dependencies.
2. Runs `npm run verify`.
3. Gives the build a monotonically newer `0.2.<run number>` version.
4. Builds the NSIS installer and Electron update metadata.
5. Verifies the deployed collaboration service supports upload progress, then publishes a stable GitHub release.

The installed app exposes **Settings → Check for updates**. Morgan can check, download, and restart to install without using Git or replacing her episode files.

Use `workflow_dispatch` to rerun the release manually when needed.

## Supported Targets Prepared

- Windows NSIS
- macOS DMG
- Linux AppImage

## Release Rules

- During a requested media sync, progress and bounded, redacted upload logs may be stored in the configured private episode bucket.
- Local diagnostic logs remain available. Credentials and media contents must stay out of cloud progress reports.
- Dependency licenses must be reviewed before distribution.
- A failed verification job must never publish an update.
- Episode recordings and settings remain outside the installed application and are not replaced by updates.
- Public distribution still requires a trusted Windows code-signing certificate.

## Upload progress and logs

Studio shows verified bytes as a completion percentage and remaining percentage. Files already verified in Cloudflare and saved multipart receipts count toward progress. Final publication stays below 100 percent until its manifest succeeds.

In Cloudflare R2, open `whataboutit-collab-media/episodes/<episode-id>/upload-status.json`. It contains `completionPercent`, `remainingPercent`, byte and file totals, `phase`, and `updatedAt`. Updates are sent at most once every ten seconds, plus initial and final reports. During preparation the byte total can be unknown, so the percentage is null. Treat an unfinished report as last-known progress after its `validUntil` time.

The report's `logPath` points to `upload-logs/<operation-id>.json` in the same episode. It retains the most recent 100 phase, retry, reuse, resume, file-completion, and failure events, with `eventCount` and `eventsOmitted` exposing truncation. Automatic project saves do not replace the current media backup report. The authenticated `GET /episodes/<episode-id>/upload-status` endpoint also computes whether a report is stale.

Cloud progress reporting is best effort. A reporting outage does not fail the media transfer, and local logs record the reporting failure. Deploy and verify the Worker before publishing the Windows update.

Multipart files up to 5 GiB use R2's storage-side SHA-256 validation via a conditional streaming write. This does not buffer or hash the whole recording in Worker JavaScript. Existing bytes and metadata are preserved, and an ETag precondition prevents overwriting another version. A lost completion response can be retried without retransmitting the original parts; a native checksum or verification receipt avoids repeating the write.

Files larger than R2's 5 GiB single-write limit use resumable 256 KiB SHA-256 steps. Hash checkpoints bind the exact object ETag, size and expected hash. The current installer continues until verification completes; older installers receive an update-required error for this size rather than an unbounded CPU operation. No object enters a versioned manifest until its complete checksum matches. The Worker configuration deliberately omits paid-only CPU overrides so deployment supports Workers Free. Free-tier request and R2 storage/operation quotas still apply; a free Workers plan does not guarantee zero R2 charges.


## Simple current files and incremental backup

Current audio and video files are directly accessible under the episode's Audio, Cameras, Program and Review folders with ordinary filenames. No version/date folders are needed to find the current files. Existing unrelated legacy files are preserved; when a name collision requires it, Studio uses a clear Latest- filename rather than overwriting an unmanaged recording. The authenticated current-files endpoint uses checksum and ETag validation and copies only changed media. An unchanged repeat reuses the existing file. Immutable upload backing is kept separately under _system for new uploads, so the current-file view does not compromise publication or recovery.

The Collaboration screen scans the actual episode folder without rewriting workspace.json. It separates local inventory, published cloud backup status and the current upload plan. Duration comes from recording/session or proxy metadata, never from compressed file size. Full backup is the default; review-copy mode explicitly excludes originals, and a review-only folder cannot claim a full original-media backup. Automatic project saves preserve the last full recording proof and do not remove a previously uploaded Program.

If preparing the simple Cloudflare file view is interrupted, a completed verified backup stays complete. Finish the simple file view resumes cloud-side copies without resending local recordings. Temporary reviewed episode requests must be removed after the live operation succeeds.
