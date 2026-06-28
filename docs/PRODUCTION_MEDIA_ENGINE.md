# Production Media Engine

Phase 7 status: blocked for full production readiness.

Phase 7A status: real FFmpeg export integration completed.

Phase 7B status: partial real recording capture integration completed.

Phase 7B.5 status: short physical camera/microphone validation completed.

This pass audited the current media engine against the requirement to replace placeholder or simulated behavior with production-ready integrations. The project is not ready for a Phase 7 production commit because the required real media integrations are not yet implemented or validated.

No new UI features were added. No interface redesign was performed. No Version 2 features were started.

## Current Result

The existing application remains an offline-first MVP shell with local project structure, draft timeline storage, review/edit/export flows, and Auto Edit review concepts. It does not yet contain a validated production media engine.

The requested commit condition was not met:

> Commit only if production integrations replace placeholder implementations.

Because full-length multi-track stability, media-backed timeline playback, Auto Edit, full recovery, and packaging remain unvalidated foundations, the full production gate is still not complete. Phase 7A specifically replaced the export placeholder with a real local FFmpeg render path. Phase 7B hardened the browser MediaRecorder path for one-camera/one-mic capture where supported and validates saved recordings with ffprobe. Phase 7B.5 validated a short physical recording with real connected camera/microphone hardware. Phase 9I added sidecar camera/mic recording outputs where Electron/browser capture supports them.

## Recording

Status: partial real integration.

Evidence:

- `app/src/renderer/plugins/recording/browser-media-recorder-plugin.ts`
- `app/src/renderer/plugins/recording/obs-control-plugin.ts`
- `app/src/main/recording-session-store.ts`
- `app/src/main/recording-session-store.test.ts`
- `app/src/renderer/services/recording-service.test.ts`

The browser recording plugin uses `navigator.mediaDevices.getUserMedia` and `MediaRecorder` for the main Program recording, then attempts separate sidecar recorders for selected Camera 1/2/3 and Morgan/Guest/Extra mic slots. The main process saves the Program bytes to `Episode/Program/program.webm`, validates that file with ffprobe, saves camera sidecars to `Episode/Cameras`, transcodes mic sidecars to `Episode/Audio/*.m4a`, and validates every saved sidecar before marking it saved.

The recording save path updates `Session/sync-metadata.json` with saved media file paths, validation status, and truthful sidecar states such as `Saved`, `Preview only`, and `Needs Attention`.

Phase 7B.5 physical validation:

- Camera: Integrated Camera
- Microphone: Microphone (Realtek(R) Audio)
- Program output: VP9 video, Opus mono audio, 640x480
- Camera mirror: created and ffprobe-valid
- Audio extraction: AAC mono M4A, 17.039 seconds
- Final UI state: `Recording Complete`, `STOPPED`, 17-second timer
- Manual QA report: `docs/manual-qa/PHYSICAL_RECORDING_QA.md`

Friendly capture failure states now include:

- `Camera needs attention`
- `Mic needs attention`

The OBS control plugin still throws `OBS recording engine is not connected yet.` for start, pause, resume, and stop.

Missing production work:

- Validate Camera 3 with supported hardware.
- Validate Extra Mic with supported hardware.
- Confirm exact physical identity for each separate microphone source.
- Validate long-duration recording stability.
- Validate audio/video sync.
- Validate dropped frame and drift reporting from the real backend.
- Validate recording from an installable packaged app, not only `npm run electron`.

## Timeline

Status: partial foundation.

Evidence:

- `app/src/main/timeline-store.ts`
- `app/src/shared/timeline.ts`
- `app/src/renderer/components/TimelineReview.tsx`

The timeline currently saves and loads `Session/draft-timeline.json` and preserves non-destructive edit operations. It does not yet load actual recorded media into a production playback timeline or provide accurate media-backed playback.

Missing production work:

- Discover actual recording files for an episode.
- Probe durations and streams.
- Bind timeline tracks to real media assets.
- Play recorded program/camera/audio media accurately.
- Apply trim, split, and delete operations against a renderable draft timeline.

## Export

Status: real integration completed for local export rendering.

Evidence:

- `app/src/main/export-store.ts`
- `app/src/main/ffmpeg-tools.ts`
- `app/src/main/export-store.test.ts`
- `app/package.json`

The export store now detects bundled FFmpeg and ffprobe binaries, renders playable local outputs, and validates the output with ffprobe before marking a job complete.

Supported Phase 7A outputs:

- Full Episode Video: `what-about-it-full-episode-video.mp4`
- Audio Only: `what-about-it-audio-only.m4a`
- Archive Master: `what-about-it-archive-master.mkv`

Export artifacts still write locally to `Episode/Exports/`:

- `export-job.json`
- `export-log.txt`
- `export-summary.json`

The app now reports a friendly readiness status:

- `Media tools are ready`
- `Media tools need setup before export`

Real export validation:

- `app/src/main/export-store.test.ts` generates tiny local sample media through FFmpeg.
- The test exports a playable MP4 and M4A.
- The output is validated through ffprobe before the job completes.

Missing production work:

- Validate Full Episode Video, Audio Only, and Archive Master presets.
- Render from a fully media-backed draft timeline once real recording and timeline playback are complete.
- Validate exports from real recorded podcast media, not only generated sample media.

## Auto Edit

Status: simulated analysis.

Evidence:

- `app/src/shared/auto-edit.ts`
- `app/src/main/auto-edit-store.ts`

Auto Edit currently generates deterministic draft suggestions from the existing draft timeline and markers. It does not analyze recorded audio/video media, transcripts, silence, speakers, camera changes, or loudness from real files.

Missing production work:

- Run offline transcript generation or document a selected local transcript backend.
- Analyze real audio for silence, pacing, loudness, clipping, and noise.
- Analyze real recording assets for speaker/camera decisions where feasible.
- Generate chapter and clip suggestions from actual media evidence.
- Write `AutoEditReport.json` from real analysis results.

## Recovery

Status: partial state recovery foundation.

Evidence:

- Recording state and session folder scaffolding exist from earlier phases.

The application can represent unfinished recording state, but crash recovery has not been validated against real recorded media files.

Missing production work:

- Interrupt a real recording.
- Confirm partial files remain available.
- Confirm the application detects the unfinished session.
- Confirm the user can safely resume, recover, or review what was saved.
- Confirm raw files are never deleted automatically.

## Packaging

Status: packaging configuration only.

Evidence:

- `app/package.json`

Electron Builder configuration exists for Windows, macOS, and Linux targets. Installable builds and clean-machine first-run validation were not completed in this pass.

Missing production work:

- Produce installable artifacts.
- Validate first run on a clean machine.
- Confirm native media dependencies are included.
- Confirm offline behavior after installation.

## End-to-End Real Media Test

Status: partial.

Phase 7A completed a real export test with generated sample media. The test uses bundled FFmpeg to create sample media, exports a playable output, and validates it with ffprobe.

Phase 7B completed automated real-media recording-path tests with generated local media:

- A generated WebM is saved through the recording session store.
- `Program/program.webm` is validated with ffprobe.
- `Cameras/camera-1.webm` is written and validated.
- `Audio/morgan-mic.m4a` is extracted and validated.
- `sync-metadata.json` records saved media files and validation state.
- Export from an existing `Episode/Program/program.webm` file is validated.

Phase 7B.5 completed a real physical camera/mic test and exported the resulting recording through the UI. The full app launch-to-record-to-review-to-edit-to-export real-media test is still blocked because media-backed timeline review/edit remains incomplete and real Auto Edit remains incomplete.

## Production Gate Decision

The MVP user flow remains useful as a guided prototype and offline product shell. It is not yet a production media engine.

The Phase 7B.5 commit may be made because a real short physical camera/mic recording was captured, validated, and exported to a playable file. The full Phase 7 production gate should remain blocked until a full-length recording can be captured, reviewed with media-backed playback, edited non-destructively, exported to a playable file, and documented with real test evidence.
