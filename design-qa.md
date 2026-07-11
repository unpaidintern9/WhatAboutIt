# Design QA: Live Studio Reference Match

source visual truth path: `C:\Users\mmcga\Downloads\StudioReference.png`

implementation screenshot path: `C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudio\design-qa-recording-spacing-fix.png`

comparison evidence: `C:\Users\mmcga\OneDrive\Documents\WhatAboutItStudio\design-qa-comparison.png`

viewport: `1920 x 1017`

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

## Follow-Up Polish

- P3: Replace the letter-avatar Morgan treatment with a properly licensed/cropped Morgan cutout asset if packaging can include it.
- P3: Add the full future layout editor behind `View Layouts`; currently it exposes and explains the preset controls already on the screen.
- P3: Further tune the mixer into true vertical VU strips once the audio mixer gets a dedicated canvas or component.

final result: passed
