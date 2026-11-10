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

Large multipart files use SHA-256 verification in bounded 16 MiB ranges. Checkpoints bind the accumulated hash state to the exact R2 object ETag and size. A retry after completion resumes hashing the stored object and preserves uploaded parts. An object cannot enter a manifest until the final SHA-256 matches. The Worker CPU ceiling is 300 seconds for compatibility with older installers, while current installers use the bounded protocol. Cloudflare must support that configured ceiling before this release can deploy.
