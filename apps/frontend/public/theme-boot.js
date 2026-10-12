// Applies the user's last theme before Angular starts (no flash). External file: the CSP forbids
// inline scripts. Format: BootCache in projects/ui/src/lib/theme/appearance-store.ts (version 2).
(function () {
  try {
    var cache = JSON.parse(localStorage.getItem('smart.theme.boot') || 'null');
    if (!cache || cache.v !== 2) return;
    var dark =
      cache.mode === 'dark' ||
      (cache.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var high =
      cache.followsSystemContrast === true && window.matchMedia('(prefers-contrast: more)').matches;
    var vars = high ? (dark ? cache.darkHigh : cache.lightHigh) : dark ? cache.dark : cache.light;
    if (!vars || typeof vars !== 'object') return;
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
