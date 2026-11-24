// Per-Space bookmark bars.
//
// Chrome has a single bookmarks bar shared by every window, so the bar
// reflects the most recently *switched-to* Space. Each Space owns a folder
// under "Other Bookmarks / Spaces"; on switch we move the bar's contents
// into the outgoing owner's folder and move the incoming Space's folder
// contents onto the bar. Bookmarks are only ever moved — never deleted —
// so no operation here can lose data.
//
// Invariant: while a Space owns the bar, its folder is empty (its contents
// ARE the bar). Stashing appends, so even if the invariant breaks (crash
// mid-swap, manual edits) the result is a harmless merge.

import { getSpaces, getSettings } from './state.js';

const K_FOLDERS = 'bookmarkFolders'; // spaceId -> folderId
const K_BAR_OWNER = 'barSpaceId'; // which Space's bookmarks are on the bar
const K_BAR_FOLDER = 'barFolderId'; // which folder the bar's contents came from
const ROOT_FOLDER_NAME = 'Spaces';
const ARCHIVE_FOLDER_NAME = 'Saved bar';

// All bar mutations are serialized through this queue so rapid switches
// can't interleave moves.
let queue = Promise.resolve();
function enqueue(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

async function rootChildren() {
  const tree = await chrome.bookmarks.getTree();
  return tree[0].children ?? [];
}

// folderType is Chrome 134+; fall back to the well-known ids.
async function getBarNode() {
  const kids = await rootChildren();
  return kids.find((n) => n.folderType === 'bookmarks-bar') ?? kids.find((n) => n.id === '1') ?? kids[0];
}

async function getOtherNode() {
  const kids = await rootChildren();
  return kids.find((n) => n.folderType === 'other') ?? kids.find((n) => n.id === '2') ?? kids[kids.length - 1];
}

async function findOrCreateFolder(parentId, title) {
  const children = await chrome.bookmarks.getChildren(parentId);
  const existing = children.find((n) => !n.url && n.title === title);
  if (existing) return existing.id;
  const created = await chrome.bookmarks.create({ parentId, title });
  return created.id;
}

export async function getSpacesRootId() {
  const other = await getOtherNode();
  return findOrCreateFolder(other.id, ROOT_FOLDER_NAME);
}

export async function getSpaceFolderMap() {
  const { [K_FOLDERS]: map = {} } = await chrome.storage.local.get(K_FOLDERS);
  return map;
}

export function ensureSpaceFolder(spaceId, opts) {
  return folderForSpace(spaceId, opts);
}

// Explicitly adopt an existing folder as a Space's own (used when creating
// a Space whose name matches an orphaned folder — user-confirmed, so the
// implicit title-matching hazard doesn't apply).
export async function linkSpaceFolder(spaceId, folderId) {
  const { [K_FOLDERS]: map = {} } = await chrome.storage.local.get(K_FOLDERS);
  map[spaceId] = folderId;
  await chrome.storage.local.set({ [K_FOLDERS]: map });
}

async function folderForSpace(spaceId, { allowAdopt = true } = {}) {
  const { [K_FOLDERS]: map = {} } = await chrome.storage.local.get(K_FOLDERS);
  if (map[spaceId]) {
    const nodes = await chrome.bookmarks.get(map[spaceId]).catch(() => null);
    if (nodes?.[0] && !nodes[0].url) return map[spaceId];
  }
  const spaces = await getSpaces();
  const name = spaces.find((s) => s.id === spaceId)?.name || 'Space';
  const rootId = await getSpacesRootId();
  let folderId = null;
  if (allowAdopt) {
    // The mapping is lost or stale — Chrome sync merges can recreate
    // folders under new node ids. Re-adopt a same-named folder that no
    // other Space owns before creating an empty duplicate. (This never
    // fuses two Spaces: an owned folder is never adopted.)
    const owned = new Set(Object.values(map));
    const children = await chrome.bookmarks.getChildren(rootId).catch(() => []);
    folderId = children.find((n) => !n.url && !owned.has(n.id) && n.title === name)?.id ?? null;
  }
  if (!folderId) {
    const folder = await chrome.bookmarks.create({ parentId: rootId, title: name });
    folderId = folder.id;
  }
  map[spaceId] = folderId;
  await chrome.storage.local.set({ [K_FOLDERS]: map });
  return folderId;
}

async function moveChildren(fromId, toId) {
  const children = await chrome.bookmarks.getChildren(fromId);
  let index = (await chrome.bookmarks.getChildren(toId)).length;
  for (const child of children) {
    await chrome.bookmarks.move(child.id, { parentId: toId, index: index++ }).catch((e) => {
      console.warn('Spaces: could not move bookmark', child.title, e);
    });
  }
}

export function setBarOwner(spaceId) {
  return chrome.storage.local.set({ [K_BAR_OWNER]: spaceId });
}

export async function getBarNodeId() {
  const bar = await getBarNode();
  return bar?.id ?? null;
}

export async function getBarFolderId() {
  const { [K_BAR_FOLDER]: id } = await chrome.storage.local.get(K_BAR_FOLDER);
  return id ?? null;
}

// Returns the id if it names an existing folder, else null.
async function verifyFolder(id) {
  if (!id) return null;
  const nodes = await chrome.bookmarks.get(id).catch(() => null);
  return nodes?.[0] && !nodes[0].url ? id : null;
}

// Return the bar's current contents to the folder they came from
// (preferred), the owner Space's folder (legacy fallback), or the archive.
async function stashBar(barId, spaces, ownerId, recordedFolderId) {
  const barChildren = await chrome.bookmarks.getChildren(barId);
  if (!barChildren.length) return;
  let stashId = await verifyFolder(recordedFolderId);
  if (!stashId && ownerId && spaces.some((s) => s.id === ownerId)) {
    stashId = await folderForSpace(ownerId);
  }
  if (!stashId) {
    stashId = await findOrCreateFolder(await getSpacesRootId(), ARCHIVE_FOLDER_NAME);
  }
  await moveChildren(barId, stashId);
}

// Swap the bar from its current owner to targetSpaceId. `fallbackOwnerId`
// is the Space the calling window was showing — used the first time this
// feature runs, when no owner has been recorded yet.
//
// Calls are collapsed latest-wins: rapid focus changes in follow mode can
// queue many swaps, but only the newest target matters, and skipping the
// intermediates is safe because each swap reads the recorded owner fresh.
let swapSeq = 0;
export function swapBars(fallbackOwnerId, targetSpaceId) {
  const mySeq = ++swapSeq;
  return enqueue(async () => {
    try {
      if (mySeq !== swapSeq) return; // superseded by a newer swap
      const mode = (await getSettings()).bookmarkMode;
      if (mode === 'off') return;
      const store = await chrome.storage.local.get([K_BAR_OWNER, K_BAR_FOLDER]);
      const owner = store[K_BAR_OWNER] ?? fallbackOwnerId ?? null;
      const spaces = await getSpaces();
      const target = spaces.find((s) => s.id === targetSpaceId);
      if (!target) return;

      // The Space's bar shows its pinned folder when set, otherwise its
      // own folder. In 'pinned' mode only pinned Spaces touch the bar —
      // switching to an unpinned Space leaves it exactly as it is.
      const pinnedId = await verifyFolder(target.bookmarkFolderId);
      if (mode === 'pinned' && !pinnedId) return;
      const loadId = pinnedId ?? (await folderForSpace(targetSpaceId));
      const currentFolder =
        (await verifyFolder(store[K_BAR_FOLDER])) ??
        (owner && spaces.some((s) => s.id === owner) ? await folderForSpace(owner) : null);
      if (owner === targetSpaceId && currentFolder === loadId) {
        await chrome.storage.local.set({ [K_BAR_OWNER]: targetSpaceId, [K_BAR_FOLDER]: loadId });
        return;
      }
      const bar = await getBarNode();
      if (!bar) return;

      await stashBar(bar.id, spaces, owner, currentFolder);
      await moveChildren(loadId, bar.id);
      await chrome.storage.local.set({ [K_BAR_OWNER]: targetSpaceId, [K_BAR_FOLDER]: loadId });
    } catch (e) {
      console.warn('Spaces: bookmark bar swap failed', e);
    }
  });
}

// Explicitly put a folder's contents on the bookmarks bar right now
// ("on the fly"). Works in any bookmark mode — it's a direct user action.
export function loadFolderToBar(folderId, ownerSpaceId = null) {
  const mySeq = ++swapSeq; // participates in latest-wins with swapBars
  return enqueue(async () => {
    try {
      if (mySeq !== swapSeq) return;
      const loadId = await verifyFolder(folderId);
      if (!loadId) return;
      const store = await chrome.storage.local.get([K_BAR_OWNER, K_BAR_FOLDER]);
      if (store[K_BAR_FOLDER] === loadId) {
        // The record says this folder is already on the bar — but manual
        // bookmark edits (or cleanups) can leave that record stale. If the
        // folder still holds children, it clearly isn't loaded; proceed.
        const kids = await chrome.bookmarks.getChildren(loadId).catch(() => []);
        if (!kids.length) return; // genuinely already on the bar
      }
      const bar = await getBarNode();
      if (!bar) return;
      const spaces = await getSpaces();
      await stashBar(bar.id, spaces, store[K_BAR_OWNER] ?? ownerSpaceId ?? null, store[K_BAR_FOLDER]);
      await moveChildren(loadId, bar.id);
      const update = { [K_BAR_FOLDER]: loadId };
      if (ownerSpaceId) update[K_BAR_OWNER] = ownerSpaceId;
      await chrome.storage.local.set(update);
    } catch (e) {
      console.warn('Spaces: load folder to bar failed', e);
    }
  });
}

// Keep the hidden folder's name in sync with the Space's name.
export function renameSpaceFolder(spaceId, newName) {
  return enqueue(async () => {
    try {
      const { [K_FOLDERS]: map = {} } = await chrome.storage.local.get(K_FOLDERS);
      if (!map[spaceId]) return;
      await chrome.bookmarks.update(map[spaceId], { title: newName }).catch(() => {});
    } catch (e) {
      console.warn('Spaces: bookmark folder rename failed', e);
    }
  });
}

// When a Space is deleted its bookmarks are never removed: if it owned the
// bar, its bookmarks are stashed into its folder, which remains under
// "Other Bookmarks / Spaces" as an archive.
export function onSpaceDeleted(spaceId) {
  return enqueue(async () => {
    try {
      const store = await chrome.storage.local.get([K_BAR_OWNER, K_BAR_FOLDER]);
      if (store[K_BAR_OWNER] === spaceId) {
        const bar = await getBarNode();
        if (bar) {
          const stashId = (await verifyFolder(store[K_BAR_FOLDER])) ?? (await folderForSpace(spaceId));
          const barChildren = await chrome.bookmarks.getChildren(bar.id);
          if (barChildren.length) await moveChildren(bar.id, stashId);
        }
        await chrome.storage.local.remove([K_BAR_OWNER, K_BAR_FOLDER]);
      }
      const { [K_FOLDERS]: map = {} } = await chrome.storage.local.get(K_FOLDERS);
      if (map[spaceId]) {
        delete map[spaceId];
        await chrome.storage.local.set({ [K_FOLDERS]: map });
      }
    } catch (e) {
      console.warn('Spaces: bookmark cleanup on delete failed', e);
    }
  });
}
