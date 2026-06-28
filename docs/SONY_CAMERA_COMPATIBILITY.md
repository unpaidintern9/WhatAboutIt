# Sony Camera Compatibility

Phase: 7C Sony Multi-Camera + Wireless Video Validation, updated in Phase 9B

Status: Sony Imaging Edge camera is detected by Windows and Electron; Studio Setup live preview is not fully validated.

## Phase 9B Update

Windows detected `Sony Camera (Imaging Edge)` as a camera device with status `OK`.

Electron enumeration detected:

- `Sony Camera (Imaging Edge)`
- `Integrated Camera (13d3:540a)`
- `Microphone (Realtek(R) Audio)`
- `Speakers (Realtek(R) Audio)`

Sony Remote and Imaging Edge Desktop were running during the audit. If the app reports that the Sony camera is busy, close those Sony apps and refresh cameras.

The built What About It Studio smoke did not populate Studio Setup camera dropdowns after refresh, so Sony live preview from the setup card is still blocked. Do not claim Studio Setup Sony preview support until that pass succeeds.

## Detection Result

Windows camera devices visible during the original Phase 7C pass:

- Integrated Camera, `USB\VID_04F2&PID_B78E&MI_00\6&1A0304F2&1&0000`, status unknown
- HP True Vision HD Camera, `USB\VID_05C8&PID_0B08&MI_00\6&353BDB39&0&0000`, status unknown
- Integrated Camera, `USB\VID_13D3&PID_540A&MI_00\6&2C56DEBB&0&0000`, status OK
- USB Live camera, `USB\VID_0C46&PID_64AB&MI_00\6&186AEB07&0&0000`, status unknown

No device identified itself as Sony by friendly name or Sony USB vendor ID during the original Phase 7C pass. This changed in Phase 9B when `Sony Camera (Imaging Edge)` was present.

## Sony Audit Fields

Every Sony camera should be audited for:

- Model
- Firmware
- USB webcam/streaming support
- HDMI capture support
- Wi-Fi video support
- Bluetooth control support
- Remote-control support
- Battery/charging status

Unknown fields must remain `Not confirmed`. Do not infer support from brand alone.

## Connection Matrix

The app now has behind-the-scenes provider slots for:

- USB/UVC provider
- HDMI capture provider
- Wireless camera provider
- Sony remote-control/capability placeholder provider
- Future Sony SDK/provider slot

## Current Guidance

Bluetooth must be treated as control/pairing only unless a real discoverable video stream is validated.

Wireless video must remain `Not confirmed` until a specific Sony model exposes a usable video stream and the app validates it.

Wired camera use must not be blocked because wireless failed.

## User-Facing Language

The main UI should keep showing only:

- Camera 1
- Camera 2
- Camera 3
- Choose Camera
- Test Camera
- Refresh Cameras
- Release Camera
- Open Camera Help
- Ready
- Live
- Needs attention
- Used by another app
- Permission needed
- Signal weak
- Battery low
- Not connected

Technical details stay in docs, provider code, or the gear menu.
