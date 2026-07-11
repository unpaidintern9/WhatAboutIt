# Beta Acceptance Checklist

Phase 7 beta acceptance status: not accepted.

Only validated production behavior can receive a "Yes." This pass did not validate a complete real-media workflow, so the checklist remains blocked.

| Question | Answer | Evidence |
| --- | --- | --- |
| Can Morgan record a full episode? | Partial | Phase 8D validated a real 30-minute live-studio recording/export after fixing long-run stop/save defects. A clean post-fix 60-minute pass is still needed. |
| Can Morgan review the recording? | Partial | Phase 9I Review displayed saved Camera 1, Camera 2, Morgan Mic, and Guest Mic files from a real current-build recording. Camera 3 and Extra Mic physical validation remain incomplete. |
| Can Morgan edit the recording? | No | Edit operations are non-destructive draft entries, but they are not yet applied to playable media in preview or render. |
| Can Morgan run Auto Edit on a real recording? | No | Auto Edit currently generates deterministic suggestions from draft metadata and markers rather than analyzing real media. |
| Can Morgan export a playable episode? | Partial | Phase 9G exported a fresh MP4 from real recorded media and ffprobe validated H.264/AAC, 1024x576, 30 fps, duration `54.724000`. All presets and full-length production media remain unvalidated. |
| Can Morgan recover from an interrupted session? | No | Recovery state exists, but interrupted real recording recovery has not been validated. |
| Can Morgan use multiple Sony cameras? | Partial | Phase 9I saved separate Camera 1 Sony and Camera 2 Integrated files. Multiple Sony bodies and Camera 3 remain unvalidated. |
| Can Morgan use Sony wireless video? | No | Wireless video is not confirmed. Bluetooth is treated as control-only unless a real video stream is validated. |
| Can Morgan launch the app from the desktop? | Partial | `What About It Studio.lnk` was created and launched the Electron app. Final installer and branded icon are still pending. |
| Can Morgan run a guided real hardware test? | Partial | Phase 8C live-studio QA validated two live camera previews, Realtek mic meters, 30-second recording, 5-minute recording, Review handoff, and playable MP4 export. Physical unplug/replug and full guided Hardware Test Mode rerun remain pending. |
| Can Morgan save a diagnostics bundle? | Partial | Phase 8B created a local diagnostics folder with app info, device list, hardware results, session files, and logs. Raw media was not included. |
| Can Morgan install the Windows beta app? | Partial | Phase 8C built `What About It Studio-0.1.0-Windows.exe`, installed it, launched from Desktop and Start Menu shortcuts, ran Hardware Test Mode, exported MP4, exported diagnostics, uninstalled, and reinstalled. Final branded icon, author metadata, and clean-machine QA remain pending. |

## Required Evidence Before Beta

Before any item can move to "Yes," the project needs a recorded test episode that proves:

- Actual camera and microphone input were captured locally for a full-length test.
- The captured `Program/program.webm` validates with ffprobe after a full-length test.
- The saved recording can be opened and reviewed in the application.
- Draft timeline edits are preserved without modifying originals.
- Export produces a playable media file from real recorded podcast media.
- Auto Edit analysis is derived from the recorded media or is clearly disabled until a real backend is available.
- An interrupted real recording can be detected and recovered without deleting raw files.
- Sony cameras can be validated by exact model, connection method, and recorded output.
- The desktop shortcut can be created and used to launch the app from a clean installed build.
- The real hardware test mode can complete Camera, Microphone, Recording, Export, and Results using all intended production hardware, including multi-camera setups.
- Diagnostics can be exported after a hardware test and inspected without raw media or secrets.
- Windows installer can be validated on a separate clean Windows machine with final icon/metadata.

## Current Gate Decision

Morgan should not rely on this build to record a production episode today.

The correct next engineering task is to connect and validate the real media backend, starting with export/runtime availability and one reliable recording path before broadening to multi-camera and Auto Edit.

## Phase 8B Live Studio Gate

The live Record screen is more functional and closer to the reference UI, but beta acceptance is still blocked until real hardware QA confirms:

- All intended cameras preview live on the Record screen.
- Mic meters move while speaking.
- Monitor Mic works through headphones without echo.
- Record, Pause, Resume, and Stop save a usable recording.
- Stop lands in Review Episode with the recorded session draft.
- Export works from that recorded file.
- ffprobe validation passes for the saved recording/export where available.

## Phase 8C Live Studio Gate

Phase 8C moved several items from untested to partially validated:

- Pass: Camera 1 and Camera 2 live previews appeared with real hardware.
- Pass: Realtek mic meter showed `We hear you` during the 30-second pass and `We can't hear you yet` during quiet-room sections.
- Pass: Record, Pause, Resume, Stop, Review Episode handoff, and local save worked for the 30-second test.
- Pass: Record, Stop, Review Episode handoff, and local save worked for the 5-minute test.
- Pass: ffprobe validated playable exports for both tests after capping video export to 30 fps.
- Partial: Test sound action and Monitor Mic toggle executed, but audible/headphone confirmation was not independently captured.
- Partial: Camera 3 not-connected state appeared, but physical disconnect/reconnect was not performed.

## Phase 8D Audio Monitoring and Long Recording Gate

Phase 8D moved long-recording stability forward, but beta remains blocked:

- Pass after fix: 30-minute real recording output was recovered from actual buffered browser recorder chunks and validated with ffprobe.
- Pass after fix: Export produced a playable 30-minute MP4, H.264/AAC, 1024x576, 30 fps, duration `1828.869000`.
- Pass: Camera 1 and Camera 2 stayed live through the 30-minute checkpoint.
- Pass: Feedback warning appeared for monitoring: `Use headphones so the mic doesn't echo.`
- Partial: Play Test Sound now routes to the selected output, but audible confirmation is still pending human confirmation.
- Partial: Monitor Mic toggled, but headphone audibility/no-echo is still pending human confirmation.
- Not run: 60-minute stability test.
- Fixed: Long-run stop/save hang and dead Export button exposed during this pass.

## Phase 9F Media Reliability Gate

Phase 9F removes several false-success risks, but beta remains blocked:

- Pass in automated tests: live preview/meter streams have central cleanup and duplicate mic streams are stopped.
- Pass in automated tests: recording shutdown calls the recorder cleanup hook.
- Pass in automated tests: per-mic monitoring controls show `Hear Morgan`, `Hear Guest`, and `Hear Extra` style On/Off states.
- Pass in automated tests: Review loads real Program, Camera, and Audio files from an episode folder and marks missing media truthfully.
- Pass in automated tests: Export fails when `Program/program.webm` is missing and succeeds from a real generated `Program/program.webm`.
- Partial: Draft edits are saved non-destructively, but render-applied editing is not implemented.
- Not run: focused physical Sony/mic media-flow QA after these fixes.

## Phase 9G Focused Media Flow Gate

Phase 9G validates the core real-media loop after the lifecycle fixes, but beta remains blocked:

- Pass: Installed app detected and previewed Sony Camera (Imaging Edge) and Integrated Camera after stale app processes were cleaned up.
- Pass: Live Studio recorded a real 44-second take and opened Review after Stop.
- Pass: Saved Program WebM, Camera 1 WebM, and Morgan Mic M4A files validated with ffprobe.
- Pass: Export completed from the recorded file and produced a valid MP4, H.264/AAC, 1024x576, 30 fps, duration `54.724000`; ffmpeg decode smoke passed.
- Fixed: Review now uses recording-state elapsed time when WebM duration metadata is missing, avoiding `00:00:00` duration for valid browser recordings.
- Partial: Per-mic monitoring controls toggled and defaulted Off, but audible headphone monitoring was not independently confirmable through automation.
- Partial: Camera 2 and Guest/Extra mic cards showed truthful missing states in Review, but separate files were not recorded.

## Phase 9I Multi-Track Recording Gate

Phase 9I moves multi-track recording from missing to partially validated:

- Pass: Program recording still saves and exports successfully.
- Pass: Current-source Electron QA saved `Cameras\camera-1.webm` from Sony Camera and `Cameras\camera-2.webm` from Integrated Camera.
- Pass: Current-source Electron QA saved `Audio\morgan-mic.m4a` and `Audio\guest-mic.m4a` from app-selected mic channels.
- Pass: Review displayed Camera 1, Camera 2, Morgan Mic, and Guest Mic as ready.
- Pass: ffprobe validated Program, Camera 1, Camera 2, Morgan Mic, Guest Mic, and exported MP4.
- Pass in automated tests: Camera 2, Camera 3, Guest Mic, and Extra Mic output paths are created when recorder sidecars succeed.
- Pass in automated tests: Preview-only devices keep truthful states instead of fake files.
- Partial: Camera 3 and Extra Mic were not physically validated in this run.
- Partial: The exact physical identity of the Guest Mic source was not independently confirmed.
- Partial: Human ear confirmation is still required for test sound and headphone monitoring.

## Post-Phase 9I Routing Gate

This pass fixes a usability/reliability issue reported with an M-Audio AudioBox and multiple live cameras:

- Pass in automated tests: already-live selected cameras are cloned for recording instead of being opened a second time.
- Pass in automated tests: Camera 1 audio routing can choose Morgan, Guest, or Extra mic slot for Program audio.
- Pass in automated tests: Morgan/Guest/Extra mixer strips expose input selection and update saved device defaults.
- Pass in automated tests: the device service exposes active camera/mic streams for recorder reuse.
- Partial: Physical M-Audio AudioBox input selection still needs a real hardware pass.
- Partial: Physical confirmation that all currently live cameras save in unison after this fix still needs a real hardware pass.
- Partial: Human ear confirmation is still required for output test sound and headphone monitoring.
