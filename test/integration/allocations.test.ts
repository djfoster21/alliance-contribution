import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { AllocationPreview, AllocationWithLines } from "../../shared/types";
import { createServices } from "../../src/services";
import { ADMIN, MANAGER, VIEWER } from "./keys";

const { DB, SEED_STATEMENTS } = env;
const URL = "https://example.com/api/admin/allocations";

// Storage is NOT reset between tests (see analytics.test.ts) — every member/date here is unique to
// this file. Week A: three mapped members with distinct contribution tiers. Week B: only an unmapped
// name, so it HAS events but no eligible member (the zero-eligible case).
let weekA: string;
let weekB: string;

const json = (body: unknown) => ({ "Content-Type": "application/json", body: JSON.stringify(body) });

function post(path: string, body: unknown, headers: Record<string, string> = ADMIN) {
  const { body: b, ...h } = { ...json(body) };
  return SELF.fetch(`${URL}${path}`, { method: "POST", headers: { ...headers, ...h }, body: b });
}

beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) {
    await DB.prepare(stmt).run();
  }
  const { memberService, eventService, aliasService } = createServices(DB);
  const a = await memberService.create({ governor: "Alloc_A", alliance_rank: "R4", power: 98_500_000 });
  for (const governor of ["Alloc_B", "Alloc_C"]) {
    await memberService.create({ governor });
  }
  // Two aliases; the LATER one is the member's "last alias" (created_at ties resolve by id).
  await aliasService.add({ alias: "Alloc_A_Old", member_id: a.id });
  await aliasService.add({ alias: "Alloc_A_New", member_id: a.id });
  // Contribution seed tiers: 20000 -> 1, 60000 -> 2, 120000 -> 3 points.
  weekA = (
    await eventService.create({
      activity: "contribution",
      date: "2028-01-10",
      rows: [
        { raw_name: "Alloc_A", value: 120000 }, // 3 points
        { raw_name: "Alloc_B", value: 60000 }, // 2 points
        { raw_name: "Alloc_C", value: 25000 }, // 1 point
      ],
    })
  ).event.week;
  weekB = (
    await eventService.create({
      activity: "contribution",
      date: "2028-02-07",
      rows: [{ raw_name: "Alloc_Nobody", value: 60000 }], // unmapped -> counts for nobody
    })
  ).event.week;
});

const topN = (quantity: number, weeks: () => string[]) => ({
  title: "KvK chests",
  quantity,
  metric: "points",
  weeks: weeks(),
  strategy: "top_n",
});

describe("allocations auth", () => {
  it("rejects viewer and manager keys on every route with 403", async () => {
    const routes: [string, string][] = [
      ["POST", "/preview"],
      ["POST", ""],
      ["GET", ""],
      ["GET", "/1"],
      ["PATCH", "/1"],
      ["DELETE", "/1"],
    ];
    for (const headers of [VIEWER, MANAGER]) {
      for (const [method, path] of routes) {
        const res = await SELF.fetch(`${URL}${path}`, { method, headers });
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    }
  });
});

describe("POST /preview", () => {
  it("computes lines without storing anything", async () => {
    const res = await post("/preview", { quantity: 2, metric: "points", weeks: [weekA], strategy: "top_n" });
    expect(res.status).toBe(200);
    const preview = (await res.json()) as AllocationPreview;
    expect(preview.lines.map((l) => [l.rank, l.governor, l.metric_value, l.amount])).toEqual([
      [1, "Alloc_A", 3, 1],
      [2, "Alloc_B", 2, 1],
    ]);
    // Preview-only display context: attendance over the selected weeks (both attended weekA's
    // single event-day -> 1.0). Saved lines never carry it.
    expect(preview.lines.map((l) => l.attendance)).toEqual([1, 1]);
    // Member display context joined onto every line: current alliance rank, power, last alias.
    expect(preview.lines.map((l) => [l.alliance_rank, l.power, l.last_alias])).toEqual([
      ["R4", 98_500_000, "Alloc_A_New"],
      [null, null, null],
    ]);
    expect(preview.warnings).toEqual([]);

    const list = await SELF.fetch(URL, { headers: ADMIN });
    expect(await list.json()).toEqual([]);
  });

  it("shows the zero-eligible case as a warning instead of failing", async () => {
    const res = await post("/preview", { quantity: 5, metric: "points", weeks: [weekB], strategy: "top_n" });
    expect(res.status).toBe(200);
    const preview = (await res.json()) as AllocationPreview;
    expect(preview.lines).toEqual([]);
    expect(preview.warnings.some((w) => /eligible/i.test(w))).toBe(true);
  });

  it("ranks by attendance (distinct event-days) when metric = attendance", async () => {
    const res = await post("/preview", {
      quantity: 2,
      metric: "attendance",
      weeks: [weekA],
      strategy: "proportional",
    });
    expect(res.status).toBe(200);
    const preview = (await res.json()) as AllocationPreview;
    // Everyone attended the single event-day once: equal values, largest-remainder falls to rank order.
    expect(preview.lines.map((l) => [l.governor, l.metric_value, l.amount])).toEqual([
      ["Alloc_A", 1, 1],
      ["Alloc_B", 1, 1],
    ]);
  });

  it("rejects a week that has no events with 400", async () => {
    const res = await post("/preview", { quantity: 2, metric: "points", weeks: ["2099-W01"], strategy: "top_n" });
    expect(res.status).toBe(400);
  });

  it("rejects bad inputs with 400", async () => {
    const base = { quantity: 2, metric: "points", weeks: [weekA], strategy: "top_n" };
    for (const body of [
      { ...base, quantity: 0 },
      { ...base, quantity: 1.5 },
      { ...base, metric: "power" },
      { ...base, strategy: "lottery" },
      { ...base, weeks: [] },
      { ...base, strategy: "tiered", tiers: [{ fromRank: 1, toRank: 3, amountEach: 1 }, { fromRank: 2, toRank: 4, amountEach: 1 }] },
      { ...base, strategy: "proportional_top" }, // topCount missing
      { ...base, strategy: "proportional_top", topCount: 0 },
      { ...base, strategy: "proportional_top", topCount: 1.5 },
    ]) {
      const res = await post("/preview", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("splits proportionally among only the top N for proportional_top", async () => {
    const res = await post("/preview", {
      quantity: 10,
      metric: "points",
      weeks: [weekA],
      strategy: "proportional_top",
      topCount: 2,
    });
    expect(res.status).toBe(200);
    const preview = (await res.json()) as AllocationPreview;
    // A=3, B=2 points -> 6 and 4 of 10; C excluded by the cutoff.
    expect(preview.lines.map((l) => [l.governor, l.amount])).toEqual([
      ["Alloc_A", 6],
      ["Alloc_B", 4],
    ]);
  });

  it("always allocates 100% — top_n with quantity above the eligible count redistributes by rank", async () => {
    const res = await post("/preview", { quantity: 10, metric: "points", weeks: [weekA], strategy: "top_n" });
    expect(res.status).toBe(200);
    const preview = (await res.json()) as AllocationPreview;
    expect(preview.lines.map((l) => l.amount)).toEqual([4, 3, 3]);
    expect(preview.lines.reduce((sum, l) => sum + l.amount, 0)).toBe(10);
  });
});

describe("request hygiene", () => {
  it("rejects malformed or non-object JSON bodies with 400, not 500", async () => {
    for (const body of ["{not json", "null", '"a string"']) {
      const res = await SELF.fetch(`${URL}/preview`, {
        method: "POST",
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body,
      });
      expect(res.status, body).toBe(400);
    }
    const patch = await SELF.fetch(`${URL}/1`, {
      method: "PATCH",
      headers: { ...ADMIN, "Content-Type": "application/json" },
      body: "null",
    });
    expect(patch.status).toBe(400);
  });

  it("rejects a non-numeric :id with 400", async () => {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const res = await SELF.fetch(`${URL}/abc`, {
        method,
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ title: "x" }) : undefined,
      });
      expect(res.status, method).toBe(400);
    }
  });
});

describe("POST / (create)", () => {
  it("requires a title", async () => {
    const res = await post("", { quantity: 2, metric: "points", weeks: [weekA], strategy: "top_n" });
    expect(res.status).toBe(400);
  });

  it("rejects a zero-eligible save with 400 — a hand-out to nobody is never a valid record", async () => {
    const res = await post("", { title: "Nobody", quantity: 5, metric: "points", weeks: [weekB], strategy: "top_n" });
    expect(res.status).toBe(400);
  });

  it("rejects a tiered save whose bands all miss the eligible range, without claiming nobody is eligible", async () => {
    // weekA has 3 eligible members; the band starts at rank 50 — valid tiers, zero lines.
    const res = await post("", {
      title: "Ghost band",
      quantity: 20,
      metric: "points",
      weeks: [weekA],
      strategy: "tiered",
      tiers: [{ fromRank: 50, toRank: 60, amountEach: 1 }],
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).not.toMatch(/^no eligible members/i);
    expect(error).toMatch(/hand out nothing/i);
  });

  it("recomputes from current data, persists, and round-trips via GET (preview parity)", async () => {
    const previewRes = await post("/preview", topN(2, () => [weekA]));
    const preview = (await previewRes.json()) as AllocationPreview;

    const createRes = await post("", topN(2, () => [weekA]));
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as AllocationWithLines;
    expect(created.id).toBeGreaterThan(0);
    expect(created.title).toBe("KvK chests");
    expect(created.quantity).toBe(2);
    expect(created.metric).toBe("points");
    expect(created.weeks).toEqual([weekA]);
    expect(created.strategy).toBe("top_n");
    expect(created.tiers).toBeNull();
    // Parity on the frozen fields; `attendance` is a preview-only enrichment, absent once saved.
    expect(created.lines).toEqual(preview.lines.map(({ attendance: _a, ...rest }) => rest));
    expect(created.lines.every((l) => !("attendance" in l))).toBe(true);

    const getRes = await SELF.fetch(`${URL}/${created.id}`, { headers: ADMIN });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as AllocationWithLines;
    expect(fetched).toEqual(created);
    // Saved lines read back with the member's CURRENT rank/power/last-alias joined on.
    expect(fetched.lines[0].alliance_rank).toBe("R4");
    expect(fetched.lines[0].power).toBe(98_500_000);
    expect(fetched.lines[0].last_alias).toBe("Alloc_A_New");

    const list = await SELF.fetch(URL, { headers: ADMIN });
    const rows = (await list.json()) as AllocationWithLines[];
    expect(rows.some((r) => r.id === created.id)).toBe(true);
  });

  it("stores top_count for a proportional_top allocation and round-trips it", async () => {
    const res = await post("", {
      title: "Top heavy",
      quantity: 10,
      metric: "points",
      weeks: [weekA],
      strategy: "proportional_top",
      topCount: 2,
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as AllocationWithLines;
    expect(created.strategy).toBe("proportional_top");
    expect(created.top_count).toBe(2);
    expect(created.tiers).toBeNull();
    expect(created.lines.map((l) => l.amount)).toEqual([6, 4]);

    const fetched = (await (await SELF.fetch(`${URL}/${created.id}`, { headers: ADMIN })).json()) as AllocationWithLines;
    expect(fetched.top_count).toBe(2);
  });

  it("stores tiers for a tiered allocation", async () => {
    const tiers = [{ fromRank: 1, toRank: 2, amountEach: 2 }];
    const res = await post("", {
      title: "Tiered",
      quantity: 4,
      metric: "points",
      weeks: [weekA],
      strategy: "tiered",
      tiers,
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as AllocationWithLines;
    expect(created.tiers).toEqual(tiers);
    expect(created.lines.map((l) => l.amount)).toEqual([2, 2]);
  });
});

describe("PATCH /:id and DELETE /:id", () => {
  it("patches the title only, 404s on unknown ids, and delete cascades the lines", async () => {
    const created = (await (await post("", topN(1, () => [weekA]))).json()) as AllocationWithLines;

    const patch = await SELF.fetch(`${URL}/${created.id}`, {
      method: "PATCH",
      headers: { ...ADMIN, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(patch.status).toBe(200);
    const after = (await (await SELF.fetch(`${URL}/${created.id}`, { headers: ADMIN })).json()) as AllocationWithLines;
    expect(after.title).toBe("Renamed");
    expect(after.lines).toEqual(created.lines);

    const empty = await SELF.fetch(`${URL}/${created.id}`, {
      method: "PATCH",
      headers: { ...ADMIN, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "  " }),
    });
    expect(empty.status).toBe(400);

    for (const method of ["GET", "PATCH", "DELETE"]) {
      const res = await SELF.fetch(`${URL}/999999`, {
        method,
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ title: "x" }) : undefined,
      });
      expect(res.status, method).toBe(404);
    }

    const del = await SELF.fetch(`${URL}/${created.id}`, { method: "DELETE", headers: ADMIN });
    expect(del.status).toBe(200);
    expect((await SELF.fetch(`${URL}/${created.id}`, { headers: ADMIN })).status).toBe(404);
    const orphans = await DB.prepare("SELECT COUNT(*) AS n FROM allocation_lines WHERE allocation_id = ?")
      .bind(created.id)
      .first<{ n: number }>();
    expect(orphans?.n).toBe(0);
  });
});

describe("member merge", () => {
  it("repoints saved lines at the surviving member and leaves amounts untouched", async () => {
    const { memberService, eventService } = createServices(DB);
    const source = await memberService.create({ governor: "AllocM_Old" });
    const target = await memberService.create({ governor: "AllocM_New" });
    const week = (
      await eventService.create({
        activity: "contribution",
        date: "2028-03-06",
        rows: [{ raw_name: "AllocM_Old", value: 120000 }],
      })
    ).event.week;

    const created = (await (
      await post("", { title: "Merge case", quantity: 1, metric: "points", weeks: [week], strategy: "top_n" })
    ).json()) as AllocationWithLines;
    expect(created.lines.map((l) => [l.member_id, l.amount])).toEqual([[source.id, 1]]);

    await memberService.merge(source.id, target.id);

    const after = (await (await SELF.fetch(`${URL}/${created.id}`, { headers: ADMIN })).json()) as AllocationWithLines;
    expect(after.lines.map((l) => [l.member_id, l.governor, l.amount, l.rank, l.metric_value])).toEqual([
      [target.id, "AllocM_New", 1, 1, 3],
    ]);
  });
});
