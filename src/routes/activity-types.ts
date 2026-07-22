import { Hono } from "hono";
import type { Env } from "../../shared/types";
import { createServices } from "../services";

const activityTypesRoutes = new Hono<{ Bindings: Env }>();

activityTypesRoutes.get("/", async (c) => {
  const activeParam = c.req.query("active");
  const opts = activeParam === undefined ? undefined : { active: activeParam === "true" };

  const { activityService } = createServices(c.env.DB);
  return c.json(await activityService.list(opts));
});

activityTypesRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const { activityService } = createServices(c.env.DB);

  try {
    return c.json(await activityService.create(body), 201);
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes("UNIQUE") ? 409 : 400;
    return c.json({ error: message }, status);
  }
});

activityTypesRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { activityService } = createServices(c.env.DB);
  const activity = await activityService.get(id);
  if (!activity) return c.json({ error: "activity type not found" }, 404);

  return c.json(activity);
});

activityTypesRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const body = await c.req.json();
  const { activityService } = createServices(c.env.DB);

  try {
    const updated = await activityService.update(id, body);
    if (!updated) return c.json({ error: "activity type not found" }, 404);
    return c.json(updated);
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, message.includes("UNIQUE") ? 409 : message.includes("not found") ? 404 : 400);
  }
});

activityTypesRoutes.get("/:id/scoring", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { scoringService } = createServices(c.env.DB);
  try {
    return c.json(await scoringService.getConfig(id));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

activityTypesRoutes.put("/:id/scoring", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const body = await c.req.json<{ weight: number; tiers: { min_value: number; points: number }[] }>();
  const { scoringService } = createServices(c.env.DB);

  try {
    await scoringService.replaceScoring(id, { weight: body.weight, tiers: body.tiers });
  } catch (err) {
    const message = (err as Error).message;
    const status = message.includes("not found") ? 404 : 400;
    return c.json({ error: message }, status);
  }

  return c.json(await scoringService.getConfig(id));
});

export default activityTypesRoutes;
