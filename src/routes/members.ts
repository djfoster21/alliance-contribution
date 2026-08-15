import { Hono } from "hono";
import type { Env, RosterImportBatch } from "../../shared/types";
import type { AuthVariables } from "../middleware/auth";
import { requireAdmin } from "../middleware/auth";
import { createServices } from "../services";

const membersRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Maps a thrown service error to an HTTP status: a missing member is 404; shadowing/duplicate/alias
// conflicts are 409; everything else (empty governor, bad input) is a 400 bad request.
// A raw `CHECK constraint failed` deliberately falls through to 400 rather than getting its own branch.
// Every rank that could trip one is now rejected up front with an explicit message — by create/update for
// a single member, and by importRoster's EFFECTIVE-rank check for a whole batch — so the only way to reach
// this line with a bare CHECK message is a value that entered `members` outside this service (a restored
// backup, hand-run SQL). The remedy for that is still "fix the offending member's stored rank and resend",
// which is what 400 tells the operator; the actionable detail is in the message body, and for an import it
// arrives wrapped in importRoster's partial-apply warning. A 500 branch would be speculative machinery for
// a path validation is supposed to make unreachable.
function statusForError(message: string): 400 | 404 | 409 {
  if (message.includes("not found")) return 404;
  if (message.includes("UNIQUE") || /conflict|shadow/.test(message)) return 409;
  return 400;
}

membersRoutes.get("/", async (c) => {
  const activeParam = c.req.query("active");
  const opts = activeParam === undefined ? undefined : { active: activeParam === "true" };

  const { memberService } = createServices(c.env.DB);
  return c.json(await memberService.list(opts));
});

membersRoutes.post("/", async (c) => {
  const { memberService } = createServices(c.env.DB);

  try {
    const body = await c.req.json();
    return c.json(await memberService.create(body), 201);
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

// Bulk roster import of an already-decided batch (see MemberService.importRoster). Registered before the
// `/:id` routes so the literal `/import` segment is never captured as an id param.
membersRoutes.post("/import", requireAdmin, async (c) => {
  const { memberService } = createServices(c.env.DB);

  try {
    const batch = await c.req.json<RosterImportBatch>();
    return c.json(await memberService.importRoster(batch));
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

// Every capture date with its member count — the roster time-travel select's options. Static path,
// registered above /captures/:date so the literal segment is never captured as a date param.
membersRoutes.get("/captures", async (c) => {
  const { memberService } = createServices(c.env.DB);
  return c.json({ captures: await memberService.listCaptures() });
});

// How many snapshots a capture date already holds — the import wizard's overwrite guard. A plain GET,
// not admin-gated: it reveals only a count for a date, no member data, matching the other GETs on this
// router (list/:id/:id/profile are all readable by any authenticated tier, viewer included).
membersRoutes.get("/captures/:date", async (c) => {
  const { memberService } = createServices(c.env.DB);
  const captured_on = c.req.param("date");

  try {
    return c.json({
      captured_on,
      count: await memberService.captureCount(captured_on),
      latest: await memberService.latestCapture(),
    });
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

// Delete one capture wholesale — the roster page's "Delete update". Admin like /import, the only other
// snapshot write. 404 when the date holds nothing; malformed date → 400 via statusForError.
membersRoutes.delete("/captures/:date", requireAdmin, async (c) => {
  const { memberService } = createServices(c.env.DB);

  try {
    const deleted = await memberService.deleteCapture(c.req.param("date"));
    if (!deleted) return c.json({ error: "no capture on that date" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

// The roster as observed on one capture date (see MemberService.rosterForDate). 404 when the date
// has no snapshot rows — unlike the sibling count endpoint, where zero is a real answer, an as-of
// view of nothing is not. Malformed date → 400 via statusForError.
membersRoutes.get("/captures/:date/roster", async (c) => {
  const { memberService } = createServices(c.env.DB);

  try {
    const view = await memberService.rosterForDate(c.req.param("date"));
    if (!view) return c.json({ error: "no capture on that date" }, 404);
    return c.json(view);
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

// Per-member power/position deltas for the roster table. Registered before the `/:id` routes so the
// literal `/deltas` segment is never captured as an id. Plain GET like the other reads on this router.
membersRoutes.get("/deltas", async (c) => {
  const { memberService } = createServices(c.env.DB);
  return c.json(await memberService.deltas());
});

membersRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { memberService } = createServices(c.env.DB);
  const member = await memberService.get(id);
  if (!member) return c.json({ error: "member not found" }, 404);

  return c.json(member);
});

membersRoutes.get("/:id/profile", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { statsService } = createServices(c.env.DB);
  const profile = await statsService.memberProfile(id);
  if (!profile) return c.json({ error: "member not found" }, 404);

  return c.json(profile);
});

membersRoutes.get("/:id/snapshots", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { memberService } = createServices(c.env.DB);
  const series = await memberService.snapshots(id);
  if (!series) return c.json({ error: "member not found" }, 404);

  return c.json(series);
});

membersRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { memberService } = createServices(c.env.DB);

  try {
    const body = await c.req.json();
    const updated = await memberService.update(id, body);
    if (!updated) return c.json({ error: "member not found" }, 404);
    return c.json(updated);
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

// Merge :id (the duplicate) into `into` (the survivor) — see MemberService.merge. Destructive
// (deletes the source member), so admin-gated like /import.
membersRoutes.post("/:id/merge", requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { memberService } = createServices(c.env.DB);

  try {
    const body = await c.req.json<{ into: number }>();
    if (typeof body.into !== "number") return c.json({ error: "into must be a member id" }, 400);
    return c.json(await memberService.merge(id, body.into));
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

membersRoutes.post("/:id/rename", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const { memberService } = createServices(c.env.DB);

  try {
    const body = await c.req.json<{ governor: string; addAlias?: boolean }>();
    return c.json(await memberService.rename(id, body.governor, { addAlias: body.addAlias }));
  } catch (err) {
    const message = (err as Error).message;
    return c.json({ error: message }, statusForError(message));
  }
});

export default membersRoutes;
