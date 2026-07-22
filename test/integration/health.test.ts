import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("returns 200 { ok: true }", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("reads require a key", () => {
  it("rejects GET /api/members without X-Api-Key", async () => {
    const res = await SELF.fetch("https://example.com/api/members");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("accepts GET /api/members with the viewer key", async () => {
    const res = await SELF.fetch("https://example.com/api/members", {
      headers: { "X-Api-Key": "test-viewer-key" },
    });
    expect(res.status).toBe(200);
  });

  it("keeps /api/health reachable without a key (uptime probe)", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
  });

  it("keeps /api/auth/me reachable without a key (SPA key check)", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/me");
    expect(res.status).toBe(200);
  });
});

describe("the viewer tier is read-only", () => {
  it("returns role viewer for the viewer key", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/me", {
      headers: { "X-Api-Key": "test-viewer-key" },
    });
    expect(await res.json()).toEqual({ role: "viewer" });
  });

  it("rejects a write with the viewer key (403, not 401)", async () => {
    const res = await SELF.fetch("https://example.com/api/members", {
      method: "POST",
      headers: { "X-Api-Key": "test-viewer-key", "Content-Type": "application/json" },
      body: JSON.stringify({ governor: "ViewerShouldNotCreate" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("rejects /api/admin/* GET with the viewer key", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/export", {
      headers: { "X-Api-Key": "test-viewer-key" },
    });
    expect(res.status).toBe(403);
  });
});

describe("api key auth", () => {
  it("rejects POST /api/anything without X-Api-Key", async () => {
    const res = await SELF.fetch("https://example.com/api/anything", {
      method: "POST",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("accepts POST /api/anything with the correct X-Api-Key", async () => {
    const res = await SELF.fetch("https://example.com/api/anything", {
      method: "POST",
      headers: { "X-Api-Key": "test-key" },
    });
    expect(res.status).not.toBe(401);
  });

  it("rejects POST /api/anything with the wrong X-Api-Key", async () => {
    const res = await SELF.fetch("https://example.com/api/anything", {
      method: "POST",
      headers: { "X-Api-Key": "wrong-key" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects GET /api/admin/whatever without X-Api-Key", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/whatever");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("GET /api/auth/me", () => {
  it("returns role admin for the admin key", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/me", {
      headers: { "X-Api-Key": "test-admin-key" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "admin" });
  });

  it("returns role manager for the manager key", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/me", {
      headers: { "X-Api-Key": "test-key" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "manager" });
  });

  it("returns role null when no key is presented", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: null });
  });

  it("returns role null for a wrong key", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/me", {
      headers: { "X-Api-Key": "wrong-key" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: null });
  });
});

describe("destructive endpoints require the admin tier", () => {
  it("rejects a manager key on a destructive endpoint with 403", async () => {
    const res = await SELF.fetch("https://example.com/api/ingests/999999", {
      method: "DELETE",
      headers: { "X-Api-Key": "test-key" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("accepts an admin key on a destructive endpoint (auth passes; domain 404 is fine)", async () => {
    const res = await SELF.fetch("https://example.com/api/ingests/999999", {
      method: "DELETE",
      headers: { "X-Api-Key": "test-admin-key" },
    });
    expect(res.status).toBe(404);
  });
});

describe("admin key is a superset of the manager tier", () => {
  it("an admin key is accepted on a manager-tier write (recompute)", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/recompute", {
      method: "POST",
      headers: { "X-Api-Key": "test-admin-key" },
    });
    expect(res.status).toBe(200);
  });
});
