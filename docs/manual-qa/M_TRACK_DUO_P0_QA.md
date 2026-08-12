# M-Track Duo P0 QA

Date: 2026-08-09

## Hardware Evidence

- Connected USB audio endpoint: `Line (2- USB AUDIO CODEC)`
- Windows device class: `USB AUDIO CODEC` / Generic USB Audio
- DirectShow maximum: 2 channels, 16-bit, 44.1 kHz
- Output endpoint: `Speakers (2- USB AUDIO CODEC)`

A three-second DirectShow capture completed and ffprobe validated PCM 16-bit stereo, 44.1 kHz, duration `2.990998`. Both channels contained only very quiet energy during the unattended probe (about -80 dB RMS), so this proves two-channel delivery but does not prove the two spoken microphone assignments.

Windows does not expose the product name `M-Audio M-Track Duo` to DirectShow on this laptop. The app truthfully displays the endpoint as a USB audio interface and retains the raw Windows name in diagnostics.

## Automated Result

- PASS: selected physical device remains exact through all capture fallbacks.
- PASS: first fallback retains a two-channel request with browser processing disabled.
- PASS: Input 1 maps to channel index 0 and Input 2 maps to channel index 1.
- PASS: Input 2 is rejected with a truthful message when the stream reports one channel.
- PASS: duplicate device/channel routes are blocked while one device with distinct channels is allowed.
- PASS: independent route names and channel numbers persist in session metadata.
- PASS: Program recording and separate microphone sidecar recording paths remain covered.
- PASS: removed the duplicate 900 ms global microphone sampler; Setup and Record now keep one shared live stream per selected device instead of repeatedly reopening the interface.

Focused result: 60 tests passed across audio capture, device discovery, routing, setup, recording UI, and recording metadata. Full verification passed 185 tests.

## Short Human Check Required Today

1. Connect both microphones and select the USB Audio Interface for Morgan and Susan.
2. Set Morgan to Input 1 and Susan to Input 2.
3. Speak into Input 1 only. Confirm only Morgan's meter responds.
4. Speak into Input 2 only. Confirm only Susan's meter responds.
5. Record 10 seconds, stop, and open Review.
6. Play Morgan and Susan sidecars separately and confirm the correct voice association.
7. Use the M-Track Duo Direct Monitor control for the performer; browser monitoring is for confidence checking and cannot provide hardware-zero latency.

Do not mark the two-input spoken isolation complete until steps 3, 4, and 6 are heard by a person at the hardware.
