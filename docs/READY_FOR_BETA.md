# Ready For Beta

Date: 2026-06-27

## Can Morgan record a real episode today?

No.

Morgan can use the app as a polished offline prototype and may be able to make a basic single-camera browser recording in a controlled environment. She cannot yet rely on it for a real production podcast episode.

## What prevents beta?

1. **Recording is not production-grade**
   - The app uses a browser MediaRecorder foundation.
   - The hidden OBS/libobs recording layer is not implemented.
   - Up to 3 cameras and multiple microphones are not truly captured as production-ready separate sources.

2. **Export does not create real media**
   - Export currently writes local job/log/summary files and a text placeholder.
   - It does not produce a real YouTube-ready MP4, podcast audio file, or archive master.

3. **Auto Edit is simulated**
   - Auto Edit creates a reviewable report and draft timeline.
   - It does not yet analyze actual audio, transcript, speakers, camera changes, silence, or clipping.

4. **Timeline editing is not media-backed**
   - Trim, split, cut, and Auto Edit suggestions are saved as draft operations.
   - Users cannot yet preview those edits against real synchronized media.

5. **Recovery is unproven with real interrupted recordings**
   - Session state exists, but interrupted media-file recovery needs real recorder testing.

6. **Packaging is not release-ready**
   - Installer configuration exists, but signed packaged builds and install smoke tests are not complete.

## Beta Gate

The app should not be called beta-ready until a real episode can be recorded, reviewed, edited, exported to playable files, reopened, and recovered after interruption using production integrations.
