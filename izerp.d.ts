// Type definitions for iZerp v1.3
// Project: https://github.com/Illustratus/iZerp
// iZerp is a plain browser global (window.iZerp); this file describes it.

export as namespace iZerp;

/** A single slide: a saved camera target on the canvas. */
export interface IZerpSlide {
  /** Unique identifier. */
  id: string;
  /** Title shown in the slide list & speaker panel. */
  title: string;
  /** X centre of the view, in canvas pixels. */
  cx: number;
  /** Y centre of the view, in canvas pixels. */
  cy: number;
  /** Zoom factor (1 = 100%). */
  scale: number;
  /** Viewport width at capture (reference for contain-fit). */
  vw: number;
  /** Viewport height at capture. */
  vh: number;
  /** Speaker notes (may be empty). */
  notes: string;
}

/** UI string dictionary. Values are strings or functions returning strings. */
export type IZerpLanguage = Record<string, string | ((...args: any[]) => string)>;

/** Runtime configuration. All fields optional; see the README for precedence. */
export interface IZerpConfig {
  /** URL of a `.izerp` file to load as the default deck (http[s]). */
  slides?: string | null;
  /** UI language: 'de' | 'en' | 'auto' | any registered code. */
  lang?: string;
  /** Fixed storage-key suffix (default: the page URL). */
  storageKey?: string | null;
  /** false → never read/write slides in localStorage. */
  persist?: boolean;
  /** false → hide the launcher FAB (drive iZerp via the API). */
  fab?: boolean;
  /** CSS selector of the element to wrap (default: <body>). */
  target?: string | null;
  /** false → do not auto-init; call iZerp.init() yourself. */
  autoInit?: boolean;
  /** Add/override UI languages: `{ code: { ...strings } }`. */
  languages?: Record<string, IZerpLanguage> | null;
}

export type IZerpMode = 'idle' | 'menu' | 'editor' | 'presentation' | 'settings';

export type IZerpDeckReason =
  | 'add' | 'update' | 'remove' | 'reorder' | 'clear' | 'import' | 'load' | 'edit';

/** Event payloads, keyed by event type (without the `izerp:` DOM prefix). */
export interface IZerpEventMap {
  ready:             { version: string; total: number };
  slidechange:       { index: number; total: number; slide: IZerpSlide | null; mode: IZerpMode };
  slidesettled:      { index: number; total: number; slide: IZerpSlide | null; mode: IZerpMode };
  presentationstart: { total: number };
  presentationend:   { mode: IZerpMode; total: number; elapsedMs: number };
  modechange:        { mode: IZerpMode; total: number };
  deckchange:        { slides: IZerpSlide[]; total: number; reason: IZerpDeckReason };
  laserchange:       { active: boolean; x: number; y: number };
  settingschange:    { settings: Record<string, unknown> };
  destroy:           Record<string, never>;
}

export interface IZerpAPI {
  readonly version: string;
  /** Initialise (or re-initialise after destroy). Returns the API. */
  init(options?: IZerpConfig): IZerpAPI;
  /** Tear everything down and restore the host DOM. */
  destroy(): void;
  /** A copy of all slides. */
  getSlides(): IZerpSlide[];
  /** Index of the active slide (0-based; -1 = none). */
  getCurrentIndex(): number;
  /** The active slide object, or null. */
  getCurrentSlide(): IZerpSlide | null;
  /** A copy of the resolved configuration. */
  getConfig(): Required<IZerpConfig>;
  /** True once initialised. */
  isReady(): boolean;
  /** Switch modes programmatically. */
  setMode(mode: IZerpMode): void;
  /** Trigger a `.izerp` export. */
  saveToFile(): Promise<void>;
  /** Open the `.izerp` import dialog. */
  loadFromFile(): Promise<void>;
  /** Add or override a UI language at runtime. */
  registerLanguage(code: string, dict: IZerpLanguage): void;
  /** Subscribe to an event; returns an unsubscribe function. */
  on<K extends keyof IZerpEventMap>(type: K, handler: (detail: IZerpEventMap[K]) => void): () => void;
  /** Unsubscribe a handler. */
  off<K extends keyof IZerpEventMap>(type: K, handler: (detail: IZerpEventMap[K]) => void): void;
}

declare global {
  interface Window {
    iZerp: IZerpAPI;
    /** Optional ambient configuration, read before the script initialises. */
    iZerpConfig?: IZerpConfig;
  }
}

export {};
