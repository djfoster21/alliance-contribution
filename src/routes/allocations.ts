import { Hono } from "hono";
import type { Context } from "hono";
import type { AllocationInput, Env } from "../../shared/types";
import type { AuthVariables } from "../middleware/auth";
import { requireAdmin } from "../middleware/auth";
import { createServices } from "../services";
import { AllocationValidationError } from "../services/allocation-service";

// Reward allocations (2026-08-07 spec). requireAdmin on EVERYTHING: the /api/admin path prefix alone
// only excludes the viewer key — the manager key would pass otherwise (contrast /api/admin/recompute,
// which is deliberately manager-accessible).
const allocationsRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
allocationsRoutes.use("*", requireAdmin);

// Validation failures -> 400; unexpected failures propagate as 500.
async function respond(c: Context, fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AllocationValidationError) return c.json({ error: err.message }, 400);
    throw err;
  }
}

// Malformed or non-object bodies are client errors (400, via respond), not uncaught 500s.
async function jsonBody<T>(c: Context): Promise<T> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw new AllocationValidationError("invalid JSON body");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AllocationValidationError("body must be a JSON object");
  }
  return parsed as T;
}

allocationsRoutes.post("/preview", async (c) =>
  respond(c, async () => {
    const { allocationService } = createServices(c.env.DB);
    return c.json(await allocationService.preview(await jsonBody<AllocationInput>(c)));
  }),
);

allocationsRoutes.post("/", async (c) =>
  respond(c, async () => {
    const { allocationService } = createServices(c.env.DB);
    return c.json(await allocationService.create(await jsonBody<AllocationInput>(c)));
  }),
);

allocationsRoutes.get("/", async (c) => {
  const { allocationService } = createServices(c.env.DB);
  return c.json(await allocationService.list());
});

allocationsRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const { allocationService } = createServices(c.env.DB);
  const allocation = await allocationService.get(id);
  if (!allocation) return c.json({ error: "not found" }, 404);
  return c.json(allocation);
});

allocationsRoutes.patch("/:id", async (c) =>
  respond(c, async () => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
    const { allocationService } = createServices(c.env.DB);
    const { title } = await jsonBody<{ title?: unknown }>(c);
    const allocation = await allocationService.updateTitle(id, title);
    if (!allocation) return c.json({ error: "not found" }, 404);
    return c.json(allocation);
  }),
);

allocationsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const { allocationService } = createServices(c.env.DB);
  const deleted = await allocationService.delete(id);
  if (!deleted) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

export default allocationsRoutes;
