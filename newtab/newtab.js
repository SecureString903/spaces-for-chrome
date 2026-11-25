// Spaces start page. Runs as the New Tab override and adapts to the Space
// the window is in: redirects to the Space's homepage when one is set,
// otherwise renders per-Space link groups. Zero network by default —
// weather and reachability checks only run when enabled in Options.

import { getWinMap, getSpaces, getSettings, getIcons, getLastSpaceId } from '../background/state.js';

// Storage: a flat, ordered array of groups. Each group has `scopes`: a
// list containing '*' (everywhere), GENERIC (only in windows outside any
// Space), and/or Space ids — so one group can show in several Spaces.
// (Earlier versions stored { scopeKey: Group[] }; migrated on first read.)
const K_LINKS = 'linkGroups';
const GENERIC = 'generic';
const ACCENTS = ['#89b4fa', '#a6e3a1', '#cba6f7', '#fab387', '#94e2d5', '#f9e2af', '#f38ba8'];

const $ = (sel) => document.querySelector(sel);

let currentSpace = null;
let settings = null;
let editing = false;
let spacesCache = []; // for the scope dropdown in edit mode

// ---------- data ----------

// Flatten the pre-multi-scope bucket shape, preserving the visual order
// (explicit order weights first, then bucket order).
function migrateBuckets(obj) {
  const flat = [];
  let i = 0;
  for (const [key, groups] of Object.entries(obj)) {
    for (const g of groups ?? []) {
      flat.push({ ...g, scopes: [key], _k: typeof g.order === 'number' ? g.order : 1000 + i });
      i++;
    }
  }
  flat.sort((a, b) => a._k - b._k);
  for (const g of flat) {
    delete g._k;
    delete g.order;
  }
  return flat;
}

async function getGroups() {
  const { [K_LINKS]: stored } = await chrome.storage.local.get(K_LINKS);
  if (Array.isArray(stored)) return stored;
  if (stored && typeof stored === 'object') {
    const flat = migrateBuckets(stored);
    await chrome.storage.local.set({ [K_LINKS]: flat });
    return flat;
  }
  return [];
}

function saveGroups(groups) {
  return chrome.storage.local.set({ [K_LINKS]: groups });
}

// The scope key for this page: the Space's id, or the generic bucket for
// windows outside any Space.
function pageScope() {
  return currentSpace?.id ?? GENERIC;
}

function groupScopes(g) {
  return g.scopes?.length ? g.scopes : ['*'];
}

function onThisPage(g) {
  const s = groupScopes(g);
  return s.includes('*') || s.includes(pageScope());
}

function scopeLabel(g) {
  const s = groupScopes(g);
  if (s.includes('*')) return 'everywhere';
  return s
    .map((k) => (k === GENERIC ? 'outside Spaces' : spacesCache.find((sp) => sp.id === k)?.name ?? '?'))
    .join(' · ');
}

// ---------- appearance ----------

// Theme and background come from synced settings; an uploaded photo is far
// too big for storage.sync, so Options keeps it in storage.local (per
// device). The resolved look is mirrored to localStorage for theme-boot.js,
// which restyles the next load before first paint.
function applyLook() {
  const theme = settings?.ntTheme === 'light' || settings?.ntTheme === 'auto' ? settings.ntTheme : 'dark';
  const resolved =
    theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  const bg = settings?.ntBackground === 'solid' || settings?.ntBackground === 'photo'
    ? settings.ntBackground : 'blobs';
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.bg = bg;
  if (bg === 'solid' && settings?.ntColor) root.style.setProperty('--page-bg', settings.ntColor);
  else root.style.removeProperty('--page-bg');
  if (bg === 'photo') {
    chrome.storage.local.get('ntPhoto').then(({ ntPhoto }) => {
      const img = $('#bg-photo');
      if (ntPhoto && img) {
        img.src = ntPhoto;
        img.hidden = false;
      }
    }).catch(() => { /* plain background */ });
  }
  try {
    localStorage.setItem('ntLook', JSON.stringify({ t: resolved, b: bg, c: settings?.ntColor ?? null }));
  } catch { /* mirror only */ }
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
    if (cached && cached.c === settings.weatherCoords && Date.now() - cached.t < 30 * 60e3) {
      return show(cached);
    }
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${coords[0]}&longitude=${coords[1]}` +
      '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min' +
      '&temperature_unit=fahrenheit&timezone=auto&forecast_days=1'
    );
    const d = await r.json();
    const w = { t: Date.now(), c: settings.weatherCoords,
      temp: d.current.temperature_2m, code: d.current.weather_code,
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
  const groups = await getGroups();
  // Normally only this page's groups; edit mode shows every group (the
  // off-page ones dimmed) so any group can be re-scoped from anywhere.
  const entries = groups
    .map((g, i) => ({ g, index: i }))
    .filter((e) => editing || onThisPage(e.g));

  const checks = [];
  entries.forEach((entry, gi) => {
    const { g: group } = entry;
    const section = el('section');
    section.style.setProperty('--accent', group.accent || ACCENTS[gi % ACCENTS.length]);
    // Explicit size wins; otherwise the first of several groups goes wide.
    if (group.span === 'full') section.classList.add('wide');
    else if (group.span === 2) section.classList.add('span2');
    else if (gi === 0 && entries.length > 1) section.classList.add('wide');
    if (editing && !onThisPage(group)) section.classList.add('off-page');
    section.style.animationDelay = gi * 70 + 'ms';
    const links = (group.links || []).filter((l) => l.url);

    if (editing) {
      section.appendChild(buildGroupEditor(entry, gi, entries));
    } else {
      const h2 = el('h2', {}, group.title || 'Links', el('span', { class: 'count' }, String(links.length)));
      const s = groupScopes(group);
      // Badge the scope unless it's exactly "this page only".
      if (!(s.length === 1 && s[0] === pageScope())) {
        h2.appendChild(el('span', { class: 'scope' }, scopeLabel(group)));
      }
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

// Swap the group at rendered position `gi` with its neighbour. Edit mode
// renders the full flat list, so the swap is a swap in storage order too.
async function moveGroup(renderedEntries, gi, dir) {
  const j = gi + dir;
  if (j < 0 || j >= renderedEntries.length) return;
  const gs = await getGroups();
  const a = renderedEntries[gi].index;
  const b = renderedEntries[j].index;
  if (!gs[a] || !gs[b]) return;
  [gs[a], gs[b]] = [gs[b], gs[a]];
  await saveGroups(gs);
  render();
}

function buildGroupEditor(entry, gi, renderedEntries) {
  const { g: group } = entry;

  const mutate = async (fn) => {
    const gs = await getGroups();
    fn(gs);
    await saveGroups(gs);
    render();
  };

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
    sizeSel,
    el('button', { class: 'mini-btn', title: 'Move group up', onclick: () => moveGroup(renderedEntries, gi, -1) }, '▲'),
    el('button', { class: 'mini-btn', title: 'Move group down', onclick: () => moveGroup(renderedEntries, gi, 1) }, '▼'),
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

  // Where the group appears: Everywhere, or any mix of the generic page
  // and specific Spaces. Unchecking everything falls back to this page.
  const scopes = new Set(groupScopes(group));
  const scopeRow = el('div', { class: 'g-scopes' }, el('span', { class: 'g-scopes-label' }, 'Show:'));
  const targets = [
    { id: '*', label: 'Everywhere' },
    { id: GENERIC, label: 'Outside Spaces' },
    ...spacesCache.map((s) => ({ id: s.id, label: s.name }))
  ];
  for (const t of targets) {
    const cb = el('input', { type: 'checkbox', ...(scopes.has(t.id) ? { checked: '' } : {}) });
    if (t.id !== '*' && scopes.has('*')) cb.disabled = true;
    cb.addEventListener('change', () => mutate((gs) => {
      const g = gs[entry.index];
      if (!g) return;
      let next = new Set(groupScopes(g));
      if (t.id === '*') {
        next = new Set([cb.checked ? '*' : pageScope()]);
      } else {
        if (cb.checked) next.add(t.id);
        else next.delete(t.id);
        next.delete('*');
        if (!next.size) next.add(pageScope());
      }
      g.scopes = [...next];
    }));
    scopeRow.appendChild(el('label', {}, cb, t.label));
  }

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
  frag.appendChild(scopeRow);
  frag.appendChild(linksBox);
  return frag;
}

async function addGroup() {
  // New groups start scoped to this page (the Space, or the generic
  // page); the Show checkboxes widen it from there.
  const gs = await getGroups();
  gs.push({ title: 'New group', scopes: [pageScope()], links: [{ name: '', url: '' }] });
  await saveGroups(gs);
  render();
}

// ---------- import / export ----------

function setupIO() {
  const dialog = $('#io-dialog');
  $('#export-btn').addEventListener('click', async () => {
    $('#io-text').textContent =
      'All link groups, in order. Each "scopes" lists where the group shows: "*" = everywhere, "generic" = outside Spaces, otherwise Space ids.';
    $('#io-area').value = JSON.stringify(await getGroups(), null, 2);
    $('#io-ok').hidden = true;
    dialog.showModal();
  });
  $('#import-btn').addEventListener('click', () => {
    $('#io-text').textContent =
      'Paste an array of groups (added to the list; groups without "scopes" land on ' +
      (currentSpace ? `“${currentSpace.name}”` : 'this generic page') +
      ') or an old scope-keyed export (replaces everything).';
    $('#io-area').value = '';
    $('#io-ok').hidden = false;
    dialog.showModal();
  });
  $('#io-cancel').addEventListener('click', () => dialog.close());
  $('#io-ok').addEventListener('click', async () => {
    try {
      const parsed = JSON.parse($('#io-area').value);
      if (Array.isArray(parsed)) {
        const incoming = parsed.map((g) => ({ ...g, scopes: g.scopes?.length ? g.scopes : [pageScope()] }));
        await saveGroups([...(await getGroups()), ...incoming]);
      } else if (parsed && typeof parsed === 'object') {
        await saveGroups(migrateBuckets(parsed));
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
  applyLook();
  try {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (settings?.ntTheme === 'auto') applyLook();
    });
  } catch { /* fixed theme */ }
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
  // ☰ toggles the side panel. Chrome has no sidePanel.close(), so the
  // open panel closes itself when asked; its open-state is tracked in a
  // per-window session-storage key. Opening happens synchronously in
  // the click (the user gesture), which is why the state is cached here
  // instead of read at click time.
  const panelKey = 'panelOpen:' + winId;
  let panelOpen = false;
  try {
    const stored = await chrome.storage.session.get(panelKey);
    panelOpen = !!stored[panelKey];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes[panelKey]) {
        panelOpen = !!changes[panelKey].newValue;
      }
    });
  } catch { /* toggle degrades to open-only */ }
  const openPanel = () => {
    try {
      chrome.sidePanel.open(winId != null ? { windowId: winId } : {});
    } catch { /* API unavailable (e.g. harness) */ }
  };
  $('#panel-btn').addEventListener('click', async () => {
    if (!panelOpen) {
      openPanel();
      return;
    }
    panelOpen = false;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'closeSidePanel', windowId: winId });
      // Only the live panel answers closed:true. Anything else means the
      // open-state was stale — the click's transient activation usually
      // still counts, so open instead of eating the click.
      if (!res?.closed) openPanel();
    } catch {
      openPanel();
    }
  });
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
