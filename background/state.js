// Storage layer.
//
// - All Space data (definitions, tab snapshots, icons, backups) lives in
//   chrome.storage.local: Spaces are deliberately per-machine. Tab
//   snapshots couldn't fit sync quotas anyway, and half-synced Spaces
//   (definitions roaming without their tabs) read as data loss on a second
//   machine. Only the options-page settings roam via chrome.storage.sync.
// - The windowId -> spaceId map lives in chrome.storage.session: windowIds
//   are only meaningful within one browser run, and session storage survives
//   service-worker restarts but not browser restarts (index.js re-associates
//   windows to Spaces on startup).

const K_SPACES = 'spaces';
const K_WINMAP = 'winmap';
const K_BACKUPS = 'backups';
const K_SETTINGS = 'settings';

export const DEFAULT_SETTINGS = {
  bookmarkMode: 'switch', // 'switch' | 'follow' | 'pinned' | 'off'
  lazyLoad: true,
  maxBackups: 15,
  chipStyle: 'name' // 'name' | 'icon' — current-Space indicator in the panel
};

export async function getSettings() {
  const { [K_SETTINGS]: settings = {} } = await chrome.storage.sync.get(K_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...settings };
}

const tabsKey = (spaceId) => `tabs:${spaceId}`;

export function newId() {
  return crypto.randomUUID();
}

// Versions before 0.7.2 kept Space definitions in chrome.storage.sync.
// One-time migration: copy them into local, then clear the sync copy so
// the per-machine story is complete.
async function migrateSpacesToLocal() {
  try {
    const local = await chrome.storage.local.get(K_SPACES);
    if (local[K_SPACES]?.length) return;
    const synced = await chrome.storage.sync.get(K_SPACES);
    if (synced[K_SPACES]?.length) {
      await chrome.storage.local.set({ [K_SPACES]: synced[K_SPACES] });
      await chrome.storage.sync.remove(K_SPACES);
    }
  } catch (e) {
    console.warn('Spaces: sync->local migration failed', e);
  }
}
const spacesMigrated = migrateSpacesToLocal();

export async function getSpaces() {
  await spacesMigrated;
  const { [K_SPACES]: spaces = [] } = await chrome.storage.local.get(K_SPACES);
  return spaces.sort((a, b) => a.order - b.order);
}

export async function setSpaces(spaces) {
  await spacesMigrated;
  await chrome.storage.local.set({ [K_SPACES]: spaces });
}

export async function getWinMap() {
  const { [K_WINMAP]: winmap = {} } = await chrome.storage.session.get(K_WINMAP);
  return winmap;
}

// Serialized read-modify-write for the winmap. Multiple async writers
// (switches, window closes, resurrection, re-association) previously each
// did their own read...write with awaits in between, silently reverting
// each other's changes. All mutations MUST go through here: the mutator
// gets a fresh map and returns the map to store.
let winMapQueue = Promise.resolve();
export function updateWinMap(mutate) {
  const run = async () => {
    const map = await getWinMap();
    const next = (await mutate(map)) ?? map;
    await chrome.storage.session.set({ [K_WINMAP]: next });
    return next;
  };
  winMapQueue = winMapQueue.then(run, run);
  return winMapQueue;
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
// title can degrade to a bare URL. Tab-group membership is recorded per
// tab (`group` -> a key into `groups` holding title/color/collapsed).
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

  const groups = {};
  const keyByGroupId = new Map();
  if (chrome.tabGroups) {
    const groupIds = [...new Set(tabs.map((t) => t.groupId).filter((g) => g != null && g !== -1))];
    for (let i = 0; i < groupIds.length; i++) {
      const info = await chrome.tabGroups.get(groupIds[i]).catch(() => null);
      if (!info) continue;
      const key = 'g' + i;
      keyByGroupId.set(groupIds[i], key);
      groups[key] = { title: info.title || '', color: info.color, collapsed: !!info.collapsed };
    }
  }

  return {
    tabs: tabs.map((t) => {
      const url = t.url || t.pendingUrl || 'chrome://newtab/';
      const remembered = t.discarded ? prevByUrl.get(url) : null;
      return {
        url,
        title: (remembered?.title || t.title || '').slice(0, 300),
        pinned: !!t.pinned,
        favIconUrl: remembered?.favIconUrl || t.favIconUrl || '',
        group: keyByGroupId.get(t.groupId)
      };
    }),
    groups,
    activeIndex,
    updatedAt: Date.now()
  };
}

// Rolling safety net: keep the last N tab lists that were about to be
// replaced or deleted, so a bad switch never silently loses tabs.
export async function pushBackup(label, snapshot) {
  if (!snapshot.tabs.length) return;
  const { maxBackups } = await getSettings();
  const { [K_BACKUPS]: backups = [] } = await chrome.storage.local.get(K_BACKUPS);
  backups.unshift({ label, at: Date.now(), tabs: snapshot.tabs, groups: snapshot.groups ?? {} });
  await chrome.storage.local.set({ [K_BACKUPS]: backups.slice(0, Math.max(0, maxBackups)) });
}

export async function getBackups() {
  const { [K_BACKUPS]: backups = [] } = await chrome.storage.local.get(K_BACKUPS);
  return backups;
}

// Custom Space icons (data-URL images). Stored in local storage — sync's
// 8KB-per-item quota can't hold image data.
const K_ICONS = 'spaceIcons';

export async function getIcons() {
  const { [K_ICONS]: icons = {} } = await chrome.storage.local.get(K_ICONS);
  return icons;
}

export async function setIcon(spaceId, dataUrl) {
  const icons = await getIcons();
  if (dataUrl) icons[spaceId] = dataUrl;
  else delete icons[spaceId];
  await chrome.storage.local.set({ [K_ICONS]: icons });
}

export async function removeBackup(at) {
  const { [K_BACKUPS]: backups = [] } = await chrome.storage.local.get(K_BACKUPS);
  await chrome.storage.local.set({ [K_BACKUPS]: backups.filter((b) => b.at !== at) });
}
