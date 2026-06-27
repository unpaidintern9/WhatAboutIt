# whisper.cpp Dependency Audit

Repository: `external-repos/whisper.cpp`  
Remote: https://github.com/ggml-org/whisper.cpp.git  
Local shallow commit: `0ae02cd`

## What Problem It Solves

whisper.cpp provides local speech-to-text transcription. It supports offline transcripts, chapter suggestions, search, and Auto Edit context.

## Features We Will Actually Use

- Local transcription.
- Timestamped words or segments.
- Chapter suggestion inputs.
- Searchable episode text.
- Clip-hunting context in Phase 6.

## Parts We Will Not Use

- Remote transcription.
- Model download flows that are required at runtime.
- GPU-specific paths until packaging is understood.
- Direct model/CLI jargon in user-facing screens.

## License

MIT, based on local `LICENSE`.

## Build Requirements

CMake/C++ build. Optional acceleration paths may require additional platform-specific SDKs.

## Risks

- Model files can be large.
- Accuracy depends on model selection and audio quality.
- CPU transcription can be slow.
- Model licensing and distribution must be documented separately from code.

## Better Alternatives

- OS-native speech recognition where available, though offline guarantees vary.
- Cloud transcription only as optional future feature, not core.

## Integration Approach

Keep behind a `TranscriptService` stage in the Auto Edit pipeline. Models should be managed locally, with clear offline availability and no required network call.

