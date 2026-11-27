// Runs synchronously in <head> (before first paint) so there is no theme flash.
// Preference: 'auto' (follow the device), 'light' or 'dark'.
(function () {
  var KEY = 'pn-theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function pref() {
    try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
  }
  function apply() {
    var p = pref();
    var dark = p === 'dark' || (p === 'auto' && mq && mq.matches);
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  }
  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  window.pnTheme = {
    get: pref,
    set: function (v) {
      try { localStorage.setItem(KEY, v); } catch (e) {}
      apply();
    },
  };
})();
