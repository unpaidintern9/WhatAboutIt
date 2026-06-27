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

