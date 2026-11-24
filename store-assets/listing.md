# Chrome Web Store listing — Spaces

Everything needed to fill in the Web Store developer dashboard.

## Name

Spaces — Workspaces for Chrome

## Summary (max 132 chars)

Swap your window between named workspaces — tabs, tab groups, and even the
bookmarks bar. Everything stays on your device.

## Category

Productivity → Workflow & Planning

## Description

Spaces brings Shift-style workspaces natively to Chrome. Each Space is a
named context — Work, Personal, Side Project — with its own tabs, tab
groups, and its own bookmarks bar. Switching Spaces saves and closes the
window's tabs and opens the new Space's tabs in their place: one clean
window per context.

WHAT IT DOES

• Swap-in-place switching — your tabs are saved before anything closes,
  and restored exactly as you left them: order, pinned tabs, tab groups
  (titles, colors, collapsed state), and the focused tab.
• Live auto-save — the active Space continuously tracks every change, so
  its state is always current.
• A bookmarks bar per Space — switching can swap the bar's contents
  through folders under Other Bookmarks, with four modes: every switch,
  follow the focused window, only for Spaces you've pinned a folder to,
  or hands-off. The extension moves bookmarks, never deletes them on
  its own.
• Bookmarks in the side panel — browse any Space's folder (or the bar
  itself), open, add, move, and organize bookmarks right in the panel,
  pin a default folder per Space, or load any folder onto the bar with
  one click. A sync-friendly alternative to bar swapping if you use
  several computers.
• Lazy loading — restored tabs load when you click them, so big Spaces
  switch instantly.
• Safety nets — rolling backups of every replaced tab list, restorable
  from the panel in one click.
• Keyboard switching — Ctrl+Shift+Period / Ctrl+Shift+Comma to cycle
  Spaces (customizable).
• Icons your way — give each Space a color, an emoji, a site's favicon,
  or an uploaded image.
• A Space-aware start page — the New Tab page shows a clock, search, and
  your link groups (per Space or shared), edited right on the page. Give
  a Space a homepage URL and new tabs in that Space go straight there.
  Optional extras (weather, reachability dots for homelab links) are off
  by default and clearly disclosed.

NOTE FOR MULTI-COMPUTER USE: Chrome syncs bookmarks, so bookmarks bar
swaps follow your profile to other computers. If you use several
computers with one Chrome profile, choose "Only for pinned Spaces" (the
bar moves only for Spaces you deliberately pin) or "Don't manage
bookmarks" in Options.

PRIVATE BY DESIGN

No accounts, no servers, no analytics. Your Spaces, tabs, and backups
never leave your computer. Only your preferences roam between your own
Chrome browsers, via Chrome's standard settings sync.

Open source: https://github.com/SecureString903/spaces-for-chrome

## Single-purpose description (dashboard field)

Spaces lets users organize their browser window into named workspaces and
switch between them: it saves and restores each workspace's tabs, tab
groups, and bookmarks-bar contents, and provides a workspace-aware New
Tab start page (per-workspace links and optional homepage redirect).

## Permission justifications (dashboard fields)

- **tabs** — Required to read the URLs and titles of the tabs in the
  current window so a workspace can be saved, and to open those tabs
  again when the user switches back to that workspace.
- **tabGroups** — Required to save and restore tab-group titles, colors,
  and collapsed state so groups survive workspace switches.
- **storage** — Required to store the user's workspaces, saved tab lists,
  backups, and settings locally in the browser.
- **sidePanel** — The extension's primary interface is a side panel for
  viewing and switching workspaces.
- **bookmarks** — Required for the per-workspace bookmarks bar (on a
  switch, the bar's bookmarks are moved into the outgoing workspace's
  folder and the incoming workspace's bookmarks are moved onto the bar)
  and for the side panel's bookmark browser, where users view, open,
  add, move, and explicitly delete their own bookmarks. The extension
  never deletes bookmarks on its own.
- **favicon** — Required to display site icons next to saved tabs in the
  side panel.

## Privacy disclosures (dashboard)

- Does not collect any user data. All data stays in extension storage on
  the user's device; no network requests are made by default (two
  opt-in start-page features — weather and reachability checks — are
  documented in the privacy policy).
- Privacy policy URL:
  https://github.com/SecureString903/spaces-for-chrome/blob/main/PRIVACY.md

## Assets

- Icon 128x128: `icons/icon128.png`
- Screenshots (1280x800): `store-assets/screenshot-*.png`
- Small promo tile (440x280): `store-assets/promo-tile.png`
