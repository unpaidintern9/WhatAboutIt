# Studio Setup Live Preview

Phase: 9B Sony Live Preview + Simplify Studio Flow

Status: implemented with truthful states; Sony live preview not fully validated in built-app smoke.

## Behavior

- Camera cards now contain a real `<video>` preview surface.
- Selecting a saved camera starts a live preview for that specific device id.
- Each camera card reports `Live`, `Ready`, `Needs attention`, `Used by another app`, or `Permission needed`.
- `Refresh Cameras` now uses the permission-aware device path.
- `Release Camera` stops the active preview stream and clears the video surface.
- `Open Camera Help` gives first-step recovery guidance without exposing developer error text.

## Phase 9B Fixes

- Camera and microphone permission requests are attempted independently so one busy device does not hide the other device list.
- The Studio Ready banner now requires the selected camera and microphone to be present in current detection, not only saved in settings.

## Current Limitation

During the compiled Electron smoke on 2026-06-28, Studio Setup continued to show empty camera cards after `Check again`. The operating system and a separate Electron enumeration pass detected `Sony Camera (Imaging Edge)` and `Integrated Camera`, so the remaining issue is specific to the app setup refresh/runtime path.
