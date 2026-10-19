# User themes

[README](../README.md) · [На русском](themes.ru.md)

Open **Settings → Theme → Open themes folder**. Create a subfolder with any name and add your theme's files there. Click
**Reload themes** after adding or editing files.

The `themes` folder is beside the installed executable. Windows portable builds use the folder beside the portable EXE,
and Linux AppImage builds use the folder beside the AppImage. On macOS it is beside `Trace.app`, outside the application
bundle. Development uses `themes` in the project root. The folder must be writable; opening it in Settings also creates
it if necessary. The full path is shown in Settings.

Each theme folder contains `theme.json`, a CSS stylesheet and any local images or fonts used by the stylesheet. Theme
files remain outside the application archive. The Windows installer preserves `themes` during replacement and uninstall.
Moving the application requires moving this folder too.

**Clubs** is a supplied light theme with the original Clubs design: green accents, a dark green navigation rail and soft
paper backgrounds. The Windows installer installs it in `themes/clubs` before the first launch. Portable builds and
other platforms create the package at startup when missing. Existing folders are never overwritten. Choose **Clubs** in
Settings. The original Trace appearance remains available as **Trace — Original**.

## Manifest

`theme.json` describes a CSS theme:

```json
{
  "format": "clubs/theme",
  "api_version": 1,
  "name": "My theme",
  "mode": "dark",
  "stylesheet": "style.css"
}
```

`format` and `api_version` identify the theme API shared with Clubs; keep `clubs/theme` for compatible packages. `name`
is the display name; optional `description` describes
the theme. `mode` is `dark` or `light`. `stylesheet` is a relative CSS path inside this theme folder, using `/` as the
separator.

To offer several variants from the same folder, replace `mode` with `variants`:

```json
"variants": [
{"id": "night", "name": "My theme — Night", "mode": "dark"
},
{
"id": "day", "name": "My theme — Day", "mode": "light"}
]
```

Variant IDs must be unique and stable. Settings lists each variant separately. The selection remembers the folder name
and variant ID, so renaming either makes the saved selection unavailable.

## Stylesheet

The application sets these attributes on `<html>` while the theme is active:

- `data-theme="custom"`
- `data-theme-mode="dark"` or `"light"`
- `data-theme-id` containing the folder name
- `data-theme-variant` containing the variant ID, if present

Use `:root[data-theme='custom']` for palette declarations. Mode and variant selectors can override them:

```css
:root[data-theme='custom'] {
  --theme-accent: #8ac6ad;
  --theme-accent-ink: #16251e;
  --theme-bg: #18231e;
  --theme-panel: #24352b;
  --theme-text: #edf4ec;
  --theme-muted: #b5c5b7;
}

:root[data-theme='custom'][data-theme-variant='day'] {
  --theme-bg: #f7f8f4;
  --theme-panel: #ffffff;
  --theme-text: #2c3f36;
  --theme-muted: #657568;
}
```

Available palette
variables: `--theme-accent`, `--theme-accent-ink`, `--theme-bg`, `--theme-panel`, `--theme-panel-alt`, `--theme-input`, `--theme-text`, `--theme-muted`, `--theme-faint`, `--theme-line`, `--theme-hover`, `--theme-canvas`, `--theme-active`, `--theme-shadow`, `--theme-font`.
Unspecified values use the selected mode's defaults. Palette changes cover the application panels, buttons, fields,
dialogs and visible diagram without changing library records.

CSS can also style existing components such
as `.rail`, `.topbar`, `.sidebar`, `.canvas`, `.inspector`, `.settings-card`, `.character-card` and `.modal`. The
built-in themes' artwork is not added to custom themes.

Images, fonts and imported CSS use ordinary paths relative to the stylesheet, for
example `url('./images/paper.svg')`, `url('./fonts/story.woff2')` or `@import './palette.css';`. Resources must remain
inside the same theme folder. Supported files are CSS, SVG, PNG, JPEG, WebP, GIF, WOFF, WOFF2, TTF and OTF. Theme source
files are limited to 2 MiB; images and fonts to 32 MiB. Theme packages use CSS; there is no JavaScript/TSX theme entry
point. Maploom themes need their manifest and application selectors adapted to the shared CSS theme API.

## Installation and removal

`themes` is excluded from Windows installer cleanup. Replacement and uninstall remove the application files while
retaining all theme folders. The optional delete-application-data action also leaves this folder intact. AppImage files
and macOS application bundles are replaced separately from their adjacent `themes` folder; Linux DEB packages do not
include user theme files in their payload.

The Windows regression script `scripts/check-themes-windows.ps1` checks an isolated NSIS installation, same-version
replacement, update mode, uninstall and installation after uninstall, comparing every theme file's SHA-256. Its
installer must be built under `.test-data`
with `appId=studio.trace.theme-lifecycle-test`, `productName=TraceThemeLifecycleTest`, no shortcuts and no launch after
installation. The script refuses other product identities and an existing lifecycle-test installation. Native
macOS/Linux installer lifecycle checks are separate from this Windows test.

## Reloading and missing files

**Reload themes** scans the folder and reapplies the selected stylesheet, including edits to its local resources. Themes
are also scanned at startup. No restart is required after editing files.

Invalid packages appear in **Theme loading errors**, while valid themes remain selectable. If the selected package or
variant disappears, the original appearance is used and the saved choice is retained. Restore the files and reload to
reactivate it, or select another theme. If a stylesheet fails to load, Settings reports the error and uses the original
appearance. Missing secondary images, fonts or CSS imports are reported by the browser and do not invalidate the
manifest.
