# Multi-Camera Validation

Status: architecture and ordering tests complete; physical multi-camera Sony validation blocked by missing Sony hardware.

## What Was Added

The app now has stable assignment helpers for:

- Camera 1
- Camera 2
- Camera 3

Camera ordering is persisted by slot, not by whatever order the operating system returns devices.

Tests cover:

- Three camera assignments
- Camera ordering persistence
- Per-camera gear settings save/load
- Friendly reconnect/signal/battery states

## Physical Devices Detected

The machine reported multiple camera-like devices, but no Sony camera was identifiable.

Detected camera-like devices:

- Integrated Camera
- HP True Vision HD Camera
- Integrated Camera
- USB Live camera

These may be useful for future non-Sony multi-camera validation, but Phase 7C specifically requires Sony validation and cannot claim it from these names.

## Current Result

Multiple Sony cameras at once: Not validated.

One Sony camera: Not validated.

Generic local physical camera: Previously validated in Phase 7B.5.

## Remaining Work

- Connect Sony Camera 1 and record a short test.
- Connect Sony Camera 2 and confirm it appears separately.
- Connect Sony Camera 3 if available.
- Confirm Camera 1/2/3 assignments do not swap after refresh/relaunch.
- Confirm per-camera reconnect state.
- Confirm per-camera recording readiness.
- Record and export a short test from each available physical Sony setup.
