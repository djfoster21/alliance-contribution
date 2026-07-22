import { Hono } from "hono";
import type { Env } from "../../shared/types";
import type { AuthVariables } from "../middleware/auth";
import { requireAdmin } from "../middleware/auth";
import { createServices } from "../services";

const eventsRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Maps a thrown service error to an HTTP status: a missing event id is 404; identity/key conflicts are
// 409; everything else (unknown activity key, bad instance, malformed date) is a 400 bad request.
function statusForError(message: string): 400 | 404 | 409 {
  if (message === "event not found") return 404;
  if (/conflict|duplicate|two-trap|overlap/.test(message)) return 409;
  return 400;
}

eventsRoutes.get("/", async (c) => {
  const filter = {
    activity: c.req.query("activity"),
    week: c.req.query("week"),
    from: c.req.query("from"),
    to: c.req.query("to"),
  };

  const { eventService } = createServices(c.env.DB);
  try {
    return c.json(await eventService.list(filter));
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

eventsRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { eventService } = createServices(c.env.DB);
  const result = await eventService.get(id);
  if (!result) return c.json({ error: "event not found" }, 404);

  return c.json(result);
});

eventsRoutes.post("/", async (c) => {
  const { eventService } = createServices(c.env.DB);

  try {
    const body = await c.req.json();
    return c.json(await eventService.create(body));
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

eventsRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { eventService } = createServices(c.env.DB);

  try {
    const body = await c.req.json();
    return c.json(await eventService.update(id, body));
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

eventsRoutes.delete("/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { eventService } = createServices(c.env.DB);
  const result = await eventService.get(id);
  if (!result) return c.json({ error: "event not found" }, 404);

  await eventService.delete(id);
  return c.json({ ok: true });
});

export default eventsRoutes;
