// Storage layer.
//
// - Space definitions live in chrome.storage.sync so they roam across the
//   user's Chrome installs (they're tiny).
// - Tab snapshots live in chrome.storage.local (too large for sync quotas).
// - The windowId -> spaceId map lives in chrome.storage.session: windowIds
//   are only meaningful within one browser run, and session storage survives
//   service-worker restarts but not browser restarts (index.js re-associates
//   windows to Spaces on startup).

import { MAX_BACKUPS } from '../shared/constants.js';

const K_SPACES = 'spaces';
const K_WINMAP = 'winmap';
const K_BACKUPS = 'backups';

const tabsKey = (spaceId) => `tabs:${spaceId}`;

export function newId() {
  return crypto.randomUUID();
}

export async function getSpaces() {
  const { [K_SPACES]: spaces = [] } = await chrome.storage.sync.get(K_SPACES);
  return spaces.sort((a, b) => a.order - b.order);
}

export async function setSpaces(spaces) {
  await chrome.storage.sync.set({ [K_SPACES]: spaces });
}

export async function getWinMap() {
  const { [K_WINMAP]: winmap = {} } = await chrome.storage.session.get(K_WINMAP);
  return winmap;
}

export async function setWinMap(winmap) {
  await chrome.storage.session.set({ [K_WINMAP]: winmap });
}

export async function getSpaceTabs(spaceId) {
  const key = tabsKey(spaceId);
  const result = await chrome.storage.local.get(key);
  return result[key] ?? { tabs: [], activeIndex: 0, updatedAt: 0 };
}

export async function setSpaceTabs(spaceId, snapshot) {
  await chrome.storage.local.set({ [tabsKey(spaceId)]: snapshot });
}

export async function removeSpaceTabs(spaceId) {
  await chrome.storage.local.remove(tabsKey(spaceId));
}

// Snapshot every tab in a window. `prev` (a prior snapshot for the same
// Space) lets us keep good titles/favicons for discarded tabs, whose live
// title can degrade to a bare URL.
export async function captureWindow(windowId, prev = null) {
  const tabs = await chrome.tabs.query({ windowId });
  const prevByUrl = new Map();
  if (prev) {
    for (const t of prev.tabs) {
      if (!prevByUrl.has(t.url)) prevByUrl.set(t.url, t);
    }
  }
  let activeIndex = tabs.findIndex((t) => t.active);
  if (activeIndex < 0) activeIndex = 0;
  return {
    tabs: tabs.map((t) => {
      const url = t.url || t.pendingUrl || 'chrome://newtab/';
      const remembered = t.discarded ? prevByUrl.get(url) : null;
      return {
        url,
        title: (remembered?.title || t.title || '').slice(0, 300),
        pinned: !!t.pinned,
        favIconUrl: remembered?.favIconUrl || t.favIconUrl || ''
      };
    }),
    activeIndex,
    updatedAt: Date.now()
  };
}

// Rolling safety net: keep the last N tab lists that were about to be
// replaced or deleted, so a bad switch never silently loses tabs.
export async function pushBackup(label, snapshot) {
  if (!snapshot.tabs.length) return;
  const { [K_BACKUPS]: backups = [] } = await chrome.storage.local.get(K_BACKUPS);
  backups.unshift({ label, at: Date.now(), tabs: snapshot.tabs });
  await chrome.storage.local.set({ [K_BACKUPS]: backups.slice(0, MAX_BACKUPS) });
}

export async function getBackups() {
  const { [K_BACKUPS]: backups = [] } = await chrome.storage.local.get(K_BACKUPS);
  return backups;
}
