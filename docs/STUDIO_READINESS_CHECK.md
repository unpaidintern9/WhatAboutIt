# Studio Readiness Check

The studio readiness check runs before recording and answers one question:

Is Morgan ready to record right now?

The answer should be friendly and direct.

## User-Facing Examples

Ready state:

- Camera 1 Ready
- Camera 2 Ready
- Morgan Mic Ready
- Guest Mic Ready
- Storage Available
- Everything Ready!

Needs-attention state:

- Camera 2 Needs Attention
- Camera 3 Battery Low
- Guest Mic Needs Attention
- Needs Attention

## Rules

- Use plain language only.
- Do not show protocol names.
- Do not show driver or provider names.
- Do not mention brand-specific internals.
- Do not block ready cameras because another camera needs attention.
- Preserve Camera 1/2/3 assignment between launches.

## Current Implementation

The shared camera configuration layer can generate a `StudioReadinessReport` from:

- Camera assignments.
- Per-camera connection states.
- Microphone readiness.
- Storage availability.

This report is currently foundational and test-covered. Future phases can surface it more deeply in the recording workflow without changing the user-facing camera model.

## Recovery Behavior

When a camera loses health, the app should:

1. Try automatic reconnect if supported.
2. Keep recording with healthy devices when safe.
3. Warn with friendly language.
4. Preserve raw files.
5. Avoid technical details unless the user opens advanced settings.
