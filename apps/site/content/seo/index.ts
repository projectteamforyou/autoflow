import type { LocaleCode } from "@autoflow/core";
import { en } from "./en.js";
import type { SeoContent } from "./types.js";

// TEMP preview: every locale uses English until translations land.
export const SEO: Record<LocaleCode, SeoContent> = { en, ko: en, ja: en, "zh-CN": en, "zh-TW": en, es: en, fr: en, de: en, "pt-BR": en, ru: en, vi: en, id: en };
