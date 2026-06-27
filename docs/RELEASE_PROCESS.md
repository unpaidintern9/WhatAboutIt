# Release Process

Release packaging is not active yet.

## Future Release Steps

1. Run `npm run verify`.
2. Run `npm run build`.
3. Run packaging for the target operating system.
4. Smoke-test the packaged app offline.
5. Confirm Brand Guardian approval.
6. Archive build logs locally.

## Supported Targets Prepared

- Windows NSIS
- macOS DMG
- Linux AppImage

## Release Rules

- No telemetry.
- No cloud reporting.
- Local logs only.
- Dependency licenses must be reviewed before distribution.

