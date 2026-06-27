# Phase 8B Hardware Readiness

Phase 8B turns Real Hardware Test Mode into a beta hardware readiness surface.

## What Changed

- Device changes refresh automatically while the app is open.
- Saved Camera 1/2/3 and Morgan Mic choices remain saved across launches.
- If a saved device is missing, the app keeps the preference and shows `Needs Attention`.
- Real Hardware Test Mode now includes a Live Studio Dashboard.
- Recording stops safely when a required saved device disappears during a test or recording.
- Diagnostics can be saved locally for support review.

## User-Facing States

The main UI stays simple:

- Ready
- Disconnected
- Reconnecting
- Needs Attention

No protocols, drivers, codecs, or technical camera language are shown in the primary flow.

## Diagnostics Bundle

The diagnostics action creates a local folder under:

```text
WhatAboutItStudioData/diagnostics/
```

It may include:

- `app-info.json`
- `device-list.json`
- `hardware-test-results.json`
- Session JSON files when a recording session exists
- Relevant app and recording logs

It must not include raw media files or secrets.

## Beta Limitations

- Multi-camera physical validation is still required.
- Long-duration recording stability is still required.
- A final branded app icon is still required for the desktop shortcut.
- Diagnostics are a folder, not a compressed zip, so beta testers can inspect contents easily.
