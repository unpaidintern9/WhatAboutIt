# Design Tokens

All visual values come from the active theme.

## Token Sources

Each theme folder contains:

- `colors.json`
- `typography.json`
- `spacing.json`
- `components.json`
- `icons.json`
- `textures.json`
- `animations.json`

## No Hardcoded Values

Components may not hardcode:

- Colors
- Fonts
- Radius
- Padding
- Shadows
- Animation speeds

When a new visual value is needed, add it to the theme schema first.

## CSS Mapping

The Theme Engine maps theme JSON into CSS custom properties:

- `--color-*`
- `--font-*`
- `--space-*`
- `--component-*`
- `--animation-*`
- `--texture-*`

## Review Rule

The Brand Guardian must reject screens that bypass tokens for visual styling.

