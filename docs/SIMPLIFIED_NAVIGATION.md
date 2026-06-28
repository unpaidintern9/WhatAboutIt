# Simplified Navigation

Phase: 9B Sony Live Preview + Simplify Studio Flow

Status: implemented.

## Primary Navigation

The sidebar now emphasizes the core studio flow:

- Studio
- Setup
- Record
- Review
- Export

Secondary tools moved lower in the sidebar:

- New Episode
- Auto Edit
- Hardware Test
- Theme Editor
- Learn
- Practice
- Settings

## Collapsed Sidebar

- The sidebar has a persistent collapse control.
- Collapsed mode keeps icons visible and hides labels.
- The selected route is preserved while collapsing.
- The preference is saved in `StudioSettings.ui.sidebarCollapsed`.

## Validation

Automated app mount coverage verifies that collapsing the sidebar applies the collapsed class and saves the preference.
