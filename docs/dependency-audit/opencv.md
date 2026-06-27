# OpenCV Dependency Audit

Repository: `external-repos/opencv`  
Remote: https://github.com/opencv/opencv.git  
Local shallow commit: `dd54196`

## What Problem It Solves

OpenCV provides computer vision primitives for camera/frame analysis.

## Features We Will Actually Use

- Future camera activity analysis research.
- Visual quality checks such as black frames or frozen frames.
- Possible active-speaker or scene-change signals only if audio alone is insufficient.

## Parts We Will Not Use

- Face recognition.
- Fake person generation.
- Heavy vision pipelines in early phases.
- User-visible computer vision jargon.

## License

Apache-2.0, based on local `LICENSE`.

## Build Requirements

CMake/C++ build. Optional modules and acceleration paths add dependencies.

## Risks

- Large dependency footprint.
- Overkill for basic podcast editing.
- Privacy concerns if visual analysis is not explained and local.
- False positives can create poor edit decisions.

## Better Alternatives

- Lightweight frame sampling with FFmpeg.
- Audio-first active speaker detection.
- Simple black-frame checks before full OpenCV.

## Integration Approach

Keep optional behind a `CameraAnalysisStage`. Do not require it for Phase 2 device setup or Phase 3 recording.

