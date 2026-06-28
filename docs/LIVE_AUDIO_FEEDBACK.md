# Live Audio Feedback

Phase: 9B Sony Live Preview + Simplify Studio Flow

Status: implemented; audible output was not retested in this phase.

## Studio Setup

- The microphone step now opens the selected microphone stream when available.
- The setup meter updates from Web Audio instead of relying only on a manual test click.
- Friendly states are shown:
  - `We hear you`
  - `Try speaking closer`
  - `We can't hear you yet`

## Record Screen

- The existing Record screen mic meter remains active while the screen is open.
- App-level polling keeps the microphone level fresh while Studio Setup or Record is visible.

## Notes

Phase 8D already validated the monitoring controls visually and fixed output-device routing where `setSinkId` is available. Phase 9B did not repeat audible headphone confirmation because no recording or output-device code was intentionally changed beyond live setup feedback.
