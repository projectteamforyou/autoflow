import { describe, expect, it } from "vitest";
import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, PNG_DATA_URL_PREFIX, checkPngDataUrl, dataUrlBytes, isValidImageRef, listImages, pngSize, sanitizeImageRef } from "./images";

/** A PNG header (signature + IHDR start) with the given size, as a data URL; `extra` pads the body. */
function png(width: number, height: number, extra = 0): string {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
  for (const n of [width, height]) bytes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  bytes.push(8, 6, 0, 0, 0);
  let s = String.fromCharCode(...bytes);
  if (extra) s += "\0".repeat(extra);
  return PNG_DATA_URL_PREFIX + btoa(s);
}

describe("image refs", () => {
  it("accepts letters, digits, _ - . and refuses a leading dot, other characters and long names", () => {
    for (const ok of ["a", "Button_OK-2.v1", "9lives", "-dash", "_x", "a".repeat(200)]) expect(isValidImageRef(ok)).toBe(true);
    for (const bad of ["", ".hidden", "a b", "버튼", "a/b", "a\\b", "x.png ", "a".repeat(201)]) expect(isValidImageRef(bad)).toBe(false);
  });

  it("turns file names into valid refs", () => {
    expect(sanitizeImageRef("Submit button.PNG")).toBe("Submit_button");
    expect(sanitizeImageRef("C:\\shots\\ok (1).png")).toBe("ok_1");
    expect(sanitizeImageRef("/tmp/été.png")).toBe("ete");
    expect(sanitizeImageRef("..secret.png")).toBe("secret");
    expect(sanitizeImageRef("  a__b  ")).toBe("a_b");
    expect(sanitizeImageRef("v1.2-final")).toBe("v1.2-final");
    expect(sanitizeImageRef("버튼.png")).toBe("");
    expect(sanitizeImageRef(".png")).toBe("");
    expect(sanitizeImageRef("x".repeat(300)).length).toBe(200);
    for (const name of ["Submit button.PNG", "ok (1).png", "a.b.c", "x".repeat(300)]) expect(isValidImageRef(sanitizeImageRef(name))).toBe(true);
  });
});

describe("PNG checks (mirror of the native limits)", () => {
  it("reads the size from the header", () => {
    expect(pngSize(png(640, 480))).toEqual({ width: 640, height: 480 });
    expect(pngSize(png(70000, 1))).toEqual({ width: 70000, height: 1 });
    expect(pngSize("data:image/jpeg;base64,/9j/4AAQ")).toBeNull();
    expect(pngSize(PNG_DATA_URL_PREFIX + btoa("not a png at all, just some text"))).toBeNull();
    expect(pngSize(PNG_DATA_URL_PREFIX + "%%%")).toBeNull();
  });

  it("counts decoded bytes without decoding", () => {
    expect(dataUrlBytes(PNG_DATA_URL_PREFIX + btoa("abc"))).toBe(3);
    expect(dataUrlBytes(PNG_DATA_URL_PREFIX + btoa("abcd"))).toBe(4);
    expect(dataUrlBytes(PNG_DATA_URL_PREFIX + btoa("abcde"))).toBe(5);
  });

  it("names the reason an image would be refused", () => {
    expect(checkPngDataUrl(png(100, 100))).toBeNull();
    expect(checkPngDataUrl(png(IMAGE_MAX_SIDE, IMAGE_MAX_SIDE))).toBeNull();
    expect(checkPngDataUrl("data:image/jpeg;base64,AAAA")).toEqual({ key: "editor.image.notPng" });
    expect(checkPngDataUrl(PNG_DATA_URL_PREFIX + btoa("x".repeat(40)))).toEqual({ key: "editor.image.notPng" });
    expect(checkPngDataUrl(png(0, 10))).toEqual({ key: "editor.image.notPng" });
    expect(checkPngDataUrl(png(IMAGE_MAX_SIDE + 1, 10))).toEqual({ key: "editor.image.tooLarge", params: { px: 4096 } });
    expect(checkPngDataUrl(png(10, 5000))).toEqual({ key: "editor.image.tooLarge", params: { px: 4096 } });
    expect(checkPngDataUrl(png(10, 10, IMAGE_MAX_BYTES))).toEqual({ key: "editor.image.tooBig", params: { mb: 4 } });
  });

  it("has no image store in the browser: the list is unavailable, not an error", async () => {
    expect(await listImages()).toBeNull();
  });
});
