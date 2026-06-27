# OBS Studio Dependency Audit

Repository: `external-repos/obs-studio`  
Remote: https://github.com/obsproject/obs-studio.git  
Local shallow commit: `3bba730`

## What Problem It Solves

OBS Studio provides a mature local recording and scene-composition engine. It solves multi-source capture, scene composition, encoder configuration, and recording orchestration.

## Features We Will Actually Use

- Research path for hidden recording architecture.
- Potential libobs-based recording control in Phase 3.
- Scene/source concepts for up to 3 cameras and multiple mics.
- Crash-safe recording behavior patterns.
- Local-only recording pipeline.

## Parts We Will Not Use

- OBS user interface.
- Streaming workflows.
- Plugin marketplace behavior.
- Browser-source-heavy production features unless explicitly needed.
- Advanced broadcast controls exposed directly to Morgan.

## License

GPL-2.0, based on the local `COPYING` file.

## Build Requirements

OBS is a large C/C++ CMake project. Windows builds typically require Visual Studio build tools, CMake, Qt, platform SDKs, and OBS dependency bundles.

## Risks

- GPL obligations may affect distribution strategy if libobs is linked into the app.
- Large build and packaging complexity.
- Tight coupling to OBS internals could make upgrades expensive.
- Exposing OBS concepts would harm product simplicity.

## Better Alternatives

- Native Media Foundation capture for a simpler Windows-first recorder.
- FFmpeg device capture for narrower capture flows.
- Keeping OBS as a separately launched local process instead of linking libobs, if license and packaging strategy require separation.

## Integration Approach

Do not integrate in Phase 1.5 or Phase 2 planning. Keep OBS behind a `RecordingPlugin` interface. Prototype both process-control and libobs approaches before committing to one.

