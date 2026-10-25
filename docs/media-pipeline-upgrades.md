# Recording, cloud review and editor handoff upgrades

Scope: audit upgrades 1–9. Network cameras and live broadcasting (10) are deferred.

## Recording and recovery

- Each episode remains a separate directory. Pause finalizes a protected part; reopening and Resume add another part in the same episode.
- Program and camera 1 share one capture encode. The finalized camera 1 source is retained without a second live encoder. Other cameras keep independent recording tracks.
- Balanced and High profiles explicitly request 8 and 16 Mbps video. Chromium still chooses the capture encoder; these rates are targets, not guaranteed sustained throughput.
- Up to eight named microphone routes can be configured in Setup and used in the mixer, review and exports. One shared capture router is opened per interface. Eight-channel capture requires eight browser-visible channels; stereo drivers cannot expose missing inputs.
- Isolated microphones use an AudioWorklet to transfer bounded chunks of signed 24-bit PCM. New canonical audio is FLAC, avoiding the former Opus-to-AAC generation. The requested container precision does not increase a device's actual precision. Existing AAC episodes remain readable.
- PCM source sample counts and recorder timecodes are compared with a monotonic clock. Calibration requires at least two minutes with low delivery jitter; corrections outside a narrow clock-rate range are refused. Reliable deviations of at least 100 ppm are corrected in derived media. Raw recordings remain untouched. This does not claim content-based drift detection or external timecode support.
- Chunk writes are serialized per source, reject sequence gaps, and acknowledge only after data sync and an atomic recovery-journal update. Duplicate acknowledgments do not append media twice.
- Recording pauses automatically when aggregate pending chunks reach 128 MiB, with a 256 MiB absolute queued-data ceiling. The final incomplete tail can require recovery; earlier acknowledged chunks are retained. Disk reserve is checked while writing.
- Optional rolling second-drive backup copies raw chunks and recovery metadata during capture. Its queue is capped independently; a slow or failed backup warns without stopping the primary writer. Finalized copies are still produced. Moving/importing a recovery folder resolves capture paths against the current directory.
- Storage estimates include PCM audio, immutable parts, canonical media and review-copy headroom. Actual capacity remains hardware-dependent.

## Stopping and background performance

- Compatible parts use a validated stream-copy concat. Necessary normalization uses lossless VP9 for video and FLAC for isolated audio rather than another 6 Mbps video/AAC generation. Incompatible inputs can still take substantial time to combine.
- Save progress identifies the source being assembled. All outputs are verified before canonical files are published; part originals remain authoritative if publication is interrupted.
- A shared two-operation budget coordinates encodes, hashing and network requests. Recording defers new background work. Running FFmpeg derivations now yield and restart after capture/finalization; hashing yields between chunks. In-flight network requests can finish. See [October 25 recording upgrades](recording-readiness-performance.md) for the current behavior and acceptance limits.
- Immutable media hashes are cached using inode/device/size/mtime/ctime and rechecked for changes. Mutable project files are snapshotted and rehashed for upload.
- Multipart sizes adapt to the 10,000-part limit. Large parts stream from disk rather than being buffered in full. Transfer checkpoints remain resumable; cancellation and retries remain available.
- Compatible editor video exports probe actual hardware encoder operation with a one-frame encode, then use it when available. Software remains the fallback. Hardware support and output quality require validation on the recording computer.

## Cloud publication and review

- Raw `Recordings/part-*` media is classified as protected original media, including when restoring older manifests that mislabeled it.
- Every changed upload gets a separate cloud object version. Unchanged verified objects are reused. The cloud manifest is compared against the revision observed before the upload starts.
- Versioned objects require a matching server verification receipt, size and object ETag before publication. Revision manifests are retained for recovery. Failed or conflicting publication does not overwrite media referenced by the previous revision.
- Multipart SHA-256 uses Cloudflare's `crypto.DigestStream`; the compatibility fallback refuses large objects rather than buffering them. Receipts are published only after verification.
- Smaller H.264 review videos (up to 1280 pixels wide, 30 fps, bounded bitrate) and AAC audio review copies are generated separately from originals. Review opens immediately from local media while copies build in the background.
- Stream Review downloads project metadata and streams proxy media through a token-protected loopback server. Cloud credentials stay in the main process. Range requests support seeking. Download All retains the verified offline workflow. Older cloud episodes without proxies use the previous download behavior.
- Proxy generation is cancellable and respects capture priority. Cache cleanup cancels pending generation before removing proxies; it does not delete original recording parts.

## External editors

The handoff retains compatible MP4 or ProRes source video, isolated WAV audio, a reference render, captions, markers, sync notes and checksums. It now also contains:

- `04 Project Notes/Premiere-Resolve.xml` — FCP 7 XML interchange.
- `04 Project Notes/Final-Cut.fcpxml` — FCPXML 1.10 with document-relative media URLs.
- `04 Project Notes/Timeline Import Notes.txt` — supported edits and relinking guidance.

The interchange carries basic cuts, camera choices, isolated tracks, source offsets, gains, mute/solo and markers. The sequence timebase is 30 fps; media and declared source frame rates remain native. Advanced effects, transitions, titles and automation remain in the reference render and Studio draft. Editor applications can differ in XML handling; physical import testing is still required.

## Verification

Automated checks cover PCM conversion and pause flushing, an exact 24-bit PCM→FLAC→PCM round trip, eight distinct interface routes on one shared device clock, recording-part restart/recovery, duplicate/gapped chunks, rolling backup bytes, publication conflicts, protected-original restore, streaming review, range playback, clock calibration and XML structure/timing.

`npm run verify` and `npm run build` validate the desktop application. `cloudflare/collab` provides `npm run check` and `npm run test:runtime`; the runtime canary uses disposable local R2 and a >8 MiB multipart object to exercise streaming verification. CI runs both. `npm run verify:media-runtime` loads the built renderer in headless Electron, checks the packaged PCM worklet under the production content security policy, and verifies loopback review audio reaches Web Audio without CORS silence. Backend changes deploy through the dedicated WhatAboutIt workflow; the production multipart canary also exceeds the buffering fallback limit.

Remaining acceptance work: a current 2–4 hour physical multicamera/multimic session, eight-input driver visibility, unplug/reconnect and slow-drive behavior, GPU encoding on target Windows hardware, and actual Premiere/Resolve/Final Cut imports. Synthetic headless Electron checks passed; interactive visual and physical device acceptance remain outstanding. These limitations must not be described as certified capacity.
