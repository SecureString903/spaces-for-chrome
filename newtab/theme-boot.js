// Pre-paint restyle. newtab.js mirrors the resolved look (theme, background
// mode, solid color) into localStorage; module scripts run after parse, so
// without this a light or solid-color page would flash dark glass first.
// Settings remain authoritative — newtab.js re-applies them on load.
try {
  var look = JSON.parse(localStorage.getItem('ntLook') || 'null');
  if (look && look.t) document.documentElement.dataset.theme = look.t;
  if (look && look.b) document.documentElement.dataset.bg = look.b;
  if (look && look.b === 'solid' && look.c) {
    document.documentElement.style.setProperty('--page-bg', look.c);
  }
  if (look && look.o) document.documentElement.dataset.on = look.o;
} catch (e) { /* first load: default dark glass */ }
