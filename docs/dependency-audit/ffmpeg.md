# FFmpeg Dependency Audit

Repository: `external-repos/FFmpeg`  
Remote: https://github.com/FFmpeg/FFmpeg.git  
Local shallow commit: `8512161`

## What Problem It Solves

FFmpeg provides local media transcoding, muxing, demuxing, audio extraction, waveform preparation, and final export.

## Features We Will Actually Use

- YouTube-ready MP4 export.
- Audio-only export.
- Proxy generation if needed.
- Audio extraction for analysis and transcripts.
- Loudness normalization research.
- Progress reporting through worker wrappers.

## Parts We Will Not Use

- Network streaming.
- Device capture in Phase 2.
- GPL-only filters unless the product deliberately accepts GPL distribution implications.
- Direct command exposure in the UI.

## License

Mostly LGPL-2.1-or-later by default, with optional GPL components when configured with `--enable-gpl`, based on local `LICENSE.md`.

## Build Requirements

FFmpeg builds through its `configure` script and compiler toolchains. Windows builds typically need MSYS2, MinGW, clang, or MSVC-oriented build tooling depending on the chosen path.

## Risks

- License mode changes depending on build flags.
- Codec availability depends on build configuration.
- Command-line complexity can leak into user experience if not wrapped carefully.
- Long-running exports need cancellation and recovery.

## Better Alternatives

- Prebuilt FFmpeg binaries with documented license configuration.
- OS-native encoders for limited exports, though less portable and less flexible.

## Integration Approach

Use FFmpeg behind an `ExportPlugin` and `MediaAnalysisService`. Prefer an isolated worker process with structured job specs, progress events, cancellation, and explicit license/build notes.

