import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion, parseVersion } from "./version";

describe("version compare", () => {
  it("parses major.minor.patch with optional v prefix, short forms and suffixes", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion(" v1.10.0 ")).toEqual([1, 10, 0]);
    expect(parseVersion("2")).toEqual([2, 0, 0]);
    expect(parseVersion("1.4")).toEqual([1, 4, 0]);
    expect(parseVersion("1.2.3-beta.1+build5")).toEqual([1, 2, 3]);
    for (const bad of ["", "latest", "1.2.3.4", "1..2", "a.b.c", "1.2.x", null, undefined, 12]) expect(parseVersion(bad)).toBeNull();
  });

  it("compares numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.1.2", "1.1.10")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });

  it("never reports an update when either side is not a version", () => {
    expect(isNewerVersion("1.1.3", "1.1.2")).toBe(true);
    expect(isNewerVersion("1.1.2", "1.1.2")).toBe(false);
    expect(isNewerVersion("1.1.1", "1.1.2")).toBe(false);
    expect(isNewerVersion(null, "1.1.2")).toBe(false);
    expect(isNewerVersion("1.1.3", undefined)).toBe(false);
    expect(isNewerVersion("nightly", "1.1.2")).toBe(false);
  });
});
