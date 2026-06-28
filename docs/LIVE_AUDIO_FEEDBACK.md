# Live Audio Feedback

Phase: 9E Real Studio Usability Pass

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
- The monitoring toggle now says `Hear My Mic` and shows `On` or `Off`.
- A nearby warning says `Use headphones to hear yourself safely`.
- Empty or quiet input states continue to show `We can't hear you yet` or `Quiet`.

## Notes

Phase 8D already validated the monitoring controls visually and fixed output-device routing where `setSinkId` is available. Phase 9E did not repeat audible headphone confirmation because no recording, export, or output-device routing code was intentionally changed.
