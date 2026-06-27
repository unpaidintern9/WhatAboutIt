# Wireless Video Support

Status: safe foundation added; Sony wireless video not confirmed.

## Key Rule

Do not claim Bluetooth video support.

Bluetooth is treated as pairing/control only unless a specific camera exposes a real video stream and the app validates that stream.

## Current App Behavior

The app has a Sony wireless provider slot that can return friendly unsupported states without blocking wired recording.

Friendly fallback language:

- Try USB
- Try HDMI capture
- Check Wi-Fi connection
- This camera may only support Bluetooth control, not wireless video

## What Counts As Confirmed Wireless Video

Wireless video is confirmed only when:

- A specific camera model is known.
- A wireless video path is available on that model and firmware.
- The app can discover or receive an actual video stream.
- The stream can be previewed or recorded locally.
- The recorded output validates with ffprobe.

## Current Result

Sony wireless video: Not confirmed.

Bluetooth video: Not supported and not claimed.

Wired fallback: Supported where the camera appears as a local camera/capture device.

## Next Validation

When a Sony camera is connected:

1. Record model and firmware.
2. Try USB first.
3. Try HDMI capture if available.
4. Try wireless video only if the model exposes a real stream.
5. Treat Bluetooth as control-only unless proven otherwise.
6. Document exact result in `docs/manual-qa/SONY_MULTI_CAMERA_QA.md`.
