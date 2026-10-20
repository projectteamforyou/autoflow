/**
 * Programmatic SEO pages: task guides (/<lang>/guides/<slug>/) and alternative pages (/<lang>/alternatives/<slug>/).
 * Slugs are shared by every locale so hreflang alternates line up; the copy is written per locale.
 */

export const TASKS = [
  "auto-clicker",
  "mouse-macro",
  "keyboard-macro",
  "macro-recorder",
  "auto-typer",
  "key-remapper",
  "mouse-button-remap",
  "text-expander",
  "android-auto-tapper",
  "auto-swipe",
  "scheduled-clicks",
  "click-on-image",
  "click-on-color",
  "screen-text-ocr",
  "form-filling",
  "data-entry",
  "auto-refresh",
  "idle-game-auto-tap",
  "multi-monitor-automation",
  "hotkey-launcher",
  "window-layout",
  "clipboard-automation",
  "repeat-keypress",
  "no-code-rpa",
] as const;
export type TaskSlug = (typeof TASKS)[number];

export type Platform = "windows" | "android" | "mac" | "web" | "ios";

/** Programs people search for alternatives to. Names are trademarks of their owners; we only state neutral facts. */
export const ALTS = [
  { slug: "op-auto-clicker", name: "OP Auto Clicker", platforms: ["windows"] },
  { slug: "gs-auto-clicker", name: "GS Auto Clicker", platforms: ["windows"] },
  { slug: "speed-autoclicker", name: "Speed AutoClicker", platforms: ["windows"] },
  { slug: "murgaa-auto-clicker", name: "Murgaa Auto Clicker", platforms: ["windows"] },
  { slug: "autohotkey", name: "AutoHotkey", platforms: ["windows"] },
  { slug: "autoit", name: "AutoIt", platforms: ["windows"] },
  { slug: "tinytask", name: "TinyTask", platforms: ["windows"] },
  { slug: "jitbit-macro-recorder", name: "Jitbit Macro Recorder", platforms: ["windows"] },
  { slug: "pulovers-macro-creator", name: "Pulover’s Macro Creator", platforms: ["windows"] },
  { slug: "macro-express", name: "Macro Express", platforms: ["windows"] },
  { slug: "power-automate-desktop", name: "Power Automate Desktop", platforms: ["windows"] },
  { slug: "uipath", name: "UiPath", platforms: ["windows", "web"] },
  { slug: "x-mouse-button-control", name: "X-Mouse Button Control", platforms: ["windows"] },
  { slug: "powertoys-keyboard-manager", name: "PowerToys Keyboard Manager", platforms: ["windows"] },
  { slug: "sharpkeys", name: "SharpKeys", platforms: ["windows"] },
  { slug: "textexpander", name: "TextExpander", platforms: ["windows", "mac", "ios"] },
  { slug: "tasker", name: "Tasker", platforms: ["android"] },
  { slug: "macrodroid", name: "MacroDroid", platforms: ["android"] },
  { slug: "automate-llamalab", name: "Automate (LlamaLab)", platforms: ["android"] },
  { slug: "anjian-jingling", name: "按键精灵 (Anjian Jingling)", platforms: ["windows", "android"] },
  { slug: "uwsc", name: "UWSC", platforms: ["windows"] },
] as const satisfies readonly { slug: string; name: string; platforms: readonly Platform[] }[];
export type AltSlug = (typeof ALTS)[number]["slug"];

export interface Qa {
  q: string;
  a: string;
}

export interface TaskCopy {
  /** Short search phrase used on cards and in breadcrumbs, e.g. "Auto clicker". */
  kw: string;
  /** <title>, ≤ 60 characters where the language allows. */
  title: string;
  /** Meta description, ≤ 155 characters where the language allows. */
  description: string;
  h1: string;
  intro: string;
  /** "How to do it in AutoFlow", 4 steps. */
  steps: string[];
  /** 3 practical tips. */
  tips: string[];
  /** 2 questions specific to this task. */
  faq: Qa[];
}

export interface AltCopy {
  title: string;
  description: string;
  h1: string;
  /** Neutral one-paragraph description of what people use the program for, then what AutoFlow offers. */
  intro: string;
  /** 4 points about what AutoFlow brings for this kind of user (claims about AutoFlow only). */
  points: string[];
  /** 2 questions specific to this program. */
  faq: Qa[];
}

export interface SeoUi {
  guides: { nav: string; title: string; description: string; h1: string; lead: string };
  alternatives: { nav: string; title: string; description: string; h1: string; lead: string };
  /** Section headings and labels. */
  howTo: string;
  tips: string;
  faq: string;
  related: string;
  relatedAlts: string;
  whyAutoflow: string;
  switchH: string;
  /** 3 steps for moving tasks from another tool to AutoFlow. */
  switchSteps: string[];
  glanceH: string;
  /** [label, value] rows about AutoFlow only. */
  glance: [string, string][];
  platformsLabel: string;
  platformNames: Record<Platform, string>;
  /** Uses {name}. */
  disclaimer: string;
  /** Uses {name}. Generic FAQ appended to every alternative page. */
  affiliatedQ: string;
  affiliatedA: string;
  /** Generic FAQ appended to every guide. */
  freeQ: string;
  freeA: string;
  ctaH: string;
  ctaP: string;
  readGuide: string;
  seeAlternative: string;
}

export interface SeoContent {
  ui: SeoUi;
  tasks: Record<TaskSlug, TaskCopy>;
  alts: Record<AltSlug, AltCopy>;
}
