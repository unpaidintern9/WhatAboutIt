# Windows Beta Installer

Phase 8C prepares a real Windows beta installer for What About It Studio.

## Commands

From the project root:

```text
npm run package:win
npm run installer:win
npm run beta:win
```

Meanings:

- `package:win`: builds a Windows unpacked app for inspection.
- `installer:win`: builds the NSIS Windows installer.
- `beta:win`: runs verification first, then builds the installer.

Development launch and the existing desktop shortcut workflow remain available.

## Installer Identity

- Product name: `What About It Studio`
- App ID: `studio.whataboutit.desktop`
- Installer target: NSIS
- Desktop shortcut: enabled
- Start Menu shortcut: enabled
- Shortcut name: `What About It Studio`
- Update source: GitHub Releases for `unpaidintern9/WhatAboutIt`
- Update channel: prerelease builds produced from verified `main`

## In-App Update Flow

Open **Settings → App updates** and choose **Check for updates**. When a newer verified release exists, the app shows **Download update**, reports progress, and then offers **Restart and install**.

Development launches intentionally disable the updater. Update checks only run in the packaged application, and they never modify episode folders.

## Icon Status

A final production `.ico` file is not yet available in the project. The installer currently uses Electron Builder's default icon behavior. Before public beta, add an approved branded Windows icon and wire it into the Electron Builder `win.icon` setting.

## Installed App Paths

Packaged builds use Electron's per-user app data folder:

```text
%APPDATA%\What About It Studio
```

Expected installed data layout:

```text
What About It Studio/
  settings.json
  episodes/
  logs/
  diagnostics/
```

Development builds continue to use:

```text
Documents/WhatAboutItStudioData
```

This keeps existing Phase 8A and Phase 8B development workflows stable while packaged builds avoid source repo paths.

## First-Run Flow

On first launch, the beta welcome screen prompts Morgan to run Hardware Test Mode first. The first-run screen keeps the choices simple:

- Run Hardware Test
- Start with Home
- Remind Me Later
- Never Show Again

Hardware Test Mode confirms camera, microphone, test recording, export, storage, and diagnostics readiness.

## Installer QA Checklist

Use this checklist for every Windows beta installer candidate:

- Fresh install completes.
- Desktop shortcut launches `What About It Studio`.
- Start Menu shortcut launches `What About It Studio`.
- First-run screen appears on a clean profile.
- Hardware Test Mode is reachable immediately.
- Real camera and mic test runs.
- Test recording exports to MP4.
- Diagnostics folder exports and contains expected files.
- Diagnostics include app data paths.
- Diagnostics do not include raw media or secrets.
- Uninstall completes.
- Reinstall launches.
- Preferences restore or show `Needs Attention` if saved devices are missing.

## Current Manual Status

Status: Passed for local Windows beta installer creation and installed-app smoke testing on June 27, 2026.

Validated installer artifact:

```text
app/release/What About It Studio-0.1.0-Windows.exe
```

Validated installed app path:

```text
C:\Users\mmcga\AppData\Local\Programs\what-about-it-studio\What About It Studio.exe
```

Validated packaged data root:

```text
C:\Users\mmcga\AppData\Roaming\What About It Studio
```

Manual QA results:

- `npm run installer:win` completed and produced the NSIS installer.
- Desktop shortcut was created and launched the installed app.
- Start Menu shortcut was created and launched the installed app.
- First-run screen appeared and routed directly to Hardware Test Mode.
- Hardware Test Mode recorded a 30-second real camera/mic test.
- The installed app exported a playable MP4 validated by ffprobe.
- Diagnostics exported under `%APPDATA%\What About It Studio\diagnostics`.
- Diagnostics included packaged path information and did not include raw media files.
- Uninstall completed silently.
- Reinstall completed silently and launched successfully.

Remaining beta polish:

- Add a final approved branded `.ico` file. Electron Builder currently falls back to the default icon.
- Add final package author metadata before public distribution.
- Run the installer on a separate clean Windows machine.
- Decide whether uninstall should preserve or remove `%APPDATA%\What About It Studio`; the current silent uninstall removed settings/app data, so reinstall starts fresh.
