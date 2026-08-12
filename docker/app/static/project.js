/* The one script the container adds to an HTML project's own page.
 *
 * It does two things and nothing else:
 *   1. applies the mode the link asked for  (…/#edit, …/#present)
 *   2. reloads the page when a file in the project folder changes
 *
 * The mode travels in the hash, not the path: a project ships its own copy of
 * the library, and older versions key localStorage on location.pathname —
 * serving the same deck under /edit and /present would split it into two sets
 * of slides, and work saved in the editor would be missing during the talk.
 * /p/<slug>/edit and /p/<slug>/present redirect here; they are the links you
 * share.
 *
 * The reload pauses while a presentation is running, whatever started it. A
 * page that reloads itself mid-talk is worse than a stale one.
 */
(function () {
  'use strict';

  var self = document.currentScript;
  if (!self) return;
  var SIG = self.dataset.sig || '';

  var MODES = { '#edit': 'editor', '#present': 'presentation' };

  // ── mode ───────────────────────────────────────────────────────────────
  // Poll rather than listen for izerp:ready: a project may pin any version of
  // the library, and older ones have neither that event nor isReady().
  var wanted = MODES[location.hash];
  if (wanted) {
    var tries = 0;
    var waiting = setInterval(function () {
      if (window.iZerp && typeof window.iZerp.setMode === 'function') {
        clearInterval(waiting);
        try { window.iZerp.setMode(wanted); } catch (e) { /* not our page to fix */ }
      } else if (++tries > 100) {
        clearInterval(waiting);
        console.warn('[iZerp host] no window.iZerp on this page — "' + location.hash +
                     '" not applied');
      }
    }, 100);
  }

  // ── live reload ────────────────────────────────────────────────────────
  // Long poll: the request hangs until the folder's fingerprint changes, so a
  // saved file shows up in well under a second without polling in a loop.
  var current = SIG;
  var backoff = 1000;

  // Read the mode off the DOM instead of an event: works on every version of
  // the library, and covers a talk started from the menu rather than the link.
  function presenting() {
    var root = document.getElementById('izerp-root');
    return !!root && root.dataset.mode === 'presentation';
  }

  function watch() {
    fetch('__watch?sig=' + encodeURIComponent(current), { cache: 'no-store' })
      .then(function (response) {
        if (response.status === 204) { backoff = 1000; return watch(); }
        if (!response.ok) throw new Error('watch ' + response.status);
        return response.json().then(function (data) {
          if (!data.sig || data.sig === current) { backoff = 1000; return watch(); }
          if (presenting()) {
            // Files changed during a talk. Remember where we are and look
            // again later — reloading now would drop the speaker mid-sentence.
            current = data.sig;
            return setTimeout(watch, 2000);
          }
          location.reload();
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
