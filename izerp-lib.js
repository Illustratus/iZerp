/**
 * izerp-lib.js — iZerp PanZoom Presentation Library v1.5
 * Turns any HTML page into a zoom-and-pan ("Prezi-style") presentation.
 * Wraps the page content in a zoomable canvas; saved viewports become slides.
 *
 * Drop-in usage (auto-initialises on DOMContentLoaded):
 *   <link rel="stylesheet" href="izerp-lib.css">
 *   <script src="izerp-lib.js"></script>   <!-- LAST, before </body> -->
 *
 * Configuration — three equivalent sources, merged in this order of
 * precedence (later wins): defaults  →  window.iZerpConfig  →  data-*
 * attributes on the <script> tag  →  options passed to iZerp.init().
 *
 *   Key           data-* attribute     Meaning
 *   ───────────   ──────────────────   ─────────────────────────────────
 *   slides        data-slides          URL of a companion .izerp file to
 *                                       load as the default deck (http[s]).
 *   lang          data-lang            'de' | 'en' | 'auto' (default 'auto').
 *   storageKey    data-storage-key     Fixed key suffix for slide storage.
 *                                       Default: the page URL, so decks are
 *                                       per-page. Set this to share one deck
 *                                       across URLs (or survive renames).
 *   persist       data-persist         'false' → never touch localStorage for
 *                                       slides (in-memory / data-slides only).
 *   fab           data-fab             'false' → hide the launcher button;
 *                                       drive iZerp via the API instead.
 *   target        data-target          CSS selector of the element whose
 *                                       children become the canvas. Default:
 *                                       <body>. Use a full-viewport stage.
 *   autoInit      data-auto-init       'false' → do not auto-init; call
 *                                       iZerp.init(options) yourself.
 *
 * Programmatic API is documented at the bottom (window.iZerp) — includes
 * iZerp.init(opts), iZerp.destroy(), the event API (iZerp.on/off) and getters.
 */
(function () {
  'use strict';

  // The <script src="izerp-lib.js"> element — captured now (currentScript is
  // only valid during this synchronous top-level run, not later in init()).
  // Its data-* attributes configure iZerp, e.g. data-slides="folien.izerp".
  const SCRIPT_EL = document.currentScript;

  /* ════════════════════════════════════════════════════════════
     CONSTANTS
     ════════════════════════════════════════════════════════════ */
  const VERSION      = '1.5';
  const FLY_DURATION = '0.85s';
  const EASE_CAM     = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const SIDEBAR_W    = 320; // sidebar width in px — must match CSS --p-sidebar-w
  const BAR_H        = 64;  // editor toolbar height — must match CSS --p-bar-h

  /* ════════════════════════════════════════════════════════════
     CONFIGURATION
     ----------------------------------------------------------------
     Resolved once in init() from three sources (see file header).
     ════════════════════════════════════════════════════════════ */
  const CONFIG = {
    slides:     null,    // URL of a .izerp file to auto-load as the default deck
    lang:       'auto',  // 'de' | 'en' | 'auto'
    storageKey: null,    // fixed suffix; null → use the page URL (per-page decks)
    persist:    true,    // false → never read/write slides in localStorage
    fab:        true,    // false → hide the launcher button (use the API)
    target:     null,    // selector of the element to wrap (null → document.body)
    autoInit:   true,    // false → skip auto-init; caller runs iZerp.init()
    languages:  null,    // { code: {…strings} } — add/override UI languages
  };

  // Coerce a data-* / config string into the type the default implies.
  function coerceConfigValue(key, raw) {
    if (raw == null) return undefined;
    const def = CONFIG[key];
    if (typeof def === 'boolean') {
      if (raw === true || raw === false) return raw;
      const s = String(raw).trim().toLowerCase();
      if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
      if (s === 'true'  || s === '1' || s === 'yes' || s === 'on')  return true;
      return def;
    }
    return raw;
  }

  // Merge one config source (object) into CONFIG, coercing types.
  function mergeConfig(src) {
    if (!src || typeof src !== 'object') return;
    Object.keys(CONFIG).forEach(key => {
      if (key in src) {
        const v = coerceConfigValue(key, src[key]);
        if (v !== undefined) CONFIG[key] = v;
      }
    });
  }

  // Read data-* attributes off the <script> tag into a config-shaped object.
  //   data-storage-key → storageKey, data-auto-init → autoInit, etc.
  function configFromDataset(ds) {
    if (!ds) return {};
    const out = {};
    const map = {
      slides: 'slides', lang: 'lang', storageKey: 'storageKey',
      persist: 'persist', fab: 'fab', target: 'target', autoInit: 'autoInit',
    };
    Object.keys(map).forEach(k => { if (ds[k] != null) out[map[k]] = ds[k]; });
    return out;
  }

  // Merge the ambient sources (global object + data-* attributes). Options
  // passed to iZerp.init() are layered on top inside init() itself.
  function resolveConfig() {
    mergeConfig(window.iZerpConfig);                                // 1) global object
    mergeConfig(configFromDataset(SCRIPT_EL && SCRIPT_EL.dataset)); // 2) data-*
  }

  function storageKey() {
    const suffix = CONFIG.storageKey != null
      ? CONFIG.storageKey
      : location.pathname + location.search;
    return 'izerp:slides:' + suffix;
  }

  /* ════════════════════════════════════════════════════════════
     I18N
     ════════════════════════════════════════════════════════════ */
  const STRINGS = {
    de: {
      fabTitle:            'iZerp öffnen / schließen',
      fabAriaLabel:        'iZerp öffnen',
      menuAriaLabel:       'iZerp Menü',
      closeEsc:            'Schließen (Esc)',
      close:               'Schließen',
      editorLabel:         'Editor',
      editorDesc:          'Folien setzen & verwalten',
      presentationLabel:   'Presentation',
      presentationDesc:    'Präsentation starten',
      settingsLabel:       'Settings',
      settingsDesc:        'Farben & Export',
      slidesCount:         (n) => '<strong>' + n + '</strong> Folie' + (n !== 1 ? 'n' : '') + ' gespeichert',
      escClose:            'ESC schließen',
      editorToolbar:       'Editor Werkzeugleiste',
      zoomOut:             'Zoom Out',
      zoomIn:              'Zoom In',
      zoomTitle:           'Klick: auf 100% zurücksetzen',
      setSlide:            'Folie setzen',
      setSlideTitle:       'Aktuellen Ausschnitt als neue Folie speichern',
      updateSlide:         'Folie aktualisieren',
      updateSlideTitle:    'Ausschnitt auf gewählte Folie anwenden',
      removeSlide:         'Entfernen',
      removeSlideTitle:    'Aktuelle Folie entfernen',
      noSlides:            'KEINE FOLIEN',
      slidesLabel:         (n) => n + ' FOLIE' + (n !== 1 ? 'N' : ''),
      prev:                'Zurück',
      prevTitle:           'Zur vorigen Folie (←)',
      next:                'Weiter',
      nextTitle:           'Zur nächsten Folie (→)',
      exit:                'Beenden',
      exitEditorTitle:     'Editor beenden (Esc)',
      sidebarAriaLabel:    'Folienliste',
      folien:              'FOLIEN',
      presExitTitle:       'Präsentation beenden (Esc)',
      speaker:             'SPEAKER',
      folieLabel:          'FOLIE',
      zeitLabel:           'ZEIT',
      resetTitle:          'Timer zurücksetzen',
      reset:               'RESET',
      speakerNow:          'AKTUELL',
      speakerNext:         'NÄCHSTE',
      notesToggle:         'Sprechernotizen (N)',
      noNotes:             'Keine Notizen für diese Folie.',
      endOfDeck:           'Ende — Fragerunde',
      presHint:            '← → Navigieren · LEER Pointer · N Notizen · ESC Beenden',
      settingsAriaLabel:   'Einstellungen',
      settingsHd:          'EINSTELLUNGEN',
      secColors:           'Farben',
      secFile:             'Datei',
      secDanger:           'Gefahrenzone',
      primaryColor:        'Primärfarbe',
      primaryHint:         'Akzent · Fortschritt · Buttons',
      secondaryColor:      'Sekundärfarbe',
      secondaryHint:       'Panel-Hintergrund',
      tertiaryColor:       'Tertiärfarbe',
      tertiaryHint:        'Text auf Panels',
      exportBtn:           'Als .izerp speichern',
      importBtn:           '.izerp öffnen',
      fileHint:            'Folien & Einstellungen als JSON-Datei exportieren / importieren. Format: <code>.izerp</code>',
      clearBtn:            'Alle Folien löschen',
      saveSettings:        'EINSTELLUNGEN SPEICHERN',
      secLang:             'Sprache',
      langDe:              'Deutsch',
      langEn:              'English',
      toastTimerReset:     'Timer zurückgesetzt',
      toastSettingsSaved:  'Einstellungen gespeichert',
      toastNotesSaved:     'Notizen gespeichert',
      toastDeleted:        (title) => '"' + title + '" gelöscht',
      toastAllDeleted:     'Alle Folien gelöscht',
      confirmClear:        (n) => 'Wirklich alle ' + n + ' Folien löschen?',
      defaultSlideTitle:   (n) => 'Folie ' + n,
      notesPh:             'Notizen…',
      dragTitle:           'Reihenfolge ändern',
      gotoTitle:           'Zu Folie fliegen',
      deleteTitle:         'Folie löschen',
      logSlide:            (title, m, s) => '[iZerp] Folie "' + title + '" — ' + m + ':' + s,
      saveDialogTitle:     'iZerp-Folien speichern',
      saveDialogFail:      'Speichern fehlgeschlagen',
      loadDialogFail:      'Öffnen fehlgeschlagen',
      invalidFile:         'Ungültige Datei',
      invalidIzerp:        'Ungültige iZerp-Datei',
      toastSaved:          (n) => 'Folie ' + n + ' gesetzt',
      toastUpdated:        (title) => '"' + title + '" aktualisiert',
      toastRemoved:        (title) => '"' + title + '" entfernt',
      toastDownloaded:     'Download gestartet',
      toastFileSaved:      'Als .izerp gespeichert',
      toastOrderUpdated:   'Reihenfolge aktualisiert',
      toastZoom100:        'Zoom → 100%',
      toastImported:       (n) => n + ' Folie' + (n !== 1 ? 'n' : '') + ' geladen',
    },
    en: {
      fabTitle:            'Open / close iZerp',
      fabAriaLabel:        'Open iZerp',
      menuAriaLabel:       'iZerp Menu',
      closeEsc:            'Close (Esc)',
      close:               'Close',
      editorLabel:         'Editor',
      editorDesc:          'Set & manage slides',
      presentationLabel:   'Presentation',
      presentationDesc:    'Start presentation',
      settingsLabel:       'Settings',
      settingsDesc:        'Colors & Export',
      slidesCount:         (n) => '<strong>' + n + '</strong> slide' + (n !== 1 ? 's' : '') + ' saved',
      escClose:            'ESC to close',
      editorToolbar:       'Editor Toolbar',
      zoomOut:             'Zoom Out',
      zoomIn:              'Zoom In',
      zoomTitle:           'Click: reset to 100%',
      setSlide:            'Set slide',
      setSlideTitle:       'Save current view as new slide',
      updateSlide:         'Update slide',
      updateSlideTitle:    'Apply current view to selected slide',
      removeSlide:         'Remove',
      removeSlideTitle:    'Remove selected slide',
      noSlides:            'NO SLIDES',
      slidesLabel:         (n) => n + ' SLIDE' + (n !== 1 ? 'S' : ''),
      prev:                'Back',
      prevTitle:           'Previous slide (←)',
      next:                'Next',
      nextTitle:           'Next slide (→)',
      exit:                'Exit',
      exitEditorTitle:     'Exit editor (Esc)',
      sidebarAriaLabel:    'Slide list',
      folien:              'SLIDES',
      presExitTitle:       'End presentation (Esc)',
      speaker:             'SPEAKER',
      folieLabel:          'SLIDE',
      zeitLabel:           'TIME',
      resetTitle:          'Reset timer',
      reset:               'RESET',
      speakerNow:          'NOW',
      speakerNext:         'NEXT',
      notesToggle:         'Speaker notes (N)',
      noNotes:             'No notes for this slide.',
      endOfDeck:           'End — Q & A',
      presHint:            '← → Navigate · SPACE Pointer · N Notes · ESC Exit',
      settingsAriaLabel:   'Settings',
      settingsHd:          'SETTINGS',
      secColors:           'Colors',
      secFile:             'File',
      secDanger:           'Danger zone',
      primaryColor:        'Primary color',
      primaryHint:         'Accent · Progress · Buttons',
      secondaryColor:      'Secondary color',
      secondaryHint:       'Panel background',
      tertiaryColor:       'Tertiary color',
      tertiaryHint:        'Text on panels',
      exportBtn:           'Save as .izerp',
      importBtn:           'Open .izerp',
      fileHint:            'Export / import slides & settings as a JSON file. Format: <code>.izerp</code>',
      clearBtn:            'Delete all slides',
      saveSettings:        'SAVE SETTINGS',
      secLang:             'Language',
      langDe:              'Deutsch',
      langEn:              'English',
      toastTimerReset:     'Timer reset',
      toastSettingsSaved:  'Settings saved',
      toastNotesSaved:     'Notes saved',
      toastDeleted:        (title) => '"' + title + '" deleted',
      toastAllDeleted:     'All slides deleted',
      confirmClear:        (n) => 'Really delete all ' + n + ' slides?',
      defaultSlideTitle:   (n) => 'Slide ' + n,
      notesPh:             'Notes…',
      dragTitle:           'Change order',
      gotoTitle:           'Fly to slide',
      deleteTitle:         'Delete slide',
      logSlide:            (title, m, s) => '[iZerp] Slide "' + title + '" — ' + m + ':' + s,
      saveDialogTitle:     'Save iZerp slides',
      saveDialogFail:      'Save failed',
      loadDialogFail:      'Open failed',
      invalidFile:         'Invalid file',
      invalidIzerp:        'Invalid iZerp file',
      toastSaved:          (n) => 'Slide ' + n + ' set',
      toastUpdated:        (title) => '"' + title + '" updated',
      toastRemoved:        (title) => '"' + title + '" removed',
      toastDownloaded:     'Download started',
      toastFileSaved:      'Saved as .izerp',
      toastOrderUpdated:   'Order updated',
      toastZoom100:        'Zoom → 100%',
      toastImported:       (n) => n + ' slide' + (n !== 1 ? 's' : '') + ' loaded',
    },
  };

  function detectLang() {
    const stored = (() => { try { const r = localStorage.getItem('izerp:settings'); return r ? JSON.parse(r).lang : null; } catch(_){} return null; })();
    if (stored === 'de' || stored === 'en') return stored;
    const browser = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    return browser.startsWith('de') ? 'de' : 'en';
  }

  function t(key, ...args) {
    const s = STRINGS[state.settings.lang] || STRINGS.en;
    // Per-key fallback to English, then to the key itself — so a custom or
    // partial language dict only needs to override the strings it cares about.
    let val = s[key];
    if (val == null && s !== STRINGS.en) val = STRINGS.en[key];
    return typeof val === 'function' ? val(...args) : (val != null ? val : key);
  }

  // Register (or extend) a UI language at runtime — no source edit needed.
  //   iZerp.registerLanguage('fr', { editorLabel: 'Éditeur', … })
  // Partial dicts are fine; missing keys fall back to English (see t()).
  // Call before init(), or set config.languages; takes effect on next rebuild.
  function registerLanguage(code, dict) {
    if (!code || !dict || typeof dict !== 'object') return;
    STRINGS[code] = Object.assign({}, STRINGS[code], dict);
  }

  /* ════════════════════════════════════════════════════════════
     STATE
     ════════════════════════════════════════════════════════════ */
  const state = {
    mode:           'idle',
    slides:         [],
    currentSlide:   -1,
    camera:         { tx: 0, ty: 0, scale: 1 },
    panning:        false,
    panStart:       null,
    camAtPanStart:  null,
    sidebarOpen:    false,
    timerStart:     null,
    timerInterval:  null,
    laserActive:     false,
    spaceHoldTimer:  null,
    slideEnteredAt:  null,
    mouseX:          0,
    mouseY:          0,
    settings: {
      colorPrimary:   '#c69a4c',
      colorSecondary: '#0e0c0a',
      colorTertiary:  '#f3ecda',
      lang:           'auto',
    },
  };

  /* ════════════════════════════════════════════════════════════
     DOM SHORTCUTS
     ════════════════════════════════════════════════════════════ */
  function $id(id) { return document.getElementById(id); }
  function wrap()  { return $id('izerp-canvas-wrap'); }

  /* ════════════════════════════════════════════════════════════
     EVENT API
     ----------------------------------------------------------------
     Let the host page react to navigation deterministically instead of
     polling geometry every frame. Subscribe via iZerp.on(type, handler)
     or listen for the bubbling DOM events 'izerp:slidechange' /
     'izerp:slidesettled' / 'izerp:modechange' on document.

       iZerp.on('slidechange', ({ index, total, slide }) => { … });

     Events
       slidechange       — fired the moment the active slide changes (camera
                           starts flying). detail: { index, total, slide, mode }
       slidesettled      — fired once the fly-to animation has finished for that
                           slide (same detail). Superseded if you navigate again
                           before it lands.
       presentationstart — fired when presentation mode begins, before the
                           first slide settles. detail: { total }
       presentationend   — fired when leaving presentation mode. detail:
                           { mode, total, elapsedMs } — mode is where you went,
                           elapsedMs is the time the talk ran.
       modechange        — fired on every mode switch. detail: { mode, total }
       ready             — fired once iZerp is initialised and the data-slides
                           file (if any) has loaded. detail: { version, total }
       deckchange        — fired whenever the slide SET changes (not navigation).
                           detail: { slides, total, reason } — reason is one of
                           'add'|'update'|'remove'|'reorder'|'clear'|'import'|
                           'load'|'edit'.
       laserchange       — fired when the laser pointer shows/hides.
                           detail: { active, x, y }
       settingschange    — fired when colours/language are saved. detail:
                           { settings }

     'index' is 0-based (-1 when nothing is active); 'slide' is the slide
     object or null.
     ════════════════════════════════════════════════════════════ */
  const FLY_MS = Math.max(0, parseFloat(FLY_DURATION) * 1000) || 0;
  const listeners = Object.create(null);
  let settleTimer = null;

  // Lifecycle bookkeeping — supports the double-init guard and destroy().
  let initialized = false;   // true once init() has run (prevents double-init)
  let hostEl      = null;    // the element whose children were wrapped in the canvas
  let scoped      = false;   // true when iZerp is scoped to a data-target container
  let hostPositionPatched = false; // we set the host's position:relative and must undo it

  function on(type, handler) {
    if (typeof handler !== 'function') return () => {};
    (listeners[type] || (listeners[type] = new Set())).add(handler);
    return () => off(type, handler);
  }
  function off(type, handler) {
    if (listeners[type]) listeners[type].delete(handler);
  }
  function emit(type, detail) {
    if (listeners[type]) {
      listeners[type].forEach(h => { try { h(detail); } catch (e) { console.error('[iZerp] listener error:', e); } });
    }
    try { document.dispatchEvent(new CustomEvent('izerp:' + type, { detail, bubbles: true })); } catch (_) {}
  }

  function slideDetail() {
    return {
      index: state.currentSlide,
      total: state.slides.length,
      slide: state.slides[state.currentSlide] || null,
      mode:  state.mode,
    };
  }

  // Announce the active slide: 'slidechange' now, 'slidesettled' once the
  // camera has arrived. A later navigation cancels a pending 'slidesettled'.
  function emitSlideChange() {
    const detail = slideDetail();
    emit('slidechange', detail);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => emit('slidesettled', slideDetail()), FLY_MS);
  }

  /* ════════════════════════════════════════════════════════════
     CAMERA
     ════════════════════════════════════════════════════════════ */
  function applyCamera(immediate) {
    const el = wrap();
    if (!el) return;
    const { tx, ty, scale } = state.camera;
    el.style.transition = immediate
      ? 'none'
      : `transform ${FLY_DURATION} ${EASE_CAM}`;
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    updateZoomPill();
  }

  // The stage's on-screen box. For the default <body> host this is the whole
  // window; for a data-target container it's that element's rect. All camera
  // math and pointer input is expressed relative to this box, so iZerp works
  // the same whether it owns the viewport or a sub-container.
  function hostRect() {
    if (CONFIG.target && hostEl && hostEl !== document.body && hostEl.getBoundingClientRect) {
      const r = hostEl.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  // Convert a viewport (client) coordinate into stage-local space.
  function toStage(clientX, clientY) {
    const r = hostRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // Returns the usable stage area, excluding the editor toolbar (top) and sidebar (right).
  // offsetX/offsetY: canvas-space origin of the usable area (always 0/barH in editor).
  function effectiveViewport() {
    const inEditor = state.mode === 'editor';
    const barH     = inEditor ? BAR_H    : 0;
    const sidebarW = inEditor ? SIDEBAR_W : 0;
    const r        = hostRect();
    return {
      vw:      r.width  - sidebarW,
      vh:      r.height - barH,
      offsetX: 0,
      offsetY: barH,
    };
  }

  function getCameraCenter() {
    const { vw, vh, offsetX, offsetY } = effectiveViewport();
    const { tx, ty, scale } = state.camera;
    return {
      cx: (offsetX + vw / 2 - tx) / scale,
      cy: (offsetY + vh / 2 - ty) / scale,
    };
  }

  // Compute display scale for a slide using contain-fit logic:
  // the recorded viewport always fits fully, larger windows show more content.
  function adaptedScale(slide) {
    const { vw, vh } = effectiveViewport();
    const recVW = slide.vw || window.innerWidth;
    const recVH = slide.vh || window.innerHeight;
    return slide.scale * Math.min(vw / recVW, vh / recVH);
  }

  function flyTo(cx, cy, scale, immediate) {
    const { vw, vh, offsetX, offsetY } = effectiveViewport();
    state.camera = {
      tx:    offsetX + vw / 2 - cx * scale,
      ty:    offsetY + vh / 2 - cy * scale,
      scale,
    };
    applyCamera(immediate);
  }

  function resetCamera() {
    state.camera = { tx: 0, ty: 0, scale: 1 };
    const el = wrap();
    if (el) { el.style.transition = ''; el.style.transform = ''; }
  }

  function resetZoomTo100() {
    const { cx, cy } = getCameraCenter();
    flyTo(cx, cy, 1, false);
    toast(t('toastZoom100'));
  }

  function zoomBy(factor, animated) {
    const { vw, vh, offsetX, offsetY } = effectiveViewport();
    const newScale = clamp(state.camera.scale * factor, 0.04, 8);
    const cx = (offsetX + vw / 2 - state.camera.tx) / state.camera.scale;
    const cy = (offsetY + vh / 2 - state.camera.ty) / state.camera.scale;
    state.camera = {
      scale: newScale,
      tx: offsetX + vw / 2 - cx * newScale,
      ty: offsetY + vh / 2 - cy * newScale,
    };
    applyCamera(!animated);
  }

  function updateZoomPill() {
    const el = $id('izerp-zoom-level');
    if (el) el.textContent = Math.round(state.camera.scale * 100) + '%';
  }

  /* ════════════════════════════════════════════════════════════
     SLIDES PERSISTENCE
     ════════════════════════════════════════════════════════════ */
  function loadSlides() {
    if (CONFIG.persist === false) return;   // in-memory only (e.g. data-slides embeds)
    try {
      const raw = localStorage.getItem(storageKey());
      if (raw) state.slides = JSON.parse(raw);
    } catch (_) { state.slides = []; }
  }

  // Every slide-set mutation routes through here, so this is also where the
  // public 'deckchange' event is announced. Pass a reason for nicer detail
  // ('add' | 'update' | 'remove' | 'reorder' | 'clear' | 'import' | 'edit').
  function saveSlides(reason) {
    // Persistence is optional; the deckchange event fires either way so hosts
    // observe every mutation whether or not it hit localStorage.
    if (CONFIG.persist !== false) {
      try { localStorage.setItem(storageKey(), JSON.stringify(state.slides)); } catch (_) {}
    }
    emit('deckchange', { slides: state.slides.slice(), total: state.slides.length, reason: reason || 'edit' });
  }

  // Auto-load slides from a companion .izerp file, configured via
  //   <script src="izerp-lib.js" data-slides="folien.izerp"></script>
  // The file acts as the DEFAULT slide set: it is loaded only when this page
  // has no slides in localStorage yet, so any edits made in the editor (which
  // persist to localStorage) always take precedence. Slides are NOT persisted
  // here — that way updating the .izerp file is reflected on the next reload,
  // until the user makes their own edits. Settings (colors) from the file are
  // applied for the authored look without overwriting the global preferences.
  // Requires http(s); over file:// the browser blocks fetch — then the user
  // imports manually via Settings → “.izerp öffnen”.
  async function loadDefaultSlides() {
    if (state.slides.length) return;                       // localStorage already has slides
    const src = SCRIPT_EL && SCRIPT_EL.dataset ? SCRIPT_EL.dataset.slides : null;
    if (!src) return;

    let data;
    try {
      const res = await fetch(src, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (e) {
      console.warn('[iZerp] Standard-Folien "' + src + '" konnten nicht geladen werden: ' + e.message +
        '. Über file:// blockiert der Browser den Zugriff — die Seite über einen lokalen Server öffnen ' +
        '(z. B. "python3 -m http.server") oder die Folien manuell über Settings → „.izerp öffnen" importieren.');
      return;
    }

    if (!data || !Array.isArray(data.slides)) return;
    state.slides       = data.slides;
    state.currentSlide = state.slides.length ? 0 : -1;
    if (data.settings && typeof data.settings === 'object') {
      Object.assign(state.settings, data.settings);
      applySettings();
      if (typeof syncSettingsInputs === 'function') syncSettingsInputs();
    }
    renderSidebar();
    updateFabCount();
    updateSetSlideBtn();
    updateEditorCenter();
    // Not persisted (the .izerp file stays the source) — announce it anyway so
    // hosts listening to 'deckchange' see the initial deck like any other.
    emit('deckchange', { slides: state.slides.slice(), total: state.slides.length, reason: 'load' });
  }

  function addSlide() {
    const { cx, cy } = getCameraCenter();
    const { vw, vh } = effectiveViewport();
    const slide = {
      id:    Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: t('defaultSlideTitle', state.slides.length + 1),
      cx, cy,
      scale: state.camera.scale,
      vw, vh,
      notes: '',
    };
    state.slides.push(slide);
    saveSlides('add');
    state.currentSlide = state.slides.length - 1;
    renderSidebar();
    updateEditorCenter();
    updateSetSlideBtn();
    updateFabCount();
    toast(t('toastSaved', state.slides.length));
  }

  function updateCurrentSlide() {
    const s = state.slides[state.currentSlide];
    if (!s) return;
    const { cx, cy } = getCameraCenter();
    const { vw, vh } = effectiveViewport();
    s.cx    = cx;
    s.cy    = cy;
    s.scale = state.camera.scale;
    s.vw    = vw;
    s.vh    = vh;
    saveSlides('update');
    renderSidebar();
    toast(t('toastUpdated', s.title));
  }

  function removeSlide() {
    if (!state.slides.length) return;
    const idx = (state.currentSlide >= 0 && state.currentSlide < state.slides.length)
      ? state.currentSlide
      : closestSlideIndex();
    if (idx < 0) return;
    const title = state.slides[idx].title;
    state.slides.splice(idx, 1);
    saveSlides('remove');
    state.currentSlide = state.slides.length ? clamp(idx, 0, state.slides.length - 1) : -1;
    renderSidebar();
    updateEditorCenter();
    updateSetSlideBtn();
    updateFabCount();
    toast(t('toastRemoved', title));
  }

  function closestSlideIndex() {
    const { cx, cy } = getCameraCenter();
    let best = -1, minD = Infinity;
    state.slides.forEach((s, i) => {
      const d = Math.hypot(s.cx - cx, s.cy - cy);
      if (d < minD) { minD = d; best = i; }
    });
    return best;
  }

  /* ════════════════════════════════════════════════════════════
     SET/UPDATE SLIDE BUTTON STATE
     ════════════════════════════════════════════════════════════ */
  function updateSetSlideBtn() {
    const btn   = $id('izerp-btn-update');
    if (!btn) return;
    const isUpdate = state.currentSlide >= 0 && state.currentSlide < state.slides.length;
    btn.disabled = !isUpdate;
    btn.title = isUpdate ? t('updateSlideTitle') : t('setSlideTitle');
  }

  /* ════════════════════════════════════════════════════════════
     FILE SAVE / LOAD (File System Access API + download fallback)
     ════════════════════════════════════════════════════════════ */
  async function saveToFile() {
    const data = JSON.stringify({
      version:  VERSION,
      savedAt:  new Date().toISOString(),
      slides:   state.slides,
      settings: state.settings,
    }, null, 2);

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'slides.izerp',
          types: [{ description: 'iZerp file', accept: { 'application/json': ['.izerp'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        toast(t('toastFileSaved'));
      } catch (e) {
        if (e.name !== 'AbortError') toast(t('saveDialogFail'));
      }
    } else {
      // Fallback: trigger browser download
      const a = document.createElement('a');
      a.href     = 'data:application/json;charset=utf-8,' + encodeURIComponent(data);
      a.download = 'slides.izerp';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast(t('toastDownloaded'));
    }
  }

  async function loadFromFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'iZerp file', accept: { 'application/json': ['.izerp', '.json'] } }],
          multiple: false,
        });
        const file = await handle.getFile();
        importData(JSON.parse(await file.text()));
      } catch (e) {
        if (e.name !== 'AbortError') toast(t('loadDialogFail'));
      }
    } else {
      const input = document.createElement('input');
      input.type   = 'file';
      input.accept = '.izerp,.json';
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        try { importData(JSON.parse(await file.text())); }
        catch (_) { toast(t('invalidFile')); }
      });
      input.click();
    }
  }

  function importData(data) {
    if (!data || typeof data !== 'object') { toast(t('invalidIzerp')); return; }
    if (Array.isArray(data.slides)) {
      state.slides       = data.slides;
      state.currentSlide = state.slides.length > 0 ? 0 : -1;
      saveSlides('import');
    }
    if (data.settings && typeof data.settings === 'object') {
      Object.assign(state.settings, data.settings);
      saveSettings();
      syncSettingsInputs();
    }
    renderSidebar();
    updateEditorCenter();
    updateSetSlideBtn();
    updateFabCount();
    toast(t('toastImported', state.slides.length));
  }

  /* ════════════════════════════════════════════════════════════
     SETTINGS PERSISTENCE
     ════════════════════════════════════════════════════════════ */
  function loadSettings() {
    try {
      const raw = localStorage.getItem('izerp:settings');
      if (raw) Object.assign(state.settings, JSON.parse(raw));
    } catch (_) {}
    // Language precedence: explicit config (data-lang / init) wins, then the
    // stored preference, then 'auto' → browser detection. Any registered code
    // is accepted (built-in de/en or one added via config.languages).
    if (CONFIG.lang && CONFIG.lang !== 'auto' && STRINGS[CONFIG.lang]) {
      state.settings.lang = CONFIG.lang;
    } else if (!state.settings.lang || state.settings.lang === 'auto') {
      state.settings.lang = detectLang();
    }
  }

  function saveSettings() {
    localStorage.setItem('izerp:settings', JSON.stringify(state.settings));
    applySettings();
    emit('settingschange', { settings: Object.assign({}, state.settings) });
  }

  function applySettings() {
    const root = $id('izerp-root');
    if (!root) return;
    root.style.setProperty('--p-primary',        state.settings.colorPrimary);
    root.style.setProperty('--p-progress-color', state.settings.colorPrimary);
    root.style.setProperty('--p-panel-bg',        state.settings.colorSecondary);
    root.style.setProperty('--p-panel-text',      state.settings.colorTertiary);
  }

  /* ════════════════════════════════════════════════════════════
     MODE MANAGEMENT
     ════════════════════════════════════════════════════════════ */
  function setMode(mode) {
    const prev = state.mode;
    state.mode = mode;
    const root = $id('izerp-root');
    if (root) root.dataset.mode = mode;

    // Reset scroll before locking it — prevents scrollX/Y from shifting the canvas origin.
    if (mode === 'editor' || mode === 'presentation') window.scrollTo(0, 0);

    document.body.classList.toggle('izerp-editor-active', mode === 'editor');
    document.body.classList.toggle('izerp-pres-active',   mode === 'presentation');
    if (mode === 'idle') resetCamera();

    setVisible('izerp-menu-overlay',      mode === 'menu');
    setVisible('izerp-editor-bar',        mode === 'editor');
    setVisible('izerp-pres-overlays',     mode === 'presentation');
    setVisible('izerp-settings-outer',     mode === 'settings');
    setVisible('izerp-settings-backdrop', mode === 'settings');

    if (mode !== 'editor' && state.sidebarOpen) {
      state.sidebarOpen = false;
      setVisible('izerp-sidebar', false);
    }
    if (mode === 'editor') {
      state.sidebarOpen = true;
      setVisible('izerp-sidebar', true);
      renderSidebar();
      updateEditorCenter();
      updateSetSlideBtn();
    }
    if (mode === 'presentation') {
      toggleSpeakerNotes(false);   // start collapsed — stage stays clear
      renderRailTicks();
      state.currentSlide  = 0;
      state.slideEnteredAt = Date.now();
      if (state.slides.length) {
        // Use adaptedScale (contain-fit) like every other navigation — otherwise
        // the first slide flies to its raw recorded scale and only fits correctly
        // once revisited.
        flyTo(state.slides[0].cx, state.slides[0].cy, adaptedScale(state.slides[0]), false);
        updatePresentationUI();
        logCurrentNotes();
        emitSlideChange();
      }
      startTimer();
      emit('presentationstart', { total: state.slides.length });
    }
    if (mode === 'settings') syncSettingsInputs();
    if (prev === 'presentation' && mode !== 'presentation') {
      logSlideTime(state.currentSlide);
      state.slideEnteredAt = null;
      const elapsedMs = state.timerStart ? Date.now() - state.timerStart : 0;
      stopTimer();
      emit('presentationend', { mode, total: state.slides.length, elapsedMs });
    }
    manageDialogFocus(mode, prev);
    if (mode !== prev) emit('modechange', { mode, total: state.slides.length });
  }

  function setVisible(id, visible) {
    const el = $id(id);
    if (el) el.classList.toggle('izerp-visible', !!visible);
  }

  /* ── Dialog focus management (a11y) ──────────────────────────────
     When the menu or settings dialog opens, move focus into it and keep
     Tab cycling inside (see trapTab in onKeyDown); on close, restore focus
     to whatever the user came from. */
  const FOCUSABLE_SEL =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let lastFocusedEl = null;

  function dialogEl() {
    if (state.mode === 'menu')     return $id('izerp-menu-overlay');
    if (state.mode === 'settings') return $id('izerp-settings-outer');
    return null;
  }
  function focusablesIn(el) {
    if (!el) return [];
    return Array.prototype.slice.call(el.querySelectorAll(FOCUSABLE_SEL))
      .filter(n => !n.hasAttribute('disabled') && (n.offsetParent !== null || n === document.activeElement));
  }
  function manageDialogFocus(mode, prev) {
    const opens = mode === 'menu' || mode === 'settings';
    const closed = prev === 'menu' || prev === 'settings';
    if (opens && !closed) lastFocusedEl = document.activeElement;
    if (opens) {
      setTimeout(() => { const f = focusablesIn(dialogEl()); (f[0] || dialogEl() || document.body).focus && (f[0] || dialogEl()).focus(); }, 0);
    } else if (closed && lastFocusedEl) {
      if (typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
      lastFocusedEl = null;
    }
  }
  function trapTab(e) {
    const el = dialogEl();
    if (!el) return;
    const f = focusablesIn(el);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1], active = document.activeElement;
    if (!el.contains(active)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  // Screen-reader announcement (polite live region built in buildUI).
  function announce(msg) {
    const el = $id('izerp-live');
    if (el) el.textContent = msg;
  }

  /* ════════════════════════════════════════════════════════════
     EDITOR UI
     ════════════════════════════════════════════════════════════ */
  function updateEditorCenter() {
    const el = $id('izerp-bar-center-label');
    if (!el) return;
    const n = state.slides.length;
    el.textContent = n === 0 ? t('noSlides') : t('slidesLabel', n);
  }

  function editorSelect(idx) {
    const s = state.slides[idx];
    if (!s) return;
    if (state.currentSlide === idx) return; // already selected, don't re-render
    state.currentSlide = idx;
    renderSidebar();
    updateEditorCenter();
    updateSetSlideBtn();
  }

  function editorGoto(idx) {
    const s = state.slides[idx];
    if (!s) return;
    state.currentSlide = idx;
    flyTo(s.cx, s.cy, adaptedScale(s), false);
    renderSidebar();
    updateEditorCenter();
    updateSetSlideBtn();
    emitSlideChange();
  }

  /* ════════════════════════════════════════════════════════════
     PRESENTATION
     ════════════════════════════════════════════════════════════ */
  function logSlideTime(slideIdx) {
    if (state.slideEnteredAt === null || slideIdx < 0 || slideIdx >= state.slides.length) return;
    const elapsed = Math.round((Date.now() - state.slideEnteredAt) / 1000);
    const m       = Math.floor(elapsed / 60);
    const sec     = elapsed % 60;
    const s       = state.slides[slideIdx];
    console.log(
      '%c' + t('logSlide', (s ? s.title : ''), m, String(sec).padStart(2, '0')),
      'color:#c69a4c;font-weight:600;font-family:monospace'
    );
  }

  function prevSlide() {
    if (state.currentSlide > 0) {
      logSlideTime(state.currentSlide);
      state.currentSlide--;
      navigateToCurrent();
    }
  }

  function nextSlide() {
    if (state.currentSlide < state.slides.length - 1) {
      logSlideTime(state.currentSlide);
      state.currentSlide++;
      navigateToCurrent();
    }
  }

  function navigateToCurrent() {
    const s = state.slides[state.currentSlide];
    if (!s) return;
    state.slideEnteredAt = Date.now();
    flyTo(s.cx, s.cy, adaptedScale(s), false);
    updatePresentationUI();
    logCurrentNotes();
    document.querySelectorAll('.izerp-slide-item').forEach((el, i) => {
      el.classList.toggle('izerp-active', i === state.currentSlide);
    });
    emitSlideChange();
  }

  function logCurrentNotes() {
    const s   = state.slides[state.currentSlide];
    const num = state.currentSlide + 1;
    const tot = state.slides.length;
    if (s && s.notes && s.notes.trim()) {
      console.log(
        '%c[iZerp] Folie ' + num + '/' + tot + ' — ' + s.title + '\n' +
        '%c' + s.notes.trim(),
        'color:#c69a4c;font-weight:600;font-family:monospace',
        'color:#888;font-family:monospace'
      );
    } else {
      console.log(
        '%c[iZerp] Folie ' + num + '/' + tot + ' — ' + (s ? s.title : ''),
        'color:#c69a4c;font-weight:600;font-family:monospace'
      );
    }
  }

  function updatePresentationUI() {
    const cur  = state.currentSlide + 1;
    const tot  = state.slides.length;
    const set  = (id, val) => { const el = $id(id); if (el) el.textContent = val; };
    set('izerp-spk-counter', cur + ' / ' + tot);
    set('izerp-rail-cur',    String(cur).padStart(2, '0'));
    set('izerp-rail-total',  ' / ' + String(tot).padStart(2, '0'));
    const fill = $id('izerp-progress-fill');
    if (fill) fill.style.width = (cur / tot * 100) + '%';
    updateSpeakerPanel();
    const s = state.slides[state.currentSlide];
    announce(t('folieLabel') + ' ' + cur + ' / ' + tot + (s && s.title ? ': ' + s.title : ''));
  }

  // Fill the collapsible presenter sheet: current title, notes, what's next.
  function updateSpeakerPanel() {
    const s  = state.slides[state.currentSlide];
    const nx = state.slides[state.currentSlide + 1];
    const set = (id, val) => { const el = $id(id); if (el) el.textContent = val; };
    set('izerp-spk-title', s ? s.title : '—');
    const notesEl = $id('izerp-spk-notes');
    if (notesEl) notesEl.textContent = (s && s.notes && s.notes.trim()) ? s.notes.trim() : t('noNotes');
    set('izerp-spk-next-title', nx ? nx.title : t('endOfDeck'));
  }

  // Engrave one graduation per slide onto the rail (drawn once per run).
  function renderRailTicks() {
    const el = $id('izerp-rail-ticks');
    if (!el) return;
    el.innerHTML = '';
    const n = state.slides.length;
    for (let i = 1; i < n; i++) {
      const tick = document.createElement('span');
      tick.className = 'izerp-rail-tick';
      tick.style.left = (i / n * 100) + '%';
      el.appendChild(tick);
    }
  }

  // Speaker notes are off by default so they never cover the stage;
  // the presenter summons them from the rail or with "N".
  function toggleSpeakerNotes(force) {
    const panel = $id('izerp-speaker');
    if (!panel) return;
    const collapsed = panel.dataset.collapsed === 'true';
    const open = (typeof force === 'boolean') ? force : collapsed;
    panel.dataset.collapsed = open ? 'false' : 'true';
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    const toggle = $id('izerp-spk-toggle');
    if (toggle) {
      toggle.classList.toggle('izerp-on', open);
      toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
    }
  }

  /* ════════════════════════════════════════════════════════════
     TIMER
     ════════════════════════════════════════════════════════════ */
  function startTimer() {
    state.timerStart    = Date.now();
    state.timerInterval = setInterval(tickTimer, 1000);
    tickTimer();
  }

  function stopTimer() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  function resetTimer() {
    state.timerStart = Date.now();
    tickTimer();
    toast(t('toastTimerReset'));
  }

  function tickTimer() {
    const elapsed = Math.floor((Date.now() - state.timerStart) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    const el = $id('izerp-spk-timer');
    if (el) {
      el.textContent  = m + ':' + String(s).padStart(2, '0');
      el.dataset.warn = elapsed > 18 * 60 ? 'red' : elapsed > 15 * 60 ? 'orange' : '';
    }
  }

  /* ════════════════════════════════════════════════════════════
     MINI-MAP THUMBNAIL
     ════════════════════════════════════════════════════════════ */
  /* ════════════════════════════════════════════════════════════
     SIDEBAR
     ════════════════════════════════════════════════════════════ */
  function renderSidebar() {
    const list = $id('izerp-slide-list');
    if (!list) return;
    list.innerHTML = '';

    state.slides.forEach((slide, i) => {
      const item = document.createElement('div');
      item.className = 'izerp-slide-item' + (i === state.currentSlide ? ' izerp-active' : '');
      item.draggable = true;
      item.dataset.idx = i;

      item.innerHTML =
        '<div class="izerp-slide-header">' +
          '<span class="izerp-drag-handle" title="' + t('dragTitle') + '">' +
            '<svg viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/></svg>' +
          '</span>' +
          '<span class="izerp-slide-num">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<div class="izerp-slide-title-edit" contenteditable="true" data-idx="' + i + '">' + esc(slide.title) + '</div>' +
          '<button class="izerp-slide-goto" data-idx="' + i + '" title="' + t('gotoTitle') + '">→</button>' +
          '<button class="izerp-slide-delete" data-idx="' + i + '" title="' + t('deleteTitle') + '">' +
            '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="izerp-slide-meta">' + Math.round(slide.scale * 100) + '% &middot; ' + Math.round(slide.cx) + ', ' + Math.round(slide.cy) + '</div>' +
        '<textarea class="izerp-slide-notes" data-idx="' + i + '" placeholder="' + t('notesPh') + '">' + esc(slide.notes || '') + '</textarea>';

      list.appendChild(item);
    });

    // Select on item click (any area that isn't a button or editable field)
    list.querySelectorAll('.izerp-slide-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        if (e.target.closest('[contenteditable]')) return;
        if (e.target.tagName === 'TEXTAREA') return;
        editorSelect(parseInt(item.dataset.idx));
      });
    });

    // Goto (fly to slide)
    list.querySelectorAll('.izerp-slide-goto').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); editorGoto(parseInt(btn.dataset.idx)); });
    });

    // Delete
    list.querySelectorAll('.izerp-slide-delete').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        const title = state.slides[idx].title;
        state.slides.splice(idx, 1);
        saveSlides('remove');
        if (state.currentSlide === idx) {
          state.currentSlide = state.slides.length ? clamp(idx, 0, state.slides.length - 1) : -1;
        } else if (state.currentSlide > idx) {
          state.currentSlide--;
        }
        renderSidebar();
        updateEditorCenter();
        updateSetSlideBtn();
        updateFabCount();
        toast(t('toastDeleted', title));
      });
    });

    // Title edit
    list.querySelectorAll('.izerp-slide-title-edit').forEach(el => {
      el.addEventListener('blur', () => {
        const idx = parseInt(el.dataset.idx);
        state.slides[idx].title = el.textContent.trim() || t('defaultSlideTitle', idx + 1);
        saveSlides();
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        e.stopPropagation();
      });
    });

    // Notes
    list.querySelectorAll('.izerp-slide-notes').forEach(el => {
      el.addEventListener('input', () => {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
      });
      el.addEventListener('blur', () => {
        const idx = parseInt(el.dataset.idx);
        state.slides[idx].notes = el.value;
        saveSlides();
        toast(t('toastNotesSaved'));
      });
      el.addEventListener('keydown', e => e.stopPropagation());
    });

    // Drag-and-drop reordering
    let dragSrcIdx = -1;

    list.querySelectorAll('.izerp-slide-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        dragSrcIdx = parseInt(item.dataset.idx);
        item.classList.add('izerp-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragSrcIdx);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('izerp-dragging');
        list.querySelectorAll('.izerp-drag-over').forEach(el => el.classList.remove('izerp-drag-over'));
      });

      item.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        list.querySelectorAll('.izerp-drag-over').forEach(el => el.classList.remove('izerp-drag-over'));
        if (parseInt(item.dataset.idx) !== dragSrcIdx) item.classList.add('izerp-drag-over');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('izerp-drag-over');
      });

      item.addEventListener('drop', e => {
        e.preventDefault();
        const targetIdx = parseInt(item.dataset.idx);
        if (dragSrcIdx === -1 || dragSrcIdx === targetIdx) return;

        const moved = state.slides.splice(dragSrcIdx, 1)[0];
        state.slides.splice(targetIdx, 0, moved);

        // Update currentSlide to follow the moved slide
        if (state.currentSlide === dragSrcIdx) {
          state.currentSlide = targetIdx;
        } else if (dragSrcIdx < targetIdx) {
          if (state.currentSlide > dragSrcIdx && state.currentSlide <= targetIdx) state.currentSlide--;
        } else {
          if (state.currentSlide >= targetIdx && state.currentSlide < dragSrcIdx) state.currentSlide++;
        }

        dragSrcIdx = -1;
        saveSlides('reorder');
        renderSidebar();
        updateSetSlideBtn();
        toast(t('toastOrderUpdated'));
      });

      // Only start drag from the handle
      const handle = item.querySelector('.izerp-drag-handle');
      if (handle) {
        handle.addEventListener('mousedown', () => { item.draggable = true; });
        item.addEventListener('mousedown', e => {
          if (!e.target.closest('.izerp-drag-handle')) item.draggable = false;
        });
        item.addEventListener('dragstart', () => { item.draggable = true; });
      }
    });
  }


  /* ════════════════════════════════════════════════════════════
     SETTINGS
     ════════════════════════════════════════════════════════════ */
  function syncSettingsInputs() {
    syncColorPair('primary',   state.settings.colorPrimary);
    syncColorPair('secondary', state.settings.colorSecondary);
    syncColorPair('tertiary',  state.settings.colorTertiary);
  }

  function syncColorPair(key, value) {
    const picker  = $id('izerp-color-' + key);
    const hex     = $id('izerp-color-' + key + '-hex');
    const preview = $id('izerp-color-' + key + '-preview');
    if (picker)  picker.value            = value;
    if (hex)     hex.value               = value;
    if (preview) preview.style.background = value;
  }

  /* ════════════════════════════════════════════════════════════
     TOAST
     ════════════════════════════════════════════════════════════ */
  let toastTimeout;
  function toast(msg) {
    const el = $id('izerp-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('izerp-visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.remove('izerp-visible'), 2400);
  }

  function updateFabCount() {
    const el = $id('izerp-menu-count');
    if (!el) return;
    el.innerHTML = t('slidesCount', state.slides.length);
  }

  /* ════════════════════════════════════════════════════════════
     LASER POINTER
     ════════════════════════════════════════════════════════════ */
  function activateLaser() {
    state.laserActive = true;
    state.spaceHoldTimer = null;
    const laser = $id('izerp-laser');
    if (laser) {
      laser.style.left = state.mouseX + 'px';
      laser.style.top  = state.mouseY + 'px';
      laser.classList.add('izerp-visible');
    }
    document.body.style.cursor = 'none';
    emit('laserchange', { active: true, x: state.mouseX, y: state.mouseY });
  }

  function deactivateLaser() {
    state.laserActive = false;
    clearTimeout(state.spaceHoldTimer);
    state.spaceHoldTimer = null;
    const laser = $id('izerp-laser');
    if (laser) {
      laser.classList.remove('izerp-visible');
      laser.style.left = '-999px';
      laser.style.top  = '-999px';
    }
    document.body.style.cursor = '';
    emit('laserchange', { active: false, x: state.mouseX, y: state.mouseY });
  }

  /* ════════════════════════════════════════════════════════════
     EVENT HANDLERS
     ════════════════════════════════════════════════════════════ */
  /* ── Pointer input — mouse, touch and pen through one code path ──
     Editor: single pointer pans, two pointers pinch-zoom. Presentation:
     a horizontal flick navigates slides. All coordinates go through
     toStage() so this works in a sub-container as well as fullscreen. */
  const activePointers = new Map(); // pointerId -> { x, y } (client coords)
  let pinchState = null;            // { startDist, startScale, worldX, worldY }
  let swipeState = null;            // { x, y, t, id } in presentation

  function pointerList() { return [...activePointers.values()]; }
  function pinchDistance() {
    const [a, b] = pointerList();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function pinchMidpoint() {
    const [a, b] = pointerList();
    return toStage((a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  function beginPinch() {
    const mid = pinchMidpoint();
    pinchState = {
      startDist:  pinchDistance() || 1,
      startScale: state.camera.scale,
      worldX: (mid.x - state.camera.tx) / state.camera.scale,
      worldY: (mid.y - state.camera.ty) / state.camera.scale,
    };
    state.panning = false;
  }
  function updatePinch() {
    const mid  = pinchMidpoint();
    const dist = pinchDistance();
    const newScale = clamp(pinchState.startScale * (dist / pinchState.startDist), 0.04, 8);
    state.camera.scale = newScale;
    state.camera.tx = mid.x - pinchState.worldX * newScale;
    state.camera.ty = mid.y - pinchState.worldY * newScale;
    applyCamera(true);
  }
  function beginPanFrom(pt) {
    state.panning       = true;
    state.panStart      = { x: pt.x, y: pt.y };
    state.camAtPanStart = { ...state.camera };
  }

  function onPointerDown(e) {
    if (e.target.closest('#izerp-root')) return;  // let the chrome handle its own input

    if (state.mode === 'presentation') {           // arm a swipe
      swipeState = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
      return;
    }
    if (state.mode !== 'editor') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = wrap();
    if (el) el.style.transition = 'none';

    if (activePointers.size >= 2) beginPinch();
    else beginPanFrom({ x: e.clientX, y: e.clientY });
  }

  function onPointerMove(e) {
    state.mouseX = e.clientX;
    state.mouseY = e.clientY;
    if (state.laserActive) {
      const laser = $id('izerp-laser');
      if (laser) { laser.style.left = e.clientX + 'px'; laser.style.top = e.clientY + 'px'; }
    }
    if (state.mode !== 'editor' || !activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchState && activePointers.size >= 2) updatePinch();
    else if (state.panning) {
      state.camera.tx = state.camAtPanStart.tx + (e.clientX - state.panStart.x);
      state.camera.ty = state.camAtPanStart.ty + (e.clientY - state.panStart.y);
      applyCamera(true);
    }
  }

  function endPointer(id) {
    if (!activePointers.has(id)) return;
    activePointers.delete(id);
    if (activePointers.size < 2) pinchState = null;
    if (activePointers.size === 1) beginPanFrom(pointerList()[0]);   // resume single-finger pan
    if (activePointers.size === 0) {
      state.panning = false;
      const el = wrap();
      if (el) el.style.transition = '';
    }
  }

  function onPointerUp(e) {
    if (state.mode === 'presentation' && swipeState && swipeState.id === e.pointerId) {
      const dx = e.clientX - swipeState.x;
      const dy = e.clientY - swipeState.y;
      const dt = Date.now() - swipeState.t;
      swipeState = null;
      // A quick, mostly-horizontal flick pages through the deck.
      if (dt < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) nextSlide(); else prevSlide();
      }
      return;
    }
    endPointer(e.pointerId);
  }

  function onPointerCancel(e) {
    swipeState = null;
    endPointer(e.pointerId);
  }

  function onWheel(e) {
    if (state.mode !== 'editor') return;
    if (e.target.closest('#izerp-root')) return;
    e.preventDefault();
    const factor   = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = clamp(state.camera.scale * factor, 0.04, 8);
    const { x: mx, y: my } = toStage(e.clientX, e.clientY);
    const worldX = (mx - state.camera.tx) / state.camera.scale;
    const worldY = (my - state.camera.ty) / state.camera.scale;
    state.camera.scale = newScale;
    state.camera.tx    = mx - worldX * newScale;
    state.camera.ty    = my - worldY * newScale;
    applyCamera(true);
  }

  function onKeyDown(e) {
    // Keep Tab inside an open dialog (runs before the input-guard below so it
    // works while a settings field is focused).
    if ((state.mode === 'menu' || state.mode === 'settings') && e.key === 'Tab') {
      trapTab(e);
      return;
    }

    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
               ae.tagName === 'SELECT' || ae.contentEditable === 'true')) return;

    if (state.mode === 'presentation') {
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat && !state.laserActive) {
          activateLaser();
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault(); nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); prevSlide();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault(); toggleSpeakerNotes();
      } else if (e.key === 'Escape') {
        setMode('idle');
      }
    } else if (state.mode === 'editor') {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (state.currentSlide > 0) editorGoto(state.currentSlide - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (state.currentSlide < state.slides.length - 1) editorGoto(state.currentSlide + 1);
      } else if (e.key === 'Escape') {
        setMode('idle');
      }
    } else if (state.mode === 'menu' || state.mode === 'settings') {
      if (e.key === 'Escape') setMode('idle');
    }
  }

  function onKeyUp(e) {
    if (state.mode === 'presentation' && e.key === ' ') {
      clearTimeout(state.spaceHoldTimer);
      state.spaceHoldTimer = null;
      if (state.laserActive) deactivateLaser();
    }
  }

  /* ════════════════════════════════════════════════════════════
     BUILD UI HTML
     ════════════════════════════════════════════════════════════ */
  function buildUI() {
    const root = document.createElement('div');
    root.id           = 'izerp-root';
    root.dataset.mode = 'idle';
    root.dataset.fab  = CONFIG.fab === false ? 'false' : 'true';
    if (scoped) root.dataset.scoped = 'true';   // overlay is absolute within the host

    // One language button per registered language (built-in de/en + any added
    // via config.languages / registerLanguage). A custom dict can name itself
    // with a `langLabel`; otherwise the code is shown uppercased.
    const langButtons = Object.keys(STRINGS).map(code => {
      const label = (STRINGS[code] && STRINGS[code].langLabel)
        || (code === 'de' ? t('langDe') : code === 'en' ? t('langEn') : code.toUpperCase());
      const active = state.settings.lang === code ? ' izerp-lang-active' : '';
      return `<button class="izerp-lang-btn${active}" data-lang="${esc(code)}">${esc(label)}</button>`;
    }).join('');

    root.innerHTML = /* html */`

    <!-- ── FAB ── -->
    <button id="izerp-fab" title="${t('fabTitle')}" aria-label="${t('fabAriaLabel')}">
      <svg id="izerp-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      <span id="izerp-fab-label" style="text-transform:none">iZerp</span>
    </button>

    <!-- ── Menu Overlay ── -->
    <div id="izerp-menu-overlay" role="dialog" aria-label="${t('menuAriaLabel')}">
      <button class="izerp-panel-close" id="izerp-close-menu" title="${t('closeEsc')}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
      </button>
      <div id="izerp-menu-card">
        <div class="izerp-menu-header">
          <div class="izerp-logo-mark">
            <svg class="izerp-logo-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor">
              <circle cx="10" cy="10" r="3" stroke-width="2"/>
              <path d="M10 1v4M10 15v4M1 10h4M15 10h4" stroke-width="1.5"/>
            </svg>
            <span class="izerp-logo-text">iZerp</span>
            <span class="izerp-menu-version">v${VERSION}</span>
          </div>
        </div>
        <div class="izerp-menu-modes">
          <button class="izerp-mode-btn" data-target="editor">
            <div class="izerp-mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </div>
            <span class="izerp-mode-label">${t('editorLabel')}</span>
            <div class="izerp-mode-desc">${t('editorDesc')}</div>
          </button>
          <button class="izerp-mode-btn" data-target="presentation">
            <div class="izerp-mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </div>
            <span class="izerp-mode-label">${t('presentationLabel')}</span>
            <div class="izerp-mode-desc">${t('presentationDesc')}</div>
          </button>
          <button class="izerp-mode-btn" data-target="settings">
            <div class="izerp-mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            </div>
            <span class="izerp-mode-label">${t('settingsLabel')}</span>
            <div class="izerp-mode-desc">${t('settingsDesc')}</div>
          </button>
        </div>
        <div class="izerp-menu-footer">
          <span class="izerp-menu-slide-count" id="izerp-menu-count">
            ${t('slidesCount', 0)}
          </span>
          <span class="izerp-menu-footer-sep"></span>
          <span class="izerp-menu-hint">${t('escClose')}</span>
        </div>
      </div>
    </div>

    <!-- ── Editor Control Bar ── -->
    <div id="izerp-editor-bar" role="toolbar" aria-label="${t('editorToolbar')}">
      <div class="izerp-bar-seg">
        <button class="izerp-bar-btn" id="izerp-btn-zoom-out" title="${t('zoomOut')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          ${t('zoomOut')}
        </button>
        <span class="izerp-zoom-pill" id="izerp-zoom-level" title="${t('zoomTitle')}">100%</span>
        <button class="izerp-bar-btn" id="izerp-btn-zoom-in" title="${t('zoomIn')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          ${t('zoomIn')}
        </button>
      </div>
      <div class="izerp-bar-divider"></div>
      <div class="izerp-bar-seg">
        <button class="izerp-bar-btn variant-set" id="izerp-btn-set" title="${t('setSlideTitle')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          ${t('setSlide')}
        </button>
        <button class="izerp-bar-btn variant-update" id="izerp-btn-update" title="${t('updateSlideTitle')}" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c-1.66 0-3-4.03-3-9s1.34-9 3-9m0 18c1.66 0 3-4.03 3-9s-1.34-9-3-9m-9 9a9 9 0 019-9"/></svg>
          ${t('updateSlide')}
        </button>
        <button class="izerp-bar-btn variant-remove" id="izerp-btn-remove" title="${t('removeSlideTitle')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          ${t('removeSlide')}
        </button>
      </div>
      <div class="izerp-bar-divider"></div>
      <div class="izerp-bar-seg izerp-bar-seg-grow">
        <span class="izerp-bar-center-label" id="izerp-bar-center-label">${t('noSlides')}</span>
      </div>
      <div class="izerp-bar-divider"></div>
      <div class="izerp-bar-seg">
        <button class="izerp-bar-btn" id="izerp-btn-prev" title="${t('prevTitle')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          ${t('prev')}
        </button>
        <button class="izerp-bar-btn" id="izerp-btn-next" title="${t('nextTitle')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          ${t('next')}
        </button>
      </div>
      <div class="izerp-bar-divider"></div>
      <div class="izerp-bar-seg">
        <button class="izerp-bar-btn variant-exit" id="izerp-btn-exit-editor" title="${t('exitEditorTitle')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ${t('exit')}
        </button>
      </div>
    </div>

    <!-- ── Slides Sidebar ── -->
    <div id="izerp-sidebar" role="complementary" aria-label="${t('sidebarAriaLabel')}">
      <div class="izerp-sidebar-hd">
        <span class="izerp-sidebar-hd-label">${t('folien')}</span>
      </div>
      <div id="izerp-slide-list"></div>
    </div>

    <!-- ── Presentation Overlays ── -->
    <div id="izerp-pres-overlays">

      <button class="izerp-pres-ctrl" id="izerp-pres-exit" title="${t('presExitTitle')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      <!-- Speaker sheet — discreet, collapsible presenter aid -->
      <div id="izerp-speaker-outer">
        <div id="izerp-speaker" data-collapsed="true" aria-hidden="true">
          <button class="izerp-panel-close" id="izerp-spk-close" title="${t('close')}">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
          </button>
          <div class="izerp-spk-hd">
            <span class="izerp-spk-eyebrow">${t('speakerNow')}</span>
            <span class="izerp-spk-eyebrow" id="izerp-spk-counter">— / —</span>
          </div>
          <div class="izerp-spk-title" id="izerp-spk-title">—</div>
          <div class="izerp-spk-notes" id="izerp-spk-notes"></div>
          <div class="izerp-spk-next">
            <span class="izerp-spk-next-arrow"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 3 11 8 6 13"/></svg></span>
            <span class="izerp-spk-eyebrow">${t('speakerNext')}</span>
            <span class="izerp-spk-next-title" id="izerp-spk-next-title">—</span>
          </div>
        </div>
      </div>

      <!-- The Rail — index · graduated progress · timer -->
      <div id="izerp-rail" role="group" aria-label="${t('speaker')}">
        <span class="izerp-rail-index"><span id="izerp-rail-cur">—</span><span class="izerp-rail-total" id="izerp-rail-total"> / —</span></span>
        <div id="izerp-progress-bar">
          <div class="izerp-rail-ticks" id="izerp-rail-ticks"></div>
          <div id="izerp-progress-fill"><span class="izerp-rail-head"></span></div>
        </div>
        <button class="izerp-rail-btn" id="izerp-spk-toggle" title="${t('notesToggle')}" aria-pressed="false">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5h7l3 3V13a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 13z"/><path d="M9.5 2.5V6h3.5"/><path d="M5.5 8.5h5M5.5 11h3.5"/></svg>
        </button>
        <div class="izerp-rail-timer">
          <span class="izerp-rail-time" id="izerp-spk-timer">0:00</span>
          <button class="izerp-rail-btn" id="izerp-spk-timer-reset" title="${t('resetTitle')}">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 7a4.5 4.5 0 1 0 .9-2.7"/><polyline points="1 2 2.5 4.4 4.9 3"/></svg>
          </button>
        </div>
      </div>

      <div id="izerp-pres-hint">${t('presHint')}</div>
    </div>

    <!-- ── Settings backdrop ── -->
    <div id="izerp-settings-backdrop"></div>

    <!-- ── Settings Panel ── -->
    <div id="izerp-settings-outer" role="dialog" aria-label="${t('settingsAriaLabel')}">
      <button class="izerp-panel-close" id="izerp-settings-close" title="${t('closeEsc')}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
      </button>
      <div id="izerp-settings">
        <div class="izerp-settings-hd">
          <div class="izerp-settings-hd-inner">
            <svg class="izerp-settings-hd-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke-linecap="round"/>
            </svg>
            <span class="izerp-settings-hd-label">${t('settingsHd')}</span>
          </div>
        </div>

        <div class="izerp-settings-body">

          <!-- Language section -->
          <div class="izerp-settings-section">
            <div class="izerp-section-label">
              <span class="izerp-section-num">00</span>
              ${t('secLang')}
            </div>
            <div class="izerp-lang-btns">${langButtons}</div>
          </div>

          <!-- Color section -->
          <div class="izerp-settings-section">
            <div class="izerp-section-label">
              <span class="izerp-section-num">01</span>
              ${t('secColors')}
            </div>

            <div class="izerp-color-group">
              <div class="izerp-color-preview-bar" id="izerp-color-primary-preview" style="background:#c69a4c"></div>
              <div class="izerp-color-label-row">
                <span class="izerp-color-name">${t('primaryColor')}</span>
                <span class="izerp-color-hint">${t('primaryHint')}</span>
              </div>
              <div class="izerp-color-input-row">
                <input type="color" id="izerp-color-primary" value="#c69a4c">
                <input type="text" class="izerp-hex-input" id="izerp-color-primary-hex" value="#c69a4c" maxlength="7" spellcheck="false" placeholder="#000000">
              </div>
            </div>

            <div class="izerp-color-group">
              <div class="izerp-color-preview-bar" id="izerp-color-secondary-preview" style="background:#0e0c0a"></div>
              <div class="izerp-color-label-row">
                <span class="izerp-color-name">${t('secondaryColor')}</span>
                <span class="izerp-color-hint">${t('secondaryHint')}</span>
              </div>
              <div class="izerp-color-input-row">
                <input type="color" id="izerp-color-secondary" value="#0e0c0a">
                <input type="text" class="izerp-hex-input" id="izerp-color-secondary-hex" value="#0e0c0a" maxlength="7" spellcheck="false" placeholder="#000000">
              </div>
            </div>

            <div class="izerp-color-group">
              <div class="izerp-color-preview-bar" id="izerp-color-tertiary-preview" style="background:#f3ecda"></div>
              <div class="izerp-color-label-row">
                <span class="izerp-color-name">${t('tertiaryColor')}</span>
                <span class="izerp-color-hint">${t('tertiaryHint')}</span>
              </div>
              <div class="izerp-color-input-row">
                <input type="color" id="izerp-color-tertiary" value="#f3ecda">
                <input type="text" class="izerp-hex-input" id="izerp-color-tertiary-hex" value="#f3ecda" maxlength="7" spellcheck="false" placeholder="#000000">
              </div>
            </div>
          </div>

          <!-- File section -->
          <div class="izerp-settings-section">
            <div class="izerp-section-label">
              <span class="izerp-section-num">02</span>
              ${t('secFile')}
            </div>
            <div class="izerp-file-btns">
              <button class="izerp-btn izerp-btn-file" id="izerp-btn-export">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 14l7 4 7-4"/><path d="M3 10l7 4 7-4"/><path d="M10 2v8"/><polyline points="7 5 10 2 13 5"/></svg>
                ${t('exportBtn')}
              </button>
              <button class="izerp-btn izerp-btn-file" id="izerp-btn-import">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 14l7 4 7-4"/><path d="M3 10l7 4 7-4"/><path d="M10 10V2"/><polyline points="7 13 10 16 13 13"/></svg>
                ${t('importBtn')}
              </button>
            </div>
            <p class="izerp-file-hint">${t('fileHint')}</p>
          </div>

          <!-- Danger section -->
          <div class="izerp-settings-section izerp-danger-section">
            <div class="izerp-section-label">
              <span class="izerp-section-num izerp-section-num-danger">!</span>
              ${t('secDanger')}
            </div>
            <button class="izerp-btn izerp-btn-danger" id="izerp-btn-clear">${t('clearBtn')}</button>
          </div>

        </div>

        <div class="izerp-settings-ft">
          <button class="izerp-btn izerp-btn-primary" id="izerp-settings-save">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 10 8 14 16 6"/></svg>
            ${t('saveSettings')}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Laser Pointer ── -->
    <div id="izerp-laser" aria-hidden="true"></div>

    <!-- ── Toast ── -->
    <div id="izerp-toast" role="status" aria-live="polite"></div>

    <!-- ── Screen-reader live region (slide changes) ── -->
    <div id="izerp-live" class="izerp-sr-only" aria-live="polite" aria-atomic="true"></div>
    `;

    // Scoped: mount the overlay inside the host so its chrome (FAB, rail,
    // panels) lives in the container. Otherwise it's a fullscreen fixed layer.
    (scoped && hostEl ? hostEl : document.body).appendChild(root);
  }

  /* ════════════════════════════════════════════════════════════
     BIND EVENTS
     ════════════════════════════════════════════════════════════ */
  function bindUIEvents() {
    $id('izerp-fab').addEventListener('click', () =>
      setMode(state.mode === 'menu' ? 'idle' : 'menu')
    );
    document.querySelectorAll('.izerp-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.target));
    });
    $id('izerp-close-menu').addEventListener('click', () => setMode('idle'));

    // Zoom pill click → reset to 100%
    $id('izerp-zoom-level').addEventListener('click', resetZoomTo100);

    $id('izerp-btn-zoom-out').addEventListener('click', () => zoomBy(1 / 1.35, true));
    $id('izerp-btn-zoom-in' ).addEventListener('click', () => zoomBy(1.35, true));

    // Set / Update slide
    $id('izerp-btn-set'   ).addEventListener('click', addSlide);
    $id('izerp-btn-update').addEventListener('click', updateCurrentSlide);

    $id('izerp-btn-remove'  ).addEventListener('click', removeSlide);
    $id('izerp-btn-prev').addEventListener('click', () => {
      if (state.currentSlide > 0) editorGoto(state.currentSlide - 1);
    });
    $id('izerp-btn-next').addEventListener('click', () => {
      if (state.currentSlide < state.slides.length - 1) editorGoto(state.currentSlide + 1);
    });
    $id('izerp-btn-exit-editor').addEventListener('click', () => setMode('idle'));

    $id('izerp-pres-exit'       ).addEventListener('click', () => setMode('idle'));
    $id('izerp-spk-close'       ).addEventListener('click', () => toggleSpeakerNotes(false));
    $id('izerp-spk-toggle'      ).addEventListener('click', () => toggleSpeakerNotes());
    $id('izerp-spk-timer-reset' ).addEventListener('click', resetTimer);

    $id('izerp-settings-close'  ).addEventListener('click', () => setMode('idle'));
    $id('izerp-settings-backdrop').addEventListener('click', () => setMode('idle'));

    // Language toggle
    document.querySelectorAll('.izerp-lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.lang === state.settings.lang) return;
        state.settings.lang = btn.dataset.lang;
        saveSettings();
        // Rebuild UI with new language
        const root = $id('izerp-root');
        if (root) root.remove();
        buildUI();
        bindUIEvents();   // re-bind element handlers only; global listeners persist
        applySettings();
        syncSettingsInputs();
        updateFabCount();
        updateEditorCenter();
        updateSetSlideBtn();
        renderSidebar();
        setMode('settings');
      });
    });

    $id('izerp-settings-save').addEventListener('click', () => {
      state.settings.colorPrimary   = $id('izerp-color-primary'  ).value;
      state.settings.colorSecondary = $id('izerp-color-secondary').value;
      state.settings.colorTertiary  = $id('izerp-color-tertiary' ).value;
      saveSettings();
      toast(t('toastSettingsSaved'));
    });

    // Color picker ↔ hex ↔ preview sync
    ['primary', 'secondary', 'tertiary'].forEach(key => {
      const picker  = $id('izerp-color-' + key);
      const hex     = $id('izerp-color-' + key + '-hex');
      const preview = $id('izerp-color-' + key + '-preview');
      picker.addEventListener('input', () => {
        hex.value               = picker.value;
        preview.style.background = picker.value;
      });
      hex.addEventListener('input', () => {
        if (/^#[0-9a-f]{6}$/i.test(hex.value)) {
          picker.value               = hex.value;
          preview.style.background   = hex.value;
        }
      });
    });

    // File export / import
    $id('izerp-btn-export').addEventListener('click', saveToFile);
    $id('izerp-btn-import').addEventListener('click', loadFromFile);

    $id('izerp-btn-clear').addEventListener('click', () => {
      if (!confirm(t('confirmClear', state.slides.length))) return;
      state.slides = [];
      state.currentSlide = -1;
      saveSlides('clear');
      renderSidebar();
      updateEditorCenter();
      updateSetSlideBtn();
      updateFabCount();
      toast(t('toastAllDeleted'));
    });

  }

  // Document-level listeners live for the whole iZerp session. Bound ONCE in
  // init() (not on every language rebuild) and removed again in destroy().
  const GLOBAL_LISTENERS = [
    ['pointerdown',   onPointerDown],
    ['pointermove',   onPointerMove],
    ['pointerup',     onPointerUp],
    ['pointercancel', onPointerCancel],
    ['wheel',         onWheel, { passive: false }],
    ['keydown',       onKeyDown],
    ['keyup',         onKeyUp],
  ];
  function bindGlobalEvents() {
    GLOBAL_LISTENERS.forEach(([type, fn, opts]) => document.addEventListener(type, fn, opts));
  }
  function unbindGlobalEvents() {
    GLOBAL_LISTENERS.forEach(([type, fn, opts]) => document.removeEventListener(type, fn, opts));
  }

  /* ════════════════════════════════════════════════════════════
     GLOBAL STYLE INJECTION
     ════════════════════════════════════════════════════════════ */
  function injectGlobalStyles() {
    const style = document.createElement('style');
    style.id = 'izerp-global-styles';
    style.textContent = [
      '#izerp-canvas-wrap { transform-origin: 0 0; }',
      'body.izerp-editor-active { overflow: hidden; }',
      'body.izerp-pres-active   { overflow: hidden; }',
      // Own touch gestures on the stage so the browser doesn't scroll/zoom the
      // page underneath (panels inside #izerp-root keep normal touch scrolling).
      'body.izerp-editor-active #izerp-canvas-wrap,',
      'body.izerp-pres-active   #izerp-canvas-wrap { touch-action: none; }',
      // config.fab === false hides the launcher (drive iZerp via the API).
      '#izerp-root[data-fab="false"] #izerp-fab { display: none !important; }',
      // Scoped to a data-target container: the overlay is absolute within it,
      // not a fixed fullscreen layer.
      '#izerp-root[data-scoped="true"] { position: absolute; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════════════
     HELPERS
     ════════════════════════════════════════════════════════════ */
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ════════════════════════════════════════════════════════════
     WRAP BODY CONTENT
     ════════════════════════════════════════════════════════════ */
  function wrapBodyContent() {
    // Which element's children become the zoomable canvas. Defaults to <body>;
    // a host can scope iZerp to a stage element via data-target / config.target
    // instead of reparenting the whole page.
    hostEl = (CONFIG.target && document.querySelector(CONFIG.target)) || document.body;
    scoped = hostEl !== document.body;
    // A scoped stage needs a positioning context so the overlay (position:
    // absolute) sits inside it. Only patch a static host, and remember it so
    // destroy() can restore the original.
    if (scoped && getComputedStyle(hostEl).position === 'static') {
      hostEl.style.position = 'relative';
      hostPositionPatched = true;
    }
    const canvasWrap = document.createElement('div');
    canvasWrap.id = 'izerp-canvas-wrap';
    const frag = document.createDocumentFragment();
    Array.from(hostEl.childNodes).forEach(node => frag.appendChild(node));
    canvasWrap.appendChild(frag);
    hostEl.insertBefore(canvasWrap, hostEl.firstChild);
  }

  // Reverse of wrapBodyContent(): lift the wrapped children back out and drop
  // the #izerp-canvas-wrap element, restoring the host to its original DOM.
  function unwrapBodyContent() {
    const canvasWrap = $id('izerp-canvas-wrap');
    if (!canvasWrap || !canvasWrap.parentNode) return;
    const parent = canvasWrap.parentNode;
    const frag = document.createDocumentFragment();
    Array.from(canvasWrap.childNodes).forEach(node => frag.appendChild(node));
    parent.insertBefore(frag, canvasWrap);
    parent.removeChild(canvasWrap);
  }

  /* ════════════════════════════════════════════════════════════
     INIT
     ════════════════════════════════════════════════════════════ */
  function init(options) {
    if (initialized) {
      console.warn('[iZerp] already initialised — ignoring repeat init(). ' +
                   'Call iZerp.destroy() first if you want to re-initialise.');
      return window.iZerp;
    }
    mergeConfig(options);   // iZerp.init(options) — highest precedence
    initialized = true;

    // Register any languages supplied via config before we resolve the UI lang.
    if (CONFIG.languages && typeof CONFIG.languages === 'object') {
      Object.keys(CONFIG.languages).forEach(code => registerLanguage(code, CONFIG.languages[code]));
    }

    loadSettings();
    loadSlides();
    injectGlobalStyles();
    wrapBodyContent();
    buildUI();
    bindUIEvents();
    bindGlobalEvents();
    applySettings();
    updateFabCount();
    updateEditorCenter();
    updateSetSlideBtn();
    // 'ready' waits for the async default-slide load to settle, so hosts can
    // safely read iZerp.getSlides() the moment they hear it.
    loadDefaultSlides().finally(() => emit('ready', { version: VERSION, total: state.slides.length }));
    return window.iZerp;
  }

  // Tear iZerp down completely: stop the presentation, remove every listener
  // and injected node, and un-wrap the canvas so the host DOM is restored.
  // After this, iZerp.init() can be called again from a clean slate — the
  // whole point on SPAs / hot-reload / repeated embeds.
  function destroy() {
    if (!initialized) return;

    // Stop timers and transient UI (laser also restores the cursor).
    stopTimer();
    clearTimeout(settleTimer);   settleTimer = null;
    clearTimeout(toastTimeout);
    deactivateLaser();

    // Drop the document-level listeners we installed.
    unbindGlobalEvents();

    // Restore the document: classes, cursor, injected nodes, canvas wrapper.
    document.body.classList.remove('izerp-editor-active', 'izerp-pres-active');
    document.body.style.cursor = '';
    const root = $id('izerp-root');            if (root) root.remove();
    const styles = $id('izerp-global-styles'); if (styles) styles.remove();
    if (hostPositionPatched && hostEl) hostEl.style.position = '';   // undo scoped positioning
    unwrapBodyContent();

    // Reset state so a subsequent init() starts fresh.
    state.mode         = 'idle';
    state.slides       = [];
    state.currentSlide = -1;
    state.camera       = { tx: 0, ty: 0, scale: 1 };
    state.sidebarOpen  = false;
    state.panning      = false;
    activePointers.clear();
    pinchState = null;
    swipeState = null;
    hostEl      = null;
    scoped      = false;
    hostPositionPatched = false;
    initialized = false;

    emit('destroy', {});   // host subscriptions (iZerp.on) survive across re-init
  }

  window.iZerp = {
    version:   VERSION,
    // Lifecycle
    init,
    destroy,
    // Introspection
    getSlides:       () => state.slides.slice(),
    getCurrentIndex: () => state.currentSlide,
    getCurrentSlide: () => state.slides[state.currentSlide] || null,
    getConfig:       () => Object.assign({}, CONFIG),
    isReady:         () => initialized,
    // Control
    setMode,
    saveToFile,
    loadFromFile,
    registerLanguage,
    // Event API — react to navigation instead of polling geometry.
    on,
    off,
  };

  // ── Auto-init ──────────────────────────────────────────────────
  // Resolve the ambient config first so data-auto-init="false" is honoured
  // before we decide to run. When disabled, the host calls iZerp.init() itself.
  resolveConfig();
  if (CONFIG.autoInit !== false) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => init());
    } else {
      init();
    }
  }

})();
