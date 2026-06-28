# Sony Windows Camera Audit

Phase: 9B Sony Live Preview + Simplify Studio Flow

Date: 2026-06-28

Status: Windows and Electron can see the Sony camera; Studio Setup live preview is not fully validated.

## Installed Sony Software

- Imaging Edge Desktop (Remote/Viewer/Edit), version `4.1.01.06121`, Sony Corporation, `C:\Program Files\Sony\Imaging Edge\`
- Imaging Edge Webcam, version `1.1.03.10061`, Sony Corporation, `C:\Program Files\Sony\Imaging Edge Webcam\`
- Imaging Edge Desktop, version `1.2.02.08050`, Sony Corporation, `C:\Program Files\Sony\Imaging Edge Desktop\`

## Windows Devices

- `Sony Camera (Imaging Edge)`, class `Camera`, status `OK`, instance `ROOT\IMAGINGEDGEWEBCAM\0000`
- `Integrated Camera`, status `OK`, instance starts with `USB\VID_13D3&PID_540A`
- Stale or inactive camera-like entries were also present: `HP True Vision HD Camera`, another `Integrated Camera`, and `USB Live camera`
- Audio devices present: `Realtek(R) Audio`, `Microphone (Realtek(R) Audio)`, and `Speakers (Realtek(R) Audio)`

## Sony Processes Running During Audit

- `ied`, window `Imaging Edge Desktop`
- `ImagingEdgeWebcamLauncher`
- `Remote`, window `Remote`

These processes may occupy the Sony camera. If What About It Studio shows `Used by another app`, close Sony Remote/Imaging Edge/Desktop and refresh cameras.

## Electron Enumeration Evidence

Electron media enumeration with Sony software still running reported:

- Video input: `Sony Camera (Imaging Edge)`
- Video input: `Integrated Camera (13d3:540a)`
- Audio input: `Microphone (Realtek(R) Audio)`
- Audio output: `Speakers (Realtek(R) Audio)`

## Conclusions

- Sony Imaging Edge exposes the camera as a normal Windows camera device.
- Bluetooth is not a video source and was not treated as one.
- No separate Sony wireless video device was detected.
- No multiple Sony cameras were detected.
- Studio Setup still needs a follow-up pass because the built app did not populate the camera list during the Phase 9B smoke.
