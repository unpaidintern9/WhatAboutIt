# auto-editor Dependency Audit

Repository: `external-repos/auto-editor`  
Remote: https://github.com/WyattBlue/auto-editor.git  
Local shallow commit: `1685d17`

## What Problem It Solves

auto-editor automates cuts based on silence, motion, and editing rules. It is useful as a reference for dead-air removal and pacing.

## Features We Will Actually Use

- Silence detection strategy research.
- Cut-list and edit-decision concepts.
- Reference behavior for conservative podcast tightening.

## Parts We Will Not Use

- CLI-first workflow.
- Direct destructive output as the primary UX.
- Advanced scripting exposed to users.
- Full dependency chain unless a wrapper proves valuable.

## License

Public domain / Unlicense style, based on local `LICENSE`.

## Build Requirements

Python project. Runtime requirements depend on selected features and media backends.

## Risks

- CLI behavior may not map cleanly to reviewable draft timelines.
- Automatic cuts can harm natural conversation if thresholds are too aggressive.
- Python packaging may complicate desktop distribution.

## Better Alternatives

- Build a small app-owned silence analyzer using FFmpeg audio data.
- Use auto-editor only as reference and test corpus.

## Integration Approach

Phase 6 only. Keep it behind an `AutoEditPlugin` pipeline stage. All output must become non-destructive draft timeline suggestions with review/accept/reject.

