// Live tab tracking: keeps the active Space's snapshot continuously current
// so switching away (or a crash) never loses state. Snapshots are debounced
// per window; windows mid-switch are skipped via the `switching` set.

import { getWinMap, captureWindow, getSpaceTabs, setSpaceTabs } from './state.js';

const timers = new Map();

// windowIds currently being switched by switcher.js — tracker must not
// snapshot the half-swapped tab set.
export const switching = new Set();

export function scheduleSnapshot(windowId) {
  if (windowId == null || windowId < 0) return;
  if (switching.has(windowId)) return;
  clearTimeout(timers.get(windowId));
  timers.set(windowId, setTimeout(() => snapshotNow(windowId), 400));
}

export async function snapshotNow(windowId) {
  try {
    if (switching.has(windowId)) return;
    const map = await getWinMap();
    const spaceId = map[windowId];
    if (!spaceId) return;
    const win = await chrome.windows.get(windowId).catch(() => null);
    if (!win || win.type !== 'normal') return;
    const prev = await getSpaceTabs(spaceId);
    const snapshot = await captureWindow(windowId, prev);
    if (!snapshot.tabs.length) return;
    await setSpaceTabs(spaceId, snapshot);
  } catch (e) {
    console.warn('Spaces: snapshot failed for window', windowId, e);
  }
}

export function initTracker() {
  chrome.tabs.onCreated.addListener((tab) => scheduleSnapshot(tab.windowId));
  chrome.tabs.onRemoved.addListener((tabId, info) => {
    if (!info.isWindowClosing) scheduleSnapshot(info.windowId);
  });
  chrome.tabs.onUpdated.addListener((tabId, changes, tab) => {
    if (
      changes.url ||
      changes.title ||
      changes.favIconUrl ||
      changes.pinned !== undefined ||
      changes.status === 'complete'
    ) {
      scheduleSnapshot(tab.windowId);
    }
  });
  chrome.tabs.onMoved.addListener((tabId, info) => scheduleSnapshot(info.windowId));
  chrome.tabs.onActivated.addListener((info) => scheduleSnapshot(info.windowId));
  chrome.tabs.onAttached.addListener((tabId, info) => scheduleSnapshot(info.newWindowId));
  chrome.tabs.onDetached.addListener((tabId, info) => scheduleSnapshot(info.oldWindowId));
  if (chrome.tabGroups) {
    chrome.tabGroups.onCreated.addListener((group) => scheduleSnapshot(group.windowId));
    chrome.tabGroups.onUpdated.addListener((group) => scheduleSnapshot(group.windowId));
    chrome.tabGroups.onMoved.addListener((group) => scheduleSnapshot(group.windowId));
    chrome.tabGroups.onRemoved.addListener((group) => scheduleSnapshot(group.windowId));
  }
}
