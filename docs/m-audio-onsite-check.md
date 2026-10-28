# M-Track Duo: separate voices and isolate static

Keep the existing episode folders and original audio. Before changing anything, open the affected episode and use **Settings → Save Support Diagnostics**. Note the time of each short test and keep the recording with its ZIP.

## 1. Find which path has the noise

With the studio app fully closed, plug wired headphones into the M-Audio. Start at a comfortable low headphone volume.

| Test | What the result tells us |
| --- | --- |
| Direct Mono: listen while each person speaks, then stays quiet | Noise here exists in the mic/interface/monitoring path without this app. The computer can still contribute USB power noise. |
| USB: play a known clean file with the app still closed | Noise here points toward the playback/output, USB, driver or power path. It does not by itself prove the microphone recording is noisy. |
| Save a short recording and listen on another known good device/headphone output | Noise in the file is different from noise heard only through the interface's headphone output. |

Direct Mono puts both inputs in both ears for live listening. It does **not** merge the recorded input channels. Direct Stereo puts Input 1 on the left and Input 2 on the right. Use USB when checking computer playback.

## 2. Isolate the hardware, one change at a time

1. Connect the interface directly to the computer for the test. Compare another USB port/cable, and compare laptop battery power with the charger disconnected. Note which change affects the noise.
2. Test one microphone/cable on Input 1, then on Input 2 with comparable gain. If the noise follows it, compare a known good cable and microphone separately. If it stays with a port, investigate that input/interface.
3. Reduce headphone volume before reconnecting microphones. Use phantom power only as required by the actual microphone model. Confirm microphone/XLR connections and the interface's appropriate input setting.
4. Speak at the normal recording distance. Adjust the physical input gain for a healthy level without red clipping indicators. Excessive preamp gain can add hiss; headphone volume and the app's headphone fader do not set the recorded microphone gain.

## 3. Verify Windows and the two tracks

1. Check the installed driver against M-Audio's official download page. Do not install unrelated driver wrappers as a first troubleshooting step.
2. Open Windows Sound → More sound settings → Recording → the M-Audio → Properties → Advanced. Choose a supported **2-channel, 48,000 Hz** format for the Duo; use the bit depth the driver actually offers. Check the playback format too. Disable Windows audio enhancements for the comparison if present. Close other apps using the interface, then reconnect inputs in the studio app.
3. In Studio Setup or Record, choose the M-Audio interface and **Use Input 1 + Input 2**. Morgan should use Input 1 · Mono; Guest should use Input 2 · Mono. An unavailable Input 2/one-channel warning must be resolved before claiming isolation.
4. Speak into Morgan's mic with the guest quiet, then reverse. The corresponding meter should respond most strongly. Some acoustic pickup of the other person is normal; identical strong signals on both tracks require investigation.
5. Record about 20 seconds: a few seconds of room silence, Morgan alone, Guest alone, then both. Stop and listen to the **individual Morgan and Guest audio files**, as well as the program playback. Camera/program files may intentionally contain reference audio; those are not the isolated microphone files.
6. Repeat the same test in another recording app using the same interface. Noise in both apps points toward a common input/driver/Windows path; a clean comparison recording narrows the investigation toward this app or its playback path.
7. Save Support Diagnostics immediately after the comparison. Keep the original short recordings, ZIP, test times, microphone model, driver version and the physical gain/switch positions.

## Manufacturer references

- [Duo user guide: ports, gain, phantom power and Direct/USB monitoring](https://cdn.inmusicbrands.com/m-audio/maudio_documentation/M-Track%20Duo%20-%20User%20Guide%20-%20v1.5.pdf)
- [Official drivers and documentation](https://www.m-audio.com/support/downloads)
- [Setting recording levels](https://support.m-audio.com/en/support/solutions/articles/69000858597-m-audio-interface-recording-tips-part-2-setting-levels)
- [Distortion, clicks and pops troubleshooting](https://support.m-audio.com/en/support/solutions/articles/69000805535-m-audio-troubleshooting-distortion-clicks-pops-with-your-audio-interface)

These comparisons identify the path to investigate. They do not establish a hardware fault or an app defect on their own. The app cannot read the interface's physical gain knobs or Direct/USB switch.
