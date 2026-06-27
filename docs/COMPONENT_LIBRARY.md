# Component Library

Reusable UI components live in `app/src/renderer/components/`.

## Initial Components

- Primary Button
- Secondary Button
- Icon Button
- Card
- Panel
- Sidebar
- Toolbar
- Audio Meter
- Camera Preview
- Timeline Marker
- Modal
- Toast
- Tooltip

## Rules

- Components consume active theme tokens.
- Components must expose accessible labels when needed.
- Components must not duplicate layout or visual code.
- Feature screens should compose components instead of recreating UI patterns.
- Component additions require Brand Guardian review.

## Current Status

Phase 1.5 creates the component skeleton and starts migrating the shell. Future phases should continue replacing screen-specific markup with these primitives before adding feature complexity.

