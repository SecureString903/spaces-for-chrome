const DEFAULTS = {
  bookmarkMode: 'switch',
  lazyLoad: true,
  maxBackups: 15,
  keepWindowOpen: false,
  homepageUrl: ''
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

async function load() {
  const { settings = {} } = await chrome.storage.sync.get('settings');
  const s = { ...DEFAULTS, ...settings };
  document.querySelector(`input[name="bookmarkMode"][value="${s.bookmarkMode}"]`).checked = true;
  document.querySelector('#lazyLoad').checked = s.lazyLoad;
  document.querySelector('#maxBackups').value = s.maxBackups;
  document.querySelector('#keepWindowOpen').checked = s.keepWindowOpen;
  document.querySelector('#homepageUrl').value = s.homepageUrl;
}

async function save() {
  let homepageUrl = document.querySelector('#homepageUrl').value.trim();
  if (homepageUrl && !/^[a-z][a-z0-9+.-]*:/i.test(homepageUrl)) {
    homepageUrl = 'https://' + homepageUrl;
    document.querySelector('#homepageUrl').value = homepageUrl;
  }
  const settings = {
    bookmarkMode: document.querySelector('input[name="bookmarkMode"]:checked')?.value ?? 'switch',
    lazyLoad: document.querySelector('#lazyLoad').checked,
    maxBackups: Math.min(50, Math.max(1, Number(document.querySelector('#maxBackups').value) || 15)),
    keepWindowOpen: document.querySelector('#keepWindowOpen').checked,
    homepageUrl
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
