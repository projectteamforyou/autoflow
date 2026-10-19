import type { en } from "./en.js";

/** The shape every locale must implement — inferred from the English source. */
export type Content = typeof en;

/** A legal-document block: a paragraph, or a bulleted list. */
export type Block = string | string[];
export interface Section {
  h: string;
  b: Block[];
}
export const sec = (h: string, ...b: Block[]): Section => ({ h, b });

export interface LegalDoc<K extends string> {
  seo: { title: string; description: string };
  h1: string;
  intro: string;
  sections: Record<K, Section>;
}

export type PrivacyKey =
  | "controller"
  | "summary"
  | "local"
  | "account"
  | "sync"
  | "atlas"
  | "share"
  | "ai"
  | "android"
  | "windows"
  | "website"
  | "noSale"
  | "processors"
  | "transfers"
  | "retention"
  | "rights"
  | "gdpr"
  | "pipa"
  | "appi"
  | "lgpd"
  | "ccpa"
  | "security"
  | "children"
  | "changes"
  | "contact";

export type TermsKey =
  | "agreement"
  | "service"
  | "eligibility"
  | "license"
  | "acceptable"
  | "responsibility"
  | "ai"
  | "content"
  | "sync"
  | "fees"
  | "ip"
  | "thirdParty"
  | "disclaimer"
  | "liability"
  | "indemnity"
  | "termination"
  | "changes"
  | "law"
  | "misc"
  | "contact";

export type Privacy = LegalDoc<PrivacyKey>;
export type Terms = LegalDoc<TermsKey>;
