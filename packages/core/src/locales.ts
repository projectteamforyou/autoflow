/** The 12 languages AutoFlow ships in — UI, SEO pages, legal pages and store listings. */
export const LOCALES = [
  { code: "en", hreflang: "en", og: "en_US", play: "en-US", name: "English", english: "English", dir: "ltr" },
  { code: "ko", hreflang: "ko", og: "ko_KR", play: "ko-KR", name: "한국어", english: "Korean", dir: "ltr" },
  { code: "ja", hreflang: "ja", og: "ja_JP", play: "ja-JP", name: "日本語", english: "Japanese", dir: "ltr" },
  { code: "zh-CN", hreflang: "zh-Hans", og: "zh_CN", play: "zh-CN", name: "简体中文", english: "Chinese (Simplified)", dir: "ltr" },
  { code: "zh-TW", hreflang: "zh-Hant", og: "zh_TW", play: "zh-TW", name: "繁體中文", english: "Chinese (Traditional)", dir: "ltr" },
  { code: "es", hreflang: "es", og: "es_ES", play: "es-ES", name: "Español", english: "Spanish", dir: "ltr" },
  { code: "fr", hreflang: "fr", og: "fr_FR", play: "fr-FR", name: "Français", english: "French", dir: "ltr" },
  { code: "de", hreflang: "de", og: "de_DE", play: "de-DE", name: "Deutsch", english: "German", dir: "ltr" },
  { code: "pt-BR", hreflang: "pt-BR", og: "pt_BR", play: "pt-BR", name: "Português (Brasil)", english: "Portuguese (Brazil)", dir: "ltr" },
  { code: "ru", hreflang: "ru", og: "ru_RU", play: "ru-RU", name: "Русский", english: "Russian", dir: "ltr" },
  { code: "vi", hreflang: "vi", og: "vi_VN", play: "vi", name: "Tiếng Việt", english: "Vietnamese", dir: "ltr" },
  { code: "id", hreflang: "id", og: "id_ID", play: "id", name: "Bahasa Indonesia", english: "Indonesian", dir: "ltr" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];
export const LOCALE_CODES = LOCALES.map((l) => l.code) as LocaleCode[];
export const DEFAULT_LOCALE: LocaleCode = "en";

/** Best match for navigator.languages / Accept-Language. */
export function matchLocale(prefs: readonly string[]): LocaleCode {
  for (const raw of prefs) {
    const p = raw.trim().split(";")[0]!.toLowerCase();
    if (!p) continue;
    if (p.startsWith("zh")) return /tw|hk|mo|hant/.test(p) ? "zh-TW" : "zh-CN";
    if (p.startsWith("pt")) return "pt-BR";
    const base = p.split("-")[0]!;
    const hit = LOCALES.find((l) => l.code.toLowerCase() === base);
    if (hit) return hit.code;
  }
  return DEFAULT_LOCALE;
}
