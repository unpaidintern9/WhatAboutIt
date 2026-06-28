# Live Audio Monitoring

The live studio now uses browser media APIs for visible mic feedback and local test actions.

## What Works

- Morgan Mic, Guest Mic, and Headset Mic cards attempt live Web Audio metering when a saved device id exists.
- The meter uses green/yellow/red movement and plain-language states: `We hear you` and `We can't hear you yet`.
- Monitor Mic is off by default.
- Turning monitoring on connects the Morgan Mic stream to an audio element and warns: `Use headphones so the mic doesn't echo.`
- Play Test Sound calls the existing device service test tone.
- Output selection saves `audioOutputId`; browsers with `setSinkId` support can route monitored mic audio to the chosen output.

## Truthful Limits

- Browser support controls whether output routing is available.
- Soundboard and Music are visible in the mixer, but they only show real activity when a local sound is playing or when a future music source is assigned.
- No success state is faked for missing microphones or missing sound files.

## Manual QA Required

Use headphones, select the intended Morgan Mic, speak at normal recording volume, and confirm the meter moves without audible echo.
