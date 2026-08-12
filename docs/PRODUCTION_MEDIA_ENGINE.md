# Production Media Engine

The app has a real, offline production path built on Electron media capture plus bundled FFmpeg and ffprobe. The originals, draft, rendered masters, and reports for an episode stay inside that episode's folder.

## Recording

The Live Studio creates `Program/program.webm` and attempts a separate sidecar for every selected source:

- `Cameras/camera-1.webm`, `camera-2.webm`, and `camera-3.webm`
- `Audio/morgan-mic.m4a`, `guest-mic.m4a`, and `extra-mic.m4a`

Every saved file is probed before it is reported as saved. A source that previews but cannot open a separate recorder is reported as `Preview only`; the app does not create a fake file.

While Record or Pause is active, the renderer reads recorder health from the capture engine. It reports whether the Program recorder is alive, how many selected camera and microphone sidecars are active, and whether any selected source needs attention. Preflight readiness is not reused as proof that recording is healthy.

One Windows camera device can occupy only one camera slot. Multiple Sony bodies are supported only when Windows exposes each body as a unique camera device ID. Every browser-visible Windows audio input remains selectable, including laptop microphone arrays and interface channel pairs. One interface can feed multiple mic tracks through browser-visible Inputs 1 through 16, but the exact same device and input route cannot be assigned twice. Channels hidden behind an ASIO-only driver are not available to Electron.

## Edit Studio

`Session/draft-timeline.json` is a non-destructive edit decision document. The Edit Studio loads the real Program, camera, and microphone inventory and offers:

- synchronized Program, camera, and microphone lanes
- source playback, click-to-scrub, drag range selection, exact In/Out selection, trim start/end, click-to-split, and range removal
- timeline zoom, marker/cut snapping, and draggable camera sources that create real Program camera decisions at the drop time
- per-camera inclusion, fit/fill framing, zoom and position, brightness, contrast, saturation, temperature, tint, denoise, sharpening, and sync nudge
- per-mic inclusion, mute, solo, level, pan, fades, sync nudge, noise cleanup, gate, de-essing, compression, three-band tone, voice presets, and output limiting
- clean-cut or soft-fade camera changes with an adjustable transition duration
- reusable `Apply to all mics` and `Apply to all cameras` treatment actions plus independent source reset
- Podcast (-16 LUFS), Video (-14 LUFS), and Broadcast (-24 LUFS) final delivery targets with true-peak protection
- manual camera decisions and explainable Auto Edit camera suggestions
- undo, redo, restore, and explicit draft save

The raw recordings are never rewritten. Arbitrary ripple rearranging of recorded clips, titles, transcript editing, automation keyframes, advanced color masks/curves, and third-party VST hosting are not implemented. Camera clips can be dragged onto Program to create export-backed camera changes; they cannot yet be freely reordered like a general-purpose nonlinear editor. The de-ess control is a focused high-frequency reduction rather than a spectral de-esser plug-in.

## Export

Bundled FFmpeg renders the draft and ffprobe validates decodability before the job completes. The UI reports live percentage plus Prepare, Mix Sources, Build Video, Verify File, and Done stages, and lists every generated artifact. A completed job makes `Open export folder` the primary action while preserving clear routes back to Review or Home.

Full episode exports include:

- finished H.264/AAC MP4
- each available camera paired with its assigned microphone in `Exports/Camera Masters/`
- each available edited microphone as 48 kHz stereo, 24-bit PCM WAV in `Exports/Audio Masters/`
- `Exports/edit-decision-list.json`

The final voice mix uses track controls and EBU R128 loudness normalization using the delivery target stored in the draft. Podcast defaults to -16 LUFS with a -1.5 dB true-peak ceiling; Video and Broadcast targets are selectable in the Program inspector. Standard renders at 720p with 192 kbps AAC. High renders at 1080p with 320 kbps AAC. Archive uses a near-master H.264 encode and 24-bit PCM audio.

## Auto Edit

Auto Edit reads saved microphone activity and camera-to-mic routes to propose camera changes. It applies a mode-specific starting profile for voice cleanup, dynamics, three-band tone, output limiting, camera denoise, picture finishing, and camera transitions. A locally stored learning profile blends in treatment, transition, and camera pacing values from explicitly saved Manual Edit drafts. Minimum camera hold time suppresses rapid activity-driven switching. It does not guess when sidecars or routing evidence are missing. Manual Edit and Auto Edit use the same draft and controls, so every automatic choice remains editable before export.

## Validation Status

Automated short-media tests create two camera files and two microphone files, render a switched-camera final MP4, exercise camera fades, reframing, color, denoise, sharpening, voice cleanup, EQ, compression, limiting, pan, and sync controls, create 24-bit WAV stems, and decode-validate every result. Focused UI tests also exercise drag range selection and split-tool placement against the non-destructive draft model.

Previously completed physical QA validated Sony Imaging Edge plus an integrated camera, separate microphone files, review playback, export, and ffprobe. Camera 3, Extra Mic, long-duration drift, and hidden ASIO-only channels still require compatible physical hardware validation. The latest start-to-finish UI pass used focused automated tests and intentionally did not run a long recording test.
