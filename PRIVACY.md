# Privacy Policy — Spaces (Workspaces for Chrome)

_Last updated: November 24, 2026_

## The short version

Spaces does not collect, transmit, sell, or share any data. Everything the
extension stores stays inside your browser, on your computer.

## What the extension stores, and where

Spaces stores the following data using Chrome's built-in extension storage,
entirely on your device:

- **Your Spaces** — names, colors, emoji, and custom icons you choose.
- **Tab snapshots** — the URLs and titles of the tabs in each Space, so
  they can be restored when you switch.
- **Tab group details** — titles, colors, and collapsed state, so groups
  can be rebuilt on switch.
- **Backups** — rolling copies of recently replaced tab lists, kept as a
  safety net.
- **Bookmark folder mappings** — which hidden folder under
  *Other Bookmarks → Spaces* belongs to which Space.

Your **options-page preferences** (and nothing else) are saved with
`chrome.storage.sync`, which means Chrome itself may sync them between
your own signed-in Chrome browsers. This is Chrome's standard settings
sync — the data goes to your Google account the same way your other
Chrome settings do, and never to us.

- **Start-page link groups** — the names and URLs of the links you add to
  the Space-aware New Tab page.

## What the extension does NOT do

- No data is sent to any server by default. The extension makes no network
  requests of its own, with two strictly opt-in exceptions described in
  the next section.
- No analytics, telemetry, crash reporting, or tracking of any kind.
- No accounts, no sign-in.
- Your browsing history is not read; the extension only sees the tabs and
  bookmarks it needs to save and restore your Spaces.

## Optional start-page features (off by default)

The Space-aware New Tab page has two features that make network requests
**only if you turn them on** in Options:

- **Weather** — if you enter coordinates, the start page requests the
  forecast from `api.open-meteo.com`. Only the coordinates you typed are
  sent; no account, no identifiers, no other data.
- **Reachability dots** — if enabled, link groups you mark with "status
  dots" send a lightweight request to **the URLs you yourself added** (for
  example your homelab services) to show whether they're up. No other
  hosts are ever contacted.

Leave both unconfigured and the extension makes no network requests at all.

## Why each permission is needed

| Permission | Why |
| --- | --- |
| `tabs` | Read tab URLs and titles to save each Space, and open them again when you switch back. |
| `tabGroups` | Preserve tab-group names, colors, and collapsed state across switches. |
| `storage` | Keep your Spaces, snapshots, backups, and settings in the browser. |
| `sidePanel` | Show the Spaces panel — the extension's main interface. |
| `bookmarks` | Give each Space its own bookmarks bar by moving bookmarks between the bar and per-Space folders, and power the panel's bookmark browser (view, add, move). The extension never deletes a bookmark on its own — the only deletions are ones you explicitly make with the panel's delete buttons. |
| `favicon` | Display site icons next to saved tabs in the panel. |

## Data removal

Uninstalling the extension removes everything it stored, except your
bookmarks: any bookmarks filed under *Other Bookmarks → Spaces* remain in
your bookmarks. They are yours — the extension never deletes a bookmark
except when you explicitly delete one yourself in the panel.

## Changes and contact

If this policy ever changes, the update will appear in this repository
with a revision date. Questions or concerns: please open an issue at
<https://github.com/SecureString903/spaces-for-chrome/issues>.
