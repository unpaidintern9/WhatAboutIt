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
| Shortcut launches app | Passed | Launching the shortcut opened the Windows Electron app. Phase 8C updates the beta app window title to `What About It Studio`. |
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

## Phase 8C Installed-App Retest

Status: Passed for installed beta launch, first-run Hardware Test routing, one physical camera, one physical microphone, 30-second recording, local export, and diagnostics on June 27, 2026.

| Check | Result | Evidence |
| --- | --- | --- |
| NSIS installer builds | Passed | `npm run installer:win` produced `app/release/What About It Studio-0.1.0-Windows.exe`. |
| Installed Desktop shortcut launches app | Passed | `C:\Users\mmcga\OneDrive\Desktop\What About It Studio.lnk` opened the installed app window. |
| Installed Start Menu shortcut launches app | Passed | `C:\Users\mmcga\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\What About It Studio.lnk` opened the installed app window. |
| First-run Hardware Test prompt appears | Passed | Installed app showed the beta welcome/check setup screen with `Run Hardware Test`. |
| 30-second real recording completes | Passed | Packaged app saved `Program/program.webm`, `Cameras/camera-1.webm`, and `Audio/morgan-mic.m4a`. |
| Export still validates | Passed | Packaged app exported `Exports/what-about-it-full-episode-video.mp4`, validated by ffprobe at 29.999 seconds. |
| Diagnostics folder exists | Passed | Diagnostics were saved under `%APPDATA%\What About It Studio\diagnostics` and included packaged app path data. |
| Diagnostics excludes raw media | Passed | No `.webm`, `.mp4`, `.m4a`, `.mov`, or `.mkv` files were found in the diagnostics folder. |
| Uninstall/reinstall smoke test | Passed with caveat | Silent uninstall removed the installed app and `%APPDATA%\What About It Studio` settings. Reinstall succeeded and launched fresh. |

Latest Phase 8C packaged-app episode:

```text
C:\Users\mmcga\AppData\Roaming\What About It Studio\episodes\2026-06-27-hardware-test-6-27-2026-7-54-08-pm-a51f1fa9
```

Latest Phase 8C packaged-app diagnostics folder:

```text
C:\Users\mmcga\AppData\Roaming\What About It Studio\diagnostics\2026-06-27-2026-06-27-hardware-test-6-27-2026-7-54-08-pm-a51f1fa9-1782604498314
```

Validated packaged outputs:

- `Program/program.webm`: 3,380,199 bytes.
- `Cameras/camera-1.webm`: 3,380,199 bytes.
- `Audio/morgan-mic.m4a`: 565,561 bytes, 29.999 seconds.
- `Exports/what-about-it-full-episode-video.mp4`: 1,367,107 bytes, 29.999 seconds.
- `Diagnostics/app-info.json`: `mode: packaged`, `appDataRoot: C:\Users\mmcga\AppData\Roaming\What About It Studio`.

## Phase 8B Retest

Status: Passed for desktop launch, one physical camera, one physical microphone, 30-second recording, local export, dashboard readiness, and diagnostics on June 27, 2026.

| Check | Result | Evidence |
| --- | --- | --- |
| Desktop shortcut still launches app | Passed | `What About It Studio.lnk` opened the app window. Phase 8C updates the beta app window title to `What About It Studio`. |
| Live Studio Dashboard renders | Passed | Dashboard displayed `Needs Attention`, Camera 1, Camera 2, Camera 3, Morgan Mic, Recording, Export, and Storage cards. |
| Saved preferences restore | Passed | Existing app settings loaded and hardware checks completed without reselecting devices. |
| Missing saved/unavailable devices show Needs Attention | Passed | Camera 2 and Camera 3 showed `Needs Attention` because only one physical camera was connected. |
| Device changes refresh without restart | Automated only | Code listens for `devicechange` and tests cover hot-plug readiness changes. Physical unplug/replug was not performed in this manual pass. |
| 30-second real recording still completes | Passed | Latest session stopped with real `Program/program.webm`, `Cameras/camera-1.webm`, and `Audio/morgan-mic.m4a`. |
| Export still validates | Passed | Latest `Exports/what-about-it-full-episode-video.mp4` validated with ffprobe at 30.340333 seconds. |
| Diagnostics folder exists | Passed | Diagnostics folder was created with app info, device list, hardware results, session files, and logs. |
| Diagnostics excludes raw media | Passed | No `.webm`, `.mp4`, `.m4a`, `.mov`, or `.mkv` files were found in the diagnostics folder. |

Latest Phase 8B validated episode:

```text
C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudioData\episodes\2026-06-27-hardware-test-6-27-2026-7-00-48-pm-e25338dc
```

Latest Phase 8B diagnostics folder:

```text
C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudioData\diagnostics\2026-06-27-2026-06-27-hardware-test-6-27-2026-7-00-48-pm-e25338dc-1782601298666
```

Validated outputs:

- `Program/program.webm`: 3,189,931 bytes.
- `Cameras/camera-1.webm`: 3,189,931 bytes.
- `Audio/morgan-mic.m4a`: 476,489 bytes, 30.321333 seconds.
- `Exports/what-about-it-full-episode-video.mp4`: 1,259,054 bytes, 30.340333 seconds.
- `Session/recording-session.json`: `status: stopped`, `practice: false`.
- Diagnostics files: `app-info.json`, `device-list.json`, `hardware-test-results.json`, session JSON files, app log, and `errors.log`.
