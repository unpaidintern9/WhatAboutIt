# Physical Recording QA

Phase: 7B.5 Physical Camera/Mic Validation

Date: 2026-06-27

Result: passed for a short one-camera/one-microphone physical recording and export.

This QA pass used the launched Electron app, real connected hardware, the existing recording UI, the local recording session store, bundled ffprobe validation, and the existing FFmpeg export path.

## Hardware

Camera:

- Integrated Camera
- Device class: Camera
- Instance: `USB\VID_13D3&PID_540A&MI_00\6&2C56DEBB&0&0000`

Microphone:

- Microphone (Realtek(R) Audio)
- Device class: AudioEndpoint
- Instance: `SWD\MMDEVAPI\{0.0.1.00000000}.{29A71E6E-B4FB-4C35-9614-E03E824FB438}`

Speaker/output present:

- Speakers (Realtek(R) Audio)

The app used the default camera and microphone selected by Electron/Chromium because no explicit device defaults were chosen in Studio Setup for this run.

## Test Steps

1. Launched What About It? Studio with `npm run electron`.
2. Opened the Record screen.
3. Pressed Record.
4. Confirmed the UI entered `RECORDING`.
5. Recorded a short physical hardware test.
6. Pressed Stop.
7. Confirmed the UI showed `Recording Complete`, `STOPPED`, and preserved a 17-second timer.
8. Validated the local recording outputs with ffprobe.
9. Restarted the app so the new recording metadata was loaded as an episode.
10. Opened Export.
11. Confirmed `Media tools are ready`.
12. Exported Full Episode Video.
13. Confirmed the UI showed `Export complete`.
14. Validated the exported MP4 with ffprobe.

## Output Folder

Validated episode:

`C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudioData\episodes\2026-06-27-studio-recording-1e1ef91e`

## Recording Outputs

Program recording:

- Path: `Program\program.webm`
- Video: VP9, 640x480, 10 fps
- Audio: Opus, 48000 Hz, mono
- Size: 1,932,694 bytes
- ffprobe result: valid streams and non-empty file

Camera mirror:

- Path: `Cameras\camera-1.webm`
- Video: VP9, 640x480, 10 fps
- Audio: Opus, 48000 Hz, mono
- Size: 1,932,694 bytes
- ffprobe result: valid streams and non-empty file

Microphone extraction:

- Path: `Audio\morgan-mic.m4a`
- Audio: AAC, 48000 Hz, mono
- Duration: 17.039 seconds
- Size: 263,438 bytes
- ffprobe result: valid playable audio

Session metadata:

- `metadata.json` created for the ad hoc recording.
- `Session\recording-session.json` created.
- `Session\device-map.json` created.
- `Session\recording-state.json` status: `stopped`, elapsed: 17,048 ms.
- `Session\sync-metadata.json` includes saved media paths and `programPlayable: true`.
- `Logs\errors.log` empty for the final validated pass.

## Export Validation

Exported file:

- Path: `Exports\what-about-it-full-episode-video.mp4`
- Video: H.264, 640x480, 10 fps
- Audio: AAC, 48000 Hz, mono
- Duration: 17.039 seconds
- Size: 917,049 bytes
- ffprobe result: playable media

Export artifacts:

- `Exports\export-job.json`
- `Exports\export-log.txt`
- `Exports\export-summary.json`

Export summary status: `complete`

## Issues Found And Fixed

Issue 1: WebM validation was too strict.

- First physical pass created a real `Program\program.webm` with VP9 video and Opus audio.
- ffprobe did not report a top-level container duration for that WebM.
- The previous validator required duration and rejected the file even though streams existed.
- Fix: `validatePlayableMedia` now accepts either a positive duration or valid streams plus non-empty file size.

Issue 2: Ad hoc recording sessions were not listable for export.

- Recording without an active episode created a real session folder but no `metadata.json`.
- On app restart, the recording could not appear in recent episodes.
- Fix: `createRecordingSession` now writes metadata when needed so an ad hoc recording can be loaded and exported.

Issue 3: stopped timer reset to zero.

- The UI reached `Recording Complete`, but the timer displayed `00:00:00`.
- Fix: `RecordingService.stop()` now preserves the final elapsed time before setting status to stopped.

## Remaining Risks

- Only one physical camera and one physical microphone were validated.
- Multi-camera capture is still not validated.
- Multiple simultaneous microphones are still not validated.
- Long-duration recording stability is still not validated.
- The camera mirror currently copies the program recording; it is not a separate isolated camera track.
- Browser/Electron logs showed Windows camera buffer reservation warnings during the first failed validation pass.
- Media-backed timeline playback is still not complete.
- Real Auto Edit is still not complete.

## Decision

Short physical camera/microphone recording is validated for the current hardware.

Morgan should still not rely on this build for a full production episode until long-duration recording, multi-device behavior, recovery, and media-backed review are validated.
