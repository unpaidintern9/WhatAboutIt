# Design Reference Assets

These files are reference assets only. They are not production assets and must not be shipped inside the application by default.

## Reference Files

### Morgan Headshot Reference

Path: `assets/references/branding/morgan-headshot-reference.jpeg`

This is a layout reference for Morgan-facing profile moments. Use it during design reviews to judge avatar placement, profile card sizing, welcome screen composition, and spacing around profile elements.

Do not embed this image into production builds by default. The application should use a branded placeholder when no user image exists, and profile photos should be user configurable.

### Studio UI Reference

Path: `assets/references/ui/studio-ui-reference.png`

This is a visual direction reference for the application interface. Use it for overall layout, spacing, navigation placement, proportions, visual hierarchy, mood, colors, textures, and typography inspiration.

Do not recreate this image pixel-for-pixel. Capture the feeling while using What About It? Studio's own component library, theme engine, and accessibility standards.

## Usage Rules

- Reference assets live outside `app/` so the desktop build does not include them accidentally.
- Production code must not import or link to `assets/references`.
- Brand Guardian reviews should compare screenshots against these references for mood and consistency.
- Screens should feel inspired by the approved references, not copied from them.
- No fake Morgan or guest photos should be generated from these references.

## Future Agent Reminder

These images exist to guide design judgment. They are not source material for production UI, generated people images, or exact duplication.
