# Contributing

## Phase Rule

Do not begin Phase 2 device integration until Phase 1.75 quality gates pass.

## Before Work

- Read `docs/ARCHITECTURE.md`.
- Read `docs/CODING_STANDARDS.md`.
- Check the relevant plugin README.
- Check the Brand Guardian requirements.

## Before Commit

Run:

```bash
npm run verify
```

Do not commit if lint, typecheck, tests, theme validation, plugin validation, JSON validation, documentation validation, accessibility validation, or architecture validation fails.

## UI Work

All UI work must use theme tokens and component library primitives. Screens need a Brand Guardian score of 90+.

