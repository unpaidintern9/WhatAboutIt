# Open-Source Editor Integration

## Decision

What About It Studio keeps its existing branded Electron/React interface and its app-owned episode workflow. It does not embed or reskin another editor application.

The editor architecture uses two source layers:

- What About It owns the screens, terminology, project model, recording workflow, Auto Edit workflow, and FFmpeg export pipeline.
- Selected nonvisual timeline interaction algorithms may be adapted from the MIT-licensed OpenCut Classic codebase and translated to What About It's types and tests.

Kdenlive and Shotcut remain useful product and MLT-framework references, but their GPL C++/Qt interfaces are not copied into What About It. MLT remains an optional future renderer only if the existing FFmpeg pipeline cannot support an approved editing requirement.

## Approved OpenCut Boundary

Allowed to adapt:

- snapping and ruler math
- clip placement and collision rules
- drag, resize, and grouped-move calculations
- ripple-edit calculations
- timeline zoom and scroll coordination
- waveform display calculations

Not adopted:

- OpenCut UI, styling, navigation, panels, icons, or branding
- authentication, cloud services, databases, or account flows
- Next.js application shell
- OpenCut project persistence
- OpenCut rendering/export stack
- experimental Rust/WASM runtime

## Compatibility Rules

1. Every adapted module uses What About It domain types and remains behind the existing timeline service boundary.
2. Existing episode folders and `Session/draft-timeline.json` stay readable.
3. Original recordings are never rewritten.
4. Existing FFmpeg export behavior remains the fallback until replacement behavior passes the same media verification.
5. UI changes must use What About It theme tokens and vocabulary.
6. Each adopted behavior requires focused tests and an entry in `THIRD_PARTY_NOTICES.md`.

## Current Integration

The first adopted primitive is the snapping resolver. It replaces the fixed 500 ms snap window with a visual threshold derived from the existing What About It timeline zoom and viewport width. The visible interface is unchanged, but fine edits no longer jump an excessive distance when zoomed in.
