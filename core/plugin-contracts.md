# Plugin Contracts

Each plugin must provide:

- `id`
- `name`
- `version`
- `phase`
- `capabilities`
- `offlineSupport`
- `riskLevel`
- `initialize()`
- `healthCheck()`
- `shutdown()`

Plugins may also expose feature-specific contracts such as `startRecording`, `analyzeAudio`, `renderTimeline`, or `exportMedia`.

## Registration

Plugins register with the app shell through a manifest. The application calls only the contract, not implementation details.

## Replacement Rule

Any plugin must be replaceable by another implementation that satisfies the same contract.

