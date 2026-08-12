# Live Audio Monitoring

Phase 9F replaces the single global monitor toggle with per-channel monitoring.

## What Works

- Morgan Mic, Guest Mic, and Extra Mic start with monitoring Off.
- Each channel has its own clear control: `Hear Morgan`, `Hear Guest`, or `Hear Extra`.
- Each monitor control shows `On` or `Off`.
- Mute blocks monitoring for that channel.
- Solo limits monitoring to the soloed channel or channels.
- Web Audio meters still move independently for selected mic device ids.
- Output selection saves `audioOutputId`; Electron routes the low-buffer AudioContext directly to that output where `AudioContext.setSinkId` is available.
- Software monitoring no longer passes through a generated media stream and `<audio>` element, and it omits look-ahead compression from the live path to avoid unnecessary buffering.
- The monitor uses interactive latency at 48 kHz. Windows driver and USB buffers still contribute latency, so an interface's hardware `Direct Monitor` switch, mixer knob, or control-panel route remains the only true zero-delay option.
- Laptop microphones use an automatic centered mono downmix. Multichannel interfaces can select browser-visible Inputs 1 through 16.
- A selected multichannel interface is opened once and its browser-visible channels are routed to independent meters and monitor paths. The UI rejects a numbered input that the browser did not actually expose.
- Studio Setup shows the selected USB interface, an editable person name, the numbered physical input, independent RMS/peak state, and reported channel/sample-rate details before recording.
- The warning copy is now: `Use headphones to avoid echo.`

## Truthful Limits

- Program audio remains a centered mono podcast mix. Selected Morgan, Guest, and Extra routes also attempt separate sidecar recordings so the original voices remain editable.
- Browser support controls whether output routing is available.
- Soundboard and Music do not pretend to be live mic channels.
- Audible no-echo confirmation still requires human headphone QA.
- Browser software monitoring cannot be zero latency. Use the interface's hardware Direct Monitor control for the performer whenever possible.

## Manual QA Required

Use headphones, select Morgan/Guest/Extra mic devices where available, enable one `Hear` control at a time, then enable multiple channels and Solo to confirm the heard mix matches the UI.
