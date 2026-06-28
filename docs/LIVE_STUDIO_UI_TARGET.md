# Live Studio UI Target

Phase 8B turns the Record screen into a live control room instead of a placeholder page.

## Implemented UI

- Left deep-red studio rail with a large What About It? Studio brand lockup.
- Top episode/control-room header with live status and timer.
- Three camera panels across the top with live preview attempts, status copy, device labels, resolution/fps metadata when available, and gear buttons.
- Camera layout row for Host, Guest, Split, Triple, Picture-in-Picture, Sponsor Card, Intro, Outro, and Topic Card.
- Bottom control-room grid for Microphone Mixer, Soundboard, Markers, Episode Notes, Guest Notes, and Teleprompter.
- Giant action row for Record, Pause, Stop, Resume, Auto Edit, and Export.
- Rustic reusable component patterns: `RippedPaperCard`, `RusticButton`, `VintagePanel`, `TornEdgeHeader`, `DistressedMeter`, and `StudioControlButton`.

## Truthful States

- Camera preview uses browser `getUserMedia` and shows Needs Attention if the selected camera cannot open.
- Empty soundboard buttons say `Add a sound first`.
- Auto Edit and Export from the live studio show a needs-recording message until a session exists.
- Stop uses the existing real recording path, saves, creates a timeline draft, and routes to Review Episode.

## Reference Asset

The design reference is stored at `assets/references/ui/live-studio-target-reference.png`.

It is a design reference only. The Electron package includes `dist/**/*`, `node_modules/**/*`, and `package.json`; root-level reference assets are not shipped.
