# Auto Edit Spec

Auto Edit is a Phase 6 feature. Phase 1 may show disabled placeholders only.

## Modes

- Gentle: preserve conversation pacing and remove only obvious dead air.
- Balanced: tighten pacing while preserving natural delivery.
- Fast Paced: prioritize momentum and concise segments.
- Clip Hunter: identify highlight candidates without forcing a full episode edit.

## Required Behavior

- Produce non-destructive draft timelines.
- Preserve live markers.
- Generate an edit report.
- Allow review, accept, reject, and undo.
- Keep original media untouched.

## Signal Sources

- Silence/dead-air detection.
- Audio levels and normalization.
- Speaker activity.
- Transcript and chapter suggestions from whisper.cpp.
- Optional visual/audio analysis from OpenCV and Essentia.

