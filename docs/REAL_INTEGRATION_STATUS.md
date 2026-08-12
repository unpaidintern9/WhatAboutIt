# Real Integration Status

This document records the current status of production media integrations after the Phase 7 audit.

## Application Subsystems

| Area | Current implementation | Production ready | Missing work |
| --- | --- | --- | --- |
| Recording | Browser `MediaRecorder` Program path plus Phase 9I sidecar camera/mic recorders with ffprobe validation after save; active preview streams are reused for synchronous multi-camera start; live recorder health reports Program and active sidecar counts | Partial | M-Audio physical routing confirmation, Camera 3/Extra Mic physical validation, clean 60-minute pass, sync/drift validation |
| Camera capture | Physical Sony Camera via Imaging Edge and Integrated Camera previews validated; Phase 9I saved separate Camera 1 and Camera 2 WebM files | Partial | Camera 3 physical validation, capture cards, backend error handling, physical unplug/replug validation |
| Microphone capture | Physical microphone capture validated; Phase 9I saved separate Morgan and Guest M4A files; every browser-visible Windows input is preserved, laptop mics use automatic mono routing, interfaces expose Inputs 1-16, and capture retries the same device with simpler constraints when optional quality preferences are rejected | Partial | M-Audio AudioBox and other multichannel routes need physical validation, exact second-mic hardware identity confirmation, Extra Mic physical validation, drift and clipping reporting |
| Timeline review | Draft timeline JSON plus real Review media inventory for Program, Cameras, and Audio files with ffprobe durations, recording-state duration fallback, browser playback, click scrubbing, drag range selection, split placement, zoom, and snapping | Partial | Review proxy generation for non-browser-playable files and render-accurate edit preview |
| Editing | Non-destructive per-source timeline with cuts, draggable camera-to-Program decisions, source mix, voice treatment, camera finishing, reusable treatment actions, and delivery mastering targets | Partial | Arbitrary clip reorder/ripple editing, automation keyframes, transcript editing, advanced color tools, and plug-in hosting |
| Export | Bundled FFmpeg/ffprobe rendering applies draft camera cuts, source mix, voice/camera treatment, transitions, and configurable loudness targets; output is decode-validated before success | Partial | Validate all presets from full-length real podcast media and broader hardware combinations |
| Auto Edit | Offline microphone activity analysis, camera routing decisions, mode-based production treatment, stable camera hold, and local learning from explicitly approved Manual Edit drafts | Partial | Transcript-backed structure, richer audio analysis, visual speaker evidence, and broader real-episode evaluation |
| Recovery | Session state foundation | Partial | Real interrupted recording validation and media recovery workflow |
| Packaging | Electron Builder config | Partial | Installable builds, clean-machine test, bundled media dependencies |
| Windows beta installer | NSIS installer built and installed locally; Desktop shortcut, Start Menu shortcut, first-run Hardware Test routing, packaged app data paths, MP4 export, diagnostics, uninstall, and reinstall were validated in Phase 8C | Partial | Final branded `.ico`, package author metadata, and separate clean-machine QA still needed |
| Desktop launcher | Windows shortcut script and installer shortcut config added in Phase 8A | Partial | Shortcut creation and launch validated; final branded `.ico` asset still needed |
| Real Hardware Test Mode | Guided Camera/Mic/Record/Export/Results flow plus Phase 8B live readiness dashboard, hot-plug refresh, saved preference handling, and diagnostics | Partial | One-camera/one-mic 30-second test passed in Phase 8B; physical unplug/replug and multi-camera validation still pending |

## Dependency Integration Audit

| Dependency | Present locally | Currently integrated | Production ready | Notes |
| --- | --- | --- | --- | --- |
| OBS Studio | Yes, `external-repos/obs-studio` | No | No | OBS control plugin exists but throws a not-connected error. No libobs or WebSocket bridge is wired into the app. |
| FFmpeg | Yes, `external-repos/FFmpeg`; bundled app binaries via `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` | Yes for export | Partial | Export uses bundled FFmpeg/ffprobe, writes playable local files, and validates output with ffprobe. The cloned FFmpeg source remains a reference dependency and is not built directly. |
| MLT Framework | Yes, `external-repos/mlt` | No | No | No production timeline/render integration is present. |
| auto-editor | Yes, `external-repos/auto-editor` | No | No | No application code invokes auto-editor for real media analysis or timeline generation. |
| whisper.cpp | Yes, `external-repos/whisper.cpp` | No | No | No local transcription backend is built or invoked. |
| OpenCV | Yes, `external-repos/opencv` | No | No | No camera/speaker/video analysis integration is present. |
| Essentia | Yes, `external-repos/essentia` | No | No | No audio feature extraction integration is present. |

## Files With Blocking Evidence

- `app/src/main/export-store.ts`: renders playable MP4, M4A, and MKV export outputs with FFmpeg and now requires `Program/program.webm` for non-practice exports.
- `app/src/main/ffmpeg-tools.ts`: detects bundled FFmpeg/ffprobe, runs media tools, and validates playable outputs.
- `app/src/main/recording-session-store.ts`: saves captured Program bytes, validates sidecar camera/audio tracks, transcodes mic sidecars to M4A, and updates sync metadata.
- `docs/manual-qa/PHYSICAL_RECORDING_QA.md`: documents the short physical camera/mic validation result.
- `app/src/shared/camera-config.ts`: preserves Camera 1/2/3 ordering, stores gear settings, and models Sony wireless support without assuming Bluetooth video.
- `app/src/renderer/plugins/cameras/sony-camera-provider.ts`: registers Sony USB, HDMI capture, wireless, remote-control, and future SDK provider slots.
- `docs/manual-qa/SONY_MULTI_CAMERA_QA.md`: documents that no physical Sony camera was detected during Phase 7C.
- `app/src/renderer/plugins/recording/obs-control-plugin.ts`: all recording methods throw `OBS recording engine is not connected yet.`
- `app/src/renderer/plugins/recording/browser-media-recorder-plugin.ts`: records one browser media stream where supported and now surfaces friendly camera/mic attention states.
- `app/src/shared/auto-edit.ts`: creates non-destructive camera/treatment suggestions, blends approved local production preferences, and enforces stable camera pacing.
- `app/src/main/auto-edit-store.ts`: analyzes saved microphone activity and persists the Auto Edit report and draft.
- `app/src/main/review-media-store.ts`: loads real Review media from Program, Cameras, and Audio folders and probes durations/codecs with ffprobe.
- `app/src/main/timeline-store.ts`: persists non-destructive draft JSON; `app/src/main/export-store.ts` applies supported cuts, camera decisions, source treatment, and mastering during render.
- `app/scripts/create-shortcut.mjs`: creates the local Windows desktop shortcut for development testing; validated at `C:\Users\mmcga\OneDrive\Desktop\What About It Studio.lnk`.
- `app/src/shared/hardware-test.ts`: models the real hardware test flow and Ready/Needs Attention result states without simulated success.
- `app/src/main/diagnostics-store.ts`: creates local diagnostics folders without raw media payloads.
- `docs/manual-qa/REAL_HARDWARE_TEST_MODE.md`: documents the validated 30.899-second Integrated Camera and Realtek microphone hardware test.
- `docs/PHASE_8B_HARDWARE_READINESS.md`: documents hot-plug, saved preference, safe stop, and diagnostics behavior.
- `docs/WINDOWS_BETA_INSTALLER.md`: documents Windows beta installer scripts, shortcuts, first-run flow, installed paths, and QA checklist.

## Integration Readiness Summary

The project now has partial real media integrations for offline FFmpeg export rendering, physically validated Program recording, and Phase 9I sidecar recording for available Camera 1/2 and Morgan/Guest mic channels. Phase 7C added a Sony-capable camera connection matrix and stable Camera 1/2/3 assignment logic, but no Sony wireless video was validated. Phase 8A added and validated a desktop launcher script plus a guided real hardware test mode. Phase 8B adds live readiness, hot-plug refresh handling, saved preference truthfulness, safe stop handling, and diagnostics export. Phase 8C built a Windows NSIS beta installer, validated installed Desktop and Start Menu shortcuts, confirmed first-run Hardware Test routing, confirmed packaged app data under `%APPDATA%\What About It Studio`, exported diagnostics from the installed app, and completed uninstall/reinstall smoke testing. Phase 8D validated a 30-minute real live-studio recording/export after finding and fixing long-run stop/save and Export button defects. Physical unplug/replug was not manually performed. The remaining production media work is clean long-run multi-track stability, Camera 3 and Extra Mic physical validation, exact mic identity confirmation, media-backed timeline playback, real Auto Edit analysis, recovery validation, clean-machine installer QA, final branded app icon, and final package author metadata.

## Phase 8B Live Studio Addendum

- `app/src/renderer/components/RecordingStudio.tsx` now attempts live camera previews from selected device ids with truthful Live, Needs Attention, and Not Connected states.
- The same screen now performs live Web Audio mic metering for selected microphone ids and keeps monitoring off by default.
- The big Record/Pause/Resume/Stop controls call the existing `RecordingService` and browser `MediaRecorder` path.
- Stop saves through the existing session path, creates a timeline draft, and routes to Review Episode.
- Auto Edit was not enhanced; the live studio only routes there after a recording exists.
- Export was not enhanced; the live studio only routes there after a recording/session exists.
- Soundboard slots do not fake playback. Empty slots show `Add a sound first`; local file playback is attempted only when a slot has a file path.
- Manual hardware QA for this exact UI pass is still required and is tracked in `docs/manual-qa/LIVE_STUDIO_HARDWARE_QA.md`.

## Phase 8C Live Studio Hardware QA Addendum

- Built Electron app was launched with real camera/mic permission.
- Detected live hardware: `Sony Camera (Imaging Edge)`, `Integrated Camera (13d3:540a)`, `Default - Microphone (Realtek(R) Audio)`, and `Default - Speakers (Realtek(R) Audio)`.
- Record screen showed Camera 1 and Camera 2 live previews. Camera 3 truthfully showed `Not Connected` / `Needs Attention`.
- 30-second real recording passed with Pause/Resume, Stop, Review Episode handoff, saved `Program\program.webm`, extracted `Audio\morgan-mic.m4a`, and playable MP4 export.
- 5-minute real recording passed with Stop, Review Episode handoff, saved `Program\program.webm`, extracted `Audio\morgan-mic.m4a`, and playable MP4 export.
- 5-minute export initially exposed a 1000 fps WebM metadata issue. `app/src/main/export-store.ts` now caps video exports to 30 fps; corrected 5-minute MP4 validates at 1024x576, 30 fps, H.264/AAC, duration `315.674000`.
- Test sound and monitoring controls executed and displayed correct warnings, but audible headphone confirmation was not independently captured by automation.
- Physical unplug/replug was not performed. Recovery and full-episode duration remain pending.

## Phase 8D Audio Monitoring and Long Recording Addendum

- `Play Test Sound` now uses selected output routing when `HTMLAudioElement.setSinkId` is available. Automation could not independently confirm audibility.
- `Monitor Mic` toggled and showed the no-feedback headphone warning. Automation could not independently confirm headphone monitoring audio/no-echo.
- 30-minute live-studio run reached `00:30:33` with Sony and Integrated camera previews still live.
- The real long recording validated with ffprobe: `Program\program.webm` is 257,607,059 bytes with VP9 video and Opus mono audio; extracted mic audio is AAC mono duration `1828.869000`.
- The long run found a real stop/save hang when `MediaRecorder` was already `inactive`; recording bytes are now returned as `Uint8Array` and inactive recorders resolve instead of waiting forever.
- Export button handling was fixed after the long recording exposed a dead primary Export button.
- Patched app exported `what-about-it-full-episode-video.mp4`, 33,013,463 bytes, H.264/AAC, 1024x576, 30 fps, duration `1828.869000`.
- 60-minute stability was not run after the 30-minute pass found defects requiring fixes.

## Phase 9B Sony Live Preview and Studio Flow Addendum

- Windows detected `Sony Camera (Imaging Edge)` and Electron enumeration detected both Sony and Integrated camera inputs.
- Studio Setup camera cards now have real preview video elements, `Live`/`Ready`/`Needs attention`/`Used by another app`/`Permission needed` states, `Refresh Cameras`, `Release Camera`, and `Open Camera Help`.
- `Refresh Cameras` now uses the permission-aware media request path.
- Camera and microphone permission requests are independent, so one busy device should not hide all setup feedback.
- The Studio Ready banner now requires the selected camera and microphone to be present in current detection.
- Studio Setup built-app smoke remained blocked: camera dropdowns did not populate after `Check again`, so Sony setup live preview was not validated.
- Navigation is simplified to primary Studio, Setup, Record, Review, Export routes with secondary tools lower in the sidebar.
- Sidebar collapsed state is saved in settings and covered by automated tests.

## Phase 9C Built-App Camera Discovery Addendum

- Built Electron renderer diagnostics confirmed `navigator.mediaDevices.enumerateDevices()` returned `Sony Camera (Imaging Edge)` and `Integrated Camera (13d3:540a)`.
- The main process now grants local `media` permission requests so built-app camera/mic discovery matches the validated recording path.
- The active device plugin now merges camera provider registry discovery into Studio Setup detection.
- Studio Setup dropdowns populated with Sony and Integrated cameras for Camera 1, Camera 2, and Camera 3.
- Selecting `Sony Camera (Imaging Edge)` in Camera 1 started a live setup preview and reached `Live`.
- Microphone dropdowns still populated with Realtek microphone options.

## Phase 9F Media Reliability Addendum

- `DeviceService` now tracks opened camera and microphone streams, stops duplicate streams for the same device, and exposes `releaseAll()` for route changes and app shutdown.
- `RecordingService.shutdown()` and the browser recorder shutdown hook stop active recording tracks without pretending media was saved.
- Live Studio monitoring is now per mic with `Hear Morgan`, `Hear Guest`, and `Hear Extra` controls. Monitoring defaults Off, Mute blocks monitoring, and Solo limits the audible channel set.
- Software monitoring now uses a direct interactive AudioContext route instead of a buffered media-element relay and removes live look-ahead compression. Hardware direct monitoring remains the only zero-delay path; audible latency improvements still require human confirmation on each Windows driver/interface combination.
- Review Episode now loads actual files from `Program`, `Cameras`, and `Audio`, shows a real Program video player when `Program/program.webm` exists, and shows real audio preview controls for present mic files.
- Review uses ffprobe metadata for duration/codecs and marks missing media truthfully.
- Draft edit operations remain non-destructive metadata. The UI now says `Draft saved. Preview rendering comes next.` when edits exist.
- Export now requires `Program/program.webm` for real exports, rejects stray Program-folder media, and does not report success until ffprobe validates output.
- Manual Sony/mic hardware QA was not rerun during this code pass; `docs/manual-qa/MEDIA_FLOW_QA.md` tracks the focused physical checklist.

## Phase 9G Focused Media Flow Hardware Addendum

- Installed app was updated and launched from `C:\Users\mmcga\AppData\Local\Programs\what-about-it-studio\What About It Studio.exe`.
- Studio Setup detected and previewed `Sony Camera (Imaging Edge)` as Camera 1 and `Integrated Camera (13d3:540a)` as Camera 2.
- A stale/busy launch state showed cameras as used by another app until previous installed-app processes were stopped; after cleanup, both cameras returned to `Live`.
- Live Studio showed Sony and Integrated previews, Morgan/Guest/Extra meter cards, readiness strip, and sticky Record/Pause/Stop controls.
- Per-mic monitoring controls for Morgan and Guest toggled and monitoring defaulted Off after leaving/reopening. Headphone audibility/no-echo was not independently confirmable through automation.
- Real recording reached `00:00:44` and saved to `%APPDATA%\What About It Studio\episodes\2026-06-28-studio-recording-94ac2f9c`.
- Fresh files saved: `Program\program.webm`, `Cameras\camera-1.webm`, and `Audio\morgan-mic.m4a`.
- `Cameras\camera-2.webm`, `Audio\guest-mic.m4a`, and `Audio\extra-mic.m4a` were not produced; simultaneous multi-camera/multi-mic recording remains incomplete.
- Review opened after Stop, rendered Program video and Morgan audio controls, and truthfully marked missing secondary camera/mic files.
- Phase 9G found and fixed a Review duration display bug for durationless WebM files by falling back to `Session\recording-state.json` elapsed time.
- ffprobe validated Program/Camera 1 as VP9+Opus WebM and Morgan Mic as AAC M4A duration `54.724000`.
- Standard Full Episode Video export completed and produced `what-about-it-full-episode-video.mp4`, H.264/AAC, 1024x576, 30 fps, duration `54.724000`; ffmpeg decode smoke passed.

## Phase 9I Multi-Track Recording Addendum

- Browser recording still creates `Program\program.webm` for Review and Export.
- Separate sidecar recorders now attempt selected Camera 1/2/3 and Morgan/Guest/Extra mic outputs where Electron/browser capture supports them.
- Saved camera sidecars are written to `Cameras\camera-1.webm`, `Cameras\camera-2.webm`, and `Cameras\camera-3.webm`.
- Saved mic sidecars are transcoded to `Audio\morgan-mic.m4a`, `Audio\guest-mic.m4a`, and `Audio\extra-mic.m4a`.
- Track states are persisted as `Saved`, `Preview only`, or `Needs Attention`; the app no longer fabricates Camera 2/3 or Guest/Extra files when capture is unavailable.
- Current-source Electron QA selected `Sony Camera (Imaging Edge)` as Camera 1 and `Integrated Camera (13d3:540a)` as Camera 2, then recorded past 30 seconds.
- ffprobe validated fresh files: Program VP9/Opus WebM, Camera 1 VP9 1024x576 WebM, Camera 2 VP9 640x480 WebM, Morgan Mic AAC M4A duration `74.335000`, and Guest Mic AAC M4A duration `74.095000`.
- Review displayed Camera 1, Camera 2, Morgan Mic, and Guest Mic as ready; Camera 3 and Extra Mic showed truthful `Not recorded in this episode` states.
- Export continued to use `Program\program.webm` and produced H.264/AAC MP4, 1024x576, 30 fps, duration `74.359833`.
- Camera 3, Extra Mic, exact physical second-mic identity, and audible monitoring/test sound remain pending human/hardware validation.

## Post-Phase 9I Studio Routing Addendum

- `DeviceService` now exposes active camera and microphone streams to the recording plugin so live previews/meters can be cloned at Record start.
- `BrowserMediaRecorderPlugin` now reuses active Camera 1/2/3 preview tracks before falling back to a fresh `getUserMedia()` request. This targets the real failure where only one camera saved while another selected camera was already previewing.
- Camera 1/2/3 cards now include an explicit `Audio input` route to Morgan Mic, Guest Mic, or Extra Mic. Camera 1's route feeds the Program recording audio source.
- The mixer now shows clear Output routing, per-channel Input selectors for Morgan/Guest/Extra, Volume sliders, Mute, Solo, and Hear controls without hiding them behind a collapsed `More` panel.
- Automated tests cover live camera stream reuse, Camera 1 mic route selection, mixer input updates, and stream resolver exposure.
- Physical M-Audio AudioBox input selection, audible test sound, and headphone monitoring/no-feedback confirmation are still pending. No docs mark those as human-confirmed.

## Production Depth Addendum

- The collapsed sidebar is now one consistent branded navigation rail on Setup, Record, Review, and Export. Record no longer forces the sidebar open; compact controls retain hover/focus labels.
- Recording confidence now comes from the active media engine. The UI checks Program state, active camera/audio sidecar counts, expected source counts, and source warnings while recording.
- Edit Studio can copy an approved voice treatment to all microphone tracks, copy a camera look to all camera tracks, and reset one source without changing the others.
- Program mastering offers Podcast, Video, and Broadcast loudness targets. The selected LUFS and true-peak values are passed into FFmpeg loudness normalization.
- Explicitly saving a Manual Edit draft updates a local Auto Edit learning profile. Auto Edit blends those approved settings with the selected mode and applies a minimum camera hold to avoid rapid cuts.
- This pass used automated short-media and UI tests only. It did not claim new physical hardware, audible-monitoring, long-recording, or full-episode validation.

## Start-to-Finish Workflow Addendum

- Workspace scrolling is isolated from the branded sidebar, so setup, recording, editing, and export navigation stays available on laptop-sized windows.
- The four-step workflow is interactive and truthful. Placeholder timeline tracks no longer mark Review complete, and Review/Export remain locked until media exists.
- Recent episode rows reopen their real Review inventory.
- Studio Setup was condensed so hardware selection begins substantially closer to the top of the screen; the detailed setup checklist is available on demand.
- Live Studio now reports pending `Starting` and `Saving` work around the asynchronous recorder lifecycle instead of appearing unresponsive.
- Edit Studio can jump between saved markers and uses `Save & Export` to persist the current approved draft before handoff.
- Export now communicates five concrete rendering stages and provides explicit completion actions.
- This pass did not change media codecs or claim additional physical hardware results. Validation is automated and short-duration only.

## Direct Editing Usability Addendum

- The Edit Studio now supports click-to-scrub, drag range selection with visible handles, Split mode, double-click split, Delete range, timeline zoom, and optional snapping to markers, edits, and camera decisions.
- Recorded camera sources and camera timeline clips can be dragged onto Program to create an export-backed camera decision at the drop time.
- Draft saved/changed status is visible beside source readiness; Undo, Redo, Save draft, and Save & Export remain explicit.
- New installs default to the compact branded navigation rail, while a saved user choice to expand it remains authoritative.
- Closing or completing the first-run guide now persists `never`; `Remind Me Later` remains the only choice that intentionally brings it back.
- Laptop-width browser QA at 1366x768 found no horizontal workspace overflow on Studio Setup, Record, Edit Studio, or Export.
- This pass used focused automated interaction tests and visual browser QA. It did not run a long recording or claim new physical hardware results.

## M-Track Duo P0 Audio Addendum

- Windows exposes the connected two-input interface as one generic DirectShow endpoint: `Line (2- USB AUDIO CODEC)`, not as two separately named M-Audio devices.
- DirectShow reports a maximum of two channels at 44.1 kHz/16-bit. The app therefore treats this machine as one interface with browser-visible Input 1 and Input 2 routes and does not fabricate separate devices.
- USB audio endpoints are surfaced as `USB Audio Interface (...)` while preserving the exact Windows label for diagnostics and session metadata.
- Audio capture now preserves a stereo request through the first constraint fallback, validates the real stream channel count before routing a numbered input, and reports a truthful one-channel error when Input 2 is unavailable.
- Studio Setup and Live Studio provide independent RMS/peak meters, clipping/quiet/disconnected states, editable person names, route diagnostics, and a first-click quiet-input warning with a second-click recording override.
- Program and sidecar recording retain the selected slot, device, label, input number, person name, and role. Same-interface Input 1/Input 2 tracks use distinct sync keys.
- Automated audio/setup/recording coverage passed. Windows/DirectShow detection is physically confirmed; spoken isolation of Input 1 versus Input 2 and post-record voice playback still require the short human hardware steps in `docs/manual-qa/M_TRACK_DUO_P0_QA.md`.
- A duplicate app-level mic sampler that reopened the selected input every 900 ms was removed. Setup and Record now rely on their persistent per-channel meter streams, eliminating the observed capture loop.
- Laptop layout QA at 1366x768 confirms three camera previews, a non-overlapping transport, a three-column mic console, collapsed secondary tools, and no body/workspace horizontal overflow.
- Three same-named Imaging Edge feeds remain distinct when Windows exposes three unique device IDs. The current laptop audit still exposes one Imaging Edge endpoint, so three Sony tracks require two additional Windows-visible video endpoints rather than duplicated app slots.
