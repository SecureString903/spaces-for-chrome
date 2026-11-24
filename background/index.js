// Service worker entry point: lifecycle, message routing, commands.

import { PALETTE, DEFAULT_SPACE_NAME, SCHEMA_VERSION } from '../shared/constants.js';
import * as state from './state.js';
import { initTracker } from './tracker.js';
import { switchSpace, cycleSpace, openTabsInNewWindow } from './switcher.js';
import {
  setBarOwner,
  renameSpaceFolder,
  onSpaceDeleted,
  swapBars,
  getSpacesRootId,
  getSpaceFolderMap,
  ensureSpaceFolder,
  loadFolderToBar,
  getBarFolderId,
  getBarNodeId,
  linkSpaceFolder
} from './bookmarks.js';

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

// Re-enabling bookmark management after 'off': the recorded bar owner is
// stale (the user may have switched Spaces and edited the bar while it was
// off). The bar's contents belong to whatever Space the user is looking at
// now.
let lastBookmarkMode = null;
state.getSettings().then((s) => (lastBookmarkMode = s.bookmarkMode));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    state.getSettings().then(async (s) => {
      const prevMode = lastBookmarkMode;
      lastBookmarkMode = s.bookmarkMode;
      if (prevMode === 'off' && s.bookmarkMode !== 'off') {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
        const map = await state.getWinMap();
        await setBarOwner(win && map[win.id] ? map[win.id] : null);
      }
    });
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  await state.updateWinMap((map) => {
    delete map[windowId];
    return map;
  });
});

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
      if (msg.linkFolderId) {
        const nodes = await chrome.bookmarks.get(msg.linkFolderId).catch(() => null);
        if (nodes?.[0] && !nodes[0].url) await linkSpaceFolder(id, msg.linkFolderId);
      }
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
      if (msg.patch && 'bookmarkFolderId' in msg.patch) {
        if (msg.patch.bookmarkFolderId) space.bookmarkFolderId = msg.patch.bookmarkFolderId;
        else delete space.bookmarkFolderId;
      }
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

    case 'getBookmarkContext': {
      // Everything the panel's Bookmarks section needs: the folders under
      // "Other Bookmarks / Spaces", the current Space, its mapped folder,
      // and its configured default view folder.
      const map = await state.getWinMap();
      const currentSpaceId = map[msg.windowId] ?? null;
      let rootId = null;
      let folders = [];
      try {
        rootId = await getSpacesRootId();
        const folderMap = await getSpaceFolderMap();
        const allSpaces = await state.getSpaces();
        const ownedIds = new Set(allSpaces.map((s) => folderMap[s.id]).filter(Boolean));
        folders = (await chrome.bookmarks.getChildren(rootId))
          .filter((n) => !n.url)
          .map((n) => ({ id: n.id, title: n.title, linked: ownedIds.has(n.id) }));
      } catch {
        return { ok: true, rootId: null, folders: [], currentSpaceId, defaultFolderId: null, barFolderId: null };
      }
      let defaultFolderId = null;
      if (currentSpaceId) {
        const spaceFolderId = (await getSpaceFolderMap())[currentSpaceId] ?? null;
        const spaces = await state.getSpaces();
        defaultFolderId = spaces.find((s) => s.id === currentSpaceId)?.bookmarkFolderId ?? spaceFolderId;
        if (defaultFolderId) {
          const node = await chrome.bookmarks.get(defaultFolderId).catch(() => null);
          if (!node) defaultFolderId = spaceFolderId;
        }
      }
      return {
        ok: true,
        rootId,
        folders,
        currentSpaceId,
        defaultFolderId,
        barFolderId: await getBarFolderId(),
        barNodeId: await getBarNodeId()
      };
    }

    case 'loadFolderToBar': {
      const map = await state.getWinMap();
      await loadFolderToBar(msg.folderId, map[msg.windowId] ?? null);
      return { ok: true };
    }

    case 'ensureSpaceFolder': {
      const folderId = await ensureSpaceFolder(msg.spaceId);
      return { ok: true, folderId };
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
