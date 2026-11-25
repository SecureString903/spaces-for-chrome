const DEFAULTS = {
  bookmarkMode: 'switch',
  lazyLoad: true,
  maxBackups: 15,
  chipStyle: 'name',
  greetingName: '',
  weatherCoords: '',
  statusChecks: false
};

let toastTimer = null;
function toast(text) {
  const node = document.querySelector('#toast');
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 1600);
}

// A stored value outside the rendered radio set (corruption, or synced from
// a newer version) must not crash load() — a blank form plus the wired
// change->save handlers would let one click overwrite every setting.
function checkRadio(name, value, fallback) {
  const radios = [...document.querySelectorAll(`input[name="${name}"]`)];
  const target = radios.find((r) => r.value === value) ?? radios.find((r) => r.value === fallback);
  if (target) target.checked = true;
}

async function load() {
  const { settings = {} } = await chrome.storage.sync.get('settings');
  const s = { ...DEFAULTS, ...settings };
  checkRadio('bookmarkMode', s.bookmarkMode, DEFAULTS.bookmarkMode);
  document.querySelector('#lazyLoad').checked = s.lazyLoad;
  document.querySelector('#maxBackups').value = s.maxBackups;
  document.querySelector('#greetingName').value = s.greetingName;
  document.querySelector('#weatherCoords').value = s.weatherCoords;
  document.querySelector('#statusChecks').checked = s.statusChecks;
  checkRadio('chipStyle', s.chipStyle, DEFAULTS.chipStyle);
}

// The weather field takes "lat, lon" directly, or a place name that is
// resolved to coordinates once (open-meteo's geocoder — the same opt-in
// provider the forecast uses) and stored as coordinates.
async function resolveWeatherInput() {
  const input = document.querySelector('#weatherCoords');
  const hint = document.querySelector('#weatherHint');
  const text = input.value.trim();
  hint.hidden = true;
  if (!text) return '';
  const parts = text.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length === 2 && parts.every(Number.isFinite)) return text;
  hint.hidden = false;
  hint.textContent = `Looking up “${text}”…`;
  try {
    const lookup = async (q) => {
      const r = await fetch(
        'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' +
        encodeURIComponent(q)
      );
      return (await r.json()).results?.[0] ?? null;
    };
    // "City, State" often matches better as just "City".
    const hit = (await lookup(text)) ?? (await lookup(text.split(',')[0].trim()));
    if (!hit) {
      hint.textContent = 'Place not found — try just the city name, or coordinates as “lat, lon”.';
      return '';
    }
    const coords = `${hit.latitude.toFixed(4)}, ${hit.longitude.toFixed(4)}`;
    input.value = coords;
    hint.textContent = `Using ${[hit.name, hit.admin1, hit.country].filter(Boolean).join(', ')} (${coords})`;
    return coords;
  } catch {
    hint.textContent = 'Lookup failed (offline?) — enter coordinates as “lat, lon”.';
    return '';
  }
}

async function save() {
  const settings = {
    bookmarkMode: document.querySelector('input[name="bookmarkMode"]:checked')?.value ?? 'switch',
    lazyLoad: document.querySelector('#lazyLoad').checked,
    maxBackups: Math.min(50, Math.max(1, Number(document.querySelector('#maxBackups').value) || 15)),
    chipStyle: document.querySelector('input[name="chipStyle"]:checked')?.value ?? 'name',
    greetingName: document.querySelector('#greetingName').value.trim(),
    weatherCoords: await resolveWeatherInput(),
    statusChecks: document.querySelector('#statusChecks').checked
  };
  await chrome.storage.sync.set({ settings });
  toast('Saved');
}

document.querySelectorAll('input').forEach((input) => input.addEventListener('change', save));
document.querySelector('#shortcuts-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
document.querySelector('#version').textContent = `Spaces v${chrome.runtime.getManifest().version}`;

load();
