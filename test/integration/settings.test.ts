import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ADMIN, MANAGER, VIEWER } from "./keys";

const URL = "https://example.com/api/settings/rank-bands";

describe("/api/settings/rank-bands", () => {
  it("returns the defaults when nothing is stored", async () => {
    const res = await SELF.fetch(URL, { headers: VIEWER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ top: 30, mid: 20 });
  });

  it("rejects a viewer PUT with 403", async () => {
    const res = await SELF.fetch(URL, {
      method: "PUT",
      headers: { ...VIEWER, "Content-Type": "application/json" },
      body: JSON.stringify({ top: 10, mid: 10 }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a manager PUT with 403 — band sizes are admin-gated", async () => {
    const res = await SELF.fetch(URL, {
      method: "PUT",
      headers: { ...MANAGER, "Content-Type": "application/json" },
      body: JSON.stringify({ top: 10, mid: 10 }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects non-integer and negative sizes with 400", async () => {
    for (const body of [{ top: -1, mid: 5 }, { top: 1.5, mid: 5 }, { top: "x", mid: 5 }, { top: 5 }]) {
      const res = await SELF.fetch(URL, {
        method: "PUT",
        headers: { ...ADMIN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it("admin PUT upserts and round-trips via GET", async () => {
    const put = await SELF.fetch(URL, {
      method: "PUT",
      headers: { ...ADMIN, "Content-Type": "application/json" },
      body: JSON.stringify({ top: 25, mid: 15 }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ top: 25, mid: 15 });

    const get = await SELF.fetch(URL, { headers: VIEWER });
    expect(await get.json()).toEqual({ top: 25, mid: 15 });
  });

  it("falls back to the default for a garbage stored value, per key", async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('band_top', 'garbage') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run();
    const res = await SELF.fetch(URL, { headers: VIEWER });
    // top falls back to default; mid keeps the 15 written by the previous test.
    expect(await res.json()).toEqual({ top: 30, mid: 15 });
  });
});
