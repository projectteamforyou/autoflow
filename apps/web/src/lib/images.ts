/**
 * Template images for `findImage` steps and image targets. They live in the Windows / Android app
 * (bridge commands image_import / image_list / image_delete); the checks here mirror the native
 * limits so the user gets a friendly message before anything is sent over the bridge.
 */
import { tryInvoke, type Tried } from "./native";
import { platform } from "../platform";

/** Largest accepted PNG file (bytes) and side (px) — same as the native side. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const IMAGE_MAX_SIDE = platform === "android" ? 2048 : 4096;
export const IMAGE_REF_MAX = 200;
export const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

/** Letters, digits, `_`, `-` and `.`; at most 200 characters; not starting with a dot. */
export function isValidImageRef(ref: string): boolean {
  return ref.length > 0 && ref.length <= IMAGE_REF_MAX && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(ref);
}

/**
 * Turns a file name (or anything typed) into a valid reference: the `.png` extension and accents go,
 * every other character outside the charset becomes `_`. Returns "" when nothing usable is left.
 */
export function sanitizeImageRef(name: string): string {
  const base = name
    .trim()
    .replace(/^.*[\\/]/, "")
    .replace(/\.png$/i, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._]+/, "")
    .replace(/_+$/, "")
    .slice(0, IMAGE_REF_MAX);
  return isValidImageRef(base) ? base : "";
}

/** Decoded size in bytes of a base64 data URL (without decoding it). */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

/** Width and height from the PNG header (signature + IHDR) of a PNG data URL; null when it is not a PNG. */
export function pngSize(dataUrl: string): { width: number; height: number } | null {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return null;
  let head: string;
  try {
    // 32 base64 characters = the first 24 bytes: 8 signature, 4 length, 4 "IHDR", 4 width, 4 height.
    head = atob(dataUrl.slice(PNG_DATA_URL_PREFIX.length, PNG_DATA_URL_PREFIX.length + 32));
  } catch {
    return null;
  }
  if (head.length < 24 || head.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || head.slice(12, 16) !== "IHDR") return null;
  const u32 = (at: number) => ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0;
  return { width: u32(16), height: u32(20) };
}

export type ImageProblem = { key: "editor.image.notPng" } | { key: "editor.image.tooBig"; params: { mb: number } } | { key: "editor.image.tooLarge"; params: { px: number } };

/** The reason a data URL would be refused by `image_import`, as an i18n key; null when it is fine. */
export function checkPngDataUrl(dataUrl: string): ImageProblem | null {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return { key: "editor.image.notPng" };
  if (dataUrlBytes(dataUrl) > IMAGE_MAX_BYTES) return { key: "editor.image.tooBig", params: { mb: IMAGE_MAX_BYTES / (1024 * 1024) } };
  const size = pngSize(dataUrl);
  if (!size || size.width === 0 || size.height === 0) return { key: "editor.image.notPng" };
  if (size.width > IMAGE_MAX_SIDE || size.height > IMAGE_MAX_SIDE) return { key: "editor.image.tooLarge", params: { px: IMAGE_MAX_SIDE } };
  return null;
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Stored image refs, sorted; `null` when this app version (or the browser) has no image store. */
export async function listImages(): Promise<string[] | null> {
  const r = await tryInvoke("image_list", {});
  return r.ok && Array.isArray(r.value) ? r.value.filter((x): x is string => typeof x === "string").sort() : null;
}

export function importImage(ref: string, dataUrl: string): Promise<Tried<void>> {
  return tryInvoke("image_import", { ref, dataUrl });
}

export function deleteImage(ref: string): Promise<Tried<void>> {
  return tryInvoke("image_delete", { ref });
}
