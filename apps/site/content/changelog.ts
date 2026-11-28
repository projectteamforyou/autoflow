/**
 * Release notes shown on /<lang>/changelog/ in every locale (English only — one source of truth, no 12-way drift).
 * Newest first. `platforms` are the keys of Content.labels.platforms so the chips are translated.
 */
export type ChangelogPlatform = "windows" | "android" | "web";

export interface ChangelogEntry {
  version: string;
  /** ISO date of the release. */
  date: string;
  platforms: ChangelogPlatform[];
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.2.2",
    date: "2026-11-28",
    platforms: ["android"],
    items: [
      "Android: scheduled, device-event and hotkey flows with risky steps (sending data, writing files, a secret leaving the keystore) now need your approval once, as on Windows. Run the flow from the app and approve it; later automatic runs go ahead. Until then an automatic run stops and a notification says so.",
      "Editing such a flow, or a flow it runs, asks for approval again. Renaming it or changing its trigger does not.",
      "“Run from here” and “Run only this step” on Android no longer replace the copy that schedules and hotkeys start.",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-11-27",
    platforms: ["windows", "android", "web"],
    items: [
      "Safety: a flow that runs another flow now asks for approval when the called flow has risky steps (sending a secret, writing files). Before, a scheduled or hotkey run of the caller ran them without asking; on Windows, editing the called flow asks again.",
      "Scheduled and hotkey flows can run flows that have no trigger of their own (they failed with “flow not found”), and a called flow gets its own variables.",
      "Sync no longer deletes flows you restored with Undo after a bulk delete, sends deletes made while sync was locked, and keeps each device’s folders and favourites.",
      "Email verification, password reset and share links open the app again (they pointed at a page that did not exist).",
      "Editor: Ctrl+Enter and Ctrl+S no longer act behind an open dialog, hotkeys keep Shift (Ctrl+Shift+K), and HTTP headers, tags, launch arguments and negative numbers can be typed. Easy mode is only offered when it can keep everything in the flow.",
      "A copy of a flow whose trigger is switched off starts switched off too. Shared and exported flows no longer include scene preview images.",
      "Windows: quitting releases held keys and mouse buttons, “Identify monitors” no longer risks freezing the app, and a stopped run cannot leave a question box behind.",
      "Android: a step’s time limit stops a long press or swipe in progress, the run notification shows the first step and the paused state, and reference image import rejects damaged files.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-25",
    platforms: ["windows", "android", "web"],
    items: [
      "Editor: undo and redo for everything you do in a session, run a flow from any step or run just one step, collapse groups and loops, wrap a step in a group / loop / try, and a shortcuts sheet (press ?).",
      "Every step can have its own time limit and a full retry policy (fixed, linear or exponential back-off with a cap and jitter); “jump to step” now offers a list of steps instead of an id box.",
      "Library: folders, multi-select with bulk move / tag / export / delete, sort by last run, search inside steps, and drop a .json file to import.",
      "Triggers: switch a schedule or hotkey off without losing its setup, see hotkeys that two flows share, and see why a trigger could not be registered.",
      "Run history: each run is folded into its steps with durations and the slowest steps, with search, run again, export, and a link to the step that failed.",
      "Secrets manager in Settings for {{secret:name}} values (stored in the system keystore on Windows and Android), showing which flows use each secret and which are missing on this device.",
      "Reference images for Find image and image targets can be imported inside the Windows and Android apps; window and app fields offer a list to pick from.",
      "Windows: a step’s time limit now interrupts long waits (window, image search, OCR, HTTP, questions); scheduled and hotkey flows with steps that need approval run once you have approved them in the app; a trigger-started run that fails shows a notification.",
      "Android: scheduled flows start more reliably while the phone is idle, failed trigger runs notify you, and the run notification shows the current step.",
      "Backups use one format everywhere and restoring keeps folders, favourites and breakpoints. The app starts faster: each screen loads on demand.",
    ],
  },
  {
    version: "1.1.3",
    date: "2026-11-03",
    platforms: ["android"],
    items: [
      "Android can now read the screen: pixel checks, waiting for a colour, scene matching, finding a reference image and on-screen text (OCR) work through Android's screen-capture consent, which you grant once each time the app starts.",
      "Stop (from the app, the notification or a hotkey) now also cancels a long press or drag that is still in progress.",
      "OCR uses on-device text recognition from Google Play services (Latin, Korean, Japanese and Chinese).",
    ],
  },
  {
    version: "1.1.2",
    date: "2026-10-24",
    platforms: ["android", "web"],
    items: [
      "Android: the app now explains what the Accessibility service does — in a dialog inside the app, in 12 languages — before it ever sends you to Android Settings, and asks for an explicit Agree.",
      "Web app and site: every download button first asks whether you use AutoFlow personally (free) or for work (Business license), and licensed users download straight away.",
      "Site: the whole page follows your browser language, the language name is shown in the header, and short paragraphs no longer end on a single dangling word.",
    ],
  },
  {
    version: "1.1.2",
    date: "2026-10-20",
    platforms: ["windows"],
    items: [
      "Fixed: the window could open blank on first launch (Windows 10 and 11). If you installed 1.1.0 or 1.1.1, update to this build.",
      "Downloads always deliver the newest installer — a browser can no longer hand back an older file it had cached.",
    ],
  },
  {
    version: "1.1.1",
    date: "2026-10-20",
    platforms: ["windows", "android", "web"],
    items: [
      "Safety: flows stop within half a second even inside loops with no waits; expressions have a cost limit; range() rejects values above 2^53.",
      "Safety Score now also flags dynamic URLs, header variables, private-network addresses and file append/copy steps.",
      "Windows: pressed keys are released on stop; the Halt key ignores extra modifiers; glide and image searches stop immediately; UNC paths and HTTP redirects are blocked for file and http steps.",
      "Billing: payments are checked against the order and refunded automatically on a mismatch; a pending order can be re-checked from the app.",
      "Web app: live run log on the Practice Canvas, an update-ready notice in 12 languages, and session tokens bound to the API they came from.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-19",
    platforms: ["windows", "android", "web"],
    items: [
      "First public release: Easy and Pro editors, Practice Canvas, Atlas templates, Keyforge key remapping, Ledger run history, Halt key, Safety Score and run limits.",
      "Windows installer (signed), Android APK, and the installable web app — all free for personal use.",
    ],
  },
];
