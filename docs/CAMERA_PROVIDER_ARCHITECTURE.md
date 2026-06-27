# Camera Provider Architecture

Camera support is replaceable behind a provider contract.

## Purpose

The UI stays simple while providers handle camera discovery, connection, reconnect, signal, battery, and forget behavior.

## Provider Types

- Local computer cameras
- Built-in webcams
- USB cameras
- HDMI capture cards
- Wireless camera discovery foundation
- Future camera plugins

## Contract

Each provider must support:

- Discover cameras
- Connect
- Reconnect
- Forget
- Report friendly status
- Report signal when available
- Report battery when available

## Rules

Do not promise support for every proprietary camera. Add specific support through a provider when it can be tested safely.

Do not expose provider names, technical camera terms, OBS, FFmpeg, codecs, or implementation details in the main UI.

All camera settings and status stay local. No telemetry or cloud discovery is allowed.
