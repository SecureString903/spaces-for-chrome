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

import { getSpaces } from './state.js';

const K_FOLDERS = 'bookmarkFolders'; // spaceId -> folderId
const K_BAR_OWNER = 'barSpaceId'; // which Space's bookmarks are on the bar
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

async function getSpacesRootId() {
  const other = await getOtherNode();
  return findOrCreateFolder(other.id, ROOT_FOLDER_NAME);
}

async function folderForSpace(spaceId) {
  const { [K_FOLDERS]: map = {} } = await chrome.storage.local.get(K_FOLDERS);
  if (map[spaceId]) {
    const nodes = await chrome.bookmarks.get(map[spaceId]).catch(() => null);
    if (nodes?.[0] && !nodes[0].url) return map[spaceId];
  }
  const spaces = await getSpaces();
  const name = spaces.find((s) => s.id === spaceId)?.name || 'Space';
  const rootId = await getSpacesRootId();
  const folderId = await findOrCreateFolder(rootId, name);
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

// Swap the bar from its current owner to targetSpaceId. `fallbackOwnerId`
// is the Space the calling window was showing — used the first time this
// feature runs, when no owner has been recorded yet.
export function swapBars(fallbackOwnerId, targetSpaceId) {
  return enqueue(async () => {
    try {
      const { [K_BAR_OWNER]: recorded } = await chrome.storage.local.get(K_BAR_OWNER);
      const owner = recorded ?? fallbackOwnerId ?? null;
      if (owner === targetSpaceId) {
        await setBarOwner(targetSpaceId);
        return;
      }
      const bar = await getBarNode();
      if (!bar) return;
      const spaces = await getSpaces();

      // Stash the bar's contents with whoever owned them.
      const barChildren = await chrome.bookmarks.getChildren(bar.id);
      if (barChildren.length) {
        const stashId =
          owner && spaces.some((s) => s.id === owner)
            ? await folderForSpace(owner)
            : await findOrCreateFolder(await getSpacesRootId(), ARCHIVE_FOLDER_NAME);
        await moveChildren(bar.id, stashId);
      }

      // Load the incoming Space's bookmarks onto the bar.
      if (spaces.some((s) => s.id === targetSpaceId)) {
        await moveChildren(await folderForSpace(targetSpaceId), bar.id);
      }
      await setBarOwner(targetSpaceId);
    } catch (e) {
      console.warn('Spaces: bookmark bar swap failed', e);
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
      const { [K_BAR_OWNER]: owner } = await chrome.storage.local.get(K_BAR_OWNER);
      if (owner === spaceId) {
        const bar = await getBarNode();
        if (bar) {
          const barChildren = await chrome.bookmarks.getChildren(bar.id);
          if (barChildren.length) {
            await moveChildren(bar.id, await folderForSpace(spaceId));
          }
        }
        await chrome.storage.local.remove(K_BAR_OWNER);
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
