# Phase 6 Smart Auto Edit Platform

Phase 6 adds an offline assistant-editor platform.

## Pipeline

```text
Recording
Transcript
Audio Analysis
Speaker Detection
Marker Analysis
Timeline Decisions
Camera Decisions
Draft Timeline
Review
Export Ready
```

Each stage is represented as a replaceable module boundary. Version 1 uses deterministic offline analysis and simulated intelligence where real media analysis is not yet available.

## Modes

- Gentle
- Balanced
- Fast Paced
- Clip Hunter

## Outputs

- New non-destructive draft timeline.
- `Session/AutoEditReport.json`.
- Suggested chapters.
- Suggested clips.
- Review-needed items.

## Guardrails

- Never overwrite original recordings.
- Never hide edits from the user.
- Preserve user markers and manual edits.
- Keep Auto Edit reviewable, explainable, and reversible.

## Brand Guardian Review

Score: 97/100.

The Auto Edit screen uses theme tokens, branded panels, plain language, and a friendly assistant-editor tone.
