# Essentia Dependency Audit

Repository: `external-repos/essentia`  
Remote: https://github.com/MTG/essentia.git  
Local shallow commit: `b9fa6cb`

## What Problem It Solves

Essentia provides audio analysis algorithms that could support loudness, speech/music features, silence analysis, and quality signals.

## Features We Will Actually Use

- Research for audio feature extraction.
- Audio quality metrics if FFmpeg-level analysis is insufficient.
- Possible Auto Edit signal enrichment in Phase 6.

## Parts We Will Not Use

- Music information retrieval features unrelated to podcasts.
- Network or server-style workflows.
- Any analysis that cannot be explained in the edit report.

## License

AGPL-3.0, based on local `COPYING.txt`.

## Build Requirements

Python/C++ project with `setup.py` and `pyproject.toml`. Native build requirements vary by feature set.

## Risks

- AGPL license is high-impact for distribution and integration.
- Likely too broad for MVP podcast editing.
- Native/Python packaging complexity.

## Better Alternatives

- FFmpeg loudness and silence filters.
- Small app-owned audio analysis workers.
- WebAudio-style analysis in renderer for previews.

## Integration Approach

Do not integrate into the product by default. Keep as research only unless legal and distribution strategy explicitly approve AGPL use.

