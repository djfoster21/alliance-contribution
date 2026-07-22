import { describe, expect, it } from "vitest";
import { normalizeName, resolveName } from "../../src/domain/resolve";

describe("resolveName", () => {
  it("resolves an alias hit to its member_id", () => {
    const aliases = new Map([[normalizeName("Nobody"), 10]]);
    const governors = new Map<string, number>();
    expect(resolveName("Nobody", aliases, governors)).toBe(10);
  });

  it("resolves a governor hit when no alias matches", () => {
    const aliases = new Map<string, number>();
    const governors = new Map([[normalizeName("Drake"), 20]]);
    expect(resolveName("Drake", aliases, governors)).toBe(20);
  });

  it("prefers the alias over a governor with the same key (alias-first)", () => {
    const key = normalizeName("Shared");
    const aliases = new Map([[key, 1]]);
    const governors = new Map([[key, 2]]);
    expect(resolveName("Shared", aliases, governors)).toBe(1);
  });

  it("returns null for an unmapped name", () => {
    const aliases = new Map<string, number>();
    const governors = new Map<string, number>();
    expect(resolveName("NoOneKnowsThisName", aliases, governors)).toBeNull();
  });

  it("resolves decoy names to their own distinct members", () => {
    const aliases = new Map([
      [normalizeName("NotEmber"), 1],
      [normalizeName("probablynotember"), 2],
      [normalizeName("ClearlyNotEmber"), 3],
    ]);
    const governors = new Map<string, number>();

    expect(resolveName("NotEmber", aliases, governors)).toBe(1);
    expect(resolveName("probablynotember", aliases, governors)).toBe(2);
    expect(resolveName("ClearlyNotEmber", aliases, governors)).toBe(3);
  });

  it("is case-sensitive — differing case does not collide with a decoy alias", () => {
    const aliases = new Map([[normalizeName("NotEmber"), 1]]);
    const governors = new Map<string, number>();

    expect(resolveName("notember", aliases, governors)).toBeNull();
  });

  it("strips the alliance tag before lookup", () => {
    const aliases = new Map([[normalizeName("NotEmber"), 1]]);
    const governors = new Map<string, number>();

    expect(resolveName("[ABC]NotEmber", aliases, governors)).toBe(1);
  });

  it("trims leading and trailing whitespace", () => {
    const aliases = new Map([[normalizeName("NotEmber"), 1]]);
    const governors = new Map<string, number>();

    expect(resolveName("  NotEmber  ", aliases, governors)).toBe(1);
  });

  it("NFC-normalizes so an NFD-decomposed lookup matches an NFC-keyed entry", () => {
    const nfc = "Frost_눈송이".normalize("NFC");
    const nfd = "Frost_눈송이".normalize("NFD");
    const governors = new Map([[normalizeName(nfc), 30]]);
    const aliases = new Map<string, number>();

    expect(resolveName(nfd, aliases, governors)).toBe(30);
  });

  it("returns null for an empty or whitespace-only rawName", () => {
    const aliases = new Map<string, number>();
    const governors = new Map<string, number>();

    expect(resolveName("", aliases, governors)).toBeNull();
    expect(resolveName("   ", aliases, governors)).toBeNull();
  });
});

describe("normalizeName", () => {
  it("removes the alliance tag, trims, and NFC-normalizes", () => {
    expect(normalizeName("[ABC]NotEmber")).toBe("NotEmber");
    expect(normalizeName("  NotEmber  ")).toBe("NotEmber");
    expect(normalizeName("[ABC]  NotEmber  ")).toBe("NotEmber");
  });

  it("normalizes an NFD string to its NFC form", () => {
    const nfd = "눈송이".normalize("NFD");
    expect(normalizeName(nfd)).toBe("눈송이".normalize("NFC"));
  });
});
