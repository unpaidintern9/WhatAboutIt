# Sony Live Preview QA

Phase: 9B Sony Live Preview + Simplify Studio Flow

Date: 2026-06-28

Result: blocked for Studio Setup live preview validation.

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
- Empty camera cards truthfully showed `Needs attention`.

## Failed or Blocked

- Studio Setup did not populate the camera dropdowns after `Check again`.
- Sony live preview could not be selected from Studio Setup.
- Integrated camera live preview could not be selected from Studio Setup.
- The built-app smoke did not reach the `Live` state for a setup camera card.

## Fixes Made During This Pass

- `Refresh Cameras` now uses the permission-aware request path.
- Camera and microphone permission requests are independent, so one busy device should not hide all device feedback.
- The ready banner no longer claims the studio is ready unless the saved camera and mic are present in current detection.

## Not Retested

- Long recording stability.
- Export from a new recording.
- Audible headphone monitoring.

These were already covered in earlier phases and were not changed by this pass.
