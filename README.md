# Spaces — Workspaces for Chrome

Shift-style Spaces, natively in Chrome. Each Space is a named context (Work,
Personal, Project X…) with its own set of tabs. Switching Spaces saves and
closes the current window's tabs and opens the new Space's tabs in their
place — one clean window per context.

## Features

- **Swap-in-place switching** — the window's tabs are saved, closed, and
  replaced by the target Space's tabs. Restored tabs load lazily (on click)
  so big Spaces don't hammer your machine.
- **Live auto-save** — the active Space's tab list is continuously tracked
  (open, close, navigate, reorder, pin), so its state is always current.
- **Side panel switcher** — create, rename, recolor, reorder (drag & drop),
  and delete Spaces; see and jump between the current window's tabs.
- **Per-window Spaces** — each Chrome window has its own active Space. A
  Space can be live in one window at a time; switching to a Space that's
  open elsewhere focuses that window.
- **Keyboard shortcuts** — `Ctrl+Shift+.` / `Ctrl+Shift+,` cycle Spaces
  (customizable at `chrome://extensions/shortcuts`).
- **Safety nets** — tabs are saved *before* anything closes, and the last 15
  replaced/deleted tab lists are kept as rolling backups in storage.
- **Restart-safe** — after a browser restart, restored windows are re-matched
  to their Spaces by comparing tab URLs.

No build step, no external services — plain JavaScript, and no data ever
leaves the browser.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the Spaces toolbar icon to open the side panel.

On install, your current window is adopted into a default **General** Space.

## Project layout

```
manifest.json          MV3 manifest
background/            Service worker
  index.js             Lifecycle, message routing, commands, startup re-association
  state.js             Storage layer (sync: Space defs, local: tab snapshots + backups,
                       session: window→Space map)
  tracker.js           Debounced live tab tracking
  switcher.js          Swap-in-place switch engine + keyboard cycling
sidepanel/             Side panel UI (vanilla JS, light/dark aware)
shared/constants.js    Palette and shared constants
scripts/gen-icons.ps1  Regenerates icons/*.png
```

## Roadmap

- Backups UI (restore a replaced/deleted tab list)
- Onboarding & options page
- Chrome Web Store packaging (icons/screenshots/privacy policy)
