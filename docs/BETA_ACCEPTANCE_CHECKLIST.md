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

## Current Gate Decision

Morgan should not rely on this build to record a production episode today.

The correct next engineering task is to connect and validate the real media backend, starting with export/runtime availability and one reliable recording path before broadening to multi-camera and Auto Edit.
