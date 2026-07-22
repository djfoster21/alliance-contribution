import { Hono } from "hono";
import type { Env } from "../../shared/types";
import { createServices } from "../services";

// Read-only temporal views served straight from D1. Still key-gated by apiKeyAuth — reachable with
// any tier, including viewer, but not anonymously.
const analyticsRoutes = new Hono<{ Bindings: Env }>();

analyticsRoutes.get("/rankings/weekly", async (c) => {
  const week = c.req.query("week");
  const activity = c.req.query("activity");
  const { statsService } = createServices(c.env.DB);
  return c.json(await statsService.weeklyRanking(week, activity));
});

analyticsRoutes.get("/rankings/overall", async (c) => {
  const activity = c.req.query("activity");
  const { statsService } = createServices(c.env.DB);
  return c.json(await statsService.overallRanking(activity));
});

analyticsRoutes.get("/attendance", async (c) => {
  const week = c.req.query("week");
  const activity = c.req.query("activity");
  const { statsService } = createServices(c.env.DB);
  return c.json(await statsService.attendance(week, activity));
});

analyticsRoutes.get("/weeks", async (c) => {
  const { statsService } = createServices(c.env.DB);
  return c.json(await statsService.weeks());
});

analyticsRoutes.get("/overview", async (c) => {
  const { statsService } = createServices(c.env.DB);
  return c.json(await statsService.overview());
});

export default analyticsRoutes;
