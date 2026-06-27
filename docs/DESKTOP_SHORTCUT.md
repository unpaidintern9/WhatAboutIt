# Desktop Shortcut

Phase 8A adds a local Windows launcher shortcut named `What About It Studio`.

## Recreate the Shortcut

From the project root:

```text
npm run create-shortcut
```

The root script delegates to the app script:

```text
cd app && npm run create-shortcut
```

The shortcut points to the local Electron runtime in `app/node_modules/electron/dist/electron.exe`, uses the app folder as the working directory, and passes `.` so Electron opens the local application entry point.

## Shortcut Location

The script asks Windows for the current user's Desktop folder and creates:

```text
What About It Studio.lnk
```

Validated Phase 8A path:

```text
C:\Users\mmcga\OneDrive\Desktop\What About It Studio.lnk
```

Manual validation on June 27, 2026 confirmed this shortcut opens the Electron app window titled `What About It? Studio`.

## Icon

The shortcut currently uses the local Electron executable icon because the project does not yet include a production `.ico` file. When a final app icon is approved, update `app/scripts/shortcut-paths.mjs` so `getShortcutIconPath` returns the branded `.ico` file.

## Future Installer Shortcuts

Electron Builder is prepared to create:

- Desktop shortcut
- Start Menu shortcut

The future installer shortcut name is:

```text
What About It Studio
```

This phase does not require packaging. It only prepares the installer config and creates the development desktop launcher.
