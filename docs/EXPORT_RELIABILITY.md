# Export Reliability

Export uses only real episode media and bundled FFmpeg. A non-practice export requires `Program/program.webm`; stray files cannot produce a false success.

## Draft Rendering

The render applies the saved camera plan, clean-cut or soft-fade camera changes, global and source-specific cuts, source inclusion, framing, zoom, position, picture correction, denoise, sharpening, audio level, mute/solo, pan, fades, sync offsets, noise cleanup, gate, de-essing, compression, three-band tone, voice presets, and output limiting. The final mix is normalized to -16 LUFS with a -1.5 dB true-peak ceiling and resampled to 48 kHz stereo.

If a camera decision points to a missing or removed source section, Program is used for that section. Missing sidecars never replace the original Program fallback with fabricated media.

## Deliverables

Each export reserves a new directory under `Episode/Exports/<UTC timestamp> <export type>/`. Its media, sidecars, job, log, and summary stay together. Repeated exports never replace a previous export or its notes; camera and audio masters also stay inside the job directory. Existing flat exports remain untouched. The Export screen shows the exact folder and opens that directory after completion.

A full episode export creates inside its job directory:

- `what-about-it-full-episode-video.mp4`
- available camera/mic pairs under `Camera Masters/`
- available edited microphone stems under `Audio Masters/` as 48 kHz, 24-bit WAV
- `edit-decision-list.json`
- `export-job.json`, `export-log.txt`, and `export-summary.json`

Standard is 720p/192 kbps AAC. High is 1080p/320 kbps AAC and is the recommended finished episode. Archive is 1080p near-master video with 24-bit PCM audio.

## Confidence And Failure States

The Export screen shows queued/running progress, the current operation, completion, and every output filename. Completion is written only after ffprobe confirms the requested audio/video streams and a decode pass succeeds.

- Missing Program recording: `We couldn't find the recording file`
- Missing bundled media tools: `Media tools need setup before export`
- FFmpeg or validation failure: `Something needs attention before export`

Focused automated tests validate a two-camera/two-mic manual draft with the production controls enabled, processed audio stems, camera masters, progress updates, and the final playable MP4. No long recording test was run in this pass.

## Editor Handoff

Choose a transfer directory. Every handoff creates a uniquely reserved, dated package there, separate from the protected episode originals:

- `01 Reference Edit/`: the edited 1080p/30 reference MP4.
- `02 Camera Video/`: full-length uncut Program and each available camera, with embedded guide audio only when it exists in that source.
- `03 Isolated Audio/`: full-length microphone WAVs at 48 kHz / 24-bit PCM, preserving the source channel count.
- `04 Project Notes/`: edited captions, original-clock markers, sync-map CSV with package-relative filenames and unavailable-source statuses, the What About It draft, recording evidence when present, and `handoff-manifest.json` with probed codec, size, rate, channels, duration, and source offsets.
- `README - START HERE.txt` and streamed SHA-256 checksums for transferable content.

**Compatible MP4** uses H.264 with a short GOP and a faster encoder preset for compact transfers. **ProRes 422 MOV** provides an intraframe alternative for editing in Premiere, Resolve, and Final Cut at much greater disk cost; choose MP4 for CapCut. Source videos retain resolution and frame rate instead of being forced to 1080p/30 (MP4 rounds odd pixel dimensions down to even). Conversion does not recover detail or bit depth absent in the capture. The reference remains a finished mix; source videos and WAVs do not bake in timeline cuts, treatments, or mastering.

Disk preflight estimates every available source using its own duration, resolution, frame rate, and channel count, with a larger ProRes allowance. Sources are transcoded sequentially to bound CPU pressure. Cancellation also interrupts checksum streaming. Completion still requires every emitted media file to pass stream/decode validation.

This is a media handoff, not a native NLE project or automatic recreation of What About It's timeline. Editors import the included media, align with the sync map, and rebuild edits against the reference. No native editor application was used for automated acceptance.

Real-media integration tests cover both presets, 640×360 at 24000/1001 fps, stereo microphone preservation, PCM WAV output, full-length Program inclusion, relative manifests, and checksum integrity. These small fixtures do not certify long-session performance or physical-camera capture.
