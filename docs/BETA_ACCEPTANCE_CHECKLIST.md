# Beta Acceptance Checklist

Phase 7 beta acceptance status: not accepted.

Only validated production behavior can receive a "Yes." This pass did not validate a complete real-media workflow, so the checklist remains blocked.

| Question | Answer | Evidence |
| --- | --- | --- |
| Can Morgan record a full episode? | No | The browser recorder foundation is not validated for long-duration multi-camera and multi-mic recording. OBS integration is still a stub. |
| Can Morgan review the recording? | No | The review screen uses draft timeline data and placeholders, not a validated real media playback timeline. |
| Can Morgan edit the recording? | No | Edit operations are non-destructive draft entries, but they are not yet applied to playable media in preview or render. |
| Can Morgan run Auto Edit on a real recording? | No | Auto Edit currently generates deterministic suggestions from draft metadata and markers rather than analyzing real media. |
| Can Morgan export a playable episode? | No | The app can now render playable exports from available/generated local media through FFmpeg, but a real recorded podcast episode has not yet been captured and exported end to end. |
| Can Morgan recover from an interrupted session? | No | Recovery state exists, but interrupted real recording recovery has not been validated. |

## Required Evidence Before Beta

Before any item can move to "Yes," the project needs a recorded test episode that proves:

- Actual camera and microphone input were captured locally.
- The saved recording can be opened and reviewed in the application.
- Draft timeline edits are preserved without modifying originals.
- Export produces a playable media file from real recorded podcast media.
- Auto Edit analysis is derived from the recorded media or is clearly disabled until a real backend is available.
- An interrupted real recording can be detected and recovered without deleting raw files.

## Current Gate Decision

Morgan should not rely on this build to record a production episode today.

The correct next engineering task is to connect and validate the real media backend, starting with export/runtime availability and one reliable recording path before broadening to multi-camera and Auto Edit.
