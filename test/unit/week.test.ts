import { describe, expect, it } from "vitest";
import { isoWeek } from "../../src/domain/week";

describe("isoWeek", () => {
  it("derives the week for a mid-year date", () => {
    expect(isoWeek("2026-07-13")).toBe("2026-W29");
  });

  it("matches the known W28 anchor (Monday of ISO week 28, 2026)", () => {
    expect(isoWeek("2026-07-06")).toBe("2026-W28");
  });

  it("uses the ISO week-numbering year across the Jan 1 boundary", () => {
    expect(isoWeek("2021-01-01")).toBe("2020-W53");
  });

  it("uses the ISO week-numbering year across the Dec 31 boundary", () => {
    expect(isoWeek("2019-12-30")).toBe("2020-W01");
  });

  it("handles a W53 year", () => {
    expect(isoWeek("2016-01-03")).toBe("2015-W53");
  });

  it("handles a leap year boundary", () => {
    expect(isoWeek("2024-12-30")).toBe("2025-W01");
  });

  it("zero-pads single-digit week numbers", () => {
    expect(isoWeek("2026-01-05")).toBe("2026-W02");
  });

  it("throws on a non-zero-padded date", () => {
    expect(() => isoWeek("2026-7-6")).toThrow(/malformed date/);
  });

  it("throws on garbage input", () => {
    expect(() => isoWeek("garbage")).toThrow(/malformed date/);
  });

  it("throws on an invalid calendar date", () => {
    expect(() => isoWeek("2026-02-30")).toThrow(/invalid calendar date/);
  });
});
