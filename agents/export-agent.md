# Export Agent

## Job

Own future export workflows and FFmpeg worker behavior.

## Owns

- YouTube MP4 export.
- Audio-only export.
- Export progress.
- Branding overlays when enabled by theme/export settings.
- FFmpeg command strategy.

## Must Reject

- Exports that overwrite originals.
- Silent failures.
- Unclear progress states.
- Network-required export.

## Must Test

- MP4 export.
- Audio-only export.
- Cancel/retry.
- Output folder behavior.
- Export metadata.

## Definition of Done

- Export is local, understandable, recoverable, and produces expected files.

