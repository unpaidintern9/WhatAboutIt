# Recording support diagnostics

Install the current Windows update on the studio computer. Logging starts automatically when the app opens; this does not change microphone gain, treatment, capture quality or channel routing.

After reproducing a problem, pause/save or stop the recording. Open the affected episode, then **Settings → Save Support Diagnostics**. The app creates one ZIP and reveals it in the file browser. Keep the original episode folder and recordings in place. Share the ZIP for review; it is never uploaded automatically.

## Evidence collected

- Timestamped application events with a run ID, sequence, episode/session/part IDs where available, structured error codes, paths, causes and stacks.
- Device discovery, channel selection and active sample-rate/channel settings.
- Selected-input meter summaries every 15 seconds, plus the last partial window on close. These are sampled observations and can miss very short transients.
- Numeric statistics from every acknowledged mono 24-bit PCM chunk during recording: RMS, peak, near-full-scale counts, DC offset and minimum block RMS. Samples are inspected without changing or retaining their bytes in diagnostics. Duplicate acknowledged chunks are not counted twice.
- Recording source health, pending-write queues, timing drift, disk-write durations, recovered/exhausted file-lock retries, and process CPU/memory summaries.
- Renderer exceptions, rejected promises, process exits and fatal main-process exceptions. Fatal capture preserves the runtime's normal crash behavior.
- Root session metadata, the recording-parts journal, each part's capture manifest and error file, recent primary/fallback logs and the bounded in-memory event history.

App version comes from the installed executable. The bundle's manifest lists missing/unreadable/size-limited files. Events use UTC; match run ID + sequence to order and deduplicate copies.

## Reliability and limits

Logging uses a bounded asynchronous queue and batches disk writes; recording does not await the log disk. A blocked primary log folder falls back to a separate temporary folder. If both fail, a bounded memory ring retains recent evidence for export while the process remains alive. Buffer drops, failed sinks and memory eviction counts are reported. This cannot guarantee evidence survives a power failure or simultaneous loss of all storage.

Logs rotate at approximately 2 MiB, with at most 30 retained log files per location and a 14-day age limit applied during cleanup. Support exports are bounded, text-only ZIPs; they exclude recordings, settings and cloud credential files. Structured credentials and signed URL parameters are redacted. Bundles still contain device identifiers and local filesystem paths: review before sharing.

Physical interface gain, cabling, the M-Track Direct Mono/Stereo switch and noise heard while the app is closed cannot be observed by software. Minimum RMS is a possible noise-floor observation, not a diagnosis. New signal statistics begin when this app version runs; earlier recordings cannot supply missing historical telemetry.
