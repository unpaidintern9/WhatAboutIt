# Production Readiness Audit

Date: 2026-06-27

Verdict: Not production-ready for recording and exporting a real full podcast episode.

The app is a strong offline MVP prototype with cohesive UX, local data storage, modular service boundaries, and reviewable draft logic. It is not yet a production recording/editing/export system because several critical media paths are placeholders, browser-only foundations, or deterministic simulations.

## Feature Audit

| Feature | Status | Evidence | Risk | Recommended fix | Priority |
|---|---|---|---|---|---|
| Branded shell and navigation | Complete | `app/src/renderer/App.tsx`, `app/src/renderer/styles.css` | Low | Continue visual QA during future changes. | P3 |
| Theme engine | Partial | `themes/`, `app/src/renderer/theme/themes.ts`, `ThemeEditorView` | Theme selection works, but full custom theme import/export editor remains staged. | Finish visual Theme Editor only after core media paths are real. | P3 |
| New episode creation | Partial | `app/src/main/main.ts` | Creates metadata and expected folders, but folder schema changed over phases and needs migration handling. | Add settings/data migration tests and a schema version. | P2 |
| Camera manager | Partial | `app/src/renderer/plugins/devices/browser-device-plugin.ts`, `DeviceSetupWizard.tsx` | Browser device enumeration works, but no native capture-card, HDMI, wireless camera, reconnect, battery, or real preview pipeline. | Implement native/provider camera plugins and real preview health checks. | P1 |
| Audio setup | Partial | `browser-device-plugin.ts`, `AudioMeter.tsx` | Basic mic detection and sample meter exist, but no production gain, monitoring, multi-track capture, device routing, or drift handling. | Add native audio service with real meters, routing, drift, and multi-track support. | P1 |
| Recording | Needs Real Integration | `BrowserMediaRecorderPlugin`, `HiddenObsControlPlugin`, `recording-session-store.ts` | Browser MediaRecorder captures one browser stream path; OBS plugin is a throwing stub. Multi-camera, multi-mic, separate tracks, crash safety, and production recording are not real. | Integrate OBS/libobs or a native recorder behind `RecordingEnginePlugin`. | P0 |
| OBS integration | Stub | `app/src/renderer/plugins/recording/obs-control-plugin.ts` | All methods throw “not connected yet.” | Replace with real hidden OBS/libobs/process-control adapter or remove from production build. | P0 |
| Podcast tools | Partial | `PodcastToolsPanel.tsx`, `podcast-tools-store.ts` | Notes, markers, teleprompter state, soundboard settings are local; real sound playback and second-screen hardening are limited. | Finish local audio playback, popout lifecycle, and persistence QA. | P2 |
| Timeline review | Partial | `TimelineReview.tsx`, `timeline.ts` | Draft model exists; visual tracks are abstract review rows, not waveform/video-backed media tracks. | Connect timeline to real media metadata, thumbnails/waveforms, and playback. | P1 |
| Manual editing | Partial | `timeline.ts`, `TimelineReview.tsx` | Trim/split/cut are operation logs only; no real media preview or rendered edit decision list playback. | Implement actual non-destructive playback/render interpretation. | P1 |
| Export | Placeholder | `export-store.ts`, `ExportEpisode.tsx` | Export writes text placeholder artifacts, not MP4/WAV/MP3/media files. FFmpeg is not integrated. | Build real FFmpeg export worker with progress, cancel, output validation, and storage checks. | P0 |
| Auto Edit | Mock / Placeholder Intelligence | `auto-edit.ts`, `auto-edit-store.ts`, `AutoEditReview.tsx` | Pipeline, report, chapters, and clips are deterministic simulated suggestions. No transcript, silence analysis, speaker detection, audio analysis, or camera analysis. | Integrate offline media analysis stages and make each stage testable with real media fixtures. | P0 |
| Learning Center | Partial | `learning/`, `LearnStudioView` | Broad offline lessons exist, but content is static and not tied to per-feature help/search metadata. | Add searchable lesson registry and contextual tooltips. | P3 |
| Practice Mode | Partial | `PracticeModeView`, `learning/practice/` | Useful explanation mode, but not an interactive full guided simulation. | Add guided practice flows after media integrations stabilize. | P3 |
| Recovery | Partial | `recording-session-store.ts`, `RecordingStudio.tsx` | Unfinished sessions can be detected by state files, but real interrupted-media recovery is not proven. | Test crash scenarios with real recorder outputs. | P1 |
| Packaging | Partial | `app/package.json` | Electron Builder config exists; installers are not produced or signed. | Add CI packaging, signing, update channel policy, and install smoke tests. | P2 |
| Offline capability | Partial | Local stores and no telemetry are in place. | External repos are cloned, but many real processing tools are not built or bundled. | Build/bundle required native tools inside project-controlled paths. | P1 |
| Testing | Partial | 22 test files, 59 tests before this audit. | Tests cover models and screens, not real hardware/media integration. | Add integration tests with sample media, packaging tests, and device plugin tests. | P1 |

## Placeholder / Mock / Stub Inventory

| Item | Type | Evidence | Production impact |
|---|---|---|---|
| OBS recording adapter | Stub | `HiddenObsControlPlugin` throws in every method. | Blocks production multi-source recording. |
| Export output | Placeholder | `export-store.ts` writes `.txt` “local export placeholder.” | Blocks usable MP4/audio exports. |
| Auto Edit intelligence | Simulated behavior | `runOfflineAutoEdit` uses deterministic duration percentages and marker heuristics. | Not real silence/audio/transcript/camera analysis. |
| Timeline tracks | Abstract model | `TimelineTrack.placeholder` now user-friendly labels, but no real waveform/video source mapping. | Review/edit playback cannot represent true media. |
| Camera provider metadata | Approximation | Browser plugin assigns connection type/signal defaults. | Health status may be misleading for real devices. |
| Review-mode demo bridge | Mock data | `getStudioBridge()` returns demo devices, episodes, timeline, export. | Good for browser review, not production behavior. |
| Social clips | Version 2 | Export option is disabled as “Saved for Version 2.” | Fine for MVP scope, not complete social workflow. |
| Theme Editor | Staged UI | `ThemeEditorView` disables custom theme controls. | Not a blocker for recording MVP, but not complete. |

## Dependency Integration Audit

| Dependency | Currently integrated? | Planned only? | Placeholder? | Production-ready? | Missing work |
|---|---:|---:|---:|---:|---|
| OBS | No | Yes | Yes | No | Build hidden OBS/libobs/process adapter, map devices/scenes, test crash recovery, bundle/install strategy. |
| FFmpeg | No | Yes | Yes | No | Build export worker, validate binaries/licensing, implement progress/cancel, generate real MP4/audio/archive outputs. |
| MLT | No | Optional | No | No | Decide whether MLT is needed; current timeline JSON may be enough until advanced edits. |
| auto-editor | No | Reference only | No | No | Either integrate behind Auto Edit stage or replace with app-owned silence analyzer. |
| whisper.cpp | No | Yes | No | No | Build local transcription stage, model management, transcript cache, progress, errors. |
| OpenCV | No | Optional | No | No | Add camera/frame analysis only if needed for speaker/camera decisions. |
| Essentia | No | Optional | No | No | Add real audio analysis only if FFmpeg/basic analysis is insufficient. |

## Temporary / Dead / Duplicate Code Review

- No safe source dependency removal was identified during this pass.
- Test mocks are intentional and required by test coverage.
- Review-mode demo data in `getStudioBridge()` is useful for browser QA but must be clearly treated as non-production.
- Plugin README placeholders are documentation of architecture boundaries, not executable production code.
- `HiddenObsControlPlugin` is executable but throwing; it should not be selected in production until implemented.

## Production Readiness Decision

The MVP is not ready for beta as a real production recording tool. It is ready as an offline product prototype and architecture demo.
