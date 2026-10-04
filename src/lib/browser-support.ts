/** Runs before hydration; recovery uses a static page that needs no framework. */
export const BROWSER_SUPPORT_GUARD = `(function () {
  var supported = false;
  try {
    var css = window.CSS;
    supported = !!css && typeof css.supports === 'function'
      && typeof css.registerProperty === 'function'
      && css.supports('color', 'oklch(0.5 0.1 120)')
      && css.supports('color', 'color-mix(in oklab, white, black)')
      && css.supports('selector(:has(*))')
      && typeof Array.prototype.findLast === 'function';
  } catch (_) {}
  if (!supported) {
    window.location.replace('/browser-update.html#' + (document.documentElement.lang === 'ar' ? 'ar' : 'en'));
  }
})();`;
