# Auto Edit Architecture

Auto Edit creates a non-destructive first draft from the media saved inside one episode folder. Manual Edit and Auto Edit share the same `Session/draft-timeline.json`, so the user can change any automatic decision before export.

## Current Pipeline

1. Load the Program, camera, and microphone inventory for the episode.
2. Read Camera 1/2/3 microphone routes from `Session/device-map.json`.
3. Analyze the saved routed microphone files with FFmpeg loudness measurements.
4. Choose the camera routed to the strongest sustained microphone activity.
5. Apply a mode-specific, conservative production profile to every saved microphone and camera track.
6. Blend in the locally learned production profile from explicitly saved Manual Edit drafts.
7. Enforce a mode/profile camera hold interval so short activity spikes do not cause rapid cuts.
8. Write explainable camera decisions and transition choices into the draft timeline.
9. Present every automatic setting and decision for manual review.
10. Render the approved camera plan and included microphone tracks during export.

If separate routed microphone files are unavailable, Auto Edit keeps the Program camera and says why. It does not invent speaker activity.

## Manual Editing

The Review screen exposes each saved source as its own non-destructive track:

- Program
- Camera 1, Camera 2, and Camera 3
- Morgan Mic, Guest Mic, and Extra Mic

The user can select one source, set an exact In/Out range, trim it, split it, remove a section, and include or exclude it from the episode. Camera tracks add fit/fill framing, zoom and position, brightness, contrast, saturation, temperature, tint, denoise, sharpening, sync nudge, and clean-cut or soft-fade camera changes. Microphone tracks add mute, solo, level, pan, fades, sync nudge, noise cleanup, gate, de-essing, compression, three-band tone, voice profiles, and output limiting. Camera decisions choose which saved camera is used from a selected point. Program edits apply to the combined episode.

Auto Edit writes the same controls used by Manual Edit. Gentle, Balanced, Fast Paced, and Clip Hunter select different conservative voice, picture, and transition profiles; users can then change any individual value before export. Auto Edit does not hide a second effect system behind the manual editor.

When a user explicitly saves a Manual Edit draft, the app updates a local production profile in Studio settings. It averages approved microphone cleanup/tone/dynamics, camera framing/finishing, transition style, and observed camera hold time across saved drafts. Auto Edit reports whether that profile was used. Unsaved changes and Auto Edit drafts do not train the profile.

## Export

The full-episode export renders the draft when it contains source edits, source mix changes, production treatment, transitions, or camera decisions. It assembles selected camera sections, mixes included microphone tracks, applies the per-track controls, loudness-normalizes the finished mix, and writes a playable H.264/AAC MP4. The Program recording remains the fallback when a selected sidecar is missing.

Original media is never modified. Camera masters with their assigned microphones, edited 24-bit microphone stems, and an edit decision list remain separate export artifacts when those source files are available.

## Current Limits

- Automatic camera selection uses routed microphone loudness, not face tracking or transcript speaker identification.
- Learning is local numeric preference learning from approved controls; it is not a cloud model and does not infer intent from unapproved edits.
- Automatic silence removal is not applied yet. Auto Edit keeps timing intact until real cut decisions are available and approved.
- The current de-ess control uses a focused high-frequency reduction because the bundled FFmpeg build does not include a dedicated spectral de-esser.
- Advanced color curves, masks, clip dragging, automation keyframes, motion graphics, transcript editing, and third-party VST hosting are not implemented.
- Camera and microphone sync still depends on the timestamps and duration of the captured sidecars.

## Non-Negotiables

- Original media is never modified.
- Every camera decision has a visible reason.
- Missing source media falls back truthfully.
- Every stage remains independently testable.
