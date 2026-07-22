import { describe, expect, it } from "vitest";
import { ACTIVITY_COLORS, DEFAULT_ACTIVITY_COLOR, isActivityColor } from "../../shared/colors";

describe("ACTIVITY_COLORS", () => {
  it("has the 8 fixed palette tokens", () => {
    expect(ACTIVITY_COLORS).toEqual([
      "blue", "green", "violet", "sky", "amber", "red", "slate", "pink",
    ]);
  });

  it("defaults to slate", () => {
    expect(DEFAULT_ACTIVITY_COLOR).toBe("slate");
  });
});

describe("isActivityColor", () => {
  it("accepts a valid token", () => {
    expect(isActivityColor("sky")).toBe(true);
  });

  it("rejects an unknown token", () => {
    expect(isActivityColor("teal")).toBe(false);
  });

  it("rejects null", () => {
    expect(isActivityColor(null)).toBe(false);
  });
});
