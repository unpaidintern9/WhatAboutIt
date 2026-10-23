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

Program remains the reliable fallback. Review now exposes every saved sidecar as an individual editable source, and draft export can assemble selected camera angles plus the included microphone tracks into one episode.

## Editing and Episode Folders

Each episode is one recording and keeps its complete work inside its own folder. Record uses a selected empty episode shell once. If that episode already has a session, imported media, finalized media, or recoverable media, Record automatically creates a new sibling episode with a UTC timestamp, title slug, and unique suffix. Existing data is never moved. Even empty/failed sessions are retained, and concurrent starts reserve different session files. Guest and description metadata carry forward; the new recording gets a fresh review draft and markers. Recent Episodes shows date and time so identically titled recordings are distinguishable. Pause/Resume remains within the same episode, including after closing and reopening the app.

Each recording contains:

- original Program, Cameras, and Audio media
- device and camera-to-microphone routing in `Session/device-map.json`
- non-destructive manual or Auto Edit decisions in `Session/draft-timeline.json`
- Auto Edit evidence and explanations in `Session/AutoEditReport.json`
- final episode and camera masters in `Exports/`
- edited 48 kHz, 24-bit microphone masters in `Exports/<job>/Audio Masters/`
- portable edit decisions in `Exports/<job>/edit-decision-list.json`

Camera and microphone sources can be selected independently in Review. Source-specific trims and cuts affect only that source. Program edits affect the combined episode. Microphones can be included, excluded, and leveled independently before the final mix.

Auto Edit can use sustained loudness from saved routed microphone tracks to propose camera changes. When the required mic sidecars or routes are missing, it keeps Program and reports that limitation instead of guessing.

## Interface Input Routing

Morgan, Guest, and Extra Mic each store a physical input route: `Automatic / mono mix` or numbered `Input 1` through `Input 16`. Automatic mono mix is the correct default for laptop microphones and ordinary single-input devices. Numbered routing is available for any interface whose Windows driver exposes those channels to Electron, not only one hardware brand.

One physical interface capture stream is shared and cloned for selected channels. Each numbered input is centered to mono independently for podcast recording and monitoring. Assigning one interface to multiple mic tracks automatically chooses separate numbered routes, and the exact same device/input route cannot be assigned twice. The recorder also refuses to start from stale settings that contain an exact duplicate route.

Camera assignment follows the same physical-source rule. Choosing a camera that is already in another slot moves it to the new slot, and the used option is disabled in the other selectors. Three Sony bodies must be exposed by Windows as three unique camera device IDs; one Imaging Edge virtual device cannot truthfully represent three simultaneous bodies.

When Windows supplies three distinct camera IDs with the same `Sony Camera (Imaging Edge)` label, discovery keeps all three and numbers the visible labels 1 through 3. Recording identity remains the device ID, and the three recorders write separate Camera 1/2/3 sidecars. One shared Imaging Edge endpoint is never duplicated into fake angles.

Interfaces that expose channels or channel pairs as separate Windows devices appear as separate microphone choices. Capture retries the same selected device in three steps: preferred studio quality, stereo with browser processing disabled, then device-only. This preserves Input 2 whenever the driver rejects only the optional sample-rate/sample-size request, and it never silently switches to another microphone. Interfaces still depend on their Windows WDM/WASAPI driver exposing those channels to Electron, and the app does not claim access to hidden ASIO-only channels.

The session device map retains the selected device id, Windows label, numbered channel, editable display name, role, and a slot/channel-specific start timestamp. Two tracks may share one interface only when their numbered channel routes differ.

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

## Durable Pause and Resume

New capture sessions write immutable parts inside `Episode/Recordings/part-<sequence>-<id>/`. Each part has its own Program, Cameras, Audio, Session, and Logs folders. `Episode/Session/recording-parts.json` owns the ordered part list. The episode/session IDs and top-level episode folder stay the same through every pause and resume.

Pause flushes the recorders, validates the part, writes a durable checkpoint with measured duration, and releases capture/close protection only after the save succeeds. A lossless Program remux supplies duration and seek metadata missing from browser WebM; the untouched capture remains as `Program/program.source.webm`. The app may then close. Reopening the episode or choosing **Open Paused Episode** restores the elapsed time; **Resume** starts another part in that episode. Only recorded time is included; time away from the app is excluded.

**Stop** finishes the episode and publishes validated combined Program/Cameras/Audio files at the existing top-level paths used by Review and Export. A single part is copied without transcoding. Multiple parts are aligned to each Program duration, normalize video to the first part's dimensions/frame rate, and are concatenated locally. Missing isolated tracks are withheld from the combined outputs with warnings; their available originals remain in the part folders. No fabricated camera or microphone track is substituted. Secondary backups use distinct part directories.

Recording starts/resumes and checkpoint operations are serialized. The backend only resumes a durably paused session, checks its saved Program files, rejects concurrent resume claims, and retains completed parts if assembly fails. Recovery can retry after interruption during finalization. Active capture/start/save prevents switching to or creating another episode. Paused episodes can be left and returned to; Review and Export require finishing with Stop. New Episode clears the prior recording's in-memory transport state and gets its own folder.

Legacy episode folders remain readable. Old interrupted recordings still support recovery; only new segmented sessions support closing and reopening a durable pause. Protected part originals should be included in a full local backup; they are not expendable review cache.

Real-media tests simulate main-process recreation between pauses, repeated saves, multiple resumes, streaming WebM without duration, concurrent resume claims, incomplete sidecars, and recovery after media finalization but before journal commit. Physical device reopen and long-session performance require hands-on QA.
