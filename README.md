# What About It? Studio

What About It? Studio is an offline-first desktop app for Morgan's podcast workflow.

BLUF: Morgan opens the app, clicks New Episode, records up to 3 cameras and multiple mics, presses Auto Edit, reviews suggested edits, and exports the finished podcast. OBS, FFmpeg, MLT, whisper.cpp, OpenCV, Essentia, and auto-editor stay hidden behind the scenes.

## Project Rules

- No fake people photos.
- No generated Morgan or guest photos.
- Use branded placeholders, typography, color, icons, textures, and empty camera preview boxes.
- Stay offline-first.
- Store repos and source dependencies inside this folder.
- Build Phase 1 before touching Phase 2 device detection.

## Current Scope

Phase 1 only: branded offline shell, local project folders, metadata JSON, recent episodes, settings, Learn Studio placeholder, Practice Mode placeholder, and a Theme Engine scaffold.

## Folder Map

- `app/`: Electron and React desktop app scaffold.
- `external-repos/`: Shallow local clones of media engine dependencies.
- `agents/`: Specialist agent contracts.
- `skills/`: Project skills and operating instructions.
- `docs/`: Planning, architecture, brand, offline, and roadmap docs.
- `assets/`: Branding and placeholder assets only.
- `research/`: Notes and investigations.
- `scripts/`: Utility scripts.

## Dependency Repos

See `docs/REPO_DEPENDENCIES.md`.

