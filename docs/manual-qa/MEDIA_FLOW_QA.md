# Media Flow QA

Date: 2026-06-28

## Automated Phase 9F Checks

Passed:

- Managed camera/mic streams release through `DeviceService.releaseAll()`.
- Duplicate mic streams are stopped before a replacement opens.
- Recording service shutdown calls the recorder shutdown hook.
- Per-mic monitoring controls render clear On/Off states.
- Review loads real program, camera, and audio files from an episode folder.
- Review marks missing media truthfully.
- Export fails when `Program/program.webm` is missing.
- Export succeeds from real `Program/program.webm`.
- Export summary matches the output state.
- Edited draft export states that draft rendering comes next.

## Manual Hardware QA Still Required

Not rerun in this pass:

1. Launch installed app.
2. Open Studio Setup.
3. Select Sony Camera and mic.
4. Confirm live preview and meter work.
5. Leave screen and confirm device releases.
6. Go Record.
7. Enable and disable per-mic monitoring with headphones.
8. Record a short 30-second test.
9. Stop.
10. Confirm Review opens.
11. Play Program video in Review.
12. Preview audio in Review.
13. Export MP4.
14. Validate with ffprobe.
15. Close app and confirm mic/camera are not left active.

## Current Status

The code path is now media-backed and test-covered, but this document does not claim a new physical Sony/mic run until that manual QA is performed.
