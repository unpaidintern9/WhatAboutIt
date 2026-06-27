# Real Integration Status

This document records the current status of production media integrations after the Phase 7 audit.

## Application Subsystems

| Area | Current implementation | Production ready | Missing work |
| --- | --- | --- | --- |
| Recording | Browser `MediaRecorder` one-camera/one-mic path with ffprobe validation after save | Partial | Multi-camera capture, multi-mic capture, long-duration validation, sync validation |
| Camera capture | Physical Integrated Camera validated through browser capture, saved to Program and mirrored to Cameras | Partial | Up to three simultaneous cameras, capture cards, backend error handling |
| Microphone capture | Physical Realtek microphone validated, muxed into Program and extracted to Audio with FFmpeg | Partial | Multiple input capture, separate tracks where supported, drift and clipping reporting |
| Timeline review | Draft timeline JSON and marker/edit model | No | Real media discovery, stream probing, accurate playback, media-backed timeline tracks |
| Editing | Non-destructive edit operation log | Partial | Apply edit decisions to renderable media timeline and playback preview |
| Export | Bundled FFmpeg/ffprobe detection and real local rendering | Partial | Validate all presets from longer real podcast media and render from a fully media-backed draft timeline |
| Auto Edit | Deterministic offline suggestion generator from draft data | No | Real transcript, audio analysis, speaker/camera analysis, real report evidence |
| Recovery | Session state foundation | Partial | Real interrupted recording validation and media recovery workflow |
| Packaging | Electron Builder config | Partial | Installable builds, clean-machine test, bundled media dependencies |

## Dependency Integration Audit

| Dependency | Present locally | Currently integrated | Production ready | Notes |
| --- | --- | --- | --- | --- |
| OBS Studio | Yes, `external-repos/obs-studio` | No | No | OBS control plugin exists but throws a not-connected error. No libobs or WebSocket bridge is wired into the app. |
| FFmpeg | Yes, `external-repos/FFmpeg`; bundled app binaries via `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` | Yes for export | Partial | Export uses bundled FFmpeg/ffprobe, writes playable local files, and validates output with ffprobe. The cloned FFmpeg source remains a reference dependency and is not built directly. |
| MLT Framework | Yes, `external-repos/mlt` | No | No | No production timeline/render integration is present. |
| auto-editor | Yes, `external-repos/auto-editor` | No | No | No application code invokes auto-editor for real media analysis or timeline generation. |
| whisper.cpp | Yes, `external-repos/whisper.cpp` | No | No | No local transcription backend is built or invoked. |
| OpenCV | Yes, `external-repos/opencv` | No | No | No camera/speaker/video analysis integration is present. |
| Essentia | Yes, `external-repos/essentia` | No | No | No audio feature extraction integration is present. |

## Files With Blocking Evidence

- `app/src/main/export-store.ts`: now renders playable MP4, M4A, and MKV export outputs with FFmpeg.
- `app/src/main/ffmpeg-tools.ts`: detects bundled FFmpeg/ffprobe, runs media tools, and validates playable outputs.
- `app/src/main/recording-session-store.ts`: saves captured program bytes, validates them with ffprobe, mirrors the camera recording, extracts mic audio, and updates sync metadata.
- `docs/manual-qa/PHYSICAL_RECORDING_QA.md`: documents the short physical camera/mic validation result.
- `app/src/renderer/plugins/recording/obs-control-plugin.ts`: all recording methods throw `OBS recording engine is not connected yet.`
- `app/src/renderer/plugins/recording/browser-media-recorder-plugin.ts`: records one browser media stream where supported and now surfaces friendly camera/mic attention states.
- `app/src/shared/auto-edit.ts`: computes suggested edits from draft duration and markers, not real media analysis.
- `app/src/main/auto-edit-store.ts`: persists the simulated Auto Edit result.
- `app/src/main/timeline-store.ts`: persists draft JSON but does not bind to playable recorded media.

## Integration Readiness Summary

The project now has two partial real media integrations: offline FFmpeg export rendering and a physically validated one-camera/one-mic browser recording save path. The remaining production media work is long-duration recording validation, multi-device recording, media-backed timeline playback, real Auto Edit analysis, recovery validation, and installable packaging.
