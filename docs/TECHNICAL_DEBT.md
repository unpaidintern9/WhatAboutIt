# Technical Debt

Date: 2026-06-27

## Critical

1. **Recording engine is browser-only**
   - Risk: Cannot reliably capture up to 3 cameras and multiple mics.
   - Fix: Implement native/OBS recording plugin and integration tests.

2. **Export does not create media**
   - Risk: User cannot produce a finished episode file.
   - Fix: Build FFmpeg worker and real output validation.

3. **Auto Edit is simulated**
   - Risk: Product promise exceeds actual intelligence.
   - Fix: Add real transcript, silence, audio, speaker, marker, and camera analysis stages.

## High

4. **Timeline edits are not playable against real media**
   - Risk: Users cannot verify edits in context.
   - Fix: Add media-backed preview engine and waveform/thumbnails.

5. **Device health is approximate**
   - Risk: Camera/mic readiness can be misleading.
   - Fix: Add real preview streams, reconnect detection, busy-device handling, and output routing.

6. **No installer/release QA**
   - Risk: App may fail outside dev environment.
   - Fix: Add packaged app smoke tests and signing plan.

## Medium

7. **Review-mode demo bridge lives in App**
   - Risk: Demo code and production app code are interleaved.
   - Fix: Move review bridge to a dedicated fixture module.

8. **Static Learning Center**
   - Risk: Help content will drift from feature behavior.
   - Fix: Add lesson registry metadata and per-feature help hooks.

9. **Settings lack schema versioning**
   - Risk: Older local settings may become inconsistent.
   - Fix: Add settings schema version and migrations.

10. **Docs from earlier phases contain stale phase language**
    - Risk: Developers may misread current status.
    - Fix: Add an active status index and archive old phase docs.

## Low

11. **CSS contains styles for staged/unused panels**
    - Risk: Slight maintenance overhead.
    - Fix: Prune after production feature set stabilizes.

12. **External repos are source clones only**
    - Risk: Large disk usage and unclear binary strategy.
    - Fix: Convert dependency strategy to pinned build artifacts when ready.
