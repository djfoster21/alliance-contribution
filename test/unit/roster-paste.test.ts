import { describe, expect, it } from "vitest";
import type { ParsedRosterRow } from "../../web/src/lib/roster-paste";
import {
  classifyRoster,
  metaFields,
  parseNumCell,
  parseRoster,
  serializeRoster,
  type AliasLike,
  type MemberLike,
} from "../../web/src/lib/roster-paste";
import type { RosterImportBatch } from "../../shared/types";

// Compile-time pin: the parsed row's meta must match the batch's update shape by NAME and type.
// Required<> is load-bearing — the raw shape is all-optional, i.e. a weak type, so a field renamed
// back to the legacy role/rank_snapshot would still be assignable and would pass silently.
type BatchMeta = Required<Omit<RosterImportBatch["updates"][number], "member_id">>;
type ParsedMeta = Omit<ParsedRosterRow, "line" | "governor">;
const _pinTo: BatchMeta = {} as ParsedMeta;
const _pinFrom: ParsedMeta = {} as BatchMeta;
void _pinTo;
void _pinFrom;

describe("parseRoster", () => {
  it("parses the four columns and strips thousand separators", () => {
    const out = parseRoster("Aurora\tR4\t164,497,800\t1");
    expect(out.rows).toEqual([
      { line: 1, governor: "Aurora", alliance_rank: "R4", power: 164497800, power_position: 1 },
    ]);
    expect(out.noGovernor).toBe(0);
    expect(out.invalid).toEqual([]);
  });

  it("uppercases the rank and tolerates a CRLF paste", () => {
    const out = parseRoster("Aurora\tr4\t10\t1\r\nBlaze\t R3 \t9\t2\r\n");
    expect(out.rows.map((r) => r.alliance_rank)).toEqual(["R4", "R3"]);
  });

  it("marks a rank outside R1-R5 invalid instead of storing it", () => {
    const out = parseRoster("Aurora\tR4\t10\t1\nBlaze\tR6\t9\t2\nCinder\tLeader\t8\t3");
    expect(out.rows.map((r) => r.governor)).toEqual(["Aurora"]);
    expect(out.invalid).toEqual([
      { line: 2, governor: "Blaze", field: "rank", value: "R6" },
      { line: 3, governor: "Cinder", field: "rank", value: "Leader" },
    ]);
  });

  it("treats a blank rank cell as null, not invalid", () => {
    const out = parseRoster("Aurora\t\t10\t1");
    expect(out.rows[0].alliance_rank).toBeNull();
    expect(out.invalid).toEqual([]);
  });

  it("leaves omitted trailing columns null so a partial paste still updates what it carries", () => {
    const out = parseRoster("Aurora\tR4");
    expect(out.rows[0]).toEqual({
      line: 1, governor: "Aurora", alliance_rank: "R4", power: null, power_position: null,
    });
  });

  it("strips the alliance tag from the governor", () => {
    expect(parseRoster("[ABC]Aurora\tR4\t10\t1").rows[0].governor).toBe("Aurora");
  });

  it("counts a line with no governor as no-governor", () => {
    const out = parseRoster("Aurora\tR4\t10\t1\n\tR3\t9\t2");
    expect(out.rows).toHaveLength(1);
    expect(out.noGovernor).toBe(1);
  });

  it("numbers lines from the raw text so an invalid row points at the right line", () => {
    const out = parseRoster("\n\nAurora\tR9\t10\t1");
    expect(out.invalid).toEqual([{ line: 3, governor: "Aurora", field: "rank", value: "R9" }]);
  });

  // CRITICAL: a non-empty but unreadable power/position must NOT map to null. null means "cell
  // absent" downstream (metaFields omits the key, the member keeps its stale power), and
  // MemberService.importRoster writes the snapshot from POST-UPDATE member state — so a garbled
  // cell would silently persist last capture's power under today's date and report "no change".
  it("rejects an unreadable power cell instead of silently keeping the member's stale power", () => {
    const out = parseRoster("Aurora\tR4\t1.2B\t1");
    expect(out.rows).toEqual([]);
    expect(out.invalid).toEqual([{ line: 1, governor: "Aurora", field: "power", value: "1.2B" }]);
  });

  it("rejects a negative power_position", () => {
    const out = parseRoster("Aurora\tR4\t10\t-3");
    expect(out.rows).toEqual([]);
    expect(out.invalid).toEqual([{ line: 1, governor: "Aurora", field: "power_position", value: "-3" }]);
  });

  it("rejects a non-integer power_position", () => {
    const out = parseRoster("Aurora\tR4\t10\t1.5");
    expect(out.rows).toEqual([]);
    expect(out.invalid).toEqual([{ line: 1, governor: "Aurora", field: "power_position", value: "1.5" }]);
  });

  it("treats a blank power cell as null, not invalid — distinct from an unreadable one", () => {
    const out = parseRoster("Aurora\tR4\t\t1");
    expect(out.rows[0].power).toBeNull();
    expect(out.invalid).toEqual([]);
  });

  it("does not inflate the no-governor count for a trailing blank line", () => {
    const out = parseRoster("Aurora\tR4\t10\t1\n");
    expect(out.rows).toHaveLength(1);
    expect(out.noGovernor).toBe(0);
  });

  it("counts an alliance tag alone as the whole governor cell as no-governor, not a row with an empty name", () => {
    const out = parseRoster("[ABC]\tR4\t10\t1");
    expect(out.rows).toEqual([]);
    expect(out.noGovernor).toBe(1);
  });

  it("strips space-separated thousands in a power cell", () => {
    const out = parseRoster("Aurora\tR4\t164 497 800\t1");
    expect(out.rows[0].power).toBe(164497800);
  });

  it("rejects -0 and hex-looking cells rather than coercing them to a number", () => {
    expect(parseRoster("Aurora\tR4\t-0\t1").invalid).toEqual([
      { line: 1, governor: "Aurora", field: "power", value: "-0" },
    ]);
    expect(parseRoster("Aurora\tR4\t0x10\t1").invalid).toEqual([
      { line: 1, governor: "Aurora", field: "power", value: "0x10" },
    ]);
  });

  // The `field` tag only earns its keep if the banner shows the operator's own text. Pin that the
  // reported value is the trimmed cell, not a re-serialized or further-stripped version of it.
  it("reports the invalid cell's own text, internal spacing intact, as the value", () => {
    const out = parseRoster("Aurora\tR4\t 1.2 B \t1");
    expect(out.invalid).toEqual([{ line: 1, governor: "Aurora", field: "power", value: "1.2 B" }]);
  });

  // Mirrors web/src/pages/Events.tsx's identical guard. The prompt asks for a fenced block, so this
  // is the ordinary shape of a paste, not an edge case — without the guard the fence would reach the
  // wizard as a candidate new member named "```". Note the row is line 2: the fence occupies line 1,
  // so the "line N" in an unreadable-cell error counts the fence the operator can see in the box.
  it("ignores code-fence lines instead of treating them as governors", () => {
    const out = parseRoster("```\nAurora\tR4\t10\t1\n```");
    expect(out.rows).toEqual([
      { line: 2, governor: "Aurora", alliance_rank: "R4", power: 10, power_position: 1 },
    ]);
    expect(out.noGovernor).toBe(0);
    expect(out.invalid).toEqual([]);
  });
});

const MEMBERS: MemberLike[] = [
  { id: 1, governor: "Aurora", active: 1 },
  { id: 2, governor: "Ember", active: 1 },
  { id: 3, governor: "Blaze", active: 1 },
  { id: 4, governor: "Ghost", active: 0 },
];
const ALIASES: AliasLike[] = [{ alias: "NotEmber", member_id: 2 }];

// aliasTargets is keyed by the normalized pasted name, exactly as the wizard keys its decisions.
const classify = (text: string, aliasTargets: Record<string, number | null> = {}) =>
  classifyRoster({ rows: parseRoster(text).rows, members: MEMBERS, aliases: ALIASES, aliasTargets });

describe("classifyRoster", () => {
  it("resolves a name from the alias table", () => {
    const c = classify("NotEmber\tR3\t10\t1");
    expect(c.matched.map((m) => m.memberId)).toEqual([2]);
    expect(c.unrecognized).toEqual([]);
  });

  it("resolves an alias before a governor of the same name (the decoy rename)", () => {
    // The alliance deliberately renames decoys onto names that look like other members'. The alias
    // table wins, so "Ember" here is Vega, and the real Ember is absent from this capture.
    // The backend keeps this state unreachable in a consistent DB (alias-service.ts:75 rejects an
    // alias equal to a governor), so this pins the mirror's intent rather than a live case.
    const c = classifyRoster({
      rows: parseRoster("Ember\tR3\t10\t1").rows,
      members: [
        { id: 1, governor: "Ember", active: 1 },
        { id: 2, governor: "Vega", active: 1 },
      ],
      aliases: [{ alias: "Ember", member_id: 2 }],
    });
    expect(c.matched.map((m) => m.memberId)).toEqual([2]);
    expect(c.absent.map((m) => m.governor)).toEqual(["Ember"]);
  });

  it("collapses the pinned self-row and counts it", () => {
    const c = classify("Aurora\tR4\t10\t1\nBlaze\tR3\t9\t2\nAurora\tR4\t10\t1");
    expect(c.matched.map((m) => m.memberId)).toEqual([1, 3]);
    expect(c.duplicates).toBe(1);
    expect(c.conflicts).toEqual([]);
  });

  it("blocks when two distinct names resolve to the same member", () => {
    const c = classify("Ember\tR3\t10\t1\nNotEmber\tR3\t10\t1");
    expect(c.conflicts).toEqual([{ memberId: 2, governor: "Ember", names: ["Ember", "NotEmber"] }]);
  });

  it("blocks an alias decision pointing at a member the paste already matched", () => {
    const c = classify("Aurora\tR4\t10\t1\nNewcomer\tR3\t9\t2", { Newcomer: 1 });
    expect(c.conflicts).toEqual([
      { memberId: 1, governor: "Aurora", names: ["Aurora", "Newcomer"] },
    ]);
  });

  it("blocks two alias decisions pointing at the same unmatched member", () => {
    // Neither name matches anything, so `matched` is empty — the conflict must come from the
    // decisions alone. The server rejects this with "member 3 appears twice in this batch".
    const c = classify("Emb0r\tR3\t10\t1\nEmb3r\tR3\t9\t2", { Emb0r: 3, Emb3r: 3 });
    expect(c.conflicts).toEqual([{ memberId: 3, governor: "Blaze", names: ["Emb0r", "Emb3r"] }]);
  });

  it("a 'new member' decision claims nobody", () => {
    const c = classify("NewA\tR5\t10\t1\nNewB\tR3\t9\t2", { NewA: null, NewB: null });
    expect(c.conflicts).toEqual([]);
    expect(c.absent.map((m) => m.governor)).toEqual(["Aurora", "Ember", "Blaze"]);
  });

  it("surfaces a decision targeting a member id absent from the roster with a legible label", () => {
    // A step-2 decision can point at a member id no longer in `members` (e.g. deleted between
    // paste and apply). The conflict must still read as text in the banner, not a bare id.
    const c = classify("Emb0r\tR3\t10\t1\nEmb3r\tR3\t9\t2", { Emb0r: 99, Emb3r: 99 });
    expect(c.conflicts).toEqual([{ memberId: 99, governor: "#99", names: ["Emb0r", "Emb3r"] }]);
  });

  it("ignores a decision whose name is no longer in the paste", () => {
    // The operator mapped the OCR artifact "Emb0r" to Ember, then fixed the paste in place.
    // The stale decision must not conflict with the now-matching row, and must not hide Blaze.
    const c = classify("Ember\tR3\t10\t1", { Emb0r: 2 });
    expect(c.conflicts).toEqual([]);
    expect(c.absent.map((m) => m.governor)).toEqual(["Aurora", "Blaze"]);
  });

  it("lists active members the paste never mentions as absent", () => {
    const c = classify("Aurora\tR4\t10\t1");
    expect(c.absent.map((m) => m.governor)).toEqual(["Ember", "Blaze"]);
  });

  it("removes a member from absent once a step-2 alias decision claims them", () => {
    const c = classify("Aurora\tR4\t10\t1\nEmberX\tR3\t9\t2", { EmberX: 2 });
    expect(c.absent.map((m) => m.governor)).toEqual(["Blaze"]);
  });

  it("never lists an inactive member as absent, and reports a matched one as returning", () => {
    const c = classify("Aurora\tR4\t10\t1\nGhost\tR2\t8\t3");
    expect(c.absent.map((m) => m.governor)).toEqual(["Ember", "Blaze"]);
    expect(c.returning.map((m) => m.governor)).toEqual(["Ghost"]);
  });

  it("warns when the paste claims no R5", () => {
    expect(classify("Aurora\tR4\t10\t1").leaderWarning).toBe(
      "No R5 in this paste — the alliance leader is missing or the paste is partial.",
    );
  });

  it("warns when two different members claim R5", () => {
    expect(classify("Aurora\tR5\t10\t1\nBlaze\tR5\t9\t2").leaderWarning).toBe(
      "2 rows claim R5 — an alliance has exactly one leader, so check the paste.",
    );
  });

  it("stays silent when the R5's own row is the pinned duplicate", () => {
    // The leader is the most likely person to capture the screen, and the screen pins their own
    // row again at the bottom. Counting before the collapse would cry wolf on every single import.
    const c = classify("Aurora\tR5\t10\t1\nBlaze\tR4\t9\t2\nAurora\tR5\t10\t1");
    expect(c.duplicates).toBe(1);
    expect(c.leaderWarning).toBeNull();
  });

  it("stays silent on exactly one R5", () => {
    expect(classify("Aurora\tR5\t10\t1").leaderWarning).toBeNull();
  });
});

describe("metaFields", () => {
  it("omits a field whose cell was blank so an update leaves it untouched", () => {
    const [row] = parseRoster("Aurora\t\t\t").rows;
    expect(metaFields(row)).toEqual({});
  });

  it("includes every field the paste carried", () => {
    const [row] = parseRoster("Aurora\tR4\t10\t3").rows;
    expect(metaFields(row)).toEqual({ alliance_rank: "R4", power: 10, power_position: 3 });
  });

  it("includes a zero power rather than treating it as missing", () => {
    const [row] = parseRoster("Aurora\tR4\t0\t3").rows;
    expect(metaFields(row)).toEqual({ alliance_rank: "R4", power: 0, power_position: 3 });
  });
});

// Exported for the Add/Edit member dialogs, which validate the same two columns by hand. A negative
// power stored from a dialog would permanently disarm the delta's identity tripwire, which divides
// by the baseline power (src/domain/roster-delta.ts).
describe("parseNumCell", () => {
  it("rejects a negative number", () => {
    expect(parseNumCell("-5")).toBe("bad");
  });

  it("rejects hex and scientific notation that Number() would happily coerce", () => {
    expect(parseNumCell("0x10")).toBe("bad");
    expect(parseNumCell("1e5")).toBe("bad");
    expect(parseNumCell("-0")).toBe("bad");
  });

  it("reads a blank cell as null and a digit string as its number", () => {
    expect(parseNumCell("")).toBeNull();
    expect(parseNumCell("  ")).toBeNull();
    expect(parseNumCell("164,497,800")).toBe(164497800);
    expect(parseNumCell("0")).toBe(0);
  });
});

describe("serializeRoster", () => {
  it("round-trips through parseRoster, empty cells included", () => {
    const rows = [
      { governor: "Aurora", alliance_rank: "R4", power: 164497800, power_position: 1 },
      { governor: "Blaze", alliance_rank: null, power: null, power_position: 7 },
      { governor: "Cinder", alliance_rank: "R1", power: 0, power_position: null },
    ];
    const out = parseRoster(serializeRoster(rows));
    expect(out.invalid).toEqual([]);
    expect(out.noGovernor).toBe(0);
    expect(out.rows.map(({ line: _l, ...r }) => r)).toEqual(rows);
  });
});
