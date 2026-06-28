# Live Audio Monitoring

Phase 9F replaces the single global monitor toggle with per-channel monitoring.

## What Works

- Morgan Mic, Guest Mic, and Extra Mic start with monitoring Off.
- Each channel has its own clear control: `Hear Morgan`, `Hear Guest`, or `Hear Extra`.
- Each monitor control shows `On` or `Off`.
- Mute blocks monitoring for that channel.
- Solo limits monitoring to the soloed channel or channels.
- Web Audio meters still move independently for selected mic device ids.
- Output selection still saves `audioOutputId`; browsers with `setSinkId` support route monitored audio to the chosen output.
- The warning copy is now: `Use headphones to avoid echo.`

## Truthful Limits

- Recording still captures the browser `MediaRecorder` program stream, not separate recorded mic files for every selected mic.
- Browser support controls whether output routing is available.
- Soundboard and Music do not pretend to be live mic channels.
- Audible no-echo confirmation still requires human headphone QA.

## Manual QA Required

Use headphones, select Morgan/Guest/Extra mic devices where available, enable one `Hear` control at a time, then enable multiple channels and Solo to confirm the heard mix matches the UI.
