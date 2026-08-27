// Service worker entry point: lifecycle, message routing, commands.

import { PALETTE, DEFAULT_SPACE_NAME, SCHEMA_VERSION } from '../shared/constants.js';
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
  // Stamp the storage format so future versions can migrate instead of
  // duck-typing shapes.
  chrome.storage.sync.set({ schemaVersion: SCHEMA_VERSION }).catch(() => {});
  chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION }).catch(() => {});
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
    await state.updateWinMap((m) => {
      m[win.id] = id;
      return m;
    });
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
        // A restart-restored window matches its Space at ~1.0; a lower bar
        // adopts unrelated windows whose tabs then overwrite the Space.
        if (score >= 0.8) candidates.push({ score, windowId: win.id, spaceId: space.id });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const map = {};
    const chosen = [];
    const usedWindows = new Set();
    const usedSpaces = new Set();
    for (const c of candidates) {
      if (usedWindows.has(c.windowId) || usedSpaces.has(c.spaceId)) continue;
      map[c.windowId] = c.spaceId;
      chosen.push(c);
      usedWindows.add(c.windowId);
      usedSpaces.add(c.spaceId);
    }
    // An imperfect adoption is about to be live-tracked over the Space's
    // saved tabs — keep a backup first so a mismatch is recoverable.
    for (const c of chosen) {
      if (c.score >= 0.999) continue;
      const saved = await state.getSpaceTabs(c.spaceId);
      if (saved.tabs.length) {
        const name = spaces.find((s) => s.id === c.spaceId)?.name ?? 'Space';
        await state.pushBackup(`Before re-attaching “${name}” after restart`, saved);
      }
    }
    await state.updateWinMap((current) =>
      Object.keys(current).length ? current : map
    );
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

// ---- Keep the window open when its last tab is closed (optional) ----
//
// Closing a tab directly reports isWindowClosing=false even when it's the
// last one. Two lines of defense:
//   1. Fast path: from in-memory caches, create a replacement tab the
//      instant the removal event fires, hoping to beat window teardown.
//   2. Resurrection: a direct last-tab close marks the window; if the
//      window dies anyway (teardown won, or the created tab landed in a
//      doomed window), windows.onRemoved sees the fresh marker, reopens a
//      window with the homepage, and re-attaches it to the Space.
// Closing the whole window (✕ / Ctrl+Shift+W) reports isWindowClosing=true
// for its tabs, never sets the marker, and is always left alone.

let cachedSettings = null;
const settingsReady = state.getSettings().then((s) => (cachedSettings = s));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    const prevMode = cachedSettings?.bookmarkMode;
    state.getSettings().then(async (s) => {
      cachedSettings = s;
      // Re-enabling bookmark management: the recorded bar owner is stale
      // (the user may have switched Spaces and edited the bar while it was
      // off). The bar's contents belong to whatever Space the user is
      // looking at now.
      if (prevMode === 'off' && s.bookmarkMode !== 'off') {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
        const map = await state.getWinMap();
        await setBarOwner(win && map[win.id] ? map[win.id] : null);
      }
    });
  }
});

const tabCounts = new Map();
// Last known geometry per window, so a resurrected window reappears in
// exactly the same place — the close+reopen then reads as a repaint.
const windowBounds = new Map();
const rememberBounds = (win) => {
  if (win.type !== 'normal') return;
  windowBounds.set(win.id, {
    left: win.left, top: win.top, width: win.width, height: win.height, state: win.state
  });
};
chrome.windows
  .getAll({ windowTypes: ['normal'], populate: true })
  .then((wins) => {
    for (const w of wins) {
      if (!tabCounts.has(w.id)) tabCounts.set(w.id, w.tabs.length);
      rememberBounds(w);
    }
  })
  .catch(() => {});
chrome.windows.onBoundsChanged.addListener(rememberBounds);
const bumpCount = (windowId, delta) => {
  const known = tabCounts.get(windowId);
  if (known !== undefined) tabCounts.set(windowId, Math.max(0, known + delta));
};
const reseedCount = (windowId) => {
  chrome.tabs.query({ windowId })
    .then((tabs) => tabCounts.set(windowId, tabs.length))
    .catch(() => {});
};
chrome.tabs.onCreated.addListener((tab) => bumpCount(tab.windowId, +1));
// Attach/detach race the windows.onCreated seeding query (a dragged-out tab
// fires both), so arithmetic double-counts; a fresh query is idempotent.
chrome.tabs.onAttached.addListener((tabId, info) => reseedCount(info.newWindowId));
chrome.tabs.onDetached.addListener((tabId, info) => reseedCount(info.oldWindowId));
// Seed counts for windows created after service-worker start — without
// this, new windows have no count and the fast path below can never run.
chrome.windows.onCreated.addListener((win) => {
  if (win.type !== 'normal') return;
  rememberBounds(win);
  reseedCount(win.id);
});

// windowId -> timestamp of a direct (isWindowClosing=false) last-tab close.
const pendingKeepAlive = new Map();

// After a replacement tab lands, confirm the window actually survived and
// clear the marker so a genuine window close right after isn't undone.
function armKeepAliveProbe(windowId) {
  setTimeout(async () => {
    const win = await chrome.windows.get(windowId).catch(() => null);
    if (win) pendingKeepAlive.delete(windowId);
  }, 500);
}

chrome.tabs.onRemoved.addListener((tabId, info) => {
  if (info.isWindowClosing) return;
  const known = tabCounts.get(info.windowId);
  const remaining = known !== undefined ? Math.max(0, known - 1) : undefined;
  if (known !== undefined) tabCounts.set(info.windowId, remaining);

  // Fast path: the count says that was the last tab and everything needed
  // is already in memory — call create with NO awaits in between, so it
  // reaches the browser before window teardown commits and the window
  // simply gets a fresh tab instead of closing.
  if (remaining === 0 && cachedSettings?.keepWindowOpen && !switching.has(info.windowId)) {
    pendingKeepAlive.set(info.windowId, Date.now());
    chrome.tabs.create({
      windowId: info.windowId,
      url: cachedSettings.homepageUrl || undefined
    })
      .then(() => armKeepAliveProbe(info.windowId))
      // Rejected create = the window is already tearing down. Don't wait
      // for windows.onRemoved — resurrect immediately.
      .catch(() => resurrectIfMarked(info.windowId));
    return;
  }
  keepWindowOpen(info.windowId, remaining);
});

async function keepWindowOpen(windowId, remainingHint) {
  try {
    if (!cachedSettings) await settingsReady;
    if (!cachedSettings?.keepWindowOpen) return;
    if (switching.has(windowId)) return;

    // Mark FIRST: on a cold start the tabs.query below races window
    // teardown, and windows.onRemoved must find the marker to resurrect.
    // This path only runs for direct tab closes (never window closes), so
    // if the window dies while the marker is set, it was the last tab.
    // A close that leaves tabs behind clears the marker just below.
    pendingKeepAlive.set(windowId, Date.now());

    let remaining = remainingHint;
    if (remaining === undefined) {
      const tabs = await chrome.tabs.query({ windowId }).catch(() => null);
      // A failed query means the window is already gone — lost race.
      remaining = tabs ? tabs.length : 0;
    }
    if (remaining > 0) {
      pendingKeepAlive.delete(windowId);
      return;
    }

    const url = cachedSettings.homepageUrl || undefined;
    const tab = await chrome.tabs.create({ windowId, url }).catch(() => null);
    if (tab) {
      armKeepAliveProbe(windowId);
    } else {
      // Window already tearing down — resurrect (parity with the fast path).
      await resurrectIfMarked(windowId);
    }
  } catch (e) {
    console.warn('Spaces: keep-window-open failed', e);
  }
}

// Space of each recently closed window, kept briefly so resurrection can
// re-attach a window whose mapping was already wiped.
const recentlyClosedSpaces = new Map();

chrome.windows.onRemoved.addListener(async (windowId) => {
  tabCounts.delete(windowId);
  await state.updateWinMap((map) => {
    if (map[windowId]) {
      recentlyClosedSpaces.set(windowId, map[windowId]);
      setTimeout(() => recentlyClosedSpaces.delete(windowId), 15000);
      delete map[windowId];
    }
    return map;
  });
  await resurrectIfMarked(windowId);
  windowBounds.delete(windowId);
});

// Reopen a window that died from a direct last-tab close: same geometry,
// same Space, homepage tab. The marker check makes this run at most once
// per closed window, whichever caller gets there first.
async function resurrectIfMarked(windowId) {
  let markedAt = pendingKeepAlive.get(windowId);
  if (!markedAt) {
    // On a cold start the slow path may still be setting the marker while
    // windows.onRemoved gets here first — give it one beat.
    await new Promise((resolve) => setTimeout(resolve, 250));
    markedAt = pendingKeepAlive.get(windowId);
  }
  if (!markedAt || Date.now() - markedAt > 3000) return;
  pendingKeepAlive.delete(windowId);
  if (!cachedSettings) await settingsReady;
  if (!cachedSettings?.keepWindowOpen) return;

  const spaceId = (await state.getWinMap())[windowId] ?? recentlyClosedSpaces.get(windowId);
  const opts = { url: cachedSettings.homepageUrl || undefined, focused: true };
  const bounds = windowBounds.get(windowId);
  // Always create with explicit coordinates — they pin the window to the
  // monitor the old one was on. chrome.windows.create can't combine
  // coordinates with a maximized state, so maximize in a second step.
  if (bounds && bounds.state !== 'minimized') {
    opts.left = bounds.left;
    opts.top = bounds.top;
    opts.width = bounds.width;
    opts.height = bounds.height;
  }
  const win = await chrome.windows.create(opts).catch(() => null);
  if (win && (bounds?.state === 'maximized' || bounds?.state === 'fullscreen')) {
    await chrome.windows.update(win.id, { state: 'maximized' }).catch(() => {});
  }
  if (win && spaceId) {
    await state.updateWinMap((m) => {
      delete m[windowId];
      // If another window claimed the Space while we were reopening,
      // leave the new window unattached rather than double-mapping.
      if (!Object.values(m).includes(spaceId)) m[win.id] = spaceId;
      return m;
    });
  }
  windowBounds.delete(windowId);
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
      return {
        ok: true,
        spaces,
        winMap: map,
        counts,
        backups: await state.getBackups(),
        icons: await state.getIcons(),
        settings: await state.getSettings()
      };
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
      if (msg.iconData) await state.setIcon(id, msg.iconData);
      if (msg.fromWindowId != null) {
        // "Save this window as a Space": adopt its live tabs.
        await state.updateWinMap((m) => {
          m[msg.fromWindowId] = id;
          return m;
        });
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
      if (msg.patch && 'iconData' in msg.patch) {
        await state.setIcon(space.id, msg.patch.iconData);
      }
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
      await state.setIcon(msg.id, null);
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
        await state.setSpaceTabs(id, {
          tabs: backup.tabs,
          groups: backup.groups ?? {},
          activeIndex: 0,
          updatedAt: Date.now()
        });
        return { ok: true, id, name };
      }
      const windowId = await openTabsInNewWindow(backup.tabs, backup.groups ?? {});
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
