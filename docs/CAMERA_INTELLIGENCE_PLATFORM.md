# Camera Intelligence Platform

Status: foundational platform complete.

The camera platform keeps the user experience simple:

- Camera 1
- Camera 2
- Camera 3
- Ready
- Needs Attention

Everything more complex stays inside providers, saved settings, health checks, and documentation.

## Supported Ecosystems

The provider registry can now support:

- Sony
- Canon
- Nikon
- Panasonic
- Fujifilm
- GoPro
- DJI
- Blackmagic
- USB webcams
- HDMI capture
- Network cameras
- Future camera providers

Brand-specific behavior belongs inside provider plugins, not the main UI.

## Common Camera Capability Contract

Every provider exposes a common capability shape:

- Camera name
- Manufacturer
- Model
- Battery availability
- Charging availability
- Temperature availability
- Connection quality availability
- Signal strength availability
- Resolution availability
- Frame rate availability
- Wireless video availability
- Remote control availability
- HDMI availability
- USB availability
- Network streaming availability
- Recording ready
- Preview ready
- Health status

Unavailable data is reported as unavailable or not confirmed. It is never guessed.

## Smart Camera Manager Rules

The platform should:

- Remember previously used cameras.
- Keep Camera 1/2/3 stable between launches.
- Prefer healthy connections.
- Reconnect automatically when a provider supports it.
- Warn before recording if a camera is unavailable.
- Never block a working wired camera because wireless failed.

## Health States

Camera health maps to friendly user states:

- Ready
- Needs Attention
- Signal weak
- Battery low
- Not connected

## Recovery

Providers may attempt recovery automatically when:

- A camera disconnects.
- Preview is lost.
- Signal becomes weak.
- Recording is interrupted.

Recovery must stay calm and local. The app should explain the next simple step without showing technical internals.

## Brand Guardian Review

Brand Guardian score target: 97+

Requirements:

- Friendly wording.
- Vintage What About It? styling.
- Theme tokens only.
- No generic settings pages.
- No technical jargon on primary screens.
- Brand names and connection details stay out of the main workflow unless the user opens advanced settings or documentation.
