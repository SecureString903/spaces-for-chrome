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
  (open, close, navigate, reorder, pin, group), so its state is always
  current. Chrome tab groups are preserved: their title, color, collapsed
  state, and membership are saved and rebuilt on switch and restore.
- **Side panel switcher** — create, rename, recolor, reorder (drag & drop),
  and delete Spaces; see and jump between the current window's tabs.
- **Per-window Spaces** — each Chrome window has its own active Space. A
  Space can be live in one window at a time; switching to a Space that's
  open elsewhere focuses that window.
- **Per-Space bookmark bars** — each Space has its own bookmarks bar.
  On switch, the bar's contents are stashed into a hidden folder under
  **Other Bookmarks → Spaces** and the incoming Space's bookmarks take
  their place. Bookmarks are only ever moved, never deleted; deleting a
  Space leaves its folder behind as an archive. Note: Chrome has a single
  bar shared by all windows, so the bar tracks the most recently
  switched-to Space.
- **Keyboard shortcuts** — `Ctrl+Shift+.` / `Ctrl+Shift+,` cycle Spaces
  (customizable at `chrome://extensions/shortcuts`).
- **Safety nets** — tabs are saved *before* anything closes, and the last 15
  replaced/deleted tab lists are kept as rolling backups. The panel's
  Backups section can reopen any of them in a new window, save one as a
  new Space, or delete it.
- **Restart-safe** — after a browser restart, restored windows are re-matched
  to their Spaces by comparing tab URLs.

No build step, no external services — plain JavaScript, and no data ever
leaves the browser. Spaces are deliberately **per-machine**: your tabs,
Spaces, icons, and backups stay on this computer. Only the options-page
preferences roam between your Chrome installs via Chrome sync.

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
  state.js             Storage layer (local: Spaces, tab snapshots, icons, backups;
                       sync: settings; session: window→Space map)
  tracker.js           Debounced live tab tracking
  switcher.js          Swap-in-place switch engine + keyboard cycling
  bookmarks.js         Per-Space bookmark bar swapping
sidepanel/             Side panel UI (vanilla JS, light/dark aware)
shared/constants.js    Palette and shared constants
scripts/gen-icons.ps1  Regenerates icons/*.png
```

## Options

The gear icon in the panel (or the extension's Options entry) opens the
options page: bookmarks bar behavior (swap on switch / follow focused
window / off), lazy-load toggle, keep-window-open-on-last-tab-close with
a configurable homepage, and how many backups to keep. A welcome page
opens once on first install.

## Roadmap

- Chrome Web Store packaging (icons/screenshots/privacy policy)
