# Repository Dependencies

All source dependencies are stored inside `external-repos/`.

| Dependency | Repo | Planned Role |
| --- | --- | --- |
| OBS Studio | https://github.com/obsproject/obs-studio.git | Recording engine research and possible libobs integration. |
| FFmpeg | https://github.com/FFmpeg/FFmpeg.git | Export, transcode, audio extraction, render workers. |
| MLT Framework | https://github.com/mltframework/mlt.git | Timeline and non-linear editing research. |
| auto-editor | https://github.com/WyattBlue/auto-editor.git | Silence removal and auto-edit research. |
| whisper.cpp | https://github.com/ggml-org/whisper.cpp.git | Local transcription and chapter suggestions. |
| OpenCV | https://github.com/opencv/opencv.git | Future visual analysis and camera signal research. |
| Essentia | https://github.com/MTG/essentia.git | Audio analysis and quality signal research. |

## Policy

Do not add hidden source dependencies outside this project root. If future binary builds are needed, document them here and store related scripts in `scripts/`.

## Local Transcription Runtime

The installed Windows app downloads the MIT-licensed `whisper.cpp` v1.9.2 x64 runtime and the English `base.en Q5_1` Whisper model only when local transcription is first used. Both URLs are pinned to immutable versions and both files must pass their committed SHA-256 digest before the app installs or executes them. The model is about 57 MB and the runtime archive is about 8 MB.

Downloaded files live under the app's local data folder in `Local Transcription`. Episode audio and generated transcript text never leave the computer. A third-party notice with the Whisper and whisper.cpp license terms is written beside the downloaded files.
