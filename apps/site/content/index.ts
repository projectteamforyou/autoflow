import type { LocaleCode } from "@autoflow/core";
import { de } from "./de.js";
import { en } from "./en.js";
import { es } from "./es.js";
import { fr } from "./fr.js";
import { id } from "./id.js";
import { ja } from "./ja.js";
import { ko } from "./ko.js";
import { ptBR } from "./pt-BR.js";
import { ru } from "./ru.js";
import type { Content } from "./types.js";
import { vi } from "./vi.js";
import { zhCN } from "./zh-CN.js";
import { zhTW } from "./zh-TW.js";

/** Every locale in @autoflow/core LOCALES must appear here — a missing one fails typecheck. */
export const CONTENT: Record<LocaleCode, Content> = {
  en,
  ko,
  ja,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  es,
  fr,
  de,
  "pt-BR": ptBR,
  ru,
  vi,
  id,
};
