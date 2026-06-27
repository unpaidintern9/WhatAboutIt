# Learning Center Architecture

The Learning Center is an offline knowledge system tied to product features.

## Feature Learning Contract

Every feature must register:

- `walkthroughId`
- `helpArticleId`
- `tooltipIds`
- `searchKeywords`
- `practiceModeId`

## Search

Search indexes local Markdown and JSON metadata. Search must not require a remote service.

## Practice Mode

Practice Mode uses simulated local projects and branded placeholders. It must never require cameras, mics, or network access to explain a feature.

