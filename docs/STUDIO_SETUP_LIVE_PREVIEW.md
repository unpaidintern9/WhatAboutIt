# Studio Setup Live Preview

Phase: 9B Sony Live Preview + Simplify Studio Flow

Status: implemented and validated in built-app Phase 9C smoke.

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

## Phase 9C Fixes

- The main Electron process now grants only local media permission requests for the app.
- The active device plugin merges camera provider registry output into Studio Setup detection.
- Device discovery diagnostics can be enabled locally with `localStorage.waiDeviceDebug = "1"`.

## Phase 9C Built-App Result

The compiled Electron app showed `Sony Camera (Imaging Edge)` and `Integrated Camera (13d3:540a)` in Studio Setup camera dropdowns. Selecting Sony in Camera 1 started live preview and the preview class reached `setup-live-preview live`.
