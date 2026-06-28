# Media Flow QA

Date: 2026-06-28

## Automated Phase 9F Checks

Passed:

- Managed camera/mic streams release through `DeviceService.releaseAll()`.
- Duplicate mic streams are stopped before a replacement opens.
- Recording service shutdown calls the recorder shutdown hook.
- Per-mic monitoring controls render clear On/Off states.
- Review loads real program, camera, and audio files from an episode folder.
- Review marks missing media truthfully.
- Export fails when `Program/program.webm` is missing.
- Export succeeds from real `Program/program.webm`.
- Export summary matches the output state.
- Edited draft export states that draft rendering comes next.

## Phase 9G Focused Real Hardware QA

Run date: 2026-06-28
Installed app: `C:\Users\mmcga\AppData\Local\Programs\what-about-it-studio\What About It Studio.exe`

Hardware observed in the installed app:

- `Sony Camera (Imaging Edge)`
- `Integrated Camera (13d3:540a)`
- Morgan mic channel mapped to the available local microphone path.
- Guest and Extra mic channels rendered, but only Morgan Mic produced a saved audio file in this run.
- Output device shown as `Speakers (3- AudioBox USB 96)`.

### App/device cleanup

Result: Partial.

- Studio Setup showed Sony Camera and Integrated Camera as detected devices.
- A stale/busy launch state showed both cameras as `Camera is being used by another app.` while previous installed-app processes were still present.
- After stopping only `What About It Studio` processes and relaunching one visible session, Sony and Integrated both returned to `Live`.
- Final physical camera/mic LED release was not independently observable through automation.

### Studio Setup live preview

Result: Pass.

- Camera 1 showed `Live`, `Camera 1 is showing live`, and `Sony Camera (Imaging Edge)`.
- Camera 2 showed `Live`, `Camera 2 is showing live`, and `Integrated Camera (13d3:540a)`.
- Camera 3 truthfully stayed unselected with `Pick a camera first`.

### Per-mic monitoring

Result: Partial.

- Mixer rendered per-channel controls for Morgan, Guest, Extra, Soundboard, and Music.
- Morgan `More` exposed Gain, Mute, Solo, and `Hear Morgan Off`.
- `Hear Morgan` toggled On and Off.
- Morgan Mute changed the channel to `Muted` and dropped the meter to 0%.
- Guest `More` exposed Gain, Mute, Solo, and `Hear Guest Off`; `Hear Guest` toggled during the run.
- Monitoring defaulted back Off after leaving/reopening the flow.
- Headphone audibility/no-feedback was not independently confirmable through automation.

### Recording

Result: Pass for the current one-camera/one-mic recorder.

- Record screen showed Sony and Integrated live previews before recording.
- Readiness strip showed `Cameras Ready`, `Microphones Ready`, `Storage Available`, and `Recording Healthy`.
- Recording started from the sticky controls.
- Timer advanced to `00:00:44`, satisfying the requested 30-second recording test.
- App showed `Recording. Saving. Auto Save on.` with session folder:
  `C:\Users\mmcga\AppData\Roaming\What About It Studio\episodes\2026-06-28-studio-recording-94ac2f9c`
- Stop opened Review Episode.

Saved files from this run:

- `Program\program.webm`, 1,630,619 bytes.
- `Cameras\camera-1.webm`, 1,630,619 bytes.
- `Audio\morgan-mic.m4a`, 140,940 bytes.
- `Cameras\camera-2.webm`, `Audio\guest-mic.m4a`, and `Audio\extra-mic.m4a` were not produced.

### Review playback

Result: Partial.

- Review opened automatically after Stop.
- Program video player rendered and displayed the Sony Imaging Edge preview frame.
- Morgan Mic audio player rendered and showed `0:00 / 0:54`.
- Camera 1 card appeared with `Cameras\camera-1.webm`, `vp9`, `1024x576`.
- Missing Camera 2, Camera 3, Guest Mic, and Extra Mic showed friendly `Not recorded in this episode` states.
- Bug found: WebM duration displayed as `00:00:00` in Review because ffprobe did not expose embedded WebM duration for this browser recording. Fixed in `app/src/main/review-media-store.ts` by falling back to `Session\recording-state.json` elapsed time when probe duration is unavailable.

ffprobe validation:

- `Program\program.webm`: VP9 video, 1024x576, Opus mono audio, 48 kHz.
- `Cameras\camera-1.webm`: VP9 video, 1024x576, Opus mono audio, 48 kHz.
- `Audio\morgan-mic.m4a`: AAC mono audio, 48 kHz, duration `54.724000`.

### Export

Result: Pass.

- Export screen opened from Review.
- Standard `Full Episode Video` export completed in the installed app.
- Fresh output:
  `Exports\what-about-it-full-episode-video.mp4`
- ffprobe result: MP4, H.264 video, AAC mono audio, 1024x576, 30 fps, duration `54.724000`, size 288,677 bytes.
- ffmpeg decode smoke passed for both one video frame and one second of audio.

### UI cleanup notes

- Review now truthfully shows missing secondary camera/mic files, but that makes the current one-camera/one-mic recording limitation visible when Camera 2 was live.
- The per-channel mixer controls work, but at this viewport the expanded channel controls are cramped near the bottom of the visible area.
- Audible test sound and headphone monitoring still require a human listener confirmation.

## Current Status

The focused Phase 9G real hardware loop passed for Sony/Integrated live preview, Morgan mic capture, real recording, Review handoff, and MP4 export validation. Beta remains blocked for simultaneous multi-camera/multi-mic recording and human-confirmed audio monitoring.
