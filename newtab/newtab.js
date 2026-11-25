// Spaces start page. Runs as the New Tab override and adapts to the Space
// the window is in: redirects to the Space's homepage when one is set,
// otherwise renders per-Space link groups. Zero network by default —
// weather and reachability checks only run when enabled in Options.

import { getWinMap, getSpaces, getSettings, getIcons, getLastSpaceId } from '../background/state.js';

const K_LINKS = 'linkGroups'; // { '*': Group[], [spaceId]: Group[] }
const ACCENTS = ['#89b4fa', '#a6e3a1', '#cba6f7', '#fab387', '#94e2d5', '#f9e2af', '#f38ba8'];

const $ = (sel) => document.querySelector(sel);

let currentSpace = null;
let settings = null;
let editing = false;

// ---------- data ----------

async function getAllGroups() {
  const { [K_LINKS]: all = {} } = await chrome.storage.local.get(K_LINKS);
  return all;
}

async function saveScope(scopeKey, groups) {
  const all = await getAllGroups();
  if (groups.length) all[scopeKey] = groups;
  else delete all[scopeKey];
  await chrome.storage.local.set({ [K_LINKS]: all });
}

function scopeKey(global) {
  return global ? '*' : currentSpace?.id ?? '*';
}

// ---------- clock & greeting ----------

function tick() {
  const now = new Date();
  const h = now.getHours();
  const name = settings?.greetingName?.trim();
  $('#greeting').textContent =
    (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (name ? `, ${name}` : '');
  $('#clock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// ---------- weather (opt-in: only when coordinates are configured) ----------

const WMO = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️', 61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '🌨️', 80: '🌦️', 81: '🌧️', 82: '⛈️', 95: '⛈️', 96: '⛈️', 99: '⛈️' };

async function initWeather() {
  const coords = (settings.weatherCoords || '').split(',').map((s) => parseFloat(s.trim()));
  if (coords.length !== 2 || coords.some(Number.isNaN)) return;
  const show = (w) => {
    $('#weather').textContent =
      `${WMO[w.code] ?? ''} ${Math.round(w.temp)}°F · H ${Math.round(w.hi)}° L ${Math.round(w.lo)}°`;
  };
  try {
    const cached = JSON.parse(localStorage.getItem('wx') || 'null');
    if (cached && Date.now() - cached.t < 30 * 60e3) return show(cached);
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${coords[0]}&longitude=${coords[1]}` +
      '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min' +
      '&temperature_unit=fahrenheit&timezone=auto&forecast_days=1'
    );
    const d = await r.json();
    const w = { t: Date.now(), temp: d.current.temperature_2m, code: d.current.weather_code,
      hi: d.daily.temperature_2m_max[0], lo: d.daily.temperature_2m_min[0] };
    try { localStorage.setItem('wx', JSON.stringify(w)); } catch {}
    show(w);
  } catch { /* offline or blocked: leave blank */ }
}

// ---------- icons ----------

function faviconUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.toString();
}

function letterTile(name) {
  const t = document.createElement('div');
  t.className = 'tile';
  t.textContent = (name || '?').charAt(0).toUpperCase();
  return t;
}

function makeIcon(link) {
  const img = document.createElement('img');
  img.className = 'icon';
  img.alt = '';
  img.src = faviconUrl(link.url);
  img.onerror = () => img.parentNode && img.parentNode.replaceChildren(letterTile(link.name));
  return img;
}

// ---------- reachability (opt-in) ----------

async function check(url, dot) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    dot.className = 'dot up';
    dot.title = 'Reachable';
    return true;
  } catch {
    dot.className = 'dot down';
    dot.title = 'Unreachable';
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- space chip ----------

function renderChip(space, icons) {
  const chip = $('#space-chip');
  if (!space) { chip.hidden = true; return; }
  chip.hidden = false;
  chip.replaceChildren();
  chip.style.setProperty('--space-accent', space.color || '#89b4fa');
  const iconData = icons[space.id];
  if (iconData) {
    const img = document.createElement('img');
    img.src = iconData;
    img.alt = '';
    chip.appendChild(img);
  } else if (space.emoji) {
    chip.appendChild(document.createTextNode(space.emoji + ' '));
  } else {
    chip.appendChild(document.createElement('i'));
  }
  chip.appendChild(document.createTextNode(space.name));
}

// ---------- resume (unmapped window) ----------

// A window that isn't in any Space gets a one-click way back in: the last
// used Space leads as "Resume …", the rest follow as plain pills. Spaces
// live in other windows are left out (clicking would only focus elsewhere).
async function renderResume() {
  const box = $('#resume');
  const row = box.querySelector('.resume-row');
  const [spaces, map, icons, lastId] = await Promise.all([
    getSpaces(), getWinMap(), getIcons(), getLastSpaceId()
  ]);
  const live = new Set(Object.values(map));
  const candidates = spaces.filter((s) => !live.has(s.id));
  if (!candidates.length) return;
  candidates.sort((a, b) => (b.id === lastId) - (a.id === lastId));

  for (const space of candidates) {
    const primary = space.id === lastId;
    const btn = el('button', { class: 'resume-btn' + (primary ? ' primary' : ''), title: `Open “${space.name}” in this window` });
    btn.style.setProperty('--space-accent', space.color || '#89b4fa');
    const iconData = icons[space.id];
    if (iconData) btn.appendChild(el('img', { src: iconData, alt: '' }));
    else if (space.emoji) btn.append(space.emoji + ' ');
    else btn.appendChild(el('i'));
    btn.append((primary ? 'Resume ' : '') + space.name);
    btn.addEventListener('click', () => resumeSpace(space));
    row.appendChild(btn);
  }
  box.hidden = false;
}

async function resumeSpace(space) {
  const hint = $('#resume .resume-hint');
  try {
    const win = await chrome.windows.getCurrent();
    const tabs = await chrome.tabs.query({ currentWindow: true });
    // An overridden NTP reports the extension's own URL, not chrome://newtab.
    const ntpUrls = ['chrome://newtab', chrome.runtime.getURL('newtab/newtab.html')];
    const others = tabs.filter((t) => {
      const u = t.url || t.pendingUrl || '';
      return !ntpUrls.some((p) => u.startsWith(p));
    });
    if (others.length &&
        !confirm(`Open “${space.name}” here?\n\nThe ${tabs.length} tabs in this window will be saved to Backups and replaced.`)) {
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'switchSpace', windowId: win.id, spaceId: space.id });
    // On success this tab is closed by the switch; nothing left to do.
    if (!res?.ok) hint.textContent = res?.error || 'Could not open that Space.';
  } catch (e) {
    hint.textContent = 'Could not open that Space: ' + (e?.message ?? e);
  }
}

// ---------- render ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

async function render() {
  const main = $('#groups');
  main.replaceChildren();
  const all = await getAllGroups();
  // Entries carry their scope so edits write back to the right bucket.
  const entries = [
    ...(all['*'] ?? []).map((g, i) => ({ g, global: true, index: i })),
    ...((currentSpace && all[currentSpace.id]) ?? []).map((g, i) => ({ g, global: false, index: i }))
  ];

  const checks = [];
  entries.forEach((entry, gi) => {
    const { g: group } = entry;
    const section = el('section');
    section.style.setProperty('--accent', group.accent || ACCENTS[gi % ACCENTS.length]);
    if (gi === 0 && entries.length > 1) section.classList.add('wide');
    if (group.span === 2) section.classList.add('span2');
    section.style.animationDelay = gi * 70 + 'ms';
    const links = (group.links || []).filter((l) => l.url);

    if (editing) {
      section.appendChild(buildGroupEditor(entry));
    } else {
      const h2 = el('h2', {}, group.title || 'Links', el('span', { class: 'count' }, String(links.length)));
      if (entry.global && currentSpace) h2.appendChild(el('span', { class: 'scope' }, 'all Spaces'));
      section.appendChild(h2);
    }

    const wrap = el('div', { class: 'links' });
    if (!links.length && !editing) {
      wrap.appendChild(el('div', { class: 'empty' }, 'No links yet — use ✎ Edit below.'));
    }
    for (const link of links) {
      const a = el('a', { href: link.url, title: link.url });
      a.appendChild(el('div', { class: 'icon-wrap' }, makeIcon(link)));
      a.appendChild(el('span', { class: 'name' }, link.name || link.url));
      if (group.internal && settings.statusChecks && !editing) {
        const dot = el('i', { class: 'dot', title: 'Checking…' });
        a.appendChild(dot);
        checks.push(check(link.url, dot));
      }
      wrap.appendChild(a);
    }
    section.appendChild(wrap);
    main.appendChild(section);
  });

  if (editing) {
    main.appendChild(el('button', { class: 'add-group', onclick: addGroup }, '＋ New group'));
  } else if (!entries.length) {
    main.appendChild(el('div', { class: 'empty', style: 'grid-column:1/-1; text-align:center' },
      'No link groups yet. Click ✎ Edit to add some — per Space, or shared across all Spaces.'));
  }

  const status = $('#lab-status');
  status.textContent = '';
  if (checks.length) {
    Promise.all(checks).then((r) => {
      const up = r.filter(Boolean).length;
      status.textContent = `${up}/${r.length} services reachable · checked ` +
        new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    });
  }
}

// ---------- editor ----------

function buildGroupEditor(entry) {
  const { g: group } = entry;
  const key = scopeKey(entry.global);

  const mutate = async (fn) => {
    const all = await getAllGroups();
    const groups = all[key] ?? [];
    fn(groups);
    await saveScope(key, groups);
    render();
  };

  const head = el('div', { class: 'g-controls' },
    el('input', {
      type: 'text', class: 'g-title', value: group.title ?? '', placeholder: 'Group title',
      onchange: (e) => mutate((gs) => { if (gs[entry.index]) gs[entry.index].title = e.target.value; })
    }),
    el('label', {},
      el('input', {
        type: 'checkbox', ...(group.internal ? { checked: '' } : {}),
        onchange: (e) => mutate((gs) => { if (gs[entry.index]) gs[entry.index].internal = e.target.checked; })
      }),
      'status dots'
    ),
    el('button', {
      class: 'mini-btn danger',
      onclick: () => mutate((gs) => gs.splice(entry.index, 1))
    }, 'Delete group')
  );

  const linksBox = el('div');
  (group.links ?? []).forEach((link, li) => {
    linksBox.appendChild(el('div', { class: 'link-edit' },
      el('input', {
        type: 'text', value: link.name ?? '', placeholder: 'Name',
        onchange: (e) => mutate((gs) => { if (gs[entry.index]?.links[li]) gs[entry.index].links[li].name = e.target.value; })
      }),
      el('input', {
        type: 'text', value: link.url ?? '', placeholder: 'https://…',
        onchange: (e) => mutate((gs) => { if (gs[entry.index]?.links[li]) gs[entry.index].links[li].url = e.target.value.trim(); })
      }),
      el('button', {
        class: 'mini-btn danger',
        onclick: () => mutate((gs) => gs[entry.index]?.links.splice(li, 1))
      }, '✕')
    ));
  });
  linksBox.appendChild(el('button', {
    class: 'mini-btn',
    onclick: () => mutate((gs) => { if (gs[entry.index]) (gs[entry.index].links ??= []).push({ name: '', url: '' }); })
  }, '＋ Link'));

  const frag = document.createDocumentFragment();
  frag.appendChild(head);
  frag.appendChild(linksBox);
  return frag;
}

async function addGroup() {
  const global = currentSpace
    ? !confirm(`Add this group only to the “${currentSpace.name}” Space?\n\nOK = only ${currentSpace.name} · Cancel = all Spaces`)
    : true;
  const key = scopeKey(global);
  const all = await getAllGroups();
  const groups = all[key] ?? [];
  groups.push({ title: 'New group', links: [{ name: '', url: '' }] });
  await saveScope(key, groups);
  render();
}

// ---------- import / export ----------

function setupIO() {
  const dialog = $('#io-dialog');
  $('#export-btn').addEventListener('click', async () => {
    $('#io-text').textContent = 'All link groups, by scope ("*" = all Spaces, otherwise a Space id):';
    $('#io-area').value = JSON.stringify(await getAllGroups(), null, 2);
    $('#io-ok').hidden = true;
    dialog.showModal();
  });
  $('#import-btn').addEventListener('click', () => {
    $('#io-text').textContent = currentSpace
      ? `Paste either a full export (object keyed by scope) or an array of groups to add to “${currentSpace.name}”.`
      : 'Paste either a full export (object keyed by scope) or an array of groups to add to all Spaces.';
    $('#io-area').value = '';
    $('#io-ok').hidden = false;
    dialog.showModal();
  });
  $('#io-cancel').addEventListener('click', () => dialog.close());
  $('#io-ok').addEventListener('click', async () => {
    try {
      const parsed = JSON.parse($('#io-area').value);
      if (Array.isArray(parsed)) {
        const key = scopeKey(false);
        const all = await getAllGroups();
        await saveScope(key, [...(all[key] ?? []), ...parsed]);
      } else if (parsed && typeof parsed === 'object') {
        await chrome.storage.local.set({ [K_LINKS]: parsed });
      } else {
        throw new Error('not an object or array');
      }
      dialog.close();
      render();
    } catch (e) {
      $('#io-text').textContent = 'Could not import: ' + (e?.message ?? e);
    }
  });
}

// ---------- init ----------

(async () => {
  settings = await getSettings();
  tick();
  setInterval(tick, 1000);

  document.addEventListener('keydown', (e) => {
    const input = $('#search input');
    if (e.key === '/' && document.activeElement !== input && !editing) {
      e.preventDefault();
      input.focus();
    }
  });

  let space = null;
  let winId = null;
  try {
    const win = await chrome.windows.getCurrent();
    winId = win.id;
    const map = await getWinMap();
    const spaceId = map[win.id];
    if (spaceId) space = (await getSpaces()).find((s) => s.id === spaceId) ?? null;
  } catch { /* render spaceless */ }
  currentSpace = space;

  // A switch creates this window's fresh new-tab page *before* it records
  // the window→Space mapping, so a page spawned mid-switch can read the
  // stale map and render as unmapped. Re-initialize when this window's
  // mapping actually changes (also picks up the homepage redirect).
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'session' || !changes.winmap || winId == null) return;
      const mappedId = changes.winmap.newValue?.[winId] ?? null;
      if ((currentSpace?.id ?? null) !== mappedId) location.reload();
    });
  } catch { /* stale-chip worst case */ }

  // Homepage redirect — open the page with #edit to bypass (e.g. to edit
  // this Space's groups).
  if (space?.homepageUrl && location.hash !== '#edit') {
    location.replace(space.homepageUrl);
    return;
  }

  renderChip(space, space ? await getIcons() : {});
  if (!space) renderResume().catch(() => {});
  initWeather();
  setupIO();
  $('#edit-btn').addEventListener('click', () => {
    editing = !editing;
    document.body.classList.toggle('editing', editing);
    $('#export-btn').hidden = !editing;
    $('#import-btn').hidden = !editing;
    $('#edit-btn').textContent = editing ? '✓ Done' : '✎ Edit';
    render();
  });
  if (location.hash === '#edit') $('#edit-btn').click();
  else render();
})();
