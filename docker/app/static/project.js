/* The one script the container adds to an HTML project's own page.
 *
 * It does two things and nothing else:
 *   1. puts iZerp into the mode the route asked for (/edit, /present)
 *   2. reloads the page when a file in the project folder changes
 *
 * The reload is deliberately absent on /present — a page that reloads itself
 * mid-talk is worse than a stale one. Build with your own toolchain on the
 * host; the container only notices that the files moved.
 */
(function () {
  'use strict';

  var self = document.currentScript;
  if (!self) return;
  var MODE = self.dataset.mode || '';
  var WATCH = self.dataset.watch === '1';
  var SIG = self.dataset.sig || '';

  // ── mode ───────────────────────────────────────────────────────────────
  // Poll rather than listen: a project may ship any version of the library,
  // and older ones have neither izerp:ready nor isReady().
  if (MODE) {
    var tries = 0;
    var waiting = setInterval(function () {
      if (window.iZerp && typeof window.iZerp.setMode === 'function') {
        clearInterval(waiting);
        try { window.iZerp.setMode(MODE); } catch (e) { /* not our page to fix */ }
      } else if (++tries > 100) {
        clearInterval(waiting);
        console.warn('[iZerp host] no window.iZerp on this page — mode "' + MODE + '" not applied');
      }
    }, 100);
  }

  // ── live reload ────────────────────────────────────────────────────────
  // Long poll: the request hangs until the folder's fingerprint changes, so a
  // saved file shows up in well under a second without polling in a loop.
  if (!WATCH) return;

  var current = SIG;
  var backoff = 1000;

  function watch() {
    fetch('__watch?sig=' + encodeURIComponent(current), { cache: 'no-store' })
      .then(function (response) {
        if (response.status === 204) { backoff = 1000; return watch(); }   // nothing changed
        if (!response.ok) throw new Error('watch ' + response.status);
        return response.json().then(function (data) {
          if (data.sig && data.sig !== current) location.reload();
          else { backoff = 1000; watch(); }
        });
      })
      .catch(function () {
        // Server restarting, laptop asleep, network blip — keep trying, slower.
        setTimeout(watch, backoff);
        backoff = Math.min(backoff * 2, 15000);
      });
  }

  watch();
})();
