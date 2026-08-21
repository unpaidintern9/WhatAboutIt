# Release Process

Windows release packaging and in-app updates are active. Every verified app change merged to `main` starts the Windows release workflow.

## Automated Main Release

`.github/workflows/release-main.yml` runs on Windows and:

1. Installs the locked dependencies.
2. Runs `npm run verify`.
3. Gives the build a monotonically newer `0.2.<run number>` version.
4. Builds the NSIS installer and Electron update metadata.
5. Publishes them as a GitHub prerelease.

The installed app exposes **Settings → Check for updates**. Morgan can check, download, and restart to install without using Git or replacing her episode files.

Use `workflow_dispatch` to rerun the release manually when needed.

## Supported Targets Prepared

- Windows NSIS
- macOS DMG
- Linux AppImage

## Release Rules

- No telemetry.
- No cloud reporting.
- Local logs only.
- Dependency licenses must be reviewed before distribution.
- A failed verification job must never publish an update.
- Episode recordings and settings remain outside the installed application and are not replaced by updates.
- Public distribution still requires a trusted Windows code-signing certificate.

## Windows Signing Cutover

The release workflow is signing-ready without interrupting internal beta updates:

1. Add the base64-encoded P12 certificate as the `WINDOWS_CERTIFICATE_P12_BASE64` repository secret.
2. Add its password as `WINDOWS_CERTIFICATE_PASSWORD`.
3. Run the release workflow and confirm the Authenticode verification step reports `Valid`.
4. Set the repository variable `REQUIRE_WINDOWS_SIGNING=true` so future unsigned releases fail before publication.

Until that variable is enabled, unsigned internal builds produce an explicit workflow warning instead of being mistaken for public-distribution-ready installers.
