# Services

Services coordinate app behavior across core contracts and plugin implementations.

## Initial Services

- `EpisodeService`
- `SettingsService`
- `ThemeService`
- `LearningService`
- `PluginRegistry`
- `AutoEditPipelineService`
- `LoggingService`
- `ErrorService`

## Rules

- Services depend on contracts, not implementation details.
- Services return structured results.
- Services log technical details separately from friendly user messages.
- Services must remain offline-first.

