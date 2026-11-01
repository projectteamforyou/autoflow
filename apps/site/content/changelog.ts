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
