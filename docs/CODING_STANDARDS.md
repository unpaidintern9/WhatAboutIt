# Coding Standards

## Folder Structure

- `core/`: contracts, app events, policy, and domain interfaces.
- `plugins/`: replaceable feature implementations or placeholders.
- `services/`: orchestration around contracts.
- `app/`: Electron and React shell.
- `themes/`: source-of-truth theme tokens.
- `learning/`: offline learning content.
- `docs/`: decisions, plans, audits, and specs.

## Naming Conventions

- Use PascalCase for React components.
- Use camelCase for functions and variables.
- Use kebab-case for folders and Markdown files.
- Use explicit names over abbreviations.
- Plugin IDs use kebab-case.

## Documentation Rules

- Every new plugin needs a README.
- Every new service needs purpose, inputs, outputs, errors, and tests.
- Every dependency needs an audit before integration.
- Every user-facing feature needs learning hooks.

## Test Requirements

- Unit-test pure logic.
- Contract-test plugins.
- Integration-test filesystem behavior.
- Screenshot-review UI with the Brand Guardian.
- Verify offline launch and offline save paths.

## Accessibility Requirements

- Keyboard access for all controls.
- Visible focus states.
- Readable contrast.
- Semantic labels for icon-only buttons.
- No text trapped in images.
- Friendly empty and error states.

## Error Handling Patterns

- Technical errors go to logs.
- User messages are friendly and actionable.
- Do not expose stack traces in the UI.
- Preserve local data on failure.
- Prefer recoverable states over dead ends.

## Logging Standards

- Logs must be local.
- Logs must avoid recording sensitive guest notes by default.
- Logs include timestamp, source, event, severity, and details.
- Long-running jobs emit progress events.

## Visual Standards

- No hardcoded visual values in components.
- Use active theme tokens for color, spacing, type, radius, shadows, borders, and animation speeds.
- Every screen needs a Brand Guardian score of 90+ before approval.

