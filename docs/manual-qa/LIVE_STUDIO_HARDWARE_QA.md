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

Phase 8C hardware QA was run on June 28, 2026 from the built Electron app with real camera and microphone permission granted.

## Phase 8C Hardware

- Camera 1: `Sony Camera (Imaging Edge)`.
- Camera 2: `Integrated Camera (13d3:540a)`.
- Camera 3: not connected; the live studio showed `Not Connected` / `Needs Attention`.
- Morgan Mic: `Default - Microphone (Realtek(R) Audio)`.
- Guest Mic: `Communications - Microphone (Realtek(R) Audio)`.
- Headset Mic: `Microphone (Realtek(R) Audio)`.
- Output: `Default - Speakers (Realtek(R) Audio)`.

## Phase 8C Results

| Check | Result | Evidence |
| --- | --- | --- |
| Live camera preview | Pass | Camera 1 and Camera 2 both rendered live preview streams on the Record screen. |
| Camera disconnected/not connected state | Partial | Camera 3 showed `Not Connected` and `Needs Attention`; physical unplug/replug was not performed. |
| Mic meter movement | Pass | Realtek mic meters showed `We hear you` during the 30-second pass. |
| Mic quiet/muted state | Pass | During a quiet room section of the 5-minute pass, mic cards showed `We can't hear you yet`. |
| Test sound | Partial | `Play Test Sound` action completed without app error; audible confirmation was not independently captured in automation. |
| Mic monitoring | Partial | Monitor toggled on/off and showed the headphone warning; headphone audio quality/no-echo was not independently captured in automation. |
| Feedback loop warning | Pass | The UI showed `Use headphones so the mic doesn't echo.` |
| 30-second recording | Pass | Timer reached `00:00:31`; Stop saved media and opened Review Episode. |
| Pause/Resume | Pass | Pause held at `00:00:11`; Resume continued to `00:00:31`. |
| 5-minute recording | Pass | Timer reached `00:05:14`; Stop saved media and opened Review Episode. |
| Review Episode handoff | Pass | Both recordings routed to Review Episode after Stop. |
| Export from recorded file | Pass after fix | 30-second and 5-minute recorded files exported to playable MP4. |
| ffprobe validation | Pass | 30-second export duration `32.074833`; 5-minute export duration `315.674000`. |

## Phase 8C Evidence

30-second episode:

- Folder: `C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudioData\episodes\2026-06-28-live-studio-hardware-qa-2026-06-28t16-00-40-400z-19d954ac`
- Program: `Program\program.webm`, 1,072,330 bytes, VP9 video 1024x576, Opus mono audio.
- Extracted mic: `Audio\morgan-mic.m4a`, 666,882 bytes.
- Export: `Exports\what-about-it-full-episode-video.mp4`, 2,598,657 bytes, H.264 video, AAC mono audio, duration `32.074833`.
- App log: `RecordingService` saved and validated the program recording; `ExportService` created a playable local export.

5-minute episode:

- Folder: `C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudioData\episodes\2026-06-28-live-studio-hardware-qa-5-minute-2026-06-28t16-0-21b8f995`
- Program: `Program\program.webm`, 10,348,958 bytes, VP9 video 1024x576, Opus mono audio.
- Extracted mic: `Audio\morgan-mic.m4a`, 6,364,973 bytes.
- Export: `Exports\what-about-it-full-episode-video.mp4`, 7,171,526 bytes, H.264 video 1024x576 at 30 fps, AAC mono audio, duration `315.674000`.
- App log: `RecordingService` saved and validated the program recording; `ExportService` created a playable local export.

## Fix Applied During QA

The first 5-minute export attempt exposed a real issue: browser-recorded WebM reported a 1000 fps video rate, which made FFmpeg duplicate hundreds of thousands of frames and run too long. `app/src/main/export-store.ts` now caps video exports to 30 fps for full-episode and archive video outputs. The corrected 5-minute export completed and validated with ffprobe.
