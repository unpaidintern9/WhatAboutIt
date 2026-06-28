# Live Studio Hardware QA

Run this checklist with the real recording setup connected.

## Camera

- Open Studio Setup and select Camera 1, Camera 2, and Camera 3 where available.
- Open Record.
- Confirm each selected camera shows live motion.
- Confirm unavailable cameras show Needs Attention or Not Connected.
- Confirm the gear buttons are visible and do not claim a setting was changed.

## Audio

- Select Morgan Mic and the intended headphones/output.
- Confirm Morgan Mic meter moves while speaking.
- Toggle Monitor Mic on while wearing headphones.
- Confirm the warning says: `Use headphones so the mic doesn't echo.`
- Confirm Play Test Sound is audible.

## Recording

- Press Record.
- Confirm status changes to Recording Live.
- Confirm the timer runs.
- Confirm the saving location appears.
- Press Pause and Resume if supported by the browser recorder.
- Press Stop.
- Confirm Review Episode opens and the saved draft contains markers made during recording.

## Save Validation

- Inspect the session folder.
- Confirm the saved program recording exists.
- Run ffprobe validation where available through the existing recording/export validation path.

## Current Result

Not yet run for this Phase 8B UI pass in this coding session. Hardware QA must be completed before this is called production-ready.
