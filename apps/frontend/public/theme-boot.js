// Applies the user's last theme before Angular starts (no flash). External file: the CSP forbids inline scripts.
(function () {
  try {
    var cache = JSON.parse(localStorage.getItem('smart.theme.boot') || 'null');
    if (!cache || !cache.light || !cache.dark) return;
    var dark =
      cache.mode === 'dark' ||
      (cache.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var vars = dark ? cache.dark : cache.light;
    var style = document.documentElement.style;
    var applied = 0;
    for (var name in vars) {
      if (name.indexOf('--') === 0 && typeof vars[name] === 'string') {
        style.setProperty(name, vars[name]);
        applied++;
      }
    }
    // Without variables the default theme stays, so its color scheme must stay too.
    if (applied > 0) style.colorScheme = dark ? 'dark' : 'light';
  } catch {
    // Storage unavailable or corrupt: the build-time default theme applies.
  }
})();
