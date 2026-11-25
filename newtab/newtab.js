// Spaces start page. Runs as the New Tab override and adapts to the Space
// the window is in: redirects to the Space's homepage when one is set,
// otherwise renders per-Space link groups. Zero network by default —
// weather and reachability checks only run when enabled in Options.

import { getWinMap, getSpaces, getSettings, getIcons, getLastSpaceId } from '../background/state.js';

const K_LINKS = 'linkGroups'; // { '*': Group[], generic: Group[], [spaceId]: Group[] }
// Scopes: '*' shows everywhere, GENERIC only in windows outside any Space,
// a Space id only in that Space. (Space ids are UUIDs, so no collision.)
const GENERIC = 'generic';
const ACCENTS = ['#89b4fa', '#a6e3a1', '#cba6f7', '#fab387', '#94e2d5', '#f9e2af', '#f38ba8'];

const $ = (sel) => document.querySelector(sel);

let currentSpace = null;
let settings = null;
let editing = false;
let spacesCache = []; // for the scope dropdown in edit mode

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

// The scope this page's own groups live in: the Space, or the generic
// bucket for windows outside any Space.
function pageScope() {
  return currentSpace?.id ?? GENERIC;
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

// A window that isn't in any Space gets a one-click way into every Space:
// the last used one leads as "Resume …", the rest follow as plain pills.
// A Space that's live in another window focuses that window instead.
async function renderResume() {
  const box = $('#resume');
  const row = box.querySelector('.resume-row');
  const [spaces, map, icons, lastId] = await Promise.all([
    getSpaces(), getWinMap(), getIcons(), getLastSpaceId()
  ]);
  const live = new Set(Object.values(map));
  if (!spaces.length) return;
  const candidates = [...spaces].sort((a, b) => (b.id === lastId) - (a.id === lastId));

  for (const space of candidates) {
    const primary = space.id === lastId && !live.has(space.id);
    const btn = el('button', {
      class: 'resume-btn' + (primary ? ' primary' : ''),
      title: live.has(space.id)
        ? `“${space.name}” is open in another window — click to focus it`
        : `Open “${space.name}” in this window`
    });
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
    ...(all['*'] ?? []).map((g, i) => ({ g, scope: '*', index: i })),
    ...(all[pageScope()] ?? []).map((g, i) => ({ g, scope: pageScope(), index: i }))
  ];

  const checks = [];
  entries.forEach((entry, gi) => {
    const { g: group } = entry;
    const section = el('section');
    section.style.setProperty('--accent', group.accent || ACCENTS[gi % ACCENTS.length]);
    // Explicit size wins; otherwise the first of several groups goes wide.
    if (group.span === 'full') section.classList.add('wide');
    else if (group.span === 2) section.classList.add('span2');
    else if (gi === 0 && entries.length > 1) section.classList.add('wide');
    section.style.animationDelay = gi * 70 + 'ms';
    const links = (group.links || []).filter((l) => l.url);

    if (editing) {
      section.appendChild(buildGroupEditor(entry));
    } else {
      const h2 = el('h2', {}, group.title || 'Links', el('span', { class: 'count' }, String(links.length)));
      if (entry.scope === '*') h2.appendChild(el('span', { class: 'scope' }, 'everywhere'));
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
  const key = entry.scope;

  const mutate = async (fn) => {
    const all = await getAllGroups();
    const groups = all[key] ?? [];
    fn(groups);
    await saveScope(key, groups);
    render();
  };

  // Move the group to another scope bucket (everywhere / generic / a Space).
  const moveScope = async (newKey) => {
    if (newKey === key) return;
    const all = await getAllGroups();
    const from = all[key] ?? [];
    const [moved] = from.splice(entry.index, 1);
    if (!moved) return;
    if (from.length) all[key] = from;
    else delete all[key];
    (all[newKey] ??= []).push(moved);
    await chrome.storage.local.set({ [K_LINKS]: all });
    render();
  };

  const scopeSel = el('select', { class: 'g-select', title: 'Where this group appears' },
    el('option', { value: '*' }, 'Everywhere'),
    el('option', { value: GENERIC }, 'Outside Spaces'),
    ...spacesCache.map((s) => el('option', { value: s.id }, 'Only ' + s.name))
  );
  scopeSel.value = key;
  scopeSel.addEventListener('change', (e) => moveScope(e.target.value));

  const sizeSel = el('select', { class: 'g-select', title: 'How wide this group is' },
    el('option', { value: 'auto' }, 'Auto width'),
    el('option', { value: '2' }, '2 columns'),
    el('option', { value: 'full' }, 'Full width')
  );
  sizeSel.value = group.span === 'full' ? 'full' : group.span === 2 ? '2' : 'auto';
  sizeSel.addEventListener('change', (e) => mutate((gs) => {
    if (!gs[entry.index]) return;
    if (e.target.value === 'auto') delete gs[entry.index].span;
    else gs[entry.index].span = e.target.value === 'full' ? 'full' : 2;
  }));

  const head = el('div', { class: 'g-controls' },
    el('input', {
      type: 'text', class: 'g-title', value: group.title ?? '', placeholder: 'Group title',
      onchange: (e) => mutate((gs) => { if (gs[entry.index]) gs[entry.index].title = e.target.value; })
    }),
    scopeSel,
    sizeSel,
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
  // New groups land in this page's own scope (the Space, or the generic
  // page); the group's scope dropdown moves it elsewhere.
  const key = pageScope();
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
    $('#io-text').textContent =
      'All link groups, by scope ("*" = everywhere, "generic" = outside Spaces, otherwise a Space id):';
    $('#io-area').value = JSON.stringify(await getAllGroups(), null, 2);
    $('#io-ok').hidden = true;
    dialog.showModal();
  });
  $('#import-btn').addEventListener('click', () => {
    $('#io-text').textContent = currentSpace
      ? `Paste either a full export (object keyed by scope) or an array of groups to add to “${currentSpace.name}”.`
      : 'Paste either a full export (object keyed by scope) or an array of groups to add to this generic page.';
    $('#io-area').value = '';
    $('#io-ok').hidden = false;
    dialog.showModal();
  });
  $('#io-cancel').addEventListener('click', () => dialog.close());
  $('#io-ok').addEventListener('click', async () => {
    try {
      const parsed = JSON.parse($('#io-area').value);
      if (Array.isArray(parsed)) {
        const key = pageScope();
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
    spacesCache = await getSpaces();
    const win = await chrome.windows.getCurrent();
    winId = win.id;
    const map = await getWinMap();
    const spaceId = map[win.id];
    if (spaceId) space = spacesCache.find((s) => s.id === spaceId) ?? null;
  } catch { /* render spaceless */ }
  currentSpace = space;

  // The mapping can change after this page read it (a switch in flight,
  // startup re-association, Chrome pre-rendering this page early). When
  // this window's mapping no longer matches what we rendered, re-init —
  // that also applies the homepage redirect. Checked on storage events,
  // whenever the page becomes visible, and twice shortly after load.
  const recheckMapping = async () => {
    if (editing || winId == null) return;
    try {
      const map = await getWinMap();
      const mappedId = map[winId] ?? null;
      if ((currentSpace?.id ?? null) !== mappedId) location.reload();
    } catch { /* stale-chip worst case */ }
  };
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.winmap) recheckMapping();
    });
  } catch { /* fall back to the polls below */ }
  setTimeout(recheckMapping, 700);
  setTimeout(recheckMapping, 2500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) recheckMapping();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) recheckMapping();
  });

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
