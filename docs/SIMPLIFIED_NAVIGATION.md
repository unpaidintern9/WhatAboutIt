# Simplified Navigation

Phase: 9D Simplify Live Studio Layout After Sony Fix

Status: implemented.

## Primary Navigation

The sidebar now emphasizes the core studio flow:

- Studio Setup
- Record
- Review
- Export

Secondary tools are intentionally collapsed into:

- Learn
- Settings
- More

## Collapsed Sidebar

- The sidebar has a persistent collapse control.
- The sidebar defaults to collapsed when no saved preference exists.
- Collapsed mode keeps icons visible and hides labels.
- The selected route is preserved while collapsing.
- The preference is saved in `StudioSettings.ui.sidebarCollapsed`.

## Validation

Automated app mount coverage verifies the collapsed default, the four-step workflow, the reduced secondary nav, and saved collapse preference behavior.
