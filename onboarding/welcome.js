document.querySelector('#open-panel-btn').addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  // Requires a user gesture, which this click provides.
  chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
});

document.querySelector('#options-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
