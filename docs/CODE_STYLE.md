# Code Style

## Formatting

Prettier defines formatting.

```bash
npm run format
```

Use `npm run format:write` from `app/` to apply formatting when needed.

## Linting

ESLint defines code quality rules for TypeScript, React, and scripts.

```bash
npm run lint
```

## Naming

- Components: PascalCase.
- Functions and variables: camelCase.
- Folders and Markdown files: kebab-case.
- Plugin IDs: kebab-case.

## Visual Values

Do not hardcode colors, font stacks, radius, padding, shadows, or animation speeds in feature components. Add a token to the active theme schema first.

