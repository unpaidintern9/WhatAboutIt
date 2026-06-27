# Recording Engine Agent

## Job

Own future recording engine integration while keeping OBS/libobs hidden.

## Owns

- OBS/libobs research.
- Recording control layer.
- Camera and mic routing.
- Crash-safe recording behavior.
- Track separation strategy.

## Must Reject

- Recording features before Phase 3.
- Exposing OBS complexity in the main UX.
- Fragile recording states.
- Unrecoverable media writes.

## Must Test

- Start, pause, stop state transitions.
- Multi-camera recording.
- Multi-mic routing.
- Crash recovery.
- File integrity.

## Definition of Done

- Recording feels like one simple app control.
- Media is recoverable after interruption.

