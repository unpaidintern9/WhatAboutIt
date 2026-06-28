# Beta Acceptance Checklist

Phase 7 beta acceptance status: not accepted.

Only validated production behavior can receive a "Yes." This pass did not validate a complete real-media workflow, so the checklist remains blocked.

| Question | Answer | Evidence |
| --- | --- | --- |
| Can Morgan record a full episode? | No | A 17-second physical one-camera/one-mic recording was validated, but full-episode long-duration stability has not been validated. |
| Can Morgan review the recording? | No | The review screen uses draft timeline data and placeholders, not a validated real media playback timeline. |
| Can Morgan edit the recording? | No | Edit operations are non-destructive draft entries, but they are not yet applied to playable media in preview or render. |
| Can Morgan run Auto Edit on a real recording? | No | Auto Edit currently generates deterministic suggestions from draft metadata and markers rather than analyzing real media. |
| Can Morgan export a playable episode? | Partial | A 17-second physical hardware recording exported successfully to a playable MP4. A full-length episode export has not been validated. |
| Can Morgan recover from an interrupted session? | No | Recovery state exists, but interrupted real recording recovery has not been validated. |
| Can Morgan use multiple Sony cameras? | No | Sony provider slots and Camera 1/2/3 ordering are in place, but no Sony camera was detected for physical validation. |
| Can Morgan use Sony wireless video? | No | Wireless video is not confirmed. Bluetooth is treated as control-only unless a real video stream is validated. |
| Can Morgan launch the app from the desktop? | Partial | `What About It Studio.lnk` was created and launched the Electron app. Final installer and branded icon are still pending. |
| Can Morgan run a guided real hardware test? | Partial | Phase 8B completed with one physical camera, one physical mic, dashboard readiness, a 30.340333-second MP4 export, and diagnostics. Multi-camera, physical unplug/replug, and long-duration validation remain pending. |
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
