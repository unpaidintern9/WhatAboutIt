# Phase 5C Offline Export Foundation

Phase 5C unlocks a local Export screen while keeping Auto Edit, publishing, uploading, and social clip generation out of scope.

## User-Facing Options

- Full Episode Video: Ready for YouTube.
- Audio Only: Audio file for podcast platforms.
- Archive Master: Local archive copy.
- Social Clip Placeholder: Locked for Phase 6.

## Local Files

Exports are saved to:

```text
Episode/Exports/
```

Each export writes:

- `export-job.json`
- `export-log.txt`
- `export-summary.json`

## Guardrails

- Never overwrite original recordings.
- Keep hidden tooling behind the export service.
- Use simple language only.
- Keep all work offline and local.

## Brand Guardian Review

Visual score: 96/100.

The Export screen uses the active theme tokens, large tactile controls, plain wording, and vintage What About It? styling. It does not expose technical export internals.
