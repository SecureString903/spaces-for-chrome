# Manual test checklist

Run before every Web Store release (~20 minutes). Steps assume a loaded
build with at least two Spaces. Items marked **[R]** guard against a
specific regression that has actually occurred.

## 1. Fresh install & onboarding

- [ ] Load unpacked into a clean Chrome profile: the welcome page opens
      automatically, once.
- [ ] Current window is adopted into a **General** Space; the panel chip
      shows it.
- [ ] Welcome page's "Open the Spaces panel" button opens the side panel.
- [ ] No errors on the extension card at `chrome://extensions`.

## 2. Space create / edit / delete

- [ ] Create a Space: name, preset color; it appears in the list.
- [ ] Custom color well opens Chrome's picker; hex/RGB entry works and the
      chosen color shows on the Space row.
- [ ] Icon picker: emoji grid sets an emoji; "site favicon" of a visited
      site produces its icon; "Upload image…" accepts a PNG/JPG and shows
      cropped-square; "No icon" reverts to the color dot.
- [ ] **[R]** Compound emoji (👨‍👩‍👧, flag, skin tone) can be entered via
      Win+. and survives save.
- [ ] Creating a Space named like an **orphaned** folder under
      *Other Bookmarks → Spaces* shows the "Link existing bookmark folder"
      offer; creating with it checked adopts the folder (no duplicate
      appears later). Named like a folder a live Space owns → no offer.
- [ ] Rename a Space → its folder under *Other Bookmarks → Spaces* renames.
- [ ] Drag-reorder Spaces; order survives a panel close/reopen.
- [ ] Delete guards: cannot delete the last Space; cannot delete a Space
      active in any window (clear message). Deleting an inactive Space
      keeps its bookmark folder and pushes its tabs to Backups.

## 3. Switching

- [ ] Round-trip fidelity: arrange ~6 tabs (1 pinned, distinct order,
      non-first tab focused), switch away and back — order, pinned state,
      and focused tab all restored.
- [ ] **[R]** Lazy load: restored background tabs sit unloaded and load on
      click. No tab ever shows an endless spinner or reloads to blank.
- [ ] Switching to an empty Space yields a single New Tab page.
- [ ] **[R]** Double-click two different Spaces quickly: second click gets
      the "switch already in progress" toast; no Space's saved tabs end up
      mixed.
- [ ] `Ctrl+Shift+.` / `Ctrl+Shift+,` cycle Spaces in the focused window.
- [ ] Clicking the Space that's live in another window focuses that window
      instead of duplicating it.

## 4. Tab groups **[R]**

- [ ] Put 2–3 tabs in a named, colored group; collapse a second group.
- [ ] Switch away and back: group membership, title, color restored;
      the collapsed group returns collapsed (unless it holds the focused
      tab).
- [ ] Renaming/recoloring a group, then switching away/back, keeps the
      change (auto-save tracked it).

## 5. Live auto-save

- [ ] Open/close/navigate tabs, then switch away and back — the Space
      reflects the exact final state.
- [ ] Tab counts on Space rows update as tabs change elsewhere.

## 6. Multiple windows

- [ ] Open a second window: banner says it isn't in a Space.
- [ ] "Save window as a Space" adopts its live tabs (checkbox on).
- [ ] Clicking an existing unused Space from the unmapped window warns,
      then swaps in (old tabs land in Backups).
- [ ] Each window switches independently; closing a window frees its Space
      for other windows.

## 7. Bookmarks

Mode: **Swap on switch**
- [ ] Switching Spaces swaps the bar; bookmarks are findable under
      *Other Bookmarks → Spaces → \<name\>* while stashed.
- [ ] **[R]** Two same-named Spaces keep separate folders — no merging.
- [ ] 📌 pin a folder for the current Space: bar updates immediately, and
      switching away/back brings that folder to the bar.
- [ ] ⬆ loads the viewed folder onto the bar on the fly; the previous bar
      contents return to the folder they came from on the next swap.

Mode: **Follow focused window** (two windows, different Spaces)
- [ ] Focusing each window brings its Space's bookmarks to the bar; rapid
      alt-tabbing settles on the last-focused window's Space (no hang).

Mode: **Only for pinned Spaces**
- [ ] Switching to a Space with a 📌 pinned folder loads it onto the bar;
      switching to an unpinned Space leaves the bar exactly as it was.
- [ ] Pinning a folder while in that Space applies to the bar immediately.

Any managed mode
- [ ] Closing the last window of the Space that owns the bar empties the
      bar (bookmarks return to the Space's folder); a new window then
      shows no Space bookmarks. Resuming the Space brings them back.
- [ ] Restart with "continue where you left off": once windows re-attach,
      the focused window's Space bookmarks return to the bar.

Mode: **Don't manage bookmarks**
- [ ] Switching Spaces leaves the bar untouched.
- [ ] Turning management back on and switching re-anchors cleanly (bar
      contents attributed to the Space focused at re-enable).

Panel section
- [ ] Dropdown lists the folders under *Spaces*; drill into a subfolder
      and back out with ◀.
- [ ] Click opens in the active tab; Ctrl+click opens a background tab.
- [ ] ★ bookmarks the current tab into the viewed folder.
- [ ] A folder whose contents are on the bar shows the "currently on the
      bookmarks bar" note instead of a bare "empty".
- [ ] "Bookmarks bar" is selectable in the dropdown; ↪ on a row moves the
      item into a chosen Space folder (and vice versa). Pin/⬆ refuse the
      bar itself with a clear toast.
- [ ] ✕ deletes a bookmark instantly (toast); deleting a folder asks for
      confirmation first.
- [ ] 📌 toggles: clicking it on the pinned folder clears the pin and the
      Space falls back to its own folder.

## 7b. Start page (New Tab)

- [ ] New tab shows the start page with the current Space's chip; an
      unmapped window shows no chip but still works.
- [ ] Resume: close a Space window's last tab, open a new window — the
      start page offers "Resume \<that Space\>" first and a pill for every
      other Space. Clicking a free Space resumes it with its saved tabs
      (the page re-renders with its chip, or its homepage loads); clicking
      a Space live in another window focuses that window. In a window with
      non-new-tab tabs, resuming asks for confirmation first.
- [ ] **[R]** After switching Spaces via the panel, the new window's start
      page shows the Space's chip — never "This window isn't in a Space".
- [ ] **[R]** A fresh blank window is never silently adopted into a Space
      whose snapshot is just a new tab (reload the extension with such a
      window open: it stays unmapped).
- [ ] ✎ Edit: add a group (it lands in the current page's scope), add
      links, delete a link and a group; changes survive a new tab.
- [ ] Scopes: the group dropdown moves a group between "Everywhere",
      "Outside Spaces", and a specific Space — a Space group only shows
      in its Space, an Outside-Spaces group only on the generic page,
      an Everywhere group on all of them. Editing the generic page never
      changes what a Space shows (and vice versa), except for Everywhere
      groups.
- [ ] Size: the width dropdown (auto / 2 columns / full width) takes
      effect immediately; a lone full-width group fills the row instead
      of condensing left.
- [ ] Order: ▲/▼ move a group one slot, including past a group from
      another scope (e.g. a Space group above an Everywhere group); the
      order survives a new tab.
- [ ] Set a homepage URL on a Space: Ctrl+T in that Space goes straight
      there; opening the new tab page with `#edit` bypasses the redirect.
- [ ] With weather/status unset (defaults), the page makes zero network
      requests (DevTools Network tab stays empty apart from extension
      resources).
- [ ] Opt-ins: weather coords show the forecast; "status dots" groups show
      up/down with the footer summary when reachability is enabled.

## 8. Backups

- [ ] Every switch adds a backup labeled with the outgoing Space.
- [ ] Expanding a backup lists its tabs with favicons.
- [ ] ↗ opens the backup in a new (unmapped) window, lazy-loaded.
- [ ] ＋ creates a "Restored …" Space with those tabs.
- [ ] ✕ deletes after confirmation.
- [ ] Options → backup retention count is honored (set 2, make 3 switches,
      only 2 remain).

## 9. Restart & lifecycle

- [ ] Quit Chrome fully and reopen (with "continue where you left off"):
      windows re-attach to their Spaces; panel chip is correct.
- [ ] **[R]** Reload the extension from `chrome://extensions`: windows
      re-associate; no orphaned "not in a Space" banners for restored
      windows.
- [ ] **[R]** A scratch window sharing only *some* tabs with a closed Space
      is NOT adopted into it (adoption needs a strong match, and imperfect
      adoptions appear in Backups first).
- [ ] Leave Chrome idle 2+ minutes (service worker sleeps), then switch
      Spaces — works identically.

## 10. Options

- [ ] Every control persists across an options-page reload.
- [ ] Chip style "Icon only" shows just the icon in the header (falls back
      to the name for icon-less Spaces); "Name and color" shows both.
- [ ] **[R]** Long Space names ellipsize in the header instead of
      collapsing to one letter.
- [ ] Lazy-load off: a switch loads every restored tab immediately.

## 11. Regression watchlist (quick)

- [ ] **[R]** Closing the last tab of a window simply closes the window —
      no phantom tabs, no window reopening (keep-window-open was removed).
- [ ] **[R]** Closing one of several tabs never spawns an extra tab.
- [ ] Uninstall/reinstall: bookmarks under *Other Bookmarks → Spaces*
      survive untouched.
