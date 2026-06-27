# MLT Framework Dependency Audit

Repository: `external-repos/mlt`  
Remote: https://github.com/mltframework/mlt.git  
Local shallow commit: `bef9d89`

## What Problem It Solves

MLT provides a non-linear editing framework for timelines, producers, filters, transitions, and rendering.

## Features We Will Actually Use

- Timeline architecture research.
- Possible draft timeline render model in Phase 5.
- Non-destructive edit representation ideas.

## Parts We Will Not Use

- Full editor UI concepts.
- Transitions/effects-heavy editing.
- Direct exposure of MLT terminology.
- Rendering before Phase 5.

## License

LGPL-2.1, based on local `COPYING`.

## Build Requirements

MLT uses CMake and native media dependencies. Windows builds may require compiler toolchains plus FFmpeg and optional module dependencies.

## Risks

- Adds another complex native media stack.
- Overkill for a simple first timeline.
- Packaging and codec compatibility require careful testing.

## Better Alternatives

- App-owned JSON edit decision list rendered with FFmpeg.
- OpenTimelineIO for interchange concepts.
- A minimal timeline model until advanced editing justifies MLT.

## Integration Approach

Do not integrate blindly. Define the app's own `TimelinePlugin` interface and draft timeline JSON first. Treat MLT as optional implementation research for later rendering or timeline operations.

