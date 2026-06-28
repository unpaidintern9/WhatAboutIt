# Media Stream Lifecycle

Phase 9F adds explicit cleanup for camera, microphone, monitoring, and recording streams.

## Cleanup Rules

- Studio Setup and Record preview streams are managed by `DeviceService`.
- Opening a second stream for the same camera or mic stops the older stream first.
- Leaving Studio Setup or Record calls `DeviceService.releaseAll()`.
- Renderer shutdown and `beforeunload` call both `DeviceService.releaseAll()` and `RecordingService.shutdown()`.
- Camera preview components still stop their local tracks on unmount.
- Mic meter components stop their local tracks, cancel animation frames, and close `AudioContext`.
- The browser recording plugin stops all tracks on stop and shutdown.

## Tested

- Duplicate mic streams are stopped before a replacement opens.
- Camera and mic preview streams stop through central cleanup.
- Recording service shutdown calls the recording plugin shutdown hook.
- Mic meter monitor streams stop when React unmounts or monitoring changes.
- Camera preview streams stop when released by component cleanup or central service cleanup.

## Remaining Manual QA

Windows camera/mic privacy indicators should be checked after leaving Setup, leaving Record, stopping recording, and closing the app. No automated test can prove the physical LED or OS tray indicator turned off.
