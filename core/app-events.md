# App Events

The app should communicate feature state through structured events.

## Event Rules

- Events use plain serializable objects.
- Events include `type`, `timestamp`, `source`, and `payload`.
- Error events include friendly user copy and technical details for logs.
- No event may require network access.

## Initial Event Families

- `episode.created`
- `episode.updated`
- `theme.changed`
- `learning.entry.requested`
- `plugin.health.changed`
- `autoEdit.stage.completed`
- `export.progress.changed`

