# Camera Provider Guide

Camera providers are replaceable modules that translate a camera ecosystem into the app's simple Camera 1/2/3 experience.

## Provider Responsibilities

Each provider must:

- Discover cameras it can actually see.
- Report capabilities through the common camera capability contract.
- Connect only when a real preview or recording path exists.
- Reconnect when possible.
- Forget saved devices on request.
- Return friendly status messages.
- Mark unknown capabilities as unavailable or not confirmed.

## Provider Interface

Providers expose:

- `discover`
- `getCapabilities`
- `connect`
- `reconnect`
- `forget`

Provider capabilities include:

- Manufacturer
- Preview support
- Wireless discovery support
- Battery status support
- Signal status support
- Auto reconnect support
- Remote control support
- HDMI support
- USB support
- Network streaming support

## Ecosystem Slots

Current slots:

- `sony-usb-uvc-cameras`
- `sony-hdmi-capture-cameras`
- `sony-wireless-video-cameras`
- `sony-remote-control-capabilities`
- `future-sony-sdk-provider`
- `canon-camera-provider`
- `nikon-camera-provider`
- `panasonic-camera-provider`
- `fujifilm-camera-provider`
- `gopro-camera-provider`
- `dji-camera-provider`
- `blackmagic-camera-provider`
- `generic-hdmi-capture-provider`
- `generic-network-camera-provider`
- `future-camera-provider`

## What Providers Must Not Do

Providers must not:

- Claim wireless video without a real stream.
- Treat Bluetooth as video.
- Guess battery, temperature, or signal data.
- Expose technical connection language on the main UI.
- Rewrite Camera 1/2/3 behavior.
- Break wired camera use when wireless setup fails.

## Friendly Status Mapping

Provider internals map to these user-facing states:

- `ready` -> Ready
- `needs-attention` -> Needs Attention
- `signal-weak` -> Signal weak
- `battery-low` -> Battery low
- `not-connected` -> Not connected

## Testing Expectations

Each provider should include tests for:

- Capability reporting.
- Unsupported capability handling.
- Reconnect state.
- Friendly failure state.
- Stable Camera 1/2/3 assignment.
- Gear settings save/load.
- Recording readiness.
