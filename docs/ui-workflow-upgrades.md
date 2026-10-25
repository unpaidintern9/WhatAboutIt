# Studio UI workflow upgrades

This follow-up implements the ten recommendations from the October 25, 2026 UI audit. It preserves the red, cream and brass identity and the existing recording, audio-treatment and export engines.

## Implemented behavior

1. **Review actions:** an independent header row replaces negative positioning over the workflow navigation. Episodes, collaboration, File, Auto Edit, Save and Export stay reachable. Export opens the options screen so the user can choose a format before starting work.
2. **Media and captions:** Video, Audio, Captions and Media are direct panel destinations. Media cards stack by container width; captions use one expanded editor with readable fields. Neither requires nested disclosure panels.
3. **Navigation:** the compact sidebar keeps labels, adds Episodes, and makes More a working tools page. Appearance, Hardware Test and Getting Started are reachable from normal navigation. Settings has shortcuts and Help has search and working destination links.
4. **Recording layout:** the camera wall adapts to one, two or three assigned cameras. Meters remain visible while input/headphone details are collapsed. Advanced audio, camera layouts and secondary tools remain available.
5. **Simple Review:** basic selection, split, range, undo and trim tools lead; advanced graphics/automation, audio controls and restoration remain available through Advanced tools and panel disclosures. Hiding the inspector returns space to the preview.
6. **Trustworthy status:** an active saved pause is excluded from recovery candidates and stopped-source warnings. Other saved/interrupted sessions remain visible. Setup distinguishes saved selections from a tested recording; system-default headphones are named correctly. Library badges derive recorded, paused/resumable and exported state from durable journals without rewriting project metadata.
7. **Readability:** controls use consistent readable fonts; navigation labels, media, captions, export extras and workspace settings use explicit text/background pairs. Theme colors remain available outside the focused editor.
8. **Keyboard dialog:** the episode picker has a named dialog, modal semantics, inert background, initial focus, Tab/Shift-Tab containment, safe Escape behavior and focus restoration. Active transfers require cancellation/completion before dismissal.
9. **Smaller windows:** Review actions wrap rather than disappear, inspectors can be hidden, tool labels remain visible and the timeline alone scrolls as needed. At narrower widths the inspector stacks below the preview. Home no longer gives decorative camera placeholders the first viewport.
10. **Export:** a sticky summary keeps format, quality, extras, destination and the primary action together. Extra source masters live under Advanced. Editor handoff still requires a destination and preserves compatible MP4/ProRes choices. Completion still exposes the verified export folder.

Cloud Collaboration also exposes the existing connection-settings window and disables Sync while disconnected. The Getting Started page gives an honest real-gear test workflow rather than advertising nonexistent sample-recording buttons. Completed Auto Edit shows a ready result rather than a wall of in-progress labels.

## Verification

Regression tests cover direct Review panel switching, caption entry without nested disclosures, inspector hiding, active saved-pause warnings, meter preservation and journal-derived library status. Existing recording, timeline, audio, export and cloud tests remain required.

Rendered verification uses the actual built Electron renderer and actual local recording/review/audio/export stores, with synthetic camera/audio and disposable episodes. The standalone Browser plugin is unavailable in this environment, so Playwright drives Electron. The harness supplies initial settings, device enumeration and native window plumbing. Desktop viewports include 1440×1000, 1024×768 and 800×600. It checks ordinary pointer access to header actions, media card geometry, modal keyboard behavior, recording/pause/resume/stop, captions, title editing, split/undo, processed audio, export and episode reopening. Screenshots remain outside the repository.

Physical camera/interface drivers, long-session endurance, live cloud transfers, native folder dialogs and actual Windows display scaling are separate acceptance checks. CSS reflow at a viewport size does not certify hardware, screen readers or full WCAG compliance. The packaged Windows media-runtime check remains required in CI.
