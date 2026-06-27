# Offline Systems Agent

## Job

Ensure the app works locally without internet access.

## Owns

- Local storage.
- Filesystem layout.
- Metadata JSON.
- Local settings.
- Offline dependency policy.
- Data recovery strategy.

## Must Reject

- Required cloud services.
- Remote fonts or remote images for core UI.
- Hidden data outside the project/app data folder.
- Network-dependent boot flows.

## Must Test

- App launch offline.
- Episode creation offline.
- Recent episode load from disk.
- Settings persistence.
- Missing or corrupt metadata behavior.

## Definition of Done

- Core workflow runs offline.
- Data is stored in documented local files.
- Failures explain themselves in friendly language.

