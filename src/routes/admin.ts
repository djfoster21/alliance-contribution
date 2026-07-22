import { Hono } from "hono";
import type { Env } from "../../shared/types";
import { BackupValidationError } from "../domain/backup";
import type { AuthVariables } from "../middleware/auth";
import { requireAdmin } from "../middleware/auth";
import { createServices } from "../services";

// Admin escape hatch. apiKeyAuth gates all of /api/admin/* (including GET) with X-Api-Key; the destructive
// export/import routes additionally require requireAdmin (admin tier only).
const adminRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Manual full re-resolve + re-score. There is no view cache to refresh — reads are current on commit.
// Manager tier: available to both admin and manager keys.
adminRoutes.post("/recompute", async (c) => {
  const { recomputeService } = createServices(c.env.DB);
  const result = await recomputeService.run();
  // `recomputed` = rows evaluated; `updated` = rows actually written. A second call with nothing
  // pending must report updated: 0 — that is how the write-cost fix is verified against a live DB.
  return c.json({ recomputed: result.participations, updated: result.updated });
});

// Full-DB export as a downloadable JSON file.
adminRoutes.get("/export", requireAdmin, async (c) => {
  const { backupService } = createServices(c.env.DB);
  const now = new Date().toISOString();
  const file = await backupService.export(now);
  return new Response(JSON.stringify(file), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="alliance-backup-${now.slice(0, 10)}.json"`,
    },
  });
});

// Full-DB replace-all import. Validation failures -> 400; unexpected failures -> 500.
adminRoutes.post("/import", requireAdmin, async (c) => {
  const { backupService } = createServices(c.env.DB);

  const text = await c.req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  try {
    return c.json(await backupService.import(parsed));
  } catch (err) {
    const status = err instanceof BackupValidationError ? 400 : 500;
    return c.json({ error: (err as Error).message }, status);
  }
});

export default adminRoutes;
