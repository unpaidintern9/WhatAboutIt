# Multi-Monitor Studio Workspace

What About It? Studio keeps the main recording window focused on live cameras, the audio mixer, and record controls. Studio tools can move to floating windows so a second or third monitor can hold the teleprompter, soundboard, notes, markers, or diagnostics.

## Display Detection

The desktop app reads connected displays through Electron and records:

- Number of monitors
- Primary display
- Resolution
- Work area
- Scaling

The Studio UI uses simple actions such as:

- Move Teleprompter to Monitor 2
- Move Soundboard to Monitor 2

If only one display is available, tools can still pop out and be moved manually.

## Workspace Settings

Settings includes a Studio Workspace section with:

- Remember window positions
- Launch with saved layout
- Default monitor
- Reset layout

Window position, size, monitor, collapsed state, and fullscreen state are saved locally in the app data folder.

## Recording Safety

Pop-out windows do not redesign or replace the recording engine. The main Studio keeps recording while tool windows open, move, close, or return to Studio.

## Supported Panels

Supported now:

- Teleprompter
- Soundboard
- Guest Notes
- Episode Notes
- Marker List
- Studio Diagnostics

Planned later:

- Timeline
- Review
- Export Queue
- Auto Edit Progress
