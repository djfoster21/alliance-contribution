import { SELF } from "cloudflare:test";
import { VIEWER } from "./keys";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createServices } from "../../src/services";

const { DB, SEED_STATEMENTS } = env;
const AUTH = { "X-Api-Key": "test-admin-key" };

beforeAll(async () => {
  for (const stmt of SEED_STATEMENTS) await DB.prepare(stmt).run();
  const { memberService } = createServices(DB);
  await memberService.create({ governor: "ApiBackupMember" });
});

describe("GET /api/admin/export", () => {
  it("requires a key at all", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/export");
    expect(res.status).toBe(401);
  });

  it("rejects the viewer key with 403", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/export", { headers: VIEWER });
    expect(res.status).toBe(403);
  });

  it("rejects the manager key with 403", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/export", {
      headers: { "X-Api-Key": "test-key" },
    });
    expect(res.status).toBe(403);
  });

  it("returns a JSON backup as a download", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/export", { headers: AUTH });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename="alliance-backup-.*\.json"/);
    const file = (await res.json()) as { format: string; tables: Record<string, unknown[]> };
    expect(file.format).toBe("alliance-backup");
    expect(file.tables.members.some((r) => (r as { governor: string }).governor === "ApiBackupMember")).toBe(true);
  });
});

describe("POST /api/admin/import", () => {
  it("POST /import requires the admin key", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "alliance-backup" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects the manager key with 403", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/import", {
      method: "POST",
      headers: { "X-Api-Key": "test-key", "Content-Type": "application/json" },
      body: JSON.stringify({ format: "alliance-backup" }),
    });
    expect(res.status).toBe(403);
  });

  it("round-trips an exported file", async () => {
    const exported = await (await SELF.fetch("https://example.com/api/admin/export", { headers: AUTH })).json();
    const res = await SELF.fetch("https://example.com/api/admin/import", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify(exported),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recomputed: boolean; imported: Record<string, number> };
    expect(body.recomputed).toBe(true);
    expect(body.imported.members).toBeGreaterThan(0);
  });

  it("rejects an invalid file with 400", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/import", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ format: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-JSON with 400", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/import", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});
