// Service worker entry point: lifecycle, message routing, commands.

import { PALETTE, DEFAULT_SPACE_NAME } from '../shared/constants.js';
import * as state from './state.js';
import { initTracker } from './tracker.js';
import { switchSpace, cycleSpace } from './switcher.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
initTracker();

chrome.runtime.onInstalled.addListener(async () => {
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
});

// After a browser restart windowIds are new and session storage is empty.
// Re-associate restored windows to Spaces by comparing their tab URLs to
// each Space's saved snapshot (greedy best-match, one window per Space).
chrome.runtime.onStartup.addListener(async () => {
  try {
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
    console.warn('Spaces: startup re-association failed', e);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const map = await state.getWinMap();
  if (map[windowId]) {
    delete map[windowId];
    await state.setWinMap(map);
  }
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
      return { ok: true, spaces, winMap: map, counts };
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
      if (typeof msg.patch?.name === 'string') space.name = msg.patch.name.trim() || space.name;
      if (typeof msg.patch?.color === 'string') space.color = msg.patch.color;
      if (typeof msg.patch?.emoji === 'string') space.emoji = msg.patch.emoji.trim();
      await state.setSpaces(spaces);
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
