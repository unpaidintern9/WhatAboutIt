# Live Studio UI Target

Phase 9D keeps the Record screen focused on the beginner workflow after Sony preview discovery was fixed.

## Implemented UI

- Collapsed-by-default sidebar so the Record screen has more room.
- Simple workflow: Studio Setup, Record, Review, Export.
- Three live camera panels are the first major Record screen surface.
- Microphone Mixer sits directly under the camera panels.
- Readiness strip stays near the primary recording decision.
- Giant sticky action row keeps Record, Pause, Stop, Resume, Auto Edit, and Export visible.
- Secondary tools sit lower: camera layout, Soundboard, Markers, Episode Notes, Guest Notes, and Teleprompter.
- Rustic reusable component patterns: `RippedPaperCard`, `RusticButton`, `VintagePanel`, `TornEdgeHeader`, `DistressedMeter`, and `StudioControlButton`.

## Truthful States

- Camera preview uses browser `getUserMedia` and shows Needs Attention if the selected camera cannot open.
- Empty soundboard buttons say `Add a sound first`.
- Auto Edit and Export from the live studio show a needs-recording message until a session exists.
- Stop uses the existing real recording path, saves, creates a timeline draft, and routes to Review Episode.

## Phase 9D Layout Rule

Keep these above the lower tools grid:

- Three camera cards
- Live audio feedback
- Readiness strip
- Record/Pause/Stop controls

## Reference Asset

The design reference is stored at `assets/references/ui/live-studio-target-reference.png`.

It is a design reference only. The Electron package includes `dist/**/*`, `node_modules/**/*`, and `package.json`; root-level reference assets are not shipped.
