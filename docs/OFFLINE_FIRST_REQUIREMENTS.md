# Offline-First Requirements

What About It? Studio must work without internet access.

## Requirements

- Episode creation stores metadata locally.
- Recent episodes come from local storage.
- Settings persist locally.
- Theme files live locally.
- Media processing dependencies live inside `external-repos/` or later packaged binaries.
- No app screen should require a remote API to render.
- Online features, if added later, must be optional.

## Local Data

The default app data model should create:

- `episodes/<episode-id>/metadata.json`
- `episodes/<episode-id>/media/`
- `episodes/<episode-id>/drafts/`
- `episodes/<episode-id>/exports/`
- `episodes/<episode-id>/reports/`

## Rejection Criteria

Reject any feature that requires cloud login, remote processing, remote templates, remote fonts, or remote images for core operation.

