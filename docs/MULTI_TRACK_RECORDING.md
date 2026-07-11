# Multi-Track Recording

Date: 2026-06-28

## Current Behavior

The Live Studio now records a main Program file and attempts separate sidecar recordings for selected camera and microphone slots.

Program output:

- `Program/program.webm`

Camera sidecar outputs, when selected and supported by Electron/browser capture:

- `Cameras/camera-1.webm`
- `Cameras/camera-2.webm`
- `Cameras/camera-3.webm`

Audio sidecar outputs, when selected and supported by Electron/browser capture:

- `Audio/morgan-mic.m4a`
- `Audio/guest-mic.m4a`
- `Audio/extra-mic.m4a`

Export still uses `Program/program.webm`. Sidecar files are for Review and future edit/export choices.

## Truthful States

Each sidecar recorder reports one of these states:

- `Saved`: the file was written and validated.
- `Preview only`: the device could be previewed, but a separate recorder could not start.
- `Needs Attention`: a sidecar recorder produced no valid output or failed validation.

The app does not create fake Camera 2, Camera 3, Guest Mic, or Extra Mic files when separate capture is not available.

## Validation

Every saved sidecar is validated before it is marked saved.

- Camera sidecars are written as WebM and checked with ffprobe.
- Mic sidecars are captured by MediaRecorder, transcoded to AAC M4A with FFmpeg, and checked with ffprobe.
- Sync metadata records saved file paths and per-track states in `Session/sync-metadata.json`.

## Phase 9I Manual QA Result

Run: current source build launched with `npm start`

Hardware selected:

- Camera 1: `Sony Camera (Imaging Edge)`
- Camera 2: `Integrated Camera (13d3:540a)`
- Camera 3: not selected
- Morgan Mic: selected local microphone channel
- Guest Mic: selected local microphone channel detected by the app
- Extra Mic: not physically validated

Recording result:

- Timer reached `00:00:52`.
- Review opened after Stop.
- Review displayed Camera 1, Camera 2, Morgan Mic, and Guest Mic as ready.
- Camera 3 and Extra Mic showed truthful `Not recorded in this episode` states.

ffprobe validated:

- `Program/program.webm`: VP9 video 1024x576, Opus mono audio 48 kHz.
- `Cameras/camera-1.webm`: VP9 video 1024x576.
- `Cameras/camera-2.webm`: VP9 video 640x480.
- `Audio/morgan-mic.m4a`: AAC mono 48 kHz, duration `74.335000`.
- `Audio/guest-mic.m4a`: AAC mono 48 kHz, duration `74.095000`.

Export result:

- Standard Full Episode Video export completed.
- `Exports/what-about-it-full-episode-video.mp4` validated as H.264/AAC, 1024x576, 30 fps, duration `74.359833`.

## Remaining Gaps

- Camera 3 was not physically validated.
- Extra Mic was not physically validated.
- Guest Mic was validated as a saved app channel, but the exact physical second microphone identity was not independently confirmed.
- Human ear confirmation is still needed for test sound and headphone monitoring.

## Post-Phase 9I Routing Fix

The recorder now prefers active Live Studio preview and meter streams before opening a device again. When Camera 1, Camera 2, or Camera 3 is already live on the Record screen, pressing Record clones that live camera track for the Program/sidecar recorder instead of asking Windows/Electron to open the same camera a second time. This is intended to avoid the real failure where one camera previews but another camera fails to save because the driver rejects duplicate opens.

Camera cards now include an `Audio input` route to Morgan Mic, Guest Mic, or Extra Mic. The Program recording uses the Camera 1 audio route. Sidecar audio files still save by microphone slot:

- Camera 1 default route: Morgan Mic
- Camera 2 default route: Guest Mic
- Camera 3 default route: Extra Mic

Automated coverage confirms:

- Already-live Camera 1 and Camera 2 streams are reused without calling `getUserMedia()` again.
- The Camera 1 audio route controls which selected mic feeds the Program recorder.
- Mixer input selectors update Morgan/Guest/Extra mic device assignments.

Physical M-Audio AudioBox input selection and headphone monitoring still need a human hardware pass.
