import { Hono } from "hono";
import type { Env } from "../../shared/types";
import type { AuthVariables } from "../middleware/auth";
import { requireAdmin } from "../middleware/auth";
import { createServices } from "../services";

const settingsRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

settingsRoutes.get("/rank-bands", async (c) => {
  const { settingsService } = createServices(c.env.DB);
  return c.json(await settingsService.getRankBands());
});

// Admin-gated by explicit user choice (stricter than the manager-editable scoring config).
settingsRoutes.put("/rank-bands", requireAdmin, async (c) => {
  const { settingsService } = createServices(c.env.DB);
  try {
    const body = await c.req.json<{ top?: unknown; mid?: unknown }>();
    return c.json(await settingsService.setRankBands(body));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

export default settingsRoutes;
