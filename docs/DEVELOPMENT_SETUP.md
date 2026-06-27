# Development Setup

## Required Toolchain

Install Node.js LTS. No other manual setup should be required for app development.

Verified on 2026-06-27:

- Node.js: `v24.18.0`
- npm: `11.16.0`

Git is also required to clone the repository.

## One-Command Setup

From the repository root:

```bash
npm run setup
```

This installs app dependencies from `app/package-lock.json`.

## Common Commands

```bash
npm run dev
npm run verify
npm run build
npm run package
```

PowerShell note: if `npm` is blocked by execution policy, use `npm.cmd` for the same commands.

## Quality Gate

No commit should be created unless this passes:

```bash
npm run verify
```

