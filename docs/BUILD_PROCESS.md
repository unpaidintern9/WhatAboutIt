# Build Process

## Build Command

```bash
npm run build
```

This runs:

- Clean previous `dist/`.
- Compile Electron main and preload code.
- Build the React renderer through Vite.

## Desktop Launch

```bash
cd app
npm run start
```

`npm run start` builds the app and launches Electron.

## Packaging Prep

Packaging config is prepared through `electron-builder` for:

- Windows
- macOS
- Linux

Phase 1.75 prepares packaging configuration only. It does not create release artifacts as part of verification.

