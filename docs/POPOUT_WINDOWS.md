# Pop-Out Windows

Pop-out windows let major Studio panels live outside the main recording window.

## Controls

Each supported panel includes:

- Pop Out
- Return to Studio
- Move to Monitor 2 when another display is available

Floating windows keep the active theme, vintage typography, ripped-paper panel styling, and What About It? branding.

## Teleprompter

The teleprompter supports:

- Second or third monitor placement
- Fullscreen
- Mirror mode
- Dark mode
- Font controls
- Scroll speed
- Remote pause
- Remote resume
- Last monitor restore

When it is popped out, recording continues in the main Studio window.

## Soundboard

The soundboard supports:

- Second monitor placement
- Touch-friendly large buttons
- Categories
- Search
- Hotkey labels
- Currently playing indicator
- Volume

The soundboard does not need to stay inside the main Studio view.

## Notes, Markers, and Diagnostics

Guest Notes, Episode Notes, Marker List, and Studio Diagnostics can also pop out. They use the same podcast tool state as the embedded Studio panels, so edits continue saving locally.

## Developer Notes

The reusable window manager lives in the Electron main process and handles display detection, BrowserWindow creation, panel restore, monitor assignment, layout restore, and reset.
