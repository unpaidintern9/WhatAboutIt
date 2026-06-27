# Architecture

## App

Electron hosts the offline desktop application. React renders the interface. The main process owns local filesystem actions; the renderer asks through a small IPC bridge.

## Phase 1 Boundaries

Implemented:

- App shell.
- Local episode metadata.
- Recent episodes.
- Settings placeholder.
- Learn Studio placeholder.
- Practice Mode placeholder.
- Theme Engine scaffold.
- Built-in theme files.
- Visual Theme Editor placeholder.

Not implemented:

- Device detection.
- Live camera previews.
- Mic capture.
- OBS/libobs control.
- Recording.
- Timeline processing.
- Export processing.
- Auto Edit execution.

## Theme Engine

Theme JSON files define visual tokens for colors, typography, branding, textures, and component behavior. Renderer styles consume CSS custom properties generated from the active theme.

Later phases should add:

- Theme validation.
- Visual Theme Editor persistence.
- Import/export/share theme flows.
- Brand Guardian visual review reports.

