# Sony Live Preview QA

Phase: 9B Sony Live Preview + Simplify Studio Flow

Date: 2026-06-28

Result: passed for built-app Studio Setup dropdown population and Sony live preview.

## Hardware and Software Observed

- Windows device: `Sony Camera (Imaging Edge)`, status `OK`
- Windows device: `Integrated Camera`, status `OK`
- Audio input: `Microphone (Realtek(R) Audio)`, status `OK`
- Audio output: `Speakers (Realtek(R) Audio)`, status `OK`
- Sony apps running during audit: Imaging Edge Desktop, Imaging Edge Webcam Launcher, and Remote

## Passed

- Windows detected `Sony Camera (Imaging Edge)`.
- Electron enumeration detected `Sony Camera (Imaging Edge)` and `Integrated Camera`.
- The rebuilt app launched.
- The simplified sidebar displayed primary Studio, Setup, Record, Review, and Export routes.
- Studio Setup showed camera cards with `Refresh Cameras`, `Release Camera`, and `Open Camera Help`.
- Studio Setup camera dropdowns showed `Sony Camera (Imaging Edge)` and `Integrated Camera (13d3:540a)` for Camera 1, Camera 2, and Camera 3.
- Selecting `Sony Camera (Imaging Edge)` in Camera 1 started live preview and the card showed `Live`.
- Microphone dropdowns showed Realtek microphone options.

## Failed or Blocked

None for the Phase 9C dropdown/live-preview target.

## Fixes Made During This Pass

- `Refresh Cameras` now uses the permission-aware request path.
- Camera and microphone permission requests are independent, so one busy device should not hide all device feedback.
- The ready banner no longer claims the studio is ready unless the saved camera and mic are present in current detection.
- Electron grants local app media permission requests.
- Provider registry camera discovery is merged into the active Studio Setup detection path.
- Local diagnostic logging was added behind `localStorage.waiDeviceDebug = "1"`.

## Not Retested

- Long recording stability.
- Export from a new recording.
- Audible headphone monitoring.

These were already covered in earlier phases and were not changed by this pass.
