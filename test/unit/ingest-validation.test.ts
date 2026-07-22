import { describe, expect, it } from "vitest";
import {
  findTwoTrapOverlaps,
  findWithinEventDuplicates,
  type ResolvedRow,
} from "../../src/domain/ingest-validation";

describe("findWithinEventDuplicates", () => {
  it("flags an alias and the canonical name resolving to the same member", () => {
    const rows: ResolvedRow[] = [
      { raw_name: "NotEmber", member_id: 5 },
      { raw_name: "Ember", member_id: 5 },
    ];
    expect(findWithinEventDuplicates(rows)).toEqual([
      { member_id: 5, raw_names: ["NotEmber", "Ember"] },
    ]);
  });

  it("returns [] when raw names resolve to distinct members", () => {
    const rows: ResolvedRow[] = [
      { raw_name: "Ember", member_id: 5 },
      { raw_name: "Blaze", member_id: 7 },
    ];
    expect(findWithinEventDuplicates(rows)).toEqual([]);
  });

  it("does not flag two unresolved (null) rows", () => {
    const rows: ResolvedRow[] = [
      { raw_name: "Unknown1", member_id: null },
      { raw_name: "Unknown2", member_id: null },
    ];
    expect(findWithinEventDuplicates(rows)).toEqual([]);
  });

  it("groups all raw names for a member appearing 3 times", () => {
    const rows: ResolvedRow[] = [
      { raw_name: "Ember", member_id: 5 },
      { raw_name: "NotEmber", member_id: 5 },
      { raw_name: "EmberAlt", member_id: 5 },
    ];
    expect(findWithinEventDuplicates(rows)).toEqual([
      { member_id: 5, raw_names: ["Ember", "NotEmber", "EmberAlt"] },
    ]);
  });
});

describe("findTwoTrapOverlaps", () => {
  it("flags the same member_id appearing in both traps under different raw names", () => {
    const trap1: ResolvedRow[] = [{ raw_name: "Ember", member_id: 5 }];
    const trap2: ResolvedRow[] = [{ raw_name: "NotEmber", member_id: 5 }];
    expect(findTwoTrapOverlaps(trap1, trap2)).toEqual([{ raw_name: "Ember", member_id: 5 }]);
  });

  it("returns [] when the traps have different members", () => {
    const trap1: ResolvedRow[] = [{ raw_name: "Ember", member_id: 5 }];
    const trap2: ResolvedRow[] = [{ raw_name: "Blaze", member_id: 7 }];
    expect(findTwoTrapOverlaps(trap1, trap2)).toEqual([]);
  });

  it("flags an unresolved row appearing under the identical raw_name in both traps", () => {
    const trap1: ResolvedRow[] = [{ raw_name: "Unknown1", member_id: null }];
    const trap2: ResolvedRow[] = [{ raw_name: "Unknown1", member_id: null }];
    expect(findTwoTrapOverlaps(trap1, trap2)).toEqual([{ raw_name: "Unknown1", member_id: null }]);
  });

  it("does not flag unresolved rows with different raw names", () => {
    const trap1: ResolvedRow[] = [{ raw_name: "Unknown1", member_id: null }];
    const trap2: ResolvedRow[] = [{ raw_name: "Unknown2", member_id: null }];
    expect(findTwoTrapOverlaps(trap1, trap2)).toEqual([]);
  });

  it("does not flag a resolved member that only appears in its own trap", () => {
    const trap1: ResolvedRow[] = [{ raw_name: "Ember", member_id: 5 }];
    const trap2: ResolvedRow[] = [{ raw_name: "Someone", member_id: 9 }];
    expect(findTwoTrapOverlaps(trap1, trap2)).toEqual([]);
  });
});
