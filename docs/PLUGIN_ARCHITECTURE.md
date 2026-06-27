# Plugin Architecture

What About It? Studio is designed around replaceable modules. Major features should be swappable without rewriting the app shell.

## Plugin Areas

- Recording
- Cameras
- Audio
- Timeline
- Auto Edit
- Export
- Teleprompter
- Themes
- Learning Center

## Boundaries

The app shell owns navigation, local app state, and user interaction. Services own orchestration. Plugins own specialized capability implementations.

## Integration Rule

Every plugin must satisfy a contract in `core/`. No screen should call OBS, FFmpeg, MLT, whisper.cpp, OpenCV, Essentia, or auto-editor directly.

## Phase Rule

Plugin folders may exist before their implementation phase. Capability code may not begin before the approved phase.

