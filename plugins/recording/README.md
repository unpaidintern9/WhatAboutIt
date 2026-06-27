# Recording Plugin

Owns future recording orchestration behind a simple start, pause, stop contract.

Phase: 3  
Status: browser MediaRecorder foundation active, hidden OBS adapter placeholder present

Must stay replaceable between browser MediaRecorder, libobs, OBS process control, FFmpeg capture, or a native Windows implementation.

The user must only see Record, Pause, Resume, Stop, local saving, and recovery language.
