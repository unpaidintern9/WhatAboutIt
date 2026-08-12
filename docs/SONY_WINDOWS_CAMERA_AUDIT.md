# Sony Windows Camera Audit

Phase: 9B Sony Live Preview + Simplify Studio Flow

Date: 2026-06-28

Status: Windows, Electron, and Studio Setup can see the Sony camera; built-app live preview validated in Phase 9C.

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

## Phase 9C Built-App Evidence

Built Electron renderer diagnostics reported:

- `Sony Camera (Imaging Edge)`
- `Integrated Camera (13d3:540a)`
- `Default - Microphone (Realtek(R) Audio)`
- `Microphone (Realtek(R) Audio)`
- `Speakers (Realtek(R) Audio)`

Studio Setup camera dropdowns populated with both `Sony Camera (Imaging Edge)` and `Integrated Camera (13d3:540a)` for Camera 1, Camera 2, and Camera 3. Selecting `Sony Camera (Imaging Edge)` in Camera 1 started a live preview and the card reached `Live`.

## Conclusions

- Sony Imaging Edge exposes the camera as a normal Windows camera device.
- Bluetooth is not a video source and was not treated as one.
- No separate Sony wireless video device was detected.
- No multiple Sony cameras were detected.
- Studio Setup built-app dropdown population and Sony live preview passed in Phase 9C.

## Three-Camera Sony Boundary

The current Windows audit exposes one Imaging Edge Webcam endpoint: `ROOT\IMAGINGEDGEWEBCAM\0000`. That endpoint carries one Sony video feed and cannot identify three camera bodies as three simultaneous sources. Assigning it to three app slots would duplicate the same feed or cause later opens to fail.

The August 9 hardware recheck found two connected ZV-1F bodies:

- `USB\VID_054C&PID_0E08\C8082064F9E3`
- `USB\VID_054C&PID_0E08\C80830656A74`

Windows currently classifies both as `Sony Remote Control Camera` under `libusbK Usb Devices`. They are physical control connections, not independent DirectShow video inputs. At the same time, DirectShow exposes only the single `Sony Camera (Imaging Edge)` endpoint above. Consequently, the app can select only one Sony video feed in this configuration even though two camera bodies are connected.

What About It Studio accepts any three distinct Windows camera endpoints and records them together. A three-Sony setup therefore requires one distinct endpoint per body:

- use native `USB Streaming` mode on each compatible Sony camera, or
- connect each camera through its own HDMI-to-USB capture device.

Studio Setup now displays the number of distinct simultaneous feeds detected and gives Sony-specific connection guidance when only the shared Imaging Edge Webcam endpoint is present. Imaging Edge Webcam remains fully selectable in any one camera slot.

For each ZV-1F that should become its own camera track, Sony's supported camera-side path is `MENU > Setup > USB > USB Connection Mode > USB Streaming` (or choose `Live Stream (USB Streaming)` when connecting). Reconnect each body and use `Refresh Cameras`; Windows must then publish a different video device ID for each body. Sony documents the ZV-1F USB stream as MJPEG at 1280x720 and 30/25 fps: <https://helpguide.sony.net/dc/2210/v1/en/contents/TP1000934575.html>.

If Windows exposes three distinct video device IDs with the same `Sony Camera (Imaging Edge)` label, Studio Setup keeps all three and numbers them `1`, `2`, and `3`. Record starts those distinct sources together and saves them as `Cameras/camera-1.webm`, `camera-2.webm`, and `camera-3.webm`. Labels alone are never used to merge cameras; the Windows device ID is the source identity.

Automated coverage now starts three already-live camera streams together, requires three active camera tracks, and verifies Camera 3 is included in the recording result. Physical three-camera acceptance remains pending until Windows publishes three distinct video endpoints; only two Sony bodies are currently connected, and neither is presently exposed as its own DirectShow stream.
