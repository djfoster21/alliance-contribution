import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SnapshotRepo } from "../../src/repositories/snapshot-repo";
import { MemberRepo } from "../../src/repositories/member-repo";

const repo = new SnapshotRepo(env.DB);
const members = new MemberRepo(env.DB);

// Storage is NOT reset between `it` blocks, so every test creates its OWN members and owns a distinct
// block of capture dates. No test may depend on another's writes or on declaration order: a single
// `it.only` must pass on its own. That is an authored rule, not an enforced one — there is no
// `sequence.shuffle` in the vitest config, and turning it on globally would apply to every integration
// suite, several of which are order-independent only by the same convention and none of which are
// verified to be.
let seq = 0;
const newMember = async (name: string): Promise<number> =>
  (await members.insert({
    governor: `Snap${name}${seq++}`,
    alliance_rank: "R2",
    power: 100,
    power_position: 1,
    active: 1,
  })).id;

describe("SnapshotRepo", () => {
  it("writes a capture and counts it", async () => {
    const [a, b] = [await newMember("WriteA"), await newMember("WriteB")];

    await repo.replaceForDate("2030-01-01", [
      { member_id: a, captured_on: "2030-01-01", alliance_rank: "R4", power: 100, power_position: 1 },
      { member_id: b, captured_on: "2030-01-01", alliance_rank: "R2", power: 200, power_position: 2 },
    ]);
    expect(await repo.countForDate("2030-01-01")).toBe(2);
  });

  it("replaces a capture rather than appending to it", async () => {
    const [a, b] = [await newMember("ReplaceA"), await newMember("ReplaceB")];

    await repo.replaceForDate("2030-02-01", [
      { member_id: a, captured_on: "2030-02-01", alliance_rank: "R4", power: 100, power_position: 1 },
      { member_id: b, captured_on: "2030-02-01", alliance_rank: "R2", power: 200, power_position: 2 },
    ]);
    await repo.replaceForDate("2030-02-01", [
      { member_id: a, captured_on: "2030-02-01", alliance_rank: "R4", power: 111, power_position: 1 },
    ]);

    expect(await repo.countForDate("2030-02-01")).toBe(1);
    expect((await repo.listForMember(a)).map((r) => r.power)).toEqual([111]);
    expect(await repo.listForMember(b)).toEqual([]);
  });

  // The date argument — not each row's own captured_on — decides what is deleted AND what is written, so
  // the method can never delete one date while writing another.
  it("writes every row under the date argument, ignoring the row's own captured_on", async () => {
    const a = await newMember("ArgDate");

    await repo.replaceForDate("2030-02-15", [
      { member_id: a, captured_on: "1999-12-31", alliance_rank: "R2", power: 5, power_position: 3 },
    ]);

    expect(await repo.countForDate("2030-02-15")).toBe(1);
    expect(await repo.countForDate("1999-12-31")).toBe(0);
    expect((await repo.listForMember(a)).map((r) => r.captured_on)).toEqual(["2030-02-15"]);
  });

  it("falls back per member across a gap", async () => {
    // Alpha observed 03-01 and 03-08. Bravo observed 03-01 only — absent from 03-08.
    const [a, b] = [await newMember("GapA"), await newMember("GapB")];

    await repo.replaceForDate("2030-03-01", [
      { member_id: a, captured_on: "2030-03-01", alliance_rank: "R4", power: 111, power_position: 1 },
      { member_id: b, captured_on: "2030-03-01", alliance_rank: "R2", power: 200, power_position: 2 },
    ]);
    await repo.replaceForDate("2030-03-08", [
      { member_id: a, captured_on: "2030-03-08", alliance_rank: "R4", power: 120, power_position: 1 },
    ]);

    const byMember = new Map((await repo.latestPerMemberBefore("2030-03-15")).map((r) => [r.member_id, r]));
    expect(byMember.get(a)?.captured_on).toBe("2030-03-08");
    expect(byMember.get(b)?.captured_on).toBe("2030-03-01"); // fell back past the gap
    expect(byMember.get(b)?.power).toBe(200);
  });

  // Strictly BEFORE, never on: a same-date re-import reads its baseline with the date it is about to
  // rewrite, and must compare against the genuinely earlier capture rather than against itself.
  it("excludes the query date itself", async () => {
    const a = await newMember("Boundary");

    await repo.replaceForDate("2030-04-01", [
      { member_id: a, captured_on: "2030-04-01", alliance_rank: "R2", power: 100, power_position: 9 },
    ]);
    await repo.replaceForDate("2030-04-08", [
      { member_id: a, captured_on: "2030-04-08", alliance_rank: "R3", power: 200, power_position: 4 },
    ]);

    const baseline = (await repo.latestPerMemberBefore("2030-04-08")).find((r) => r.member_id === a);
    expect(baseline?.captured_on).toBe("2030-04-01");
    expect(baseline?.power).toBe(100);
  });

  it("returns an empty baseline when nothing precedes the capture", async () => {
    expect(await repo.latestPerMemberBefore("1900-01-01")).toEqual([]);
  });

  it("orders a member's history by capture date", async () => {
    const a = await newMember("History");

    // Written newest-first so the ordering cannot come from insertion order.
    await repo.replaceForDate("2030-05-08", [
      { member_id: a, captured_on: "2030-05-08", alliance_rank: "R2", power: 2, power_position: 2 },
    ]);
    await repo.replaceForDate("2030-05-01", [
      { member_id: a, captured_on: "2030-05-01", alliance_rank: "R2", power: 1, power_position: 1 },
    ]);

    expect((await repo.listForMember(a)).map((r) => r.captured_on)).toEqual(["2030-05-01", "2030-05-08"]);
  });

  it("lists captures newest first with member counts", async () => {
    const [a, b] = [await newMember("ListCapA"), await newMember("ListCapB")];

    await repo.replaceForDate("2030-06-01", [
      { member_id: a, captured_on: "2030-06-01", alliance_rank: "R2", power: 1, power_position: 1 },
      { member_id: b, captured_on: "2030-06-01", alliance_rank: "R2", power: 2, power_position: 2 },
    ]);
    await repo.replaceForDate("2030-06-08", [
      { member_id: a, captured_on: "2030-06-08", alliance_rank: "R2", power: 3, power_position: 1 },
    ]);

    const captures = await repo.listCaptures();
    // Other tests own other dates — assert on OUR two, and on their relative order.
    const mine = captures.filter((c) => c.captured_on.startsWith("2030-06-"));
    expect(mine).toEqual([
      { captured_on: "2030-06-08", members: 1 },
      { captured_on: "2030-06-01", members: 2 },
    ]);
    const dates = captures.map((c) => c.captured_on);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("lists a single date's snapshot rows", async () => {
    const [a, b] = [await newMember("ForDateA"), await newMember("ForDateB")];

    await repo.replaceForDate("2030-07-01", [
      { member_id: a, captured_on: "2030-07-01", alliance_rank: "R4", power: 10, power_position: 1 },
      { member_id: b, captured_on: "2030-07-01", alliance_rank: null, power: null, power_position: null },
    ]);
    await repo.replaceForDate("2030-07-08", [
      { member_id: a, captured_on: "2030-07-08", alliance_rank: "R4", power: 20, power_position: 1 },
    ]);

    const rows = await repo.listForDate("2030-07-01");
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r) => [r.member_id, r]));
    expect(byId.get(a)).toMatchObject({ captured_on: "2030-07-01", alliance_rank: "R4", power: 10 });
    expect(byId.get(b)).toMatchObject({ alliance_rank: null, power: null, power_position: null });

    expect(await repo.listForDate("1900-01-01")).toEqual([]);
  });
});
