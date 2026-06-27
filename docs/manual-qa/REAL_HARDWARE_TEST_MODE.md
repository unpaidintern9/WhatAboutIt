# Real Hardware Test Mode QA

Phase 8A adds a guided real hardware validation flow:

1. Check cameras
2. Check microphones
3. Record a test
4. Export the test
5. Results

This mode must not simulate success. A result may show `Ready` only when the app has real evidence from device detection, recording state, or export state.

## Expected Output

The guided recording test should save real local media through the normal episode/session folder structure. Export should write a finished local copy through the existing FFmpeg export path.

## Manual Validation Result

Status: Passed for one physical camera, one physical microphone, local recording, and local export on June 27, 2026.

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop shortcut created | Passed | `C:\Users\mmcga\OneDrive\Desktop\What About It Studio.lnk` was created by `npm run create-shortcut`. |
| Shortcut launches app | Passed | Launching the shortcut opened a Windows Electron window titled `What About It? Studio`. |
| Camera test | Passed for Camera 1 | UI result showed `Camera 1 Ready`. Camera 2 and Camera 3 correctly showed `Needs Attention` because only one physical camera was available. |
| Microphone test | Passed | UI result showed `Morgan Mic Ready`. |
| 30-second recording test | Passed | `recording-state.json` shows `status: stopped` and `elapsedMs: 30933`. |
| Export test recording | Passed | UI result showed `Export Ready`; `Exports/export-summary.json` shows `status: complete`. |
| ffprobe validation | Passed | Program, Camera 1, Morgan Mic audio, and exported MP4 all validated with bundled ffprobe. |

## Hardware Used

- Camera: `Integrated Camera (13d3:540a)`
- Microphone: `Default - Microphone (Realtek(R) Audio)`
- Speaker/output devices detected: `Speakers (Realtek(R) Audio)`
- Operating system: Windows
- App launch path: desktop shortcut plus rebuilt Electron app for CDP-assisted validation

## Failures and Fixes

- During validation, `recording-session.json` originally stayed at `status: recording` after stop while `recording-state.json` was stopped. Fixed by syncing session status in `writeRecordingState`.
- Camera 2 and Camera 3 remained `Needs Attention`, which is expected because no second or third physical camera was connected.
- Shortcut creation initially failed because Electron's binary had not downloaded after dependency recovery. Running the Electron wrapper downloaded `electron.exe`, and `npm run create-shortcut` then succeeded.

## Final Evidence

Latest validated test episode:

```text
C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudioData\episodes\2026-06-27-hardware-test-6-27-2026-6-35-59-pm-5b6d1cc3
```

Validated outputs:

- `Program/program.webm`: 3,189,604 bytes; audio Opus plus VP9 video at 640x480.
- `Cameras/camera-1.webm`: 3,189,604 bytes; mirrored Camera 1 recording.
- `Audio/morgan-mic.m4a`: 522,255 bytes; AAC mono audio, 30.899 seconds.
- `Exports/what-about-it-full-episode-video.mp4`: 2,814,252 bytes; H.264/AAC MP4, 30.899 seconds.
- `Session/recording-session.json`: `status: stopped`, `practice: false`, with `stoppedAt`.
- `Session/recording-state.json`: `status: stopped`, `elapsedMs: 30933`.
- `Exports/export-summary.json`: `status: complete`, `originalRecordingSafe: true`.

## Notes

If camera or microphone permission fails, do not mark the test as passed. Record the blocker and keep the user-facing language friendly.
