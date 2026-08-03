# Auto Edit Architecture

Auto Edit creates a non-destructive first draft from the media saved inside one episode folder. Manual Edit and Auto Edit share the same `Session/draft-timeline.json`, so the user can change any automatic decision before export.

## Current Pipeline

1. Load the Program, camera, and microphone inventory for the episode.
2. Read Camera 1/2/3 microphone routes from `Session/device-map.json`.
3. Analyze the saved routed microphone files with FFmpeg loudness measurements.
4. Choose the camera routed to the strongest sustained microphone activity.
5. Write explainable camera decisions into the draft timeline.
6. Present the decisions for manual review.
7. Render the approved camera plan and included microphone tracks during export.

If separate routed microphone files are unavailable, Auto Edit keeps the Program camera and says why. It does not invent speaker activity.

## Manual Editing

The Review screen exposes each saved source as its own non-destructive track:

- Program
- Camera 1, Camera 2, and Camera 3
- Morgan Mic, Guest Mic, and Extra Mic

The user can select one source, trim it, split it, cut a section, include or exclude it from the episode, and set microphone level. Camera decisions choose which saved camera is used from a selected point. Program edits apply to the combined episode.

## Export

The full-episode export renders the draft when it contains source edits, source mix changes, or camera decisions. It assembles selected camera sections, mixes included microphone tracks, applies per-track level and mute ranges, and writes a playable H.264/AAC MP4. The Program recording remains the fallback when a selected sidecar is missing.

Original media is never modified. Camera masters with their assigned microphones remain separate export artifacts when those source files are available.

## Current Limits

- Automatic camera selection uses routed microphone loudness, not face tracking or transcript speaker identification.
- Automatic silence removal is not applied yet. Auto Edit keeps timing intact until real cut decisions are available and approved.
- Complex transitions, color grading, clip dragging, plug-in effects, and keyframes are not implemented.
- Camera and microphone sync still depends on the timestamps and duration of the captured sidecars.

## Non-Negotiables

- Original media is never modified.
- Every camera decision has a visible reason.
- Missing source media falls back truthfully.
- Every stage remains independently testable.
