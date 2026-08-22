# Design QA: Live Studio Reference Match

source visual truth path: `C:\Users\mmcga\Downloads\StudioReference.png`

implementation screenshot path: `C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudio\design-qa-recording-lenovo-fit.png`

stress screenshot path: `C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudio\design-qa-recording-lenovo-fit-1366.png`

comparison evidence: `C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudio\design-qa-comparison.png`

viewport: `1920 x 900` primary Lenovo-height check, plus `1366 x 768` stress check

state: Record screen, not recording, browser demo mode with live camera permissions unavailable.

primary interactions tested: View Layouts, Guest layout preset, bottom Auto Edit, bottom Export.

console errors checked: one 404 static resource in Vite dev mode; no React/runtime error observed during the smoke.

## Required Fidelity Surfaces

- Fonts and typography: Passed. The implementation uses bold western display typography, compact uppercase labels, and large action text matching the reference hierarchy. Minor font-family differences remain acceptable because the app uses theme tokens rather than a one-off imported mock font.
- Spacing and layout rhythm: Passed. The screen now uses the reference composition: red left rail, cream header, three camera cards above the fold, right notes/prompter stack, compact mixer/sound/marker row, and five large bottom actions without page scrolling at this viewport.
- Colors and visual tokens: Passed. Deep red, warm cream, black console surfaces, brass/gold labels, and distressed texture treatments are preserved through the existing theme-token system.
- Image quality and asset fidelity: Passed with expected product constraint. The source mock uses posed podcast photos; the implementation keeps real live video/device states instead of static photos. Morgan branding is represented in the left rail without copying mock photography into the production app.
- Copy and content: Passed. The header, camera labels, notes, teleprompter, layout controls, and action deck match the reference intent while preserving real app states and helpful unavailable messages.

## Comparison History

### Pass 1 Findings

- P2: Left logo clipped in the rail.
  Fix: Reduced recording-shell brand display size and kept the stacked lockup within the rail.
- P2: Layout preset buttons wrapped to a second row.
  Fix: Changed the layout preset grid to nine compact columns.
- P2: Camera-to-mic routing was hidden by reference styling.
  Fix: Restored compact `Audio input` selectors under each camera preview.
- P2: Mixer controls overlapped in compact channel strips.
  Fix: Increased mixer width share, reduced compact control typography, and changed channel action buttons to icon-forward compact controls.

### Pass 2 Result

No actionable P0/P1/P2 findings remain for this implementation scope.

### Spacing Fix Follow-Up

- Fixed: Camera previews were turning off and on because release callbacks were recreated on parent rerenders, causing preview effects to clean up and restart. Release callbacks are now stable.
- Fixed: The packaged app viewport showed vertical scroll and bottom controls overlapping the mixer. The recording shell now fits the viewport, the recovery banner is compact, the workbench rows are tighter, and the bottom controls sit below the console row.
- Fixed: Compact mixer controls were cramped. Channel strips now expose clear `M`, `S`, and `H` controls for Mute, Solo, and Hear while preserving input/output and volume.
- Evidence: `document.body.scrollHeight` equals `window.innerHeight` at `1920 x 1017`; console row bottom is `906.98px` and controls top is `914px`.

### Lenovo Laptop Fit Follow-Up

- Fixed: The Record screen now accounts for Electron title/menu height and Windows taskbar pressure by using laptop-height responsive rules at `max-height: 980px` and a tighter emergency layout below `820px`.
- Fixed: The reference board now fills the available viewport without forcing the recovery banner to push the bottom action deck below the fold. When the unfinished-recording banner is present, the board subtracts the banner height instead of overflowing.
- Evidence: At `1920 x 900`, `document.body.scrollHeight` equals `window.innerHeight` (`900px`), the control row bottom is `892px`, and the board bottom is `897px`.
- Evidence: At `1366 x 768`, `document.body.scrollHeight` equals `window.innerHeight` (`768px`), and the control row bottom is `760px`.

### Empty Review Recovery Follow-Up

- Source defect: The zero-duration Review state rendered the full timeline and inspector even though no media could be edited. This produced an oversized blank monitor, compressed the import workflow into a narrow rail, and caused source cards and copy to overlap.
- Fixed: Empty episodes now render a compact preview state and one full-width Media Setup workspace. Timeline tools, lanes, playback controls, and the selected-track inspector render only after a playable Program exists.
- Fixed: Camera 1, Camera 2, Camera 3, and Main audio use stable equal-width cards with bounded text, consistent button sizing, and responsive collapse rules.
- Evidence: `artifacts/audio-regression-2026-08-22/review-empty-before-after.png` compares the reported defect with the corrected `1536 x 864` implementation.
- Evidence: `review-empty-1920x1080.png`, `review-empty-1536x864.png`, `review-empty-1366x768.png`, and `review-empty-980x720.png` verify the requested desktop sizes and the application minimum. No overlap, clipping, or page-level scroll remains.
- Regression coverage: The focused component test asserts a single Media Setup, purposeful empty copy, and the absence of the timeline, editing toolbar, and selected-track inspector while Program media is unavailable.

### Real Hardware End-to-End Audit

- Recorded `11:02.60` through the packaged Windows app with three USB camera streams and the verified `Microphone (ZV-1F)` input. Program and all four isolated sources finalized and passed the app integrity checks.
- Verified the Morgan stem and Program independently: AAC/Opus at `48 kHz`, audible signal at `-31.1 dB` average with peaks near `-2.6 dB`, and no USB disconnect or protected-chunk error in the session log.
- Fixed: Normal microphone capture no longer depends on a suspended Web Audio graph. Explicit interface Left/Right routing still uses the channel graph, and live/setup meters resume their contexts before measuring.
- Fixed: Switching episodes can no longer flash the previous episode's media. A cold 11-minute Review load now shows an honest preparing state and reaches the correct timeline in about `7.7 seconds` instead of several minutes.
- Fixed: Long recordings use repeated 16:9 poster thumbnails rather than an end-to-end filmstrip scan or stretched lane image. Final packaged inspection found four poster lanes, one Morgan waveform lane, and zero stretched filmstrip images.
- Exported the full audit episode through measured High quality. The verified file is `1920 x 1080` H.264 with AAC stereo at `48 kHz`, duration `11:02.53`, and size `245.49 MB`.
- Fixed: AAC true-peak reconstruction could exceed the selected protection ceiling. The codec-safe mastering pass measured `-16.2 LUFS` integrated and `-2.2 dBFS` true peak for a `-1.5 dB` target.
- Evidence: `artifacts/audio-regression-2026-08-22/recording-10min-finalized.png`, `recording-10min-review-final-packaged.png`, `recording-console-final-packaged.png`, and `recording-10min-export-complete.png`.

### Audio Controls, USB Refresh, and Native Minimum Follow-Up

- Source evidence: `C:\Users\mmcga\AppData\Local\Temp\codex-clipboard-b0adb130-587d-4dc7-a5c1-acf8c499113f.png` and `codex-clipboard-ce5f378b-9faa-4ed9-9bf6-646405136059.png`.
- Implementation evidence: `C:\Users\mmcga\AppData\Local\Temp\whataboutit-audit-2026-08-22\07-record-1280x860-final.png`, `06-record-min-980x720-fixed.png`, and `04-review-waveform-fixed.jpg`.
- Fixed P1: Quiet or temporarily unreadable live-meter state no longer disables Record; only a selected microphone that is actually disconnected blocks capture.
- Fixed P1: Morgan and Guest now keep Input, Physical Jack, Voice Polish, headphone level, peak, Mute, Solo, and Hear visible together at `1280 x 860` and `980 x 720`.
- Fixed P1: Audio Diagnostics opens as a bounded closable dialog and no longer replaces the mixer with a raw nested scroll surface.
- Fixed P1: Review playback shows the finalized Morgan waveform and an explicit Guest no-signal lane; real media playback reported one microphone track playing.
- Fixed P2: Idle USB device changes release stale streams and remount camera/microphone previews. Active recording keeps its existing disconnect protection and safe-stop path.
- Fixed P2: The page no longer forces a second `980px` content minimum inside a `980px` outer native window, removing the minimum-size horizontal scrollbar.
- Density normalization: the source captures and implementation captures use different native window chrome and pixel sizes, so comparison used matched major regions and device states. Live camera content intentionally reflects the attached Sony and integrated cameras.

## Follow-Up Polish

- P3: Replace the letter-avatar Morgan treatment with a properly licensed/cropped Morgan cutout asset if packaging can include it.
- P3: Add the full future layout editor behind `View Layouts`; currently it exposes and explains the preset controls already on the screen.
- P3: Further tune the mixer into true vertical VU strips once the audio mixer gets a dedicated canvas or component.

final result: passed
