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

async function save() {
  const settings = {
    bookmarkMode: document.querySelector('input[name="bookmarkMode"]:checked')?.value ?? 'switch',
    lazyLoad: document.querySelector('#lazyLoad').checked,
    maxBackups: Math.min(50, Math.max(1, Number(document.querySelector('#maxBackups').value) || 15)),
    chipStyle: document.querySelector('input[name="chipStyle"]:checked')?.value ?? 'name',
    greetingName: document.querySelector('#greetingName').value.trim(),
    weatherCoords: document.querySelector('#weatherCoords').value.trim(),
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
