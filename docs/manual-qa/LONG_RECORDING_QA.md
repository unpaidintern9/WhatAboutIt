# Long Recording QA

Phase 8D run: June 28, 2026.

## Hardware

- Camera 1: `Sony Camera (Imaging Edge)`.
- Camera 2: `Integrated Camera (13d3:540a)`.
- Camera 3: not connected; Record screen showed `Not Connected` / `Needs Attention`.
- Mic: `Default - Microphone (Realtek(R) Audio)`.
- Output: `Default - Speakers (Realtek(R) Audio)`.

## Audio Monitoring

| Check | Result | Evidence |
| --- | --- | --- |
| Output device selection | Pass after fix | `Play Test Sound` now routes through a sink-aware `Audio` element and uses `setSinkId` when the selected output supports it. |
| Play Test Sound audible | Pending human confirmation | The app reported `Test sound played. Pick headphones if you didn't hear it.` Automation cannot independently hear the selected speaker/headphone output. |
| Monitor Mic through headphones | Pending human confirmation | Monitor toggled on/off and targets the selected output; automation cannot independently confirm headphone audibility/no echo. |
| Feedback warning without headphones | Pass | The Record screen showed `Use headphones so the mic doesn't echo.` when monitoring controls were exercised. |

## 30-Minute Stability Test

| Check | Result | Evidence |
| --- | --- | --- |
| Camera preview stays live | Pass | Camera 1 and Camera 2 still showed `Live` at `00:30:33`. |
| Mic meters stay active | Partial | Mic meter components stayed mounted; room was quiet during the long run, so meters showed `We can't hear you yet`. |
| Recording timer accuracy | Pass with defect found | Timer reached `00:30:33`; MediaRecorder output duration validated at `00:30:28.869`. |
| Stop saves media | Pass after fix/recovery | Stop exposed a long-run hang when the recorder was already `inactive`; source now resolves inactive recorders and keeps bytes as `Uint8Array`. The real buffered WebM was recovered and saved. |
| Output file valid | Pass | `Program/program.webm` ffprobe: WebM, VP9 1024x576, Opus mono, probe score 100, 257,607,059 bytes. |
| Extracted audio valid | Pass | `Audio/morgan-mic.m4a` ffprobe duration `1828.869000`, AAC mono 48 kHz, 28,355,460 bytes. |
| Review Episode opens | Pass | Review Episode opened from the patched app after the recovered session was marked stopped. |
| Export completes | Pass after fix | Export button was not firing because it relied on a fragile ref listener; it now uses normal `onClick`. The patched app exported successfully. |
| Exported MP4 duration | Pass | `Exports/what-about-it-full-episode-video.mp4` duration `1828.869000` (`00:30:28.869`). |
| Audio/video sync | Pass | Exported video duration `1828.800000`, audio duration `1828.869000`; difference about 69 ms. |
| App crash | Pass | App stayed open through the long run. The stop/save path hung before the fix, but the process did not crash. |

## Files

- Episode folder: `C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudioData\episodes\2026-06-28-long-recording-qa-30-minute-2026-06-28t17-15-30--ef95424d`
- Program: `Program\program.webm`, 257,607,059 bytes.
- Camera mirror: `Cameras\camera-1.webm`, 257,607,059 bytes.
- Extracted mic: `Audio\morgan-mic.m4a`, 28,355,460 bytes.
- Export: `Exports\what-about-it-full-episode-video.mp4`, 33,013,463 bytes.

## Resource Notes

- Around the 10-minute checkpoint, Electron processes were using about 318 MB, 171 MB, 180 MB, 96 MB, and smaller helper-process private memory values; the app remained responsive.
- After export, C: reported 430,955,581,440 bytes free and 78,765,019,136 bytes used.
- After export, Electron helper processes were still below about 141 MB private memory each, with the visible app process around 70 MB private memory.
- Media footprint for this long QA episode after recovery/export is about 576 MB across Program, Cameras, Audio, and Exports.

## 60-Minute Test

Not run in this pass. The 30-minute test exposed real stop/save and export-button defects that required fixes and recovery. A 60-minute rerun should be performed after these fixes are committed and built.

## Fixes Applied During QA

- `app/src/renderer/plugins/devices/browser-device-plugin.ts`: routes Play Test Sound through the selected output device when `setSinkId` is available.
- `app/src/renderer/plugins/recording/browser-media-recorder-plugin.ts`: resolves `stop()` when `MediaRecorder.state` is already `inactive` and returns `Uint8Array` bytes instead of building a huge `number[]`.
- `app/src/main/preload.ts`, `app/src/main/main.ts`, and `app/src/renderer/vite-env.d.ts`: pass recording bytes through IPC as `Uint8Array`.
- `app/src/renderer/components/ExportEpisode.tsx`: starts export with a normal `onClick` handler.
