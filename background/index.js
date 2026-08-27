// Service worker entry point: lifecycle, message routing, commands.

import { PALETTE, DEFAULT_SPACE_NAME } from '../shared/constants.js';
import * as state from './state.js';
import { initTracker, switching } from './tracker.js';
import { switchSpace, cycleSpace, openTabsInNewWindow } from './switcher.js';
import { setBarOwner, renameSpaceFolder, onSpaceDeleted, swapBars } from './bookmarks.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
initTracker();

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/welcome.html') }).catch(() => {});
  }
  const spaces = await state.getSpaces();
  if (spaces.length) return;
  // First install: adopt the focused window into a default Space so the
  // extension is immediately live-tracking something.
  const id = state.newId();
  await state.setSpaces([
    { id, name: DEFAULT_SPACE_NAME, color: PALETTE[0].hex, emoji: '', order: 0 }
  ]);
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (win) {
    const map = await state.getWinMap();
    map[win.id] = id;
    await state.setWinMap(map);
    await state.setSpaceTabs(id, await state.captureWindow(win.id));
  }
  // Whatever is on the bookmarks bar right now belongs to the first Space.
  await setBarOwner(id);
});

// After a browser restart (or an extension reload/update, which clears
// session storage) the window→Space map is empty. Re-associate windows to
// Spaces by comparing their tab URLs to each Space's saved snapshot
// (greedy best-match, one window per Space).
async function reassociateWindows() {
  try {
    const existing = await state.getWinMap();
    if (Object.keys(existing).length) return; // already associated
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'], populate: true });
    const spaces = await state.getSpaces();
    const candidates = [];
    for (const win of windows) {
      const urls = new Set(win.tabs.map((t) => t.url || t.pendingUrl).filter(Boolean));
      for (const space of spaces) {
        const saved = await state.getSpaceTabs(space.id);
        if (!saved.tabs.length) continue;
        const overlap = saved.tabs.filter((t) => urls.has(t.url)).length;
        const score = overlap / Math.max(urls.size, saved.tabs.length);
        if (score >= 0.5) candidates.push({ score, windowId: win.id, spaceId: space.id });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const map = {};
    const usedWindows = new Set();
    const usedSpaces = new Set();
    for (const c of candidates) {
      if (usedWindows.has(c.windowId) || usedSpaces.has(c.spaceId)) continue;
      map[c.windowId] = c.spaceId;
      usedWindows.add(c.windowId);
      usedSpaces.add(c.spaceId);
    }
    await state.setWinMap(map);
  } catch (e) {
    console.warn('Spaces: window re-association failed', e);
  }
}

chrome.runtime.onStartup.addListener(reassociateWindows);
// Also run on every service-worker cold start: covers extension
// reload/update, where onStartup never fires but the session map is gone.
// The empty-map guard makes routine worker wake-ups a no-op.
reassociateWindows();

// Optional "follow focus" bookmark mode: when the user focuses a window in
// a different Space, bring that Space's bookmarks onto the bar.
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const settings = await state.getSettings();
    if (settings.bookmarkMode !== 'follow') return;
    const map = await state.getWinMap();
    const spaceId = map[windowId];
    if (spaceId) swapBars(null, spaceId);
  } catch (e) {
    console.warn('Spaces: focus-follow bookmark swap failed', e);
  }
});

// Space of each recently closed window, kept briefly so the keep-window-open
// resurrection path can re-attach a window whose mapping was already wiped.
const recentlyClosedSpaces = new Map();

chrome.windows.onRemoved.addListener(async (windowId) => {
  const map = await state.getWinMap();
  if (map[windowId]) {
    recentlyClosedSpaces.set(windowId, map[windowId]);
    setTimeout(() => recentlyClosedSpaces.delete(windowId), 15000);
    delete map[windowId];
    await state.setWinMap(map);
  }
});

// ---- Keep the window open when its last tab is closed (optional) ----
//
// Closing a tab directly reports isWindowClosing=false even when it's the
// last one — the window teardown follows a beat later. Winning that race
// requires acting immediately, so settings and per-window tab counts are
// cached in memory and the replacement tab is created with a single API
// call. If the window dies anyway, it's resurrected with the homepage and
// re-attached to its Space. Closing the whole window (✕ / Ctrl+Shift+W)
// reports isWindowClosing=true and is always left alone.

let cachedSettings = null;
const settingsReady = state.getSettings().then((s) => (cachedSettings = s));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    state.getSettings().then((s) => (cachedSettings = s));
  }
});

const tabCounts = new Map();
chrome.windows
  .getAll({ windowTypes: ['normal'], populate: true })
  .then((wins) => {
    for (const w of wins) {
      if (!tabCounts.has(w.id)) tabCounts.set(w.id, w.tabs.length);
    }
  })
  .catch(() => {});
const bumpCount = (windowId, delta) => {
  const known = tabCounts.get(windowId);
  if (known !== undefined) tabCounts.set(windowId, Math.max(0, known + delta));
};
chrome.tabs.onCreated.addListener((tab) => bumpCount(tab.windowId, +1));
chrome.tabs.onAttached.addListener((tabId, info) => bumpCount(info.newWindowId, +1));
chrome.tabs.onDetached.addListener((tabId, info) => bumpCount(info.oldWindowId, -1));
chrome.windows.onRemoved.addListener((windowId) => tabCounts.delete(windowId));

chrome.tabs.onRemoved.addListener((tabId, info) => {
  if (info.isWindowClosing) return;
  const known = tabCounts.get(info.windowId);
  if (known !== undefined) tabCounts.set(info.windowId, Math.max(0, known - 1));
  keepWindowOpen(info.windowId, known !== undefined ? known - 1 : undefined);
});

async function keepWindowOpen(windowId, remainingHint) {
  try {
    if (!cachedSettings) await settingsReady;
    if (!cachedSettings?.keepWindowOpen) return;
    if (switching.has(windowId)) return;

    let remaining = remainingHint;
    if (remaining === undefined) {
      const tabs = await chrome.tabs.query({ windowId }).catch(() => null);
      // A failed query means the window is already gone — lost race.
      remaining = tabs ? tabs.length : 0;
    }
    if (remaining > 0) return;

    const url = cachedSettings.homepageUrl || undefined;
    try {
      await chrome.tabs.create({ windowId, url });
    } catch {
      // The window closed before our tab landed. Reopen it and re-attach
      // it to the Space it was showing.
      const spaceId = (await state.getWinMap())[windowId] ?? recentlyClosedSpaces.get(windowId);
      const win = await chrome.windows.create({ url, focused: true }).catch(() => null);
      if (win && spaceId) {
        const map = await state.getWinMap();
        delete map[windowId];
        map[win.id] = spaceId;
        await state.setWinMap(map);
      }
    }
  } catch (e) {
    console.warn('Spaces: keep-window-open failed', e);
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'next-space') cycleSpace(1);
  else if (command === 'prev-space') cycleSpace(-1);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
  return true; // async response
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'getState': {
      const spaces = await state.getSpaces();
      const map = await state.getWinMap();
      const counts = {};
      for (const s of spaces) {
        counts[s.id] = (await state.getSpaceTabs(s.id)).tabs.length;
      }
      return { ok: true, spaces, winMap: map, counts, backups: await state.getBackups() };
    }

    case 'switchSpace':
      return switchSpace(msg.windowId, msg.spaceId);

    case 'createSpace': {
      const spaces = await state.getSpaces();
      const id = state.newId();
      const space = {
        id,
        name: (msg.name || '').trim() || 'Untitled',
        color: msg.color || PALETTE[spaces.length % PALETTE.length].hex,
        emoji: (msg.emoji || '').trim(),
        order: spaces.length
      };
      await state.setSpaces([...spaces, space]);
      if (msg.fromWindowId != null) {
        // "Save this window as a Space": adopt its live tabs.
        const map = await state.getWinMap();
        map[msg.fromWindowId] = id;
        await state.setWinMap(map);
        await state.setSpaceTabs(id, await state.captureWindow(msg.fromWindowId));
      }
      return { ok: true, id };
    }

    case 'updateSpace': {
      const spaces = await state.getSpaces();
      const space = spaces.find((s) => s.id === msg.id);
      if (!space) return { ok: false, error: 'Space not found.' };
      const oldName = space.name;
      if (typeof msg.patch?.name === 'string') space.name = msg.patch.name.trim() || space.name;
      if (typeof msg.patch?.color === 'string') space.color = msg.patch.color;
      if (typeof msg.patch?.emoji === 'string') space.emoji = msg.patch.emoji.trim();
      await state.setSpaces(spaces);
      if (space.name !== oldName) renameSpaceFolder(space.id, space.name);
      return { ok: true };
    }

    case 'deleteSpace': {
      const map = await state.getWinMap();
      if (Object.values(map).includes(msg.id)) {
        return { ok: false, error: 'This Space is open in a window. Switch that window to another Space first.' };
      }
      const spaces = await state.getSpaces();
      if (spaces.length <= 1) return { ok: false, error: 'You need at least one Space.' };
      const space = spaces.find((s) => s.id === msg.id);
      if (!space) return { ok: false, error: 'Space not found.' };
      const snapshot = await state.getSpaceTabs(msg.id);
      if (snapshot.tabs.length) {
        await state.pushBackup(`Deleted Space “${space.name}”`, snapshot);
      }
      await state.setSpaces(
        spaces.filter((s) => s.id !== msg.id).map((s, i) => ({ ...s, order: i }))
      );
      await state.removeSpaceTabs(msg.id);
      await onSpaceDeleted(msg.id);
      return { ok: true };
    }

    case 'restoreBackup': {
      const backups = await state.getBackups();
      const backup = backups.find((b) => b.at === msg.at);
      if (!backup) return { ok: false, error: 'Backup not found.' };
      if (msg.mode === 'space') {
        const spaces = await state.getSpaces();
        const id = state.newId();
        const name =
          (msg.name || '').trim() ||
          `Restored ${new Date(backup.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
        await state.setSpaces([
          ...spaces,
          { id, name, color: PALETTE[spaces.length % PALETTE.length].hex, emoji: '', order: spaces.length }
        ]);
        await state.setSpaceTabs(id, { tabs: backup.tabs, activeIndex: 0, updatedAt: Date.now() });
        return { ok: true, id, name };
      }
      const windowId = await openTabsInNewWindow(backup.tabs);
      return windowId != null ? { ok: true } : { ok: false, error: 'Could not open a window.' };
    }

    case 'deleteBackup': {
      await state.removeBackup(msg.at);
      return { ok: true };
    }

    case 'reorderSpaces': {
      const spaces = await state.getSpaces();
      const byId = new Map(spaces.map((s) => [s.id, s]));
      if (msg.order.length !== spaces.length || !msg.order.every((id) => byId.has(id))) {
        return { ok: false, error: 'Stale reorder request.' };
      }
      await state.setSpaces(msg.order.map((id, i) => ({ ...byId.get(id), order: i })));
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}
