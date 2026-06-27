# Auto Edit Architecture

Auto Edit is not implemented in Phase 1.5. This document defines the future pipeline.

## Pipeline

Recording

Analysis

Transcript

Audio Analysis

Camera Analysis

Timeline Decisions

Draft Timeline

Review Layer

Export

## Stage Contracts

Each stage must be independently testable. A stage receives immutable input, writes structured output, reports confidence, and records explainable reasons.

## Stage Details

### Recording

Input: recorded local media and metadata.  
Output: media manifest with file paths, durations, tracks, markers, and capture notes.

### Analysis

Input: media manifest.  
Output: normalized analysis job bundle for audio, transcript, and optional camera stages.

### Transcript

Input: extracted audio.  
Output: timestamped transcript segments from a local transcription engine.

### Audio Analysis

Input: audio tracks.  
Output: silence, loudness, clipping, speaker activity, and pacing signals.

### Camera Analysis

Input: sampled frames or camera tracks.  
Output: black-frame, frozen-frame, scene-change, and optional activity signals.

### Timeline Decisions

Input: transcript, audio signals, camera signals, markers, and user mode.  
Output: proposed edit decisions with explanations and confidence.

### Draft Timeline

Input: edit decisions.  
Output: non-destructive draft timeline JSON.

### Review Layer

Input: draft timeline.  
Output: accepted, rejected, or modified edit decisions.

### Export

Input: approved timeline.  
Output: local export job for the Export Plugin.

## Non-Negotiables

- Original media is never modified.
- Every cut is reviewable.
- Every decision has a reason.
- Every stage can be tested in isolation.

