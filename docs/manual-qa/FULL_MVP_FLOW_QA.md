# Full MVP Flow QA

Date: 2026-06-27

Scope: Welcome to local export. Auto Edit is intentionally not included.

## Flow Checked

```text
Welcome -> New Episode -> Studio Setup -> Record -> Review Episode -> Edit Draft -> Export
```

## Findings

- Welcome/Home gives one obvious next action: New Episode.
- New Episode moves into Studio Setup after local metadata is created.
- Studio Setup keeps camera and microphone wording beginner-friendly.
- Record screen reassures that everything saves locally.
- Review Episode shows draft timeline, marker review, safe edit controls, and original-safe messaging.
- Export screen provides simple local options and keeps original-safe messaging visible.
- Practice Mode now covers new episode, setup, recording, review, safe editing, recovery, and export practice.
- Learning Center covers the flow from device setup through export.

## Local Data Checks

- New episodes create local episode folders.
- Recording creates `Program`, `Cameras`, `Audio`, `Backup`, `Session`, and `Logs`.
- Draft edits save to `Session/draft-timeline.json`.
- Exports save to `Exports` and create `export-job.json`, `export-log.txt`, and `export-summary.json`.

## Offline Checks

- No account is required.
- No telemetry is used.
- No cloud service is required.
- Local files remain the source of truth.

## Language Checks

User-facing screens avoid technical terms such as FFmpeg, codecs, bitrate, render graphs, OBS, or upload services.

## Brand Guardian Review

Score: 96/100.

The MVP flow remains vintage What About It? Studio, uses theme tokens, keeps large clear controls, and avoids generic dashboard patterns.
