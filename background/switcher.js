// The switch engine: swap-in-place Space switching.
//
// Order of operations is chosen so tabs are never lost:
//   1. Save the outgoing tab set (to its Space, and to the rolling backups).
//   2. Create the incoming Space's tabs (inactive).
//   3. Activate the target tab.
//   4. Only then close the old tabs.
//   5. Discard the non-active new tabs so a big Space doesn't load all at once.
//
// Invariant: a Space can be active in at most one window. Switching to a
// Space that's showing in another window focuses that window instead.

import {
  getSpaces,
  getWinMap,
  setWinMap,
  getSpaceTabs,
  setSpaceTabs,
  captureWindow,
  pushBackup
} from './state.js';
import { switching, snapshotNow } from './tracker.js';
import { swapBars } from './bookmarks.js';

export async function switchSpace(windowId, targetSpaceId) {
  const map = await getWinMap();
  const currentSpaceId = map[windowId];
  if (currentSpaceId === targetSpaceId) return { ok: true, noop: true };

  // If the target Space is live in another window, focus that window.
  for (const [wid, sid] of Object.entries(map)) {
    if (sid === targetSpaceId && Number(wid) !== windowId) {
      const win = await chrome.windows.get(Number(wid)).catch(() => null);
      if (win) {
        await chrome.windows.update(Number(wid), { focused: true });
        return { ok: true, focusedOtherWindow: true };
      }
      delete map[wid]; // stale entry from a closed window
    }
  }

  const spaces = await getSpaces();
  const target = spaces.find((s) => s.id === targetSpaceId);
  if (!target) return { ok: false, error: 'Space not found.' };

  switching.add(windowId);
  try {
    const oldTabs = await chrome.tabs.query({ windowId });
    const oldIds = oldTabs.map((t) => t.id).filter((id) => id != null);

    // 1. Save outgoing state before touching anything.
    const prev = currentSpaceId ? await getSpaceTabs(currentSpaceId) : null;
    const outgoing = await captureWindow(windowId, prev);
    if (currentSpaceId) {
      await setSpaceTabs(currentSpaceId, outgoing);
      const name = spaces.find((s) => s.id === currentSpaceId)?.name ?? 'a Space';
      await pushBackup(`Before switching away from “${name}”`, outgoing);
    } else {
      await pushBackup('Window tabs replaced by a Space switch', outgoing);
    }

    // 2. Create the incoming tabs.
    const saved = await getSpaceTabs(targetSpaceId);
    let list = saved.tabs;
    if (!list.length) list = [{ url: 'chrome://newtab/', pinned: false }];

    const created = [];
    for (const t of list) {
      let tab = null;
      try {
        tab = await chrome.tabs.create({
          windowId,
          url: t.url,
          pinned: !!t.pinned,
          active: false
        });
      } catch {
        // Some URLs can't be created directly (e.g. other extensions' pages);
        // fall back to a blank tab rather than dropping the slot.
        tab = await chrome.tabs.create({ windowId, pinned: !!t.pinned, active: false }).catch(() => null);
      }
      if (tab) created.push(tab);
    }
    if (!created.length) {
      const tab = await chrome.tabs.create({ windowId, active: false }).catch(() => null);
      if (tab) created.push(tab);
    }
    if (!created.length) {
      return { ok: false, error: 'Could not open the Space’s tabs.' };
    }

    // 3. Activate before removing, so the window never lands on a random tab.
    const activeIndex = Math.min(Math.max(saved.activeIndex ?? 0, 0), created.length - 1);
    await chrome.tabs.update(created[activeIndex].id, { active: true }).catch(() => {});

    // 4. Close the outgoing tabs.
    if (oldIds.length) await chrome.tabs.remove(oldIds).catch(() => {});

    // 5. Lazy-load: discard everything except the active tab.
    for (let i = 0; i < created.length; i++) {
      if (i !== activeIndex) discardWhenCommitted(created[i].id);
    }

    map[windowId] = targetSpaceId;
    await setWinMap(map);

    // Bring this Space's bookmarks onto the (global) bookmarks bar.
    await swapBars(currentSpaceId ?? null, targetSpaceId);
    return { ok: true };
  } finally {
    switching.delete(windowId);
    // Let tab churn settle, then record the fresh state.
    setTimeout(() => snapshotNow(windowId), 800);
  }
}

// Discarding a tab before its navigation has committed leaves it with no URL
// to restore — a permanently stuck, spinner-forever tab. Wait until Chrome
// has committed the URL (tab.url becomes non-empty), then discard. If commit
// never arrives, leave the tab alone and let it load normally.
function discardWhenCommitted(tabId) {
  const cleanup = () => {
    chrome.tabs.onUpdated.removeListener(listener);
    clearTimeout(timer);
  };
  const tryDiscard = (tab) => {
    if (tab.active) {
      cleanup();
      return true; // user already went there — let it load
    }
    if (tab.url && tab.url !== 'about:blank') {
      cleanup();
      chrome.tabs.discard(tabId).catch(() => {});
      return true;
    }
    return false;
  };
  const listener = (id, changes, tab) => {
    if (id === tabId) tryDiscard(tab);
  };
  const timer = setTimeout(cleanup, 15000);
  chrome.tabs.onUpdated.addListener(listener);
  // The navigation may have committed before the listener attached.
  chrome.tabs.get(tabId).then(tryDiscard).catch(cleanup);
}

// Open a saved tab list in a fresh window (used by backup restore). The
// window is not attached to any Space; the side panel's banner offers to
// save it as one. Non-active tabs load lazily.
export async function openTabsInNewWindow(tabs) {
  if (!tabs.length) return null;
  let win = null;
  try {
    win = await chrome.windows.create({ url: tabs[0].url, focused: true });
  } catch {
    win = await chrome.windows.create({ focused: true }).catch(() => null);
  }
  if (!win) return null;
  const firstTab = win.tabs?.[0];
  if (tabs[0].pinned && firstTab) {
    await chrome.tabs.update(firstTab.id, { pinned: true }).catch(() => {});
  }
  for (let i = 1; i < tabs.length; i++) {
    const t = tabs[i];
    let tab = null;
    try {
      tab = await chrome.tabs.create({ windowId: win.id, url: t.url, pinned: !!t.pinned, active: false });
    } catch {
      tab = await chrome.tabs.create({ windowId: win.id, active: false }).catch(() => null);
    }
    if (tab) discardWhenCommitted(tab.id);
  }
  return win.id;
}

// Keyboard cycling. Only acts on windows already in a Space (cycling an
// unadopted window would replace tabs the user never asked us to manage),
// and skips Spaces that are live in other windows.
export async function cycleSpace(direction) {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (!win) return;
  const map = await getWinMap();
  const currentSpaceId = map[win.id];
  if (!currentSpaceId) return;
  const spaces = await getSpaces();
  if (spaces.length < 2) return;

  const inOtherWindow = (spaceId) =>
    Object.entries(map).some(([wid, sid]) => sid === spaceId && Number(wid) !== win.id);

  const idx = spaces.findIndex((s) => s.id === currentSpaceId);
  const n = spaces.length;
  for (let step = 1; step < n; step++) {
    const candidate = spaces[(((idx + direction * step) % n) + n) % n];
    if (candidate.id === currentSpaceId || inOtherWindow(candidate.id)) continue;
    await switchSpace(win.id, candidate.id);
    return;
  }
}
