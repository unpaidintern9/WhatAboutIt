# Camera Setup User Flow

Camera Setup must feel obvious to a first-time user.

## Main Screen

The user sees three cards:

- Camera 1
- Camera 2
- Camera 3

Each card shows a branded preview box, the camera name, one status, a large action button, Reconnect, and a small gear icon.

## Friendly States

- Ready
- Needs attention
- Not connected

Approved copy:

- Let's pick your cameras
- Camera 1 is ready
- We lost Camera 2, trying to reconnect
- This camera is already being used somewhere else
- Everything looks good

## Guardrails

The main UI must not mention protocols, source graphs, transport, driver stacks, backend providers, codecs, OBS, or FFmpeg.

The setup screen may support advanced camera paths behind the scenes, but the user should only need Find Cameras, Connect, Reconnect, and Signal.
