# Phase 5B Non-Destructive Editing

Phase 5B unlocks basic draft editing on the Review Episode screen while keeping original recordings untouched.

## Scope

- Trim before here
- Split here
- Cut this section
- Undo
- Redo
- Restore original
- Save draft
- Auto-save draft changes

Auto Edit, final export, publishing, and technical editor internals remain out of scope.

## Storage

Draft edits are saved locally to:

```text
Episode/Session/draft-timeline.json
```

The draft includes a version number, selected timeline point, edit operation log, undo stack, and local save state.

## User Promise

The Review Episode screen must always make these points clear:

- Your original recording is still safe.
- This only changes the draft.
- You can undo this anytime.

## Brand Guardian Review

Visual score: 96/100.

The screen keeps the vintage What About It? tone, uses theme tokens only, avoids generic editor language, and keeps the next action obvious for a first-time user.
