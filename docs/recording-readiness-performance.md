# Recording readiness and performance — October 25, 2026

Scope: the first five upgrades from the October 25 audit. The UI redesign, timeline overhaul, disk writer redesign, cloud restore center and editor frame-rate work (6–10) are deferred. Network cameras/live broadcasting remain deferred separately.

## 1. Recording checks and live health

Before recording or resuming, the installed desktop app opens every assigned camera and microphone, checks live tracks, and verifies each numbered microphone input against the active channel count. A driver's advertised maximum is not treated as an active input. Shared interfaces are opened once during preflight; every consumer is released even if another opener fails. Silent/quiet inputs remain visible in the existing live meters rather than being treated as proof that a device is disconnected.

The recording screen also provides **Check inputs & drive**. A disposable random-data write test on the selected primary volume writes at most 24 MiB, synchronizes each block and removes its temporary file. Recording checks require at least twice the configured capture bitrate and the existing space reserve. This is a short write check, not sustained capacity certification. A slow or unavailable drive produces an actionable message before capture. The test refuses to run during capture.

The health strip shows estimated remaining drive space at the selected profile, pending disk-write bytes, and sources needing attention. Camera previews report skipped display frames when the browser exposes this measurement. Those numbers measure the preview, not frames successfully encoded into the recording.

## 2. Progressive Review loading

Review returns playable inventory and cached artwork without awaiting full-track waveforms or posters. Missing artwork builds in a cancellable background queue and arrives through asset-level updates. Source identity and episode guards prevent late artwork from replacing another take or source. Artwork updates do not replace playback URLs, timeline drafts or playheads. Cache cleanup and shutdown cancel artwork work before removing derived files.

## 3. Shared live audio engine

Lossless PCM recorders reuse their interface router's AudioContext and load the worklet once per context. Releasing one recorder disconnects its graph without closing the interface clock used by the other microphones. Failed setup disconnects partially-created nodes.

Meters and setup monitoring acquire reference-counted contexts by sample rate/output. All meter channels share one sampling timer: 20 Hz in a visible window and 1 Hz when hidden. The capture worklet still runs independently of UI sampling. Original recordings remain unprocessed.

## 4. Capture and finalization priority

Running FFmpeg derivation jobs now yield when recording starts, including on Windows: their disposable process is terminated, protected sources remain untouched, and the derivation restarts after capture. Progress does not move backwards when a restarted encode catches up. Explicit user cancellation remains final and does not restart the job.

Stop/Pause/recovery finalization gets foreground access before background jobs resume. Foreground finalization still yields if another recording window starts capture. Hashing cooperatively waits between bounded chunks. Already-in-flight network requests can finish; subsequent transfer operations remain gated by the existing budget. This is not OS-level preemption of arbitrary network requests or storage drivers. Restarting an encode can repeat work; capture safety takes priority over retaining partial encode progress.

## 5. Export-matched source audio previews

De-essing uses multiband compression of sibilant frequencies instead of a permanent treble reduction. The bundled FFmpeg filter set is used, without requiring an external plugin. Export, short effect previews and full-source review caches use the same audio treatment filter builder, including FFT noise cleanup, the gate, EQ, compression and dynamic de-essing.

After a treatment adjustment settles, the app prepares a lossless source preview in the background. Playback switches to that verified derived source while retaining interactive gain, pan, fades and timeline timing. The live processing chain bypasses already-rendered cleanup to avoid applying it twice. Changes to gain/selection/playhead do not regenerate source treatment. Stale results and cancellations are ignored. Source changes invalidate cached treatment. Derived treatment caches are excluded from cloud uploads and removed by the existing Review cache cleanup.

Until a cache is ready, the interface labels playback as the basic live preview. Streaming-only episodes need downloaded originals for the exact cleanup cache. Final mix loudness/mastering remains an export step; source treatment playback does not claim to reproduce that final mastered mix. Existing ten-second final-quality previews remain available.

## Verification and remaining acceptance

Tests cover all assigned microphone readiness, a driver exposing fewer inputs than advertised, late opener cleanup, disposable drive writes, progressive loading while artwork generation is blocked, late source updates, shared contexts/timers, recorder lifetime, capture interruption/restart/cancellation, foreground finalization and derived audio preservation/reuse.

A real FFmpeg signal test checks that high-band de-essing reduces a harsh high-frequency tone by more than 5 dB while preserving the low speech-frequency tone within 1 dB. A real paced encode test verifies that a running process exits during capture and rebuilds a complete playable output afterward.

Physical 2–4 hour multicamera/multimicrophone sessions, target Windows GPU/audio drivers, USB contention, unplug/reconnect and power-loss acceptance still require the recording computer. Short synthetic sessions and automated tests do not certify those capacities.

Local validation: 415 tests in 73 files passed with all repository validators. After source-versioned atomic artwork publication was added, all 22 focused Review/PCM/scheduler checks, the production build and packaged Electron media runtime checks passed. The Electron check measured 48,000 PCM frames / 144,000 bytes and nonzero loopback review audio.

A Playwright-controlled offscreen Electron session exercised actual MediaRecorder, PCM worklets, recording stores and FFmpeg with synthetic camera/audio streams in a disposable episode library. Inputs/drive check → Record → Pause → Resume → Stop → Review → de-ess → processed-source playback passed without renderer errors. Screens were checked at 1280×860 and 1024×768. The Browser plugin was unavailable; the standalone Chromium download failed, so the installed Electron runtime was used. This is synthetic application acceptance, not physical device or native Windows UI certification.
