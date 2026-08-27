// Side panel app. Talks to the service worker for all mutations; reads
// live tab info for the current window directly from chrome.tabs.

import { PALETTE } from '../shared/constants.js';
import { EMOJI } from './emoji.js';

let windowId = null;
let appState = { spaces: [], winMap: {}, counts: {}, backups: [], icons: {}, settings: {} };
let editingSpaceId = null; // null = no editor; 'new' = create form
let dragSpaceId = null;
const expandedBackups = new Set(); // backup `at` timestamps

const $ = (sel) => document.querySelector(sel);

// ---------- helpers ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (v !== undefined && v !== null) {
      node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function faviconUrl(pageUrl, size = 16) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
}

// Load any image source and normalize it into a 64x64 PNG data URL
// (cover-fit), so Space icons are small, square, and self-contained.
function imageToIcon(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

// Icon precedence: custom image > emoji > color dot.
function spaceIconEl(space) {
  const image = appState.icons?.[space.id];
  if (image) return el('img', { class: 'space-icon-img', src: image, alt: '' });
  if (space.emoji) return el('span', { class: 'space-emoji' }, space.emoji);
  return el('span', { class: 'space-dot', style: `background:${space.color}` });
}

let toastTimer = null;
function toast(text) {
  const node = $('#toast');
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 2200);
}

function confirmDialog(text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const dialog = $('#confirm-dialog');
    $('#confirm-text').textContent = text;
    const okBtn = $('#confirm-ok');
    okBtn.textContent = okLabel;
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'ok');
    };
    dialog.addEventListener('close', onClose);
    okBtn.onclick = () => dialog.close('ok');
    $('#confirm-cancel').onclick = () => dialog.close('cancel');
    dialog.returnValue = 'cancel';
    dialog.showModal();
  });
}

// ---------- data ----------

async function refreshState() {
  const result = await send({ type: 'getState' });
  if (result?.ok) {
    appState = result;
  }
}

function currentSpace() {
  const spaceId = appState.winMap[windowId];
  return appState.spaces.find((s) => s.id === spaceId) ?? null;
}

function spaceWindow(spaceId) {
  for (const [wid, sid] of Object.entries(appState.winMap)) {
    if (sid === spaceId) return Number(wid);
  }
  return null;
}

// ---------- actions ----------

async function onSpaceClick(space) {
  const current = currentSpace();
  if (current?.id === space.id) return;

  const otherWindow = spaceWindow(space.id);
  if (otherWindow != null && otherWindow !== windowId) {
    await send({ type: 'switchSpace', windowId, spaceId: space.id });
    toast(`“${space.name}” is open in another window — focused it`);
    return;
  }

  if (!current) {
    const ok = await confirmDialog(
      `This window isn't in a Space yet. Switching to “${space.name}” will replace this window's tabs (they'll be kept in Backups).`,
      'Switch'
    );
    if (!ok) return;
  }

  const result = await send({ type: 'switchSpace', windowId, spaceId: space.id });
  if (!result?.ok) toast(result?.error ?? 'Switch failed');
  await refreshAndRender();
}

async function saveEditor(form) {
  const name = form.querySelector('.name-input').value;
  const color = form.dataset.color || PALETTE[0].hex;
  const icon = form._icon();
  if (editingSpaceId === 'new') {
    const adopt = form.querySelector('.adopt-check')?.checked;
    const result = await send({
      type: 'createSpace',
      name,
      color,
      emoji: icon.emoji,
      iconData: icon.imageData || undefined,
      fromWindowId: adopt ? windowId : undefined
    });
    if (!result?.ok) toast(result?.error ?? 'Could not create Space');
  } else {
    const patch = { name, color, emoji: icon.emoji };
    if (icon.dirty) patch.iconData = icon.imageData ?? null;
    const result = await send({ type: 'updateSpace', id: editingSpaceId, patch });
    if (!result?.ok) toast(result?.error ?? 'Could not save Space');
  }
  editingSpaceId = null;
  await refreshAndRender();
}

async function deleteSpace(space) {
  const count = appState.counts[space.id] ?? 0;
  const ok = await confirmDialog(
    `Delete “${space.name}”?` +
      (count ? ` Its ${count} saved tab${count === 1 ? '' : 's'} will be kept in Backups.` : ''),
    'Delete'
  );
  if (!ok) return;
  const result = await send({ type: 'deleteSpace', id: space.id });
  if (!result?.ok) {
    toast(result?.error ?? 'Could not delete Space');
    return;
  }
  editingSpaceId = null;
  await refreshAndRender();
}

// ---------- rendering ----------

function renderHeader() {
  const chip = $('#current-chip');
  const space = currentSpace();
  if (!space) {
    chip.hidden = true;
    return;
  }
  chip.hidden = false;
  const iconOnly =
    (appState.settings?.chipStyle ?? 'name') === 'icon' &&
    !!(appState.icons?.[space.id] || space.emoji);
  chip.classList.toggle('icon-only', iconOnly);
  chip.replaceChildren(spaceIconEl(space));
  if (!iconOnly) chip.append(el('span', {}, space.name));
  chip.title = space.name;
}

function renderBanner() {
  const banner = $('#banner');
  if (currentSpace() || !appState.spaces.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.replaceChildren(
    el('div', {}, "This window isn't in a Space yet. Save it as a new Space, or click a Space below to switch this window to it."),
    el('button', {
      class: 'primary-btn',
      onclick: () => {
        editingSpaceId = 'new';
        render();
        $('#editor-slot .name-input')?.focus();
      }
    }, 'Save window as a Space')
  );
}

function renderEditor(space = null) {
  const isNew = editingSpaceId === 'new';
  const initialColor = space?.color ?? PALETTE[appState.spaces.length % PALETTE.length].hex;
  const isPreset = (hex) => PALETTE.some((p) => p.hex.toLowerCase() === hex.toLowerCase());

  const swatches = el('div', { class: 'swatches' });
  const setColor = (hex) => {
    form.dataset.color = hex;
    swatches.querySelectorAll('.swatch[data-hex]').forEach((s) => {
      s.classList.toggle('selected', s.dataset.hex.toLowerCase() === hex.toLowerCase());
    });
    const custom = !isPreset(hex);
    customWrap.classList.toggle('selected', custom);
    if (custom) customInput.value = hex;
  };
  for (const { hex } of PALETTE) {
    swatches.append(el('button', {
      type: 'button',
      class: 'swatch',
      style: `background:${hex}`,
      dataset: { hex },
      title: hex,
      onclick: () => setColor(hex)
    }));
  }
  const customInput = el('input', {
    type: 'color',
    class: 'custom-swatch',
    value: isPreset(initialColor) ? '#94a3b8' : initialColor,
    title: 'Custom color — the picker accepts hex and RGB',
    oninput: (e) => setColor(e.target.value)
  });
  const customWrap = el('span', { class: 'custom-swatch-wrap', title: 'Custom color' }, customInput);
  swatches.append(customWrap);

  // ---- Icon (emoji / custom favicon) ----
  let pendingEmoji = space?.emoji ?? '';
  let pendingImage = space ? appState.icons?.[space.id] ?? null : null;
  let iconDirty = false;
  let pickerOpen = false;

  const iconBtn = el('button', { type: 'button', class: 'icon-select-btn', title: 'Choose an icon' });
  const refreshIconBtn = () => {
    iconBtn.replaceChildren(
      pendingImage
        ? el('img', { class: 'space-icon-img', src: pendingImage, alt: '' })
        : pendingEmoji
          ? el('span', {}, pendingEmoji)
          : el('span', { class: 'icon-placeholder' }, '🙂'),
      el('span', { class: 'icon-caret' }, '▾')
    );
  };
  const picker = el('div', { class: 'icon-popover', hidden: '' });
  const syncPicker = () => (picker.hidden = !pickerOpen);
  iconBtn.addEventListener('click', () => {
    pickerOpen = !pickerOpen;
    syncPicker();
  });
  const pickDone = () => {
    iconDirty = true;
    pickerOpen = false;
    syncPicker();
    refreshIconBtn();
  };
  const chooseEmoji = (e) => {
    pendingEmoji = e;
    pendingImage = null;
    pickDone();
  };
  const chooseImage = (dataUrl) => {
    pendingImage = dataUrl;
    pendingEmoji = '';
    pickDone();
  };

  const grid = el('div', { class: 'emoji-grid' });
  for (const e of EMOJI) {
    grid.append(el('button', { type: 'button', class: 'emoji-cell', onclick: () => chooseEmoji(e) }, e));
  }
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: '' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      imageToIcon(reader.result).then(chooseImage).catch(() => toast('Could not read that image'));
    reader.readAsDataURL(file);
    fileInput.value = '';
  });
  const siteInput = el('input', {
    type: 'text',
    class: 'site-input',
    placeholder: 'example.com',
    title: 'Uses Chrome’s favicon cache — works for sites you’ve visited'
  });
  const useSiteFavicon = async () => {
    let url = siteInput.value.trim();
    if (!url) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    try {
      chooseImage(await imageToIcon(faviconUrl(url, 32)));
    } catch {
      toast('No favicon found for that site');
    }
  };
  siteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      useSiteFavicon();
    }
  });
  picker.append(
    grid,
    el('div', { class: 'icon-actions' },
      el('div', { class: 'row' },
        el('span', { class: 'muted-label' }, 'Site favicon'),
        siteInput,
        el('button', { type: 'button', class: 'ghost-btn small', onclick: useSiteFavicon }, 'Use')
      ),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost-btn small', onclick: () => fileInput.click() }, 'Upload image…'),
        el('button', {
          type: 'button',
          class: 'ghost-btn small',
          onclick: () => {
            pendingEmoji = '';
            pendingImage = null;
            pickDone();
          }
        }, 'No icon'),
        fileInput
      )
    )
  );
  refreshIconBtn();

  const form = el('div', { class: 'editor' },
    el('div', { class: 'row' },
      iconBtn,
      el('input', {
        type: 'text',
        class: 'name-input',
        placeholder: 'Space name',
        maxlength: '40',
        value: space?.name ?? ''
      })
    ),
    picker,
    swatches,
    isNew && !currentSpace()
      ? el('label', { class: 'row', style: 'font-size:12px; gap:6px; cursor:pointer' },
          el('input', { type: 'checkbox', class: 'adopt-check', checked: '' }),
          "Adopt this window's current tabs"
        )
      : null,
    el('div', { class: 'editor-actions' },
      !isNew && space
        ? el('button', { class: 'danger-btn', onclick: () => deleteSpace(space) }, 'Delete')
        : null,
      el('button', {
        class: 'ghost-btn',
        onclick: () => {
          editingSpaceId = null;
          render();
        }
      }, 'Cancel'),
      el('button', { class: 'primary-btn', onclick: () => saveEditor(form) }, isNew ? 'Create' : 'Save')
    )
  );

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('name-input')) saveEditor(form);
    if (e.key === 'Escape') {
      editingSpaceId = null;
      render();
    }
  });

  setColor(initialColor);
  form._icon = () => ({ emoji: pendingEmoji, imageData: pendingImage, dirty: iconDirty });
  return form;
}

function renderSpaces() {
  const list = $('#space-list');
  const slot = $('#editor-slot');
  list.replaceChildren();
  slot.replaceChildren();

  const current = currentSpace();

  for (const space of appState.spaces) {
    if (editingSpaceId === space.id) {
      list.append(el('li', {}, renderEditor(space)));
      continue;
    }
    const isActive = current?.id === space.id;
    const otherWindow = spaceWindow(space.id) != null && !isActive;
    const count = isActive ? null : appState.counts[space.id] ?? 0;

    const row = el('li', {
      class: 'space-row' + (isActive ? ' active' : ''),
      draggable: 'true',
      dataset: { id: space.id },
      title: isActive ? 'Current Space' : `Switch to ${space.name}`,
      onclick: () => onSpaceClick(space)
    },
      spaceIconEl(space),
      el('span', { class: 'space-name' }, space.name),
      el('span', { class: 'space-meta' },
        isActive ? 'current' : otherWindow ? 'other window ↗' : `${count} tab${count === 1 ? '' : 's'}`
      ),
      el('button', {
        class: 'icon-btn',
        title: 'Edit Space',
        onclick: (e) => {
          e.stopPropagation();
          editingSpaceId = space.id;
          render();
          $('#space-list .name-input')?.focus();
        }
      }, '✎')
    );

    row.addEventListener('dragstart', (e) => {
      dragSpaceId = space.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      dragSpaceId = null;
      row.classList.remove('dragging');
      list.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      if (!dragSpaceId || dragSpaceId === space.id) return;
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (!dragSpaceId || dragSpaceId === space.id) return;
      const order = appState.spaces.map((s) => s.id);
      const from = order.indexOf(dragSpaceId);
      const to = order.indexOf(space.id);
      order.splice(to, 0, ...order.splice(from, 1));
      await send({ type: 'reorderSpaces', order });
      await refreshAndRender();
    });

    list.append(row);
  }

  if (editingSpaceId === 'new') {
    slot.append(renderEditor(null));
  }

  if (!appState.spaces.length) {
    list.append(el('li', { class: 'empty-note' }, 'No Spaces yet — create your first one below.'));
  }

  $('#new-space-btn').hidden = editingSpaceId === 'new';
}

async function renderTabs() {
  const list = $('#tab-list');
  const tabs = await chrome.tabs.query({ windowId });
  $('#tab-count').textContent = `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`;
  list.replaceChildren();
  for (const tab of tabs) {
    const url = tab.url || tab.pendingUrl || '';
    const row = el('li', {
      class: 'tab-row' + (tab.active ? ' active' : ''),
      title: url,
      onclick: () => chrome.tabs.update(tab.id, { active: true })
    },
      el('img', {
        class: 'tab-favicon',
        src: tab.favIconUrl || (url ? faviconUrl(url) : ''),
        alt: ''
      }),
      tab.pinned ? el('span', { class: 'pin' }, '📌') : null,
      el('span', { class: 'tab-title' }, tab.title || url || 'New tab'),
      el('button', {
        class: 'icon-btn',
        title: 'Close tab',
        onclick: (e) => {
          e.stopPropagation();
          chrome.tabs.remove(tab.id);
        }
      }, '✕')
    );
    list.append(row);
  }
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function renderBackups() {
  const section = $('#backups-section');
  const backups = appState.backups ?? [];
  section.hidden = !backups.length;
  if (!backups.length) return;
  $('#backup-count').textContent = String(backups.length);
  const list = $('#backup-list');
  list.replaceChildren();

  for (const backup of backups) {
    const expanded = expandedBackups.has(backup.at);
    const head = el('div', {
      class: 'backup-head',
      title: expanded ? 'Hide tabs' : 'Show tabs',
      onclick: () => {
        if (expandedBackups.has(backup.at)) expandedBackups.delete(backup.at);
        else expandedBackups.add(backup.at);
        render();
      }
    },
      el('span', { class: 'backup-label' }, backup.label),
      el('span', { class: 'backup-meta' }, `${backup.tabs.length} tab${backup.tabs.length === 1 ? '' : 's'} · ${timeAgo(backup.at)}`),
      el('button', {
        class: 'icon-btn',
        title: 'Open in a new window',
        onclick: async (e) => {
          e.stopPropagation();
          const result = await send({ type: 'restoreBackup', at: backup.at, mode: 'window' });
          if (!result?.ok) toast(result?.error ?? 'Restore failed');
        }
      }, '↗'),
      el('button', {
        class: 'icon-btn',
        title: 'Save as a new Space',
        onclick: async (e) => {
          e.stopPropagation();
          const result = await send({ type: 'restoreBackup', at: backup.at, mode: 'space' });
          if (result?.ok) toast(`Saved as Space “${result.name}”`);
          else toast(result?.error ?? 'Restore failed');
          await refreshAndRender();
        }
      }, '＋'),
      el('button', {
        class: 'icon-btn',
        title: 'Delete backup',
        onclick: async (e) => {
          e.stopPropagation();
          const ok = await confirmDialog(
            `Delete this backup of ${backup.tabs.length} tab${backup.tabs.length === 1 ? '' : 's'}? This can't be undone.`,
            'Delete'
          );
          if (!ok) return;
          await send({ type: 'deleteBackup', at: backup.at });
          expandedBackups.delete(backup.at);
          await refreshAndRender();
        }
      }, '✕')
    );

    const row = el('li', { class: 'backup-row' }, head);
    if (expanded) {
      const tabList = el('ul', { class: 'backup-tabs' });
      for (const t of backup.tabs) {
        tabList.append(el('li', { title: t.url },
          el('img', { class: 'tab-favicon', src: t.favIconUrl || faviconUrl(t.url), alt: '' }),
          el('span', {}, t.title || t.url)
        ));
      }
      row.append(tabList);
    }
    list.append(row);
  }
}

function render() {
  renderHeader();
  renderBanner();
  renderSpaces();
  renderTabs();
  renderBackups();
}

async function refreshAndRender() {
  await refreshState();
  render();
}

// ---------- events ----------

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(refreshAndRender, 200);
}

function initListeners() {
  $('#options-btn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#new-space-btn').addEventListener('click', () => {
    editingSpaceId = 'new';
    render();
    $('#editor-slot .name-input')?.focus();
  });

  chrome.storage.onChanged.addListener(() => scheduleRender());

  const ifThisWindow = (wid) => {
    if (wid === windowId) scheduleRender();
  };
  chrome.tabs.onCreated.addListener((tab) => ifThisWindow(tab.windowId));
  chrome.tabs.onRemoved.addListener((tabId, info) => ifThisWindow(info.windowId));
  chrome.tabs.onUpdated.addListener((tabId, changes, tab) => {
    if (changes.title || changes.favIconUrl || changes.status === 'complete' || changes.pinned !== undefined) {
      ifThisWindow(tab.windowId);
    }
  });
  chrome.tabs.onMoved.addListener((tabId, info) => ifThisWindow(info.windowId));
  chrome.tabs.onActivated.addListener((info) => ifThisWindow(info.windowId));
}

async function main() {
  const win = await chrome.windows.getCurrent();
  windowId = win.id;
  initListeners();
  await refreshAndRender();
}

main();
