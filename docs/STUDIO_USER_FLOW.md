# Studio User Flow

Phase: 9E Real Studio Usability Pass

Status: implemented.

## Beginner Path

Studio Setup now guides a non-technical user through:

- Pick Camera 1
- Pick Camera 2
- Pick Camera 3
- Pick Morgan Mic
- Test Mic
- Go Record

The top of Studio Setup is compact: readiness, the four setup steps, and a collapsed checklist sit directly above the current hardware panel. The bottom has one primary action: `Go to Record`.

## Record Screen Order

The first Record screen stack is:

- Live camera previews
- Mic meters
- Readiness strip
- Studio Ready summary
- Record/Pause/Stop controls directly after the camera wall

Notes, teleprompter, markers, soundboard, and camera layout controls remain available as secondary tools.

Each microphone strip keeps input, interface channel, voice polish, volume, mute, solo, and monitoring together. Notes, markers, teleprompter, and soundboard remain secondary to the camera and recording path.

## Workflow Confidence

- The branded sidebar remains visible while the current workspace scrolls. New installs begin with the compact rail; an explicit expanded/collapsed preference is preserved.
- Completing or closing the first-run guide persists the choice instead of reopening the same guide on every launch.
- The top `Studio Setup -> Record -> Review -> Export` path is clickable and reflects real completion state.
- Review and Export remain unavailable until recorded media exists and explain why on hover.
- Recent episode rows reopen the real Review workspace instead of acting like dead cards.
- Record shows `Starting` while the capture service opens all ready sources, and Stop shows `Saving` until camera and microphone files finish.
- Edit Studio saves the approved draft before moving to Export.
- Export identifies Prepare, Mix Sources, Build Video, Verify File, and Done stages, then offers Open Folder, Back to Review, and Finish.

## Edit Flow

- Click a track to move the playhead.
- Drag across a track to select a real edit range.
- Choose Split and click a track, or double-click with Select, to cut at that moment.
- Drag a recorded camera source or camera timeline clip onto Program to switch cameras at the drop time.
- Zoom and snapping keep longer episodes manageable without changing source files.
- Undo, redo, draft status, Save draft, and Save & Export remain visible around the timeline.

These gestures update the same non-destructive draft consumed by export. General clip reordering and ripple rearrangement are not claimed.

## Helpful States

The studio uses plain language:

- `Pick a camera first`
- `Camera is being used by another app`
- `We need permission`
- `We can't hear you yet`
- `Use headphones to hear yourself safely`

## Guardrails

This workflow pass did not change camera discovery, Sony preview handling, codec behavior, or long-recording behavior. It used automated focused tests only.
