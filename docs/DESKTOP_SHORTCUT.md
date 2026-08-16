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

The shortcut points to the installed Windows app when available, or to `app/release/win-unpacked/What About It Studio.exe` after `npm run package:win`. Both targets are packaged applications, so in-app update checks remain available.

To intentionally create a development shortcut instead:

```text
npm run create-shortcut:dev
```

The development shortcut points to the local Electron runtime, uses the app folder as its working directory, and disables in-app updates.

## Shortcut Location

The script asks Windows for the current user's Desktop folder and creates:

```text
What About It Studio.lnk
```

Validated Phase 8A path:

```text
C:\Users\mmcga\OneDrive\Desktop\What About It Studio.lnk
```

Manual validation on June 27, 2026 confirmed this shortcut opens the Electron app window. Phase 8C updates the beta app window title to `What About It Studio`.

Phase 8C also validated installer-created shortcuts:

- Desktop shortcut: `C:\Users\mmcga\OneDrive\Desktop\What About It Studio.lnk`
- Start Menu shortcut: `C:\Users\mmcga\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\What About It Studio.lnk`

Both shortcuts launched the installed beta app.

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

Phase 8C adds Windows beta installer scripts. The default shortcut script preserves installer behavior by choosing the installed or packaged app. The explicit `create-shortcut:dev` command remains available for source-tree testing.

Phase 8C validation confirmed the NSIS installer created both shortcuts and both opened the installed app from:

```text
C:\Users\mmcga\AppData\Local\Programs\what-about-it-studio\What About It Studio.exe
```

## Icon Status

A final branded Windows `.ico` file is not yet available. The development shortcut uses the local Electron executable icon. The beta installer also needs an approved `.ico` before public beta.
