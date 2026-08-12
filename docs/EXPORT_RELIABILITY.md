# Export Reliability

Export uses only real episode media and bundled FFmpeg. A non-practice export requires `Program/program.webm`; stray files cannot produce a false success.

## Draft Rendering

The render applies the saved camera plan, clean-cut or soft-fade camera changes, global and source-specific cuts, source inclusion, framing, zoom, position, picture correction, denoise, sharpening, audio level, mute/solo, pan, fades, sync offsets, noise cleanup, gate, de-essing, compression, three-band tone, voice presets, and output limiting. The final mix is normalized to -16 LUFS with a -1.5 dB true-peak ceiling and resampled to 48 kHz stereo.

If a camera decision points to a missing or removed source section, Program is used for that section. Missing sidecars never replace the original Program fallback with fabricated media.

## Deliverables

A full episode export creates:

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
