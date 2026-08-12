/* Host chrome for a container-served deck: switch presentations, get back to
 * the library. Deliberately NOT part of iZerp — the library's own surface stays
 * exactly as it is (FAB bottom-left, sidebar right, rail bottom-centre); this
 * bar occupies the one corner iZerp leaves empty and steps aside the moment a
 * presentation starts.
 *
 * It is mounted on <body> only AFTER iZerp has wrapped the page content, so it
 * lives outside #izerp-canvas-wrap and does not zoom along with the slides.
 */
(function () {
  'use strict';

  var boot = window.IZERP_CONTAINER;
  if (!boot) return;

  var STYLE = [
    '#izerp-host{',
    '  position:fixed;top:22px;left:22px;z-index:2147483000;',
    '  display:flex;align-items:center;gap:8px;',
    '  padding:7px 8px 7px 10px;',
    '  font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
    '  color:rgba(243,236,218,0.74);',
    '  background:linear-gradient(158deg,rgba(255,248,232,0.07),rgba(255,248,232,0.02) 32%,transparent 64%),rgba(20,16,11,0.92);',
    '  -webkit-backdrop-filter:blur(30px) saturate(1.5);backdrop-filter:blur(30px) saturate(1.5);',
    '  border:1px solid rgba(198,154,76,0.16);border-top-color:rgba(236,207,146,0.42);',
    '  border-radius:10px;',
    '  box-shadow:inset 0 1px 0 rgba(255,248,232,0.10),0 10px 30px rgba(0,0,0,0.55);',
    '  transition:opacity .28s cubic-bezier(.4,0,.2,1),transform .28s cubic-bezier(.4,0,.2,1);',
    '}',
    '#izerp-host[hidden]{display:none}',
    '#izerp-host.izerp-host-away{opacity:0;pointer-events:none;transform:translateY(-10px)}',
    '#izerp-host a{color:rgba(243,236,218,0.74);text-decoration:none;padding:4px 6px;border-radius:7px}',
    '#izerp-host a:hover{color:#f3ecda;background:rgba(198,154,76,0.12)}',
    '#izerp-host a:focus-visible,#izerp-host select:focus-visible{outline:2px solid #eccf92;outline-offset:2px}',
    '#izerp-host .izerp-host-sep{width:1px;align-self:stretch;background:rgba(198,154,76,0.16)}',
    '#izerp-host select{',
    '  font:inherit;color:#f3ecda;background:rgba(14,12,10,0.9);',
    '  border:1px solid rgba(198,154,76,0.16);border-radius:7px;',
    '  padding:5px 8px;max-width:min(46vw,320px);cursor:pointer;',
    '}',
    '#izerp-host select:hover{border-color:rgba(198,154,76,0.30)}',
    '@media (max-width:600px){#izerp-host{top:14px;left:14px;right:14px;font-size:13px}}',
    '@media (prefers-reduced-motion:reduce){#izerp-host{transition:none}}'
  ].join('\n');

  function sep() {
    var rule = document.createElement('span');
    rule.className = 'izerp-host-sep';
    return rule;
  }

  function mount() {
    if (document.getElementById('izerp-host')) return;

    var style = document.createElement('style');
    style.id = 'izerp-host-style';
    style.textContent = STYLE;
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'izerp-host';

    var home = document.createElement('a');
    home.href = '/';
    home.textContent = '◂ Library';
    home.title = 'All presentations on this volume';
    bar.appendChild(home);

    var decks = boot.decks || [];
    if (decks.length > 1) {
      bar.appendChild(sep());

      var label = document.createElement('label');
      label.className = 'izerp-sr-only';
      label.setAttribute('for', 'izerp-host-switch');
      label.textContent = 'Switch presentation';
      bar.appendChild(label);

      var select = document.createElement('select');
      select.id = 'izerp-host-switch';
      decks.forEach(function (deck) {
        var option = document.createElement('option');
        option.value = deck.slug;
        option.textContent = deck.name;
        if (deck.slug === boot.slug) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', function () {
        if (select.value && select.value !== boot.slug) {
          location.href = '/p/' + encodeURIComponent(select.value) + '/';
        }
      });
      bar.appendChild(select);
    }

    // First child, not last: appended at the end the bar would sit behind
    // iZerp's whole menu in the tab order, and reaching "Library" by keyboard
    // would mean tabbing through every control of the library first.
    document.body.insertBefore(bar, document.body.firstChild);

    // Only visible at rest. In presentation mode it would sit on the stage; in
    // editor mode iZerp's own toolbar owns the top strip and would cover it;
    // over the menu and settings overlays it would float on top of the dim.
    document.addEventListener('izerp:modechange', function (event) {
      var mode = event.detail && event.detail.mode;
      bar.classList.toggle('izerp-host-away', mode !== 'idle');
    });

    // /p/<slug>/present and /p/<slug>/edit redirect here with a hash — one
    // click from the library to a running talk instead of page → FAB → menu.
    var wanted = { '#edit': 'editor', '#present': 'presentation' }[location.hash];
    if (wanted && window.iZerp && window.iZerp.isReady()) {
      window.iZerp.setMode(wanted);
    }
  }

  // iZerp wraps the body content when it initialises; mounting before that
  // would put this bar inside the zoomable canvas.
  document.addEventListener('izerp:ready', mount);
  if (window.iZerp && window.iZerp.isReady && window.iZerp.isReady()) mount();
  // Fallback: iZerp missing or failed to start — the way back must still exist.
  window.addEventListener('load', function () { setTimeout(mount, 300); });
})();
