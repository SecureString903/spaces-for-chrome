# Privacy Policy — Spaces (Workspaces for Chrome)

_Last updated: August 27, 2026_

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

## What the extension does NOT do

- No data is sent to any server. The extension makes no network requests
  of its own.
- No analytics, telemetry, crash reporting, or tracking of any kind.
- No accounts, no sign-in.
- Your browsing history is not read; the extension only sees the tabs and
  bookmarks it needs to save and restore your Spaces.

## Why each permission is needed

| Permission | Why |
| --- | --- |
| `tabs` | Read tab URLs and titles to save each Space, and open them again when you switch back. |
| `tabGroups` | Preserve tab-group names, colors, and collapsed state across switches. |
| `storage` | Keep your Spaces, snapshots, backups, and settings in the browser. |
| `sidePanel` | Show the Spaces panel — the extension's main interface. |
| `bookmarks` | Give each Space its own bookmarks bar by moving bookmarks between the bar and per-Space folders. Bookmarks are only ever moved, never deleted. |
| `favicon` | Display site icons next to saved tabs in the panel. |

## Data removal

Uninstalling the extension removes everything it stored, except your
bookmarks: any bookmarks filed under *Other Bookmarks → Spaces* remain in
your bookmarks (they are yours, and we never delete bookmarks).

## Changes and contact

If this policy ever changes, the update will appear in this repository
with a revision date. Questions or concerns: please open an issue at
<https://github.com/SecureString903/spaces-for-chrome/issues>.
