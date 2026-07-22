import { Hono } from "hono";
import type { Env } from "../../shared/types";
import type { AuthVariables } from "../middleware/auth";
import { requireAdmin } from "../middleware/auth";
import { createServices } from "../services";

const aliasesRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Maps a thrown service error to an HTTP status. Conflict is the more specific signal and is checked FIRST:
// a uniqueness/shadow conflict (or the DB UNIQUE constraint) is 409 even when the offending alias text
// happens to contain "not found". A genuine missing member/alias is 404; everything else (empty/dead
// alias) is a 400 bad request.
function statusForError(message: string): 400 | 404 | 409 {
  if (message.includes("UNIQUE") || /conflict/.test(message)) return 409;
  if (message.includes("not found")) return 404;
  return 400;
}

aliasesRoutes.get("/", async (c) => {
  const memberParam = c.req.query("member");
  let opts: { member_id?: number } | undefined;
  if (memberParam !== undefined) {
    const member_id = Number(memberParam);
    if (Number.isNaN(member_id)) return c.json({ error: "invalid member id" }, 400);
    opts = { member_id };
  }

  const { aliasService } = createServices(c.env.DB);
  return c.json(await aliasService.list(opts));
});

aliasesRoutes.post("/", async (c) => {
  const { aliasService } = createServices(c.env.DB);

  try {
    const body = await c.req.json();
    return c.json(await aliasService.add(body), 201);
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

aliasesRoutes.delete("/:id", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { aliasService } = createServices(c.env.DB);

  try {
    return c.json(await aliasService.remove(id));
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

export default aliasesRoutes;
