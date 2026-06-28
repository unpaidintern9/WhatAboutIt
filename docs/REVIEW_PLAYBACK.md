# Review Playback

Phase 9F makes Review Episode load actual media from the episode folder.

## Loaded Paths

- `Program/program.webm`
- `Cameras/camera-1.webm`
- `Cameras/camera-2.webm`
- `Cameras/camera-3.webm`
- `Audio/morgan-mic.m4a`
- `Audio/guest-mic.m4a`
- `Audio/extra-mic.m4a`

## What Works

- Review shows `Review your recording`.
- Program video renders a real browser `video` player when `Program/program.webm` exists.
- Camera files and audio files appear in one place with duration and codec metadata from ffprobe.
- Audio files render real browser audio preview controls when present.
- Missing files say `Not recorded in this episode`.
- Original files are described as safe.
- Draft edits remain non-destructive.

## Truthful Limits

- If a file exists but cannot be probed or played by the browser, Review marks it as needing a review proxy.
- Automatic proxy generation is identified but not implemented in this pass.
- Draft trim/split/cut changes do not alter the playable video yet. The UI says `Draft saved. Preview rendering comes next.`
