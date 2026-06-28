# Export Reliability

Phase 9F tightens export around real recorded media.

## What Works

- Export requires `Program/program.webm` for non-practice exports.
- Stray files in the Program folder no longer allow a false successful export.
- Export renders with bundled FFmpeg.
- Export success is written only after ffprobe validates the output.
- Export summary mirrors the real job status and message.
- Export works after Review reload because it uses the active or latest episode id already used by the app flow.

## Draft Edits

Draft edits are saved, but render-applied editing is not complete. When an edited draft is exported, the job and summary say:

`Export complete from original program. Draft rendering comes next.`

## Failure States

- No `Program/program.webm`: `We couldn't find the recording file`
- Missing media tools: `Media tools need setup before export`
- FFmpeg or validation failure: `Something needs attention before export`

No placeholder export files count as success.
